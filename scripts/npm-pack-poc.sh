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
# Usage: bash scripts/npm-pack-poc.sh [artifact-directory]
# The optional directory must not exist; after all checks pass it receives the
# exact tested tarball, npm pack metadata, and the tested source revision.
# Requires: node >= 18, npm, git, tar.
# Use this clean staging path for the package under test; running npm pack
# directly in archify/ retains repository-only manifest fields.
#
# Note: a bare `archify` argument to npm pack/npm view is resolved as a registry
# spec, not a folder — it silently packs whatever `archify` currently sits on
# the npm registry (a 0.0.4 squatter at the time of writing). The staging
# directory path used below is always explicit and local.

set -euo pipefail

if [ "$#" -gt 1 ]; then
  printf 'Usage: bash scripts/npm-pack-poc.sh [artifact-directory]\n' >&2
  exit 1
fi
# Resolve a relative output against the caller's directory before entering the
# repository. Absolute paths work in both POSIX shells and Git Bash.
artifact_dir="${1:-}"
if [ -n "$artifact_dir" ]; then
  case "$artifact_dir" in
    /*|[A-Za-z]:*) ;;
    *) artifact_dir="$PWD/$artifact_dir" ;;
  esac
fi

cd "$(dirname "$0")/.."

readonly PKG_DIR_NAME="@tt-a1i/archify"

repo_root="$(pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/archify-pack-poc-XXXXXX")"
trap 'rm -rf "$work"' EXIT

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  [ok]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m  [FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

if [ -n "$artifact_dir" ] && { [ -e "$artifact_dir" ] || [ -L "$artifact_dir" ]; }; then
  fail "artifact directory already exists: $artifact_dir"
fi

log "1/10 Staging the clean package tree (scripts/stage-clean-skill.mjs)"
printf 'Source revision: %s\n' "$(git rev-parse HEAD)"
staged="${work}/staged"
node scripts/stage-clean-skill.mjs --dest "$staged" >/dev/null \
  || fail "clean-skill staging failed"
ok "staged $(find "$staged" -type f | wc -l | tr -d ' ') files into ${staged}"

log "2/10 npm pack from the staged tree"
# --pack-destination keeps the tarball out of the repository working tree.
npm pack --json --pack-destination "$work" "$staged" > "${work}/pack.json"
tarball_path="$(node -e 'const fs = require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[0].filename);' "${work}/pack.json")"
tarball="${work}/${tarball_path}"
[ -f "$tarball" ] || fail "npm pack did not produce a tarball"
case "$tarball_path" in
  tt-a1i-archify-*.tgz) ok "packed ${tarball_path}" ;;
  *) fail "packed the wrong package: ${tarball_path} (expected tt-a1i-archify-*.tgz)" ;;
esac
node -e '
  const fs = require("node:fs");
  const [packed] = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  console.log(`Package: ${packed.name}@${packed.version}`);
  console.log(`Integrity: ${packed.integrity}`);
  console.log("Packed files:");
  for (const entry of packed.files) console.log(`  ${entry.path}`);
' "${work}/pack.json"

log "3/10 Extracting tarball into an isolated directory"
extract_dir="${work}/package"
mkdir -p "$extract_dir"
tar -xzf "$tarball" -C "$extract_dir"
ok "extracted $(find "$extract_dir/package" -type f | wc -l | tr -d ' ') files"

log "4/10 Verifying packaged metadata (scoped name, bin-only, clean manifest)"
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

log "5/10 Verifying bundled assets required by the shipped commands"
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

log "6/10 Installing the same tarball locally and in an isolated global prefix"
install_dir="${work}/install"
global_dir="${work}/global prefix"
mkdir -p "$install_dir"
npm install --silent --no-fund --no-audit --ignore-scripts --loglevel=error \
  "${tarball}" --prefix "$install_dir"
ok "installed into ${install_dir}/node_modules/${PKG_DIR_NAME}"
bin="${install_dir}/node_modules/${PKG_DIR_NAME}/bin/archify.mjs"
npm install --silent --no-fund --no-audit --ignore-scripts --loglevel=error \
  --global --prefix "$global_dir" "$tarball"
global_bin="${global_dir}/bin/archify"
# npm places Windows global shims directly in the prefix, not its bin/ child.
if [ ! -f "$global_bin" ]; then global_bin="${global_dir}/archify"; fi
[ -f "$global_bin" ] || fail "global installation did not create the archify shim"
global_package="${global_dir}/lib/node_modules/${PKG_DIR_NAME}"
if [ ! -d "$global_package" ]; then global_package="${global_dir}/node_modules/${PKG_DIR_NAME}"; fi
ok "installed into an isolated global prefix containing a space"

log "7/10 Running archify doctor outside the checkout for both installations"
(cd "$install_dir" && node "$bin" doctor) \
  || fail "archify doctor reported an incomplete local installation"
(cd "$work" && "$global_bin" doctor) \
  || fail "archify doctor reported an incomplete global installation"
ok "doctor reports a complete installation"

log "8/10 Rendering and validating with the installed CLI"
input="${install_dir}/node_modules/${PKG_DIR_NAME}/examples/web-app.architecture.json"
output="${work}/rendered/poc.html"
mkdir -p "$(dirname "$output")"

(cd "$install_dir" && node "$bin" validate architecture "$input") >/dev/null \
  || fail "archify validate failed"
ok "validate architecture"

(cd "$install_dir" && node "$bin" deliver architecture "$input" "$output" --json) > "${work}/receipt.json" \
  || fail "archify deliver failed"
node -e '
  const fs = require("node:fs");
  const receipt = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (receipt.ok !== true) throw new Error(`delivery receipt not ok: ${receipt.error || "(unknown)"}`);
  if (!receipt.artifact || !/^[a-f0-9]{64}$/.test(receipt.artifact.sha256 || "")) throw new Error("receipt missing artifact sha256");
' "${work}/receipt.json" || fail "delivery receipt failed verification"
ok "deliver architecture (receipt verified, artifact written)"

log "9/10 Rendering all five installed examples through local and global CLI shims"
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
for type in architecture workflow sequence dataflow lifecycle; do
  relative="examples/${fixture[$type]}"
  input="${install_dir}/node_modules/${PKG_DIR_NAME}/${relative}"
  cmp -s "${repo_root}/archify/${relative}" "$input" \
    || fail "installed example differs from source: ${relative}"
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
  global_input="${global_package}/${relative}"
  cmp -s "${repo_root}/archify/${relative}" "$global_input" \
    || fail "globally installed example differs from source: ${relative}"
  (cd "$work" && "$global_bin" render "$type" "$global_input" "${work}/global-${type}.html") \
    || fail "global archify render ${type} failed outside the checkout"
  cmp -s "${work}/src-${type}.html" "${work}/global-${type}.html" \
    || fail "${type}: global render differs from the source render"
  ok "${type}: isolated global output byte-identical to source"
done

log "10/10 Checking machine-readable failures from both installed CLI paths"
printf '{}\n' > "${work}/invalid.workflow.json"
for invocation in local global; do
  set +e
  if [ "$invocation" = local ]; then
    (cd "$install_dir" && npx --no-install archify validate workflow "${work}/invalid.workflow.json" --json) \
      > "${work}/${invocation}-failure.json" 2> "${work}/${invocation}-failure.stderr"
  else
    (cd "$work" && "$global_bin" validate workflow "${work}/invalid.workflow.json" --json) \
      > "${work}/${invocation}-failure.json" 2> "${work}/${invocation}-failure.stderr"
  fi
  status=$?
  set -e
  [ "$status" -eq 1 ] || fail "${invocation}: expected invalid-diagram exit 1, got ${status}"
  node -e '
    const fs = require("node:fs");
    const receipt = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (receipt.ok !== false || !receipt.diagnostics?.some((entry) => typeof entry.code === "string")) {
      throw new Error("invalid diagram must return a classified JSON failure");
    }
  ' "${work}/${invocation}-failure.json" || fail "${invocation}: invalid JSON failure receipt"
  ok "${invocation}: exit 1 and classified JSON diagnostics"
done

if [ -n "$artifact_dir" ]; then
  mkdir -- "$artifact_dir"
  cp -- "$tarball" "${work}/pack.json" "$artifact_dir/"
  git rev-parse HEAD > "$artifact_dir/source-revision.txt"
  ok "retained the verified tarball and metadata in $artifact_dir"
fi

printf '\n\033[1;32mPackaging PoC passed.\033[0m\n'
