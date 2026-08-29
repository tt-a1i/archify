#!/usr/bin/env bash

set -euo pipefail

data_branch="${1:-star-history}"
light_chart="${2:-assets/star-history-light.svg}"
dark_chart="${3:-assets/star-history-dark.svg}"

git check-ref-format --branch "$data_branch" >/dev/null

for chart in "$light_chart" "$dark_chart"; do
  case "$chart" in
    /*|../*|*/../*|*/..)
      echo "Chart path must stay inside the repository: $chart" >&2
      exit 2
      ;;
  esac
  if [[ ! -f "$chart" ]]; then
    echo "Generated chart is missing: $chart" >&2
    exit 2
  fi
done

temp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
snapshot_dir="$(mktemp -d "${temp_root%/}/archify-star-history.XXXXXX")"
mv -- "$light_chart" "$snapshot_dir/light.svg"
mv -- "$dark_chart" "$snapshot_dir/dark.svg"

if git ls-remote --exit-code --heads origin "refs/heads/$data_branch" >/dev/null 2>&1; then
  git fetch --no-tags origin "refs/heads/$data_branch:refs/remotes/origin/$data_branch"
  git switch --detach "refs/remotes/origin/$data_branch"
else
  git switch --orphan "$data_branch"
fi

# The data branch deliberately contains only the two generated charts. Keep its
# history linear so repositories that reject force pushes can refresh it safely.
git rm -r -q --ignore-unmatch .
mkdir -p -- "$(dirname "$light_chart")" "$(dirname "$dark_chart")"
mv -- "$snapshot_dir/light.svg" "$light_chart"
mv -- "$snapshot_dir/dark.svg" "$dark_chart"
git add -f -- "$light_chart" "$dark_chart"

if git diff --cached --quiet; then
  echo "Star History charts are unchanged."
  exit 0
fi

git -c user.name="github-actions[bot]" \
  -c user.email="github-actions[bot]@users.noreply.github.com" \
  commit -m "${STAR_HISTORY_COMMIT_MESSAGE:-chore: update star history chart}"
git push origin "HEAD:refs/heads/$data_branch"
