import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { throwDiagnosticError } from './diagnostics.mjs';

const FULL_SHA_RE = /^[a-f0-9]{40}$/i;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

function evidenceFailure(code, message, { subject = {}, evidence = {}, supportedFixes = [] } = {}) {
  throwDiagnosticError(message, [{
    code,
    severity: 'error',
    message,
    subject: { surface: 'repository-evidence', ...subject },
    evidence,
    supportedFixes,
  }]);
}

function runGit(repoRoot, args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) evidenceFailure('repository-evidence/git-unavailable', `Could not run Git: ${result.error.message}`, {
    evidence: { reason: result.error.message },
    supportedFixes: ['install Git and ensure it is available on PATH'],
  });
  return result;
}

function gitValue(repoRoot, args, failure) {
  const result = runGit(repoRoot, args);
  if (result.status !== 0) evidenceFailure('repository-evidence/git-command', failure, {
    evidence: { gitArgs: args, exitCode: result.status },
    supportedFixes: ['use the intended local Git repository and verify its origin and revision'],
  });
  return result.stdout.trim();
}

function githubSlug(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

function verifiedSourcePath(value, where) {
  const sourcePath = String(value || '');
  if (!sourcePath || sourcePath.startsWith('/') || sourcePath.includes('\\') || CONTROL_CHARACTER_RE.test(sourcePath)) {
    evidenceFailure('repository-evidence/path-invalid', `${where} must be a repo-relative POSIX path.`, {
      subject: { path: where },
      evidence: { authoredPath: sourcePath },
      supportedFixes: ['use a repository-relative path with forward slashes'],
    });
  }
  const segments = sourcePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..') || segments[0] === '.git') {
    evidenceFailure('repository-evidence/path-escape', `${where} must stay inside the repository and may not address .git.`, {
      subject: { path: where },
      evidence: { authoredPath: sourcePath },
      supportedFixes: ['remove empty, dot, parent, or .git path segments'],
    });
  }
  return segments.join('/');
}

function sourceHref(repositoryUrl, revision, source) {
  const encodedPath = source.path.split('/').map(encodeURIComponent).join('/');
  const lineFragment = source.line
    ? `#L${source.line}${source.endLine && source.endLine !== source.line ? `-L${source.endLine}` : ''}`
    : '';
  return `${repositoryUrl}/blob/${revision}/${encodedPath}${lineFragment}`;
}

function sourceLineCount(content) {
  if (!content.length) return 0;
  const lines = content.split(/\r\n|\n|\r/);
  return lines.length - (/(?:\r\n|\n|\r)$/.test(content) ? 1 : 0);
}

export function hasRepositoryEvidence(diagramType, diagram) {
  if (diagramType !== 'architecture') return false;
  const components = Array.isArray(diagram?.components) ? diagram.components : [];
  return Boolean(diagram?.meta?.repository) || components.some((component) => Array.isArray(component?.sources) && component.sources.length);
}

export function verifyRepositoryEvidence(diagramType, diagram, repoRootInput) {
  if (!hasRepositoryEvidence(diagramType, diagram)) return null;
  if (diagramType !== 'architecture') evidenceFailure('repository-evidence/type-unsupported', 'Repository evidence is currently supported for architecture diagrams only.', {
    subject: { diagramType },
    supportedFixes: ['use architecture mode or remove repository evidence'],
  });

  const repository = diagram.meta?.repository;
  if (!repository) evidenceFailure('repository-evidence/repository-required', 'Repository evidence requires /meta/repository.', {
    subject: { path: '/meta/repository' },
    supportedFixes: ['add the pinned public repository metadata or remove component sources'],
  });
  if (!FULL_SHA_RE.test(repository.revision || '')) {
    evidenceFailure('repository-evidence/revision-invalid', '/meta/repository/revision must be a full 40-character commit SHA.', {
      subject: { path: '/meta/repository/revision' },
      evidence: { revision: repository.revision },
      supportedFixes: ['pin one full 40-character commit SHA'],
    });
  }
  const authoredSlug = githubSlug(repository.url);
  if (!authoredSlug || !String(repository.url).startsWith('https://github.com/')) {
    evidenceFailure('repository-evidence/url-invalid', '/meta/repository/url must be a public https://github.com owner/repository URL.', {
      subject: { path: '/meta/repository/url' },
      evidence: { repositoryUrl: repository.url },
      supportedFixes: ['use the canonical public GitHub HTTPS repository URL'],
    });
  }
  if (!repoRootInput) {
    evidenceFailure('repository-evidence/root-required', 'This diagram declares source evidence. Pass --repo-root <repository> so Archify can verify it before rendering.', {
      subject: { path: '/meta/repository' },
      supportedFixes: ['pass --repo-root with the matching local Git checkout'],
    });
  }

  const requestedRoot = path.resolve(repoRootInput);
  let realRoot;
  try {
    realRoot = fs.realpathSync(requestedRoot);
  } catch (error) {
    evidenceFailure('repository-evidence/root-unreadable', `Could not resolve evidence repository root "${requestedRoot}": ${error.message}`, {
      subject: { repoRoot: requestedRoot },
      evidence: { reason: error.message },
      supportedFixes: ['pass one readable local repository directory'],
    });
  }
  const gitRoot = gitValue(realRoot, ['rev-parse', '--show-toplevel'], `Evidence root "${realRoot}" is not a Git repository.`);
  if (fs.realpathSync(gitRoot) !== realRoot) {
    evidenceFailure('repository-evidence/root-not-top-level', `Evidence root must be the Git top-level directory: ${gitRoot}`, {
      subject: { repoRoot: realRoot },
      evidence: { gitTopLevel: gitRoot },
      supportedFixes: [`pass --repo-root ${gitRoot}`],
    });
  }
  const origin = gitValue(realRoot, ['remote', 'get-url', 'origin'], 'Evidence repository must have an origin remote.');
  if (githubSlug(origin) !== authoredSlug) {
    evidenceFailure('repository-evidence/origin-mismatch', `Evidence repository origin ${JSON.stringify(origin)} does not match ${JSON.stringify(repository.url)}.`, {
      subject: { repoRoot: realRoot },
      evidence: { localOrigin: origin, authoredRepository: repository.url },
      supportedFixes: ['use the matching local checkout or correct the authored repository URL'],
    });
  }

  const revision = repository.revision.toLowerCase();
  const commit = runGit(realRoot, ['cat-file', '-e', `${revision}^{commit}`]);
  if (commit.status !== 0) {
    evidenceFailure('repository-evidence/revision-unavailable', `Evidence revision ${revision} is not available in the local repository.`, {
      subject: { repoRoot: realRoot },
      evidence: { revision },
      supportedFixes: ['fetch the pinned commit or pin an available full commit SHA'],
    });
  }

  const nodes = Object.create(null);
  let referenceCount = 0;
  const components = Array.isArray(diagram.components) ? diagram.components : [];
  for (const [componentIndex, component] of components.entries()) {
    if (!Array.isArray(component.sources) || component.sources.length === 0) continue;
    const verified = [];
    for (const [sourceIndex, authored] of component.sources.entries()) {
      const where = `/components/${componentIndex}/sources/${sourceIndex}/path`;
      const source = {
        path: verifiedSourcePath(authored.path, where),
        ...(authored.line ? { line: authored.line } : {}),
        ...(authored.end_line ? { endLine: authored.end_line } : {}),
        ...(authored.label ? { label: authored.label } : {}),
      };
      if (source.endLine && !source.line) {
        evidenceFailure('repository-evidence/line-required', `/components/${componentIndex}/sources/${sourceIndex}/end_line requires line.`, {
          subject: { path: `/components/${componentIndex}/sources/${sourceIndex}/end_line`, componentId: component.id },
          supportedFixes: ['add line or remove end_line'],
        });
      }
      if (source.endLine && source.endLine < source.line) {
        evidenceFailure('repository-evidence/line-range-invalid', `/components/${componentIndex}/sources/${sourceIndex}/end_line must be greater than or equal to line.`, {
          subject: { path: `/components/${componentIndex}/sources/${sourceIndex}`, componentId: component.id },
          evidence: { line: source.line, endLine: source.endLine },
          supportedFixes: ['use an end_line greater than or equal to line'],
        });
      }
      const object = `${revision}:${source.path}`;
      const type = runGit(realRoot, ['cat-file', '-t', object]);
      if (type.status !== 0 || type.stdout.trim() !== 'blob') {
        evidenceFailure('repository-evidence/file-missing', `${where} does not identify a file at revision ${revision}.`, {
          subject: { path: where, componentId: component.id },
          evidence: { sourcePath: source.path, revision },
          supportedFixes: ['use a file path that exists at the pinned revision'],
        });
      }
      if (source.line) {
        const content = runGit(realRoot, ['show', object]);
        if (content.status !== 0) evidenceFailure('repository-evidence/file-unreadable', `${where} could not be read at revision ${revision}.`, {
          subject: { path: where, componentId: component.id },
          evidence: { sourcePath: source.path, revision },
          supportedFixes: ['verify the pinned blob is readable in the local checkout'],
        });
        const lineCount = sourceLineCount(content.stdout);
        const requestedLine = source.endLine || source.line;
        if (requestedLine > lineCount) {
          evidenceFailure('repository-evidence/line-out-of-range', `/components/${componentIndex}/sources/${sourceIndex} requests line ${requestedLine}, but ${source.path} has ${lineCount} lines at revision ${revision}.`, {
            subject: { path: `/components/${componentIndex}/sources/${sourceIndex}`, componentId: component.id },
            evidence: { sourcePath: source.path, requestedLine, lineCount, revision },
            supportedFixes: ['use a line range that exists at the pinned revision'],
          });
        }
      }
      verified.push({ ...source, href: sourceHref(repository.url.replace(/\.git\/?$/i, '').replace(/\/$/, ''), revision, source) });
      referenceCount += 1;
    }
    nodes[component.id] = verified;
  }
  if (referenceCount === 0) {
    evidenceFailure('repository-evidence/source-required', '/meta/repository requires at least one component source reference.', {
      subject: { path: '/meta/repository' },
      supportedFixes: ['add at least one verified component source or remove repository metadata'],
    });
  }

  return {
    schemaVersion: 1,
    verified: true,
    repository: {
      url: repository.url.replace(/\.git\/?$/i, '').replace(/\/$/, ''),
      revision,
      shortRevision: revision.slice(0, 7),
    },
    referenceCount,
    nodes,
  };
}
