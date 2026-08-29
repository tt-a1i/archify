import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { SCENARIO_RECIPES, startPromptsFor } from '../recipes/scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');

class FakeElement {
  constructor({ id = '', textContent = '', dataset = {} } = {}) {
    this.id = id;
    this.textContent = textContent;
    this.dataset = dataset;
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.tabIndex = 0;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  replaceChildren(...children) { this.children = children; }
  appendChild() {}
  remove() {}
  select() {}
  focus() { this.focused = true; }
  click() { return this.listeners.click?.({ preventDefault() {} }); }
  dispatchKey(key) { return this.listeners.keydown?.({ key, preventDefault() {} }); }
}

function executeStartPage(html) {
  const dataMatch = html.match(/<script id="start-data" type="application\/json">([\s\S]*?)<\/script>/);
  const scriptMatch = html.match(/<script>\n([\s\S]*?)\n  <\/script>\n<\/body>/);
  assert.ok(dataMatch);
  assert.ok(scriptMatch);

  const ids = Object.fromEntries([
    'recipe-title', 'recipe-question', 'recipe-prompt', 'include-list', 'proof-link',
    'proof-meta', 'copy-status', 'language', 'agent-state', 'install-command',
    'project-command', 'copy-prompt', 'copy-starter',
  ].map((id) => [id, new FakeElement({ id })]));
  ids['start-data'] = new FakeElement({ id: 'start-data', textContent: dataMatch[1] });

  const types = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']
    .map((type) => new FakeElement({ dataset: { type } }));
  const agents = ['cursor', 'codex', 'claude-code', 'opencode']
    .map((agent) => new FakeElement({ textContent: agent === 'codex' ? 'Codex' : agent, dataset: { agent } }));
  const inputs = ['description', 'repository']
    .map((input) => new FakeElement({ dataset: { input } }));
  const copySources = ['install-command', 'project-command']
    .map((copySource) => new FakeElement({ dataset: { copySource } }));
  const copied = [];
  const stored = new Map();
  let replacedUrl = '';
  const document = {
    documentElement: {},
    body: { appendChild() {} },
    getElementById(id) { return ids[id]; },
    createElement() { return new FakeElement(); },
    execCommand() { return true; },
    querySelector(selector) {
      const match = selector.match(/^\[data-agent="([^"]+)"\]$/);
      return match ? agents.find((element) => element.dataset.agent === match[1]) : null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-type]') return types;
      if (selector === '[data-agent]') return agents;
      if (selector === '[data-input]') return inputs;
      if (selector === '[data-copy-source]') return copySources;
      if (selector === '[data-en][data-zh]') return [];
      return [];
    },
  };
  const window = {
    location: { href: 'https://example.test/start.html', search: '', pathname: '/start.html' },
    isSecureContext: true,
    dispatchEvent() {},
    ArchifySiteLanguage: {
      read() { return 'en'; },
      write(value) { return value; },
    },
  };
  const context = {
    window,
    ArchifySiteLanguage: window.ArchifySiteLanguage,
    document,
    navigator: { languages: ['en'], language: 'en', clipboard: { async writeText(value) { copied.push(value); } } },
    history: { replaceState(_state, _title, url) { replacedUrl = url; } },
    sessionStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, value); },
    },
    CustomEvent: class { constructor(name, options) { this.name = name; this.detail = options.detail; } },
    URL,
    URLSearchParams,
    Set,
    Array,
    JSON,
    encodeURIComponent,
  };
  vm.createContext(context);
  new vm.Script(scriptMatch[1]).runInContext(context);
  return { data: JSON.parse(dataMatch[1]), ids, inputs, copied, window, getUrl: () => replacedUrl };
}

test('start page: checked-in HTML is reproducible from canonical scenario recipes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-start-page-'));
  const generated = path.join(tmp, 'start.html');
  try {
    execFileSync(process.execPath, [path.join(repoRoot, 'scripts/build-start.mjs'), generated]);
    assert.equal(
      fs.readFileSync(generated, 'utf8'),
      fs.readFileSync(path.join(repoRoot, 'docs/start.html'), 'utf8'),
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('start page: offers five bounded bilingual starts without ingesting source content', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'docs/start.html'), 'utf8');
  assert.doesNotMatch(html, /\[\[[A-Z0-9_]+\]\]/);
  assert.match(html, /npx -y skills add tt-a1i\/archify --skill archify --agent codex --global --copy --yes/);
  assert.match(html, /npx -y skills add tt-a1i\/archify --skill archify --agent codex --copy --yes/);
  for (const agent of ['cursor', 'codex', 'claude-code', 'opencode']) {
    assert.match(html, new RegExp(`role="tab" data-agent="${agent}"`));
  }
  assert.match(html, /data-en="Describe it\."/);
  assert.match(html, /data-en="Archify maps it\."/);
  assert.match(html, /data-zh="直接说，"/);
  assert.match(html, /data-zh="Archify 就能画。"/);
  assert.match(html, /id="copy-starter"/);
  assert.match(html, /data-en="Copy install \+ prompt"/);
  assert.match(html, /data-zh="复制安装命令 \+ 提示词"/);
  assert.match(html, /data-en="No repository is required\./);
  assert.match(html, /data-zh="不需要绑定代码库。/);
  assert.match(html, /data-input="description"/);
  assert.match(html, /data-input="repository"/);

  const dataMatch = html.match(/<script id="start-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(dataMatch);
  const data = JSON.parse(dataMatch[1]);
  assert.deepEqual(Object.keys(data), ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
  assert.ok(Object.values(data).every((entry) => entry.en.prompt && entry.zh.prompt && entry.en.descriptionPrompt && entry.zh.descriptionPrompt && entry.en.repositoryPrompt && entry.zh.repositoryPrompt && entry.proof));

  const scriptMatch = html.match(/<script>\n([\s\S]*?)\n  <\/script>\n<\/body>/);
  assert.ok(scriptMatch);
  assert.doesNotThrow(() => new vm.Script(scriptMatch[1]));
  assert.match(scriptMatch[1], /KNOWN_TYPES\.has\(requestedType\)/);
  assert.match(scriptMatch[1], /KNOWN_AGENTS\.has\(requestedAgent\)/);
  assert.match(scriptMatch[1], /KNOWN_SOURCES\.has\(requestedSource\)/);
  assert.match(scriptMatch[1], /KNOWN_INPUTS\.has\(requestedInput\)/);
  assert.match(scriptMatch[1], /next\.searchParams\.set\('agent', agent\)/);
  assert.match(scriptMatch[1], /next\.searchParams\.set\('source', source\)/);
  assert.match(scriptMatch[1], /next\.searchParams\.set\('input', input\)/);
  assert.match(scriptMatch[1], /next\.searchParams\.delete\('lang'\)/);
  assert.match(scriptMatch[1], /--agent ' \+ agent \+ ' --global --copy --yes/);
  assert.match(scriptMatch[1], /--agent ' \+ agent \+ ' --copy --yes/);
  assert.match(scriptMatch[1], /function starterText\(\)/);
  assert.match(scriptMatch[1], /archify:start-funnel/);
  assert.match(scriptMatch[1], /archify\.start\.events\.v1/);
  assert.doesNotMatch(scriptMatch[1], /fetch\(|sendBeacon\(|XMLHttpRequest/);
  assert.match(scriptMatch[1], /textContent/);
  assert.match(scriptMatch[1], /replaceChildren/);
  assert.doesNotMatch(scriptMatch[1], /innerHTML/);
});

test('start page: canonical recipes own description and repository prompt variants', () => {
  const selected = new Map([
    ['architecture', 'system-overview'],
    ['workflow', 'agent-tool-call'],
    ['sequence', 'api-request'],
    ['dataflow', 'event-stream'],
    ['lifecycle', 'object-lifecycle'],
  ]);
  for (const [type, id] of selected) {
    const recipe = SCENARIO_RECIPES.find((candidate) => candidate.id === id);
    assert.equal(recipe?.type, type);
    for (const language of ['en', 'zh']) {
      const prompts = startPromptsFor(recipe, language);
      assert.equal(prompts.descriptionPrompt, recipe.start[language].descriptionPrompt);
      assert.ok(prompts.repositoryPrompt.toLowerCase().includes(recipe[language].prompt.toLowerCase()));
    }
  }
});

test('start page: input mode drives rendered prompt, copy, keyboard, and URL without changing event schema', async () => {
  const html = fs.readFileSync(path.join(repoRoot, 'docs/start.html'), 'utf8');
  const page = executeStartPage(html);
  const descriptionPrompt = page.data.architecture.en.descriptionPrompt;
  const repositoryPrompt = page.data.architecture.en.repositoryPrompt;

  assert.equal(page.inputs[0].getAttribute('aria-selected'), 'true');
  assert.equal(page.inputs[1].getAttribute('aria-selected'), 'false');
  assert.equal(page.ids['recipe-prompt'].textContent, descriptionPrompt);
  assert.equal(new URL(page.getUrl(), 'https://example.test').searchParams.get('input'), 'description');

  page.inputs[1].click();
  assert.equal(page.inputs[1].getAttribute('aria-selected'), 'true');
  assert.equal(page.ids['recipe-prompt'].textContent, repositoryPrompt);
  assert.equal(new URL(page.getUrl(), 'https://example.test').searchParams.get('input'), 'repository');

  page.ids['copy-prompt'].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.copied.at(-1), repositoryPrompt);

  page.inputs[1].dispatchKey('ArrowLeft');
  assert.equal(page.inputs[0].getAttribute('aria-selected'), 'true');
  assert.equal(page.inputs[0].focused, true);
  assert.equal(page.ids['recipe-prompt'].textContent, descriptionPrompt);

  page.ids['copy-starter'].click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(page.copied.at(-1), /Then start any new chat and tell Codex:/);
  assert.ok(page.copied.at(-1).endsWith(descriptionPrompt));

  const [viewEvent, promptEvent, starterEvent] = page.window.ArchifyStartMetrics.snapshot();
  for (const event of [viewEvent, promptEvent, starterEvent]) {
    assert.deepEqual(Object.keys(event), ['schemaVersion', 'step', 'source', 'type', 'agent', 'language']);
    assert.equal('input' in event, false);
  }
  assert.deepEqual([viewEvent.step, promptEvent.step, starterEvent.step], ['start_view', 'prompt_copy', 'starter_copy']);
});

test('generated artifacts omit the promotional footer and shortcut manual', () => {
  const examples = {
    architecture: 'web-app.architecture.json',
    workflow: 'agent-tool-call.workflow.json',
    sequence: 'cache-miss-request.sequence.json',
    dataflow: 'product-analytics.dataflow.json',
    lifecycle: 'agent-run.lifecycle.json',
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-start-artifacts-'));
  try {
    for (const [type, input] of Object.entries(examples)) {
      const out = path.join(tmp, `${type}.html`);
      execFileSync(process.execPath, [
        path.join(skillRoot, `renderers/${type}/render-${type}.mjs`),
        path.join(skillRoot, 'examples', input),
        out,
      ]);
      const html = fs.readFileSync(out, 'utf8');
      assert.doesNotMatch(html, /<p class="footer">/, `${type}: footer element`);
      assert.doesNotMatch(html, /Built with Archify/, `${type}: product signature`);
      assert.doesNotMatch(html, /Create yours/, `${type}: promotional CTA`);
      assert.doesNotMatch(html, /Hover to trace/, `${type}: shortcut manual`);
      assert.doesNotMatch(html, /source=artifact/, `${type}: removed artifact CTA URL`);
      assert.match(html, /id="btn-diagram-guide"/, `${type}: diagram guide remains available`);

      const svg = html.match(/<svg[\s\S]*?<\/svg>/)?.[0];
      assert.ok(svg, `${type}: SVG missing`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('viewer gives wide screens a larger canvas without forcing a subtitle row', () => {
  const template = fs.readFileSync(path.join(skillRoot, 'assets', 'template.html'), 'utf8');
  assert.match(template, /max-width: var\(--archify-reader-width, 1440px\)/);
  assert.match(template, /Archify\.readerLayout = \(function \(\)/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-title-hierarchy-'));
  try {
    const input = JSON.parse(fs.readFileSync(
      path.join(skillRoot, 'examples', 'web-app.architecture.json'),
      'utf8',
    ));
    delete input.meta.subtitle;
    const source = path.join(tmp, 'without-subtitle.architecture.json');
    const output = path.join(tmp, 'without-subtitle.html');
    fs.writeFileSync(source, `${JSON.stringify(input, null, 2)}\n`);
    execFileSync(process.execPath, [
      path.join(skillRoot, 'renderers', 'architecture', 'render-architecture.mjs'),
      source,
      output,
    ]);
    assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /class="subtitle"/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('artifact-to-install measurement plan separates observable funnel steps from first-diagram success', () => {
  const plan = fs.readFileSync(
    path.join(repoRoot, 'docs/artifact-install-v2-measurement.md'),
    'utf8',
  );

  for (const required of [
    'start_view',
    'starter_copy',
    'global_install_copy',
    'project_install_copy',
    'prompt_copy',
    'proof_open',
    'starter_copy / start_view',
    'First-diagram success is not observable from this static page',
    'No network request',
    'source=artifact',
    'source=gallery',
  ]) {
    assert.match(plan, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), required);
  }
});
