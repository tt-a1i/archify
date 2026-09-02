import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { stageCleanSkill } from '../../scripts/stage-clean-skill.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-svg-delivery-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

const typeCases = [
  ['architecture', 'web-app.architecture.json'],
  ['workflow', 'agent-tool-call.workflow.json'],
  ['sequence', 'cache-miss-request.sequence.json'],
  ['dataflow', 'product-analytics.dataflow.json'],
  ['lifecycle', 'agent-run.lifecycle.json'],
].map(([type, file]) => ({
  id: type,
  type,
  input: path.join(skillRoot, 'examples', file),
}));

function architectureVariant(id, change) {
  const diagram = JSON.parse(fs.readFileSync(typeCases[0].input, 'utf8'));
  delete diagram.meta.output;
  change(diagram);
  const input = path.join(tmp, `${id}.architecture.json`);
  fs.writeFileSync(input, `${JSON.stringify(diagram, null, 2)}\n`);
  return { id, type: 'architecture', input };
}

const parityCases = [
  ...typeCases,
  ...['signal-flow', 'blueprint', 'editorial'].map((preset) => (
    architectureVariant(`architecture-${preset}`, (diagram) => {
      diagram.meta.visual_preset = preset;
    })
  )),
  {
    id: 'architecture-brands',
    type: 'architecture',
    input: path.join(skillRoot, 'examples', 'brand-aware-delivery.architecture.json'),
  },
  architectureVariant('architecture-unicode', (diagram) => {
    diagram.meta.title = '全球架构 🌏';
    diagram.meta.locale = 'zh-CN';
    diagram.components.find((component) => component.id === 'users').label = '用户 👩‍💻';
    diagram.components.find((component) => component.id === 'db').label = '数据库';
    diagram.connections.find((connection) => connection.id === 'users-to-cdn').label = '请求';
  }),
];

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function svgParts(markup) {
  const match = markup.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/);
  assert.ok(match, 'expected one SVG root');
  return { root: match[1], body: match[2] };
}

function diagramBody(standaloneSvg) {
  return svgParts(standaloneSvg).body.replace(
    /^<style>[\s\S]*?<\/style><rect width="100%" height="100%" (?:class="c-bg-rect"|fill="[^"]+")\/>/,
    '',
  );
}

function deliverSvg({ id, type, input }, theme, suffix = '') {
  const output = path.join(tmp, `${id}-${theme}${suffix}.svg`);
  const result = run([
    'deliver', type, input, output,
    '--format', 'svg', '--theme', theme, '--quality', 'showcase', '--json',
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { output, artifact: fs.readFileSync(output, 'utf8'), receipt: JSON.parse(result.stdout) };
}

test('SVG delivery covers every diagram type, theme, preset, brand mark, and Unicode path', { timeout: 120000 }, () => {
  for (const item of parityCases) {
    let canonicalBody = null;
    const source = JSON.parse(fs.readFileSync(item.input, 'utf8'));
    const expectedPreset = source.meta.visual_preset || 'classic';

    for (const theme of ['auto', 'light', 'dark']) {
      const delivered = deliverSvg(item, theme);
      const root = svgParts(delivered.artifact).root;
      const body = diagramBody(delivered.artifact);
      if (canonicalBody === null) canonicalBody = body;
      else assert.equal(body, canonicalBody, `${item.id} ${theme}`);
      const viewBox = root.match(/\bviewBox="(?:[-\d.]+[ ,]+){2}([-\d.]+)[ ,]+([-\d.]+)"/);
      assert.ok(viewBox, item.id);
      assert.match(root, /\bxmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.match(root, new RegExp(`\\bwidth="${viewBox[1]}"`));
      assert.match(root, new RegExp(`\\bheight="${viewBox[2]}"`));
      assert.match(root, new RegExp(`\\bdata-preset="${expectedPreset}"`));
      assert.equal(delivered.receipt.format, 'svg');
      assert.equal(delivered.receipt.theme, theme);
      assert.deepEqual(delivered.receipt.validation, {
        checksPassed: 9,
        checkCount: 9,
        compositionProfile: 'showcase',
        compositionStatus: 'pass',
        errors: 0,
        warnings: 0,
      });
      assert.deepEqual(delivered.receipt.svgValidation, { checksPassed: 16, checkCount: 16 });
      if (theme === 'auto') {
        assert.doesNotMatch(root, /\bdata-theme=/);
        assert.match(delivered.artifact, /@media \(prefers-color-scheme: light\)/);
      } else {
        assert.match(root, new RegExp(`\\bdata-theme="${theme}"`));
        assert.doesNotMatch(delivered.artifact, /@media \(prefers-color-scheme: light\)/);
      }
    }
  }

  const first = deliverSvg(typeCases[0], 'auto', '-repeat-a');
  const second = deliverSvg(typeCases[0], 'auto', '-repeat-b');
  assert.equal(first.artifact, second.artifact);
});

test('SVG delivery rejects malformed options and unsafe paths without touching trusted output', () => {
  const existing = path.join(tmp, 'trusted.svg');
  const input = typeCases[0].input;
  for (const args of [
    ['--format', 'pdf'],
    ['--format', 'svg', '--theme', 'sepia'],
    ['--format', 'svg', '--format', 'svg'],
    ['--format', 'svg', '--theme', 'dark', '--theme', 'light'],
    ['--format', 'html', '--theme', 'dark'],
    ['--format', 'svg', '--unknown'],
  ]) {
    fs.writeFileSync(existing, 'trusted\n');
    const result = run(['deliver', 'architecture', input, existing, ...args, '--json']);
    assert.equal(result.status, 2, args.join(' '));
    assert.equal(JSON.parse(result.stdout).stage, 'options', args.join(' '));
    assert.equal(fs.readFileSync(existing, 'utf8'), 'trusted\n', args.join(' '));
  }

  const missingPath = run(['deliver', 'architecture', input, '--format', 'svg', '--json']);
  assert.equal(missingPath.status, 2);
  assert.equal(JSON.parse(missingPath.stdout).diagnostics[0].code, 'delivery/svg-output-path');

  const wrongExtension = run(['deliver', 'architecture', input, path.join(tmp, 'wrong.html'), '--format=svg', '--json']);
  assert.equal(wrongExtension.status, 2);
  assert.equal(JSON.parse(wrongExtension.stdout).diagnostics[0].code, 'delivery/svg-output-path');

  const malformedInput = path.join(tmp, 'malformed.json');
  fs.writeFileSync(malformedInput, '{');
  fs.writeFileSync(existing, 'trusted\n');
  const malformed = run(['deliver', 'architecture', malformedInput, existing, '--format=svg', '--theme=dark', '--json']);
  assert.equal(malformed.status, 1);
  assert.equal(JSON.parse(malformed.stdout).stage, 'input');
  assert.equal(JSON.parse(malformed.stdout).output, existing);
  assert.equal(fs.readFileSync(existing, 'utf8'), 'trusted\n');

  for (const link of ['symlink', 'hardlink']) {
    const directory = fs.mkdtempSync(path.join(tmp, `alias-${link}-`));
    const aliasInput = path.join(directory, 'diagram.json');
    const aliasOutput = path.join(directory, 'diagram.svg');
    fs.copyFileSync(input, aliasInput);
    if (link === 'symlink') fs.symlinkSync(aliasInput, aliasOutput, 'file');
    else fs.linkSync(aliasInput, aliasOutput);
    const source = fs.readFileSync(aliasInput);
    const result = run(['deliver', 'architecture', aliasInput, aliasOutput, '--format', 'svg', '--json']);
    assert.equal(result.status, 1, link);
    assert.equal(JSON.parse(result.stdout).stage, 'prepare', link);
    assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'output/input-alias', link);
    assert.deepEqual(fs.readFileSync(aliasInput), source, link);
    assert.deepEqual(fs.readdirSync(directory).filter((name) => name.startsWith('.archify-delivery-')), []);
  }
});

test('ambient internal SVG variables cannot change default HTML delivery', () => {
  const output = path.join(tmp, 'default-delivery.html');
  const result = run([
    'deliver', 'architecture', typeCases[0].input, output,
    '--quality', 'showcase', '--json',
  ], { ARCHIFY_OUTPUT_FORMAT: 'svg', ARCHIFY_SVG_THEME: 'light' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(fs.readFileSync(output, 'utf8'), /^<!DOCTYPE html>/);
  assert.equal(Object.hasOwn(JSON.parse(result.stdout), 'format'), false);
});

test('standalone SVG checks reject network, script, and embedded SVG resources', () => {
  const delivered = deliverSvg(typeCases[0], 'auto', '-resource-check');
  const closing = delivered.artifact.lastIndexOf('</svg>');
  for (const [name, injection] of [
    ['network-attribute', '<image href="https://example.invalid/mark.png"/>'],
    ['network-css', '<style>.x{background:url(https://example.invalid/mark.png)}</style>'],
    ['embedded-svg', '<image href="data:image/svg+xml;base64,PHN2Zy8+"/>'],
    ['script', '<script>throw new Error()</script>'],
  ]) {
    const output = path.join(tmp, `${name}.svg`);
    fs.writeFileSync(output, `${delivered.artifact.slice(0, closing)}${injection}</svg>\n`);
    const result = run(['check', output]);
    assert.equal(result.status, 1, name);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.checks.find((check) => check.name === 'standalone_resources').ok, false, name);
  }
});

test('direct SVG and Viewer export have identical structure and decoded pixels across the matrix', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run exact SVG parity.',
  timeout: 180000,
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    for (const item of parityCases) {
      const htmlOutput = path.join(tmp, `${item.id}-browser-parity.html`);
      const htmlResult = run(['deliver', item.type, item.input, htmlOutput, '--quality', 'showcase', '--json']);
      assert.equal(htmlResult.status, 0, `${item.id}: ${htmlResult.stderr || htmlResult.stdout}`);
      const direct = Object.fromEntries(['auto', 'light', 'dark'].map((theme) => {
        const delivered = deliverSvg(item, theme, '-browser');
        return [theme, delivered.artifact];
      }));

      await browser.inspect({ artifactPath: htmlOutput, width: 1440, height: 900, theme: 'dark' });
      const sessionId = await browser.sessionPromise;
      const response = await browser.cdp.send('Runtime.evaluate', {
        expression: `(async function () {
        var captured = null;
        var originalCreateObjectURL = URL.createObjectURL.bind(URL);
        var originalClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = function (blob) {
          if (blob && blob.type && blob.type.indexOf('image/svg+xml') === 0) captured = blob;
          return originalCreateObjectURL(blob);
        };
        HTMLAnchorElement.prototype.click = function () {};
        try {
          await Archify.exportMenu.run('svg');
        } finally {
          URL.createObjectURL = originalCreateObjectURL;
          HTMLAnchorElement.prototype.click = originalClick;
        }
        if (!captured) throw new Error('Viewer SVG export was not captured.');
        var viewerText = await captured.text();
        var direct = ${JSON.stringify(direct)};
        var parser = new DOMParser();
        var serializer = new XMLSerializer();

        function signature(text) {
          var root = parser.parseFromString(text, 'image/svg+xml').documentElement;
          var clone = root.cloneNode(true);
          var style = clone.querySelector(':scope > style');
          if (style) style.remove();
          var background = clone.querySelector(':scope > rect.c-bg-rect, :scope > rect[width="100%"][height="100%"]');
          if (background) background.remove();
          ['xmlns', 'width', 'height', 'data-theme'].forEach(function (name) { clone.removeAttribute(name); });
          function elementValue(element) {
            var attributes = Array.from(element.attributes).map(function (attribute) {
              return [attribute.name, attribute.value];
            }).sort(function (left, right) { return left[0].localeCompare(right[0]); });
            return [
              element.localName,
              attributes,
              element.localName === 'text' || element.localName === 'title' || element.localName === 'desc'
                ? element.textContent : '',
              Array.from(element.children).map(elementValue)
            ];
          }
          return JSON.stringify(elementValue(clone));
        }

        function forceTheme(text, theme) {
          var root = parser.parseFromString(text, 'image/svg+xml').documentElement;
          if (theme) root.setAttribute('data-theme', theme);
          else root.removeAttribute('data-theme');
          return serializer.serializeToString(root);
        }

        function pixels(text) {
          return new Promise(function (resolve, reject) {
            var root = parser.parseFromString(text, 'image/svg+xml').documentElement;
            var width = Number(root.getAttribute('width'));
            var height = Number(root.getAttribute('height'));
            var url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
            var image = new Image();
            image.onload = function () {
              try {
                var canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                var context = canvas.getContext('2d');
                context.drawImage(image, 0, 0);
                resolve(context.getImageData(0, 0, width, height).data);
              } catch (error) {
                reject(error);
              } finally {
                URL.revokeObjectURL(url);
              }
            };
            image.onerror = reject;
            image.src = url;
          });
        }

        var result = { structure: {}, pixelMismatches: {} };
        var directSignature = signature(direct.auto);
        var viewerSignature = signature(viewerText);
        result.structure.auto = directSignature === viewerSignature;
        if (!result.structure.auto) {
          var difference = 0;
          while (difference < directSignature.length && difference < viewerSignature.length &&
            directSignature[difference] === viewerSignature[difference]) difference += 1;
          result.structureDifference = {
            index: difference,
            direct: directSignature.slice(Math.max(0, difference - 100), difference + 200),
            viewer: viewerSignature.slice(Math.max(0, difference - 100), difference + 200)
          };
        }
        for (var theme of ['auto', 'light', 'dark']) {
          var viewerPixels = await pixels(forceTheme(viewerText, theme === 'auto' ? null : theme));
          var directPixels = await pixels(direct[theme]);
          var mismatches = 0;
          for (var index = 0; index < viewerPixels.length; index++) {
            if (viewerPixels[index] !== directPixels[index]) mismatches += 1;
          }
          result.pixelMismatches[theme] = mismatches;
        }
        return result;
      })()`,
        awaitPromise: true,
        returnByValue: true,
      }, sessionId);
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      }
      assert.deepEqual(response.result.value, {
        structure: { auto: true },
        pixelMismatches: { auto: 0, light: 0, dark: 0 },
      }, item.id);
    }
  } finally {
    await browser.close();
  }
});

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function packagedSkill() {
  const source = path.join(tmp, 'package-source');
  const installed = path.join(tmp, 'installed-skill');
  fs.mkdirSync(source);
  fs.copyFileSync(path.join(repoRoot, 'THIRD_PARTY_NOTICES.md'), path.join(source, 'THIRD_PARTY_NOTICES.md'));
  fs.cpSync(skillRoot, path.join(source, 'archify'), {
    recursive: true,
    filter: (entry) => !entry.split(path.sep).includes('node_modules'),
  });
  git(source, ['init']);
  git(source, ['add', 'THIRD_PARTY_NOTICES.md', 'archify']);
  stageCleanSkill({ repoRoot: source, destination: installed });
  return installed;
}

test('clean packaged Skill delivers SVG without node_modules and preserves trusted output on an SVG-check failure', { timeout: 30000 }, () => {
  const installed = packagedSkill();
  const installedCli = path.join(installed, 'bin', 'archify.mjs');
  const input = path.join(installed, 'examples', 'web-app.architecture.json');
  const output = path.join(tmp, 'installed.svg');
  assert.equal(fs.existsSync(path.join(installed, 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(installed, 'renderers', 'shared', 'svg-export.mjs')), true);

  let result = spawnSync(process.execPath, [
    installedCli, 'deliver', 'architecture', input, output,
    '--format', 'svg', '--theme', 'light', '--quality', 'showcase', '--json',
  ], { cwd: installed, encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).svgValidation, { checksPassed: 16, checkCount: 16 });

  const checker = path.join(installed, 'scripts', 'check-render-output.mjs');
  fs.writeFileSync(checker, `
import fs from 'node:fs';
const source = fs.readFileSync(process.argv[2], 'utf8');
const svg = source.trimStart().startsWith('<svg');
console.log(JSON.stringify({
  ok: !svg,
  checks: [{ name: svg ? 'forced_svg_failure' : 'html_fixture', ok: !svg, details: [] }],
  composition: { profile: 'showcase', status: 'pass', summary: { errors: 0, warnings: 0 } }
}));
if (svg) process.exitCode = 1;
`);
  fs.writeFileSync(output, 'trusted\n');
  result = spawnSync(process.execPath, [
    installedCli, 'deliver', 'architecture', input, output,
    '--format', 'svg', '--theme', 'light', '--quality', 'showcase', '--json',
  ], { cwd: installed, encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).stage, 'svg-check');
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted\n');
  assert.deepEqual(fs.readdirSync(tmp).filter((name) => name.startsWith('.archify-delivery-')), []);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
