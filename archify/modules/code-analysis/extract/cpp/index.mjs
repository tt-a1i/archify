import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeRepository } from '../shared/git.mjs';
import { fail } from '../shared/diagnostics.mjs';
import { classifyRole, lineCount, listFiles, snapshotTree, toPosix } from '../shared/files.mjs';
import { matcher } from '../shared/glob.mjs';

export const id = 'cpp';
export const REVISION = 4;
export const CALL_MODEL = 'cpp-source-direct-v1';
const C = /\.c$/;
const CPP = /\.(?:cc|cpp|cxx|C)$/;
const INPUT = /\.(?:c|cc|cpp|cxx|C|h|hh|hpp|hxx|inc|ipp|inl|tcc|tpp|def)$/;
const script = fileURLToPath(new URL('./extract.py', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export const countC = (root, config) => listFiles(root, config).filter(file => C.test(file)).length;
export const countSources = (root, config) => listFiles(root, config).filter(file => CPP.test(file)).length;
export const detect = (root, config) => countSources(root, config) > 0;
export const extract = (root, config, options) => extractFor(id, root, config, options);

// An out-of-tree compilation database is allowed, but it receives the same
// checked single-read treatment as an in-tree metadata input.
function readDatabase(file) {
  let fd;
  try {
    const beforePath = fs.lstatSync(file, { bigint: true });
    if (!beforePath.isFile()) throw new Error('not a regular file');
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = fs.fstatSync(fd, { bigint: true });
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    const afterPath = fs.lstatSync(file, { bigint: true });
    if ([before, after, afterPath].some(state => state.dev !== beforePath.dev || state.ino !== beforePath.ino || state.size !== beforePath.size || state.mtimeNs !== beforePath.mtimeNs || state.ctimeNs !== beforePath.ctimeNs)) throw new Error('changed during capture');
    return bytes;
  } catch (error) {
    fail('extract/cpp-database-unreadable', 'The compilation database could not be captured as a stable regular file.', {
      subject: { file }, evidence: { reason: error.message }, supportedFixes: ['provide an existing compile_commands.json and retry after build files stop changing'],
    });
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function extractFor(language, root, config, { onCapture } = {}) {
  root = fs.realpathSync(root);
  const options = config.cpp || {};
  if (typeof options.compileCommands !== 'string' || !options.compileCommands || (options.sysroot !== undefined && typeof options.sysroot !== 'string')) fail('extract/cpp-database-missing', 'C/C++ analysis requires config.cpp.compileCommands pointing to an existing compile_commands.json.', {
    subject: { option: 'config.cpp.compileCommands' }, supportedFixes: ['generate a compilation database with your build system, then pass its path in --config; Archify does not run the build'],
  });
  const timeoutMs = options.timeoutMs ?? 180000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 600000) fail('extract/cpp-timeout-invalid', 'config.cpp.timeoutMs must be an integer between 10000 and 600000 milliseconds.', {
    subject: { option: 'config.cpp.timeoutMs' }, supportedFixes: ['use a timeout from 10000 to 600000 milliseconds, or omit it for the 180000 millisecond default'],
  });
  const databasePath = path.resolve(root, options.compileCommands);
  if (path.basename(databasePath) !== 'compile_commands.json') fail('extract/cpp-database-invalid', 'The compilation database file must be named compile_commands.json.', {
    subject: { file: databasePath }, supportedFixes: ['point config.cpp.compileCommands at compile_commands.json'],
  });
  const databaseRel = inside(root, databasePath) ? toPosix(path.relative(root, databasePath)) : null;
  const include = matcher(config.include), exclude = matcher(config.exclude || []);
  const excluded = file => {
    if (exclude(file)) return true;
    for (let slash = file.indexOf('/'); slash !== -1; slash = file.indexOf('/', slash + 1)) {
      if (exclude(`${file.slice(0, slash)}/`)) return true;
    }
    return false;
  };
  const sourceFile = file => INPUT.test(file) && include(file) && !excluded(file);
  const tree = snapshotTree(root, file => sourceFile(file) || file === databaseRel);
  const databaseBytes = databaseRel ? tree.contents.get(databaseRel) : readDatabase(databasePath);
  if (!databaseBytes) fail('extract/cpp-database-unreadable', 'The configured compilation database is missing from the captured root.', { subject: { file: databaseRel } });
  let database;
  try { database = JSON.parse(databaseBytes.toString('utf8')); } catch { fail('extract/cpp-database-invalid', 'The captured compilation database is not JSON.', { subject: { file: databasePath } }); }
  if (!Array.isArray(database)) fail('extract/cpp-database-invalid', 'The captured compilation database must be an array.', { subject: { file: databasePath } });
  const sourceBytes = [...tree.contents].filter(([file]) => sourceFile(file));
  const candidates = sourceBytes.map(([file]) => file).filter(file => language === 'c' ? C.test(file) : C.test(file) || CPP.test(file));
  const blocked = tree.names.filter(file => INPUT.test(file) && !sourceFile(file));
  if (!candidates.length) fail('extract/cpp-no-sources', 'No selected C/C++ translation units are inside the analyzed root.', {
    subject: { root }, supportedFixes: ['include .c/.cc/.cpp/.cxx/.C sources in the analysis config'],
  });
  const totalBytes = sourceBytes.reduce((sum, [, bytes]) => sum + bytes.length, 0);
  if (sourceBytes.length > 20000 || totalBytes > 256 * 1024 * 1024) fail('extract/cpp-input-too-large', 'The frozen C/C++ input exceeds this adapter’s 20,000-file or 256 MiB limit.', {
    evidence: { files: sourceBytes.length, bytes: totalBytes }, supportedFixes: ['analyze a smaller root or exclude large generated trees'],
  });
  let sysroot = options.sysroot || process.env.ARCHIFY_CPP_SYSROOT || '';
  if (!sysroot && process.platform === 'darwin') {
    const sdk = spawnSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8', timeout: 3000 });
    if (sdk.status === 0) sysroot = sdk.stdout.trim();
  }
  const python = process.env.ARCHIFY_CPP_PYTHON || 'python3';
  const result = spawnSync(python, [script], {
    input: JSON.stringify({ root, language, database: databaseBytes.toString('utf8'), candidates, blocked,
      sources: Object.fromEntries(sourceBytes.map(([file, bytes]) => [file, bytes.toString('base64')])), sysroot }),
    cwd: os.tmpdir(), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: '', PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (result.error || result.status !== 0) fail(result.error?.code === 'ENOENT' ? 'extract/cpp-python-unavailable' : result.error?.code === 'ETIMEDOUT' ? 'extract/cpp-timeout' : 'extract/cpp-helper-failed', 'The C/C++ libclang helper could not run.', {
    evidence: { code: result.error?.code ?? null, exit: result.status, timeoutMs, stderr: result.stderr?.trim().split('\n').slice(-8) },
    supportedFixes: result.error?.code === 'ETIMEDOUT'
      ? ['increase config.cpp.timeoutMs up to 600000 milliseconds for this build selection', 'analyze a smaller root or select fewer compilation units']
      : ['install Python 3, matching clang Python bindings and libclang; set ARCHIFY_CPP_PYTHON and ARCHIFY_LIBCLANG if needed'],
  });
  let output;
  try { output = JSON.parse(result.stdout); } catch { fail('extract/cpp-output-invalid', 'The C/C++ helper returned invalid JSON.', { evidence: { stderr: result.stderr?.trim().split('\n').slice(-8) } }); }
  if (output.error) fail(output.code || 'extract/cpp-failed', output.error, {
    evidence: output.evidence || {}, supportedFixes: output.fixes || ['check the compilation database and installed libclang version'],
  });
  const selected = new Set(output.selectedFiles);
  // The database may contain private -D values and absolute build paths. Keep
  // its digest and per-unit command digests, never its full text in raw facts.
  const metadata = [];
  const build = { databasePath, databaseSha256: sha(databaseBytes), sysroot, libclang: output.libclang, units: output.units };
  onCapture?.({ coverage: 'compilation-database', model: CALL_MODEL, options: build, reads: [[databasePath, databaseBytes.toString('utf8')]] });
  return {
    schema_version: 1, callModel: CALL_MODEL,
    repository: { ...describeRepository(root), language, adapter: `libclang@${output.libclang}`, adapterRevision: REVISION },
    files: [...selected].sort().map(file => {
      const sourceText = tree.contents.get(file).toString('utf8');
      return { path: file, sourceText, loc: lineCount(sourceText), role: classifyRole(file, config.roles) };
    }),
    imports: output.imports, symbols: [], functions: output.functions, calls: output.calls,
    unresolved: output.unresolved,
    ...(output.parse_errors.length ? { parse_errors: output.parse_errors } : {}),
    languageScope: { language, build, selectedFiles: [...selected].sort(), excludedFiles: output.excludedFiles, fileContexts: output.fileContexts,
      metadata, conflicts: output.conflicts,
      limitations: ['Only translation units with a unique command in the captured compilation database are parsed. Headers are attributed to the translation units that included them; unselected commands and external headers do not establish project coverage.',
        'C/C++ include edges are active in at least one recorded translation-unit context. They are structural preprocessor relationships, not runtime loading or initialization evidence.',
        'Function measurements cover uniquely located source definitions. Conflicting identities or measurements for one physical definition are omitted. Ordinary calls bind only to captured definitions visible in the same translation unit. Cross-unit calls, virtual dispatch, function pointers, templates and macro-generated calls remain unknown.',
        'Project source bytes are supplied to libclang as unsaved files. External headers, SDK configuration and file-existence queries remain environment inputs; this is not proof of a successful project build.'] },
  };
}
