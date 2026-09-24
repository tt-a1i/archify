// Source excerpts are opt-in (`--source-excerpts`). When they are requested,
// drop any line that names a credential, and strip URL userinfo and query
// strings before the line leaves the scanner.
const SECRET_ASSIGNMENT = /(?:^|[^\w])[\w$.-]*(?:token|secret|password|passwd|pwd|api[_-]?key|credential)[\w$.-]*['"]?\]?\s*[:=]/i;
// A credential word on its own (API_TOKEN, "--password", access_token) but not
// inside a longer word such as tokenizer or max_tokens.
const SECRET_WORD = /(?<![a-z])(?:token|secret|password|passwd|pwd|api[_-]?key|credentials?|bearer|private[_-]?key)(?![a-z])/i;
const AUTHORIZATION_HEADER = /(?:^|[^\w])['"]?(?:proxy[-_])?authorization['"]?\s*:/i;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]*@/gi;
const URL_QUERY = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`?#]*)\?[^\s'"`#]*/gi;

export function safeSourceLine(line) {
  if (SECRET_ASSIGNMENT.test(line) || SECRET_WORD.test(line) || AUTHORIZATION_HEADER.test(line)) return null;
  return line.replace(URL_USERINFO, '$1[redacted]@').replace(URL_QUERY, '$1?[redacted]');
}
