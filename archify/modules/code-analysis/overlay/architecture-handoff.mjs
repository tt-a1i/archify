import { createTranslator, messagesFor } from './i18n.mjs';

// A bounded orientation for AI, built from the same facts as check's receipt.
export function architectureHandoff({ overview, repository, locale }) {
  const t = createTranslator(messagesFor(locale));
  const a = overview.investigation.architecture, c = overview.coverage;
  const lines = [`# ${t('Source-backed architecture brief')}`, '', t('Captured working tree; verify current source before editing.'),
    `Snapshot: ${repository.snapshotId || repository.revision || 'unavailable'}`, '', `## ${t('Scope')}`,
    t('{files} analyzed files · {modules} modules · {edges} module edges', { files: c.files.analyzed ?? '?', modules: a.modules, edges: a.edges }),
    t('Excluded by role: {count}', { count: c.files.excludedByRole }), t('Unmapped modules: {count}', { count: c.unmappedModules.length }),
    t('Parse failures: {count}', { count: c.files.parseErrors.length }),
    ...(c.otherLanguages.length ? [t('Other languages not analyzed: {languages}', { languages: c.otherLanguages.map(x => `${x.adapter}: ${x.files}`).join(', ') })] : []),
    t('Unresolved dependency records: {count}', { count: (c.unresolved?.unknown || 0) + (c.unresolved?.opaque || 0) }),
    ...(c.rules.suppressed.length ? [t('Checks switched off: {rules}', { rules: c.rules.suppressed.join(', ') })] : []),
    `${t('Checks that ran')}: ${c.rules.run.join(', ') || 'none'}`,
    '', `## ${t('Reading hotspots')}`, t('Reading order uses size and incoming dependencies; it is not business importance or a refactoring decision.'),
    ...a.hotspots.map(m => `- ${m.path || m.id} · ${m.files} ${t('files')} · ${m.loc} ${t('lines')} · ${t('fan-in')} ${m.fanIn} / ${t('fan-out')} ${m.fanOut}`),
    '', `## ${t('Strongest captured dependencies')}`, ...a.strongestEdges.map(e => `- ${e.from} → ${e.to} · ${e.weight}${e.sample ? ` · ${e.sample}` : ''}`),
    '', `## ${t('Priority investigations')}`, ...overview.investigation.leads.map(f => `- ${f.id} [${f.severity}] ${f.where || f.code}: ${f.message}`),
    '', `## ${t('Additional structural signals')}`, ...a.structuralSignals.map(f => `- ${f.id} [${f.severity}] ${f.where || f.code}: ${f.message}`),
    '', `## ${t('Limits and next step')}`, t('Static source evidence does not determine runtime dispatch or the full impact of a change. Open priority tasks for evidence and allowed files; verify the source, make a scoped change or retain it with a reason, then rerun analysis and project tests.'),
  ];
  return lines.join('\n') + '\n';
}
