# Contributor cards

Generate Archify's paper-map contribution card from an actual merged GitHub PR. The repository author, title, PR number, UTC merge date and merge commit come from the GitHub API. The card says **Merged**, not **Verified**. Closed but unmerged PRs, bot authors and PRs targeting a non-default branch are rejected.

## Generate a preview

Use Node 22 or newer, Chrome and either an authenticated `gh` session or `GH_TOKEN`:

```sh
node tools/contributor-cards/cli.mjs --pr 394 --out /tmp/archify-card
```

An optional `--repo owner/repository` selects another repository. On Linux, install `fonts-noto-cjk` for Chinese titles; on macOS the template uses PingFang SC. `ARCHIFY_CHROME` can select a Chrome executable. Preview mode never writes to GitHub.

The output includes the 1000 × 1500 PNG, a portable HTML document with embedded map/fonts, original metadata with a PNG digest, a browser layout receipt, and the proposed reply. Original PR titles remain in metadata. The HTML title attribute retains the normalized display text before visual truncation. Titles that normalize to empty text are rejected. Font size is reduced within a readable range; exceptionally long titles end with an explicit ellipsis. Usernames are fitted without truncation; exceptionally wide 39-character handles wrap to two lines at the minimum 30px size. Middle-dot text separators are not used.

## Publish and reply

```sh
node tools/contributor-cards/cli.mjs --pr 394 --out /tmp/archify-card --publish
```

This is an explicit external write. It atomically adds the PNG and source record to the dedicated `contributor-cards` branch, verifies that the public image is readable, and posts a thank-you reply on that PR. Only public repositories are supported for publication. It does not create a Release, tag, Pages deployment or commit on main.

Each PR has one filename and one comment marker. Unchanged images do not create new commits. A repeated run reuses or updates the authenticated publisher's existing reply. It does not edit comments owned by another user. Consequently, use the workflow consistently for production; publishing locally as a person and later as the Actions bot creates separately owned replies. Existing images remain available through commit-pinned links. A failed comment request can be recovered by rerunning. Ref updates are fast-forward only, and conflicts retry against the latest tree without dropping other PR cards.

## GitHub workflow

[Contributor cards](../../.github/workflows/contributor-cards.yml) provides:

- Automatic publication after a human-authored PR merges into `main` in `tt-a1i/archify`.
- **Run workflow** with a merged PR number for preview or backfill. **Publish** defaults to false; enable it to post/update the reply.
- A downloadable workflow artifact retained for seven days; published PNGs live in the data branch independently of that retention.
- Scoped unit/browser checks on PRs and pushes to `dev` or `main` when this tool or its workflow changes.

During dev integration, use the local CLI preview and the scoped CI checks. Merging into `dev` does not send a card. The manual Actions renderer and automatic publication become usable after the tool is promoted to the default branch.

Privileged runs explicitly check out the default branch, never the PR head or merge ref. PR text is read as JSON, validated and HTML-escaped; it is never interpolated into shell commands or JavaScript. Exported HTML has a restrictive content policy, and Chrome blocks network requests during rendering. Checkout does not persist credentials. Job permissions are limited to repository content and PR comments. Per-PR concurrency prevents duplicate replies; publication handles races between different PRs.

To stop automatic replies, disable this workflow in Actions. Historical PRs are not automatically backfilled. Re-enable and use a manual run to recover a failed card. No separate API key, paid image generation or external publishing service is needed for each card.

## Validation

```sh
node --test tools/contributor-cards/test/*.test.mjs
```

Chrome is required; browser acceptance fails rather than silently skipping when unavailable. Coverage includes unmerged/wrong-repository/bot inputs, HTML injection, long handles, long unbroken/Chinese titles, duplicate runs, ref races, failed comments, forged comment markers, and public-image availability. Linux CI installs the Chinese fallback font explicitly. Visual review still checks the real PNG; layout metrics alone are not an aesthetic verdict.

## Assets and design

The map is the user-directed ChatGPT Web Pro image from the contributor-card exploration on 2026-09-03. It is reused unchanged; no new model call occurs during generation. Manrope and Barlow Condensed are bundled from the Google Fonts repository under their included SIL Open Font License files. The design retains the approved paper palette, map position and sentence-case typography. These are repository/community assets, outside the packaged Archify skill and its diagram design system.
