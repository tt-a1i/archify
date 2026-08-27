import { throwDiagnosticError } from './diagnostics.mjs';
import { rectsOverlap, segmentIntersectsRect } from './geometry.mjs';
import { esc, textUnits } from './utils.mjs';
import { translateMessage } from './i18n.mjs';

const DEFAULT_FONT_SIZE = 8;
const DEFAULT_ITEM_GAP = 22;
const DEFAULT_LINE_GAP = 22;
const DEFAULT_SWATCH_GAP = 8;
const TEXT_ADVANCE_EM = 0.62;
const INTERACTIVE_BADGE_ALLOWANCE = 21;

export function relationshipLegendObstacles(relations, { pointsFor, labelRectFor } = {}) {
  const obstacles = [];
  for (const [index, relation] of (Array.isArray(relations) ? relations : []).entries()) {
    const points = typeof pointsFor === 'function' ? pointsFor(relation, index) : [];
    const finitePoints = (Array.isArray(points) ? points : []).filter((point) => (
      Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
    ));
    for (let pointIndex = 0; pointIndex < finitePoints.length - 1; pointIndex += 1) {
      obstacles.push({
        kind: 'relationship-segment',
        start: finitePoints[pointIndex],
        end: finitePoints[pointIndex + 1],
      });
    }
    const labelRect = typeof labelRectFor === 'function' ? labelRectFor(relation, index) : null;
    if (labelRect && [labelRect.x, labelRect.y, labelRect.width, labelRect.height].every(Number.isFinite)) {
      obstacles.push({ kind: 'relationship-label', ...labelRect });
    }
  }
  return obstacles;
}

export function resolveLegend(config, catalog, presentKinds) {
  const mode = config?.mode || 'auto';
  if (mode === 'hidden') return [];
  const present = presentKinds instanceof Set ? presentKinds : new Set(presentKinds || []);
  const overrides = config?.entries || {};

  return catalog.flatMap((catalogEntry) => {
    const override = overrides[catalogEntry.kind] || {};
    const selectedByMode = mode === 'all' || present.has(catalogEntry.kind);
    const visible = override.visible === true || (selectedByMode && override.visible !== false);
    if (!visible) return [];
    return [{
      ...catalogEntry,
      label: override.label || catalogEntry.label,
      present: present.has(catalogEntry.kind),
      interactive: catalogEntry.interactive !== false && present.has(catalogEntry.kind),
    }];
  });
}

function measuredEntryWidth(entry, fontSize, swatchGap) {
  const swatchWidth = entry.swatchWidth ?? 14;
  return Math.ceil(
    swatchWidth
    + swatchGap
    + textUnits(entry.label) * fontSize * TEXT_ADVANCE_EM
    + (entry.interactive ? INTERACTIVE_BADGE_ALLOWANCE : 0),
  );
}

// One pure footprint calculation owns both auto-viewBox sizing and final SVG
// placement. Callers must not maintain a second approximation of legend width
// or row count; that would make generated geometry disagree with validation.
export function legendFootprint(entries, {
  width,
  fontSize = DEFAULT_FONT_SIZE,
  itemGap = DEFAULT_ITEM_GAP,
  lineGap = DEFAULT_LINE_GAP,
  swatchGap = DEFAULT_SWATCH_GAP,
} = {}) {
  if (!entries.length) {
    return { measured: [], rows: [], rowCount: 0, minWidth: 0, extraHeight: 0 };
  }
  const measured = entries.map((entry) => ({
    ...entry,
    width: measuredEntryWidth(entry, fontSize, entry.swatchGap ?? swatchGap),
  }));
  const rows = [[]];
  let cursor = 0;
  for (const entry of measured) {
    const row = rows.at(-1);
    const required = (row.length ? itemGap : 0) + entry.width;
    if (row.length && cursor + required > width) {
      rows.push([entry]);
      cursor = entry.width;
    } else {
      row.push(entry);
      cursor += required;
    }
  }
  return {
    measured,
    rows,
    rowCount: rows.length,
    minWidth: Math.max(...measured.map((entry) => entry.width)),
    extraHeight: (rows.length - 1) * lineGap,
  };
}

export function measureLegend(entries, {
  x,
  baselineY,
  width,
  fontSize = DEFAULT_FONT_SIZE,
  itemGap = DEFAULT_ITEM_GAP,
  lineGap = DEFAULT_LINE_GAP,
  swatchGap = DEFAULT_SWATCH_GAP,
  minTitleY = 0,
  obstacles = [],
  unfit = 'error',
  diagramType = 'diagram',
} = {}) {
  if (!entries.length) return { entries: [], rowCount: 0, titleY: null };
  const footprint = legendFootprint(entries, { width, fontSize, itemGap, lineGap, swatchGap });
  const tooWide = footprint.measured.find((entry) => entry.width > width);
  if (tooWide) {
    if (unfit === 'hide') return null;
    const message = `[legend/label-too-wide] ${diagramType} legend label for "${tooWide.kind}" needs ${tooWide.width}px but only ${width}px is available.`;
    throwDiagnosticError(message, [{
      code: 'legend/label-too-wide',
      severity: 'error',
      message,
      subject: { diagramType, path: `/meta/legend/entries/${tooWide.kind}/label` },
      evidence: { kind: tooWide.kind, measuredWidthPx: tooWide.width, availableWidthPx: width },
      supportedFixes: ['shorten the legend label or use a wider viewBox'],
    }]);
  }

  const titleY = baselineY - footprint.extraHeight - 20;
  const legendTopY = titleY - 10;
  if (legendTopY < minTitleY) {
    if (unfit === 'hide') return null;
    const message = `[legend/vertical-overflow] ${diagramType} legend needs ${footprint.rowCount} rows, which would start at y=${legendTopY} above the available legend band at y=${minTitleY}.`;
    throwDiagnosticError(message, [{
      code: 'legend/vertical-overflow',
      severity: 'error',
      message,
      subject: { diagramType, path: '/meta/legend' },
      evidence: { rowCount: footprint.rowCount, requiredTopY: legendTopY, availableTopY: minTitleY },
      supportedFixes: ['shorten legend labels, hide nonessential entries, or use a wider viewBox'],
    }]);
  }

  const positioned = [];
  footprint.rows.forEach((row, rowIndex) => {
    let entryX = x;
    const baseline = baselineY - (footprint.rowCount - rowIndex - 1) * lineGap;
    for (const entry of row) {
      positioned.push({ ...entry, x: entryX, baseline, row: rowIndex });
      entryX += entry.width + itemGap;
    }
  });

  const legendRects = [
    { kind: 'title', x, y: legendTopY, width: 48, height: 14 },
    ...positioned.map((entry) => ({
      kind: entry.kind,
      x: entry.x,
      y: entry.baseline - 10,
      width: entry.width,
      height: 14,
    })),
  ];
  const collision = legendRects.find((legendRect) => obstacles.some((obstacle) => (
    Array.isArray(obstacle.start) && Array.isArray(obstacle.end)
      ? segmentIntersectsRect({ start: obstacle.start, end: obstacle.end }, legendRect)
      : rectsOverlap(obstacle, legendRect)
  )));
  if (collision) {
    if (unfit === 'hide') return null;
    const message = `[legend/content-overlap] ${diagramType} legend entry "${collision.kind}" overlaps authored relationship geometry.`;
    throwDiagnosticError(message, [{
      code: 'legend/content-overlap',
      severity: 'error',
      message,
      subject: { diagramType, path: '/meta/legend' },
      evidence: { legendKind: collision.kind, legendRect: collision },
      supportedFixes: ['shorten or hide legend entries, use a wider viewBox, or move the authored relationship route/label out of the legend band'],
    }]);
  }

  return {
    entries: positioned,
    rowCount: footprint.rowCount,
    titleY,
    fontSize,
  };
}

export function renderLegend({ entries, layout, renderSwatch, locale }) {
  if (!entries.length) return '';
  const measured = measureLegend(entries, layout);
  if (!measured) return '';
  const hasInteractiveEntries = measured.entries.some((entry) => entry.interactive);
  const renderedFontSize = measured.fontSize < 8 ? measured.fontSize + 0.5 : measured.fontSize + 2;
  const rootAttributes = hasInteractiveEntries ? ' data-legend="" data-legend-bridge=""' : ' data-legend=""';
  const parts = [
    `        <g${rootAttributes}>`,
    `          <text x="${layout.x}" y="${measured.titleY}" class="t-primary" font-size="12" font-weight="650">${esc(translateMessage(locale, 'legend.title'))}</text>`,
  ];

  for (const entry of measured.entries) {
    const interactive = entry.interactive
      ? ` data-legend-kind="${esc(entry.kind)}" data-legend-label="${esc(entry.label)}"`
      : '';
    parts.push(`          <g data-legend-semantic-kind="${esc(entry.kind)}"${interactive} data-legend-x="${entry.x}" data-legend-baseline="${entry.baseline}" data-legend-width="${entry.width}">`);
    parts.push(`            ${renderSwatch(entry)}`);
    parts.push(`            <text x="${entry.x + (entry.swatchWidth ?? 14) + (entry.swatchGap ?? DEFAULT_SWATCH_GAP)}" y="${entry.baseline}" class="t-muted" font-size="${renderedFontSize}" font-weight="500">${esc(entry.label)}</text>`);
    parts.push('          </g>');
  }
  parts.push('        </g>');
  return parts.join('\n');
}
