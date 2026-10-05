import { textUnits } from '../shared/text-units.mjs';
import { renderGridPattern } from '../shared/svg-grid.mjs';
/* Shared interval layout for CLI rendering and browser editing. */
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const defaults = {
  background: 'var(--mask)',
  track: 'var(--lane-fill)',
  span: 'var(--external-fill)',
  ink: 'var(--text)',
  line: 'var(--arrow)',
  accent: 'var(--arrow-emphasis)',
  warning: 'var(--security-fill)',
  muted: 'var(--text-muted)',
  'io-red': 'var(--security-stroke)',
  'io-gray': 'var(--external-stroke)',
  'io-blue': 'var(--frontend-stroke)',
  'io-green': 'var(--backend-stroke)',
  'io-orange': 'var(--messagebus-stroke)',
  'io-yellow': 'var(--cloud-stroke)',
  'io-purple': 'var(--database-stroke)',
  'io-red-fill': 'var(--security-fill)',
  'io-blue-fill': 'var(--frontend-fill)',
  'io-green-fill': 'var(--backend-fill)',
  'io-orange-fill': 'var(--messagebus-fill)',
  'io-yellow-fill': 'var(--cloud-fill)',
  'io-purple-fill': 'var(--database-fill)',
  'io-gray-fill': 'var(--external-fill)',
};

function intervalError(message, code, subject, evidence, supportedFixes) {
  const error = new Error(message);
  error.intervalDiagnostic = {
    code,
    severity: 'error',
    message,
    subject,
    evidence,
    supportedFixes,
  };
  return error;
}

export function renderIntervalLayout(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec))
    throw Error('Diagram must be an object.');
  const warnings = [],
    anchors = spec.anchors || {},
    tracks = spec.tracks || [];
  if (!Array.isArray(tracks) || !tracks.length) throw Error('Add at least one track.');
  const finite = (v, name) => {
    if (typeof v !== 'number' || !Number.isFinite(v))
      throw Error(name + ' must be a finite number.');
    return v;
  };
  const nonnegative = (v, name) => {
    finite(v, name);
    if (v < 0) throw Error(name + ' must be nonnegative.');
    return v;
  };
  const color = (v, name, allowNone = false) => {
    if (allowNone && v === 'none') return v;
    if (typeof v === 'string' && Object.hasOwn(palette, v)) return palette[v];
    if (typeof v === 'string' && /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(v)) return v;
    throw Error(
      name + ' must be a palette name or hex color' + (allowNone ? ' (or none)' : '') + '.',
    );
  };
  const palette = { ...defaults };
  if (spec.palette !== undefined) {
    if (!spec.palette || typeof spec.palette !== 'object' || Array.isArray(spec.palette))
      throw Error('palette must be an object.');
    for (const [name, value] of Object.entries(spec.palette)) {
      if (!Object.hasOwn(defaults, name)) throw Error('Unknown palette color: ' + name);
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value))
        throw Error('palette.' + name + ' must be a hex color.');
      palette[name] = value;
    }
  }
  const mask = spec.palette?.background ? palette.background : 'var(--mask)';
  const positions = [];
  const positionOf = (p) =>
    p && typeof p === 'object' && !Array.isArray(p) && Object.hasOwn(p, 'at') ? p.at : p;
  Object.values(anchors).forEach((a) => positions.push(a.at));
  tracks.forEach((t) => {
    positions.push(...(t.lifetime || []));
    for (const kind of ['spans', 'objects', 'arrows'])
      for (const item of t[kind] || []) positions.push(positionOf(item.from), positionOf(item.to));
    for (const kind of ['points', 'events', 'callouts'])
      for (const item of t[kind] || []) positions.push(item.at);
  });
  const abs = (p) =>
    typeof p === 'number' && Number.isFinite(p)
      ? p
      : typeof p === 'string' && /^-?(?:\d+\.?\d*|\.\d+)u$/.test(p)
        ? parseFloat(p)
        : null;
  const width = spec.unitWidth ?? Math.max(100, ...positions.map(abs).filter((v) => v !== null));
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0)
    throw Error('unitWidth must be a positive number.');
  function resolve(p, seen = []) {
    const n = abs(p);
    if (n !== null) return n;
    if (typeof p === 'string' && /^-?(?:\d+\.?\d*|\.\d+)%$/.test(p))
      return (parseFloat(p) * width) / 100;
    if (typeof p === 'string' && Object.hasOwn(anchors, p)) {
      if (seen.includes(p)) {
        const cycle = [...seen, p];
        throw intervalError(
          'Circular anchor: ' + cycle.join(' → '),
          'interval/circular-anchor',
          { anchor: p, path: `/anchors/${p}/at` },
          { cycle },
          ['change one anchor in the cycle to a numeric, unit, or percentage position'],
        );
      }
      return resolve(anchors[p].at, [...seen, p]);
    }
    throw intervalError(
      'Unknown position or anchor: ' + String(p),
      'interval/unknown-anchor',
      { reference: p, ...(seen.length ? { path: `/anchors/${seen.at(-1)}/at` } : {}) },
      { knownAnchors: Object.keys(anchors) },
      ['define the named anchor under anchors or use a numeric, unit, or percentage position'],
    );
  }
  const horizontalScale = finite(spec.horizontalScale ?? 1, 'horizontalScale');
  if (horizontalScale <= 0) throw Error('horizontalScale must be positive.');
  const plotWidth = 720 * horizontalScale;
  // Reserve the label gutter before mapping coordinates; annotation-only rows
  // do not own a plotted band and may intentionally span the page.
  const origin = Math.max(160, ...tracks.filter(t => !(t.style?.fill === 'none' && t.style?.stroke === 'none'))
    .map(t => 8 + textUnits(t.label || t.id) * .6 * 22 + Math.max(0, t.labelOffset?.[0] || 0) + 24));
  const x = (p) => origin + (resolve(p) / width) * plotWidth;
  let rowY = 90;
  const trackIds = new Set();
  const rows = tracks.map((t, index) => {
    if (!t || typeof t !== 'object' || !t.id) throw Error('Track IDs must be present and unique.');
    if (trackIds.has(t.id))
      throw intervalError(
        'Duplicate track ID: ' + t.id,
        'interval/duplicate-track',
        { track: t.id, path: `/tracks/${index}/id` },
        {
          id: t.id,
          firstIndex: tracks.findIndex((candidate) => candidate.id === t.id),
          duplicateIndex: index,
        },
        ['give this track a unique ID and update references to it'],
      );
    trackIds.add(t.id);
    const gap = nonnegative(t.gapBefore ?? 0, 'Track gap'),
      h = finite(t.height ?? 44, 'Track height');
    if (h <= 0) throw Error('Track height must be positive.');
    rowY += gap;
    if (t.lifetime !== undefined && (!Array.isArray(t.lifetime) || t.lifetime.length !== 2))
      throw Error(t.id + ': lifetime must have two positions.');
    const row = { ...t, y: rowY, h, a: t.lifetime?.[0] ?? 0, b: t.lifetime?.[1] ?? '100%' };
    rowY += h;
    return row;
  });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const uid = 'interval-',
    defs = [],
    layers = [],
    labels = [],
    stripedAreas = [],
    backingCandidates = [],
    strokeLevels = new Set();
  let defSerial = 0,
    order = 0,
    minX = 0,
    maxX = origin + 60 + plotWidth,
    minY = 0,
    maxY = rowY + 85;
  const bound = (a, b, c, d) => {
    minX = Math.min(minX, a);
    maxX = Math.max(maxX, b);
    minY = Math.min(minY, c);
    maxY = Math.max(maxY, d);
  };
  const editAttr = (path, kind) =>
    path ? ` data-edit-path="${esc(JSON.stringify(path))}" data-edit-kind="${kind}"` : '';
  const labelOffset = (item) => {
    const offset = item.labelOffset ?? [0, 0];
    if (!Array.isArray(offset) || offset.length !== 2) throw Error('labelOffset must be [x, y].');
    return [finite(offset[0], 'labelOffset x'), finite(offset[1], 'labelOffset y')];
  };
  const measure = (s, size) => {
    // JetBrains Mono is monospaced. Use one estimate in Node and the browser so
    // editing does not shift bounds when it rerenders an unchanged specification.
    const lines = s.split('\n');
    const advance = Math.max(...lines.map(line => textUnits(line) * 0.6 * size));
    const halfLeading = (lines.length - 1) * size * 1.25 / 2;
    return { advance, left: 0, right: advance, ascent: size * 0.8 + halfLeading,
      descent: size * 0.2 + halfLeading };
  };
  const text = (tx, ty, value, opts = {}) => {
    const size = opts.size || 20,
      anchor = opts.anchor || 'middle',
      s = String(value),
      weight = opts.weight || 'normal',
      m = measure(s, size, weight),
      origin = tx - (anchor === 'middle' ? m.advance / 2 : anchor === 'end' ? m.advance : 0);
    const x1 = origin - m.left,
      x2 = origin + m.right,
      y1 = ty - m.ascent,
      y2 = ty + m.descent;
    bound(x1 - 2, x2 + 2, y1 - 2, y2 + 2);
    if (opts.probe !== false && s.trim()) {
      const box = { name: s, x1, x2, y1, y2 };
      for (const old of labels)
        if (
          Math.min(box.x2, old.x2) - Math.max(box.x1, old.x1) > 2 &&
          Math.min(box.y2, old.y2) - Math.max(box.y1, old.y1) > 2
        )
          warnings.push(
            `Text labels "${old.name}" and "${box.name}" may overlap (approximate bounds).`,
          );
      labels.push(box);
    }
    let backing = '';
    if (opts.backing) {
      const marker = `<!--ts-${uid}backing-${backingCandidates.length}-->`;
      backingCandidates.push({
        marker,
        box: { x1, x2, y1, y2 },
        color: opts.backing === true ? mask : opts.backing,
        z: opts.z ?? 55,
      });
      backing = marker;
    }
    return `${backing}<text x="${tx}" y="${ty}" text-anchor="${anchor}" font-family="JetBrains Mono,monospace" font-size="${size}" font-weight="${weight}" fill="${opts.color || palette.ink}"${opts.layoutOffset ? ` data-layout-offset="${esc(JSON.stringify(opts.layoutOffset))}"` : ''} data-node-label=""${editAttr(opts.editPath, 'label')}>${s.split('\n').map((line, index, lines) => lines.length === 1 ? esc(line) : `<tspan x="${tx}" y="${ty + (index - (lines.length - 1) / 2) * size * 1.25}">${esc(line)}</tspan>`).join('')}</text>`;
  };
  const group = (kind, z, content, opacity = 1, path = null, editKind = 'body', extra = '') => {
    finite(z, kind + ' z');
    layers.push({
      z,
      order: order++,
      svg: `<g data-kind="${kind}" data-z="${z}"${opacity === 1 ? '' : ` opacity="${opacity}"`}${editAttr(path, editKind)}${extra}>${content}</g>`,
    });
  };
  const labeled = (kind, item, defaultZ, geometry, caption, s, path, extra = '') => {
    group(
      kind,
      item.z ?? defaultZ,
      geometry + (item.z === undefined ? '' : caption),
      s.opacity,
      path,
      'body',
      extra,
    );
    if (item.z === undefined && caption)
      group(kind + '-label', 55, caption, s.opacity, [...path, 'label'], 'label');
  };
  const shiftedText = (tx, ty, value, item, opts) => {
    const [dx, dy] = labelOffset(item);
    return text(tx + dx, ty + dy, value, opts);
  };
  const labelBox = (cx, baseline, value) => {
    const m = measure(String(value), 20);
    return { x1: cx - m.advance / 2, x2: cx + m.advance / 2,
      y1: baseline - m.ascent, y2: baseline + m.descent };
  };
  const intersects = (a, b, pad = 2) =>
    Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > -pad &&
    Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > -pad;
  // Reserve all rectangular geometry before placing labels. This prevents an
  // early label from being pushed onto a later span on the same or next track.
  const geometryBlocks = [];
  const trackBands = rows.map((r, index) => ({ owner: index,
    x1: Math.min(x(r.a), x(r.b)), x2: Math.max(x(r.a), x(r.b)),
    y1: r.y, y2: r.y + r.h }));
  const guideBlocks = [];
  const reserveGuide = (at, across, owner) => {
    const selected = across?.map(id => byId[id]).filter(Boolean) || [owner];
    if (!selected.length) return;
    const px = x(at), first = Math.min(...selected.map(r => r.y));
    const last = Math.max(...selected.map(r => r.y + r.h));
    guideBlocks.push({ x1: px - 3, x2: px + 3, y1: first - 14, y2: last + 12 });
  };
  rows.forEach(row => (row.events || []).forEach(item => reserveGuide(item.at, item.across, row)));
  Object.values(anchors).forEach(anchor => {
    if (anchor.across) reserveGuide(anchor.at, anchor.across, null);
  });
  const placeRectangleLabel = (row, owner, a, b, top, h, value, item, style, editPath) => {
    const subject = `${row.id}/${owner.split('/').slice(1).join('/')}`;
    const center = (a + b) / 2, baseline = top + h / 2 + 7;
    const width = measure(String(value), 20).advance;
    const source = { x1: Math.min(a, b), x2: Math.max(a, b), y1: top, y2: top + h };
    const trackLeft = Math.min(x(row.a), x(row.b)), trackRight = Math.max(x(row.a), x(row.b));
    const otherGeometry = geometryBlocks.filter(block => block.owner !== owner);
    const candidateOK = (cx, y, inside = false) => {
      const box = labelBox(cx, y, value);
      if (box.x1 < trackLeft + 4 || box.x2 > trackRight - 4) return false;
      if (inside && (box.x1 < source.x1 + 4 || box.x2 > source.x2 - 4 ||
          box.y1 < source.y1 + 2 || box.y2 > source.y2 - 2)) return false;
      if (!inside && intersects(box, source, 5)) return false;
      if (otherGeometry.some(block => intersects(box, block, 5))) return false;
      if (guideBlocks.some(block => intersects(box, block, 3))) return false;
      if (trackBands.some(band => band.owner !== rows.indexOf(row) && intersects(box, band, 5))) return false;
      return !labels.some(old => intersects(box, old, 5));
    };
    const [manualX, manualY] = labelOffset(item);
    let cx = center + manualX, y = baseline + manualY, mode = 'inside';
    if (item.labelOffset === undefined) {
      if (width + 12 > Math.abs(b - a) || !candidateOK(center, baseline, true)) {
        const interior = [center + 12, center - 12, center + 24, center - 24,
          source.x1 + width / 2 + 8, source.x2 - width / 2 - 8,
          ...guideBlocks.flatMap(g => [g.x1 - width / 2 - 8, g.x2 + width / 2 + 8])].find(next => candidateOK(next, baseline, true));
        if (interior !== undefined) cx = interior;
        else {
          const sideCenters = [source.x1 - width / 2 - 12, source.x2 + width / 2 + 12];
          const xChoice = sideCenters.find(next =>
            Math.abs(next - center) <= width + 12 && candidateOK(next, baseline));
          if (xChoice !== undefined) { cx = xChoice; mode = 'outside'; }
          else {
            const vertical = [row.y - 15, row.y + row.h + 26];
            const yChoice = vertical.find(next => candidateOK(center, next));
            if (yChoice !== undefined) { y = yChoice; mode = 'outside'; }
            else warnings.push(`${subject}: label "${value}" has no clear bounded placement. Increase horizontalScale, shorten the label, or place it explicitly with labelOffset and an arrow.`);
          }
        }
      }
    } else if (width + 12 > Math.abs(b - a) || !intersects(labelBox(cx, y, value), source, -2)) {
      mode = 'outside';
      if (!candidateOK(cx, y))
        warnings.push(`${subject}: explicit labelOffset places "${value}" near another label or shape; inspect ownership and clearance.`);
    }
    let leader = '';
    if (mode === 'outside') {
      const targetX = Math.max(source.x1, Math.min(source.x2, cx));
      const targetY = y < source.y1 ? source.y1 : y > source.y2 ? source.y2 : source.y1 + h / 2;
      const box = labelBox(cx, y, value);
      const tailX = Math.max(box.x1, Math.min(box.x2, targetX));
      const tailY = targetY < box.y1 ? box.y1 - 3 : targetY > box.y2 ? box.y2 + 3 : y;
      const route = { x1: Math.min(tailX, targetX), x2: Math.max(tailX, targetX), y1: Math.min(tailY, targetY), y2: Math.max(tailY, targetY) };
      const guideCrossesRoute = guideBlocks.some(block => {
        const gx = (block.x1 + block.x2) / 2;
        return gx > route.x1 + 3 && gx < route.x2 - 3 &&
          route.y2 > block.y1 && route.y1 < block.y2;
      });
      // A leader may touch a neighboring boundary or leave a mark overlaid on
      // a containing span. Neither is a crossing through an unrelated shape.
      const containsSource = block => block.x1 <= source.x1 && block.x2 >= source.x2 &&
        block.y1 <= source.y1 && block.y2 >= source.y2;
      const crossesInterior = block => route.x2 > block.x1 + 1 && route.x1 < block.x2 - 1 &&
        route.y2 > block.y1 + 1 && route.y1 < block.y2 - 1;
      if (otherGeometry.some(block => !containsSource(block) && crossesInterior(block)) || guideCrossesRoute)
        warnings.push(`${subject}: leader for "${value}" crosses another shape or guide; choose a clearer label position.`);
      leader = path(`M${tailX} ${tailY}L${targetX} ${targetY}`,
        [tailX, targetX], [tailY, targetY], { ...style, fill: 'none',
          stroke: style.stroke === 'none' ? palette.line : style.stroke,
          strokeWidth: 1.5, opacity: 1 }, false, 54);
      group('label-leader', 54, leader, 1, editPath, 'body');
    }
    return text(cx, y, value, { color: style.text, weight: style.fontWeight,
      backing: !style.gradient && style.fill !== 'none' && mode === 'inside' ? style.fill : true,
      z: item.z ?? 55, editPath: [...editPath, 'label'],
      layoutOffset: [cx - center, y - baseline] });
  };
  const check = (p, row, what = row.id) => {
    const v = resolve(p),
      px = x(p);
    bound(px, px, 0, 0);
    if (v < 0 || v > width) warnings.push(`${what}: ${p} is outside the global range 0–${width}.`);
    if (
      v < Math.min(resolve(row.a), resolve(row.b)) ||
      v > Math.max(resolve(row.a), resolve(row.b))
    )
      warnings.push(`${what}: ${p} is outside its lifetime.`);
    return px;
  };
  const style = (input, kind) => {
    if (input === undefined) input = {};
    if (typeof input === 'string') input = { preset: input };
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw Error(kind + ' style must be a preset or object.');
    for (const key of Object.keys(input))
      if (
        ![
          'preset',
          'fill',
          'stroke',
          'text',
          'strokeWidth',
          'dash',
          'opacity',
          'fontWeight',
          'pattern',
          'stripeColor',
          'gradient',
        ].includes(key)
      )
        throw Error('Unknown ' + kind + ' style field: ' + key);
    const preset = input.preset ?? 'default';
    if (!['default', 'emphasis', 'muted', 'alert', 'stripes'].includes(preset))
      throw Error('Unknown style preset: ' + preset);
    const s = {
      preset,
      fill:
        kind === 'span'
          ? palette.span
          : kind === 'object'
            ? palette.track
            : kind === 'track'
              ? palette.track
              : 'none',
      stroke: kind === 'span' ? palette.line : kind === 'track' ? palette.muted : palette.accent,
      text: palette.ink,
      strokeWidth: kind === 'track' ? 1 : 2,
      dash: 'solid',
      opacity: 1,
      fontWeight: 'normal',
      pattern: 'solid',
      stripeColor: palette.line,
      gradient: null,
    };
    if (preset === 'emphasis') {
      s.strokeWidth = 3;
      s.fontWeight = 'bold';
    }
    if (preset === 'muted') {
      s.fill = palette.track;
      s.stroke = palette.muted;
      s.text = palette.ink;
      s.opacity = 0.65;
    }
    if (preset === 'alert') {
      s.fill = palette.warning;
      s.stroke = palette.ink;
      s.text = palette.ink;
      s.fontWeight = 'bold';
    }
    if (preset === 'stripes') {
      s.fill = kind === 'span' ? palette.span : palette.track;
      s.stroke = palette.line;
      s.pattern = 'stripes';
    }
    for (const key of ['fill', 'stroke', 'text'])
      if (input[key] !== undefined)
        s[key] = color(input[key], kind + ' style.' + key, key !== 'text');
    if (input.strokeWidth !== undefined)
      s.strokeWidth = nonnegative(input.strokeWidth, kind + ' style.strokeWidth');
    if (input.opacity !== undefined) {
      s.opacity = finite(input.opacity, kind + ' style.opacity');
      if (s.opacity < 0 || s.opacity > 1) throw Error(kind + ' style.opacity must be 0..1.');
    }
    for (const [key, allowed] of [
      ['dash', ['solid', 'dashed', 'dotted']],
      ['fontWeight', ['normal', 'bold']],
      ['pattern', ['solid', 'stripes']],
    ])
      if (input[key] !== undefined) {
        if (!allowed.includes(input[key])) throw Error(kind + ' style.' + key + ' is invalid.');
        s[key] = input[key];
      }
    if (input.stripeColor !== undefined)
      s.stripeColor = color(input.stripeColor, kind + ' style.stripeColor');
    if (input.gradient !== undefined) {
      if (!Array.isArray(input.gradient) || input.gradient.length !== 2)
        throw Error(kind + ' style.gradient must have two colors.');
      s.gradient = input.gradient.map((v) => color(v, kind + ' style.gradient'));
    }
    if (s.gradient && s.pattern === 'stripes')
      throw Error(kind + ' style.gradient and pattern cannot be combined.');
    if (kind === 'event' || kind === 'anchor') {
      if (input.stroke === undefined) s.stroke = 'var(--security-stroke)';
      if (input.strokeWidth === undefined) s.strokeWidth = 4;
    }
    return s;
  };
  const paint = (s, rect = false) => {
    let fill = s.fill;
    if (s.gradient) {
      const id = uid + 'gradient' + ++defSerial;
      defs.push(
        `<linearGradient id="${id}"><stop offset="0%" stop-color="${s.gradient[0]}"/><stop offset="100%" stop-color="${s.gradient[1]}"/></linearGradient>`,
      );
      fill = `url(#${id})`;
    }
    if (s.pattern === 'stripes') {
      const id = uid + 'pattern' + ++defSerial;
      defs.push(
        `<pattern id="${id}" patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(45)"><rect width="12" height="12" fill="${s.fill === 'none' ? palette.background : s.fill}"/><path d="M0 0V12" stroke="${s.stripeColor}" stroke-width="7"/></pattern>`,
      );
      fill = `url(#${id})`;
    }
    return `fill="${fill}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}"${s.dash === 'solid' ? '' : ` stroke-dasharray="${s.dash === 'dashed' ? '7 5' : '2 5'}"`}`;
  };
  const rect = (a, b, top, h, s, z = 0) => {
    const left = Math.min(a, b),
      right = Math.max(a, b),
      bottom = top + h;
    bound(
      left - s.strokeWidth / 2,
      right + s.strokeWidth / 2,
      top - s.strokeWidth / 2,
      bottom + s.strokeWidth / 2,
    );
    if (s.pattern === 'stripes' && s.opacity > 0)
      stripedAreas.push({ x1: left, x2: right, y1: top, y2: bottom, z });
    strokeLevels.add(z);
    const geometry = `x="${left}" y="${top}" width="${right - left}" height="${h}"`;
    return `<rect ${geometry} ${paint({ ...s, stroke: 'none' }, true)}/><rect ${geometry} ${paint({ ...s, fill: 'none', pattern: undefined, gradient: undefined })} mask="url(#${uid}stroke-${z})"/>`;
  };
  const path = (d, xs, ys, s, marker = false, z = 30) => {
    bound(
      Math.min(...xs) - s.strokeWidth - 5,
      Math.max(...xs) + s.strokeWidth + 5,
      Math.min(...ys) - s.strokeWidth - 5,
      Math.max(...ys) + s.strokeWidth + 5,
    );
    let end = '';
    if (marker) {
      const id = uid + 'tip' + ++defSerial;
      defs.push(
        `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="${s.stroke}"/></marker>`,
      );
      end = ` marker-end="url(#${id})"`;
    }
    strokeLevels.add(z);
    return `<path d="${d}" ${paint({ ...s, fill: 'none' })}${end} mask="url(#${uid}stroke-${z})"/>`;
  };
  const heightOf = (v, row, fallback) => {
    if (v === undefined) return row.h * fallback;
    if (typeof v === 'string' && /^(?:\d+\.?\d*|\.\d+)%$/.test(v))
      return (row.h * parseFloat(v)) / 100;
    const h = finite(v, 'Rectangle height');
    if (h < 0) throw Error('Rectangle height must be nonnegative.');
    return h;
  };
  const topOf = (item, row, h) => {
    const align = item.align ?? 'center';
    if (!['top', 'center', 'bottom'].includes(align))
      throw Error('Rectangle align must be top, center, or bottom.');
    return (
      row.y +
      (align === 'top' ? 0 : align === 'bottom' ? row.h - h : (row.h - h) / 2) +
      finite(item.offsetY ?? 0, 'Rectangle offsetY')
    );
  };
  rows.forEach((r, ri) => {
    for (const kind of ['spans', 'objects'])
      for (const [j, item] of (r[kind] || []).entries()) {
        const a = x(item.from), b = x(item.to), h = heightOf(item.height, r, kind === 'spans' ? 1 : 0.8);
        const top = topOf(item, r, h);
        geometryBlocks.push({ owner: `${ri}/${kind}/${j}`, x1: Math.min(a, b), x2: Math.max(a, b), y1: top, y2: top + h });
      }
  });
  const calloutY = (item, row, offsetY) => {
    const pos = item.y_pos ?? (offsetY > 0 ? 'bottom' : 'top');
    if (pos === 'top') return row.y;
    if (pos === 'center') return row.y + row.h / 2;
    if (pos === 'bottom') return row.y + row.h;
    if (typeof pos === 'number') return row.y + finite(pos, 'Callout y_pos');
    if (typeof pos === 'string' && /^(?:\d+\.?\d*|\.\d+)%$/.test(pos))
      return row.y + (row.h * parseFloat(pos)) / 100;
    throw Error('Callout y_pos must be top, center, bottom, a number, or percentage.');
  };
  const turnY = (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.y_pos == null)
      throw Error('turnY needs a track and y_pos.');
    const row = byId[value.track];
    if (!Object.hasOwn(byId, value.track) || !row)
      throw intervalError(
        'Unknown turnY track: ' + String(value.track),
        'interval/unknown-track',
        { track: value.track, path: `${path}/track` },
        { knownTracks: rows.map((track) => track.id) },
        ['use an existing track ID in turnY.track or add that track'],
      );
    return calloutY(value, row, 0) + finite(value.offset ?? 0, 'turnY offset');
  };
  const verticalWarning = (kind, row, top, h) => {
    if (top < row.y || top + h > row.y + row.h)
      warnings.push(`${row.id}: ${kind} extends outside its track bounds.`);
  };
  const extent = (start, context, path) => {
    if (!Array.isArray(context) || context.length !== 2)
      throw Error(start + ': across must have two track IDs.');
    const a = rows.findIndex((r) => r.id === context[0]),
      b = rows.findIndex((r) => r.id === context[1]);
    if (a < 0 || b < 0) {
      const index = a < 0 ? 0 : 1;
      throw intervalError(
        'Unknown track in ' + start + ': ' + String(context[index]),
        'interval/unknown-track',
        { track: context[index], path: `${path}/${index}` },
        { knownTracks: rows.map((track) => track.id) },
        ['use an existing track ID in across or add that track'],
      );
    }
    return [rows[Math.min(a, b)], rows[Math.max(a, b)]];
  };
  const endpoint = (value, row, path) => {
    const obj =
      value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : { at: value, edge: 'top' };
    if (!Object.hasOwn(obj, 'at')) throw Error('Arrow endpoint needs at.');
    const target =
      obj.track === undefined ? row : Object.hasOwn(byId, obj.track) ? byId[obj.track] : null;
    if (!target)
      throw intervalError(
        'Unknown arrow endpoint track: ' + obj.track,
        'interval/unknown-track',
        { track: obj.track, path: `${path}/track` },
        { knownTracks: rows.map((track) => track.id) },
        ['use an existing track ID in the arrow endpoint or add that track'],
      );
    const edge = obj.edge ?? 'center';
    if (!['top', 'center', 'bottom'].includes(edge))
      throw Error('Arrow endpoint edge must be top, center, or bottom.');
    return {
      x: check(obj.at, target),
      y: target.y + (edge === 'top' ? 0 : edge === 'bottom' ? target.h : target.h / 2),
      row: target,
      edge,
    };
  };

  rows.forEach((row, ri) => {
    const a = check(row.a, row),
      b = check(row.b, row),
      base = style(row.style, 'track');
    group('track', row.z ?? 10, rect(a, b, row.y, row.h, base, row.z ?? 10), base.opacity, [
      'tracks',
      ri,
    ]);
    group(
      'track-label',
      60,
      shiftedText(8, row.y + row.h / 2 + 7, row.label || row.id, row, {
        anchor: 'start',
        size: 22,
        backing: true,
        z: 60,
        editPath: ['tracks', ri, 'label'],
      }),
      1,
      ['tracks', ri, 'label'],
      'label',
    );
    for (const kind of ['spans', 'objects'])
      for (const [j, item] of (row[kind] || []).entries()) {
        if (item.labelOffset !== undefined) labelOffset(item);
        const editPath = ['tracks', ri, kind, j],
          z = item.z ?? (kind === 'spans' ? 20 : 25);
        const a = check(item.from, row),
          b = check(item.to, row),
          h = heightOf(item.height, row, kind === 'spans' ? 1 : 0.8),
          top = topOf(item, row, h),
          s = style(item.style, kind.slice(0, -1));
        verticalWarning(kind.slice(0, -1), row, top, h);
        const body = rect(a, b, top, h, s, z);
        const caption =
          item.label !== undefined && item.label !== ''
            ? placeRectangleLabel(row, `${ri}/${kind}/${j}`, a, b, top, h,
                item.label, item, s, editPath)
            : '';
        labeled(
          kind.slice(0, -1),
          item,
          kind === 'spans' ? 20 : 25,
          body,
          caption,
          s,
          editPath,
          ` data-edit-from-path="${esc(JSON.stringify([...editPath, 'from']))}" data-edit-to-path="${esc(JSON.stringify([...editPath, 'to']))}"`,
        );
      }
    for (const [j, item] of (row.arrows || []).entries()) {
      if (item.labelOffset !== undefined) labelOffset(item);
      const editPath = ['tracks', ri, 'arrows', j],
        z = item.z ?? 30;
      const start = endpoint(item.from, row, `/tracks/${ri}/arrows/${j}/from`),
        to = endpoint(item.to, row, `/tracks/${ri}/arrows/${j}/to`),
        s = style(item.style, 'arrow');
      const from = { ...start,
        x: start.x + finite(item.startXOffset ?? 0, 'startXOffset'),
        y: start.y + finite(item.startYOffset ?? 0, 'startYOffset') };
      if (item.labelPlacement !== undefined && !['midpoint', 'start'].includes(item.labelPlacement))
        throw Error('labelPlacement must be midpoint or start.');
      if (item.label && item.labelPlacement === 'start') {
        const [ldx, ldy] = labelOffset(item);
        const clear = (fx, fy) => {
          const box = labelBox(fx + ldx, fy - 12 + ldy, item.label);
          return !labels.some(old => intersects(box, old, 5)) &&
            !geometryBlocks.some(block => intersects(box, block, 5)) &&
            !guideBlocks.some(block => intersects(box, block, 3)) &&
            !trackBands.some(band => band.owner !== rows.indexOf(start.row) && intersects(box, band, 5));
        };
        if (!clear(from.x, from.y))
          warnings.push(`${row.id}/arrows/${j}: start label "${item.label}" overlaps another label, shape, or guide. Adjust startXOffset/startYOffset, shorten the label, or choose a different arrow endpoint.`);
      }
      let d,
        xs = [from.x, to.x],
        ys = [from.y, to.y],
        labelY;
      if (from.row === to.row) {
        const rise = nonnegative(item.offset ?? 26, 'Arrow offset'),
          high =
            item.turnY === undefined
              ? Math.min(from.y, to.y) - rise
              : turnY(item.turnY, `/tracks/${ri}/arrows/${j}/turnY`);
        d = `M${from.x} ${from.y - 3}V${high}H${to.x}V${to.y - 3}`;
        ys.push(high);
        labelY = high - 8;
        if ((row.gapBefore ?? 0) < 48)
          warnings.push(
            `${row.id}: arrows may overlap the previous track; consider gapBefore: 56.`,
          );
      } else {
        const mid =
          item.turnY === undefined
            ? (from.y + to.y) / 2
            : turnY(item.turnY, `/tracks/${ri}/arrows/${j}/turnY`);
        d = `M${from.x} ${from.y}V${mid}H${to.x}V${to.y}`;
        ys.push(mid);
        labelY = mid - 8;
      }
      const body = path(d, xs, ys, s, true, z);
      const caption = item.label
        ? shiftedText(item.labelPlacement === 'start' ? from.x : (from.x + to.x) / 2,
            item.labelPlacement === 'start' ? from.y - 12 : labelY, item.label, item, {
            color: s.text,
            weight: s.fontWeight,
            backing: true,
            z: item.z ?? 55,
            editPath: [...editPath, 'label'],
          })
        : '';
      labeled(
        'arrow',
        item,
        30,
        body,
        caption,
        s,
        editPath,
        ` data-edit-from-path="${esc(JSON.stringify([...editPath, 'from']))}" data-edit-to-path="${esc(JSON.stringify([...editPath, 'to']))}"`,
      );
    }
    // Explicit offsets stay authoritative, but peer captions need an ownership check
    // even when their text boxes do not collide.
    const pointBaselines = new Set((row.points || []).map(point => labelOffset(point)[1]));
    if (pointBaselines.size > 1) {
      warnings.push(`${row.id}/points: peer captions use different authored Y offsets (${[...pointBaselines].join(', ')}). Omit offsets for a shared baseline; use start-attached labelled arrows for independent callouts, or retain intentional offsets after checking ownership.`);
    }
    for (const [j, item] of (row.points || []).entries()) {
      const editPath = ['tracks', ri, 'points', j],
        z = item.z ?? 30;
      const px = check(item.at, row),
        from = row.y + row.h + 32,
        to = row.y + row.h + 3,
        s = style(item.style, 'point');
      const body = path(`M${px} ${from}V${to}`, [px], [from, to], s, true, z);
      const value = item.label || String(item.at), baseY = row.y + row.h + 51;
      let labelX = px, labelY = baseY;
      if (item.labelOffset === undefined) {
        const w = measure(String(value), 20).advance;
        const shifts = [0, -Math.min(w / 2 + 8, 70), Math.min(w / 2 + 8, 70)];
        const baselines = [baseY, row.y + row.h + 29];
        const selected = baselines.flatMap((y, index) =>
          (index === 0 ? shifts : shifts.slice(1)).map(dx => ({ x: px + dx, y })))
          .find(({ x, y }) => {
            const box = labelBox(x, y, value);
            return !labels.some(old => intersects(box, old, 5)) &&
              !geometryBlocks.some(block => intersects(box, block, 5)) &&
              !guideBlocks.some(block => intersects(box, block, 3)) &&
              !trackBands.some(band => intersects(box, band, 5));
          });
        if (selected === undefined)
          warnings.push(`${row.id}/points/${j}: label "${value}" has no clear bounded position on the point-label baseline. Increase horizontalScale or shorten the label.`);
        else { labelX = selected.x; labelY = selected.y; }
      } else {
        const [dx, dy] = labelOffset(item);
        labelX += dx; labelY += dy;
        if (Math.abs(dy) > 10)
          warnings.push(`${row.id}/points/${j}: explicit labelOffset moves "${value}" off the shared point-label baseline; inspect its arrow association.`);
      }
      if (labelX !== px || labelY !== baseY) {
        const box = labelBox(labelX, labelY, value);
        const tailX = Math.max(box.x1, Math.min(box.x2, px));
        const tailY = from < box.y1 ? box.y1 - 4 : box.y2 + 4;
        group('label-leader', 54,
          path(`M${px} ${from}L${tailX} ${tailY}`, [px, tailX], [from, tailY],
            { ...s, fill: 'none', stroke: s.stroke === 'none' ? palette.line : s.stroke,
              strokeWidth: 1.5, opacity: 1 }, false, 54), 1, editPath);
      }
      const caption = text(labelX, labelY, value, {
        color: s.text,
        weight: s.fontWeight,
        backing: true,
        z: item.z ?? 55,
        editPath: [...editPath, 'label'],
        layoutOffset: [labelX - px, labelY - baseY],
      });
      labeled(
        'point',
        item,
        30,
        body,
        caption,
        s,
        editPath,
        ` data-edit-at-path="${esc(JSON.stringify([...editPath, 'at']))}"`,
      );
    }
    for (const [j, item] of (row.events || []).entries()) {
      if (item.labelOffset !== undefined) labelOffset(item);
      const editPath = ['tracks', ri, 'events', j],
        z = item.z ?? 40;
      const px = check(item.at, row),
        [first, last] = item.across
          ? extent('event', item.across, `/tracks/${ri}/events/${j}/across`)
          : [row, row],
        top = first.y - 14,
        bottom = last.y + last.h + 12,
        s = style(item.style, 'event');
      let body = path(
        `M${px} ${top}V${bottom}`,
        [px],
        [top, bottom],
        { ...s, dash: item.style?.dash ?? 'dashed' },
        false,
        z,
      );
      if (s.preset === 'alert') {
        bound(px - 13, px + 13, top - 33, top - 9);
        const iconStroke =
          item.style && typeof item.style === 'object' && Object.hasOwn(item.style, 'stroke')
            ? s.stroke
            : palette.ink;
        body += `<path d="M${px} ${top - 32}L${px + 12} ${top - 10}H${px - 12}Z" fill="${s.fill}" stroke="${iconStroke}"/>`;
        body += text(px, top - 14, '!', { size: 16, weight: 'bold', color: s.text, probe: false });
      }
      const alertInk =
        s.preset === 'alert' && item.label ? measure(String(item.label), 20, s.fontWeight) : null;
      const caption = item.label
        ? shiftedText(
            s.preset === 'alert' ? px + 20 : px,
            s.preset === 'alert' ? top - 21 + (alertInk.ascent - alertInk.descent) / 2 : top - 9,
            item.label,
            item,
            {
              anchor: s.preset === 'alert' ? 'start' : 'middle',
              color: s.text,
              weight: s.fontWeight,
              backing: true,
              z: item.z ?? 55,
              editPath: [...editPath, 'label'],
            },
          )
        : '';
      labeled(
        'event',
        item,
        40,
        body,
        caption,
        s,
        editPath,
        ` data-edit-at-path="${esc(JSON.stringify([...editPath, 'at']))}"`,
      );
    }
  });
  for (const [name, a] of Object.entries(anchors)) {
    resolve(name);
    if (!a.across) continue;
    const editPath = ['anchors', name],
      z = a.z ?? 40;
    const [first, last] = extent('anchor ' + name, a.across, `/anchors/${name}/across`),
      px = x(name),
      top = first.y - 14,
      bottom = last.y + last.h + 12,
      s = style(a.style, 'anchor');
    if (resolve(name) < 0 || resolve(name) > width)
      warnings.push(`${name}: anchor is outside the global range.`);
    const body = path(
      `M${px} ${top}V${bottom}`,
      [px],
      [top, bottom],
      { ...s, dash: a.style?.dash ?? 'dashed' },
      false,
      z,
    );
    const value = a.label || name;
    let labelX = px;
    if (a.labelOffset === undefined) {
      const w = measure(String(value), 20).advance;
      const candidates = [px, ...labels.flatMap(old => [old.x1 - w / 2 - 10, old.x2 + w / 2 + 10])];
      const clear = candidates.filter(cx => Math.abs(cx - px) <= w &&
        !labels.some(old => intersects(labelBox(cx, top - 9, value), old, 5)) &&
        !geometryBlocks.some(old => intersects(labelBox(cx, top - 9, value), old, 5)))
        .sort((a, b) => Math.abs(a - px) - Math.abs(b - px))[0];
      if (clear !== undefined) labelX = clear;
      if (labelX !== px) group('label-leader', 54,
        path(`M${px} ${top}L${labelX} ${top - 4}`, [px, labelX], [top, top - 4],
          { ...s, strokeWidth: 1.5, dash: '', fill: 'none' }, false, 54), 1, editPath);
    }
    const caption = shiftedText(labelX, top - 9, value, a, {
      color: s.text,
      weight: s.fontWeight,
      backing: true,
      z: a.z ?? 55,
      editPath: [...editPath, 'label'],
    });
    labeled(
      'anchor',
      a,
      40,
      body,
      caption,
      s,
      editPath,
      ` data-edit-at-path="${esc(JSON.stringify([...editPath, 'at']))}"`,
    );
  }
  let autoNumber = 1;
  const numbers = new Map();
  const index = [];
  for (const [ri, row] of rows.entries())
    for (const [j, item] of (row.callouts || []).entries()) {
      if (item.text === undefined || String(item.text) === '')
        throw Error('Callout text is required.');
      const shape = item.shape ?? 'circle';
      if (!['circle', 'triangle', 'rectangle', 'bubble'].includes(shape))
        throw Error('Unknown callout shape: ' + shape);
      const routing = item.routing ?? 'straight';
      if (!['straight', 'orthogonal'].includes(routing))
        throw Error('Callout routing must be straight or orthogonal.');
      if (shape === 'bubble' && item.routing !== undefined)
        throw Error('Bubble callouts do not use routing.');
      const editPath = ['tracks', ri, 'callouts', j],
        offsetY = finite(item.offsetY ?? -28, 'Callout offsetY');
      const targetX = check(item.at, row),
        targetY = calloutY(item, row, offsetY),
        px = targetX + finite(item.offsetX ?? 28, 'Callout offsetX'),
        py = targetY + offsetY,
        s = style(item.style, 'callout'),
        z = item.z ?? 50;
      let body = '';
      if (shape !== 'bubble') {
        const dx = targetX - px,
          dy = targetY - py,
          distance = Math.hypot(dx, dy);
        if (shape !== 'circle' || distance > 0) {
          let endX, endY;
          if (shape === 'circle' && routing === 'straight') {
            endX = px + (18 * dx) / distance;
            endY = py + (18 * dy) / distance;
          } else {
            const candidates =
              shape === 'circle'
                ? [
                    [px, py - 18],
                    [px + 18, py],
                    [px, py + 18],
                    [px - 18, py],
                  ]
                : shape === 'triangle'
                  ? [
                      [px, py - 20],
                      [px + 20, py + 17],
                      [px - 20, py + 17],
                    ]
                  : [
                      [px, py - 18],
                      [px + 20, py - 18],
                      [px + 20, py],
                      [px + 20, py + 18],
                      [px, py + 18],
                      [px - 20, py + 18],
                      [px - 20, py],
                      [px - 20, py - 18],
                    ];
            [endX, endY] = candidates.reduce((best, p) =>
              Math.hypot(p[0] - targetX, p[1] - targetY) <
              Math.hypot(best[0] - targetX, best[1] - targetY)
                ? p
                : best,
            );
          }
          let route = `M${targetX} ${targetY}L${endX} ${endY}`;
          if (routing === 'orthogonal')
            route =
              shape === 'circle' && endX === px
                ? `M${targetX} ${targetY}V${(targetY + endY) / 2}H${endX}V${endY}`
                : `M${targetX} ${targetY}V${endY}H${endX}`;
          body = path(route, [targetX, endX], [targetY, endY], s, false, z);
        }
      }
      if (shape === 'bubble') {
        const lines = wrap(String(item.text), 32),
          w = Math.max(120, ...lines.map((v) => measure(v, 20).advance + 26)),
          h = lines.length * 25 + 20;
        const bubble = { ...s, fill: s.fill === 'none' ? palette.track : s.fill },
          left = px,
          right = px + w,
          top = py - h / 2,
          bottom = py + h / 2;
        const tail =
          targetX < left
            ? [
                [left, py - 8],
                [targetX, targetY],
                [left, py + 8],
              ]
            : targetX > right
              ? [
                  [right, py - 8],
                  [targetX, targetY],
                  [right, py + 8],
                ]
              : targetY < top
                ? [
                    [px + w / 2 - 8, top],
                    [targetX, targetY],
                    [px + w / 2 + 8, top],
                  ]
                : [
                    [px + w / 2 - 8, bottom],
                    [targetX, targetY],
                    [px + w / 2 + 8, bottom],
                  ];
        bound(
          Math.min(...tail.map((p) => p[0])) - s.strokeWidth,
          Math.max(...tail.map((p) => p[0])) + s.strokeWidth,
          Math.min(...tail.map((p) => p[1])) - s.strokeWidth,
          Math.max(...tail.map((p) => p[1])) + s.strokeWidth,
        );
        body += `<path d="M${tail[0][0]} ${tail[0][1]}L${tail[1][0]} ${tail[1][1]}L${tail[2][0]} ${tail[2][1]}Z" ${paint(bubble)}/>`;
        bound(
          left - s.strokeWidth,
          right + s.strokeWidth,
          top - s.strokeWidth,
          bottom + s.strokeWidth,
        );
        if (s.pattern === 'stripes' && s.opacity > 0)
          stripedAreas.push({ x1: left, x2: right, y1: top, y2: bottom, z });
        body += `<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="9" ${paint(bubble)}/>`;
        const [dx, dy] = labelOffset(item);
        lines.forEach(
          (line, i) =>
            (body += text(px + 13 + dx, py - h / 2 + 31 + i * 25 + dy, line, {
              anchor: 'start',
              color: s.text,
              weight: s.fontWeight,
              backing: s.fill === 'none' ? mask : s.fill,
              z,
              editPath: [...editPath, 'text'],
            })),
        );
      } else {
        while (numbers.has(autoNumber)) autoNumber++;
        const number = item.number ?? autoNumber++;
        if (typeof number !== 'number' || !Number.isInteger(number) || number < 1)
          throw Error('Callout numbers must be unique positive integers.');
        if (numbers.has(number))
          throw intervalError(
            'Duplicate callout number: ' + number,
            'interval/duplicate-callout-number',
            { track: row.id, path: `/tracks/${ri}/callouts/${j}/number` },
            { number, firstPath: numbers.get(number) },
            ['choose an unused positive integer or omit number for automatic numbering'],
          );
        numbers.set(number, `/tracks/${ri}/callouts/${j}/number`);
        bound(px - 20, px + 20, py - 20, py + 20);
        if (shape === 'circle')
          body += `<circle cx="${px}" cy="${py}" r="18" ${paint({ ...s, fill: s.fill === 'none' ? palette.background : s.fill })}/>`;
        if (shape === 'triangle')
          body += `<path d="M${px} ${py - 20}L${px + 20} ${py + 17}H${px - 20}Z" ${paint({ ...s, fill: s.fill === 'none' ? palette.background : s.fill })}/>`;
        if (shape === 'rectangle')
          body += `<rect x="${px - 20}" y="${py - 18}" width="40" height="36" ${paint({ ...s, fill: s.fill === 'none' ? palette.background : s.fill })}/>`;
        body += text(px, py + 7, number, { color: s.text, weight: 'bold', probe: false });
        index.push({
          number,
          text: String(item.text),
          style: s,
          indexInk:
            item.style && typeof item.style === 'object' && Object.hasOwn(item.style, 'text')
              ? s.text
              : palette.ink,
          z,
          item,
          editPath,
        });
      }
      group(
        'callout',
        z,
        body,
        s.opacity,
        editPath,
        'callout',
        ` data-edit-at-path="${esc(JSON.stringify([...editPath, 'at']))}"`,
      );
    }
  // Mechanical notes occupy a reserved column to the right of all drawn geometry.
  if (index.length) {
    const column = maxX + 44;
    let indexY = 94;
    index.forEach((entry) => {
      const lines = wrap(entry.text, 34),
        top = indexY;
      indexY += Math.max(72, lines.length * 23 + 20);
      const ink = entry.indexInk;
      let body = text(column, top, entry.number + '.', {
        anchor: 'start',
        weight: 'bold',
        color: ink,
        probe: false,
      });
      const [dx, dy] = labelOffset(entry.item);
      lines.forEach(
        (line, j) =>
          (body += text(column + 35 + dx, top + j * 23 + dy, line, {
            anchor: 'start',
            color: ink,
            backing: true,
            z: entry.z,
            editPath: [...entry.editPath, 'text'],
          })),
      );
      group('callout-index', entry.z, body, entry.style.opacity, entry.editPath, 'callout');
    });
  }
  const axisStyle = {
    fill: 'none',
    stroke: palette.muted,
    strokeWidth: 1,
    opacity: 1,
    dash: 'solid',
  };
  let axis = path(`M${origin} 42H${origin + plotWidth}`, [origin, origin + plotWidth], [42], axisStyle, false, 60);
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const px = origin + fraction * plotWidth;
    axis += path(`M${px} 38V46`, [px], [38, 46], axisStyle, false, 60);
    axis += text(px, 25, String(Number((fraction * width).toPrecision(12))), { size: 20, color: palette.ink, probe: false });
  }
  if (spec.showAxis !== false) group('axis', 60, axis);
  for (const candidate of backingCandidates) {
    const b = candidate.box,
      striped = stripedAreas.some(
        (a) =>
          a.z <= candidate.z &&
          Math.min(b.x2, a.x2) > Math.max(b.x1, a.x1) &&
          Math.min(b.y2, a.y2) > Math.max(b.y1, a.y1),
      );
    let backing = '';
    if (striped) {
      // A 3-unit side pad and 3.5-unit vertical pad replace the former blur extent.
      const x = b.x1 - 3,
        y = b.y1 - 3.5,
        w = b.x2 - b.x1 + 6,
        h = b.y2 - b.y1 + 7;
      bound(x, x + w, y, y + h);
      backing = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${mask}"/>`;
    }
    for (const layer of layers)
      if (layer.svg.includes(candidate.marker))
        layer.svg = layer.svg.replace(candidate.marker, backing);
  }
  const left = Math.min(0, Math.floor(minX - 24)),
    top = Math.min(0, Math.floor(minY - 24));
  const right = Math.max(origin + 60 + plotWidth, Math.ceil(maxX + 28)),
    bottom = Math.max(rowY + 85, Math.ceil(maxY + 24));
  layers.sort((a, b) => a.z - b.z || a.order - b.order);
  // Remove only crossing strokes; translucent fills remain painted exactly once.
  for (const z of strokeLevels) {
    const holes = backingCandidates.filter(c => c.z >= z).map(({ box: b }) =>
      `<rect x="${b.x1 - 3}" y="${b.y1 - 3.5}" width="${b.x2 - b.x1 + 6}" height="${b.y2 - b.y1 + 7}" fill="black"/>`).join('');
    defs.push(`<mask id="${uid}stroke-${z}" maskUnits="userSpaceOnUse" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}"><rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="white"/>${holes}</mask>`);
  }
  defs.push(renderGridPattern(`${uid}grid`));
  const background = `<rect data-kind="background" data-z="0" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="${palette.background}"/><rect data-kind="grid" x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="url(#${uid}grid)"/>`;
  layers.push({ z: 0, order: -1, svg: background });
  layers.sort((a, b) => a.z - b.z || a.order - b.order);
  return {
    width,
    warnings: [...new Set(warnings)],
    svg: `<svg data-reader-fit="intrinsic-height" data-reader-min-text="7.5" xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${right - left} ${bottom - top}" data-x-origin="${origin}" data-x-scale="${plotWidth / width}" role="img" aria-label="Generated track diagram"><defs>${defs.join('')}</defs>${layers.map((v) => v.svg).join('')}</svg>`,
  };
}
function wrap(value, limit) {
  const words = value.split(/\s+/),
    lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > limit && line) {
      lines.push(line);
      line = '';
    }
    if (word.length > limit) {
      if (line) {
        lines.push(line);
        line = '';
      }
      for (let i = 0; i < word.length; i += limit) lines.push(word.slice(i, i + limit));
    } else line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines;
}
