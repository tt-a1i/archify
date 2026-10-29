# 饼图配置后，数值和占比为什么还要保留？ {#pie-diff}

这个提交先解析饼图，再给图例补上数值和占比；渲染时继续使用同一个解析结果。下面保留完整文件差异，便于核对兼容性处理。[](source:change)

@answer scope="Archify 的一个已提交改动 · 固定输入阅读实验"
@meta locale=zh-CN style=editorial
@source change title="饼图图例修复的固定提交" url=https://github.com/tt-a1i/archify/commit/e5e03d185ce0617aa4fc7645bac0317e4079f421

## 先看改变的顺序 {#sequence}

原来直接改写图表文本；现在先解析，再修改图例，最后渲染解析结果。原有多行写法的兼容处理仍在 `pieInput` 中。[](source:change)

## 完整改动里有哪些细节？ {#patch}

@diff id=complete-patch caption="charts.mjs 的完整文件差异；原行与新行分别计数"
```diff
diff --git a/archify/explainer/charts.mjs b/archify/explainer/charts.mjs
index c067c0f50..0900f8994 100644
--- a/archify/explainer/charts.mjs
+++ b/archify/explainer/charts.mjs
@@ -1,4 +1,4 @@
-import { PeleError, detectType, register, render } from './vendor/pele/core.js';
+import { PeleError, detectType, parse, register, render } from './vendor/pele/core.js';
 import pie from './vendor/pele/diagrams/pie.js';
 import xychart from './vendor/pele/diagrams/xychart.js';
 import quadrantChart from './vendor/pele/diagrams/quadrantChart.js';
@@ -10,19 +10,28 @@ register(pie, xychart, quadrantChart, sankey, radar, venn);
 
 const NATIVE = { flowchart: 'workflow or architecture', sequence: 'sequence', class: 'class', er: 'erd', state: 'lifecycle', timeline: 'timeline', gantt: 'timeline or waterfall', mindmap: 'tree', treeView: 'tree' };
 
-// A pie legend reads "Label · value (share%)" rather than Pele's "Label [value]". The labels are
-// rewritten before rendering so the legend is laid out for their real width.
-function pieLegend(text) {
+// Retain the multiline pie tokens accepted by the original wrapper. Keep line breaks so
+// a later parse error still points to the authored line; configuration prefixes need no rewrite.
+function pieInput(text) {
   if (!/^\s*pie\b/u.test(text)) return text;
-  const slice = /^(\s*)"((?:[^"\\]|\\.)*)"\s*:\s*(-?\d+(?:\.\d+)?)\s*$/gmu;
-  const total = [...text.matchAll(slice)].reduce((sum, match) => sum + Number(match[3]), 0);
-  if (!(total > 0)) return text;
-  return text.replace(/^(\s*pie)(\s+)showData\b/u, (_, pie, gap) => pie + gap.replace(/[^\r\n]/g, '')).replace(slice, (matched, indent, label, value) => {
-    const share = Math.round(Number(value) / total * 100);
-    // Keep accepted multiline whitespace without dropping diagnostic lines.
-    const breaks = matched.slice(indent.length + label.length + 2).replace(/[^\r\n]/g, '');
-    return `${indent}"${label} · ${value}${/\p{Script=Han}/u.test(label) ? `（${share}%）` : ` (${share}%)`}" : ${value}${breaks}`;
-  });
+  return text.replace(/^(\s*pie)(\s+)showData\b/u, (_, pie, gap) => pie + ' showData' + gap.replace(/[^\r\n]/g, ''))
+    .replace(/^(\s*)"((?:[^"\\]|\\.)*)"\s*:\s*(-?\d+(?:\.\d+)?)\s*$/gmu, (matched, indent, label, value) => {
+      const breaks = matched.slice(indent.length + label.length + 2).replace(/[^\r\n]/g, '');
+      return `${indent}"${label}" : ${value}${breaks}`;
+    });
+}
+
+// Decorate parsed sections so configuration prefixes and accepted label syntax retain the
+// same value/share legend. Rendering the same model also preserves its parsed configuration.
+function pieLegend(model) {
+  const total = [...model.sections.values()].reduce((sum, value) => sum + value, 0);
+  if (!(total > 0)) return model;
+  model.showData = false;
+  model.sections = new Map([...model.sections].map(([label, value]) => {
+    const share = Math.round(value / total * 100);
+    return [`${label} · ${value}${/\p{Script=Han}/u.test(label) ? `（${share}%）` : ` (${share}%)`}`, value];
+  }));
+  return model;
 }
 
 /** Render a Mermaid chart to static SVG, or return a located diagnostic reason. */
@@ -30,7 +39,8 @@ export function compileExplainerChart(text) {
   const type = detectType(text);
   if (type && NATIVE[type]) return { error: `Mermaid ${type} is drawn with the native ${NATIVE[type]} shorthand, which Archify validates and lets readers explore.`, example: `@${NATIVE[type].split(' ')[0]} id=...` };
   try {
-    const result = render(pieLegend(text), { padding: 8, fontSize: 13, links: false, images: false, config: { xyChart: { width: 480, height: 260, showDataLabel: true }, quadrantChart: { chartWidth: 400, chartHeight: 400 } } });
+    const input = type === 'pie' ? pieLegend(parse(pieInput(text))) : text;
+    const result = render(input, { padding: 8, fontSize: 13, links: false, images: false, config: { xyChart: { width: 480, height: 260, showDataLabel: true }, quadrantChart: { chartWidth: 400, chartHeight: 400 } } });
     // A rotated CJK axis title lies on its side; vertical writing keeps the characters upright.
     const svg = result.svg.replace(/<g transform="translate\(([\d.-]+),([\d.-]+)\) rotate\(-90\)"><text x="0" y="[\d.-]+" text-anchor="middle">([^<]*\p{Script=Han}[^<]*)<\/text><\/g>/gu, (_, x, y, label) => `<text x="${x}" y="${y}" text-anchor="middle" writing-mode="vertical-rl">${label}</text>`);
     return { svg, width: result.width, height: result.height, type: result.type };
```

## 读完后核对什么？ {#checks}

检查图例是否仍有数值和占比，布局配置是否继续生效，以及原来接受的多行输入是否还能解析。这些是该提交的检查目标；此页面只用于比较差异块的阅读和导出。[](source:change)
