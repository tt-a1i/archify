import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { textUnits } from '../archify/renderers/shared/utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');

function renderOutcome(doc, publicCli = false) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-column-fit-'));
  const input = path.join(tmp, 'input.json');
  const output = path.join(tmp, 'output.html');
  const renderDoc = structuredClone(doc);
  renderDoc.meta = { ...renderDoc.meta, output: 'sequence-column-fit.html' };
  fs.writeFileSync(input, JSON.stringify(renderDoc));
  try {
    execFileSync('node', publicCli
      ? [path.join(skillRoot, 'bin/archify.mjs'), 'render', 'sequence', input, output]
      : [path.join(skillRoot, 'renderers/sequence/render-sequence.mjs'), input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { code: 0, stderr: '', html: fs.readFileSync(output, 'utf8') };
  } catch (err) {
    return { code: err.status ?? 1, stderr: String(err.stderr || ''), html: '' };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function render(doc, publicCli = false) {
  const outcome = renderOutcome(doc, publicCli);
  assert.equal(outcome.code, 0, outcome.stderr);
  return outcome.html;
}

function participantBoxes(html) {
  return [...html.matchAll(/<rect x="([\d.]+)" y="72" width="([\d.]+)" height="60"/g)]
    .map(([, x, width]) => ({ x: Number(x), width: Number(width) }))
    .filter((box, index, all) => all.findIndex((other) => other.x === box.x) === index)
    .sort((left, right) => left.x - right.x);
}

function wideSequence(columnFit) {
  const meta = { title: 'Column fit', viewBox: [1320, 620] };
  if (columnFit) meta.column_fit = columnFit;
  return {
    schema_version: 1,
    diagram_type: 'sequence',
    meta,
    participants: [
      { id: 'browser', type: 'frontend', label: 'Browser' },
      { id: 'gateway', type: 'backend', label: 'Gateway' },
      { id: 'idp', type: 'security', label: 'IdP' },
      { id: 'api', type: 'backend', label: 'API' },
      { id: 'store', type: 'database', label: 'Store' }
    ],
    messages: [
      { from: 'browser', to: 'gateway', y: 200, label: 'request' },
      { from: 'gateway', to: 'idp', y: 260, label: 'authorize' },
      { from: 'idp', to: 'api', y: 320, label: 'token' },
      { from: 'api', to: 'store', y: 380, label: 'read' }
    ]
  };
}

test('fixed column fit keeps the historical 108px gap regardless of viewBox width', () => {
  const boxes = participantBoxes(render(wideSequence('fixed')));
  assert.equal(boxes.length, 5);
  assert.deepEqual(boxes, [19, 127, 235, 343, 451].map(x => ({ x, width: 86 })));
  assert.equal(boxes[1].x - boxes[0].x, 108);
  assert.equal(boxes.at(-1).x + boxes.at(-1).width < 600, true,
    'fixed lanes stay packed on the left, leaving the wide canvas unused');
});

test('spread column fit uses the viewBox width and stays inside it', () => {
  const boxes = participantBoxes(render(wideSequence('spread')));
  assert.equal(boxes.length, 5);
  assert.ok(boxes[0].width > 86, 'participant boxes widen with the available room');
  assert.ok(boxes[1].x - boxes[0].x > 108, 'columns spread past the fixed gap');
  assert.equal(boxes[0].x, 62, 'first lane keeps the side margin');
  assert.ok(boxes.at(-1).x + boxes.at(-1).width <= 1320 - 40,
    'last lane stays inside the viewBox with the reserved margin');
});

test('an authored viewBox with unset column fit renders like explicit spread', () => {
  assert.equal(render(wideSequence()), render(wideSequence('spread')));
});

const wideLabel = 'Payment Gateway Service';

function labelledSequence(columnFit) {
  const doc = wideSequence(columnFit);
  doc.participants[1].label = wideLabel;
  return doc;
}

test('a label the fixed box rejects fits the spread box on the same viewBox', () => {
  const estimatedLabelW = textUnits(wideLabel) * 6.8;
  assert.ok(estimatedLabelW > 86 + 6, 'the fixture label must actually exceed the fixed box');

  const fixed = renderOutcome(labelledSequence('fixed'));
  assert.notEqual(fixed.code, 0, 'the fixed box still rejects a label it cannot hold');
  assert.ok(fixed.stderr.includes(`Label "${wideLabel}"`), `expected the label in stderr:\n${fixed.stderr}`);
  assert.ok(fixed.stderr.includes('component "gateway" (86px)'), `expected the fixed box width in stderr:\n${fixed.stderr}`);

  const spread = renderOutcome(labelledSequence('spread'));
  assert.equal(spread.code, 0, spread.stderr);
  const box = participantBoxes(spread.html)[1];
  assert.ok(estimatedLabelW <= box.width + 6, `label ~${estimatedLabelW}px must fit the ${box.width}px spread box`);
  assert.ok(spread.html.includes(`>${wideLabel}</text>`), 'the label renders unshortened');
});

test('the sublabel diagnostic reports the width in force, not the historical constant', () => {
  const unrescuable = 'Payment authorization gateway detail text that stays far too long to shrink';
  const doc = wideSequence('spread');
  doc.participants[0].sublabel = unrescuable;

  const { code, stderr } = renderOutcome(doc);
  assert.notEqual(code, 0, 'a sublabel past the legible minimum is still rejected');
  assert.match(stderr, /participant boxes are 190px for this viewBox width and 5 participants/);
  assert.doesNotMatch(stderr, /boxes are a fixed/, 'spread must not quote the fixed layout');
});

test('the authoring contract explains automatic spread and explicit geometry compatibility', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(skillRoot, 'schemas/sequence.schema.json'), 'utf8'));
  const description = schema.properties.meta.properties.column_fit.description;
  const skill = fs.readFileSync(path.join(skillRoot, 'references/authoring-defaults.md'), 'utf8');
  const rendererReadme = fs.readFileSync(path.join(skillRoot, 'renderers/sequence/README.md'), 'utf8');

  assert.match(description, /wide viewBox/);
  assert.match(description, /meaningful participant labels/);
  assert.match(description, /Defaults to spread whether or not meta\.viewBox is supplied/);
  assert.match(description, /Explicit fixed preserves the historical 86px boxes and 108px column gap/);
  assert.match(skill, /use `spread` when a wide viewBox leaves unused horizontal space or meaningful labels need width/);
  assert.match(rendererReadme, /Use `"spread"` when a wide/);
  assert.match(rendererReadme, /default to `meta\.column_fit: "spread"`, whether or not\s+`meta\.viewBox` is supplied/);
  assert.match(rendererReadme, /try `meta\.column_fit: "spread"` before shortening/);
});

test('message names use readable primary type with a plate wide enough for the same text', () => {
  const doc = wideSequence('spread');
  doc.meta.quality_profile = 'showcase';
  const html = render(doc);
  const match = html.match(/<rect x="[^"]+" y="[^"]+" width="([^"]+)" height="[^"]+" rx="3" class="c-mask"\/>\s*<text[^>]*font-size="([^"]+)"[^>]*>authorize<\/text>/);
  assert.ok(match, 'message and its plate are present');
  assert.ok(Number(match[2]) >= 11, 'primary message text should be at least 11 source px');
  assert.ok(Number(match[1]) >= 9 * 6.4 + 12, 'plate must fit the larger monospace text');
});


test('standard retains acceptance for parallel schema-v1 labels with legacy spacing', () => {
  const doc = {
    schema_version: 1, diagram_type: 'sequence', meta: { title: 'Parallel requests' },
    participants: ['a', 'b', 'c', 'd'].map(id => ({ id, type: 'backend', label: id })),
    messages: [
      { from: 'a', to: 'b', y: 200, label: '123456789012345678901234567890123' },
      { from: 'c', to: 'd', y: 200, label: '123456789012345678901234567890123' },
    ],
  };
  const result = renderOutcome(doc);
  assert.equal(result.code, 0);
  const plate = result.html.match(/<rect x="[^"]+" y="[^"]+" width="([^"]+)" height="([^"]+)" rx="3" class="c-mask"\/>\s*<text[^>]*font-size="([^"]+)"[^>]*>123456789012345678901234567890123<\/text>/);
  assert.ok(plate, 'legacy parallel message label is present');
  assert.equal(Number(plate[1]), textUnits(doc.messages[0].label) * 5.2 + 12);
  assert.equal(Number(plate[2]), 16);
  assert.equal(Number(plate[3]), 9);
});


test('seven participants fit an authored 820px frame with real card gutters', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/async-job-roundtrip.sequence.json'), 'utf8'));
  assert.equal(doc.meta.column_fit, undefined);
  const original = structuredClone(doc);
  const html = render(doc);
  const boxes = participantBoxes(html);
  assert.equal(boxes.length, 7);
  assert.equal(boxes[0].x, 62);
  assert.equal(boxes.at(-1).x + boxes.at(-1).width, 780);
  for (let i = 1; i < boxes.length; i++) {
    const gap = boxes[i].x - boxes[i - 1].x;
    assert.ok(gap < 108 && gap >= boxes[i - 1].width + 16);
  }
  assert.match(html, /viewBox="0 0 820 920"/);
  assert.deepEqual(doc, original, 'rendering never rewrites the authored input');
  assert.equal(html, render({ ...doc, meta: { ...doc.meta, column_fit: 'spread' } }));
  const nodes = [...html.matchAll(/<g id="node-([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(nodes, doc.participants.map(participant => participant.id));
  const paths = [...html.matchAll(/data-composition-edge-from="([^"]+)" data-composition-edge-to="([^"]+)"[^>]* d="M ([\d.]+) ([\d.]+) L ([\d.]+) ([\d.]+)"/g)];
  assert.deepEqual(paths.map(match => [match[1], match[2], Number(match[4]), Number(match[6])]),
    doc.messages.map(message => [message.from, message.to, message.y, message.y]));
  for (const match of paths) assert.ok(Math.abs(Number(match[5]) - Number(match[3])) >= 60);
  for (const message of doc.messages) assert.ok(html.includes(`>${message.label}</text>`));
});

test('spread capacity still rejects an infeasible frame and unrescuable participant label', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/async-job-roundtrip.sequence.json'), 'utf8'));
  doc.meta.viewBox[0] = 740;
  const narrow = renderOutcome(doc);
  assert.notEqual(narrow.code, 0);
  assert.match(narrow.stderr, /Participants exceed viewBox width/);
  doc.meta.viewBox[0] = 820;
  doc.participants[0].label = 'A participant label far beyond the available frame capacity';
  const long = renderOutcome(doc);
  assert.notEqual(long.code, 0);
  assert.ok(long.stderr.includes(`wider than component "${doc.participants[0].id}" (86px)`), long.stderr);
});


test('narrow authored canvases reduce only the spread left margin to retain feasible capacity', () => {
  for (const [width, height, count, expectedLeft] of [[480, 620, 4, 48], [794, 920, 7, 56]]) {
    const doc = wideSequence();
    doc.meta.viewBox = [width, height];
    doc.participants = Array.from({ length: count }, (_, index) => ({ id: `p${index}`, type: 'backend', label: `P${index}` }));
    doc.messages = [{ from: 'p0', to: `p${count - 1}`, y: 200, label: 'request' }];
    const html = render(doc, true);
    const boxes = participantBoxes(html);
    assert.equal(boxes.length, count);
    assert.equal(boxes[0].x, expectedLeft);
    assert.equal(boxes[0].width, 86);
    assert.equal(boxes.at(-1).x + boxes.at(-1).width, width - 40);
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].x - boxes[i - 1].x - boxes[i - 1].width >= 16);
    assert.match(html, new RegExp(`viewBox="0 0 ${width} ${height}"`));
    assert.equal(html, render({ ...doc, meta: { ...doc.meta, column_fit: 'spread' } }, true));
    const fixedBoxes = participantBoxes(render({ ...doc, meta: { ...doc.meta, column_fit: 'fixed' } }, true));
    assert.deepEqual(fixedBoxes, Array.from({ length: count }, (_, index) => ({ x: 19 + index * 108, width: 86 })));
  }
});


test('few-participant automatic spread packs below 920px when labels fit', () => {
  for (const count of [2, 3]) {
    const doc = {
      schema_version: 1, diagram_type: 'sequence',
      meta: { title: `${count} participants`, quality_profile: 'showcase' },
      participants: Array.from({ length: count }, (_, index) => ({
        id: `p${index}`, type: 'backend', label: `P${index}`,
      })),
      messages: [{ id: 'm0', from: 'p0', to: `p${count - 1}`, y: 200, label: 'ping' }],
    };
    const html = render(doc, true);
    const width = Number(html.match(/<svg viewBox="0 0 (\d+) /)[1]);
    assert.equal(width, 560, `${count}p should pack to 560, got ${width}`);
    assert.match(html, /data-sequence-column-fit="spread"/);
  }
  // Four participants retain the established 920px spread contract.
  const four = {
    schema_version: 1, diagram_type: 'sequence',
    meta: { title: 'Four participants', quality_profile: 'showcase' },
    participants: Array.from({ length: 4 }, (_, index) => ({
      id: `p${index}`, type: 'backend', label: `P${index}`,
    })),
    messages: [{ id: 'm0', from: 'p0', to: 'p3', y: 200, label: 'ping' }],
  };
  const fourHtml = render(four, true);
  assert.match(fourHtml, /viewBox="0 0 920 /);
});

function compactSequence() {
  return {
    schema_version: 1, diagram_type: 'sequence',
    meta: { title: 'Complete timeline', quality_profile: 'showcase' },
    participants: [{ id: 'client', type: 'external', label: 'Client' }, { id: 'api', type: 'backend', label: 'API' }],
    messages: [{ id: 'request', from: 'client', to: 'api', y: 200, label: 'ping' }],
  };
}

test('compact automatic sequence includes full message and segment label footprints', () => {
  for (const content of ['message', 'segment']) {
    const doc = compactSequence();
    const label = 'POST /api/v1/accounts/{accountId}/transactions/{transactionId}/settlement?include=balance,ledger';
    if (content === 'message') doc.messages[0].label = label;
    else doc.segments = [{ from: 160, to: 250, label }];
    const html = render(doc, true);
    const width = Number(html.match(/<svg viewBox="0 0 (\d+) /)[1]);
    assert.ok(width > 560 && width < 920, `${content} should widen only enough to fit, got ${width}`);
    assert.ok(html.includes(label), 'full authored label remains in the SVG');
    if (content === 'message') {
      const boxes = participantBoxes(html);
      const center = (boxes[0].x + boxes[0].width / 2 + boxes[1].x + boxes[1].width / 2) / 2;
      const labelWidth = textUnits(label) * 6.6 + 12;
      assert.ok(center - labelWidth / 2 >= 0 && center + labelWidth / 2 <= width);
    } else assert.ok(56 + textUnits(label) * 5.2 + 14 <= width - 48);
  }
});

test('automatic timeline height includes late content when its legend is empty', () => {
  for (const legend of [{ mode: 'hidden' }, { entries: { default: { visible: false } } }]) {
    const doc = compactSequence();
    doc.meta.legend = legend;
    doc.messages[0].y = 500;
    doc.messages[0].note = 'Complete note';
    doc.activations = [{ participant: 'api', from: 480, to: 530 }];
    doc.segments = [{ from: 160, to: 540, label: 'Phase' }];
    const html = render(doc, true);
    const height = Number(html.match(/<svg viewBox="0 0 \d+ (\d+)"/)[1]);
    assert.ok(height >= 583 && height < 760, `late content should fit in a compact timeline, got ${height}`);
    assert.match(html, /Complete note/);
    assert.match(html, /data-composition-points="[^\"]*,500;/);
  }
});

test('eight participants fit the automatic 920px canvas with default and explicit spread', () => {
  const doc = {
    schema_version: 1, diagram_type: 'sequence', meta: { title: 'Eight participants' },
    participants: Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`, type: 'backend', label: `P${index}` })),
    messages: [{ from: 'p0', to: 'p7', y: 200, label: 'request' }],
  };
  const original = structuredClone(doc);
  const html = render(doc, true);
  const boxes = participantBoxes(html);
  assert.equal(boxes.length, 8);
  assert.equal(boxes[0].x, 62);
  assert.equal(boxes.at(-1).x + boxes.at(-1).width, 880);
  for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].x - boxes[i - 1].x - boxes[i - 1].width >= 16);
  assert.match(html, /viewBox="0 0 920 327"/);
  assert.deepEqual(doc, original);
  assert.equal(html, render({ ...doc, meta: { ...doc.meta, column_fit: 'spread' } }, true));
  const fixedBoxes = participantBoxes(render({ ...doc, meta: { ...doc.meta, column_fit: 'fixed' } }, true));
  assert.deepEqual(fixedBoxes, Array.from({ length: 8 }, (_, index) => ({ x: 19 + index * 108, width: 86 })));
});
// The Viewer fit declaration is independent of fixed/spread column geometry.
test('automatic sequence declares width-first fit; authored viewBox does not', () => {
  for (const columnFit of [undefined, 'fixed', 'spread']) {
    const doc = wideSequence(columnFit);
    delete doc.meta.viewBox;
    const root = render(doc).match(/<svg\b[^>]*>/)?.[0];
    assert.match(root, /data-reader-fit="width-first"/);
    assert.match(root, new RegExp(`data-sequence-column-fit="${columnFit || 'spread'}"`));
    const authoredRoot = render(wideSequence(columnFit)).match(/<svg\b[^>]*>/)?.[0];
    assert.doesNotMatch(authoredRoot, /data-reader-fit=/);
  }
});

test('automatic spread canvas widens for participant labels up to the readable width', () => {
  const participant = (id, label) => ({ id, type: 'backend', label });
  const doc = {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Automatic width', quality_profile: 'showcase' },
    participants: [
      participant('a', 'Web UI'), participant('b', 'Orchestrator'), participant('c', 'team CLI'), participant('d', 'Runtime'),
      participant('e', 'Team operations'), participant('f', 'SQLite'), participant('g', 'Stdin queue'), participant('h', 'Worker'),
    ],
    messages: [{ from: 'a', to: 'h', label: 'send', y: 180 }],
  };
  const html = render(doc);
  const width = Number(html.match(/<svg viewBox="0 0 (\d+) /)[1]);
  assert.ok(width > 920 && width <= 1085, String(width));
  for (const box of participantBoxes(html)) assert.ok(box.width + 6 >= textUnits('Team operations') * 6.8, JSON.stringify(box));

  doc.participants[6].label = 'Stdin dispatcher queue';
  const crowded = renderOutcome(doc);
  assert.notEqual(crowded.code, 0);
  assert.match(crowded.stderr, /shorten it to at most \d+ text units[^]*keep meta\.viewBox omitted/);
});

test('a widened automatic canvas reports sublabels at the size that stays readable there', () => {
  const participant = (id, label, sublabel) => ({ id, type: 'backend', label, ...(sublabel ? { sublabel } : {}) });
  const doc = {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Readable sublabel', quality_profile: 'showcase' },
    participants: [
      participant('a', 'Web UI'), participant('b', 'Orchestrator'), participant('c', 'team CLI'), participant('d', 'Runtime'),
      participant('e', 'Team operations'), participant('f', 'SQLite'), participant('g', 'Stdin queue', 'tmp 或 reports/review'), participant('h', 'Worker'),
    ],
    messages: [{ from: 'a', to: 'h', label: 'send', y: 180 }],
  };
  const outcome = renderOutcome(doc);
  assert.notEqual(outcome.code, 0);
  assert.match(outcome.stderr, /Sublabel "tmp 或 reports\/review" needs ~\d+px at the [\d.]+px minimum that stays readable on this \d+px canvas/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-diagnostic-'));
  try {
    const input = path.join(tmp, 'input.json');
    fs.writeFileSync(input, JSON.stringify({ ...doc, meta: { ...doc.meta, output: 'sequence.html' } }));
    const result = spawnSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'validate', 'sequence', input, '--json'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    const diagnostic = JSON.parse(result.stdout).diagnostics.find(entry => entry.code === 'sequence/participant-sublabel-overflow');
    assert.equal(diagnostic.subject.nodeId, 'g');
    assert.equal(diagnostic.subject.path, '/participants/6/sublabel');
    assert.ok(diagnostic.evidence.requiredWidth > diagnostic.evidence.availableWidth);
    assert.ok(diagnostic.evidence.minimumFontPx > 6);
    assert.match(diagnostic.supportedFixes[0], /preserving its role or protocol/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('standard fixed authored canvases retain accepted sublabel fitting', () => {
  const doc = wideSequence('fixed');
  doc.meta.quality_profile = 'standard';
  doc.participants[0].sublabel = 'ABCDEFGHIJKLMNOPQRST';
  const html = render(doc, true);
  assert.match(html, /font-size="6\.5"[^>]*>ABCDEFGHIJKLMNOPQRST<\/text>/);
  assert.deepEqual(participantBoxes(html), [19, 127, 235, 343, 451].map(x => ({ x, width: 86 })));
});

test('wide authored canvases never enlarge sublabels beyond the historical card rows', () => {
  for (const columnFit of ['fixed', 'spread']) {
    const doc = wideSequence(columnFit);
    doc.meta.quality_profile = 'standard';
    doc.meta.viewBox = [3000, 760];
    doc.participants[0].sublabel = 'DB';
    assert.match(render(doc, true), /y="122" class="t-muted" font-size="7"[^>]*>DB<\/text>/);
  }
});

test('automatic showcase spread retains a readable sublabel font after widening', () => {
  const doc = {
    schema_version: 1, diagram_type: 'sequence', meta: { title: 'Readable automatic width', quality_profile: 'showcase' },
    participants: Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`, type: 'backend', label: 'Team operations', sublabel: 'context' })),
    messages: [{ from: 'p0', to: 'p7', label: 'send', y: 180 }],
  };
  const html = render(doc, true);
  const width = Number(html.match(/<svg viewBox="0 0 (\d+) /)[1]);
  assert.ok(width > 920 && width <= 1085, String(width));
  const fonts = [...html.matchAll(/font-size="([\d.]+)"[^>]*>context<\/text>/g)].map(match => Number(match[1]));
  assert.ok(fonts.length >= 8);
  for (const font of fonts) assert.ok(font * Math.min(1, 930 / width) >= 6, `${font}px on ${width}px canvas`);
});
