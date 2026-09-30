import test from 'node:test';
import assert from 'node:assert/strict';
import { legendFootprint, measureLegend, renderLegend } from '../renderers/shared/legend.mjs';

const entries = [
  { kind: 'backend', label: 'Backend', interactive: false },
  { kind: 'database', label: 'Database', interactive: false },
];
const layout = { x: 20, baselineY: 200, width: 300, fontSize: 7, itemGap: 7 };
const swatch = (entry) => `<rect x="${entry.x}" y="${entry.baseline - 8}" width="14" height="9"/>`;

test('omitted legend typography keeps the existing rendering and placement', () => {
  const measured = measureLegend(entries, layout);
  assert.equal(measured.titleY, 180);
  assert.deepEqual(measured.entries.map(({ x, baseline, width }) => ({ x, baseline, width })), [
    { x: 20, baseline: 200, width: 53 },
    { x: 80, baseline: 200, width: 57 },
  ]);
  assert.equal(renderLegend({ entries: entries.slice(0, 1), layout, renderSwatch: swatch, locale: 'en' }), [
    '        <g data-legend="">',
    '          <text x="20" y="180" class="t-primary" font-size="12" font-weight="650">Legend</text>',
    '          <g data-legend-semantic-kind="backend" data-legend-x="20" data-legend-baseline="200" data-legend-width="53">',
    '            <rect x="20" y="192" width="14" height="9"/>',
    '            <text x="42" y="200" class="t-muted" font-size="7.5" font-weight="500">Backend</text>',
    '          </g>',
    '        </g>',
  ].join('\n'));
});

test('explicit legend typography measures the font that is rendered', () => {
  const scaled = { ...layout, width: 160, renderedFontSize: 15, titleFontSize: 24, lineGap: 44 };
  const footprint = legendFootprint(entries, scaled);
  const measured = measureLegend(entries, scaled);
  assert.deepEqual(footprint.measured.map(({ width }) => width), [88, 97]);
  assert.equal(footprint.rowCount, 2);
  assert.equal(footprint.extraHeight, 44);
  assert.equal(measured.entries[1].baseline - measured.entries[0].baseline, 44);
  const svg = renderLegend({ entries, layout: scaled, renderSwatch: swatch, locale: 'en' });
  assert.match(svg, /font-size="24"[^>]*>Legend/);
  assert.match(svg, /font-size="15"[^>]*>Backend/);
  assert.match(svg, /font-size="15"[^>]*>Database/);
  const [title, first, second] = measured.rects;
  assert.ok(title.y + title.height < first.y);
  assert.ok(first.y + first.height < second.y);
});

test('large legend rows reserve enough space even with the default line gap', () => {
  const scaled = { ...layout, width: 160, renderedFontSize: 24, titleFontSize: 24 };
  const footprint = legendFootprint(entries, scaled);
  const measured = measureLegend(entries, scaled);
  assert.equal(footprint.rowCount, 2);
  assert.ok(footprint.extraHeight > 22);
  assert.equal(footprint.extraHeight, measured.entries[1].baseline - measured.entries[0].baseline);
  assert.ok(measured.rects[1].y + measured.rects[1].height < measured.rects[2].y);
});

test('scaled legend rejects routes in the enlarged text bounds', () => {
  assert.throws(() => measureLegend(entries.slice(0, 1), {
    ...layout,
    renderedFontSize: 15,
    titleFontSize: 24,
    obstacles: [{ start: [20, 185], end: [108, 185] }],
  }), /legend\/content-overlap/);
});

test('scaled title and wrapped rows participate in available-height validation', () => {
  const scaled = { ...layout, width: 160, renderedFontSize: 15, titleFontSize: 24, lineGap: 44, minTitleY: 110 };
  assert.throws(() => measureLegend(entries, scaled), /legend\/vertical-overflow/);
  assert.equal(measureLegend(entries, { ...scaled, unfit: 'hide' }), null);
});
