#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultPackageRoot = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'archify-package', 'archify')
  : path.join(repoRoot, 'archify');
const skillRoot = path.resolve(process.argv[2] || defaultPackageRoot);
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-smoke-'));

function requireAbsent(relative) {
  if (fs.existsSync(path.join(skillRoot, relative))) {
    throw new Error(`packaged skill must not contain ${relative}`);
  }
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error([
      `archify ${args.join(' ')} failed with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function runExpectFailure(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status === 0) throw new Error(`archify ${args.join(' ')} unexpectedly passed`);
  return result.stdout;
}

try {
  if (!fs.existsSync(cli)) throw new Error(`packaged CLI not found at ${cli}`);
  requireAbsent('node_modules');
  requireAbsent('package-lock.json');
  requireAbsent(path.join('scripts', 'generate-validators.mjs'));

  const packageJson = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));
  if (packageJson.dependencies || packageJson.devDependencies) {
    throw new Error('packaged skill must not declare runtime or development dependencies');
  }

  run(['--help']);
  run(['doctor']);
  run(['demo', path.join(scratch, 'demo')]);
  run(['examples']);

  const fixtures = [
    ['architecture', 'production-deployment.architecture.json'],
    ['workflow', 'agent-tool-call.workflow.json'],
    ['sequence', 'cache-miss-request.sequence.json'],
    ['dataflow', 'product-analytics.dataflow.json'],
    ['lifecycle', 'agent-run.lifecycle.json'],
  ];
  for (const [mode, fixture] of fixtures) {
    const receipt = JSON.parse(run([
      'validate', mode, path.join(skillRoot, 'examples', fixture), '--json',
    ]));
    if (!receipt.ok || receipt.type !== mode) {
      throw new Error(`${mode} package validation returned an invalid receipt`);
    }
    if (mode === 'architecture' && receipt.engineeringProfile !== 'deployment-ownership') {
      throw new Error('deployment package validation omitted the engineering profile receipt');
    }
  }

  const deployment = path.join(scratch, 'deployment.html');
  run(['render', 'architecture', path.join(skillRoot, 'examples', fixtures[0][1]), deployment]);
  run(['check', deployment]);

  const delivered = JSON.parse(run([
    'deliver', 'workflow', path.join(skillRoot, 'examples', fixtures[1][1]),
    path.join(scratch, 'workflow-delivered.html'), '--quality', 'showcase', '--json',
  ]));
  if (!delivered.ok || delivered.validation?.compositionStatus !== 'pass') {
    throw new Error('packaged workflow delivery did not return a passing receipt');
  }

  const emptyPath = path.join(scratch, 'empty-path');
  fs.mkdirSync(emptyPath);
  const openReceipt = JSON.parse(run([
    'deliver', 'workflow', path.join(skillRoot, 'examples', fixtures[1][1]),
    path.join(scratch, 'workflow-open-fallback.html'), '--open', '--json',
  ], { env: { ...process.env, PATH: emptyPath } }));
  if (!openReceipt.ok || openReceipt.open?.status !== 'unsupported') {
    throw new Error('packaged open fallback did not remain a successful unsupported handoff');
  }

  const invalidWorkflow = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', fixtures[1][1]), 'utf8',
  ));
  invalidWorkflow.nodes[0].colour = 'cyan';
  const invalidPath = path.join(scratch, 'invalid-workflow.json');
  fs.writeFileSync(invalidPath, JSON.stringify(invalidWorkflow));
  const failure = JSON.parse(runExpectFailure(['validate', 'workflow', invalidPath, '--json']));
  if (failure.ok || !failure.diagnostics?.some((diagnostic) => diagnostic.code === 'schema/additionalProperties')) {
    throw new Error('packaged skill did not return the expected unknown-field diagnostic');
  }

  process.stdout.write(`package smoke passed on ${process.platform} (${skillRoot})\n`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
