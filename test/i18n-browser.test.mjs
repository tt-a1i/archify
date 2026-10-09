import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome, runVisualCheck } from '../archify/bin/visual-check.mjs';
import {
  skillRoot, cli, EXAMPLES, example, localeDocument, FR_PARTIAL_TRANSLATIONS, createLocaleFixture,
} from './helpers/i18n-fixture.mjs';

const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const { tmp, run, deliverKoreanFixture, deliverJapaneseFixture, cliJson } = createLocaleFixture();

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

test('a passing finalize keeps locale warnings in its receipt', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run finalize with its browser gate.',
}, () => {
  const input = path.join(tmp, 'finalize-fr.json');
  fs.writeFileSync(input, JSON.stringify(localeDocument('architecture', { locale: 'fr', translations: FR_PARTIAL_TRANSLATIONS })));
  const summary = cliJson(['finalize', 'architecture', input, path.join(tmp, 'finalize-fr.html'), '--quality', 'showcase', '--json']);
  assert.equal(summary.ok, true);
  assert.equal(summary.status, 'pass');
  assert.deepEqual(summary.diagnostics.map((entry) => entry.code), ['i18n/translation-coverage']);
  const full = JSON.parse(fs.readFileSync(summary.evidence.receipt, 'utf8'));
  assert.deepEqual(full.diagnostics.map((entry) => entry.code), ['i18n/translation-coverage']);
});

const BROWSER_LOCALES = {
  'zh-CN': {
    title: (type) => `浏览器本地化-${type}`,
    toolbarLabel: '图表视图控制',
    finder: { hidden: false, title: '查找节点', searchLabel: '搜索图表节点' },
    route: { hidden: false, title: '点击路径的起点', label: '清除已追踪路径' },
    exportLabel: '导出图表',
    exportMenuLabel: '导出',
    exportMenuText: /复制图表/,
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
    route: { hidden: false, title: 'Haz clic donde empieza la ruta', label: 'Borrar la ruta trazada' },
    exportLabel: 'Exportar diagrama',
    exportMenuLabel: 'Exportar',
    exportMenuText: /Copiar diagrama/,
    presetBadges: {
      'signal-flow': { header: 'FLUJO DE SEÑAL', plate: 'none' },
      blueprint: { header: 'PLANO / REV 01', plate: '' },
      editorial: { header: 'EDITORIAL / NOTA DE CAMPO', plate: 'ARCHIFY / LÁMINA 04' },
    },
    shareCardFailure: 'Contexto de lienzo 2D no disponible para Tarjeta para compartir',
  },
  ko: {
    title: (type) => `브라우저 로케일-${type}`,
    toolbarLabel: '다이어그램 보기 제어',
    finder: { hidden: false, title: '노드 찾기', searchLabel: '다이어그램 노드 검색' },
    route: { hidden: false, title: '시작 노드 선택', label: '추적된 경로 지우기' },
    exportLabel: '다이어그램 내보내기',
    exportMenuLabel: '내보내기',
    exportMenuText: /다이어그램 복사/,
    presetBadges: {
      'signal-flow': { header: '시그널 플로우', plate: 'none' },
      blueprint: { header: '블루프린트 / 개정 01', plate: '' },
      editorial: { header: '에디토리얼 / 현장 노트', plate: 'ARCHIFY / 도판 04' },
    },
    shareCardFailure: '공유 카드에 2D 캔버스 컨텍스트를 만들 수 없습니다',
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
        var edge = document.querySelector('.diagram-container svg [data-edge-from][data-edge-to]');
        Archify.routeProbe.begin({ source: edge.getAttribute('data-edge-from'), focusNode: false });
        Archify.routeProbe.choose(edge.getAttribute('data-edge-to'), { updateUrl: false });
        await Archify.exportMenu.shareCard({ variant: 'route' });
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

    // Keep every locale/type's real viewport, theme, font and capture checks.
    // The delivered fixtures above retain the public visual-check CLI receipt
    // contract; this matrix calls the same checker without another CLI process.
    // Its default factory still creates a fresh Chrome profile for each artifact.
    const visual = await runVisualCheck({ artifactPath: result.output, chromePath });
    assert.ok([0, 1].includes(visual.exitCode), `${locale}/${type}: ${JSON.stringify(visual.receipt)}`);
    const receipt = visual.receipt;
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

test('real Chrome keeps ko Finder, Route, Export, and accessibility UI localized in all five modes', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser localization regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    await assertLocalizedViewer(browser, 'ko', BROWSER_LOCALES.ko);
  } finally {
    await browser.close();
  }
});
