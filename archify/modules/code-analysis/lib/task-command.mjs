// Copyable commands target cmd.exe on Windows and POSIX sh elsewhere.
// Keep ordinary commands readable. cmd expands %variables% even inside double
// quotes, and !variables! when delayed expansion is enabled. For those paths,
// pass encoded argv to Node instead of attempting another shell escape layer.
export function taskCommand(cli, id, root, out, platform = process.platform) {
  if (!out) return null;
  const quote = platform === 'win32' ? cmdQuote : posixQuote;
  return nodeCommand([cli, 'code-analysis', 'task', out, '--root', root, '--format', 'json'], platform) + ` --finding ${quote(id)}`;
}

// The command that records today's findings as a baseline, so a project can
// adopt the rules (or a stricter rule version) without failing CI on what
// already exists.
export function baselineCommand(cli, root, { language = null, config = null, baseline = 'analysis-baseline.json' } = {}, platform = process.platform) {
  return nodeCommand([cli, 'code-analysis', 'check', root,
    ...(language ? ['--language', language] : []), ...(config ? ['--config', config] : []),
    '--baseline', baseline, '--update-baseline', '--reason', 'existing findings recorded when adopting Code Analysis'], platform);
}

// Resume an offline report using the same captured IR and analysis settings.
// Opening a report never executes this command; the user can copy it explicitly.
export function analysisStartCommand(cli, root, { ir, out, locale, language, config, map, baseline, quality, pr, repository, scope } = {}, platform = process.platform) {
  return nodeCommand([cli, 'start', root, ...(ir ? ['--ir', ir] : []), '--out', out,
    ...Object.entries({ locale, language, config, map, baseline, quality, pr, repository, scope }).flatMap(([key, value]) => value ? [`--${key}`, value] : []),
  ], platform);
}

function nodeCommand(args, platform) {
  const windows = platform === 'win32';
  if (windows && args.some((arg) => /[%!"\r\n]/.test(arg))) {
    const payload = Buffer.from(JSON.stringify(args)).toString('base64');
    const launcher = "const r=require('node:child_process').spawnSync(process.execPath,JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8')).concat(process.argv.slice(2)),{stdio:'inherit'});if(r.error)console.error(r.error.message);process.exit(r.status??2)";
    return `node -e "${launcher}" ${payload}`;
  }
  return `node ${args.map(windows ? cmdQuote : posixQuote).join(' ')}`;
}

function cmdQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+\\-]+$/.test(text)) return text;
  // Windows native argv parsing treats backslashes before the closing quote
  // specially. A trailing directory separator must survive the quoted token.
  return `"${text.replace(/(\\+)$/, '$1$1')}"`;
}

function posixQuote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:=@+-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}
