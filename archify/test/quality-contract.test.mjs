import assert from 'node:assert/strict';
import test from 'node:test';
import {
  QUALITY_CONTRACT,
  QUALITY_CONTRACT_DIGEST,
  assertExpectedQualityContract,
} from '../authoring/quality-contract.mjs';

test('quality contract has a stable content digest and fails closed on an unexpected digest', () => {
  assert.match(QUALITY_CONTRACT_DIGEST, /^[a-f0-9]{64}$/);
  assert.equal(QUALITY_CONTRACT_DIGEST, 'd0f08e111e63fdb056cb56192b1107bdf161a40ad2efdd4ebb4a1af97e7f798e');
  assert.equal(assertExpectedQualityContract(QUALITY_CONTRACT_DIGEST), QUALITY_CONTRACT_DIGEST);
  assert.throws(
    () => assertExpectedQualityContract('0'.repeat(64)),
    /quality contract mismatch/i,
  );
  assert.throws(
    () => assertExpectedQualityContract('not-a-digest'),
    /valid SHA-256/i,
  );
  assert.equal(QUALITY_CONTRACT.guards.overflowHidingAllowed, false);
  assert.equal(QUALITY_CONTRACT.guards.completeExampleInAuthoringContextAllowed, false);
  assert.equal(QUALITY_CONTRACT.guards.repositorySemanticRequirementsRequired, true);
  assert.equal(QUALITY_CONTRACT.guards.diagramTypeTitleConsistencyRequired, true);
  assert.equal(QUALITY_CONTRACT.guards.requiredClaimCoverageRatio, 1);
  assert.equal(QUALITY_CONTRACT.guards.minimumUniqueRequiredClaimIds, 3);
  assert.equal(QUALITY_CONTRACT.semanticScope.defaultProfile, 'project-overview');
  assert.deepEqual(
    QUALITY_CONTRACT.semanticScope.profiles['project-overview'].sequence.targetPrimaryRange,
    { participants: [5, 7], messages: [9, 13] },
  );
  assert.deepEqual(
    QUALITY_CONTRACT.semanticScope.profiles['project-overview'].dataflow.requiredRoles,
    ['source', 'transform', 'control-store', 'runtime-sink', 'observability-consumer'],
  );
  assert.deepEqual(QUALITY_CONTRACT.guards.authoringTerminalStatuses, ['failed', 'blocked', 'aborted']);
  assert.equal(QUALITY_CONTRACT.repairPolicy.maxFocusedAttemptsBeforeStructuralReflow, 6);
  assert.equal(QUALITY_CONTRACT.repairPolicy.maxStructuralReflows, 2);
  assert.equal(QUALITY_CONTRACT.repairPolicy.maxConsecutiveIdenticalAttempts, 5);
  assert.equal(QUALITY_CONTRACT.repairPolicy.maxTotalAttempts, 24);
});
