import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chromePath = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chromePath) {
  throw new Error(`ARCHIFY_CHROME does not resolve to an executable browser: ${process.env.ARCHIFY_CHROME}`);
}

// A slash-joined enumeration is ordinary authored prose with no break
// opportunity, so it sets the card's min-content width. Four and five cards
// exercise both rail densities reported in #617.
const UNBREAKABLE = 'ingest/normalize/enrich/dedupe/partition/compact/publish/verify';

function fixture(cardCount, output) {
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  const cards = source.cards.slice(0, 3);
  const extra = [
    { dot: 'amber', title: 'Pipelines', items: [UNBREAKABLE, 'Nightly backfill replays the same stages'] },
    { dot: 'violet', title: 'Observability', items: ['traces/metrics/logs/profiles/exemplars/alerts', 'One dashboard per service'] },
  ];
  return {
    ...source,
    meta: { ...source.meta, output },
    cards: [...cards, ...extra].slice(0, cardCount),
  };
}

test('reader cards keep an unbreakable note inside the viewport width', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cards-overflow-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const artifacts = {};
  for (const cardCount of [4, 5]) {
    const output = path.join(scratch, `cards-${cardCount}.html`);
    const input = path.join(scratch, `cards-${cardCount}.architecture.json`);
    fs.writeFileSync(input, JSON.stringify(fixture(cardCount, `cards-${cardCount}.html`)));
    execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), input, output]);
    artifacts[cardCount] = output;
  }

  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const session = await browser.sessionPromise;
    const send = (method, params = {}) => browser.cdp.send(method, params, session);
    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
      return result.result?.value;
    }
    // `Page.navigate` resolves when navigation starts, so measuring straight
    // after it can read the previous document or miss `.cards` entirely. Wait
    // for the load event, then for the reader's own settle signal.
    async function load(artifact) {
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      loaded.catch(() => {});
      const navigation = await send('Page.navigate', { url: pathToFileURL(artifact).href });
      assert.equal(navigation.errorText, undefined, navigation.errorText);
      await loaded;
      await evaluate(`(async function () {
        for (var i = 0; i < 2; i += 1) {
          await Archify.readerLayout.whenStable();
          await Archify.viewerChromeLayout.whenStable();
        }
      })()`);
    }
    for (const [cardCount, artifact] of Object.entries(artifacts)) {
      for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await load(artifact);
        const measured = await evaluate(`(function () {
          var rail = document.querySelector('.cards');
          return {
            railScroll: rail.scrollWidth,
            railClient: rail.clientWidth,
            noteRendered: document.body.textContent.indexOf(${JSON.stringify(UNBREAKABLE)}) !== -1,
            docScroll: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
          };
        })()`);
        const where = `${cardCount} cards at ${width}x${height}`;
        assert.equal(measured.noteRendered, true, `the unbreakable note is missing, so ${where} proves nothing`);
        assert.ok(
          measured.railScroll <= measured.railClient,
          `cards rail overflows its container at ${where}: scrollWidth ${measured.railScroll} > clientWidth ${measured.railClient}`,
        );
        assert.ok(
          measured.docScroll <= measured.innerWidth,
          `page scrolls horizontally at ${where}: documentElement.scrollWidth ${measured.docScroll} > innerWidth ${measured.innerWidth}`,
        );
      }
    }
  } finally {
    await browser.close?.();
  }
});
