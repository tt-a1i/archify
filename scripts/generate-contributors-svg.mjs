#!/usr/bin/env node
// Builds a README contributors wall from the GitHub contributors API.
// Avatar bytes are inlined as base64 so GitHub's image proxy does not have to
// fetch nested images. The scheduled workflow publishes the file on a data
// branch; this script does not commit.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const WALL_WIDTH = 1000;
const COLUMNS = 8;
const AVATAR = 72;
const CELL_WIDTH = WALL_WIDTH / COLUMNS;
const AVATAR_X = (CELL_WIDTH - AVATAR) / 2;
const AVATAR_Y = 8;
const NAME_LIMIT = 18;
const ROW_HEIGHT = AVATAR_Y + AVATAR + 36;
const MAX_AVATAR_BYTES = 1_500_000;

// Exact logins, plus any account GitHub marks as a Bot or names with [bot].
// "claude" is the unscoped Claude app login, not a substring of human names.
const BOT_LOGINS = new Set([
  'allcontributors',
  'claude',
  'codecov',
  'copilot',
  'dependabot',
  'dependabot-preview',
  'github-actions',
  'imgbot',
  'pre-commit-ci',
  'renovate',
  'snyk-bot',
  'web-flow',
]);

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export function isBotContributor(user) {
  if (!user || typeof user.login !== 'string') return true;
  if (user.type === 'Bot') return true;
  const login = user.login.trim();
  if (/\[bot\]$/i.test(login)) return true;
  return BOT_LOGINS.has(login.toLowerCase());
}

export function displayLogin(login) {
  if (login.length <= NAME_LIMIT) return login;
  return `${login.slice(0, NAME_LIMIT - 1)}…`;
}

export function avatarMediaType(bytes, headerType = '') {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const gif = bytes.length >= 6 ? bytes.subarray(0, 6).toString('ascii') : '';
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  const normalized = String(headerType).split(';')[0].trim().toLowerCase();
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(normalized)) return normalized;
  throw new Error('Avatar is not a PNG, JPEG, GIF, or WebP image');
}

function xmlEscape(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[char]));
}

function repoParts(repo) {
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(repo || '');
  if (!match) throw new Error('Repository must look like owner/name');
  return { owner: match[1], name: match[2] };
}

function githubHeaders(token, accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'User-Agent': 'archify-contributors-svg',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function nextPage(linkHeader) {
  if (!linkHeader) return '';
  for (const part of linkHeader.split(',')) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part);
    if (!match) continue;
    const url = new URL(match[1]);
    if (url.protocol !== 'https:' || url.hostname !== 'api.github.com') {
      throw new Error('Refusing contributors pagination outside api.github.com');
    }
    return url.href;
  }
  return '';
}

export async function fetchContributors({ repo = 'tt-a1i/archify', token = '', fetchImpl = fetch } = {}) {
  const { owner, name } = repoParts(repo);
  let url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contributors?per_page=100`;
  const people = [];
  const seen = new Set();
  while (url) {
    const response = await fetchImpl(url, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub contributors request failed (${response.status})`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('GitHub contributors response was not a list');
    for (const user of page) {
      if (isBotContributor(user) || seen.has(user.login)) continue;
      if (!LOGIN.test(user.login)) continue;
      seen.add(user.login);
      people.push({
        login: user.login,
        contributions: Number(user.contributions) || 0,
        avatarUrl: user.avatar_url,
      });
    }
    url = nextPage(response.headers.get('link'));
  }
  people.sort((a, b) => b.contributions - a.contributions || a.login.localeCompare(b.login));
  if (!people.length) throw new Error('No human contributors to render');
  return people;
}

function avatarRequestUrl(avatarUrl, login) {
  let url;
  try {
    url = new URL(avatarUrl);
  } catch {
    throw new Error(`Contributor ${login} has no avatar URL`);
  }
  if (url.protocol !== 'https:' || !['avatars.githubusercontent.com', 'github.com'].includes(url.hostname)) {
    throw new Error(`Refusing avatar host for ${login}`);
  }
  url.searchParams.set('s', '144');
  return url;
}

export async function fetchAvatarDataUri(person, { token = '', fetchImpl = fetch } = {}) {
  const response = await fetchImpl(avatarRequestUrl(person.avatarUrl, person.login), {
    headers: githubHeaders(token, 'application/octet-stream'),
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Avatar download failed for ${person.login} (${response.status})`);
  const requested = avatarRequestUrl(person.avatarUrl, person.login);
  const finalHost = new URL(response.url || requested).hostname;
  if (!['avatars.githubusercontent.com', 'github.com'].includes(finalHost)) {
    throw new Error(`Refusing redirected avatar host for ${person.login}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) {
    throw new Error(`Avatar for ${person.login} is empty or larger than ${MAX_AVATAR_BYTES} bytes`);
  }
  const mediaType = avatarMediaType(bytes, response.headers.get('content-type') || '');
  return `data:${mediaType};base64,${bytes.toString('base64')}`;
}

export function renderContributorsSvg(contributors) {
  if (!Array.isArray(contributors) || contributors.length === 0) {
    throw new Error('No human contributors to render');
  }
  const rows = Math.ceil(contributors.length / COLUMNS);
  const cells = contributors.map((person, index) => {
    if (!person || !LOGIN.test(person.login || '')) throw new Error('Contributor login is not a GitHub login');
    if (!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(person.dataUri || '')) {
      throw new Error(`Contributor ${person.login} is missing an inline avatar`);
    }
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const label = displayLogin(person.login);
    const centerX = AVATAR_X + AVATAR / 2;
    const centerY = AVATAR_Y + AVATAR / 2;
    return `  <g transform="translate(${column * CELL_WIDTH} ${row * ROW_HEIGHT})">
    <title>${xmlEscape(person.login)}</title>
    <defs><clipPath id="archify-contributor-${index}"><circle cx="${centerX}" cy="${centerY}" r="${AVATAR / 2}"/></clipPath></defs>
    <image href="${person.dataUri}" x="${AVATAR_X}" y="${AVATAR_Y}" width="${AVATAR}" height="${AVATAR}" clip-path="url(#archify-contributor-${index})" preserveAspectRatio="xMidYMid slice"/>
    <circle class="ring" cx="${centerX}" cy="${centerY}" r="${AVATAR / 2}" fill="none" stroke-width="1"/>
    <text class="name" x="${centerX}" y="${AVATAR_Y + AVATAR + 22}" text-anchor="middle">${xmlEscape(label)}</text>
  </g>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WALL_WIDTH}" height="${rows * ROW_HEIGHT}" viewBox="0 0 ${WALL_WIDTH} ${rows * ROW_HEIGHT}" role="img">
  <title>Archify contributors</title>
  <style><![CDATA[
    .name { fill: #24292f; stroke: #ffffff; stroke-width: 3px; paint-order: stroke fill; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 12px; }
    .ring { stroke: #d0d7de; }
    @media (prefers-color-scheme: dark) {
      .name { fill: #f0f6fc; stroke: #010409; }
      .ring { stroke: #30363d; }
    }
  ]]></style>
${cells.join('\n')}
</svg>
`;
}

export async function buildContributorsSvg(options = {}) {
  const people = await fetchContributors(options);
  const rendered = [];
  for (const person of people) {
    rendered.push({
      login: person.login,
      dataUri: await fetchAvatarDataUri(person, options),
    });
  }
  return renderContributorsSvg(rendered);
}

function parseArgs(argv) {
  const options = { repo: 'tt-a1i/archify', out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--repo') options.repo = argv[++index];
    else if (arg === '--out') options.out = argv[++index];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
    if (options.repo === undefined || options.out === undefined) throw new Error(`Missing value for ${arg}`);
  }
  return options;
}

async function main(argv, env = process.env) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log('Usage: node scripts/generate-contributors-svg.mjs [--repo owner/name] [--out file]');
    return;
  }
  const svg = await buildContributorsSvg({
    repo: options.repo,
    token: env.GH_TOKEN || env.GITHUB_TOKEN || '',
  });
  if (options.out) fs.writeFileSync(options.out, svg);
  else process.stdout.write(svg);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
