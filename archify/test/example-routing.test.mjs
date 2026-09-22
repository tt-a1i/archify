import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
const reference = fs.readFileSync(path.join(root, 'references/repository-authoring.md'), 'utf8');

// These check the shipped instruction/resource contract. Actual model loading
// order is a separate experiment, not established by matching this text.
test('repository Architecture routes before example loading through one canonical selection', () => {
  const router = skill.slice(skill.indexOf('## Type router'), skill.indexOf('## Mermaid input'));
  const architectureRow = router.split('\n').find((line) => line.startsWith('| `architecture`'));
  assert.match(architectureRow, /System descriptions\/services \(including CLI servers\): `examples\/web-app\.architecture\.json`/);
  assert.match(architectureRow, /library\/API or CLI data processing repos: `examples\/source-to-diagram\/source-to-diagram\.architecture\.json`/);
  assert.match(architectureRow, /deployment repos: `examples\/production-deployment\.architecture\.json`/);
  assert.match(skill, /select the matching showcase example in the Type router before loading it/);
  assert.match(reference, /Read another example when a necessary\s+capability remains unexplained/);
  assert.match(reference, /\.\.\/SKILL\.md#type-router/);
  const selection = reference.slice(reference.indexOf('## Choose an example'), reference.indexOf('## Author from evidence'));
  assert.doesNotMatch(selection, /instead of|examples\/web-app/);
});

test('all routed examples and schema references resolve to the advertised diagram type', () => {
  const router = skill.slice(skill.indexOf('## Type router'), skill.indexOf('## Mermaid input'));
  const rows = router.split('\n').filter((line) => /^\| `(architecture|workflow|sequence|dataflow|lifecycle)`/.test(line));
  assert.equal(rows.length, 5);
  for (const row of rows) {
    const type = row.match(/^\| `([^`]+)`/)[1];
    for (const relative of [...row.matchAll(/`((?:schemas|examples)\/[^`]+\.json)`/g)].map((m) => m[1])) {
      const document = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
      if (relative.startsWith('examples/')) assert.equal(document.diagram_type, type, relative);
    }
  }
  for (const relative of [...router.matchAll(/`(examples\/[^`]+\.architecture\.json)`/g)].map((m) => m[1])) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')).diagram_type, 'architecture');
  }
});

test('existing candidate handoff and other mode starters retain their direct paths', () => {
  const handoff = skill.slice(skill.indexOf('## Existing candidate handoff'), skill.indexOf('## Fast authoring path'));
  assert.match(handoff, /run `finalize` first as one CLI invocation/);
  assert.doesNotMatch(handoff, /example selection|examples\//);
  for (const starter of ['starter.workflow.json', 'cache-miss-request.sequence.json', 'product-analytics.dataflow.json', 'deployment-release.lifecycle.json']) {
    assert.ok(skill.includes('`examples/' + starter + '`'), starter);
  }
  const defaults = fs.readFileSync(path.join(root, 'references/authoring-defaults.md'), 'utf8');
  assert.match(defaults, /inspect `properties.boundaries.items`/);
  assert.match(defaults, /`\$defs.guidedViews`/);
  assert.match(defaults, /never target a total reference count/);
});
