import { fail } from './diagnostics.mjs';

// Minimal glob → RegExp for include/exclude/role patterns.
// Supports **, *, ?, and {a,b}. Paths are POSIX, repo-relative, no leading "./".
export function globToRegExp(glob) {
  let re = '';
  let depth = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else if (ch === '{') {
      depth += 1;
      re += '(?:';
    } else if (ch === '}' && depth) { depth -= 1; re += ')'; }
    else if (ch === ',' && depth) re += '|';
    else if (ch === '\\' && i + 1 < glob.length) re += escape(glob[++i]);
    else re += escape(ch);
  }
  if (depth) fail('cli/config-invalid', 'Unclosed brace in glob pattern.', {
    subject: { pattern: glob }, supportedFixes: ['close the brace in the configured glob pattern'],
  });
  return new RegExp(`^${re}$`);
}

function escape(text) {
  return text.replace(/[.*?{}+^$()|[\]\\]/g, '\\$&');
}

export function matcher(globs) {
  const regexps = (globs || []).map(globToRegExp);
  return (p) => regexps.some((re) => re.test(p));
}
