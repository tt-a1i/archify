import { esc } from './utils.mjs';

// Archify-authored, brand-neutral capability glyphs. These deliberately avoid
// vendor names, colors, initials, domains, and recognizable logo silhouettes.
// They are part of Archify and distributed under the repository MIT license.
export const CAPABILITY_MARKS = Object.freeze([
  { id: 'source-control', title: 'Source control', glyph: '<circle cx="6" cy="6" r="2"/><circle cx="14" cy="14" r="2"/><path d="M8 6h2a4 4 0 0 1 4 4v2M6 8v6h6"/>' },
  { id: 'delivery', title: 'Delivery pipeline', glyph: '<path d="M3 6h8M9 3l3 3-3 3M17 14H9m2-3-3 3 3 3"/>' },
  { id: 'container', title: 'Container', glyph: '<path d="m4 7 6-3 6 3v7l-6 3-6-3Z"/><path d="m4 7 6 3 6-3M10 10v7"/>' },
  { id: 'infrastructure', title: 'Infrastructure', glyph: '<rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="7.5" y="12" width="5" height="5" rx="1"/><path d="M5.5 8v2h9V8M10 10v2"/>' },
  { id: 'observability', title: 'Observability', glyph: '<path d="M3 14h3l2-7 3 9 2-6 2 4h2"/><circle cx="10" cy="10" r="8"/>' },
  { id: 'ai-routing', title: 'AI routing', glyph: '<circle cx="5" cy="10" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="15" cy="15" r="2"/><path d="M7 10h2c3 0 2-5 4-5M9 10c3 0 2 5 4 5"/>' },
  { id: 'ai-search', title: 'AI search', glyph: '<circle cx="8" cy="8" r="4"/><path d="m11 11 5 5M14 3v3M12.5 4.5h3"/>' },
  { id: 'application-platform', title: 'Application platform', glyph: '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 8h14M6 6h.01M9 6h.01"/>' },
  { id: 'cloud-platform', title: 'Cloud platform', glyph: '<path d="M6 15h9a3 3 0 0 0 .5-6A5.5 5.5 0 0 0 5 8.5 3.3 3.3 0 0 0 6 15Z"/><path d="M8 12h4M10 10v4"/>' },
  { id: 'language', title: 'Programming language', glyph: '<path d="m7 5-4 5 4 5M13 5l4 5-4 5M12 3 8 17"/>' },
  { id: 'ui-framework', title: 'UI framework', glyph: '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 7h14M7 7v10"/>' },
  { id: 'application-framework', title: 'Application framework', glyph: '<path d="M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z"/>' },
  { id: 'relational-database', title: 'Relational database', glyph: '<ellipse cx="10" cy="5" rx="6" ry="2.5"/><path d="M4 5v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5M4 10v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5"/>' },
  { id: 'document-database', title: 'Document database', glyph: '<path d="M5 3h7l3 3v11H5zM12 3v4h3M8 10h4M8 13h4"/>' },
  { id: 'cache', title: 'Cache', glyph: '<path d="M4 7h12v9H4zM6 4h8v3M7 11h6M7 14h4"/>' },
  { id: 'event-stream', title: 'Event stream', glyph: '<path d="M3 6h10M11 3l3 3-3 3M17 14H7m2-3-3 3 3 3"/><circle cx="4" cy="6" r="1"/><circle cx="16" cy="14" r="1"/>' },
  { id: 'message-queue', title: 'Message queue', glyph: '<rect x="3" y="4" width="14" height="4" rx="1"/><rect x="3" y="12" width="14" height="4" rx="1"/><path d="M6 8v4M14 8v4"/>' },
  { id: 'analytics-store', title: 'Analytics store', glyph: '<path d="M4 16V9M8 16V5M12 16v-7M16 16V3"/><path d="M3 16h14"/>' },
  { id: 'search-index', title: 'Search index', glyph: '<path d="M4 4h8M4 8h6M4 12h5"/><circle cx="13" cy="13" r="3"/><path d="m15.2 15.2 2 2"/>' },
  { id: 'time-series-store', title: 'Time-series store', glyph: '<path d="M3 15h14M4 13l3-4 3 2 3-6 3 3"/><path d="M4 4v12"/>' },
  { id: 'orchestration', title: 'Orchestration', glyph: '<circle cx="10" cy="10" r="3"/><circle cx="10" cy="3" r="1.5"/><circle cx="17" cy="10" r="1.5"/><circle cx="10" cy="17" r="1.5"/><circle cx="3" cy="10" r="1.5"/><path d="M10 4.5V7m3 3h2.5M10 13v2.5M7 10H4.5"/>' },
  { id: 'collaboration', title: 'Collaboration', glyph: '<circle cx="7" cy="7" r="3"/><circle cx="14" cy="8" r="2.5"/><path d="M2.5 17c.5-3 2.3-4.5 4.5-4.5s4 1.5 4.5 4.5M11 13c2.8-.8 5.5.8 6 4"/>' },
  { id: 'payments', title: 'Payments', glyph: '<rect x="2.5" y="5" width="15" height="11" rx="2"/><path d="M2.5 9h15M6 13h3"/>' },
  { id: 'commerce', title: 'Commerce', glyph: '<path d="M3 4h2l2 9h7l2-6H6"/><circle cx="8" cy="16" r="1"/><circle cx="14" cy="16" r="1"/>' },
  { id: 'crm', title: 'Customer relationship management', glyph: '<circle cx="7" cy="7" r="3"/><path d="M2.5 17c.5-3 2.2-4.5 4.5-4.5 1.5 0 2.8.6 3.6 1.8"/><path d="M13 10v6M10 13h6"/>' },
  { id: 'support', title: 'Customer support', glyph: '<path d="M4 11v-1a6 6 0 0 1 12 0v1M4 11v3h3v-4H4M16 11v3h-3v-4h3M13 16c-1 1-2 1.5-4 1.5"/>' },
  { id: 'media-channel', title: 'Media channel', glyph: '<path d="M3 5h8M3 9h6M3 13h4"/><circle cx="11" cy="14" r="1"/><path d="M13 10c2 1 3 2.5 3 4M13 6c4 2 6 4.5 6 8"/>' },
  { id: 'community-channel', title: 'Community channel', glyph: '<path d="M4 5h12v8H9l-4 3v-3H4z"/><circle cx="7" cy="9" r=".7"/><circle cx="10" cy="9" r=".7"/><circle cx="13" cy="9" r=".7"/>' },
]);

const BY_ID = new Map(CAPABILITY_MARKS.map((mark) => [mark.id, Object.freeze(mark)]));

export function capabilityMarkFor(node) {
  return node?.capability ? BY_ID.get(node.capability) || null : null;
}

export function renderCapabilityMark(node, { x, y, size = 16 } = {}) {
  const mark = capabilityMarkFor(node);
  if (!mark) return '';
  const scale = size / 20;
  return `<g aria-hidden="true" data-capability-mark="${esc(mark.id)}" data-capability-title="${esc(mark.title)}" data-identity-kind="capability" class="capability-mark" transform="translate(${x} ${y})">
            <rect width="${size}" height="${size}" rx="4" class="capability-mark-badge"/>
            <g transform="scale(${scale})" class="capability-mark-glyph">${mark.glyph}</g>
            <rect width="${size}" height="${size}" rx="4" class="capability-mark-frame"/>
          </g>`;
}
