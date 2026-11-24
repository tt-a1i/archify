import { normalizeRoutePoints, rectsOverlap, segmentRectClearanceWithin } from './geometry.mjs';
import { createSpatialGrid } from './spatial-grid.mjs';
import { maskCoversArrowhead } from './arrowhead.mjs';

// A bounded fallback for an unpinned label whose usual position collides.
// It never routes an edge, moves a node, expands the canvas, or rewrites input.
export function placeAutomaticLabels({
  labels, routes, components, titles, viewBox, placementBottom = viewBox[1], fallbackRing = true, keepFallbackNearRoute = false,
  gridSweep = false, maxOwnRouteDistance = Infinity, protectedEndpoints = new Map(), onlyProtectedEndpoints = false,
  arrowheads = [], clearanceBorders = [], ownershipMargin = 0, repairOwnership = false, searchBand = false,
  coversRouteStroke = () => false, coversOwnShaft, coversFrame, preferShaftAttachment = false,
  canMove = () => true, allowsPlacement = () => true, requiresPlacement = () => false,
}) {
  const preferRouteMidpoint = Boolean(coversOwnShaft);
  const placed = [...labels];
  const obstacles = [...components, ...titles];
  const segments = routes.flatMap(({ relationIndex, points }) => {
    const normalized = normalizeRoutePoints(points);
    return normalized.slice(1).map((end, index) => ({ relationIndex, start: normalized[index], end }));
  });
  const inside = rect => (
    rect.x >= 0 && rect.y >= 0
    && rect.x + rect.width <= viewBox[0] && rect.y + rect.height <= viewBox[1]
  );
  // The mask test asked every segment about every candidate position. Segments
  // go into a uniform grid once, and a candidate only asks the cells it covers.
  const SEGMENT_CELL = 120;
  const segmentGrid = createSpatialGrid(SEGMENT_CELL);
  for (const segment of segments) {
    const [sx, sy] = segment.start;
    const [ex, ey] = segment.end;
    segmentGrid.insert({
      minX: Math.min(sx, ex), maxX: Math.max(sx, ex),
      minY: Math.min(sy, ey), maxY: Math.max(sy, ey),
    }, segment);
  }
  const segmentsNear = (rect, margin) => segmentGrid.query({
    minX: rect.x - margin, maxX: rect.x + rect.width + margin,
    minY: rect.y - margin, maxY: rect.y + rect.height + margin,
  });
  const masksRoute = rect => {
    for (const segment of segmentsNear(rect, 4)) {
      if (segment.relationIndex === rect.relationIndex) continue;
      if (segmentRectClearanceWithin(segment, rect, 4) + 0.0001 < 4) return true;
    }
    return false;
  };
  const overlapsLabel = (rect, index, gap = 0) => placed.some((other, otherIndex) => (
    otherIndex !== index && rectsOverlap(rect, other, gap)
  ));
  const coversEndpoint = rect => protectedEndpoints.get(rect.relationIndex)?.some(zone => rectsOverlap(rect, zone))
    || arrowheads.some(({ marker }) => maskCoversArrowhead(rect, marker));
  const touchesBorder = rect => coversFrame?.(rect)
    || clearanceBorders.some(part => segmentRectClearanceWithin(part, rect, 2) < 2 - 0.0001);
  const mustKeepOwner = new Set(labels.filter(label => touchesBorder(label) || arrowheads.some(({ relationIndex, marker }) =>
    relationIndex !== label.relationIndex && maskCoversArrowhead(label, marker))).map(label => label.relationIndex));
  function keepsOwner(rect) {
    if (!ownershipMargin && !mustKeepOwner.has(rect.relationIndex)) return true;
    let own = Infinity;
    for (const segment of segments) if (segment.relationIndex === rect.relationIndex) {
      own = Math.min(own, segmentRectClearanceWithin(segment, rect, own));
    }
    const limit = own + ownershipMargin;
    return Number.isFinite(limit) && segmentsNear(rect, limit).every(segment => {
      if (segment.relationIndex === rect.relationIndex) return true;
      const gap = segmentRectClearanceWithin(segment, rect, limit);
      return ownershipMargin ? gap + 0.0001 >= limit : gap > own;
    });
  }
  const distanceToOwner = (rect, ownSegments) => {
    let distance = Infinity;
    for (const segment of ownSegments) {
      distance = Math.min(distance, segmentRectClearanceWithin(segment, rect, distance));
    }
    return distance;
  };
  const cardDistance = (rect, limit) => {
    let distance = limit;
    for (const component of components) {
      const dx = Math.max(rect.x - component.x - component.width, component.x - rect.x - rect.width, 0);
      const dy = Math.max(rect.y - component.y - component.height, component.y - rect.y - rect.height, 0);
      distance = Math.min(distance, Math.hypot(dx, dy));
    }
    return distance;
  };
  const clear = (rect, index) => (
    allowsPlacement(rect) && inside(rect) && rect.y + rect.height <= placementBottom
    && !obstacles.some(obstacle => rectsOverlap(rect, obstacle, 2))
    && !overlapsLabel(rect, index, 2) && !masksRoute(rect) && !coversRouteStroke(rect)
    && !coversEndpoint(rect) && !touchesBorder(rect) && keepsOwner(rect)
    && (!Number.isFinite(maxOwnRouteDistance) || segments.some(segment =>
      segment.relationIndex === rect.relationIndex
      && segmentRectClearanceWithin(segment, rect, maxOwnRouteDistance) <= maxOwnRouteDistance))
  );
  const rectAt = (label, lx, ly) => ({
    ...label, lx, ly, x: lx - label.width / 2, y: ly - 10,
  });
  // Fixed fractions can miss a narrow free slot. Try the ends of the free
  // intervals beside an orthogonal segment, using obstacle edges rather
  // than a finer sampling grid. The ordinary clearance test still decides
  // whether a candidate is usable; this search never changes geometry.
  const slidingCandidates = (label, index, { start: a, end: b }) => {
    const horizontal = Math.abs(a[1] - b[1]) < 0.0001;
    if (!horizontal && Math.abs(a[0] - b[0]) >= 0.0001) return [];
    const axis = horizontal ? 'x' : 'y';
    const size = horizontal ? 'width' : 'height';
    const across = horizontal ? 'y' : 'x';
    const crossSize = horizontal ? 'height' : 'width';
    const low = Math.min(a[horizontal ? 0 : 1], b[horizontal ? 0 : 1]) + 8;
    const high = Math.max(a[horizontal ? 0 : 1], b[horizontal ? 0 : 1]) - label[size] - 8;
    if (high < low) return [];
    const offsets = horizontal
      ? [a[1] - 20, a[1] + 10, a[1] - 28, a[1] + 18]
      : [a[0] - label.width - 6, a[0] + 6, a[0] - label.width - 14, a[0] + 14];
    return offsets.flatMap(offset => {
      const band = { ...label, [axis]: low, [size]: high - low + label[size], [across]: offset };
      const blockers = [
        ...obstacles.map(rect => ({ rect, gap: 2 })),
        ...placed.filter((_, otherIndex) => otherIndex !== index).map(rect => ({ rect, gap: 2 })),
        ...segmentsNear(band, 4).filter(segment => segment.relationIndex !== label.relationIndex).map(segment => ({
          rect: {
            x: Math.min(segment.start[0], segment.end[0]), y: Math.min(segment.start[1], segment.end[1]),
            width: Math.abs(segment.end[0] - segment.start[0]), height: Math.abs(segment.end[1] - segment.start[1]),
          }, gap: 4,
        })),
      ];
      const positions = [Math.max(low, Math.min(high, label[axis])), low, high];
      for (const { rect, gap } of blockers) {
        if (offset + label[crossSize] + gap <= rect[across]
          || rect[across] + rect[crossSize] + gap <= offset) continue;
        positions.push(rect[axis] - gap - label[size], rect[axis] + rect[size] + gap);
      }
      return [...new Set(positions)].filter(position => position >= low && position <= high)
        .sort((left, right) => Math.abs(left - label[axis]) - Math.abs(right - label[axis]))
        .map(position => {
          const rect = { ...label, [axis]: position, [across]: offset };
          return rectAt(label, rect.x + label.width / 2, rect.y + 10);
        });
    });
  };
  // When the usual slots fail, sweep both sides and the centerline of
  // each owned segment. Clip the band to the canvas and bound the sampling
  // density on very long shafts. Retain the old anchor as a possible slot.
  const stations = (low, high, preferred, maximum) => {
    if (high < low) return [];
    const values = new Set([Math.max(low, Math.min(high, preferred)), high]);
    const step = Math.max(1, (high - low) / maximum);
    for (let at = low; at <= high; at += step) values.add(at);
    return [...values].sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
  };

  let remainingBandProbes = 100_000;
  function searchOwnedBand(label, index, ownSegments) {
    // Rank only a label that needs repair. The current clear positions
    // are already reserved and do not need another search.
    let anchorX = label.x + label.width / 2;
    let anchorY = label.y + label.height / 2;
    if (preferRouteMidpoint) {
      const lengths = ownSegments.map(({ start, end }) => Math.hypot(end[0] - start[0], end[1] - start[1]));
      let length = lengths.reduce((sum, value) => sum + value, 0) / 2;
      for (const [i, { start, end }] of ownSegments.entries()) {
        if (length <= lengths[i] && lengths[i] > 0) {
          const ratio = length / lengths[i];
          anchorX = start[0] + (end[0] - start[0]) * ratio;
          anchorY = start[1] + (end[1] - start[1]) * ratio;
          break;
        }
        length -= lengths[i];
      }
    }

    const reach = label.height * 3;
    // A feasible slot can extend just past a short segment's endpoint.
    const endReach = preferRouteMidpoint ? reach : 0;
    let best = null;
    let bestDistance = Infinity;
    let bestGap = Infinity;
    let bestCardGap = Infinity;
    // Permit a shaft interruption only if the current label has a hard
    // collision. A candidate that leaves the shaft clear always wins.
    let bestMasksShaft = !coversOwnShaft || needsPlacement(label, index);
    const accept = (rect, segment) => {
      if (!coversOwnShaft) {
        if (!clear(rect, index) || segmentRectClearanceWithin(segment, rect, reach) > reach) return false;
        best = rect;
        return true;
      }
      const dx = rect.x + rect.width / 2 - anchorX;
      const dy = rect.y + rect.height / 2 - anchorY;
      const distance = dx * dx + dy * dy;
      const gap = preferShaftAttachment ? distanceToOwner(rect, ownSegments) : 0;
      const cardGap = preferShaftAttachment ? Math.max(0, gap - cardDistance(rect, gap)) : 0;
      const order = cardGap - bestCardGap || gap - bestGap || distance - bestDistance;
      if (!bestMasksShaft && order >= 0) return false;
      const masksShaft = coversOwnShaft(rect);
      if ((masksShaft && !bestMasksShaft) || (masksShaft === bestMasksShaft && order >= 0)
        || !clear(rect, index) || segmentRectClearanceWithin(segment, rect, reach) > reach) return false;
      best = rect;
      bestDistance = distance;
      bestGap = gap;
      bestCardGap = cardGap;
      bestMasksShaft = masksShaft;
      return false;
    };
    const perSegment = Math.max(1, Math.floor(24_000 / ownSegments.length));
    for (const segment of ownSegments) {
      const { start, end } = segment;
      const horizontal = start[1] === end[1];
      if (!horizontal && start[0] !== end[0]) {
        const [dx, dy] = end.map((value, axis) => value - start[axis]);
        const length = Math.hypot(dx, dy);
        const [ux, uy] = [dx / length, dy / length];
        const halfWidth = label.width / 2;
        const halfHeight = label.height / 2;
        const [x, y] = [anchorX - start[0], anchorY - start[1]];
        const normalReach = Math.abs(uy) * halfWidth + Math.abs(ux) * halfHeight + reach;
        const across = stations(-normalReach, normalReach, -uy * x + ux * y,
          Math.max(2, Math.floor(Math.sqrt(perSegment)) - 3));
        const along = stations(-endReach, length + endReach, ux * x + uy * y, Math.max(2, Math.floor(perSegment / across.length) - 3));
        for (const offset of across) for (const position of along) {
          if (!remainingBandProbes) return best;
          remainingBandProbes -= 1;
          const rect = rectAt(label, start[0] + position * ux - offset * uy,
            start[1] + position * uy + offset * ux - halfHeight + 10);
          if (accept(rect, segment)) return best;
        }
        continue;
      }
      const axis = horizontal ? 0 : 1;
      const span = horizontal ? label.width : label.height;
      const thickness = horizontal ? label.height : label.width;
      const extent = [viewBox[0], placementBottom];
      const preferred = preferRouteMidpoint
        ? [anchorX - label.width / 2, anchorY - label.height / 2] : [label.x, label.y];
      const samples = Math.max(2, Math.floor(Math.sqrt(perSegment)) - 3);
      const offsets = stations(Math.max(0, start[1 - axis] - thickness - reach),
        Math.min(extent[1 - axis] - thickness, start[1 - axis] + reach), preferred[1 - axis], samples);
      if (!offsets.length) continue;
      const low = Math.max(0, Math.min(start[axis], end[axis]) - span / 2 - endReach);
      const high = Math.min(extent[axis] - span, Math.max(start[axis], end[axis]) - span / 2 + endReach);
      const run = stations(low, high, preferred[axis], Math.max(2, Math.floor(perSegment / offsets.length) - 3));
      if (!run.length) continue;
      // Reject card-blocked samples before constructing a candidate or testing
      // its strokes. Each row needs only the obstacles that touch its band.
      for (const offset of offsets) {
        const band = horizontal
          ? { x: low, y: offset, width: high - low + span, height: thickness }
          : { x: offset, y: low, width: thickness, height: high - low + span };
        const nearby = obstacles.filter(obstacle => rectsOverlap(band, obstacle, 2));
        const sample = { width: label.width, height: label.height, x: band.x, y: band.y };
        for (const position of run) {
          if (!remainingBandProbes) return best;
          remainingBandProbes -= 1;
          sample.x = horizontal ? position : offset;
          sample.y = horizontal ? offset : position;
          if (nearby.some(obstacle => rectsOverlap(sample, obstacle, 2))) continue;
          const { x, y } = sample;
          if (accept({ ...label, x, y, lx: x + label.width / 2, ly: y + 10 }, segment)) {
            return rectAt(label, best.lx, best.ly);
          }
        }
      }
    }
    return best;
  }

  // A close parallel of another relationship on one side (a reciprocal
  // pair) makes a label on that side read as the neighbour's: prefer the
  // far side.
  const parallelDistance = (relationIndex, a, b, axis) => {
    const across = 1 - axis;
    const [low, high] = [Math.min(a[axis], b[axis]), Math.max(a[axis], b[axis])];
    let nearest = null;
    for (const other of segments) {
      if (other.relationIndex === relationIndex) continue;
      if (Math.abs(other.start[across] - other.end[across]) > 0.0001) continue;
      const distance = other.start[across] - a[across];
      if (Math.abs(distance) < 0.0001 || Math.abs(distance) > 36) continue;
      const overlap = Math.min(high, Math.max(other.start[axis], other.end[axis]))
        - Math.max(low, Math.min(other.start[axis], other.end[axis]));
      if (overlap <= 0) continue;
      if (nearest === null || Math.abs(distance) < Math.abs(nearest)) nearest = distance;
    }
    return nearest;
  };
  const parallelOnLowSide = (relationIndex, a, b, axis) => {
    const nearest = parallelDistance(relationIndex, a, b, axis);
    return nearest !== null && nearest < 0;
  };

  // Keep labels on the same side of a multi-step vertical spine when one
  // side fits strictly more of its labels without collision.
  const preferRightSpine = new Set();
  if (repairOwnership && !onlyProtectedEndpoints) {
    const verticalEntries = [];
    for (const [index, label] of placed.entries()) {
      const own = segments.filter(segment => segment.relationIndex === label.relationIndex);
      if (own.length !== 1) continue;
      const { start: a, end: b } = own[0];
      if (Math.abs(a[0] - b[0]) >= 0.0001 || Math.abs(a[1] - b[1]) < label.height + 16) continue;
      if (parallelDistance(label.relationIndex, a, b, 1) !== null) continue;
      verticalEntries.push({ index, label, x: a[0], y: (a[1] + b[1]) / 2 + 3 });
    }
    verticalEntries.sort((left, right) => left.x - right.x);
    const spines = [];
    for (const entry of verticalEntries) {
      const spine = spines.at(-1);
      if (spine && Math.abs(entry.x - spine.x) <= 24) {
        spine.entries.push(entry);
        spine.x = spine.entries.reduce((sum, item) => sum + item.x, 0) / spine.entries.length;
      } else {
        spines.push({ x: entry.x, entries: [entry] });
      }
    }
    const staticClear = rect => (
      allowsPlacement(rect) && inside(rect) && rect.y + rect.height <= placementBottom
      && !obstacles.some(obstacle => rectsOverlap(rect, obstacle, 2))
      && !masksRoute(rect) && !coversRouteStroke(rect)
      && !coversEndpoint(rect) && !touchesBorder(rect) && keepsOwner(rect)
    );
    for (const { entries } of spines) {
      if (entries.length < 2) continue;
      let leftCount = 0;
      let rightCount = 0;
      for (const { label, x, y } of entries) {
        if (staticClear(rectAt(label, x - label.width / 2 - 6, y))) leftCount += 1;
        if (staticClear(rectAt(label, x + label.width / 2 + 6, y))) rightCount += 1;
      }
      if (rightCount > leftCount) {
        for (const { label } of entries) preferRightSpine.add(label.relationIndex);
      }
    }
  }

  // An opted-in grid layout runs parallel lines through shared gaps. Rank
  // every position along all of the label's own segments: beside the line
  // first, then centred on its own line (the plate interrupts only that
  // line), then stepping outward past neighbouring parallels.
  const gridCandidates = (label) => {
    const fractions = [0.5, 0.25, 0.75, 0.375, 0.625, 0.125, 0.875];
    const ranked = [];
    for (const { start: a, end: b } of segments.filter(segment => segment.relationIndex === label.relationIndex)) {
      if (Math.abs(a[1] - b[1]) < 0.0001 && Math.abs(a[0] - b[0]) >= label.width + 16) {
        const [above, below] = parallelOnLowSide(label.relationIndex, a, b, 0) ? [1, 0] : [0, 1];
        for (const fraction of fractions) {
          const x = a[0] + (b[0] - a[0]) * fraction;
          if (Math.min(Math.abs(x - a[0]), Math.abs(x - b[0])) < label.width / 2 + 6) continue;
          ranked.push([above, x, a[1] - 10], [below, x, a[1] + 20], [2, x, a[1] + 3], [3, x, a[1] - 18], [3, x, a[1] + 28]);
        }
      } else if (Math.abs(a[0] - b[0]) < 0.0001 && Math.abs(a[1] - b[1]) >= label.height + 16) {
        const leftFirst = !parallelOnLowSide(label.relationIndex, a, b, 1) && !preferRightSpine.has(label.relationIndex);
        for (const fraction of fractions) {
          const y = a[1] + (b[1] - a[1]) * fraction;
          if (Math.min(Math.abs(y - a[1]), Math.abs(y - b[1])) < label.height / 2 + 6) continue;
          ranked.push([2, a[0], y + 3]);
          [6, 14, 22, 30, 38, 46, 54].forEach((offset, step) => {
            const tier = step === 0 ? 0 : step === 1 ? 1 : 2 + step;
            const left = [tier + (leftFirst ? 0 : 0.5), a[0] - label.width / 2 - offset, y + 3];
            const right = [tier + (leftFirst ? 0.5 : 0), a[0] + label.width / 2 + offset, y + 3];
            ranked.push(left, right);
          });
        }
      }
    }
    return ranked.map((entry, order) => [...entry, order])
      .sort((left, right) => left[0] - right[0] || left[3] - right[3])
      .map(([, lx, ly]) => [lx, ly]);
  };

  const pinned = label => ['labelAt', 'labelDx', 'labelDy', 'labelSegment']
    .some(key => label.relation[key] !== undefined);
  const needsPlacement = (label, index) => requiresPlacement(label)
    || coversEndpoint(label) || touchesBorder(label) || coversRouteStroke(label)
    || (repairOwnership && !keepsOwner(label)) || (!onlyProtectedEndpoints && (!inside(label)
    || components.some(component => rectsOverlap(label, component, -2))
    || titles.some(title => rectsOverlap(label, title))
    || overlapsLabel(label, index) || masksRoute(label)));
  const placeLabel = (index, rerank) => {
    const label = placed[index];
    // Match actual defect thresholds before searching; a valid placement is
    // not a reason to restyle the diagram. New placements leave extra space.
    // The grid ranking already starts from the preferred position, so it
    // also re-ranks labels whose default spot is merely valid.
    if (!rerank && !needsPlacement(label, index) && !coversOwnShaft?.(label)) {
      if (repairOwnership && !onlyProtectedEndpoints) {
        const own = segments.filter(segment => segment.relationIndex === label.relationIndex);
        if (own.length === 1) {
          const { start: a, end: b } = own[0];
          if (Math.abs(a[1] - b[1]) < 0.0001 && label.y + label.height <= a[1]
              && parallelOnLowSide(label.relationIndex, a, b, 0)) {
            const outer = rectAt(label, label.lx, a[1] + 16);
            if (clear(outer, index)) placed[index] = outer;
          }
        }
      }
      return;
    }
    if (preferRouteMidpoint) {
      const replacement = searchOwnedBand(label, index, segments.filter(segment => segment.relationIndex === label.relationIndex));
      if (replacement) placed[index] = replacement;
      return;
    }
    if (rerank) {
      // Callers measure the plate one pixel higher than rectAt; test with a
      // pixel of slack so the chosen position also passes their clearance.
      const replacement = gridCandidates(label).map(([lx, ly]) => rectAt(label, lx, ly))
        .find(rect => clear({ ...rect, x: rect.x - 1, y: rect.y - 1, width: rect.width + 2, height: rect.height + 2 }, index));
      if (replacement) {
        placed[index] = replacement;
        return;
      }
    }
    for (const segment of segments.filter(segment => segment.relationIndex === label.relationIndex)) {
      const [a, b] = [segment.start, segment.end];
      let candidates = [];
      // These candidates sit beside the line. They need the same 2px node
      // clearance checked by clear(), not 8px reserved at each endpoint.
      // Extra endpoint padding can hide a valid outer slot for a reciprocal
      // pair and make the planner send its other arrow around both nodes.
      if (Math.abs(a[1] - b[1]) < 0.0001 && Math.abs(a[0] - b[0]) >= label.width + 4) {
        const belowFirst = repairOwnership && !onlyProtectedEndpoints && parallelOnLowSide(label.relationIndex, a, b, 0);
        candidates = [0.5, 0.25, 0.75, 0.125, 0.875].flatMap(fraction => {
          const x = a[0] + (b[0] - a[0]) * fraction;
          if (Math.min(Math.abs(x - a[0]), Math.abs(x - b[0])) < 8) return [];
          return belowFirst ? [
            [x, a[1] + 20],
            [x, a[1] - 10],
            [x, a[1] + 28],
            [x, a[1] - 18],
          ] : [
            [x, a[1] - 10],
            [x, a[1] + 20],
            [x, a[1] - 18],
            [x, a[1] + 28],
          ];
        });
      } else if (Math.abs(a[0] - b[0]) < 0.0001 && Math.abs(a[1] - b[1]) >= label.height + 16) {
        const rightFirst = repairOwnership && !onlyProtectedEndpoints
          && (parallelOnLowSide(label.relationIndex, a, b, 1) || preferRightSpine.has(label.relationIndex));
        candidates = [0.5, 0.25, 0.75, 0.125, 0.875].flatMap(fraction => {
          const y = a[1] + (b[1] - a[1]) * fraction;
          if (Math.min(Math.abs(y - a[1]), Math.abs(y - b[1])) < 8) return [];
          return rightFirst ? [
            [a[0] + label.width / 2 + 6, y + 3],
            [a[0] - label.width / 2 - 6, y + 3],
            [a[0] + label.width / 2 + 14, y + 3],
            [a[0] - label.width / 2 - 14, y + 3],
          ] : [
            [a[0] - label.width / 2 - 6, y + 3],
            [a[0] + label.width / 2 + 6, y + 3],
            [a[0] - label.width / 2 - 14, y + 3],
            [a[0] + label.width / 2 + 14, y + 3],
          ];
        });
      }
      if (ownershipMargin) {
        // Try a tighter attachment before placing a mask directly on its
        // shaft. In a narrow corridor these are still held to the neighbor
        // clearance, owner margin and marker checks below.
        if (a[0] === b[0] && Math.abs(a[1] - b[1]) >= label.height + 16) {
          for (const fraction of [0.5, 0.625, 0.375, 0.75, 0.25]) {
            const y = a[1] + (b[1] - a[1]) * fraction + 3;
            candidates.push([a[0] - label.width / 2 - 2, y], [a[0] + label.width / 2 + 2, y]);
          }
        }
        const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 3];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) >= 28) candidates.push(middle);
      }
      const replacement = candidates.map(([lx, ly]) => rectAt(label, lx, ly))
        .find(rect => clear(rect, index));
      if (replacement) {
        placed[index] = replacement;
        break;
      }
    }
    if (placed[index] !== label) return;
    const sliding = segments.filter(segment => segment.relationIndex === label.relationIndex)
      .flatMap(segment => slidingCandidates(label, index, segment)).find(rect => clear(rect, index));
    if (sliding) {
      placed[index] = sliding;
      return;
    }
    if (searchBand) {
      const own = segments.filter(segment => segment.relationIndex === label.relationIndex);
      const fromBand = searchOwnedBand(label, index, own);
      if (fromBand) {
        placed[index] = fromBand;
        return;
      }
    }
    if (!fallbackRing) return;

    // Dense but valid topologies can leave every point directly beside the
    // relationship occupied by another route. Search a small deterministic
    // ring around the current anchor and the relationship's segment centres.
    // A collision-free island above a node is not a readable edge label.
    // Architecture opts into keeping the mask within two label heights of
    // its own route; shared callers retain their existing policy. If no nearby
    // slot fits, retain the collision so validation can request more space.
    const ownSegments = segments.filter(segment => segment.relationIndex === label.relationIndex);
    const baseAnchors = [
      [label.lx, label.ly],
      ...ownSegments.map(segment => [
        (segment.start[0] + segment.end[0]) / 2,
        (segment.start[1] + segment.end[1]) / 2,
      ]),
    ];
    const horizontalStep = label.width / 2 + 12;
    const ringOffsets = [
      [0, -28], [0, 38],
      [-horizontalStep, -28], [horizontalStep, -28],
      [-horizontalStep, 38], [horizontalStep, 38],
      [-(label.width + 20), -52], [label.width + 20, -52],
      [-(label.width + 20), 62], [label.width + 20, 62],
      [-(label.width + 20), -76], [label.width + 20, -76],
      [-(label.width + 20), 86], [label.width + 20, 86],
    ];
    const fallback = baseAnchors.flatMap(([baseX, baseY]) => (
      ringOffsets.map(([dx, dy]) => rectAt(label, baseX + dx, baseY + dy))
    )).find(rect => clear(rect, index) && (!keepFallbackNearRoute || ownSegments.some(segment => (
      segmentRectClearanceWithin(segment, rect, label.height * 2) <= label.height * 2
    ))));
    if (fallback) placed[index] = fallback;
  };
  let pending = placed.flatMap((label, index) => !pinned(label) && canMove(label) ? [index] : []);
  // A later label can vacate the only slot available to an earlier one.
  // Retry only unresolved labels after a move; accepted placements clear all
  // current labels and fixed geometry, so each success retires one label.
  // A stalled pass ends the search, with at most one pass per input label.
  for (let pass = 0; pass < labels.length && pending.length; pass++) {
    let moved = false;
    for (const index of pending) {
      const before = placed[index];
      placeLabel(index, gridSweep && pass === 0);
      moved ||= placed[index] !== before;
    }
    if (!moved) break;
    pending = pending.filter(index => needsPlacement(placed[index], index) || coversOwnShaft?.(placed[index]));
  }
  return placed;
}

// The rect a single unpinned label would occupy given only its own route and
// the nodes: what the planner reserves before the remaining routes are laid.
// Only a placement beside the route itself is worth reserving; a label that
// would already need the fallback ring is left to the final placement pass.
export function reservedLabelRect({
  label, points, routes = [], labels = [], components, viewBox = [Infinity, Infinity], placementBottom = Infinity,
}) {
  const [rect] = placeAutomaticLabels({
    labels: [{ ...label, relationIndex: -1 }, ...labels.map(other => ({ ...other, relationIndex: -2 }))],
    routes: [{ relationIndex: -1, points }, ...routes],
    components,
    titles: [],
    viewBox,
    placementBottom,
    fallbackRing: false,
  });
  return components.some(component => rectsOverlap(rect, component, -2)) ? null : rect;
}
