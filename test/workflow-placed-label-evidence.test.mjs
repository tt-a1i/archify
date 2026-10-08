import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';
import { rectsOverlap, segmentRectClearance } from '../archify/renderers/shared/geometry.mjs';

function fixture(kind, offset) {
  return {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Measured label collision', output: 'fixture.html', legend: { mode: 'hidden' } },
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'top', col: 2, type: 'backend', label: 'B' },
      { id: 'c', lane: 'bottom', col: 0, type: 'backend', label: 'C' },
      { id: 'd', lane: 'bottom', col: 2, type: 'backend', label: 'D' },
    ],
    edges: [
      { ...(kind === 'label-route' ? {} : { id: 'a-placed', label: 'Placed', labelDy: offset ?? (kind === 'label-label' ? 124 : 138) }), from: 'a', to: 'b', route: 'straight' },
      { id: 'z-candidate', from: 'c', to: 'd', route: 'straight', label: 'Candidate', ...(kind === 'label-route' ? { labelDy: offset ?? -110 } : {}) },
    ],
  };
}

for (const kind of ['label-label', 'route-label', 'label-route']) {
  for (const qualityProfile of ['standard', 'showcase']) {
    test(`${qualityProfile} placed-label diagnostics expose the actual ${kind} conflict`, () => {
      const document = fixture(kind);
      // Reverse authorship to verify evidence pointers survive canonical routing order.
      document.edges.reverse();
      const result = compileWorkflow({ workflow: document, qualityProfile });
      assert.equal(result.ok, false);
      const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/route-preset-conflict');
      assert.ok(diagnostic);
      const evidence = diagnostic.evidence;
      assert.equal(evidence.invariant, 'placed edge-label clearance');
      assert.equal(evidence.conflictType, kind);
      assert.deepEqual(evidence.candidateEdge, { edge: 'z-candidate', from: 'c', to: 'd', path: '/edges/0' });
      assert.deepEqual(evidence.otherEdge, { edge: kind === 'label-route' ? null : 'a-placed', from: 'a', to: 'b', path: '/edges/1' });
      assert.equal(evidence.candidateLabel.label, 'Candidate');
      assert.deepEqual(evidence.candidateLabel.rect, { x: 187.4, y: kind === 'label-route' ? 113 : 223, width: 53.199999999999996, height: 14 });
      if (kind === 'label-label') {
        assert.equal(evidence.otherLabel.label, 'Placed');
        assert.equal(evidence.rectangleMarginPx, -2);
        assert.equal(evidence.overlapPx.y, 14);
        assert.ok(rectsOverlap(evidence.candidateLabel.rect, evidence.otherLabel.rect, evidence.rectangleMarginPx));
        assert.equal(evidence.segment, undefined);
        assert.equal(evidence.measuredClearancePx, undefined);
      } else {
        assert.equal(evidence.segment.edge, kind === 'route-label' ? 'candidate' : 'other');
        assert.equal(evidence.segment.index, 0);
        assert.deepEqual(evidence.segment.from, [140, kind === 'route-label' ? 243 : 119]);
        assert.deepEqual(evidence.segment.to, [288, kind === 'route-label' ? 243 : 119]);
        const rect = kind === 'route-label' ? evidence.otherLabel.rect : evidence.candidateLabel.rect;
        assert.equal(evidence.measuredClearancePx, segmentRectClearance({ start: evidence.segment.from, end: evidence.segment.to }, rect));
        assert.equal(evidence.measuredClearancePx, 0);
        assert.equal(evidence.requiredClearancePx, 4);
        if (kind === 'label-route') assert.equal(evidence.otherLabel, undefined, 'an unlabeled obstacle route must not acquire a fabricated label');
      }
      for (const fix of diagnostic.supportedFixes) {
        const repaired = structuredClone(document);
        const preset = fix.match(/verified preset "([^"]+)"/)?.[1];
        if (preset) repaired.edges[0].route = preset;
        else delete repaired.edges[0].route;
        assert.equal(compileWorkflow({ workflow: repaired, qualityProfile }).ok, true, fix);
      }
    });
  }
}

for (const qualityProfile of ['standard', 'showcase']) {
  test(`${qualityProfile} scaled placed-label diagnostics preserve measured geometry and replayable repairs`, () => {
    const document = fixture('label-label', 151);
    document.meta.typography_scale = 1.5;
    // 作者顺序与路由顺序相反，诊断仍须指向作者的原始边索引。
    document.edges.reverse();
    const result = compileWorkflow({ workflow: document, qualityProfile });
    assert.equal(result.ok, false);
    const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/route-preset-conflict');
    assert.ok(diagnostic);
    const evidence = diagnostic.evidence;
    assert.equal(evidence.invariant, 'placed edge-label clearance');
    assert.equal(evidence.conflictType, 'label-label');
    assert.deepEqual(evidence.candidateEdge, { edge: 'z-candidate', from: 'c', to: 'd', path: '/edges/0' });
    assert.deepEqual(evidence.otherEdge, { edge: 'a-placed', from: 'a', to: 'b', path: '/edges/1' });
    // 固定此输入的实际矩形，避免用实现中的字体换算公式生成预期值。
    assert.deepEqual(evidence.candidateLabel, {
      label: 'Candidate', rect: { x: 176.6, y: 274, width: 74.8, height: 21 },
    });
    assert.deepEqual(evidence.otherLabel, {
      label: 'Placed', rect: { x: 187.4, y: 274, width: 53.2, height: 21 },
    });
    assert.equal(evidence.overlapPx.y, 21);
    assert.ok(diagnostic.supportedFixes.length > 0);
    for (const fix of diagnostic.supportedFixes) {
      const repaired = structuredClone(document);
      const preset = fix.match(/verified preset "([^"]+)"/)?.[1];
      if (preset) repaired.edges[0].route = preset;
      else {
        assert.match(fix, /^remove route from edge "z-candidate"/);
        delete repaired.edges[0].route;
      }
      assert.equal(compileWorkflow({ workflow: repaired, qualityProfile }).ok, true, fix);
    }
  });
}

test('placed-label acceptance retains the 2px overlap tolerance and 4px route clearance boundary', () => {
  for (const qualityProfile of ['standard', 'showcase']) {
    for (const [kind, offset] of [['label-label', 112], ['route-label', 148], ['label-route', -122]]) {
      const result = compileWorkflow({ workflow: fixture(kind, offset), qualityProfile });
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
      assert.match(result.svg, /Candidate/);
    }
  }
});
