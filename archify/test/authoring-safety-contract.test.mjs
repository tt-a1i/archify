import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const authoringContract = fs.readFileSync(
  path.join(skillRoot, 'references', 'authoring-contract.md'),
  'utf8',
);
const schemaReadme = fs.readFileSync(path.join(skillRoot, 'schemas', 'README.md'), 'utf8');

test('semantic relationship labels are preserved and deletion is not a geometry repair', () => {
  for (const [name, source] of [['SKILL.md', skill], ['authoring contract', authoringContract]]) {
    assert.match(source, /Relationship labels are semantic data/i, name);
    assert.match(source, /move the label[\s\S]*adjust the route or spacing[\s\S]*shorten/i, name);
    assert.match(source, /protocol[\s\S]*action[\s\S]*direction[\s\S]*synchronous[\s\S]*asynchronous[\s\S]*cross-boundary mechanism/i, name);
    assert.match(source, /Omit only wording[\s\S]*fully implied by both endpoints/i, name);
    assert.match(source, /Preserve every meaningful label/i, name);
    assert.match(source, /deleting it is not\s+a (?:geometry|spacing) repair/i, name);
  }
});

test('schema policy documents the workflow v1/v2 compatibility boundary', () => {
  assert.match(schemaReadme, /Workflow[^\n]*schema versions? 1 and 2/i);
  assert.match(schemaReadme, /other four[^\n]*schema_version[^\n]*1/i);
  assert.doesNotMatch(schemaReadme, /schema_version` is `"const": 1`/);
});

test('deployment ownership stays explicit, fact-backed, and cannot be removed to pass', () => {
  assert.match(skill, /Omit `meta\.engineering_profile` by default/);
  assert.match(skill, /Region.*cluster.*security boundar.*do not.*enable/i);
  assert.match(skill, /production deployment topology.*ownership.*fail-closed deployment review/i);
  assert.match(skill, /must not remove.*engineering profile.*pass validation/i);
});

test('visual-check stays a pending sidecar receipt instead of a polish claim', () => {
  const deliveryContract = fs.readFileSync(
    path.join(skillRoot, 'references', 'delivery-contract.md'),
    'utf8',
  );
  assert.match(skill, /visual-check <output\.html> --json/);
  assert.match(skill, /automated browser evidence[\s\S]*perceptual visual review/i);
  assert.match(skill, /references\/delivery-contract\.md/);
  assert.match(skill, /without (?:rerendering or )?modifying/i);

  assert.match(deliveryContract, /visual-check <output\.html> --json/);
  assert.match(deliveryContract, /1440×900[\s\S]*1600×1000[\s\S]*1920×1080[\s\S]*2048×1320/);
  assert.match(deliveryContract, /visualReview: "pending"/);
  assert.match(deliveryContract, /never changes.*delivered|without (?:rerendering or )?modifying/i);
});
