#!/usr/bin/env bash
# Publishes one generated contributors.svg onto a dedicated data branch.
# Same linear fast-forward pattern as scripts/publish-star-history.sh: the
# branch contains only that file, and this script never commits on main or dev.
# Maintainer-only GitHub Actions helper; it is not part of the Archify CLI.

set -euo pipefail

data_branch="${1:-contributors}"
svg_path="${2:-contributors.svg}"

git check-ref-format --branch "$data_branch" >/dev/null

if [[ "$data_branch" == "main" || "$data_branch" == "dev" ]]; then
  echo "Refusing to publish contributors onto $data_branch" >&2
  exit 2
fi

case "$svg_path" in
  ../*|*/../*|*/..)
    echo "SVG path must not traverse upward: $svg_path" >&2
    exit 2
    ;;
esac

if [[ ! -f "$svg_path" ]]; then
  echo "Generated contributors SVG is missing: $svg_path" >&2
  exit 2
fi

if ! head -n 5 -- "$svg_path" | grep -q '<svg'; then
  echo "Refusing to publish a file that is not an SVG: $svg_path" >&2
  exit 2
fi

temp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
snapshot="$(mktemp "${temp_root%/}/archify-contributors.XXXXXX.svg")"
cp -- "$svg_path" "$snapshot"

if git ls-remote --exit-code --heads origin "refs/heads/$data_branch" >/dev/null 2>&1; then
  git fetch --no-tags origin "refs/heads/$data_branch:refs/remotes/origin/$data_branch"
  git switch --detach "refs/remotes/origin/$data_branch"
else
  git switch --orphan "$data_branch"
fi

# Keep the data branch to the generated wall so a fast-forward refresh stays linear.
git rm -r -q --ignore-unmatch .
cp -- "$snapshot" contributors.svg
git add -f -- contributors.svg

if git diff --cached --quiet; then
  echo "Contributors wall is unchanged."
  exit 0
fi

git -c user.name="github-actions[bot]" \
  -c user.email="github-actions[bot]@users.noreply.github.com" \
  commit -m "${CONTRIBUTORS_COMMIT_MESSAGE:-chore: update contributors wall}"
git push origin "HEAD:refs/heads/$data_branch"
