import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLocateProjection, embedProjection, locateRange } from '../locate/locate.mjs';
import { inheritParentExcluded, loadOwnership } from '../locate/ownership.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('bundle projection copies entry HTML and embeds locate projection', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-locate-bundle-'));
  const parentMap = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Parent' },
    components: [
      { id: 'cli', type: 'frontend', label: 'CLI' },
      { id: 'viewer', type: 'frontend', label: 'Viewer' },
    ],
    connections: [{ id: 'cli-viewer', from: 'cli', to: 'viewer' }],
  };
  const childMap = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Viewer child' },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'template', type: 'process', label: 'Template', lane: 'main' },
      { id: 'runtime', type: 'process', label: 'Runtime', lane: 'main' },
    ],
    edges: [{ id: 't-r', from: 'template', to: 'runtime' }],
  };
  writeJson(path.join(dir, 'parent.architecture.json'), parentMap);
  writeJson(path.join(dir, 'parent.architecture.ownership.json'), {
    schema_version: 1,
    kind: 'ownership',
    map: 'parent.architecture.json',
    components: [
      { id: 'cli', globs: ['bin/**'] },
      { id: 'viewer', globs: ['assets/**'], child_map: 'child.workflow.json' },
    ],
  });
  writeJson(path.join(dir, 'child.workflow.json'), childMap);
  writeJson(path.join(dir, 'child.workflow.ownership.json'), {
    schema_version: 1,
    kind: 'ownership',
    map: 'child.workflow.json',
    parent: { map: 'parent.architecture.json', component: 'viewer' },
    components: [
      { id: 'template', globs: ['assets/template.html'] },
      { id: 'runtime', globs: ['assets/runtime.mjs'] },
    ],
  });
  const entryHtml = '<!DOCTYPE html><html><body><p>entry</p></body></html>\n';
  fs.writeFileSync(path.join(dir, 'parent.architecture.html'), entryHtml);
  writeJson(path.join(dir, 'manifest.json'), {
    schema_version: 1,
    bundle_type: 'drilldown',
    entry: 'parent.architecture.html',
    diagrams: [
      { id: 'parent', file: 'parent.architecture.html', diagram_type: 'architecture', level: 0 },
      { id: 'child-viewer', file: 'child.workflow.html', diagram_type: 'workflow', level: 1 },
    ],
    drilldowns: [{ parent: 'parent', component: 'viewer', child: 'child-viewer' }],
  });

  const parentLoaded = loadOwnership({
    ownershipPath: path.join(dir, 'parent.architecture.ownership.json'),
    mapPath: path.join(dir, 'parent.architecture.json'),
    map: parentMap,
  });
  const childLoaded = loadOwnership({
    ownershipPath: path.join(dir, 'child.workflow.ownership.json'),
    mapPath: path.join(dir, 'child.workflow.json'),
    map: childMap,
  });
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const changes = [
    { changeType: 'M', path: 'bin/cli.mjs' },
    { changeType: 'M', path: 'assets/template.html' },
  ];
  const headTree = ['bin/cli.mjs', 'assets/template.html', 'assets/runtime.mjs'];
  const entryReceipt = locateRange({
    base,
    head,
    map: parentMap,
    ownership: parentLoaded.ownership,
    changes,
    headTree,
    children: { viewer: childLoaded.ownership },
    mapPath: 'parent.architecture.json',
    ownershipPath: 'parent.architecture.ownership.json',
    ownershipSha256: parentLoaded.sha256,
  });
  const childReceipt = locateRange({
    base,
    head,
    map: childMap,
    ownership: childLoaded.ownership,
    changes,
    headTree,
    mapPath: 'child.workflow.json',
    ownershipPath: 'child.workflow.ownership.json',
    ownershipSha256: childLoaded.sha256,
  });
  const projection = buildLocateProjection({
    base,
    head,
    entryReceipt,
    childReceipts: { 'child-viewer': childReceipt },
  });
  assert.equal(projection.schemaVersion, 1);
  assert.equal(projection.components.cli.state, 'touched');
  assert.equal(projection.components.viewer.files_touched_inside, childReceipt.summary.files.touched);
  assert.equal(projection.children['child-viewer'].nodes.template, 'touched');
  assert.equal(projection.children['child-viewer'].nodes.runtime, 'untouched');

  const projected = embedProjection(entryHtml, projection);
  const out = path.join(dir, 'parent.architecture.locate.html');
  fs.writeFileSync(out, projected);
  assert.equal(fs.readFileSync(path.join(dir, 'parent.architecture.html'), 'utf8'), entryHtml);
  assert.match(projected, /id="archify-locate-projection"/);
  assert.ok(projected.includes('</body>'));
  assert.equal(projected.indexOf('archify-locate-projection') < projected.lastIndexOf('</body>'), true);
});

test('parent excluded is inherited in the child projection and files_touched_inside', () => {
  const parentMap = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Archify' },
    components: [{ id: 'renderers-shared', type: 'backend', label: 'Shared' }],
  };
  const childMap = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Pipeline' },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [{ id: 'schema-validate', lane: 'main', col: 0, type: 'security', label: 'Validate' }],
    edges: [],
  };
  const parentOwnership = {
    excluded: ['archify/renderers/shared/generated-*.mjs'],
    components: [{
      id: 'renderers-shared',
      globs: ['archify/renderers/shared/**'],
      child_map: 'render-pipeline.json',
    }],
  };
  const childOwnership = {
    parent: { map: 'archify-self.json', component: 'renderers-shared' },
    components: [{ id: 'schema-validate', globs: ['archify/renderers/shared/**'] }],
  };
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const changes = [{ changeType: 'M', path: 'archify/renderers/shared/generated-validators.mjs' }];
  const headTree = ['archify/renderers/shared/generated-validators.mjs', 'archify/renderers/shared/validator.mjs'];
  const entryReceipt = locateRange({
    base,
    head,
    map: parentMap,
    ownership: parentOwnership,
    changes,
    headTree,
    children: { 'renderers-shared': childOwnership },
    mapPath: 'archify-self.json',
    ownershipPath: 'archify-self.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  const inside = entryReceipt.components.find((component) => component.id === 'renderers-shared').inside;
  assert.equal(inside.touched, 0);
  assert.equal(inside.excluded, 1);
  const withoutInherit = locateRange({
    base,
    head,
    map: childMap,
    ownership: childOwnership,
    changes,
    headTree,
    mapPath: 'render-pipeline.json',
    ownershipPath: 'render-pipeline.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  assert.equal(withoutInherit.files.find((file) => file.path.endsWith('generated-validators.mjs')).state, 'touched');
  const childReceipt = locateRange({
    base,
    head,
    map: childMap,
    ownership: inheritParentExcluded(parentOwnership, childOwnership),
    changes,
    headTree,
    mapPath: 'render-pipeline.json',
    ownershipPath: 'render-pipeline.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  const generated = childReceipt.files.find((file) => file.path.endsWith('generated-validators.mjs'));
  assert.equal(generated.state, 'excluded');
  const projection = buildLocateProjection({
    base,
    head,
    entryReceipt,
    childReceipts: { 'render-pipeline': childReceipt },
  });
  assert.equal(projection.components['renderers-shared'].files_touched_inside, 0);
});


test('projection JSON cannot close its embedding script element', () => {
  const value = { components: { '</script><script>bad()</script>&': { state: 'untouched' } } };
  const html = embedProjection('<html><body></body></html>', value);
  assert.equal((html.match(/<script/g) || []).length, 1);
  const embedded = html.match(/type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(embedded), value);
});
