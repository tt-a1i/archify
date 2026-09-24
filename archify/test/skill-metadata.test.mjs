import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.join(here, '..');
const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const defaults = readFileSync(path.join(skillRoot, 'references', 'authoring-defaults.md'), 'utf8');
const updateAwareness = readFileSync(path.join(skillRoot, 'references', 'update-awareness.md'), 'utf8');
const authoringContract = readFileSync(path.join(skillRoot, 'references', 'authoring-contract.md'), 'utf8');
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);

test('skill description is portable across 1024-character runtimes and remains searchable', () => {
  assert.ok(frontmatter, 'SKILL.md must start with YAML frontmatter');
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  assert.ok(description, 'frontmatter must include a one-line description');
  assert.ok(description.length <= 1024, `description is ${description.length} characters; maximum is 1024`);
  assert.ok(Buffer.byteLength(description, 'utf8') <= 1024, 'description must also fit a 1024-byte runtime limit');

  for (const trigger of ['architecture', 'workflow', 'sequence', 'data-flow', 'lifecycle', 'Mermaid']) {
    assert.match(description, new RegExp(`\\b${trigger}\\b`, 'i'), `description must retain the ${trigger} trigger`);
  }
  assert.match(description, /standalone HTML/i);
  assert.match(description, /Use when/i);
});

test('role-specific icon guidance preserves technical type semantics', () => {
  assert.match(defaults, /icon: "monitor"/);
  assert.match(defaults, /icon: "alert"/);
  assert.match(defaults, /Keep `type` tied to what the node actually is/);
  assert.match(defaults, /Do not infer either icon from label text alone/);
  assert.match(authoringContract, /type: "backend"[\s\S]*icon: "monitor"/);
  assert.match(authoringContract, /icon: "alert"/);
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
  assert.match(skill + updateAwareness, /`scripts\/check-update\.mjs`/);
  assert.match(skill + updateAwareness, /`silent`[\s\S]*without mentioning/i);
  assert.match(skill + updateAwareness, /`update_available`[\s\S]*compact notice/i);
  assert.match(skill + updateAwareness, /information, not permission/i);
  assert.match(skill + updateAwareness, /`severity` is `security`[\s\S]*security update[\s\S]*emphasis only, never user autonomy/i);
  assert.match(skill + updateAwareness, /continue the user's original task/i);
  assert.match(skill + updateAwareness, /installed version unchanged/i);
  assert.doesNotMatch(skill, /npx skills update|gh skill update/i);
});

test('language behavior stays within the bounded locale contract', () => {
  assert.match(defaults, /one primary authored language/);
  assert.match(defaults, /user's choice or the request\/conversation/);
  assert.match(defaults, /English \(`en`\), Simplified Chinese \(`zh-CN`\), or Spanish \(`es`\)/);
  assert.match(defaults, /otherwise omit it and disclose the fixed Viewer UI and `<html lang>` English fallback/);
  assert.match(defaults, /exact product, code, protocol, command, API, and environment names/);
  assert.match(defaults, /Language consistency\]\(authoring-contract\.md#language-consistency\)/);
  assert.match(authoringContract, /`meta\.locale` controls only renderer-owned reader surfaces/);
  assert.match(authoringContract, /outside `en`, `zh-CN`, and `es`/);
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
