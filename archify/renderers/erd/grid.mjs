/** Banded grid placement for the ER IR. Not auto-layout: column widths and row
 *  band heights are measured from the boxes the author declares, so the same
 *  spec always produces the same coordinates. */

export const DEFAULT_ER_GRID = {
  mode: 'grid',
  // The top origin leaves room for a domain caption above the first band, and
  // the left origin starts the first column inside the page margin so the
  // canvas is not edge-to-edge. Row bands are taller than the generic rhythm
  // because a table row is text a reader has to scan, not a node label.
  origin: [32, 40],
  gapX: 56,
  gapY: 44,
  // Wide enough for a long field name plus its SQL type at the legibility
  // sizes below (a 20-character name and a numeric(12,2) type).
  entityW: 240,
  // Header and row bands are sized for the field type legibility the reader
  // asked for: an 11-unit field name and a 10.5-unit type sit on a 20-unit
  // row, and the table name leads them on a 30-unit header.
  headerH: 30,
  rowH: 20,
};

export function erGridLayout(er) {
  const raw = er.layout;
  // Grid cells without a layout block mean the default grid, not absolute
  // coordinates that were never supplied.
  if (!raw) {
    const gridPlaced = (er.entities || []).some((entity) => Number.isFinite(entity?.row) && Number.isFinite(entity?.col));
    return gridPlaced ? { ...DEFAULT_ER_GRID } : null;
  }
  if (raw.mode !== 'grid') return null;
  return { ...DEFAULT_ER_GRID, ...raw };
}

// An entity may omit `width` and inherit the grid's default. Both the layout and
// the placement validator must resolve that the same way: reading `entity.width`
// directly turned the documented default into NaN and reported a placement
// failure for a box the schema accepts.
export function resolvedEntityWidth(entity, grid) {
  return Number.isFinite(entity?.width) ? entity.width : (grid?.entityW ?? DEFAULT_ER_GRID.entityW);
}

// One header band plus one band per declared column. An entity with no columns
// still needs a readable body, so the minimum is a single row.
export function entityHeight(entity, grid) {
  const rows = Math.max(1, Array.isArray(entity.attributes) ? entity.attributes.length : 0);
  return grid.headerH + rows * grid.rowH + 6;
}

// Every raw column index owns the widest box placed in it and every raw row
// index owns the tallest, so boxes in one band share a baseline without anyone
// measuring by hand. Indices with no box still contribute their gap, which is
// how an author asks for a routing channel between two bands. A box on a half
// column (a class grid's `col: 1.5`) is centred between two columns: it sizes
// its row but neither column.
const gridColumn = (col) => Number.isInteger(col * 2) && col >= 0;
// `columnGaps` raises the gap after a column to a measured floor (see the
// renderer's relationship-label demand); the authored or default gapX stays
// the minimum everywhere, so an absent map reproduces the plain grid.
export function bandedLayout(entities, grid, { columnGaps = null } = {}) {
  const widths = new Map();
  const heights = new Map();
  let maxCol = -1;
  for (const entity of entities) {
    if (!Number.isInteger(entity.row) || !gridColumn(entity.col)) continue;
    maxCol = Math.max(maxCol, Math.ceil(entity.col));
    if (Number.isInteger(entity.col)) widths.set(entity.col, Math.max(widths.get(entity.col) || 0, resolvedEntityWidth(entity, grid)));
    heights.set(entity.row, Math.max(heights.get(entity.row) || 0, entity.height));
  }

  const columnX = new Map();
  const rowY = new Map();
  let x = grid.origin[0];
  for (let col = 0; col <= maxCol; col += 1) {
    columnX.set(col, x);
    x += (widths.get(col) || 0) + Math.max(grid.gapX, columnGaps?.get(col) || 0);
  }
  // A half-column box may be wider than its empty neighbouring bands. Keep
  // every grid box inside the left margin without changing integer-only grids.
  let leftInset = 0;
  for (const entity of entities) {
    if (!Number.isInteger(entity.row) || !gridColumn(entity.col) || Number.isInteger(entity.col)) continue;
    const centre = (col) => columnX.get(col) + (widths.get(col) || 0) / 2;
    const midpoint = (centre(Math.floor(entity.col)) + centre(Math.ceil(entity.col))) / 2;
    leftInset = Math.max(leftInset, grid.origin[0] - midpoint + resolvedEntityWidth(entity, grid) / 2);
  }
  if (leftInset > 0) {
    for (const [col, column] of columnX) columnX.set(col, column + leftInset);
    x += leftInset;
  }
  let y = grid.origin[1];
  const maxRow = Math.max(-1, ...heights.keys());
  for (let row = 0; row <= maxRow; row += 1) {
    rowY.set(row, y);
    y += (heights.get(row) || 0) + grid.gapY;
  }

  return { columnX, rowY, widths, heights, totalWidth: x, totalHeight: y };
}

export function resolveEntityPos(entity, grid, bands) {
  if (Array.isArray(entity.pos) && entity.pos.length === 2) return entity.pos;
  if (!grid || !bands) return [NaN, NaN];
  if (!Number.isInteger(entity.row) || !gridColumn(entity.col)) return [NaN, NaN];
  const width = resolvedEntityWidth(entity, grid);
  const rowY = bands.rowY.get(entity.row);
  if (!Number.isInteger(entity.col)) {
    const centre = (col) => bands.columnX.get(col) + (bands.widths.get(col) || 0) / 2;
    const [left, right] = [Math.floor(entity.col), Math.ceil(entity.col)];
    if (![bands.columnX.get(left), bands.columnX.get(right), rowY].every(Number.isFinite)) return [NaN, NaN];
    return [(centre(left) + centre(right)) / 2 - width / 2, rowY];
  }
  const columnX = bands.columnX.get(entity.col);
  if (!Number.isFinite(columnX) || !Number.isFinite(rowY)) return [NaN, NaN];
  // Centre each box in its column so the gaps on both sides stay equal; the
  // router reads those gaps as corridors.
  const columnWidth = bands.widths.get(entity.col) || width;
  return [columnX + (columnWidth - width) / 2, rowY];
}

export function validateErGridPlacement(er, grid, bands, problems) {
  const seen = new Map();
  for (const entity of er.entities ?? []) {
    const hasPos = Array.isArray(entity.pos) && entity.pos.length === 2;
    if (!hasPos && !grid) {
      problems.push(`Entity "${entity.id}" needs pos [x,y] or a grid layout with row/col.`);
      continue;
    }
    if (hasPos) continue;
    if (!Number.isInteger(entity.row) || !Number.isInteger(entity.col)) {
      problems.push(`Entity "${entity.id}" needs pos [x,y] or grid row/col when layout.mode is "grid".`);
      continue;
    }
    if (entity.row < 0 || entity.col < 0) {
      problems.push(`Entity "${entity.id}" row/col must be non-negative integers.`);
      continue;
    }
    const key = `${entity.row},${entity.col}`;
    if (seen.has(key)) {
      problems.push(`Entities "${seen.get(key)}" and "${entity.id}" share grid cell row ${entity.row} col ${entity.col}.`);
    } else {
      seen.set(key, entity.id);
    }
    const [x, y] = resolveEntityPos(entity, grid, bands);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      problems.push(`Entity "${entity.id}" could not be placed from row ${entity.row} col ${entity.col}.`);
    }
  }
}
