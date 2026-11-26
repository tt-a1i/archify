// Executable-body scanning. One coordinator extracts nested declarations with
// sub-parsers; linear scans then collect statement-level type evidence and
// call sites, and a structural control scan measures complexity. Scans never
// cross into nested declaration ranges: local functions and classes carry
// their own measurements, like the Java adapter's <locals> handling.
import { createTokenParser } from './syntax.mjs';

const UPPERCASE = /^[A-Z]/;
const CONTROL = new Set(['if', 'for', 'while', 'do', 'when', 'try', 'catch']);
const LOOPISH = new Set(['for', 'while']);
const BRANCHY = new Set(['if', 'for', 'while', 'do', 'when', 'try', 'catch', 'finally']);

function posSpan(first, last) {
  return {
    startOffset: first.startOffset, endOffset: last.endOffset,
    startLine: first.startLine, endLine: last.endLine,
    startColumn: first.startColumn, endColumn: last.endColumn,
  };
}

// Sub-parse nested declarations out of a body token array. Returns the
// declarations and the exact source ranges later scans must skip.
export function extractNestedDeclarations(tokens) {
  const found = [];
  const covered = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    // Declaration keywords inside a body: local class/interface/object, local
    // function, local property, typealias, and anonymous object expressions.
    // Modifier or annotation prefixes are skipped over: the keyword itself is
    // still found in one or two tokens and the sub-parser re-reads backwards
    // only what the keyword begins — modifiers before it are not part of the
    // declaration extent for coverage purposes, which is conservative and safe.
    if (['class', 'interface', 'fun', 'val', 'var', 'typealias'].includes(token.image)
      || (token.image === 'object' && (tokens[i + 1]?.tokenType.name === 'Identifier' || tokens[i + 1]?.image === ':' || tokens[i + 1]?.image === '{'))) {
      // Guard: skip keywords that are part of expressions, not declarations.
      // - `val`/`var`/`fun`/`class` never appear in valid expressions, so every
      //   occurrence is a declaration attempt.
      // - `object` appears in object expressions and object declarations only.
      const slice = tokens.slice(i);
      try {
        const parser = createTokenParser(slice);
        const declaration = parser.parseDeclaration();
        if (declaration?.declEnd) {
          const end = declaration.declEnd.endOffset ?? declaration.declEnd.startOffset;
          // Accept only declarations that consumed more than their keyword:
          // a bare 'val' in front of an unparseable mess is not a declaration.
          if (end > token.endOffset) {
            found.push(declaration);
            if (!['val', 'var'].includes(token.image)) {
              covered.push({ startOffset: token.startOffset, endOffset: end });
            }
            while (i < tokens.length && tokens[i].startOffset <= end) i++;
            continue;
          }
        }
      } catch {
        // Not a well-formed declaration; continue scanning after the keyword.
      }
    }
    i++;
  }
  return { declarations: found, covered };
}

export function coveredChecker(covered) {
  return offset => covered.some(range => range.startOffset <= offset && range.endOffset >= offset);
}

// Parse the type starting at tokens[index]. Only capitalized-path references
// are meaningful type evidence; the probe stops where the type grammar ends.
export function probeTypeAt(tokens, index) {
  const slice = tokens.slice(index);
  const references = [];
  try {
    const parser = createTokenParser(slice);
    const read = parser.parseTypeProbe(references);
    return read ? references : [];
  } catch {
    return [];
  }
}

// Statement-level type evidence: is/as types, catch types, ::class chains,
// constructor-candidate invocations and call-site type arguments.
export function scanTypeEvidence(tokens, coveredBy, owners) {
  const references = [];
  const add = (ref, extra) => references.push({
    name: ref.name, line: ref.startLine,
    startOffset: ref.startOffset, endOffset: ref.endOffset,
    startLine: ref.startLine, endLine: ref.endLine,
    startColumn: ref.startColumn, endColumn: ref.endColumn,
    owners, ...extra,
  });
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (coveredBy(token.startOffset)) continue;

    if (['is', 'as'].includes(token.image) && token.tokenType.name === 'Keyword') {
      let j = i + 1;
      if (tokens[j]?.image === '?') j++; // as?
      for (const ref of probeTypeAt(tokens, j)) {
        if (!coveredBy(ref.startOffset)) add(ref, {});
      }
      continue;
    }

    if (token.image === 'catch' && tokens[i + 1]?.image === '(') {
      let j = i + 2;
      let round = 0;
      while (j < tokens.length) {
        if (tokens[j].image === '(') round++;
        if (tokens[j].image === ':') break;
        if (tokens[j].image === ')' && round === 0) break;
        if (tokens[j].image === ')') round--;
        j++;
      }
      if (tokens[j]?.image === ':') {
        for (const ref of probeTypeAt(tokens, j + 1)) {
          if (!coveredBy(ref.startOffset)) add(ref, {});
        }
      }
      continue;
    }

    // Qualified or simple Name::class — a type reference when capitalized.
    if (token.image === '::' && tokens[i + 1]?.image === 'class') {
      const segments = [];
      let k = i - 1;
      while (k >= 0) {
        if (tokens[k].tokenType.name === 'Identifier') {
          segments.unshift(tokens[k]);
          if (tokens[k - 1]?.image === '.') { k -= 2; continue; }
        }
        break;
      }
      if (segments.length && UPPERCASE.test(segments[0].image) && !coveredBy(segments[0].startOffset)) {
        add({ name: segments.map(t => t.image).join('.'), ...posSpan(segments[0], segments.at(-1)) }, {});
      }
      continue;
    }

    // Constructor candidates: capitalized callee with parens. Chains whose
    // root is capitalized count as qualified constructor candidates.
    if (token.tokenType.name === 'Identifier' && UPPERCASE.test(token.image) && tokens[i + 1]?.image === '(') {
      const previous = tokens[i - 1];
      if (!previous || !['.', '?.', '::'].includes(previous.image)) {
        if (!coveredBy(token.startOffset)) add({ name: token.image, ...posSpan(token, token) }, { construction: true });
        continue;
      }
      if (previous.image === '.') {
        const segments = [token];
        let k = i - 1;
        while (k >= 0 && tokens[k].image === '.' && tokens[k - 1]?.tokenType.name === 'Identifier') {
          segments.unshift(tokens[k - 1]);
          k -= 2;
        }
        if (segments.length > 1 && UPPERCASE.test(segments[0].image) && !coveredBy(segments[0].startOffset)) {
          add({ name: segments.map(t => t.image).join('.'), ...posSpan(segments[0], segments.at(-1)) }, { construction: true });
        }
        continue;
      }
    }

    // Call-site type arguments: name<Args>( or name<Args>:: — capitalized
    // references inside the argument list are type evidence.
    if (token.tokenType.name === 'Identifier' && tokens[i + 1]?.image === '<') {
      const close = matchAngle(tokens, i + 1);
      if (close !== null && ['(', '::'].includes(tokens[close + 1]?.image)) {
        for (let j = i + 2; j < close; j++) {
          const inner = tokens[j];
          if (inner.tokenType.name === 'Identifier' && UPPERCASE.test(inner.image) && !coveredBy(inner.startOffset)) {
            const segments = [inner];
            while (tokens[j + 1]?.image === '.' && tokens[j + 2]?.tokenType.name === 'Identifier') {
              segments.push(tokens[j + 2]);
              j += 2;
            }
            add({ name: segments.map(t => t.image).join('.'), ...posSpan(segments[0], segments.at(-1)) }, {});
          }
        }
      }
      continue;
    }
  }
  return references;
}

function matchAngle(tokens, open) {
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    if (tokens[j].image === '<') depth++;
    else if (tokens[j].image === '>') {
      depth--;
      if (depth === 0) return j;
    } else if ([';', '{', '}'].includes(tokens[j].image)) return null;
    if (j - open > 400) return null;
  }
  return null;
}

// Invocation inventory: lowercase/simple or qualified callee followed by '('.
// Capitalized callees are constructor candidates, collected as type evidence
// instead. Keywords, declaration names and control constructs are excluded.
// Binding is the caller's business; this inventory is purely lexical.
const NONCALL = new Set(['if', 'for', 'while', 'when', 'catch', 'return', 'throw', 'do', 'else', 'in', 'is', 'as', 'typeof', 'constructor', 'init', 'fun', 'val', 'var', 'class', 'interface', 'object', 'typealias', 'super', 'this', 'package', 'import', 'by', 'get', 'set', 'where', 'suspend']);

export function scanCallSites(tokens, coveredBy) {
  const calls = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (coveredBy(token.startOffset)) continue;
    if (token.tokenType.name !== 'Identifier') continue;
    if (NONCALL.has(token.image)) continue;
    if (tokens[i + 1]?.image !== '(') continue;
    if (UPPERCASE.test(token.image)) continue; // constructor candidates live elsewhere
    const previous = tokens[i - 1];
    // Qualified callees: receiver.name( or chained ).name( — inventoried but
    // never bound in the v1 lexical model.
    const qualified = previous?.image === '.' || previous?.image === '?.';
    // Newline adjacency: in Kotlin a newline between the callee and '(' ends
    // the statement, so the parenthesis is not a call of this callee.
    if (tokens[i + 1].startLine > token.endLine) continue;
    // Arity: count top-level commas inside the parens.
    const close = matchRound(tokens, i + 1);
    let arity = 0;
    if (close !== null) {
      if (close > i + 2) {
        arity = 1;
        let round = 0, curly = 0, square = 0;
        for (let j = i + 2; j < close; j++) {
          const t = tokens[j];
          if (t.image === '(') round++;
          else if (t.image === ')') round--;
          else if (t.image === '{') curly++;
          else if (t.image === '}') curly--;
          else if (t.image === '[') square++;
          else if (t.image === ']') square--;
          else if (t.image === ',' && round === 0 && curly === 0 && square === 0) arity++;
        }
      }
    }
    calls.push({
      name: token.image, qualified,
      arity: close === null ? null : arity,
      line: token.startLine, column: token.startColumn,
      endLine: tokens[close ?? i + 1]?.endLine ?? token.endLine,
      endColumn: (tokens[close ?? i + 1]?.endColumn ?? token.endColumn) + 1,
      startOffset: token.startOffset,
      endOffset: tokens[close ?? i + 1]?.endOffset ?? tokens[i + 1].endOffset,
    });
    if (close !== null) i = close;
  }
  return calls;
}

function matchRound(tokens, open) {
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    if (tokens[j].image === '(') depth++;
    else if (tokens[j].image === ')') {
      depth--;
      if (depth === 0) return j;
    }
    if (j - open > 4000) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Complexity: base 1, plus if/loop/catch/when-branch/elvis/&&/||, mirroring
// the Java adapter's scale. Nesting counts control-structure blocks; lambdas
// belong to the containing function while nested declarations are measured
// separately and skipped here.
// ---------------------------------------------------------------------------

export function measureComplexity(tokens, coveredBy, startLine) {
  const state = { complexity: 1, nesting: 0, deepestLine: startLine };
  scanRange(tokens, 0, tokens.length, 0, state, coveredBy);
  return state;

  function scanRange(arr, start, end, depth, state, coveredBy) {
    let i = start;
    while (i < end) {
      const token = arr[i];
      if (coveredBy(token.startOffset)) { i++; continue; }
      if (['&&', '||', '?:'].includes(token.image)) {
        state.complexity += 1;
        i++;
        continue;
      }
      if (token.image === 'if') {
        state.complexity += 1;
        i = scanIf(arr, i, end, depth, state, coveredBy);
        continue;
      }
      if (LOOPISH.has(token.image)) {
        state.complexity += 1;
        i = scanLoop(arr, i, end, depth, state, coveredBy);
        continue;
      }
      if (token.image === 'do') {
        state.complexity += 1;
        i = scanDo(arr, i, end, depth, state, coveredBy);
        continue;
      }
      if (token.image === 'when') {
        i = scanWhen(arr, i, end, depth, state, coveredBy);
        continue;
      }
      if (token.image === 'try') {
        i = scanTry(arr, i, end, depth, state, coveredBy);
        continue;
      }
      i++;
    }
    return i;
  }

  function noteDepth(state, depth, token) {
    if (depth > state.nesting) {
      state.nesting = depth;
      state.deepestLine = token.startLine;
    }
  }

  // Balanced group boundaries within the array slice.
  function findClose(arr, open, openImage, closeImage, end) {
    let depthCount = 0;
    for (let j = open; j < end; j++) {
      if (arr[j].image === openImage) depthCount++;
      else if (arr[j].image === closeImage) {
        depthCount--;
        if (depthCount === 0) return j;
      }
    }
    return end;
  }

  // Scan a braced block's interior at depth+1 when the block belongs to a
  // control structure.
  function scanControlBlock(arr, open, end, depth, state, coveredBy, token) {
    const close = findClose(arr, open, '{', '}', end);
    noteDepth(state, depth + 1, token);
    scanRange(arr, open + 1, close, depth + 1, state, coveredBy);
    return close + 1;
  }

  // Scan an unbraced single-statement branch: approximately to the next 'else'
  // or a newline boundary at paren depth 0. Documented approximation.
  function scanStatement(arr, i, end, depth, state, coveredBy) {
    let round = 0;
    let j = i;
    while (j < end) {
      const token = arr[j];
      if (round === 0 && token.image === 'else') break;
      if (round === 0 && j > i && token.startLine > arr[j - 1].endLine && !['.', '?.', '::', '+', '-', '*', '/', '%', '&&', '||', '?:', ','].includes(token.image)) break;
      if (token.image === '(') round++;
      else if (token.image === ')') round--;
      if (token.image === '{') {
        // A lambda or block inside the statement: scan its interior at the same depth.
        const close = findClose(arr, j, '{', '}', end);
        scanRange(arr, j + 1, close, depth, state, coveredBy);
        j = close + 1;
        continue;
      }
      scanRange(arr, j, j + 1, depth, state, coveredBy);
      j++;
    }
    return j;
  }

  function scanBranch(arr, i, end, depth, state, coveredBy, token) {
    while (i < end && arr[i].image === ';') i++;
    if (arr[i]?.image === '{') return scanControlBlock(arr, i, end, depth, state, coveredBy, token);
    return scanStatement(arr, i, end, depth, state, coveredBy);
  }

  function scanIf(arr, i, end, depth, state, coveredBy) {
    const ifToken = arr[i];
    let j = i + 1;
    // condition
    if (arr[j]?.image === '(') {
      const close = findClose(arr, j, '(', ')', end);
      scanRange(arr, j + 1, close, depth, state, coveredBy);
      j = close + 1;
    }
    noteDepth(state, depth + 1, ifToken);
    j = scanBranch(arr, j, end, depth, state, coveredBy, ifToken);
    // else chains: else-if stays at the same depth; else blocks nest inside the if.
    if (arr[j]?.image === 'else') {
      if (arr[j + 1]?.image === 'if') {
        state.complexity += 1;
        return scanIf(arr, j + 1, end, depth, state, coveredBy);
      }
      return scanBranch(arr, j + 1, end, depth, state, coveredBy, arr[j]);
    }
    return j;
  }

  function scanLoop(arr, i, end, depth, state, coveredBy) {
    const token = arr[i];
    let j = i + 1;
    if (arr[j]?.image === '(') {
      const close = findClose(arr, j, '(', ')', end);
      scanRange(arr, j + 1, close, depth, state, coveredBy);
      j = close + 1;
    }
    noteDepth(state, depth + 1, token);
    return scanBranch(arr, j, end, depth, state, coveredBy, token);
  }

  function scanDo(arr, i, end, depth, state, coveredBy) {
    const token = arr[i];
    noteDepth(state, depth + 1, token);
    let j = scanBranch(arr, i + 1, end, depth, state, coveredBy, token);
    // trailing while (…)
    if (arr[j]?.image === 'while') {
      if (arr[j + 1]?.image === '(') {
        const close = findClose(arr, j + 1, '(', ')', end);
        scanRange(arr, j + 2, close, depth, state, coveredBy);
        j = close + 1;
      }
    }
    return j;
  }

  function scanWhen(arr, i, end, depth, state, coveredBy) {
    const token = arr[i];
    let j = i + 1;
    if (arr[j]?.image === '(') {
      const close = findClose(arr, j, '(', ')', end);
      scanRange(arr, j + 1, close, depth, state, coveredBy);
      j = close + 1;
    }
    if (arr[j]?.image !== '{') return j;
    noteDepth(state, depth + 1, token);
    const close = findClose(arr, j, '{', '}', end);
    // Count branch arrows directly inside the when block (excluding else),
    // and scan the whole interior at depth+1 for nested control flow.
    // Count branch arrows directly inside the when block. An `else ->`
    // branch is the fallback and does not add a path, matching how switch
    // defaults are not decision points either.
    let braceDepth = 0, round = 0, elsePending = false;
    for (let k = j + 1; k < close; k++) {
      const t = arr[k];
      if (coveredBy(t.startOffset)) continue;
      if (t.image === '{') braceDepth++;
      else if (t.image === '}') braceDepth--;
      else if (t.image === '(') round++;
      else if (t.image === ')') round--;
      else if (braceDepth === 0 && round === 0 && t.image === 'else') elsePending = true;
      else if (braceDepth === 0 && round === 0 && t.image === '->') {
        if (!elsePending) state.complexity += 1;
        elsePending = false;
      }
    }
    scanRange(arr, j + 1, close, depth + 1, state, coveredBy);
    return close + 1;
  }

  function scanTry(arr, i, end, depth, state, coveredBy) {
    const token = arr[i];
    noteDepth(state, depth + 1, token);
    let j = scanBranch(arr, i + 1, end, depth, state, coveredBy, token);
    for (;;) {
      if (arr[j]?.image === 'catch') {
        state.complexity += 1;
        let k = j + 1;
        if (arr[k]?.image === '(') {
          const closeParen = findClose(arr, k, '(', ')', end);
          scanRange(arr, k + 1, closeParen, depth, state, coveredBy);
          k = closeParen + 1;
        }
        noteDepth(state, depth + 1, arr[j]);
        j = scanBranch(arr, k, end, depth, state, coveredBy, arr[j]);
        continue;
      }
      if (arr[j]?.image === 'finally') {
        j = scanBranch(arr, j + 1, end, depth, state, coveredBy, arr[j]);
        continue;
      }
      return j;
    }
  }
}
