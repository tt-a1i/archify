import fs from 'node:fs';
const [refFile, root, ...factsFiles] = process.argv.slice(2);
const refs = fs.readFileSync(refFile, 'utf8').trim().split('\n').filter(Boolean).map(l => {
  const m = l.match(/^(.*):(\d+):(\d+)-(\d+)$/); if (!m) return null;
  return { file: m[1].slice(root.length + 1), line: +m[2], column: +m[3] };
}).filter(Boolean);
const facts = factsFiles.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
const names = new Set();
for (const f of facts) for (const c of f.calls) if (c.target) names.add(c.target.name);
const targetName = names.size === 1 ? [...names][0] : null;
const results = facts.map(f => {
  const byLine = new Map();
  for (const c of f.calls) { const k = c.file + ':' + c.line; if (!byLine.has(k)) byLine.set(k, []); byLine.get(k).push(c); }
  const stats = { refs: refs.length, correct: 0, wrong: 0, missed: 0, unknown: 0, byResolution: {}, wrongTargets: [], missedAt: [] };
  for (const r of refs) {
    const calls = byLine.get(r.file + ':' + r.line) || [];
    const call = calls.filter(c => c.column <= r.column && r.column <= c.endColumn).sort((a, b) => (a.endColumn - a.column) - (b.endColumn - b.column))[0] || calls[0];
    if (!call) { stats.unknown++; continue; }
    const res = call.resolution; stats.byResolution[res] = (stats.byResolution[res] || 0) + 1;
    const t = call.target;
    if (t && (!targetName || t.name === targetName)) stats.correct++;
    else if (t) { stats.wrong++; stats.wrongTargets.push({ at: r.file + ':' + r.line, target: t }); }
    else { stats.missed++; stats.missedAt.push(r.file + ':' + r.line + ' ' + (call.reason || '')); }
  }
  return { model: f.callModel, revision: f.repository.adapterRevision, ...stats };
});
console.log(JSON.stringify({ refFile: refFile.split('/').pop(), targetName, results }, null, 2));
