#!/usr/bin/env bash
#
# npm packaging Proof of Concept for @tt-a1i/archify.
#
# Packs the CLI via the repository's clean-skill staging pipeline
# (scripts/stage-clean-skill.mjs, the same contract the zip release uses, which
# strips scripts/devDependencies/overrides from the shipped manifest), extracts
# the tarball into an isolated temporary directory, and verifies that every
# asset the shipped commands need was bundled.
#
# Usage: scripts/npm-pack-poc.sh
# Requires: node >= 18, npm, git, tar.
#
# Note: a bare `archify` argument to npm pack/npm view is resolved as a registry
# spec, not a folder — it silently packs whatever `archify` currently sits on
# the npm registry (a 0.0.4 squatter at the time of writing). The staging
# directory path used below is always explicit and local.

set -euo pipefail

cd "$(dirname "$0")/.."

readonly PKG_DIR_NAME="@tt-a1i/archify"

repo_root="$(pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/archify-pack-poc-XXXXXX")"
trap 'rm -rf "$work"' EXIT

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  [ok]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m  [FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

log "1/9 Staging the clean package tree (scripts/stage-clean-skill.mjs)"
staged="${work}/staged"
node scripts/stage-clean-skill.mjs --dest "$staged" >/dev/null \
  || fail "clean-skill staging failed"
ok "staged $(find "$staged" -type f | wc -l | tr -d ' ') files into ${staged}"

log "2/9 npm pack from the staged tree"
# --pack-destination keeps the tarball out of the repository working tree.
tarball_path="$(npm pack --silent --pack-destination "$work" "$staged" | tail -n1)"
tarball="${work}/${tarball_path}"
[ -f "$tarball" ] || fail "npm pack did not produce a tarball"
case "$tarball_path" in
  tt-a1i-archify-*.tgz) ok "packed ${tarball_path}" ;;
  *) fail "packed the wrong package: ${tarball_path} (expected tt-a1i-archify-*.tgz)" ;;
esac

log "3/9 Extracting tarball into an isolated directory"
extract_dir="${work}/package"
mkdir -p "$extract_dir"
tar -xzf "$tarball" -C "$extract_dir"
ok "extracted $(find "$extract_dir/package" -type f | wc -l | tr -d ' ') files"

log "4/9 Verifying packaged metadata (scoped name, bin-only, clean manifest)"
node -e '
  const fs = require("node:fs");
  const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const problems = [];
  if (pkg.name !== "@tt-a1i/archify") problems.push(`packaged name is ${pkg.name}`);
  if (!pkg.bin || pkg.bin.archify !== "./bin/archify.mjs") problems.push("bin.archify is not ./bin/archify.mjs");
  for (const field of ["main", "exports", "private", "scripts", "dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides"]) {
    if (Object.hasOwn(pkg, field)) problems.push(`packaged package.json must not contain "${field}"`);
  }
  if (problems.length) {
    console.error(problems.map((p) => `  [FAIL] ${p}`).join("\n"));
    process.exit(1);
  }
' "${extract_dir}/package/package.json" || fail "packaged metadata violates the packaging constraints"
ok "name, bin-only surface, and clean manifest confirmed"

log "5/9 Verifying bundled assets required by the shipped commands"
missing=0
# Ground truth is the archify doctor check list (bin/archify.mjs commandDoctor):
# every path below is one doctor requires to declare an installation "ready".
while IFS= read -r rel; do
  if [ -f "${extract_dir}/package/${rel}" ]; then
    ok "bundled ${rel}"
  else
    printf '\033[1;31m  [FAIL]\033[0m missing %s\n' "$rel" >&2
    missing=$((missing + 1))
  fi
done <<'EOF'
bin/archify.mjs
bin/preview.mjs
bin/visual-check.mjs
bin/open-artifact.mjs
renderers/shared/generated-validators.mjs
renderers/shared/output-path.mjs
delta/architecture-delta.mjs
recipes/scenarios.mjs
schemas/architecture.schema.json
schemas/workflow.schema.json
schemas/sequence.schema.json
schemas/dataflow.schema.json
schemas/lifecycle.schema.json
examples/web-app.architecture.json
examples/agent-tool-call.workflow.json
examples/cache-miss-request.sequence.json
examples/product-analytics.dataflow.json
examples/agent-run.lifecycle.json
examples/checkout-platform.base.architecture.json
examples/checkout-platform.head.architecture.json
assets/template.html
assets/JetBrainsMono-OFL.txt
scripts/check-render-output.mjs
scripts/check-update.mjs
scripts/render-examples.mjs
scripts/update-contract.mjs
SKILL.md
THIRD_PARTY_NOTICES.md
LICENSE
skill-release.json
package.json
EOF
[ "$missing" -eq 0 ] || fail "${missing} required asset(s) missing from the tarball"

log "6/9 Installing the tarball in an isolated prefix (no lifecycle scripts)"
install_dir="${work}/install"
mkdir -p "$install_dir"
npm install --silent --no-fund --no-audit --ignore-scripts --loglevel=error \
  "${tarball}" --prefix "$install_dir"
ok "installed into ${install_dir}/node_modules/${PKG_DIR_NAME}"
bin="${install_dir}/node_modules/${PKG_DIR_NAME}/bin/archify.mjs"

log "7/9 Running archify doctor from the installed package"
node "$bin" doctor || fail "archify doctor reported an incomplete installation"
ok "doctor reports a complete installation"

log "8/9 Rendering and validating with the installed CLI"
input="${extract_dir}/package/examples/web-app.architecture.json"
output="${work}/rendered/poc.html"
mkdir -p "$(dirname "$output")"

node "$bin" validate architecture "$input" >/dev/null \
  || fail "archify validate failed"
ok "validate architecture"

node "$bin" deliver architecture "$input" "$output" --json > "${work}/receipt.json" \
  || fail "archify deliver failed"
node -e '
  const fs = require("node:fs");
  const receipt = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (receipt.ok !== true) throw new Error(`delivery receipt not ok: ${receipt.error || "(unknown)"}`);
  if (!receipt.artifact || !/^[a-f0-9]{64}$/.test(receipt.artifact.sha256 || "")) throw new Error("receipt missing artifact sha256");
' "${work}/receipt.json" || fail "delivery receipt failed verification"
ok "deliver architecture (receipt verified, artifact written)"

log "9/9 Rendering ALL 5 diagram types via npx and comparing against the source tree"
# Exercises the installed CLI exactly like a consumer would: npx from an
# isolated project directory outside the source checkout. The packed output
# must be byte-identical to a render straight from the repository sources.
declare -A fixture=(
  [architecture]="web-app.architecture.json"
  [workflow]="agent-tool-call.workflow.json"
  [sequence]="cache-miss-request.sequence.json"
  [dataflow]="product-analytics.dataflow.json"
  [lifecycle]="agent-run.lifecycle.json"
)
repo_input_for() { printf '%s/archify/examples/%s' "$repo_root" "$1"; }
for type in architecture workflow sequence dataflow lifecycle; do
  input="$(repo_input_for "${fixture[$type]}")"
  node "${repo_root}/archify/bin/archify.mjs" render "$type" "$input" "${work}/src-${type}.html" \
    || fail "source render failed for ${type}"
  (cd "${work}/install" \
    && npx --no-install archify render "$type" "$input" "${work}/installed-${type}.html") \
    || fail "npx archify render ${type} failed from the isolated install"
  if cmp -s "${work}/src-${type}.html" "${work}/installed-${type}.html"; then
    ok "${type}: npx output byte-identical to source"
  else
    fail "${type}: installed render differs from the source render"
  fi
done

printf '\n\033[1;32mPackaging PoC passed.\033[0m\n'
