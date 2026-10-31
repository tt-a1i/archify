import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { project, toExplainer, sha256 } from './project.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.resolve(process.argv[2] ?? path.join(here, 'output'));
const mappingBytes = fs.readFileSync(path.join(here, 'input/mapping.json'));
const sidecar = JSON.parse(fs.readFileSync(path.join(here, 'flows.json'), 'utf8'));
const projection = project(mappingBytes, sidecar);
const spec = toExplainer(mappingBytes, sidecar);
// A fresh directory preserves every prior draft and its exact browser evidence.
fs.mkdirSync(out);
const write = (file, data) => fs.writeFileSync(path.join(out, file), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
write('flows.json', fs.readFileSync(path.join(here, 'flows.json'), 'utf8'));
write('projection.json', projection);
write('explainer.json', spec);
const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-task-flow-tests-'));
const startedAt = new Date().toISOString();
const args = [path.join(root, 'archify/bin/archify.mjs'), 'finalize', 'explainer', path.join(out, 'explainer.json'), path.join(out, 'review.html'), '--repo-root', root, '--json', '--receipt', path.join(raw, 'finalize.json')];
const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
fs.writeFileSync(path.join(raw, 'stdout.json'), run.stdout ?? '');
fs.writeFileSync(path.join(raw, 'stderr.txt'), run.stderr ?? '');
let result;
try { result = JSON.parse(run.stdout); } catch { result = { status: 'unparsed' }; }
const delivery = path.join(out, 'review.delivery.json');
if (fs.existsSync(delivery)) fs.copyFileSync(delivery, path.join(raw, 'delivery.json'), fs.constants.COPYFILE_EXCL);
const files = ['flows.json', 'explainer.json', 'projection.json', 'review.html'].filter(name => fs.existsSync(path.join(out, name))).map(name => ({ path: name, sha256: sha256(fs.readFileSync(path.join(out, name))) }));
// Raw receipts may contain local paths; publish only portable stage facts.
const safe = value => typeof value === 'string' ? value.split(root).join('<checkout>').split(out).join('<output>').split(raw).join('<private-receipts>') : value;
write('build-evidence.json', { version: 1, startedAt, endedAt: new Date().toISOString(), node: process.version,
  productBase: 'e837dc4cb83042d2b6c596e039692e25ec62c2da', exitCode: run.status, signal: run.signal,
  error: run.error ? safe(run.error.message) : null, kind: 'portable-stage-summary-not-original-receipt',
  result: JSON.parse(JSON.stringify(result, (_key, value) => safe(value))), files,
  execution: 'Only projector tests and Archify tooling may run. Historical code/tests and task-view are not executed.' });
console.log(JSON.stringify({ output: out, exitCode: run.status, privateReceipts: raw }));
if (run.status !== 0) process.exitCode = 1;
