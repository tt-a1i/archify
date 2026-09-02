import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileArchitectureGraph } from '../renderers/architecture/architecture-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');

function graph({
  title = 'Scoped graph',
  secondPos = [240, 80],
  fromSide = 'right',
  toSide = 'left',
  variant = 'default',
} = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title, viewBox: [520, 320] },
    components: [
      { id: 'input', type: 'frontend', label: 'Input', pos: [40, 80], size: [120, 60] },
      { id: 'output', type: 'backend', label: 'Output', pos: secondPos, size: [120, 60] },
    ],
    boundaries: [],
    connections: [
      {
        id: 'flow',
        from: 'input',
        to: 'output',
        variant,
        fromSide,
        toSide,
        route: 'straight',
      },
    ],
  };
}

function extractParentSvg(html) {
  return html.match(/      <svg\b[\s\S]*?      <\/svg>/)?.[0] || '';
}

function domIds(svg) {
  return new Set([...svg.matchAll(/(?:^|[\s<])id="([^"]+)"/g)].map((match) => match[1]));
}

test('compiler preserves the checked-in no-subarchitecture parent SVG byte for byte', () => {
  const input = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', 'web-app.architecture.json'),
    'utf8',
  ));
  const expected = extractParentSvg(fs.readFileSync(
    path.join(repoRoot, 'examples', 'web-app-rendered.html'),
    'utf8',
  ));

  assert.ok(expected, 'checked artifact must contain its canonical parent SVG');
  assert.equal(compileArchitectureGraph(input).svg, expected);
});

test('adding subarchitecture leaves the complete parent SVG and layout report unchanged', () => {
  const withSubarchitecture = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'test', 'fixtures', 'transformer-subarchitecture.architecture.json'),
    'utf8',
  ));
  const parentOnly = structuredClone(withSubarchitecture);
  delete parentOnly.components.find((component) => component.id === 'transformer').subarchitecture;

  const parentCompiled = compileArchitectureGraph(parentOnly);
  const additiveCompiled = compileArchitectureGraph(withSubarchitecture);

  assert.equal(additiveCompiled.svg, parentCompiled.svg);
  assert.deepEqual(additiveCompiled.layoutReport, parentCompiled.layoutReport);
  assert.deepEqual(additiveCompiled.semantic, parentCompiled.semantic);
});

test('compiler is re-entrant across A to B to A and does not mutate either input', () => {
  const inputA = graph({ title: 'Graph A' });
  const inputB = graph({
    title: 'Graph B',
    secondPos: [40, 200],
    fromSide: 'bottom',
    toSide: 'top',
  });
  const beforeA = JSON.stringify(inputA);
  const beforeB = JSON.stringify(inputB);

  const firstA = compileArchitectureGraph(inputA);
  const compiledB = compileArchitectureGraph(inputB);
  const secondA = compileArchitectureGraph(inputA);

  assert.equal(firstA.svg, secondA.svg);
  assert.deepEqual(firstA.layoutReport, secondA.layoutReport);
  assert.notEqual(firstA.svg, compiledB.svg);
  assert.equal(JSON.stringify(inputA), beforeA);
  assert.equal(JSON.stringify(inputB), beforeB);
  assert.deepEqual(firstA.viewBox, [520, 320]);
  assert.ok(firstA.svgBody && !firstA.svgBody.trimStart().startsWith('<svg'));
  assert.ok(firstA.svg.includes(firstA.svgBody));
  assert.deepEqual(firstA.semantic.nodes.map(({ id }) => id), ['input', 'output']);
  assert.deepEqual(firstA.semantic.edges.map(({ id }) => id), ['flow']);
});

test('identityPrefix scopes DOM and SVG resources while preserving authored semantic ids', () => {
  const prefix = 'sub-transformer-';
  const markerByVariant = {
    default: 'arrowhead',
    emphasis: 'arrowhead-emphasis',
    security: 'arrowhead-security',
    dashed: 'arrowhead-dashed',
  };

  for (const [variant, marker] of Object.entries(markerByVariant)) {
    const { svg } = compileArchitectureGraph(graph({ variant }), { identityPrefix: prefix });
    const ids = domIds(svg);

    assert.match(svg, /data-node-id="input"/);
    assert.match(svg, /data-node-id="output"/);
    assert.match(svg, /data-edge-id="flow"/);
    assert.match(svg, /data-edge-from="input"/);
    assert.match(svg, /data-edge-to="output"/);
    assert.ok(ids.has(`${prefix}node-input`));
    assert.ok(ids.has(`${prefix}node-output`));
    assert.ok(ids.has(`${prefix}archify-diagram-title`));
    assert.ok(ids.has(`${prefix}archify-diagram-description`));
    assert.ok(ids.has(`${prefix}grid`));
    assert.ok(ids.has(`${prefix}arrowhead`));
    assert.ok(ids.has(`${prefix}arrowhead-emphasis`));
    assert.ok(ids.has(`${prefix}arrowhead-security`));
    assert.ok(ids.has(`${prefix}arrowhead-dashed`));
    assert.match(
      svg,
      new RegExp(`aria-labelledby="${prefix}archify-diagram-title ${prefix}archify-diagram-description"`),
    );
    assert.match(svg, new RegExp(`marker-end="url\\(#${prefix}${marker}\\)"`));

    const references = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);
    assert.ok(references.length >= 2, 'compiled SVG must reference its grid and marker definitions');
    for (const reference of references) {
      assert.ok(reference.startsWith(prefix), `unscoped SVG reference: ${reference}`);
      assert.ok(ids.has(reference), `missing scoped definition for ${reference}`);
    }
  }
});

test('different prefixes make identical authored child ids DOM-disjoint', () => {
  const input = graph();
  const first = compileArchitectureGraph(input, { identityPrefix: 'sub-transformer-' });
  const second = compileArchitectureGraph(input, { identityPrefix: 'sub-encoder-' });
  const firstIds = domIds(first.svg);
  const secondIds = domIds(second.svg);

  assert.deepEqual([...firstIds].filter((id) => secondIds.has(id)), []);
  assert.match(first.svg, /data-node-id="input"/);
  assert.match(second.svg, /data-node-id="input"/);
});

test('compiler diagnostics retain the authored child subject base', () => {
  const invalid = graph();
  invalid.components[1].pos = [80, 90];
  const subjectBase = '/components/0/subarchitecture';

  assert.throws(
    () => compileArchitectureGraph(invalid, {
      graphScope: 'subarchitecture',
      parentId: 'transformer',
      subjectBase,
    }),
    (error) => {
      assert.ok(Array.isArray(error.archifyDiagnostics));
      assert.ok(error.archifyDiagnostics.length > 0);
      assert.ok(error.archifyDiagnostics.every(
        (diagnostic) => diagnostic.subject.subjectBase === subjectBase,
      ));
      assert.ok(error.archifyDiagnostics.every(
        (diagnostic) => diagnostic.subject.graphScope === 'subarchitecture',
      ));
      assert.ok(error.archifyDiagnostics.every(
        (diagnostic) => diagnostic.subject.parentId === 'transformer',
      ));
      return true;
    },
  );
});

test('architecture renderer embeds one inert scoped Transformer subgraph template', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-subarchitecture-template-'));
  const input = path.join(skillRoot, 'test', 'fixtures', 'transformer-subarchitecture.architecture.json');
  const output = path.join(scratch, 'transformer.html');
  try {
    const rendered = spawnSync(process.execPath, [
      path.join(skillRoot, 'renderers', 'architecture', 'render-architecture.mjs'),
      input,
      output,
    ], { cwd: skillRoot, encoding: 'utf8' });
    assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
    const html = fs.readFileSync(output, 'utf8');
    const templates = [...html.matchAll(/<template\b[^>]*data-subarchitecture-parent="([^"]+)"[^>]*>([\s\S]*?)<\/template>/g)];
    assert.equal(templates.length, 1);
    assert.equal(templates[0][1], 'transformer');
    assert.match(templates[0][0], /data-subarchitecture-title="Transformer Layer Internals"/);
    assert.equal((html.match(/<svg\b/g) || []).length, 2, 'one canonical parent plus one inert child SVG');
    const childSvg = templates[0][2];
    assert.equal((childSvg.match(/<svg\b/g) || []).length, 1);
    for (const id of ['layer_input', 'norm_1', 'attention', 'residual_1', 'norm_2', 'ffn', 'residual_2']) {
      assert.match(childSvg, new RegExp(`data-node-id="${id}"`));
    }
    assert.match(childSvg, /Residual Skip 1/);
    assert.match(childSvg, /Residual Skip 2/);
    assert.match(childSvg, /data-composition-frame-label="Self-Attention Block"/);
    assert.match(childSvg, /marker-end="url\(#sub-transformer-arrowhead-dashed\)"/);
    const childIds = [...childSvg.matchAll(/(?:^|[\s<])id="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(childIds.length > 0);
    assert.ok(childIds.every((id) => id.startsWith('sub-transformer-')));
    assert.doesNotMatch(templates[0][0], /"components"\s*:/, 'template must not embed raw Architecture JSON');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
