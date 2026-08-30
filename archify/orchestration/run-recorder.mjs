import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const EVENT_SCHEMA_VERSION = 1;
const TIMING_SCHEMA_VERSION = 1;
const TIMING_KIND = 'archify.run-timing';

function productionClock() {
  return {
    monotonicMs: () => performance.now(),
    wallMs: () => Date.now(),
  };
}

function roundMs(value) {
  return Math.round(value * 1000) / 1000;
}

function jsonValue(value, label) {
  try {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new TypeError(`${label} must be JSON-serializable: ${error.message}`);
  }
}

function errorReceipt(error) {
  return {
    name: typeof error?.name === 'string' ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : String(error),
    ...(typeof error?.code === 'string' || typeof error?.code === 'number'
      ? { code: error.code }
      : {}),
    ...(Number.isInteger(error?.exitCode) ? { exitCode: error.exitCode } : {}),
  };
}

function assertName(name, label) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return name.trim();
}

function writeAtomicJson(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, target);
    try {
      const directory = fs.openSync(path.dirname(target), 'r');
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
    } catch {
      // Some filesystems do not permit directory fsync. The file itself is
      // already durable and the append-only event log remains authoritative.
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function readEvents(eventsPath) {
  const source = fs.readFileSync(eventsPath, 'utf8');
  const lines = source.split('\n');
  const events = [];
  let truncatedTail = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.schemaVersion !== EVENT_SCHEMA_VERSION) {
        throw new Error(`unsupported event schema ${JSON.stringify(event.schemaVersion)}`);
      }
      events.push(event);
    } catch (error) {
      const isTail = lines.slice(index + 1).every((candidate) => !candidate.trim());
      if (!isTail) {
        throw new Error(`Invalid event log line ${index + 1}: ${error.message}`);
      }
      truncatedTail = true;
    }
  }

  if (events.length === 0) throw new Error(`Run event log is empty: ${eventsPath}`);
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].seq !== index + 1) {
      throw new Error(`Run event log sequence is not contiguous at event ${index + 1}.`);
    }
  }
  return { events, truncatedTail };
}

function makeScope(startEvent) {
  return {
    id: startEvent.scope.id,
    name: startEvent.scope.name,
    status: 'interrupted',
    startedAt: startEvent.at,
    endedAt: null,
    startOffsetMs: startEvent.elapsedMs,
    endOffsetMs: null,
    durationMs: null,
    metadata: startEvent.scope.metadata || {},
    spans: [],
    attempts: [],
    ...(startEvent.scope.kind === 'attempt'
      ? { attempt: startEvent.scope.attempt }
      : {}),
  };
}

function compileTiming(eventsPath, { interruptedStatus = 'interrupted' } = {}) {
  const absoluteEventsPath = path.resolve(eventsPath);
  const { events, truncatedTail } = readEvents(absoluteEventsPath);
  const start = events.find((event) => event.type === 'run.started');
  if (!start) throw new Error('Run event log has no run.started event.');

  const scopes = new Map();
  const parentByScope = new Map();
  const kindByScope = new Map();
  const stages = [];
  const milestones = [];
  let finalReceipt = null;
  let finish = null;

  for (const event of events) {
    if (event.type === 'scope.started') {
      if (scopes.has(event.scope.id)) throw new Error(`Duplicate scope id ${event.scope.id}.`);
      const scope = makeScope(event);
      scopes.set(scope.id, scope);
      parentByScope.set(scope.id, event.scope.parentId || null);
      kindByScope.set(scope.id, event.scope.kind);
      if (event.scope.kind === 'stage') stages.push(scope);
      continue;
    }
    if (event.type === 'scope.finished') {
      const scope = scopes.get(event.scopeId);
      if (!scope) throw new Error(`Finished unknown scope ${event.scopeId}.`);
      scope.status = event.status;
      scope.endedAt = event.at;
      scope.endOffsetMs = event.elapsedMs;
      scope.durationMs = roundMs(event.elapsedMs - scope.startOffsetMs);
      if (event.error) scope.error = event.error;
      continue;
    }
    if (event.type === 'milestone.recorded') {
      milestones.push({
        name: event.name,
        at: event.at,
        elapsedMs: event.elapsedMs,
        ...(event.scopeId ? { scopeId: event.scopeId } : {}),
        metadata: event.metadata || {},
      });
      continue;
    }
    if (event.type === 'receipt.recorded') {
      finalReceipt = event.receipt;
      continue;
    }
    if (event.type === 'run.finished') finish = event;
  }

  for (const [scopeId, scope] of scopes) {
    const parentId = parentByScope.get(scopeId);
    if (!parentId) continue;
    const parent = scopes.get(parentId);
    if (!parent) throw new Error(`Scope ${scopeId} references unknown parent ${parentId}.`);
    if (scope.startOffsetMs < parent.startOffsetMs
      || (parent.endOffsetMs !== null
        && (scope.endOffsetMs === null || scope.endOffsetMs > parent.endOffsetMs))) {
      throw new Error(`Nested scope ${scope.name} is not contained by parent ${parent.name}.`);
    }
    const collection = kindByScope.get(scopeId) === 'attempt' ? parent.attempts : parent.spans;
    collection.push(scope);
  }

  const sortScopes = (scope) => {
    scope.spans.sort((left, right) => left.startOffsetMs - right.startOffsetMs);
    scope.attempts.sort((left, right) => left.startOffsetMs - right.startOffsetMs);
    scope.spans.forEach(sortScopes);
    scope.attempts.forEach(sortScopes);
  };
  stages.sort((left, right) => left.startOffsetMs - right.startOffsetMs);
  stages.forEach(sortScopes);

  for (let index = 1; index < stages.length; index += 1) {
    const previous = stages[index - 1];
    const current = stages[index];
    if (previous.endOffsetMs === null || current.startOffsetMs < previous.endOffsetMs) {
      throw new Error(`Top-level stages overlap: ${previous.name} and ${current.name}.`);
    }
  }

  const lastEvent = finish || events.at(-1);
  const endedAt = finish?.at || null;
  const durationMs = roundMs(lastEvent.elapsedMs);
  const stagedMs = roundMs(stages.reduce(
    (sum, stage) => sum + (Number.isFinite(stage.durationMs) ? stage.durationMs : 0),
    0,
  ));
  return {
    schemaVersion: TIMING_SCHEMA_VERSION,
    kind: TIMING_KIND,
    run: start.run,
    status: finish?.status || interruptedStatus,
    startedAt: start.at,
    endedAt,
    durationMs,
    stages,
    milestones,
    finalReceipt,
    ...(start.run?.measurementDomain === 'agent-authoring' ? {
      accounting: {
        stagedMs,
        agentOverheadMs: roundMs(durationMs - stagedMs),
        durationSource: 'monotonic-endpoints',
      },
    } : {}),
    eventLog: {
      path: absoluteEventsPath,
      eventCount: events.length,
      durableAppend: true,
      truncatedTail,
    },
  };
}

/**
 * Compile an append-only event log into the canonical Archify timing v1
 * receipt. This is also the recovery path after an interrupted process.
 */
export function recoverRunTiming(eventsPath, timingPath, options = {}) {
  const timing = compileTiming(eventsPath, options);
  writeAtomicJson(timingPath, timing);
  return timing;
}

function legacyStageEndpoints(stage, index) {
  const startMs = stage?.startedAtMs ?? stage?.startMs;
  const endMs = stage?.endedAtMs ?? stage?.endMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new TypeError(`authoring stage ${index + 1} must contain finite start and end markers.`);
  }
  if (endMs < startMs) {
    throw new Error(`authoring stage ${index + 1} ends before it starts.`);
  }
  return { startMs, endMs };
}

/**
 * Normalize the historical per-agent timing shapes into the same canonical
 * timing receipt consumed by reporting. Legacy duration fields are treated as
 * untrusted annotations: every duration is re-derived from endpoint markers.
 */
export function normalizeAuthoringTiming(source) {
  const input = jsonValue(source, 'authoring timing');
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('authoring timing must be an object.');
  }
  const status = input.status === undefined ? 'completed' : input.status;
  if (!['completed', 'failed', 'blocked', 'aborted', 'cancelled'].includes(status)) {
    throw new TypeError(`Unsupported authoring timing status ${JSON.stringify(status)}.`);
  }
  const startedMs = input.agentStartMs;
  const endedMs = input.agentEndMs;
  if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs)) {
    throw new TypeError('authoring timing must contain finite agentStartMs and agentEndMs.');
  }
  if (endedMs < startedMs) throw new Error('authoring timing ends before it starts.');

  const stages = (Array.isArray(input.stages) ? input.stages : []).map((stage, index) => {
    const name = assertName(stage?.name, `authoring stage ${index + 1} name`);
    const endpoints = legacyStageEndpoints(stage, index);
    if (endpoints.startMs < startedMs || endpoints.endMs > endedMs) {
      throw new Error(`authoring stage ${JSON.stringify(name)} is outside the run endpoints.`);
    }
    return {
      id: `stage-${index + 1}`,
      name,
      status: stage.status === 'failed' ? 'failed' : 'passed',
      startedAt: new Date(endpoints.startMs).toISOString(),
      endedAt: new Date(endpoints.endMs).toISOString(),
      startOffsetMs: roundMs(endpoints.startMs - startedMs),
      endOffsetMs: roundMs(endpoints.endMs - startedMs),
      durationMs: roundMs(endpoints.endMs - endpoints.startMs),
      metadata: {},
      spans: [],
      attempts: [],
    };
  });
  for (let index = 1; index < stages.length; index += 1) {
    if (stages[index].startOffsetMs < stages[index - 1].startOffsetMs) {
      throw new Error(`Top-level authoring stages are not monotonic: ${stages[index - 1].name} and ${stages[index].name}.`);
    }
    if (stages[index].startOffsetMs < stages[index - 1].endOffsetMs) {
      throw new Error(`Top-level authoring stages overlap: ${stages[index - 1].name} and ${stages[index].name}.`);
    }
  }
  const durationMs = roundMs(endedMs - startedMs);
  const stagedMs = roundMs(stages.reduce((sum, stage) => sum + stage.durationMs, 0));
  return {
    schemaVersion: TIMING_SCHEMA_VERSION,
    kind: TIMING_KIND,
    run: {
      id: typeof input.runId === 'string' && input.runId.trim()
        ? input.runId.trim()
        : `authoring/${assertName(input.diagramType, 'diagramType')}`,
      diagramType: assertName(input.diagramType, 'diagramType'),
      measurementDomain: 'agent-authoring',
      ...(input.repository && typeof input.repository === 'object'
        ? { repository: input.repository }
        : {}),
    },
    status,
    startedAt: new Date(startedMs).toISOString(),
    endedAt: new Date(endedMs).toISOString(),
    durationMs,
    stages,
    milestones: [],
    finalReceipt: null,
    accounting: {
      stagedMs,
      agentOverheadMs: roundMs(durationMs - stagedMs),
      durationSource: 'endpoints',
    },
    eventLog: {
      path: null,
      eventCount: 0,
      durableAppend: false,
      truncatedTail: false,
      migratedFrom: 'legacy-agent-timing',
    },
  };
}

class Scope {
  constructor(recorder, id) {
    this.recorder = recorder;
    this.id = id;
  }

  span(name, operation, metadata = {}) {
    const running = this.recorder._runScope('span', this.id, name, operation, metadata);
    // A caller may deliberately fire work and let the parent scope own its
    // lifetime. Keep the returned promise rejectable for awaited callers, but
    // attach an observer so an unawaited failed child is still represented by
    // timing evidence rather than becoming an unhandled rejection.
    running.catch(() => {});
    return running;
  }

  attempt(name, operation, metadata = {}) {
    const running = this.recorder._runScope('attempt', this.id, name, operation, metadata);
    running.catch(() => {});
    return running;
  }

  milestone(name, metadata = {}) {
    return this.recorder.milestone(name, metadata, this.id);
  }
}

/**
 * Deep timing module. Callers name stages and execute work; the module owns
 * ordering, nesting, monotonic measurement, crash evidence, and canonical
 * receipt construction behind that interface.
 */
export class RunRecorder {
  static open({ run, eventsPath, timingPath, clock = productionClock() }) {
    return new RunRecorder({ run, eventsPath, timingPath, clock });
  }

  constructor({ run, eventsPath, timingPath, clock }) {
    const safeRun = jsonValue(run, 'run identity');
    if (!safeRun || typeof safeRun !== 'object' || !assertName(safeRun.id, 'run.id')) {
      throw new TypeError('run must contain a non-empty id.');
    }
    if (!clock || typeof clock.monotonicMs !== 'function' || typeof clock.wallMs !== 'function') {
      throw new TypeError('clock must provide monotonicMs() and wallMs().');
    }

    this.run = safeRun;
    this.eventsPath = path.resolve(eventsPath);
    this.timingPath = path.resolve(timingPath);
    fs.mkdirSync(path.dirname(this.eventsPath), { recursive: true });
    fs.mkdirSync(path.dirname(this.timingPath), { recursive: true });
    const canonicalEventsPath = path.join(
      fs.realpathSync(path.dirname(this.eventsPath)),
      path.basename(this.eventsPath),
    );
    const canonicalTimingPath = path.join(
      fs.realpathSync(path.dirname(this.timingPath)),
      path.basename(this.timingPath),
    );
    if (canonicalEventsPath === canonicalTimingPath) {
      throw new Error('eventsPath and timingPath must be different files.');
    }
    try {
      fs.lstatSync(this.timingPath);
      const error = new Error(`Canonical timing output already exists: ${this.timingPath}`);
      error.code = 'EEXIST';
      throw error;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.clock = clock;
    this.sequence = 0;
    this.scopeSequence = 0;
    this.attempts = new Map();
    this.openScopes = new Set();
    this.childCompletions = new Map();
    this.activeStageId = null;
    this.finalized = false;
    this.appendFailure = null;
    this.startedMonoMs = clock.monotonicMs();
    this.startedWallMs = clock.wallMs();

    this.descriptor = fs.openSync(this.eventsPath, 'wx', 0o600);
    this._append('run.started', { run: this.run });
  }

  _append(type, payload = {}) {
    if (this.finalized) throw new Error('RunRecorder is already finalized.');
    if (this.appendFailure) {
      throw new Error('RunRecorder is unusable after an append failure.', { cause: this.appendFailure });
    }
    const monotonicMs = this.clock.monotonicMs();
    const elapsedMs = roundMs(monotonicMs - this.startedMonoMs);
    const event = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      seq: ++this.sequence,
      type,
      at: new Date(this.startedWallMs + elapsedMs).toISOString(),
      elapsedMs,
      ...jsonValue(payload, `event ${type}`),
    };
    const line = Buffer.from(`${JSON.stringify(event)}\n`, 'utf8');
    let offset = 0;
    try {
      while (offset < line.byteLength) {
        const written = fs.writeSync(this.descriptor, line, offset, line.byteLength - offset, null);
        if (written <= 0) throw new Error(`Could not append event ${event.seq}.`);
        offset += written;
      }
      fs.fsyncSync(this.descriptor);
    } catch (error) {
      this.appendFailure = error;
      throw error;
    }
    return event;
  }

  async stage(name, operation, metadata = {}) {
    if (this.activeStageId) {
      throw new Error(`Top-level stage ${JSON.stringify(name)} overlaps active stage ${this.activeStageId}.`);
    }
    return this._runScope('stage', null, name, operation, metadata);
  }

  async _runScope(kind, parentId, name, operation, metadata = {}) {
    if (this.finalized) throw new Error('RunRecorder is already finalized.');
    if (typeof operation !== 'function') throw new TypeError(`${kind} operation must be a function.`);
    const normalizedName = assertName(name, `${kind} name`);
    const safeMetadata = jsonValue(metadata, `${kind} metadata`) || {};
    if (parentId && !this.openScopes.has(parentId)) {
      throw new Error(`Cannot start ${kind} ${JSON.stringify(normalizedName)} after parent scope ${parentId} closed.`);
    }
    const id = `${kind}-${++this.scopeSequence}`;
    let attempt;
    if (kind === 'attempt') {
      const key = `${parentId}:${normalizedName}`;
      attempt = (this.attempts.get(key) || 0) + 1;
      this.attempts.set(key, attempt);
    }
    if (kind === 'stage') this.activeStageId = id;

    let completeChild;
    const childCompletion = new Promise((resolve) => { completeChild = resolve; });
    if (parentId) this.childCompletions.get(parentId).add(childCompletion);
    this.childCompletions.set(id, new Set());
    this.openScopes.add(id);

    try {
      this._append('scope.started', {
        scope: {
          id,
          kind,
          name: normalizedName,
          parentId,
          ...(attempt ? { attempt } : {}),
          metadata: safeMetadata,
        },
      });
    } catch (error) {
      this.openScopes.delete(id);
      this.childCompletions.delete(id);
      if (parentId) this.childCompletions.get(parentId)?.delete(childCompletion);
      completeChild();
      if (kind === 'stage') this.activeStageId = null;
      throw error;
    }
    const scope = new Scope(this, id);
    let result;
    let operationError;
    let operationFailed = false;
    try {
      result = await operation(scope);
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }

    // Parent completion owns every child lifetime, even when a caller does
    // not explicitly await a nested span. This preserves tree containment in
    // the canonical receipt without forcing orchestration callers to expose
    // internal promise bookkeeping at the interface.
    await Promise.all([...this.childCompletions.get(id)]);
    try {
      if (operationFailed) {
        this._append('scope.finished', {
          scopeId: id,
          status: 'failed',
          error: errorReceipt(operationError),
        });
        throw operationError;
      }
      this._append('scope.finished', { scopeId: id, status: 'passed' });
      return result;
    } finally {
      this.openScopes.delete(id);
      this.childCompletions.delete(id);
      completeChild();
      if (kind === 'stage') this.activeStageId = null;
    }
  }

  milestone(name, metadata = {}, scopeId = null) {
    const normalizedName = assertName(name, 'milestone name');
    if (scopeId && !this.openScopes.has(scopeId)) {
      throw new Error(`Cannot record milestone ${JSON.stringify(normalizedName)} after scope ${scopeId} closed.`);
    }
    return this._append('milestone.recorded', {
      name: normalizedName,
      scopeId,
      metadata: jsonValue(metadata, 'milestone metadata') || {},
    });
  }

  finalize({ status = 'completed', finalReceipt = null } = {}) {
    if (this.finalized) throw new Error('RunRecorder is already finalized.');
    if (this.appendFailure) {
      throw new Error('RunRecorder is unusable after an append failure.', { cause: this.appendFailure });
    }
    if (this.activeStageId || this.openScopes.size) {
      throw new Error(`Cannot finalize while scope ${this.activeStageId || [...this.openScopes][0]} is active.`);
    }
    if (!['completed', 'failed', 'blocked', 'aborted', 'cancelled'].includes(status)) {
      throw new TypeError(`Unsupported run status ${JSON.stringify(status)}.`);
    }
    this._append('receipt.recorded', {
      receipt: jsonValue(finalReceipt, 'finalReceipt'),
    });
    this._append('run.finished', { status });
    fs.closeSync(this.descriptor);
    this.descriptor = undefined;
    this.finalized = true;
    return recoverRunTiming(this.eventsPath, this.timingPath);
  }
}

export const timingV1 = Object.freeze({
  schemaVersion: TIMING_SCHEMA_VERSION,
  kind: TIMING_KIND,
});
