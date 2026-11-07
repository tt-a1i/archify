// Question-led source orientation. This is input to the host Agent, not an analysis.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInside } from './evidence.mjs';
import { questionCalls } from './question-calls.mjs';
import { fail } from '../extract/shared/diagnostics.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');
export const WORKFLOW = fileURLToPath(new URL('../docs/FUNCTION-ANALYSIS.md', import.meta.url));

// Optional index metadata: no working-tree traversal, extraction or Git mutations.
export function questionScope(root, facts) {
  const scope = {
    analysisRoot: path.resolve(root),
    facts: facts ? { status: 'captured', language: facts.repository?.language || null,
      files: [...new Set(facts.files.map((f) => f.path))].sort() }
      : { status: 'unknown', language: null, files: null },
    git: { status: 'unknown', repositoryRoot: null, analysisPath: null,
      trackedPathCount: null, outsideAnalysisRoot: null },
    limitations: [
      'Facts file paths are relative to analysisRoot and describe the captured selection, not current whole-repository coverage; language, include/exclude and parse limits still apply when both roots match.',
      'Git scope uses indexed paths only: untracked files and submodule contents are not enumerated; indexed paths may be deleted or changed in the working tree.',
      'Outside regions group repository-relative paths by their first directory (root files keep their names). These are path facts, not subsystem responsibilities.',
    ],
  };
  const git = (cwd, args) => spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', timeout: 2000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' },
  });
  try {
    const top = git(root, ['rev-parse', '--show-toplevel']);
    if (top.error || top.status !== 0 || !top.stdout.trim()) {
      scope.git.reason = 'Git repository root unavailable (no repository, Git unavailable, or query failed).';
      return scope;
    }
    const repoRoot = fs.realpathSync(top.stdout.trim());
    const relative = path.relative(repoRoot, fs.realpathSync(root));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      scope.git.reason = 'Git root does not contain the analysis root.';
      return scope;
    }
    scope.git.repositoryRoot = repoRoot;
    scope.git.analysisPath = relative.split(path.sep).join('/') || '.';
    const listed = git(repoRoot, ['ls-files', '--cached', '--full-name', '-z']);
    if (listed.error || listed.status !== 0) {
      scope.git.reason = 'Git tracked-path query failed or exceeded its time/output limit.';
      return scope;
    }
    const paths = [...new Set(listed.stdout.split('\0').filter(Boolean))];
    const prefix = relative ? `${scope.git.analysisPath}/` : '';
    const outside = new Map();
    for (const file of paths) {
      if (!prefix || file.startsWith(prefix)) continue;
      const slash = file.indexOf('/');
      const region = slash < 0 ? file : file.slice(0, slash + 1);
      outside.set(region, (outside.get(region) || 0) + 1);
    }
    scope.git.status = 'known';
    scope.git.trackedPathCount = paths.length;
    scope.git.outsideAnalysisRoot = [...outside].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([region, trackedPaths]) => ({ region, trackedPaths }));
  } catch {
    scope.git.reason = 'Git scope could not be read; entry orientation remains available.';
  }
  return scope;
}

export function buildQuestion({ question, entry, symbol, root, facts = null, factsPath = null }) {
  if (!question?.trim()) fail('task/question-empty', 'Provide the question to investigate.');
  const jsEntry = /\.(?:[mc]?[jt]s|[jt]sx)$/.test(entry || '') && !/\.d\.(?:ts|mts|cts)$/.test(entry);
  // Other languages reuse saved source/function/import facts, not the TS parser.
  // Require the producer contract and its captured inventory as well as a suffix.
  const language = facts?.repository?.language;
  const adapter = facts?.repository?.adapter || '';
  const savedEntry = !jsEntry && Array.isArray(facts?.files) && facts.files.some(f => f.path === entry)
    && ((language === 'py' && /^python@\d/.test(adapter) && /\.py$/.test(entry || ''))
      || (language === 'java' && /^java-parser@\d/.test(adapter) && /\.java$/.test(entry || ''))
      || (language === 'go' && /^go-parser@\d/.test(adapter) && /\.go$/.test(entry || '')));
  if (!jsEntry && !savedEntry) fail('task/entry-invalid', 'Question mode needs a JS/TS implementation file, or a captured .py/.java/.go entry from matching Python/Java/Go raw facts; declaration files are not supported.', { subject: { entry }, supportedFixes: ['pass a repository-relative JS/TS implementation file, or a saved analysis directory containing the Python/Java entry from its matching adapter'] });
  if (facts !== null && (!Array.isArray(facts.files) || !Array.isArray(facts.functions) || !Array.isArray(facts.imports))) fail('task/facts-invalid', 'Expected raw facts with files, functions and imports.', { supportedFixes: ['regenerate raw-facts.json with code-analysis check'] });
  const captured = new Map((facts?.files || []).map((f) => [f.path, f]));
  const cache = new Map();
  const sources = new Map();
  const inspect = (file) => {
    if (cache.has(file)) return cache.get(file);
    if (file !== entry && !captured.has(file)) {
      const result = { file, currentStatus: 'not-checked', factsStatus: 'unverifiable', parseErrors: [], reason: 'target-not-captured' };
      cache.set(file, result); return result;
    }
    const current = readInside(root, file);
    if (current.status === 'ok') sources.set(file, current.text);
    const old = captured.get(file);
    const result = {
      file, currentStatus: current.status,
      parseErrors: (facts?.parse_errors || []).filter((e) => e.path === file),
      ...(current.reason ? { reason: current.reason } : {}),
      factsStatus: current.status !== 'ok' ? current.status
        : typeof old?.sourceText !== 'string' ? 'unverifiable'
          : old.sourceText === current.text ? 'valid' : 'changed',
      ...(current.status === 'ok' ? { currentSha256: hash(current.text) } : {}),
    };
    cache.set(file, result);
    return result;
  };
  const selected = inspect(entry);
  const languageInputs = facts?.languageScope?.metadata?.map(input => {
    const current = readInside(root, input.file);
    return { file: input.file, status: current.status === 'ok' && current.text === input.sourceText ? 'valid' : 'changed-or-unreadable' };
  });
  if (languageInputs?.some(input => input.status !== 'valid')) selected.factsStatus = 'resolution-input-changed';
  if (selected.currentStatus !== 'ok') fail('task/entry-unreadable', `Cannot read entry: ${entry}`, { subject: { entry }, evidence: selected, supportedFixes: ['select an existing file inside --root'] });
  const matches = (facts?.functions || []).filter((f) => f.file === entry && (f.qualname === symbol || f.name === symbol));
  let location = null;
  if (symbol && selected.factsStatus === 'valid' && !selected.parseErrors.length) {
    if (matches.length !== 1) fail('task/function-unresolved', `Expected one captured function named ${symbol}; found ${matches.length}.`, { subject: { entry, symbol }, supportedFixes: ['use an exact qualname from raw-facts.json, or omit --function and inspect the file'] });
    const f = matches[0];
    const lines = sources.get(entry).split(/\r\n|[\n\r\u2028\u2029]/);
    if (!Number.isInteger(f.line) || !Number.isInteger(f.endLine) || f.line < 1 || f.endLine < f.line || f.endLine > lines.length) fail('task/facts-invalid', 'Function range is outside the captured file.', { subject: { entry, symbol } });
    location = { file: entry, symbol: f.qualname, startLine: f.line, endLine: f.endLine };
  }
  const imports = (facts?.imports || []).filter((i) => i.from === entry).map((i) => ({
    ...i, originStatus: selected.factsStatus,
    ...(i.to ? { target: inspect(i.to) } : {}),
  }));
  return {
    kind: 'archify-function-question', question: question.trim(),
    stage: 'orientation-only', root: path.resolve(root),
    entry: { ...selected, ...(symbol ? { requestedFunction: symbol } : {}), location },
    snapshotId: facts?.repository?.snapshotId || null,
    factsAvailable: facts !== null, imports,
    calls: questionCalls({ facts, factsPath, inspect, entry: selected, location, symbol, text: sources.get(entry), selectedFunction: matches.length === 1 ? matches[0] : null }),
    scope: { ...questionScope(root, facts), ...(facts?.languageScope ? { languageScope: facts.languageScope, languageInputs } : {}) },
    limitations: [
      'Locations and imports are captured static facts, usable only where factsStatus/originStatus is valid; dependency targets have separate freshness checks.',
      'Missing facts or changed source require current-source reading and fresh extraction before reusing captured function ranges.',
      'Empty calls and unresolved/computed imports do not mean no calls or dependencies. Follow current source, subprocesses and configuration as the question requires.',
      'Valid factsStatus means source freshness, not parse completeness; inspect parseErrors before trusting recovered syntax. Import lists cover the entry file, not only the selected function.',
      'Only the entry and its captured direct import targets were checked. This is not whole-repository freshness or a semantic analysis.',
      'Python import edges identify files, not imported object identity. Java type/import dependencies do not identify runtime providers or dispatch.',
    ],
    workflow: WORKFLOW,
  };
}

export function renderQuestionMarkdown(brief) {
  return `# Function analysis question\n\n${brief.question}\n\nOrientation only. Complete the host Agent workflow in [FUNCTION-ANALYSIS.md](${brief.workflow}) before delivering an analysis.\n\nThe following JSON records tool observations, not semantic conclusions. Read current source at the recorded root; check each dependency when following it.\n\n\`\`\`json\n${JSON.stringify(brief, null, 2)}\n\`\`\`\n`;
}
