process.env.ARCHIFY_SITE_INTEGRATION = '1';

// GitHub-hosted Linux runners require the same explicit Chrome sandbox opt-out
// already used by this workflow's other real-browser regression steps.
if (process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true') {
  process.env.ARCHIFY_CHROME_NO_SANDBOX = '1';
}

await import('./site-language-continuity.test.mjs');
