import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  RunRecorder,
  normalizeAuthoringTiming,
  recoverRunTiming,
  timingV1,
} from '../orchestration/run-recorder.mjs';

function fakeClock() {
  let now = 0;
  return {
    monotonicMs: () => now,
    wallMs: () => Date.parse('2026-08-29T00:00:00.000Z'),
    advance(milliseconds) {
      now += milliseconds;
    },
  };
}

function files(directory) {
  return {
    eventsPath: path.join(directory, 'timing.events.jsonl'),
    timingPath: path.join(directory, 'timing.json'),
  };
}

test('authoring timing normalization: derives every duration from endpoints across all five legacy shapes', () => {
  const variants = [
    {
      diagramType: 'architecture',
      stage: { name: 'authoring-kit', startedAtMs: 1_010, endedAtMs: 1_025, durationMs: 99_999 },
    },
    {
      diagramType: 'workflow',
      stage: { name: 'authoring-kit', startMs: 1_010, endMs: 1_025, durationMs: 99_999 },
    },
    {
      diagramType: 'sequence',
      stage: { name: 'authoring-kit', startMs: 1_010, endMs: 1_025, durationMs: 99_999, status: 'completed' },
    },
    {
      diagramType: 'dataflow',
      stage: { name: 'authoring-kit', startMs: 1_010, endMs: 1_025, durationMs: 99_999, notes: 'legacy marker window' },
    },
    {
      diagramType: 'lifecycle',
      stage: { name: 'authoring-kit', startMs: 1_010, endMs: 1_025, durationMs: 10_015 },
    },
  ];

  for (const { diagramType, stage } of variants) {
    const timing = normalizeAuthoringTiming({
      schemaVersion: 1,
      diagramType,
      agentStartMs: 1_000,
      agentEndMs: 1_050,
      totalMs: 88_888,
      stages: [stage],
    });

    assert.equal(timing.kind, 'archify.run-timing');
    assert.equal(timing.run.diagramType, diagramType);
    assert.equal(timing.durationMs, 50);
    assert.equal(timing.stages[0].startOffsetMs, 10);
    assert.equal(timing.stages[0].endOffsetMs, 25);
    assert.equal(timing.stages[0].durationMs, 15);
    assert.equal(timing.accounting.stagedMs, 15);
    assert.equal(timing.accounting.agentOverheadMs, 35);
    assert.equal(Date.parse(timing.endedAt) - Date.parse(timing.startedAt), timing.durationMs);
  }
});

test('authoring timing normalization: rejects non-monotonic and overlapping stage markers', () => {
  const base = {
    diagramType: 'workflow',
    agentStartMs: 1_000,
    agentEndMs: 1_100,
  };
  assert.throws(() => normalizeAuthoringTiming({
    ...base,
    stages: [
      { name: 'second', startMs: 1_040, endMs: 1_050 },
      { name: 'first', startMs: 1_010, endMs: 1_020 },
    ],
  }), /not monotonic/);
  assert.throws(() => normalizeAuthoringTiming({
    ...base,
    stages: [
      { name: 'first', startMs: 1_010, endMs: 1_040 },
      { name: 'second', startMs: 1_030, endMs: 1_050 },
    ],
  }), /overlap/);
  assert.throws(() => normalizeAuthoringTiming({
    ...base,
    stages: [{ name: 'broken', startMs: 1_020, endMs: 1_010 }],
  }), /ends before it starts/);
});

test('authoring timing normalization: preserves every supported terminal status and rejects unknown statuses', () => {
  const base = {
    diagramType: 'workflow',
    agentStartMs: 1_000,
    agentEndMs: 1_100,
    stages: [],
  };

  for (const status of ['completed', 'failed', 'blocked', 'aborted', 'cancelled']) {
    assert.equal(normalizeAuthoringTiming({ ...base, status }).status, status);
  }
  assert.equal(normalizeAuthoringTiming(base).status, 'completed');
  assert.throws(
    () => normalizeAuthoringTiming({ ...base, status: 'unexpected' }),
    /unsupported authoring timing status/i,
  );
});

test('run recorder: durable events compile into canonical timing v1 with nested spans and attempts', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-run-recorder-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const clock = fakeClock();
  const paths = files(tmp);
  const recorder = RunRecorder.open({
    run: { id: 'pi/workflow', diagramType: 'workflow' },
    ...paths,
    clock,
  });

  await recorder.stage('authoring', async (stage) => {
    clock.advance(5);
    await stage.span('schema', async () => {
      clock.advance(7);
    });
    await assert.rejects(
      stage.attempt('validate', async () => {
        clock.advance(11);
        throw new Error('diagnosed geometry');
      }),
      /diagnosed geometry/,
    );
    await stage.attempt('validate', async (attempt) => {
      await attempt.span('command', async () => {
        clock.advance(13);
      });
    });
    stage.milestone('candidateReady', { version: 2 });
  });
  clock.advance(3);
  await recorder.stage('delivery', async () => {
    clock.advance(17);
  });
  const timing = recorder.finalize({
    finalReceipt: { artifact: { sha256: 'abc' }, visualReview: 'pending' },
  });

  assert.deepEqual(timingV1, { schemaVersion: 1, kind: 'archify.run-timing' });
  assert.equal(timing.schemaVersion, 1);
  assert.equal(timing.kind, 'archify.run-timing');
  assert.equal(timing.status, 'completed');
  assert.equal(timing.run.id, 'pi/workflow');
  assert.deepEqual(timing.stages.map((stage) => stage.name), ['authoring', 'delivery']);
  assert.ok(timing.stages[0].endOffsetMs <= timing.stages[1].startOffsetMs);
  assert.deepEqual(timing.stages[0].spans.map((span) => span.name), ['schema']);
  assert.deepEqual(timing.stages[0].attempts.map((attempt) => [attempt.name, attempt.attempt, attempt.status]), [
    ['validate', 1, 'failed'],
    ['validate', 2, 'passed'],
  ]);
  assert.equal(timing.stages[0].attempts[1].spans[0].name, 'command');
  assert.equal(timing.milestones[0].name, 'candidateReady');
  assert.deepEqual(timing.finalReceipt, { artifact: { sha256: 'abc' }, visualReview: 'pending' });
  assert.equal(timing.eventLog.durableAppend, true);
  assert.equal(fs.readFileSync(paths.eventsPath, 'utf8').trim().split('\n').length, timing.eventLog.eventCount);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.timingPath, 'utf8')), timing);
});

test('run recorder: rejects overlapping top-level stages while permitting recovery from live durable events', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-run-recorder-overlap-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const clock = fakeClock();
  const paths = files(tmp);
  const recorder = RunRecorder.open({ run: { id: 'pi/dataflow' }, ...paths, clock });
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const active = recorder.stage('validation', async () => {
    clock.advance(5);
    await wait;
  });

  await assert.rejects(recorder.stage('delivery', async () => {}), /overlaps active stage/);
  const recoveredPath = path.join(tmp, 'interrupted.json');
  const interrupted = recoverRunTiming(paths.eventsPath, recoveredPath);
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.endedAt, null);
  assert.equal(interrupted.stages[0].status, 'interrupted');

  release();
  await active;
  recorder.finalize();
});

test('run recorder: preserves valid crash evidence when the final JSONL line is truncated', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-run-recorder-tail-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const paths = files(tmp);
  const recorder = RunRecorder.open({ run: { id: 'pi/sequence' }, ...paths, clock: fakeClock() });
  await recorder.stage('validate', async () => {});
  recorder.finalize();
  fs.appendFileSync(paths.eventsPath, '{"partial":');

  const recovered = recoverRunTiming(paths.eventsPath, path.join(tmp, 'tail-recovery.json'));
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.eventLog.truncatedTail, true);
  assert.equal(recovered.stages[0].status, 'passed');
});

test('run recorder: never truncates an existing event log', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-run-recorder-existing-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const paths = files(tmp);
  fs.writeFileSync(paths.eventsPath, 'trusted prior evidence\n');

  assert.throws(
    () => RunRecorder.open({ run: { id: 'pi/lifecycle' }, ...paths, clock: fakeClock() }),
    (error) => error?.code === 'EEXIST',
  );
  assert.equal(fs.readFileSync(paths.eventsPath, 'utf8'), 'trusted prior evidence\n');
});

test('run recorder: rejects event/timing path aliases before append evidence can be replaced', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-run-recorder-alias-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const alias = path.join(tmp, 'timing.jsonl');

  assert.throws(
    () => RunRecorder.open({
      run: { id: 'pi/architecture' },
      eventsPath: alias,
      timingPath: alias,
      clock: fakeClock(),
    }),
    /must be different files/,
  );
  assert.equal(fs.existsSync(alias), false);

  const realDirectory = path.join(tmp, 'real');
  const linkedDirectory = path.join(tmp, 'linked');
  fs.mkdirSync(realDirectory);
  fs.symlinkSync(realDirectory, linkedDirectory, 'dir');
  assert.throws(
    () => RunRecorder.open({
      run: { id: 'pi/symlink-alias' },
      eventsPath: path.join(realDirectory, 'same'),
      timingPath: path.join(linkedDirectory, 'same'),
      clock: fakeClock(),
    }),
    /must be different files/,
  );
  assert.equal(fs.existsSync(path.join(realDirectory, 'same')), false);
});

test('run recorder: parent lifetime contains unawaited children and escaped scopes close fail-closed', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-run-recorder-scope-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const clock = fakeClock();
  const paths = files(tmp);
  const recorder = RunRecorder.open({ run: { id: 'pi/scope' }, ...paths, clock });
  let release;
  const childGate = new Promise((resolve) => { release = resolve; });
  let escaped;
  let stageSettled = false;
  const stage = recorder.stage('validation', async (scope) => {
    escaped = scope;
    scope.span('background-command', async () => {
      await childGate;
      clock.advance(7);
    });
    clock.advance(3);
  });
  stage.then(() => { stageSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stageSettled, false, 'parent stage must own an unawaited child lifetime');
  release();
  await stage;

  await assert.rejects(
    escaped.span('late-work', async () => {}),
    /after parent scope .* closed/,
  );
  assert.throws(
    () => escaped.milestone('late-milestone'),
    /after scope .* closed/,
  );
  const timing = recorder.finalize();
  const child = timing.stages[0].spans[0];
  assert.ok(child.startOffsetMs >= timing.stages[0].startOffsetMs);
  assert.ok(child.endOffsetMs <= timing.stages[0].endOffsetMs);
});

test('run recorder: a failed durable scope-start append rolls back live registrations without hanging', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-run-recorder-append-failure-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const paths = files(tmp);
  const recorder = RunRecorder.open({ run: { id: 'pi/append-failure' }, ...paths, clock: fakeClock() });
  const originalFsyncSync = fs.fsyncSync;
  fs.fsyncSync = () => {
    const error = new Error('simulated fsync failure');
    error.code = 'EIO';
    throw error;
  };
  t.after(() => { fs.fsyncSync = originalFsyncSync; });

  await assert.rejects(
    Promise.race([
      recorder.stage('validation', async () => {}),
      new Promise((_, reject) => setTimeout(() => reject(new Error('scope registration hung')), 250)),
    ]),
    /simulated fsync failure/,
  );
  fs.fsyncSync = originalFsyncSync;
  await assert.rejects(recorder.stage('retry', async () => {}), /unusable after an append failure/);
  assert.throws(() => recorder.finalize(), /unusable after an append failure/);
});
