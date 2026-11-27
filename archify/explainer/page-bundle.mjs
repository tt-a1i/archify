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

// Every citation of a repository file is its own dependency entry with the whole file frozen in
// `contentBase64`, so a file cited ten times would be embedded ten times. The page instead holds
// each repeated content once in `dependencyContents`, keyed by the entry's declared SHA-256, and
// the entry names it in place with `contentRef`. Unpacking restores the exact entries (same keys,
// same order), so the digest and every per-entry byte check still run over the prepared form.
const CONTENTS = 'dependencyContents';
const replaceKey = (entry, from, to, value) => Object.fromEntries(Object.entries(entry).map(([key, current]) => key === from ? [to, value] : [key, current]));

const packDependencies = bundle => {
  if (!Array.isArray(bundle?.dependencies)) return bundle;
  const packable = entry => entry && typeof entry.contentBase64 === 'string' && typeof entry.sha256 === 'string' && !('contentRef' in entry);
  // Only content cited more than once moves; a page without repeats keeps today's exact bytes.
  const key = entry => `${entry.sha256}:${entry.contentBase64}`, uses = new Map();
  for (const entry of bundle.dependencies) if (packable(entry)) uses.set(key(entry), (uses.get(key(entry)) || 0) + 1);
  const contents = {};
  const dependencies = bundle.dependencies.map(entry => {
    if (!packable(entry) || uses.get(key(entry)) < 2) return entry;
    // Never merge two different strings under one identity: a corrupt entry keeps its own bytes
    // inline, so the checker still sees and reports exactly what was written.
    if (Object.hasOwn(contents, entry.sha256) && contents[entry.sha256] !== entry.contentBase64) return entry;
    contents[entry.sha256] = entry.contentBase64;
    return replaceKey(entry, 'contentBase64', 'contentRef', entry.sha256);
  });
  return Object.keys(contents).length ? { ...bundle, dependencies, [CONTENTS]: contents } : bundle;
};

const unpackDependencies = bundle => {
  if (!bundle || typeof bundle !== 'object' || !(CONTENTS in bundle)) return bundle;
  const { [CONTENTS]: stored, ...rest } = bundle;
  const contents = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  if (!Array.isArray(rest.dependencies)) return rest;
  // A missing or unknown reference restores no bytes; the dependency check then reports it.
  return { ...rest, dependencies: rest.dependencies.map(entry => entry && typeof entry === 'object' && typeof entry.contentRef === 'string'
    ? replaceKey(entry, 'contentRef', 'contentBase64', Object.hasOwn(contents, entry.contentRef) && typeof contents[entry.contentRef] === 'string' ? contents[entry.contentRef] : undefined)
    : entry) };
};

export const packPageBundle = bundle => packDependencies(swap(bundle, 'html', 'htmlGzip', html => gzipSync(html, { level: 9 }).toString('base64')));

/** Accepts packed and older unpacked pages alike. */
export const unpackPageBundle = bundle => unpackDependencies(swap(bundle, 'htmlGzip', 'html', data => gunzipSync(Buffer.from(data, 'base64')).toString('utf8')));
