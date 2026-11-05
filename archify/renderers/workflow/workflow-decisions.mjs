// One visible string feeds layout, SVG, relationship details and receipts.
// Keep authored fields intact: repair candidates and migration recompile them.
export function workflowEdgeLabel(edge) {
  const condition = edge.condition?.value;
  if (condition === undefined) return edge.label;
  return !edge.label || edge.label === condition ? condition : `${condition} · ${edge.label}`;
}

// Called after schema validation. Free text is author intent, not a predicate
// language: neither the number of branches nor distinct strings prove coverage.
export function workflowDecisionDiagnostics(workflow) {
  const decisions = new Set(workflow.nodes.filter(node => node.decision === true).map(node => node.id));
  return workflow.edges.flatMap((edge, index) => {
    if (!decisions.has(edge.from) || edge.condition !== undefined) return [];
    const name = edge.id || `${edge.from}->${edge.to}`;
    return [{
      code: 'workflow/missing-branch-condition',
      severity: 'warning',
      message: `Decision "${edge.from}" has an outgoing edge "${name}" without an explicit condition.`,
      subject: { diagramType: 'workflow', edge: name, from: edge.from, to: edge.to, path: `/edges/${index}/condition` },
      evidence: { decision: true, ...(edge.label === undefined ? {} : { label: edge.label }) },
      supportedFixes: [`add condition.value to /edges/${index} describing when this branch is taken; label may retain its action or relationship text`],
    }];
  });
}
