import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { listFiles, snapshotTree, classifyRole, lineCount } from '../shared/files.mjs';
import { matcher } from '../shared/glob.mjs';
import { describeRepository } from '../shared/git.mjs';
import { fail } from '../shared/diagnostics.mjs';

export const id = 'go';
export const REVISION = 9;
export const CALL_MODEL = 'go-source-direct-v6';
export const detect = (root, config) => listFiles(root, config).some(file => file.endsWith('.go'));
export const countSources = (root, config) => listFiles(root, config).filter(file => file.endsWith('.go')).length;
const script = fileURLToPath(new URL('./worker.mjs', import.meta.url));
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
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ sources, moduleText, goos: go.goos || process.env.GOOS || '', goarch: go.goarch || process.env.GOARCH || '', tags: go.tags || [], tests: go.tests !== false, stdlib: go.stdlib !== false }),
    encoding: 'utf8', timeout: 200000, maxBuffer: 256 * 1024 * 1024,
  });
  let output;
  try { output = JSON.parse(result.stdout); } catch { /* handled as a process failure */ }
  if (result.error || result.status !== 0 || output?.failure) {
    const failure = output?.failure;
    fail(`extract/${failure?.code || 'go-failed'}`, failure?.message || 'The Go analysis worker could not finish.', {
      evidence: failure?.evidence || { code: result.error?.code, exit: result.status, stderr: result.stderr?.trim().split('\n').slice(-8) },
      supportedFixes: ['install a Go 1.25+ project SDK on PATH or select it with ARCHIFY_GO', 'allow Go 1.26+ helper toolchain selection, or set ARCHIFY_GO_BUILD to an installed build Go executable', 'allow the locked helper modules to download, or prepopulate the Go toolchain and module cache before offline use; GOTOOLCHAIN=local disables build toolchain switching', 'inspect SDK target/tag errors; go.stdlib: false selects captured-only partial typing'],
    });
  }
  if (!output) fail('extract/go-output-invalid', 'The Go analysis worker returned invalid JSON.', { supportedFixes: ['report this analyzer failure'] });
  const module = output.module;
  const imports = output.imports;
  const unresolved = { external: 0, outside: 0, unknown: 0, opaque: 0 };
  for (const edge of imports) if (!edge.resolved) unresolved[edge.specifier === module || edge.specifier.startsWith(`${module}/`) ? 'outside' : 'external'] += 1;
  const selected = new Set(output.selected);
  const metadata = [...tree.contents].filter(([file]) => metadataFile(file)).map(([file, bytes]) => ({ file, sourceText: bytes.toString('utf8'), sha256: hash(bytes) }));
  onCapture?.({ coverage: 'source-only', model: CALL_MODEL, options: { module, ...output.build, standardLibrary: output.standardLibrary, loader: output.loader }, reads: metadata.map(input => [path.join(root, input.file), input.sourceText]) });
  return {
    schema_version: 1, callModel: CALL_MODEL,
    repository: { ...describeRepository(root), language: id, adapter: `go-packages@${output.loader.version.replace(/^v/, '')}`, adapterRevision: REVISION },
    files: [...selected].map(file => { const sourceText = tree.contents.get(file).toString('utf8'); return { path: file, sourceText, loc: lineCount(sourceText), role: file.endsWith('_test.go') ? 'test' : classifyRole(file, config.roles) }; }),
    packageMarkers: ['go.mod'], imports, symbols: [], functions: output.functions, calls: output.calls, unresolved,
    interfaceImplementations: output.interfaceImplementations,
    ...(output.parse_errors.length ? { parse_errors: output.parse_errors } : {}),
    languageScope: { language: id, module, build: output.build, packages: output.packages, typing: output.typing, loader: output.loader, standardLibrary: output.standardLibrary, interfaceEvidence: output.interfaceEvidence,
      selectedFiles: output.selected, excludedFiles: [...excluded, ...output.excluded].sort((a, b) => a.file.localeCompare(b.file)), metadata,
      limitations: ['Only this root module is captured. go.work, replace directives, third-party dependencies, cgo, generated compiler output and nested modules are not loaded. SDK export types may be prepared; SDK source and metrics are not included in the captured source.',
        'Source selection uses tool/release tags queried from the selected project SDK for the target; the helper compiler version is recorded separately.',
        'Official go/packages loads an isolated captured-source module with the declared Go language version (Go 1.16 when omitted). Project dependency and toolchain downloads are disabled. go.stdlib:false uses package metadata and a captured-only go/types checker under the same language version.',
        'Targets use official Go type objects admitted only at unique captured function/method declarations. AST and type operations supply metrics, ambiguity guards and interface method-set evidence; third-party types remain incomplete. They do not prove successful compilation, argument applicability, runtime dispatch or a complete caller set.',
        'Function bodies and receiver declarations are inventoried; concrete compiler-selected source methods are bound, including promotion, method expressions and generic instances. Interface method calls bind to a captured interface method declaration when one is visible; the runtime implementation remains unknown. Function-variable calls remain unknown. Selected tests are captured but excluded from the module graph by its default role policy.',
        'Captured interface implementation edges use go/types method sets for named source types and interfaces. Value and pointer satisfaction are recorded separately. Named captured interfaces may retain uncaptured external method identities without source locations. Unsupported or incomplete interfaces, generic interfaces/concrete types and type aliases remain outside proven edge coverage; read interfaceEvidence. Absence of an edge is not proof that a type does not implement an interface.'] },
  };
}
