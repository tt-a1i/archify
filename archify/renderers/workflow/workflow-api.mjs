import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDiagramHtml, validateCrossCollectionContracts } from '../shared/cli.mjs';
import { validateEngineeringProfile } from '../shared/engineering-profiles.mjs';
import { validateSchema } from '../shared/validator.mjs';
import { verifyRepositoryEvidence } from '../shared/repository-evidence.mjs';
import { prepareDiagramBrandMarks } from '../shared/brand-marks.mjs';
import { withDiagnosticRecordingSuppressed } from '../shared/diagnostics.mjs';
import { compileWorkflow } from './workflow-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '../..');
let cachedTemplate;

function readTemplate() {
  if (cachedTemplate === undefined) {
    cachedTemplate = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  }
  return cachedTemplate;
}

// In-memory counterpart to render-workflow.mjs: same validation and resource
// preparation as the CLI's loadDiagramWithBrandMarks + compileWorkflow, minus
// argv/input-file handling and output writes. Resource preparation can still
// read files or fetch pinned brand resources, and the HTML template is read
// on first use. Never installs the process-level diagnostics boundary, so an
// author-facing failure comes back as { ok: false } instead of taking down
// the host process; only an unclassified implementation error still throws.
// The caller owns delivery: nothing here writes a file or claims completion.
//
// Wrapped in withDiagnosticRecordingSuppressed so a host process that happens
// to run with ARCHIFY_DIAGNOSTIC_FORMAT=json set (e.g. because it also shells
// out to archify's own CLI elsewhere) never has this call's diagnostics leak
// into that unrelated CLI failure history.
export async function renderWorkflow(options = {}) {
  return withDiagnosticRecordingSuppressed(() => renderWorkflowInternal(options));
}

async function renderWorkflowInternal({
  workflow,
  qualityProfile,
  repoRoot,
} = {}) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    throw new TypeError('renderWorkflow requires one parsed workflow document object.');
  }
  // Clone so a caller's object is never mutated by validation or brand-mark
  // preparation, and so concurrent calls never observe each other's writes.
  const diagram = structuredClone(workflow);
  let sourceEvidence = null;
  try {
    validateSchema('workflow', diagram);
    validateCrossCollectionContracts('workflow', diagram);
    validateEngineeringProfile('workflow', diagram);
    sourceEvidence = verifyRepositoryEvidence('workflow', diagram, repoRoot);
    await prepareDiagramBrandMarks('workflow', diagram);
  } catch (error) {
    if (!error?.archifyDiagnostics?.length) throw error;
    return { ok: false, error: error.message, diagnostics: error.archifyDiagnostics };
  }

  const compiled = compileWorkflow({ workflow: diagram, qualityProfile });
  if (!compiled.ok) {
    return { ok: false, error: compiled.error, diagnostics: compiled.diagnostics, receipt: compiled.receipt };
  }

  // Report the effective profile, not just the authored one: an explicit
  // qualityProfile argument is what actually got rendered into compiled.svg,
  // so meta must agree with the SVG rather than silently disagreeing with it.
  const { resolvedQualityProfile } = compiled;
  const meta = resolvedQualityProfile && resolvedQualityProfile !== diagram.meta?.quality_profile
    ? { ...diagram.meta, quality_profile: resolvedQualityProfile }
    : diagram.meta;

  const html = renderDiagramHtml({
    diagramType: 'workflow',
    meta,
    svg: compiled.svg,
    cards: diagram.cards,
    sourceEvidence,
    template: readTemplate(),
  });

  return { ok: true, html, svg: compiled.svg, cards: diagram.cards, meta, sourceEvidence, receipt: compiled.receipt };
}
