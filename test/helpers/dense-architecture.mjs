export function denseArchitecture(seed, cardCount) {
  let state = seed;
  function random(limit) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor(state / 2 ** 32 * limit);
  }
  const storeCount = 2 + cardCount % 2;
  const firstStore = cardCount - storeCount;
  const components = Array.from({ length: cardCount }, (_, i) => ({
    id: `card-${i}`,
    type: i >= firstStore ? 'database' : i === 0 ? 'frontend' : 'backend',
    label: i >= firstStore ? `Record store ${i - firstStore + 1}` : `Service ${i + 1}`,
    size: [120 + 12 * random(4), 60],
  }));
  const connections = [];
  function link(from, to, variant) {
    connections.push({ from: components[from].id, to: components[to].id, variant });
  }
  link(0, 1, 'emphasis');
  link(1, 0);
  for (let i = 2; i < firstStore; i++) {
    link(1 + random(Math.min(i - 1, 3)), i);
  }
  for (let i = firstStore; i < cardCount; i++) {
    const first = 1 + random(firstStore - 1);
    const second = 1 + ((first + random(firstStore - 2)) % (firstStore - 1));
    link(first, i);
    link(second, i);
  }
  const options = [];
  for (let i = 1; i < firstStore; i++) for (let j = i + 1; j < cardCount; j++) {
    if (!connections.some(({ from, to }) => from === components[i].id && to === components[j].id)) {
      options.push([i, j]);
    }
  }
  while (connections.length < cardCount + 3) {
    const [[from, to]] = options.splice(random(options.length), 1);
    link(from, to);
  }
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    layout: { mode: 'auto' },
    meta: { title: 'Service dependencies', output: 'chart.html', quality_profile: 'standard' },
    components,
    connections,
  };
}
