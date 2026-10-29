# curl: request, download and display

[Reviewed page](candidate.html) · [Independent first draft](author/answer.html) · [Review index](../index.html#curl)

This discovery case asks why `-I` and `-i` differ, and why seeing only headers does not establish that a request used HEAD. It changes example content only. It is not a paired authoring-instruction experiment or a generation benchmark.

## Sources and local observation

- Official curl option documentation is pinned to curl 8.7.1, commit `de7b3e89218467159a7af72d58cea8425946e97d`. The page links to `head`, `include`, `request`, `dump-header`, `output` and `disable` individually. It uses the older `--include` spelling appropriate to this version.
- [RFC 9110 §9.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.2) defines HEAD; [§8.6](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6) constrains its optional Content-Length. HEAD content is absent, but response headers still travel. A reported length is not the number of body bytes downloaded by this HEAD request.
- [probe.py](probe.py) starts an ephemeral loopback HTTP/1.1 server with a six-byte body, disables curl configuration and proxies, captures the server-observed method, body-download count and exact stdout, and shuts the server down. It uses `/usr/bin/curl 8.7.1`, an Apple build; upstream binary equivalence is not claimed.

| Operation | Observed method | Body bytes downloaded | stdout |
| --- | --- | --- | --- |
| Plain | GET | 6 | Body |
| `-i` | GET | 6 | Headers and body |
| `-I` | HEAD | 0 | Headers |
| `-D - -o /dev/null` | GET | 6 | Headers |

The last two stdout byte sequences are identical in this fixture. Their methods and downloaded body counts differ. Both [first run](probe-first-output.json) and [repeat run](probe-output.json) are retained; the repeat only clarified the scope sentence, and the cases are identical ([comparison](probe-comparison.json)). These observations do not establish behavior for all servers, proxies, redirects, authentication or performance workloads. The sample commands use a `URL` placeholder and POSIX `/dev/null`.

## Authoring and reading repair

Runtime frozen at `5492057ceb5f4267c11e8c8a3c3ad3450acd4788`. One independent gpt-6.1-terra/medium author used the retained [prompt](author-prompt.txt), first draft and notes in [author/](author/). Its first strict finalize passed with zero diagnostics and no repairs. The parent then checked sources and the rendered page.

The original four-column table needs 432 px in a 332 px phone frame; the output column is initially hidden. The reviewed two-column table combines the method, downloaded body and output in each row. All four operations fit without horizontal scrolling at 390 px. This costs some row height: 263 → 298 px. At desktop width, content changes also changed card placement and width; this is not a fixed-layout renderer comparison.

The parent also removed literal title backticks, clarified that zero body bytes does not mean zero transferred bytes, and added a short checklist for interpreting a real response. The three-command code block remains unchanged. [Original measurements](author-visual.json) and [reviewed measurements](visual-metrics.json) retain the actual widths.

Parent visual inspection covered [desktop light](top-1440-light.png), [phone light](table-390-light.png), and [phone dark](table-390-dark.png). Labels, counts and the qualification about received headers remain readable. The original phone screenshot is [retained](author/table-390.png). This is agent inspection, not a human readability study.

## Verification boundary

- Reviewed source: strict finalize passed validate/deliver/check with zero diagnostics; the [current-path check](check.json) passes provenance and artifact identity.
- The copied original author's receipts still identify its original tuning directory. Checking the relocated copy correctly fails provenance ([actual failure](author/relocation-check.json)); the receipts were not rewritten to conceal relocation.
- Local probe assertions pass in both recorded runs. No new runtime, dependency, authoring rule or package source changed; no ZIP rebuild or renderer suite was needed for these content edits.
- The review index loaded both added variants, matched each full-page link and fit the outer 390 px viewport ([live check](index-check.json)); all 25 local targets exist ([links](index-links.json)). The first browser harness launch mixed CommonJS `require` with top-level `await` and exited before browser work; changing the import to ESM allowed the recorded check to run.
- No complete browser gate, OS clipboard acceptance, Windows check, remote final-head CI, human acceptance or general authoring gain is claimed.

Disposition: verified local content repair, with the original draft and source/observation limits retained. Continue the overall exploration goal.
