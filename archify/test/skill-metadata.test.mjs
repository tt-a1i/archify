import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.join(here, '..');
const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const authoringContract = readFileSync(path.join(skillRoot, 'references', 'authoring-contract.md'), 'utf8');
const authoringDefaults = readFileSync(path.join(skillRoot, 'references', 'authoring-defaults.md'), 'utf8');
const topologyGuidance = `${skill}\n${authoringContract}\n${authoringDefaults}`;
const updateAwareness = readFileSync(path.join(skillRoot, 'references', 'update-awareness.md'), 'utf8');
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
  assert.ok(Buffer.byteLength(skill, 'utf8') <= 13000, `SKILL.md is ${Buffer.byteLength(skill, 'utf8')} bytes; keep branch-specific rules progressively disclosed`);
  for (const reference of [
    'references/authoring-defaults.md',
    'references/authoring-contract.md',
    'references/update-awareness.md',
    'references/viewer-runtime.md',
    'references/delivery-contract.md',
  ]) {
    assert.match(skill, new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(existsSync(path.join(skillRoot, reference)), true, `${reference} must ship with the skill`);
  }
});

test('fresh authoring routes directly to a starter or full schema example without directory discovery', () => {
  assert.match(skill, /do not list `schemas\/` or `examples\/` first/i);
  const routes = {
    architecture: ['schemas/architecture.schema.json', 'examples/web-app.architecture.json'],
    workflow: ['schemas/workflow.schema.json', 'examples/starter.workflow.json'],
    sequence: ['schemas/sequence.schema.json', 'examples/cache-miss-request.sequence.json'],
    dataflow: ['schemas/dataflow.schema.json', 'examples/product-analytics.dataflow.json'],
    lifecycle: ['schemas/lifecycle.schema.json', 'examples/deployment-release.lifecycle.json'],
  };
  for (const [type, references] of Object.entries(routes)) {
    const row = skill.split('\n').find((line) => line.startsWith(`| \`${type}\``));
    assert.ok(row, `missing Type router row for ${type}`);
    for (const reference of references) {
      assert.match(row, new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.equal(existsSync(path.join(skillRoot, reference)), true, `${reference} must ship with the skill`);
    }
  }
});

test('repository authoring starts with evidence and avoids speculative preflight work', () => {
  assert.match(skill, /do not run help, doctor, validate a starter, create a temporary diagram, pre-create\/list output paths, or query brands/i);
  assert.match(skill, /Architecture[\s\S]*matching showcase example[\s\S]*guided views[\s\S]*conclusion cards/i);
  assert.match(skill, /Let the real system determine the number of nodes and relationships/i);
  assert.match(skill, /merging would hide a responsibility, boundary, trust boundary, protocol, lifecycle, ownership, or persistence seam/i);
  assert.match(skill, /Never use node, relationship, source-reference, view, card, or boundary counts as an authoring target, ceiling, or performance lever/i);
  assert.match(skill, /audit responsibility ownership rather than counts/i);
  assert.match(skill, /controller, broker, runtime, or supervisor separate when it manages multiple participants/i);
  assert.match(skill, /external caller or client separate from the gateway, relay, or service/i);
  assert.match(skill, /transport is not its user/i);
  assert.match(skill, /Never use shared source citations as a substitute for an omitted role/i);
  assert.match(skill, /repository showcase[\s\S]*curated `meta\.views` for distinct reader questions[\s\S]*every aid must improve comprehension, with no quota/i);
  assert.doesNotMatch(topologyGuidance, /nodes \+ 2|\d+[–-]\d+\s+(?:primary\s+)?(?:nodes|components|relationships|views|cards|boundaries)|roughly \d+\s+(?:primary\s+)?(?:nodes|components|relationships)|at most \w+\s+(?:curated\s+)?(?:nodes|components|relationships|chapters|views|cards|boundaries)/i);
  assert.match(authoringContract, /source-driven topology needs room/i);
  assert.match(authoringContract, /Include every component required to explain the requested responsibilities and boundaries; omit only genuinely irrelevant detail/i);
  assert.match(skill, /repository-backed candidate[\s\S]*--repo-root <repo-root>/i);
  assert.match(skill, /rerun the complete `finalize` command from step 4 once, retaining `--quality showcase` and `--repo-root <repo-root>` for repository-backed candidates/i);
  assert.match(skill, /Use standalone `validate` only for focused diagnosis, with `--repo-root <repo-root>` for a repository/i);
  assert.match(authoringDefaults, /finish the evidence shape while inspecting source, not after validation fails/i);
  assert.match(authoringDefaults, /canonical remote URL and full 40-character commit/i);
  assert.match(authoringDefaults, /at least one inspected `sources` entry to every key semantic node/i);
  assert.match(authoringDefaults, /source references are evidence, never decoration/i);
  assert.match(authoringDefaults, /Audit ownership before freezing topology/i);
  assert.match(authoringDefaults, /shared control plane distinct from the managed participants/i);
  assert.match(authoringDefaults, /Audit entry and trust boundaries too/i);
  assert.match(authoringDefaults, /Do not merge an actor into infrastructure/i);
  assert.match(authoringDefaults, /For a fresh Architecture, omit `meta\.viewBox` by default/i);
  assert.match(authoringDefaults, /renderer measures the real content and declares intrinsic-height Reader behavior/i);
  assert.match(authoringDefaults, /Architecture sublabels render at a preferred 9px/i);
  assert.match(authoringDefaults, /5\.4px × text units \+ 8px/i);
  assert.match(authoringDefaults, /Never remove a responsibility, protocol, or boundary fact just to shorten text/i);
});

test('update awareness is notification-only and never enters the serialized delivery path', () => {
  assert.match(skill, /`scripts\/check-update\.mjs`/);
  assert.match(skill, /true parallel tool calls[\s\S]*alongside validation or `finalize`/i);
  assert.match(skill, /Otherwise skip it; do not serialize it into the user's delivery path/i);
  assert.match(skill, /Never add a foreground tool turn or delay a required gate for update information/i);
  assert.match(skill, /`silent`[\s\S]*without mentioning/i);
  assert.match(skill, /`update_available`[\s\S]*references\/update-awareness\.md/i);
  assert.match(updateAwareness, /compact notice/i);
  assert.match(updateAwareness, /information, not permission/i);
  assert.match(updateAwareness, /`severity` is `security`[\s\S]*security update[\s\S]*emphasis only, never reduced user autonomy/i);
  assert.match(updateAwareness, /continue the user's original task/i);
  assert.match(updateAwareness, /installed version unchanged/i);
  assert.doesNotMatch(`${skill}\n${updateAwareness}`, /npx skills update|gh skill update/i);
});

test('architecture defaults prevent predictable first-draft route churn without weakening meaning', () => {
  assert.match(authoringDefaults, /Components do not accept a `variant` field/i);
  assert.match(authoringDefaults, /Relationship variants are `default`, `emphasis`, `security`, and `dashed`/i);
  assert.match(authoringDefaults, /step across multiple rows[\s\S]*shallow strip[\s\S]*semantic compression/i);
  assert.match(skill, /first draft[\s\S]*renderer route every connection[\s\S]*omit `via`, `route`, `fromSide`, `toSide`, `channelX`, `channelY`, `labelAt`, `labelDx`, `labelDy`, and `labelSegment`/i);
  assert.match(authoringDefaults, /first draft leaves every connection on automatic routing/i);
  assert.match(authoringDefaults, /After a measured diagnostic[\s\S]*smallest named control/i);
  assert.match(authoringDefaults, /real return edge[\s\S]*compact outer side pair or perimeter corridor/i);
  assert.match(authoringDefaults, /never delete it to simplify geometry/i);
  assert.match(skill, /smallest coherent local edit[\s\S]*not prose coordinate exploration or whole-candidate replacement/i);
  assert.match(skill, /Geometry never authorizes deleting or merging a source-backed component, relationship, reference, view, card, boundary, or semantic label/i);
  assert.match(skill, /Do not read `bin\/` implementation[\s\S]*before the first candidate/i);
  assert.match(authoringDefaults, /Never make unrelated orthogonal segments share the same axis for 8px or more/i);
  assert.match(authoringDefaults, /counting each CJK character as two units/i);
  assert.match(authoringDefaults, /every labeled connection on the main path/i);
  assert.match(authoringDefaults, /minimum clear gap, never as one fixed gap shared across the row/i);
  assert.match(authoringDefaults, /relationship does not accept a `side` field/i);
  assert.match(authoringDefaults, /only after a diagnostic proves endpoint routing is required[\s\S]*use `fromSide` or `toSide` on the diagnosed endpoint/i);
  assert.match(authoringDefaults, /6px projected-text check is a hard failure floor, not a layout target/i);
  assert.match(authoringDefaults, /at 1440px, aim for ordinary context text around 7\.5px or larger/i);
  assert.match(authoringDefaults, /meaningful vertical rows[\s\S]*Reader-declared vertical page scroll/i);
  assert.match(authoringDefaults, /At 1440px, legacy, unknown, and authored-viewBox artifacts[\s\S]*930px diagram budget/i);
  assert.match(authoringDefaults, /fresh automatic wide Architecture[\s\S]*recognized Reader contract[\s\S]*declared budget and cap[\s\S]*composition\.desktopReadability/i);
  assert.match(authoringDefaults, /meaningful rows[\s\S]*intrinsic-height layout[\s\S]*not by dropping meaning or designing to a fixed viewBox width/i);
  assert.match(authoringDefaults, /Estimate the resolved Architecture content width before the first write/i);
});

test('language behavior stays within the bounded locale contract', () => {
  assert.match(skill, /references\/authoring-defaults\.md/);
  assert.match(authoringDefaults, /one primary authored language/);
  assert.match(authoringDefaults, /explicit user choice; otherwise follow the request or conversation's dominant language/);
  assert.match(authoringDefaults, /`meta\.locale` controls only renderer-owned Viewer UI/);
  assert.match(authoringDefaults, /use `"en"`, `"zh-CN"`, or `"es"`/);
  assert.match(authoringDefaults, /For every other language, omit `meta\.locale`/);
  assert.match(authoringDefaults, /fixed Viewer UI and `<html lang>` fall back to English/);
  assert.match(authoringDefaults, /renderer never translates authored content/i);
  assert.match(authoringDefaults, /product names.*code identifiers.*protocols.*API paths.*environment names/);
  assert.match(authoringContract, /`meta\.locale` controls only renderer-owned reader surfaces/);
  assert.match(authoringContract, /outside `en`, `zh-CN`, and `es`/);
  assert.match(authoringContract, /artifact is\s+not fully localized/);
  assert.match(authoringContract, /Do not silently substitute\s+`zh-CN` for another language or Chinese locale/);
  assert.match(authoringContract, /It never translates authored content/);
  assert.match(authoringContract, /Renderer-owned default legend labels follow `meta\.locale`/);
  assert.match(authoringContract, /The fallback\s+applies only to renderer-owned surfaces/);
});

test('skill keeps the title hierarchy compact by default', () => {
  assert.match(skill, /references\/authoring-defaults\.md/);
  assert.match(authoringDefaults, /Omit `meta\.subtitle` by default/);
  assert.match(authoringDefaults, /Never invent a subtitle that restates the title, nodes, or cards/);
  assert.match(authoringContract, /omitted or blank subtitle must not leave an empty visual row/);
});
