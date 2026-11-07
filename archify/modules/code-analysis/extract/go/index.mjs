import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { listFiles, snapshotTree, classifyRole, lineCount } from '../shared/files.mjs';
import { matcher } from '../shared/glob.mjs';
import { describeRepository } from '../shared/git.mjs';
import { fail } from '../shared/diagnostics.mjs';

export const id = 'go';
export const REVISION = 1;
export const CALL_MODEL = 'go-source-direct-v1';
export const detect = (root, config) => listFiles(root, config).some(file => file.endsWith('.go'));
export const countSources = (root, config) => listFiles(root, config).filter(file => file.endsWith('.go')).length;
const script = fileURLToPath(new URL('./extract.go', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const metadataFile = file => /(?:^|\/)(?:go\.mod|go\.work)$/.test(file);

export function extract(root, config, { onCapture } = {}) {
  const go = config.go || {};
  if (!Array.isArray(go.tags ?? []) || !(go.tags ?? []).every(tag => typeof tag === 'string' && /^[\w.]+$/.test(tag))
    || (go.tests !== undefined && typeof go.tests !== 'boolean')
    || ['goos', 'goarch'].some(key => go[key] !== undefined && (typeof go[key] !== 'string' || !/^[a-z0-9]+$/.test(go[key])))
    || (go.cgo !== undefined && go.cgo !== false)) fail('extract/go-config-invalid', 'Go scope accepts goos/goarch, tags (string array), tests (boolean), and cgo: false only.', {
    subject: { option: 'config.go' }, supportedFixes: ['choose an explicit source build scope; cgo is not loaded'],
  });
  const tree = snapshotTree(root, file => file.endsWith('.go') || metadataFile(file));
  const moduleText = tree.contents.get('go.mod')?.toString('utf8');
  const directive = moduleText?.match(/^\s*module\s+("(?:[^"\\]|\\.)*"|[^\s/][^\s]*)\s*(?:\/\/.*)?$/m)?.[1];
  let module;
  try { module = directive?.startsWith('"') ? JSON.parse(directive) : directive; } catch { /* explicit failure below */ }
  if (!module) fail('extract/go-module-missing', 'Go source analysis requires a captured root go.mod with a module directive.', {
    subject: { file: 'go.mod' }, supportedFixes: ['analyze the module root; nested modules and go.work are not combined'],
  });
  const include = matcher(config.include), exclude = matcher(config.exclude || []);
  const nested = [...tree.contents.keys()].filter(file => file !== 'go.mod' && file.endsWith('/go.mod')).map(file => path.posix.dirname(file));
  const sources = {}, excluded = [];
  for (const [file, bytes] of tree.contents) {
    if (!file.endsWith('.go')) continue;
    const parts = file.split('/');
    const reason = !include(file) || exclude(file) || parts.slice(0, -1).some((_, i) => exclude(`${parts.slice(0, i + 1).join('/')}/`)) ? 'config-include-exclude'
      : nested.some(dir => file.startsWith(`${dir}/`)) ? 'nested-module-not-loaded'
        : parts.slice(0, -1).some(part => part.startsWith('.') || part.startsWith('_') || part === 'testdata' || part === 'vendor') ? 'go-package-directory-excluded' : null;
    if (reason) excluded.push({ file, reason }); else sources[file] = bytes.toString('base64');
  }
  const command = process.env.ARCHIFY_GO || 'go';
  const result = spawnSync(command, ['run', script], {
    input: JSON.stringify({ sources, module, goos: go.goos || process.env.GOOS || '', goarch: go.goarch || process.env.GOARCH || '', tags: go.tags || [], tests: go.tests !== false }),
    encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024,
    // Compile only our standard-library helper, with the installed host toolchain.
    // The analyzed module is never passed to go commands or downloaded.
    env: { ...process.env, GO111MODULE: 'off', GOWORK: 'off', GOFLAGS: '', GOTOOLCHAIN: 'local', GOENV: 'off', GOOS: '', GOARCH: '', CGO_ENABLED: '0' },
  });
  if (result.error || result.status !== 0) fail(result.error?.code === 'ENOENT' ? 'extract/go-unavailable' : 'extract/go-failed', 'The Go standard-library source helper could not run. Go 1.18+ with its compiler is required.', {
    subject: { command }, evidence: { code: result.error?.code ?? null, exit: result.status, stderr: result.stderr?.trim().split('\n').slice(-8) },
    supportedFixes: ['install Go 1.18+ and put go on PATH', 'set ARCHIFY_GO to an installed Go executable'],
  });
  let output;
  try { output = JSON.parse(result.stdout); } catch { fail('extract/go-output-invalid', 'The Go helper returned invalid JSON.', { supportedFixes: ['report this analyzer failure'] }); }
  const imports = output.imports;
  const unresolved = { external: 0, outside: 0, unknown: 0, opaque: 0 };
  for (const edge of imports) if (!edge.resolved) unresolved[edge.specifier === module || edge.specifier.startsWith(`${module}/`) ? 'outside' : 'external'] += 1;
  const selected = new Set(output.selected);
  const metadata = [...tree.contents].filter(([file]) => metadataFile(file)).map(([file, bytes]) => ({ file, sourceText: bytes.toString('utf8'), sha256: hash(bytes) }));
  onCapture?.({ coverage: 'source-only', model: CALL_MODEL, options: { module, ...output.build }, reads: metadata.map(input => [path.join(root, input.file), input.sourceText]) });
  return {
    schema_version: 1, callModel: CALL_MODEL,
    repository: { ...describeRepository(root), language: id, adapter: `go-parser@${output.version.replace(/^go/, '')}`, adapterRevision: REVISION },
    files: [...selected].map(file => { const sourceText = tree.contents.get(file).toString('utf8'); return { path: file, sourceText, loc: lineCount(sourceText), role: file.endsWith('_test.go') ? 'test' : classifyRole(file, config.roles) }; }),
    packageMarkers: ['go.mod'], imports, symbols: [], functions: output.functions, calls: output.calls, unresolved,
    ...(output.parse_errors.length ? { parse_errors: output.parse_errors } : {}),
    languageScope: { language: id, module, build: output.build, packages: output.packages, typing: output.typing,
      selectedFiles: output.selected, excludedFiles: [...excluded, ...output.excluded].sort((a, b) => a.file.localeCompare(b.file)), metadata,
      limitations: ['Only this root module is analyzed. go.work, replace directives, external dependencies, cgo, generated compiler output and nested modules are not loaded.',
        'Targets are direct source function bindings from go/types with incomplete external types. They do not prove successful compilation, argument applicability, runtime dispatch or a complete caller set.',
        'Function bodies and receiver declarations are inventoried; interface/method/function-variable calls remain unknown. Selected tests are captured but excluded from the module graph by its default role policy.'] },
  };
}
