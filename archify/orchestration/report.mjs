import path from 'node:path';

function markdownCell(value) {
  return String(value ?? '—')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
}

function seconds(milliseconds) {
  if (!Number.isFinite(milliseconds)) return '—';
  return `${(milliseconds / 1000).toFixed(3)}s`;
}

function relativeLink(outputRoot, file) {
  if (!file) return '—';
  const relative = path.relative(outputRoot, file).split(path.sep).join('/');
  return `[${markdownCell(relative)}](./${relative})`;
}

function commandReceipt(finalReceipt, kind) {
  const commands = Array.isArray(finalReceipt?.commands) ? finalReceipt.commands : [];
  return commands.filter((command) => command.kind === kind).at(-1)?.receipt || null;
}

function validationSummary(finalReceipt) {
  const receipt = commandReceipt(finalReceipt, 'validate');
  if (!receipt) return 'not recorded';
  if (!receipt.ok) return 'failed';
  const checks = Array.isArray(receipt.checks) ? receipt.checks : [];
  const passed = checks.filter((check) => check?.ok).length;
  const composition = receipt.composition?.summary;
  return `${passed}/${checks.length}; ${composition?.errors ?? 0} errors; ${composition?.warnings ?? 0} warnings`;
}

function visualCheckSummary(finalReceipt) {
  const receipt = commandReceipt(finalReceipt, 'visual-check');
  if (!receipt) return 'not recorded';
  const viewports = receipt.containment?.viewports;
  const passed = Array.isArray(viewports) ? viewports.filter((viewport) => viewport?.ok).length : 0;
  const total = Array.isArray(viewports) ? viewports.length : 0;
  return receipt.ok ? `pass (${passed}/${total} viewports)` : (receipt.status || 'failed');
}

function reviewSummary(review) {
  if (!review || review.status === 'pending') return 'pending (human required)';
  if (!['passed', 'failed'].includes(review.status)
    || typeof review.reviewer !== 'string'
    || !review.reviewer.trim()
    || typeof review.reviewedAt !== 'string'
    || Number.isNaN(Date.parse(review.reviewedAt))) {
    return 'invalid independent review record';
  }
  const reviewer = review.reviewer ? ` by ${review.reviewer}` : '';
  return `${review.status}${reviewer}`;
}

function completedHumanReview(review) {
  return reviewSummary(review).startsWith('passed by ');
}

function suiteStatus(suite, results) {
  if (suite.chromeCapability?.receipt?.ok !== true || suite.automationError) return 'automated-failure';
  if (results.some((result) => result.timing.status !== 'completed')) return 'automated-failure';
  if (results.every((result) => completedHumanReview(result.visualReview))) return 'complete';
  return 'automated-pass-awaiting-human-review';
}

/**
 * Pure report interface. Every quality claim comes from a canonical timing
 * receipt, its final command receipts, or an independent visual-review record.
 */
export function renderSuiteReport({ suite, results, outputRoot }) {
  const activeDiagramMs = results.reduce((sum, result) => sum + result.timing.stages.reduce(
    (stageSum, stage) => stageSum + (stage.metadata?.sharedBatch ? 0 : (stage.durationMs || 0)),
    0,
  ), 0);
  const sharedVisualMs = suite.visualCheckBatch?.durationMs || 0;
  const aggregateWorkMs = activeDiagramMs + sharedVisualMs;
  const status = suiteStatus(suite, results);
  const lines = [
    `# ${suite.id} Archify suite report`,
    '',
    '> Generated mechanically from canonical timing v1 and final command receipts. Browser checks do not complete human visual review.',
    '',
    `- Status: \`${status}\``,
    `- Repository: \`${suite.repository.root}\``,
    `- Pinned revision: \`${suite.repository.revision}\``,
    `- Quality profile: \`${suite.qualityProfile}\``,
    `- Validate viewport preflight: \`${suite.viewportPreflight ? 'enabled' : 'disabled'}\``,
    `- Shared candidate preflight: \`${suite.sharedViewportPreflight ? 'enabled' : 'disabled'}\``,
    `- Chrome capability gate: \`${suite.chromeCapability?.receipt?.status || 'not-recorded'}\` (${seconds(suite.chromeCapability?.durationMs)})`,
    ...(suite.chromeCapability?.receipt?.error
      ? [`- Chrome capability error: ${markdownCell(suite.chromeCapability.receipt.error)}`]
      : []),
    ...(suite.visualCheckBatch
      ? [`- Shared final visual-check: \`${suite.visualCheckBatch.receipt?.status || 'invalid'}\` (${seconds(suite.visualCheckBatch.durationMs)}; ${suite.visualCheckBatch.artifacts.length} artifacts, one browser process)`]
      : []),
    ...(suite.sharedViewportPreflightReceipt
      ? [`- Shared pre-delivery candidate check: \`${suite.sharedViewportPreflightReceipt.status || 'invalid'}\` (${suite.sharedViewportPreflightReceipt.candidates?.length || 0} candidates, one browser process)`]
      : []),
    ...(suite.projectIndexReceipt
      ? [`- Shared project index: ${relativeLink(outputRoot, suite.projectIndexReceipt.path)} (\`${suite.projectIndexReceipt.digest}\`; ${suite.projectIndexReceipt.files} files, ${suite.projectIndexReceipt.filesAnalyzed} analyzed)`]
      : []),
    `- Aggregate active diagram work: ${seconds(aggregateWorkMs)} (per-diagram active stages ${seconds(activeDiagramMs)} + shared final visual-check once ${seconds(sharedVisualMs)})`,
    `- Suite timing receipt: ${relativeLink(outputRoot, suite.suiteTimingPath)}`,
    `- Suite durable event log: ${relativeLink(outputRoot, suite.suiteEventsPath)}`,
    '',
    '## Diagram outcomes',
    '',
    '| Diagram | Automated run | Duration | Deterministic validation | Browser containment | Human visual review | Artifact |',
    '| --- | --- | ---: | --- | --- | --- | --- |',
  ];

  for (const result of results) {
    lines.push(`| ${markdownCell(`${result.diagram.type} (${result.diagram.id})`)} | ${markdownCell(result.timing.status)} | ${seconds(result.timing.durationMs)} | ${markdownCell(validationSummary(result.timing.finalReceipt))} | ${markdownCell(visualCheckSummary(result.timing.finalReceipt))} | ${markdownCell(reviewSummary(result.visualReview))} | ${relativeLink(outputRoot, result.artifactPath)} |`);
  }

  lines.push('', '## Stage timing', '');
  for (const result of results) {
    lines.push(`### ${result.diagram.type} — ${result.diagram.id}`, '');
    lines.push('| Stage | Status | Duration | Attempts |', '| --- | --- | ---: | ---: |');
    for (const stage of result.timing.stages) {
      lines.push(`| ${markdownCell(stage.name)} | ${markdownCell(stage.status)} | ${seconds(stage.durationMs)} | ${stage.attempts.length} |`);
    }
    if (result.timing.stages.length === 0) lines.push('| — | — | — | 0 |');
    lines.push('', `- Timing receipt: ${relativeLink(outputRoot, result.timingPath)}`);
    lines.push(`- Durable event log: ${relativeLink(outputRoot, result.eventsPath)}`);
    lines.push(`- Human review record: ${relativeLink(outputRoot, result.visualReviewPath)}`, '');
  }

  lines.push('## Review contract', '');
  lines.push('A successful deterministic validation and browser containment check leave `visualReview.status` as `pending`. A human reviewer must update the independent review record; the suite runner never promotes it to `passed`.', '');

  return {
    status,
    markdown: `${lines.join('\n')}\n`,
  };
}

/**
 * Render an authoring handoff without accepting agent-authored prose or
 * duration fields. All claims are derived from canonical receipts.
 */
export function renderAuthoringReport({ timing, outputRoot }) {
  if (timing?.kind !== 'archify.run-timing') {
    throw new TypeError('authoring report requires a canonical timing receipt.');
  }
  const handoff = timing.finalReceipt;
  if (handoff?.kind === 'archify.authoring-terminal') {
    const root = path.resolve(outputRoot);
    const stagedMs = timing.stages.reduce(
      (sum, stage) => sum + (Number.isFinite(stage.durationMs) ? stage.durationMs : 0),
      0,
    );
    const agentOverheadMs = timing.accounting?.agentOverheadMs
      ?? Math.max(0, timing.durationMs - stagedMs);
    return {
      status: timing.status,
      markdown: `${[
        `# ${handoff.diagram.type} — ${handoff.diagram.id} authoring report`,
        '',
        '> Generated mechanically from canonical timing and terminal receipts. No duration is supplied by the authoring agent.',
        '',
        `- Status: \`${timing.status}\``,
        `- Reason: \`${markdownCell(handoff.reason)}\``,
        `- Total measured authoring envelope: ${seconds(timing.durationMs)}`,
        `- Staged work: ${seconds(stagedMs)}`,
        `- Agent overhead: ${seconds(agentOverheadMs)}`,
        `- Quality contract: \`${handoff.contract?.quality?.sha256 || 'not-recorded'}\``,
        `- Enforcement runtime: \`${handoff.contract?.runtime?.sha256 || 'not-recorded'}\``,
        `- Contract drift at stop: \`${handoff.contractDrift?.detected ? 'detected' : 'not-detected'}\` (current runtime \`${handoff.contractDrift?.current?.runtime?.sha256 || 'not-recorded'}\`)`,
        `- Terminal receipt digest: \`${handoff.digest}\``,
        `- Timing receipt: ${relativeLink(root, path.join(root, 'timing.json'))}`,
        '',
      ].join('\n')}\n`,
    };
  }
  if (handoff?.kind !== 'archify.authoring-handoff') {
    throw new TypeError('authoring timing finalReceipt must be a canonical authoring handoff or terminal receipt.');
  }
  const root = path.resolve(outputRoot);
  const stagedMs = timing.stages.reduce(
    (sum, stage) => sum + (Number.isFinite(stage.durationMs) ? stage.durationMs : 0),
    0,
  );
  const agentOverheadMs = timing.accounting?.agentOverheadMs
    ?? Math.max(0, timing.durationMs - stagedMs);
  const semantics = handoff.semanticRequirements || {};
  const density = semantics.density || {};
  const evidenceBreadth = semantics.evidenceBreadth || {};
  const language = handoff.validation?.authoredLanguage;
  const lines = [
    `# ${handoff.diagram.type} — ${handoff.diagram.id} authoring report`,
    '',
    '> Generated mechanically from canonical timing and handoff receipts. No duration or quality claim is supplied by the authoring agent.',
    '',
    `- Status: \`${timing.status}\` / handoff \`${handoff.status}\``,
    `- Total measured authoring envelope: ${seconds(timing.durationMs)}`,
    `- Staged work: ${seconds(stagedMs)}`,
    `- Agent overhead: ${seconds(agentOverheadMs)}`,
    `- Semantic scope: \`${semantics.scopeProfile || 'not-recorded'}\``,
    `- Semantic density: ${density.entities ?? 'not-recorded'} entities / ${density.relationships ?? 'not-recorded'} relationships`,
    `- Evidence breadth: ${evidenceBreadth.distinctSourceFiles ?? 'not-recorded'} source files (minimum ${evidenceBreadth.minimumDistinctSourceFiles ?? 'not-recorded'})`,
    `- Authored language: ${language ? `\`${language.required}\` / locale \`${language.locale}\` / ${language.violations} violations` : '`not-required`'}`,
    `- Quality contract: \`${handoff.contract?.quality?.sha256 || 'not-recorded'}\``,
    `- Enforcement runtime: \`${handoff.contract?.runtime?.sha256 || 'not-recorded'}\``,
    `- Candidate: ${relativeLink(root, handoff.candidate.path)} (\`${handoff.candidate.sha256}\`)`,
    `- Candidate freshness binding: \`${handoff.candidate.freshness?.pathBoundAtStart ? 'bound-and-absent-at-start' : 'legacy-unbound'}\``,
    `- Evidence ledger: ${relativeLink(root, handoff.evidence.path)} (\`${handoff.evidence.sha256}\`; ${handoff.evidence.factCount} facts)`,
    `- Validation receipt: ${relativeLink(root, handoff.validation.path)} (\`${handoff.validation.sha256}\`; ${handoff.validation.checksPassed}/${handoff.validation.checksTotal}; ${handoff.validation.errors} errors; ${handoff.validation.warnings} warnings)`,
    `- Handoff digest: \`${handoff.digest}\``,
    '',
    '## Stage timing',
    '',
    '| Stage | Status | Duration | Attempts |',
    '| --- | --- | ---: | ---: |',
    ...timing.stages.map((stage) => `| ${markdownCell(stage.name)} | ${markdownCell(stage.status)} | ${seconds(stage.durationMs)} | ${stage.attempts.length} |`),
    ...(timing.stages.length === 0 ? ['| — | — | — | 0 |'] : []),
    '',
    '## Accounting contract',
    '',
    '`agent-overhead` is the mechanically measured run envelope not covered by named stages. It can include model reasoning, source reading, editing, scheduling, and serialization; it is never reported as CLI process time.',
    '',
  ];
  return {
    status: timing.status === 'completed' && handoff.status === 'ready' ? 'ready' : 'failed',
    markdown: `${lines.join('\n')}\n`,
  };
}
