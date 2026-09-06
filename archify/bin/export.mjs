#!/usr/bin/env node

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio || 'inherit',
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
}

function extractSvgFromHtml(html) {
  // Extract the primary diagram SVG from the rendered HTML artifact
  const svgMatch = html.match(/<svg[^>]*viewBox="0 0 [^"]+"[^>]*>[\s\S]*?<\/svg>/);
  if (!svgMatch) {
    throw new Error('Could not extract SVG from rendered artifact.');
  }
  let svg = svgMatch[0];

  // Extract stylesheet from the HTML artifact so standalone SVG renders colors and typography
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  const css = styleMatch ? styleMatch[1].trim() : '';

  // Ensure xmlns attribute is present for standalone SVG validity
  if (!svg.includes('xmlns=')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // Embed stylesheet inside the SVG if styles exist and not already embedded
  if (css && !svg.includes('<style>')) {
    // Insert <style> right after the opening <svg ...> tag
    svg = svg.replace(/(<svg[^>]*>)/, `$1\n  <style>\n${css}\n  </style>`);
  }

  return svg;
}

function rendererPath(type) {
  const TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
  if (!TYPES.has(type)) {
    fail(`Unknown diagram type "${type}". Expected one of: ${[...TYPES].join(', ')}`);
  }
  return path.join(skillRoot, 'renderers', type, `render-${type}.mjs`);
}

function rendererEnv(quality, repoRoot) {
  return {
    ...(quality ? { ARCHIFY_QUALITY_PROFILE: quality } : {}),
    ...(repoRoot ? { ARCHIFY_REPO_ROOT: repoRoot } : {}),
  };
}

export async function commandExport(args) {
  const positional = [];
  let format = 'svg';
  let quality;
  let repoRoot;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--format') {
      format = args[index + 1];
      if (!format || format.startsWith('--')) fail('--format requires svg, png, or webp.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length);
      if (!format) fail('--format requires svg, png, or webp.');
      continue;
    }
    if (arg === '--quality') {
      quality = args[index + 1];
      if (!quality || quality.startsWith('--')) fail('--quality requires standard or showcase.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--quality=')) {
      quality = arg.slice('--quality='.length);
      if (!quality) fail('--quality requires standard or showcase.');
      continue;
    }
    if (arg === '--repo-root') {
      repoRoot = args[index + 1];
      if (!repoRoot || repoRoot.startsWith('--')) fail('--repo-root requires a repository path.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--repo-root=')) {
      repoRoot = arg.slice('--repo-root='.length);
      if (!repoRoot) fail('--repo-root requires a repository path.');
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg.startsWith('--')) {
      fail(`Unknown export option "${arg}".`);
    }
    positional.push(arg);
  }

  const [type, input, output] = positional;
  if (!type || !input || !output || positional.length !== 3) {
    fail('Usage: archify export <type> <input.json> <output.svg> [--format svg|png|webp] [--quality standard|showcase] [--repo-root path] [--json]');
  }

  if (quality && !['standard', 'showcase'].includes(quality)) {
    fail(`Unknown quality profile "${quality}". Expected standard or showcase.`);
  }

  if (!['svg', 'png', 'webp'].includes(format)) {
    fail(`Unknown format "${format}". Expected svg, png, or webp.`);
  }

  if (['png', 'webp'].includes(format)) {
    fail(`Format "${format}" is not yet supported. Currently only SVG export is available.\nFor PNG/WebP export, use "archify deliver" to generate the HTML artifact, then use the in-viewer Export menu.`);
  }

  if (repoRoot && type !== 'architecture') {
    fail('--repo-root is currently supported for architecture diagrams only.');
  }

  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);

  // Create a temporary directory for the intermediate HTML artifact
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-'));
  const tmpHtml = path.join(tmpDir, `${type}.html`);

  try {
    // Render the diagram to a temporary HTML file
    const render = runNode(
      [rendererPath(type), inputPath, tmpHtml],
      {
        stdio: 'pipe',
        env: rendererEnv(quality, repoRoot ? path.resolve(repoRoot) : undefined),
      }
    );

    if (render.status !== 0) {
      fail(`Render failed: ${render.stderr || 'Unknown error'}`, render.status ?? 1);
    }

    // Read the HTML and extract the SVG
    const html = fs.readFileSync(tmpHtml, 'utf8');
    const svg = extractSvgFromHtml(html);

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Write the SVG to the output file
    fs.writeFileSync(outputPath, svg, 'utf8');

    if (json) {
      const svgBuffer = Buffer.from(svg, 'utf8');
      console.log(JSON.stringify({
        schemaVersion: 1,
        ok: true,
        command: 'export',
        type,
        format,
        input: inputPath,
        output: outputPath,
        artifact: {
          sha256: createHash('sha256').update(svgBuffer).digest('hex'),
          bytes: svgBuffer.byteLength,
        },
      }, null, 2));
    } else {
      console.log(`exported ${type} ${format} ${outputPath}`);
    }
  } catch (error) {
    if (json) {
      console.log(JSON.stringify({
        schemaVersion: 1,
        ok: false,
        command: 'export',
        type,
        format,
        input: inputPath,
        output: outputPath,
        error: error.message,
      }, null, 2));
    } else {
      fail(`Export failed: ${error.message}`, 1);
    }
  } finally {
    // Clean up temporary directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Warning: could not remove temporary directory "${tmpDir}": ${cleanupError.message}`);
    }
  }
}

// Main execution when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  await commandExport(args);
}
