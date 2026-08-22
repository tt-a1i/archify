#!/usr/bin/env bash
# Build the distributable skill archive from the archify/ folder.
# Usage: scripts/build-zip.sh [output.zip]
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$repo_root/archify.zip}"
if [[ "$out" != /* ]]; then
  out="$(pwd)/$out"
fi

# Stage only files tracked by Git. This keeps untracked working-tree content out
# of the archive, and rejecting tracked paths that are symlinks prevents an
# archive build from reading through links to content outside the repository.
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
while IFS= read -r -d '' tracked; do
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
  cp -p "$source" "$target"
done < <(git -C "$repo_root" ls-files -z -- archify)
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
