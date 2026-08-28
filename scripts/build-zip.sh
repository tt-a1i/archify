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

# Stage only files tracked by Git. Paths and modes come from the index, while
# bytes intentionally come from the working tree so contributors can package
# tracked edits before committing them. A conflicted index is never publishable.
# Rejecting tracked paths that are symlinks prevents an archive build from
# reading through links to content outside the repository.
# test/ is repo-only (the golden harness compares against ../examples at the
# repo root, which does not exist in an installed skill). The npm scripts and
# build-only dependencies are stripped from the shipped package.json. Runtime
# schema validation is provided by the committed standalone validators, so
# installing the skill never requires npm install.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
if [[ ! -f "$repo_root/archify/renderers/shared/generated-validators.mjs" ]]; then
  echo 'generated validators are missing — run npm run generate:validators in archify/' >&2
  exit 1
fi
while IFS= read -r -d '' record; do
  metadata="${record%%$'\t'*}"
  tracked="${record#*$'\t'}"
  tracked_mode="${metadata%% *}"
  tracked_stage="${metadata##* }"
  if [[ "$tracked_stage" != 0 ]]; then
    echo "refusing to package unmerged index entry (stage $tracked_stage): $tracked" >&2
    exit 1
  fi
  case "$tracked" in
    archify/test | archify/test/* | \
    archify/package-lock.json | \
    archify/scripts/generate-brand-marks.mjs | \
    archify/scripts/generate-validators.mjs)
      continue
      ;;
  esac

  source="$repo_root/$tracked"
  if [[ -L "$source" ]]; then
    echo "refusing to package tracked symlink: $tracked" >&2
    exit 1
  fi
  if [[ ! -f "$source" ]]; then
    echo "tracked package input is missing or not a regular file: $tracked" >&2
    exit 1
  fi

  target="$stage/$tracked"
  mkdir -p "$(dirname "$target")"
  cp "$source" "$target"
  case "$tracked_mode" in
    100755) chmod 0755 "$target" ;;
    100644) chmod 0644 "$target" ;;
    *)
      echo "unsupported tracked package mode $tracked_mode: $tracked" >&2
      exit 1
      ;;
  esac
done < <(git -C "$repo_root" ls-files --stage -z -- archify)
node -e "
  const fs = require('fs');
  const p = '$stage/archify/package.json';
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete pkg.scripts;
  delete pkg.devDependencies;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
"
rm -f "$stage/archify/package-lock.json"

node "$repo_root/scripts/write-deterministic-zip.mjs" "$stage/archify" "$out"

echo "built $out"
