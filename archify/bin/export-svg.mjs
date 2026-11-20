#!/usr/bin/env node
// Export through the standalone Viewer's own SVG download path.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from './visual-check.mjs';
import { createOwnedTempDirectory } from '../renderers/shared/owned-temp-directory.mjs';

async function main() {
  const [input, output, theme = 'auto', ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length || !['auto', 'light', 'dark'].includes(theme) || path.extname(output).toLowerCase() !== '.svg') {
    throw new Error('Usage: node export-svg.mjs INPUT.html OUTPUT.svg [auto|light|dark]');
  }
  const artifact = path.resolve(input);
  if (!fs.statSync(artifact).isFile() || path.extname(artifact).toLowerCase() !== '.html') throw new Error('Input must be a standalone HTML file');
  if (fs.existsSync(output)) throw new Error(`Output already exists: ${output}`);
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome or Chromium not found; set ARCHIFY_CHROME to its executable');
  const target = path.resolve(output);
  const staging = createOwnedTempDirectory('archify-svg-', { parent: path.dirname(target) });
  let browser;
  try {
    browser = new ChromeVisualBrowser(chrome);
    const session = await browser.sessionPromise;
    await browser.cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allowAndName', downloadPath: staging.path, eventsEnabled: true,
    });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    loaded.catch(() => {});
    const navigation = await browser.cdp.send('Page.navigate', { url: pathToFileURL(artifact).href }, session);
    if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
    await loaded;
    const ready = await browser.cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        if (!window.Archify || !Archify.exportMenu || typeof Archify.exportMenu.run !== 'function') throw new Error('This HTML does not support Viewer SVG export');
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        if (Archify.layoutStability && Archify.layoutStability.whenStable) await Archify.layoutStability.whenStable();
      })()`, awaitPromise: true, returnByValue: true,
    }, session);
    if (ready.exceptionDetails) throw new Error(ready.exceptionDetails.exception?.description || ready.exceptionDetails.text);
    const started = browser.cdp.waitFor('Browser.downloadWillBegin', undefined, 10000);
    const dialog = browser.cdp.waitFor('Page.javascriptDialogOpening', session, 10000);
    // Both waiters must have rejection handlers even when the other wins.
    started.catch(() => {});
    dialog.catch(() => {});
    const launched = browser.cdp.send('Runtime.evaluate', {
      expression: `void Archify.exportMenu.run(${JSON.stringify(theme === 'auto' ? 'svg' : `svg-${theme}`)})`,
    }, session);
    const launchFailure = launched.then(result => {
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return new Promise(() => {});
    });
    const event = await Promise.race([
      launchFailure,
      started.then(value => ({ download: value })),
      dialog.then(value => ({ dialog: value })),
    ]);
    if (event.dialog) {
      await browser.cdp.send('Page.handleJavaScriptDialog', { accept: true }, session);
      const detail = await browser.cdp.send('Runtime.evaluate', {
        expression: "document.documentElement.getAttribute('data-last-export-error')", returnByValue: true,
      }, session);
      throw new Error(`Viewer export failed: ${detail.result?.value || event.dialog.message}`);
    }
    const downloaded = path.join(staging.path, event.download.guid);
    let svg;
    for (let attempt = 0; attempt < 400; attempt++) {
      if (fs.existsSync(downloaded)) {
        svg = fs.readFileSync(downloaded, 'utf8');
        if (svg.trimEnd().endsWith('</svg>')) break;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (typeof svg !== 'string' || !/^\s*(?:<\?xml[^?]*\?>\s*)?<svg\b/.test(svg) || !svg.trimEnd().endsWith('</svg>')) {
      throw new Error('Viewer did not finish downloading a valid SVG');
    }
    // A hard link publishes the complete download without replacing a destination.
    fs.linkSync(downloaded, target);
    console.log(`Exported ${output}`);
  } finally {
    try { if (browser) await browser.close(); } finally { await staging.cleanup(); }
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
