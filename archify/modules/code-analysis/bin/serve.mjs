#!/usr/bin/env node
// Code Analysis, the only way in:
//   1. Archify delivers the authored architecture diagram, exactly as `archify deliver` does.
//   2. The page is served locally with one extra toolbar button, "Code Analysis".
//   3. Clicking it runs the analysis (extract → graphs → evaluate → overlay) for the
//      repository and switches the page to the analysis view. Nothing runs before the click.
// The delivered HTML is never modified; the analysis page is written next to it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { analyzeRepository } from '../lib/analysis.mjs';
import { DiagnosticError } from '../extract/shared/diagnostics.mjs';

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(here, '..');
const archify = path.resolve(here, '../../../bin/archify.mjs');

// The module's two dependencies (typescript for the JS/TS extractor, ajv for
// schema checks) live in its own package. Archify itself needs no install, and
// the skill is often used from a plain copy of the folder, so the first `serve`
// installs them on demand instead of asking for a separate setup step.
export async function ensureDependencies(root = moduleRoot) {
  const missing = ['typescript', 'ajv'].filter((name) => !fs.existsSync(path.join(root, 'node_modules', name, 'package.json')));
  if (!missing.length) return false;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const lock = fs.existsSync(path.join(root, 'package-lock.json'));
  console.error(`Code Analysis: installing ${missing.join(' and ')} into ${path.relative(process.cwd(), root) || '.'} (first run only)…`);
  try {
    await execute(npm, [lock ? 'ci' : 'install', '--no-audit', '--no-fund', '--prefix', root], { shell: process.platform === 'win32', maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`Code Analysis needs ${missing.join(' and ')} and could not install them automatically (${error.message.split('\n')[0]}). Run \`npm ci\` in ${root} once, then retry.`);
  }
  return true;
}

export const USAGE = `Usage:
  archify code-analysis serve <repo-root> --ir <architecture.json> --out <dir>
                              [--language ts|py] [--map overlay-map.json] [--config file.json] [--quality standard|showcase]

Delivers the authored diagram with Archify, serves it on a local port, and runs the
code analysis for <repo-root> when "Code Analysis" is clicked on that page. Nothing
runs before the click. Output: <dir>/architecture.html (Archify's artifact, untouched)
and <dir>/analysis/{raw-facts,module-graph,findings}.json + repo.analysis.html.`;

export function parseArgs(argv) {
  const [repo, ...rest] = argv;
  if (!repo || repo.startsWith('-')) throw new Error(USAGE);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!['--ir', '--out', '--language', '--config', '--map', '--quality'].includes(key) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Invalid option: ${key}\n${USAGE}`);
    options[key] = rest[i + 1];
  }
  if (!options['--ir'] || !options['--out']) throw new Error(`serve requires --ir and --out\n${USAGE}`);
  return { repo, options };
}

export async function startAnalysisView(argv) {
  const { repo, options } = parseArgs(argv);
  await ensureDependencies();
  const root = path.resolve(repo), ir = path.resolve(options['--ir']), out = path.resolve(options['--out']);
  fs.mkdirSync(out, { recursive: true });

  // 1. Archify delivers the diagram. Repository evidence is checked when the IR pins a repository.
  const delivered = path.join(out, 'architecture.html');
  const doc = JSON.parse(fs.readFileSync(ir, 'utf8'));
  let evidenceArgs = [];
  if (doc.meta?.repository) {
    const top = await execute('git', ['-C', root, 'rev-parse', '--show-toplevel']);
    evidenceArgs = ['--repo-root', top.stdout.trim()];
  }
  const quality = options['--quality'] || doc.meta?.quality_profile || 'standard';
  try {
    await execute(process.execPath, [archify, 'deliver', 'architecture', ir, delivered, '--quality', quality, ...evidenceArgs, '--json'], { maxBuffer: 16 * 1024 * 1024 });
  } catch (error) {
    // Archify refused the diagram. Show its receipt, not a bare "command failed": the IR needs
    // repair (validate → fix what the diagnostics point at → validate again) before it can be served.
    let receipt = null;
    try { receipt = JSON.parse(error.stdout); } catch { /* not JSON */ }
    const lines = receipt?.diagnostics?.length
      ? receipt.diagnostics.map((d) => `  - [${d.code}] ${d.message.replace(/^\[[^\]]+\]\s*/, '')}`)
      : [`  ${(receipt?.error || error.stderr || error.message).split('\n').join('\n  ')}`];
    throw new Error([
      `Archify did not deliver ${path.basename(ir)} (${receipt?.stage || 'deliver'} failed, quality "${quality}"). The diagram must pass before it can be served:`,
      ...lines.slice(0, 12),
      lines.length > 12 ? `  … ${lines.length - 12} more` : null,
      `Repair the IR, then check with:`,
      `  node ${path.relative(process.cwd(), archify)} validate architecture ${path.relative(process.cwd(), ir)} --quality ${quality}${evidenceArgs.length ? ` --repo-root ${evidenceArgs[1]}` : ''} --json`,
    ].filter(Boolean).join('\n'));
  }

  // 2. Serve it with the button. The token ties analysis requests to this page.
  const token = randomBytes(24).toString('hex');
  const page = fs.readFileSync(delivered, 'utf8').replace('</body>', `<script>(${client.toString()})(${JSON.stringify(token)})</script></body>`);
  let pending = null, result = null, origin;
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(body); };
    if (req.headers.host !== new URL(origin).host) return send(403, '{}');
    if (req.method === 'GET' && req.url === '/') return send(200, page, 'text/html; charset=utf-8');
    if (req.method !== 'POST' || req.url !== '/analyze') return send(404, '{}');
    if (req.headers.origin !== origin || req.headers['x-analysis-token'] !== token) return send(403, '{}');
    // 3. The click. One analysis per server lifetime; concurrent clicks share it.
    try {
      if (!result) {
        pending ??= new Promise((resolve, reject) => {
          try {
            const receipt = analyzeRepository({
              root, ir, html: delivered, out: path.join(out, 'analysis'),
              language: options['--language'] || null, config: options['--config'] || null, map: options['--map'] || null,
            });
            resolve(fs.readFileSync(receipt.overlay.html, 'utf8'));
          } catch (error) { reject(error); }
        }).then((html) => { result = html; return html; }).finally(() => { pending = null; });
      }
      send(200, result || await pending, 'text/html; charset=utf-8');
    } catch (error) {
      const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [{ code: 'internal/unclassified', severity: 'error', message: error.message, subject: {}, evidence: {}, supportedFixes: [] }];
      send(500, JSON.stringify({ error: diagnostics.map((d) => d.message).join('\n'), diagnostics }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, url: origin, token, delivered };
}

// Runs in the page. One toolbar button: click → analysis runs → the analysis
// layer is added to this page and switched on. From then on the layer's own
// toggle (the same button, now owned by the layer) shows or hides it.
function client(token) {
  var toolbar = document.querySelector('.toolbar');
  if (!toolbar) return;
  var button = document.createElement('button');
  button.id = 'code-analysis-start'; button.type = 'button'; button.textContent = 'Code Analysis';
  button.title = 'Analyze the repository and show the result on this diagram';
  toolbar.appendChild(button);
  var note = document.createElement('div');
  note.id = 'code-analysis-note'; note.setAttribute('role', 'status');
  note.style.cssText = 'position:fixed;left:16px;top:76px;z-index:59;max-width:420px;padding:8px 12px;border-radius:8px;background:var(--panel,#0f172a);color:var(--text-muted,#94a3b8);border:1px solid var(--panel-border,#1e293b);font:12px ui-monospace,Menlo,Consolas,monospace;display:none';
  document.body.appendChild(note);
  var say = function (text) { note.textContent = text; note.style.display = text ? 'block' : 'none'; };
  button.addEventListener('click', async function () {
    button.disabled = true; button.textContent = 'Analyzing…'; say('Reading the repository — imports, modules, rules. This runs once.');
    try {
      var response = await fetch('/analyze', { method: 'POST', headers: { 'X-Analysis-Token': token } });
      if (!response.ok) { var body = await response.json(); throw new Error(body.error || 'analysis failed'); }
      var parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
      var ids = ['bauify-analysis', 'bauify-style', 'bauify-script'];
      for (var i = 0; i < ids.length; i++) if (!parsed.getElementById(ids[i])) throw new Error('analysis result is incomplete');
      // Hand over to the layer: it adds its own toggle to the toolbar, so this button retires.
      button.remove(); say('');
      for (var j = 0; j < ids.length; j++) {
        var original = parsed.getElementById(ids[j]), element = document.createElement(original.tagName);
        element.id = ids[j]; if (ids[j] === 'bauify-analysis') element.type = 'application/json';
        element.textContent = original.textContent; document.body.appendChild(element);
      }
      var toggle = document.getElementById('btn-bauify');
      if (toggle) toggle.click();
    } catch (error) {
      button.disabled = false; button.textContent = 'Code Analysis';
      say('Analysis failed: ' + error.message + ' — click Code Analysis to retry.');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help' || args[0] === '-h') { console.log(USAGE); }
  else startAnalysisView(args).then(({ url, delivered }) => console.log(`Diagram delivered: ${delivered}\nCode Analysis: ${url}\nOpen the URL and click "Code Analysis". Press Ctrl+C to stop.`)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
