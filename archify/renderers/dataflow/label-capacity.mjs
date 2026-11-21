import { textUnits } from '../shared/utils.mjs';
import { rectsOverlap, segmentRectClearanceWithin } from '../shared/geometry.mjs';
import { changeEdgeLabelExtraWidth } from '../shared/change-marks.mjs';

export const FLOW_LABEL_HEIGHT = 16;
export function flowLabelSize(flow, lines = [flow.label]) {
  const longestLine = Math.max(...lines.map(textUnits), textUnits(flow.classification || ''));
  return {
    width: Math.round((Math.max(34, longestLine * 4.9 + 12) + changeEdgeLabelExtraWidth(flow)) * 10) / 10,
    height: FLOW_LABEL_HEIGHT + 11 * (lines.length - 1 + Number(Boolean(flow.classification))),
  };
}

// A last capacity repair after routing: two complete text rows can fit beside
// a short arrow where one wide row cannot. Never move a route or a valid label.
export function wrapBlockedFlowLabels({ labels, routes, components, titles, viewBox, placementBottom }) {
  const placed = [...labels];
  const segments = routes.flatMap(route => route.points.slice(1).map((end, index) => ({
    relationIndex: route.relationIndex, start: route.points[index], end,
  })));
  const inside = rect => rect.x >= 0 && rect.y >= 0
    && rect.x + rect.width <= viewBox[0] && rect.y + rect.height <= placementBottom;
  const masks = (segment, rect) => segmentRectClearanceWithin(segment, rect, 4) + 0.0001 < 4;
  const obstacles = [...components, ...titles];
  let wordSegmenter;
  for (const [index, label] of placed.entries()) {
    if (['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => label.relation[key] !== undefined)) continue;
    if (inside(label) && !components.some(rect => rectsOverlap(label, rect, -2))
      && !titles.some(rect => rectsOverlap(label, rect))
      && !placed.some((rect, i) => i !== index && rectsOverlap(label, rect))
      && !segments.some(segment => segment.relationIndex !== label.relationIndex && masks(segment, label))) continue;
    const text = label.label;
    wordSegmenter ||= new Intl.Segmenter(undefined, { granularity: 'word' });
    const shapes = [...wordSegmenter.segment(text)].slice(1).map(({ index: split }) => {
      const lines = [text.slice(0, split), text.slice(split)];
      return { lines, ...flowLabelSize(label.relation, lines) };
    }).filter(shape => shape.lines.every(line => line.trim()) && shape.width < label.width)
      .sort((a, b) => a.width - b.width).slice(0, 8);
    const blockers = [
      ...obstacles.map(rect => ({ rect, gap: 2 })),
      ...placed.filter((_, i) => i !== index).map(rect => ({ rect, gap: 2 })),
      ...segments.map(segment => ({ rect: {
        x: Math.min(segment.start[0], segment.end[0]), y: Math.min(segment.start[1], segment.end[1]),
        width: Math.abs(segment.end[0] - segment.start[0]), height: Math.abs(segment.end[1] - segment.start[1]),
      }, gap: 4 })),
    ];
    let probes = 0;
    const seen = new Set();
    search: for (const shape of shapes) {
      for (const segment of segments.filter(segment => segment.relationIndex === label.relationIndex)) {
        const [a, b] = [segment.start, segment.end];
        if (Math.abs(a[1] - b[1]) > 0.0001) continue;
        const low = Math.min(a[0], b[0]) + 8, high = Math.max(a[0], b[0]) - shape.width - 8;
        if (high < low) continue;
        const ys = [a[1] - shape.height - 4, a[1] + 4];
        if (label.y > a[1]) ys.reverse();
        for (const y of ys) {
          const positions = [Math.max(low, Math.min(high, label.lx - shape.width / 2)), low, high];
          for (const { rect, gap } of blockers) {
            if (y + shape.height + gap <= rect.y || rect.y + rect.height + gap <= y) continue;
            positions.push(rect.x - gap - shape.width, rect.x + rect.width + gap);
          }
          const xs = [...new Set(positions)].filter(x => x >= low && x <= high)
            .sort((a, b) => Math.abs(a + shape.width / 2 - label.lx) - Math.abs(b + shape.width / 2 - label.lx));
          for (const x of xs) {
            const key = `${x},${y},${shape.width},${shape.height}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (probes++ >= 64) break search;
            const rect = { ...label, ...shape, x, y, lx: x + shape.width / 2, ly: y + 11 };
            if (!inside(rect) || obstacles.some(other => rectsOverlap(rect, other, 2))
              || placed.some((other, i) => i !== index && rectsOverlap(rect, other, 2))
              || segments.some(segment => masks(segment, rect))) continue;
            placed[index] = rect;
            break search;
          }
        }
      }
    }
  }
  return placed;
}
