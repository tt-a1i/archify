// The artifact replays the compiler's selected edges from the reader's own
// moment. The walk is also callable from Node to check its arithmetic against
// the compiled plan.
//
// Self-contained by contract: the compiler stringifies this function into the
// artifact, so it may not import, close over a scope, or use syntax that does
// not survive being stringified.
export function walkClock(input) {
  var lanes = input.lanes || {};
  var nodes = input.nodes || {};
  var edges = input.edges || {};
  var overrides = input.dwells || null;
  var seed = lanes[input.laneId];
  if (!seed) return null;
  // A document may name a node "constructor" or "toString"; a plain object would
  // answer with the inherited member instead of the document's own entry.
  var outgoing = Object.create(null);
  Object.keys(edges).forEach(function (key) {
    var parts = key.split(' ');
    outgoing[parts[0]] = { to: parts[1], key: key, minutes: edges[key] };
  });
  var anchored = Boolean(input.anchor) && input.anchorLane === input.laneId;
  var current = anchored ? input.anchor : seed.start;
  var value = anchored ? input.anchorTime : seed.base;
  var rows = [];
  var seen = Object.create(null);
  var stop = 'end';
  // A chain has no length limit and needs none: a cycle is what stops it, and
  // the schema does not cap a lane's node count.
  while (current) {
    if (seen[current]) { stop = 'cycle'; break; }
    seen[current] = true;
    var authored = typeof nodes[current] === 'number' ? nodes[current] : null;
    var nodeFact = overrides && typeof overrides[current] === 'number' ? overrides[current] : authored;
    value += nodeFact === null ? 0 : nodeFact;
    var leg = outgoing[current];
    if (!leg) {
      rows.push({ node: current, nodeFact: nodeFact, key: null, edgeFact: null, to: null, value: value });
      break;
    }
    var edgeFact = typeof leg.minutes === 'number' ? leg.minutes : null;
    value += edgeFact === null ? 0 : edgeFact;
    rows.push({ node: current, nodeFact: nodeFact, key: leg.key, edgeFact: edgeFact, to: leg.to, value: value });
    current = leg.to;
    // Reading from a stop in the middle of a day: the day still ends where it
    // started, so the replay stops on the second arrival at the base instead of
    // rolling into tomorrow morning.
    if (anchored && current === seed.start) { stop = 'base'; break; }
  }
  return { rows: rows, end: value, last: current, stop: stop, anchored: anchored };
}

// Both hosts use this formatter. Keep it self-contained so the artifact can
// embed it alongside the walk without importing any runtime dependencies.
export function renderClockTemplate(template, value, options = {}) {
  let shown = String(Math.round(value * 100) / 100);
  if (options.clock) {
    const wrap = options.wrap;
    const wrapped = wrap && wrap.at && value >= wrap.at;
    const minutes = wrapped ? value - wrap.at : value;
    shown = (wrapped ? wrap.label || '' : '')
      + String(Math.floor(minutes / 60)).padStart(2, '0') + ':'
      + String(minutes % 60).padStart(2, '0');
  }
  const band = (options.bands || []).find(entry => (
    value >= entry.from && value <= (entry.wraps ? 1440 + entry.to : entry.to)
  ));
  // Every occurrence, not the first: an authored template may use a token more
  // than once, and a half-substituted line is worse than an unresolved one.
  return String(template)
    .replaceAll('{value}', shown)
    .replaceAll('{band}', band ? band.entry.label : '')
    .replaceAll('{minutes}', typeof options.minutes === 'number' && Number.isFinite(options.minutes)
      ? String(options.minutes) : '');
}
