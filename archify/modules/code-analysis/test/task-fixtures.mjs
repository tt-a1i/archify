// Builds the AI task fixtures from the py-tasks fixture repository:
//   findings.json, raw-facts.json            the analysis snapshot (one real run)
//   <rule>.task.json / .task.md              one captured task per finding kind
//   <rule>.task.<status>.json                the same task after an evidence check
//                                            against an edited copy of the source
// The fixture repository is copied to a temporary non-Git directory first, so
// the snapshot does not depend on the checkout's HEAD.
//   node test/task-fixtures.mjs                     write the fixtures
//   generateTaskFixtures()                          return them without writing (tests)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, evaluateGraph, extractFacts, loadConfig, stableJson } from '../lib/analysis.mjs';
import { buildTask, renderTaskMarkdown } from '../lib/task.mjs';
import { verifyTask } from '../lib/evidence.mjs';

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tasks');
export const SOURCE = path.join(HERE, '..', 'py-tasks');
export const CHECKED_AT = new Date('2026-10-17T00:00:00.000Z');
const KINDS = [
  ['complexity', 'complexity/function'],
  ['import-cycle', 'coupling/import-cycle'],
  ['module-cycle', 'coupling/cycle'],
  ['boundary', 'architecture/boundary'],
];

// Edits applied to a copy of the source to show each evidence status.
const EDITS = {
  // A comment added above the function: its lines move, their text does not.
  'complexity.task.valid.json': { kind: 'complexity', edit: (dir) => prepend(dir, 'app/engine.py', '# routing table lives in docs/routing.md\n') },
  // The cited import line itself changes.
  'import-cycle.task.changed.json': { kind: 'import-cycle', edit: (dir) => replace(dir, 'app/b.py', 'from app.a import DEFAULT_TIMEOUT', 'from app.a import DEFAULT_TIMEOUT  # noqa') },
  // The importing file was deleted.
  'boundary.task.missing.json': { kind: 'boundary', edit: (dir) => fs.rmSync(path.join(dir, 'domain/order.py')) },
};

export function copySource() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-task-fixture-'));
  fs.cpSync(SOURCE, dir, { recursive: true, filter: (src) => !src.includes('__pycache__') });
  return dir;
}

export function analyzeFixture(dir) {
  const config = loadConfig(path.join(SOURCE, 'analysis.config.json'));
  const { facts } = extractFacts(dir, { language: 'py', config });
  const graph = buildGraph(facts, config);
  const findings = evaluateGraph(graph, config, facts);
  return { facts, graph, findings, config };
}

export function generateTaskFixtures() {
  const dir = copySource();
  try {
    const { facts, findings } = analyzeFixture(dir);
    const files = { 'raw-facts.json': stableJson(facts), 'findings.json': stableJson(findings) };
    const tasks = {};
    for (const [name, code] of KINDS) {
      const finding = findings.diagnostics.find((d) => d.code === code);
      if (!finding) throw new Error(`fixture produced no ${code} finding`);
      const task = buildTask({ findings, facts, ids: [finding.id] });
      tasks[name] = task;
      files[`${name}.task.json`] = stableJson(task);
      files[`${name}.task.md`] = renderTaskMarkdown(task);
    }
    for (const [file, { kind, edit }] of Object.entries(EDITS)) {
      const copy = copySource();
      try { edit(copy); files[file] = stableJson(verifyTask(tasks[kind], copy, { now: CHECKED_AT })); } finally { fs.rmSync(copy, { recursive: true, force: true }); }
    }
    return files;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function prepend(dir, rel, text) { const f = path.join(dir, rel); fs.writeFileSync(f, text + fs.readFileSync(f, 'utf8')); }
function replace(dir, rel, from, to) { const f = path.join(dir, rel); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(from, to)); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, text] of Object.entries(generateTaskFixtures())) fs.writeFileSync(path.join(HERE, name), text);
  console.log(`wrote task fixtures to ${path.relative(process.cwd(), HERE)}`);
}
