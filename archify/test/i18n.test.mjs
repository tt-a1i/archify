import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

import {
  SUPPORTED_LOCALES,
  catalogKeys,
  translateCount,
  translateMessage,
  registerLocale,
  validateTranslations,
} from '../renderers/shared/i18n.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const templatePath = path.join(skillRoot, 'assets/template.html');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-i18n-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
let sequence = 0;

// examples/locales/ko.json is the worked example the maintainer asked for:
// Korean supplied as data through meta.translations instead of a third
// hard-coded locale in i18n.mjs. examples/locales/fr.partial.json is the
// genericity proof — a second, previously unsupported language, deliberately
// partial to also exercise the coverage/fallback contract. Registering 'ko'
// here (once, at module scope) makes direct translateMessage('ko', …) calls
// below resolve the same way the CLI resolves it per-document.
const KO_TRANSLATIONS = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/locales/ko.json'), 'utf8'));
const FR_PARTIAL_TRANSLATIONS = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/locales/fr.partial.json'), 'utf8'));
registerLocale('ko', KO_TRANSLATIONS);

const EXAMPLES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function example(type) {
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

function authoredExample(type, locale) {
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

async function evaluate(browser, sessionId, expression, awaitPromise = false) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'browser evaluation failed');
  }
  return response.result?.value;
}

async function loadArtifact(browser, artifactPath) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(artifactPath).href,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `new Promise(function (resolve) {
    requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(true); }); });
  })`, true);
  return sessionId;
}

test('zh-CN localizes renderer-owned output across all five modes without translating authored content', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'zh-CN', 'es']);
  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    const authoredTitle = document.meta.title;
    document.meta.locale = 'zh-CN';
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="zh-CN"/);
    assert.match(result.html, /<svg\b[^>]*\blang="zh-CN"/);
    assert.ok(result.html.includes(`<title>${authoredTitle}</title>`), `${type}: authored title changed`);
    assert.ok(result.html.includes(`<h1>${authoredTitle}</h1>`), `${type}: authored heading changed`);
    assert.match(result.html, /<text\b[^>]*>\u56fe\u4f8b<\/text>/);
    assert.match(result.html, /aria-label="\u805a\u7126/);
    assert.match(result.html, new RegExp(`<desc id="archify-diagram-description">\u7531 Archify \u751f\u6210\u7684`));
    assert.match(result.html, /"locale":"zh-CN"/);
    assert.match(result.html, />\u5bfc\u51fa\u56fe\u8868</);
    assert.doesNotMatch(result.html, /\{\{i18n:/);
  }
});

test('es localizes renderer-owned output across all five modes without translating authored content', () => {
  // es must keep working as a built-in catalog: it ships on dev independently
  // of meta.translations, and this PR's mechanism must not regress it to an
  // English fallback once merged (see tt-a1i's review on #457).
  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    const authoredTitle = document.meta.title;
    document.meta.locale = 'es';
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="es"/);
    assert.match(result.html, /<svg\b[^>]*\blang="es"/);
    assert.ok(result.html.includes(`<title>${authoredTitle} · Diagrama</title>`), `${type}: authored title changed`);
    assert.ok(result.html.includes(`<h1>${authoredTitle}</h1>`), `${type}: authored heading changed`);
    assert.match(result.html, /<text\b[^>]*>Leyenda<\/text>/);
    assert.match(result.html, /aria-label="Enfocar /);
    assert.match(result.html, /<desc id="archify-diagram-description">[^<]*generado por Archify/);
    assert.match(result.html, /"locale":"es"/);
    assert.match(result.html, />Exportar diagrama</);
    assert.doesNotMatch(result.html, /\{\{i18n:/);
    assert.doesNotMatch(result.stderr, /has no built-in catalog/, `${type}: es unexpectedly fell back to English`);
  }
});

test('ko localizes renderer-owned output across all five modes via meta.translations, without translating authored content', () => {
  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    const authoredTitle = document.meta.title;
    document.meta.locale = 'ko';
    document.meta.translations = KO_TRANSLATIONS;
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="ko"/);
    assert.match(result.html, /<svg\b[^>]*\blang="ko"/);
    assert.ok(result.html.includes(`<title>${authoredTitle} 다이어그램</title>`), `${type}: authored title changed`);
    assert.ok(result.html.includes(`<h1>${authoredTitle}</h1>`), `${type}: authored heading changed`);
    assert.match(result.html, /<text\b[^>]*>범례<\/text>/);
    assert.match(result.html, /aria-label="[^"]*포커스/);
    assert.match(result.html, new RegExp(`<desc id="archify-diagram-description">Archify로 생성한`));
    assert.match(result.html, /"locale":"ko"/);
    assert.match(result.html, />다이어그램 내보내기</);
    assert.doesNotMatch(result.html, /\{\{i18n:/);
  }
});

test('explicit en, zh-CN, and ko preserve complete authored field inventories across all five modes', () => {
  for (const type of Object.keys(EXAMPLES)) {
    const english = authoredExample(type, 'en');
    const chinese = authoredExample(type, 'zh-CN');
    const korean = authoredExample(type, 'ko');
    assert.equal(english.authored.length, chinese.authored.length, `${type}: authored shapes differ`);
    assert.equal(english.authored.length, korean.authored.length, `${type}: Korean authored shapes differ`);
    assert.ok(english.authored.length >= 10, `${type}: authored inventory is unexpectedly small`);
    if (type === 'dataflow') {
      assert.ok(
        english.authored.includes(english.document.flows[0].classification),
        'dataflow: classification is missing from the authored inventory',
      );
    }
    if (type === 'lifecycle') {
      assert.ok(
        english.authored.includes(english.document.states[0].step),
        'lifecycle: step is missing from the authored inventory',
      );
    }

    for (const candidate of [english, chinese, korean]) {
      const locale = candidate.document.meta.locale;
      const result = run(type, candidate.document);
      assert.equal(result.status, 0, `${type}/${locale}: ${result.stderr || result.stdout}`);
      assert.match(result.html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${locale}"`));
      assert.match(result.html, new RegExp(`<svg\\b[^>]*\\blang="${locale}"`));
      assert.match(result.html, new RegExp(`"locale":"${locale}"`));
      for (const authoredText of candidate.authored) {
        assert.ok(result.html.includes(authoredText), `${type}/${locale}: lost authored text ${authoredText}`);
      }
      if (locale === 'zh-CN') {
        assert.ok(result.html.includes(`<title>${candidate.document.meta.title}</title>`), type);
        assert.match(result.html, />导出图表</);
      } else if (locale === 'ko') {
        assert.ok(result.html.includes(`<title>${candidate.document.meta.title} 다이어그램</title>`), type);
        assert.match(result.html, />다이어그램 내보내기</);
      } else {
        assert.ok(result.html.includes(`<title>${candidate.document.meta.title} Diagram</title>`), type);
        assert.match(result.html, />Export diagram</);
      }
    }
  }
});

test('omitted locale preserves non-English authored content and the English Viewer contract in all five modes', () => {
  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    const authoredTitle = `作者内容-${type}`;
    document.meta.title = authoredTitle;
    delete document.meta.locale;
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="en"/);
    assert.ok(result.html.includes(`<title>${authoredTitle} Diagram</title>`), `${type}: authored title changed`);
    assert.ok(result.html.includes(`<h1>${authoredTitle}</h1>`), `${type}: authored heading changed`);
    assert.match(result.html, /<svg\b[^>]*\blang="en"/);
    assert.match(result.html, /aria-label="Focus /);
    assert.match(result.html, /"locale":"en"/);
    assert.match(result.html, />Export diagram</);
  }
});

function deliverKoreanFixture() {
  const fixture = path.join(skillRoot, 'test/fixtures/korean-locale.architecture.json');
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

test('checked-in Korean fixture validates and delivers a ko architecture artifact', () => {
  const { artifact, delivery } = deliverKoreanFixture();
  const html = fs.readFileSync(artifact, 'utf8');
  assert.match(html, /^<!DOCTYPE html>\n<html lang="ko"/);
  assert.match(html, /<svg\b[^>]*\blang="ko"/);
  assert.ok(html.includes('<title>한국어 웹앱 다이어그램</title>'));
  assert.ok(html.includes('<h1>한국어 웹앱</h1>'));
  assert.ok(html.includes('사용자'));
  assert.ok(html.includes('API 서버'));
  assert.match(html, />다이어그램 내보내기</);
  assert.match(html, /<text\b[^>]*>범례<\/text>/);
  assert.match(delivery.artifact.sha256, /^[a-f0-9]{64}$/);
});

test('visual-check binds the delivered Korean fixture to viewport and theme receipts', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to collect artifact-bound visual-check evidence for the Korean fixture.',
}, () => {
  const { artifact, delivery } = deliverKoreanFixture();
  const visual = spawnSync(process.execPath, [cli, 'visual-check', artifact, '--json'], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_CHROME: chromePath },
  });
  assert.ok([0, 1].includes(visual.status), visual.stderr || visual.stdout);
  const receipt = JSON.parse(visual.stdout);
  assert.equal(receipt.command, 'visual-check');
  assert.equal(receipt.visualReview, 'pending');
  assert.equal(receipt.chrome.status, 'available');
  assert.equal(receipt.readability.status, 'pass');
  assert.equal(receipt.viewerChrome.status, 'pass');
  assert.equal(receipt.captures.status, 'pass');
  assert.equal(receipt.artifact.sha256, delivery.artifact.sha256);
  assert.equal(receipt.artifact.bytes, delivery.artifact.bytes);
  assert.equal(
    receipt.containment.viewports.every((viewport) => viewport.overflowX === false),
    true,
    'Korean fixture introduced horizontal overflow',
  );
});

// examples/locales/ko.json proved the mechanism for renderer-owned Viewer
// chrome; this fixture proves the other half of "complete" language support
// that predates this PR (issue #458: "the renderer never translates
// authored content") — an agent authoring titles, node labels, and cards
// directly in the target language, with meta.locale/meta.translations
// localizing only the fixed chrome around it. Japanese is a second,
// independent worked example of that same end-to-end pattern.
function deliverJapaneseFixture() {
  const fixture = path.join(skillRoot, 'test/fixtures/japanese-locale.architecture.json');
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

test('checked-in Japanese fixture validates and delivers a fully-authored ja architecture artifact', () => {
  const { artifact, delivery } = deliverJapaneseFixture();
  const html = fs.readFileSync(artifact, 'utf8');
  assert.match(html, /^<!DOCTYPE html>\n<html lang="ja"/);
  assert.match(html, /<svg\b[^>]*\blang="ja"/);
  assert.ok(html.includes('<title>日本語ウェブアプリ ダイアグラム</title>'));
  assert.ok(html.includes('<h1>日本語ウェブアプリ</h1>'));
  // Authored content (node labels, cards) — never translated, only ever
  // whatever language the fixture itself was written in.
  assert.ok(html.includes('ユーザー'));
  assert.ok(html.includes('APIサーバー'));
  assert.ok(html.includes('エッジ'));
  assert.ok(html.includes('CloudFront CDNがトラフィックを受信'));
  // Renderer-owned chrome — localized via meta.translations.
  assert.match(html, />ダイアグラムをエクスポート</);
  assert.match(html, /<text\b[^>]*>凡例<\/text>/);
  assert.match(delivery.artifact.sha256, /^[a-f0-9]{64}$/);
});

test('visual-check binds the delivered Japanese fixture to viewport and theme receipts', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to collect artifact-bound visual-check evidence for the Japanese fixture.',
}, () => {
  const { artifact, delivery } = deliverJapaneseFixture();
  const visual = spawnSync(process.execPath, [cli, 'visual-check', artifact, '--json'], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_CHROME: chromePath },
  });
  assert.ok([0, 1].includes(visual.status), visual.stderr || visual.stdout);
  const receipt = JSON.parse(visual.stdout);
  assert.equal(receipt.command, 'visual-check');
  assert.equal(receipt.visualReview, 'pending');
  assert.equal(receipt.chrome.status, 'available');
  assert.equal(receipt.readability.status, 'pass');
  assert.equal(receipt.viewerChrome.status, 'pass');
  assert.equal(receipt.captures.status, 'pass');
  assert.equal(receipt.artifact.sha256, delivery.artifact.sha256);
  assert.equal(receipt.artifact.bytes, delivery.artifact.bytes);
  assert.equal(
    receipt.containment.viewports.every((viewport) => viewport.overflowX === false),
    true,
    'Japanese fixture introduced horizontal overflow',
  );
});

test('malformed locale tags fail schema validation in every mode', () => {
  for (const locale of ['123', 'x', 'en_US', 'a'.repeat(40)]) {
    for (const type of Object.keys(EXAMPLES)) {
      const document = example(type);
      document.meta.locale = locale;
      const result = run(type, document, 'validate');
      assert.notEqual(result.status, 0, `${type}: malformed locale ${locale} unexpectedly passed`);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.ok(payload.diagnostics.some((entry) => entry.subject?.path === '/meta/locale'), `${type}: ${locale}`);
    }
  }
});

test('a well-formed but unregistered locale passes validation, falls back to English chrome, and discloses the fallback', () => {
  for (const locale of ['fr', 'zh-HK']) {
    for (const type of Object.keys(EXAMPLES)) {
      const document = example(type);
      document.meta.locale = locale;
      const validated = run(type, document, 'validate');
      assert.equal(validated.status, 0, `${type}/${locale}: ${validated.stderr || validated.stdout}`);
      assert.equal(JSON.parse(validated.stdout).ok, true, `${type}/${locale}`);
      assert.match(
        validated.stderr,
        new RegExp(`meta\\.locale "${locale}" has no built-in catalog and no meta\\.translations`),
        `${type}/${locale}: fallback was not disclosed`,
      );

      const rendered = run(type, document);
      assert.equal(rendered.status, 0, `${type}/${locale}: ${rendered.stderr || rendered.stdout}`);
      assert.match(rendered.html, /^<!DOCTYPE html>\n<html lang="en"/, `${type}/${locale}: did not fall back to en`);
      assert.match(rendered.html, />Export diagram</, `${type}/${locale}`);
    }
  }
});

test('a previously unsupported locale localizes renderer-owned output once meta.translations supplies it, with partial coverage falling back to English key by key', () => {
  const report = validateTranslations(FR_PARTIAL_TRANSLATIONS);
  assert.ok(report.coveredKeys > 0 && report.coveredKeys < report.totalKeys, 'fixture should demonstrate partial, not full or empty, coverage');
  assert.deepEqual(report.placeholderMismatches, []);

  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    document.meta.locale = 'fr';
    document.meta.translations = FR_PARTIAL_TRANSLATIONS;
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="fr"/, type);
    assert.match(result.html, /<svg\b[^>]*\blang="fr"/, type);
    assert.match(result.html, /<text\b[^>]*>Légende<\/text>/, `${type}: covered key did not localize`);
    assert.match(result.html, />Exporter le diagramme</, `${type}: covered key did not localize`);
    // 'viewer.guided.showAll' is outside the partial fr catalog and must fall
    // back to the English base string, not throw or render blank.
    assert.match(result.html, />Show all</, `${type}: uncovered key did not fall back to English`);
    assert.match(
      result.stderr,
      new RegExp(`meta\\.translations for locale "fr" covers ${report.coveredKeys}/${report.totalKeys} renderer-owned messages`),
      `${type}: coverage was not disclosed`,
    );
  }
});

test('translations with unknown keys or mismatched interpolation placeholders are reported and fall back to English per key', () => {
  const document = example('architecture');
  document.meta.locale = 'fr';
  document.meta.translations = {
    ...FR_PARTIAL_TRANSLATIONS,
    'node.focus': '{wrongPlaceholder} au point',
    'this.key.does.not.exist': 'orphan',
  };
  delete document.meta.subtitle;

  const result = run('architecture', document);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  // node.focus falls back to English because {wrongPlaceholder} does not
  // match the canonical {label} token — never a raw or broken template.
  assert.match(result.html, /aria-label="Focus /);
  assert.doesNotMatch(result.html, /wrongPlaceholder/);
  assert.match(result.stderr, /meta\.translations for locale "fr" covers \d+\/519 renderer-owned messages/);
});

test('real Chrome keeps zh-CN Finder, Route, Export, and accessibility UI localized in all five modes', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser localization regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    for (const type of Object.keys(EXAMPLES)) {
      const document = example(type);
      document.meta.locale = 'zh-CN';
      document.meta.title = `浏览器本地化-${type}`;
      const result = run(type, document);
      assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);

      const sessionId = await loadArtifact(browser, result.output);
      const state = await evaluate(browser, sessionId, `(function () {
        var finderButton = document.getElementById('btn-node-finder');
        var routeButton = document.getElementById('btn-route-probe');
        var exportButton = document.getElementById('btn-export');
        finderButton.click();
        var finder = {
          hidden: document.getElementById('node-finder').hidden,
          title: document.getElementById('node-finder-title').textContent.trim(),
          searchLabel: document.getElementById('node-finder-input').getAttribute('aria-label')
        };
        document.getElementById('node-finder-close').click();
        routeButton.click();
        var route = {
          hidden: document.getElementById('route-probe').hidden,
          title: document.getElementById('route-probe-title').textContent.trim(),
          label: routeButton.getAttribute('aria-label')
        };
        routeButton.click();
        exportButton.click();
        var exportMenu = document.getElementById('export-menu');
        function pseudoContent(selector) {
          var content = getComputedStyle(document.querySelector(selector), '::after').content || '';
          return content.replace(/^["']|["']$/g, '');
        }
        var presetBadges = {};
        ['signal-flow', 'blueprint', 'editorial'].forEach(function (preset) {
          document.documentElement.setAttribute('data-preset', preset);
          presetBadges[preset] = {
            header: pseudoContent('.header-row'),
            plate: pseudoContent('.diagram-container')
          };
        });
        return {
          htmlLang: document.documentElement.lang,
          svgLang: document.querySelector('.diagram-container svg').getAttribute('lang'),
          toolbarLabel: document.querySelector('.diagram-nav').getAttribute('aria-label'),
          finder: finder,
          route: route,
          exportMenuOpen: exportMenu.classList.contains('open'),
          exportLabel: exportButton.getAttribute('aria-label'),
          exportMenuLabel: exportMenu.getAttribute('aria-label'),
          exportMenuText: exportMenu.textContent,
          presetBadges: presetBadges
        };
      })()`);

      assert.equal(state.htmlLang, 'zh-CN', type);
      assert.equal(state.svgLang, 'zh-CN', type);
      assert.equal(state.toolbarLabel, '图表视图控制', type);
      assert.deepEqual(state.finder, {
        hidden: false,
        title: '查找节点',
        searchLabel: '搜索图表节点',
      }, type);
      assert.deepEqual(state.route, {
        hidden: false,
        title: '选择起点节点',
        label: '清除已追踪路径',
      }, type);
      assert.equal(state.exportMenuOpen, true, type);
      assert.equal(state.exportLabel, '导出图表', type);
      assert.equal(state.exportMenuLabel, '导出', type);
      assert.match(state.exportMenuText, /分享卡片/, type);
      assert.deepEqual(state.presetBadges, {
        'signal-flow': { header: '信号流', plate: 'none' },
        blueprint: { header: '蓝图 / 修订 01', plate: '' },
        editorial: { header: '编辑风格 / 现场笔记', plate: 'ARCHIFY / 图版 04' },
      }, type);

      const shareCardFailure = await evaluate(browser, sessionId, `(async function () {
        var originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function () { return null; };
        try {
          await Archify.exportMenu.shareCard();
          return { rejected: false, message: '' };
        } catch (error) {
          return { rejected: true, message: String(error && error.message || error) };
        } finally {
          HTMLCanvasElement.prototype.getContext = originalGetContext;
        }
      })()`, true);
      assert.deepEqual(shareCardFailure, {
        rejected: true,
        message: '无法为分享卡片创建二维画布上下文',
      }, type);

      const visual = spawnSync(process.execPath, [cli, 'visual-check', result.output, '--json'], {
        cwd: skillRoot,
        encoding: 'utf8',
        env: { ...process.env, ARCHIFY_CHROME: chromePath },
      });
      assert.ok([0, 1].includes(visual.status), `${type}: ${visual.stderr || visual.stdout}`);
      const receipt = JSON.parse(visual.stdout);
      assert.equal(receipt.visualReview, 'pending', type);
      assert.equal(receipt.chrome.status, 'available', type);
      assert.equal(receipt.readability.status, 'pass', type);
      assert.equal(receipt.viewerChrome.status, 'pass', type);
      assert.equal(receipt.captures.status, 'pass', type);
      assert.equal(
        receipt.containment.viewports.every((viewport) => viewport.overflowX === false),
        true,
        `${type}: localized Viewer introduced horizontal overflow`,
      );
    }
  } finally {
    await browser.close();
  }
});

test('real Chrome keeps ko Finder, Route, Export, and accessibility UI localized in all five modes', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser localization regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    for (const type of Object.keys(EXAMPLES)) {
      const document = example(type);
      document.meta.locale = 'ko';
      document.meta.translations = KO_TRANSLATIONS;
      document.meta.title = `브라우저 로케일-${type}`;
      const result = run(type, document);
      assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);

      const sessionId = await loadArtifact(browser, result.output);
      const state = await evaluate(browser, sessionId, `(function () {
        var finderButton = document.getElementById('btn-node-finder');
        var routeButton = document.getElementById('btn-route-probe');
        var exportButton = document.getElementById('btn-export');
        finderButton.click();
        var finder = {
          hidden: document.getElementById('node-finder').hidden,
          title: document.getElementById('node-finder-title').textContent.trim(),
          searchLabel: document.getElementById('node-finder-input').getAttribute('aria-label')
        };
        document.getElementById('node-finder-close').click();
        routeButton.click();
        var route = {
          hidden: document.getElementById('route-probe').hidden,
          title: document.getElementById('route-probe-title').textContent.trim(),
          label: routeButton.getAttribute('aria-label')
        };
        routeButton.click();
        exportButton.click();
        var exportMenu = document.getElementById('export-menu');
        function pseudoContent(selector) {
          var content = getComputedStyle(document.querySelector(selector), '::after').content || '';
          return content.replace(/^["']|["']$/g, '');
        }
        var presetBadges = {};
        ['signal-flow', 'blueprint', 'editorial'].forEach(function (preset) {
          document.documentElement.setAttribute('data-preset', preset);
          presetBadges[preset] = {
            header: pseudoContent('.header-row'),
            plate: pseudoContent('.diagram-container')
          };
        });
        return {
          htmlLang: document.documentElement.lang,
          svgLang: document.querySelector('.diagram-container svg').getAttribute('lang'),
          toolbarLabel: document.querySelector('.diagram-nav').getAttribute('aria-label'),
          finder: finder,
          route: route,
          exportMenuOpen: exportMenu.classList.contains('open'),
          exportLabel: exportButton.getAttribute('aria-label'),
          exportMenuLabel: exportMenu.getAttribute('aria-label'),
          exportMenuText: exportMenu.textContent,
          presetBadges: presetBadges
        };
      })()`);

      assert.equal(state.htmlLang, 'ko', type);
      assert.equal(state.svgLang, 'ko', type);
      assert.equal(state.toolbarLabel, '다이어그램 보기 제어', type);
      assert.deepEqual(state.finder, {
        hidden: false,
        title: '노드 찾기',
        searchLabel: '다이어그램 노드 검색',
      }, type);
      assert.deepEqual(state.route, {
        hidden: false,
        title: '시작 노드 선택',
        label: '추적된 경로 지우기',
      }, type);
      assert.equal(state.exportMenuOpen, true, type);
      assert.equal(state.exportLabel, '다이어그램 내보내기', type);
      assert.equal(state.exportMenuLabel, '내보내기', type);
      assert.match(state.exportMenuText, /공유 카드/, type);
      assert.deepEqual(state.presetBadges, {
        'signal-flow': { header: '시그널 플로우', plate: 'none' },
        blueprint: { header: '블루프린트 / 개정 01', plate: '' },
        editorial: { header: '에디토리얼 / 현장 노트', plate: 'ARCHIFY / 도판 04' },
      }, type);

      const shareCardFailure = await evaluate(browser, sessionId, `(async function () {
        var originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function () { return null; };
        try {
          await Archify.exportMenu.shareCard();
          return { rejected: false, message: '' };
        } catch (error) {
          return { rejected: true, message: String(error && error.message || error) };
        } finally {
          HTMLCanvasElement.prototype.getContext = originalGetContext;
        }
      })()`, true);
      assert.deepEqual(shareCardFailure, {
        rejected: true,
        message: '공유 카드에 2D 캔버스 컨텍스트를 만들 수 없습니다',
      }, type);

      const visual = spawnSync(process.execPath, [cli, 'visual-check', result.output, '--json'], {
        cwd: skillRoot,
        encoding: 'utf8',
        env: { ...process.env, ARCHIFY_CHROME: chromePath },
      });
      assert.ok([0, 1].includes(visual.status), `${type}: ${visual.stderr || visual.stdout}`);
      const receipt = JSON.parse(visual.stdout);
      assert.equal(receipt.visualReview, 'pending', type);
      assert.equal(receipt.chrome.status, 'available', type);
      assert.equal(receipt.readability.status, 'pass', type);
      assert.equal(receipt.viewerChrome.status, 'pass', type);
      assert.equal(receipt.captures.status, 'pass', type);
      assert.equal(
        receipt.containment.viewports.every((viewport) => viewport.overflowX === false),
        true,
        `${type}: localized Viewer introduced horizontal overflow`,
      );
    }
  } finally {
    await browser.close();
  }
});

test('every Viewer message reference resolves through the shared catalog', () => {
  const template = fs.readFileSync(templatePath, 'utf8');
  const keys = new Set(catalogKeys());
  const references = new Set([
    ...[...template.matchAll(/\{\{i18n:([a-zA-Z0-9_.-]+)\}\}/g)].map((match) => match[1]),
    ...[...template.matchAll(/['"](viewer\.[a-zA-Z0-9_.-]+)['"]/g)].map((match) => match[1]),
  ]);
  const unresolved = [...references].filter((key) => (
    !key.endsWith('.') && !keys.has(key) && !(keys.has(`${key}.one`) && keys.has(`${key}.other`))
  ));
  assert.deepEqual(unresolved, []);
});

test('every supported catalog is complete and preserves interpolation variables', () => {
  const variables = (value) => [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort();
  for (const key of catalogKeys()) {
    const expected = variables(translateMessage('en', key));
    for (const locale of SUPPORTED_LOCALES) {
      const message = translateMessage(locale, key);
      assert.ok(message && message !== 'undefined', `${locale}: ${key}`);
      assert.deepEqual(variables(message), expected, `${locale}: ${key}`);
    }
  }
});

// ko is no longer a built-in catalog (SUPPORTED_LOCALES), so its full-coverage
// guarantee now lives here as a data test on examples/locales/ko.json, the
// worked example, instead of the module-load assertion i18n.mjs used to run
// over a hard-coded third tuple slot.
test('the checked-in Korean example catalog is complete and preserves interpolation variables for every canonical key', () => {
  const report = validateTranslations(KO_TRANSLATIONS);
  assert.equal(report.missingKeys.length, 0, `missing: ${report.missingKeys.join(', ')}`);
  assert.equal(report.unknownKeys.length, 0, `unknown: ${report.unknownKeys.join(', ')}`);
  assert.equal(report.placeholderMismatches.length, 0, JSON.stringify(report.placeholderMismatches));
  assert.equal(report.coveredKeys, report.totalKeys);
});

// Additional checked-in example catalogs demonstrating the same data
// contract across a wider language set (representative real-diagram checks
// requested in tt-a1i's review on #457): each is a complete, full-coverage
// example a caller could supply via meta.translations, none of them built
// into the renderer.
for (const locale of ['fr', 'pt', 'ja', 'de', 'it', 'ru']) {
  test(`the checked-in ${locale} example catalog is complete and preserves interpolation variables for every canonical key`, () => {
    const translations = JSON.parse(fs.readFileSync(path.join(skillRoot, `examples/locales/${locale}.json`), 'utf8'));
    const report = validateTranslations(translations);
    assert.equal(report.missingKeys.length, 0, `missing: ${report.missingKeys.join(', ')}`);
    assert.equal(report.unknownKeys.length, 0, `unknown: ${report.unknownKeys.join(', ')}`);
    assert.equal(report.placeholderMismatches.length, 0, JSON.stringify(report.placeholderMismatches));
    assert.equal(report.coveredKeys, report.totalKeys);
  });

  test(`${locale} localizes renderer-owned output via meta.translations without leaving any renderer-owned English badge or preset name behind`, () => {
    const translations = JSON.parse(fs.readFileSync(path.join(skillRoot, `examples/locales/${locale}.json`), 'utf8'));
    const document = example('architecture');
    document.meta.locale = locale;
    document.meta.translations = translations;
    delete document.meta.subtitle;

    const result = run('architecture', document);
    assert.equal(result.status, 0, `${locale}: ${result.stderr || result.stdout}`);
    assert.match(result.html, new RegExp(`^<!DOCTYPE html>\\n<html lang="${locale}"`));
    assert.match(result.html, new RegExp(`"locale":"${locale}"`));
    assert.doesNotMatch(result.html, /\{\{i18n:/);
    assert.doesNotMatch(result.stderr, /has no built-in catalog/, `${locale}: unexpectedly fell back to English`);

    // Check the actual embedded runtime catalog, not raw HTML/CSS source
    // (which can contain incidental English substrings, e.g. template
    // section comments, that are never shown to a reader). These
    // ALL-CAPS badges/short labels must be translated, not silently left
    // in English — see the fr/de/it/ja fix for the bug where several
    // catalogs kept them as English badges by mistake.
    const embedded = result.html.match(/<script id="archify-i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(embedded, `${locale}: missing embedded i18n data script`);
    const messages = JSON.parse(embedded[1]).messages;
    const englishBadges = {
      'viewer.preset.badge.signalFlow': 'SIGNAL FLOW',
      'viewer.nav.radar.short': 'MAP',
      'viewer.nav.level.map': 'MAP',
      'viewer.nav.lens.short': 'LENS',
      'viewer.nav.route.short': 'PATH',
      'viewer.nav.read': 'READ',
      'viewer.nav.level.read': 'READ',
      'viewer.nav.level.full': 'FULL',
    };
    for (const [key, enValue] of Object.entries(englishBadges)) {
      assert.notEqual(messages[key], enValue, `${locale}: ${key} left untranslated as "${enValue}"`);
    }
  });
}

test('runtime labels stay localized after composition', () => {
  assert.equal(translateMessage('zh-CN', 'viewer.kind.backend'), '后端');
  assert.equal(translateMessage('zh-CN', 'viewer.kind.decision'), '决策');
  assert.equal(translateMessage('zh-CN', 'viewer.passport.relationship.connectsFrom'), '连接自');
  assert.equal(translateMessage('zh-CN', 'viewer.nav.level.auto'), '自动');

  const zhHops = translateCount('zh-CN', 'viewer.route.hop', 2);
  assert.equal(
    translateMessage('zh-CN', 'viewer.finder.result.routeTarget', { label: '终点', links: zhHops }),
    '选择终点作为路径终点，2 跳',
  );
  const enHop = translateCount('en', 'viewer.route.overview.hop', 1);
  const enNode = translateCount('en', 'viewer.route.overview.node', 2);
  assert.equal(
    translateMessage('en', 'viewer.route.overview.status', { nodes: enNode, hops: enHop }),
    '2 nodes · 1 directed hop · shortest authored route',
  );

  assert.equal(translateMessage('ko', 'viewer.kind.backend'), '백엔드');
  assert.equal(translateMessage('ko', 'viewer.kind.decision'), '판단');
  assert.equal(translateMessage('ko', 'viewer.passport.relationship.connectsFrom'), '연결 출처');
  assert.equal(translateMessage('ko', 'viewer.nav.level.auto'), '자동');
  const koHops = translateCount('ko', 'viewer.route.hop', 2);
  assert.equal(
    translateMessage('ko', 'viewer.finder.result.routeTarget', { label: '도착', links: koHops }),
    '도착을(를) 경로 도착점으로 선택, 홉 2개',
  );
});

test('Share Card and export failures use catalog messages instead of fixed English', () => {
  assert.equal(
    translateCount('zh-CN', 'viewer.export.card.routeSummary', 2, { source: '来源', target: '目标' }),
    '路径：来源 → 目标 · 2 个有向跳转',
  );
  assert.equal(
    translateMessage('zh-CN', 'viewer.export.error.toBlobNull', { label: '分享卡片' }),
    '分享卡片的 canvas.toBlob 未返回数据',
  );
  assert.equal(
    translateCount('ko', 'viewer.export.card.routeSummary', 2, { source: '출발', target: '도착' }),
    '경로: 출발 → 도착 · 방향성 홉 2개',
  );
  assert.equal(
    translateMessage('ko', 'viewer.export.error.toBlobNull', { label: '공유 카드' }),
    '공유 카드의 canvas.toBlob이 데이터를 반환하지 않았습니다',
  );

  const template = fs.readFileSync(templatePath, 'utf8');
  for (const hardcoded of [
    "'Route: '",
    "'Share Card variants cannot be combined'",
    "canvas2dOrThrow(canvas, 'Share Card')",
    "'Share Card export could not remove temporary viewer state'",
    "'WebM motion export requires a trace animation and browser MediaRecorder support'",
  ]) {
    assert.ok(!template.includes(hardcoded), hardcoded);
  }
});
