# Story HTML parser

`html-parser.mjs` bundles the `parse` and `serializeOuter` exports of parse5
7.3.0 with entities 6.0.1. It is used only by the Node story scanner and builder,
and is not embedded in generated HTML. Packaged commands need no npm install.

Sources: [parse5](https://github.com/inikulin/parse5/tree/v7.3.0),
[entities](https://github.com/fb55/entities/tree/v6.0.1).
The adjacent files retain the MIT and BSD-2-Clause licenses respectively.

From the repository root, with its locked dependencies installed, rebuild with
esbuild 0.25.11 using this stdin entry:

```js
export { parse, serializeOuter } from 'parse5';
```

```sh
npx --yes esbuild@0.25.11 --bundle --platform=node --format=esm --target=node18 --minify --legal-comments=none --outfile=archify/story/vendor/html-parser.mjs < entry.mjs
```
