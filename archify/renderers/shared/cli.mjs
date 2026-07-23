import fs from 'node:fs';
import path from 'node:path';
import { applyTemplate, renderCards, esc } from './utils.mjs';
import { validateSchema } from './validator.mjs';
import { verifyRepositoryEvidence } from './repository-evidence.mjs';
import { installRendererDiagnosticBoundary, throwDiagnosticProblems } from './diagnostics.mjs';

installRendererDiagnosticBoundary();

// Common CLI head: node render-<type>.mjs [input.json] [output.html]
export function loadDiagram({ rendererDir, diagramType, defaultExample, argv = process.argv }) {
  const skillRoot = path.resolve(rendererDir, '../..');
  const inputPath = path.resolve(argv[2] || path.join(skillRoot, 'examples', defaultExample));
  const diagram = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  validateSchema(diagramType, diagram);
  validateGuidedViews(diagramType, diagram);
  validateRelationshipIds(diagramType, diagram);
  const sourceEvidence = verifyRepositoryEvidence(diagramType, diagram, process.env.ARCHIFY_REPO_ROOT);
  const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  // Optional chaining: in degraded mode (no ajv) malformed input must still
  // reach the renderer's friendly layout checks instead of crashing here.
  const outPath = path.resolve(process.cwd(), argv[3] || diagram.meta?.output || `${diagramType}.html`);
  return { diagram, template, outPath, sourceEvidence };
}

const START_TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);

// Common CLI tail: fill the template and write the standalone HTML file.
// The keyboard hint and the restrained start link are viewer-only — neither
// belongs in canonical SVG exports or on paper.
export function writeDiagram({ outPath, template, diagramType, meta, footerLabel, svg, cards, sourceEvidence = null }) {
  if (!START_TYPES.has(diagramType)) throw new Error(`writeDiagram: unknown diagram type ${JSON.stringify(diagramType)}`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const guidedHint = Array.isArray(meta.views) && meta.views.length
    ? ' &bull; <kbd>[</kbd>/<kbd>]</kbd> views &bull; <kbd>P</kbd> play story'
    : '';
  const startUrl = `https://tt-a1i.github.io/archify/start.html?type=${esc(diagramType)}`;
  fs.writeFileSync(outPath, applyTemplate(template, {
    title: meta.title,
    subtitle: meta.subtitle,
    footer: `${footerLabel} &bull; Built with Archify<span class="no-print"> &bull; <a class="artifact-start-link" href="${startUrl}" target="_blank" rel="noopener noreferrer">Create yours &nearr;</a> &bull; Hover to trace &bull; <kbd>R</kbd> route &bull; Click to focus &bull; <kbd>+</kbd>/<kbd>&minus;</kbd> zoom &bull; <kbd>M</kbd> radar${guidedHint} &bull; <kbd>T</kbd> theme &bull; <kbd>E</kbd> export</span>`,
    svg,
    cards: renderCards(cards),
    visualPreset: meta.visual_preset || 'classic',
    guidedViews: meta.views || [],
    sourceEvidence,
  }));
  console.log(outPath);
}

const SEMANTIC_COLLECTIONS = {
  architecture: 'components',
  workflow: 'nodes',
  sequence: 'participants',
  dataflow: 'nodes',
  lifecycle: 'states',
};

const RELATIONSHIP_COLLECTIONS = {
  architecture: 'connections',
  workflow: 'edges',
  sequence: 'messages',
  dataflow: 'flows',
  lifecycle: 'transitions',
};

// Relationship IDs are optional for backwards compatibility, but once an
// author supplies one it becomes the durable identity used by viewer links.
// Keep uniqueness enforcement in the shared zero-install path so every typed
// renderer fails the same way even when development dependencies are absent.
export function validateRelationshipIds(diagramType, diagram) {
  const collection = RELATIONSHIP_COLLECTIONS[diagramType];
  const relationships = collection && Array.isArray(diagram[collection]) ? diagram[collection] : [];
  const seen = new Set();
  const problems = [];

  relationships.forEach((relationship, index) => {
    if (relationship.id === undefined || relationship.id === null || relationship.id === '') return;
    if (seen.has(relationship.id)) {
      problems.push(`/${collection}/${index}/id duplicates relationship id ${JSON.stringify(relationship.id)}`);
    }
    seen.add(relationship.id);
  });

  if (problems.length) {
    throwDiagnosticProblems('Relationship identity validation failed', problems, {
      code: 'relationship/duplicate-id',
      subject: { diagramType, collection },
    });
  }
}

// JSON Schema keeps the view object bounded; this pass checks facts that span
// collections. Keeping it here makes the same contract apply to all five
// renderers, including the zero-install standalone-validator path.
export function validateGuidedViews(diagramType, diagram) {
  const views = diagram.meta?.views;
  if (!Array.isArray(views) || views.length === 0) return;
  const collection = SEMANTIC_COLLECTIONS[diagramType];
  const semanticIds = new Set((diagram[collection] || []).map((item) => item.id));
  const seen = new Set();
  const problems = [];

  views.forEach((view, index) => {
    if (seen.has(view.id)) problems.push(`/meta/views/${index}/id duplicates view id ${JSON.stringify(view.id)}`);
    seen.add(view.id);
    const seenFocus = new Set();
    (view.focus || []).forEach((id, focusIndex) => {
      if (seenFocus.has(id)) {
        problems.push(`/meta/views/${index}/focus/${focusIndex} duplicates semantic id ${JSON.stringify(id)}`);
      }
      seenFocus.add(id);
      if (!semanticIds.has(id)) {
        problems.push(`/meta/views/${index}/focus/${focusIndex} references unknown semantic id ${JSON.stringify(id)}`);
      }
    });
  });

  if (problems.length) {
    throwDiagnosticProblems('Guided view validation failed', problems, {
      code: 'guided-view/invalid',
      subject: { diagramType, collection: 'meta.views' },
    });
  }
}

// Accessible name for the generated diagram SVG.
export function svgRootAttrs(meta, kind) {
  const animation = meta.animation === 'trace' ? ' data-animation="trace"' : '';
  const preset = ` data-preset="${esc(meta.visual_preset || 'classic')}"`;
  const requestedProfile = process.env.ARCHIFY_QUALITY_PROFILE || meta.quality_profile;
  const qualityProfile = requestedProfile === 'showcase' ? 'showcase' : 'standard';
  const advisory = requestedProfile ? '' : ' data-quality-gates="advisory"';
  return `role="img" aria-labelledby="archify-diagram-title archify-diagram-description"${animation}${preset} data-quality-profile="${esc(qualityProfile)}"${advisory}`;
}

// Keep the accessible name inside the SVG so it survives standalone SVG
// export and embedding. The fixed IDs are deterministic because an Archify
// artifact intentionally contains one primary diagram SVG.
export function svgAccessibleText(meta, kind) {
  const description = meta.subtitle || `A ${kind} generated by Archify.`;
  return `        <title id="archify-diagram-title">${esc(meta.title)}</title>\n        <desc id="archify-diagram-description">${esc(description)}</desc>`;
}

export function animateAttr(meta, kind, step) {
  if (meta.animation !== 'trace') return '';
  // Ambient trace must finish inside the fixed six-second WebM capture. The
  // cap affects visual delay only; authored order and semantic identity stay
  // untouched in the JSON, DOM, Story, and relationship contracts.
  const safeStep = Number.isFinite(step) && step >= 0 ? Math.min(12, Math.floor(step)) : 0;
  return ` data-animate="${kind}" style="--step:${safeStep}"`;
}

// Stable semantic hooks for the standalone HTML explorer. IDs already pass
// the schema's conservative identifier pattern; escape again at the markup
// boundary so these helpers remain safe if that contract expands later.
export function focusNodeAttrs(id, label, metadata = {}) {
  const optional = [
    ['data-node-kind', metadata.kind],
    ['data-node-sublabel', metadata.sublabel],
    ['data-node-tag', metadata.tag],
    ['data-node-context', metadata.context],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([name, value]) => ` ${name}="${esc(String(value))}"`)
    .join('');
  const detail = [metadata.sublabel, metadata.context]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .join(', ');
  const aria = detail ? `Focus ${label}, ${detail}` : `Focus ${label}`;
  return `id="node-${esc(id)}" data-node-id="${esc(id)}" data-node-label="${esc(label)}" tabindex="0" role="button" aria-label="${esc(aria)}" aria-pressed="false"${optional}`;
}

// Native SVG titles preserve a compact details-on-demand fallback when the
// canonical SVG is embedded inline outside the full Archify viewer.
export function focusNodeTitle(label, metadata = {}) {
  const parts = [label, metadata.sublabel, metadata.context, metadata.tag]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return `<title>${esc(parts.join(' · '))}</title>`;
}

export function focusEdgeAttrs(from, to, label, key, id) {
  const named = label ? ` data-edge-label="${esc(label)}"` : '';
  const keyed = key !== undefined && key !== null ? ` data-edge-key="${esc(String(key))}"` : '';
  const identified = id !== undefined && id !== null && String(id).trim() !== ''
    ? ` data-edge-id="${esc(String(id))}"`
    : '';
  return `data-edge-from="${esc(from)}" data-edge-to="${esc(to)}"${named}${keyed}${identified}`;
}
