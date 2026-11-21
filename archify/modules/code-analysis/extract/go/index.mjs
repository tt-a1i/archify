import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listFiles, snapshotTree, classifyRole, lineCount } from '../shared/files.mjs';
import { matcher } from '../shared/glob.mjs';
import { describeRepository } from '../shared/git.mjs';
import { fail } from '../shared/diagnostics.mjs';

export const id = 'go';
export const REVISION = 7;
export const CALL_MODEL = 'go-source-direct-v4';
export const detect = (root, config) => listFiles(root, config).some(file => file.endsWith('.go'));
export const countSources = (root, config) => listFiles(root, config).filter(file => file.endsWith('.go')).length;
const script = fileURLToPath(new URL('./extract.go', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const metadataFile = file => /(?:^|\/)(?:go\.mod|go\.work)$/.test(file);

export function extract(root, config, { onCapture } = {}) {
  const go = config.go || {};
  if (!Array.isArray(go.tags ?? []) || !(go.tags ?? []).every(tag => typeof tag === 'string' && /^[\w.]+$/.test(tag))
    || (go.stdlib !== undefined && typeof go.stdlib !== 'boolean')
    || (go.tests !== undefined && typeof go.tests !== 'boolean')
    || ['goos', 'goarch'].some(key => go[key] !== undefined && (typeof go[key] !== 'string' || !/^[a-z0-9]+$/.test(go[key])))
    || (go.cgo !== undefined && go.cgo !== false)) fail('extract/go-config-invalid', 'Go scope accepts goos/goarch, tags (string array), tests/stdlib (boolean), and cgo: false only.', {
    subject: { option: 'config.go' }, supportedFixes: ['choose an explicit source build scope; cgo is not loaded'],
  });
  const tree = snapshotTree(root, file => file.endsWith('.go') || metadataFile(file));
  const moduleText = tree.contents.get('go.mod')?.toString('utf8');
  if (moduleText === undefined) fail('extract/go-module-missing', 'Go source analysis requires a captured root go.mod with a module directive.', {
    subject: { file: 'go.mod' }, supportedFixes: ['analyze the module root; nested modules and go.work are not combined'],
  });
  const command = process.env.ARCHIFY_GO || 'go';
  const env = { ...process.env, GO111MODULE: 'off', GOWORK: 'off', GOFLAGS: '', GOTOOLCHAIN: 'local', GOENV: 'off', GOOS: '', GOARCH: '', CGO_ENABLED: '0', GOPROXY: 'off', GOSUMDB: 'off' };
  // Ask the installed SDK to parse only the captured metadata. No project
  // directory, dependency graph, programs or generators reach this command.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-go-module-'));
  let moduleResult;
  try {
    fs.writeFileSync(path.join(temporary, 'go.mod'), moduleText);
    moduleResult = spawnSync(command, ['mod', 'edit', '-json'], {
      cwd: temporary, env: { ...env, GO111MODULE: 'on' }, encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024,
    });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  if (moduleResult.error || moduleResult.status !== 0) fail(moduleResult.error?.code === 'ENOENT' ? 'extract/go-unavailable' : 'extract/go-module-invalid', 'The installed Go SDK could not parse the captured root go.mod.', {
    subject: { file: 'go.mod', command }, evidence: { code: moduleResult.error?.code ?? null, exit: moduleResult.status, stderr: moduleResult.stderr?.trim().split('\n').slice(-8) },
    supportedFixes: ['install Go 1.18+ and put go on PATH, or set ARCHIFY_GO', 'correct go.mod syntax or use an installed SDK that understands its directives'],
  });
  let moduleInfo;
  try { moduleInfo = JSON.parse(moduleResult.stdout); } catch { fail('extract/go-output-invalid', 'The Go SDK returned invalid module metadata JSON.', { supportedFixes: ['report this analyzer failure'] }); }
  const module = moduleInfo?.Module?.Path;
  if (!module) fail('extract/go-module-missing', 'The captured root go.mod has no module directive.', { subject: { file: 'go.mod' }, supportedFixes: ['analyze the module root with its module directive'] });
  const languageVersion = moduleInfo.Go || '1.16';
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
  const result = spawnSync(command, ['run', script], {
    input: JSON.stringify({ sources, module, languageVersion, goos: go.goos || process.env.GOOS || '', goarch: go.goarch || process.env.GOARCH || '', tags: go.tags || [], tests: go.tests !== false, stdlib: go.stdlib !== false }),
    encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024,
    // Compile our helper with the host SDK. It prepares only needed SDK exports
    // in an empty directory when standard-library typing is enabled.
    // The analyzed module is never passed to go commands or downloaded.
    env,
  });
  if (result.error || result.status !== 0) fail(result.error?.code === 'ENOENT' ? 'extract/go-unavailable' : 'extract/go-failed', 'The Go standard-library source helper could not run. Go 1.18+ with its compiler is required.', {
    subject: { command }, evidence: { code: result.error?.code ?? null, exit: result.status, stderr: result.stderr?.trim().split('\n').slice(-8) },
    supportedFixes: ['install Go 1.18+ and put go on PATH', 'set ARCHIFY_GO to an installed Go executable', 'inspect SDK target/tag errors; go.stdlib: false selects captured-only partial typing'],
  });
  let output;
  try { output = JSON.parse(result.stdout); } catch { fail('extract/go-output-invalid', 'The Go helper returned invalid JSON.', { supportedFixes: ['report this analyzer failure'] }); }
  const imports = output.imports;
  const unresolved = { external: 0, outside: 0, unknown: 0, opaque: 0 };
  for (const edge of imports) if (!edge.resolved) unresolved[edge.specifier === module || edge.specifier.startsWith(`${module}/`) ? 'outside' : 'external'] += 1;
  const selected = new Set(output.selected);
  const metadata = [...tree.contents].filter(([file]) => metadataFile(file)).map(([file, bytes]) => ({ file, sourceText: bytes.toString('utf8'), sha256: hash(bytes) }));
  onCapture?.({ coverage: 'source-only', model: CALL_MODEL, options: { module, ...output.build, standardLibrary: output.standardLibrary }, reads: metadata.map(input => [path.join(root, input.file), input.sourceText]) });
  return {
    schema_version: 1, callModel: CALL_MODEL,
    repository: { ...describeRepository(root), language: id, adapter: `go-parser@${output.version.replace(/^go/, '')}`, adapterRevision: REVISION },
    files: [...selected].map(file => { const sourceText = tree.contents.get(file).toString('utf8'); return { path: file, sourceText, loc: lineCount(sourceText), role: file.endsWith('_test.go') ? 'test' : classifyRole(file, config.roles) }; }),
    packageMarkers: ['go.mod'], imports, symbols: [], functions: output.functions, calls: output.calls, unresolved,
    interfaceImplementations: output.interfaceImplementations,
    ...(output.parse_errors.length ? { parse_errors: output.parse_errors } : {}),
    languageScope: { language: id, module, build: output.build, packages: output.packages, typing: output.typing, standardLibrary: output.standardLibrary, interfaceEvidence: output.interfaceEvidence,
      selectedFiles: output.selected, excludedFiles: [...excluded, ...output.excluded].sort((a, b) => a.file.localeCompare(b.file)), metadata,
      limitations: ['Only this root module is analyzed. go.work, replace directives, third-party dependencies, cgo, generated compiler output and nested modules are not loaded. SDK standard-library type exports may be prepared and read; their source is not analyzed.',
        'Source selection uses the running SDK tool/release tags; target CPU-feature and experimental overrides are not independently reconstructed.',
        'The captured go.mod is parsed with the installed SDK in an isolated metadata-only directory. Its Go language version (1.16 when omitted) is passed to go/types. Toolchain directives do not download or select another SDK; this remains incomplete type checking.',
        'Targets are direct source function bindings from go/types with recorded SDK types when enabled and incomplete third-party types. They do not prove successful compilation, argument applicability, runtime dispatch or a complete caller set.',
        'Function bodies and receiver declarations are inventoried; concrete compiler-selected source methods are bound, including promotion, method expressions and generic instances. Interface method calls bind to a captured interface method declaration when one is visible; the runtime implementation remains unknown. Function-variable calls remain unknown. Selected tests are captured but excluded from the module graph by its default role policy.',
        'Captured interface implementation edges use go/types method sets for named source types and interfaces. Value and pointer satisfaction are recorded separately. Interfaces with external or anonymous embedded interfaces, generic interfaces, generic concrete types and type aliases are omitted from the edge set and reported as unknown; absence of an edge is not proof that a type does not implement an interface.'] },
  };
}
