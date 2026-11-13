// Bounded static orientation shared by the headless receipt and reading view.
const MAX_HOTSPOTS = 5;
const MAX_STRONGEST_EDGES = 5;
const MAX_STRUCTURAL_SIGNALS = 5;

export function architectureBrief({ graph, findings, overview, findingWhere }) {
  const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const readingWeight = m => m.loc * (1 + Math.log2(1 + m.fanIn));
  const hotspots = [...(graph.modules || [])]
    .filter((m) => (m.fanIn + m.fanOut) > 0)
    .sort((a, b) => readingWeight(b) - readingWeight(a) || b.fanIn - a.fanIn || b.fanOut - a.fanOut || compareText(a.id, b.id))
    .slice(0, MAX_HOTSPOTS)
    .map((m) => ({
      id: m.id,
      path: m.path || null,
      files: m.files,
      loc: m.loc,
      fanIn: m.fanIn,
      fanOut: m.fanOut,
      instability: m.instability,
      entry: m.entry,
      readingWeight: Math.round(readingWeight(m) * 1000) / 1000,
    }));
  const strongestEdges = [...(graph.edges || [])]
    .sort((a, b) => b.weight - a.weight || compareText(a.from, b.from) || compareText(a.to, b.to))
    .slice(0, MAX_STRONGEST_EDGES)
    .map((e) => ({
      from: e.from,
      to: e.to,
      weight: e.weight,
      sample: e.evidence?.[0] ? `${e.evidence[0].file}:${e.evidence[0].line}` : null,
    }));
  const byId = new Map(findings.map((f) => [f.id, f]));
  const entryById = new Map(overview.findings.map((e) => [e.id, e]));
  const covered = new Set();
  for (const id of overview.priorities) {
    covered.add(id);
    for (const r of entryById.get(id)?.relatedIds || []) covered.add(r);
  }
  const candidates = overview.findings.filter((e) => {
    if (e.status === 'accepted' || covered.has(e.id)) return false;
    const d = byId.get(e.id);
    return Boolean(d && !d.external && (d.dimension === 'coupling' || d.dimension === 'architecture'));
  });
  const picked = [];
  const rulesTaken = new Set();
  const take = (e) => {
    picked.push(e);
    covered.add(e.id);
    for (const r of e.relatedIds || []) covered.add(r);
  };
  for (const e of candidates) {
    if (picked.length >= MAX_STRUCTURAL_SIGNALS) break;
    if (covered.has(e.id) || rulesTaken.has(e.code)) continue;
    rulesTaken.add(e.code);
    take(e);
  }
  for (const e of candidates) {
    if (picked.length >= MAX_STRUCTURAL_SIGNALS) break;
    if (!covered.has(e.id)) take(e);
  }
  return {
    modules: (graph.modules || []).length,
    edges: (graph.edges || []).length,
    hotspots,
    hotspotRanking: 'Connected modules ordered by loc * (1 + log2(1 + fanIn)), then fanIn, fanOut and id. A bounded reading order, not inferred business importance, defect severity or refactoring advice.',
    strongestEdges,
    structuralSignals: picked.map((e) => {
      const d = byId.get(e.id);
      return {
        id: e.id,
        code: d.code,
        severity: d.severity,
        message: d.message,
        where: findingWhere(d),
        impact: e.impact,
      };
    }),
  };
}
