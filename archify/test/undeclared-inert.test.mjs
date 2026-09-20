import assert from 'node:assert/strict';
import test from 'node:test';

import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

// The claim this branch makes is "a document that declares none of the new
// positions renders as it did before". Testing that with examples is sampling.
// This suite tests the dispatcher instead: the declaration switches are a
// finite set, so every combination of them can be compiled and checked, and the
// statement "feature present if and only if declared" is established for all of
// them rather than for the documents someone happened to write.
//
// The byte-level half of the claim stays where it can be checked: test/golden.mjs
// for the checked-in documents, and scripts/fuzz-legacy-equivalence.mjs, which
// compiles generated documents with a base revision's compiler and compares
// bytes, for the open-ended space.

const SWITCHES = ['rules', 'links', 'media', 'types', 'edgeStates', 'reader', 'suppress', 'bands'];
const OBSERVABLE = {
  rules: '09:45',
  links: 'https://example.com/x',
  media: 'example.com/p.jpg',
  types: 'SPOTKIND',
  edgeStates: 'data-edge-state="hot"',
  reader: 'archify-reader',
  suppress: 'data-suppressed',
  bands: 'BANDWORD',
};

function fixture(flags) {
  const spec = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'undeclared fixture', quality_profile: 'standard' },
    lanes: [{ id: 'l1', label: 'Lane' }],
    nodes: [
      { id: 'a', lane: 'l1', col: 0, type: flags.types ? 'spot' : 'frontend', label: 'A', width: 100, facts: { stay: 30 } },
      { id: 'b', lane: 'l1', col: 1, type: flags.types ? 'spot' : 'backend', label: 'B', width: 100, facts: { stay: 30 } },
      { id: 'c', lane: 'l1', col: 2, type: flags.types ? 'spot' : 'frontend', label: 'C', width: 100, facts: { stay: 30 } },
    ],
    edges: [
      { id: 'ab', from: 'a', to: 'b', label: 'go', facts: { ride: 15 } },
      { id: 'bc', from: 'b', to: 'c', label: 'go', facts: { ride: 15 } },
    ],
    cards: [],
  };
  if (flags.rules || flags.bands) {
    spec.meta.rules = [{
      id: 'clock',
      kind: 'accumulate',
      seeds: { l1: { start: 'a', base: '09:00' } },
      add: { node: 'stay', edge: 'ride' },
      render: { edge: '{value} ', ...(flags.bands ? { caption: '{band} · {minutes} 分' } : {}) },
    }];
  }
  if (flags.links) for (const node of spec.nodes) node.links = [{ label: 'spot', href: 'https://example.com/x' }];
  if (flags.media) for (const node of spec.nodes) node.media = { href: 'https://example.com/p.jpg', alt: 'photo' };
  if (flags.types) spec.meta.types = [{ id: 'spot', label: 'SPOTKIND', color: 'cyan' }];
  if (flags.edgeStates) {
    spec.meta.edgeStates = [{ id: 'hot', color: 'rose' }];
    for (const edge of spec.edges) edge.state = 'hot';
  }
  if (flags.reader) {
    spec.meta.reader = { store: true, slots: [{ id: 'here', kind: 'point', label: 'here' }] };
    if (flags.suppress) spec.meta.reader.suppress = ['chapter_delta'];
  }
  if (flags.bands) spec.meta.bands = [{ id: 'morning', label: 'BANDWORD', from: '05:00', to: '11:59' }];
  return spec;
}

test('every declaration switch is inert until it is declared', () => {
  const total = 1 << SWITCHES.length;
  const leaks = [];
  for (let mask = 0; mask < total; mask += 1) {
    const flags = {};
    SWITCHES.forEach((flag, index) => { flags[flag] = Boolean(mask & (1 << index)); });
    // Suppression lives inside the reader's declaration; there is no suppression
    // without a reader to suppress in.
    if (flags.suppress) flags.reader = true;
    const compiled = compileWorkflow({ workflow: fixture(flags) });
    assert.equal(compiled.ok, true, JSON.stringify(flags) + ': ' + JSON.stringify((compiled.diagnostics || []).map((d) => d.code)));
    const text = (compiled.svg || '') + (compiled.runtime || '') + JSON.stringify(compiled.receipt || {});
    for (const flag of SWITCHES) {
      const declared = Boolean(flags[flag]) || (flag === 'rules' && flags.bands);
      if (text.includes(OBSERVABLE[flag]) !== declared) {
        leaks.push(flag + ' declared=' + Boolean(flags[flag]) + ' behind ' + JSON.stringify(flags));
      }
    }
  }
  assert.deepEqual(leaks, [], total + ' switch combinations: a feature appeared without its declaration, or vanished with it');
});

test('the same document compiles to the same bytes twice', () => {
  for (const flags of [{}, { rules: true }, { rules: true, bands: true, reader: true, edgeStates: true }]) {
    const first = compileWorkflow({ workflow: fixture(flags) });
    const second = compileWorkflow({ workflow: fixture(flags) });
    assert.equal(first.svg, second.svg, JSON.stringify(flags));
    assert.equal(first.runtime, second.runtime, JSON.stringify(flags));
  }
});
