import path from 'node:path';
import { sameLocation } from '../shared/path-semantics.mjs';
import { fileURLToPath } from 'node:url';
import { loadDiagram, writeDiagram, svgRootAttrs, svgAccessibleText } from '../shared/cli.mjs';
import { throwDiagnosticError } from '../shared/diagnostics.mjs';
import { renderIntervalLayout } from './interval-layout.mjs';

const rendererDir = path.dirname(fileURLToPath(import.meta.url));

export function renderInterval(spec) {
  try {
    return renderIntervalLayout(spec);
  } catch (error) {
    throwDiagnosticError(error.message, [error.intervalDiagnostic || {
      code: 'interval/invalid-geometry',
      severity: 'error',
      message: error.message,
      subject: { diagramType: 'interval', path: '/tracks' },
      evidence: { reason: error.message },
      supportedFixes: ['correct the named geometry field using schemas/interval.schema.json'],
    }]);
  }
}

function svgForViewer(svg, meta) {
  return svg.replace(/<svg\b[^>]*>/, opening => {
    const viewBox = opening.match(/\bviewBox="([^"]+)"/)[1];
    const origin = opening.match(/\bdata-x-origin="([^"]+)"/)[1];
    const scale = opening.match(/\bdata-x-scale="([^"]+)"/)[1];
    return `<svg xmlns="http://www.w3.org/2000/svg" data-diagram-type="interval" data-reader-fit="intrinsic-height" data-reader-min-text="7.5" viewBox="${viewBox}" data-x-origin="${origin}" data-x-scale="${scale}" ${svgRootAttrs(meta)}>${svgAccessibleText(meta, 'interval')}`;
  });
}

if (process.argv[1] && sameLocation(process.argv[1], fileURLToPath(import.meta.url))) {
  const { diagram, template, outPath } = loadDiagram({
    rendererDir,
    diagramType: 'interval',
    defaultExample: 'storage.interval.json',
  });
  if ((process.env.ARCHIFY_QUALITY_PROFILE || diagram.meta.quality_profile) === 'showcase') {
    throwDiagnosticError('Interval diagrams require the standard quality profile; showcase is unsupported', [{
      code: 'interval/unsupported-quality-profile',
      severity: 'error',
      message: 'The showcase profile has no interval-specific composition checks.',
      subject: { diagramType: 'interval', path: '/meta/quality_profile' },
      evidence: { requested: 'showcase', supported: ['standard'] },
      supportedFixes: ['use --quality standard for interval diagrams'],
    }]);
  }
  const result = renderInterval(diagram);
  for (const warning of result.warnings) console.warn(`interval warning: ${warning}`);
  writeDiagram({
    outPath,
    template,
    diagramType: 'interval',
    meta: diagram.meta,
    svg: svgForViewer(result.svg, diagram.meta),
    intervalData: { spec: diagram, warnings: result.warnings },
  });
}
