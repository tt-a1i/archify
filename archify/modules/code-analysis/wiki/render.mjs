import fs from 'node:fs';
import { escapeHtml as esc } from '../../../renderers/shared/i18n.mjs';
import { scriptSafeJson } from '../overlay/inject.mjs';

const css = fs.readFileSync(new URL('./wiki.css', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('./client.js', import.meta.url), 'utf8');
const copy = {
  'zh-CN': {
    title: '仓库 Wiki', overview: '概览', modules: '模块', source: '源码引用', atlas: '查看 Atlas', markdown: '下载 Markdown',
    search: '搜索模块、文件或指南', index: '搜索结果', noResults: '没有匹配的模块或指南。', scope: '范围', commit: '提交',
    files: '文件', analyzed: '已分析文件', parseErrors: '解析失败', other: '其他语言', omitted: '跳过的 Git 条目',
    unresolved: '未解析依赖', lines: '行', incoming: '传入依赖', outgoing: '传出依赖', definitions: '代表性定义',
    related: '引用的模块', findings: '分析线索', guides: '说明指南', limits: '覆盖范围',
    evidenceNotice: '此 Wiki 反映固定快照中的静态证据。导入关系不代表运行时行为。',
    guideNotice: '说明由作者或 Agent 提供。引用范围已校验，需阅读源码以核对具体结论。',
    noExcerpt: '该产物未嵌入源码。', excerpt: '引用摘录，最多 16 行', excluded: '按角色排除',
    ignored: '排除的路径模式', adapter: '分析器', rule: '运行的规则', language: '语言',
  },
  en: {
    title: 'Repository Wiki', overview: 'Overview', modules: 'Modules', source: 'Source citations', atlas: 'Open Atlas', markdown: 'Download Markdown',
    search: 'Search modules, files, or guides', index: 'Search results', noResults: 'No matching modules or guides.', scope: 'Scope', commit: 'Commit',
    files: 'files', analyzed: 'Analyzed files', parseErrors: 'Parse failures', other: 'Other languages', omitted: 'Skipped Git entries',
    unresolved: 'Unresolved dependencies', lines: 'lines', incoming: 'incoming', outgoing: 'outgoing', definitions: 'Selected definitions',
    related: 'Module dependencies', findings: 'Analysis leads', guides: 'Reading guides', limits: 'Coverage',
    evidenceNotice: 'This wiki reflects static evidence from one pinned snapshot. Imports do not establish runtime behavior.',
    guideNotice: 'These observations were supplied by an author or agent. The citation ranges were checked. Read the source to confirm each claim.',
    noExcerpt: 'This artifact has no embedded source text.', excerpt: 'Cited excerpt, up to 16 lines', excluded: 'Excluded by role',
    ignored: 'Excluded path patterns', adapter: 'Analyzer', rule: 'Rules run', language: 'Language',
  },
};
const link = (href, label) => '<a href="' + esc(href) + '">' + esc(label) + '</a>';
const labelFor = citation => citation.path + ':' + citation.startLine + (citation.endLine !== citation.startLine ? '–' + citation.endLine : '');
const md = value => esc(value).replace(/[\r\n\t]/g, ' ').replace(/[\\\u0060*_~#|[\]()!]/g, '\\$&');

function coverageRows(coverage, t) {
  const join = values => values?.length ? values.join(', ') : '—';
  return [
    [t.language, coverage.language],
    [t.adapter, coverage.adapter],
    [t.analyzed, coverage.files.analyzed],
    [t.excluded, coverage.files.excludedByRole],
    [t.parseErrors, join(coverage.files.parseErrors)],
    [t.other, join(coverage.otherLanguages.map(({ adapter, files }) => adapter + ' (' + files + ')'))],
    [t.unresolved, Object.entries(coverage.unresolved || {}).map(([key, value]) => key + ' ' + value).join(', ') || '—'],
    [t.omitted, coverage.omittedGitEntries],
    [t.ignored, join(coverage.files.excludePatterns)],
    [t.rule, join(coverage.rules.run)],
  ];
}

export function wikiHtml({ document: doc, excerpts }, markdown) {
  const t = copy[doc.locale];
  const sources = new Map(doc.citations.map(citation => [citation.id, citation]));
  const moduleIndex = new Map(doc.modules.map(module => [module.id, module]));
  const source = id => sources.has(id) ? link('#' + id, labelFor(sources.get(id))) : '';
  const page = (module) => '<article id="' + module.anchor + '" data-wiki-page><h3>' + esc(module.label) + '</h3>'
    + '<p class="path">' + esc(module.path) + '</p><p class="meta">' + module.files + ' ' + t.files + ' · ' + module.lines + ' ' + t.lines + ' · '
    + module.incoming + ' ' + t.incoming + ' · ' + module.outgoing + ' ' + t.outgoing + '</p>'
    + (module.definitions.length ? '<h4>' + t.definitions + '</h4><ul>' + module.definitions.map(fn => '<li><code>' + esc(fn.name) + '</code> ' + source(fn.citation) + '</li>').join('') + '</ul>' : '')
    + (module.dependencies.length ? '<h4>' + t.related + '</h4><ul>' + module.dependencies.map(dep => {
      const target = moduleIndex.get(dep.to);
      return '<li>' + link('#' + target.anchor, target.label) + ' · ' + dep.count
        + (dep.citations.length ? '<small>' + dep.citations.map(source).join(' · ') + '</small>' : '') + '</li>';
    }).join('') + '</ul>' : '')
    + '<details><summary>' + t.files + ' (' + module.fileIndex.length + ')</summary><ul>' + module.fileIndex.map(file => '<li><code>' + esc(file) + '</code></li>').join('') + '</ul></details></article>';
  const guides = doc.guides.length ? '<section id="guides"><h2>' + t.guides + '</h2><p>' + t.guideNotice + '</p>' + doc.guides.map((guide, i) =>
    '<article id="guide-' + (i + 1) + '" data-wiki-page><h3>' + esc(guide.title) + '</h3><p class="guide">' + esc(guide.text) + '</p><p>'
    + guide.citations.map(source).join(' · ') + '</p></article>').join('') + '</section>' : '';
  const findings = doc.findings.length ? '<section><h2>' + t.findings + '</h2><ul>' + doc.findings.map(finding => '<li><strong>'
    + esc(finding.rule) + '</strong> <span class="meta">' + esc(finding.severity) + '</span><p>' + esc(finding.message) + '</p>'
    + (finding.citation ? source(finding.citation) : '<small>' + esc(finding.where) + '</small>') + '</li>').join('') + '</ul></section>' : '';
  const evidence = '<section id="citations"><h2>' + t.source + '</h2>' + (doc.sourceExcerpts ? '' : '<p>' + t.noExcerpt + '</p>')
    + '<ol>' + doc.citations.map(citation => '<li id="' + citation.id + '"><strong>' + esc(labelFor(citation)) + '</strong>'
      + (citation.url ? ' ' + link(citation.url, 'GitHub ↗') : '') + '<small><code>SHA-256 ' + esc(citation.sha256) + '</code></small>'
      + (excerpts.has(citation.id) ? '<details><summary>' + t.excerpt + '</summary><pre>' + esc(excerpts.get(citation.id)) + '</pre></details>' : '') + '</li>').join('') + '</ol></section>';
  return '<!doctype html><html lang="' + esc(doc.locale) + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + esc(doc.title) + ' · ' + t.title + '</title><style>' + css + '</style></head><body>'
    + '<header><a class="brand" href="#overview">Archify <span>' + t.title + '</span></a><div class="actions">'
    + link('./atlas.html', t.atlas) + '<a id="wiki-download" href="./wiki.md" download>' + t.markdown + '</a></div></header>'
    + '<div class="layout"><aside><nav aria-label="' + t.index + '"><a href="#overview">' + t.overview + '</a><a href="#modules">' + t.modules + '</a>'
    + (doc.guides.length ? '<a href="#guides">' + t.guides + '</a>' : '') + '<a href="#citations">' + t.source + '</a></nav>'
    + '<label for="wiki-search">' + t.search + '</label><input id="wiki-search" type="search"><p id="wiki-empty" role="status" hidden>' + t.noResults + '</p></aside>'
    + '<main><section class="hero" id="overview"><h1>' + esc(doc.title) + '</h1><p>' + t.evidenceNotice + '</p><div class="pin"><span>'
    + t.commit + '</span><code>' + esc(doc.repository.revision) + '</code><span>' + t.scope + '</span><code>' + esc(doc.repository.scope) + '</code></div></section>'
    + '<details class="coverage"><summary>' + t.limits + ' · ' + doc.coverage.files.analyzed + ' ' + t.files + '</summary><dl>'
    + coverageRows(doc.coverage, t).map(([name, value]) => '<dt>' + esc(name) + '</dt><dd>' + esc(value) + '</dd>').join('') + '</dl></details>'
    + guides + '<section id="modules"><h2>' + t.modules + '</h2>' + doc.modules.map(page).join('') + '</section>'
    + findings + evidence + '</main></div><script id="wiki-markdown" type="application/json">'
    + scriptSafeJson(markdown) + '</script><script>' + client + '</script></body></html>\n';
}

export function wikiMarkdown(doc) {
  const t = copy[doc.locale];
  const source = id => '[' + id + ']';
  const moduleIndex = new Map(doc.modules.map(module => [module.id, module]));
  const out = ['# ' + md(doc.title), '', t.evidenceNotice, '', '- ' + t.commit + ' \u0060' + doc.repository.revision + '\u0060',
    '- ' + t.scope + ' ' + md(doc.repository.scope), '- [' + t.atlas + '](atlas.html)', '', '## ' + t.limits, '',
    ...coverageRows(doc.coverage, t).map(([name, value]) => '- **' + md(name) + '** · ' + md(value)), ''];
  if (doc.guides.length) {
    out.push('## ' + t.guides, '', t.guideNotice, '');
    for (const guide of doc.guides) out.push('### ' + md(guide.title), '', md(guide.text) + ' ' + guide.citations.map(source).join(' '), '');
  }
  out.push('## ' + t.modules, '');
  for (const module of doc.modules) {
    out.push('### ' + md(module.label), '', md(module.path) + ' · ' + module.files + ' ' + t.files + ' · ' + module.lines + ' ' + t.lines, '');
    for (const fn of module.definitions) out.push('- ' + md(fn.name) + ' ' + source(fn.citation));
    for (const dep of module.dependencies) out.push('- → ' + md(moduleIndex.get(dep.to).label) + ' · ' + dep.count + ' ' + dep.citations.map(source).join(' '));
    out.push('');
  }
  if (doc.findings.length) {
    out.push('## ' + t.findings, '');
    for (const finding of doc.findings) out.push('- ' + md(finding.message) + (finding.citation ? ' ' + source(finding.citation) : ''));
    out.push('');
  }
  out.push('## ' + t.source, '');
  for (const citation of doc.citations) {
    const location = md(labelFor(citation));
    out.push('- ' + citation.id + ' · ' + (citation.url ? '[' + location + '](<' + citation.url + '>)' : location));
  }
  return out.join('\n') + '\n';
}
