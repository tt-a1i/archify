// Copyable commands target cmd.exe on Windows and POSIX sh elsewhere.
// Keep ordinary commands readable. cmd expands %variables% even inside double
// quotes, and !variables! when delayed expansion is enabled. For those paths,
// pass encoded argv to Node instead of attempting another shell escape layer.
export function taskCommand(cli, id, root, out, platform = process.platform) {
  if (!out) return null;
  const windows = platform === 'win32';
  const quote = windows ? cmdQuote : posixQuote;
  const args = [cli, 'code-analysis', 'task', out, '--root', root, '--format', 'json'];
  const finding = ` --finding ${quote(id)}`;
  if (windows && args.some((arg) => /[%!"\r\n]/.test(arg))) {
    const payload = Buffer.from(JSON.stringify(args)).toString('base64');
    const launcher = "const r=require('node:child_process').spawnSync(process.execPath,JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8')).concat(process.argv.slice(2)),{stdio:'inherit'});if(r.error)console.error(r.error.message);process.exit(r.status??2)";
    return `node -e "${launcher}" ${payload}${finding}`;
  }
  return `node ${args.map(quote).join(' ')}${finding}`;
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
