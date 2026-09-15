# Code Analysis Quick Start

From the `archify/` package directory inside the Archify repository:

```sh
npm ci
npm start -- "/path/to/project" --ir architecture.json
```

Use the project's architecture JSON prepared with Archify as `architecture.json`. Your project can stay in its own directory.

1. Open the **Archify** URL printed in the terminal to view the architecture diagram.
2. Click **Code Analysis** in the upper-right corner to start analysis.
3. Click a module to inspect Findings. Click a source link to view code and scroll through its context in the right panel.
4. Click **Code Analysis** again to return to the architecture view.

Keep the terminal running. After changing source code, stop the server with `Ctrl+C`, restart it, open the new URL, and click **Code Analysis** again.

Python and JS/TS are supported. For mixed-language projects, add `--language py` or `--language ts`; each run analyzes one language. Add `--map overlay-map.json` when you need an explicit mapping between diagram components and code modules.

Output defaults to a system temporary directory. Add `--out out/my-project` to choose a persistent output directory. Use the printed URL: double-clicking a static HTML file cannot start local code analysis.

You can also run `node bin/archify.mjs start "/path/to/project" --ir architecture.json` directly. The legacy `code-analysis serve` command remains supported.
