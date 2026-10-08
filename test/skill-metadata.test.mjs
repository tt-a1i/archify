import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.join(here, '..', 'archify');
const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const defaults = readFileSync(path.join(skillRoot, 'references', 'authoring-defaults.md'), 'utf8');
const updateAwareness = readFileSync(path.join(skillRoot, 'references', 'update-awareness.md'), 'utf8');
const authoringContract = readFileSync(path.join(skillRoot, 'references', 'authoring-contract.md'), 'utf8');
const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

test('skill description is portable across 1024-character runtimes and remains searchable', () => {
  assert.ok(frontmatter, 'SKILL.md must start with YAML frontmatter');
  const metadata = parse(frontmatter[1]);
  assert.equal(metadata.name, 'archify');
  const description = metadata.description;
  assert.equal(typeof description, 'string', 'frontmatter description must be a YAML string');
  assert.ok(description.trim(), 'frontmatter must include a nonempty description');
  assert.ok(description.length <= 1024, `description is ${description.length} characters; maximum is 1024`);
  assert.ok(Buffer.byteLength(description, 'utf8') <= 1024, 'description must also fit a 1024-byte runtime limit');

  for (const trigger of ['architecture', 'workflow', 'sequence', 'data-flow', 'lifecycle', 'Mermaid']) {
    assert.match(description, new RegExp(`\\b${trigger}\\b`, 'i'), `description must retain the ${trigger} trigger`);
  }
  assert.match(description, /standalone HTML/i);
  assert.match(description, /Use when/i);
});

test('literal packaged-skill path references resolve inside the installed skill root', () => {
  const references = [...skill.matchAll(/`((?:assets|bin|examples|recipes|references|renderers|schemas|scripts)\/[^`\s]+)`/g)]
    .map((match) => match[1])
    .filter((reference) => !/[<>{}*\[\]]/.test(reference));

  assert.ok(references.length > 0, 'expected literal packaged-skill references');
  for (const reference of new Set(references)) {
    assert.equal(existsSync(path.join(skillRoot, reference)), true, `SKILL.md references missing packaged path ${reference}`);
  }
});

test('main skill stays a bounded authoring router with progressive references', () => {
  const lines = skill.trimEnd().split('\n');
  assert.ok(lines.length <= 160, `SKILL.md is ${lines.length} lines; keep the entrypoint at 160 or fewer`);
  for (const reference of [
    'references/authoring-contract.md',
    'references/viewer-runtime.md',
    'references/delivery-contract.md',
  ]) {
    assert.match(skill, new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(existsSync(path.join(skillRoot, reference)), true, `${reference} must ship with the skill`);
  }
});

test('update awareness is notification-only and never replaces the requested workflow', () => {
  assert.match(skill + updateAwareness, /`finalize` and standalone `deliver` include `update`/);
  assert.match(skill + updateAwareness, /`update\.noticeRequired`[\s\S]*final response/i);
  assert.match(skill + updateAwareness, /several diagrams[\s\S]*once in the final response/i);
  assert.match(skill + updateAwareness, /information, not permission/i);
  assert.match(skill, /Snooze or ignore a reminder only when the user explicitly asks/);
  assert.match(updateAwareness, /explicitly asks to pause or stop[\s\S]*--snooze "<eventKey>"[\s\S]*--ignore "<eventKey>"[\s\S]*Never run them on your own initiative/);
  assert.match(skill + updateAwareness, /installed Skill has not changed/i);
  assert.doesNotMatch(skill, /npx skills update|gh skill update/i);
});

test('language behavior stays within the bounded locale contract', () => {
  assert.match(defaults, /one primary authored language/);
  assert.match(defaults, /user's choice or the request\/conversation/);
  assert.match(defaults, /`en`, `zh-CN`, `zh-TW`, `es`, and `ko` select a bundled Viewer catalog/);
  assert.match(defaults, /meta\.translations/);
  assert.match(defaults, /exact product, code, protocol, command, API, and environment names/);
  assert.match(defaults, /Language consistency\]\(authoring-contract\.md#language-consistency\)/);
  assert.match(authoringContract, /`meta\.locale` controls only renderer-owned reader surfaces/);
  assert.match(authoringContract, /valid\s+`meta\.translations` value → the selected bundled catalog → English/);
  assert.match(authoringContract, /supply only the keys whose wording the diagram needs to change/);
  assert.match(authoringContract, /For a language without a bundled catalog, supply the catalog here/);
  assert.match(authoringContract, /Reuse suitable translations/);
  assert.match(authoringContract, /artifact is\s+not fully localized/);
  assert.match(authoringContract, /Do not silently substitute\s+`zh-CN` for another language or Chinese locale/);
  assert.match(authoringContract, /It never translates authored content/);
  assert.match(authoringContract, /Renderer-owned default legend labels follow `meta\.locale`/);
  assert.match(authoringContract, /The fallback\s+applies only to renderer-owned surfaces/);
});

test('skill keeps the title hierarchy compact by default', () => {
  assert.match(defaults, /`meta\.subtitle` for a title-only header/);
  assert.match(defaults, /Explicit styles and a subtitle require a user request/);
  assert.match(authoringContract, /never use it to restate the title, nodes, edges,\s+or cards/);
  assert.match(authoringContract, /omitted or blank subtitle must not leave an empty visual row/);
});

// The review Skill remains available to repository maintainers, but must not
// enter an unfiltered consumer install from the repository root.
test('contributor review skill is internal and retains its repository references', () => {
  const reviewRoot = path.resolve(skillRoot, '..', '.agents', 'skills', 'archify-review');
  const review = readFileSync(path.join(reviewRoot, 'SKILL.md'), 'utf8');
  const metadata = parse(review.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)[1]);
  assert.equal(metadata.name, 'archify-review');
  assert.equal(metadata.metadata?.internal, true);
  for (const document of ['../../../REVIEWING.md', '../../../CONTRIBUTING.md']) {
    assert.ok(review.includes(document));
    assert.ok(existsSync(path.resolve(reviewRoot, document)));
  }
});
