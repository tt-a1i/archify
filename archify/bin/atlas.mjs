import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fingerprint = (bytes) => ({
  sha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
});
const identifier = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
function reject(message, subject = {}) {
  const error = new Error(message);
  error.diagnostic = {
    code: "atlas/invalid-input",
    severity: "error",
    message,
    subject,
    evidence: {},
    supportedFixes: ["correct the named manifest entry and rerun atlas"],
  };
  throw error;
}
function fields(value, names, subject) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    reject("Expected an object.", subject);
  for (const key of Object.keys(value))
    if (!names.includes(key)) reject(`Unknown field "${key}".`, subject);
}
function canonical(file) {
  return fs.existsSync(file)
    ? fs.realpathSync(file)
    : path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
}

export function buildAtlas(input, output) {
  const inputPath = fs.realpathSync(input),
    outputPath = path.resolve(output);
  const manifestBytes = fs.readFileSync(inputPath);
  const manifest = JSON.parse(manifestBytes);
  fields(
    manifest,
    ["schema_version", "title", "locale", "overview", "diagrams", "links"],
    { input },
  );
  if (manifest.schema_version !== 1) reject("schema_version must be 1.");
  if (typeof manifest.title !== "string" || !manifest.title.trim())
    reject("title must be nonempty.");
  if (
    manifest.locale !== undefined &&
    !["en", "zh-CN"].includes(manifest.locale)
  )
    reject("locale must be en or zh-CN.");
  if (
    !Array.isArray(manifest.diagrams) ||
    manifest.diagrams.length < 2 ||
    manifest.diagrams.length > 20
  )
    reject("Provide 2 to 20 diagrams.");
  if (!Array.isArray(manifest.links) || !manifest.links.length)
    reject("Provide explicit overview links.");
  const ids = new Set(),
    inputs = [inputPath];
  const diagrams = manifest.diagrams.map((entry, index) => {
    const subject = { diagram: index };
    fields(entry, ["id", "title", "file"], subject);
    if (!identifier.test(entry.id || "") || ids.has(entry.id))
      reject("Diagram IDs must be unique identifiers.", subject);
    ids.add(entry.id);
    if (
      typeof entry.title !== "string" ||
      !entry.title.trim() ||
      typeof entry.file !== "string"
    )
      reject("Each diagram needs a title and local HTML file.", subject);
    const file = fs.realpathSync(
      path.resolve(path.dirname(inputPath), entry.file),
    );
    inputs.push(file);
    const bytes = fs.readFileSync(file),
      html = bytes.toString("utf8");
    if (!html.includes("data-node-id=") || !html.includes("Archify.theme"))
      reject("Expected a renderer-backed Archify HTML artifact.", subject);
    // Check a private snapshot: the bytes checked must be exactly the bytes embedded.
    const snapshot = fs.mkdtempSync(
      path.join(path.dirname(outputPath), ".archify-atlas-check-"),
    );
    try {
      const candidate = path.join(snapshot, "diagram.html");
      fs.writeFileSync(candidate, bytes);
      const check = spawnSync(
        process.execPath,
        [path.join(root, "bin/archify.mjs"), "check", candidate],
        { encoding: "utf8" },
      );
      if (check.status !== 0)
        reject("Child artifact checks failed.", {
          ...subject,
          reason: check.stderr || check.stdout,
        });
    } finally {
      fs.rmSync(snapshot, { recursive: true, force: true });
    }
    return { id: entry.id, title: entry.title, html, ...fingerprint(bytes) };
  });
  if (!ids.has(manifest.overview)) reject("overview must name a diagram.");
  const overview = diagrams.find((entry) => entry.id === manifest.overview);
  const nodes = [...overview.html.matchAll(/\bdata-node-id="([^"]+)"/g)].map(
    (match) => match[1],
  );
  const linked = new Set();
  for (const [index, link] of manifest.links.entries()) {
    const subject = { link: index };
    fields(link, ["node", "details"], subject);
    if (
      !identifier.test(link.node || "") ||
      linked.has(link.node) ||
      nodes.filter((node) => node === link.node).length !== 1
    )
      reject("Link must name one unique overview node.", subject);
    linked.add(link.node);
    if (
      !Array.isArray(link.details) ||
      !link.details.length ||
      new Set(link.details).size !== link.details.length ||
      link.details.some((id) => !ids.has(id) || id === manifest.overview)
    )
      reject("details must name distinct non-overview diagrams.", subject);
  }
  for (const id of ids)
    if (
      id !== manifest.overview &&
      !manifest.links.some((link) => link.details.includes(id))
    )
      reject("Every detail must be reachable from the overview.", { id });
  if (inputs.includes(canonical(outputPath)))
    reject("Output must not replace the manifest or a child artifact.", {
      output,
    });
  const data = JSON.stringify({ ...manifest, diagrams }).replace(
    /</g,
    "\\u003c",
  );
  const template = fs.readFileSync(
    path.join(root, "assets/atlas.html"),
    "utf8",
  );
  const html = Buffer.from(
    template.replace("__ARCHIFY_ATLAS_DATA__", () => data),
  );
  const staging = fs.mkdtempSync(
    path.join(path.dirname(outputPath), ".archify-atlas-"),
  );
  try {
    const candidate = path.join(staging, "atlas.html");
    fs.writeFileSync(candidate, html);
    fs.renameSync(candidate, outputPath);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return {
    schemaVersion: 1,
    command: "atlas",
    status: "pass",
    specification: fingerprint(manifestBytes),
    artifact: { path: outputPath, ...fingerprint(html) },
    children: diagrams.map(({ id, sha256, bytes }) => ({ id, sha256, bytes })),
    browser_evidence: "pending",
    visual_review: "pending",
  };
}

export function commandAtlas(args) {
  const json = args.includes("--json"),
    positional = args.filter((arg) => arg !== "--json");
  try {
    if (
      positional.length !== 2 ||
      positional.some((arg) => arg.startsWith("--"))
    )
      reject("Usage: archify atlas <manifest.json> <output.html> [--json]");
    const receipt = buildAtlas(...positional);
    console.log(
      json
        ? JSON.stringify(receipt)
        : `Atlas written: ${receipt.artifact.path}; browser and perceptual review pending`,
    );
  } catch (error) {
    const diagnostic = error.diagnostic || {
      code: "atlas/input-or-delivery",
      severity: "error",
      message: error.message,
      subject: {},
      evidence: { reason: error.message },
      supportedFixes: [
        "check manifest JSON, input paths and output directory permissions",
      ],
    };
    const receipt = {
      schemaVersion: 1,
      command: "atlas",
      status: "fail",
      diagnostics: [diagnostic],
    };
    if (json) console.log(JSON.stringify(receipt));
    else console.error(diagnostic.message);
    process.exitCode = 1;
  }
}
