const PRESETS = new Set(['classic', 'signal-flow', 'blueprint', 'editorial']);
const THEMES = new Set(['auto', 'light', 'dark']);

function markedSections(source, name) {
  const startMarker = `/* ARCHIFY:${name}_START */`;
  const endMarker = `/* ARCHIFY:${name}_END */`;
  const sections = [];
  let cursor = 0;
  while (true) {
    const start = source.indexOf(startMarker, cursor);
    if (start < 0) break;
    const contentStart = start + startMarker.length;
    const end = source.indexOf(endMarker, contentStart);
    if (end < 0) throw new Error(`SVG export stylesheet is missing ${endMarker}.`);
    sections.push(source.slice(contentStart, end).trim());
    cursor = end + endMarker.length;
  }
  if (!sections.length) throw new Error(`SVG export stylesheet is missing ${startMarker}.`);
  return sections;
}

function cssDeclarations(block) {
  const values = {};
  for (const match of block.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)) {
    values[match[1]] = match[2].trim();
  }
  return values;
}

function resolvedThemeVariables(themeCss, preset, theme) {
  const rules = new Map();
  for (const match of themeCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, '');
    const declarations = cssDeclarations(match[2]);
    if (Object.keys(declarations).length) rules.set(selector, declarations);
  }

  const dark = rules.get(':root,[data-theme="dark"]');
  const light = rules.get('[data-theme="light"]');
  if (!dark || !light) throw new Error('SVG export stylesheet is missing the classic theme variables.');
  const values = {
    ...dark,
    ...(theme === 'light' ? light : {}),
  };
  if (preset !== 'classic') {
    const override = rules.get(`[data-preset="${preset}"][data-theme="${theme}"]`);
    if (!override) throw new Error(`SVG export stylesheet is missing the ${preset} ${theme} variables.`);
    Object.assign(values, override);
  }
  return values;
}

function serializeVariables(values) {
  return Object.entries(values).map(([name, value]) => `${name}: ${value};`).join(' ');
}

function rootAttribute(markup, name, value) {
  const rootEnd = markup.indexOf('>');
  if (rootEnd < 0 || !/^\s*<svg\b/.test(markup.slice(0, rootEnd + 1))) {
    throw new Error('SVG export received no root <svg> element.');
  }
  const pattern = new RegExp(`\\s${name}="[^"]*"`, 'g');
  let root = markup.slice(0, rootEnd + 1).replace(pattern, '');
  if (value !== null) root = `${root.slice(0, -1)} ${name}="${value}">`;
  return root + markup.slice(rootEnd + 1);
}

function removeTagAttributes(tag, names) {
  return names.reduce((value, name) => (
    value.replace(new RegExp(`\\s${name}="[^"]*"`, 'g'), '')
  ), tag);
}

// Kept self-contained because applyTemplate embeds this exact function in the
// zero-install Viewer while Node imports and calls it directly.
export function buildStandaloneSvg(svgMarkup, options = {}) {
  function xmlText(value) {
    return String(value).replace(/[&<]/g, function (character) {
      return character === '&' ? '&amp;' : '&lt;';
    });
  }
  function xmlAttribute(value) {
    return String(value).replace(/[&"<>]/g, function (character) {
      return { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[character];
    });
  }

  var rootEnd = svgMarkup.indexOf('>');
  var closeStart = svgMarkup.lastIndexOf('</svg>');
  if (rootEnd < 0 || closeStart <= rootEnd || !/^\s*<svg\b/.test(svgMarkup.slice(0, rootEnd + 1))) {
    throw new Error('SVG export received malformed root markup.');
  }

  var fontFallback = [400, 500, 600, 700].map(function (weight) {
    return "@font-face { font-family: 'JetBrains Mono'; font-weight: " + weight +
      "; src: local('JetBrains Mono'), local('JetBrainsMono-Regular'); }";
  }).join('\n');
  var styleText = fontFallback + "\n" +
    "svg { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono CJK SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace; }\n" +
    String(options.hostStyle || '') + "\n";
  var background;
  if (options.theme === 'auto') {
    styleText += ":root, svg { " + options.darkVars + " }\n" +
      "@media (prefers-color-scheme: light) { :root, svg { " + options.lightVars + " } }\n" +
      "svg[data-theme=\"light\"] { " + options.lightVars + " }\n" +
      "svg[data-theme=\"dark\"] { " + options.darkVars + " }\n" +
      "rect.c-bg-rect { fill: var(--bg); }\n";
    background = '<rect width="100%" height="100%" class="c-bg-rect"/>';
  } else {
    styleText += ":root, svg { " + options.vars + " }\n";
    background = '<rect width="100%" height="100%" fill="' +
      xmlAttribute(options.background || '#ffffff') + '"/>';
  }
  styleText += String(options.extraStyle || '');

  return svgMarkup.slice(0, rootEnd + 1) +
    '<style>' + xmlText(styleText) + '</style>' + background +
    svgMarkup.slice(rootEnd + 1);
}

export function standaloneSvgBuilderSource() {
  return `(${buildStandaloneSvg.toString()})`;
}

export function renderStandaloneSvg({ svg, template, preset = 'classic', theme = 'auto' }) {
  if (!PRESETS.has(preset)) throw new Error(`Unknown SVG preset ${JSON.stringify(preset)}.`);
  if (!THEMES.has(theme)) throw new Error(`Unknown SVG theme ${JSON.stringify(theme)}.`);

  const themeCss = markedSections(template, 'SVG_EXPORT_THEME').join('\n');
  const hostStyle = [themeCss, ...markedSections(template, 'SVG_EXPORT_STYLE')].join('\n');
  const dark = resolvedThemeVariables(themeCss, preset, 'dark');
  const light = resolvedThemeVariables(themeCss, preset, 'light');

  let markup = String(svg).trim();
  markup = markup.replace(/\sdata-detail(?:-anchor)?="[^"]*"/g, '');
  markup = markup.replace(/<[^>]+\sdata-legend-kind="[^"]*"[^>]*>/g, (tag) => removeTagAttributes(tag, [
    'data-legend-kind',
    'data-legend-label',
    'data-legend-count',
    'data-legend-zero',
    'data-legend-selected',
    'role',
    'tabindex',
    'aria-label',
    'aria-pressed',
    'aria-haspopup',
    'aria-controls',
    'aria-expanded',
  ]));
  markup = markup.replace(/<[^>]+\sdata-legend-bridge="[^"]*"[^>]*>/g, (tag) => (
    removeTagAttributes(tag, ['data-legend-bridge', 'role', 'aria-label'])
  ));
  const rootEnd = markup.indexOf('>');
  const root = markup.slice(0, rootEnd + 1);
  const viewBox = root.match(/\bviewBox="([^"]+)"/)?.[1]
    ?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error('SVG export requires a finite positive viewBox.');
  }

  markup = rootAttribute(markup, 'xmlns', 'http://www.w3.org/2000/svg');
  markup = rootAttribute(markup, 'width', String(viewBox[2]));
  markup = rootAttribute(markup, 'height', String(viewBox[3]));
  markup = rootAttribute(markup, 'data-preset', preset);
  markup = rootAttribute(markup, 'data-theme', theme === 'auto' ? null : theme);

  return `${buildStandaloneSvg(markup, {
    hostStyle,
    theme,
    darkVars: serializeVariables(dark),
    lightVars: serializeVariables(light),
    vars: serializeVariables(theme === 'light' ? light : dark),
    background: (theme === 'light' ? light : dark)['--bg'],
  })}\n`;
}
