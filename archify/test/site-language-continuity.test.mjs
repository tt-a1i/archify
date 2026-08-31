import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { DIAGRAM_TYPES, DIAGRAM_TYPE_LABELS } from '../../scripts/site-copy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const runtimePath = path.join(repoRoot, 'docs/assets/site-language.js');
const navigationPath = path.join(repoRoot, 'docs/assets/site-navigation.css');
const integrationEnabled = process.env.ARCHIFY_SITE_INTEGRATION === '1';
const chromePath = integrationEnabled && process.env.ARCHIFY_CHROME ? findChrome() : null;

function loadRuntime({
  url = 'https://example.test/',
  values = new Map(),
  storageError = false,
  historyError = false,
  source = runtimePath,
} = {}) {
  const localStorage = {
    getItem(key) {
      if (storageError) throw new Error('storage unavailable');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (storageError) throw new Error('storage unavailable');
      values.set(key, String(value));
    },
  };
  let currentUrl = new URL(url);
  const location = {};
  function syncLocation() {
    location.href = currentUrl.href;
    location.search = currentUrl.search;
    location.pathname = currentUrl.pathname;
    location.hash = currentUrl.hash;
  }
  syncLocation();
  const window = {
    location,
    history: {
      replaceState(_state, _title, next) {
        if (historyError) throw new Error('history unavailable');
        currentUrl = new URL(next, currentUrl);
        syncLocation();
      },
    },
    localStorage,
  };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), { window, URL, URLSearchParams });
  return { language: window.ArchifySiteLanguage, values, url: () => new URL(currentUrl) };
}

async function evaluate(browser, sessionId, expression) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

async function navigate(browser, sessionId, url) {
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', { url }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
}

async function clickAndNavigate(browser, sessionId, selector) {
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  await evaluate(browser, sessionId, `(function () {
    var link = document.querySelector(${JSON.stringify(selector)});
    if (!link) throw new Error('Missing navigation link: ' + ${JSON.stringify(selector)});
    link.click();
  })()`);
  await loaded;
}

function startStaticServer(root) {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
    const requestedPath = path.resolve(root, relative);
    if (!requestedPath.startsWith(`${path.resolve(root)}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      const body = fs.readFileSync(requestedPath);
      const contentType = requestedPath.endsWith('.css') ? 'text/css'
        : requestedPath.endsWith('.js') ? 'text/javascript'
          : requestedPath.endsWith('.json') ? 'application/json'
            : 'text/html';
      response.writeHead(200, { 'content-type': `${contentType}; charset=utf-8` });
      response.end(body);
    } catch (_) {
      response.writeHead(404).end('Not found');
    }
  });
  return server;
}

test('site language runtime normalizes one entry parameter into one durable preference', () => {
  const canonical = loadRuntime({ values: new Map([['archify-lang', 'zh']]) });
  assert.equal(canonical.language.read(), 'zh');

  for (const legacyKey of ['archify-gallery-language', 'archify-guide-language']) {
    const legacy = loadRuntime({ values: new Map([[legacyKey, 'zh']]) });
    assert.equal(legacy.language.read(), 'zh', `${legacyKey} must remain readable during migration`);
    assert.equal(legacy.values.get('archify-lang'), 'zh', `${legacyKey} must migrate to the canonical key`);
  }

  const canonicalWins = loadRuntime({
    values: new Map([
      ['archify-lang', 'en'],
      ['archify-gallery-language', 'zh'],
      ['archify-guide-language', 'zh'],
    ]),
  });
  assert.equal(canonicalWins.language.read(), 'en');

  const secondLegacyFallback = loadRuntime({
    values: new Map([
      ['archify-gallery-language', 'fr'],
      ['archify-guide-language', 'zh'],
    ]),
  });
  assert.equal(secondLegacyFallback.language.read(), 'zh');
  assert.equal(secondLegacyFallback.values.get('archify-lang'), 'zh');

  const conflictingLegacy = loadRuntime({
    values: new Map([
      ['archify-gallery-language', 'zh'],
      ['archify-guide-language', 'en'],
    ]),
  });
  assert.equal(conflictingLegacy.language.read(), 'zh');
  assert.equal(conflictingLegacy.values.get('archify-lang'), 'zh');
  conflictingLegacy.values.set('archify-gallery-language', 'en');
  const migrated = loadRuntime({ values: conflictingLegacy.values });
  assert.equal(migrated.language.read(), 'zh', 'the canonical migration must win on later page loads');

  const explicit = loadRuntime({
    url: 'https://example.test/guide.html?lang=en&type=workflow#chooser',
    values: new Map([['archify-lang', 'zh']]),
  });
  assert.equal(explicit.language.read(), 'en');
  assert.equal(explicit.values.get('archify-lang'), 'en');
  assert.equal(explicit.url().searchParams.has('lang'), false);
  assert.equal(explicit.url().searchParams.get('type'), 'workflow');
  assert.equal(explicit.url().hash, '#chooser');

  const historyBlocked = loadRuntime({
    url: 'https://example.test/guide.html?lang=zh&type=workflow#chooser',
    values: new Map([['archify-lang', 'en']]),
    historyError: true,
  });
  assert.equal(historyBlocked.language.read(), 'zh');
  assert.equal(historyBlocked.values.get('archify-lang'), 'zh');
  assert.equal(historyBlocked.url().searchParams.get('lang'), 'zh');

  assert.equal(explicit.language.write('zh'), 'zh');
  const refreshed = loadRuntime({ url: explicit.url().href, values: explicit.values });
  assert.equal(refreshed.language.read(), 'zh');

  const unsupported = loadRuntime({
    url: 'https://example.test/?lang=fr',
    values: new Map([['archify-lang', 'zh']]),
  });
  assert.equal(unsupported.language.read(), 'zh');
  assert.equal(unsupported.url().searchParams.has('lang'), false);

  const defaultLanguage = loadRuntime();
  assert.equal(defaultLanguage.language.read(), 'en');

  const blocked = loadRuntime({ storageError: true });
  assert.equal(blocked.language.read(), 'en');
  assert.equal(blocked.language.write('zh'), 'zh');

  const source = fs.readFileSync(runtimePath, 'utf8');
  assert.match(source, /archify-gallery-language/);
  assert.match(source, /archify-guide-language/);
  assert.doesNotMatch(source, /navigator\.language|detectBrowserLanguage|select\s*:/);
});

test('custom site builders emit every shared site asset and preserve entry, navigation, selection, and refresh state', {
  skip: integrationEnabled ? false : 'Run through the serialized site integration gate.',
}, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-site-language-'));
  try {
    const builds = [
      { script: 'build-start.mjs', args: [path.join(tmp, 'start-site/start.html')], root: 'start-site' },
      { script: 'build-guide.mjs', args: [path.join(tmp, 'guide-site/guide.html')], root: 'guide-site' },
      { script: 'build-gallery.mjs', args: [path.join(tmp, 'gallery-site')], root: 'gallery-site' },
    ];

    for (const build of builds) {
      execFileSync(process.execPath, [path.join(repoRoot, 'scripts', build.script), ...build.args]);
      for (const asset of ['site-language.js', 'site-navigation.css']) {
        const emitted = path.join(tmp, build.root, 'assets', asset);
        const canonicalAsset = path.join(repoRoot, 'docs/assets', asset);
        assert.ok(fs.existsSync(emitted), `${build.script}: ${asset} missing from custom output`);
        assert.equal(fs.readFileSync(emitted, 'utf8'), fs.readFileSync(canonicalAsset, 'utf8'));
      }
    }

    const emittedRuntime = path.join(tmp, 'start-site/assets/site-language.js');
    const values = new Map();

    const landing = loadRuntime({
      url: 'https://example.test/?lang=zh&utm_source=readme#proof',
      values,
      source: emittedRuntime,
    });
    assert.equal(landing.language.read(), 'zh');
    assert.equal(values.get('archify-lang'), 'zh');
    assert.equal(landing.url().searchParams.has('lang'), false);
    assert.equal(landing.url().searchParams.get('utm_source'), 'readme');
    assert.equal(landing.url().hash, '#proof');

    for (const page of ['gallery.html', 'guide.html', 'start.html']) {
      const navigation = loadRuntime({ url: `https://example.test/${page}`, values, source: emittedRuntime });
      assert.equal(navigation.language.read(), 'zh', page);
    }

    const explicitEnglish = loadRuntime({
      url: 'https://example.test/guide.html?lang=en#recipes',
      values,
      source: emittedRuntime,
    });
    assert.equal(explicitEnglish.language.read(), 'en');
    assert.equal(values.get('archify-lang'), 'en');
    assert.equal(explicitEnglish.url().searchParams.has('lang'), false);

    explicitEnglish.language.write('zh');
    assert.equal(explicitEnglish.url().searchParams.has('lang'), false);
    assert.equal(explicitEnglish.url().hash, '#recipes');

    const refreshed = loadRuntime({ url: explicitEnglish.url().href, values, source: emittedRuntime });
    assert.equal(refreshed.language.read(), 'zh');

    const nextPage = loadRuntime({ url: 'https://example.test/gallery.html', values, source: emittedRuntime });
    assert.equal(nextPage.language.read(), 'zh');

    nextPage.language.write('en');
    const refreshedEnglish = loadRuntime({ url: nextPage.url().href, values, source: emittedRuntime });
    assert.equal(refreshedEnglish.language.read(), 'en');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('all site pages consume one language runtime and one navigation contract', () => {
  const pages = [
    'docs/index.html',
    'scripts/gallery-template.html',
    'scripts/guide-template.html',
    'scripts/start-template.html',
    'docs/gallery.html',
    'docs/guide.html',
    'docs/start.html',
  ];

  for (const relative of pages) {
    const html = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    assert.match(html, /<script src="assets\/site-language\.js"><\/script>/, `${relative}: shared runtime missing`);
    assert.match(html, /<link rel="stylesheet" href="assets\/site-navigation\.css">/, `${relative}: shared navigation missing`);
    assert.match(html, /<nav class="site-nav" aria-label="Primary navigation">/, `${relative}: canonical navigation root missing`);
    assert.match(html, /ArchifySiteLanguage\.read\(/, `${relative}: shared language read missing`);
    assert.match(html, /ArchifySiteLanguage\.write\(/, `${relative}: shared language write missing`);
    assert.match(html, /href="guide\.html"/, `${relative}: Guide navigation missing`);
    assert.match(html, /href="gallery\.html"/, `${relative}: Proof Lab navigation missing`);
    assert.match(html, /href="start\.html"/, `${relative}: Start navigation missing`);
    assert.match(html, /class="btn btn-primary nav-cta"/, `${relative}: install action missing`);
    assert.doesNotMatch(html, /(?:^|\s)nav\s*\{/, `${relative}: inline navigation layout bypasses the shared contract`);
    assert.doesNotMatch(html, /\.nav-right\s*\{/, `${relative}: inline navigation actions bypass the shared contract`);
    assert.doesNotMatch(
      html,
      /localStorage\.setItem\(['"]archify-(?:lang|gallery-language|guide-language)['"]/,
      `${relative}: page bypasses the shared language writer`,
    );
  }

  const navigation = fs.readFileSync(navigationPath, 'utf8');
  assert.match(navigation, /\.site-nav\s*\{/);
  assert.match(navigation, /\.site-nav \.nav-right\s*\{/);
  assert.match(navigation, /@media \(max-width: 640px\)/);
});

test('site page identity paths localize with the selected language', () => {
  const pages = [
    { paths: ['scripts/guide-template.html', 'docs/guide.html'], en: '/ guide', zh: '/ 场景指南' },
    { paths: ['scripts/gallery-template.html', 'docs/gallery.html'], en: '/ proof lab', zh: '/ 验证作品集' },
    { paths: ['scripts/start-template.html', 'docs/start.html'], en: '/ start', zh: '/ 快速上手' },
  ];

  for (const page of pages) {
    for (const relative of page.paths) {
      const html = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
      assert.ok(
        html.includes(`<span class="nav-logo-path" data-en="${page.en}" data-zh="${page.zh}">${page.en}</span>`),
        `${relative}: page identity path must expose matching English and Chinese copy`,
      );
      assert.match(
        html,
        /querySelectorAll\('\[data-en\]\[data-zh\]'\)/,
        `${relative}: language changes must update bilingual page identity copy`,
      );
    }
  }
});

test('proof gallery type filters localize with the selected language', () => {
  const filters = DIAGRAM_TYPES.map((type) => ({
    type,
    en: DIAGRAM_TYPE_LABELS.en[type],
    zh: DIAGRAM_TYPE_LABELS.zh[type],
  }));

  const template = fs.readFileSync(path.join(repoRoot, 'scripts/gallery-template.html'), 'utf8');
  for (const filter of filters) {
    const placeholder = filter.type.toUpperCase();
    assert.ok(
      template.includes(`data-filter="${filter.type}" aria-pressed="false" data-en="[[DIAGRAM_TYPE_${placeholder}_EN]]" data-zh="[[DIAGRAM_TYPE_${placeholder}_ZH]]"`),
      `gallery template: ${filter.type} filter must consume the shared copy source`,
    );
  }

  for (const relative of ['docs/gallery.html']) {
    const html = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    assert.match(
      html,
      /<button(?=[^>]*data-filter="all")(?=[^>]*data-en="All \/ [^"]+")(?=[^>]*data-zh="全部配方 \/ [^"]+")[^>]*>All \/ [^<]+<\/button>/,
      `${relative}: all filter must expose English and Chinese copy`,
    );
    for (const filter of filters) {
      const bilingualFilter = new RegExp(
        `<button(?=[^>]*data-filter="${filter.type}")(?=[^>]*data-en="${filter.en}")(?=[^>]*data-zh="${filter.zh}")[^>]*>${filter.en}<\\/button>`,
      );
      assert.match(html, bilingualFilter, `${relative}: ${filter.type} filter must expose English and Chinese copy`);
    }
    assert.match(
      html,
      /querySelectorAll\('\[data-en\]\[data-zh\]'\)/,
      `${relative}: language changes must update bilingual gallery filters`,
    );
  }
});

test('scenario guide type filters use consistent Chinese diagram names', () => {
  const template = fs.readFileSync(path.join(repoRoot, 'scripts/guide-template.html'), 'utf8');
  assert.match(template, /var types = \[\[DIAGRAM_TYPES_JSON\]\];/);
  assert.match(template, /var labels = \[\[DIAGRAM_TYPE_LABELS_JSON\]\];/);

  const html = fs.readFileSync(path.join(repoRoot, 'docs/guide.html'), 'utf8');
  assert.ok(
    html.includes(`var labels = ${JSON.stringify(DIAGRAM_TYPE_LABELS)};`),
    'docs/guide.html: Guide filters must use the shared Chinese diagram names',
  );
});

test('real Chrome preserves language through entry, navigation, selection, refresh, and consistent navigation chrome', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real site regression.',
  timeout: 60000,
}, async () => {
  const docsRoot = path.join(repoRoot, 'docs');
  const server = startStaticServer(docsRoot);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = new ChromeVisualBrowser(chromePath);

  try {
    const sessionId = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);

    await navigate(browser, sessionId, `${baseUrl}/index.html`);
    await evaluate(browser, sessionId, 'localStorage.clear()');

    await evaluate(browser, sessionId, "localStorage.setItem('archify-guide-language', 'zh')");
    await navigate(browser, sessionId, `${baseUrl}/index.html`);
    assert.deepEqual(await evaluate(browser, sessionId, `({
      language: document.documentElement.lang,
      stored: localStorage.getItem('archify-lang')
    })`), { language: 'zh-CN', stored: 'zh' });

    await evaluate(browser, sessionId, 'localStorage.clear()');
    await navigate(browser, sessionId, `${baseUrl}/index.html?lang=zh&utm_source=browser-test#proof`);

    let state = await evaluate(browser, sessionId, `({
      language: document.documentElement.lang,
      stored: localStorage.getItem('archify-lang'),
      langQuery: new URL(location.href).searchParams.get('lang'),
      campaign: new URL(location.href).searchParams.get('utm_source'),
      hash: location.hash
    })`);
    assert.deepEqual(state, {
      language: 'zh-CN', stored: 'zh', langQuery: null, campaign: 'browser-test', hash: '#proof',
    });

    await clickAndNavigate(browser, sessionId, '.site-nav a[href="gallery.html"]');
    assert.equal(await evaluate(browser, sessionId, 'document.documentElement.lang'), 'zh-CN');
    assert.equal(await evaluate(browser, sessionId, 'document.querySelector(".nav-logo-path").textContent'), '/ 验证作品集');
    assert.deepEqual(await evaluate(browser, sessionId, `Array.from(document.querySelectorAll('[data-filter]')).map(function (button) {
      return button.textContent;
    })`), ['全部配方 / 11', '架构图', '工作流', '时序图', '数据流', '生命周期']);

    await evaluate(browser, sessionId, 'document.querySelector(\'[data-filter="architecture"]\').click()');
    state = await evaluate(browser, sessionId, `({
      language: document.documentElement.lang,
      selected: document.querySelector('[data-filter="architecture"]').getAttribute('aria-pressed'),
      typeQuery: new URL(location.href).searchParams.get('type'),
      visibleCount: document.querySelectorAll('.showcase-card:not([hidden])').length,
      onlyArchitecture: Array.from(document.querySelectorAll('.showcase-card:not([hidden])')).every(function (card) {
        return card.getAttribute('data-type') === 'architecture';
      })
    })`);
    assert.deepEqual(state, {
      language: 'zh-CN', selected: 'true', typeQuery: 'architecture', visibleCount: 2, onlyArchitecture: true,
    });

    let loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
    await browser.cdp.send('Page.reload', {}, sessionId);
    await loaded;
    assert.deepEqual(await evaluate(browser, sessionId, `({
      language: document.documentElement.lang,
      selected: document.querySelector('[data-filter="architecture"]').getAttribute('aria-pressed'),
      visibleCount: document.querySelectorAll('.showcase-card:not([hidden])').length
    })`), { language: 'zh-CN', selected: 'true', visibleCount: 2 });

    await evaluate(browser, sessionId, 'document.getElementById("language").click()');
    assert.equal(await evaluate(browser, sessionId, 'document.documentElement.lang'), 'en');
    assert.equal(await evaluate(browser, sessionId, 'document.querySelector(".nav-logo-path").textContent'), '/ proof lab');
    assert.deepEqual(await evaluate(browser, sessionId, `Array.from(document.querySelectorAll('[data-filter]')).map(function (button) {
      return button.textContent;
    })`), ['All / 11', 'Architecture', 'Workflow', 'Sequence', 'Data flow', 'Lifecycle']);

    loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
    await browser.cdp.send('Page.reload', {}, sessionId);
    await loaded;
    assert.equal(await evaluate(browser, sessionId, 'document.documentElement.lang'), 'en');

    await clickAndNavigate(browser, sessionId, '.site-nav a[href="guide.html"]');
    assert.equal(await evaluate(browser, sessionId, 'document.documentElement.lang'), 'en');
    await navigate(browser, sessionId, `${baseUrl}/guide.html?lang=zh#recipes`);
    state = await evaluate(browser, sessionId, `({
      language: document.documentElement.lang,
      stored: localStorage.getItem('archify-lang'),
      langQuery: new URL(location.href).searchParams.get('lang'),
      hash: location.hash
    })`);
    assert.deepEqual(state, { language: 'zh-CN', stored: 'zh', langQuery: null, hash: '#recipes' });
    assert.equal(await evaluate(browser, sessionId, 'document.querySelector(".nav-logo-path").textContent'), '/ 场景指南');
    assert.deepEqual(await evaluate(browser, sessionId, `Array.from(document.querySelectorAll('#filters [data-filter]')).map(function (button) {
      return button.textContent;
    })`), ['全部配方', '架构图', '工作流', '时序图', '数据流', '生命周期']);

    await evaluate(browser, sessionId, 'document.querySelector(\'#filters [data-filter="sequence"]\').click()');
    state = await evaluate(browser, sessionId, `({
      language: document.documentElement.lang,
      selected: document.querySelector('#filters [data-filter="sequence"]').classList.contains('active'),
      visibleCount: document.querySelectorAll('#cards .card').length,
      onlySequence: Array.from(document.querySelectorAll('#cards .card .card-type')).every(function (label) {
        return label.textContent === 'sequence';
      }),
      labels: Array.from(document.querySelectorAll('#filters [data-filter]')).map(function (button) {
        return button.textContent;
      })
    })`);
    assert.deepEqual(state, {
      language: 'zh-CN',
      selected: true,
      visibleCount: 2,
      onlySequence: true,
      labels: ['全部配方', '架构图', '工作流', '时序图', '数据流', '生命周期'],
    });

    await clickAndNavigate(browser, sessionId, '.site-nav a[href="start.html"]');
    assert.equal(await evaluate(browser, sessionId, 'document.documentElement.lang'), 'zh-CN');
    assert.equal(await evaluate(browser, sessionId, 'new URL(location.href).searchParams.has("lang")'), false);
    assert.equal(await evaluate(browser, sessionId, 'document.querySelector(".nav-logo-path").textContent'), '/ 快速上手');

    const pages = ['index.html', 'gallery.html', 'guide.html', 'start.html'];
    const desktopReceipts = [];
    for (const page of pages) {
      await navigate(browser, sessionId, `${baseUrl}/${page}`);
      desktopReceipts.push(await evaluate(browser, sessionId, `(function () {
        var nav = document.querySelector('.site-nav');
        var logo = nav.querySelector('.nav-logo-text');
        var actions = nav.querySelector('.nav-right');
        var language = nav.querySelector('.btn-lang');
        var cta = nav.querySelector('.nav-cta');
        var navStyle = getComputedStyle(nav);
        var logoStyle = getComputedStyle(logo);
        var actionsStyle = getComputedStyle(actions);
        var languageStyle = getComputedStyle(language);
        var ctaStyle = getComputedStyle(cta);
        return {
          height: nav.getBoundingClientRect().height,
          position: navStyle.position,
          paddingLeft: navStyle.paddingLeft,
          background: navStyle.backgroundColor,
          borderBottom: navStyle.borderBottomWidth + ' ' + navStyle.borderBottomStyle + ' ' + navStyle.borderBottomColor,
          logoFont: logoStyle.fontFamily,
          logoSize: logoStyle.fontSize,
          actionGap: actionsStyle.gap,
          languageHeight: language.getBoundingClientRect().height,
          languageRadius: languageStyle.borderRadius,
          ctaHeight: cta.getBoundingClientRect().height,
          ctaRadius: ctaStyle.borderRadius,
          linkCount: nav.querySelectorAll('.nav-link').length
        };
      })()`));
    }
    for (const receipt of desktopReceipts.slice(1)) assert.deepEqual(receipt, desktopReceipts[0]);

    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    }, sessionId);
    for (const page of pages) {
      await navigate(browser, sessionId, `${baseUrl}/${page}`);
      const mobile = await evaluate(browser, sessionId, `(function () {
        var nav = document.querySelector('.site-nav');
        var rect = nav.getBoundingClientRect();
        var actions = nav.querySelector('.nav-right').getBoundingClientRect();
        return {
          height: rect.height,
          left: rect.left,
          right: rect.right,
          actionsRight: actions.right,
          linkDisplay: getComputedStyle(nav.querySelector('.nav-link')).display
        };
      })()`);
      assert.deepEqual(mobile, { height: 60, left: 0, right: 390, actionsRight: 370, linkDisplay: 'none' }, page);
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
