import fs from 'node:fs';
import path from 'node:path';
import { containedBy } from '../renderers/shared/path-semantics.mjs';
import { STATIC_RELATION_TYPES } from './component-stage.mjs';
import { compileBrief, MAX_BRIEF_EXCERPT_LINES } from './story-plan.mjs';

const roundTime = (value) => Math.round(value * 1000) / 1000;

export class StoryChoreographyError extends Error {
  constructor(message, { code, stage = 'manifest', subject = {}, evidence = {}, supportedFixes = [] } = {}) {
    super(message);
    this.code = code;
    this.stage = stage;
    this.subject = subject;
    this.evidence = evidence;
    this.supportedFixes = supportedFixes;
    this.diagnostics = [{
      code,
      severity: 'error',
      message,
      subject: { surface: 'story-choreography', ...subject },
      evidence,
      supportedFixes,
    }];
  }
}

export function failChoreography(code, stage, message, options = {}) {
  throw new StoryChoreographyError(message, { code, stage, ...options });
}

function checkTimestamp(value, duration, label) {
  if (!Number.isFinite(value) || value < 0 || value > duration) {
    failChoreography('story/invalid-timing', 'manifest', `story ${label} (${value}) must be between 0 and duration (${duration}).`, {
      subject: { path: `/story/${label}` },
      evidence: { value, duration },
      supportedFixes: [`set ${label} within 0..${duration}`],
    });
  }
}

export function validatePortableSourcePath(filePath, pointer = '/story/detail/path') {
  const parts = typeof filePath === 'string' ? filePath.split('/') : [];
  if (
    typeof filePath !== 'string'
    || !filePath.trim()
    || path.isAbsolute(filePath)
    || filePath.includes('\\')
    || parts.some((segment) => segment === '' || segment === '.' || segment === '..')
    || /[\0\r\n:]/.test(filePath)
  ) {
    failChoreography('story/invalid-source-path', 'manifest', `Invalid story.detail path "${filePath}".`, {
      subject: { path: pointer },
      supportedFixes: ['use a clean POSIX workspace-relative path without "." or ".."'],
    });
  }
}

export function readLocalSourceLines(filePath, { baseDir, repoRoot, requireSource = false, onRead } = {}) {
  validatePortableSourcePath(filePath);
  const roots = [repoRoot, baseDir].filter(Boolean);
  for (const root of roots) {
    const resolvedRoot = path.resolve(root);
    const candidate = path.resolve(resolvedRoot, ...filePath.split('/'));
    const check = containedBy(resolvedRoot, candidate);
    if (check.status !== 'match') continue;
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    const text = fs.readFileSync(candidate, 'utf8');
    if (text.includes('\0')) {
      failChoreography('story/source-not-found', 'views', `story.detail target "${filePath}" is a binary file.`, {
        subject: { path: filePath },
        supportedFixes: ['cite a text source file'],
      });
    }
    onRead?.(candidate);
    return text.split(/\r?\n/);
  }
  if (requireSource) {
    failChoreography('story/source-not-found', 'views', `Could not read source file "${filePath}" from ${repoRoot || baseDir || 'workspace'}.`, {
      subject: { path: filePath },
      supportedFixes: ['cite an existing text file relative to --repo-root or the choreography directory'],
    });
  }
  return null;
}

function requiredMotionDuration(step) {
  const enterCount = Array.isArray(step.enter) ? step.enter.length : (step.enter?.nodes?.length || 0);
  const connectCount = Array.isArray(step.connect) ? step.connect.length : (step.connect?.edges?.length || 0);
  const traceEdges = step.trace?.edges?.length || 0;
  const travel = step.trace?.travel ?? 1.4;
  const enterStagger = Array.isArray(step.enter) ? 0.3 : (step.enter?.stagger ?? 0.3);
  const connectStagger = Array.isArray(step.connect) ? 0.35 : (step.connect?.stagger ?? 0.35);
  return Math.max(
    enterCount ? 0.3 + (enterCount - 1) * enterStagger + 1.05 : 0,
    connectCount ? (step.enter ? 0.9 : 0.4) + (connectCount - 1) * connectStagger + 1.1 : 0,
    traceEdges ? (step.connect ? 1.5 : step.enter ? 1.05 : 0.55)
      + (traceEdges - 1) * (step.trace.action === 'parallel' ? 0.2 : travel + 0.2) + travel + 0.35 : 0,
  );
}

function estimateStepDuration(step) {
  if (step.duration !== undefined) return step.duration;
  const units = [...`${step.title || ''} ${step.body || ''}`].reduce(
    (sum, ch) => sum + (/[\u2E80-\uFFFF]/.test(ch) ? 1 : 0.58),
    0,
  );
  let dur = Math.max(4.5, Math.min(9.5, Number((2.2 + units / 9).toFixed(1))));
  const enterCount = Array.isArray(step.enter) ? step.enter.length : (step.enter?.nodes?.length || 0);
  const connectCount = Array.isArray(step.connect) ? step.connect.length : (step.connect?.edges?.length || 0);
  const traceEdges = step.trace?.edges?.length || 0;
  const travel = step.trace?.travel ?? 1.4;
  const traceSpan = traceEdges
    ? (step.trace.action === 'parallel' ? travel + 0.6 : traceEdges * (travel + 0.25))
    : 0;
  const motionNeed = (step.transition ? 1.5 : 0)
    + (enterCount ? 0.5 + enterCount * 0.25 : 0)
    + (connectCount ? 0.6 + connectCount * 0.3 : 0)
    + traceSpan
    + (step.detail ? 2.0 : 0);
  if (motionNeed > 0) dur = Math.max(dur, Number((motionNeed + 1.2).toFixed(1)));
  return roundTime(Math.max(Math.min(20, dur), requiredMotionDuration(step)));
}

function normalizeStepBeat(step, index, viewId, t0, tEnd, buckets) {
  if (step.transition) {
    buckets.transitions.push({
      from: step.transition.from,
      to: viewId,
      at: t0,
      duration: step.transition.duration ?? 1.4,
      shared: step.transition.shared,
      isPair: false,
    });
  }
  if (step.enter) {
    const nodes = Array.isArray(step.enter) ? step.enter : step.enter.nodes;
    const stagger = Array.isArray(step.enter) ? 0.3 : (step.enter.stagger ?? 0.3);
    buckets.enter.push({ view: viewId, nodes, at: roundTime(t0 + 0.3), stagger });
  }
  if (step.connect) {
    const edges = Array.isArray(step.connect) ? step.connect : step.connect.edges;
    const stagger = Array.isArray(step.connect) ? 0.35 : (step.connect.stagger ?? 0.35);
    buckets.connect.push({ view: viewId, edges, at: roundTime(t0 + (step.enter ? 0.9 : 0.4)), stagger });
  }
  if (step.relabel) {
    for (const entry of step.relabel) {
      buckets.relabel.push({ view: viewId, node: entry.node, label: entry.label, subtitle: entry.subtitle, at: roundTime(t0 + 0.45) });
    }
  }
  if (step.fade) {
    buckets.fade.push({ view: viewId, ...step.fade, at: roundTime(t0 + 0.35) });
  }
  if (step.focus) {
    const nodes = Array.isArray(step.focus) ? step.focus : step.focus.nodes;
    const area = Array.isArray(step.focus) ? (step.detail ? 'left' : 'center') : (step.focus.area || (step.detail ? 'left' : 'center'));
    buckets.focus.push({ view: viewId, nodes, at: roundTime(t0 + 0.15), area, fromStep: true });
  }
  if (step.trace) {
    const travel = step.trace.travel ?? 1.4;
    const action = step.trace.action || 'trace';
    const hop0 = roundTime(t0 + (step.connect ? 1.5 : step.enter ? 1.05 : 0.55));
    const times = step.trace.edges.map((_, idx) => roundTime(
      hop0 + (action === 'parallel' ? idx * 0.2 : idx * (travel + 0.2)),
    ));
    const end = Math.max(times.at(-1) + 0.2, Math.min(roundTime(tEnd - 0.1), roundTime(times.at(-1) + travel + 0.25)));
    buckets.traces.push({
      ...(step.trace.id ? { id: step.trace.id } : {}),
      view: viewId,
      edges: step.trace.edges,
      times,
      end,
      travel,
    });
  }
  if (step.metrics) {
    for (const metric of step.metrics) {
      buckets.metrics.push({ ...metric, view: viewId, at: roundTime(t0 + 0.75) });
    }
  }
  if (step.detail) {
    buckets.details.push({ ...step.detail, view: viewId, start: t0, end: tEnd });
  }
}

function validateDetailEntry(detail, index, duration, { loadSourceLines, baseDir, repoRoot, requireDetailSource }) {
  checkTimestamp(detail.start, duration, `detail[${index}]/start`);
  checkTimestamp(detail.end, duration, `detail[${index}]/end`);
  if (detail.start >= detail.end) {
    failChoreography('story/invalid-timing', 'manifest', `story detail[${index}] start (${detail.start}) must be less than end (${detail.end}).`, {
      subject: { path: `/story/details/${index}` },
      supportedFixes: ['set detail.start strictly before detail.end'],
    });
  }
  for (const [si, sel] of (detail.selections || []).entries()) {
    checkTimestamp(sel.at, duration, `detail[${index}]/selections/${si}/at`);
  }
  validatePortableSourcePath(detail.path, `/story/details/${index}/path`);
  const fileLines = loadSourceLines
    ? loadSourceLines(detail)
    : readLocalSourceLines(detail.path, { baseDir, repoRoot, requireSource: requireDetailSource });

  if (fileLines) {
    const checkLineRange = (line, where) => {
      if (!Number.isInteger(line) || line < 1 || line > fileLines.length) {
        failChoreography('story/source-line-out-of-range', 'views', `story.detail ${where} line ${line} is outside "${detail.path}" (1..${fileLines.length}).`, {
          subject: { path: detail.path, line, maxLine: fileLines.length },
          supportedFixes: [`cite line numbers between 1 and ${fileLines.length}`],
        });
      }
    };
    for (const line of detail.lines) checkLineRange(line, 'lines');
    for (const line of detail.highlight || []) checkLineRange(line, 'highlight');
    for (const [si, sel] of (detail.selections || []).entries()) {
      for (const line of sel.lines) checkLineRange(line, `selections/${si}/lines`);
    }
  }
  return { ...detail, fileLines };
}

function resolveStepTimings(rawSpec) {
  const stepsIn = rawSpec.steps || [];
  const hasExplicitTiming = rawSpec.duration !== undefined && stepsIn.every((s) => s.at !== undefined);
  const steps = [];

  if (hasExplicitTiming) {
    let prevAt = -1;
    for (const [i, step] of stepsIn.entries()) {
      checkTimestamp(step.at, rawSpec.duration, `steps/${i}/at`);
      if (step.at >= rawSpec.duration) {
        failChoreography('story/invalid-timing', 'manifest', `story step ${i} at=${step.at} must be strictly less than duration ${rawSpec.duration}.`, {
          subject: { path: `/story/steps/${i}/at` },
          supportedFixes: ['place every step start before story.duration'],
        });
      }
      if (step.at <= prevAt) {
        failChoreography('story/invalid-timing', 'manifest', `story.steps timestamps must increase strictly (step ${i} at=${step.at} <= ${prevAt}).`, {
          subject: { path: `/story/steps/${i}/at` },
          supportedFixes: ['sort steps in strictly ascending order of at'],
        });
      }
      prevAt = step.at;
    }
    for (const [i, step] of stepsIn.entries()) {
      const nextAt = i + 1 < stepsIn.length ? stepsIn[i + 1].at : rawSpec.duration;
      steps.push({ ...step, tEnd: step.duration === undefined ? nextAt : roundTime(step.at + step.duration) });
    }
  } else {
    let cursor = 0;
    for (const [i, step] of stepsIn.entries()) {
      const start = step.at !== undefined ? step.at : cursor;
      if (i > 0 && start <= steps[i - 1].at) {
        failChoreography('story/invalid-timing', 'manifest', `story.steps timestamps must increase strictly (step ${i} at=${start} <= ${steps[i - 1].at}).`, {
          subject: { path: `/story/steps/${i}/at` },
          supportedFixes: ['omit step.at for auto-timing or keep step.at strictly increasing'],
        });
      }
      const stepDur = estimateStepDuration(step);
      const tEnd = roundTime(start + stepDur);
      steps.push({ ...step, at: roundTime(start), tEnd });
      cursor = tEnd;
    }
  }

  const duration = rawSpec.duration !== undefined ? rawSpec.duration : Math.max(4, roundTime(steps.at(-1)?.tEnd ?? 6));
  for (const [i, step] of steps.entries()) {
    const boundary = steps[i + 1]?.at ?? duration;
    if (step.duration !== undefined && step.tEnd > boundary) {
      failChoreography('story/invalid-timing', 'manifest', `story step ${i} ends at ${step.tEnd}, after its boundary ${boundary}.`, {
        subject: { path: `/story/steps/${i}/duration` },
        supportedFixes: ['shorten step.duration, move the next step, or increase story.duration'],
      });
    }
    step.tEnd = Math.min(step.tEnd, boundary);
  }
  if (hasExplicitTiming === false && rawSpec.duration !== undefined && steps.at(-1)?.at >= duration) {
    failChoreography('story/invalid-timing', 'manifest', `story steps exceed declared duration (${duration}).`, {
      subject: { path: '/story/duration' },
      supportedFixes: ['increase story.duration or omit it to derive duration from steps'],
    });
  }
  if (steps.length && steps.at(-1).tEnd > duration) {
    steps[steps.length - 1].tEnd = duration;
  }
  return { steps, duration };
}

function resolveStageWindows(rawSpec, steps, duration, declaredViews, ensureDeclared) {
  if (Array.isArray(rawSpec.stages) && rawSpec.stages.length) {
    for (const [i, stage] of rawSpec.stages.entries()) ensureDeclared(stage.view, `stages/${i}/view`);
    return rawSpec.stages.map((s) => ({ ...s }));
  }
  let activeView = declaredViews.length === 1 ? declaredViews[0] : null;
  const visits = [];
  for (const [i, step] of steps.entries()) {
    const resolvedView = step.view || activeView;
    if (!resolvedView) {
      failChoreography('story/unknown-view', 'manifest', `story step ${i} needs "view" when story.stages is omitted across multiple views.`, {
        subject: { path: `/story/steps/${i}/view` },
        supportedFixes: ['set view on each step or declare story.stages'],
      });
    }
    ensureDeclared(resolvedView, `steps/${i}/view`);
    activeView = resolvedView;
    const previous = visits.at(-1);
    if (previous?.view !== resolvedView) {
      if (previous) previous.end = step.at;
      visits.push({ view: resolvedView, start: step.at, end: step.tEnd });
    } else previous.end = step.tEnd;
  }
  if (visits.length) {
    visits[0].start = 0;
    visits.at(-1).end = duration;
  }
  const windows = new Map();
  for (const visit of visits) {
    if (!windows.has(visit.view)) {
      windows.set(visit.view, { ...visit });
    } else {
      const stage = windows.get(visit.view);
      stage.windows ??= [{ start: stage.start, end: stage.end }];
      stage.windows.push({ start: visit.start, end: visit.end });
      stage.end = visit.end;
    }
  }
  return [...windows.values()];
}

const STEP_BEAT_FIELDS = ['transition', 'enter', 'connect', 'relabel', 'fade', 'focus', 'trace', 'metrics', 'detail'];

function createInitialBuckets(rawSpec) {
  return {
    transitions: [
      ...(rawSpec.pair ? [{
        from: rawSpec.pair.before,
        to: rawSpec.pair.after,
        at: rawSpec.pair.at,
        until: rawSpec.pair.until,
        duration: rawSpec.pair.duration,
        shared: rawSpec.pair.shared,
        isPair: true,
      }] : []),
      ...(rawSpec.transitions || []).map((t) => ({ ...t, isPair: false })),
    ],
    relabel: [...(rawSpec.relabel || [])],
    enter: [...(rawSpec.enter || [])],
    connect: [...(rawSpec.connect || [])],
    fade: [...(rawSpec.fade || [])],
    focus: [...(rawSpec.focus || [])],
    traces: [...(rawSpec.traces || [])],
    metrics: [...(rawSpec.metrics || [])],
    details: [
      ...(rawSpec.detail ? [rawSpec.detail] : []),
      ...(rawSpec.details || []),
    ],
  };
}

function collectNormalizedBuckets(rawSpec, steps, stages, duration, ensureStaged) {
  const buckets = createInitialBuckets(rawSpec);
  let activeStepView = stages[0]?.view || '';
  for (const [i, step] of steps.entries()) {
    const viewId = step.view || activeStepView;
    ensureStaged(viewId, `steps/${i}/view`);
    activeStepView = viewId;
    step.view = viewId;
    if (STEP_BEAT_FIELDS.some((key) => Boolean(step[key]))) {
      normalizeStepBeat(step, i, viewId, step.at, step.tEnd, buckets);
    }
  }

  const stageById = new Map(stages.map((s) => [s.view, s]));
  if (!rawSpec.stages?.length && stages.length) {
    for (const tr of buckets.transitions) {
      const fromStage = stageById.get(tr.from);
      const toStage = stageById.get(tr.to);
      if (fromStage && toStage) {
        fromStage.end = Math.max(fromStage.end ?? duration, tr.at);
        toStage.start = Math.min(toStage.start ?? tr.at, tr.at);
      }
    }
  }
  return { buckets, stageById };
}

function validateTransitionAndBucketTimings(stages, stageById, buckets, duration, ensureStaged) {
  for (const [i, stage] of stages.entries()) {
    const start = stage.start ?? 0;
    const end = stage.end ?? duration;
    checkTimestamp(start, duration, `stages/${i}/start`);
    checkTimestamp(end, duration, `stages/${i}/end`);
    if (start >= end) {
      failChoreography('story/invalid-timing', 'manifest', `story stage "${stage.view}" start (${start}) must be less than end (${end}).`, {
        subject: { path: `/story/stages/${i}` },
        supportedFixes: ['set stage.start strictly earlier than stage.end'],
      });
    }
  }

  for (const [i, tr] of buckets.transitions.entries()) {
    const prefix = tr.isPair ? 'pair' : `transitions/${i}`;
    ensureStaged(tr.from, `${prefix}/from`);
    ensureStaged(tr.to, `${prefix}/to`);
    if (tr.from === tr.to) {
      failChoreography('story/invalid-timing', 'manifest', `story transition ${prefix} from and to must name different views.`, {
        subject: { view: tr.from },
        supportedFixes: ['assign separate source and target views'],
      });
    }
    checkTimestamp(tr.at, duration, `${prefix}/at`);
    const until = tr.until ?? stageById.get(tr.to)?.end ?? duration;
    checkTimestamp(until, duration, `${prefix}/until`);
    if (tr.at >= until) {
      failChoreography('story/invalid-timing', 'manifest', `story ${prefix}.at (${tr.at}) must be less than until (${until}).`, {
        subject: { path: `/story/${prefix}` },
        supportedFixes: ['set transition at strictly earlier than until'],
      });
    }
  }

  for (const key of ['relabel', 'enter', 'connect', 'fade', 'focus', 'metrics']) {
    for (const [i, op] of buckets[key].entries()) {
      ensureStaged(op.view, `${key}/${i}/view`);
      checkTimestamp(op.at, duration, `${key}/${i}/at`);
    }
  }
}

function validateTracesAndDetails(buckets, duration, ensureStaged, detailOptions) {
  for (const [i, trace] of buckets.traces.entries()) {
    ensureStaged(trace.view, `traces/${i}/view`);
    if (trace.edges.length !== trace.times.length) {
      failChoreography('story/trace-mismatch', 'manifest', `story trace ${i} has ${trace.edges.length} edge(s) but ${trace.times.length} timestamp(s).`, {
        subject: { path: `/story/traces/${i}` },
        supportedFixes: ['give every trace edge one matching timestamp in times[]'],
      });
    }
    for (const [ti, time] of trace.times.entries()) checkTimestamp(time, duration, `traces/${i}/times/${ti}`);
    if (trace.end !== undefined) {
      checkTimestamp(trace.end, duration, `traces/${i}/end`);
      if (trace.end <= Math.max(...trace.times)) {
        failChoreography('story/invalid-timing', 'manifest', `story trace ${i} end (${trace.end}) must follow all hop timestamps.`, {
          subject: { path: `/story/traces/${i}/end` },
          supportedFixes: ['set trace.end after the last hop time'],
        });
      }
    }
  }

  const normalizedDetails = buckets.details
    .map((detail, i) => {
      ensureStaged(detail.view, `details/${i}/view`);
      return validateDetailEntry(detail, i, duration, detailOptions);
    })
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < normalizedDetails.length; i += 1) {
    if (normalizedDetails[i].start < normalizedDetails[i - 1].end) {
      failChoreography('story/invalid-timing', 'manifest', `story details[${i}] start (${normalizedDetails[i].start}) overlaps previous detail end (${normalizedDetails[i - 1].end}).`, {
        subject: { path: `/story/details/${i}` },
        supportedFixes: ['keep multiple code detail panels in disjoint time windows'],
      });
    }
  }
  return normalizedDetails;
}

export function normalizeChoreographySpec(rawSpec, {
  declaredViews,
  loadSourceLines = null,
  baseDir = null,
  repoRoot = null,
  requireDetailSource = false,
} = {}) {
  const viewSet = new Set(declaredViews);
  const ensureDeclared = (viewId, field) => {
    if (!viewSet.has(viewId)) {
      failChoreography('story/unknown-view', 'manifest', `story ${field} references unknown view "${viewId}".`, {
        subject: { view: viewId, field },
        supportedFixes: ['declare the view id under views or update the reference'],
      });
    }
  };

  const { steps, duration } = resolveStepTimings(rawSpec);
  const stages = resolveStageWindows(rawSpec, steps, duration, declaredViews, ensureDeclared);
  const stageById = new Map(stages.map((s) => [s.view, s]));
  const ensureStaged = (viewId, field) => {
    ensureDeclared(viewId, field);
    if (!stageById.has(viewId)) {
      failChoreography('story/unknown-view', 'manifest', `story ${field} references view "${viewId}", which is not listed in story.stages.`, {
        subject: { view: viewId, field },
        supportedFixes: [`add { "view": "${viewId}" } to story.stages`],
      });
    }
  };

  const { buckets } = collectNormalizedBuckets(rawSpec, steps, stages, duration, ensureStaged);
  validateTransitionAndBucketTimings(stages, stageById, buckets, duration, ensureStaged);
  const normalizedDetails = validateTracesAndDetails(buckets, duration, ensureStaged, {
    loadSourceLines, baseDir, repoRoot, requireDetailSource,
  });

  const viewCallouts = {};
  for (const view of rawSpec.views || []) {
    if (rawSpec.callouts || view.callouts) {
      viewCallouts[view.id] = { ...(rawSpec.callouts || {}), ...(view.callouts || {}) };
    }
  }

  return {
    id: rawSpec.id || 'walkthrough',
    title: rawSpec.title,
    caption: rawSpec.caption || rawSpec.question || '',
    locale: rawSpec.locale || '',
    chrome: rawSpec.chrome || 'story',
    badge: rawSpec.badge || '',
    statusBadges: rawSpec.statusBadges || 'auto',
    callouts: rawSpec.callouts || null,
    viewCallouts,
    duration,
    loop: rawSpec.loop !== false,
    allowStructuralTrace: Boolean(rawSpec.allowStructuralTrace),
    stills: rawSpec.stills || [],
    stages,
    transitions: buckets.transitions,
    relabel: buckets.relabel,
    enter: buckets.enter,
    connect: buckets.connect,
    fade: buckets.fade,
    focus: buckets.focus,
    traces: buckets.traces,
    metrics: buckets.metrics,
    details: normalizedDetails,
    steps,
  };
}

function requirePartNode(part, nodeId, kind, index, viewId, supportedFix = 'cite node ids declared in that view') {
  if (!part.nodes.some((n) => n.id === nodeId)) {
    failChoreography('story/unknown-node', 'views', `story ${kind}[${index}] references unknown node "${nodeId}" in view "${viewId}".`, {
      subject: { view: viewId, node: nodeId },
      supportedFixes: [supportedFix],
    });
  }
}

function requirePartEdge(part, edgeRef, kind, index, viewId, supportedFix) {
  if (!part.paths.has(edgeRef)) {
    failChoreography('story/unknown-edge', 'views', `story ${kind}[${index}] references unknown edge "${edgeRef}" in view "${viewId}".`, {
      subject: { view: viewId, edge: edgeRef },
      supportedFixes: [supportedFix],
    });
  }
  return part.paths.get(edgeRef);
}

function validateTraceAgainstPart(trace, ti, part, allowStructuralTrace) {
  if (STATIC_RELATION_TYPES.has(part.type) && !allowStructuralTrace) {
    failChoreography('story/static-structure-trace', 'views', `story trace[${ti}] cannot animate live tokens on static ${part.type} view "${trace.view}".`, {
      subject: { view: trace.view, type: part.type },
      supportedFixes: ['use connect or focus for static structural diagrams (erd, class, tree)'],
    });
  }
  for (const edgeRef of trace.edges) {
    const route = requirePartEdge(part, edgeRef, 'trace', ti, trace.view, 'cite an authored edge id or "from~to" present in that view');
    const isRemoved = part.removedEdges.has(route.id)
      || part.removedEdges.has(edgeRef)
      || part.removedNodes.has(route.from)
      || part.removedNodes.has(route.to);
    if (isRemoved) {
      failChoreography('story/removed-transfer', 'views', `story trace[${ti}] edge "${edgeRef}" is marked removed and cannot animate live transfer tokens.`, {
        subject: { view: trace.view, edge: edgeRef },
        supportedFixes: ['use connect or fade for removed elements instead of traces'],
      });
    }
  }
}

export function validatePlanAgainstParts(plan, parts) {
  for (const [mi, item] of plan.metrics.entries()) {
    requirePartNode(parts[item.view], item.node, 'metrics', mi, item.view, 'cite a node id that renders in that view');
  }
  for (const [fi, op] of plan.focus.entries()) {
    for (const nodeId of op.nodes) requirePartNode(parts[op.view], nodeId, 'focus', fi, op.view);
  }
  for (const [di, detail] of plan.details.entries()) {
    for (const nodeId of detail.nodes) requirePartNode(parts[detail.view], nodeId, 'detail', di, detail.view);
  }
  for (const [ti, tr] of plan.transitions.entries()) {
    const fromPart = parts[tr.from];
    const toPart = parts[tr.to];
    for (const shared of tr.shared) {
      const targetId = shared.targetId || shared.id;
      if (!fromPart.nodes.some((n) => n.id === shared.id) || !toPart.nodes.some((n) => n.id === targetId)) {
        failChoreography('story/unknown-node', 'views', `story transition[${ti}] shared node "${shared.id}" must exist in both "${tr.from}" and "${tr.to}".`, {
          subject: { node: shared.id, before: tr.from, after: tr.to },
          supportedFixes: ['include the shared node id in both source and target views'],
        });
      }
    }
  }
  for (const [ri, op] of plan.relabel.entries()) {
    requirePartNode(parts[op.view], op.node, 'relabel', ri, op.view, 'cite an existing node id in that view');
  }
  for (const [oi, op] of plan.enter.entries()) {
    for (const nodeId of op.nodes) requirePartNode(parts[op.view], nodeId, 'enter', oi, op.view, 'cite an existing node id in that view');
  }
  for (const [ci, op] of plan.connect.entries()) {
    for (const edgeRef of op.edges) {
      requirePartEdge(parts[op.view], edgeRef, 'connect', ci, op.view, 'pass an authored edge id or "from~to" endpoint key present in that view');
    }
  }
  for (const [fi, op] of plan.fade.entries()) {
    const part = parts[op.view];
    for (const nodeId of op.nodes || []) requirePartNode(part, nodeId, 'fade', fi, op.view);
    for (const edgeRef of op.edges || []) requirePartEdge(part, edgeRef, 'fade', fi, op.view, 'cite an authored edge id or "from~to" present in that view');
  }
  for (const [ti, trace] of plan.traces.entries()) {
    validateTraceAgainstPart(trace, ti, parts[trace.view], plan.allowStructuralTrace);
  }
}

function clipText(value, limit) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function resolveShotCodeDetail(note, facts) {
  if (!note.code || !facts.nodes) return null;
  const targetNode = facts.nodes.find((n) => n.id === (note.code.node || note.anchor));
  const source = targetNode?.sources?.[note.code.source || 0];
  if (!source?.path) return null;
  const fromLine = note.code.fromLine ?? source.line ?? 1;
  const toLine = note.code.toLine ?? Math.min(source.endLine || fromLine + 10, fromLine + 10);
  const lines = [];
  for (let line = fromLine; line <= toLine && lines.length < MAX_BRIEF_EXCERPT_LINES; line += 1) lines.push(line);
  if (!lines.length) return null;
  const highlight = (note.code.emphasis || []).filter((line) => lines.includes(line));
  return {
    nodes: [targetNode.id],
    title: `${source.path}`,
    path: source.path,
    lines,
    ...(highlight.length ? { highlight } : {}),
  };
}

function buildBriefShotBeat(shot, view, viewId, isStatic, facts) {
  const note = shot.annotations?.[view.note] || {};
  const beat = {
    view: viewId,
    duration: Math.max(4.5, Math.min(10, Math.round((note.until - note.at + 0.5) || 6))),
    title: clipText(note.title || shot.headline, 120),
    body: clipText(note.caption || note.body || shot.caption, 240),
  };
  if (view.nodes?.length) beat.focus = { nodes: view.nodes, area: 'center' };
  const traceEdges = (view.edges || []).filter((id) => shot.edgeModes?.[id] !== 'relation');
  if (traceEdges.length && !isStatic) beat.trace = { edges: traceEdges, action: 'trace', travel: 1.2 };
  const detail = resolveShotCodeDetail(note, facts);
  if (detail) {
    beat.detail = detail;
    if (beat.focus) beat.focus.area = 'left';
  }
  beat.duration = Math.max(beat.duration, roundTime(requiredMotionDuration(beat)));
  return beat;
}

export function fromStoryBriefToChoreography(brief, facts, { viewId = 'main', diagramType = 'workflow', locale = 'en' } = {}) {
  const compiled = compileBrief(brief, facts);
  const steps = [];
  const isStatic = STATIC_RELATION_TYPES.has(diagramType);

  const establish = compiled.shots[0];
  if (establish) {
    steps.push({
      view: viewId,
      duration: Math.min(5, Math.max(3.5, establish.duration || 4)),
      title: clipText(establish.headline || brief.title, 120),
      body: clipText(establish.caption || brief.intro, 240),
    });
  }

  for (const shot of compiled.shots.slice(1, -1)) {
    const views = shot.views?.length ? shot.views : [{ nodes: shot.nodes, edges: shot.edges, note: 0 }];
    for (const view of views) steps.push(buildBriefShotBeat(shot, view, viewId, isStatic, facts));
  }

  const resolve = compiled.shots.at(-1);
  if (resolve && resolve.caption && resolve.caption !== steps.at(-1)?.body) {
    steps.push({
      view: viewId,
      duration: 4.5,
      title: clipText(resolve.headline || brief.closingTitle || brief.title, 120),
      body: clipText(resolve.caption || brief.outro, 240),
    });
  }

  return {
    schema_version: 1,
    kind: 'story-choreography',
    id: 'walkthrough',
    title: clipText(brief.title, 160),
    caption: clipText(brief.intro, 600),
    locale,
    chrome: 'story',
    views: [{ id: viewId, type: diagramType, input: `${viewId}.html` }],
    steps,
  };
}
