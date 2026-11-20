import { once } from 'node:events';

export async function closeAnalysisBrowser(browser) {
  const { child } = browser;
  if (child.exitCode === null && child.signalCode === null) {
    // On Windows the CDP reply can precede process exit and profile unlock.
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(20_000) }).catch(() => {});
    await browser.cdp.send('Browser.close').catch(() => {});
    await exited;
  }
  // Preserve the normal forced shutdown, cleanup and failure reporting.
  await browser.close();
}
