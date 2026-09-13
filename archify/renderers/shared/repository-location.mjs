// Repository identity and forge links are independent of local Git object checks.
// This module never contacts a remote server or reads the user's SSH config.
export function parseRepositoryRemote(value, { authored = false } = {}) {
  if (typeof value !== 'string') return null;
  const raw = authored ? value : value.trim();
  if (!raw || /[\s\\\u0000-\u001f\u007f?#]/.test(raw)) return null;
  const scp = raw.match(/^git@([^/:]+):(.+)$/);
  const scpAbsolute = Boolean(scp && scp[2].startsWith('/'));
  const expanded = scp ? `ssh://git@${scp[1]}/${scp[2].replace(/^\//, '')}` : raw;
  const match = expanded.match(/^(https?|ssh):\/\/([^/]+)\/(.+)$/i);
  if (!match) return null;
  // Validate the original path before URL parsing can collapse dot segments.
  let segments;
  try {
    segments = match[3].replace(/\/$/, '').split('/');
    // Git passes SCP paths literally; percent escapes are decoded only in URIs.
    if (!scp) segments = segments.map(decodeURIComponent);
  }
  catch { return null; }
  if (segments.some((part) => !part || part === '.' || part === '..' || /[/\\\s\u0000-\u001f\u007f?#]/.test(part))) return null;
  let url;
  try { url = new URL(expanded); } catch { return null; }
  const protocol = url.protocol;
  if (protocol === 'ssh:' && (url.username !== 'git' || url.password)) return null;
  if (authored && protocol !== 'ssh:' && (url.username || url.password)) return null;
  const hostname = url.hostname.toLowerCase();
  if (!hostname) return null;
  const provider = hostname === 'github.com' ? 'github' : hostname === 'gitee.com' ? 'gitee' : null;
  const last = segments.length - 1;
  if (provider) segments[last] = segments[last].replace(provider === 'github' ? /\.git$/i : /\.git$/, '');
  if (!segments[last] || segments[last] === '.' || segments[last] === '..') return null;
  const repositoryPath = segments.join('/');
  // Only known forges map HTTPS and SSH to one repository namespace. Other
  // hosts retain transport, port and remote-relative/absolute path semantics.
  const port = url.port || (protocol === 'ssh:' ? '22' : protocol === 'https:' ? '443' : '80');
  const endpoint = provider && ((protocol === 'https:' && port === '443') || (protocol === 'ssh:' && port === '22'))
    ? 'standard' : `${protocol}${port}`;
  const pathKind = provider ? 'repository' : scp && !scpAbsolute ? 'relative' : 'absolute';
  const identityPath = provider === 'github' ? repositoryPath.toLowerCase() : repositoryPath;
  const encodedPath = segments.map(encodeURIComponent).join('/');
  const canonicalUrl = scp ? `git@${hostname}:${scpAbsolute ? '/' : ''}${repositoryPath}`
    : `${protocol}//${protocol === 'ssh:' ? 'git@' : ''}${url.host}/${encodedPath}`;
  return { identity: JSON.stringify([hostname, endpoint, pathKind, identityPath]), url: canonicalUrl, provider, protocol, path: repositoryPath, endpoint };
}

export function redactRepositoryRemote(value) {
  return String(value || '')
    .replace(/^((?:https?|ssh):\/\/)[^/]*@/i, '$1REDACTED@')
    .replace(/[?#].*$/s, '?REDACTED');
}

export function repositorySourceHref(provider, url, revision, source) {
  const encodedPath = source.path.split('/').map(encodeURIComponent).join('/');
  const end = source.endLine && source.endLine !== source.line
    ? `-${provider === 'github' ? 'L' : ''}${source.endLine}` : '';
  const fragment = source.line ? `#L${source.line}${end}` : '';
  return `${url}/blob/${revision}/${encodedPath}${fragment}`;
}
