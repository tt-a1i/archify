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
    assert.match(result.html, /aria-label="Enfocar/);
    assert.match(result.html, /<desc id="archify-diagram-description">Un diagrama de /);
    assert.match(result.html, /"locale":"es"/);
    assert.match(result.html, />Exportar diagrama</);
    assert.doesNotMatch(result.html, /\{\{i18n:/);
  }
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
  for (const locale of ['fr', 'zh-HK']) {
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

// One fixture + one runner drive every real-Chrome locale regression so a new
// locale only adds an expectations record, never a parallel copy of the probe.
const BROWSER_LOCALES = {
  'zh-CN': {
    title: (type) => `浏览器本地化-${type}`,
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
    shareCardFailure: '无法为分享卡片创建二维画布上下文',
  },
  es: {
    title: (type) => `Localización del navegador-${type}`,
    toolbarLabel: 'Controles de vista del diagrama',
    finder: { hidden: false, title: 'Buscar un nodo', searchLabel: 'Buscar nodos del diagrama' },
    route: { hidden: false, title: 'Elegir un nodo de inicio', label: 'Borrar la ruta trazada' },
    exportLabel: 'Exportar diagrama',
    exportMenuLabel: 'Exportar',
    exportMenuText: /Tarjeta para compartir/,
    presetBadges: {
      'signal-flow': { header: 'FLUJO DE SEÑAL', plate: 'none' },
      blueprint: { header: 'PLANO / REV 01', plate: '' },
      editorial: { header: 'EDITORIAL / NOTA DE CAMPO', plate: 'ARCHIFY / LÁMINA 04' },
    },
    shareCardFailure: 'Contexto de lienzo 2D no disponible para Tarjeta para compartir',
  },
};

async function assertLocalizedViewer(browser, locale, expected) {
  for (const type of Object.keys(EXAMPLES)) {
    const document = example(type);
    document.meta.locale = locale;
    const authoredTitle = expected.title(type);
    document.meta.title = authoredTitle;
    const result = run(type, document);
    assert.equal(result.status, 0, `${locale}/${type}: ${result.stderr || result.stdout}`);

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
        heading: (document.querySelector('h1') || {}).textContent,
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

    assert.equal(state.htmlLang, locale, `${locale}/${type}`);
    assert.equal(state.svgLang, locale, `${locale}/${type}`);
    // Authored copy stays verbatim while the surrounding chrome localizes.
    assert.equal(state.heading, authoredTitle, `${locale}/${type}: authored heading changed`);
    assert.equal(state.toolbarLabel, expected.toolbarLabel, `${locale}/${type}`);
    assert.deepEqual(state.finder, expected.finder, `${locale}/${type}`);
    assert.deepEqual(state.route, expected.route, `${locale}/${type}`);
    assert.equal(state.exportMenuOpen, true, `${locale}/${type}`);
    assert.equal(state.exportLabel, expected.exportLabel, `${locale}/${type}`);
    assert.equal(state.exportMenuLabel, expected.exportMenuLabel, `${locale}/${type}`);
    assert.match(state.exportMenuText, expected.exportMenuText, `${locale}/${type}`);
    assert.deepEqual(state.presetBadges, expected.presetBadges, `${locale}/${type}`);

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
      message: expected.shareCardFailure,
    }, `${locale}/${type}`);

    // Representative visual pass: longer localized labels must not overflow.
    const visual = spawnSync(process.execPath, [cli, 'visual-check', result.output, '--json'], {
      cwd: skillRoot,
      encoding: 'utf8',
      env: { ...process.env, ARCHIFY_CHROME: chromePath },
    });
    assert.ok([0, 1].includes(visual.status), `${locale}/${type}: ${visual.stderr || visual.stdout}`);
    const receipt = JSON.parse(visual.stdout);
    assert.equal(receipt.visualReview, 'pending', `${locale}/${type}`);
    assert.equal(receipt.chrome.status, 'available', `${locale}/${type}`);
    assert.equal(receipt.readability.status, 'pass', `${locale}/${type}`);
    assert.equal(receipt.viewerChrome.status, 'pass', `${locale}/${type}`);
    assert.equal(receipt.captures.status, 'pass', `${locale}/${type}`);
    assert.equal(
      receipt.containment.viewports.every((viewport) => viewport.overflowX === false),
      true,
      `${locale}/${type}: localized Viewer introduced horizontal overflow`,
    );
  }
}

test('real Chrome keeps zh-CN Finder, Route, Export, and accessibility UI localized in all five modes', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser localization regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    await assertLocalizedViewer(browser, 'zh-CN', BROWSER_LOCALES['zh-CN']);
  } finally {
    await browser.close();
  }
});

test('real Chrome keeps es Finder, Route, Export, and accessibility UI localized in all five modes', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser localization regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    await assertLocalizedViewer(browser, 'es', BROWSER_LOCALES.es);
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
