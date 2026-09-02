import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiagramWithBrandMarks, writeDiagram } from '../shared/cli.mjs';
import { esc } from '../shared/utils.mjs';
import { compileArchitectureGraph } from './architecture-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: arch, template, outPath, sourceEvidence } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'architecture',
  defaultExample: 'web-app.architecture.json',
  argv: cliArgs,
});

const compiled = compileArchitectureGraph(arch, { sourceEvidence });
if (layoutJsonMode) {
  console.log(JSON.stringify(compiled.layoutReport, null, 2));
  process.exit(0);
}

const inheritedMeta = Object.fromEntries([
  'locale',
  'animation',
  'visual_preset',
  'quality_profile',
  'engineering_profile',
].flatMap((key) => arch.meta?.[key] === undefined ? [] : [[key, arch.meta[key]]]));
const subarchitectureTemplates = (arch.components || []).flatMap((parent, parentIndex) => {
  const local = parent.subarchitecture;
  if (!local) return [];
  const localGraph = {
    meta: { title: local.title },
    components: local.components,
    boundaries: local.boundaries || [],
    connections: local.connections || [],
    ...(local.layout ? { layout: local.layout } : {}),
  };
  const scopedEvidence = sourceEvidence?.subgraphs?.[parent.id] || null;
  const localCompiled = compileArchitectureGraph(localGraph, {
    identityPrefix: `sub-${parent.id}-`,
    graphScope: 'subarchitecture',
    parentId: parent.id,
    subjectBase: `/components/${parentIndex}/subarchitecture`,
    inheritedMeta,
    sourceEvidence: scopedEvidence,
  });
  return [`    <template data-subarchitecture-parent="${esc(parent.id)}" data-subarchitecture-title="${esc(local.title)}">
${localCompiled.svg}
    </template>`];
}).join('\n');

writeDiagram({
  outPath,
  template,
  diagramType: 'architecture',
  meta: arch.meta,
  svg: compiled.svg,
  cards: arch.cards,
  sourceEvidence,
  subarchitectureTemplates,
});
