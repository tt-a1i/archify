// Cache only accepted attachment URLs inside the current anchored pack. Malformed
// or unrelated comments are ignored so they cannot prevent a fresh upload.
const META_RE = /^<!-- archify-pr-meta: (.+) -->$/m;
const ASSET_URL = /^https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9._-]+$/;

export function renderPackMetadata({ baseSha = null, headSha = null, assets = {} } = {}) {
  return `<!-- archify-pr-meta: ${JSON.stringify({ v: 1, baseSha, headSha, assets })} -->`;
}

export function readPackMetadata(body, acceptUrl = (url) => ASSET_URL.test(url)) {
  const block = /<!-- archify-pr-pack:start -->([\s\S]*?)<!-- archify-pr-pack:end -->/.exec(String(body ?? ''));
  const match = block && META_RE.exec(block[1]);
  if (!match) return null;
  try {
    const metadata = JSON.parse(match[1]);
    if (metadata?.v !== 1 || !metadata.assets || typeof metadata.assets !== 'object' || Array.isArray(metadata.assets)) return null;
    return { ...metadata, assets: Object.fromEntries(Object.entries(metadata.assets).filter(([key, url]) => /^[A-Za-z0-9_.-]+:[a-f0-9]{16}$/.test(key) && typeof url === 'string' && acceptUrl(url))) };
  } catch {
    return null;
  }
}

export function setPackMetadata(markdown, metadata) {
  return markdown.replace(/(<!-- archify-pr-pack:start -->)(?:\n<!-- archify-pr-meta: .* -->)?/, `$1\n${renderPackMetadata(metadata)}`);
}
