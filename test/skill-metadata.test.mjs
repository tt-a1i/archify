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
const explainerAuthoring = readFileSync(path.join(skillRoot, 'references', 'explainer-authoring.md'), 'utf8');
const repositoryRoot = path.join(skillRoot, '..');
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
  const references = [...skill.matchAll(/`((?:assets|bin|examples|explainer|recipes|references|renderers|schemas|scripts)\/[^`\s]+)`/g)]
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
  assert.match(updateAwareness, /Keep the installed version unchanged/i);
  assert.doesNotMatch(skill, /npx skills update|gh skill update/i);
});

test('language behavior stays within the bounded locale contract', () => {
  assert.match(defaults, /one primary authored language/);
  assert.match(defaults, /user's choice or the request\/conversation/);
  assert.match(defaults, /`en`, `zh-CN`, `zh-TW`, `es`, `ko`, and `ar` select a bundled Viewer catalog/);
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

// #1299: explainer pages are proactive by default (like Answer me with HTML),
// remain switchable back to on-demand through the existing rules line, and a
// produced page is always reachable from the last line of the final reply.
test('explainer mode defaults to proactive and switches through the existing rules line', () => {
  const metadata = parse(frontmatter[1]);
  assert.match(metadata.description, /by default unasked/i);
  assert.match(metadata.description, /\[archify explainer: on-demand\]/);
  assert.match(skill, /Explainer mode is `proactive` by default/);
  assert.match(skill, /`proactive` \(default, no line needed\)[^\n]*complex flow[^\n]*diagnosis or troubleshooting[^\n]*comparison[^\n]*test or review report/);
  assert.match(skill, /`on-demand`: make a page only when asked/);
  assert.match(skill, /`always-on` \(opt-in only\)/);
  assert.match(skill, /Never switch to `always-on` unasked/);
  assert.match(skill, /only when the user asks[^\n]*`\[archify explainer: <mode>\]` line in the current agent's global rules file[^\n]*deleting the line restores `proactive`/);
  // The retired on-request upsell would contradict the new default and push the link off the last line.
  assert.doesNotMatch(skill, /offering the proactive mode|mode offer/);
  assert.doesNotMatch(explainerAuthoring, /mode offer/);
  assert.match(explainerAuthoring, /default `proactive` mode, `on-demand` and opt-in `always-on`/);
});

test('explainer suppression rules keep short, text-only and failed answers free of pages and links', () => {
  assert.match(skill, /short or one-line answers, routine status updates[^\n]*raw command output, a requested native diagram and any reply where the user asks for text only or no page/);
  assert.match(skill, /at most one page per reply, and none when the user names another page tool or another skill already made a page/);
  assert.match(skill, /When `finalize explainer` fails or the renderer is unavailable, answer in text, say in one line that the page was not produced, and give no page link/);
  assert.match(explainerAuthoring, /When finalize does not pass and repair stops, answer in text, say the page was not produced, and give no page link/);
});

test('a delivered explainer ends its reply with a descriptive absolute-path link', () => {
  for (const [name, text] of [['SKILL.md', skill], ['explainer-authoring.md', explainerAuthoring]]) {
    assert.match(text, /conclusion in one to three lines/, `${name} keeps a directly readable conclusion`);
    assert.match(text, /last line, a Markdown link[^\n]*descriptive title in the user's language/, `${name} puts the link last`);
    assert.match(text, /\[查看测试报告\]\(\/abs\/path\/test-report\.html\)/, `${name} shows a descriptive link example`);
  }
  assert.match(skill, /Use the absolute path, wrapped in `<\.\.\.>` when it contains spaces, not `file:\/\/`; put any update notice before it/);
  assert.match(skill, /Never offer a directory, terminal log or auto-open \(`--open`\) instead of the link/);
  assert.match(explainerAuthoring, /Hosts differ[^\n]*do not tell the user a link is clickable or was opened in a host where you have not seen that happen/);
});

test('every README documents the proactive default and the on-demand switch', () => {
  for (const name of ['README.md', 'README_EN.md', 'README_ZH.md', 'README_JA.md', 'README_KO.md']) {
    const readme = readFileSync(path.join(repositoryRoot, name), 'utf8');
    assert.match(readme, /`\[archify explainer: on-demand\]`/, `${name} names the on-demand switch`);
    assert.match(readme, /`\[archify explainer: always-on\]`/, `${name} names the opt-in always-on mode`);
    assert.match(readme, /~\/\.codex\/AGENTS\.md/, `${name} names a global rules file`);
  }
});

test('explainer authoring documents role naming and narrow-screen two-to-three column tables', () => {
  assert.match(explainerAuthoring, /role <type> \| <label>/);
  assert.match(explainerAuthoring, /Keep tables to two or three columns/);
});
