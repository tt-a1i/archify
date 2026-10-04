import fs from 'node:fs';
import path from 'node:path';
import { validateSchema } from './validator.mjs';
import { throwDiagnosticError, withDiagnosticRecordingSuppressed } from './diagnostics.mjs';

// A levels document binds several already-authored architecture diagrams into
// one drill-down artifact. It deliberately owns no geometry: each level keeps
// its own hand-placed coordinates and its own cards, so every existing layout
// and composition check still runs unchanged against a single static canvas.
// The only new facts are the ones that span files, and they all live here.

const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const LEVEL_DIAGRAM_TYPE = 'architecture';

function fail(diagnostics) {
  const message = diagnostics.length === 1
    ? `Levels document validation failed:\n  ${diagnostics[0].message}`
    : `Levels document validation failed:\n${diagnostics.map((d) => `  ${d.message}`).join('\n')}`;
  throwDiagnosticError(message, diagnostics);
}

function diagnostic(code, message, { subject = {}, evidence = {}, supportedFixes = [] } = {}) {
  return { code, severity: 'error', message, subject, evidence, supportedFixes };
}

// Author-supplied paths are read from disk and inlined into the artifact, so
// they follow the same containment rule repository evidence already applies:
// manifest-relative POSIX only, with no way to climb out of the directory.
function resolveSourcePath(level, index, manifestDir) {
  const where = `/levels/${index}/source`;
  const authored = String(level.source || '');
  const subject = { document: 'levels', path: where, level: level.id };

  if (!authored || authored.startsWith('/') || authored.includes('\\') || CONTROL_CHARACTER_RE.test(authored)) {
    return {
      problem: diagnostic('levels/source-path-invalid', `${where} must be a manifest-relative POSIX path.`, {
        subject,
        evidence: { authoredPath: authored },
        supportedFixes: ['use a manifest-relative path with forward slashes'],
      }),
    };
  }

  const segments = authored.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return {
      problem: diagnostic('levels/source-path-escape', `${where} must stay inside the manifest directory.`, {
        subject,
        evidence: { authoredPath: authored },
        supportedFixes: ['remove empty, dot, or parent path segments'],
      }),
    };
  }

  return { sourcePath: path.join(manifestDir, segments.join(path.sep)) };
}

// The authored string cannot contain `..`, but a symlink can still point out
// of the manifest directory. Resolve both sides before reading so containment
// is a fact about the file actually opened, not about how it was spelled.
function symlinkEscape(level, index, manifestDir, sourcePath) {
  let realSource;
  let realDir;
  try {
    realSource = fs.realpathSync(sourcePath);
    realDir = fs.realpathSync(manifestDir);
  } catch {
    // A path that cannot be resolved is reported by the read below as a
    // missing source, which is the more useful diagnostic.
    return null;
  }
  if (realSource === realDir || realSource.startsWith(realDir + path.sep)) return null;
  return diagnostic('levels/source-path-escape', `/levels/${index}/source resolves outside the manifest directory through a link.`, {
    subject: { document: 'levels', path: `/levels/${index}/source`, level: level.id },
    evidence: { authoredPath: level.source, resolvedOutside: true },
    supportedFixes: ['keep level sources inside the manifest directory'],
  });
}

function readLevelDiagram(level, index, sourcePath, manifestDir) {
  const where = `/levels/${index}/source`;
  const subject = { document: 'levels', path: where, level: level.id };
  const escaped = symlinkEscape(level, index, manifestDir, sourcePath);
  if (escaped) return { problem: escaped };
  let raw;
  try {
    raw = fs.readFileSync(sourcePath, 'utf8');
  } catch (error) {
    return {
      problem: diagnostic('levels/source-missing', `${where} cannot be read: ${level.source}`, {
        subject,
        evidence: { authoredPath: level.source, reason: error.code || String(error.message || error) },
        supportedFixes: ['point source at a file that exists beside the manifest'],
      }),
    };
  }

  let diagram;
  try {
    diagram = JSON.parse(raw);
  } catch (error) {
    return {
      problem: diagnostic('levels/source-unparsable', `${where} is not valid JSON: ${level.source}`, {
        subject,
        evidence: { authoredPath: level.source, reason: String(error.message || error) },
        supportedFixes: ['fix the JSON syntax in the referenced level file'],
      }),
    };
  }

  if (diagram?.diagram_type !== LEVEL_DIAGRAM_TYPE) {
    return {
      problem: diagnostic('levels/source-type', `${where} must reference a ${LEVEL_DIAGRAM_TYPE} diagram, found ${JSON.stringify(diagram?.diagram_type ?? null)}.`, {
        subject,
        evidence: { authoredPath: level.source, diagramType: diagram?.diagram_type ?? null },
        supportedFixes: [`reference a diagram whose diagram_type is "${LEVEL_DIAGRAM_TYPE}"`],
      }),
    };
  }

  // Each level must independently satisfy its own schema before any
  // cross-level fact is checked. Re-scope the level's own diagnostics onto
  // this manifest entry and keep collecting, so one broken level does not
  // hide the rest of the document's problems. Recording is suppressed while
  // the nested check runs because the re-scoped copies are what callers read.
  try {
    withDiagnosticRecordingSuppressed(() => validateSchema(LEVEL_DIAGRAM_TYPE, diagram));
  } catch (error) {
    const nested = Array.isArray(error?.archifyDiagnostics) && error.archifyDiagnostics.length
      ? error.archifyDiagnostics
      : [{ code: 'schema/unknown', message: String(error?.message || error), evidence: {}, supportedFixes: [] }];
    return {
      problems: nested.map((inner) => diagnostic(
        `levels/source-schema`,
        `${where} references ${level.source}, which fails ${LEVEL_DIAGRAM_TYPE} schema validation: ${inner.message}`,
        {
          subject: { ...subject, levelDiagnostic: inner.code },
          evidence: { authoredPath: level.source, ...inner.evidence },
          supportedFixes: inner.supportedFixes,
        },
      )),
    };
  }
  return { diagram };
}

function checkIdentity(levels) {
  const problems = [];
  const seenIds = new Set();
  const seenSources = new Map();

  levels.forEach((level, index) => {
    if (seenIds.has(level.id)) {
      problems.push(diagnostic('levels/duplicate-id', `/levels/${index}/id duplicates level id ${JSON.stringify(level.id)}.`, {
        subject: { document: 'levels', path: `/levels/${index}/id`, level: level.id },
        evidence: { levelId: level.id },
        supportedFixes: ['give every level a unique id'],
      }));
    }
    seenIds.add(level.id);

    const priorIndex = seenSources.get(level.source);
    if (priorIndex !== undefined) {
      problems.push(diagnostic('levels/duplicate-source', `/levels/${index}/source repeats ${JSON.stringify(level.source)} already used by /levels/${priorIndex}.`, {
        subject: { document: 'levels', path: `/levels/${index}/source`, level: level.id },
        evidence: { authoredPath: level.source, firstUsedBy: priorIndex },
        supportedFixes: ['reference each level file exactly once'],
      }));
    } else {
      seenSources.set(level.source, index);
    }
  });

  return problems;
}

function componentIds(diagram) {
  const ids = new Set();
  for (const component of Array.isArray(diagram?.components) ? diagram.components : []) {
    if (component && component.id !== undefined) ids.add(component.id);
  }
  return ids;
}

function checkParents(levels, loaded) {
  const problems = [];
  const byId = new Map(levels.map((level) => [level.id, level]));
  const claimedTargets = new Map();

  levels.forEach((level, index) => {
    const parent = level.parent;
    if (!parent) return;
    const where = `/levels/${index}/parent`;
    const subject = { document: 'levels', path: where, level: level.id };

    if (parent.level === level.id) {
      problems.push(diagnostic('levels/parent-self', `${where} makes level ${JSON.stringify(level.id)} its own parent.`, {
        subject,
        evidence: { levelId: level.id },
        supportedFixes: ['point parent.level at a different level'],
      }));
      return;
    }

    if (!byId.has(parent.level)) {
      problems.push(diagnostic('levels/parent-unknown-level', `${where}/level references unknown level ${JSON.stringify(parent.level)}.`, {
        subject,
        evidence: { parentLevel: parent.level, knownLevels: [...byId.keys()] },
        supportedFixes: [`use one of: ${[...byId.keys()].join(', ')}`],
      }));
      return;
    }

    const parentDiagram = loaded.get(parent.level);
    if (parentDiagram) {
      const ids = componentIds(parentDiagram);
      if (!ids.has(parent.node)) {
        problems.push(diagnostic('levels/parent-unknown-node', `${where}/node references ${JSON.stringify(parent.node)}, which is not a component of level ${JSON.stringify(parent.level)}.`, {
          subject,
          evidence: { parentLevel: parent.level, parentNode: parent.node, knownComponents: [...ids] },
          supportedFixes: ['name a component id that exists in the parent level'],
        }));
      }
    }

    // Two levels drilling from the same node would leave the viewer with no
    // truthful single destination for that node's affordance.
    const targetKey = `${parent.level}\u0000${parent.node}`;
    const priorLevel = claimedTargets.get(targetKey);
    if (priorLevel !== undefined) {
      problems.push(diagnostic('levels/drill-target-conflict', `${where} drills from ${JSON.stringify(parent.level)}/${JSON.stringify(parent.node)}, already claimed by level ${JSON.stringify(priorLevel)}.`, {
        subject,
        evidence: { parentLevel: parent.level, parentNode: parent.node, claimedBy: priorLevel },
        supportedFixes: ['give each drillable node exactly one child level'],
      }));
    } else {
      claimedTargets.set(targetKey, level.id);
    }
  });

  return problems;
}

function checkShape(levels) {
  const problems = [];
  const roots = levels.filter((level) => !level.parent);

  if (roots.length === 0) {
    problems.push(diagnostic('levels/root-missing', 'A levels document needs exactly one root level with no parent.', {
      subject: { document: 'levels', path: '/levels' },
      evidence: { levelCount: levels.length },
      supportedFixes: ['remove parent from the entry level'],
    }));
    return { problems, root: null };
  }

  if (roots.length > 1) {
    problems.push(diagnostic('levels/root-ambiguous', `A levels document needs exactly one root level; found ${roots.length}: ${roots.map((level) => JSON.stringify(level.id)).join(', ')}.`, {
      subject: { document: 'levels', path: '/levels' },
      evidence: { roots: roots.map((level) => level.id) },
      supportedFixes: ['give every level except the entry level a parent'],
    }));
    return { problems, root: null };
  }

  const root = roots[0];
  const children = new Map();
  for (const level of levels) {
    if (!level.parent) continue;
    if (!children.has(level.parent.level)) children.set(level.parent.level, []);
    children.get(level.parent.level).push(level.id);
  }

  // Breadth-first from the single root establishes both reachability and the
  // stable order the viewer breadcrumb and the renderer emit levels in.
  const order = [];
  const seen = new Set([root.id]);
  const queue = [root.id];
  while (queue.length) {
    const current = queue.shift();
    order.push(current);
    for (const child of children.get(current) || []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }

  for (const level of levels) {
    if (seen.has(level.id)) continue;
    problems.push(diagnostic('levels/unreachable', `Level ${JSON.stringify(level.id)} cannot be reached by drilling from root ${JSON.stringify(root.id)}.`, {
      subject: { document: 'levels', level: level.id },
      evidence: { levelId: level.id, root: root.id },
      supportedFixes: ['attach the level to a parent reachable from the root, or remove it'],
    }));
  }

  return { problems, root: root.id, order, children };
}

// Resolve a levels manifest into the ordered, fully-checked structure the
// renderer and viewer consume. Throws a diagnostic error listing every
// problem found rather than stopping at the first one.
export function loadLevelsDocument(manifestPath) {
  const resolvedManifest = path.resolve(manifestPath);
  const manifestDir = path.dirname(resolvedManifest);
  let raw;
  try {
    raw = fs.readFileSync(resolvedManifest, 'utf8');
  } catch (error) {
    const filesystem = typeof error?.code === 'string'
      && typeof error?.syscall === 'string'
      && typeof error?.errno === 'number';
    if (!filesystem) throw error;
    const message = `Input could not be read: ${error.message}`;
    throwDiagnosticError(message, [{
      code: 'input/read',
      message,
      subject: { input: resolvedManifest },
      evidence: { systemCode: error.code, reason: error.message },
      supportedFixes: ['provide one readable JSON input file'],
    }]);
  }
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const message = `Input JSON could not be parsed: ${error.message}`;
    throwDiagnosticError(message, [{
      code: 'input/json-parse',
      message,
      subject: { input: resolvedManifest },
      evidence: { reason: error.message },
      supportedFixes: ['repair the JSON syntax and run validation again'],
    }]);
  }
  validateSchema('levels', document);

  const levels = document.levels;
  const problems = [...checkIdentity(levels)];
  const loaded = new Map();
  const sourcePaths = new Map();

  levels.forEach((level, index) => {
    const { sourcePath, problem } = resolveSourcePath(level, index, manifestDir);
    if (problem) {
      problems.push(problem);
      return;
    }
    sourcePaths.set(level.id, sourcePath);
    const read = readLevelDiagram(level, index, sourcePath, manifestDir);
    if (read.problem) {
      problems.push(read.problem);
      return;
    }
    if (read.problems) {
      problems.push(...read.problems);
      return;
    }
    loaded.set(level.id, read.diagram);
  });

  problems.push(...checkParents(levels, loaded));
  const shape = checkShape(levels);
  problems.push(...shape.problems);

  if (problems.length) fail(problems);

  const byId = new Map(levels.map((level) => [level.id, level]));
  return {
    manifestPath: resolvedManifest,
    manifestDir,
    meta: document.meta,
    root: shape.root,
    order: shape.order,
    levels: shape.order.map((id) => {
      const level = byId.get(id);
      return {
        id: level.id,
        label: level.label,
        note: level.note,
        source: level.source,
        sourcePath: sourcePaths.get(level.id),
        parent: level.parent ? { level: level.parent.level, node: level.parent.node } : null,
        children: (shape.children.get(level.id) || []).slice(),
        diagram: loaded.get(level.id),
      };
    }),
  };
}
