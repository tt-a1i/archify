// Minimal glob → RegExp for include/exclude/role patterns.
// Supports **, *, ?, and {a,b}. Paths are POSIX, repo-relative, no leading "./".
export function globToRegExp(glob) {
  let re = '';
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
      const end = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, end).split(',').map(escape).join('|')})`;
      i = end;
    } else re += escape(ch);
  }
  return new RegExp(`^${re}$`);
}

function escape(text) {
  return text.replace(/[.+^$()|[\]\\]/g, '\\$&');
}

export function matcher(globs) {
  const regexps = (globs || []).map(globToRegExp);
  return (p) => regexps.some((re) => re.test(p));
}
