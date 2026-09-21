import fs from 'node:fs';
import path from 'node:path';
import { applyTemplate, renderCards, esc } from './utils.mjs';
import { validateSchema } from './validator.mjs';
import { verifyRepositoryEvidence } from './repository-evidence.mjs';
import { installRendererDiagnosticBoundary, throwDiagnosticProblems, recordDiagnostic } from './diagnostics.mjs';
import { validateEngineeringProfile } from './engineering-profiles.mjs';
import { resolveOutputPath } from './output-path.mjs';
import { prepareDiagramBrandMarks } from './brand-marks.mjs';
import { resolveLocale, translateMessage, registerLocale, SUPPORTED_LOCALES } from './i18n.mjs';

installRendererDiagnosticBoundary();

const outputPathGuards = new Map();

// meta.locale is renderer-owned Viewer UI, not authored content: en and
// zh-CN ship as built-in catalogs, so any locale tag works out of the box.
// Any other tag needs meta.translations (validated against the English
// message-key set, layered over English per-key so partial/invalid entries
// never break rendering) or it falls back to the English Viewer chrome —
// the same "omit locale, disclose the fallback" contract as before, just
// resolved from data instead of a hard-coded enum. See i18n.mjs.
function applyLocaleTranslations(diagramType, diagram) {
  const locale = diagram.meta?.locale;
  if (!locale) return;
  const translations = diagram.meta?.translations;
  if (translations && Object.keys(translations).length) {
    const report = registerLocale(locale, translations);
    if (report.missingKeys.length || report.unknownKeys.length || report.placeholderMismatches.length) {
      recordDiagnostic({
        code: 'i18n/translation-coverage',
        severity: 'warning',
        message: `meta.translations for locale ${JSON.stringify(locale)} covers ${report.coveredKeys}/${report.totalKeys} renderer-owned messages (${Math.round(report.coverage * 100)}%); uncovered keys fall back to English.`,
        subject: { diagramType, path: '/meta/translations' },
        evidence: {
          missingKeys: report.missingKeys.slice(0, 10),
          missingKeysTotal: report.missingKeys.length,
          unknownKeys: report.unknownKeys.slice(0, 10),
          unknownKeysTotal: report.unknownKeys.length,
          placeholderMismatches: report.placeholderMismatches.slice(0, 10),
          placeholderMismatchesTotal: report.placeholderMismatches.length,
        },
        supportedFixes: ['Add the missing keys to meta.translations.', 'Match each translation\'s {placeholders} to the English source string.'],
      });
      // Coverage is a fact about this render, not just a diagnostic-mode
      // artifact: print it to stderr unconditionally so `render`/`deliver`/
      // `validate` disclose the fallback even without ARCHIFY_DIAGNOSTIC_FORMAT.
      console.warn(`archify: meta.translations for locale ${JSON.stringify(locale)} covers ${report.coveredKeys}/${report.totalKeys} renderer-owned messages (${Math.round(report.coverage * 100)}%); uncovered keys fall back to English.`);
    }
  } else if (!SUPPORTED_LOCALES.includes(locale)) {
    recordDiagnostic({
      code: 'i18n/locale-fallback',
      severity: 'warning',
      message: `meta.locale ${JSON.stringify(locale)} has no built-in catalog and no meta.translations; the Viewer chrome and <html lang> fall back to English.`,
      subject: { diagramType, path: '/meta/locale' },
      supportedFixes: ['Supply meta.translations for this locale.', `Use a built-in locale: ${SUPPORTED_LOCALES.join(', ')}.`],
    });
    console.warn(`archify: meta.locale ${JSON.stringify(locale)} has no built-in catalog and no meta.translations; the Viewer chrome and <html lang> fall back to English.`);
  }
}

// Common CLI head: node render-<type>.mjs [input.json] [output.html]
// Keep this synchronous because callers also use it to establish the guarded
// output path before testing a last-moment filesystem alias change.
export function loadDiagram({ rendererDir, diagramType, defaultExample, argv = process.argv }) {
  const skillRoot = path.resolve(rendererDir, '../..');
  const inputPath = path.resolve(argv[2] || path.join(skillRoot, 'examples', defaultExample));
  const diagram = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  validateSchema(diagramType, diagram);
  applyLocaleTranslations(diagramType, diagram);
  validateGuidedViews(diagramType, diagram);
  validateRelationshipIds(diagramType, diagram);
  validateEngineeringProfile(diagramType, diagram);
  const sourceEvidence = verifyRepositoryEvidence(diagramType, diagram, process.env.ARCHIFY_REPO_ROOT);
  const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  const outputRequest = {
    requestedOutput: argv[3],
    authoredOutput: diagram.meta?.output,
    defaultOutput: `${diagramType}.html`,
    inputPaths: [inputPath],
    cwd: process.cwd(),
  };
  const { outputPath: outPath } = resolveOutputPath(outputRequest);
  outputPathGuards.set(outPath, outputRequest);
  return { diagram, template, outPath, sourceEvidence };
}

// Brand URL capture is the only asynchronous authoring step. Typed renderers
// opt into it through this wrapper without changing loadDiagram's long-lived
// synchronous safety contract.
export async function loadDiagramWithBrandMarks(options) {
  const loaded = loadDiagram(options);
  await prepareDiagramBrandMarks(options.diagramType, loaded.diagram);
  return loaded;
}

const START_TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);

// Common CLI tail: fill the template and write the standalone HTML file.
export function writeDiagram({ outPath, template, diagramType, meta, svg, cards, sourceEvidence = null }) {
  if (!START_TYPES.has(diagramType)) throw new Error(`writeDiagram: unknown diagram type ${JSON.stringify(diagramType)}`);
  const outputGuard = outputPathGuards.get(outPath);
  if (outputGuard) resolveOutputPath(outputGuard);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, applyTemplate(template, {
    title: meta.title,
    subtitle: meta.subtitle,
    svg,
    cards: renderCards(cards),
    locale: meta.locale,
    visualPreset: meta.visual_preset || 'classic',
    guidedViews: meta.views || [],
    sourceEvidence,
  }));
  outputPathGuards.delete(outPath);
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
export function svgRootAttrs(meta, explicitQualityProfile) {
  const animation = meta.animation === 'trace' ? ' data-animation="trace"' : '';
  const preset = ` data-preset="${esc(meta.visual_preset || 'classic')}"`;
  const engineeringProfile = meta.engineering_profile
    ? ` data-engineering-profile="${esc(meta.engineering_profile)}"`
    : '';
  const requestedProfile = explicitQualityProfile || process.env.ARCHIFY_QUALITY_PROFILE || meta.quality_profile;
  const qualityProfile = requestedProfile === 'showcase' ? 'showcase' : 'standard';
  const advisory = requestedProfile ? '' : ' data-quality-gates="advisory"';
  return `role="img" lang="${esc(resolveLocale(meta.locale))}" aria-labelledby="archify-diagram-title archify-diagram-description"${animation}${preset}${engineeringProfile} data-quality-profile="${esc(qualityProfile)}"${advisory}`;
}

// Keep the accessible name inside the SVG so it survives standalone SVG
// export and embedding. The fixed IDs are deterministic because an Archify
// artifact intentionally contains one primary diagram SVG.
export function svgAccessibleText(meta, kind) {
  const description = meta.subtitle || translateMessage(meta.locale, `diagram.description.${kind}`);
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
export function focusNodeAttrs(id, label, metadata = {}, locale) {
  const optional = [
    ['data-node-kind', metadata.kind],
    ['data-node-sublabel', metadata.sublabel],
    ['data-node-tag', metadata.tag],
    ['data-node-context', metadata.context],
    ['data-node-brand', metadata.brand],
    ['data-node-brand-id', metadata.brandId],
    ['data-node-brand-status', metadata.brandStatus],
    ['data-node-brand-source', metadata.brandSource],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([name, value]) => ` ${name}="${esc(String(value))}"`)
    .join('');
  const detail = [metadata.sublabel, metadata.context, metadata.brand]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .join(', ');
  const aria = detail
    ? translateMessage(locale, 'node.focus.detail', { label, detail })
    : translateMessage(locale, 'node.focus', { label });
  return `id="node-${esc(id)}" data-node-id="${esc(id)}" data-node-label="${esc(label)}" tabindex="0" role="button" aria-label="${esc(aria)}" aria-pressed="false"${optional}`;
}

// Native SVG titles preserve a compact details-on-demand fallback when the
// canonical SVG is embedded inline outside the full Archify viewer.
export function focusNodeTitle(label, metadata = {}) {
  const parts = [label, metadata.sublabel, metadata.context, metadata.tag, metadata.brand]
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
