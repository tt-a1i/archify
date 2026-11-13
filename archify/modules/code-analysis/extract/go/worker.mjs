import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const failure = (code, message, evidence = {}) => Object.assign(new Error(message), { code, evidence });

// Each tool owns a process group so a deadline also stops go list/compiler
// descendants. The worker owns temporary files, including on interrupted runs.
function stop(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { timeout: 5000, windowsHide: true });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (cause) {
      if (!['ESRCH', 'EPERM'].includes(cause.code)) throw cause;
      child.kill('SIGKILL');
    }
  }
}

export async function analyzeGo(req, { command = process.env.ARCHIFY_GO || 'go', buildCommand = process.env.ARCHIFY_GO_BUILD || command, timeoutMs = 180000 } = {}) {
  if (!req.moduleText) throw failure('go-module-missing', 'Go source analysis requires a captured root go.mod.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-go-'));
  const buildRoot = path.join(temporary, 'helper'), root = path.join(temporary, 'capture');
  const deadline = Date.now() + timeoutMs;
  let active, interrupted = false;
  const cancel = () => { interrupted = true; stop(active); };
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  const env = { ...process.env, GO111MODULE: 'on', GOWORK: 'off', GOFLAGS: '', GOTOOLCHAIN: 'local',
    GOENV: 'off', GOROOT: '', GOOS: '', GOARCH: '', CGO_ENABLED: '0', GOPACKAGESDRIVER: 'off' };
  // An explicit relative executable is relative to the invoking directory.
  if (command.includes('/') || command.includes('\\')) command = path.resolve(command);
  if (buildCommand.includes('/') || buildCommand.includes('\\')) buildCommand = path.resolve(buildCommand);
  async function run(executable, args, { phase = 'project-analysis', ...options } = {}) {
    if (interrupted) throw failure('go-interrupted', 'Go analysis was interrupted.');
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: buildRoot, env, detached: process.platform !== 'win32', windowsHide: true, ...options });
      active = child;
      const stdout = [], stderr = [];
      let bytes = 0, cause;
      const abort = error => { cause ||= error; stop(child); };
      const timer = setTimeout(() => abort(failure('go-timeout', 'Go analysis exceeded its time limit.')), Math.max(1, deadline - Date.now()));
      for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => {
        if (cause) return;
        bytes += chunk.length;
        if (bytes > 256 * 1024 * 1024) abort(failure('go-output-too-large', 'Go analysis exceeded its output limit.'));
        else chunks.push(chunk);
      });
      child.on('error', error => { cause = failure(error.code === 'ENOENT' ? 'go-unavailable' : 'go-failed', 'The Go tool could not start.', { phase, command: executable, code: error.code }); });
      child.stdin.on('error', () => {}); // Early exits are reported by close.
      child.once('close', (code, signal) => {
        clearTimeout(timer); active = undefined;
        if (interrupted) cause = failure('go-interrupted', 'Go analysis was interrupted.');
        if (cause || code !== 0) {
          stop(child);
          reject(cause || failure('go-failed', 'The Go tool could not complete. Check the project SDK, helper build toolchain and locked helper dependencies.', {
            phase, exit: code, signal, stderr: Buffer.concat(stderr).toString('utf8').replaceAll(temporary, '<analysis>').trim().split('\n').slice(-8),
          }));
        } else resolve(Buffer.concat(stdout).toString('utf8'));
      });
      child.stdin.end(options.input || '');
    });
  }
  try {
    fs.mkdirSync(buildRoot); fs.mkdirSync(root);
    for (const file of ['extract.go', 'go.mod', 'go.sum']) fs.copyFileSync(path.join(directory, file), path.join(buildRoot, file));
    // Query the project SDK outside the helper module: its higher go directive
    // must not select the toolchain used to load captured project source.
    const sdk = JSON.parse(await run(command, ['env', '-json', 'GOROOT', 'GOVERSION'], { cwd: root, phase: 'project-sdk' }));
    const version = /^go(\d+)\.(\d+)/.exec(sdk.GOVERSION || '');
    if (!sdk.GOROOT || !version || Number(version[1]) < 1 || (Number(version[1]) === 1 && Number(version[2]) < 25)) {
      throw failure('go-unavailable', 'Project loading requires a Go 1.25+ SDK; older project language versions remain supported.', { version: sdk.GOVERSION });
    }
    const projectEnv = { ...env, GOROOT: sdk.GOROOT, PATH: `${path.join(sdk.GOROOT, 'bin')}${path.delimiter}${env.PATH || ''}`,
      GOOS: req.goos || '', GOARCH: req.goarch || '', GOPROXY: 'off', GOSUMDB: 'off' };
    // The SDK supplies its own release, experiment and target architecture tags.
    // Reconstructing these from the helper's build.Default selects wrong files
    // when the helper compiler and the project SDK differ.
    const context = await run(command, ['list', '-f', '{{context.GOOS}}|{{context.GOARCH}}|{{join context.ReleaseTags ","}}|{{join context.ToolTags ","}}', 'unsafe'], { cwd: root, env: projectEnv, phase: 'project-sdk' });
    const [goos, goarch, releases, tags] = context.trim().split('|');
    if (!goos || !goarch || !releases || tags === undefined) throw failure('go-output-invalid', 'The project SDK returned invalid build context.');
    const executable = path.join(buildRoot, process.platform === 'win32' ? 'extract.exe' : 'extract');
    // Go's own toolchain selection satisfies the helper's go.mod independently.
    // Honor an explicit GOTOOLCHAIN (including local/path for offline use).
    await run(buildCommand, ['build', '-trimpath', '-mod=readonly', '-o', executable, '.'], {
      env: { ...env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || 'auto' }, phase: 'helper-build',
    });
    const output = await run(executable, [], { input: JSON.stringify({ ...req, root, goos, goarch,
      sdk: { version: sdk.GOVERSION, releaseTags: releases.split(','), toolTags: tags ? tags.split(',') : [] } }), env: projectEnv });
    try { return JSON.parse(output); } catch { throw failure('go-output-invalid', 'The Go helper returned invalid JSON.'); }
  } finally {
    stop(active);
    process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await analyzeGo(JSON.parse(fs.readFileSync(0, 'utf8'))))); }
  catch (cause) {
    process.stdout.write(JSON.stringify({ failure: { code: typeof cause.code === 'string' ? cause.code : 'go-failed', message: cause.message, evidence: cause.evidence } }));
    process.exitCode = 1;
  }
}
