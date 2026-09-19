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

Analysis reads the working tree, including uncommitted and untracked source files. Results are labeled **Working tree**; any base commit is context only. Source panels use the text captured during extraction, and working-tree results do not provide commit-based source links. The raw facts retain that source text and a snapshot digest so findings, graphs, and source panels refer to the same extraction. Non-Git directories are supported.

The source panel marks captured changes against the base commit: green gutters for added lines, amber for modified lines, and red deletion markers between lines. This includes staged and unstaged changes; files absent from the base are labeled **New file**. Markers stay tied to the captured source, so restart analysis to see later edits. Without a readable Git base, the panel reports that markers are unavailable rather than treating every line as new.

If the architecture JSON changes or becomes unavailable after startup, the analysis request is rejected and the page asks you to regenerate the diagram. Restart with the updated JSON and open the new URL. The server never rewrites your input JSON or silently combines a new architecture with the previous diagram.

Python and JS/TS are supported. For mixed-language projects, add `--language py` or `--language ts`; each run analyzes one language. Add `--map overlay-map.json` when you need an explicit mapping between diagram components and code modules.

Output defaults to a system temporary directory. Add `--out out/my-project` to choose a persistent output directory. Use the printed URL: double-clicking a static HTML file cannot start local code analysis.

You can also run `node bin/archify.mjs start "/path/to/project" --ir architecture.json` directly. The legacy `code-analysis serve` command remains supported.
