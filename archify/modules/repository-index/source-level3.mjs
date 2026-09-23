import fs from 'node:fs';
import path from 'node:path';

// Level 3 turns the Level 1 configuration boundaries and the Level 2 import
// graph into one bounded evidence pack. The pack is an answer, not a work
// queue: it leads with the derived module graph and configuration boundaries,
// states what the scanners could not see, and asks at most a dozen
// module-level questions whose answers could change a boundary. Per-file
// detail stays in the on-disk graph the pack points to. The serialized pack
// never exceeds its byte budget; when trimming is needed, evidence detail is
// dropped before facts, and every trim is recorded.
export const PACK_DEFAULT_LIMITS = Object.freeze({
  maximumBytes: 16 * 1024,
  maximumModules: 24,
  maximumEdges: 60,
  maximumEdgeEvidence: 2,
  maximumBoundaryItems: 15,
  maximumQuestions: 12,
  maximumQuestionsPerKind: 4,
  maximumExcerptLines: 7,
  maximumRuntimeChannels: 16,
});

const BUILD_FILE = /^(?:cmakelists\.txt|setup\.py|build\.rs|makefile|meson\.build|binding\.gyp|build\.sh)$/i;

function evidenceReference(entry) {
  return `${entry.file}:${entry.line}`;
}

// --- Anchor excerpts ---------------------------------------------------------
// A question anchor carries the few lines that answer it, so the author does
// not open whole files: a line anchor keeps its surrounding lines, and a build
// or project file keeps the lines that declare bindings, extensions, or
// generated code. Lines that look like credentials are never copied.
const BUILD_HINT = /add_library|add_subdirectory|pybind|nanobind|pyo3|maturin|cython|extension|compile_protos|tonic_build|protoc|grpc|python-source|module-name|\[project\.scripts\]|:main\b/i;
const SECRET_LINE = /(?:token|secret|passw(?:or)?d|api[_-]?key|credential)\s*[:=]/i;
const MAXIMUM_EXCERPT_LINE = 160;

function anchorExcerpt(root, anchor, maximumLines) {
  const [, file, lineText] = anchor.match(/^(.*?)(?::(\d+))?$/);
  let lines;
  try {
    lines = fs.readFileSync(path.join(root, ...file.split('/')), 'utf8').split(/\r?\n/);
  } catch {
    return null;
  }
  const basename = path.posix.basename(file);
  let numbers;
  if (lineText) {
    const line = Number(lineText);
    numbers = lines.map((_, index) => index + 1).filter((number) => number >= line - 2 && number <= line + 4);
  } else if (BUILD_FILE.test(basename) || /^(?:pyproject\.toml|setup\.cfg|cargo\.toml)$/i.test(basename)) {
    numbers = lines.map((_, index) => index + 1)
      .filter((number) => BUILD_HINT.test(lines[number - 1]) && !/^\s*(?:#|\/\/)/.test(lines[number - 1]));
  } else {
    return null;
  }
  const picked = numbers
    .filter((number) => lines[number - 1].trim() && !SECRET_LINE.test(lines[number - 1]))
    .slice(0, maximumLines)
    .map((number) => {
      const text = lines[number - 1].trim();
      return `${number}: ${text.length > MAXIMUM_EXCERPT_LINE ? `${text.slice(0, MAXIMUM_EXCERPT_LINE)}...` : text}`;
    });
  return picked.length ? picked : null;
}

function withExcerpts(question, root, maximumLines) {
  if (!root || maximumLines === 0) return question;
  const excerpts = Object.fromEntries(question.anchors
    .map((anchor) => [anchor, anchorExcerpt(root, anchor, maximumLines)])
    .filter(([, lines]) => lines));
  return Object.keys(excerpts).length ? { ...question, excerpts } : question;
}

// A console script names a module (`pkg.cli:main`). Mapping it onto a scanned
// file answers where it starts, and a console script always runs as its own
// process, so a resolved script needs no question.
function resolveScriptEntrypoints(boundaries, records) {
  if (!Array.isArray(boundaries.entrypoints)) return boundaries;
  const paths = records.map((record) => record.path);
  return {
    ...boundaries,
    entrypoints: boundaries.entrypoints.map((entry) => {
      if (!entry.module || entry.files?.length) return entry;
      const tail = entry.module.split('.').join('/');
      const suffixes = [`${tail}.py`, `${tail}/__init__.py`];
      const candidates = paths.filter((file) => suffixes.some((suffix) => file === suffix || file.endsWith(`/${suffix}`)));
      const base = path.posix.dirname(entry.source);
      const file = candidates.find((candidate) => base === '.' || candidate.startsWith(`${base}/`))
        || (candidates.length === 1 ? candidates[0] : null);
      return file ? { ...entry, files: [file] } : entry;
    }),
  };
}

function trimList(list, maximum) {
  return { items: list.slice(0, maximum), omitted: Math.max(0, list.length - maximum) };
}

// --- Module roles -------------------------------------------------------------
// Directory modules mix runtime components with the code around them. A
// diagram of the runtime should not draw tests, maintenance scripts, or data
// folders as components. A name alone is not trusted: a directory called
// tools/ that runtime modules import is a runtime component (a voice
// assistant's tool-calling layer, say). Support status needs the name hint
// AND the graph: nothing in the runtime imports it and it owns no entrypoint.
const SUPPORT_NAME = /^(?:scripts?|tools?|tooling|bench(?:mark)?s?|examples?|demos?|samples?|experiments?|notebooks?|docs?|e2e|fixtures?|hack|dev|ci)$/i;
const TEST_NAME = /^(?:tests?|testing|specs?|e2e|__tests__|integration[-_]tests?)$/i;

// Only configuration-declared entrypoints (console scripts, npm bin, Procfile,
// container commands) exempt a support-named module. Filename heuristics are
// not enough: every script in scripts/ looks like an entrypoint.
export function classifyModules(level2, declaredEntryFiles = []) {
  const roles = new Map();
  const ownsDeclaredEntry = (modulePath) => declaredEntryFiles
    .some((file) => file === modulePath || file.startsWith(`${modulePath}/`));
  for (const module of level2.modules) {
    const fileRoles = module.roles || {};
    const sourceFiles = fileRoles.source || 0;
    const testFiles = fileRoles.test || 0;
    const unscanned = Object.values(module.unscannedLanguages || {}).reduce((total, count) => total + count, 0);
    const name = module.path.split('/').pop();
    // Hidden directories (.claude, .github, .devcontainer) hold agent,
    // editor, and CI tooling, never runtime components.
    if (module.path.split('/').some((segment) => segment.startsWith('.') && segment !== '.')) {
      roles.set(module.path, 'tooling');
      continue;
    }
    // Colocated tests do not make a module a test module: it needs no source
    // at all, or a test-like name with tests outnumbering source.
    if (testFiles > 0 && (sourceFiles === 0 || (TEST_NAME.test(name) && testFiles >= sourceFiles))) roles.set(module.path, 'test');
    else if (sourceFiles === 0 && unscanned === 0) roles.set(module.path, 'non-source');
    else roles.set(module.path, 'runtime');
  }
  // A support module may import another support module (scripts -> tests),
  // so importers are re-evaluated until no module changes role.
  for (let changed = true; changed;) {
    changed = false;
    for (const module of level2.modules) {
      if (roles.get(module.path) !== 'runtime') continue;
      const name = module.path.split('/').pop();
      if (!SUPPORT_NAME.test(name) || ownsDeclaredEntry(module.path)) continue;
      const runtimeImporters = level2.edges.filter((edge) => edge.to === module.path && roles.get(edge.from) === 'runtime');
      if (runtimeImporters.length === 0) {
        roles.set(module.path, 'tooling');
        changed = true;
      }
    }
  }
  return roles;
}

// --- Question generators ----------------------------------------------------
// Each generator returns module-level questions with at most two source
// anchors. Only situations that can change a diagram boundary qualify;
// everything else stays a plain fact in the pack.

function crossLanguageQuestions(level2, records, roles) {
  const questions = [];
  for (const module of level2.modules) {
    const unscanned = Object.entries(module.unscannedLanguages || {});
    const unscannedFiles = unscanned.reduce((total, [, count]) => total + count, 0);
    if (unscannedFiles < 5 || unscannedFiles < Math.ceil(module.files * 0.3)) continue;
    const languages = unscanned.sort(([, left], [, right]) => right - left).map(([name]) => name);
    const buildFile = records.find((record) => record.path.startsWith(`${module.path}/`)
      && BUILD_FILE.test(path.posix.basename(record.path)))
      || records.find((record) => BUILD_FILE.test(path.posix.basename(record.path)));
    const sample = records.find((record) => record.modulePath === module.path
      && record.role === 'source' && languages.includes(record.language));
    const lead = (level2.routeReferences || []).find((entry) => (entry.from === module.path || entry.to === module.path)
      && roles.get(entry.from) === 'runtime' && roles.get(entry.to) === 'runtime');
    const leadText = lead
      ? ` Route strings suggest ${lead.from} -> ${lead.to} over ${lead.shared} HTTP routes (${lead.routes.slice(0, 2).join(', ')}); confirm at the anchor.`
      : ' Confirm its boundary with the scanned code from build or binding configuration.';
    questions.push({
      kind: 'cross-language-boundary',
      subject: module.path,
      question: `${module.path} holds ${unscannedFiles} ${languages.join('/')} files the import scan cannot see.${leadText}`,
      anchors: (lead ? [`${lead.evidence[0].file}:${lead.evidence[0].line}`, buildFile?.path] : [buildFile?.path, sample?.path]).filter(Boolean).slice(0, 2),
      rank: unscannedFiles,
    });
  }
  return questions;
}

function entrypointQuestions(boundaries, level2, moduleOfFile) {
  const questions = [];
  const moduleByPath = new Map(level2.modules.map((module) => [module.path, module]));
  for (const entry of boundaries.entrypoints || []) {
    const files = (entry.files || []).map((file) => file.replace(/^\.\//, ''));
    const mapped = files.map((file) => moduleOfFile.get(file)).filter(Boolean);
    if (entry.kind === 'console-script' && files.length) continue;
    if (mapped.length) {
      const module = moduleByPath.get(mapped[0]);
      if (module && module.fanIn === 0 && level2.edges.length) {
        questions.push({
          kind: 'entrypoint-process',
          subject: entry.name,
          question: `Entrypoint ${entry.name} (${entry.kind}) starts ${mapped[0]}, which no scanned module imports; confirm whether it runs as a separate process or in-process.`,
          anchors: [entry.source, files[0]].filter(Boolean).slice(0, 2),
          rank: 3,
        });
      }
    } else if (entry.kind === 'console-script' || entry.kind === 'process') {
      questions.push({
        kind: 'entrypoint-process',
        subject: entry.name,
        question: `Entrypoint ${entry.name} (${entry.kind}) does not map onto a scanned module by file path; confirm its owning module and process boundary.`,
        anchors: [entry.source].filter(Boolean),
        rank: 2,
      });
    }
  }
  return questions;
}

function serviceQuestions(boundaries, level2) {
  const questions = [];
  const modulePaths = new Set(level2.modules.map((module) => module.path));
  for (const service of boundaries.services || []) {
    if (service.kind !== 'compose-service' || !service.build || service.build === '.') continue;
    const normalized = service.build.replace(/^\.\//, '').replace(/\/$/, '');
    const matched = modulePaths.has(normalized)
      || [...modulePaths].some((module) => module.startsWith(`${normalized}/`) || normalized.startsWith(`${module}/`));
    if (!matched) {
      questions.push({
        kind: 'service-module-unmapped',
        subject: service.name,
        question: `Compose service ${service.name} builds from ${service.build}, which matches no scanned module; confirm which code it deploys.`,
        anchors: [service.source].filter(Boolean),
        rank: 2,
      });
    }
  }
  return questions;
}

// Distribution names and import names often differ: flashinfer_python
// provides flashinfer, nvidia-cutlass-dsl provides cutlass. A declared
// distribution covers an import name when the import name is one of its
// underscore-separated tokens after -/_ folding.
function dependencyKey(name) {
  return name.split('.')[0].toLowerCase().replace(/-/g, '_');
}

function isDeclared(importName, declaredDependencies) {
  const key = dependencyKey(importName);
  if (declaredDependencies.has(key)) return true;
  for (const declared of declaredDependencies) {
    if (declared.split('_').includes(key)) return true;
  }
  return false;
}

function unknownImportQuestions(level2) {
  return (level2.unresolved.topUnknown || [])
    .filter((entry) => entry.count >= 5)
    .map((entry) => ({
      kind: 'unknown-import-hub',
      subject: entry.name,
      question: `${entry.count} import sites reference "${entry.name}" but no file resolves it; confirm whether it is vendored, generated, or a namespace package.`,
      anchors: [evidenceReference(entry.example)],
      rank: entry.count,
    }));
}

// Only meaningful when every dependency list was read in full: with a
// truncated manifest, "not declared" may just mean "past the fact cap".
function undeclaredImportQuestions(level2, declaredDependencies) {
  if (!declaredDependencies) return [];
  return (level2.unresolved.topExternal || [])
    .filter((entry) => entry.count >= 5 && !isDeclared(entry.name, declaredDependencies))
    .map((entry) => ({
      kind: 'undeclared-import',
      subject: entry.name,
      question: `${entry.count} import sites reference "${entry.name}", which no parsed manifest declares; confirm whether it is vendored, transitive, or missing.`,
      anchors: [evidenceReference(entry.example)],
      rank: entry.count,
    }));
}

function isolatedModuleQuestions(level2, roles) {
  return level2.modules
    .filter((module) => roles.get(module.path) === 'runtime')
    // Hidden directories (.github, .claude, ...) hold tooling, not runtime code.
    .filter((module) => !module.path.startsWith('.'))
    .filter((module) => module.scannedFiles >= 10 && module.fanIn === 0 && module.fanOut === 0)
    .map((module) => ({
      kind: 'isolated-module',
      subject: module.path,
      question: `${module.path} has ${module.scannedFiles} scanned files but no import edges in either direction; confirm whether it is loaded dynamically or out of scope.`,
      anchors: [module.entrypoints[0] || `${module.path}/`],
      rank: module.scannedFiles,
    }));
}

const QUESTION_PRIORITY = ['cross-language-boundary', 'entrypoint-process', 'service-module-unmapped', 'unknown-import-hub', 'isolated-module', 'undeclared-import'];
const KIND_CAP = { 'undeclared-import': 2 };

export function buildQuestions({ boundaries, level2, records, declaredDependencies }, limits, roles = classifyModules(level2)) {
  const moduleOfFile = new Map(records.map((record) => [record.path, record.modulePath]));
  const generated = [
    ...crossLanguageQuestions(level2, records, roles),
    ...entrypointQuestions(boundaries, level2, moduleOfFile),
    ...serviceQuestions(boundaries, level2),
    ...unknownImportQuestions(level2),
    ...isolatedModuleQuestions(level2, roles),
    ...undeclaredImportQuestions(level2, declaredDependencies),
  ];
  const byKind = new Map();
  const selected = [];
  const seen = new Set();
  for (const kind of QUESTION_PRIORITY) {
    const candidates = generated
      .filter((question) => question.kind === kind)
      .filter((question) => {
        const key = `${question.kind}\u0000${question.subject}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => right.rank - left.rank || left.subject.localeCompare(right.subject));
    for (const question of candidates) {
      const used = byKind.get(kind) || 0;
      const cap = Math.min(limits.maximumQuestionsPerKind, KIND_CAP[kind] ?? Infinity);
      if (used >= cap || selected.length >= limits.maximumQuestions) break;
      byKind.set(kind, used + 1);
      selected.push(question);
    }
  }
  return selected.map((question, index) => ({
    id: `q${index + 1}`,
    kind: question.kind,
    subject: question.subject,
    question: question.question,
    anchors: question.anchors.slice(0, 2),
  }));
}

// --- Pack assembly ----------------------------------------------------------

// Rank counts code the import scan cannot read: a Rust gateway has no
// scanned files and no import edges, and ranking on those alone pushed it out
// of the module list, leaving only a question about it.
function moduleWeight(module) {
  const unscanned = Object.values(module.unscannedLanguages || {}).reduce((total, count) => total + count, 0);
  return module.scannedFiles + unscanned + module.fanIn + module.fanOut;
}

// One existing file per module, taken from import evidence, so authors cite a
// real file instead of guessing a directory or an __init__.py.
function moduleSample(level2, module) {
  if (module.entrypoints.length) return null;
  for (const edge of level2.edges) {
    if (edge.from === module.path && edge.evidence[0]) return edge.evidence[0].file;
    if (edge.to === module.path && edge.evidence[0]?.to) return edge.evidence[0].to;
  }
  return null;
}

// HTTP route providers are pinned: a small server module (the one other
// runtimes call) lost to size ranking left every cross-language relationship
// pointing at a module the author could not see.
function packModules(level2, roles, maximum, pinned = new Set()) {
  const runtime = level2.modules.filter((module) => roles.get(module.path) === 'runtime');
  const ranked = [...runtime]
    .sort((left, right) => Number(pinned.has(right.path)) - Number(pinned.has(left.path))
      || moduleWeight(right) - moduleWeight(left)
      || left.path.localeCompare(right.path));
  const { items, omitted } = trimList(ranked, maximum);
  return {
    omitted,
    items: items.map((module) => ({
      path: module.path,
      files: module.files,
      ...(Object.keys(module.languages).length ? { languages: module.languages } : {}),
      ...(Object.keys(module.unscannedLanguages).length ? { unscannedLanguages: module.unscannedLanguages } : {}),
      fanIn: module.fanIn,
      fanOut: module.fanOut,
      ...(module.entrypoints.length ? { entrypoints: module.entrypoints } : {}),
      ...(moduleSample(level2, module) ? { sample: moduleSample(level2, module) } : {}),
    })),
  };
}

// Support modules are listed, not ranked: one line each, no edges, so they
// stay visible as context without competing for the component budget.
function packSupportModules(level2, roles, maximum) {
  const support = level2.modules
    .filter((module) => roles.get(module.path) !== 'runtime')
    .sort((left, right) => right.files - left.files || left.path.localeCompare(right.path));
  const { items, omitted } = trimList(support, maximum);
  return {
    omitted,
    items: items.map((module) => ({ path: module.path, role: roles.get(module.path), files: module.files })),
  };
}

// Edges are chosen spanning-tree first: a maximum-weight spanning forest over
// the shown modules is taken before the rest of the budget is filled by
// weight. Giving each module one edge is not enough: two modules can cover
// each other with a single edge and form an island while the heavy edges
// elsewhere take the budget. A spanning forest keeps the shown graph as
// connected as the import graph itself.
function selectEdges(level2, shownModules, maximumEdges, roles) {
  const shown = new Set(shownModules);
  const runtimeEdges = level2.edges.filter((edge) => roles.get(edge.from) === 'runtime' && roles.get(edge.to) === 'runtime');
  const internal = runtimeEdges.filter((edge) => shown.has(edge.from) && shown.has(edge.to));
  const external = runtimeEdges.filter((edge) => !(shown.has(edge.from) && shown.has(edge.to)));
  const parent = new Map(shownModules.map((module) => [module, module]));
  const find = (module) => {
    let current = module;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const chosen = new Set();
  for (const edge of internal) {
    if (chosen.size >= maximumEdges) break;
    const left = find(edge.from);
    const right = find(edge.to);
    if (left === right) continue;
    parent.set(left, right);
    chosen.add(edge);
  }
  // A shown module with no edge inside the shown set still keeps its heaviest
  // runtime edge, so no module reaches the author without a relationship.
  for (const module of shownModules) {
    if ([...chosen].some((edge) => edge.from === module || edge.to === module)) continue;
    const own = runtimeEdges.find((edge) => edge.from === module || edge.to === module);
    if (own) chosen.add(own);
  }
  for (const edge of [...internal, ...external]) {
    if (chosen.size >= maximumEdges) break;
    chosen.add(edge);
  }
  const order = new Map(level2.edges.map((edge, index) => [edge, index]));
  return {
    items: [...chosen].sort((left, right) => order.get(left) - order.get(right)),
    omitted: runtimeEdges.length - chosen.size,
    supportEdges: level2.edges.length - runtimeEdges.length,
  };
}

function packEdges(level2, shownModules, maximumEdges, maximumEvidence, roles) {
  const { items, omitted, supportEdges } = selectEdges(level2, shownModules, maximumEdges, roles);
  return {
    omitted,
    supportEdges,
    items: items.map((edge) => ({
      from: edge.from,
      to: edge.to,
      weight: edge.weight,
      ...(maximumEvidence > 0 ? { evidence: edge.evidence.slice(0, maximumEvidence).map(evidenceReference) } : {}),
    })),
  };
}

// Cross-language facts are handed to the diagram author as a compact table,
// not asserted as edges. Route references are string matches: the author
// judges whether a pair is a real client/server link, reading the one anchor
// when it matters. Only pairs the import graph does not already connect are
// listed, since the others add no information.
// Runtime channels are the links an import graph cannot show: process spawns,
// WebSocket servers and clients, HTTP servers and clients, worker threads.
// Only runtime modules are listed, the ones that open a process or socket
// first, so a spawn or server is never trimmed away before an HTTP call.
const CHANNEL_PRIORITY = ['process-spawn', 'websocket-server', 'http-server', 'websocket-client', 'http-client', 'worker-thread'];

function packRuntimeChannels(level2, roles, maximum) {
  // Round-robin across kinds so one noisy kind (every utility that shells
  // out) cannot take every slot from the server and client channels.
  const byKind = new Map(CHANNEL_PRIORITY.map((kind) => [kind, []]));
  for (const entry of level2.runtimeChannels || []) {
    if (roles.get(entry.module) === 'runtime') byKind.get(entry.kind)?.push(entry);
  }
  for (const list of byKind.values()) list.sort((left, right) => right.count - left.count || left.module.localeCompare(right.module));
  const channels = [];
  for (let round = 0; [...byKind.values()].some((list) => list.length > round); round += 1) {
    for (const list of byKind.values()) if (list[round]) channels.push(list[round]);
  }
  const { items, omitted } = trimList(channels, maximum);
  return {
    note: 'Call sites that open a process, socket or HTTP connection; draw the runtime link they create or leave it out only when its peer is outside the requested scope.',
    // The one-line excerpt stays in the detail graph; the pack keeps the anchor.
    items: items.map(({ module, kind, count, anchor }) => ({ module, kind, count, anchor })),
    omitted,
  };
}

function packCrossLanguage(level2, roles, maximumProviders, maximumReferences) {
  const runtime = (module) => roles.get(module) === 'runtime';
  const imported = new Set(level2.edges.flatMap((edge) => [`${edge.from}\u0000${edge.to}`, `${edge.to}\u0000${edge.from}`]));
  const providers = (level2.routeProviders || []).filter((entry) => runtime(entry.module));
  const references = (level2.routeReferences || [])
    .filter((entry) => runtime(entry.from) && runtime(entry.to) && !imported.has(`${entry.from}\u0000${entry.to}`));
  return {
    note: 'HTTP route strings matched to route declarations; a candidate link, not a confirmed call.',
    routeProviders: trimList(providers, maximumProviders).items,
    routeReferences: {
      items: trimList(references, maximumReferences).items.map((entry) => ({
        from: entry.from,
        to: entry.to,
        shared: entry.shared,
        specificity: entry.specificity,
        routes: entry.routes.slice(0, 3),
        anchor: `${entry.evidence[0].file}:${entry.evidence[0].line}`,
      })),
      omitted: Math.max(0, references.length - maximumReferences),
    },
  };
}

function packBoundaries(boundaries, maximumItems) {
  const packed = {};
  for (const [name, list] of Object.entries(boundaries)) {
    const { items, omitted } = trimList(list, maximumItems);
    packed[name] = { items, ...(omitted ? { omitted } : {}) };
  }
  return packed;
}

export function buildEvidencePack({ repositoryState, summary, records, boundaries: declaredBoundaries, level2, detailPath, declaredDependencies, root }, options = {}) {
  const limits = { ...PACK_DEFAULT_LIMITS, ...(options.limits || {}) };
  const boundaries = resolveScriptEntrypoints(declaredBoundaries, records);
  const declaredEntryFiles = (boundaries.entrypoints || []).flatMap((entry) => (entry.files || []).map((file) => file.replace(/^\.\//, '')));
  const roles = classifyModules(level2, declaredEntryFiles);
  const questions = buildQuestions({ boundaries, level2, records, declaredDependencies }, limits, roles);

  const state = {
    modules: limits.maximumModules,
    edges: limits.maximumEdges,
    edgeEvidence: limits.maximumEdgeEvidence,
    boundaryItems: limits.maximumBoundaryItems,
    questions: questions.length,
    references: 6,
    channels: limits.maximumRuntimeChannels,
    excerptLines: limits.maximumExcerptLines,
  };
  const trimmed = [];

  const assemble = () => {
    const crossLanguage = packCrossLanguage(level2, roles, 4, state.references);
    const pinned = new Set(crossLanguage.routeProviders.map((entry) => entry.module));
    const modules = packModules(level2, roles, state.modules, pinned);
    return {
    name: 'evidence-pack',
    schemaVersion: 1,
    repository: {
      head: repositoryState?.head || null,
      dirty: repositoryState?.dirty ?? null,
      files: summary.retainedFiles,
      languages: summary.languages,
    },
    coverage: {
      scannedFiles: level2.scannedFiles,
      candidateFiles: level2.candidateFiles,
      truncated: level2.truncated,
      unscanned: level2.unscanned,
      unresolved: {
        stdlib: level2.unresolved.stdlib,
        external: level2.unresolved.external,
        dynamic: level2.unresolved.dynamic,
        unknown: level2.unresolved.unknown,
      },
    },
    boundaries: packBoundaries(boundaries, state.boundaryItems),
    modules,
    supportModules: packSupportModules(level2, roles, state.modules),
    crossLanguage,
    runtimeChannels: packRuntimeChannels(level2, roles, state.channels),
    edges: packEdges(level2, modules.items.map((module) => module.path), state.edges, state.edgeEvidence, roles),
    questions: questions.slice(0, state.questions).map((question) => withExcerpts(question, root, state.excerptLines)),
    detail: detailPath ? { path: detailPath } : null,
    budget: { maximumBytes: limits.maximumBytes, bytes: 0, trimmed },
    };
  };

  // Facts survive trims longer than their supporting detail: edge evidence
  // goes first, then list tails, and questions are cut last.
  const shrinkSteps = [
    ['edge-evidence', () => { state.edgeEvidence = Math.max(0, state.edgeEvidence - 1); }],
    ['edges-40', () => { state.edges = Math.min(state.edges, 40); }],
    ['boundary-items-8', () => { state.boundaryItems = Math.min(state.boundaryItems, 8); }],
    ['edge-evidence', () => { state.edgeEvidence = 0; }],
    ['edges-24', () => { state.edges = Math.min(state.edges, 24); }],
    ['channels-10', () => { state.channels = Math.min(state.channels, 10); }],
    ['modules-16', () => { state.modules = Math.min(state.modules, 16); }],
    ['boundary-items-5', () => { state.boundaryItems = Math.min(state.boundaryItems, 5); }],
    ['excerpts-4', () => { state.excerptLines = Math.min(state.excerptLines, 4); }],
    ['channels-4', () => { state.channels = Math.min(state.channels, 4); }],
    ['questions-8', () => { state.questions = Math.min(state.questions, 8); }],
    ['references-3', () => { state.references = Math.min(state.references, 3); }],
    ['channels-0', () => { state.channels = 0; }],
    ['edges-12', () => { state.edges = Math.min(state.edges, 12); }],
    ['modules-10', () => { state.modules = Math.min(state.modules, 10); }],
    // Last resort: these steps guarantee the budget even for repositories
    // whose fixed sections are unusually large.
    ['references-0', () => { state.references = 0; }],
    ['excerpts-0', () => { state.excerptLines = 0; }],
    ['questions-4', () => { state.questions = Math.min(state.questions, 4); }],
    ['boundary-items-2', () => { state.boundaryItems = Math.min(state.boundaryItems, 2); }],
    ['edges-8', () => { state.edges = Math.min(state.edges, 8); }],
    ['modules-6', () => { state.modules = Math.min(state.modules, 6); }],
  ];

  let pack = assemble();
  let bytes = Buffer.byteLength(JSON.stringify(pack));
  for (const [label, apply] of shrinkSteps) {
    if (bytes <= limits.maximumBytes) break;
    apply();
    trimmed.push(label);
    pack = assemble();
    bytes = Buffer.byteLength(JSON.stringify(pack));
  }
  pack.budget.bytes = Buffer.byteLength(JSON.stringify(pack));
  pack.budget.bytes = Buffer.byteLength(JSON.stringify(pack));
  return pack;
}
