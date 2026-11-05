import fs from 'node:fs';

const files = ['NOTICE', 'LICENSE', 'LICENSE-MIT', 'THIRD_PARTY_NOTICES.md'];
export const softwareNotices = files.map(name => `${name}\n${fs.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8').trimEnd()}`).join('\n\n');
// JSON data preserves the exact notice text without HTML/script delimiters.
export const softwareNoticesHtml = `<script type="application/json" id="archify-software-notices">${JSON.stringify(softwareNotices).replace(/</g, '\\u003c')}</script>`;
