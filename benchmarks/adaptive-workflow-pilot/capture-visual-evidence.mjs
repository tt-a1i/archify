#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findChrome, runVisualCheck } from '../../archify/bin/visual-check.mjs';
import { compileWorkflow } from '../../archify/renderers/workflow/workflow-compiler.mjs';
import { largeAdaptiveWorkflow } from '../../archify/test/fixtures/large-adaptive-workflow.mjs';

const benchmarkRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(benchmarkRoot, '..', '..');
const outputRoot = path.resolve(process.argv[2] || path.join(benchmarkRoot, 'evidence', 'large-adaptive-world'));
const input = path.join(outputRoot, 'large-adaptive.workflow.json');
const artifact = path.join(outputRoot, 'large-adaptive.workflow.html');
const layoutReceipt = path.join(outputRoot, 'large-adaptive.layout-receipt.json');

fs.mkdirSync(outputRoot, { recursive: true });
const workflow = largeAdaptiveWorkflow();
fs.writeFileSync(input, `${JSON.stringify(workflow, null, 2)}\n`);

const compiled = compileWorkflow({ workflow, qualityProfile: 'showcase' });
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics, null, 2));
fs.writeFileSync(layoutReceipt, `${JSON.stringify(compiled.receipt, null, 2)}\n`);

execFileSync(process.execPath, [
  path.join(repositoryRoot, 'archify', 'renderers', 'workflow', 'render-workflow.mjs'),
  input,
  artifact,
], { stdio: 'inherit' });

const chromePath = findChrome();
if (!chromePath) throw new Error('Chrome is required. Set ARCHIFY_CHROME to its executable path.');
const result = await runVisualCheck({ artifactPath: artifact, chromePath });
if (result.exitCode !== 0) throw new Error(JSON.stringify(result.receipt.diagnostics, null, 2));

process.stdout.write(`${JSON.stringify({
  outputRoot,
  artifact,
  layoutReceipt,
  visualReceipt: path.join(outputRoot, 'large-adaptive.workflow.visual-check.json'),
  status: result.receipt.status,
  viewports: result.receipt.containment.viewports.length,
  worldReachability: result.receipt.worldReachability,
  exportCompleteness: result.receipt.exportCompleteness,
}, null, 2)}\n`);
