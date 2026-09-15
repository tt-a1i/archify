import { test } from "node:test";
import assert from "node:assert/strict";
import { LABELS, renderCommand } from "./ensure-labels.mjs";

test("label names are unique and cover the governance set", () => {
  const names = LABELS.map((label) => label.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.slice().sort(), [
    "accepted",
    "awaiting-author",
    "generated-artifacts",
    "needs-repro",
    "not-now",
    "primary-implementation",
    "stale",
  ]);
});

test("colors are 6-digit hex without a leading hash", () => {
  for (const label of LABELS) {
    assert.match(label.color, /^[0-9A-Fa-f]{6}$/, label.name);
  }
});

test("descriptions are non-empty single sentences", () => {
  for (const label of LABELS) {
    assert.ok(label.description.trim().length > 0, label.name);
    assert.ok(label.description.length <= 100, `${label.name}: GitHub caps descriptions at 100 chars`);
  }
});

test("renderCommand produces the gh label create argv", () => {
  const label = LABELS.find((entry) => entry.name === "awaiting-author");
  assert.deepEqual(renderCommand(label), [
    "gh",
    "label",
    "create",
    "awaiting-author",
    "--color",
    label.color,
    "--description",
    label.description,
    "--force",
  ]);
});
