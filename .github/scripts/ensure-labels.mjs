#!/usr/bin/env node
// Create or update the governance label set with `gh label create --force`.
// Usage: node .github/scripts/ensure-labels.mjs [--dry-run]
// Label names are fixed by CONTRIBUTING.md and .github/CURRENT_FOCUS.md.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const LABELS = [
  {
    name: "accepted",
    color: "2EA043",
    description: "Maintainer agreed scope; feature or contract PRs may proceed. Maintainer-only.",
  },
  {
    name: "primary-implementation",
    color: "1D76DB",
    description: "Maintainer-designated main implementation PR for its linked issue. Maintainer-only.",
  },
  {
    name: "awaiting-author",
    color: "FBCA04",
    description: "A maintainer requested changes on the current head; the stale clock runs only on this label.",
  },
  {
    name: "needs-repro",
    color: "E99695",
    description: "Bug report lacks the minimal typed JSON reproduction or validation receipt.",
  },
  {
    name: "not-now",
    color: "BFD4F2",
    description: "Deferred per .github/CURRENT_FOCUS.md; reconsideration conditions apply.",
  },
  {
    name: "generated-artifacts",
    color: "C5DEF5",
    description: "PR touches generated-site, package, or golden-example paths; set and removed by the triage card.",
  },
  {
    name: "stale",
    color: "EDEDED",
    description: "No author response on an awaiting-author PR for 14 days; closes after 7 more.",
  },
];

export function renderCommand(label) {
  return [
    "gh",
    "label",
    "create",
    label.name,
    "--color",
    label.color,
    "--description",
    label.description,
    "--force",
  ];
}

function quote(arg) {
  return /^[\w./=-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

export function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes("--dry-run");
  for (const label of LABELS) {
    const [bin, ...args] = renderCommand(label);
    if (dryRun) {
      console.log([bin, ...args].map(quote).join(" "));
      continue;
    }
    execFileSync(bin, args, { stdio: "inherit" });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
