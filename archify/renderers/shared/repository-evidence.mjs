import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { throwDiagnosticError } from './diagnostics.mjs';
import { parseRepositoryRemote, redactRepositoryRemote, repositorySourceHref } from './repository-location.mjs';

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

function sourceLineCount(content) {
  if (!content.length) return 0;
  const lines = content.split(/\r\n|\n|\r/);
  return lines.length - (/(?:\r\n|\n|\r)$/.test(content) ? 1 : 0);
}

// Every diagram type carries its nodes under a different property name, and
// source evidence is authored on those nodes. One table keeps the verification
// below identical for all five types instead of branching per type: the only
// per-type fact is which array to read and which JSON pointer to quote back.
const EVIDENCE_NODE_COLLECTIONS = {
  architecture: 'components',
  workflow: 'nodes',
  sequence: 'participants',
  dataflow: 'nodes',
  lifecycle: 'states',
};

function evidenceNodes(diagramType, diagram) {
  const collection = EVIDENCE_NODE_COLLECTIONS[diagramType];
  if (!collection) return null;
  return { collection, nodes: Array.isArray(diagram?.[collection]) ? diagram[collection] : [] };
}

export function hasRepositoryEvidence(diagramType, diagram) {
  const authored = evidenceNodes(diagramType, diagram);
  if (!authored) return false;
  return Boolean(diagram?.meta?.repository) || authored.nodes.some((node) => Array.isArray(node?.sources) && node.sources.length);
}

export function verifyRepositoryEvidence(diagramType, diagram, repoRootInput) {
  if (!hasRepositoryEvidence(diagramType, diagram)) return null;
  const { collection, nodes: authoredNodes } = evidenceNodes(diagramType, diagram);

  const repository = diagram.meta?.repository;
  if (!repository) evidenceFailure('repository-evidence/repository-required', 'Repository evidence requires /meta/repository.', {
    subject: { path: '/meta/repository', diagramType, collection },
    supportedFixes: [`add the pinned repository metadata or remove /${collection} sources`],
  });
  if (!FULL_SHA_RE.test(repository.revision || '')) {
    evidenceFailure('repository-evidence/revision-invalid', '/meta/repository/revision must be a full 40-character commit SHA.', {
      subject: { path: '/meta/repository/revision' },
      evidence: { revision: repository.revision },
      supportedFixes: ['pin one full 40-character commit SHA'],
    });
  }
  const location = parseRepositoryRemote(repository.url, { authored: true });
  if (!location) {
    evidenceFailure('repository-evidence/url-invalid', '/meta/repository/url must be a credential-free HTTP(S) or Git SSH repository address without query, fragment, or dot segments.', {
      subject: { path: '/meta/repository/url' },
      supportedFixes: ['declare the matching repository address without credentials; use link_mode: local-only for internal repositories'],
    });
  }
  const linkMode = repository.link_mode ?? 'web';
  if (!['web', 'local-only'].includes(linkMode)) evidenceFailure('repository-evidence/link-mode-invalid', 'Repository link_mode must be web or local-only.');
  if (repository.provider !== undefined && (!['github', 'gitee'].includes(repository.provider) || repository.provider !== location.provider)) {
    evidenceFailure('repository-evidence/provider-invalid', 'Repository provider must match its supported public host (github.com or gitee.com).', {
      subject: { path: '/meta/repository/provider' },
      supportedFixes: ['use the matching provider or omit provider and select link_mode: local-only'],
    });
  }
  if (linkMode === 'web' && (!location.provider || location.protocol !== 'https:' || location.endpoint !== 'standard' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(location.path))) {
    evidenceFailure('repository-evidence/links-unsupported', 'Web source links require a canonical GitHub or Gitee HTTPS owner/repository URL.', {
      subject: { path: '/meta/repository/url' },
      supportedFixes: ['use a canonical GitHub or Gitee URL, or select link_mode: local-only to retain local verification without web links'],
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
  if (parseRepositoryRemote(origin)?.identity !== location.identity) {
    const safeOrigin = redactRepositoryRemote(origin);
    evidenceFailure('repository-evidence/origin-mismatch', `Evidence repository origin ${JSON.stringify(safeOrigin)} does not match ${JSON.stringify(repository.url)}.`, {
      subject: { repoRoot: realRoot },
      evidence: { localOrigin: safeOrigin, authoredRepository: repository.url },
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
  for (const [nodeIndex, node] of authoredNodes.entries()) {
    if (!Array.isArray(node.sources) || node.sources.length === 0) continue;
    // `componentId` shipped with the architecture-only path; keep it beside the
    // type-neutral `nodeId` so existing agent handling stays valid.
    const nodeSubject = collection === 'components'
      ? { diagramType, collection, nodeId: node.id, componentId: node.id }
      : { diagramType, collection, nodeId: node.id };
    const verified = [];
    for (const [sourceIndex, authored] of node.sources.entries()) {
      const at = `/${collection}/${nodeIndex}/sources/${sourceIndex}`;
      const where = `${at}/path`;
      const source = {
        path: verifiedSourcePath(authored.path, where),
        ...(authored.line ? { line: authored.line } : {}),
        ...(authored.end_line ? { endLine: authored.end_line } : {}),
        ...(authored.label ? { label: authored.label } : {}),
      };
      if (source.endLine && !source.line) {
        evidenceFailure('repository-evidence/line-required', `${at}/end_line requires line.`, {
          subject: { path: `${at}/end_line`, ...nodeSubject },
          supportedFixes: ['add line or remove end_line'],
        });
      }
      if (source.endLine && source.endLine < source.line) {
        evidenceFailure('repository-evidence/line-range-invalid', `${at}/end_line must be greater than or equal to line.`, {
          subject: { path: at, ...nodeSubject },
          evidence: { line: source.line, endLine: source.endLine },
          supportedFixes: ['use an end_line greater than or equal to line'],
        });
      }
      const object = `${revision}:${source.path}`;
      const type = runGit(realRoot, ['cat-file', '-t', object]);
      if (type.status !== 0 || type.stdout.trim() !== 'blob') {
        evidenceFailure('repository-evidence/file-missing', `${where} does not identify a file at revision ${revision}.`, {
          subject: { path: where, ...nodeSubject },
          evidence: { sourcePath: source.path, revision },
          supportedFixes: ['use a file path that exists at the pinned revision'],
        });
      }
      if (source.line) {
        const content = runGit(realRoot, ['show', object]);
        if (content.status !== 0) evidenceFailure('repository-evidence/file-unreadable', `${where} could not be read at revision ${revision}.`, {
          subject: { path: where, ...nodeSubject },
          evidence: { sourcePath: source.path, revision },
          supportedFixes: ['verify the pinned blob is readable in the local checkout'],
        });
        const lineCount = sourceLineCount(content.stdout);
        const requestedLine = source.endLine || source.line;
        if (requestedLine > lineCount) {
          evidenceFailure('repository-evidence/line-out-of-range', `${at} requests line ${requestedLine}, but ${source.path} has ${lineCount} lines at revision ${revision}.`, {
            subject: { path: at, ...nodeSubject },
            evidence: { sourcePath: source.path, requestedLine, lineCount, revision },
            supportedFixes: ['use a line range that exists at the pinned revision'],
          });
        }
      }
      verified.push({ ...source, ...(linkMode === 'web' ? { href: repositorySourceHref(location.provider, location.url, revision, source) } : {}) });
      referenceCount += 1;
    }
    nodes[node.id] = verified;
  }
  if (referenceCount === 0) {
    evidenceFailure('repository-evidence/source-required', `/meta/repository requires at least one /${collection} source reference.`, {
      subject: { path: '/meta/repository', diagramType, collection },
      supportedFixes: [`add at least one verified /${collection} source or remove repository metadata`],
    });
  }

  return {
    schemaVersion: 1,
    verified: true,
    repository: {
      url: location.url,
      revision,
      shortRevision: revision.slice(0, 7),
      label: location.provider === 'github' ? location.path : location.url.replace(/^(?:https?:\/\/|ssh:\/\/git@|git@)/, ''),
      ...(linkMode === 'web' ? { href: `${location.url}/tree/${revision}` } : { linkMode }),
    },
    referenceCount,
    nodes,
  };
}
