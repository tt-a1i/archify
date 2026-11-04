import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { extractSvgs, parseXml } from './helpers/xml.mjs';
import { compareArchitecture } from '../archify/delta/architecture-delta.mjs';
import { collectArrowheadCollisions } from '../archify/renderers/shared/geometry.mjs';
import { scanStory, buildStory } from '../archify/story/tool.mjs';
import { compileBrief } from '../archify/story/story-plan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/architecture-directions.json', import.meta.url)));
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-directions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function run(dir, spec, command = 'render') {
  const input = path.join(dir, 'input.json'), output = path.join(dir, 'output.html');
  fs.writeFileSync(input, JSON.stringify(spec));
  const result = spawnSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), command, spec.diagram_type, input,
    ...(command === 'validate' ? [] : [output]), ...(command === 'render' ? [] : ['--json'])], { encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } });
  return { ...result, output, html: result.status === 0 && command !== 'validate' ? fs.readFileSync(output, 'utf8') : '' };
}
function svgOf(html) { return extractSvgs(html).direct.find(svg => svg.includes('data-edge-id="shared-id"')); }

const labelArrows = JSON.parse(fs.readFileSync(new URL('./fixtures/architecture-label-arrows.json', import.meta.url)));
function labelSvg(html) { return extractSvgs(html).direct.find(svg => svg.includes('data-edge-id="request"')); }

test('label arrows deliver shared paths with two directed identities and attributable labels', t => {
  const result = run(workspace(t), labelArrows, 'deliver');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const svg = labelSvg(result.html); parseXml(svg);
  const paths = [...svg.matchAll(/<path\b[^>]*data-edge-id="([^"]+)"[^>]*>/g)];
  assert.equal(paths.length, 2);
  for (const [markup] of paths) assert.doesNotMatch(markup, /marker-(?:start|end)|data-edge-direction="(?:both|none)"/);
  const groups = [...svg.matchAll(/<g\b[^>]*data-edge-id="([^"]+)"[^>]*>[\s\S]*?<\/g>/g)];
  assert.equal(groups.length, 2);
  for (const [markup] of groups) {
    assert.match(markup, /data-label-arrow/);
    assert.match(markup, /data-label-direction=/, 'direction-bearing labels must survive reduced detail');
  }
  assert.match(groups.find(([, id]) => id === 'request')[0], /rotate\(0\)/);
  assert.match(groups.find(([, id]) => id === 'response')[0], /rotate\(180\)/);
  assert.match(svg, /Label marker shows direction/);
});

test('label arrows follow vertical paths and preserve pinned label coordinates', t => {
  const dir = workspace(t), spec = structuredClone(labelArrows);
  spec.components[1].pos = [40, 330];
  spec.connections[0].labelAt = [250, 230];
  spec.connections[1].labelAt = [250, 260];
  const result = run(dir, spec, 'deliver');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const svg = labelSvg(result.html);
  assert.match(svg, /rotate\(90\)/); assert.match(svg, /rotate\(-90\)/);
  assert.match(svg, /<text x="250" y="230"[^>]*>Create task<\/text>/);
  assert.match(svg, /<text x="250" y="260"[^>]*>Execution result<\/text>/);
});

test('label arrow opt-in rejects lost or contradictory direction information', t => {
  const dir = workspace(t);
  for (const change of [{ label: '' }, { label: '   ' }, { label: undefined }, { direction: 'both' }, { direction: 'none' }, { arrowPosition: 'middle' }]) {
    const spec = structuredClone(labelArrows); Object.assign(spec.connections[0], change);
    assert.notEqual(run(dir, spec, 'validate').status, 0, JSON.stringify(change));
  }
  const spec = structuredClone(fixture), before = run(dir, spec);
  assert.equal(before.status, 0, before.stderr);
  spec.connections.forEach(conn => { conn.arrowPosition = 'endpoints'; });
  const after = run(dir, spec);
  assert.equal(after.status, 0, after.stderr);
  assert.equal(svgOf(after.html), svgOf(before.html), 'explicit default must preserve existing output');
  assert.equal(compareArchitecture(fixture, spec).summary.connections.changed, 0);
  const head = structuredClone(labelArrows), base = structuredClone(labelArrows);
  base.connections.forEach(conn => { delete conn.arrowPosition; });
  const changed = compareArchitecture(base, head).changes.connections.find(conn => conn.id === 'request');
  assert.deepEqual(changed.changedFields, ['/arrowPosition']);
  assert.deepEqual(changed.classifications, ['geometry']);
});

test('reversed bent paths keep their labels centered on the same segment', t => {
  const spec = structuredClone(labelArrows);
  spec.components[1].pos = [420, 250];
  spec.connections[0].fromSide = 'right'; spec.connections[0].toSide = 'left';
  spec.connections[1].fromSide = 'left'; spec.connections[1].toSide = 'right';
  const via = [[210,110],[210,200],[330,200],[330,280]];
  spec.connections[0].via = via;
  spec.connections[1].via = [...via].reverse();
  spec.connections.forEach(conn => { delete conn.route; });
  const result = run(workspace(t), spec, 'deliver');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const svg = labelSvg(result.html);
  const request = svg.match(/<text x="([^"]+)" y="([^"]+)"[^>]*>Create task<\/text>/);
  const response = svg.match(/<text x="([^"]+)" y="([^"]+)"[^>]*>Execution result<\/text>/);
  assert.equal(request[1], response[1], 'both labels stay centered on the same authored corridor');
  assert.ok(Number(request[2]) < 200 && Number(response[2]) > 200);
  assert.match(svg, /rotate\(0\)/); assert.match(svg, /rotate\(180\)/);
});

test('Architecture delivers one identity per relation, accurate arrowheads and actual-style legends', t => {
  const dir = workspace(t), result = run(dir, fixture, 'deliver');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const svg = svgOf(result.html); parseXml(svg);
  const paths = [...svg.matchAll(/<path\b[^>]*data-edge-id="([^"]+)"[^>]*>/g)];
  assert.equal(paths.length, 3);
  const byId = Object.fromEntries(paths.map(([markup, id]) => [id, markup]));
  assert.doesNotMatch(byId['shared-id'], /marker-(?:start|end)|data-animate/);
  assert.match(byId['status-sync'], /marker-start="url\(#[^)]+-start\)"/);
  assert.match(byId['status-sync'], /marker-end="url\(#[^)]+\)"/);
  assert.doesNotMatch(byId['status-sync'], /data-animate/);
  assert.match(byId.publish, /marker-end=/);
  assert.match(byId.publish, /data-animate="edge"/);
  const legend = svg.slice(svg.indexOf('<!-- Legend -->'));
  assert.match(legend, /Directed relationship/); assert.match(legend, /Bidirectional relationship/);
  assert.match(legend, /Undirected association/); assert.match(legend, /a-dashed/);
  assert.equal((legend.match(/data-legend-semantic-kind="relation-/g) || []).length, 3);
});

test('explicit forward preserves legacy SVG and direction validation is Architecture-only', t => {
  const dir = workspace(t), legacy = structuredClone(fixture);
  legacy.connections.forEach(edge => delete edge.direction);
  const rendered = run(dir, legacy); assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  const before = svgOf(rendered.html);
  legacy.connections.forEach(edge => { edge.direction = 'forward'; });
  assert.equal(svgOf(run(dir, legacy).html), before);
  assert.doesNotMatch(before.slice(before.indexOf('<!-- Legend -->')), /relation-(?:forward|both|none)/);
  for (const direction of ['', null, 'reverse', 'undirected']) {
    const invalid = structuredClone(fixture); invalid.connections[0].direction = direction;
    assert.notEqual(run(dir, invalid, 'validate').status, 0, String(direction));
  }
  const workflow = JSON.parse(fs.readFileSync(path.join(root, 'archify/examples/agent-tool-call.workflow.json')));
  workflow.edges[0].direction = 'both';
  assert.notEqual(run(dir, workflow, 'validate').status, 0);
});

test('relationship legends honor hidden and custom labels without changing authored arrows', t => {
  const dir = workspace(t), spec = structuredClone(fixture);
  spec.meta.legend = { entries: { 'relation-none': { label: 'Shared identifiers' } } };
  let result = run(dir, spec); assert.equal(result.status, 0, result.stdout);
  assert.match(svgOf(result.html), /Shared identifiers/);
  spec.meta.legend.mode = 'hidden'; result = run(dir, spec);
  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(svgOf(result.html), /data-legend-semantic-kind=/);
  assert.match(svgOf(result.html), /marker-start="url\(#[^)]+-start\)"/);
});

test('Delta normalizes default forward and identifies direction changes without duplicating relationships', () => {
  const base = structuredClone(fixture), head = structuredClone(fixture);
  head.connections[2].direction = 'forward';
  assert.equal(compareArchitecture(base, head).summary.connections.changed, 0);
  head.connections[0].direction = 'both';
  let changed = compareArchitecture(base, head).changes.connections.find(edge => edge.id === 'shared-id');
  assert.deepEqual(changed.changedFields, ['/direction']);
  assert.deepEqual(changed.classifications, ['semantic']);
  head.connections[0].direction = 'forward';
  changed = compareArchitecture(base, head).changes.connections.find(edge => edge.id === 'shared-id');
  assert.deepEqual(changed.classifications, ['semantic', 'topology']);
});

test('arrow clearance checks source arrowheads for both and excludes unmarked associations', () => {
  const first = { relation: { from: 'a', to: 'b', direction: 'both' }, points: [[0, 0], [100, 0]] };
  const second = { relation: { from: 'c', to: 'a' }, points: [[100, 4], [0, 4]] };
  const collisions = () => collectArrowheadCollisions({ routedRelations: [first, second] });
  assert.equal(collisions().length, 1);
  assert.equal(collisions()[0].left.markerEndpoint, 'from');
  first.relation.direction = 'none'; assert.deepEqual(collisions(), []);
  first.relation.direction = 'forward'; assert.deepEqual(collisions(), []);
});

test('Story preserves structural identities, defaults to static actions and rejects directional transfer', t => {
  const dir = workspace(t), result = run(dir, fixture);
  assert.equal(result.status, 0, result.stdout);
  const facts = scanStory(result.output);
  assert.equal(facts.edges.find(edge => edge.id === 'shared-id').direction, 'none');
  assert.deepEqual(facts.nodes.find(node => node.id === 'crm').associations, ['shared-id']);
  assert.deepEqual(facts.nodes.find(node => node.id === 'crm').outgoing, []);
  const brief = { version: 2, title: 'Shared context', intro: 'Read the systems.', outro: 'Return to context.',
    scenes: [{ title: 'Shared identifiers', points: [{ anchor: 'ppm', via: ['shared-id', 'status-sync'], title: 'Relationships', text: 'Shared identifiers and synchronized status.' }] }] };
  const plan = compileBrief(brief, facts);
  assert.deepEqual(plan.shots[1].edgeModes, { 'shared-id': 'relation', 'status-sync': 'relation' });
  const input = path.join(dir, 'brief.json'); fs.writeFileSync(input, JSON.stringify(brief));
  buildStory(result.output, input, path.join(dir, 'story.html'), { standalone: true });
  brief.scenes[0].points[0].action = 'trace';
  assert.throws(() => compileBrief(brief, facts), /requires the static relation action/);
  fs.writeFileSync(result.output, result.html.replace('data-edge-direction="none"', 'data-edge-direction="both"'));
  assert.throws(() => scanStory(result.output), /Conflicting source connection shared-id \(direction\)/);
});
