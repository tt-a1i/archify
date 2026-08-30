import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { exampleContaminationAssessment } from '../authoring/content-quality.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function renamedWorkflowExample() {
  const document = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
    'utf8',
  ));
  const renamedIds = new Map();
  const collectIds = (value) => {
    if (Array.isArray(value)) value.forEach(collectIds);
    else if (value && typeof value === 'object') {
      if (typeof value.id === 'string') {
        renamedIds.set(value.id, `renamed-${renamedIds.size + 1}`);
      }
      Object.values(value).forEach(collectIds);
    }
  };
  const referenceFields = new Set(['id', 'from', 'to', 'lane', 'phase', 'group']);
  const referenceArrays = new Set(['mainPath', 'focus']);
  const rename = (value, field = null) => {
    if (Array.isArray(value)) return value.map((entry) => rename(entry, field));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rename(entry, key)]));
    }
    return typeof value === 'string'
      && (referenceFields.has(field) || referenceArrays.has(field))
      && renamedIds.has(value)
      ? renamedIds.get(value)
      : value;
  };
  collectIds(document);
  return rename(document);
}

test('example contamination catches a bundled topology after every ID is renamed', () => {
  const assessment = exampleContaminationAssessment(renamedWorkflowExample(), 'workflow', {
    skillRoot,
  });

  assert.equal(assessment.receipt.status, 'failed');
  assert.equal(assessment.receipt.detection, 'renamed-directed-topology');
  assert.equal(assessment.receipt.identifierOverlapRatio, 0);
  assert.equal(assessment.receipt.directedTopology.matches, true);
  assert.equal(assessment.receipt.nonIdentifierContent.overlapRatio, 1);
  assert.equal(assessment.diagnostics[0].code, 'content/example-contamination');
});

test('example contamination allows the same content and scale with a different topology', () => {
  const candidate = renamedWorkflowExample();
  const nodeIds = candidate.nodes.map((node) => node.id);
  candidate.edges[0].to = nodeIds.find((id) => (
    id !== candidate.edges[0].from && id !== candidate.edges[0].to
  ));

  const assessment = exampleContaminationAssessment(candidate, 'workflow', { skillRoot });

  assert.equal(assessment.receipt.directedTopology.matches, false);
  assert.equal(assessment.receipt.nonIdentifierContent.overlapRatio, 1);
  assert.equal(assessment.receipt.status, 'passed');
  assert.deepEqual(assessment.diagnostics, []);
});
