import { textUnits } from '../shared/utils.mjs';
import { brandMarkFor } from '../shared/brand-marks.mjs';
import { fittedNodeFontSize, nodeLabelLayout } from '../shared/text-fit.mjs';

// One profile drives both the planner and SVG serialization. Scale 1 retains
// the fixed geometry and shrink-to-fit behavior of existing documents.
export function workflowTypography(workflow) {
  const scale = workflow.schema_version === 2 ? (workflow.meta?.typography_scale ?? 1) : 1;
  const px = (value) => Math.round(value * scale * 100) / 100;
  return {
    scale,
    labelPreferred: px(11), labelMinimum: px(9),
    sublabelPreferred: px(8), sublabelMinimum: px(6),
    tagPreferred: px(7), tagMinimum: px(6),
    laneFont: px(10), laneAdvance: px(6.2), laneBaseline: px(22), laneTitleH: px(30),
    phaseFont: px(8), headingAdvance: px(5.6), phaseHeight: px(16),
    phaseBaseline: 27 + px(12), phaseLineY: 27 + px(8),
    groupInset: 8 + px(10) - 10,
    groupFont: px(7), groupAscent: px(10), groupHeight: px(14),
    edgeFont: px(8), edgeAdvance: px(4.8), edgeAscent: px(10), edgeHeight: px(14),
    laneY: 36 + px(16),
    legendOffset: px(44), bottomPadding: 124 + px(44) - 44,
    legend: scale === 1 ? { fontSize: 7, itemGap: 7 } : {
      fontSize: px(7), renderedFontSize: px(7.5), titleFontSize: px(12),
      lineGap: px(22), itemGap: 7,
    },
  };
}

export function workflowNodeSize(node, typography, source = false) {
  const { scale } = typography;
  let width = 92;
  if (scale !== 1) {
    width = Math.ceil(Math.max(width,
      textUnits(node.label) * typography.labelPreferred * 0.6 + 8 + (brandMarkFor(node) ? 48 : 0),
      textUnits(node.sublabel || '') * typography.sublabelPreferred * 0.6 + 8,
      textUnits(node.tag || '') * typography.tagPreferred * 0.6 + 8,
    ));
  }
  width = node.width ?? width;
  let height = node.height ?? Math.ceil((node.tag ? 68 : 52) * scale);
  // 先确定最终宽度，再为来源与品牌装饰下的真实文本行预留自动高度。
  if (scale !== 1 && node.height === undefined) {
    height = Math.max(height, workflowNodeMinimumHeight({ ...node, width }, typography, source));
  }
  return { width, height };
}

export function workflowNodeText(node, typography, source = false) {
  const width = brandMarkFor(node) ? Math.max(1, node.width - 48) : node.width;
  const labelFont = fittedNodeFontSize(node.label, width, typography.labelPreferred, typography.labelMinimum);
  const sublabelFont = fittedNodeFontSize(node.sublabel, node.width, typography.sublabelPreferred, typography.sublabelMinimum);
  const tagFont = fittedNodeFontSize(node.tag, node.width, typography.tagPreferred, typography.tagMinimum);
  const rows = [{ text: node.label, font: labelFont, y: 21 * typography.scale }];
  if (node.sublabel) rows.push({ text: node.sublabel, font: sublabelFont, y: 38 * typography.scale });
  if (node.tag) rows.push({ text: node.tag, font: tagFont, y: node.height - 12 * typography.scale });
  const layout = nodeLabelLayout({ width: node.width, height: node.height, rows,
    brand: Boolean(brandMarkFor(node)), source });
  return { rows, layout, labelFont, sublabelFont, tagFont };
}

// Measure the rows actually present. A compact authored one-line node need not
// reserve the automatic three-line box. Probe with enough height to retain the
// decoration rail rather than accepting nodeLabelLayout's cramped fallback.
export function workflowNodeMinimumHeight(node, typography, source = false) {
  const text = workflowNodeText({ ...node, tag: undefined, height: 256 * typography.scale }, typography, source);
  const bottom = Math.max(...text.rows.map((row, index) => text.layout.ys[index] + row.font * 0.3));
  if (!node.tag) return Math.ceil(bottom + 2);
  const tagFont = fittedNodeFontSize(node.tag, node.width, typography.tagPreferred, typography.tagMinimum);
  return Math.ceil(Math.max(bottom + 2 + tagFont * 1.2 + 12 * typography.scale,
    2 + tagFont * 0.3 + 12 * typography.scale));
}
