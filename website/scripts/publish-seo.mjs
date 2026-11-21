import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalOrigin, canonicalUrl, canonicalPath, sitePages } from '../src/data/site-urls.mjs';
import { CASES } from '../src/data/gallery-presentation.mjs';
import { PUBLISHED_CASES } from '../src/data/published-cases.mjs';

export const CANONICAL_ORIGIN = canonicalOrigin;
export const SEO_BLOCK_START = '<!-- archify:published-artifact-metadata:start -->';
export const SEO_BLOCK_END = '<!-- archify:published-artifact-metadata:end -->';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// This narrowly scoped removal lets byte-parity checks retain the standalone
// renderer contract while allowing publication-only discovery metadata.
export function stripPublishedArtifactMetadata(html) {
  return html.replace(/<!-- archify:published-artifact-metadata:start -->\n[\s\S]*?<!-- archify:published-artifact-metadata:end -->\n/g, '');
}

export function artifactMetadata(entry, presentation) {
  return publicationMetadata(entry, { title: presentation.titleEn, description: presentation.descriptionEn, language: 'en' });
}

function publicationMetadata(entry, { title, description, language, twitter = false, documentDescription = false }) {
  const url = `${CANONICAL_ORIGIN}/${entry.artifact.replace(/\.html$/, '')}`;
  const source = `${CANONICAL_ORIGIN}/${entry.input}`;
  const data = {
    '@context': 'https://schema.org', '@type': 'CreativeWork',
    name: title, description,
    url, isBasedOn: source, inLanguage: language,
  };
  const twitterMetadata = twitter ? `<meta name="twitter:card" content="summary">\n<meta name="twitter:title" content="${escape(title)}">\n<meta name="twitter:description" content="${escape(description)}">\n` : '';
  // Some artifacts, such as Explainers, already ship a document <meta name="description">.
  // The publication block must not create a second one.
  const descriptionMetadata = documentDescription ? '' : `<meta name="description" content="${escape(description)}">\n`;
  return `${SEO_BLOCK_START}\n<link rel="canonical" href="${escape(url)}">\n${descriptionMetadata}<meta property="og:type" content="article">\n<meta property="og:title" content="${escape(title)}">\n<meta property="og:description" content="${escape(description)}">\n<meta property="og:url" content="${escape(url)}">\n${twitterMetadata}<script type="application/ld+json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>\n${SEO_BLOCK_END}\n`;
}

export function caseMetadata(entry) {
  return publicationMetadata(entry, { ...entry, twitter: true, documentDescription: entry.documentDescription === true });
}

// Only gallery entries with passing artifact checks and unchanged proof hashes
// are advertised. The manifest remains a receipt for the original export bytes.
export function selectedArtifacts(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'gallery/manifest.json'), 'utf8'));
  return CASES.map(presentation => {
    const entry = manifest.entries.find(item => item.id === presentation.id);
    assert.ok(entry, `Missing gallery proof: ${presentation.id}`);
    assert.equal(entry.artifact, `gallery/artifacts/${presentation.output}`);
    assert.equal(entry.input, `gallery/sources/${presentation.input}`);
    assert.ok(entry.checks.length > 0 && entry.checks.every(check => check.ok === true), `Unproven artifact: ${entry.id}`);
    const html = fs.readFileSync(path.join(root, entry.artifact), 'utf8');
    assert.equal(sha256(stripPublishedArtifactMetadata(html)), entry.artifactSha256, `Artifact proof hash mismatch: ${entry.id}`);
    assert.equal(sha256(fs.readFileSync(path.join(root, entry.input))), entry.sourceSha256, `Source proof hash mismatch: ${entry.id}`);
    return { entry, presentation };
  });
}

export function publishSeo(root, target) {
  const paths = sitePages.flatMap(page => ['en', 'zh'].map(lang => canonicalPath(page, lang).slice(1)));
  for (const route of paths) {
    const file = route === '' || route.endsWith('/') ? `${route}index.html` : `${route}.html`;
    assert.ok(fs.existsSync(path.join(root, file)), `Missing indexable page: ${file}`);
  }
  const selected = selectedArtifacts(root);
  // Check the explicit case inventory before writing any publication metadata.
  // These are existing authored examples, not new generation or proof receipts.
  for (const entry of PUBLISHED_CASES) {
    for (const file of [entry.artifact, entry.input]) {
      assert.ok(fs.existsSync(path.join(root, file)), `Missing published case: ${file}`);
    }
    const original = stripPublishedArtifactMetadata(fs.readFileSync(path.join(root, entry.artifact), 'utf8'));
    assert.match(original, /<\/head>/i, `Artifact missing head: ${entry.artifact}`);
    const hasDescription = /<meta\b[^>]*name=["']description["']/i.test(original);
    assert.equal(hasDescription, entry.documentDescription === true, `${entry.artifact}: documentDescription must match the artifact <head>`);
  }
  const publications = [
    ...selected.map(({ entry, presentation }) => ({ entry, metadata: artifactMetadata(entry, presentation) })),
    ...PUBLISHED_CASES.map(entry => ({ entry, metadata: caseMetadata(entry) })),
  ];
  for (const { entry, metadata } of publications) {
    const file = path.join(root, entry.artifact);
    const original = stripPublishedArtifactMetadata(fs.readFileSync(file, 'utf8'));
    assert.match(original, /<\/head>/i, `Artifact missing head: ${entry.artifact}`);
    // Callback insertion keeps authored $ replacement tokens literal (#826),
    // and retains the original closing tag bytes, including its letter case.
    fs.writeFileSync(file, original.replace(/<\/head>/i, closingTag => `${metadata}${closingTag}`));
  }
  const urls = [
    ...sitePages.flatMap(page => ['en', 'zh'].map(lang => canonicalUrl(page, lang))),
    ...selected.map(({ entry }) => `${CANONICAL_ORIGIN}/${entry.artifact.replace(/\.html$/, '')}`),
    ...PUBLISHED_CASES.map(entry => `${CANONICAL_ORIGIN}/${entry.artifact.replace(/\.html$/, '')}`),
  ];
  fs.writeFileSync(path.join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${escape(url)}</loc></url>`).join('\n')}\n</urlset>\n`);
  // Disallow synthetic RFC 6901 JSON Pointer prefixes (including bare /answer
  // and /meta root pointers) embedded in Explainer <script id="archify-explainer-prepared">
  // payloads while keeping /gallery/sources/ and /cases/ crawlable so X-Robots-Tag: noindex is read.
  fs.writeFileSync(
    path.join(root, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /panels/\nDisallow: /answer/\nDisallow: /answer$\nDisallow: /meta/\nDisallow: /meta$\nDisallow: /sources/\n\nSitemap: ${CANONICAL_ORIGIN}/sitemap.xml\n`,
  );
  // Static Pages supports these response headers; GitHub Pages does not.
  if (target.name === 'cloudflare') {
    fs.writeFileSync(path.join(root, '_headers'), `/*.json\n  X-Robots-Tag: noindex\n/*.archify.md\n  X-Robots-Tag: noindex\n`);
  }
  return urls;
}
