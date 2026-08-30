import { createHash } from 'node:crypto';
import { QUALITY_CONTRACT } from './quality-contract.mjs';

function round(value) {
  return Math.round(value * 1000) / 1000;
}
function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function infrastructureDiagnostic(diagnostic) {
  const code = diagnostic?.code || 'internal/unclassified';
  return code.startsWith('internal/')
    || code === 'viewer/chrome-unavailable'
    || code === 'viewer/chrome-capability'
    || code === 'viewer/visual-check-runtime'
    || code === 'preflight/receipt-invalid';
}

export function diagnosticFingerprint(diagnostics = []) {
  const normalized = (Array.isArray(diagnostics) ? diagnostics : []).map((diagnostic) => ({
    code: diagnostic?.code || 'internal/unclassified',
    subject: diagnostic?.subject || {},
    evidence: diagnostic?.evidence || {},
  }));
  return createHash('sha256').update(canonicalJson(normalized)).digest('hex');
}

function progressAttempt(attempt, stageOrder) {
  const diagnostics = Array.isArray(attempt?.diagnostics) ? attempt.diagnostics : [];
  const stage = typeof attempt?.stage === 'string' ? attempt.stage : 'unknown';
  const errorCount = Number.isInteger(attempt?.errorCount) && attempt.errorCount >= 0
    ? attempt.errorCount
    : diagnostics.length;
  return {
    stage,
    stageRank: stageOrder.indexOf(stage),
    errorCount,
    diagnosticFingerprint: attempt?.diagnosticFingerprint || diagnosticFingerprint(diagnostics),
    repairMode: attempt?.repairMode === 'structural-reflow' ? 'structural-reflow' : 'focused',
    infrastructureFailure: diagnostics.length > 0
      && diagnostics.every(infrastructureDiagnostic),
  };
}

export function evaluateRepairProgress(attempts = [], {
  stageOrder = QUALITY_CONTRACT.repairPolicy.stageOrder,
  maxConsecutiveNonImprovingAttempts = QUALITY_CONTRACT.repairPolicy.maxConsecutiveNonImprovingAttempts,
  maxFocusedAttemptsBeforeStructuralReflow = QUALITY_CONTRACT.repairPolicy.maxFocusedAttemptsBeforeStructuralReflow,
  maxStructuralReflows = QUALITY_CONTRACT.repairPolicy.maxStructuralReflows,
  maxConsecutiveIdenticalAttempts = QUALITY_CONTRACT.repairPolicy.maxConsecutiveIdenticalAttempts,
  maxTotalAttempts = QUALITY_CONTRACT.repairPolicy.maxTotalAttempts,
} = {}) {
  if (!Array.isArray(attempts)) throw new Error('Repair progress attempts must be an array.');
  const normalized = attempts.map((attempt) => progressAttempt(attempt, stageOrder));
  const comparable = normalized.filter((attempt) => !attempt.infrastructureFailure);
  const scored = comparable.length ? comparable : normalized;
  const ignoredInfrastructureAttempts = normalized.length - scored.length;
  let best = scored[0] || null;
  let consecutiveNonImprovingAttempts = 0;
  for (const attempt of scored.slice(1)) {
    const reachedDeeperStage = attempt.stageRank > best.stageRank;
    const reducedErrorsAtBestStage = attempt.stageRank === best.stageRank
      && attempt.errorCount < best.errorCount;
    if (reachedDeeperStage || reducedErrorsAtBestStage) {
      best = attempt;
      consecutiveNonImprovingAttempts = 0;
    } else {
      consecutiveNonImprovingAttempts += 1;
    }
  }
  const currentStage = scored.at(-1)?.stage;
  const focusedAttemptCount = currentStage
    ? scored.slice().reverse().findIndex((attempt) => attempt.stage !== currentStage)
    : 0;
  const normalizedFocusedAttemptCount = focusedAttemptCount === -1
    ? scored.length
    : focusedAttemptCount;
  const current = scored.at(-1) || null;
  const structuralReflowCount = scored.filter((attempt) => attempt.repairMode === 'structural-reflow').length;
  let consecutiveIdenticalAttempts = 0;
  if (current) {
    for (const attempt of scored.slice().reverse()) {
      if (attempt.stage !== current.stage
        || attempt.errorCount !== current.errorCount
        || attempt.diagnosticFingerprint !== current.diagnosticFingerprint) break;
      consecutiveIdenticalAttempts += 1;
      if (attempt.repairMode === 'structural-reflow') break;
    }
  }
  const unresolved = (current?.errorCount || 0) > 0;
  const reflowThresholdReached = consecutiveNonImprovingAttempts >= maxConsecutiveNonImprovingAttempts
    || normalizedFocusedAttemptCount >= maxFocusedAttemptsBeforeStructuralReflow;
  const reflowsExhausted = structuralReflowCount >= maxStructuralReflows;
  const totalAttemptsExhausted = scored.length >= maxTotalAttempts;
  const repeatedAfterReflows = reflowsExhausted
    && consecutiveIdenticalAttempts >= maxConsecutiveIdenticalAttempts;
  const shouldStop = unresolved && (totalAttemptsExhausted || repeatedAfterReflows);
  const shouldReflow = unresolved
    && !shouldStop
    && !reflowsExhausted
    && reflowThresholdReached;
  return {
    stageOrder: [...stageOrder],
    attempts: normalized,
    current,
    best,
    ignoredInfrastructureAttempts,
    consecutiveNonImprovingAttempts,
    consecutiveIdenticalAttempts,
    focusedAttemptCount: normalizedFocusedAttemptCount,
    structuralReflowCount,
    maxStructuralReflows,
    maxTotalAttempts,
    shouldStop,
    shouldReflow,
    reason: shouldStop
      ? totalAttemptsExhausted
        ? `Stop after ${scored.length} repair attempts: the fail-closed total attempt budget is exhausted.`
        : `Stop after ${structuralReflowCount} structural reflows and ${consecutiveIdenticalAttempts} identical unresolved attempts.`
      : shouldReflow
        ? `Switch to semantics-preserving structural reflow before stopping: ${consecutiveNonImprovingAttempts} non-improving attempts, ${normalizedFocusedAttemptCount} focused attempts at ${currentStage}, and ${structuralReflowCount}/${maxStructuralReflows} reflows used.`
        : 'Continue only with a diagnosed, semantics-preserving repair.',
  };
}

function authoredViewBox(candidate) {
  const value = candidate?.meta?.viewBox;
  if (!Array.isArray(value) || value.length !== 2 || !value.every((entry) => Number.isFinite(entry) && entry > 0)) {
    return null;
  }
  return value.map(round);
}

function containmentAdvice(candidate, preflight) {
  const viewports = Array.isArray(preflight?.containment?.viewports)
    ? preflight.containment.viewports
    : [];
  const failing = viewports.filter((viewport) => viewport?.ok !== true);
  if (!failing.length) return null;

  const worstOverflowX = Math.max(0, ...failing.map((viewport) => Number(viewport?.overflowXBy) || 0));
  const worstOverflowY = Math.max(0, ...failing.map((viewport) => Number(viewport?.overflowYBy) || 0));
  const constrained = [...failing].sort((left, right) => (
    (Number(left?.width) || Infinity) - (Number(right?.width) || Infinity)
      || (Number(left?.height) || Infinity) - (Number(right?.height) || Infinity)
  ))[0];
  const viewBox = authoredViewBox(candidate);
  const availableSvgHeight = Number(constrained?.readerLayout?.availableSvgHeight);
  const diagramWidth = Number(constrained?.diagramWidth);
  let viewBoxOptions;
  if (viewBox && availableSvgHeight > 0 && diagramWidth > 0) {
    const [width, height] = viewBox;
    const maximumHeightAtCurrentWidth = Math.max(1, Math.floor(
      width * availableSvgHeight / diagramWidth * 0.98,
    ));
    const minimumWidthAtCurrentHeight = Math.ceil(
      height * diagramWidth / availableSvgHeight / 0.98,
    );
    viewBoxOptions = {
      current: viewBox,
      compactHeight: [width, Math.min(height, maximumHeightAtCurrentWidth)],
      preserveHeight: [Math.max(width, minimumWidthAtCurrentHeight), height],
      maximumHeightAtCurrentWidth,
      minimumWidthAtCurrentHeight,
      note: 'compactHeight requires semantic-preserving reflow; preserveHeight must still pass the 6px desktop readability gate.',
    };
  }

  return {
    cause: worstOverflowY >= worstOverflowX
      ? 'desktop-height-budget-exceeded'
      : 'desktop-width-budget-exceeded',
    failingViewports: failing.map((viewport) => ({
      width: viewport.width,
      height: viewport.height,
      overflowXBy: Number(viewport.overflowXBy) || 0,
      overflowYBy: Number(viewport.overflowYBy) || 0,
      ...(Number.isFinite(viewport?.readerLayout?.availableSvgHeight)
        ? { availableSvgHeight: round(viewport.readerLayout.availableSvgHeight) }
        : {}),
    })),
    worstOverflow: { x: round(worstOverflowX), y: round(worstOverflowY) },
    ...(viewBoxOptions ? { viewBoxOptions } : {}),
  };
}

function finiteEvidenceValue(evidence, keys) {
  for (const key of keys) {
    const value = Number(evidence?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function viewBoxWidthConstraints(diagnostics) {
  const minimums = [];
  const maximums = [];
  for (const diagnostic of diagnostics) {
    const evidence = diagnostic?.evidence || {};
    const minimum = finiteEvidenceValue(evidence, [
      'minViewBoxWidth',
      'minimumViewBoxWidth',
      'requiredViewBoxWidth',
    ]);
    const maximum = finiteEvidenceValue(evidence, [
      'maxReadableViewBoxWidth',
      'maxViewBoxWidth',
    ]);
    if (minimum != null) minimums.push(minimum);
    if (maximum != null) maximums.push(maximum);
  }
  if (!minimums.length && !maximums.length) return null;
  const minViewBoxWidth = minimums.length ? Math.max(...minimums) : null;
  const maxReadableViewBoxWidth = maximums.length ? Math.min(...maximums) : null;
  const conflict = minViewBoxWidth != null
    && maxReadableViewBoxWidth != null
    && minViewBoxWidth > maxReadableViewBoxWidth;
  return {
    status: conflict ? 'conflict' : 'feasible',
    ...(minViewBoxWidth != null ? { minViewBoxWidth: round(minViewBoxWidth) } : {}),
    ...(maxReadableViewBoxWidth != null ? { maxReadableViewBoxWidth: round(maxReadableViewBoxWidth) } : {}),
  };
}

function isInfeasibleWidthFix(value) {
  return /reduce[^.]*viewbox width|viewbox width[^.]*at most/i.test(value);
}

function diagnosticActions(diagnostics, { widthConflict = false } = {}) {
  return diagnostics.map((diagnostic, index) => ({
    id: `diagnostic-${index + 1}`,
    code: diagnostic.code || 'internal/unclassified',
    subject: diagnostic.subject || {},
    evidence: diagnostic.evidence || {},
    supportedFixes: unique(diagnostic.supportedFixes || []).filter((fix) => (
      !widthConflict || !isInfeasibleWidthFix(fix)
    )),
  }));
}

function workflowRelationshipEndpoints(reference, edgeById) {
  const relationship = reference?.relationship || reference;
  const edge = edgeById.get(relationship?.id);
  const from = relationship?.from || edge?.from;
  const to = relationship?.to || edge?.to;
  return typeof from === 'string' && typeof to === 'string' ? { from, to } : null;
}

function workflowMainPathLaneAdvice(type, candidate, diagnostics) {
  if (type !== 'workflow' || candidate?.schema_version !== 2) return null;

  const mainPath = Array.isArray(candidate?.mainPath) ? candidate.mainPath : [];
  const mainPathEdges = new Set(mainPath.slice(1).map((nodeId, index) => (
    `${mainPath[index]}\u0000${nodeId}`
  )));
  const edgeById = new Map((Array.isArray(candidate?.edges) ? candidate.edges : [])
    .filter((edge) => typeof edge?.id === 'string')
    .map((edge) => [edge.id, edge]));
  const crossingTouchesMainPath = diagnostics.some((diagnostic) => {
    if (diagnostic?.code !== 'composition/proper-crossing') return false;
    return [diagnostic?.subject, diagnostic?.evidence?.otherRelationship].some((reference) => {
      const endpoints = workflowRelationshipEndpoints(reference, edgeById);
      return endpoints && mainPathEdges.has(`${endpoints.from}\u0000${endpoints.to}`);
    });
  });
  if (!crossingTouchesMainPath) return null;

  const nodeById = new Map((Array.isArray(candidate?.nodes) ? candidate.nodes : [])
    .filter((node) => typeof node?.id === 'string' && typeof node?.lane === 'string')
    .map((node) => [node.id, node]));
  const laneRuns = [];
  for (const nodeId of mainPath) {
    const lane = nodeById.get(nodeId)?.lane;
    if (!lane) return null;
    if (laneRuns.at(-1) !== lane) laneRuns.push(lane);
  }
  const seen = new Set();
  let laneReentries = 0;
  for (const lane of laneRuns) {
    if (seen.has(lane)) laneReentries += 1;
    seen.add(lane);
  }
  if (laneReentries < 2) return null;

  return {
    laneChanges: Math.max(0, laneRuns.length - 1),
    laneReentries,
    laneRuns,
    mainPath: [...mainPath],
  };
}

/**
 * Convert validation evidence into a bounded, semantics-preserving repair plan.
 * The plan is advisory: the unchanged deterministic and browser gates remain
 * the authority after an author edits the candidate.
 */
export function createRepairPlan({
  type,
  candidate,
  stage,
  diagnostics = [],
  preflight = null,
  attemptHistory = [],
  repairMode = 'focused',
} = {}) {
  const normalizedDiagnostics = Array.isArray(diagnostics) ? diagnostics : [];
  const currentDiagnosticFingerprint = diagnosticFingerprint(normalizedDiagnostics);
  const progress = evaluateRepairProgress([
    ...(Array.isArray(attemptHistory) ? attemptHistory : []),
    {
      stage,
      diagnostics: normalizedDiagnostics,
      diagnosticFingerprint: currentDiagnosticFingerprint,
      repairMode,
    },
  ]);
  const containment = containmentAdvice(candidate, preflight);
  const widthConstraints = viewBoxWidthConstraints(normalizedDiagnostics);
  const widthConflict = widthConstraints?.status === 'conflict';
  const workflowLaneReflow = workflowMainPathLaneAdvice(type, candidate, normalizedDiagnostics);
  const topologyReflowRequired = Boolean(workflowLaneReflow)
    && !progress.shouldStop
    && progress.structuralReflowCount < progress.maxStructuralReflows;
  const actions = diagnosticActions(normalizedDiagnostics, { widthConflict });
  if (topologyReflowRequired) {
    for (const action of actions) {
      if (action.code !== 'composition/proper-crossing') continue;
      action.supportedFixes = unique([
        'perform the mainPath structural reflow before adding or changing local route controls',
        ...action.supportedFixes,
      ]);
    }
  }
  if (widthConflict) {
    const safeConflictFixes = [
      'reflow or wrap the same semantic copy so the renderer minimum width and readability maximum width no longer conflict',
      'widen affected nodes or redistribute stages without reducing typography',
      'rerun deterministic validation to recompute the feasible width interval',
    ];
    const classifiedIndex = actions.findIndex((action) => (
      action.code === 'layout/viewbox-width-constraint-conflict'
    ));
    if (classifiedIndex === -1) {
      actions.unshift({
        id: 'viewbox-width-constraint-conflict',
        code: 'layout/viewbox-width-constraint-conflict',
        subject: { type, path: '/meta/viewBox/0' },
        evidence: { ...widthConstraints },
        supportedFixes: safeConflictFixes,
      });
    } else {
      const [classified] = actions.splice(classifiedIndex, 1);
      actions.unshift({
        ...classified,
        supportedFixes: classified.supportedFixes.length
          ? classified.supportedFixes
          : safeConflictFixes,
      });
    }
  }
  if (containment) {
    actions.unshift({
      id: 'containment-budget',
      code: containment.cause,
      subject: { type, viewports: containment.failingViewports.map(({ width, height }) => `${width}x${height}`) },
      evidence: {
        worstOverflow: containment.worstOverflow,
        ...(containment.viewBoxOptions ? { viewBoxOptions: containment.viewBoxOptions } : {}),
      },
      supportedFixes: [
        'reflow the same semantic nodes into a wider, shorter main composition',
        'compact non-semantic spacing before changing node or label typography',
        'rerun deterministic validation before the next browser preflight',
      ],
    });
  }

  if (progress.shouldReflow) {
    actions.unshift({
      id: 'structural-reflow',
      code: 'layout/structural-reflow',
      subject: { type, stage },
      evidence: {
        focusedAttemptCount: progress.focusedAttemptCount,
        structuralReflowCount: progress.structuralReflowCount,
        maxStructuralReflows: progress.maxStructuralReflows,
        bestErrorCount: progress.best?.errorCount,
        currentErrorCount: progress.current?.errorCount,
      },
      supportedFixes: [
        'recompose the same semantic nodes and relationships within layoutBudget instead of continuing local coordinate edits',
        'keep every reader-facing fact and existing typography floor while shortening shared corridors and separating congested ports',
        'rerun deterministic validation once on the reflowed candidate before browser preflight',
      ],
    });
  }

  if (topologyReflowRequired) {
    actions.unshift({
      id: 'workflow-main-path-lane-reflow',
      code: 'workflow/main-path-lane-reflow',
      subject: { type, path: '/mainPath' },
      evidence: workflowLaneReflow,
      supportedFixes: [
        'place the mainPath on one primary lane when roles permit, or keep each semantic lane in one contiguous segment while preserving real ownership',
        'remove repeated back-and-forth lane re-entry; preserve an intentional terminal return only when it communicates a real handoff',
        'place tool, error, and recovery branches in adjacent lanes near their decision column, then remove stale via, bias, or route controls from the old topology',
      ],
    });
  }

  const causes = unique([
    widthConflict ? 'layout/viewbox-width-constraint-conflict' : null,
    containment?.cause,
    ...actions.map((action) => action.code),
  ]);
  return {
    schemaVersion: 1,
    type,
    stage,
    status: progress.shouldStop
      ? 'bounded-stop'
      : progress.shouldReflow || topologyReflowRequired
        ? 'structural-reflow-required'
        : widthConflict
          ? 'constraint-conflict'
        : actions.length
          ? 'repair-required'
          : 'manual-diagnosis-required',
    causes,
    diagnosticFingerprint: currentDiagnosticFingerprint,
    progress,
    ...(authoredViewBox(candidate) ? { currentViewBox: authoredViewBox(candidate) } : {}),
    ...(containment ? { containment } : {}),
    ...(widthConstraints ? { constraints: { viewBoxWidth: widthConstraints } } : {}),
    actions,
    qualityGuards: QUALITY_CONTRACT.guards,
    forbiddenActions: [
      'delete a semantic node, state, message, relationship, or evidence fact merely to fit',
      'reduce node or label typography below the existing readability floor',
      'hide or clip overflow, or add an internal diagram scroller',
    ],
    acceptance: [
      'rerun showcase deterministic validation and require 9/9 with 0 errors and 0 warnings',
      'rerun browser preflight and require all four desktop viewports to pass',
      'preserve authored semantic identifiers and reader-facing facts unless the source evidence changes',
    ],
  };
}
