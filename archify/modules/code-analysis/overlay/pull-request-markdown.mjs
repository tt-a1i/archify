import { createTranslator, messagesFor } from './i18n.mjs';

// Paths enter the handoff as literal text, including names that resemble
// Markdown links or contain control characters.
const literal = value => String(value)
  .replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu, ' ')
  .replace(/[&<>\\\x60*_[\]{}()#!|~]/gu, char => '&#' + char.codePointAt(0) + ';');

export function reviewMarkdown(pr, locale) {
  const tr = createTranslator(messagesFor(locale));
  const prefix = pr.scope === '.' ? '' : pr.scope + '/';
  const file = path => literal(prefix + path);
  const lines = [
    '# ' + tr('Pinned local review'), '',
    '- ' + tr('Repository: ') + literal(pr.repository),
    '- ' + tr('Scope: ') + literal(pr.scope),
    '- ' + tr('Pinned base') + ': ' + pr.baseSHA,
    '- ' + tr('Pinned head') + ': ' + pr.headSHA,
    '', '## ' + tr('Changed files'), '',
  ];
  for (const change of pr.changedFiles) {
    lines.push('- ' + tr(change.status) + ' · ' +
      (change.previousPath ? file(change.previousPath) + ' → ' : '') + file(change.path));
  }
  if (!pr.changedFiles.length) lines.push(tr('No Git changes in the selected scope.'));
  lines.push('', '## ' + tr('Observed dependency changes'), '');
  const labels = {
    'dependency-added': 'Dependency added', 'dependency-removed': 'Dependency removed',
    'dependency-changed': 'Dependency form changed',
  };
  const dependencies = pr.impact.records.filter(record => Object.hasOwn(labels, record.kind));
  for (const record of dependencies) {
    lines.push('- ' + tr(labels[record.kind]) + ' · ' + file(record.from) + ' → ' + file(record.to));
    for (const loc of record.locations) {
      lines.push('  - ' + tr(loc.side === 'base' ? 'Pinned base' : 'Pinned head') + ' · ' + file(loc.file) + ':' + loc.line);
    }
  }
  if (!dependencies.length) lines.push(tr('No dependency changes recorded within captured coverage.'));
  if (pr.componentDrift) {
    const components = new Map(pr.componentDrift.components.map(component => [component.id, component.label]));
    lines.push('', '## ' + tr('Architecture diagram relations'), '');
    for (const edge of pr.componentDrift.edges) {
      lines.push('- ' + tr(edge.state) + ' · ' + literal(components.get(edge.from)) + ' → ' + literal(components.get(edge.to)));
      if (edge.reasons.length) lines.push('  - ' + edge.reasons.map(reason => tr(reason)).join(' · '));
      for (const side of ['base', 'head']) for (const loc of edge[side]) {
        lines.push('  - ' + tr(side === 'base' ? 'Pinned base' : 'Pinned head') + ' · ' + file(loc.path) + ':' + loc.line);
      }
    }
    if (!pr.componentDrift.edges.length) lines.push(tr('No changed component relations recorded.'));
  }
  lines.push('', '## ' + tr('Coverage'), '',
    '- ' + tr('Analyzed files: {base} base · {head} head', { base: pr.before.files, head: pr.after.files }),
    '- ' + tr('Operating on captured local commits. Findings describe static observations within the selected scope.'),
    '- ' + tr('Known static references are not runtime or complete transitive impact.'));
  if (pr.impact.status === 'partial') lines.push('- ' + tr('Some changed regions were outside the language, parsing or reading budget; unobserved impact remains unknown.'));
  if (pr.impact.comparison.comparable !== true) lines.push('- ' + tr('Analysis contexts differ; observed measurement or binding differences are not fully attributable to source changes.'));
  if (pr.impact.omitted) lines.push('- ' + tr('Impact records omitted by the reading budget: {count}', { count: pr.impact.omitted }));
  if (pr.omitted.base.length || pr.omitted.head.length) lines.push('- ' + tr('Source capture omitted {base} base and {head} head entries (symlinks or submodules).', { base: pr.omitted.base.length, head: pr.omitted.head.length }));
  return lines.join('\n') + '\n';
}
