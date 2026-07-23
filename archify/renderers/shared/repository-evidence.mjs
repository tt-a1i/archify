import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const FULL_SHA_RE = /^[a-f0-9]{40}$/i;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

function runGit(repoRoot, args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Could not run Git: ${result.error.message}`);
  return result;
}

function gitValue(repoRoot, args, failure) {
  const result = runGit(repoRoot, args);
  if (result.status !== 0) throw new Error(failure);
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
    throw new Error(`${where} must be a repo-relative POSIX path.`);
  }
  const segments = sourcePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..') || segments[0] === '.git') {
    throw new Error(`${where} must stay inside the repository and may not address .git.`);
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
  if (diagramType !== 'architecture') throw new Error('Repository evidence is currently supported for architecture diagrams only.');

  const repository = diagram.meta?.repository;
  if (!repository) throw new Error('Repository evidence requires /meta/repository.');
  if (!FULL_SHA_RE.test(repository.revision || '')) {
    throw new Error('/meta/repository/revision must be a full 40-character commit SHA.');
  }
  const authoredSlug = githubSlug(repository.url);
  if (!authoredSlug || !String(repository.url).startsWith('https://github.com/')) {
    throw new Error('/meta/repository/url must be a public https://github.com owner/repository URL.');
  }
  if (!repoRootInput) {
    throw new Error('This diagram declares source evidence. Pass --repo-root <repository> so Archify can verify it before rendering.');
  }

  const requestedRoot = path.resolve(repoRootInput);
  let realRoot;
  try {
    realRoot = fs.realpathSync(requestedRoot);
  } catch (error) {
    throw new Error(`Could not resolve evidence repository root "${requestedRoot}": ${error.message}`);
  }
  const gitRoot = gitValue(realRoot, ['rev-parse', '--show-toplevel'], `Evidence root "${realRoot}" is not a Git repository.`);
  if (fs.realpathSync(gitRoot) !== realRoot) {
    throw new Error(`Evidence root must be the Git top-level directory: ${gitRoot}`);
  }
  const origin = gitValue(realRoot, ['remote', 'get-url', 'origin'], 'Evidence repository must have an origin remote.');
  if (githubSlug(origin) !== authoredSlug) {
    throw new Error(`Evidence repository origin ${JSON.stringify(origin)} does not match ${JSON.stringify(repository.url)}.`);
  }

  const revision = repository.revision.toLowerCase();
  const commit = runGit(realRoot, ['cat-file', '-e', `${revision}^{commit}`]);
  if (commit.status !== 0) {
    throw new Error(`Evidence revision ${revision} is not available in the local repository.`);
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
        throw new Error(`/components/${componentIndex}/sources/${sourceIndex}/end_line requires line.`);
      }
      if (source.endLine && source.endLine < source.line) {
        throw new Error(`/components/${componentIndex}/sources/${sourceIndex}/end_line must be greater than or equal to line.`);
      }
      const object = `${revision}:${source.path}`;
      const type = runGit(realRoot, ['cat-file', '-t', object]);
      if (type.status !== 0 || type.stdout.trim() !== 'blob') {
        throw new Error(`${where} does not identify a file at revision ${revision}.`);
      }
      if (source.line) {
        const content = runGit(realRoot, ['show', object]);
        if (content.status !== 0) throw new Error(`${where} could not be read at revision ${revision}.`);
        const lineCount = sourceLineCount(content.stdout);
        const requestedLine = source.endLine || source.line;
        if (requestedLine > lineCount) {
          throw new Error(`/components/${componentIndex}/sources/${sourceIndex} requests line ${requestedLine}, but ${source.path} has ${lineCount} lines at revision ${revision}.`);
        }
      }
      verified.push({ ...source, href: sourceHref(repository.url.replace(/\.git\/?$/i, '').replace(/\/$/, ''), revision, source) });
      referenceCount += 1;
    }
    nodes[component.id] = verified;
  }
  if (referenceCount === 0) {
    throw new Error('/meta/repository requires at least one component source reference.');
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
