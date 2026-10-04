import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { esc, renderCards } from '../shared/utils.mjs';
import { guardOutputPath, writeLevelsDocument } from '../shared/cli.mjs';
import { installRendererDiagnosticBoundary, throwDiagnosticError } from '../shared/diagnostics.mjs';
import { loadLevelsDocument } from '../shared/levels-document.mjs';

installRendererDiagnosticBoundary();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '../..');
const architectureRenderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');

// Each level is rendered by the ordinary architecture renderer in its own
// process. That is deliberate: the level's SVG is produced by exactly the code
// path that would produce it as a standalone artifact, after exactly the same
// layout, composition, and readability checks. A levels document can therefore
// never contain a level that would not have passed on its own, and this file
// needs no knowledge of geometry at all.
function renderLevel(level) {
  const result = spawnSync(process.execPath, [architectureRenderer, level.sourcePath, '--emit-svg'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
  });

  if (result.error) {
    throwDiagnosticError(`Levels rendering failed for level "${level.id}": ${result.error.message}`, [{
      code: 'levels/render-spawn',
      severity: 'error',
      message: `Level "${level.id}" could not be rendered: ${result.error.message}`,
      subject: { document: 'levels', level: level.id },
      evidence: { source: level.source },
      supportedFixes: [],
    }]);
  }

  if (result.status !== 0) {
    // Surface the level's own diagnostics rather than a generic failure, so a
    // geometry problem reads the same as it would from `validate architecture`.
    const nested = parseNestedDiagnostics(result.stderr);
    throwDiagnosticError(
      `Level "${level.id}" (${level.source}) failed architecture rendering:\n${result.stderr.trim()}`,
      nested.length ? nested.map((inner) => ({
        ...inner,
        subject: { ...inner.subject, document: 'levels', level: level.id },
      })) : [{
        code: 'levels/render-failed',
        severity: 'error',
        message: `Level "${level.id}" failed architecture rendering.`,
        subject: { document: 'levels', level: level.id },
        evidence: { source: level.source, stderr: result.stderr.trim().slice(0, 2000) },
        supportedFixes: [`fix ${level.source} until it renders on its own`],
      }],
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throwDiagnosticError(`Level "${level.id}" produced unreadable renderer output: ${error.message}`, [{
      code: 'levels/render-output',
      severity: 'error',
      message: `Level "${level.id}" produced unreadable renderer output.`,
      subject: { document: 'levels', level: level.id },
      evidence: { source: level.source },
      supportedFixes: [],
    }]);
  }
}

// The architecture renderer emits a JSON diagnostic envelope on stderr when
// ARCHIFY_DIAGNOSTIC_FORMAT=json. Recover it when present; fall back to the
// raw text otherwise rather than inventing structure.
function parseNestedDiagnostics(stderr) {
  const start = stderr.indexOf('{');
  if (start === -1) return [];
  try {
    const parsed = JSON.parse(stderr.slice(start));
    const list = Array.isArray(parsed?.diagnostics) ? parsed.diagnostics : [];
    return list.filter((entry) => entry && typeof entry.code === 'string');
  } catch {
    return [];
  }
}

// One `.diagram-container` carries all the viewer chrome and its unique
// element ids, so it must not be duplicated. Every level's SVG becomes a
// direct child of that single container instead, with only the active level
// visible. Direct child matters: existing rules and viewer probes select
// `.diagram-container > svg`, so a wrapper element would silently detach the
// diagram stage from the chrome that measures and drives it.
function composeSvg(levels, activeId) {
  return levels.map(({ level, rendered }) => {
    const active = level.id === activeId;
    const attrs = [
      `data-level="${esc(level.id)}"`,
      `data-level-label="${esc(level.label)}"`,
      // `hidden="hidden"` rather than a bare `hidden`: the attribute lands on
      // an SVG root, and a valueless attribute is legal HTML but not
      // well-formed XML, which SVG export and the artifact checks require.
      active ? 'data-level-active="true"' : 'hidden="hidden" aria-hidden="true"',
    ].join(' ');
    const marker = '<svg ';
    const at = rendered.svg.indexOf(marker);
    if (at === -1) {
      throwDiagnosticError(`Level "${level.id}" produced no SVG root.`, [{
        code: 'levels/render-output',
        severity: 'error',
        message: `Level "${level.id}" produced no SVG root.`,
        subject: { document: 'levels', level: level.id },
        evidence: { source: level.source },
        supportedFixes: [],
      }]);
    }
    return `${rendered.svg.slice(0, at + marker.length)}${attrs} ${rendered.svg.slice(at + marker.length)}`;
  }).join('\n');
}

function composeCards(levels, activeId) {
  return levels.map(({ level, rendered }) => {
    // renderCards always returns a wrapper, so decide on the authored cards
    // rather than on the markup, and emit nothing for a level without any.
    if (!Array.isArray(rendered.cards) || rendered.cards.length === 0) return '';
    const active = level.id === activeId;
    const attrs = active
      ? `data-level="${esc(level.id)}" data-level-active="true"`
      : `data-level="${esc(level.id)}" hidden aria-hidden="true"`;
    // Tag the wrapper so the viewer can swap card content with the diagram.
    return renderCards(rendered.cards).replace('<div class="cards">', `<div class="cards" ${attrs}>`);
  }).filter(Boolean).join('\n');
}

function manifestForViewer(resolved, rendered) {
  return {
    root: resolved.root,
    active: resolved.root,
    levels: resolved.levels.map((level) => ({
      id: level.id,
      label: level.label,
      ...(level.note ? { note: level.note } : {}),
      parent: level.parent,
      children: level.children,
      title: level.diagram.meta.title,
      views: level.diagram.meta.views || [],
      nodes: (level.diagram.components || []).map((component) => component.id),
      // The drill affordance belongs on the parent's node, but the link is
      // authored on the child, so invert it once here for the viewer.
      drillFrom: level.parent ? { level: level.parent.level, node: level.parent.node } : null,
      viewBox: rendered.get(level.id).meta.viewBox || null,
    })),
  };
}

const inputPath = path.resolve(process.argv[2] || '');
if (!process.argv[2]) {
  throwDiagnosticError('render-levels requires a levels document path.', [{
    code: 'levels/missing-input',
    severity: 'error',
    message: 'render-levels requires a levels document path.',
    subject: { document: 'levels' },
    evidence: {},
    supportedFixes: ['pass the path to a *.levels.json document'],
  }]);
}

const resolved = loadLevelsDocument(inputPath);
const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
const outPath = guardOutputPath({
  requestedOutput: process.argv[3],
  authoredOutput: resolved.meta.output,
  defaultOutput: 'levels.html',
  inputPaths: [resolved.manifestPath, ...resolved.levels.map((level) => level.sourcePath)],
  cwd: process.cwd(),
});

const renderedById = new Map();
const pairs = resolved.levels.map((level) => {
  const rendered = renderLevel(level);
  renderedById.set(level.id, rendered);
  return { level, rendered };
});

const rootLevel = resolved.levels.find((level) => level.id === resolved.root);

writeLevelsDocument({
  outPath,
  template,
  meta: resolved.meta,
  svg: composeSvg(pairs, resolved.root),
  cards: composeCards(pairs, resolved.root),
  levels: manifestForViewer(resolved, renderedById),
  // The root level is what opens, so its views and evidence are what the
  // already-shipped viewer modules should see on load.
  guidedViews: rootLevel.diagram.meta.views || [],
  sourceEvidence: renderedById.get(resolved.root).sourceEvidence || null,
});
