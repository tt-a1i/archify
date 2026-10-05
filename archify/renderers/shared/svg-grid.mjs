// Shared by server-side graph renderers and the browser-capable Tracks layout.
export function renderGridPattern(id = 'grid') {
  return `<pattern id="${id}" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" class="c-grid" stroke-width="0.5"/>
          </pattern>`;
}
