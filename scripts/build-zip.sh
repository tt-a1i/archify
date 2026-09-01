#!/usr/bin/env bash
# Build the distributable skill archive from the archify/ folder.
# Usage: scripts/build-zip.sh [output.zip]
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$repo_root/archify.zip}"
if [[ "$out" != /* ]]; then
  out="$(pwd)/$out"
fi

# Runtime consumers support every Node version declared by archify/package.json,
# but canonical ZIP bytes depend on the Node/zlib toolchain. CI and releases use
# Node 22, so fail clearly instead of publishing different bytes from another
# Node major.
canonical_node_major=22
node_version="$(node -p 'process.versions.node')"
node_major="${node_version%%.*}"
if [[ "$node_major" != "$canonical_node_major" ]]; then
  echo "canonical archify.zip builds require Node $canonical_node_major (current: $node_version)" >&2
  exit 1
fi

# The shared stager owns tracked-only selection, index modes, conflict and
# symlink rejection, repository-only exclusions, and package.json cleanup for
# both the ZIP and DeepSeek Harness tarball.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
node "$repo_root/scripts/stage-clean-skill.mjs" \
  --root "$repo_root" \
  --dest "$stage/archify" >/dev/null

node "$repo_root/scripts/write-deterministic-zip.mjs" "$stage/archify" "$out"

echo "built $out"
