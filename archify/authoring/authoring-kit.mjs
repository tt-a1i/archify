import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QUALITY_CONTRACT,
  assertExpectedQualityContract,
  qualityContractIdentity,
} from './quality-contract.mjs';
import {
  DESKTOP_READER_DIAGRAM_WIDTH,
  MIN_PROJECTED_NODE_TEXT_PX,
  minimumReadableSourceTextPx,
} from '../renderers/shared/desktop-readability.mjs';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const AUTHORING_TYPES = Object.freeze([
  'architecture',
  'workflow',
  'sequence',
  'dataflow',
  'lifecycle',
]);

const EXAMPLES = Object.freeze({
  architecture: 'examples/web-app.architecture.json',
  workflow: 'examples/agent-tool-call.workflow.json',
  sequence: 'examples/cache-miss-request.sequence.json',
  dataflow: 'examples/product-analytics.dataflow.json',
  lifecycle: 'examples/agent-run.lifecycle.json',
});

function desktopReadability(maximumViewBoxWidth) {
  return Object.freeze({
    diagramWidth: DESKTOP_READER_DIAGRAM_WIDTH,
    minimumProjectedNodeTextPx: MIN_PROJECTED_NODE_TEXT_PX,
    minimumSourceNodeTextPxAtMaximumWidth: minimumReadableSourceTextPx(maximumViewBoxWidth),
    formula: 'sourceFontPx * min(1, diagramWidth / viewBoxWidth) >= minimumProjectedNodeTextPx',
  });
}

const EVIDENCE_SELECTION_TEMPLATE = Object.freeze({
  rootShape: 'selections.json must be a bare JSON array of source selections, not an object wrapper.',
  document: freezeDocument([{
    claimId: 'stable-source-fact-id',
    path: 'path/from-project-index',
    line: 1,
    endLine: 1,
    summary: 'short source-derived fact',
  }]),
});

function semanticRequirementsTemplate(type) {
  const scopePolicy = QUALITY_CONTRACT.semanticScope.profiles['project-overview'][type];
  const entities = Array.from(
    { length: scopePolicy.minimumRequiredEntities },
    (_, index) => ({
      key: `sourceEntity${index + 1}`,
      labels: [`accepted source label ${index + 1}`],
      roles: [scopePolicy.requiredRoles[index % scopePolicy.requiredRoles.length]],
      claimIds: [`claim-for-entity-${index + 1}`],
    }),
  );
  const relationships = Array.from(
    { length: scopePolicy.minimumRequiredRelationships },
    (_, index) => ({
      from: entities[index % entities.length].key,
      to: entities[(index + 1) % entities.length].key,
      labels: [`accepted source relationship ${index + 1}`],
      claimIds: [`claim-for-relationship-${index + 1}`],
    }),
  );
  return freezeDocument({
    instructions: 'Create this requirements document before authoring the candidate. Use project-overview for a repository or multi-diagram project overview; change to focused only when the user explicitly narrows the scope. Replace every key, label, role binding, relationship, and claim with source-specific semantics. Every entity and relationship must reference claimIds in the verified EvidenceLedger, and project-overview must satisfy the supplied type-specific density, semantic-role, and source-breadth policy.',
    document: {
      schemaVersion: QUALITY_CONTRACT.semanticScope.currentRequirementsSchemaVersion,
      diagramType: type,
      scopeProfile: QUALITY_CONTRACT.semanticScope.defaultProfile,
      entities,
      relationships,
    },
  });
}

const LAYOUT_BUDGETS = Object.freeze({
  architecture: Object.freeze({
    recommendedViewBox: Object.freeze([1080, 600]),
    maximumRecommendedViewBoxWidth: 1080,
    maximumViewBoxAspectRatio: 0.556,
    desktopReadability: desktopReadability(1080),
    primaryLimits: Object.freeze({ components: 12, boundaries: 4, cards: 3, guidedViews: 2 }),
    composition: 'Use one left-to-right main path with short vertical branches.',
  }),
  workflow: Object.freeze({
    recommendedViewBox: Object.freeze([960, 540]),
    maximumRecommendedViewBoxWidth: 960,
    maximumViewBoxAspectRatio: 0.563,
    desktopReadability: desktopReadability(960),
    primaryLimits: Object.freeze({ nodes: 12, lanes: 4, cards: 2, guidedViews: 2 }),
    composition: 'Use schema v2 horizontal lanes or phases with constraint-driven readable layout. Prefer one primary lane, or keep each semantic lane in one contiguous mainPath segment; avoid repeated back-and-forth lane re-entry. Place branches in adjacent lanes near their decision column. Retain schema v1 only for fixed legacy geometry compatibility.',
  }),
  sequence: Object.freeze({
    recommendedViewBox: Object.freeze([1080, 620]),
    maximumRecommendedViewBoxWidth: 1080,
    maximumViewBoxAspectRatio: 0.575,
    desktopReadability: desktopReadability(1080),
    primaryLimits: Object.freeze({ participants: 7, messages: 13, cards: 3, guidedViews: 2 }),
    composition: 'Keep one authored timeline and merge repeated low-information events before changing typography.',
  }),
  dataflow: Object.freeze({
    recommendedViewBox: Object.freeze([1080, 600]),
    maximumRecommendedViewBoxWidth: 1080,
    maximumViewBoxAspectRatio: 0.556,
    desktopReadability: desktopReadability(1080),
    primaryLimits: Object.freeze({ nodes: 12, stages: 5, cards: 2, guidedViews: 2 }),
    composition: 'Use horizontal stage bands and keep persistence or recovery paths as compact side branches.',
  }),
  lifecycle: Object.freeze({
    recommendedViewBox: Object.freeze([1080, 630]),
    maximumRecommendedViewBoxWidth: 1080,
    maximumViewBoxAspectRatio: 0.584,
    desktopReadability: desktopReadability(1080),
    primaryLimits: Object.freeze({ states: 10, lanes: 4, cards: 2, guidedViews: 2 }),
    composition: 'Keep the main lifecycle horizontal and place terminal outcomes in one compact terminal band.',
  }),
});

const SHAPE_EXAMPLES = freezeDocument({
  architecture: {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Replace with source-specific architecture', quality_profile: 'showcase', viewBox: [1080, 600] },
    components: [
      { id: 'sourceEntityA', type: 'frontend', label: 'Source entity A', pos: [80, 180], size: [140, 60] },
      { id: 'sourceEntityB', type: 'backend', label: 'Source entity B', pos: [340, 180], size: [140, 60] },
    ],
    connections: [{ id: 'sourceRelation', from: 'sourceEntityA', to: 'sourceEntityB', label: 'Source-derived relation' }],
  },
  workflow: {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Replace with source-specific workflow', quality_profile: 'showcase', viewBox: [960, 540] },
    lanes: [{ id: 'sourceLane', label: 'Source-derived lane' }],
    mainPath: ['sourceStepA', 'sourceStepB'],
    nodes: [
      { id: 'sourceStepA', lane: 'sourceLane', col: 0, type: 'frontend', label: 'Source step A' },
      { id: 'sourceStepB', lane: 'sourceLane', col: 1, type: 'backend', label: 'Source step B' },
    ],
    edges: [{ id: 'sourceTransition', from: 'sourceStepA', to: 'sourceStepB', label: 'Source-derived transition' }],
  },
  sequence: {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Replace with source-specific sequence', quality_profile: 'showcase', viewBox: [1080, 620] },
    participants: [
      { id: 'sourceActorA', type: 'frontend', label: 'Actor A' },
      { id: 'sourceActorB', type: 'backend', label: 'Actor B' },
    ],
    messages: [{ id: 'sourceMessage', from: 'sourceActorA', to: 'sourceActorB', y: 220, label: 'Source-derived message' }],
  },
  dataflow: {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Replace with source-specific data flow', quality_profile: 'showcase', viewBox: [1080, 600] },
    stages: [{ label: 'Source stage' }, { label: 'Destination stage' }],
    nodes: [
      { id: 'sourceDataA', type: 'frontend', label: 'Source data A', stage: 0, row: 0 },
      { id: 'sourceDataB', type: 'database', label: 'Source data B', stage: 1, row: 0 },
    ],
    flows: [{ id: 'sourceFlow', from: 'sourceDataA', to: 'sourceDataB', label: 'Source-derived data' }],
  },
  lifecycle: {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Replace with source-specific lifecycle', quality_profile: 'showcase', viewBox: [1080, 630] },
    lanes: [{ id: 'main', label: 'Source lifecycle' }],
    states: [
      { id: 'sourceStateA', type: 'start', label: 'State A', lane: 'main', col: 0 },
      { id: 'sourceStateB', type: 'success', label: 'State B', lane: 'main', col: 2 },
    ],
    transitions: [{ id: 'sourceStateChange', from: 'sourceStateA', to: 'sourceStateB', label: 'transition' }],
  },
});

function authoringCommands(type) {
  const repositoryOption = type === 'architecture' ? ' [--repo-root <path>]' : '';
  const languageOption = ' --require-authored-language <en|zh-CN>';
  return Object.freeze({
    validate: `node bin/archify.mjs validate ${type} <candidate.json> --quality showcase${repositoryOption}${languageOption} --repair-history <repair-history.json> --json`,
    validateStructuralReflow: `node bin/archify.mjs validate ${type} <candidate.json> --quality showcase${repositoryOption}${languageOption} --repair-history <repair-history.json> --repair-mode structural-reflow --json`,
    inspectLayout: `node bin/archify.mjs validate ${type} <candidate.json> --quality showcase${repositoryOption} --layout-json`,
    preflight: `node bin/archify.mjs validate ${type} <candidate.json> --quality showcase${repositoryOption}${languageOption} --repair-history <repair-history.json> --preflight --json`,
    preflightBatch: 'node bin/archify.mjs validate-batch <candidates.json> --quality showcase --json',
    deliver: `node bin/archify.mjs deliver ${type} <candidate.json> <output.html> --quality showcase${repositoryOption}${languageOption} --json`,
    visualCheck: 'node bin/archify.mjs visual-check <output.html>... --json',
    projectQuery: 'node bin/archify.mjs project-index query <index.json> [--symbol <name>] [--import <specifier>] [--path <prefix>] --json',
    sourceSearch: 'node bin/archify.mjs project-index source-search <index.json> --term <literal> [--path <prefix>] --context-lines 3 --json',
    sourceInspect: 'node bin/archify.mjs project-index inspect <index.json> --range <path:start-end> --json',
    evidenceHydrate: 'node bin/archify.mjs evidence-ledger hydrate <index.json> <selections.json> --output <ledger.json> --json',
    evidenceVerify: 'node bin/archify.mjs evidence-ledger verify <ledger.json> --project-index <index.json> --repo-root <path> --json',
    authoringRunStart: `node bin/archify.mjs authoring-run start ${type} --run-id <id> --output <run-directory> --repo-root <path> --project-index <index.json> --requirements <requirements.json> --candidate <candidate.json> --scope-profile <focused|project-overview> --expect-contract <quality-contract-sha256>${languageOption} --json`,
    authoringRunFinalize: 'node bin/archify.mjs authoring-run finalize <authoring-run.json> --candidate <candidate.json> --evidence <ledger.json> --validation <validation.json> --json',
  });
}

function freezeDocument(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDocument(child);
  return Object.freeze(value);
}

function filePacket(skillRoot, relativePath, { contextJson = false, omitFromContext = false } = {}) {
  const absolutePath = path.join(skillRoot, ...relativePath.split('/'));
  const content = fs.readFileSync(absolutePath, 'utf8');
  return Object.freeze({
    path: relativePath,
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
    ...(contextJson
      ? omitFromContext
        ? { omittedFromContext: true }
        : { document: freezeDocument(JSON.parse(content)) }
      : { content }),
  });
}

/**
 * Return the complete, byte-identical authoring contract for one diagram type.
 * Callers learn one interface; file discovery and matching-example selection
 * remain local to this module.
 */
export function loadAuthoringKit(type, {
  skillRoot = moduleRoot,
  expectContract,
  contextJson = false,
} = {}) {
  if (!AUTHORING_TYPES.includes(type)) {
    throw new Error(`Unknown diagram type "${type}". Expected one of: ${AUTHORING_TYPES.join(', ')}`);
  }
  if (expectContract !== undefined) assertExpectedQualityContract(expectContract);
  const resolvedRoot = fs.realpathSync(path.resolve(skillRoot));
  return Object.freeze({
    schemaVersion: 1,
    type,
    contract: qualityContractIdentity({ skillRoot: resolvedRoot }),
    layoutBudget: Object.freeze({
      targetViewport: Object.freeze([1440, 900]),
      ...LAYOUT_BUDGETS[type],
      targetPrimaryRange: QUALITY_CONTRACT.semanticScope
        .profiles['project-overview'][type].targetPrimaryRange,
      qualityGuards: QUALITY_CONTRACT.guards,
    }),
    commands: authoringCommands(type),
    evidenceSelectionTemplate: EVIDENCE_SELECTION_TEMPLATE,
    semanticRequirementsTemplate: semanticRequirementsTemplate(type),
    semanticScope: QUALITY_CONTRACT.semanticScope,
    repairPolicy: QUALITY_CONTRACT.repairPolicy,
    ...(contextJson ? {
      shapeExample: Object.freeze({
        policy: 'shape-only',
        instruction: 'Replace every ID, label, relationship, and topology choice with source-specific content. This exemplar demonstrates field shape only and is intentionally below project-overview density; use layoutBudget.targetPrimaryRange and semanticScope instead of copying its item count.',
        document: SHAPE_EXAMPLES[type],
      }),
    } : {}),
    capabilities: Object.freeze({
      repositoryEvidence: true,
      projectIndexQuery: true,
      projectSourceSearch: true,
      evidenceLedgerHydrate: true,
      evidenceLedgerVerify: true,
      semanticRequirements: true,
      deterministicRepairPlan: true,
      machineAuthoringReport: true,
      sharedVisualCheckSession: true,
      atomicDelivery: true,
    }),
    workflow: Object.freeze([
      'create a revision-pinned EvidenceLedger, then write semanticRequirementsTemplate before authoring the candidate',
      'author a fresh candidate within layoutBudget and cover every required entity and directed relationship using accepted source-specific labels',
      'validate after every candidate edit',
      'reuse one repair-history file and follow repairPlan; validate a requested reflow with --repair-mode structural-reflow, without deleting semantics or reducing typography',
      'run preflight on the first deterministic pass and before freezing',
      'write selections.json using evidenceSelectionTemplate.document as the exact root shape, then hydrate and verify revision-pinned evidence before delivery',
      'deliver the frozen candidate exactly once',
    ]),
    files: Object.freeze({
      schema: filePacket(resolvedRoot, `schemas/${type}.schema.json`, { contextJson }),
      commonSchema: filePacket(resolvedRoot, 'schemas/common.schema.json', { contextJson }),
      example: filePacket(resolvedRoot, EXAMPLES[type], { contextJson, omitFromContext: contextJson }),
    }),
  });
}
