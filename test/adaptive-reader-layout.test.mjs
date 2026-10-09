import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DESKTOP_READABILITY_VIEWPORT,
  DESKTOP_READER_DIAGRAM_WIDTH,
  DESKTOP_READER_HORIZONTAL_CHROME,
  DESKTOP_READER_MIN_WIDTH,
  DECLARED_WIDE_READER_CONTRACT,
  DECLARED_WIDE_READER_RATIO,
  declaredWideReadabilityBudget,
  MIN_PROJECTED_NODE_TEXT_PX,
  minimumReadableSourceTextPx,
  projectedNodeTextPx,
} from '../archify/renderers/shared/desktop-readability.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const template = fs.readFileSync(path.join(skillRoot, 'assets', 'template.html'), 'utf8');
const skill = fs.readFileSync(path.join(skillRoot, 'references/authoring-defaults.md'), 'utf8');
test('desktop readability budget matches the minimum adaptive reader at 1440 by 900', () => {
  assert.deepEqual(DESKTOP_READABILITY_VIEWPORT, { width: 1440, height: 900 });
  assert.equal(DESKTOP_READER_MIN_WIDTH, 960);
  assert.equal(DESKTOP_READER_HORIZONTAL_CHROME, 30);
  assert.equal(DESKTOP_READER_DIAGRAM_WIDTH, 930);
});

test('desktop readability source floor is the inverse of the projected-size gate', () => {
  const sourceFloor = minimumReadableSourceTextPx(1376);
  assert.ok(Math.abs(sourceFloor - 8.87741935483871) < 1e-12);
  assert.ok(Math.abs(projectedNodeTextPx(sourceFloor, 1376) - MIN_PROJECTED_NODE_TEXT_PX) < 1e-12);
  assert.equal(minimumReadableSourceTextPx(DESKTOP_READER_DIAGRAM_WIDTH), MIN_PROJECTED_NODE_TEXT_PX);
  assert.equal(minimumReadableSourceTextPx(700), MIN_PROJECTED_NODE_TEXT_PX);
  assert.ok(Number.isNaN(minimumReadableSourceTextPx(0)));
});

test('declared-wide budget is additive and reports a cap without changing the legacy 930px floor', () => {
  assert.equal(DECLARED_WIDE_READER_CONTRACT, 'declared-wide-v1');
  assert.equal(DECLARED_WIDE_READER_RATIO, 1.55);
  const first = declaredWideReadabilityBudget({
    viewBoxWidth: 1438,
    viewBoxHeight: 800,
    minimumSourceTextPx: 8,
    requestedMinimumTextPx: 7.5,
  });
  assert.ok(first);
  assert.equal(first.actualReaderWidth, 1376);
  assert.equal(first.guaranteedSvgWidth, 1346);
  assert.equal(first.limit, 'viewport-cap');
  assert.ok(first.projectedMinimumTextPx >= MIN_PROJECTED_NODE_TEXT_PX);
  assert.ok(first.projectedMinimumTextPx < 7.5, 'do not round 7.488px into a met 7.5px target');
  assert.equal(first.requestedTargetMet, false);
  assert.equal(DESKTOP_READER_DIAGRAM_WIDTH, 930);
  assert.equal(declaredWideReadabilityBudget({
    viewBoxWidth: 1000,
    viewBoxHeight: 800,
    minimumSourceTextPx: 8,
    requestedMinimumTextPx: 7.5,
  }), null, 'narrow diagrams remain on the legacy checker path');
});

// Browser ownership, geometry and settling live in reader-layout-browser and
// reader-readability-maintained-browser; these checks keep the public declaration
// and authoring documentation aligned without prescribing the scheduler's code.
test('reader declaration and authoring guidance preserve the public readability contract', () => {
  assert.equal((template.match(/<meta name="archify-reader-contract" content="declared-wide-v1">/g) || []).length, 1);
  assert.match(skill, /Automated browser evidence\]\(delivery-contract\.md#automated-browser-evidence\)/);
  assert.match(skill, /intrinsic-height page scroll/);
  const delivery = fs.readFileSync(path.join(skillRoot, 'references/delivery-contract.md'), 'utf8');
  const authoring = fs.readFileSync(path.join(skillRoot, 'references/authoring-contract.md'), 'utf8');
  assert.match(delivery, /1440×900, 1600×1000, 1920×1080, and\s+2048×1320/);
  assert.match(delivery, /Reader-declared readable exception/);
  assert.match(authoring, /Generate one responsive artifact for laptops and external displays/);
  assert.match(authoring, /preserv(?:e|ing) the authored SVG\/viewBox, proportions, semantic geometry/);
});
