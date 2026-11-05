// coupling/internal-leak — other modules import a module's internal files
// instead of going through one entry point.
//
// A module's entry files are, in order of authority:
//   1. files matching `rules.coupling.internalLeak.entries` (path globs) in the
//      analysis config: the project has said what its public surface is;
//   2. otherwise an index.* (JS/TS) or __init__.py (Python) file directly in
//      the module's folder.
//
// For every resolved import from another module (test and generated files
// follow the module graph's exclusion policy) the rule records whether it
// lands on an entry file. It then reports:
//   - warning: configured entries exist and imports bypass them;
//   - info: a detected entry exists and imports bypass it, or the module has no
//     entry file at all and other modules reach `minFiles` (default 3) or more
//     of its internal files. Deep imports are a common, deliberate style in
//     ES modules and Python packages, so without a declared convention this is
//     a signal to look at, not a defect.
//
// Modules under a vendor/ or third_party/ folder are not judged: bundled
// third-party code is imported the way its bundler laid it out.
//
// Java is not checked: a package's public classes are its interface, and the
// language has no entry-file convention to compare against. Without raw facts
// the rule cannot see file-level imports and does not run.
import { matcher } from '../../../extract/shared/glob.mjs';
import { fail } from '../../../extract/shared/diagnostics.mjs';

export const code = 'coupling/internal-leak';
export const dimension = 'coupling';
export const severity = 'warning';
export const confidence = 1;
export const version = 1;

const ENTRY_FILE = /^(index\.(?:[cm]?[jt]sx?)|__init__\.py)$/;
// Bundled third-party code is imported the way its bundler laid it out.
const VENDORED = /(^|\/)(vendor|vendored|third_party|third-party)\//;

export function enabled(config, facts) {
  return Boolean(facts && Array.isArray(facts.imports)) && facts.repository?.language !== 'java';
}

export function options(config) {
  const raw = config?.rules?.coupling?.internalLeak;
  const invalid = (message) => fail('config/internal-leak-invalid', message, {
    subject: { option: 'rules.coupling.internalLeak' }, evidence: { value: raw ?? null },
    supportedFixes: ['see "Entry points" in the code-analysis usage guide for the expected shape'],
  });
  if (raw === undefined) return { entries: null, minFiles: 3 };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('"rules.coupling.internalLeak" must be an object.');
  const entries = raw.entries === undefined ? null : typeof raw.entries === 'string' ? [raw.entries] : raw.entries;
  if (entries !== null && (!Array.isArray(entries) || !entries.length || !entries.every((g) => typeof g === 'string' && g.length))) invalid('"entries" must be one or more path globs.');
  const minFiles = raw.minFiles ?? 3;
  if (!Number.isInteger(minFiles) || minFiles < 1) invalid('"minFiles" must be a whole number of at least 1.');
  return { entries, minFiles };
}

export function run({ graph, config, facts }) {
  if (!enabled(config, facts)) return [];
  const { entries: entryGlobs, minFiles } = options(config);
  const isConfiguredEntry = entryGlobs ? matcher(entryGlobs) : null;
  const fileModule = new Map(Object.entries(graph.fileModules || {}));
  const excluded = new Set(graph.excluded?.roles || []);
  const skip = new Set(facts.files.filter((f) => excluded.has(f.role)).map((f) => f.path));
  const modules = new Map(graph.modules.map((m) => [m.id, m]));

  // Files per module, and each module's entry files with where they came from.
  const filesOf = new Map();
  for (const [file, id] of fileModule) if (!skip.has(file)) (filesOf.get(id) || filesOf.set(id, []).get(id)).push(file);
  const entriesOf = new Map();
  for (const [id, files] of filesOf) {
    const m = modules.get(id);
    const configured = isConfiguredEntry ? files.filter((f) => isConfiguredEntry(f)) : [];
    const detected = files.filter((f) => ENTRY_FILE.test(f.split('/').pop()) && parentOf(f) === (m?.path ?? ''));
    entriesOf.set(id, configured.length ? { files: configured.sort(compareText), source: 'config' } : detected.length ? { files: detected.sort(compareText), source: 'detected' } : { files: [], source: 'none' });
  }

  const reached = new Map(); // target module -> { imports, internal: Set, consumers: Set, viaEntry: number }
  for (const imp of facts.imports) {
    if (!imp.resolved || skip.has(imp.from) || skip.has(imp.to)) continue;
    const from = fileModule.get(imp.from), to = fileModule.get(imp.to);
    if (!from || !to || from === to) continue;
    if (!reached.has(to)) reached.set(to, { imports: [], internal: new Set(), consumers: new Set(), viaEntry: 0 });
    const r = reached.get(to);
    if (entriesOf.get(to).files.includes(imp.to)) { r.viaEntry += 1; continue; }
    r.internal.add(imp.to); r.consumers.add(from);
    r.imports.push({ file: imp.from, line: imp.line, to: imp.to,
      ...Object.fromEntries(['typeOnly', 'lazy', 'conditional'].filter((flag) => imp[flag]).map((flag) => [flag, true])) });
  }

  const out = [];
  for (const [id, r] of [...reached].sort((a, b) => compareText(a[0], b[0]))) {
    if (!r.imports.length) continue;
    const entry = entriesOf.get(id);
    const m = modules.get(id);
    const label = m?.label ?? id;
    const total = (filesOf.get(id) || []).length;
    if (entry.source === 'none' && r.internal.size < minFiles) continue;
    if (VENDORED.test(`${m?.path ?? ''}/`)) continue;
    const level = entry.source === 'config' ? 'warning' : 'info';
    r.imports.sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.to, b.to));
    const internal = [...r.internal].sort(compareText);
    const consumers = [...r.consumers].sort(compareText);
    const n = r.imports.length;
    const message = entry.source === 'none'
      ? `${label} has no entry file: ${consumers.length} module${consumers.length === 1 ? ' imports' : 's import'} ${internal.length} of its ${total} files directly (${n} import${n === 1 ? '' : 's'}).`
      : `${label} has an entry point (${entry.files.join(', ')}), but ${n} import${n === 1 ? '' : 's'} from ${consumers.length} module${consumers.length === 1 ? '' : 's'} reach ${internal.length} of its internal files directly.`;
    out.push({
      code, dimension, severity: level, confidence, message,
      subject: { module: id },
      evidence: {
        entries: entry.files, entrySource: entry.source,
        internalFiles: internal, moduleFiles: total, consumers,
        viaEntry: r.viaEntry, totalImports: n,
        files: [...new Set(r.imports.map((i) => i.file))].sort(compareText),
        imports: r.imports,
        threshold: { minFiles },
      },
      supportedFixes: entry.source === 'none'
        ? [`add an entry file to ${m?.path || label} that re-exports what other modules use, and import from it`,
          'if deep imports are the project convention, set rules.coupling.internalLeak.entries or ignore the rule in the analysis config']
        : [`export what consumers need from ${entry.files[0]} and change the cited imports to use it`,
          'if a file is meant to be public, add it to rules.coupling.internalLeak.entries'],
    });
  }
  return out;
}

function parentOf(file) { const i = file.lastIndexOf('/'); return i === -1 ? '' : file.slice(0, i); }
function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
