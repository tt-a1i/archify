import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../renderers/shared/atlas-navigation.mjs', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

// Exercise the production scroll roots, visit restoration, directory boundary
// and details toggle. A hidden panel models the browser's zero layout box.
function navigation({ shared = true } = {}) {
  const parentContext = { hidden: false, open: true, listeners: new Map(), addEventListener(name, callback) { this.listeners.set(name, callback); } };
  const inspector = { hidden: false };
  function panel(hidden) {
    let top = 0;
    return {
      get scrollTop() { return hidden() ? 0 : top; },
      set scrollTop(value) { top = hidden() ? 0 : value; },
      closest() { return hidden() ? {} : null; },
      getClientRects() { return hidden() ? [] : [{}]; },
    };
  }
  const context = panel(() => parentContext.hidden || !parentContext.open);
  const overview = panel(() => inspector.hidden);
  const panels = { details: panel(() => inspector.hidden) };
  const directory = panel(() => false); directory.hidden = true;
  const globals = {
    parentContext, context, overview, panels, directory, inspector,
    selectedTab: 'details', directoryOpen: false, restoring: false, layout: 'rail',
    workbench: shared ? {} : null, search: { value: '' }, toggle: { setAttribute() {} },
    doc: { documentElement: { getAttribute: () => 'rail' } }, win: { getComputedStyle: () => ({ overflowY: 'auto' }) },
    directorySection: { dataset: {} }, member: { parentContext: [{}] },
    filterDirectory() {}, renderTabs() {}, focusDescriptor: () => null, restoreFocus() {},
  };
  const api = vm.runInNewContext(`
    ${between('  const scrollRoots =', '  function renderTabs()')}
    ${between('  function renderDirectory()', '  function syncAction()')}
    ${between('  function snapshot()', "  tabs.addEventListener('click'")}
    ${between("  parentContext.addEventListener('toggle'", '  for (const [key, node] of Object.entries(scrollRoots)) {\n    node.addEventListener')}
    var api = { ${between('    setDirectoryOpen(open) {', '    dispose()')} snapshot, restore, showDirectory };
    onStateChange = function () { api.snapshot(); };
    api;
  `, globals);
  return { api, context, parentContext, overview, panels };
}

for (const shared of [true, false]) {
  test(`${shared ? 'persistent' : 'member'} directory restores the parent relationships panel along with inspector scroll`, () => {
    const runtime = navigation({ shared });
    const directory = shared ? runtime.api.setDirectoryOpen : runtime.api.showDirectory;
    directory(true);
    runtime.api.restore({ parentOpen: true, tab: 'details', directoryOpen: true, scroll: { parent: 143, overview: 27, details: 92 } }, { focus: false });
    assert.equal(runtime.context.scrollTop, 0, 'Hidden panels cannot apply the saved pixel offset yet');
    assert.equal(runtime.api.snapshot().scroll.parent, 143, 'The visit cache retains the offset while hidden');
    directory(false);
    assert.equal(runtime.context.scrollTop, 143, 'Closing the directory replays the cached parent panel offset');
    assert.equal(runtime.overview.scrollTop, 27);
    assert.equal(runtime.panels.details.scrollTop, 92);
    assert.equal(runtime.api.snapshot().scroll.parent, 143);
  });
}

test('a restored folded parent section replays its cached offset when expanded', () => {
  const runtime = navigation();
  runtime.api.restore({ parentOpen: false, scroll: { parent: 117 } }, { focus: false });
  assert.equal(runtime.context.scrollTop, 0);
  runtime.parentContext.open = true;
  runtime.parentContext.listeners.get('toggle')();
  assert.equal(runtime.context.scrollTop, 117);
  assert.equal(runtime.api.snapshot().scroll.parent, 117, 'The toggle snapshot must not overwrite the restored offset with zero');
});

test('member focus chooses the visible structure heading and respects persistent workbench focus', () => {
  const calls = [];
  let surface = 'structure', canRestore = true;
  const runtime = vm.runInNewContext(`({ ${between('    focus() {', '    setDirectoryOpen(open) {')} })`, {
    workbench: { canRestoreFocus: () => canRestore }, frame: {}, title: { focus: () => calls.push('graph') },
    win: { Archify: { internalStructure: { surface: () => surface, focus: () => calls.push('structure') } } },
  });
  runtime.focus();
  assert.deepEqual(calls, ['structure'], 'A structure commit must not move focus into its hidden graph');
  surface = 'graph'; runtime.focus();
  assert.deepEqual(calls, ['structure', 'graph']);
  canRestore = false; surface = 'structure'; runtime.focus();
  assert.deepEqual(calls, ['structure', 'graph'], 'A persistent directory or toolbar keeps its focus');
});

test('reference structure availability is independent of definition navigation and never suppresses a detail action', () => {
  const selected = { id: 'shared' }, requests = [], actions = { children: [], replaceChildren() { this.children = []; } };
  const globals = {
    diagram: 'child', shown: null, zh: true, structureTarget: null, directoryOpen: false,
    bundle: {
      members: { child: { title: 'Child', structureNodes: { owner: ['code'] } }, root: { title: 'Root', structureNodes: { canonical: ['code'] } }, nested: { title: 'Nested' } },
      details: [{ from: { diagram: 'child', node: 'owner' }, to: 'nested' }],
      references: [{ occurrence: { diagram: 'child', node: 'shared' }, target: { diagram: 'root', node: 'canonical' } }],
    },
    win: { Archify: { focus: { active: () => selected.id } }, ArchifyAddress: { active: true } },
    chip: { hidden: false }, selectionHint: { dataset: {} }, overview: {}, inspectSelection: { setAttribute() {} },
    detailEmpty: {}, detail: { hidden: false }, sourceEmpty: {}, evidence: { hidden: true }, sourceScope: {},
    referenceStructure: { hidden: true, dataset: {} }, actions, renderTabs() {}, notifyChange() {},
    navigate: (...args) => requests.push(args), showDirectory() {},
    button(label, parent, click) { const action = { label, click, dataset: {} }; parent.children.push(action); return action; },
  };
  const sync = vm.runInNewContext(`${between('  function syncAction()', '  function focusDescriptor()')} syncAction;`, globals);
  sync();
  assert.equal(globals.referenceStructure.hidden, false, 'An occurrence can open its canonical structure without owning a body');
  assert.equal(globals.structureTarget.diagram, 'root');
  assert.equal(globals.structureTarget.focus, 'canonical');
  assert.equal(actions.children.length, 1, 'The existing View definition action remains available');
  assert.equal(actions.children[0].dataset.atlasReference, 'shared');
  selected.id = 'owner'; sync();
  assert.equal(globals.referenceStructure.hidden, true, 'Canonical nodes use the shared quicklook entry, without a duplicate Atlas button');
  assert.equal(actions.children.length, 1);
  assert.equal(actions.children[0].dataset.atlasDetail, 'owner', 'A canonical structure owner retains its independent Open subdiagram action');
  actions.children[0].click();
  assert.deepEqual(requests, [['nested', undefined]]);
  delete globals.bundle.members.root.structureNodes; selected.id = 'shared'; sync();
  assert.equal(globals.referenceStructure.hidden, true, 'A canonical definition with no structure must not create a dead structure entry');
});
