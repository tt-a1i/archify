#!/usr/bin/env bash
# Install the packaged Archify skill directly into a Raven workspace.
set -euo pipefail

archive_source="${ARCHIFY_RAVEN_ARCHIVE:-https://raw.githubusercontent.com/tt-a1i/archify/main/archify.zip}"
workspace="${RAVEN_WORKSPACE:-$HOME/.raven/workspace}"

usage() {
  cat <<'EOF'
Usage: install-raven.sh [--workspace <path>] [--archive <path-or-url>]

Options:
  --workspace <path>    Raven workspace (default: ~/.raven/workspace)
  --archive <path-url>  Archify ZIP source (default: the main branch archive)
  -h, --help            Show this help

The installer refuses to overwrite an existing Archify skill.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      [[ $# -ge 2 ]] || {
        echo "error: --workspace requires a path" >&2
        exit 2
      }
      workspace="$2"
      shift 2
      ;;
    --archive)
      [[ $# -ge 2 ]] || {
        echo "error: --archive requires a path or URL" >&2
        exit 2
      }
      archive_source="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

for command in unzip node; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "error: $command is required" >&2
    exit 1
  }
done

case "$archive_source" in
  http://* | https://*)
    command -v curl >/dev/null 2>&1 || {
      echo "error: curl is required to download Archify" >&2
      exit 1
    }
    ;;
  *)
    [[ -f "$archive_source" ]] || {
      echo "error: archive not found: $archive_source" >&2
      exit 1
    }
    ;;
esac

skills_dir="${workspace%/}/skills"
target="$skills_dir/archify"

if [[ -e "$target" || -L "$target" ]]; then
  echo "error: Archify is already installed at $target" >&2
  echo "Remove or move that directory before reinstalling." >&2
  exit 1
fi

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/archify-raven.XXXXXX")"
staged_target=""
cleanup() {
  rm -rf "$temp_dir"
  if [[ -n "$staged_target" && ( -e "$staged_target" || -L "$staged_target" ) ]]; then
    rm -rf "$staged_target"
  fi
}
trap cleanup EXIT

archive="$temp_dir/archify.zip"
case "$archive_source" in
  http://* | https://*)
    echo "Downloading Archify..."
    curl -fsSL "$archive_source" -o "$archive"
    ;;
  *)
    cp "$archive_source" "$archive"
    ;;
esac

unpacked="$temp_dir/unpacked"
mkdir -p "$unpacked"
unzip -q "$archive" -d "$unpacked"

if [[ ! -f "$unpacked/archify/SKILL.md" || ! -f "$unpacked/archify/bin/archify.mjs" ]]; then
  echo "error: archive does not contain a complete Archify skill" >&2
  exit 1
fi

mkdir -p "$skills_dir"
staged_target="$skills_dir/.archify.install.$$"
cp -R "$unpacked/archify" "$staged_target"
mv "$staged_target" "$target"
staged_target=""

node "$target/bin/archify.mjs" doctor

echo
echo "Archify installed for Raven:"
echo "  $target"
echo
echo "Verify with:"
echo "  raven skill list --source workspace"
echo "  raven skill get archify --with-body"
