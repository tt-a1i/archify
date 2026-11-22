import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiagramWithBrandMarks, writeDiagram } from '../shared/cli.mjs';
import { recordDiagnostic } from '../shared/diagnostics.mjs';
import { layoutReportFromSvg } from '../shared/layout-report.mjs';
import { compileDataflow } from './dataflow-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: dataflow, template, outPath, sourceEvidence } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'dataflow',
  defaultExample: 'product-analytics.dataflow.json',
});

let svg;
try {
  svg = compileDataflow({ dataflow, sourceEvidence,
    qualityProfile: process.env.ARCHIFY_QUALITY_PROFILE || dataflow.meta?.quality_profile });
} catch (error) {
  for (const diagnostic of error?.archifyDiagnostics || []) recordDiagnostic(diagnostic);
  throw error;
}
if (process.argv.includes('--layout-json')) {
  console.log(JSON.stringify(layoutReportFromSvg(svg, 'dataflow'), null, 2));
} else {
  writeDiagram({ outPath, template, diagramType: 'dataflow', meta: dataflow.meta,
    svg, cards: dataflow.cards, sourceEvidence, diagram: dataflow });
}
