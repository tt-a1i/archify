import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiagramWithBrandMarks, writeDiagram } from '../shared/cli.mjs';
import { recordDiagnostic, throwDiagnosticError, withIsolatedDiagnosticRecording } from '../shared/diagnostics.mjs';
import { compileWorkflow } from './workflow-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: workflow, template, outPath, sourceEvidence } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'workflow',
  defaultExample: 'agent-tool-call.workflow.json'
});

let compiled;
try {
  compiled = withIsolatedDiagnosticRecording(() => compileWorkflow({
    workflow,
    qualityProfile: process.env.ARCHIFY_QUALITY_PROFILE || workflow.meta?.quality_profile,
    sourceEvidence,
  }));
} catch (error) {
  // The scope has restored the caller's recording. Keep a typed escape visible
  // alongside earlier failures without publishing abandoned compile attempts.
  if (Array.isArray(error?.archifyDiagnostics)) {
    for (const diagnostic of error.archifyDiagnostics) recordDiagnostic(diagnostic);
  }
  throw error;
}

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
    sourceEvidence,
  });
}
