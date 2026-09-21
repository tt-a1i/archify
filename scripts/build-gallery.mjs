#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copySiteAssets } from './copy-site-assets.mjs';
import { diagramTypeCopyReplacements } from './site-copy.mjs';

import { CASES, renderCard } from '../website/src/data/gallery-presentation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const skillRoot = path.join(repoRoot, 'archify');
const outputRoot = path.resolve(process.argv[2] || path.join(repoRoot, 'docs'));
const artifactsRoot = path.join(outputRoot, 'gallery', 'artifacts');
const sourcesRoot = path.join(outputRoot, 'gallery', 'sources');
const templatePath = path.join(__dirname, 'gallery-template.html');
const packageJson = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));


const SHAPES = {
  architecture: ['components', 'connections'],
  workflow: ['nodes', 'edges'],
  sequence: ['participants', 'messages'],
  dataflow: ['nodes', 'flows'],
  lifecycle: ['states', 'transitions'],
};

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}


fs.rmSync(artifactsRoot, { recursive: true, force: true });
fs.rmSync(sourcesRoot, { recursive: true, force: true });
fs.mkdirSync(artifactsRoot, { recursive: true });
fs.mkdirSync(sourcesRoot, { recursive: true });

const entries = [];
for (const item of CASES) {
  const inputPath = path.join(skillRoot, 'examples', item.input);
  const sourceBuffer = fs.readFileSync(inputPath);
  const source = JSON.parse(sourceBuffer.toString('utf8'));
  const artifactPath = path.join(artifactsRoot, item.output);
  const sourcePath = path.join(sourcesRoot, item.input);

  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers', item.type, `render-${item.type}.mjs`),
    inputPath,
    artifactPath,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.copyFileSync(inputPath, sourcePath);

  const checkOutput = execFileSync(process.execPath, [
    path.join(skillRoot, 'scripts', 'check-render-output.mjs'),
    artifactPath,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const validation = JSON.parse(checkOutput);
  const artifactBuffer = fs.readFileSync(artifactPath);
  const [nodeKey, edgeKey] = SHAPES[item.type];
  const checksPassed = validation.checks.filter((check) => check.ok).length;

  entries.push({
    ...item,
    title: source.meta.title,
    subtitle: source.meta.subtitle || '',
    schemaVersion: source.schema_version,
    visualPreset: source.meta.visual_preset || 'classic',
    animation: source.meta.animation || 'static',
    engineeringProfile: source.meta.engineering_profile || null,
    viewCount: Array.isArray(source.meta.views) ? source.meta.views.length : 0,
    viewIds: Array.isArray(source.meta.views) ? source.meta.views.map((view) => view.id) : [],
    nodeCount: Array.isArray(source[nodeKey]) ? source[nodeKey].length : 0,
    edgeCount: Array.isArray(source[edgeKey]) ? source[edgeKey].length : 0,
    artifactBytes: artifactBuffer.byteLength,
    sourceBytes: sourceBuffer.byteLength,
    artifactSha256: digest(artifactBuffer),
    sourceSha256: digest(sourceBuffer),
    checkCount: validation.checks.length,
    checksPassed,
    checks: validation.checks.map((check) => ({ name: check.name, ok: check.ok })),
    composition: validation.composition,
  });
}

const manifest = {
  schemaVersion: 1,
  generator: 'scripts/build-gallery.mjs',
  archifyVersion: packageJson.version,
  entryCount: entries.length,
  checkCount: entries.reduce((sum, entry) => sum + entry.checkCount, 0),
  entries: entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    title: entry.title,
    subtitle: entry.subtitle,
    input: `gallery/sources/${entry.input}`,
    artifact: `gallery/artifacts/${entry.output}`,
    focus: entry.focus,
    view: entry.view || null,
    viewCount: entry.viewCount,
    viewIds: entry.viewIds,
    guidedPlayback: entry.viewCount > 0,
    schemaVersion: entry.schemaVersion,
    visualPreset: entry.visualPreset,
    animation: entry.animation,
    engineeringProfile: entry.engineeringProfile,
    nodeCount: entry.nodeCount,
    edgeCount: entry.edgeCount,
    artifactBytes: entry.artifactBytes,
    artifactSha256: entry.artifactSha256,
    sourceBytes: entry.sourceBytes,
    sourceSha256: entry.sourceSha256,
    checks: entry.checks,
    composition: entry.composition,
  })),
};

const manifestJson = JSON.stringify(manifest, null, 2);
fs.writeFileSync(path.join(outputRoot, 'gallery', 'manifest.json'), `${manifestJson}\n`);

const replacements = {
  ...diagramTypeCopyReplacements(),
  '[[ARCHIFY_VERSION]]': packageJson.version,
  '[[ENTRY_COUNT]]': String(manifest.entryCount),
  '[[CHECK_COUNT]]': String(manifest.checkCount),
  '[[GALLERY_CARDS]]': entries.map(renderCard).join('\n'),
  '[[MANIFEST_JSON]]': manifestJson.replace(/<\/script/gi, '<\\/script'),
};

let html = fs.readFileSync(templatePath, 'utf8');
for (const [placeholder, value] of Object.entries(replacements)) {
  html = html.split(placeholder).join(value);
}
if (/\[\[[A-Z0-9_]+\]\]/.test(html)) {
  throw new Error('Gallery template contains unresolved placeholders');
}
const galleryPath = path.join(outputRoot, 'gallery.html');
copySiteAssets(galleryPath);
fs.writeFileSync(galleryPath, html);

console.log(`gallery ${manifest.entryCount} artifacts / ${manifest.checkCount} checks`);
console.log(path.join(outputRoot, 'gallery.html'));
