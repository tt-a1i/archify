/** Uniform spatial grid for "which items can this box reach" queries (#8). */

// A cell box wider than this is not worth walking: the query returns every
// inserted item instead, which stays a superset of what the box reaches.
const DEFAULT_MAX_CELLS = 4096;

export function createSpatialGrid(cellSize, { maxCells = DEFAULT_MAX_CELLS } = {}) {
  const buckets = new Map();
  const items = [];
  // Items whose own box cannot be walked are candidates for every query.
  const overflow = [];
  const keyOf = (x, y) => x + ':' + y;
  const rangeOf = (box) => ({
    x0: Math.floor(box.minX / cellSize), x1: Math.floor(box.maxX / cellSize),
    y0: Math.floor(box.minY / cellSize), y1: Math.floor(box.maxY / cellSize),
  });
  // Finite coordinates can still land outside the safe-integer range, where
  // incrementing an index no longer advances it; and a legal coordinate can
  // name more cells than the grid is worth. Both cases stay out of the buckets
  // and are answered by the item list, so they never hang or allocate.
  const walkable = (range) => Number.isSafeInteger(range.x0) && Number.isSafeInteger(range.x1)
    && Number.isSafeInteger(range.y0) && Number.isSafeInteger(range.y1)
    && (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) <= maxCells;

  return {
    insert(box, item) {
      items.push(item);
      const range = rangeOf(box);
      if (!walkable(range)) {
        overflow.push(item);
        return;
      }
      for (let x = range.x0; x <= range.x1; x += 1) {
        for (let y = range.y0; y <= range.y1; y += 1) {
          const key = keyOf(x, y);
          let bucket = buckets.get(key);
          if (!bucket) { bucket = []; buckets.set(key, bucket); }
          bucket.push(item);
        }
      }
    },
    query(box) {
      const range = rangeOf(box);
      if (!walkable(range)) return items.slice();
      const seen = new Set();
      const found = [];
      for (let x = range.x0; x <= range.x1; x += 1) {
        for (let y = range.y0; y <= range.y1; y += 1) {
          const bucket = buckets.get(keyOf(x, y));
          if (!bucket) continue;
          for (const item of bucket) {
            if (seen.has(item)) continue;
            seen.add(item);
            found.push(item);
          }
        }
      }
      for (const item of overflow) {
        if (seen.has(item)) continue;
        seen.add(item);
        found.push(item);
      }
      return found;
    },
  };
}
