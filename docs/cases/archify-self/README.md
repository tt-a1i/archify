# Archify self-map

Bundle-canonical stems only: `archify-self.json`, `archify-renderers.json`, `render-pipeline.json`, each with a `<stem>.ownership.json` sidecar. The three HTML files are the checked-in bundle artifacts. PR locate folders keep only `locate.receipt.json`.

Regenerate from the repository root:

```bash
node archify/bin/archify.mjs bundle docs/cases/archify-self

node archify/bin/archify.mjs locate \
  b86b60789e18829885dd23c844e36549f0b40303..e9ea3a1330733ea6049429ca9e3b731d7f59d8c4 \
  --map docs/cases/archify-self/archify-self.json \
  --out docs/cases/archify-self/locate-pr-256

node archify/bin/archify.mjs locate \
  10722002bb8777ecb639d93c49586fae4adf3ae4..3b875f79bb3432ad8210b8abc36ade9802466bfa \
  --map docs/cases/archify-self/archify-self.json \
  --out docs/cases/archify-self/locate-pr-352

node archify/bin/archify.mjs locate --lint HEAD \
  --map docs/cases/archify-self/archify-self.json \
  --out /tmp/archify-self-lint
```

After regenerating a PR locate, keep `locate.receipt.json` and delete the HTML (and any `compare/` dir).
