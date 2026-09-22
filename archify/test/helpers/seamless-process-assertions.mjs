import assert from 'node:assert/strict';

function nonzero(rect) { return Boolean(rect && rect.width > 0 && rect.height > 0); }
function near(actual, expected, tolerance, message) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}`);
}

export function assertProcessFrames(frames, { cold = false, expectedTheme, expectedDiagram, allowedErrors = [] } = {}) {
  assert.ok(frames.length > 2, 'Process evidence must contain intermediate animation frames');
  for (const frame of frames) {
    const visible = frame.frames.filter(item => item.visible);
    const isHistory = ['history', 'history-recovery'].includes(frame.intent?.mode);
    const leftVisit = isHistory && (!visible.length || visible.every(item => item.entryId !== frame.entryId));
    assert.ok(frame.frames.length <= 2, `More than two viewers at ${frame.at}`);
    assert.ok(frame.frames.filter(item => item.active).length <= 1, `Multiple activity rights at ${frame.at}`);
    if (cold && !frame.everCommitted) assert.ok(visible.length <= 1, 'Cold loading may precede the first graph');
    else if (leftVisit && frame.error) assert.ok(visible.length <= 1, 'History failure may replace the inert preview');
    else assert.equal(visible.length, 1, `Expected one visible graph at ${frame.at}`);
    if (cold && frame.applicationPresent) assert.equal(frame.theme, expectedTheme, `Wrong cold-start theme at ${frame.at}`);
    for (const item of frame.frames) {
      const subject = `${item.diagram || 'candidate'} #${item.id} at ${frame.at}ms (${frame.intent?.mode}; ${item.entryId} -> ${frame.entryId})`;
      if (item.state === 'staging') {
        assert.equal(item.visible, false, `${subject}: staging must remain invisible`);
        assert.equal(item.active, false, `${subject}: staging must have no activity rights`);
        assert.equal(item.inert, true, `${subject}: staging must be inert`);
        assert.equal(item.ariaHidden, 'true', `${subject}: staging must be hidden from accessibility`);
        assert.ok(nonzero(item.bounds), `${subject}: candidate must be measurable`);
      }
      if (item.visible) {
        if (leftVisit) {
          assert.equal(item.active, false, `${subject}: Native history must revoke the old visit before preparation`);
          assert.equal(item.inert, true, `${subject}: the departed preview must remain inert`);
          assert.equal(item.ariaHidden, 'true', `${subject}: the departed preview must leave the accessibility tree`);
          // revoke() intentionally sets restoring=true. This makes the bridge
          // ready flag false while preserving already-rendered pixels; it must
          // not be interpreted as an unprepared newly committed target.
        } else {
          assert.equal(item.active, true, `${subject}: Explicit prepare revoked the readable old viewer`);
          assert.equal(item.ready, true, `${subject}: an active visible target must be ready`);
        }
        assert.ok(item.graphVisible && nonzero(item.graph), `Visible iframe has no visible graph at ${frame.at}`);
        if (item.active) {
          assert.equal(item.theme, frame.theme, `Wrong theme frame at ${frame.at}`);
          assert.equal(item.diagram, frame.current, `Directory/graph commit disagrees at ${frame.at}`);
          assert.equal(new URLSearchParams(new URL(frame.href).hash.slice(1)).get('diagram'), item.diagram);
          if (cold) assert.equal(item.diagram, expectedDiagram);
        }
      }
    }
    for (const error of frame.errors || []) assert.ok(allowedErrors.includes(error), `Unexpected runtime error: ${error}`);
    assert.deepEqual(frame.samplingErrors || [], [], 'The frame probe must not silently stop');
    if (!cold) for (const [name, control] of Object.entries(frame.shell)) {
      assert.equal(control.present, true, `${name} is missing`);
      assert.equal(control.same, true, `${name} DOM identity changed at ${frame.at}`);
    }
  }
}

// Intent marks delimit user pan/selection/navigation/resize operations. Within
// one unchanged intent, a committed viewer may not move after it is revealed.
export function assertCommittedGeometry(frames) {
  const observations = new Map();
  const initial = frames[0]?.frames.find(frame => frame.active && frame.visible);
  const initialKey = initial && `${frames[0].documentTimeOrigin}:${initial.id}`;
  for (const sample of frames) {
    const item = sample.frames.find(frame => frame.active && frame.visible);
    if (!item) continue;
    const key = `${sample.documentTimeOrigin}:${item.id}`;
    // The initial viewer may move while the user opens a compact directory.
    // Only compare a newly revealed visit until the next explicit interaction.
    if (key === initialKey) continue;
    const first = observations.get(key);
    const interaction = `${sample.intent?.at}:${sample.viewport.width}:${sample.viewport.height}:${sample.mode}`;
    if (!first) { observations.set(key, { item, interaction }); continue; }
    if (first.interaction !== interaction) continue;
    for (const coordinate of ['x', 'y', 'width', 'height']) near(item.graph[coordinate], first.item.graph[coordinate], 1,
      `Committed graph ${item.diagram}.${coordinate} moved after reveal`);
    for (const coordinate of ['centerX', 'centerY', 'scrollLeft', 'scrollTop']) near(item.camera[coordinate], first.item.camera[coordinate], 2,
      `Committed camera ${item.diagram}.${coordinate} moved after reveal`);
    near(item.camera.scale, first.item.camera.scale, .002, `Committed camera ${item.diagram}.scale moved after reveal`);
  }
}

export function assertStableChrome(frames) {
  const samples = new Map();
  for (const frame of frames) {
    for (const name of ['brand', 'toolbar', 'directory', 'search']) {
      const actual = frame.shell[name].bounds;
      assert.ok(actual, `${name} must remain present`);
      // Opening or closing the directory is an explicit visibility change.
      // Compare its visible geometry across visits, without equating a hidden
      // zero-size box with an open directory/search box.
      if (['directory', 'search'].includes(name) && !nonzero(actual)) continue;
      const key = `${name}:${frame.viewport.width}:${frame.viewport.height}:${frame.mode}`;
      const expected = samples.get(key);
      if (expected) for (const coordinate of ['x', 'y', 'width', 'height']) near(actual[coordinate], expected[coordinate], 1,
        `${name}.${coordinate} moved without viewport or layout-mode change`);
      else samples.set(key, actual);
    }
  }
}
