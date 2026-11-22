import { fail, rangeDigest, splitLines, validSourceRange } from '../core/index.mjs';
import { findingWhere } from '../overlay/overview.mjs';

const digestPattern = /^[a-f0-9]{64}$/;
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

export function buildWiki({ facts, graph, overview, findings, title, locale, omitted, configDigest, narrative, includeSource }) {
  const { repository } = facts;
  const errors = new Set(overview.coverage.files.parseErrors);
  const sources = new Map(facts.files.filter(file => !errors.has(file.path)).map(file => [file.path, file.sourceText]));
  const preparedLines = new Map();
  const citations = [], excerpts = new Map(), keys = new Map();
  const cite = (file, first, last, expected) => {
    const invalid = () => fail('wiki/citation-invalid', 'A narrative citation does not match captured source in the pinned commit.', {
      subject: { file, startLine: first, endLine: last },
      supportedFixes: ['use a parse-valid file and line range under the analysis scope', 'recompute the digest against the pinned revision'],
    });
    const source = sources.get(file);
    if (source === undefined) return expected ? invalid() : null;
    if (!preparedLines.has(file)) preparedLines.set(file, splitLines(source));
    const lines = preparedLines.get(file);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > lines.length) {
      return expected ? invalid() : null;
    }
    const sha256 = rangeDigest(lines, first, last);
    if (expected && sha256 !== expected) invalid();
    const key = JSON.stringify([file, first, last]);
    if (keys.has(key)) return keys.get(key);
    const id = 'source-' + (citations.length + 1);
    const scopePath = repository.root === '.' ? file : repository.root + '/' + file;
    const url = repository.url ? repository.url + '/blob/' + repository.revision + '/'
      + scopePath.split('/').map(encodeURIComponent).join('/') + '#L' + first + (last === first ? '' : '-L' + last) : null;
    citations.push({ id, path: scopePath, startLine: first, endLine: last, sha256, url });
    keys.set(key, id);
    if (includeSource) excerpts.set(id, lines.slice(first - 1, Math.min(first + 15, last)).join('\n').slice(0, 1600));
    return id;
  };

  const files = new Map(), functions = new Map(), dependencies = new Map();
  for (const file of facts.files) {
    const module = graph.fileModules[file.path];
    if (module === undefined) continue;
    if (!files.has(module)) files.set(module, []);
    files.get(module).push(file);
  }
  for (const fn of facts.functions || []) {
    const module = graph.fileModules[fn.file], source = sources.get(fn.file);
    if (module === undefined || source === undefined || (fn.sourceRange && !validSourceRange(source, fn, repository.language))) continue;
    if (!functions.has(module)) functions.set(module, []);
    functions.get(module).push(fn);
  }
  for (const edge of graph.edges) {
    if (!dependencies.has(edge.from)) dependencies.set(edge.from, []);
    dependencies.get(edge.from).push(edge);
  }
  const rootPath = file => repository.root === '.' ? file : repository.root + '/' + file;
  const modules = graph.modules.map((module, index) => ({
    id: module.id,
    anchor: 'module-' + (index + 1),
    label: module.label,
    path: module.path ? rootPath(module.path) : (module.files === 1 ? rootPath(files.get(module.id)[0].path) : repository.root),
    files: module.files,
    lines: module.loc,
    incoming: module.fanIn,
    outgoing: module.fanOut,
    fileIndex: files.get(module.id).map(file => rootPath(file.path)),
    // Complexity orders navigation examples. It does not infer responsibilities.
    definitions: (functions.get(module.id) || []).sort((a, b) => b.complexity - a.complexity || compare(a.file, b.file) || a.line - b.line)
      .slice(0, 5).map(fn => ({ name: fn.qualifiedName || fn.name, citation: cite(fn.file, fn.line, fn.endLine) }))
      .filter(fn => fn.citation),
    dependencies: (dependencies.get(module.id) || []).map(edge => ({
      to: edge.to,
      count: edge.weight,
      citations: edge.evidence.map(entry => cite(entry.file, entry.line, entry.line)).filter(Boolean),
    })),
  }));
  const guides = readNarrative(narrative, repository, cite);
  return {
    document: {
      schemaVersion: 1,
      kind: 'archify-repository-wiki',
      title,
      locale,
      repository: { revision: repository.revision, scope: repository.root, url: repository.url, snapshotId: repository.snapshotId },
      configSha256: configDigest,
      coverage: { ...overview.coverage, omittedGitEntries: omitted.size },
      sourceExcerpts: includeSource,
      modules,
      findings: overview.investigation.leads.map(lead => {
        const diagnostic = findings.diagnostics.find(entry => entry.id === lead.id);
        const subject = diagnostic.subject || {};
        return { id: lead.id, severity: lead.severity, rule: lead.code, where: findingWhere(diagnostic), message: diagnostic.message,
          citation: subject.file && subject.line ? cite(subject.file, subject.line, subject.line) : null };
      }),
      guides,
      citations,
    },
    excerpts,
  };
}

function readNarrative(input, repository, cite) {
  if (input === null) return [];
  const invalid = () => fail('wiki/narrative-invalid', 'Narrative must name this exact revision and scope and contain bounded, cited guide sections.', {
    supportedFixes: ['follow the Repository Wiki narrative format in the Code Analysis guide'],
  });
  if (input?.schemaVersion !== 1 || input.revision !== repository.revision || input.scope !== repository.root ||
      !Array.isArray(input.sections) || input.sections.length > 30) invalid();
  const text = (value, size) => typeof value === 'string' && value.trim().length > 0 && value.length <= size;
  return input.sections.map(section => {
    if (!text(section?.title, 140) || !text(section.text, 5000) || !Array.isArray(section.citations) ||
        !section.citations.length || section.citations.length > 8) invalid();
    const references = section.citations.map(citation => {
      if (!text(citation?.path, 1024) || typeof citation.sha256 !== 'string' || !digestPattern.test(citation.sha256)) invalid();
      const prefix = repository.root === '.' ? '' : repository.root + '/';
      if (!citation.path.startsWith(prefix)) invalid();
      return cite(citation.path.slice(prefix.length), citation.startLine, citation.endLine, citation.sha256);
    });
    return { title: section.title, text: section.text, citations: [...new Set(references)] };
  });
}
