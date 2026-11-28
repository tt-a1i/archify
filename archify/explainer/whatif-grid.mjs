import { WhatIfError, evaluateWhatIf } from './whatif-engine.mjs';

const CAP = 256n;

export function gridRanks(model, key) {
  const { domain, inputs, overlay, initial, caseSets, presetSets } = model;
  const radices = domain.map(grid => BigInt(grid.count));
  const possible = radices.reduce((product, radix) => product * radix, 1n);
  const rank = indices => indices.reduce((total, index, i) => total * radices[i] + BigInt(index), 0n);
  function tuple(position) {
    const result = [];
    for (let i = domain.length - 1; i >= 0; i--) {
      result[i] = domain[i].value(Number(position % radices[i]));
      position /= radices[i];
    }
    return result;
  }
  if (possible <= CAP) return { possible, tuple, ranks: Array.from({ length: Number(possible) }, (_, i) => BigInt(i)) };
  const defaults = key === initial.key ? initial.tuple : overlay(inputs.map(input => input.default), caseSets.get(key));
  const indices = values => values.map((value, i) => domain[i].index(value));
  const midpoint = domain.map(grid => Math.floor((grid.count - 1) / 2));
  const mandatory = new Set([rank(indices(defaults)), rank(midpoint)]);
  for (const set of presetSets.values()) mandatory.add(rank(indices(overlay(defaults, set))));
  for (let corner = 0; corner < 2 ** domain.length; corner++) {
    mandatory.add(rank(domain.map((grid, i) => corner & (1 << i) ? grid.count - 1 : 0)));
  }
  domain.forEach((grid, i) => {
    const values = inputs[i].kind === 'range' ? [0, grid.count - 1] : Array.from({ length: grid.count }, (_, j) => j);
    for (const value of values) {
      const axial = midpoint.slice();
      axial[i] = value;
      mandatory.add(rank(axial));
    }
  });
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const fixed = [...mandatory].sort(compare);
  const ranks = fixed.slice();
  const slots = CAP - BigInt(fixed.length);
  const remaining = possible - BigInt(fixed.length);
  let skipped = 0;
  for (let i = 0n; i < slots; i++) {
    let position = (2n * i + 1n) * remaining / (2n * slots) + BigInt(skipped);
    while (skipped < fixed.length && fixed[skipped] <= position) { skipped++; position++; }
    ranks.push(position);
  }
  return { possible, tuple, ranks: ranks.sort(compare) };
}

export function checkWhatIfGrid(model, report) {
  if (!model.calc && !model.scenarios) return undefined;
  const cases = model.cases.map(({ key }) => ({ key, ...gridRanks(model, key) }));
  const statesChecked = cases.reduce((sum, grid) => sum + grid.ranks.length, 0);
  const statesPossible = cases.reduce((sum, grid) => sum + grid.possible, 0n);
  const cost = statesChecked * (model.cost + model.inputs.length + model.slots.length);
  if (cost > 32_000_000) throw new WhatIfError('calc-budget', `The grid would evaluate ${cost} operations (limit 32000000). Increase the chart sample step or simplify the formulas.`);
  const seen = new Set();
  for (const { key, ranks, tuple } of cases) {
    for (const rank of ranks) {
      const values = tuple(rank);
      evaluateWhatIf(model, { key, tuple: values }, (error, details) => {
        if (seen.size >= 20 || seen.has(error.path)) return;
        seen.add(error.path);
        report(error, { ...(key === undefined ? {} : { scenario: key }),
          inputs: Object.fromEntries(model.inputs.map((input, i) => [input.key, values[i]])), ...details });
      });
      if (seen.size >= 20) break;
    }
    if (seen.size >= 20) break;
  }
  return { version: 1, mode: BigInt(statesChecked) === statesPossible ? 'full' : 'sampled',
    scenarios: cases.length, statesChecked, statesPossible: String(statesPossible) };
}
