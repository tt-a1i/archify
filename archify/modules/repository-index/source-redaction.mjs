// Evidence packs include short source excerpts. Drop likely credential
// assignments and strip URL userinfo before those lines leave the scanner.
const SECRET_ASSIGNMENT = /(?:^|[^\w])[\w$.-]*(?:token|secret|password|passwd|pwd|api[_-]?key|credential)[\w$.-]*\s*[:=]/i;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]*@/gi;

export function safeSourceLine(line) {
  if (SECRET_ASSIGNMENT.test(line)) return null;
  return line.replace(URL_USERINFO, '$1[redacted]@');
}
