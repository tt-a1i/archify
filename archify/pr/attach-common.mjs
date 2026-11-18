import { spawnSync } from 'node:child_process';
import { PrPackError, packDiagnostic } from './manifest.mjs';
import { PR_URL_PLACEHOLDER, fillAssets } from './markdown.mjs';
import { readPackMetadata, setPackMetadata } from './metadata.mjs';

export function fail(code, stage, message, options = {}) {
  throw new PrPackError(message, { code, stage, diagnostics: [packDiagnostic({ code, message, ...options })] });
}

// Run the forge CLI directly. Tests inject a scripted executor
// with the same shape: ({ args, input, env }) => { status, stdout, stderr }.
export function createExecutor({ binary, cwd }) {
  return ({ args, input, env }) => {
    const result = spawnSync(binary, args, { encoding: 'utf8', input, cwd, maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env });
    if (result.error) return { status: null, stdout: '', stderr: result.error.message };
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  };
}

export function preparePublication({ body, attachments, markdown, receipt, url, acceptUrl }) {
  const cached = readPackMetadata(body, acceptUrl)?.assets || {};
  const reusedUrls = {};
  const uploads = attachments.filter((asset) => {
    const url = cached[`${asset.id}:${asset.hash}`];
    if (url) reusedUrls[asset.id] = url;
    return !url;
  });
  const resolvedMarkdown = markdown.replaceAll(PR_URL_PLACEHOLDER, url);
  const finalMarkdown = (urls) => setPackMetadata(fillAssets(resolvedMarkdown, urls).markdown, {
    baseSha: receipt.revisions?.baseSha ?? null,
    headSha: receipt.revisions?.headSha ?? null,
    assets: Object.fromEntries(attachments.map((asset) => [`${asset.id}:${asset.hash}`, urls[asset.id]])),
  });

  return { uploads, reusedUrls, finalMarkdown };
}
