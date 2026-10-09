import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

export const skillRoot = fileURLToPath(new URL('../../archify/', import.meta.url));
export const cli = path.join(skillRoot, 'bin/archify.mjs');
export const ES_TRANSLATIONS = JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales/es.json'), 'utf8'));

// locales/ holds the package-owned catalogs that meta.locale selects through
// locales/manifest.json. examples/locales/fr.partial.json is the genericity
// proof — an unbundled language, deliberately partial to also exercise the
// coverage/fallback contract.
export const KO_TRANSLATIONS = JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales/ko.json'), 'utf8'));
export const FR_PARTIAL_TRANSLATIONS = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/locales/fr.partial.json'), 'utf8'));
export const MANIFEST = JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales/manifest.json'), 'utf8'));

export const EXAMPLES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

export function example(type) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', EXAMPLES[type]), 'utf8'));
}

const AUTHORED_TEXT_KEYS = new Set([
  'title',
  'subtitle',
  'label',
  'sublabel',
  'tag',
  'note',
  'context',
  'responsibility',
  'classification',
  'step',
]);

export function authoredExample(type, locale) {
  const document = example(type);
  const authored = [];
  let authoredIndex = 0;
  const nextAuthoredText = () => {
    authoredIndex += 1;
    const value = locale === 'zh-CN'
      ? `文案${String(authoredIndex).padStart(2, '0')}`
      : locale === 'ko'
        ? `문구${String(authoredIndex).padStart(2, '0')}`
        : `Copy${String(authoredIndex).padStart(2, '0')}`;
    authored.push(value);
    return value;
  };
  const rewrite = (value, path = []) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => rewrite(item, [...path, index]));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && AUTHORED_TEXT_KEYS.has(key)) {
        value[key] = nextAuthoredText();
      } else if (key === 'items' && path.includes('cards') && Array.isArray(child)) {
        value[key] = child.map((item) => (typeof item === 'string' ? nextAuthoredText() : item));
      } else {
        rewrite(child, [...path, key]);
      }
    }
  };

  rewrite(document);
  document.meta.locale = locale;
  if (locale === 'ko') document.meta.translations = KO_TRANSLATIONS;
  if (!document.meta.subtitle) document.meta.subtitle = nextAuthoredText();
  return { document, authored };
}

export function localeDocument(type, meta) {
  const document = example(type);
  delete document.meta.subtitle;
  Object.assign(document.meta, meta);
  return document;
}

// Each suite owns its files; sharing fixture code never shares rendered output.
export function createLocaleFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-i18n-'));
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  let sequence = 0;

  function run(type, document, command = 'render') {
    const id = sequence++;
    const input = path.join(tmp, `${id}-${type}.json`);
    const output = path.join(tmp, `${id}-${type}.html`);
    fs.writeFileSync(input, JSON.stringify(document));
    const args = command === 'render'
      ? [cli, 'render', type, input, output]
      : [cli, 'validate', type, input, '--json'];
    const result = spawnSync(process.execPath, args, { cwd: skillRoot, encoding: 'utf8' });
    return {
      ...result,
      output,
      html: result.status === 0 && command === 'render' ? fs.readFileSync(output, 'utf8') : '',
    };
  }

  function deliverKoreanFixture() {
    const fixture = path.join(skillRoot, '..', 'test', 'fixtures/korean-locale.architecture.json');
    const source = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    assert.equal(source.meta.locale, 'ko');
    assert.match(source.meta.title, /[가-힣]/);

    const validate = spawnSync(process.execPath, [cli, 'validate', 'architecture', fixture, '--json'], {
      cwd: skillRoot,
      encoding: 'utf8',
    });
    assert.equal(validate.status, 0, validate.stderr || validate.stdout);
    const validation = JSON.parse(validate.stdout);
    assert.equal(validation.ok, true);
    assert.equal(validation.command, 'validate');

    const artifact = path.join(tmp, 'korean-locale-fixture.html');
    const deliver = spawnSync(
      process.execPath,
      [cli, 'deliver', 'architecture', fixture, artifact, '--quality', 'showcase', '--json'],
      { cwd: skillRoot, encoding: 'utf8' },
    );
    assert.equal(deliver.status, 0, deliver.stderr || deliver.stdout);
    const delivery = JSON.parse(deliver.stdout);
    assert.equal(delivery.ok, true);
    assert.equal(delivery.command, 'deliver');
    assert.equal(delivery.type, 'architecture');
    assert.match(delivery.artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(delivery.artifact.bytes, fs.statSync(artifact).size);
    assert.equal(delivery.artifact.sha256, createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'));
    return { fixture, artifact, delivery };
  }

  function deliverJapaneseFixture() {
    const fixture = path.join(skillRoot, '..', 'test', 'fixtures/japanese-locale.architecture.json');
    const source = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    assert.equal(source.meta.locale, 'ja');
    assert.match(source.meta.title, /[぀-ヿ一-鿿]/);

    const validate = spawnSync(process.execPath, [cli, 'validate', 'architecture', fixture, '--json'], {
      cwd: skillRoot,
      encoding: 'utf8',
    });
    assert.equal(validate.status, 0, validate.stderr || validate.stdout);
    const validation = JSON.parse(validate.stdout);
    assert.equal(validation.ok, true);
    assert.equal(validation.command, 'validate');

    const artifact = path.join(tmp, 'japanese-locale-fixture.html');
    const deliver = spawnSync(
      process.execPath,
      [cli, 'deliver', 'architecture', fixture, artifact, '--quality', 'showcase', '--json'],
      { cwd: skillRoot, encoding: 'utf8' },
    );
    assert.equal(deliver.status, 0, deliver.stderr || deliver.stdout);
    const delivery = JSON.parse(deliver.stdout);
    assert.equal(delivery.ok, true);
    assert.equal(delivery.command, 'deliver');
    assert.equal(delivery.type, 'architecture');
    assert.match(delivery.artifact.sha256, /^[a-f0-9]{64}$/);
    assert.equal(delivery.artifact.bytes, fs.statSync(artifact).size);
    assert.equal(delivery.artifact.sha256, createHash('sha256').update(fs.readFileSync(artifact)).digest('hex'));
    return { fixture, artifact, delivery };
  }

  function cliJson(args) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: tmp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }

  return { tmp, run, deliverKoreanFixture, deliverJapaneseFixture, cliJson };
}
