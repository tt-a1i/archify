import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const DESKTOP_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1600, height: 1000 },
  { width: 1920, height: 1080 },
  { width: 2048, height: 1320 },
];

const CAPTURE_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 2048, height: 1320 },
];

const ENFORCEMENT_RUNTIME_PATHS = Object.freeze([
  'authoring/authored-language.mjs',
  'authoring/authoring-run.mjs',
  'authoring/candidate-preflight.mjs',
  'authoring/content-quality.mjs',
  'authoring/quality-contract.mjs',
  'authoring/semantic-requirements.mjs',
  'bin/archify.mjs',
  'orchestration/report.mjs',
  'orchestration/run-recorder.mjs',
  'orchestration/suite-runner.mjs',
  'scripts/check-render-output.mjs',
  'schemas/architecture.schema.json',
  'schemas/common.schema.json',
  'schemas/dataflow.schema.json',
  'schemas/lifecycle.schema.json',
  'schemas/sequence.schema.json',
  'schemas/workflow.schema.json',
]);

function recursiveModulePaths(root, relativeDirectory) {
  const directory = path.join(root, ...relativeDirectory.split('/'));
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isDirectory()) return recursiveModulePaths(root, relativePath);
      return entry.isFile() && entry.name.endsWith('.mjs') ? [relativePath] : [];
    })
    .sort();
}

export const QUALITY_CONTRACT = deepFreeze({
  schemaVersion: 1,
  semanticScope: {
    schemaVersion: 1,
    currentRequirementsSchemaVersion: 2,
    legacyRequirementsProfile: 'focused',
    defaultProfile: 'project-overview',
    profiles: {
      focused: {
        minimumRequiredEntities: 2,
        minimumRequiredRelationships: 1,
        minimumUniqueRequiredClaimIds: 3,
        minimumDistinctSourceFiles: 1,
        requiredRoles: [],
      },
      'project-overview': {
        architecture: {
          targetPrimaryRange: { components: [6, 10] },
          minimumRequiredEntities: 6,
          minimumRequiredRelationships: 5,
          minimumUniqueRequiredClaimIds: 6,
          minimumDistinctSourceFiles: 5,
          requiredRoles: ['entry', 'configuration', 'control', 'runtime', 'observability', 'integration'],
        },
        workflow: {
          targetPrimaryRange: { nodes: [7, 10] },
          minimumRequiredEntities: 7,
          minimumRequiredRelationships: 6,
          minimumUniqueRequiredClaimIds: 7,
          minimumDistinctSourceFiles: 4,
          requiredRoles: ['trigger', 'parse', 'validate', 'apply', 'observe', 'failure', 'outcome'],
        },
        sequence: {
          targetPrimaryRange: { participants: [5, 7], messages: [9, 13] },
          minimumRequiredEntities: 5,
          minimumRequiredRelationships: 9,
          minimumUniqueRequiredClaimIds: 6,
          minimumDistinctSourceFiles: 3,
          requiredRoles: ['caller', 'ingress', 'coordinator', 'runtime', 'observer'],
        },
        dataflow: {
          targetPrimaryRange: { nodes: [7, 10] },
          minimumRequiredEntities: 7,
          minimumRequiredRelationships: 6,
          minimumUniqueRequiredClaimIds: 7,
          minimumDistinctSourceFiles: 4,
          requiredRoles: ['source', 'transform', 'control-store', 'runtime-sink', 'observability-consumer'],
        },
        lifecycle: {
          targetPrimaryRange: { states: [7, 9] },
          minimumRequiredEntities: 7,
          minimumRequiredRelationships: 6,
          minimumUniqueRequiredClaimIds: 6,
          minimumDistinctSourceFiles: 3,
          requiredRoles: ['initial', 'registered', 'active', 'changing', 'recovery', 'terminal'],
        },
      },
    },
  },
  guards: {
    qualityProfile: 'showcase',
    deterministicChecks: 9,
    deterministicChecksRequired: 9,
    deterministicCheckNames: [
      'single_svg',
      'finite_svg',
      'orthogonal_arrows',
      'label_route_clearance',
      'relationship_crossings',
      'relationship_corridors',
      'container_border_runs',
      'route_rhythm',
      'legend_clearance',
    ],
    compositionErrors: 0,
    compositionWarnings: 0,
    desktopViewports: DESKTOP_VIEWPORTS,
    desktopContainmentRequired: 4,
    requireDesktopContainment: true,
    captureViewports: CAPTURE_VIEWPORTS,
    captureThemes: ['light', 'dark'],
    minimumProjectedNodeTextPx: 6,
    completeExampleInAuthoringContextAllowed: false,
    maximumExampleStructuralOverlapRatio: 0.7,
    maximumLowInformationExactRepeats: 2,
    diagramTypeTitleConsistencyRequired: true,
    repositorySemanticRequirementsRequired: true,
    minimumRequiredEntities: 2,
    minimumRequiredRelationships: 1,
    minimumUniqueRequiredClaimIds: 3,
    requiredClaimCoverageRatio: 1,
    shapeExampleBudgetConformanceRequired: true,
    authoringTerminalStatuses: ['failed', 'blocked', 'aborted'],
    semanticDeletionAllowed: false,
    typographyReductionAllowed: false,
    overflowHidingAllowed: false,
    clippingAllowed: false,
    internalScrollerAllowed: false,
  },
  visual: {
    desktopContainmentRequired: true,
    requestedStateMustMatchResolvedState: true,
    screenshotsMustBeContentAddressed: true,
  },
  repairPolicy: {
    stageOrder: ['input', 'render', 'check', 'preflight'],
    maxConsecutiveNonImprovingAttempts: 2,
    maxFocusedAttemptsBeforeStructuralReflow: 6,
    maxStructuralReflows: 2,
    maxConsecutiveIdenticalAttempts: 5,
    maxTotalAttempts: 24,
  },
});

export const QUALITY_CONTRACT_DIGEST = createHash('sha256')
  .update(canonicalJson(QUALITY_CONTRACT))
  .digest('hex');

export function assertExpectedQualityContract(expectedDigest) {
  if (typeof expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new Error('Expected quality contract must be a valid SHA-256 digest.');
  }
  if (expectedDigest !== QUALITY_CONTRACT_DIGEST) {
    throw new Error(`Quality contract mismatch: expected ${expectedDigest}, loaded ${QUALITY_CONTRACT_DIGEST}.`);
  }
  return QUALITY_CONTRACT_DIGEST;
}

export function qualityContractIdentity({ skillRoot } = {}) {
  if (typeof skillRoot !== 'string' || !skillRoot.trim()) {
    throw new Error('Quality contract identity requires a skillRoot.');
  }
  const skillPath = path.join(fs.realpathSync(path.resolve(skillRoot)), 'SKILL.md');
  const resolvedRoot = path.dirname(skillPath);
  const skill = fs.readFileSync(skillPath, 'utf8');
  const version = skill.match(/^metadata:\s*\n(?:^[ \t]+.*\n)*?^[ \t]+version:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1];
  if (!version) throw new Error(`SKILL.md metadata.version is missing: ${skillPath}`);
  const runtimePaths = [...new Set([
    ...ENFORCEMENT_RUNTIME_PATHS,
    ...recursiveModulePaths(resolvedRoot, 'renderers'),
  ])].sort();
  const runtimeFiles = runtimePaths.map((relativePath) => {
    const bytes = fs.readFileSync(path.join(resolvedRoot, ...relativePath.split('/')));
    return Object.freeze({
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });
  const runtimeBody = runtimeFiles.map(({ path: relativePath, bytes, sha256 }) => ({
    path: relativePath,
    bytes,
    sha256,
  }));
  return Object.freeze({
    quality: Object.freeze({
      schemaVersion: QUALITY_CONTRACT.schemaVersion,
      sha256: QUALITY_CONTRACT_DIGEST,
    }),
    skill: Object.freeze({
      version,
      sha256: createHash('sha256').update(skill).digest('hex'),
    }),
    runtime: Object.freeze({
      sha256: createHash('sha256').update(canonicalJson(runtimeBody)).digest('hex'),
      files: Object.freeze(runtimeFiles),
    }),
  });
}
