#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

const artifacts = manifest.entries.map((entry) => {
  const stem = `${entry.id}.${entry.type}`;
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', `${stem}.visual-check.json`), 'utf8'));
  const desktop = receipt.readability.viewports.find((viewport) => (
    viewport.width === 1440 && viewport.height === 900 && viewport.theme === 'light'
  ));
  return {
    id: entry.id,
    artifactSha256: receipt.artifact.sha256,
    status: receipt.status,
    worldProfile: desktop.worldProfile,
    overviewProjectedTextPx: desktop.overviewProjectedNodeTextPx,
    entryProjectedTextPx: desktop.minimumProjectedNodeTextPx,
    cameraMultiplier: desktop.cameraScale,
    stageWidth: desktop.stageWidth,
    stageHeight: desktop.stageHeight,
    expectedStageHeight: desktop.expectedStageHeight,
    documentContained: desktop.ok,
    staticallyProvedNodes: receipt.worldReachability.staticallyProvedNodeCount,
    navigatedNodes: receipt.worldReachability.reachedNodeCount,
    staticallyProvedEdges: receipt.worldReachability.staticallyProvedEdgeCount,
    navigatedEdges: receipt.worldReachability.reachedEdgeCount,
    canonicalExportComplete: receipt.exportCompleteness.status === 'pass',
  };
});

const summary = {
  schemaVersion: 3,
  benchmark: 'hybrid-large-world-viewer-pilot',
  generatedFrom: 'artifact-bound visual-check schema 3 receipts',
  artifacts,
  mandatoryFunctionalEvidence: artifacts.every((entry) => entry.status === 'pass') ? 'pass' : 'fail',
  prerequisiteBaseline: 'not-run: matched base P0 raw receipts missing',
  runtimePerformanceMatrix: 'not-run: matched base/candidate P4 receipt missing',
  readerAB: 'not-run',
  stress1000: 'not-run: prerequisite-incomplete',
  technicalDecision: 'not-run: prerequisite-invalid',
  promotionDecision: 'evidence-incomplete',
};

const output = path.join(root, 'results', 'functional-summary.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(output);
