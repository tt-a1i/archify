import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AUTHORING_TYPES,
  loadAuthoringKit,
} from '../authoring/authoring-kit.mjs';
import {
  QUALITY_CONTRACT,
  QUALITY_CONTRACT_DIGEST,
} from '../authoring/quality-contract.mjs';
import { normalizeSemanticRequirements } from '../authoring/semantic-requirements.mjs';
import {
  DESKTOP_READER_DIAGRAM_WIDTH,
  MIN_PROJECTED_NODE_TEXT_PX,
  projectedNodeTextPx,
} from '../renderers/shared/desktop-readability.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

const expectedExamples = {
  architecture: 'examples/web-app.architecture.json',
  workflow: 'examples/agent-tool-call.workflow.json',
  sequence: 'examples/cache-miss-request.sequence.json',
  dataflow: 'examples/product-analytics.dataflow.json',
  lifecycle: 'examples/agent-run.lifecycle.json',
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('authoring kit returns the exact schema, common schema, and one matching example', () => {
  assert.deepEqual(AUTHORING_TYPES, Object.keys(expectedExamples));

  for (const type of AUTHORING_TYPES) {
    const kit = loadAuthoringKit(type);
    assert.equal(kit.schemaVersion, 1);
    assert.equal(kit.type, type);
    assert.deepEqual(kit.layoutBudget.targetViewport, [1440, 900]);
    assert.equal(kit.layoutBudget.qualityGuards.deterministicChecks, 9);
    assert.equal(kit.layoutBudget.qualityGuards.desktopViewports.length, 4);
    assert.equal(kit.layoutBudget.qualityGuards.semanticDeletionAllowed, false);
    assert.equal(
      kit.layoutBudget.recommendedViewBox[0] <= kit.layoutBudget.maximumRecommendedViewBoxWidth,
      true,
    );
    assert.equal(kit.layoutBudget.desktopReadability.minimumProjectedNodeTextPx, 6);
    assert.equal(kit.layoutBudget.desktopReadability.diagramWidth, 930);
    assert.equal(kit.layoutBudget.desktopReadability.diagramWidth, DESKTOP_READER_DIAGRAM_WIDTH);
    assert.equal(
      kit.layoutBudget.desktopReadability.minimumProjectedNodeTextPx,
      MIN_PROJECTED_NODE_TEXT_PX,
    );
    assert.ok(Math.abs(projectedNodeTextPx(
      kit.layoutBudget.desktopReadability.minimumSourceNodeTextPxAtMaximumWidth,
      kit.layoutBudget.maximumRecommendedViewBoxWidth,
    ) - MIN_PROJECTED_NODE_TEXT_PX) < 1e-12);
    assert.equal(
      kit.layoutBudget.recommendedViewBox[1] / kit.layoutBudget.recommendedViewBox[0]
        <= kit.layoutBudget.maximumViewBoxAspectRatio,
      true,
    );
    assert.match(kit.commands.validate, new RegExp(`validate ${type}`));
    assert.match(kit.commands.validate, /--repair-history <repair-history\.json>/);
    assert.match(kit.commands.validate, /--require-authored-language <en\|zh-CN>/);
    assert.match(kit.commands.validateStructuralReflow, /--repair-mode structural-reflow/);
    assert.match(kit.commands.inspectLayout, /--layout-json/);
    assert.match(kit.commands.preflight, /--preflight/);
    assert.match(kit.commands.preflight, /--repair-history <repair-history\.json>/);
    assert.match(kit.commands.deliver, /--require-authored-language <en\|zh-CN>/);
    assert.match(kit.commands.sourceSearch, /project-index source-search/);
    assert.match(kit.commands.sourceInspect, /project-index inspect/);
    assert.match(kit.commands.evidenceHydrate, /evidence-ledger hydrate/);
    assert.match(kit.commands.evidenceVerify, /evidence-ledger verify/);
    assert.match(kit.commands.authoringRunStart, new RegExp(`authoring-run start ${type}`));
    assert.match(kit.commands.authoringRunStart, /--repo-root <path>/);
    assert.match(kit.commands.authoringRunStart, /--project-index <index\.json>/);
    assert.match(kit.commands.authoringRunStart, /--requirements <requirements\.json>/);
    assert.match(kit.commands.authoringRunStart, /--candidate <candidate\.json>/);
    assert.match(kit.commands.authoringRunStart, /--scope-profile <focused\|project-overview>/);
    assert.match(kit.commands.authoringRunStart, /--expect-contract <quality-contract-sha256>/);
    assert.match(kit.commands.authoringRunStart, /--require-authored-language <en\|zh-CN>/);
    assert.match(kit.commands.authoringRunFinalize, /authoring-run finalize/);
    assert.equal(kit.capabilities.repositoryEvidence, true);
    assert.equal(kit.capabilities.projectSourceSearch, true);
    assert.equal(kit.capabilities.evidenceLedgerVerify, true);
    assert.equal(kit.capabilities.machineAuthoringReport, true);
    assert.equal(kit.capabilities.deterministicRepairPlan, true);
    assert.equal(kit.repairPolicy.maxStructuralReflows, 2);
    assert.equal(kit.repairPolicy.maxTotalAttempts, 24);
    assert.equal(Array.isArray(kit.evidenceSelectionTemplate.document), true);
    assert.equal(kit.semanticRequirementsTemplate.document.diagramType, type);
    assert.equal(kit.semanticRequirementsTemplate.document.schemaVersion, 2);
    assert.equal(kit.semanticRequirementsTemplate.document.scopeProfile, 'project-overview');
    assert.equal(
      kit.semanticRequirementsTemplate.document.entities.length,
      kit.semanticScope.profiles['project-overview'][type].minimumRequiredEntities,
    );
    assert.equal(
      kit.semanticRequirementsTemplate.document.relationships.length,
      kit.semanticScope.profiles['project-overview'][type].minimumRequiredRelationships,
    );
    assert.deepEqual(
      kit.layoutBudget.targetPrimaryRange,
      kit.semanticScope.profiles['project-overview'][type].targetPrimaryRange,
    );
    assert.match(kit.semanticRequirementsTemplate.instructions, /before.*candidate/i);
    assert.match(kit.semanticRequirementsTemplate.instructions, /claimIds/);
    assert.match(kit.semanticRequirementsTemplate.instructions, /source-breadth/i);
    assert.doesNotThrow(() => normalizeSemanticRequirements(
      kit.semanticRequirementsTemplate.document,
      type,
    ));
    assert.deepEqual(Object.keys(kit.evidenceSelectionTemplate.document[0]), [
      'claimId',
      'path',
      'line',
      'endLine',
      'summary',
    ]);
    assert.match(kit.evidenceSelectionTemplate.rootShape, /JSON array/);
    assert.equal(Object.isFrozen(kit.evidenceSelectionTemplate), true);
    assert.equal(Object.isFrozen(kit.evidenceSelectionTemplate.document), true);
    assert.equal(Object.isFrozen(kit.evidenceSelectionTemplate.document[0]), true);
    assert.equal(Array.isArray(JSON.parse(JSON.stringify(kit)).evidenceSelectionTemplate.document), true);
    assert.ok(kit.workflow.length >= 5);
    assert.deepEqual(Object.keys(kit.files), ['schema', 'commonSchema', 'example']);
    assert.equal(kit.files.schema.path, `schemas/${type}.schema.json`);
    assert.equal(kit.files.commonSchema.path, 'schemas/common.schema.json');
    assert.equal(kit.files.example.path, expectedExamples[type]);

    for (const file of Object.values(kit.files)) {
      assert.equal(file.bytes, Buffer.byteLength(file.content));
      assert.equal(file.sha256, sha256(file.content));
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
      assert.doesNotThrow(() => JSON.parse(file.content));
    }
  }
});

test('workflow authoring budget prevents repeated main-path lane re-entry', () => {
  const composition = loadAuthoringKit('workflow').layoutBudget.composition;

  assert.match(composition, /primary lane|contiguous lane segments/i);
  assert.match(composition, /back-and-forth|repeated lane re-entry/i);
  assert.match(composition, /branch/i);
});

test('authoring kit rejects unknown types without falling back to another example', () => {
  assert.throws(
    () => loadAuthoringKit('deployment'),
    /Unknown diagram type "deployment"/,
  );
});

test('authoring kit binds the exact shared quality and skill contracts', () => {
  const kit = loadAuthoringKit('lifecycle', {
    expectContract: QUALITY_CONTRACT_DIGEST,
  });

  assert.deepEqual(kit.layoutBudget.qualityGuards, QUALITY_CONTRACT.guards);
  assert.deepEqual(kit.layoutBudget.recommendedViewBox, [1080, 630]);
  assert.equal(kit.contract.quality.sha256, QUALITY_CONTRACT_DIGEST);
  assert.equal(kit.contract.quality.schemaVersion, QUALITY_CONTRACT.schemaVersion);
  assert.equal(kit.contract.skill.version, '2.16');
  assert.match(kit.contract.skill.sha256, /^[a-f0-9]{64}$/);
  assert.match(kit.contract.runtime.sha256, /^[a-f0-9]{64}$/);
  assert.ok(kit.contract.runtime.files.some((entry) => entry.path === 'authoring/semantic-requirements.mjs'));
  assert.ok(kit.contract.runtime.files.some((entry) => entry.path === 'orchestration/suite-runner.mjs'));
  assert.ok(kit.contract.runtime.files.some((entry) => entry.path === 'renderers/dataflow/render-dataflow.mjs'));
  assert.ok(kit.contract.runtime.files.some((entry) => entry.path === 'scripts/check-render-output.mjs'));
  assert.ok(kit.contract.runtime.files.some((entry) => entry.path === 'schemas/lifecycle.schema.json'));
  assert.throws(
    () => loadAuthoringKit('workflow', { expectContract: '0'.repeat(64) }),
    /quality contract mismatch/i,
  );
});

test('context-json packet replaces the finished example with a bounded shape-only exemplar', () => {
  const packet = loadAuthoringKit('dataflow', { contextJson: true });
  const serialized = JSON.stringify(packet);
  const roundTripped = JSON.parse(serialized);

  for (const file of [roundTripped.files.schema, roundTripped.files.commonSchema]) {
    const source = fs.readFileSync(path.join(skillRoot, file.path), 'utf8');
    assert.deepEqual(file.document, JSON.parse(source));
    assert.equal(file.content, undefined);
    assert.equal(file.bytes, Buffer.byteLength(source));
    assert.equal(file.sha256, sha256(source));
  }
  assert.equal(roundTripped.files.example.document, undefined);
  assert.equal(roundTripped.files.example.content, undefined);
  assert.equal(roundTripped.files.example.omittedFromContext, true);
  assert.equal(roundTripped.shapeExample.policy, 'shape-only');
  assert.equal(roundTripped.shapeExample.document.diagram_type, 'dataflow');
  assert.equal(roundTripped.shapeExample.document.nodes.length, 2);
  assert.equal(roundTripped.shapeExample.document.flows.length, 1);
  assert.match(roundTripped.shapeExample.instruction, /below project-overview density/i);
  assert.doesNotMatch(serialized, /Product Analytics Data Flow|clickstream|identity-map|feature-vectors/);

  const legacy = loadAuthoringKit('dataflow');
  assert.equal(typeof legacy.files.schema.content, 'string');
  assert.equal(legacy.files.schema.document, undefined);
  assert.equal(typeof legacy.files.example.content, 'string');
  assert.equal(legacy.shapeExample, undefined);
});

test('all five shape-only packet examples reach the preflight seam after deterministic validation', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-shape-example-preflight-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const missingChrome = path.join(tmp, 'missing-chrome');

  for (const type of AUTHORING_TYPES) {
    const kit = loadAuthoringKit(type, { contextJson: true });
    const document = kit.shapeExample.document;
    assert.deepEqual(document.meta.viewBox, kit.layoutBudget.recommendedViewBox, `${type}: viewBox budget`);
    assert.ok(
      document.meta.viewBox[1] / document.meta.viewBox[0]
        <= kit.layoutBudget.maximumViewBoxAspectRatio,
      `${type}: aspect ratio budget`,
    );
    for (const [collection, maximum] of Object.entries(kit.layoutBudget.primaryLimits)) {
      const documentCollection = collection === 'guidedViews' ? 'views' : collection;
      assert.ok((document[documentCollection]?.length || 0) <= maximum,
        `${type}: ${documentCollection} budget`);
    }
    const input = path.join(tmp, `${type}.json`);
    writeJson(input, document);
    const result = spawnSync(process.execPath, [
      cli,
      'validate',
      type,
      input,
      '--quality',
      'showcase',
      '--preflight',
      '--json',
    ], {
      cwd: skillRoot,
      encoding: 'utf8',
      env: { ...process.env, ARCHIFY_CHROME: missingChrome },
    });
    assert.equal(result.status, 2, `${type}: ${result.stderr}`);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.stage, 'preflight', `${type}: ${receipt.error}`);
    assert.equal(receipt.checker.ok, true, `${type}: deterministic validation must pass first`);
    assert.equal(receipt.preflight.status, 'skipped');
  }
});

test('authoring-kit CLI emits a complete machine packet without an extra discovery round trip', () => {
  const result = spawnSync(process.execPath, [cli, 'authoring-kit', 'workflow', '--json'], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.type, 'workflow');
  assert.equal(packet.files.schema.path, 'schemas/workflow.schema.json');
  assert.equal(packet.files.commonSchema.path, 'schemas/common.schema.json');
  assert.equal(packet.files.example.path, 'examples/agent-tool-call.workflow.json');
  assert.match(packet.files.example.content, /Agent Tool Call Workflow/);
  assert.deepEqual(packet.layoutBudget.recommendedViewBox, [960, 540]);
  assert.equal(packet.layoutBudget.maximumRecommendedViewBoxWidth, 960);
  assert.match(packet.evidenceSelectionTemplate.rootShape, /JSON array/);
  assert.match(packet.commands.deliver, /deliver workflow/);
  assert.doesNotMatch(packet.commands.deliver, /--repo-root/);
});

test('authoring-kit CLI emits compact context JSON and rejects contract drift', () => {
  const accepted = spawnSync(process.execPath, [
    cli,
    'authoring-kit',
    'workflow',
    '--json',
    '--context-json',
    '--expect-contract',
    QUALITY_CONTRACT_DIGEST,
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(accepted.status, 0, accepted.stderr);
  const packet = JSON.parse(accepted.stdout);
  assert.equal(packet.files.schema.content, undefined);
  assert.deepEqual(packet.files.schema.document, JSON.parse(
    fs.readFileSync(path.join(skillRoot, 'schemas/workflow.schema.json'), 'utf8'),
  ));
  assert.equal(packet.files.example.omittedFromContext, true);
  assert.equal(packet.shapeExample.policy, 'shape-only');
  assert.doesNotMatch(accepted.stdout, /Agent Tool Call Workflow|Approval Gate|External API/);
  const legacy = spawnSync(process.execPath, [
    cli,
    'authoring-kit',
    'workflow',
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.ok(Buffer.byteLength(accepted.stdout) < Buffer.byteLength(legacy.stdout));

  const rejected = spawnSync(process.execPath, [
    cli,
    'authoring-kit',
    'workflow',
    '--json',
    '--expect-contract',
    '0'.repeat(64),
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(JSON.parse(rejected.stdout).error, /quality contract mismatch/i);
});
