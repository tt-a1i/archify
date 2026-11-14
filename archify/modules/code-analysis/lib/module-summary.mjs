// Bounded source/path observations for a module-level finding. Membership is
// the complete finding digest, not a second grouping guess or inferred role.
const LIMIT = 8;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const bounded = items => ({ total: items.length, shown: Math.min(LIMIT, items.length), truncated: Math.max(0, items.length - LIMIT), items: items.slice(0, LIMIT) });

export function summarizeModule(finding, facts, analysis) {
  if (finding.external || finding.code !== 'coupling/concentration' || !finding.subject?.module || finding.subject.file
    || !finding.evidenceDigest?.files?.length) return null;
  const members = new Set(finding.evidenceDigest.files);
  const excluded = new Set(analysis?.coverage?.excludedRoles || []);
  const captured = facts.files.filter(file => members.has(file.path));
  const eligible = new Set(facts.files.filter(file => !excluded.has(file.role)).map(file => file.path));
  const files = captured.map(file => ({ file: file.path, loc: file.loc }));
  let common = files[0]?.file.split('/').slice(0, -1) || [];
  for (const file of files) {
    const parts = file.file.split('/').slice(0, -1);
    let same = 0;
    while (same < common.length && common[same] === parts[same]) same++;
    common = common.slice(0, same);
  }
  const prefix = common.length ? common.join('/') + '/' : '';
  const incoming = new Map();
  for (const edge of facts.imports) {
    if (!edge.resolved || !members.has(edge.to) || members.has(edge.from) || !eligible.has(edge.from)) continue;
    if (!incoming.has(edge.to)) incoming.set(edge.to, new Set());
    incoming.get(edge.to).add(edge.from);
  }
  const clusters = new Map();
  for (const file of files) {
    const rel = file.file.slice(prefix.length);
    const slash = rel.indexOf('/');
    const dash = rel.indexOf('-');
    const name = slash >= 0 ? rel.slice(0, slash) + '/' : dash > 0 ? rel.slice(0, dash) + '-*' : '(root files)';
    if (!clusters.has(name)) clusters.set(name, { pathGroup: name, files: 0, loc: 0 });
    const group = clusters.get(name); group.files++; group.loc += file.loc;
  }
  const loc = files.reduce((n, file) => n + file.loc, 0);
  const totalLoc = finding.evidence?.size?.totalLoc ?? (analysis?.coverage?.excludedRoles
    ? facts.files.filter(file => eligible.has(file.path)).reduce((n, file) => n + file.loc, 0) : null);
  return {
    findingId: finding.id, module: finding.subject.module, path: common.join('/'),
    files: members.size, capturedFiles: files.length, loc,
    totalLoc, share: totalLoc > 0 ? Math.round(loc / totalLoc * 10000) / 10000 : null,
    largestFiles: bounded(files.sort((a, b) => b.loc - a.loc || compare(a.file, b.file))),
    entryFiles: bounded([...incoming].map(([file, from]) => ({ file, importers: from.size }))
      .sort((a, b) => b.importers - a.importers || compare(a.file, b.file))),
    clusters: bounded([...clusters.values()].sort((a, b) => b.loc - a.loc || compare(a.pathGroup, b.pathGroup))),
    basis: 'Captured file lengths and resolved static import edges. Entry counts are distinct importing files outside this digest membership, excluding graph-excluded roles. Clusters use directory/name prefixes, not inferred business responsibilities. Full membership and freshness checks remain in evidenceDigest.',
  };
}
