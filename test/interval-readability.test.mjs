import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderIntervalLayout } from '../archify/renderers/interval/interval-layout.mjs';

test('long lane names reserve a gutter without changing shared coordinates', () => {
  const result = renderIntervalLayout({unitWidth:10,tracks:[{id:'a',label:'Long lane name',spans:[{from:0,to:10,label:'Range'}]},{id:'b',label:'B'}]});
  const origin = Number(result.svg.match(/data-x-origin="([^"]+)"/)[1]);
  assert.ok(origin >= 8 + 14 * 22 * .6 + 24 - 1e-9);
  assert.match(result.svg, /data-x-scale="72"/);
  assert.deepEqual(result.warnings, []);
});
test('numeric ticks hide binary floating point noise', () => {
  const result = renderIntervalLayout({unitWidth:1.6,tracks:[{id:'a'}]});
  assert.match(result.svg, />1\.2<\/text>/);
  assert.doesNotMatch(result.svg, /1\.200000000/);
});
test('nearby guide captions separate and retain a leader', () => {
  const result = renderIntervalLayout({unitWidth:20,tracks:[{id:'a',gapBefore:30}],anchors:{reset:{at:8,across:['a','a'],label:'Reset'},restart:{at:9.5,across:['a','a'],label:'Restart'}}});
  assert.deepEqual(result.warnings, []);
  assert.match(result.svg, /data-kind="label-leader"/);
});
test('a label leader can leave an object layered over its containing span', () => {
  const result = renderIntervalLayout({tracks:[{id:'a',height:64,spans:[{from:0,to:100}],objects:[{from:25,to:60,height:27,align:'bottom',label:'Pending'}]}]});
  assert.ok(!result.warnings.some(w => w.includes('leader') && w.includes('crosses')), result.warnings.join('\n'));
});
test('multiline captions reserve line height without changing interval coordinates', () => {
  const spec = {unitWidth:100,tracks:[{id:'a',height:80,spans:[{from:10,to:90,label:'First line\nSecond line'}]}]};
  const result = renderIntervalLayout(spec);
  assert.deepEqual(result.warnings, []);
  assert.match(result.svg, /<tspan[^>]+>First line<\/tspan>/);
  assert.match(result.svg, /<tspan[^>]+>Second line<\/tspan>/);
  const single = renderIntervalLayout({...spec,tracks:[{...spec.tracks[0],spans:[{...spec.tracks[0].spans[0],label:'First line'}]}]});
  assert.equal(result.svg.match(/data-x-scale="([^"]+)"/)[1], single.svg.match(/data-x-scale="([^"]+)"/)[1]);
  assert.equal(result.svg.match(/data-x-origin="([^"]+)"/)[1], single.svg.match(/data-x-origin="([^"]+)"/)[1]);
});

test('Tracks uses the shared grid and themed canvas without changing its coordinates', () => {
  const result = renderIntervalLayout({unitWidth:10,tracks:[{id:'a'}]});
  assert.match(result.svg, /class="c-grid"/);
  assert.match(result.svg, /data-kind="grid"/);
  assert.match(result.svg, /fill="var\(--mask\)"/);
  assert.match(result.svg, /data-x-scale="72"/);
});

test("Tracks measures wide glyphs using upstream text units", () => {
  const ascii = renderIntervalLayout({tracks:[{id:"a",label:"abcdefgh"}]});
  const wide = renderIntervalLayout({tracks:[{id:"a",label:"😀😀😀😀😀😀😀😀"}]});
  const origin = result => Number(result.svg.match(/data-x-origin="([^"]+)"/)[1]);
  assert.ok(origin(wide) > origin(ascii));
});

test('peer point captions with authored baseline differences report an association warning', () => {
  const result = renderIntervalLayout({ unitWidth: 100, tracks: [{ id: 'probes',
    points: [{ at: 10, label: 'First', labelOffset: [0, -8] },
      { at: 70, label: 'Second', labelOffset: [0, 8] }, { at: 95 }] }] });
  assert.ok(result.warnings.some(w => w.includes('different authored Y offsets')));
  assert.match(result.svg, /data-layout-offset="\[0,-8\]"/);
  assert.match(result.svg, /data-layout-offset="\[0,8\]"/);
});
