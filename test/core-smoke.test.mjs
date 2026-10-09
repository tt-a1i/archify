import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const skillRoot = fileURLToPath(new URL('../archify/', import.meta.url));
const cli = path.join(skillRoot, 'bin/archify.mjs');
const examples = [
  ['architecture', 'web-app.architecture.json', 'components'],
  ['workflow', 'agent-tool-call.workflow.json', 'nodes'],
  ['sequence', 'cache-miss-request.sequence.json', 'participants'],
  ['dataflow', 'product-analytics.dataflow.json', 'nodes'],
  ['lifecycle', 'agent-run.lifecycle.json', 'states'],
  ['erd', 'orders.erd.json', 'entities'],
  ['tree', 'payment-platform.tree.json', 'nodes'],
  ['class', 'payments.class.json', 'types'],
  ['timeline', 'payment-incident.timeline.json', 'events'],
  ['waterfall', 'checkout-request.waterfall.json', 'spans'],
];

function identity(file) {
  const bytes = fs.readFileSync(file);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

function descendants(node) {
  return [node, ...(node.childNodes || []).flatMap(descendants)];
}

function attribute(node, name) {
  return node.attrs?.find((entry) => entry.name === name)?.value;
}

function assertDiagram(output, document, collection) {
  const elements = descendants(parse(fs.readFileSync(output, 'utf8')));
  const svg = elements.find((node) => node.tagName === 'svg' && attribute(node, 'role') === 'img');
  assert.ok(svg, 'the HTML must contain an accessible diagram SVG');
  const viewBox = attribute(svg, 'viewBox')?.trim().split(/\s+/).map(Number);
  assert.equal(viewBox?.length, 4, 'SVG must have a usable viewBox');
  assert.ok(viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0);
  const contents = descendants(svg);
  for (const item of document[collection]) {
    const node = contents.find((entry) => attribute(entry, 'data-node-id') === item.id);
    assert.ok(node, `SVG is missing authored ${document.diagram_type} node ${item.id}`);
    const parts = descendants(node);
    assert.ok(parts.some((part) => ['rect', 'path', 'circle', 'polygon'].includes(part.tagName)),
      `authored node ${item.id} must contain actual SVG geometry`);
    const text = parts.filter((part) => part.tagName === 'text')
      .map((part) => descendants(part).filter((child) => child.nodeName === '#text')
        .map((child) => child.value).join('')).join(' ');
    assert.ok(text.trim(), `authored node ${item.id} must contain SVG text`);
    // Ignore line wrapping and whitespace while retaining the authored words.
    const label = item.label ?? item.name ?? item.title;
    assert.ok(text.replace(/\s+/g, '').includes(label.replace(/\s+/g, '')),
      `authored node ${item.id} must retain its label in SVG text`);
  }
  for (const edge of document.connections || document.edges || document.messages || document.flows || document.transitions || document.relationships || []) {
    assert.ok(contents.some((node) => attribute(node, 'data-edge-from') === edge.from
      && attribute(node, 'data-edge-to') === edge.to),
    `SVG is missing authored connection ${edge.from} → ${edge.to}`);
  }
}

function assertDiagnostic(receipt, code) {
  assert.equal(receipt.ok, false);
  const diagnostic = receipt.diagnostics.find((entry) => entry.code === code);
  assert.ok(diagnostic, `missing ${code}: ${JSON.stringify(receipt.diagnostics)}`);
  assert.equal(diagnostic.severity, 'error');
  assert.ok(diagnostic.subject && typeof diagnostic.subject === 'object');
  assert.ok(diagnostic.evidence && typeof diagnostic.evidence === 'object');
  assert.ok(diagnostic.supportedFixes.length > 0, 'failure must give a repair action');
  return diagnostic;
}

test('core smoke: public CLI diagrams, compatibility and delivery safety', async (t) => {
  // Resolve Windows 8.3 temp aliases using the same native path semantics as delivery.
  const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-core-')));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const runtimeTmp = path.join(workspace, 'runtime-temp');
  fs.mkdirSync(runtimeTmp);
  const env = {
    ...process.env,
    ARCHIFY_UPDATE_CHECK_DISABLED: '1',
    TMPDIR: runtimeTmp,
    TMP: runtimeTmp,
    TEMP: runtimeTmp,
  };
  function run(args, cwd = workspace, status = 0) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, status, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
    assert.deepEqual(fs.readdirSync(runtimeTmp), [], 'CLI must clean its private temporary outputs');
    return result;
  }
  function receipt(args, cwd, status) {
    return JSON.parse(run(args, cwd, status).stdout);
  }
  function assertNoStaging(directory) {
    assert.deepEqual(fs.readdirSync(directory).filter((name) => name.startsWith('.archify-')
      || name.endsWith('.delivery-lock.json')), [], 'completed attempt must release locks and staging');
  }
  let workflow;

  for (const [type, filename, collection] of examples) {
    await t.test(`${type}: validate, render and deliver the official example`, () => {
      const directory = path.join(workspace, `${type} 空间 Ω`);
      fs.mkdirSync(directory);
      const input = path.join(directory, `输入 ${filename}`);
      fs.copyFileSync(path.join(skillRoot, 'examples', filename), input);
      const document = JSON.parse(fs.readFileSync(input, 'utf8'));
      assert.equal(document.diagram_type, type);

      const validation = receipt(['validate', type, input, '--json'], directory);
      assert.equal(validation.ok, true);
      assert.equal(validation.command, 'validate');
      assert.equal(validation.type, type);
      assert.equal(validation.candidateFrozen, true);
      assert.equal(validation.candidate.path, input);
      assert.deepEqual({ sha256: validation.candidate.sha256, bytes: validation.candidate.bytes }, identity(input));
      assert.ok(validation.checks.length > 0 && validation.checks.every((check) => check.ok));

      const rendered = path.join(directory, 'rendered.html');
      run(['render', type, input, rendered], directory);
      assertDiagram(rendered, document, collection);

      const output = path.join(directory, '交付 diagram.html');
      const delivered = receipt(['deliver', type, input, output, '--json'], directory);
      assert.equal(delivered.ok, true);
      assert.equal(delivered.command, 'deliver');
      assert.equal(delivered.type, type);
      assert.equal(delivered.input, input);
      assert.equal(delivered.output, output);
      assert.deepEqual(delivered.specification, identity(input));
      assert.deepEqual(delivered.artifact, identity(output));
      assert.equal(delivered.validation.checksPassed, delivered.validation.checkCount);
      assert.ok(delivered.validation.checkCount > 0);
      assert.equal(delivered.validation.errors, 0);
      assertDiagram(output, document, collection);

      const sidecar = output.replace(/\.html$/, '.delivery.json');
      const provenance = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
      assert.equal(provenance.schemaVersion, 1);
      assert.equal(provenance.status, 'current');
      assert.equal(provenance.command, 'deliver');
      assert.equal(provenance.type, type);
      assert.ok(provenance.receiptId && provenance.receiptId === delivered.receiptId);
      assert.equal(provenance.input, input);
      assert.equal(provenance.output, output);
      assert.deepEqual(provenance.specification, identity(input));
      assert.deepEqual(provenance.artifact, identity(output));
      assert.deepEqual(fs.readdirSync(directory).sort(), [path.basename(input), path.basename(rendered), path.basename(output), path.basename(sidecar)].sort());
      if (type === 'workflow') workflow = { directory, input, output, sidecar, document };
    });
  }

  for (const [type, filename, collection] of examples.slice(0, 4)) {
    await t.test(`${type}: frozen schema-v1 input remains valid and renderable`, () => {
      const input = fileURLToPath(new URL(`./fixtures/v1-baseline/${filename}`, import.meta.url));
      const document = JSON.parse(fs.readFileSync(input, 'utf8'));
      assert.equal(document.schema_version, 1);
      const validated = receipt(['validate', type, input, '--json']);
      assert.equal(validated.ok, true);
      assert.equal(validated.type, type);
      assert.ok(validated.checks.every((check) => check.ok));
      const output = path.join(workspace, `v1-${type}.html`);
      run(['render', type, input, output]);
      assertDiagram(output, document, collection);
    });
  }

  await t.test('unknown diagram types return a structured diagnostic', () => {
    const failed = receipt(['validate', 'unknown', 'ignored.json', '--json'], workspace, 2);
    const diagnostic = assertDiagnostic(failed, 'cli/unknown-diagram-type');
    assert.equal(diagnostic.subject.type, 'unknown');
    assert.deepEqual(new Set(diagnostic.evidence.supportedTypes), new Set(examples.map(([type]) => type)));
  });

  await t.test('strict provenance binds the delivered artifact bytes', (t) => {
    if (!workflow) return t.skip('requires a successful official workflow delivery');
    const checked = receipt(['check', workflow.output, '--require-provenance']);
    assert.equal(checked.ok, true);
    assert.equal(checked.provenance, 'current');
    const original = fs.readFileSync(workflow.output);
    try {
      fs.appendFileSync(workflow.output, '\n<!-- changed after delivery -->\n');
      const failed = receipt(['check', workflow.output, '--require-provenance'], workspace, 1);
      const diagnostic = assertDiagnostic(failed, 'delivery/provenance-mismatch');
      assert.equal(diagnostic.evidence.expectedSha256, createHash('sha256').update(original).digest('hex'));
      assert.equal(diagnostic.evidence.actualSha256, identity(workflow.output).sha256);
      assert.notEqual(diagnostic.evidence.actualSha256, diagnostic.evidence.expectedSha256);
    } finally {
      fs.writeFileSync(workflow.output, original);
    }
  });

  await t.test('invalid schema preserves the last artifact and marks its delivery as failed', (t) => {
    if (!workflow) return t.skip('requires a successful official workflow delivery');
    const invalid = structuredClone(workflow.document);
    invalid.nodes[0].unexpected = true;
    const input = path.join(workflow.directory, 'invalid.workflow.json');
    fs.writeFileSync(input, JSON.stringify(invalid));
    const prior = fs.readFileSync(workflow.output);
    const validated = receipt(['validate', 'workflow', input, '--json'], workspace, 1);
    const diagnostic = assertDiagnostic(validated, 'schema/additionalProperties');
    assert.equal(diagnostic.subject.identity, invalid.nodes[0].id);
    assert.equal(diagnostic.evidence.additionalProperty, 'unexpected');
    const failed = receipt(['deliver', 'workflow', input, workflow.output, '--json'], workspace, 1);
    assertDiagnostic(failed, 'schema/additionalProperties');
    assert.deepEqual(fs.readFileSync(workflow.output), prior);
    const provenance = JSON.parse(fs.readFileSync(workflow.sidecar, 'utf8'));
    assert.equal(provenance.status, 'failed');
    assert.equal(provenance.receiptId, failed.receiptId);
    assert.deepEqual(provenance.artifact, identity(workflow.output));
    const checked = receipt(['check', workflow.output, '--require-provenance'], workspace, 1);
    assertDiagnostic(checked, 'delivery/provenance-failed');
    // The failure record/journal is intentional recovery evidence; temporary
    // publication directories and completed-attempt locks must be gone.
    assertNoStaging(workflow.directory);
  });
});
