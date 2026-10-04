import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

const root = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(root, '..');
const registryDir = path.join(repoRoot, 'community', 'packages');
const dist = path.join(root, 'dist');

const registry = fs.readdirSync(registryDir).filter((entry) => entry.endsWith('.json')).sort()
  .map((file) => JSON.parse(fs.readFileSync(path.join(registryDir, file), 'utf8')));

function elements(node, tag) {
  return [...(node.tagName === tag ? [node] : []), ...(node.childNodes || []).flatMap((child) => elements(child, tag))];
}
function attr(node, name) {
  return node?.attrs?.find((attribute) => attribute.name === name)?.value;
}
function hasClass(node, name) {
  return (attr(node, 'class') || '').split(/\s+/).includes(name);
}

function communityDom() {
  const file = path.join(dist, 'community.html');
  assert.ok(fs.existsSync(file), 'dist/community.html must exist — run npm run build first');
  return parse(fs.readFileSync(file, 'utf8'));
}

test('community catalog: renders one card per registry package, derived not hand-pasted', () => {
  const dom = communityDom();
  const cards = elements(dom, 'article').filter((node) => hasClass(node, 'package-card'));
  assert.equal(cards.length, registry.length, 'card count must match community/packages/*.json');

  const names = cards.map((card) => {
    const nameNode = elements(card, 'span').find((node) => hasClass(node, 'package-name'));
    return nameNode.childNodes.map((child) => child.value || '').join('').trim();
  }).sort();
  assert.deepEqual(names, registry.map((entry) => entry.name).sort());

  for (const card of cards) {
    const type = attr(card, 'data-type');
    assert.ok(['skill', 'recipe', 'brand-marks', 'locale', 'wrapper'].includes(type), `card type ${type}`);
    const summary = elements(card, 'p').find((node) => hasClass(node, 'package-summary'));
    assert.ok(attr(summary, 'data-en') && attr(summary, 'data-zh'), 'summary must carry both locales');
    const link = elements(card, 'a').find((node) => hasClass(node, 'card-link'));
    assert.ok((attr(link, 'href') || '').startsWith('https://'), 'card must link to the package repository');
  }
});

test('community catalog: filter buttons cover the types present in the registry', () => {
  const dom = communityDom();
  const pillButtons = elements(dom, 'button').filter((node) => attr(node, 'data-filter') && hasClass(node, 'filter-button'));
  const filters = pillButtons.map((node) => attr(node, 'data-filter'));
  assert.ok(filters.includes('all'));
  for (const type of new Set(registry.map((entry) => entry.type))) {
    assert.ok(filters.includes(type), `missing filter for type ${type}`);
  }
  assert.ok(pillButtons.every((node) => attr(node, 'data-en') && attr(node, 'data-zh')), 'filter buttons must be bilingual');

  const ledgerButtons = elements(dom, 'button').filter((node) => attr(node, 'data-filter') && hasClass(node, 'ledger-cell'));
  assert.deepEqual(
    ledgerButtons.map((node) => attr(node, 'data-filter')),
    ['skill', 'recipe', 'brand-marks', 'locale', 'wrapper'],
    'type ledger must offer every package type as a filter',
  );
});

test('community catalog: navigation, language toggle and disclaimer are present', () => {
  const dom = communityDom();
  const links = elements(dom, 'a').map((node) => attr(node, 'href'));
  assert.ok(links.includes('community.html'), 'primary navigation must link to community.html');
  const languageButton = elements(dom, 'button').find((node) => attr(node, 'id') === 'language');
  assert.ok(languageButton, 'language toggle must be present');
  const html = fs.readFileSync(path.join(dist, 'community.html'), 'utf8');
  assert.match(html, /Listing is not endorsement/, 'must carry the no-endorsement disclaimer');
  const submission = elements(dom, 'a').find((node) => (attr(node, 'href') || '').includes('github.com/tt-a1i/archify/tree/main/community'));
  assert.ok(submission, 'must link to the submission guide');
});


test('community catalog: every evidence link preserves its registry label and URL', () => {
  const cards = elements(communityDom(), 'article').filter(node => hasClass(node, 'package-card'));
  assert.ok(registry.some(entry => entry.evidence?.length > 1), 'exercise a multi-evidence entry');
  for (const entry of registry) {
    const card = cards.find(node => elements(node, 'span').some(span => hasClass(span, 'package-name') && span.childNodes.some(child => child.value === entry.name)));
    const evidence = elements(card, 'a').filter(node => hasClass(node, 'evidence-link'));
    assert.deepEqual(evidence.map(node => ({ label: attr(node, 'data-en'), url: attr(node, 'href') })),
      (entry.evidence || []).map(item => ({ label: `${item.label} ↗`, url: item.url })));
  }
});
