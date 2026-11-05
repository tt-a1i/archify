import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseSource } from './adapters.mjs';
import { evaluateSemantics } from './metrics.mjs';
import { observeArtifact } from './browser.mjs';
import { evaluateRun } from './records.mjs';
import { metrics, humanRubric } from './registry.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hashFile = file => sha256(fs.readFileSync(file));
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function save(file, value) { fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
export function evaluatorHash() {
  return sha256(['adapters.mjs', 'metrics.mjs', 'browser.mjs', 'records.mjs', 'registry.mjs', 'scoring.mjs', 'comparison.mjs', 'verification.mjs', 'benchmark.mjs'].map(f => `${f}\n${fs.readFileSync(path.join(here, f), 'utf8')}`).join('\n'));
}
export function checkCorpus(corpus) {
 requireValue(corpus.schemaVersion===2&&Array.isArray(corpus.tasks)&&corpus.tasks.length>0,'Expected a v2 corpus with tasks');
 const ids=new Set();
 for(const task of corpus.tasks){
  requireValue(typeof task.id==='string'&&task.id&&!ids.has(task.id),'Missing/duplicate task id');ids.add(task.id);
  requireValue(typeof task.prompt==='string'&&task.prompt.length>0,'Missing task prompt');
  requireValue(['architecture','workflow','sequence','dataflow','lifecycle'].includes(task.type),'Unsupported native task type');
  requireValue(['small','medium','large'].includes(task.complexity),'Invalid task complexity');
  requireValue(Array.isArray(task.expected?.nodes)&&Array.isArray(task.expected?.edges),'Missing expected facts');
  const nodes=new Set(task.expected.nodes.map(n=>n.id??n.key));
  requireValue(nodes.size===task.expected.nodes.length&&task.expected.nodes.every(n=>(n.id??n.key)&&n.label),'Missing/duplicate expected node');
  requireValue(task.expected.edges.every(e=>nodes.has(e.from)&&nodes.has(e.to)),'Unbound expected relation');
 }
 return {schemaVersion:2,taskCount:corpus.tasks.length,publicPilot:corpus.publicPilot===true,calibrated:corpus.profile?.calibrated===true,metrics,humanRubric};
}

// This probe operates on a throw-away copy; source declarations of editability are ignored.
export async function probeEditability({ source, format, type, chromePath }) {
  const unknown = reason => ({ status: 'unverified', passed: false, method: null, unknownReasons: [reason] });
  if (format !== 'archify') return unknown('Independent reload/edit/render probe not yet implemented for ' + format);
  const data = JSON.parse(source), graph = parseSource(format, source, { type });
  if (graph.status !== 'verified') return unknown('Source semantics not fully supported for editing probe');
  const collection = { architecture: 'components', workflow: 'nodes', sequence: 'participants', dataflow: 'nodes', lifecycle: 'states' }[type || data.diagram_type];
  if (!collection || !data[collection]?.length) return unknown('No supported editable native collection');
  const copy = structuredClone(data), changed = copy[collection][0];
  const oldLabel = changed.label ?? changed.name;
  if (typeof oldLabel !== 'string') return unknown('No editable label');
  const sentinel = oldLabel + ' EDIT';
  changed[changed.label !== undefined ? 'label' : 'name'] = sentinel;
  const expected = structuredClone(graph); expected.nodes.find(n => n.id === changed.id).label = sentinel;
  const edited = parseSource(format, JSON.stringify(copy), { type });
  const facts = g => JSON.stringify({ nodes: g.nodes.map(n => [n.id, n.label]), edges: g.edges.map(e => [e.from, e.to, e.label]) });
  requireValue(facts(expected) === facts(edited), 'Editing unexpectedly changed native topology');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-quality-edit-'));
  try {
    const artifact = path.join(temp, 'edited.html'), input = path.join(temp, 'source.json');
    copy.meta = { ...copy.meta, output: 'edited.html' };
    fs.writeFileSync(input, JSON.stringify(copy));
    const render = spawnSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), 'render', type || data.diagram_type, input, artifact], { cwd: temp, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
    if (render.status !== 0 || !fs.existsSync(artifact)) return { status: 'verified', passed: false, method: 'archify-reload-rename-render', unknownReasons: ['Edited source did not render'] };
    const observation = await observeArtifact({ artifactPath: artifact, graph: edited, chromePath });
    const preserved = evaluateSemantics({ nodes: edited.nodes.map(({ id, label }) => ({ id, label })), edges: edited.edges.map(({ from, to, label }) => ({ from, to, label })) }, edited, observation);
    return { status: preserved.status, passed: preserved.status === 'verified' && preserved.passed, method: 'archify-reload-rename-render', editedNode: changed.id, unknownReasons: observation.unknownReasons };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

export async function verifyFiles(options) {
  const corpusFile = path.resolve(options.manifest || path.join(here, 'corpus.json'));
  const corpus = read(corpusFile); checkCorpus(corpus);
  const task = corpus.tasks.find(t => t.id === options.task);
  requireValue(task, 'Task not present in corpus');
  const source = fs.readFileSync(options.source, 'utf8'), artifactHash = hashFile(options.artifact);
  const graph = parseSource(options.format, source, { type: options.type || task.type });
  const raw = read(options.run);
  const identity = { manifestHash: hashFile(corpusFile), evaluatorHash: evaluatorHash(), profileHash: sha256(JSON.stringify(corpus.profile)), budget: raw.identity?.budget || corpus.budget || {} };
  for (const field of ['manifestHash', 'evaluatorHash', 'profileHash']) if (raw.identity?.[field]) requireValue(raw.identity[field] === identity[field], 'Run ' + field + ' differs from current evaluator inputs');
  requireValue(!raw.artifactHash || raw.artifactHash === artifactHash, 'Artifact digest mismatch');
  requireValue(!raw.sourceHash || raw.sourceHash === sha256(source), 'Source digest mismatch');
  const run = { ...raw, identity, artifactHash, sourceHash: sha256(source) };
  // Imported receipts are untrusted. All earlier candidates remain unknown until independently re-evaluated.
  run.candidates = (raw.candidates || []).map(({ verifiedReceipt, ...candidate }) => candidate);
  requireValue(run.candidates.at(-1)?.artifactHash === artifactHash, 'Final candidate must reference actual artifact digest');
  const start = performance.now();
  const observation = options.observation ? { ...read(options.observation), status: 'unverified', method: 'external-unattested', unknownReasons: ['Imported observations cannot establish independent verification'] } : await observeArtifact({ artifactPath: options.artifact, graph, chromePath: options.chrome, screenshotPath: options.screenshot });
  const editability = await probeEditability({ source, format: options.format, type: options.type || task.type, chromePath: options.chrome });
  const receipt = evaluateRun({ task, run, graph, observation, profile: corpus.profile, editability });
  receipt.grader = { durationMs: Math.round(performance.now() - start), method: observation.method, browserProfileCleaned: observation.browserProfile ? !fs.existsSync(observation.browserProfile) : null };
  receipt.observation = observation;
  if (options.output) save(options.output, receipt);
  return receipt;
}
