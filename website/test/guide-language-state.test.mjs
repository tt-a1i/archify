import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { guideCopy } from '../src/data/site-translations.mjs';

const key = 'archify-guide-language-state.v1';
const script = fs.readFileSync(new URL('../src/scripts/guide.js', import.meta.url), 'utf8');
const recipes = ['architecture', 'workflow'].map(type => ({
  id: `${type}-test`, type, signals: [], presentation: { preset: 'classic', motion: 'none' },
  en: { title: `${type} recipe`, question: 'Question', summary: 'Summary', useWhen: 'Use', avoidWhen: 'Avoid', include: ['Evidence'], prompt: 'Prompt' },
  zh: { title: `${type} 配方`, question: '问题', summary: '概要', useWhen: '适合', avoidWhen: '避免', include: ['证据'], prompt: '提示词' },
}));
function page({ language = 'en', href = 'https://archify.si/guide', target = 'https://archify.si/zh/guide', storage = new Map(), denyStorage = false }) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const handlers = new Map(), classes = new Set();
      elements.set(id, {
        value: '', textContent: '', innerHTML: '', href: target,
        classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); }, contains(value) { return classes.has(value); } },
        addEventListener(event, handler) { handlers.set(event, handler); }, setAttribute() {}, focus() {}, scrollIntoView() {},
        dispatch(event, detail) { handlers.get(event)?.(detail); },
      });
    }
    return elements.get(id);
  }
  element('guide-data').textContent = JSON.stringify(recipes);
  element('site-copy').textContent = JSON.stringify(guideCopy);
  const document = {
    documentElement: {}, getElementById: element, querySelectorAll() { return []; },
    createElement() { return { textContent: '', get innerHTML() { return this.textContent; } }; },
  };
  const sessionStorage = {
    getItem(name) { if (denyStorage) throw new Error('blocked'); return storage.get(name) || null; },
    setItem(name, value) { if (denyStorage) throw new Error('blocked'); storage.set(name, value); },
    removeItem(name) { if (denyStorage) throw new Error('blocked'); storage.delete(name); },
  };
  vm.runInNewContext(script, { document, sessionStorage, window: { location: { href } },
    URL, ArchifySiteLanguage: { read() { return language; }, write() { return language; }, page(name, suffix) { return name + (suffix || ''); } },
  });
  return { element, storage };
}
const click = { button: 0, defaultPrevented: false, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };

test('guide language navigation preserves a draft, filter and selected recipe once', () => {
  const original = page({});
  const draft = '展示私有系统的审批流；保留这段输入。';
  original.element('scenario').value = draft;
  original.element('filters').dispatch('click', { target: { closest() { return { dataset: { filter: 'workflow' } }; } } });
  original.element('cards').dispatch('click', { target: { closest() { return { dataset: { recipe: 'workflow-test' } }; } } });
  original.element('language').dispatch('click', click);
  assert.equal(JSON.parse(original.storage.get(key)).scenario, draft);
  assert.ok(!JSON.parse(original.storage.get(key)).to.includes(encodeURIComponent(draft)), 'draft never enters the navigation URL');
  const translated = page({ language: 'zh', href: 'https://archify.si/zh/guide', target: 'https://archify.si/guide', storage: original.storage });
  assert.equal(translated.element('scenario').value, draft);
  assert.match(translated.element('filters').innerHTML, /class="filter active"[^>]*data-filter="workflow"/);
  assert.match(translated.element('result').innerHTML, /<h3>workflow 配方<\/h3>/);
  assert.equal(translated.element('result').classList.contains('visible'), true);
  assert.equal(original.storage.has(key), false, 'restore consumes the record');
  translated.element('language').dispatch('click', click);
  const back = page({ storage: original.storage });
  assert.equal(back.element('scenario').value, draft);
  assert.match(back.element('result').innerHTML, /<h3>workflow recipe<\/h3>/);
  assert.equal(original.storage.has(key), false);
});

test('guide discards stale, malformed and unrelated navigation state; denied storage stays usable', () => {
  for (const state of [
    { to: 'https://archify.si/zh/guide', at: Date.now() - 30001, scenario: 'stale' },
    { to: 'https://archify.si/guide', at: Date.now(), scenario: 'unrelated' },
    { to: 'https://archify.si/zh/guide', scenario: 'missing timestamp' },
  ]) {
    const storage = new Map([[key, JSON.stringify(state)]]);
    const next = page({ language: 'zh', href: 'https://archify.si/zh/guide', storage });
    assert.equal(next.element('scenario').value, '');
    assert.equal(storage.has(key), false);
  }
  const blocked = page({ denyStorage: true });
  blocked.element('scenario').value = 'still editable';
  assert.doesNotThrow(() => blocked.element('language').dispatch('click', click));
  assert.ok(blocked.element('cards').innerHTML.includes('architecture recipe'));
  const normal = page({});
  normal.element('language').dispatch('click', { ...click, ctrlKey: true });
  assert.equal(normal.storage.has(key), false, 'modified clicks keep their native behavior');
});

test('guide draft uses the live query and hash when the language anchor is stale', () => {
  const current = page({ href: 'https://archify.si/guide?utm_source=late#recipe-workflow', target: 'https://archify.si/zh/guide' });
  current.element('scenario').value = 'Current draft';
  current.element('language').dispatch('click', click);
  const saved = JSON.parse(current.storage.get(key));
  assert.equal(saved.to, 'https://archify.si/zh/guide?utm_source=late#recipe-workflow');
  const translated = page({ language: 'zh', href: saved.to, storage: current.storage });
  assert.equal(translated.element('scenario').value, 'Current draft');
});
