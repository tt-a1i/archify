import { ChromeVisualBrowser } from '../../archify/bin/visual-check.mjs';

// A new incognito context gives each visual check its own storage, cache and
// page while avoiding a Chrome process launch for every matrix entry.
export async function isolatedVisualBrowser(browser) {
  const { browserContextId } = await browser.cdp.send('Target.createBrowserContext');
  try {
    const { targetId } = await browser.cdp.send('Target.createTarget', {
      url: 'about:blank', browserContextId,
    });
    const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await browser.cdp.send('Page.enable', {}, sessionId);
    await browser.cdp.send('Runtime.enable', {}, sessionId);
    const isolated = { cdp: browser.cdp, sessionPromise: Promise.resolve(sessionId) };
    return {
      inspect: (options) => ChromeVisualBrowser.prototype.inspect.call(isolated, options),
      close: () => browser.cdp.send('Target.disposeBrowserContext', { browserContextId }),
    };
  } catch (error) {
    await browser.cdp.send('Target.disposeBrowserContext', { browserContextId });
    throw error;
  }
}

