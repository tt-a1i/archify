const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

export function renderDefinitions() {
  return `        <!-- Definitions -->
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-default" />
          </marker>
          <marker id="arrowhead-emphasis" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-emphasis" />
          </marker>
          <marker id="arrowhead-security" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-security" />
          </marker>
          <marker id="arrowhead-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-dashed" />
          </marker>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" class="c-grid" stroke-width="0.5"/>
          </pattern>
        </defs>`;
}

const SIGIL_TONE = {
  frontend: 'frontend',
  start: 'frontend',
  backend: 'backend',
  active: 'backend',
  database: 'database',
  success: 'database',
  cloud: 'cloud',
  waiting: 'cloud',
  security: 'security',
  failure: 'security',
  messagebus: 'messagebus',
  external: 'external',
  neutral: 'external',
};

const SIGIL_SHAPE = {
  frontend: `<rect x="2" y="3" width="12" height="10" rx="2"/>
            <path d="M2 6.5h12"/>
            <circle cx="4.1" cy="4.8" r=".7" class="sigil-fill"/>
            <circle cx="6.3" cy="4.8" r=".7" class="sigil-fill"/>`,
  backend: `<path d="M6 3 3 8l3 5M10 3l3 5-3 5"/>`,
  database: `<ellipse cx="8" cy="4" rx="5" ry="2"/>
            <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/>`,
  cloud: `<path d="M4.3 12.5h7.3a2.4 2.4 0 0 0 .2-4.8 4 4 0 0 0-7.5-1.3A3.1 3.1 0 0 0 4.3 12.5Z"/>`,
  security: `<path d="M8 2.2 13 4v3.5c0 3.1-1.8 5.4-5 6.5-3.2-1.1-5-3.4-5-6.5V4Z"/>
            <path d="m5.8 8 1.5 1.5 3-3"/>`,
  messagebus: `<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>
            <circle cx="5" cy="4.5" r="1" class="sigil-fill"/>
            <circle cx="10.5" cy="8" r="1" class="sigil-fill"/>
            <circle cx="7" cy="11.5" r="1" class="sigil-fill"/>`,
  external: `<rect x="2.5" y="5" width="8.5" height="8" rx="1.5"/>
            <path d="M8 2.5h5.5V8M13.5 2.5 7.5 8.5"/>`,
  start: `<circle cx="8" cy="8" r="5"/>
            <path d="m7 5.4 3.6 2.6L7 10.6Z" class="sigil-fill"/>`,
  active: `<path d="M2 8h3l1.5-3.5L9 12l1.6-4H14"/>`,
  waiting: `<path d="M4 2.5h8M4 13.5h8M5 3c0 2.8 2 3.2 3 5-1 1.8-3 2.2-3 5M11 3c0 2.8-2 3.2-3 5 1 1.8 3 2.2 3 5"/>`,
  success: `<circle cx="8" cy="8" r="5.3"/>
            <path d="m5.2 8 1.8 1.8 3.8-4"/>`,
  failure: `<circle cx="8" cy="8" r="5.3"/>
            <path d="m5.7 5.7 4.6 4.6m0-4.6-4.6 4.6"/>`,
  neutral: `<rect x="3" y="3" width="10" height="10" rx="2"/>
            <circle cx="8" cy="8" r="1.2" class="sigil-fill"/>`,
};

// A quiet, renderer-owned role stamp. It is authored SVG content rather than a
// viewer overlay, so it survives canonical export while adding no focus target,
// accessible name, layout box, or interaction state of its own.
export function renderSemanticSigil(kind, { x, y, size = 11 } = {}) {
  const normalized = Object.hasOwn(SIGIL_SHAPE, kind) ? kind : 'neutral';
  const tone = SIGIL_TONE[normalized] || 'external';
  const scale = size / 16;
  return `<g aria-hidden="true" data-semantic-sigil="${esc(normalized)}" class="semantic-sigil s-${tone}" transform="translate(${x} ${y}) scale(${scale})">
            ${SIGIL_SHAPE[normalized]}
          </g>`;
}

export function renderCards(cards) {
  const list = Array.isArray(cards) ? cards : [];
  return `    <!-- Info Cards -->
    <div class="cards">
${list.map((card) => `      <div class="card">
        <div class="card-header">
          <div class="card-dot ${esc(card.dot)}"></div>
          <h3>${esc(card.title)}</h3>
        </div>
        <ul>
${card.items.map((item) => `          <li>&bull; ${esc(item)}</li>`).join('\n')}
        </ul>
      </div>`).join('\n\n')}
    </div>`;
}

const SVG_SLOT_RE = /      <!-- ARCHIFY:SVG_SLOT_START -->[\s\S]*?      <!-- ARCHIFY:SVG_SLOT_END -->/;
const CARDS_SLOT_RE = /    <!-- ARCHIFY:CARDS_SLOT_START -->[\s\S]*?    <!-- ARCHIFY:CARDS_SLOT_END -->/;
const GUIDED_VIEWS_PLACEHOLDER = '<!-- ARCHIFY:GUIDED_VIEWS_DATA -->';

const TEMPLATE_PLACEHOLDERS = [
  '<html lang="en" data-theme="dark" data-preset="[VISUAL PRESET]">',
  '<title>[PROJECT NAME] Architecture Diagram</title>',
  '<h1>[PROJECT NAME] Architecture</h1>',
  '<p class="subtitle">[Subtitle description]</p>',
  '[Project Name] &bull; [Additional metadata]',
  GUIDED_VIEWS_PLACEHOLDER,
];

// `footer` is injected as raw HTML so callers can embed <kbd> hints;
// pass only trusted strings here, never user input.
export function applyTemplate(template, { title, subtitle, footer, svg, cards, visualPreset = 'classic', guidedViews = [] }) {
  if (!SVG_SLOT_RE.test(template)) {
    throw new Error('applyTemplate: template missing ARCHIFY:SVG_SLOT sentinel');
  }
  if (!CARDS_SLOT_RE.test(template)) {
    throw new Error('applyTemplate: template missing ARCHIFY:CARDS_SLOT sentinel');
  }
  for (const ph of TEMPLATE_PLACEHOLDERS) {
    if (!template.includes(ph)) {
      throw new Error(`applyTemplate: template missing placeholder ${JSON.stringify(ph)}`);
    }
  }
  // Function replacers: a literal `$&`, `$'`, `$\`` or `$$` in titles, labels,
  // or rendered SVG must not be interpreted as a replacement pattern.
  const guidedViewsJson = JSON.stringify(guidedViews)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
  return template
    .replace(TEMPLATE_PLACEHOLDERS[0], () => `<html lang="en" data-theme="dark" data-preset="${esc(visualPreset)}">`)
    .replace(TEMPLATE_PLACEHOLDERS[1], () => `<title>${esc(title)} Diagram</title>`)
    .replace(TEMPLATE_PLACEHOLDERS[2], () => `<h1>${esc(title)}</h1>`)
    .replace(TEMPLATE_PLACEHOLDERS[3], () => `<p class="subtitle">${esc(subtitle ?? '')}</p>`)
    .replace(SVG_SLOT_RE, () => svg)
    .replace(CARDS_SLOT_RE, () => cards)
    .replace(TEMPLATE_PLACEHOLDERS[4], () => footer)
    .replace(GUIDED_VIEWS_PLACEHOLDER, () => `<script id="archify-guided-views-data" type="application/json">${guidedViewsJson}</script>`);
}

// CJK and other fullwidth glyphs render at roughly twice the advance width of
// ASCII in the monospace stacks the template uses. Includes the supplementary
// CJK extensions and emoji, which also render double-width.
const FULLWIDTH_RE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦　-〿\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

export function textUnits(text) {
  let units = 0;
  for (const ch of String(text ?? '')) units += FULLWIDTH_RE.test(ch) ? 2 : 1;
  return units;
}
