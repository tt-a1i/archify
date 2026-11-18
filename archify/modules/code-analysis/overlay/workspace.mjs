import { isRepositoryRelativePath } from '../core/index.mjs';

const EXTRA_SOURCE_LIMIT = 128 * 1024;
const FILE_SOURCE_LIMIT = 32 * 1024;
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function buildWorkspace({ facts, graph, atlas, snippets }) {
  if (!facts || !atlas) return null;
  const owners = new Map(atlas.files.map(([file, module]) => [file, atlas.modules[module].id]));
  const parseErrors = new Set((facts.parse_errors || []).map(item => item.path));
  const excluded = new Set(graph.excluded?.roles || []);
  const captured = new Map(facts.files.filter(file => isRepositoryRelativePath(file.path)).map(file => [file.path, file]));
  const names = [...new Set([...captured.keys(), ...[...parseErrors].filter(isRepositoryRelativePath)])].sort(compareText);
  const files = names.map(name => {
    const file = captured.get(name);
    const module = owners.get(name) ?? null;
    const state = parseErrors.has(name) ? 'parse-error' :
      excluded.has(file?.role) ? 'excluded' : module ? 'analyzed' : 'unmapped';
    return [name, module, state];
  });
  const index = new Map(names.map((name, i) => [name, i]));
  const chart = files.map(() => 0);
  const imports = [];
  const seen = new Set();
  for (const record of facts.imports) {
    const from = index.get(record.from), to = index.get(record.to);
    if (from == null || files[from][2] !== 'analyzed') continue;
    if (!record.resolved || to == null || files[to][2] !== 'analyzed') {
      chart[from]++;
      continue;
    }
    if (!Number.isInteger(record.line) || record.line <= 0) continue;
    const key = [from, to, record.line].join(':');
    if (!seen.has(key)) {
      seen.add(key);
      imports.push([from, to, record.line]);
    }
  }
  imports.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);

  // Reuse source already embedded for findings/PRs. Additional offline text
  // is bounded, read only from the capture, and stored in that same dictionary.
  // Skip files the graph did not analyze. A missing preview never hides a
  // file, edge, or its recorded location.
  let budget = EXTRA_SOURCE_LIMIT;
  for (const [name, , state] of files) {
    if (state !== 'analyzed' || Object.hasOwn(snippets, name)) continue;
    const text = captured.get(name)?.sourceText;
    if (typeof text !== 'string') continue;
    // Account for serialization too (e.g. escaping in large generated strings).
    if (Buffer.byteLength(text) > FILE_SOURCE_LIMIT) continue;
    const lines = text.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    const entry = { total: lines.length, lines };
    const bytes = Buffer.byteLength(JSON.stringify([name, entry]));
    if (bytes > FILE_SOURCE_LIMIT || bytes > budget) continue;
    Object.defineProperty(snippets, name, { value: entry, enumerable: true });
    budget -= bytes;
  }
  return {
    files, imports, outsideTargets: chart,
    modules: graph.modules.map(({ id, label }) => [id, label]),
    scope: isRepositoryRelativePath(facts.repository?.root) ? facts.repository.root : '.',
    snapshot: /^[a-f0-9]{64}$/.test(facts.repository?.snapshotId || '') ? facts.repository.snapshotId : null,
    language: facts.repository?.language || null,
    revision: facts.repository?.sourceKind === 'git-tree' ? facts.repository.revision : null,
  };
}

// Also serialized into the offline page. Keep this function self-contained.
// The UI supplies canonical paths and evidence labels, never arbitrary body text.
export function formatWorkspaceContext({ target, capture, section, rows, available, anchors = [] }) {
  const encode = new TextEncoder();
  const tick = String.fromCharCode(96);
  const code = value => {
    const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ');
    if (text.length > 512) return code(text.slice(0, 511) + '…');
    const longest = (text.match(new RegExp(tick + '+', 'g')) || []).reduce((n, run) => Math.max(n, run.length), 0);
    if (longest > 8) return code(text.replace(new RegExp(tick + '{9,}', 'g'), '…'));
    const fence = tick.repeat(longest + 1);
    return fence + ' ' + text + ' ' + fence;
  };
  const lines = ['# Archify Map context', '', 'Focus (' + target.kind + '): ' + code(target.path),
    'Scope: ' + code(capture.scope), 'Language: ' + code(capture.language || 'unknown')];
  if (capture.pr) {
    lines.push('PR: ' + code(capture.pr), 'Merge-base: ' + code(capture.base), 'Head: ' + code(capture.head));
  } else if (capture.revision) {
    lines.push('Captured Git revision: ' + code(capture.revision));
  } else {
    lines.push('Captured working-tree snapshot: ' + code(capture.snapshot || 'unknown'));
  }
  if (target.state) {
    const { status, before, after } = target.state;
    lines.push('Captured status: ' + code(status) + (before ? ' · ' + code(before) + ' → ' + code(after) : ''));
  }
  if (capture.note) lines.push(capture.note);
  lines.push('', 'Read-only captured static evidence. Verify revision and current source before editing. Missing/omitted evidence is not absence. Runtime and transitive impact were not established.');
  const size = value => encode.encode(value).length;
  let remaining = 8 * 1024 - size(lines.join('\n')) - 256;
  const append = line => {
    const bytes = size(line) + 1;
    if (bytes > remaining) return false;
    lines.push(line);
    remaining -= bytes;
    return true;
  };
  if (anchors.length) {
    lines.push('', '## Source anchors (captured)');
    let used = 0;
    // Anchor the scope and both source sides before taking optional rows.
    // Reserve space for relationship rows even when source paths are long.
    for (const anchor of anchors.slice(0, 8)) {
      const line = '- ' + code(anchor);
      if (remaining < 1024 || !append(line)) break;
      used++;
    }
    lines.push('', 'Omitted source anchors: ' + (anchors.length - used) + '.');
  }
  lines.push('', '## ' + section);
  let entries = 0;
  for (const row of rows.slice(0, 12)) {
    if (!append('- ' + row.map(code).join(' · '))) break;
    entries++;
  }
  lines.push('', 'Omitted relationship/change records in this selection: ' + Math.max(0, available - entries) + '.');
  return lines.join('\n') + '\n';
}
