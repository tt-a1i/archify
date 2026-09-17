# Reading evidence

Comparison base: `10722002bb8777ecb639d93c49586fae4adf3ae4`.

The fixed input is `archify/examples/cache-miss-request.sequence.json`.
`sequence-before.png` and `sequence-after.png` compare its base and candidate
artifacts at 1440×900, Classic/light, READ/Still, in the same Chrome environment.
Message type increases from 9 to 11 source pixels with matching plates; the
participants, routes, labels and topology are retained. Standard inputs retain
legacy message metrics, covered by a parallel-label regression.

`layered-light.png` and `layered-dark.png` show the separate-detail reader at
2048×1320 after an offline browser run. The browser fixture uses three copies
of the checked sequence to exercise single-target and multi-target navigation
without introducing unverified domain relationships. The runnable product
sample `archify/references/request-reading.atlas.json` instead links the web
application's API node to its cache-miss sequence.

Reproduce interaction evidence:

```sh
ARCHIFY_CHROME="/path/to/chrome" ARCHIFY_READING_EVIDENCE="/tmp/reading-evidence" \
  node --test archify/test/atlas-browser.test.mjs
```

That test blocks HTTP/HTTPS and exercises Enter activation, explicit detail
choice, return camera/focus, shell/child theme synchronization, four desktop
sizes, icon painting and canonical SVG export. Its second case deliberately
shrinks message text to prove that browser readability detects the defect.

Run `archify/test/desktop-reader-browser.test.mjs` with the same Chrome setting
for all packaged diagrams and the production architecture readability case.

Perceptual review: screenshots were inspected with an image-capable reviewer.
The enlarged messages remain distinct from auxiliary labels, no new message
collision was observed in the comparison, and both atlas themes show visible
controls and a contained diagram. This is bounded evidence for the fixtures,
not a guarantee for arbitrary supplied HTML, all exports or every browser.

Independent review disposition: the shared output-path guard replaces bespoke
alias handling; CLI tests cover non-HTML and symlink-resolved non-HTML targets.
The standard-v1 parallel-message compatibility finding is fixed by retaining
legacy sizing outside showcase. Atlas chrome uses the project's mono stack.
