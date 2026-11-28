// Kotlin tokenizer for captured source text. No Kotlin compiler, Gradle or
// analyzed code runs. Every token keeps UTF-16 source offsets and one-based
// line/column positions for evidence. Newlines are explicit NL tokens: Kotlin
// statement boundaries are newline-sensitive, and later stages compare token
// lines when a callee and its argument list must join without an NL break.

export const HARD_KEYWORDS = new Set([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if',
  'in', 'interface', 'is', 'null', 'object', 'package', 'return', 'super',
  'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while',
]);

// Multi-character operators, longest first. `?:` is the Elvis token: a `?`
// directly followed by `:` never forms two meaningful separate tokens in
// Kotlin source, because nullable types are not valid in the positions where
// that reading would matter.
const OPERATORS = [
  '...', '===', '!==', '?.', '!!', '::', '->', '..', '==', '!=', '<=', '>=',
  '&&', '||', '+=', '-=', '*=', '/=', '%=', '++', '--', '?:', '=>',
  '(', ')', '{', '}', '[', ']', '.', ',', ':', ';', '<', '>', '=', '+', '-',
  '*', '/', '%', '!', '?', '@', '#', '&', '|', '^', '~',
];
// '#' is not a Kotlin operator; it terminates an operator scan failure fast.
// '-' must not start a scan that would swallow the second '-' of '--' wrongly;
// ordering longest-first above already handles it.

export class LexError extends Error {
  constructor(message, offset, line, column) {
    super(message);
    this.offset = offset;
    this.line = line;
    this.column = column;
  }
}

export function tokenize(sourceText) {
  const tokens = [];
  const length = sourceText.length;
  let offset = 0, line = 1, lineStart = 0;

  const position = () => ({ line, column: offset - lineStart + 1 });
  const advance = count => {
    for (let i = 0; i < count; i++) {
      if (sourceText[offset] === '\n') { line++; lineStart = offset + 1; }
      offset++;
    }
  };
  const push = (type, start, startLine, startColumn, image) => {
    tokens.push({
      tokenType: { name: type }, image: image ?? sourceText.slice(start, offset),
      startOffset: start, endOffset: offset - 1,
      startLine, endLine: line, startColumn, endColumn: offset - lineStart,
    });
  };
  const failHere = (message, at = offset) => {
    let failureLine = 1, failureStart = 0;
    for (let i = 0; i < at; i++) if (sourceText[i] === '\n') { failureLine++; failureStart = i + 1; }
    throw new LexError(message, at, failureLine, at - failureStart + 1);
  };

  while (offset < length) {
    const char = sourceText[offset];
    const start = offset, startLine = line, startColumn = position().column;

    // Newlines, with the CR of CRLF folded into one NL token.
    if (char === '\n' || char === '\r') {
      if (char === '\r' && sourceText[offset + 1] === '\n') advance(2);
      else advance(1);
      push('NL', start, startLine, startColumn, '\\n');
      continue;
    }
    // Whitespace other than newlines.
    if (char === ' ' || char === '\t' || char === '\f' || char === ' ') { advance(1); continue; }
    if (char === '\uFEFF') { advance(1); continue; }

    // Line comment.
    if (char === '/' && sourceText[offset + 1] === '/') {
      while (offset < length && sourceText[offset] !== '\n' && sourceText[offset] !== '\r') advance(1);
      push('LineComment', start, startLine, startColumn);
      continue;
    }
    // Nested block comment (Kotlin allows arbitrary nesting).
    if (char === '/' && sourceText[offset + 1] === '*') {
      advance(2);
      let depth = 1;
      while (offset < length && depth > 0) {
        if (sourceText[offset] === '/' && sourceText[offset + 1] === '*') { depth++; advance(2); }
        else if (sourceText[offset] === '*' && sourceText[offset + 1] === '/') { depth--; advance(2); }
        else advance(1);
      }
      if (depth > 0) failHere('unterminated block comment', start);
      push('BlockComment', start, startLine, startColumn);
      continue;
    }

    // Raw string literal """ ... """ with template scanning.
    if (char === '"' && sourceText[offset + 1] === '"' && sourceText[offset + 2] === '"') {
      advance(3);
      scanStringBody({ raw: true, start });
      push('StringLiteral', start, startLine, startColumn);
      continue;
    }
    // Line string literal "..." with escape and template scanning.
    if (char === '"') {
      advance(1);
      scanStringBody({ raw: false, start });
      push('StringLiteral', start, startLine, startColumn);
      continue;
    }
    // Character literal with escapes.
    if (char === "'") {
      advance(1);
      scanCharLiteral(start);
      push('CharacterLiteral', start, startLine, startColumn);
      continue;
    }

    // Backtick-quoted identifier.
    if (char === '`') {
      advance(1);
      while (offset < length && sourceText[offset] !== '`' && sourceText[offset] !== '\n') advance(1);
      if (sourceText[offset] !== '`') failHere('unterminated backtick identifier', start);
      advance(1);
      push('Identifier', start, startLine, startColumn, sourceText.slice(start + 1, offset - 1));
      tokens.at(-1).quoted = true;
      continue;
    }

    // Number literals: decimal, hex (0x), binary (0b), real with fraction or
    // exponent, optional long/unsigned suffixes. `1..2` must scan as 1, `..`, 2.
    if (/[0-9]/.test(char)) {
      scanNumber();
      push('NumberLiteral', start, startLine, startColumn);
      continue;
    }

    // Identifiers and keywords. Kotlin permits Unicode letters in identifiers;
    // the category test runs on the code point (surrogate pairs included)
    // while advancing stays per UTF-16 code unit, so offsets remain exact.
    if (isIdentifierStart(char, sourceText, offset)) {
      advance(1);
      while (offset < length && isIdentifierPart(sourceText[offset], sourceText, offset)) advance(1);
      const word = sourceText.slice(start, offset);
      push(HARD_KEYWORDS.has(word) ? 'Keyword' : 'Identifier', start, startLine, startColumn);
      continue;
    }

    // Operators and punctuation, longest match first.
    const operator = OPERATORS.find(candidate => sourceText.startsWith(candidate, offset));
    if (operator) {
      advance(operator.length);
      push('Operator', start, startLine, startColumn);
      continue;
    }

    failHere(`unexpected character ${JSON.stringify(char)}`);
  }

  // String scanning consumes through the closing quote. Template expressions
  // `${ … }` nest braces and strings inside either string kind; `$name` simple
  // templates end at the identifier. The whole literal is one token, so brace
  // balancing in outer scans never sees template contents.
  function scanStringBody({ raw, start }) {
    while (offset < length) {
      const char = sourceText[offset];
      if (!raw && (char === '\n' || char === '\r')) failHere('unterminated line string', start);
      if (!raw && char === '\\') { advance(2); continue; }
      if (raw && char === '"' && sourceText[offset + 1] === '"' && sourceText[offset + 2] === '"') { advance(3); return; }
      if (!raw && char === '"') { advance(1); return; }
      if (char === '$') {
        if (sourceText[offset + 1] === '{') {
          advance(2);
          scanTemplateExpression(start);
          continue;
        }
        if (/[A-Za-z_]/.test(sourceText[offset + 1] || '')) {
          advance(1);
          while (offset < length && /[A-Za-z0-9_]/.test(sourceText[offset])) advance(1);
          continue;
        }
      }
      advance(1);
    }
    failHere('unterminated string literal', start);
  }

  // Inside ${ … }: braces nest, strings and comments appear as in code.
  function scanTemplateExpression(stringStart) {
    let depth = 1;
    while (offset < length && depth > 0) {
      const char = sourceText[offset];
      if (char === '{') { depth++; advance(1); continue; }
      if (char === '}') { depth--; advance(1); continue; }
      if (char === '"' && sourceText[offset + 1] === '"' && sourceText[offset + 2] === '"') {
        advance(3);
        scanStringBody({ raw: true, start: stringStart });
        continue;
      }
      if (char === '"') { advance(1); scanStringBody({ raw: false, start: stringStart }); continue; }
      if (char === "'") { advance(1); scanCharLiteral(stringStart); continue; }
      if (char === '/' && sourceText[offset + 1] === '/') {
        while (offset < length && sourceText[offset] !== '\n') advance(1);
        continue;
      }
      if (char === '/' && sourceText[offset + 1] === '*') {
        advance(2);
        let commentDepth = 1;
        while (offset < length && commentDepth > 0) {
          if (sourceText[offset] === '/' && sourceText[offset + 1] === '*') { commentDepth++; advance(2); }
          else if (sourceText[offset] === '*' && sourceText[offset + 1] === '/') { commentDepth--; advance(2); }
          else advance(1);
        }
        continue;
      }
      advance(1);
    }
    if (depth > 0) failHere('unterminated string template expression', stringStart);
  }

  function scanCharLiteral(start) {
    while (offset < length) {
      const char = sourceText[offset];
      if (char === '\\') { advance(2); continue; }
      if (char === '\n' || char === '\r') failHere('unterminated character literal', start);
      if (char === "'") { advance(1); return; }
      advance(1);
    }
    failHere('unterminated character literal', start);
  }

  function scanNumber() {
    if (sourceText.startsWith('0x', offset) || sourceText.startsWith('0X', offset)) {
      advance(2);
      while (offset < length && /[0-9a-fA-F_]/.test(sourceText[offset])) advance(1);
    } else if (sourceText.startsWith('0b', offset) || sourceText.startsWith('0B', offset)) {
      advance(2);
      while (offset < length && /[01_]/.test(sourceText[offset])) advance(1);
    } else {
      while (offset < length && /[0-9_]/.test(sourceText[offset])) advance(1);
      // Fraction only when a digit follows the dot: `1.5` yes, `1..2` no.
      if (sourceText[offset] === '.' && /[0-9]/.test(sourceText[offset + 1] || '')) {
        advance(1);
        while (offset < length && /[0-9_]/.test(sourceText[offset])) advance(1);
      }
      if (/[eE]/.test(sourceText[offset] || '')) {
        const save = offset;
        advance(1);
        if (/[+-]/.test(sourceText[offset] || '')) advance(1);
        if (/[0-9]/.test(sourceText[offset] || '')) {
          while (offset < length && /[0-9_]/.test(sourceText[offset])) advance(1);
        } else offset = save;
      }
      if (/[fF]/.test(sourceText[offset] || '')) advance(1);
    }
    if (/[uU]/.test(sourceText[offset] || '')) {
      advance(1);
      if (/[lL]/.test(sourceText[offset] || '')) { advance(1); return; }
      return;
    }
    if (/[lL]/.test(sourceText[offset] || '')) advance(1);
  }

  return tokens;
}

// Unicode identifier categories per the Kotlin spec: letters (and underscore
// or dollar) start, letters and digits continue. The test reads one code
// point, combining surrogate pairs; lone surrogates are never letters.
function codePointAt(sourceText, offset) {
  const first = sourceText.charCodeAt(offset);
  if (first >= 0xd800 && first <= 0xdbff && offset + 1 < sourceText.length) {
    const second = sourceText.charCodeAt(offset + 1);
    if (second >= 0xdc00 && second <= 0xdfff) {
      return String.fromCharCode(first, second);
    }
  }
  return sourceText[offset] ?? '';
}

function isIdentifierStart(char, sourceText, offset) {
  if (/[A-Za-z_$]/.test(char)) return true;
  return /\p{L}/u.test(codePointAt(sourceText, offset));
}

function isIdentifierPart(char, sourceText, offset) {
  if (/[A-Za-z0-9_$]/.test(char)) return true;
  return /[\p{L}\p{Nd}]/u.test(codePointAt(sourceText, offset));
}

// Significant tokens exclude whitespace trivia but keep NL: parsers skip NL
// except where statement boundaries matter.
export function significant(tokens) {
  return tokens.filter(token => !['LineComment', 'BlockComment'].includes(token.tokenType.name));
}
