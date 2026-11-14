// Shared by the CLI and the self-contained report. Keep the evaluator free
// of I/O and closed over no module state so it can be embedded in the view.
export function evaluateVerification(context, task, reported) {
  const bad = (error) => ({ error });
  if (!context) return bad('no-comparison');
  if (task?.schema_version !== 1 || task.kind !== 'archify-code-analysis-task'
    || !/^TASK-[a-f0-9]{12}$/.test(task.taskId) || !Array.isArray(task.findings)
    || !task.findings.length || task.findings.length > 100) return bad('invalid-task');
  if (task.source?.snapshotId !== context.before.snapshotId || task.source?.root !== context.root
    || (task.source?.configDigest ?? null) !== context.configDigest) return bad('wrong-task-snapshot');

  const selected = [], ids = new Set();
  for (const finding of task.findings) {
    const id = finding?.id;
    if (typeof id !== 'string' || !Object.hasOwn(context.selectedFrom, id) || ids.has(id)) return bad('wrong-task-findings');
    ids.add(id);
    const old = context.selectedFrom[id];
    if (finding.code !== old.code || (finding.evidenceDigest?.sha256 ?? null) !== old.evidence
      || (finding.external?.reviewDigest ?? null) !== old.claim
      || (finding.external?.sourceId ?? null) !== old.sourceId) return bad('wrong-task-findings');
    selected.push({
      id, code: old.code, sourceId: old.sourceId, externalReport: old.report,
      outcome: context.comparable !== true || old.limitation || (old.report && old.report !== 'different-bytes')
        ? 'inconclusive' : old.outcome,
      observed: old.outcome, limitation: old.limitation,
    });
  }

  const identity = { taskId: task.taskId, findingIds: [...ids].sort(), before: context.before, after: context.after };
  const checksTemplate = {
    schema_version: 1, kind: 'archify-code-analysis-project-checks', ...identity,
    checks: [{ name: 'Project check', status: 'not-run' }],
  };
  let projectChecks = { status: 'not-reported', checks: [] };
  if (reported !== undefined) {
    if (reported?.schema_version !== 1 || reported.kind !== checksTemplate.kind
      || !Array.isArray(reported.checks) || !reported.checks.length || reported.checks.length > 40) return bad('invalid-checks');
    const same = (key) => reported[key]?.snapshotId === identity[key].snapshotId
      && reported[key]?.analysisSha256 === identity[key].analysisSha256;
    if (reported.taskId !== identity.taskId || !same('before') || !same('after')
      || !Array.isArray(reported.findingIds) || reported.findingIds.length !== identity.findingIds.length
      || !identity.findingIds.every((id, i) => id === reported.findingIds[i])) return bad('wrong-checks-snapshot');
    const names = new Set();
    for (const check of reported.checks) {
      const name = typeof check?.name === 'string' ? check.name.trim() : '';
      if (!name || name.length > 120 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name) || names.has(name)
        || !['passed', 'failed', 'skipped', 'not-run'].includes(check.status)) return bad('invalid-checks');
      names.add(name);
      projectChecks.checks.push({ name, status: check.status });
    }
    projectChecks.status = 'reported-not-independently-verified';
  }
  return {
    checksTemplate,
    receipt: {
      schema_version: 1, kind: 'archify-code-analysis-verification',
      ...identity, analysis: { comparable: context.comparable, reasons: context.reasons, newCount: context.comparable === true ? context.newCount : null, selected },
      projectChecks,
    },
  };
}
