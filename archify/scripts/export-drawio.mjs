#!/usr/bin/env node
/**
 * Archify → draw.io exporter.
 *
 * Pipeline: JSON IR  --render-->  HTML artifact  --extract SVG-->  draw.io XML.
 *
 * The SVG is the geometry source (it already contains the renderer's computed
 * layout, routing, and port spreading); the JSON IR contributes semantic
 * relationships that are not in the SVG (architecture boundary `wraps`).
 *
 * Usage: node scripts/export-drawio.mjs <type> <input.json> [output.drawio] [--strict]
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractSvgFromHtml, convertArchifyToDrawio } from '../renderers/shared/svg-to-drawio.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

const TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
const DEFAULT_EXAMPLE = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'event-stream.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

const argv = process.argv.slice(2).filter((arg) => arg !== '--strict');
const strict = process.argv.includes('--strict');
const [diagramType, inputArg, outputArg] = argv;

if (!diagramType || !TYPES.has(diagramType)) {
  fail(`Unknown diagram type "${diagramType}". Expected one of: ${[...TYPES].join(', ')}`);
}

const inputPath = path.resolve(inputArg || path.join(skillRoot, 'examples', DEFAULT_EXAMPLE[diagramType]));
if (!fs.existsSync(inputPath)) {
  fail(`Input file not found: ${inputPath}`, 1);
}

// Resolve output path: explicit arg, or replace .json/.html with .drawio
// (strict mode appends "-strict" so both variants can coexist).
const outputPath = outputArg
  ? path.resolve(outputArg)
  : inputPath.replace(/\.(json|html)$/, strict ? '.strict.drawio' : '.drawio');

// 1. Read + validate the JSON IR (light parse; full schema validation happens
//    inside the renderer via loadDiagram).
const diagram = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// 2. Render the HTML artifact via the type's renderer (reuse the existing,
//    validated rendering pipeline). Output to a temp file.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-drawio-'));
const tmpHtml = path.join(tmpDir, 'rendered.html');
try {
  const rendererScript = path.join(skillRoot, `renderers/${diagramType}/render-${diagramType}.mjs`);
  execFileSync(process.execPath, [rendererScript, inputPath, tmpHtml], { stdio: 'inherit' });

  // 3. Extract the SVG and convert to draw.io XML. Strict mode additionally
  //    feeds the artifact CSS so shapes keep their exact Archify colors,
  //    corner radii, and dash patterns — always resolved from the light theme
  //    so the .drawio file reads correctly under any draw.io theme.
  const html = fs.readFileSync(tmpHtml, 'utf8');
  const svg = extractSvgFromHtml(html);
  const css = html.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] || '';
  const drawioXml = convertArchifyToDrawio(svg, diagramType, diagram, { strict, css });

  // 4. Write the .drawio file.
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, drawioXml);
  console.log(outputPath);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
