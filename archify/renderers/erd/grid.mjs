/** Banded grid placement for the ER IR. Not auto-layout: column widths and row
 *  band heights are measured from the boxes the author declares, so the same
 *  spec always produces the same coordinates. */

export const DEFAULT_ER_GRID = {
  mode: 'grid',
  origin: [40, 80],
  gapX: 56,
  gapY: 72,
  entityW: 200,
  headerH: 26,
  rowH: 16,
};

export function erGridLayout(er) {
  const raw = er.layout;
  if (!raw || raw.mode !== 'grid') return null;
  return { ...DEFAULT_ER_GRID, ...raw };
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
// how an author asks for a routing channel between two bands.
export function bandedLayout(entities, grid) {
  const widths = new Map();
  const heights = new Map();
  for (const entity of entities) {
    if (!Number.isInteger(entity.row) || !Number.isInteger(entity.col)) continue;
    widths.set(entity.col, Math.max(widths.get(entity.col) || 0, entity.width));
    heights.set(entity.row, Math.max(heights.get(entity.row) || 0, entity.height));
  }

  const columnX = new Map();
  const rowY = new Map();
  let x = grid.origin[0];
  const maxCol = Math.max(-1, ...widths.keys());
  for (let col = 0; col <= maxCol; col += 1) {
    columnX.set(col, x);
    x += (widths.get(col) || 0) + grid.gapX;
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
  if (!Number.isInteger(entity.row) || !Number.isInteger(entity.col)) return [NaN, NaN];
  const columnX = bands.columnX.get(entity.col);
  const rowY = bands.rowY.get(entity.row);
  if (!Number.isFinite(columnX) || !Number.isFinite(rowY)) return [NaN, NaN];
  // Centre each box in its column so the gaps on both sides stay equal; the
  // router reads those gaps as corridors.
  const columnWidth = bands.widths.get(entity.col) || entity.width;
  return [columnX + (columnWidth - entity.width) / 2, rowY];
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
