import { gzipSync, gunzipSync } from 'node:zlib';

// The native Viewer HTML is needed only when a reader opens "Explore", so the page stores it
// gzip-compressed and the reader inflates it on demand. Keys keep their order, so the prepared
// bundle digest is computed and verified over the same unpacked JSON.
const swap = (bundle, from, to, convert) => {
  const diagrams = bundle?.preparedDiagrams?.diagrams;
  if (!diagrams || typeof diagrams !== 'object') return bundle;
  return { ...bundle, preparedDiagrams: { ...bundle.preparedDiagrams, diagrams: Object.fromEntries(Object.entries(diagrams).map(([id, child]) =>
    [id, child && typeof child[from] === 'string' ? Object.fromEntries(Object.entries(child).map(([key, value]) => key === from ? [to, convert(value)] : [key, value])) : child])) } };
};

export const packPageBundle = bundle => swap(bundle, 'html', 'htmlGzip', html => gzipSync(html, { level: 9 }).toString('base64'));

/** Accepts packed and older unpacked pages alike. */
export const unpackPageBundle = bundle => swap(bundle, 'htmlGzip', 'html', data => gunzipSync(Buffer.from(data, 'base64')).toString('utf8'));
