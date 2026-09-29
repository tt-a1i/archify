#!/usr/bin/env bash
# Build the distributable skill archive from the archify/ folder.
# Usage: scripts/build-zip.sh [output.zip]
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$repo_root/archify.zip}"

# Reject unsafe raw output spellings before the canonical-toolchain gate so
# every maintained Node lane exercises the same shared native path grammar.
# This validation-only mode is read-only and does not create parent paths.
node "$repo_root/scripts/write-deterministic-zip.mjs" --validate-output "$out"

# Runtime consumers support every Node version declared by archify/package.json,
# but canonical ZIP bytes depend on the Node/zlib toolchain. CI and releases use
# official Node 22 with its bundled zlib. Distributions linked against a system
# zlib can produce different bytes even at the same Node version.
canonical_node_major=22
canonical_zlib_version=1.3.1-e00f703
node_version="$(node -p 'process.versions.node')"
node_major="${node_version%%.*}"
zlib_version="$(node -p 'process.versions.zlib')"
if [[ "$node_major" != "$canonical_node_major" || "$zlib_version" != "$canonical_zlib_version" ]]; then
  echo "canonical archify.zip builds require Node $canonical_node_major with bundled zlib $canonical_zlib_version (current: Node $node_version, zlib $zlib_version)" >&2
  echo "Use an official Node.js 22 distribution with the required bundled zlib on PATH; diagram runtime support is unchanged." >&2
  exit 1
fi

# The shared stager owns tracked-only selection, index modes, conflict and
# symlink rejection, repository-only exclusions, and package.json cleanup for
# both the ZIP and DeepSeek Harness tarball.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
node "$repo_root/scripts/stage-clean-skill.mjs" \
  --root "$repo_root" \
  --dest "$stage/archify" \
  --mode-manifest "$stage/modes.json" >/dev/null

# Entry modes come from the recorded Git index modes, not from stat(), so the
# archive bytes do not depend on the building platform's permission support.
node "$repo_root/scripts/write-deterministic-zip.mjs" "$stage/archify" "$out" \
  --mode-manifest "$stage/modes.json"

echo "built $out"
