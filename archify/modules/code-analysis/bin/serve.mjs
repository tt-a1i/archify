#!/usr/bin/env node
// Code Analysis, the only way in:
//   1. Archify delivers the authored architecture diagram, exactly as `archify deliver` does.
//   2. The page is served locally with one extra toolbar button, "Code Analysis".
//   3. Clicking it runs the analysis (extract → graphs → evaluate → overlay) for the
//      repository and switches the page to the analysis view. Nothing runs before the click.
//   4. "Re-analyze" on the overview runs it again after code changes, without a restart.
//   5. POST /task builds an AI optimization task for selected findings of the current
//      result and checks its evidence against the working tree (lib/task.mjs, lib/evidence.mjs).
// Each run happens in a child process (bin/analyze-run.mjs) so the server stays
// responsive, writes to a fresh directory, and replaces <out>/analysis only when it
// succeeds; the run it replaces moves to <out>/analysis.previous and is the
// comparison for the next one. A failed run leaves the last good result in place.
// The delivered HTML is never modified; the analysis page is written next to it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DiagnosticError } from '../extract/shared/diagnostics.mjs';
import { withInstallLock } from '../lib/install-lock.mjs';

const execute = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(here, '..');
const archify = path.resolve(here, '../../../bin/archify.mjs');
const worker = path.join(here, 'analyze-run.mjs');
const TASK_BODY_LIMIT = 16 * 1024;

// Runs one analysis in a child process and resolves with its receipt.
// Failures come back as the worker's structured diagnostics.
export function runWorker(options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      let message = null;
      try { message = JSON.parse(stdout.trim().split('\n').pop()); } catch { /* no JSON line */ }
      if (message && message.status !== 'error' && code === 0) return resolve(message);
      if (message && message.diagnostics) return reject(new DiagnosticError(message.diagnostics.map((d) => d.message).join('\n'), message.diagnostics));
      reject(new Error(`analysis process exited with ${code}: ${(stderr || stdout).trim().split('\n').slice(-3).join(' ')}`));
    });
    child.stdin.end(JSON.stringify(options));
  });
}

// Parser and schema dependencies live in the module's own package. Archify itself needs no install, and
// the skill is often used from a plain copy of the folder, so the first `serve`
// installs them on demand instead of asking for a separate setup step.
export async function ensureDependencies(root = moduleRoot) {
  root = fs.realpathSync(root);
  const missingPackages = () => ['typescript', 'ajv', 'java-parser'].filter(name => !fs.existsSync(path.join(root, 'node_modules', name, 'package.json')));
  // Installed, read-only copies need no lock file. An active installer must
  // finish even if its package manifests have already appeared.
  if (!missingPackages().length && !fs.existsSync(path.join(root, '.code-analysis-install.lock'))) return false;
  return withInstallLock(root, async () => {
    const missing = missingPackages();
    if (!missing.length) return false;
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const lock = fs.existsSync(path.join(root, 'package-lock.json'));
    console.error(`Code Analysis: installing ${missing.join(' and ')} into ${path.relative(process.cwd(), root) || '.'} (first run only)…`);
    try {
      // Pass the directory as cwd: on Windows npm.cmd needs a shell, and the
      // shell would split an unquoted --prefix path that contains spaces.
      await execute(npm, [lock ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: root, shell: process.platform === 'win32', maxBuffer: 16 * 1024 * 1024 });
    } catch (error) {
      throw new Error(`Code Analysis needs ${missing.join(' and ')} and could not install them automatically (${error.message.split('\n')[0]}). Run \`npm ci\` in ${root} once, then retry.`);
    }
    return true;
  });
}

export const USAGE = `Usage:
  archify code-analysis serve <repo-root> --ir <architecture.json> --out <dir>
                              [--language ts|py|java] [--map overlay-map.json] [--config file.json]
                              [--baseline baseline.json] [--quality standard|showcase]

Delivers the authored diagram with Archify, serves it on a local port, and runs the
code analysis for <repo-root> when "Code Analysis" is clicked on that page. Nothing
runs before the click; "Re-analyze" on the overview runs it again after code changes.
The page can request an AI optimization task for selected findings (POST /task),
checked against the current working tree.
Output: <dir>/architecture.html (Archify's artifact, untouched) and
<dir>/analysis/{raw-facts,module-graph,findings,review,overview}.json + repo.analysis.html;
the run before is kept in <dir>/analysis.previous and compared with.`;

export function parseArgs(argv) {
  const [repo, ...rest] = argv;
  if (!repo || repo.startsWith('-')) throw new Error(USAGE);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!['--ir', '--out', '--language', '--config', '--map', '--quality', '--baseline'].includes(key) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Invalid option: ${key}\n${USAGE}`);
    options[key] = rest[i + 1];
  }
  if (!options['--ir'] || !options['--out']) throw new Error(`serve requires --ir and --out\n${USAGE}`);
  return { repo, options };
}

export async function startAnalysisView(argv) {
  const { repo, options } = parseArgs(argv);
  const root = path.resolve(repo), ir = path.resolve(options['--ir']), out = path.resolve(options['--out']);
  const irBytes = fs.readFileSync(ir);
  const doc = JSON.parse(irBytes.toString('utf8'));
  await ensureDependencies();
  fs.mkdirSync(out, { recursive: true });

  // 1. Archify delivers the diagram. Repository evidence is checked when the IR pins a repository.
  const delivered = path.join(out, 'architecture.html');
  let evidenceArgs = [];
  if (doc.meta?.repository) {
    const top = await execute('git', ['-C', root, 'rev-parse', '--show-toplevel']);
    evidenceArgs = ['--repo-root', top.stdout.trim()];
  }
  const quality = options['--quality'] || doc.meta?.quality_profile || 'standard';
  // Deliver exactly the bytes captured for this session, without touching the original IR.
  const deliveryInput = path.join(out, `.analysis-input-${randomBytes(12).toString('hex')}.json`);
  fs.writeFileSync(deliveryInput, irBytes, { flag: 'wx' });
  try {
    await execute(process.execPath, [archify, 'deliver', 'architecture', deliveryInput, delivered, '--quality', quality, ...evidenceArgs, '--json'], { maxBuffer: 16 * 1024 * 1024 });
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
  } finally {
    fs.rmSync(deliveryInput, { force: true });
  }

  // 2. Serve it with the button. The token ties analysis requests to this page.
  const token = randomBytes(24).toString('hex');
  const page = fs.readFileSync(delivered, 'utf8').replace('</body>', `<script>(${client.toString()})(${JSON.stringify(token)})</script></body>`);
  let pending = null, result = null, origin;
  const analysisDir = path.join(out, 'analysis');
  // One run: fresh directory, then swap it in. The current result is the comparison.
  const runAnalysis = async () => {
    const next = path.join(out, `analysis.next-${randomBytes(6).toString('hex')}`);
    try {
      await runWorker({
        root, ir, irSnapshot: doc, html: delivered, out: next,
        language: options['--language'] || null, config: options['--config'] ? path.resolve(options['--config']) : null,
        map: options['--map'] ? path.resolve(options['--map']) : null, baseline: options['--baseline'] ? path.resolve(options['--baseline']) : null,
        previous: path.join(analysisDir, 'findings.json'),
      });
    } catch (error) {
      fs.rmSync(next, { recursive: true, force: true });
      throw error;
    }
    const previousDir = path.join(out, 'analysis.previous');
    fs.rmSync(previousDir, { recursive: true, force: true });
    if (fs.existsSync(analysisDir)) fs.renameSync(analysisDir, previousDir);
    fs.renameSync(next, analysisDir);
    return fs.readFileSync(path.join(analysisDir, 'repo.analysis.html'), 'utf8');
  };
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(body); };
    if (req.headers.host !== new URL(origin).host) return send(403, '{}');
    if (req.method === 'GET' && new URL(req.url, origin).pathname === '/') return send(200, page, 'text/html; charset=utf-8');
    if (req.method !== 'POST' || (req.url !== '/analyze' && req.url !== '/task')) return send(404, '{}');
    if (req.headers.origin !== origin || req.headers['x-analysis-token'] !== token) return send(403, '{}');
    if (req.url === '/task') return handleTask(req, send);
    // Check before cached results as well: this page belongs to the delivered IR.
    let unchanged = false;
    try { unchanged = fs.readFileSync(ir).equals(irBytes); } catch { /* Removed or unreadable input also requires redelivery. */ }
    if (!unchanged) return send(409, JSON.stringify({
      error: 'Architecture has changed. Please regenerate the diagram.',
      diagnostics: [{ code: 'analysis/architecture-changed', severity: 'error', message: 'Architecture has changed. Please regenerate the diagram.', subject: { file: ir }, evidence: {}, supportedFixes: ['restart with the updated IR to regenerate the diagram'] }],
    }));
    // 3. The click returns the latest result; 4. a refresh request runs a new one.
    // Concurrent requests share the run in progress.
    try {
      if (req.headers['x-analysis-refresh'] === '1' && !pending) result = null;
      if (!result) {
        pending ??= runAnalysis().then((html) => { result = html; return html; }).finally(() => { pending = null; });
      }
      send(200, result || await pending, 'text/html; charset=utf-8');
    } catch (error) {
      const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [{ code: 'internal/unclassified', severity: 'error', message: error.message, subject: {}, evidence: {}, supportedFixes: [] }];
      send(500, JSON.stringify({ error: diagnostics.map((d) => d.message).join('\n'), diagnostics }));
    }
  });
  // 5. A task for findings of the result on disk, checked against the working tree now.
  // The request names finding ids only; files and directories are fixed by the server.
  const handleTask = async (req, send) => {
    const fail409 = (code, message, fixes) => send(409, JSON.stringify({ error: message, diagnostics: [{ code, severity: 'error', message, subject: {}, evidence: {}, supportedFixes: fixes }] }));
    let body = '';
    try {
      for await (const chunk of req) { body += chunk; if (body.length > TASK_BODY_LIMIT) return send(413, JSON.stringify({ error: 'request too large' })); }
    } catch { return send(400, JSON.stringify({ error: 'request could not be read' })); }
    let ids;
    try { ({ ids } = JSON.parse(body || '{}')); } catch { return send(400, JSON.stringify({ error: 'request body must be JSON: {"ids": [...]}' })); }
    if (!Array.isArray(ids) || !ids.length || ids.length > 20 || !ids.every((id) => typeof id === 'string' && /^[A-Z]{2,4}-(?:[0-9a-f]{12}|[0-9]{4,})$/.test(id))) return send(400, JSON.stringify({ error: 'ids must list 1–20 finding ids' }));
    if (pending) return fail409('task/analysis-running', 'An analysis is running; build the task when it has finished.', ['retry after the analysis completes']);
    if (!fs.existsSync(path.join(analysisDir, 'findings.json'))) return fail409('task/no-analysis', 'Run the analysis before building a task.', ['click Code Analysis first']);
    try {
      const { buildTask, renderTaskMarkdown } = await import('../lib/task.mjs');
      const { verifyTask } = await import('../lib/evidence.mjs');
      const read = (name) => JSON.parse(fs.readFileSync(path.join(analysisDir, name), 'utf8'));
      const review = fs.existsSync(path.join(analysisDir, 'review.json')) ? read('review.json') : null;
      const task = verifyTask(buildTask({ findings: read('findings.json'), facts: read('raw-facts.json'), ids, review }), root);
      send(200, JSON.stringify({ task, markdown: renderTaskMarkdown(task) }));
    } catch (error) {
      const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [{ code: 'internal/unclassified', severity: 'error', message: error.message, subject: {}, evidence: {}, supportedFixes: [] }];
      send(error instanceof DiagnosticError ? 422 : 500, JSON.stringify({ error: diagnostics.map((d) => d.message).join('\n'), diagnostics }));
    }
  };
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
  note.style.cssText = 'position:fixed;z-index:59;width:max-content;max-width:min(420px,calc(100vw - 16px));box-sizing:border-box;overflow-wrap:anywhere;padding:8px 12px;border-radius:8px;background:var(--panel,#0f172a);color:var(--text-muted,#94a3b8);border:1px solid var(--panel-border,#1e293b);font:12px ui-monospace,Menlo,Consolas,monospace;display:none';
  document.body.appendChild(note);
  button.setAttribute('aria-describedby', note.id);
  var positionNote = function () {
    if (note.style.display === 'none' || !button.isConnected) return;
    var bounds = button.getBoundingClientRect();
    note.style.top = (bounds.bottom + 8) + 'px';
    note.style.left = Math.max(8, Math.min(bounds.right - note.offsetWidth, window.innerWidth - note.offsetWidth - 8)) + 'px';
  };
  // The Viewer can move the toolbar after a resize (its layout settles over a few
  // frames, and a move without a size change fires no ResizeObserver). While the
  // note is shown, follow the button for a short while after any trigger and stop
  // once its position has been stable for 30 frames.
  var followFrame = 0, lastRight = null, lastBottom = null, stableFrames = 0;
  var follow = function () {
    followFrame = 0;
    if (note.style.display === 'none' || !button.isConnected) return;
    var bounds = button.getBoundingClientRect();
    if (bounds.right !== lastRight || bounds.bottom !== lastBottom) { lastRight = bounds.right; lastBottom = bounds.bottom; stableFrames = 0; positionNote(); }
    else stableFrames += 1;
    if (stableFrames < 30) followFrame = requestAnimationFrame(follow);
  };
  var reposition = function () {
    positionNote();
    stableFrames = 0;
    if (!followFrame && typeof requestAnimationFrame === 'function') followFrame = requestAnimationFrame(follow);
  };
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  toolbar.addEventListener('transitionend', reposition);
  var toolbarObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(reposition) : null;
  if (toolbarObserver) toolbarObserver.observe(toolbar);
  var say = function (text) { note.textContent = text; note.style.display = text ? 'block' : 'none'; reposition(); };
  window.__archifyBuildTask = async function (id) {
    var response = await fetch('/task', { method: 'POST', headers: { 'X-Analysis-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) });
    var body = await response.json();
    if (!response.ok) {
      var error = new Error(body.error || (body.diagnostics || []).map(function (d) { return d.message; }).join(' ') || 'Task request failed');
      error.status = response.status;
      throw error;
    }
    return body;
  };
  // Re-analysis: the server runs a new analysis; the page then reloads and opens it,
  // which re-mounts the layer cleanly instead of patching a live one.
  window.__archifyReanalyze = async function () {
    var response = await fetch('/analyze', { method: 'POST', headers: { 'X-Analysis-Token': token, 'X-Analysis-Refresh': '1' } });
    if (!response.ok) {
      var body = {};
      try { body = await response.json(); } catch (e) { /* not JSON */ }
      throw new Error(body.error || 'analysis failed');
    }
    location.replace(location.pathname + '?analysis=open');
  };
  button.addEventListener('click', async function () {
    button.disabled = true; button.textContent = 'Analyzing…'; say('Reading the repository — imports, modules, rules.');
    try {
      var response = await fetch('/analyze', { method: 'POST', headers: { 'X-Analysis-Token': token } });
      if (!response.ok) {
        var body = await response.json();
        if (response.status === 409 && body.diagnostics?.[0]?.code === 'analysis/architecture-changed') {
          button.disabled = true; button.textContent = 'Code Analysis';
          say('Architecture has changed. Please regenerate the diagram.');
          return;
        }
        throw new Error(body.error || 'analysis failed');
      }
      var parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
      var required = ['bauify-analysis', 'bauify-style', 'bauify-script'];
      for (var i = 0; i < required.length; i++) if (!parsed.getElementById(required[i])) throw new Error('analysis result is incomplete');
      // In document order; the Atlas parts are present only when raw facts were available.
      var ids = ['bauify-analysis', 'bauify-atlas-data', 'bauify-style', 'bauify-script', 'bauify-atlas-style', 'bauify-atlas-script'].filter(function (id) { return parsed.getElementById(id); });
      // Hand over to the layer: it adds its own toggle to the toolbar, so this button retires.
      button.remove(); say('');
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      toolbar.removeEventListener('transitionend', reposition);
      if (followFrame) cancelAnimationFrame(followFrame);
      if (toolbarObserver) toolbarObserver.disconnect();
      for (var j = 0; j < ids.length; j++) {
        var original = parsed.getElementById(ids[j]), element = document.createElement(original.tagName);
        element.id = ids[j]; if (original.getAttribute('type') === 'application/json') element.type = 'application/json';
        element.textContent = original.textContent; document.body.appendChild(element);
      }
      var toggle = document.getElementById('btn-bauify');
      if (toggle) toggle.click();
      if (location.search) history.replaceState(null, '', location.pathname);
    } catch (error) {
      button.disabled = false; button.textContent = 'Code Analysis';
      say('Analysis failed: ' + error.message + ' — click Code Analysis to retry.');
    }
  });
  if (new URLSearchParams(location.search).get('analysis') === 'open') button.click();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help' || args[0] === '-h') { console.log(USAGE); }
  else startAnalysisView(args).then(({ url, delivered }) => console.log(`Diagram delivered: ${delivered}\nCode Analysis: ${url}\nOpen the URL and click "Code Analysis". Press Ctrl+C to stop.`)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
