// Tolerant Kotlin declaration parser. It parses file structure — package,
// imports, and declarations with their type positions — recursively through
// nested class bodies, and captures executable bodies as balanced token
// sequences for later statement scanning. It never executes analyzed code.
// Unsupported or broken syntax raises ParseError; the driver records it in
// parse_errors and the file then contributes no dependencies or measurements.
//
// The token stream excludes comments and newlines. Newline significance is
// recovered from token line positions where Kotlin cares: expression-body
// continuation and callee/parenthesis adjacency.
import { tokenize } from './lexer.mjs';

export class ParseError extends Error {
  constructor(message, token) {
    super(token ? `${message} at line ${token.startLine}, column ${token.startColumn}` : message);
    this.token = token;
  }
}

const TYPE_KEYWORDS = new Set(['class', 'interface', 'object']);
const CONTEXTUAL_MODIFIERS = new Set([
  'abstract', 'open', 'final', 'sealed', 'inner', 'enum', 'annotation', 'data', 'value',
  'private', 'public', 'protected', 'internal', 'const', 'lateinit', 'override',
  'suspend', 'inline', 'operator', 'infix', 'tailrec', 'external', 'crossinline',
  'noinline', 'reified', 'expect', 'actual', 'companion',
]);

const loc = token => token && ({
  startOffset: token.startOffset, endOffset: token.endOffset,
  startLine: token.startLine, endLine: token.endLine,
  startColumn: token.startColumn, endColumn: token.endColumn,
});
const span = (first, last) => !first ? null : !last ? loc(first) : ({
  startOffset: first.startOffset ?? first.startOffset,
  endOffset: (last.endOffset ?? last.startOffset),
  startLine: first.startLine, endLine: last.endLine ?? last.startLine,
  startColumn: first.startColumn, endColumn: last.endColumn ?? last.endColumn,
});

export function parseKotlinSource(sourceText) {
  const allTokens = tokenize(sourceText);
  // Drop comments and newlines; positions on remaining tokens preserve lines.
  const tokens = allTokens.filter(t => !['LineComment', 'BlockComment', 'NL'].includes(t.tokenType.name));
  return { ...parseKotlinFileTokens(tokens), tokens };
}

// A parser over an arbitrary token slice. Token positions are intrinsic, so
// slices of a file's token array keep exact source evidence. Used both for
// whole files and for sub-parsing nested declarations inside captured bodies.
export function createTokenParser(tokens, start = 0, end = tokens.length) {
  // The cursor indexes the caller's array directly: sub-parsing a declaration
  // deep inside a large body never copies the remaining tokens.
  let cursor = start;

  const eof = () => cursor >= end;
  const peek = (ahead = 0) => (cursor + ahead < end ? tokens[cursor + ahead] : null) || null;
  const next = () => {
    if (eof()) throw new ParseError('unexpected end of file', tokens.at(-1));
    return tokens[cursor++];
  };
  const at = image => peek()?.image === image;
  const accept = image => at(image) ? next() : null;
  const expect = (image, message) => {
    const token = accept(image);
    if (!token) throw new ParseError(message || `expected '${image}'`, peek());
    return token;
  };
  const atIdentifier = () => peek()?.tokenType.name === 'Identifier';
  const identifier = message => {
    const token = peek();
    if (token?.tokenType.name !== 'Identifier') throw new ParseError(message || 'expected an identifier', token);
    return next();
  };
  const atSoft = word => peek()?.image === word && peek()?.tokenType.name === 'Identifier';
  const atHard = word => peek()?.image === word;

  // ---------- types -----------------------------------------------------------
  // parseType collects classifier references into `out`. It understands
  // qualification, nullable suffixes, type arguments with variance/star
  // projections, parenthesized types and function types. It returns false when
  // no type starts at the cursor, leaving the cursor unmoved in that case.

  function parseType(out) {
    const save = cursor;
    if (!parseTypeBase(out)) { cursor = save; return false; }
    return true;
  }

  function parseTypeBase(out) {
    const token = peek();
    if (!token) return false;
    if (token.image === 'suspend' && token.tokenType.name === 'Identifier' && peek(1)?.image === '(') {
      next();
      return parseTypeBase(out);
    }
    if (token.image === '(') {
      // Parenthesized type or function type: (T) or (A, B) -> R.
      next();
      parseFunctionTypeParameterList(out);
      acceptNullableSuffixes();
      if (accept('->')) {
        if (!parseTypeBase(out)) throw new ParseError('expected a result type after ->', peek());
      }
      return true;
    }
    if (token.tokenType.name !== 'Identifier') return false;
    // Qualified classifier chain.
    const typeStartCursor = cursor;
    const segments = [next()];
    while (at('.') && peek(1)?.tokenType.name === 'Identifier') {
      next();
      segments.push(next());
    }
    const reference = { name: segments.map(t => t.image).join('.'), ...span(segments[0], segments.at(-1)) };
    out.push(reference);
    if (at('<')) { reference.hasTypeArguments = true; parseTypeArgumentList(out); }
    acceptNullableSuffixes();
    // Receiver function type: T.(A) -> R — common in DSL builders. The dot
    // continues the type rather than ending it; without this branch the
    // parameter list parser chokes on the leftover '.' and the declaration
    // is lost to recovery.
    if (at('.') && peek(1)?.image === '(') {
      next(); // '.'
      next(); // '('
      parseFunctionTypeParameterList(out);
      acceptNullableSuffixes();
      if (!accept('->')) throw new ParseError('expected -> in receiver function type', peek());
      if (!parseTypeBase(out)) throw new ParseError('expected a result type after ->', peek());
      // Normalized signature for overload identity: token images carry the
      // receiver, parameter types and return type without whitespace or
      // positions, so Builder.() -> Unit and Builder.(String) -> Unit produce
      // distinct signatures even though both share the first classifier
      // reference.
      reference.functionTypeSignature = tokens.slice(typeStartCursor, cursor).map(t => t.image).join('');
      return true;
    }
    // Function-type tail: T -> R
    if (accept('->')) {
      if (!parseTypeBase(out)) throw new ParseError('expected a result type after ->', peek());
    }
    return true;
  }

  function acceptNullableSuffixes() {
    while (at('?')) next();
  }

  function parseTypeArgumentList(out) {
    expect('<');
    for (;;) {
      // variance annotations or star projection
      while (at('in') || atSoft('out') || atSoft('reified')) next();
      // Type-use annotations: List<@Size(max = 32) String>
      while (at('@')) {
        next();
        if (atIdentifier()) parseTypeBase(out);
        if (at('(')) skipBalancedGroup();
      }
      if (accept('*')) {
        // star projection
      } else if (!parseTypeBase(out)) {
        // Tolerant: skip one token inside malformed type arguments.
        if (at('>') || at(',')) { /* boundaries handled below */ }
        else if (!eof()) next();
      }
      acceptNullableSuffixes();
      if (accept(',')) continue;
      expect('>', 'unterminated type arguments');
      return;
    }
  }

  // Function type parameter list, cursor just past '(': elements are types
  // with optional `name:` prefixes, separated by commas, up to ')'. Kotlin
  // distinguishes a named parameter from its type with a colon, not with
  // capitalization — so Payload in `Payload: String` is a name and never a
  // reference, while the type of `event: Événement` is collected no matter
  // how the name is capitalized.
  function parseFunctionTypeParameterList(out) {
    for (;;) {
      if (accept(')')) return;
      if (atIdentifier() && peek(1)?.image === ':') { next(); next(); }
      if (!parseTypeBase(out)) {
        // Tolerant: skip one token inside malformed parameter types.
        if (at(')') || at(',')) { /* boundaries handled below */ }
        else if (!eof()) next();
      }
      if (accept(',')) continue;
      if (accept(')')) return;
      if (eof()) throw new ParseError('unterminated function type parameter list', peek());
    }
  }

  // ---------- annotations -------------------------------------------------------
  function parseAnnotations(out) {
    while (at('@')) {
      next();
      // use-site target: @field:X / @get:X / @param:X / @file:X …
      if (atIdentifier() && peek(1)?.image === ':'
        && ['field', 'get', 'set', 'param', 'setparam', 'property', 'receiver', 'file', 'delegate'].includes(peek().image)) {
        next(); next();
      }
      if (atIdentifier()) {
        const before = out.length;
        parseTypeBase(out);
        // annotation constructor arguments are expressions, not types: skip
        if (at('(')) skipBalancedGroup();
        // Keep only the annotation type itself, not any stray scan of args.
        if (out.length > before + 1) out.splice(before + 1);
      }
    }
  }

  // ---------- modifiers -----------------------------------------------------------
  function parseModifiers() {
    const words = [];
    for (;;) {
      const token = peek();
      if (!token || token.tokenType.name !== 'Identifier') break;
      if (!CONTEXTUAL_MODIFIERS.has(token.image)) break;
      const following = peek(1);
      // A contextual modifier must be followed by something that can continue a
      // declaration; otherwise it is the declared name itself (e.g. a property
      // called `open` — rare, but tolerance beats strictness here).
      if (!following || ['=', ')', ';', '->'].includes(following.image)) break;
      words.push(next().image);
    }
    return words;
  }

  // ---------- shared scanners -----------------------------------------------------
  function skipBalancedGroup() {
    const open = peek();
    const pairs = { '(': ')', '{': '}', '[': ']' };
    const closeImage = pairs[open?.image];
    if (!closeImage) return null;
    next();
    let depth = 1, last = open;
    while (!eof() && depth > 0) {
      const token = next();
      last = token;
      if (token.image === open.image) depth++;
      else if (token.image === closeImage) depth--;
    }
    return { open, close: last };
  }

  function captureBody() {
    // Captures a { … } block as tokens for statement scanning.
    const open = expect('{');
    const start = cursor;
    let depth = 1, last = open;
    while (!eof() && depth > 0) {
      const token = next();
      if (token.image === '{') depth++;
      else if (token.image === '}') { depth--; if (depth === 0) { last = token; break; } }
      last = token;
    }
    if (depth > 0) throw new ParseError('unterminated block', open);
    return {
      open: loc(open), close: loc(last),
      tokens: tokens.slice(start, cursor - 1),
    };
  }

  // Expression bodies: end where the next token cannot continue the expression
  // and either starts on a later line (newline termination) or closes a scope.
  const INFIX_CONTINUATIONS = new Set(['.', '?.', '::', '+', '-', '*', '/', '%', '&&', '||', '==', '!=', '===', '!==', '<', '>', '<=', '>=', '?:', '->', ',', '=']);
  const INFIX_WORDS = new Set(['in', 'is', 'as', 'else', 'catch', 'finally']);

  function captureExpressionBody() {
    const collected = [];
    let round = 0, square = 0, curly = 0;
    let first = null, last = null;
    while (!eof()) {
      const token = peek();
      const nested = round > 0 || square > 0 || curly > 0;
      const prev = collected.at(-1);
      if (!nested && collected.length) {
        if ([';', '}'].includes(token.image)) break;
        // Newline termination: token on a later line that cannot continue.
        const continuesForward = INFIX_CONTINUATIONS.has(token.image) || INFIX_WORDS.has(token.image);
        const continuesBackward = prev && (INFIX_CONTINUATIONS.has(prev.image) || INFIX_WORDS.has(prev.image) || prev.image === '(');
        if (!continuesForward && !continuesBackward) {
          if (token.startLine > (last?.endLine ?? last?.startLine)) {
            // A control condition whose branch has not started yet is an
            // incomplete expression: if (c)\n  branch is one expression.
            if (!endsWithUnbranchedControl(collected)) break;
          }
          // Declaration keywords end the expression even on the same line
          // when they cannot be part of it.
          if (['fun', 'val', 'var', 'class', 'interface', 'object', 'typealias', 'import'].includes(token.image)) break;
        }
      }
      if (token.image === '(') round++;
      else if (token.image === ')') {
        if (round === 0 && !collected.length) break;
        if (round === 0) break;
        round--;
      }
      else if (token.image === '[') square++;
      else if (token.image === ']') square = Math.max(0, square - 1);
      else if (token.image === '{') curly++;
      else if (token.image === '}') curly--;
      first = first || token;
      last = token;
      collected.push(token);
      next();
    }
    return {
      tokens: collected,
      open: first ? loc(first) : null,
      close: last ? loc(last) : null,
    };
  }

  // Whether collected tokens end with a control construct whose condition
  // just closed but whose branch has not begun: … if (c) |newline branch.
  function endsWithUnbranchedControl(collected) {
    if (!collected.length || collected.at(-1).image !== ')') return false;
    let depth = 0, k = collected.length - 1;
    for (; k >= 0; k--) {
      if (collected[k].image === ')') depth++;
      else if (collected[k].image === '(') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (k <= 0) return false;
    const before = collected[k - 1];
    return ['if', 'when', 'while', 'for', 'catch'].includes(before.image);
  }

  // ---------- parameters ------------------------------------------------------------
  function parseParameterList(out) {
    const parameters = [];
    if (!at('(')) return { parameters, open: null, close: null };
    const open = next();
    while (!eof() && !at(')')) {
      parseAnnotations(out);
      let vararg = false, property = false;
      // Parameter modifiers precede val/var and the name. A candidate modifier
      // directly followed by ':', '=' or the list end is the parameter name
      // itself (parameters may be called data, open or value).
      for (;;) {
        const token = peek();
        if (!token) break;
        if (atSoft('vararg') && ![':', '=', ')', ','].includes(peek(1)?.image)) { vararg = true; next(); continue; }
        if (atSoft('crossinline') || atSoft('noinline')) { next(); continue; }
        if (token.tokenType.name === 'Identifier' && CONTEXTUAL_MODIFIERS.has(token.image)
          && ![':', '=', ')', ','].includes(peek(1)?.image)) { next(); continue; }
        break;
      }
      if (at('val') || at('var')) { property = true; next(); }
      if (!atIdentifier()) {
        if (!skipParameterDebris()) break;
        continue;
      }
      const name = next();
      const typeRefs = [];
      if (accept(':')) parseType(typeRefs);
      out.push(...typeRefs);
      let hasDefault = false;
      if (accept('=')) {
        hasDefault = true;
        skipDefaultExpression();
      }
      parameters.push({ name: name.image, vararg, property, hasDefault, typeReferences: typeRefs, ...loc(name) });
      if (!accept(',')) break;
    }
    const close = expect(')', 'unterminated parameter list');
    return { parameters, open: loc(open), close: loc(close) };
  }

  function skipParameterDebris() {
    let round = 0;
    while (!eof()) {
      const token = peek();
      if (round === 0 && token.image === ',') { next(); return true; }
      if (round === 0 && token.image === ')') return false;
      if (token.image === '(') round++;
      else if (token.image === ')') round--;
      next();
    }
    return false;
  }

  function skipDefaultExpression() {
    let round = 0, square = 0, curly = 0;
    while (!eof()) {
      const token = peek();
      if (round === 0 && square === 0 && curly === 0 && [',', ')'].includes(token.image)) return;
      if (token.image === '(') round++;
      else if (token.image === ')') { if (round > 0) round--; }
      else if (token.image === '[') square++;
      else if (token.image === ']') square--;
      else if (token.image === '{') curly++;
      else if (token.image === '}') curly--;
      next();
    }
  }

  // ---------- type parameters & bounds ------------------------------------------------
  function parseTypeParameters() {
    const names = [];
    if (!at('<')) return names;
    next();
    for (;;) {
      while (at('in') || atSoft('out') || atSoft('reified') || at('@')) {
        if (at('@')) { next(); parseTypeBase([]); continue; }
        next();
      }
      if (!atIdentifier()) break;
      names.push(next().image);
      // optional upper bound after ':'
      if (accept(':')) parseTypeBase([]);
      if (accept(',')) continue;
      break;
    }
    // Tolerate nested/malformed input up to the closing '>'.
    let depth = 1;
    while (!eof() && depth > 0) {
      const token = next();
      if (token.image === '<') depth++;
      else if (token.image === '>') depth--;
    }
    return names;
  }

  function parseWhereClauses(out) {
    while (atSoft('where')) {
      next();
      for (;;) {
        if (!atIdentifier()) break;
        next(); // the type parameter name
        if (accept(':')) parseType(out);
        if (!accept(',')) break;
      }
    }
  }

  // ---------- supertypes ------------------------------------------------------------------
  function parseSupertypeList(out) {
    // After ':', comma-separated entries Type[(args)] [by expr].
    for (;;) {
      const before = out.length;
      if (!parseTypeBase(out)) break;
      if (at('(')) skipBalancedGroup();
      if (atSoft('by')) {
        next();
        skipDelegateExpression();
      }
      if (out.length === before) break;
      if (!accept(',')) break;
    }
  }

  function skipDelegateExpression() {
    let round = 0, curly = 0;
    let last = null;
    const collected = [];
    while (!eof()) {
      const token = peek();
      if (round === 0 && curly === 0 && [',', '{'].includes(token.image)) return;
      // A delegate expression is an ordinary expression: it ends where the
      // next token cannot continue it and starts a later line, or where a
      // declaration keyword appears at the same nesting level.
      if (round === 0 && curly === 0 && last) {
        const continuesForward = INFIX_CONTINUATIONS.has(token.image) || INFIX_WORDS.has(token.image);
        const continuesBackward = INFIX_CONTINUATIONS.has(last.image) || INFIX_WORDS.has(last.image);
        if (!continuesForward && !continuesBackward) {
          // A control condition whose branch has not started yet is an
          // incomplete expression, exactly as in expression bodies:
          // by if (c)\n  branch is one delegate expression.
          if (token.startLine > last.endLine && !endsWithUnbranchedControl(collected)) return;
          if (['fun', 'val', 'var', 'class', 'interface', 'object', 'typealias', 'constructor', 'init'].includes(token.image)
            && token.tokenType.name === 'Keyword') return;
        }
      }
      if (token.image === '(') round++;
      else if (token.image === ')') round--;
      else if (token.image === '{') curly++;
      else if (token.image === '}') curly--;
      last = token;
      collected.push(token);
      next();
    }
  }

  // ---------- declarations ------------------------------------------------------------------
  // Declaration nodes carry both a java-parser-ish shape (name/location) and
  // the reduction data used by later stages. `children` maps hold nested
  // declarations so reduction can walk uniformly.

  function parseDeclaration() {
    const annotations = [];
    parseAnnotations(annotations);
    const modifiers = parseModifiers();
    parseAnnotations(annotations);
    const extraModifiers = parseModifiers();
    modifiers.push(...extraModifiers);
    const token = peek();
    if (!token) return null;

    // class-like: [fun] interface / [enum|annotation|data|sealed|value] class / class
    // Backtick-quoted identifiers are never declaration keywords: their token
    // type is Identifier even when the image matches a keyword.
    const unquoted = word => token.image === word && !token.quoted;
    if (unquoted('class') || unquoted('interface')
      || (unquoted('fun') && peek(1)?.image === 'interface' && !peek(1)?.quoted)
      || (['enum', 'annotation', 'data', 'sealed', 'value'].includes(token.image) && !token.quoted && peek(1) && ['class', 'interface'].includes(peek(1).image) && !peek(1).quoted)) {
      return parseClassLike(modifiers, annotations);
    }
    if (unquoted('object')) return parseObjectLike(modifiers, annotations);
    if (unquoted('fun')) return parseFunction(modifiers, annotations);
    if (unquoted('val') || unquoted('var')) return parseProperty(modifiers, annotations);
    if (unquoted('typealias')) return parseTypeAlias(modifiers, annotations);
    if (unquoted('constructor')) return parseSecondaryConstructor(modifiers, annotations);
    if (token.image === 'init' && peek(1)?.image === '{' && !token.quoted) return parseInitBlock(modifiers, annotations);
    return null;
  }

  function parseClassLike(modifiers, annotations) {
    let kind = 'class';
    const first = peek();
    if (atHard('fun') && peek(1)?.image === 'interface') { next(); kind = 'interface'; modifiers.push('fun'); }
    while (['enum', 'annotation', 'data', 'sealed', 'value'].includes(peek()?.image) && peek(1) && ['class', 'interface'].includes(peek(1).image)) {
      const word = next().image;
      if (word === 'enum') kind = 'enum';
      else if (word === 'annotation') kind = 'annotation';
      if (!modifiers.includes(word)) modifiers.push(word);
    }
    const keyword = next();
    if (keyword.image === 'interface' && kind === 'class') kind = 'interface';
    if (modifiers.includes('enum')) kind = 'enum';
    else if (modifiers.includes('annotation')) kind = 'annotation';
    const name = identifier('expected a class name');
    const typeParameters = parseTypeParameters();
    let primaryConstructor = null;
    // An annotated or visibility-modified primary constructor carries the
    // constructor keyword explicitly: class Foo @Inject constructor(…).
    if (at('@') || atSoft('constructor') || (peek()?.tokenType.name === 'Identifier' && CONTEXTUAL_MODIFIERS.has(peek().image) && peek(1)?.image !== '(')) {
      const ctorAnnotations = [];
      parseAnnotations(ctorAnnotations);
      while (peek()?.tokenType.name === 'Identifier' && CONTEXTUAL_MODIFIERS.has(peek().image) && peek().image !== 'constructor') next();
      if (atSoft('constructor') && peek().image === 'constructor') {
        next();
        if (at('(')) {
          const ctorRefs = [];
          const ctor = parseParameterList(ctorRefs);
          primaryConstructor = { ...ctor, typeReferences: ctorRefs, annotations: ctorAnnotations };
        }
      }
    }
    if (!primaryConstructor && at('(')) {
      const ctorRefs = [];
      const ctor = parseParameterList(ctorRefs);
      primaryConstructor = { ...ctor, typeReferences: ctorRefs };
    }
    const supertypes = [];
    if (accept(':')) parseSupertypeList(supertypes);
    const typeBounds = [];
    parseWhereClauses(typeBounds);
    const members = [];
    const enumEntries = [];
    let bodyRange = null;
    // A bodyless declaration still extends through its header: constructor
    // types, supertypes and where clauses are part of its extent, and type
    // parameters stay in scope across all of them.
    const headerEnd = tokens[cursor - 1] && cursor > 0 ? loc(tokens[cursor - 1]) : loc(name);
    if (at('{')) {
      const body = captureBalancedDeclarationBlock(members, kind === 'enum' ? enumEntries : null);
      bodyRange = body;
    } else accept(';');
    return {
      nodeName: nodeNameOf(kind), kind, name: name.image, modifiers, annotations,
      typeParameters, primaryConstructor, supertypes, typeBounds, members, enumEntries,
      ...span(first, bodyRange?.close ? { startOffset: bodyRange.close.startOffset, endOffset: bodyRange.close.endOffset, startLine: bodyRange.close.startLine, endLine: bodyRange.close.endLine, startColumn: bodyRange.close.startColumn, endColumn: bodyRange.close.endColumn } : name),
      declStart: loc(first), declEnd: bodyRange?.close || headerEnd,
      bodyRange,
    };
  }

  function nodeNameOf(kind) {
    return {
      class: 'classDeclaration', interface: 'interfaceDeclaration',
      enum: 'enumDeclaration', annotation: 'annotationClassDeclaration',
    }[kind] || 'classDeclaration';
  }

  // Parses a class/object body as a sequence of member declarations. Enum
  // entries and stray tokens are skipped tolerantly; nested declarations are
  // full recursive parses. Returns the body's open/close positions.
  function captureBalancedDeclarationBlock(members, entries = null) {
    const open = expect('{');
    // Entry scanning is bounded to the enum's entry list: it ends at the
    // first member declaration or at the ';' separating entries from members.
    // Outside that list an identifier-led brace group is never an entry body —
    // treating it as one misreads custom accessors like private set(value) {
    // and swallows the members after them.
    let entryScan = entries !== null;
    while (!eof() && !at('}')) {
      const before = cursor;
      // init blocks and secondary constructors are members too. A member that
      // fails to parse must not discard the file: skip forward one token and
      // keep scanning instead of propagating the failure.
      let declaration = null;
      try {
        declaration = parseDeclaration();
      } catch {
        declaration = null;
      }
      if (declaration) { members.push(declaration); entryScan = false; continue; }
      // Enum entries: IDENTIFIER [(args)] [{ body }] [,]. Their names are
      // member evidence: import pkg.Enum.ENTRY binds through the enum type.
      // Any identifier counts, not only uppercase ones: lowercase entries are
      // legal Kotlin, and gating on case would skip them here only to record
      // an uppercase constructor argument as a bogus entry instead.
      if (entryScan && atIdentifier()) {
        const entry = next();
        entries.push(entry.image);
        if (at('(')) skipBalancedGroup();
        // An entry body is an anonymous subclass of the enum: its members are
        // never members of the enum type, but their complexity and dependencies
        // are real. They parse into a synthetic carrier instead of being
        // skipped, mirroring the Java adapter's enum-constant handling.
        if (at('{')) {
          const entryMembers = [];
          const entryRange = captureBalancedDeclarationBlock(entryMembers);
          if (entryMembers.length) {
            members.push({
              nodeName: 'enumEntryDeclaration', kind: 'enumEntry', name: entry.image,
              modifiers: [], annotations: [], typeParameters: [], members: entryMembers,
              supertypes: [], typeBounds: [],
              ...span(entry, entryRange.close), declStart: loc(entry), declEnd: entryRange.close,
              bodyRange: entryRange,
            });
          }
        }
        continue;
      }
      if (at(',')) { next(); continue; }
      if (at(';')) { next(); entryScan = false; continue; }
      // Unrecognized member content: skip tolerantly. Balanced groups go as
      // units — a failed member parse can leave the cursor before its body,
      // and skipping braces one token at a time would mistake the body's
      // closing brace for the end of this declaration block, displacing every
      // member after it to the outer scope.
      if (cursor === before) {
        if (at('{') || at('(') || at('[')) skipBalancedGroup();
        else next();
      }
    }
    const close = expect('}', 'unterminated declaration block');
    return { open: loc(open), close: loc(close) };
  }

  function parseObjectLike(modifiers, annotations) {
    const first = peek();
    expect('object');
    let name = null;
    if (atIdentifier() && ![':'].includes(peek(1)?.image)) name = next();
    else if (atIdentifier() && peek(1) && !['{'].includes(peek(1).image) && peek(1).image !== '(') name = next();
    const supertypes = [];
    if (accept(':')) parseSupertypeList(supertypes);
    const members = [];
    let bodyRange = null;
    if (at('{')) bodyRange = captureBalancedDeclarationBlock(members);
    return {
      nodeName: 'objectDeclaration', kind: 'object', name: name?.image ?? null, modifiers, annotations,
      companion: modifiers.includes('companion'),
      typeParameters: [], primaryConstructor: null, supertypes, typeBounds: [], members,
      ...span(first, name || first),
      declStart: loc(first), declEnd: bodyRange?.close || loc(name || first),
      bodyRange,
    };
  }

  function parseTypeAlias(modifiers, annotations) {
    const first = next(); // typealias
    const name = identifier('expected a typealias name');
    const typeParameters = parseTypeParameters();
    expect('=', "expected '=' in a typealias declaration");
    const aliased = [];
    parseType(aliased);
    // The aliased type is part of the declaration extent: type parameters
    // stay in scope across the right-hand side.
    const headerEnd = cursor > 0 && tokens[cursor - 1] ? loc(tokens[cursor - 1]) : loc(name);
    return {
      nodeName: 'typeAliasDeclaration', kind: 'typealias', name: name.image, modifiers, annotations,
      typeParameters, aliasedReferences: aliased, supertypes: [], typeBounds: [], members: [],
      ...span(first, name), declStart: loc(first), declEnd: headerEnd, bodyRange: null,
    };
  }

  function probeReceiverType() {
    // Extension receiver: a type, '.', then the member name. The member name
    // is the final simple segment before the parameter list or type position;
    // the receiver is everything before it and may itself be a qualified or
    // generic type (JdbcClient.StatementSpec.bindService, List<T>.first). The
    // cursor ends before the member name, never consuming it.
    const save = cursor;
    // Parenthesized receivers — function types like (() -> Int).run — start
    // with '('. The collected inner references become the receiver evidence;
    // without this branch the member name probe throws and drops the file.
    if (at('(')) {
      const receiverRefs = [];
      const typeStart = peek();
      if (!parseType(receiverRefs)) { cursor = save; return null; }
      if (!(at('.') || at('?.')) || peek(1)?.tokenType.name !== 'Identifier') { cursor = save; return null; }
      next();
      const memberStartParen = cursor;
      const typeEnd = tokens[cursor - 2] || typeStart;
      cursor = memberStartParen;
      return {
        functionType: true, references: receiverRefs,
        name: receiverRefs[0]?.name ?? null,
        ...span(typeStart, typeEnd),
      };
    }
    if (!atIdentifier()) return null;
    const segments = [];
    let memberStart = cursor;
    for (;;) {
      if (!atIdentifier()) { cursor = save; return null; }
      memberStart = cursor;
      const name = next();
      let typeArguments = null;
      if (at('<')) {
        const scratch = [];
        typeArguments = true;
        parseTypeArgumentList(scratch);
      }
      segments.push({ token: name, typeArguments });
      if (at('.') && peek(1)?.tokenType.name === 'Identifier') { next(); continue; }
      // Nullable receiver: String?.tag lexes the joiner as one `?.` token.
      if (at('?.') && peek(1)?.tokenType.name === 'Identifier') { next(); continue; }
      break;
    }
    if (segments.length < 2) { cursor = save; return null; }
    const member = segments.at(-1);
    if (member.typeArguments) { cursor = save; return null; }
    const receiverSegments = segments.slice(0, -1);
    const reference = {
      name: receiverSegments.map(segment => segment.token.image).join('.'),
      ...span(receiverSegments[0].token, receiverSegments.at(-1).token),
      hasTypeArguments: receiverSegments.some(segment => segment.typeArguments),
    };
    // The cursor must sit before the member name, never consuming it.
    cursor = memberStart;
    return reference;
  }

  function parseFunction(modifiers, annotations) {
    const first = next(); // fun
    // Type parameters of the function come before any receiver.
    const typeParameters = parseTypeParameters();
    const receiver = probeReceiverType();
    const name = identifier('expected a function name');
    const refs = [];
    const { parameters, open, close } = parseParameterList(refs);
    const parameterTypeRefs = refs.slice();
    const returnReferences = [];
    if (accept(':')) parseType(returnReferences);
    const typeBounds = [];
    parseWhereClauses(typeBounds);
    // The header end covers return types and where clauses: an abstract
    // function's type parameters stay in scope through all of them.
    const headerEnd = cursor > 0 && tokens[cursor - 1] ? loc(tokens[cursor - 1]) : (close || loc(name));
    let bodyKind = 'none', bodyTokens = [], bodyRange = null;
    if (at('{')) {
      const body = captureBody();
      bodyKind = 'block';
      bodyTokens = body.tokens;
      bodyRange = { open: body.open, close: body.close };
    } else if (accept('=')) {
      const expression = captureExpressionBody();
      bodyKind = 'expression';
      bodyTokens = expression.tokens;
      bodyRange = expression.open ? { open: expression.open, close: expression.close } : null;
    }
    accept(';');
    return {
      nodeName: 'functionDeclaration', kind: 'function', name: name.image, modifiers, annotations,
      typeParameters, receiverReference: receiver, parameters, parameterTypeReferences: parameterTypeRefs,
      returnReferences, typeBounds, bodyKind, bodyTokens, bodyRange,
      parameterList: open ? { open, close } : null,
      ...span(first, name), declStart: loc(first),
      declEnd: bodyRange?.close || headerEnd,
    };
  }

  function parseProperty(modifiers, annotations) {
    const first = next(); // val / var
    if (at('(')) {
      // Destructuring declaration: no own name; capture initializer as body.
      skipBalancedGroup();
      const typeRefs = [];
      if (accept(':')) parseType(typeRefs);
      let bodyTokens = [], bodyRange = null;
      if (accept('=')) {
        const expression = captureExpressionBody();
        bodyTokens = expression.tokens;
        bodyRange = expression.open ? { open: expression.open, close: expression.close } : null;
      }
      return {
        nodeName: 'propertyDeclaration', kind: 'property', name: null, destructuring: true, modifiers, annotations,
        typeReferences: typeRefs, bodyTokens, bodyRange, accessors: [],
        ...span(first, first), declStart: loc(first), declEnd: bodyRange?.close || loc(first),
      };
    }
    const receiver = probeReceiverType();
    const name = identifier('expected a property name');
    const typeReferences = [];
    if (accept(':')) parseType(typeReferences);
    let bodyTokens = [], bodyRange = null, delegated = false;
    if (accept('=')) {
      const expression = captureExpressionBody();
      bodyTokens = expression.tokens;
      bodyRange = expression.open ? { open: expression.open, close: expression.close } : null;
    } else if (atSoft('by')) {
      next();
      delegated = true;
      const expression = captureExpressionBody();
      bodyTokens = expression.tokens;
      bodyRange = expression.open ? { open: expression.open, close: expression.close } : null;
    }
    const accessors = [];
    for (;;) {
      // Accessors may carry their own visibility modifiers: private set(value)
      // is one accessor, not a member named set. Skip the modifiers before
      // recognizing the keyword so the member loop never misreads it.
      let lookahead = 0;
      for (;;) {
        const ahead = peek(lookahead);
        if (!ahead) break;
        if (['private', 'protected', 'internal'].includes(ahead.image)) { lookahead++; continue; }
        if (ahead.image !== '@') break;
        // Accessor annotations (@Synchronized get, @Inject private set) sit
        // before the keyword just like modifiers. Count the whole group —
        // dotted name and optional argument list — so it is skipped wholesale.
        lookahead++;
        if (peek(lookahead)?.tokenType.name === 'Identifier') {
          lookahead++;
          while (peek(lookahead)?.image === '.' && peek(lookahead + 1)?.tokenType.name === 'Identifier') lookahead += 2;
        }
        if (peek(lookahead)?.image === '(') {
          let depth = 0;
          do {
            if (peek(lookahead)?.image === '(') depth++;
            else if (peek(lookahead)?.image === ')') depth--;
            lookahead++;
          } while (depth > 0 && peek(lookahead));
        }
      }
      const token = peek(lookahead);
      if (!token || token.tokenType.name !== 'Identifier') break;
      if (!['get', 'set'].includes(token.image) || peek(lookahead + 1)?.image !== '(') break;
      while (lookahead--) next();
      const keyword = next();
      skipBalancedGroup();
      // A getter may declare its result type before the body: get(): Int = …
      if (accept(':')) parseType(typeReferences);
      let accKind = 'none', accTokens = [], accRange = null;
      if (at('{')) {
        const body = captureBody();
        accKind = 'block'; accTokens = body.tokens;
        accRange = { open: body.open, close: body.close };
      } else if (accept('=')) {
        const expression = captureExpressionBody();
        accKind = 'expression'; accTokens = expression.tokens;
        accRange = expression.open ? { open: expression.open, close: expression.close } : null;
      }
      accessors.push({ kind: keyword.image, bodyKind: accKind, bodyTokens: accTokens, bodyRange: accRange, ...loc(keyword) });
    }
    accept(';');
    return {
      nodeName: 'propertyDeclaration', kind: 'property', name: name.image, modifiers, annotations,
      receiverReference: receiver, typeReferences, delegated, bodyTokens, bodyRange, accessors,
      ...span(first, name), declStart: loc(first), declEnd: bodyRange?.close || loc(name),
    };
  }

  function parseSecondaryConstructor(modifiers, annotations) {
    const first = next(); // constructor
    const refs = [];
    const { parameters, open, close } = parseParameterList(refs);
    // this/super delegation call
    if (accept(':')) {
      if (atSoft('this') || atHard('this') || atSoft('super') || atHard('super')) {
        next();
        if (at('(')) skipBalancedGroup();
      }
    }
    let bodyTokens = [], bodyRange = null, bodyKind = 'none';
    if (at('{')) {
      const body = captureBody();
      bodyKind = 'block';
      bodyTokens = body.tokens;
      bodyRange = { open: body.open, close: body.close };
    }
    return {
      nodeName: 'constructorDeclaration', kind: 'constructor', name: 'constructor', modifiers, annotations,
      parameters, parameterTypeReferences: refs, bodyKind, bodyTokens, bodyRange,
      parameterList: open ? { open, close } : null,
      ...span(first, first), declStart: loc(first), declEnd: bodyRange?.close || close || loc(first),
    };
  }

  function parseInitBlock(modifiers, annotations) {
    const first = next(); // init
    const body = captureBody();
    return {
      nodeName: 'initBlock', kind: 'init', name: '<init>', modifiers, annotations,
      parameters: [], bodyKind: 'block', bodyTokens: body.tokens,
      bodyRange: { open: body.open, close: body.close },
      ...span(first, first), declStart: loc(first), declEnd: body.close,
    };
  }

  // ---------- file ------------------------------------------------------------------

  function parseFile() {
    const typeReferences = [];
    // @file: annotations
    while (at('@')) {
      next();
      if (atSoft('file') && peek(1)?.image === ':') { next(); next(); }
      if (atIdentifier()) parseTypeBase(typeReferences);
      if (at('(')) skipBalancedGroup();
    }
    let packageName = '';
    if (atHard('package')) {
      next();
      const segments = [];
      if (atIdentifier()) {
        segments.push(next());
        while (at('.') && peek(1)?.tokenType.name === 'Identifier') { next(); segments.push(next()); }
      }
      packageName = segments.map(t => t.image).join('.');
      accept(';');
    }
    const imports = [];
    for (;;) {
      const token = peek();
      if (token?.image !== 'import' || token.tokenType.name !== 'Identifier') break;
      const keyword = next();
      if (!atIdentifier() && !at('*')) throw new ParseError('expected an import path', peek());
      const segments = [next()];
      while (at('.')) {
        next();
        if (at('*')) { segments.push(next()); break; }
        segments.push(identifier('expected an import path segment'));
      }
      const wildcard = segments.at(-1)?.image === '*';
      let alias = null;
      if (atHard('as')) {
        next();
        alias = identifier('expected an import alias').image;
      }
      imports.push({
        name: segments.filter(t => t.image !== '*').map(t => t.image).join('.'),
        wildcard, alias,
        ...loc(keyword),
      });
      accept(';');
    }
    const declarations = [];
    while (!eof()) {
      const before = cursor;
      const declaration = parseDeclaration();
      if (declaration) declarations.push(declaration);
      else if (at(';')) next();
      else if (cursor === before) next(); // tolerate stray tokens
    }
    return { packageName, imports, declarations, fileAnnotationReferences: typeReferences };
  }

  // Parses a single type at the cursor. Returns true when a type was read.
  function parseTypeProbe(out) {
    return parseType(out);
  }

  return { parseFile, parseDeclaration, parseTypeProbe, eof, peek: () => peek(), skipRemaining: () => { cursor = tokens.length; } };
}

function parseKotlinFileTokens(tokens) {
  const parser = createTokenParser(tokens);
  return parser.parseFile();
}
