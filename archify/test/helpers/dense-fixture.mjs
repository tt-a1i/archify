// Two columns with every left node connected to every right node: all edges
// span the empty middle channel, so the diagram stays valid while the dense
// label/route field pushes the checker receipt past spawnSync's 1 MiB default
// (and past multi-MiB capture floors for near-limit tests).
export function bipartiteArchitectureSpec(nodeCount) {
  const step = nodeCount <= 11 ? 56 : 50;
  const nodeHeight = step - 14;
  const components = [];
  for (let i = 0; i < nodeCount; i += 1) {
    const y = 40 + i * step;
    components.push({ id: `l${i}`, type: 'backend', label: `Source ${i}`, sublabel: 'left', pos: [60, y], size: [150, nodeHeight] });
    components.push({ id: `r${i}`, type: 'database', label: `Target ${i}`, sublabel: 'right', pos: [950, y], size: [150, nodeHeight] });
  }
  const connections = [];
  for (let i = 0; i < nodeCount; i += 1) {
    for (let j = 0; j < nodeCount; j += 1) {
      connections.push({
        id: `l${i}-r${j}`,
        from: `l${i}`,
        to: `r${j}`,
        fromSide: 'right',
        toSide: 'left',
        label: `f${i}t${j}`,
      });
    }
  }
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Dense receipt fixture',
      output: 'dense.html',
      quality_profile: 'standard',
    },
    components,
    connections,
    cards: [{ dot: 'cyan', title: 'Dense', items: ['Complete bipartite connection set'] }],
  };
}
