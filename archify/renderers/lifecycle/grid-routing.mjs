// Orthogonal router for schema_version 2 lifecycle diagrams.
//
// v2 states sit on a fixed grid: one row per lane and a shared column pitch,
// with empty gaps between rows and between columns. That structure lets
// every automatic transition use a small, predictable set of shapes instead
// of a general obstacle search:
//   - neighbours in one row connect with a horizontal line;
//   - other states in one row connect through the gap above (below for the
//     first row);
//   - states in different rows leave through the facing top/bottom side,
//     turn once in a row gap, and enter the target's facing side; when a
//     state blocks the straight descent, the route steps sideways through the
//     empty corridor between two columns.
// Ports on each side are spread in the order of where their routes head, and
// the horizontal runs in each gap get their own tracks, ordered to minimize
// crossings. Reciprocal pairs therefore render as two parallel lines.

import { rectsOverlap } from '../shared/geometry.mjs';

const PORT_GUTTER = 16;
const PORT_SPACING = 30;
const SNAP_LIMIT = 16;
const TRACK_TOP_CLEARANCE = 18;
const TRACK_BOTTOM_CLEARANCE = 18;
const PREFERRED_TRACK_SPACING = 22;
const MAX_TRACK_SPACING = 24;
const CORRIDOR_SPACING = 10;
const EXHAUSTIVE_TRACK_LIMIT = 7;

const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)])
    .map((rest) => [item, ...rest]));
}

export function createLifecycleGridRouter(states, transitions, { rowOf, columnXs, canvasWidth, bandTitles = [] }) {
  const byRow = new Map();
  for (const state of states.values()) {
    const row = rowOf(state);
    if (!Number.isInteger(row)) continue;
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(state);
  }
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const rowTop = new Map(rows.map((row) => [row, Math.min(...byRow.get(row).map((s) => s.y))]));
  const rowBottom = new Map(rows.map((row) => [row, Math.max(...byRow.get(row).map((s) => s.y + s.height))]));
  const nextRow = (row) => rows.find((candidate) => candidate > row);
  const previousRow = (row) => [...rows].reverse().find((candidate) => candidate < row);

  // Gap g sits below row g. The gap under the last row borders the legend,
  // so it only receives tracks when nothing else is possible.
  function gapBand(row) {
    const below = nextRow(row);
    const top = rowBottom.get(row) + TRACK_TOP_CLEARANCE;
    const bottom = below === undefined ? rowBottom.get(row) + 40 : rowTop.get(below) - TRACK_BOTTOM_CLEARANCE;
    return [top, Math.max(top, bottom)];
  }

  function blocksVertical(x, fromRow, toRow, exclude) {
    const [low, high] = fromRow < toRow ? [fromRow, toRow] : [toRow, fromRow];
    return [...states.values()].some((state) => {
      if (exclude.has(state.id)) return false;
      const row = rowOf(state);
      return row > low && row < high && x >= state.x - 6 && x <= state.x + state.width + 6;
    });
  }

  function blocksHorizontal(from, to) {
    const row = rowOf(from);
    const [left, right] = from.cx < to.cx ? [from, to] : [to, from];
    return byRow.get(row).some((state) => state !== left && state !== right
      && state.x < right.x && state.x + state.width > left.x + left.width
      && state.y < Math.max(left.y + left.height, right.y + right.height)
      && state.y + state.height > Math.min(left.y, right.y));
  }

  // The empty corridors between neighbouring columns.
  const corridorXs = columnXs.slice(1).map((x, index) => (x + columnXs[index]) / 2);
  const allStates = [...states.values()];
  const leftmostX = Math.min(...allStates.map((state) => state.cx));
  const rightmostX = Math.max(...allStates.map((state) => state.cx));
  const gridLeft = Math.min(...allStates.map((state) => state.x));
  const gridRight = Math.max(...allStates.map((state) => state.x + state.width));
  // The initial-state marker occupies a start state's left side.
  function loopBlocked(from, to, side) {
    if (side !== 'left') return false;
    const [low, high] = [Math.min(rowOf(from), rowOf(to)), Math.max(rowOf(from), rowOf(to))];
    return allStates.some((state) => state.type === 'start' && Math.abs(state.cx - from.cx) < 1
      && rowOf(state) >= low && rowOf(state) <= high);
  }

  // Plan: sides, the gap each horizontal run uses, and where each end heads.
  const plans = new Map();
  for (const transition of transitions) {
    const from = states.get(transition.from);
    const to = states.get(transition.to);
    if (!from || !to || from === to) continue;
    const fromRow = rowOf(from);
    const toRow = rowOf(to);
    if (!Number.isInteger(fromRow) || !Number.isInteger(toRow)) continue;
    const exclude = new Set([from.id, to.id]);
    if (fromRow === toRow) {
      if (!blocksHorizontal(from, to)) {
        const fromSide = to.cx > from.cx ? 'right' : 'left';
        plans.set(transition, { kind: 'horizontal', from, to, fromSide, toSide: opposite[fromSide] });
      } else {
        const gapRow = previousRow(fromRow);
        const useAbove = gapRow !== undefined;
        const side = useAbove ? 'top' : 'bottom';
        plans.set(transition, {
          kind: 'channel', from, to, fromSide: side, toSide: side,
          runs: [{ gap: useAbove ? gapRow : fromRow, legs: useAbove ? ['down', 'down'] : ['up', 'up'] }],
        });
      }
      continue;
    }
    const down = toRow > fromRow;
    const fromSide = down ? 'bottom' : 'top';
    const toSide = down ? 'top' : 'bottom';
    const gapNearTarget = down ? previousRow(toRow) : toRow;
    const gapNearSource = down ? fromRow : previousRow(fromRow);
    const legs = down ? ['up', 'down'] : ['down', 'up'];
    if (!blocksVertical(from.cx, fromRow, toRow, exclude) && Math.abs(from.cx - to.cx) < 1) {
      plans.set(transition, { kind: 'vertical', from, to, fromSide, toSide, runs: [{ gap: gapNearTarget, legs }] });
    } else if (!blocksVertical(from.cx, fromRow, toRow, exclude)) {
      plans.set(transition, { kind: 'channel', from, to, fromSide, toSide, runs: [{ gap: gapNearTarget, legs }] });
    } else if (!blocksVertical(to.cx, fromRow, toRow, exclude)) {
      plans.set(transition, { kind: 'channel', from, to, fromSide, toSide, runs: [{ gap: gapNearSource, legs }] });
    } else if (!transition.label && !transition.note
      && Math.abs(from.cx - to.cx) < 1 && (from.cx <= leftmostX || from.cx >= rightmostX)
      && !loopBlocked(from, to, from.cx <= leftmostX ? 'left' : 'right')) {
      // A blocked edge column loops around the outside of the grid, like a
      // bracket, instead of weaving through the rows' interior corridors.
      // The margin has no room for a label, so only unlabeled edges loop.
      const side = from.cx <= leftmostX ? 'left' : 'right';
      plans.set(transition, { kind: 'loop', from, to, fromSide: side, toSide: side, side });
    } else {
      const middle = (from.cx + to.cx) / 2;
      const corridor = corridorXs
        .filter((x) => !blocksVertical(x, fromRow, toRow, new Set()))
        .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
      plans.set(transition, corridor === undefined
        ? { kind: 'channel', from, to, fromSide, toSide, runs: [{ gap: gapNearTarget, legs }] }
        : {
          kind: 'corridor', from, to, fromSide, toSide, corridor,
          runs: [{ gap: gapNearSource, legs }, { gap: gapNearTarget, legs }],
        });
    }
  }

  // Corridor offsets: routes sharing one corridor run side by side.
  const corridorUse = new Map();
  for (const plan of plans.values()) {
    if (plan.kind !== 'corridor') continue;
    const list = corridorUse.get(plan.corridor) || [];
    list.push(plan);
    corridorUse.set(plan.corridor, list);
  }
  for (const [x, list] of corridorUse) {
    list.sort((a, b) => a.from.cx - b.from.cx || a.to.cx - b.to.cx);
    list.forEach((plan, index) => { plan.corridorX = x + (index - (list.length - 1) / 2) * CORRIDOR_SPACING; });
  }
  // Outer loops nest: a longer span sits further out so loops never cross.
  for (const side of ['left', 'right']) {
    const loops = [...plans.values()].filter((plan) => plan.kind === 'loop' && plan.side === side)
      .sort((a, b) => Math.abs(rowOf(a.from) - rowOf(a.to)) - Math.abs(rowOf(b.from) - rowOf(b.to)));
    loops.forEach((plan, index) => {
      plan.loopX = side === 'left' ? gridLeft - 18 - index * CORRIDOR_SPACING : gridRight + 18 + index * CORRIDOR_SPACING;
    });
  }

  // 只修复超出画布的外绕轨道。端点、节点和作者坐标保持不变；
  // 预算包括 crossover halo，轨道之间至少留 1px，不能靠重叠消除越界。
  const loopPadding = transition => ((transition.width || (transition.variant === 'emphasis' ? 1.6 : 1.1)) + 4) / 2;
  // 与渲染器共用标题几何，只在越界轨道重新拟合时保留左侧标题和 2px 间距。
  const leftGutter = Math.max(0, ...bandTitles.map(title => title.x + title.width + 2));
  function fitOuterLoops(entries, side, edge, compact = false) {
    const padding = Math.max(...entries.map(([transition]) => loopPadding(transition)));
    const space = (side === 'left' ? edge - leftGutter : canvasWidth - edge) - padding;
    const preferredSpacing = compact ? padding * 2 + 1 : Math.max(CORRIDOR_SPACING, padding * 2 + 1);
    const spacing = entries.length > 1 ? Math.min(preferredSpacing, (space - 8) / (entries.length - 1)) : 0;
    if (space < 8 || (entries.length > 1 && spacing < padding * 2 + 1)) return null;
    const inset = compact ? 8 : Math.min(18, space - spacing * (entries.length - 1));
    return entries.map((_, index) => edge + (side === 'left' ? -1 : 1) * (inset + index * spacing));
  }

  // 与 renderState() 的 initialMarkerShape(x - 22, x - 1, cy) 一致：
  // 圆点半径 4.5px，箭线和箭头都包含在这段标记区域中。
  const initialMarkers = allStates.filter(state => state.type === 'start').map(state => ({
    x: state.x - 26.5, y: state.cy - 4.5, width: 25.5, height: 9,
  }));
  function clearAlternateLoop(plan, side, x, padding) {
    if (loopBlocked(plan.from, plan.to, side)) return false;
    const bounds = (left, right, top, bottom) => ({ x: left, y: top, width: right - left, height: bottom - top });
    const horizontal = state => {
      const edge = side === 'left' ? state.x : state.x + state.width;
      return bounds(Math.min(x, edge), Math.max(x, edge), state.y, state.y + state.height);
    };
    // 用完整端口高度检查候选，避免重新分配端口后才撞到相邻状态。
    const corridors = [horizontal(plan.from), horizontal(plan.to),
      bounds(x, x, Math.min(plan.from.y, plan.to.y), Math.max(plan.from.y + plan.from.height, plan.to.y + plan.to.height))];
    const clear = (obstacle, clearance = Math.max(6, padding + 2)) => corridors.every(corridor => !rectsOverlap(corridor, obstacle, clearance));
    return allStates.every(state => state === plan.from || state === plan.to || clear(state))
      && initialMarkers.every(marker => clear(marker))
      && bandTitles.every(title => clear(title, padding + 2));
  }

  if (Number.isFinite(canvasWidth)) {
    // 固定原分组，防止已经换侧的路线被另一侧再次布局。
    const groups = ['left', 'right'].map(side => [side, [...plans]
      .filter(([, plan]) => plan.kind === 'loop' && plan.side === side)
      .sort(([, a], [, b]) => Math.abs(rowOf(a.from) - rowOf(a.to)) - Math.abs(rowOf(b.from) - rowOf(b.to)))]);
    // 两侧同时向内换道时先紧凑布局，避免相向的端点线合并成同一走廊。
    const compactAlternates = groups.every(([side, entries]) => entries.length
      && !fitOuterLoops(entries, side, side === 'left' ? gridLeft : gridRight));
    for (const [side, entries] of groups) {
      if (!entries.length || entries.every(([transition, plan]) => {
        const padding = loopPadding(transition);
        return plan.loopX >= padding && plan.loopX <= canvasWidth - padding;
      })) continue;
      let targetSide = side;
      let positions = fitOuterLoops(entries, side, side === 'left' ? gridLeft : gridRight);
      // 窄画布容不下清晰轨道时，未固定侧边的关系可使用状态另一侧
      // 的空闲走廊；先检查完整候选，失败时保留原有显式约束。
      if (!positions && entries.every(([transition]) => ['fromSide', 'toSide']
        .every(key => !transition[key] || transition[key] === 'auto'))) {
        targetSide = opposite[side];
        // 换侧边界覆盖本组所跨行中同列的完整状态，避免端点较窄时
        // 两个候选都落进中间宽节点；其他列仍由完整走廊检查排除。
        const envelope = allStates.filter(state => entries.some(([, plan]) =>
          Math.abs(state.cx - plan.from.cx) < 1
          && rowOf(state) >= Math.min(rowOf(plan.from), rowOf(plan.to))
          && rowOf(state) <= Math.max(rowOf(plan.from), rowOf(plan.to))));
        const endpoints = entries.flatMap(([, plan]) => [plan.from, plan.to]);
        const edges = [...new Set([endpoints, envelope].map(group => targetSide === 'left'
          ? Math.min(...group.map(state => state.x)) : Math.max(...group.map(state => state.x + state.width))))];
        // 先保留端点边界已经可用的短长嵌套分配，再扩大到中间状态；
        // 每个边界仅试常规和紧凑间距，所有候选都检查节点、标记和标题。
        for (const edge of edges) {
          for (const compact of compactAlternates ? [true, false] : [false, true]) {
            const candidate = fitOuterLoops(entries, targetSide, edge, compact);
            if (candidate && entries.every(([transition, plan], index) =>
              clearAlternateLoop(plan, targetSide, candidate[index], loopPadding(transition)))) {
              positions = candidate;
              break;
            }
          }
          if (positions) break;
        }
      }
      if (!positions) continue;
      entries.forEach(([, plan], index) => {
        plan.loopX = positions[index];
        plan.side = plan.fromSide = plan.toSide = targetSide;
      });
    }
  }

  // Where each end heads after leaving its side, used to order the ports.
  function headingFor(plan, end) {
    const self = end === 'source' ? plan.from : plan.to;
    const other = end === 'source' ? plan.to : plan.from;
    if (plan.kind === 'horizontal' || plan.kind === 'loop') return other.cy;
    if (plan.kind === 'corridor') return plan.corridorX;
    return other === self ? self.cx : other.cx;
  }

  const sideEnds = new Map();
  for (const [transition, plan] of plans) {
    for (const end of ['source', 'target']) {
      const state = end === 'source' ? plan.from : plan.to;
      const side = end === 'source' ? plan.fromSide : plan.toSide;
      const key = `${state.id}:${side}`;
      if (!sideEnds.has(key)) sideEnds.set(key, { state, side, ends: [] });
      // Movers in the positive direction (right/down) take the first slot so
      // both ends of a reciprocal pair line up.
      const positive = plan.kind === 'horizontal'
        ? plan.to.cx > plan.from.cx
        : rowOf(plan.to) > rowOf(plan.from) || (rowOf(plan.to) === rowOf(plan.from) && plan.to.cx > plan.from.cx);
      sideEnds.get(key).ends.push({ transition, end, heading: headingFor(plan, end), positive });
    }
  }

  const ports = new Map();
  for (const { state, side, ends } of sideEnds.values()) {
    ends.sort((a, b) => a.heading - b.heading || Number(b.positive) - Number(a.positive));
    const horizontalSide = side === 'top' || side === 'bottom';
    const length = horizontalSide ? state.width : state.height;
    const gutter = Math.min(PORT_GUTTER, length / 4);
    const spacing = ends.length > 1 ? Math.min(PORT_SPACING, (length - gutter * 2) / (ends.length - 1)) : 0;
    ends.forEach((entry, index) => {
      const offset = (index - (ends.length - 1) / 2) * spacing;
      const point = horizontalSide
        ? [state.cx + offset, side === 'top' ? state.y : state.y + state.height]
        : [side === 'left' ? state.x : state.x + state.width, state.cy + offset];
      const record = ports.get(entry.transition) || {};
      record[entry.end] = point;
      ports.set(entry.transition, record);
    });
  }

  // Straight connections whose spread ports landed a few px apart would
  // otherwise need a jog shorter than a readable turn: move one end onto the
  // other's line when that side still has room there.
  function sideRange(state, side) {
    return side === 'top' || side === 'bottom'
      ? [state.x + PORT_GUTTER / 2, state.x + state.width - PORT_GUTTER / 2]
      : [state.y + PORT_GUTTER / 2, state.y + state.height - PORT_GUTTER / 2];
  }
  function portsOnSide(state, side, except) {
    return (sideEnds.get(`${state.id}:${side}`)?.ends || [])
      .filter((entry) => entry.transition !== except)
      .map((entry) => ports.get(entry.transition)[entry.end]);
  }
  for (const [transition, plan] of plans) {
    const record = ports.get(transition);
    const axis = plan.kind === 'horizontal' ? 1 : 0;
    const delta = Math.abs(record.source[axis] - record.target[axis]);
    if (delta < 0.5 || delta >= SNAP_LIMIT || !(plan.kind === 'horizontal' || plan.kind === 'vertical' || plan.kind === 'channel')) continue;
    for (const [end, fixed] of [['target', 'source'], ['source', 'target']]) {
      const state = end === 'source' ? plan.from : plan.to;
      const side = end === 'source' ? plan.fromSide : plan.toSide;
      const value = record[fixed][axis];
      const [low, high] = sideRange(state, side);
      const crowded = portsOnSide(state, side, transition).some((point) => Math.abs(point[axis] - value) < 10);
      if (value >= low && value <= high && !crowded) {
        record[end] = axis ? [record[end][0], value] : [value, record[end][1]];
        break;
      }
    }
  }

  // Horizontal runs per gap, then tracks ordered to minimize crossings.
  const runsByGap = new Map();
  for (const [transition, plan] of plans) {
    if (plan.kind === 'horizontal' || plan.kind === 'loop') continue;
    const { source, target } = ports.get(transition);
    plan.runs.forEach((run, index) => {
      const x1 = index === 0 ? source[0] : plan.corridorX;
      const x2 = plan.kind === 'corridor' && index === 0 ? plan.corridorX : target[0];
      if (plan.kind !== 'corridor' && Math.abs(x1 - x2) < 0.5) return;
      const entry = { transition, index, x1, x2, legs: run.legs };
      if (!runsByGap.has(run.gap)) runsByGap.set(run.gap, []);
      runsByGap.get(run.gap).push(entry);
    });
  }

  const trackY = new Map();
  const trackCounts = new Map();
  for (const [gap, runs] of runsByGap) {
    const [top, bottom] = gapBand(gap);
    // Greedy interval colouring keeps unrelated runs on shared tracks only
    // when they do not overlap.
    const sorted = [...runs].sort((a, b) => Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2));
    const classes = [];
    for (const run of sorted) {
      const low = Math.min(run.x1, run.x2) - 8;
      const high = Math.max(run.x1, run.x2) + 8;
      let target = classes.find((members) => members.every((other) => (
        high < Math.min(other.x1, other.x2) - 8 || low > Math.max(other.x1, other.x2) + 8
      )));
      if (!target || runs.length <= EXHAUSTIVE_TRACK_LIMIT) {
        target = [];
        classes.push(target);
      }
      target.push(run);
    }
    const count = classes.length;
    trackCounts.set(gap, count);
    // The renderer sizes each gap for its track count; a fixed canvas that
    // cannot grow compresses the tracks rather than leaving the gap.
    const spacing = count > 1 ? Math.min(MAX_TRACK_SPACING, (bottom - top) / (count - 1)) : 0;
    const center = (top + bottom) / 2;
    const ys = classes.map((_, index) => center + (index - (count - 1) / 2) * spacing);
    const crossings = (order) => {
      const y = new Map();
      order.forEach((members, index) => members.forEach((run) => y.set(run, ys[index])));
      let total = 0;
      for (const a of runs) {
        for (const b of runs) {
          if (a === b || a.transition === b.transition) continue;
          const [low, high] = [Math.min(a.x1, a.x2), Math.max(a.x1, a.x2)];
          for (const [x, leg] of [[b.x1, b.legs[0]], [b.x2, b.legs[1]]]) {
            // An up leg and a down leg on one x overlap when the down leg
            // starts above where the up leg ends: that merges two routes.
            for (const [ax, aLeg] of [[a.x1, a.legs[0]], [a.x2, a.legs[1]]]) {
              if (Math.abs(ax - x) < 1 && aLeg === 'up' && leg === 'down' && y.get(b) < y.get(a)) total += 100;
            }
            if (x <= low + 0.5 || x >= high - 0.5) continue;
            if ((leg === 'up' && y.get(a) < y.get(b)) || (leg === 'down' && y.get(a) > y.get(b))) total += 1;
          }
        }
      }
      return total;
    };
    let best = classes;
    let bestScore = crossings(best);
    if (count <= EXHAUSTIVE_TRACK_LIMIT) {
      for (const order of permutations(classes).slice(1)) {
        const score = crossings(order);
        if (score < bestScore) {
          best = order;
          bestScore = score;
        }
      }
    } else {
      // Too many tracks to enumerate: swap pairs while that still helps.
      for (let improved = true; improved;) {
        improved = false;
        for (let i = 0; i < count && !improved; i += 1) {
          for (let j = i + 1; j < count && !improved; j += 1) {
            const order = [...best];
            [order[i], order[j]] = [order[j], order[i]];
            const score = crossings(order);
            if (score < bestScore) {
              best = order;
              bestScore = score;
              improved = true;
            }
          }
        }
      }
    }
    best.forEach((members, index) => members.forEach((run) => trackY.set(`${gap}:${run.index}:${transitions.indexOf(run.transition)}`, ys[index])));
  }

  const pathCache = new Map();
  function pointsFor(transition) {
    const plan = plans.get(transition);
    if (!plan) {
      // Self transitions and unknown endpoints are rejected by validation;
      // a degenerate stub keeps that diagnostic reachable.
      const state = states.get(transition.from) || states.get(transition.to);
      const point = state ? [state.x + state.width, state.cy] : [0, 0];
      return [point, point];
    }
    const { source, target } = ports.get(transition);
    if (plan.kind === 'horizontal') {
      if (Math.abs(source[1] - target[1]) < 0.5) return [source, target];
      const x = (source[0] + target[0]) / 2;
      return [source, [x, source[1]], [x, target[1]], target];
    }
    if (plan.kind === 'loop') return [source, [plan.loopX, source[1]], [plan.loopX, target[1]], target];
    const trackFor = (index) => trackY.get(`${plan.runs[index].gap}:${index}:${transitions.indexOf(transition)}`);
    if (plan.kind === 'corridor') {
      const y1 = trackFor(0);
      const y2 = trackFor(1);
      return [source, [source[0], y1], [plan.corridorX, y1], [plan.corridorX, y2], [target[0], y2], target];
    }
    if (Math.abs(source[0] - target[0]) < 0.5) return [source, target];
    const y = trackFor(0);
    return [source, [source[0], y], [target[0], y], target];
  }

  // Ports of two routes can still line up across a gap so their vertical
  // runs share one line. Nudge a turning route's end sideways on its side.
  for (const transition of plans.keys()) pathCache.set(transition, pointsFor(transition));
  const verticals = (points) => points.slice(1).flatMap((end, index) => {
    const start = points[index];
    if (Math.abs(start[0] - end[0]) >= 0.5 || Math.abs(start[1] - end[1]) < 0.5) return [];
    return [{ x: start[0], low: Math.min(start[1], end[1]), high: Math.max(start[1], end[1]), index, last: index === points.length - 2 }];
  });
  for (let round = 0; round < 12; round += 1) {
    const entries = [...pathCache.entries()];
    let conflict = null;
    for (let i = 0; i < entries.length && !conflict; i += 1) {
      for (let j = i + 1; j < entries.length && !conflict; j += 1) {
        for (const left of verticals(entries[i][1])) {
          const right = verticals(entries[j][1]).find((other) => Math.abs(other.x - left.x) < 1
            && Math.min(other.high, left.high) - Math.max(other.low, left.low) > 0.5);
          if (right) {
            conflict = [[entries[i][0], left], [entries[j][0], right]];
            break;
          }
        }
      }
    }
    if (!conflict) break;
    let moved = false;
    for (const [transition, segment] of conflict) {
      const plan = plans.get(transition);
      const end = segment.index === 0 ? 'source' : segment.last ? 'target' : null;
      if (!end || pathCache.get(transition).length < 4 || !['channel', 'corridor'].includes(plan.kind)) continue;
      const state = end === 'source' ? plan.from : plan.to;
      const side = end === 'source' ? plan.fromSide : plan.toSide;
      const record = ports.get(transition);
      const [low, high] = sideRange(state, side);
      const x = [12, -12, 20, -20].map((delta) => record[end][0] + delta).find((candidate) => (
        candidate >= low && candidate <= high
        && !portsOnSide(state, side, transition).some((point) => Math.abs(point[0] - candidate) < 10)
      ));
      if (x === undefined) continue;
      record[end] = [x, record[end][1]];
      pathCache.set(transition, pointsFor(transition));
      moved = true;
      break;
    }
    if (!moved) break;
  }

  return {
    // Height a gap below `row` needs for its tracks at a readable spacing.
    gapHeight(row) {
      const count = trackCounts.get(row) || 0;
      return TRACK_TOP_CLEARANCE + TRACK_BOTTOM_CLEARANCE + Math.max(0, count - 1) * PREFERRED_TRACK_SPACING;
    },
    connectionSides(transition) {
      const plan = plans.get(transition);
      return plan ? { fromSide: plan.fromSide, toSide: plan.toSide } : { fromSide: 'right', toSide: 'right' };
    },
    pathFor(transition) {
      if (!pathCache.has(transition)) pathCache.set(transition, pointsFor(transition));
      return pathCache.get(transition);
    },
  };
}
