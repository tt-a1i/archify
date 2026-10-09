import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSvgPath } from '../archify/renderers/shared/svg-path-analysis.mjs';

function parsed(source) {
  const result = analyzeSvgPath(source);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.subpaths;
}

test('empty data and move-only subpaths do not invent drawing segments', () => {
  assert.deepEqual(parsed(' \n\t'), []);
  const [first, second] = parsed('M20 20 M100 100');
  assert.deepEqual(first.points, [[20, 20]]);
  assert.deepEqual(second.points, [[100, 100]]);
  assert.deepEqual(first.segments, []);
  assert.deepEqual(second.straightSegments, []);
});

test('a move starts a separate subpath while subsequent pairs draw implicit lines', () => {
  const [first, second] = parsed('M20 20 100 20 M100 100 200 100');
  assert.deepEqual(first.segments, [{ start: [20, 20], end: [100, 20] }]);
  assert.deepEqual(second.segments, [{ start: [100, 100], end: [200, 100] }]);
  assert.deepEqual(first.straightSegments, first.segments);
});

test('relative repetitions and closepath restore the current subpath origin', () => {
  const [first, second] = parsed('m10 20 30 0 h20 v10 l-20 0 z m100 0 20 0');
  assert.deepEqual(first.points, [[10, 20], [40, 20], [60, 20], [60, 30], [40, 30], [10, 20]]);
  assert.equal(first.closed, true);
  assert.deepEqual(second.points, [[110, 20], [130, 20]]);
  assert.equal(second.closed, false);
});

test('each closepath uses its own most recent move and can be followed by drawing', () => {
  const paths = parsed('M20 20 H100 V60 H20 Z M160 20 H240 V60 H160 Z l0 40');
  assert.deepEqual(paths[0].segments.at(-1), { start: [20, 60], end: [20, 20] });
  assert.deepEqual(paths[1].segments.at(-1), { start: [160, 60], end: [160, 20] });
  assert.deepEqual(paths[2].segments, [{ start: [160, 20], end: [160, 60] }]);
});

test('legal number spellings preserve coordinates instead of dropping exponent letters', () => {
  const absolute = parsed('M100 20 V100');
  assert.deepEqual(parsed('M1e2 2e1 V1e2'), absolute);
  assert.deepEqual(parsed('M1E2 2E1 V1E2'), absolute);
  assert.deepEqual(parsed('M+1e+2,+2E+1 V100.'), absolute);
  assert.deepEqual(parsed('M.5-.5 l.5.5')[0].points, [[0.5, -0.5], [1, 0]]);
});

test('quadratic sampling and exact collinear primitives retain their separate meanings', () => {
  const [curve] = parsed('M0 0 Q10 0 10 10 L20 10');
  assert.equal(curve.segments.length, 9);
  assert.deepEqual(curve.points[4], [7.5, 2.5]);
  assert.deepEqual(curve.straightSegments, [{ start: [10, 10], end: [20, 10] }]);
  assert.deepEqual(parsed('M0 0 q10 0 10 10 l10 0')[0], curve);
  assert.deepEqual(parsed('M0 0 Q10 0 20 0')[0].straightSegments, [{ start: [0, 0], end: [20, 0] }]);
});

for (const source of [
  'M20', 'M20 20 Q30 30 40', 'M20 20 L', 'M20 20 Q',
  'M20 20 L30 Z', 'M20 20 Q30 30 L40 40', 'M20 20 Z30 40',
  'L20 20', 'Z', 'M,20 20', 'M20,,20', 'M20 20,', 'M20 20,L30 30',
  'M20 20 R30 30', 'M20 NaN', 'M20 Infinity', 'M20 1e', 'M20 1e+',
  'M20 1e999', 'M1e308 0 l1e308 0', 'M20 20;L30 30', 'M20\u00a020',
]) {
  test(`malformed data terminates with a source offset: ${JSON.stringify(source)}`, () => {
    const result = analyzeSvgPath(source);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'artifact/svg-path-malformed');
    assert.ok(Number.isInteger(result.error.tokenOffset));
    assert.ok(result.error.tokenOffset >= 0 && result.error.tokenOffset <= source.length);
    assert.equal(typeof result.error.reason, 'string');
    assert.equal(result.subpaths, undefined, '不把部分解析当作可信几何返回');
  });
}

test('missing parameters point to the incomplete group or interrupting command', () => {
  assert.equal(analyzeSvgPath('M20').error.tokenOffset, 3);
  assert.equal(analyzeSvgPath('M20 L30 30').error.tokenOffset, 4);
});

for (const command of ['A', 'a', 'C', 'c', 'S', 's', 'T', 't']) {
  test(`recognized unsupported command ${command} is not silently reinterpreted`, () => {
    const result = analyzeSvgPath(`M20 20 ${command} 30 30 40 40 0 50 50`);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'artifact/svg-path-unsupported');
    assert.equal(result.error.command, command);
    assert.equal(result.error.tokenOffset, 7);
  });
}
