import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiagramWithBrandMarks, writeDiagram } from '../shared/cli.mjs';
import { throwDiagnosticError } from '../shared/diagnostics.mjs';
import { compileWorkflow } from './workflow-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: workflow, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'workflow',
  defaultExample: 'agent-tool-call.workflow.json'
});

const compiled = compileWorkflow({
  workflow,
  qualityProfile: process.env.ARCHIFY_QUALITY_PROFILE || workflow.meta?.quality_profile,
});

const layoutJson = process.argv.includes('--layout-json');

if (layoutJson) {
  process.stdout.write(`${JSON.stringify(compiled.receipt, null, 2)}\n`);
  if (!compiled.ok) process.exitCode = 1;
} else if (!compiled.ok) {
  throwDiagnosticError(compiled.error || 'Workflow compilation failed.', compiled.diagnostics);
} else {
  writeDiagram({
    outPath,
    template,
    diagramType: 'workflow',
    meta: workflow.meta,
    svg: compiled.svg,
    cards: workflow.cards,
  });
}
