import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  viewerCatalog,
} from '../renderers/shared/i18n.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const templatePath = path.join(skillRoot, 'assets/template.html');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-i18n-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
let sequence = 0;

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
  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'zh-CN', 'ja']);
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

test('ja localizes renderer-owned output across all five modes without translating authored content', () => {
  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    const authoredTitle = document.meta.title;
    document.meta.locale = 'ja';
    delete document.meta.subtitle;

    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);
    assert.match(result.html, /^<!DOCTYPE html>\n<html lang="ja"/);
    assert.match(result.html, /<svg\b[^>]*\blang="ja"/);
    assert.ok(result.html.includes(`<title>${authoredTitle}</title>`), `${type}: authored title changed`);
    assert.ok(result.html.includes(`<h1>${authoredTitle}</h1>`), `${type}: authored heading changed`);
    assert.match(result.html, /<text\b[^>]*>\u51e1\u4f8b<\/text>/);
    assert.match(result.html, /aria-label="[^"]*\u306b\u30d5\u30a9\u30fc\u30ab\u30b9/);
    assert.match(result.html, new RegExp('<desc id="archify-diagram-description">Archify \u3067\u751f\u6210\u3055\u308c\u305f'));
    assert.match(result.html, /"locale":"ja"/);
    assert.match(result.html, />\u56f3\u3092\u30a8\u30af\u30b9\u30dd\u30fc\u30c8</);
    assert.doesNotMatch(result.html, /\{\{i18n:/);
  }
});

test('ja artifacts embed the Japanese Viewer catalog scoped to viewer keys', () => {
  const catalog = viewerCatalog('ja');
  assert.equal(catalog['viewer.nav.controls'], '\u56f3\u306e\u8868\u793a\u64cd\u4f5c');
  assert.equal(catalog['viewer.finder.title'], '\u30ce\u30fc\u30c9\u3092\u63a2\u3059');
  assert.equal(catalog['viewer.route.start'], '\u8d77\u70b9\u30ce\u30fc\u30c9\u3092\u9078\u629e');
  assert.equal(catalog['viewer.export.diagram'], '\u56f3\u3092\u30a8\u30af\u30b9\u30dd\u30fc\u30c8');
  assert.equal(catalog['viewer.lens.kinds'], '\u30bb\u30de\u30f3\u30c6\u30a3\u30c3\u30af\u7a2e\u5225');
  assert.equal(catalog['viewer.radar.title'], '\u30bb\u30de\u30f3\u30c6\u30a3\u30c3\u30af\u30ec\u30fc\u30c0\u30fc');
  assert.equal(catalog['viewer.preset.badge.editorialPlate'], 'ARCHIFY / \u56f3\u7248 04');
  assert.equal(catalog['viewer.motion.live'], '\u30e9\u30a4\u30d6');
  assert.equal(catalog['viewer.motion.still'], '\u9759\u6b62');
  assert.ok(!Object.hasOwn(catalog, 'legend.title'), 'viewer catalog must stay scoped to viewer.* keys');
});

// The Viewer repeats each CJK stack in several places (inline CSS plus the SVG
// export prelude). Asserting only that a Japanese face appears somewhere would
// stay green when one call site drifts, so every occurrence of the Simplified
// Chinese stack must be gone from ja output rather than merely outnumbered.
const MONO_STACK = "'Liberation Mono', 'Noto Sans Mono CJK SC'";
const SERIF_STACK = "'Times New Roman', 'Songti SC'";
const JA_MONO_STACK = "'Liberation Mono', 'Noto Sans Mono CJK JP', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans Mono CJK SC'";
const JA_SERIF_STACK = "'Times New Roman', 'Hiragino Mincho ProN', 'Yu Mincho', 'Songti SC'";

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('ja puts Japanese faces ahead of every Simplified Chinese CJK stack while other locales keep the template stacks', () => {
  const jaFonts = ["'Noto Sans Mono CJK JP'", "'Hiragino Kaku Gothic ProN'", "'Yu Gothic'", "'Hiragino Mincho ProN'", "'Yu Mincho'"];
  const scFonts = ["'Noto Sans Mono CJK SC'", "'PingFang SC'", "'Songti SC'"];
  for (const locale of ['en', 'zh-CN', 'ja']) {
    const document = example('architecture');
    document.meta.locale = locale;
    const result = run('architecture', document);
    assert.equal(result.status, 0, `${locale}: ${result.stderr || result.stdout}`);
    for (const font of scFonts) {
      assert.ok(result.html.includes(font), `${locale}: dropped Simplified Chinese fallback ${font}`);
    }
    for (const font of jaFonts) {
      assert.equal(
        result.html.includes(font),
        locale === 'ja',
        `${locale}: Japanese fallback ${font} presence is wrong`,
      );
    }

    const monoStacks = countOccurrences(result.html, MONO_STACK);
    const serifStacks = countOccurrences(result.html, SERIF_STACK);
    if (locale === 'ja') {
      assert.equal(monoStacks, 0, 'ja left a monospace stack without Japanese faces');
      assert.equal(serifStacks, 0, 'ja left a serif stack without Japanese faces');
      assert.ok(countOccurrences(result.html, JA_MONO_STACK) > 0, 'ja monospace stack is missing');
      assert.ok(countOccurrences(result.html, JA_SERIF_STACK) > 0, 'ja serif stack is missing');
    } else {
      assert.ok(monoStacks > 0, `${locale}: monospace stack was rewritten`);
      assert.ok(serifStacks > 0, `${locale}: serif stack was rewritten`);
    }
  }
});

// A legend that needs a second row is not reported: the renderers pass
// unfit: 'hide' whenever meta.legend is absent, so an over-long label makes the
// whole legend disappear from otherwise valid output. Japanese labels were
// sized against these viewBoxes, and only a rendered artifact proves the fit.
// gutter mirrors each renderer's legend band: workflow lays its legend out at
// x: 20 with width viewBox[0] - 40, every other mode at x: 40 with
// viewBox[0] - 80. Using one shared constant would silently overstate the
// workflow margin by 40px.
const LEGEND_BANDS = {
  architecture: { entries: 6, gutter: 80 },
  workflow: { entries: 7, gutter: 40 },
  sequence: { entries: 5, gutter: 80 },
  dataflow: { entries: 5, gutter: 80 },
  lifecycle: { entries: 6, gutter: 80 },
};

test('ja legends stay on a single row in all five modes instead of silently disappearing', () => {
  for (const [type, band] of Object.entries(LEGEND_BANDS)) {
    const document = example(type);
    document.meta.locale = 'ja';
    const result = run(type, document);
    assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);

    const baselines = new Set([...result.html.matchAll(/data-legend-baseline="([-\d.]+)"/g)].map((match) => match[1]));
    const widths = [...result.html.matchAll(/data-legend-width="(\d+)"/g)].map((match) => Number(match[1]));
    assert.equal(widths.length, band.entries, `${type}: ja legend entries vanished or changed count`);
    assert.equal(baselines.size, 1, `${type}: ja legend wrapped onto ${baselines.size} rows`);

    const viewBoxWidth = Number(result.html.match(/<svg viewBox="0 0 (\d+(?:\.\d+)?) /)[1]);
    const available = viewBoxWidth - band.gutter;
    const widest = Math.max(...widths);
    assert.ok(widest <= available, `${type}: ja legend entry needs ${widest}px of ${available}px`);
  }
});

test('ja and zh-CN counts reuse one identical form for both plural branches', () => {
  const bases = catalogKeys().filter((key) => key.endsWith('.one')).map((key) => key.slice(0, -'.one'.length));
  assert.ok(bases.length >= 27, `expected the full plural inventory, found ${bases.length}`);
  for (const base of bases) {
    for (const locale of ['ja', 'zh-CN']) {
      assert.equal(
        translateMessage(locale, `${base}.one`),
        translateMessage(locale, `${base}.other`),
        `${base}: ${locale} has no plural distinction`,
      );
    }
  }
  assert.equal(translateCount('ja', 'viewer.route.hop', 1), '1 \u30db\u30c3\u30d7');
  assert.equal(translateCount('ja', 'viewer.route.hop', 4), '4 \u30db\u30c3\u30d7');
  const jaHops = translateCount('ja', 'viewer.route.hop', 3);
  assert.equal(
    translateMessage('ja', 'viewer.finder.result.routeTarget', { label: '\u7d42\u70b9', links: jaHops }),
    '\u7d42\u70b9\u3092\u7d4c\u8def\u306e\u7d42\u70b9\u306b\u9078\u629e\u30013 \u30db\u30c3\u30d7',
  );
});

test('explicit en and zh-CN preserve complete authored field inventories across all five modes', () => {
  for (const type of Object.keys(EXAMPLES)) {
    const english = authoredExample(type, 'en');
    const chinese = authoredExample(type, 'zh-CN');
    assert.equal(english.authored.length, chinese.authored.length, `${type}: authored shapes differ`);
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

    for (const candidate of [english, chinese]) {
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

test('unsupported locale values fail schema validation in every mode', () => {
  for (const locale of ['fr', 'zh-HK', 'ja-JP']) {
    for (const type of Object.keys(EXAMPLES)) {
      const document = example(type);
      document.meta.locale = locale;
      const result = run(type, document, 'validate');
      assert.notEqual(result.status, 0, `${type}: unsupported locale ${locale} unexpectedly passed`);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.ok, false);
      assert.ok(payload.diagnostics.some((entry) => entry.subject?.path === '/meta/locale'), `${type}: ${locale}`);
    }
  }
});

// One probe and one expectation table drive every locale. Keeping the browser
// assertions in a single parameterized test stops a locale from quietly
// covering less ground than its sibling, which is how the preset badge and
// visualReview checks went missing from the Japanese pass.
const BROWSER_PROBE = `(function () {
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
      })()`;

const SHARE_CARD_PROBE = `(async function () {
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
      })()`;

const BROWSER_LOCALES = {
  'zh-CN': {
    titlePrefix: '浏览器本地化',
    toolbarLabel: '图表视图控制',
    finder: { hidden: false, title: '查找节点', searchLabel: '搜索图表节点' },
    route: { hidden: false, title: '选择起点节点', label: '清除已追踪路径' },
    exportLabel: '导出图表',
    exportMenuLabel: '导出',
    exportMenuText: /分享卡片/,
    presetBadges: {
      'signal-flow': { header: '信号流', plate: 'none' },
      blueprint: { header: '蓝图 / 修订 01', plate: '' },
      editorial: { header: '编辑风格 / 现场笔记', plate: 'ARCHIFY / 图版 04' },
    },
    shareCardMessage: '无法为分享卡片创建二维画布上下文',
  },
  ja: {
    titlePrefix: 'ブラウザ地域化',
    toolbarLabel: '図の表示操作',
    finder: { hidden: false, title: 'ノードを探す', searchLabel: '図のノードを検索' },
    route: { hidden: false, title: '起点ノードを選択', label: 'トレースした経路をクリア' },
    exportLabel: '図をエクスポート',
    exportMenuLabel: 'エクスポート',
    exportMenuText: /共有カード/,
    presetBadges: {
      'signal-flow': { header: 'シグナルフロー', plate: 'none' },
      blueprint: { header: 'ブループリント / REV 01', plate: '' },
      editorial: { header: 'エディトリアル / フィールドノート', plate: 'ARCHIFY / 図版 04' },
    },
    shareCardMessage: '共有カードの 2D キャンバスコンテキストを作成できません',
  },
};

// Font resolution is deliberately not asserted: CI runners carry no Japanese
// faces, so probing the resolved family would fail for reasons unrelated to
// localization. Catalog copy and layout are environment neutral.
for (const [locale, expected] of Object.entries(BROWSER_LOCALES)) {
  test(`real Chrome keeps ${locale} Finder, Route, Export, preset badges, and accessibility UI localized in all five modes`, {
    skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser localization regression.',
  }, async () => {
    const browser = new ChromeVisualBrowser(chromePath);
    try {
      for (const type of Object.keys(EXAMPLES)) {
        const document = example(type);
        document.meta.locale = locale;
        document.meta.title = `${expected.titlePrefix}-${type}`;
        const result = run(type, document);
        assert.equal(result.status, 0, `${type}: ${result.stderr || result.stdout}`);

        const sessionId = await loadArtifact(browser, result.output);
        const state = await evaluate(browser, sessionId, BROWSER_PROBE);

        assert.equal(state.htmlLang, locale, type);
        assert.equal(state.svgLang, locale, type);
        assert.equal(state.toolbarLabel, expected.toolbarLabel, type);
        assert.deepEqual(state.finder, expected.finder, type);
        assert.deepEqual(state.route, expected.route, type);
        assert.equal(state.exportMenuOpen, true, type);
        assert.equal(state.exportLabel, expected.exportLabel, type);
        assert.equal(state.exportMenuLabel, expected.exportMenuLabel, type);
        assert.match(state.exportMenuText, expected.exportMenuText, type);
        assert.deepEqual(state.presetBadges, expected.presetBadges, type);

        const shareCardFailure = await evaluate(browser, sessionId, SHARE_CARD_PROBE, true);
        assert.deepEqual(shareCardFailure, {
          rejected: true,
          message: expected.shareCardMessage,
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
}

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

// The tuple check proves every catalog key is translated, but says nothing
// about keys the schemas imply. Deriving the expected keys from the enums keeps
// a newly authored component or state type from shipping with no localized
// name in any locale.
test('every semantic kind the schemas accept has catalog keys', () => {
  const readSchema = (name) => JSON.parse(fs.readFileSync(path.join(skillRoot, 'schemas', `${name}.schema.json`), 'utf8'));
  const componentTypes = readSchema('common').$defs.componentType.enum;
  const lifecycleStates = readSchema('lifecycle').properties.states.items.properties.type.enum;
  assert.ok(componentTypes.length >= 7, 'componentType enum was not found');
  assert.ok(lifecycleStates.length >= 8, 'lifecycle state type enum was not found');

  const keys = new Set(catalogKeys());
  const missing = [];
  const expectKey = (key) => { if (!keys.has(key)) missing.push(key); };
  for (const kind of new Set([...componentTypes, ...lifecycleStates])) expectKey(`viewer.kind.${kind}`);
  for (const kind of componentTypes) {
    expectKey(`legend.architecture.${kind}`);
    expectKey(`legend.workflow.${kind}`);
  }
  for (const kind of lifecycleStates) expectKey(`legend.lifecycle.${kind}`);
  assert.deepEqual(missing, [], 'schema enum values without catalog keys');
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
