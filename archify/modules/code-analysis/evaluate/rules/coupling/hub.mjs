// coupling/hub — a module that is both widely depended on and depends widely.
// High fan-in says "stable, change carefully"; high fan-out says "fragile,
// changes elsewhere break me". Both at once is the usual shape of a module
// that has absorbed several responsibilities. Thresholds come from config.
export const code = 'coupling/hub';
export const dimension = 'coupling';
export const severity = 'warning';
export const confidence = 1.0;

export function run({ graph, config }) {
  const minIn = config.rules?.coupling?.hub?.fanIn ?? 5;
  const minOut = config.rules?.coupling?.hub?.fanOut ?? 5;
  return graph.modules
    .filter((m) => m.fanIn >= minIn && m.fanOut >= minOut)
    .sort((a, b) => (b.fanIn + b.fanOut) - (a.fanIn + a.fanOut) || (a.id < b.id ? -1 : 1))
    .map((m) => ({
      code, dimension, severity, confidence,
      message: `${m.label} is a hub: ${m.fanIn} modules depend on it and it depends on ${m.fanOut}.`,
      subject: { module: m.id },
      evidence: {
        fanIn: m.fanIn, fanOut: m.fanOut, instability: m.instability,
        dependents: graph.edges.filter((e) => e.to === m.id).map((e) => e.from).sort(),
        dependencies: graph.edges.filter((e) => e.from === m.id).map((e) => e.to).sort(),
        threshold: { fanIn: minIn, fanOut: minOut },
      },
      supportedFixes: [
        'split the module by the reasons it changes; the dependents list usually clusters',
        'move outgoing dependencies behind an interface the hub owns',
      ],
    }));
}
