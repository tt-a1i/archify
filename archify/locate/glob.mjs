import { locateFail } from './error.mjs';

const MAX_BRACE_VARIANTS = 64;

function globInvalid(message, evidence = {}) {
  locateFail('locate/ownership-glob-invalid', message, {
    evidence,
    supportedFixes: [
      'close every brace group',
      'keep brace alternatives literal (no *, ?, or nested braces)',
      'keep brace expansion at or below 64 variants',
      'give ** its own path segment',
    ],
  });
}

function findBraceGroup(pattern, from = 0) {
  const start = pattern.indexOf('{', from);
  if (start === -1) return null;
  let depth = 0;
  for (let index = start; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: index, inner: pattern.slice(start + 1, index) };
    }
  }
  globInvalid('Unclosed brace in glob.', { glob: pattern });
}

export function expandBraces(pattern) {
  if (typeof pattern !== 'string' || !pattern) globInvalid('Glob must be a non-empty string.', { glob: pattern });
  let variants = [''];
  let cursor = 0;
  while (cursor < pattern.length) {
    const group = findBraceGroup(pattern, cursor);
    if (!group) {
      const tail = pattern.slice(cursor);
      if (tail.includes('}')) globInvalid('Unbalanced brace in glob.', { glob: pattern });
      variants = variants.map((prefix) => prefix + tail);
      break;
    }
    if (group.start > cursor) {
      const literal = pattern.slice(cursor, group.start);
      variants = variants.map((prefix) => prefix + literal);
    }
    if (group.inner.includes('{') || group.inner.includes('}')) {
      globInvalid('Nested braces are not allowed.', { glob: pattern });
    }
    if (/[*?]/.test(group.inner)) {
      globInvalid('Brace alternatives must be literals without wildcards.', { glob: pattern, brace: group.inner });
    }
    const alts = group.inner.split(',');
    const next = [];
    for (const prefix of variants) {
      for (const alt of alts) {
        next.push(prefix + alt);
        if (next.length > MAX_BRACE_VARIANTS) {
          globInvalid('Brace expansion produced more than 64 variants.', { glob: pattern, count: next.length });
        }
      }
    }
    variants = next;
    cursor = group.end + 1;
  }
  if (variants.length > MAX_BRACE_VARIANTS) {
    globInvalid('Brace expansion produced more than 64 variants.', { glob: pattern, count: variants.length });
  }
  return variants;
}

function escapeRegex(char) {
  return /[.^$+()|[\]\\]/.test(char) ? `\\${char}` : char;
}

function segmentToRegex(segment) {
  let source = '';
  for (const char of segment) {
    if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += escapeRegex(char);
  }
  return source;
}

function globToRegex(pattern) {
  const segments = pattern.split('/');
  let source = '';
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.includes('**') && segment !== '**') {
      globInvalid('** must occupy a whole path segment.', { glob: pattern, segment });
    }
    if (segment === '**') {
      const trailing = index === segments.length - 1;
      source += trailing ? '[^/]+(?:/[^/]+)*' : '(?:[^/]+/)*';
      continue;
    }
    source += segmentToRegex(segment);
    if (index < segments.length - 1) source += '/';
  }
  return new RegExp(`^${source}$`);
}

export function compileGlob(pattern) {
  const variants = expandBraces(pattern);
  const regexes = variants.map(globToRegex);
  return (filePath) => regexes.some((regex) => regex.test(filePath));
}

export function matchesGlob(pattern, filePath) {
  return compileGlob(pattern)(filePath);
}

function hasWildcards(segment) {
  return segment.includes('*') || segment.includes('?');
}

function segSubsumes(parentSeg, childSeg) {
  if (parentSeg === '*') return true;
  if (parentSeg === childSeg) return true;
  if (hasWildcards(childSeg) && parentSeg !== '*' && parentSeg !== childSeg) return false;
  if (!hasWildcards(childSeg) && new RegExp(`^${segmentToRegex(parentSeg)}$`).test(childSeg)) return true;
  return false;
}

function segmentCanBeEmpty(segment) {
  return segment === '*' || segment === '';
}

function subsumesSegments(parent, child) {
  if (parent.length === 0) return child.length === 0;
  // Trailing ** is one or more non-empty segments. `*` / empty can match
  // zero-length segments (`""`, `a/`), so treating them as a subset is unsound.
  if (parent[0] === '**' && parent.length === 1) {
    return child.length > 0 && !child.some(segmentCanBeEmpty);
  }
  if (parent[0] === '**') {
    if (subsumesSegments(parent.slice(1), child)) return true;
    // A recursive prefix consumes only non-empty segments. Do not prove
    // containment by consuming a child segment that may be empty.
    if (child.length > 0 && child[0] !== '**' && !segmentCanBeEmpty(child[0])) {
      return subsumesSegments(parent, child.slice(1));
    }
    return false;
  }
  if (child.length === 0) return false;
  if (child[0] === '**') return false;
  if (!segSubsumes(parent[0], child[0])) return false;
  return subsumesSegments(parent.slice(1), child.slice(1));
}

export function subsumes(parentGlob, childGlob) {
  const parents = expandBraces(parentGlob);
  const children = expandBraces(childGlob);
  return children.every((child) => parents.some((parent) => (
    parent === child || subsumesSegments(parent.split('/'), child.split('/'))
  )));
}
