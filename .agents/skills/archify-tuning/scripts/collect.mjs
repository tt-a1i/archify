#!/usr/bin/env node
// Usage: node collect.mjs <round-name-or-path> [--round <name>] [--no-bench] [--dump] [--trace-export <file>]
//
// Reads Devin CLI session history for subagents whose task pointed at
// <round>/<type>, then reports per type: tool calls, finalize runs and
// failures, diagnostic codes, whether the first draft was fully automatic and
// the elements and relationships the final candidate dropped from it. Each
// first draft is kept as <round>/<type>/first-draft.json and added to the
// benchmark (repository evidence stripped) unless --no-bench.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIAGRAM_TYPES, authoredControls, benchmarkDocument, contentLost, finalizeStatus, tuningHome } from './lib.mjs';

const args = process.argv.slice(2);
const valueOptions = new Set(['--round', '--trace-export']);
const booleanOptions = new Set(['--dump', '--no-bench']);
const values = new Map();
const positional = [];
let invalidArgs = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (valueOptions.has(arg)) {
    const value = args[++index];
    if (!value || value.startsWith('--')) invalidArgs = true;
    else values.set(arg, value);
  } else if (booleanOptions.has(arg)) {
    // Boolean options never consume the following round path.
  } else if (arg.startsWith('--')) invalidArgs = true;
  else positional.push(arg);
}
const option = (name, fallback) => values.has(name) ? values.get(name) : fallback;
const target = !invalidArgs && positional.length === 1 ? positional[0] : '';
const root = fs.existsSync(path.resolve(target)) ? path.resolve(target) : path.join(tuningHome(), 'rounds', target);
if (!target || !fs.existsSync(root)) {
  console.error('Usage: node collect.mjs <round-name-or-path> [--round <name>] [--no-bench] [--dump] [--trace-export <file>]');
  process.exit(2);
}
const recorded = fs.existsSync(path.join(root, 'round.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'round.json'), 'utf8')) : {};
const round = option('--round', recorded.name || path.basename(root));
const bench = path.join(tuningHome(), 'bench');
const database = path.join(os.homedir(), '.local/share/devin/cli/sessions.db');
let db;
const traceExport = option('--trace-export');
if (!traceExport) {
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(database, { readOnly: true });
}

const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value ?? ''));
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Task text may name the macOS /private alias or the plain /tmp path.
const logicalPath = (value) => value.replace(/\\/g, '/');
const roots = [...new Set([root, root.replace(/^\/private\//, '/'), root.replace(/^\/tmp\//, '/private/tmp/')].map(logicalPath))];
const taskMatches = (type, content) => new RegExp(`(?:${roots.map(escape).join('|')})/${type}(?![\\w-])`).test(logicalPath(content));
const CODE = /\b((?:layout|composition|clean-flow|workflow|sequence|dataflow|lifecycle|erd|class|tree|timeline|waterfall|architecture|repository-evidence|schema|viewer|delivery)\/[a-z0-9]+(?:-[a-z0-9]+)*)\b/g;

function devinChainsByType() {
  // Serialized JSON doubles native backslashes; cover native and POSIX spellings.
  const serializedRoots = [...new Set(roots.flatMap((candidate) => [
    JSON.stringify(`${candidate}/`).slice(1, -1),
    JSON.stringify(`${candidate.replace(/\//g, '\\')}\\`).slice(1, -1),
  ]))];
  const like = serializedRoots.map(() => 'chat_message like ?').join(' or ');
  const hits = db.prepare(`select session_id, min(node_id) as first from message_nodes where ${like} group by session_id`)
    .all(...serializedRoots.map((candidate) => `%${candidate}%`));
  const best = new Map();
  for (const { session_id: session, first } of hits) {
    const rows = db.prepare('select node_id, parent_node_id, chat_message from message_nodes where session_id = ? and node_id >= ?').all(session, first);
    const nodes = new Map(rows.map((row) => [row.node_id, { ...row, message: JSON.parse(row.chat_message) }]));
    const parents = new Set(rows.map((row) => row.parent_node_id));
    for (const node of nodes.values()) {
      if (parents.has(node.node_id)) continue;
      const chain = [];
      for (let current = node; current; current = nodes.get(current.parent_node_id)) chain.unshift(current);
      for (const type of DIAGRAM_TYPES) {
        const start = chain.findIndex(({ message }) => message.role === 'user' && typeof message.content === 'string' && taskMatches(type, message.content));
        if (start === -1) continue;
        const own = chain.slice(start);
        if (!best.has(type) || best.get(type).length < own.length) best.set(type, own);
      }
    }
  }
  return best;
}

// Agent-neutral chronological messages. Host exporters normalize tool names and
// arguments to read(file_path), write(file_path, content), exec(command).
function exportedChainsByType(file) {
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (exported.schemaVersion !== 1 || !Array.isArray(exported.sessions)) throw new Error('Trace export requires schemaVersion: 1 and sessions[]');
  const best = new Map();
  for (const session of exported.sessions) {
    if (typeof session.id !== 'string' || !Array.isArray(session.messages)) throw new Error('Trace session requires id and messages[]');
    const callIds = new Set();
    const resultIds = new Set();
    for (const message of session.messages) {
      if (!['user', 'assistant', 'tool'].includes(message.role) || typeof message.content !== 'string') throw new Error('Trace messages require a supported role and string content');
      if (message.role === 'tool') {
        if (typeof message.tool_call_id !== 'string' || !callIds.has(message.tool_call_id) || resultIds.has(message.tool_call_id)) throw new Error('Trace tool result must reference one earlier tool call');
        resultIds.add(message.tool_call_id);
      }
      if (message.tool_calls !== undefined && (message.role !== 'assistant' || !Array.isArray(message.tool_calls))) throw new Error('Trace tool_calls must be an assistant array');
      for (const call of message.tool_calls || []) {
        if (typeof call.id !== 'string' || !call.id || callIds.has(call.id) || typeof call.name !== 'string' || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) throw new Error('Invalid trace tool call');
        if (['read', 'write'].includes(call.name) && typeof call.arguments.file_path !== 'string') throw new Error('Trace read/write requires file_path');
        if (call.name === 'write' && typeof call.arguments.content !== 'string') throw new Error('Trace write requires content');
        if (call.name === 'exec' && typeof call.arguments.command !== 'string') throw new Error('Trace exec requires command');
        callIds.add(call.id);
      }
    }
    for (const type of DIAGRAM_TYPES) {
      const start = session.messages.findIndex((message) => message.role === 'user' && taskMatches(type, message.content));
      if (start === -1) continue;
      const own = session.messages.slice(start).map((message) => ({ message }));
      if (!best.has(type) || best.get(type).length < own.length) best.set(type, own);
    }
  }
  return best;
}

// Recognize the positional finalize invocation, with ordinary single/double
// quoted paths. This is trace classification, not shell parsing or execution.
function isFinalizeCommand(type, command) {
  const tokens = (command.match(/"[^"]*"|'[^']*'|[^\s]+/g) || []).map((token) => {
    const quote = token[0];
    return (quote === '"' || quote === "'") && token.at(-1) === quote ? token.slice(1, -1) : token;
  });
  return tokens.some((token, index) => /(?:^|\/)archify\.mjs$/.test(logicalPath(token))
    && tokens[index + 1] === 'finalize' && tokens[index + 2] === type
    && /\.json$/.test(tokens[index + 3] || ''));
}

function latestCandidate(type) {
  const folder = path.join(root, type, '.archify');
  if (!fs.existsSync(folder)) return null;
  const files = fs.readdirSync(folder)
    .map((entry) => path.join(folder, entry, 'candidate.json'))
    .filter((file) => fs.existsSync(file))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return files[0] ? JSON.parse(fs.readFileSync(files[0], 'utf8')) : null;
}

const summary = {};
const index = fs.existsSync(path.join(bench, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(bench, 'index.json'), 'utf8')) : {};
let chains;
try { chains = traceExport ? exportedChainsByType(traceExport) : devinChainsByType(); }
catch (error) { console.error(`Cannot collect traces: ${error.message}`); process.exit(2); }
if (!chains.size) { console.error('No trace sessions matched the round/type paths; no evidence was collected.'); process.exit(2); }
for (const [type, chain] of [...chains].sort(([a], [b]) => DIAGRAM_TYPES.indexOf(a) - DIAGRAM_TYPES.indexOf(b))) {
  const results = new Map();
  for (const { message } of chain) if (message.role === 'tool') results.set(message.tool_call_id, text(message.content));
  const stats = { tools: 0, reads: 0, docReads: [], finalize: [], firstDraft: null, dump: [] };
  for (const { message } of chain) {
    if (message.role === 'assistant' && message.content) stats.dump.push(`ASSISTANT: ${text(message.content).slice(0, 2000)}`);
    for (const call of message.tool_calls || []) {
      stats.tools += 1;
      const input = call.arguments || {};
      const result = results.get(call.id) || '';
      stats.dump.push(`CALL ${call.name}: ${text(input).slice(0, 3000)}\nRESULT: ${result.slice(0, 4000)}`);
      if (call.name === 'read') {
        stats.reads += 1;
        const file = logicalPath(input.file_path || '');
        if (/\/archify\/.*\.md$/.test(file)) stats.docReads.push(file.replace(/^.*\/archify\//, ''));
      }
      if (call.name === 'write' && !stats.firstDraft && /candidate[^/]*\.json$/.test(logicalPath(input.file_path || ''))) {
        try { stats.firstDraft = JSON.parse(input.content); } catch { /* not JSON yet */ }
      }
      if (call.name === 'exec' && isFinalizeCommand(type, input.command || '')) {
        stats.finalize.push({ status: finalizeStatus(result), codes: [...new Set([...result.matchAll(CODE)].map((match) => match[1]))] });
      }
    }
  }
  const final = latestCandidate(type);
  const lost = contentLost(type, stats.firstDraft, final);
  summary[type] = {
    tools: stats.tools,
    reads: stats.reads,
    finalizeRuns: stats.finalize.length,
    finalizeFailures: stats.finalize.filter(({ status }) => status === 'fail').length,
    finalizeUnknown: stats.finalize.filter(({ status }) => status === 'unknown').length,
    firstFinalize: stats.finalize[0]?.status ?? 'not-run',
    codes: [...new Set(stats.finalize.flatMap(({ codes }) => codes))],
    controls: stats.firstDraft ? authoredControls(type, stats.firstDraft) : null,
    routingMode: !stats.firstDraft ? 'unknown' : Object.keys(authoredControls(type, stats.firstDraft)).length ? 'authored-routes' : 'automatic-routes',
    lost,
    docReads: stats.docReads,
  };
  if (args.includes('--dump')) fs.writeFileSync(path.join(root, `${type}.trace.txt`), stats.dump.join('\n\n'));
  if (stats.firstDraft) fs.writeFileSync(path.join(root, type, 'first-draft.json'), `${JSON.stringify(stats.firstDraft, null, 2)}\n`);
  if (stats.firstDraft && !args.includes('--no-bench')) {
    fs.mkdirSync(path.join(bench, type), { recursive: true });
    fs.writeFileSync(path.join(bench, type, `${round}.json`), `${JSON.stringify(benchmarkDocument(stats.firstDraft, round), null, 2)}\n`);
    index[`${type}/${round}`] = {
      round: root,
      project: stats.firstDraft.meta?.repository?.url ?? null,
      revision: stats.firstDraft.meta?.repository?.revision ?? null,
      firstFinalize: summary[type].firstFinalize,
    };
  }
}
if (!args.includes('--no-bench') && Object.keys(index).length) {
  fs.mkdirSync(bench, { recursive: true });
  fs.writeFileSync(path.join(bench, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
}
db?.close();
fs.writeFileSync(path.join(root, 'tuning-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const pad = (value, width) => String(value).padEnd(width);
console.log(`${pad('type', 13)}${pad('tools', 7)}${pad('finalize', 10)}${pad('failed', 8)}${pad('first', 9)}${pad('routes', 18)}lost (elements/relations/containers/membership)  codes`);
for (const [type, entry] of Object.entries(summary)) {
  const lost = entry.lost ? `${entry.lost.elements.length}/${entry.lost.relations.length}/${entry.lost.containers.length}/${entry.lost.membershipChanges.length}` : 'n/a';
  const failed = `${entry.finalizeFailures}${entry.finalizeUnknown ? `+${entry.finalizeUnknown}?` : ''}`;
  const draft = entry.routingMode;
  console.log(`${pad(type, 13)}${pad(entry.tools, 7)}${pad(entry.finalizeRuns, 10)}${pad(failed, 8)}${pad(entry.firstFinalize, 9)}${pad(draft, 18)}${pad(lost, 46)}${entry.codes.join(',')}`);
}
const entries = Object.values(summary);
console.log(`TOTAL tools ${entries.reduce((sum, entry) => sum + entry.tools, 0)}, finalize ${entries.reduce((sum, entry) => sum + entry.finalizeRuns, 0)}, failed ${entries.reduce((sum, entry) => sum + entry.finalizeFailures, 0)}, first-run passes ${entries.filter((entry) => entry.firstFinalize === 'pass').length}/${entries.length}`);
if (!args.includes('--no-bench')) console.log(`benchmark: ${bench}`);
