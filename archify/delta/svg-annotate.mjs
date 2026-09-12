function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function extractArchitectureSvg(html, failWith = fail) {
  const match = html.match(/<svg viewBox="0 0 [^"]+" role="img"[\s\S]*?<\/svg>/);
  if (!match) failWith('delta/svg-missing', 'A validated Architecture artifact did not contain its primary SVG.');
  return match[0];
}

export function extractArtifactCss(html, failWith = fail) {
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!match) failWith('delta/css-missing', 'A validated Architecture artifact did not contain its stylesheet.');
  return match[1];
}

export function addState(tag, change, side, forcedState) {
  const append = (attributes) => tag.endsWith('/>')
    ? tag.replace(/\/>$/, `${attributes}/>`)
    : tag.replace(/>$/, `${attributes}>`);
  if (!change && !forcedState) return append(' data-delta-state="same"');
  let state = forcedState || change.status;
  if (change?.status === 'added' && side === 'base') state = 'same';
  if (change?.status === 'removed' && side === 'head') state = 'same';
  const classes = change?.classifications?.join(',') || '';
  return append(` data-delta-state="${esc(state)}"${classes ? ` data-delta-classifications="${esc(classes)}"` : ''}`);
}

export function nodeGroupRanges(svg) {
  const ranges = [];
  const opener = /<g\s+[^>]*\bdata-node-id="([^"]+)"[^>]*>/g;
  let open;
  while ((open = opener.exec(svg))) {
    const tags = /<\/?g\b[^>]*>/g;
    tags.lastIndex = open.index;
    let depth = 0;
    let tag;
    while ((tag = tags.exec(svg))) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        ranges.push({ id: open[1], start: open.index, end: tags.lastIndex });
        opener.lastIndex = tags.lastIndex;
        break;
      }
    }
  }
  return ranges;
}

export function transformNodeGroups(svg, transform) {
  const ranges = nodeGroupRanges(svg);
  let cursor = 0;
  const parts = [];
  for (const range of ranges) {
    parts.push(svg.slice(cursor, range.start));
    parts.push(transform(svg.slice(range.start, range.end), range.id));
    cursor = range.end;
  }
  parts.push(svg.slice(cursor));
  return parts.join('');
}
