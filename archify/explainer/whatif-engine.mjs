// This module also runs verbatim in the standalone reader.
const modelKey = /^[A-Za-z][A-Za-z0-9_]{0,31}$/u;
const decimal = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu;
const comparison = new Set(['==', '!=', '<', '<=', '>', '>=']);
const arithmetic = new Set(['+', '-', '*', '/']);
const calls = new Map([
  ['min', [2, Math.min]], ['max', [2, Math.max]], ['abs', [1, Math.abs]],
  ['round', [1, Math.round]], ['floor', [1, Math.floor]], ['ceil', [1, Math.ceil]],
  ['clamp', [3, clampValue]], ['pow', [2, power]], ['if', [3]],
]);
const reserved = new Set([...calls.keys(), 'true', 'false', 't', 'scenario', 'constructor', 'prototype', '__proto__']);

export function isWhatIf(document) {
  return document?.answer?.live !== undefined || (Array.isArray(document?.panels) && document.panels.some(panel =>
    Array.isArray(panel?.blocks) && panel.blocks.some(block => block && (['calc','scenarios'].includes(block.type) ||
      block.live !== undefined || block.calc !== undefined || block.computed !== undefined || block.scenarios !== undefined))));
}

export class WhatIfError extends Error {
  constructor(code, message, offset = 0, path) {
    super(message);
    this.code = code;
    this.offset = offset;
    this.path = path;
  }
}

function guard(value, offset = 0, cap = 1e15) {
  if (typeof value !== 'number') return value;
  if (!Number.isFinite(value)) throw new WhatIfError('calc-nonfinite', 'The number is not finite.', offset);
  if (Math.abs(value) > cap) throw new WhatIfError('calc-magnitude', `The number exceeds the magnitude limit of ${cap}.`, offset);
  return value === 0 ? 0 : value;
}

function divide(a, b, offset) {
  if (b === 0) throw new WhatIfError('calc-div-zero', 'Division by zero. Guard the denominator or correct the input domain.', offset);
  return a / b;
}

function power(base, exponent, offset) {
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 1200) {
    throw new WhatIfError('calc-type', 'Power requires an integer exponent from -1200 through 1200.', offset);
  }
  if (exponent < 0) base = guard(divide(1, base, offset), offset);
  let result = 1;
  for (let remaining = Math.abs(exponent); remaining; ) {
    if (remaining % 2) result = guard(result * base, offset);
    remaining = Math.floor(remaining / 2);
    if (remaining) base = guard(base * base, offset);
  }
  return result;
}

function clampValue(value, lo, hi, offset) {
  if (lo > hi) throw new WhatIfError('calc-type', 'Clamp requires the lower bound to be at most the upper bound.', offset);
  return Math.min(Math.max(value, lo), hi);
}

export function parseExpression(source) {
  if (source.length > 512) throw new WhatIfError('calc-syntax', 'An expression may use at most 512 characters.', 512);
  let cursor = 0;
  let count = 0;
  let token;
  function next() {
    while (cursor < source.length && /\s/u.test(source[cursor])) cursor++;
    const offset = cursor;
    if (cursor === source.length) { token = { kind: 'end', offset }; return; }
    const rest = source.slice(cursor);
    const number = decimal.exec(rest)?.[0];
    const name = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(rest)?.[0];
    const key = /^'([A-Za-z][A-Za-z0-9_]{0,31})'/u.exec(rest);
    const operator = /^(?:==|!=|<=|>=|[<>()+,*/-])/u.exec(rest)?.[0];
    if (number) token = { kind: 'number', value: Number(number), offset };
    else if (name) token = { kind: 'name', value: name, offset };
    else if (key) token = { kind: 'enum', value: key[1], offset };
    else if (operator) token = { kind: operator, offset };
    else throw new WhatIfError('calc-syntax', `Unexpected character ${JSON.stringify(source[cursor])}.`, offset);
    cursor += (number || name || key?.[0] || operator).length;
  }
  function take(kind) {
    if (token.kind !== kind) throw new WhatIfError('calc-syntax', `Expected ${kind}.`, token.offset);
    const consumed = token;
    next();
    return consumed;
  }
  function node(kind, offset, children = [], value) {
    const depth = 1 + Math.max(0, ...children.map(child => child.depth));
    if (++count > 128 || depth > 24) throw new WhatIfError('calc-syntax', 'An expression may use at most 128 nodes and 24 levels.', offset);
    return { kind, offset, children, value, depth };
  }
  function primary(depth) {
    const { kind, value, offset } = token;
    if (depth > 24) throw new WhatIfError('calc-syntax', 'An expression may nest at most 24 levels.', offset);
    if (kind === '+' || kind === '-') {
      next();
      return node('unary', offset, [primary(depth + 1)], kind);
    }
    if (kind === '(') {
      next();
      const inner = expression(depth + 1);
      take(')');
      return inner;
    }
    if (kind === 'number' || kind === 'enum') {
      next();
      if (kind === 'number' && !Number.isFinite(value)) throw new WhatIfError('calc-nonfinite', 'A numeric literal must be finite.', offset);
      return node(kind, offset, [], value);
    }
    take('name');
    if (value === 'true' || value === 'false') return node('boolean', offset, [], value === 'true');
    if (token.kind !== '(') return node('name', offset, [], value);
    next();
    const args = [];
    if (token.kind !== ')') {
      args.push(expression(depth + 1));
      while (token.kind === ',') { next(); args.push(expression(depth + 1)); }
    }
    take(')');
    return node('call', offset, args, value);
  }
  function binary(read, operators, depth) {
    let left = read(depth);
    while (operators.includes(token.kind)) {
      const { kind, offset } = token;
      next();
      left = node('binary', offset, [left, read(depth)], kind);
    }
    return left;
  }
  const product = depth => binary(primary, ['*', '/'], depth);
  const sum = depth => binary(product, ['+', '-'], depth);
  function expression(depth) {
    const left = sum(depth);
    if (!comparison.has(token.kind)) return left;
    const { kind, offset } = token;
    next();
    return node('binary', offset, [left, sum(depth)], kind);
  }
  next();
  const result = expression(1);
  take('end');
  return result;
}

function compileAst(ast, lookup) {
  const { kind, value, offset, children } = ast;
  const error = message => { throw new WhatIfError('calc-type', message, offset); };
  if (kind === 'name') {
    const binding = lookup(value, offset);
    return { type: binding.type, cost: 1, run: slots => guard(slots[binding.index], offset) };
  }
  if (['number', 'boolean', 'enum'].includes(kind)) return { type: kind, value, cost: 1, run: () => guard(value, offset) };
  const args = children.map(child => compileAst(child, lookup));
  const [a, b, c] = args;
  const cost = 1 + args.reduce((total, arg) => total + arg.cost, 0);
  const numeric = () => { if (args.some(arg => arg.type !== 'number')) error('This operation requires numbers.'); };
  const compatible = (left, right) => {
    if (left.type === right.type && left.type !== 'enum') return left.type;
    if (left.type === 'enum' && right.type instanceof Set && right.type.has(left.value)) return right.type;
    if (right.type === 'enum' && left.type instanceof Set && left.type.has(right.value)) return left.type;
    return error('Use compatible types and a declared choice or scenario key.');
  };
  if (kind === 'unary') {
    numeric();
    return { type: 'number', cost, run: slots => guard(value === '-' ? -a.run(slots) : a.run(slots), offset) };
  }
  if (kind === 'binary') {
    if (value === '==' || value === '!=') compatible(a, b);
    else numeric();
    return {
      type: arithmetic.has(value) ? 'number' : 'boolean', cost,
      run(slots) {
        const left = a.run(slots), right = b.run(slots);
        switch (value) {
          case '+': return guard(left + right, offset);
          case '-': return guard(left - right, offset);
          case '*': return guard(left * right, offset);
          case '/': return guard(divide(left, right, offset), offset);
          case '==': return left === right;
          case '!=': return left !== right;
          case '<': return left < right;
          case '<=': return left <= right;
          case '>': return left > right;
          case '>=': return left >= right;
        }
      },
    };
  }
  const call = calls.get(value);
  if (!call) throw new WhatIfError('calc-name', `Unknown function ${value}.`, offset);
  if (args.length !== call[0]) error(`${value} requires ${call[0]} arguments.`);
  if (value === 'if') {
    if (a.type !== 'boolean') error('The first argument of if must be boolean.');
    return { type: compatible(b, c), cost: 1 + a.cost + Math.max(b.cost, c.cost),
      run: slots => a.run(slots) ? b.run(slots) : c.run(slots) };
  }
  numeric();
  return { type: 'number', cost: cost + (value === 'pow' ? 31 : 0), run(slots) {
    const values = args.map(arg => arg.run(slots));
    const result = value === 'pow' || value === 'clamp' ? call[1](...values, offset) : call[1](...values);
    return guard(result, offset);
  } };
}

export function decimalPrecision(value) {
  const [mantissa, exponent = 0] = String(value).split('e');
  return Math.max(0, (mantissa.split('.')[1]?.length || 0) - Number(exponent));
}

export function decimalGrid(min, max, step, cap = 10001, code = 'calc-grid') {
  const invalid = () => new WhatIfError(code, `Use an aligned decimal grid with positive step, at most six decimal places and at most ${cap} ticks.`);
  const precision = Math.max(...[min, max, step].map(decimalPrecision));
  if (![min,max,step].every(Number.isFinite) || precision > 6 || step <= 0) throw invalid();
  const scale = 10 ** precision;
  function integer(value) {
    // Convert the canonical decimal spelling before doing safe integer arithmetic.
    const [mantissa, exponent = '0'] = String(value).split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    const shift = precision + Number(exponent) - fraction.length;
    if (shift < 0 || shift > 15) return NaN;
    return Number((whole + fraction) + '0'.repeat(shift));
  }
  const [lo, hi, stride] = [min, max, step].map(integer);
  const span = hi - lo;
  const count = span / stride + 1;
  if (![lo, hi, stride, span, count].every(Number.isSafeInteger) ||
      span < 0 || span % stride !== 0 || count > cap) throw invalid();
  const grid = {
    count,
    value: i => (lo + i * stride) / scale,
    index(value) {
      if (!Number.isFinite(value) || value < min || value > max) return -1;
      const scaled = integer(value);
      const index = (scaled - lo) / stride;
      return Number.isInteger(index) ? index : -1;
    },
  };
  // An exact scaled integer can still lose its identity when divided in binary64.
  for (let i = 0; i < count; i++) {
    if (grid.index(grid.value(i)) !== i) throw new WhatIfError(code, 'Every decimal tick must remain distinct and recover its exact index as a number.');
  }
  return grid;
}

export function formatNumber(value, digits = 0, unit, trim = false) {
  value = guard(value, 0, 1e12);
  let fixed = value.toFixed(digits);
  if (Number(fixed) === 0 && fixed.startsWith('-')) fixed = fixed.slice(1);
  const [whole, fraction = ''] = fixed.split('.');
  return numberText(whole, trim ? fraction.replace(/0+$/u, '') : fraction, unit);
}

function numberText(whole, fraction, unit) {
  whole = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return whole + (fraction ? '.' + fraction : '') + (unit ? (unit === '%' ? '%' : '\u00a0' + unit) : '');
}

// Callers pass only inline text tokens. Code and link tokens are left literal.
export function templateParts(text) {
  const parts = [];
  let end = 0;
  for (const match of text.matchAll(/\{\{|\}\}/gu)) {
    if (match.index < end) continue;
    const offset = match.index;
    const slot = /^\{\{(?:(value|metric):([A-Za-z][A-Za-z0-9_-]*)|(scenario))\}\}/u.exec(text.slice(offset));
    if (!slot) throw new WhatIfError('calc-syntax', 'Use {{value:key}}, {{metric:id}} or {{scenario}}.', offset);
    parts.push({ text: text.slice(end, offset) }, { kind: slot[1] || slot[3], key: slot[2], offset, length: slot[0].length });
    end = offset + slot[0].length;
  }
  parts.push({ text: text.slice(end) });
  return parts;
}

function located(path, work) {
  try { return work(); }
  catch (error) {
    if (error instanceof WhatIfError) error.path ??= path;
    throw error;
  }
}

export function compileWhatIf(document) {
  const blocks = document.panels.flatMap((panel, pi) => panel.blocks.map((block, bi) =>
    ({ block, path: `/panels/${pi}/blocks/${bi}` })));
  function only(type) {
    const matches = blocks.filter(({ block }) => block.type === type);
    if (matches.length > 1) throw new WhatIfError('calc-name', `Declare at most one ${type} block.`, 0, matches[1].path);
    return matches[0] || {};
  }
  const { block: calc, path: calcPath } = only('calc');
  const { block: scenarios, path: scenariosPath } = only('scenarios');
  const cases = scenarios?.cases || [{ key: undefined, label: '' }];
  const inputs = calc?.inputs || [];
  const presets = calc?.presets || [];
  const definitions = calc?.derived || [];
  const bindings = new Map();
  const domain = [];
  const values = [];
  const metrics = new Map();
  const charts = new Map();
  const ordered = [];
  let cost = 0;

  function requireUnique(entries, path) {
    const seen = new Set();
    entries.forEach(({ key }, i) => {
      if (!modelKey.test(key) || seen.has(key)) throw new WhatIfError('calc-name', `Invalid or duplicate key ${key}.`, 0, `${path}/${i}/key`);
      seen.add(key);
    });
    return seen;
  }
  const caseKeys = scenarios ? requireUnique(cases, scenariosPath + '/cases') : new Set();
  if (scenarios && !caseKeys.has(scenarios.default)) throw new WhatIfError('calc-name', 'Declare the default scenario as a case.', 0, scenariosPath + '/default');
  requireUnique(presets, calcPath + '/presets');

  function bind(key, binding, path) {
    if (!modelKey.test(key) || reserved.has(key) || bindings.has(key)) throw new WhatIfError('calc-name', `Invalid, reserved or duplicate model name ${key}.`, 0, path);
    bindings.set(key, { index: bindings.size, ...binding });
  }

  inputs.forEach((input, i) => {
    const path = `${calcPath}/inputs/${i}`;
    if (input.kind === 'range') {
      bind(input.key, { type: 'number' }, path + '/key');
      domain.push(located(path, () => decimalGrid(input.min, input.max, input.step)));
    } else {
      const options = input.kind === 'toggle' ? [false, true] : [...requireUnique(input.options, path + '/options')];
      bind(input.key, { type: input.kind === 'toggle' ? 'boolean' : new Set(options) }, path + '/key');
      domain.push({ count: options.length, value: j => options[j], index: value => options.indexOf(value) });
    }
    if (domain[i].index(input.default) < 0) throw new WhatIfError('calc-grid', 'The default must be on the input grid.', 0, path + '/default');
    values.push(input.default);
  });
  definitions.forEach(({ key, expr }, i) => {
    const path = `${calcPath}/derived/${i}`;
    bind(key, { ast: located(path + '/expr', () => parseExpression(expr)), path: path + '/expr' }, path + '/key');
  });
  const scenarioIndex = bindings.size;
  const sampleIndex = scenarioIndex + 1;

  function assignment(rows, path) {
    const seen = new Set();
    return (rows || []).map(({ input, value }, i) => {
      const index = bindings.get(input)?.index;
      if (index === undefined || index >= inputs.length || seen.has(index)) {
        throw new WhatIfError('calc-name', `Unknown or duplicate input ${input}.`, 0, `${path}/${i}/input`);
      }
      seen.add(index);
      if (domain[index].index(value) < 0) throw new WhatIfError('calc-grid', `Assignment to ${input} must be on its input grid.`, 0, `${path}/${i}/value`);
      return [index, value];
    });
  }

  const caseSets = new Map(cases.map((item, i) => [item.key, assignment(item.set, `${scenariosPath}/cases/${i}/set`)]));
  const presetSets = new Map(presets.map((item, i) => [item.key, assignment(item.set, `${calcPath}/presets/${i}/set`)]));
  const stack = [];
  function lookup(name, offset, sampled = false) {
    if (name === 'scenario' && scenarios) return { type: caseKeys, index: scenarioIndex };
    if (name === 't' && sampled) return { type: 'number', index: sampleIndex };
    const binding = bindings.get(name);
    if (!binding) throw new WhatIfError('calc-name', `Unknown model name ${name}.`, offset);
    if (binding.type === undefined) {
      if (stack.includes(name)) throw new WhatIfError('calc-cycle', `Derived values form a cycle: ${[...stack.slice(stack.indexOf(name)), name].join(' → ')}.`, offset);
      stack.push(name);
      binding.program = located(binding.path, () => compileAst(binding.ast, (key, at) => lookup(key, at)));
      if (binding.program.type === 'enum') throw new WhatIfError('calc-type', 'A choice key needs a declared choice or scenario type.', 0, binding.path);
      binding.type = binding.program.type;
      stack.pop();
    }
    return binding;
  }
  // Resolve types and cycles first. Choose the earliest ready declaration for evaluation.
  for (const { key } of definitions) lookup(key, 0);
  function dependencies(ast) {
    return ast.kind === 'name' ? [ast.value] : ast.children.flatMap(dependencies);
  }
  const pending = definitions.map(({ key }) => bindings.get(key));
  const ready = new Set(inputs.map(input => input.key).concat('scenario'));
  const required = new Map(pending.map(binding => [binding, dependencies(binding.ast)]));
  while (pending.length) {
    const first = pending.findIndex(binding => required.get(binding).every(name => ready.has(name)));
    const [binding] = pending.splice(first, 1);
    ready.add(definitions[binding.index - inputs.length].key);
    ordered.push(binding);
    cost += binding.program.cost;
  }

  function modelRef(id, path) {
    if (!calc || id !== calc.id) throw new WhatIfError('calc-name', 'Reference the declared calculator ID.', 0, path);
  }
  function program(source, path, sampled = false, count = 1) {
    return located(path, () => {
      const compiled = compileAst(parseExpression(source), (name, offset) => lookup(name, offset, sampled));
      if (compiled.type !== 'number') throw new WhatIfError('calc-type', 'A numeric expression is required.');
      cost += compiled.cost * count;
      return { ...compiled, path };
    });
  }
  function dimension(data, path) {
    if (!Number.isFinite(data.ymin) || !Number.isFinite(data.ymax) || data.ymin >= data.ymax ||
        Math.max(Math.abs(data.ymin), Math.abs(data.ymax)) > 1e12 ||
        (data.series.some(item => item.kind === 'bar') && (data.ymin > 0 || data.ymax < 0))) {
      throw new WhatIfError('chart-domain', 'Use increasing finite axis bounds within ±1e12. Bars require zero on the axis.', 0, path);
    }
    if (data.domain) {
      const { from, to, step } = data.domain;
      const grid = located(path + '/domain', () => decimalGrid(from, to, step, 241, 'chart-domain'));
      if (Math.max(Math.abs(from), Math.abs(to)) > 1e12) throw new WhatIfError('chart-domain', 'Sample coordinates must be within ±1e12.', 0, path + '/domain');
      if (grid.count < 2 || data.kind !== 'line') throw new WhatIfError('chart-domain', 'A sampled line needs at least two coordinates.', 0, path + '/domain');
      return Array.from({ length: grid.count }, (_, i) => grid.value(i));
    }
    return data.labels;
  }

  if (document.answer.live !== undefined) modelRef(document.answer.live, '/answer/live');
  for (const { block, path } of blocks) {
    if (block.live !== undefined) modelRef(block.live, path + '/live');
    if (block.calc !== undefined) {
      modelRef(block.calc, path + '/calc');
      const thresholds = block.thresholds || [];
      if (metrics.size >= 32) throw new WhatIfError('calc-budget', 'At most 32 live metrics are allowed.', 0, path);
      if (thresholds.length && (thresholds.length !== 3 || new Set(thresholds.map(row => row.level)).size !== 3 ||
          thresholds[0].op === 'else' || thresholds[1].op === 'else' || thresholds[2].op !== 'else')) {
        throw new WhatIfError('calc-threshold', 'Use two cutoffs and an else row with one good, caution and bad level each.', 0, path + '/thresholds');
      }
      metrics.set(block.id, { block, bind: program(block.bind, path + '/bind'),
        cutoffs: thresholds.slice(0, 2).map((row, i) => program(row.expr, `${path}/thresholds/${i}/expr`)) });
    }
    if (block.computed) {
      const data = block.computed;
      const chartPath = path + '/computed';
      modelRef(data.calc, chartPath + '/calc');
      if (charts.size >= 8) throw new WhatIfError('calc-budget', 'At most eight computed charts are allowed.', 0, path);
      const labels = dimension(data, chartPath);
      if (data.series[0].kind !== data.kind) throw new WhatIfError('chart-domain', 'The first series must match the chart type.', 0, chartPath + '/series/0');
      const series = data.series.map((item, i) => {
        const p = `${chartPath}/series/${i}`;
        if (data.domain && item.kind === 'line' && item.expr !== undefined) return [program(item.expr, p + '/expr', true, labels.length)];
        if (!data.domain && item.values?.length === labels.length) return item.values.map((expr, j) => program(expr, `${p}/values/${j}`));
        throw new WhatIfError('chart-domain', 'Use one expression per category or one sampled line expression.', 0, p);
      });
      charts.set(block.id, { data, labels, series });
    }
  }

  for (const { block, path } of blocks) {
    if (block.scenarios === undefined) continue;
    if (!scenarios || block.scenarios !== scenarios.id) throw new WhatIfError('scenario-target', 'Reference the declared scenarios ID.', 0, path + '/scenarios');
    const activeCases = new Set();
    block.active.forEach((row, i) => {
      if (!caseKeys.has(row.case) || activeCases.has(row.case) || !(row.nodes.length || row.edges.length)) {
        throw new WhatIfError('scenario-target', 'Each case needs one active row with at least one target.', 0, `${path}/active/${i}`);
      }
      activeCases.add(row.case);
    });
    if (activeCases.size !== cases.length) throw new WhatIfError('scenario-target', 'Add an active row for every case.', 0, path + '/active');
    block.badges?.forEach((badge, i) => {
      if (!metrics.has(badge.metric)) throw new WhatIfError('scenario-target', 'A badge requires a live metric ID.', 0, `${path}/badges/${i}/metric`);
    });
  }

  function overlay(tuple, set) {
    const next = tuple.slice();
    for (const [i, value] of set) next[i] = value;
    return next;
  }
  const initial = { key: scenarios?.default, tuple: overlay(values, caseSets.get(scenarios?.default)) };
  return { calc, scenarios, cases, inputs, presets, domain, initial, cost, ordered, bindings, metrics, charts,
    calcPath, sampleIndex, scenarioIndex, caseSets, presetSets, overlay, slots: [] };
}

export function resolveSlot(model, slot) {
  if (slot.kind === 'scenario' && model.scenarios) return slot;
  if (slot.kind === 'metric' && model.metrics.has(slot.key)) return slot;
  if (slot.kind === 'value' && model.bindings.has(slot.key)) return slot;
  throw new WhatIfError('calc-name', `Unknown template binding ${slot.key || slot.kind}.`, slot.offset);
}

export function displayInput(input, value, locale, unit = input.unit) {
  if (input.kind === 'toggle') return locale?.startsWith('zh') ? (value ? '开启' : '关闭') : (value ? 'On' : 'Off');
  if (input.kind === 'choice') return input.options.find(option => option.key === value).label;
  // Use the number's canonical decimal spelling, then preserve step padding.
  // Converting a large tick with toFixed can change its shortest decimal digits.
  const [whole, fraction = ''] = String(value).split('.');
  return numberText(whole, fraction.padEnd(decimalPrecision(input.step),'0'), unit);
}

export function displaySlot(model, state, slot, locale) {
  if (slot.kind === 'scenario') return state.label;
  if (slot.kind === 'metric') return state.metrics.get(slot.key).text;
  const binding = model.bindings.get(slot.key);
  const value = state.scalars[binding.index];
  const input = model.inputs[binding.index];
  if (input) return displayInput(input, value, locale, '');
  if (typeof value === 'boolean') return displayInput({ kind: 'toggle' }, value, locale);
  if (binding.type instanceof Set) {
    return model.inputs.find(item => model.bindings.get(item.key).type === binding.type)?.options.find(option => option.key === value)?.label ||
      model.cases.find(item => item.key === value)?.label || value;
  }
  return formatNumber(value, 6, undefined, true);
}

export function evaluateWhatIf(model, { key, tuple }, report) {
  const scalars = tuple.slice();
  const state = { key, tuple, scalars, label: model.cases.find(item => item.key === key)?.label,
    metrics: new Map(), charts: new Map() };
  function attempt(path, work, detail = {}) {
    try { return located(path, work); }
    catch (error) {
      if (!report || !(error instanceof WhatIfError)) throw error;
      report(error, detail);
      return undefined;
    }
  }
  function run(program) {
    const result = program.run(scalars);
    if (result === undefined) throw new WhatIfError('calc-type', 'A required derived value failed.');
    return result;
  }
  for (const [i, grid] of model.domain.entries()) {
    attempt(`${model.calcPath}/inputs/${i}`, () => {
      if (grid.index(tuple[i]) < 0) throw new WhatIfError('calc-grid', `${model.inputs[i].label} is outside its input grid.`);
      displayInput(model.inputs[i], tuple[i]);
    });
  }
  scalars[model.scenarioIndex] = key;
  for (const binding of model.ordered) scalars[binding.index] = attempt(binding.path, () => run(binding.program));
  for (const [id, { block, bind, cutoffs }] of model.metrics) {
    const value = attempt(bind.path, () => guard(run(bind), 0, 1e12));
    const limits = cutoffs.map(cutoff => attempt(cutoff.path, () => run(cutoff)));
    let status;
    if (limits.length && limits.every(limit => limit !== undefined)) {
      const [low, high] = limits;
      attempt(cutoffs[1].path, () => {
        if (low >= high) throw new WhatIfError('calc-threshold', 'The second cutoff must be greater than the first.');
      });
      status = block.thresholds.find((row, i) => row.op === 'else' || (row.op === 'lt' ? value < limits[i] : value <= limits[i]));
    }
    if (value !== undefined) state.metrics.set(id, { value, text: formatNumber(value, block.digits, block.unit), status });
  }
  for (const [id, { data, series, labels }] of model.charts) {
    const points = series.map((programs, i) => labels.map((coordinate, j) => {
      if (data.domain) scalars[model.sampleIndex] = coordinate;
      const program = programs[data.domain ? 0 : j];
      return attempt(program.path, () => {
        const value = guard(run(program), 0, 1e12);
        if (value < data.ymin || value > data.ymax) throw new WhatIfError('chart-domain', `Chart value ${value} is outside [${data.ymin}, ${data.ymax}].`);
        return value;
      }, { series: data.series[i].label, ...(data.domain ? { t: coordinate } : { category: coordinate }) });
    }));
    state.charts.set(id, points);
  }
  for (const slot of model.slots) {
    if (slot.kind === 'value' && scalars[model.bindings.get(slot.key).index] !== undefined) {
      attempt(slot.path, () => displaySlot(model, state, slot));
    }
  }
  return state;
}

export function projectChart(data, labels, points) {
  const width = 640, height = 260, left = 105, right = 614, top = 16, bottom = 223;
  const cell = (right - left) / labels.length;
  const round = value => Number(value.toFixed(3));
  const x = index => data.domain ? left + index * (right - left) / (labels.length - 1) : left + (index + .5) * cell;
  const y = value => round(bottom - (value - data.ymin) / (data.ymax - data.ymin) * (bottom - top));
  const bars = data.series.filter(series => series.kind === 'bar').length;
  const barWidth = Math.min(55, cell * .68 / Math.max(1, bars));
  let bar = 0;
  return {
    width, height, left, right, bottom,
    ticks: Array.from({ length: 5 }, (_, i) => {
      const value = i === 4 ? data.ymax : data.ymin + (data.ymax - data.ymin) * i / 4;
      return { y: y(value), text: formatNumber(value, 2, undefined, true) };
    }),
    labels: labels.map((label, i) => ({ x: round(x(i)), text: data.domain ? formatNumber(label, 6, undefined, true) : label }))
      .filter((_, i) => !data.domain || i === labels.length - 1 || i % Math.ceil(labels.length / 5) === 0),
    series: data.series.map((series, i) => {
      if (series.kind === 'line') return { ...series, d: points[i].map((value, j) => `${j ? 'L' : 'M'}${round(x(j))} ${y(value)}`).join(' ') };
      const offset = bar++ - bars / 2;
      return { ...series, bars: points[i].map((value, j) => ({
        x: round(x(j) + offset * barWidth), y: Math.min(y(0), y(value)), width: round(barWidth),
        height: round(Math.abs(y(value) - y(0))),
      })) };
    }),
    rows: labels.map((label, i) => [data.domain ? formatNumber(label, 6, undefined, true) : label,
      ...points.map(series => formatNumber(series[i], 0, data.unit))]),
  };
}
