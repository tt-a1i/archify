#!/usr/bin/env bash
# Build the distributable skill archive from the archify/ folder.
# Usage: scripts/build-zip.sh [output.zip]
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$repo_root/archify.zip}"
if [[ "$out" != /* ]]; then
  out="$(pwd)/$out"
fi

# Stage a clean copy: node_modules never ships; test/ is repo-only (the golden
# harness compares against ../examples at the repo root, which does not exist
# in an installed skill); local agent coordination folders are also excluded so
# a developer's working tree cannot leak into the distributable archive. The npm
# scripts and build-only dependencies are stripped from the shipped
# package.json. Runtime schema validation is provided by the committed
# standalone validators, so installing the skill never requires npm install.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
if [[ ! -f "$repo_root/archify/renderers/shared/generated-validators.mjs" ]]; then
  echo 'generated validators are missing — run npm run generate:validators in archify/' >&2
  exit 1
fi
rsync -a \
  --exclude 'node_modules' \
  --exclude 'test' \
  --exclude 'scripts/generate-validators.mjs' \
  --exclude '.DS_Store' \
  --exclude '.hive' \
  --exclude '.workbuddy' \
  --exclude '.validator-check-*' \
  "$repo_root/archify/" "$stage/archify/"
node -e "
  const fs = require('fs');
  const p = '$stage/archify/package.json';
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete pkg.scripts;
  delete pkg.devDependencies;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
"
rm -f "$stage/archify/package-lock.json"

rm -f "$out"
(cd "$stage" && zip -r -X -q "$out" archify)

unzip -l "$out" | tail -1
echo "built $out"
