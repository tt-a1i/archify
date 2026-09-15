import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';
import {
  createMappedWorkflowCandidate,
  intrinsicWorkflow,
  planningWorkflow,
} from '../renderers/workflow/workflow-migration-geometry.mjs';
import { validateSchema } from '../renderers/shared/validator.mjs';

export { createHorizontalRankMapper } from '../renderers/workflow/workflow-migration-geometry.mjs';

const TARGET_SCHEMA_VERSION = 2;
const SOURCE_SCHEMA_VERSION = 1;
const DEFAULT_QUALITY_PROFILE = 'standard';

function clone(value) {
  // Workflow documents are JSON documents by contract.
  // structuredClone is safer than JSON.parse/stringify when available.
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function diagnostic({
  code,
  message,
  subject = {},
  evidence = {},
  supportedFixes = [],
}) {
  return {
    code,
    severity: 'error',
    message,
    subject,
    evidence,
    supportedFixes,
  };
}

function schemaDiagnostics(workflow) {
  try {
    validateSchema('workflow', workflow);
    return [];
  } catch (error) {
    if (Array.isArray(error?.archifyDiagnostics)) {
      return error.archifyDiagnostics.map((entry) => ({ ...entry }));
    }

    return [
      diagnostic({
        code: 'migration/schema-validation',
        message: 'Workflow schema validation failed unexpectedly.',
        evidence: {
          reason: error instanceof Error ? error.message : String(error),
        },
        supportedFixes: [
          'provide a workflow document that conforms to the workflow schema',
        ],
      }),
    ];
  }
}

function getQualityProfile(workflow) {
  const profile = workflow?.meta?.quality_profile;

  return typeof profile === 'string' && profile.trim()
    ? profile
    : DEFAULT_QUALITY_PROFILE;
}

function legacyLayoutProbe(workflow, qualityProfile) {
  if (!Array.isArray(workflow.lanes) || workflow.lanes.length === 0) {
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          code: 'migration/source-lanes',
          message: 'Workflow migration requires at least one lane.',
          subject: { path: '/lanes' },
          evidence: {
            actualLaneCount: Array.isArray(workflow.lanes)
              ? workflow.lanes.length
              : null,
          },
          supportedFixes: [
            'provide at least one workflow lane',
          ],
        }),
      ],
    };
  }

  // The probe discovers fixed-v1 rank centers, not authored canvas capacity.
  // Omitting viewBox lets a capacity-only legacy failure reach the v2 compiler,
  // which can measure and monotonically expand the real migrated document.
  const probe = {
    schema_version: SOURCE_SCHEMA_VERSION,
    diagram_type: 'workflow',
    meta: {
      title: workflow.meta?.title,
      ...(workflow.meta?.locale
        ? { locale: workflow.meta.locale }
        : {}),
      legend: { mode: 'hidden' },
    },
    lanes: clone(workflow.lanes),
    nodes: [
      {
        id: 'migration_probe',
        lane: workflow.lanes[0].id,
        col: 0,
        type: 'backend',
        label: 'Probe',
      },
    ],
    edges: [],
  };

  return compileWorkflow({
    workflow: probe,
    qualityProfile,
  });
}

function legacyRequirementProbe(workflow, qualityProfile) {
  // Measure the complete fixed-v1 document without treating an authored
  // viewBox as its intrinsic requirement.
  //
  // The authored viewBox remains migration capacity and is preserved
  // separately on the migrated document.
  const probe = clone(workflow);

  if (probe.meta) {
    delete probe.meta.viewBox;
  }

  return compileWorkflow({
    workflow: probe,
    qualityProfile,
  });
}

function requiredViewBoxFrom(result) {
  if (Array.isArray(result?.receipt?.requiredViewBox)) {
    const candidate = result.receipt.requiredViewBox;

    if (
      candidate.length === 2 &&
      candidate.every((value) => Number.isFinite(value))
    ) {
      return [...candidate];
    }
  }

  const diagnostics = Array.isArray(result?.diagnostics)
    ? result.diagnostics
    : [];

  for (const entry of diagnostics) {
    const candidate = entry?.evidence?.requiredViewBox;

    if (
      Array.isArray(candidate) &&
      candidate.length === 2 &&
      candidate.every((value) => Number.isFinite(value))
    ) {
      return [...candidate];
    }
  }

  return null;
}

function expandableViewBox(result) {
  if (!result || result.ok) {
    return null;
  }

  const diagnostics = Array.isArray(result.diagnostics)
    ? result.diagnostics
    : [];

  if (diagnostics.length === 0) {
    return null;
  }

  // Expansion is safe only when every diagnostic is the same capacity error.
  if (
    !diagnostics.every(
      (entry) => entry?.code === 'workflow/viewbox-capacity',
    )
  ) {
    return null;
  }

  return requiredViewBoxFrom(result);
}

function result({
  ok,
  document,
  fromSchemaVersion = SOURCE_SCHEMA_VERSION,
  preExistingDiagnostics = [],
  migrationDiagnostics = [],
  newSchemaDiagnostics = [],
  changedCoordinates = [],
  oldRequiredViewBox = null,
  newRequiredViewBox = null,
}) {
  return {
    ok,
    ...(document ? { document } : {}),
    fromSchemaVersion,
    toSchemaVersion: TARGET_SCHEMA_VERSION,
    preExistingDiagnostics,
    migrationDiagnostics,
    newSchemaDiagnostics,
    changedCoordinates,
    oldRequiredViewBox,
    newRequiredViewBox,
  };
}

export function migrateWorkflowDocument(inputWorkflow) {
  // -------------------------------------------------------------------------
  // 1. Basic input validation
  // -------------------------------------------------------------------------

  if (
    !inputWorkflow ||
    typeof inputWorkflow !== 'object' ||
    Array.isArray(inputWorkflow)
  ) {
    return result({
      ok: false,
      migrationDiagnostics: [
        diagnostic({
          code: 'migration/source-document',
          message: 'Workflow migration requires one parsed JSON object.',
          supportedFixes: [
            'provide one workflow schema v1 or v2 JSON document',
          ],
        }),
      ],
    });
  }

  // Migration has no quality override. The authored policy or effective
  // standard default must be used throughout migration and final validation.
  const qualityProfile = getQualityProfile(inputWorkflow);

  let workflow;

  try {
    workflow = clone(inputWorkflow);
  } catch (error) {
    return result({
      ok: false,
      migrationDiagnostics: [
        diagnostic({
          code: 'migration/source-document',
          message: 'Workflow document could not be cloned safely.',
          evidence: {
            reason: error instanceof Error
              ? error.message
              : String(error),
          },
          supportedFixes: [
            'provide a JSON-compatible workflow document',
          ],
        }),
      ],
    });
  }

  // -------------------------------------------------------------------------
  // 2. Validate source document before migration
  // -------------------------------------------------------------------------

  const preExistingDiagnostics = schemaDiagnostics(workflow);

  if (preExistingDiagnostics.length) {
    return result({
      ok: false,
      fromSchemaVersion: workflow.schema_version,
      preExistingDiagnostics,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Already migrated v2 document
  // -------------------------------------------------------------------------

  if (workflow.schema_version === TARGET_SCHEMA_VERSION) {
    const compiled = compileWorkflow({
      workflow: clone(workflow),
      qualityProfile,
    });

    const requiredViewBox = requiredViewBoxFrom(compiled);

    if (!compiled.ok) {
      return result({
        ok: false,
        fromSchemaVersion: TARGET_SCHEMA_VERSION,
        preExistingDiagnostics: compiled.diagnostics || [],
        oldRequiredViewBox: requiredViewBox,
        newRequiredViewBox: requiredViewBox,
      });
    }

    // Keep the v2 path consistent with the migration path:
    // validate the final document after compilation.
    const finalDiagnostics = schemaDiagnostics(workflow);

    if (finalDiagnostics.length) {
      return result({
        ok: false,
        fromSchemaVersion: TARGET_SCHEMA_VERSION,
        newSchemaDiagnostics: finalDiagnostics,
        oldRequiredViewBox: requiredViewBox,
        newRequiredViewBox: requiredViewBox,
      });
    }

    return result({
      ok: true,
      document: workflow,
      fromSchemaVersion: TARGET_SCHEMA_VERSION,
      oldRequiredViewBox: requiredViewBox,
      newRequiredViewBox: requiredViewBox,
    });
  }

  // -------------------------------------------------------------------------
  // 4. Only v1 -> v2 migration is supported
  // -------------------------------------------------------------------------

  if (workflow.schema_version !== SOURCE_SCHEMA_VERSION) {
    return result({
      ok: false,
      fromSchemaVersion: workflow.schema_version,
      migrationDiagnostics: [
        diagnostic({
          code: 'migration/source-schema-version',
          message:
            'Workflow migration to schema v2 requires a schema v1 or v2 source.',
          subject: {
            path: '/schema_version',
          },
          evidence: {
            actual: workflow.schema_version,
            expected: [SOURCE_SCHEMA_VERSION, TARGET_SCHEMA_VERSION],
          },
          supportedFixes: [
            'use an unchanged schema v1 workflow as the migration source',
            'use an already migrated schema v2 workflow',
          ],
        }),
      ],
    });
  }

  // -------------------------------------------------------------------------
  // 5. Compile the original v1 workflow
  // -------------------------------------------------------------------------

  const legacy = compileWorkflow({
    workflow: clone(workflow),
    qualityProfile,
  });

  const preExistingLayoutDiagnostics = legacy.ok
    ? []
    : (legacy.diagnostics || []);

  // -------------------------------------------------------------------------
  // 6. Discover legacy v1 layout
  // -------------------------------------------------------------------------

  const legacyProbe = legacyLayoutProbe(
    workflow,
    qualityProfile,
  );

  if (!legacyProbe.ok) {
    return result({
      ok: false,
      preExistingDiagnostics: preExistingLayoutDiagnostics,
      migrationDiagnostics: legacyProbe.diagnostics || [],
    });
  }

  // -------------------------------------------------------------------------
  // 7. Determine the original v1 intrinsic requirement
  // -------------------------------------------------------------------------

  const legacyRequirement = legacyRequirementProbe(
    workflow,
    qualityProfile,
  );

  const oldRequiredViewBox =
    requiredViewBoxFrom(legacyRequirement) ||
    requiredViewBoxFrom(legacyProbe) ||
    requiredViewBoxFrom(legacy);

  // -------------------------------------------------------------------------
  // 8. Build the v2 layout plan
  // -------------------------------------------------------------------------

  let planned = compileWorkflow({
    workflow: intrinsicWorkflow(workflow),
    qualityProfile,
  });

  if (!planned.ok) {
    // Old absolute pins can be invalid at the new rank centers before their X
    // coordinates are mapped. Obtain the same rank plan from an automatic-route
    // projection, then validate every authored pin again after mapping.
    planned = compileWorkflow({
      workflow: planningWorkflow(workflow),
      qualityProfile,
    });
  }

  if (!planned.ok) {
    return result({
      ok: false,
      preExistingDiagnostics: preExistingLayoutDiagnostics,
      newSchemaDiagnostics: planned.diagnostics || [],
      oldRequiredViewBox,
      newRequiredViewBox: requiredViewBoxFrom(planned),
    });
  }

  // -------------------------------------------------------------------------
  // 9. Map v1 horizontal ranks/coordinates to v2
  // -------------------------------------------------------------------------

  let mappedCandidate;

  try {
    mappedCandidate = createMappedWorkflowCandidate(
      workflow,
      legacyProbe.receipt?.columns,
      planned.receipt?.columns,
    );
  } catch (error) {
    return result({
      ok: false,
      preExistingDiagnostics: preExistingLayoutDiagnostics,
      migrationDiagnostics: [
        diagnostic({
          code: 'migration/rank-mapping',
          message:
            'Could not construct a stable horizontal rank mapping.',
          evidence: {
            reason: error instanceof Error
              ? error.message
              : String(error),
          },
          supportedFixes: [
            'report the workflow and compiler receipts to the Archify maintainers',
          ],
        }),
      ],
      oldRequiredViewBox,
      newRequiredViewBox: requiredViewBoxFrom(planned),
    });
  }

  if (
    !mappedCandidate ||
    typeof mappedCandidate !== 'object' ||
    !mappedCandidate.document
  ) {
    return result({
      ok: false,
      preExistingDiagnostics: preExistingLayoutDiagnostics,
      migrationDiagnostics: [
        diagnostic({
          code: 'migration/rank-mapping',
          message:
            'The horizontal rank mapper returned an invalid migration candidate.',
          supportedFixes: [
            'report the workflow and rank-mapping implementation to the Archify maintainers',
          ],
        }),
      ],
      oldRequiredViewBox,
      newRequiredViewBox: requiredViewBoxFrom(planned),
    });
  }

  const migrated = mappedCandidate.document;
  const changedCoordinates = Array.isArray(
    mappedCandidate.changedCoordinates,
  )
    ? mappedCandidate.changedCoordinates
    : [];

  // Ensure the target schema version is explicitly set by migration.
  migrated.schema_version = TARGET_SCHEMA_VERSION;

  // -------------------------------------------------------------------------
  // 10. Compile migrated v2 document
  // -------------------------------------------------------------------------

  let compiled = compileWorkflow({
    workflow: migrated,
    qualityProfile,
  });

  // -------------------------------------------------------------------------
  // 11. Expand authored viewBox only for pure capacity failures
  // -------------------------------------------------------------------------

  const requiredExpansion = migrated.meta?.viewBox
    ? expandableViewBox(compiled)
    : null;

  if (requiredExpansion) {
    const current = migrated.meta.viewBox;

    if (
      Array.isArray(current) &&
      current.length === 2 &&
      current.every((value) => Number.isFinite(value))
    ) {
      const expanded = [
        Math.max(current[0], requiredExpansion[0]),
        Math.max(current[1], requiredExpansion[1]),
      ];

      if (
        expanded[0] > current[0] ||
        expanded[1] > current[1]
      ) {
        migrated.meta.viewBox = expanded;

        compiled = compileWorkflow({
          workflow: migrated,
          qualityProfile,
        });
      }
    }
  }

  const newRequiredViewBox =
    requiredViewBoxFrom(compiled) ||
    requiredViewBoxFrom(planned);

  // -------------------------------------------------------------------------
  // 12. Final compiler validation
  // -------------------------------------------------------------------------

  if (!compiled.ok) {
    return result({
      ok: false,
      preExistingDiagnostics: preExistingLayoutDiagnostics,
      newSchemaDiagnostics: compiled.diagnostics || [],
      changedCoordinates,
      oldRequiredViewBox,
      newRequiredViewBox,
    });
  }

  // -------------------------------------------------------------------------
  // 13. Final schema validation
  // -------------------------------------------------------------------------

  const migratedSchemaDiagnostics = schemaDiagnostics(migrated);

  if (migratedSchemaDiagnostics.length) {
    return result({
      ok: false,
      preExistingDiagnostics: preExistingLayoutDiagnostics,
      newSchemaDiagnostics: migratedSchemaDiagnostics,
      changedCoordinates,
      oldRequiredViewBox,
      newRequiredViewBox,
    });
  }

  // -------------------------------------------------------------------------
  // 14. Successful migration
  // -------------------------------------------------------------------------

  return result({
    ok: true,
    document: migrated,
    preExistingDiagnostics: preExistingLayoutDiagnostics,
    changedCoordinates,
    oldRequiredViewBox,
    newRequiredViewBox,
  });
}

export function serializeMigratedWorkflow(workflow) {
  return `${JSON.stringify(workflow, null, 2)}\n`;
}
