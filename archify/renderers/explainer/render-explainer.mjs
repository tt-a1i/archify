import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { installRendererDiagnosticBoundary, throwDiagnosticError } from '../shared/diagnostics.mjs';
import { resolveOutputPath } from '../shared/output-path.mjs';
import { captureAtomicOutput, captureRegularFileBinding, publishRegularFileBinding, releaseRegularFileBinding, removeOwnedRegularFile } from '../shared/atomic-output.mjs';
import { prepareExplainer, readPreparedBundle, assertPreparedDependencies } from '../../explainer/prepare.mjs';
import { renderExplainer } from '../../explainer/render.mjs';
installRendererDiagnosticBoundary();
const inputPath = path.resolve(process.argv[2]);
const sourceText = fs.readFileSync(inputPath, 'utf8');
const bundle = process.env.ARCHIFY_EXPLAINER_PREPARED
  ? readPreparedBundle(process.env.ARCHIFY_EXPLAINER_PREPARED, sourceText, inputPath, { expectedInputPath: process.env.ARCHIFY_EXPLAINER_SNAPSHOT_INPUT || inputPath })
  : await prepareExplainer(sourceText, { inputPath, repoRoot: process.env.ARCHIFY_REPO_ROOT, quality: process.env.ARCHIFY_QUALITY_PROFILE });
const request = { requestedOutput: process.argv[3], authoredOutput: bundle.document.meta.output, defaultOutput: 'explainer.html', inputPaths: [inputPath, bundle.sourcePath] };
const { outputPath } = resolveOutputPath(request);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const capture = captureAtomicOutput(outputPath, { requestedEntryPolicy: 'regular-or-absent' });
if (capture.status !== 'captured') throwDiagnosticError('Could not capture explainer output safely.', [{code:'output/target-indeterminate',message:'Could not capture explainer output safely.',subject:{output:outputPath},evidence:{reason:capture.reason},supportedFixes:[]}]);
let html;
try { html = renderExplainer(bundle.document, { ...bundle, preparedBundle: bundle, pageDirectory: process.env.ARCHIFY_EXPLAINER_PAGE_DIR || path.dirname(outputPath) }); }
catch (error) { if (error.diagnostics) error.archifyDiagnostics = error.diagnostics; throw error; }
const bytes = Buffer.from(html);
const candidate = path.join(path.dirname(capture.commitPath), `.archify-explainer-${randomUUID()}.html`);
let binding;
let owned;
try {
  fs.writeFileSync(candidate, bytes, { flag: 'wx', ...(capture.mode === null ? {} : {mode:capture.mode}) });
  const stat = fs.lstatSync(candidate, {bigint:true});
  owned = {device:stat.dev,inode:stat.ino};
  if (capture.mode !== null) fs.chmodSync(candidate,capture.mode);
  const staged = captureRegularFileBinding(candidate,{expectedIdentity:owned,expectedSha256:createHash('sha256').update(bytes).digest('hex'),expectedBytes:bytes.length});
  if (staged.status !== 'captured') throw new Error('Could not bind explainer candidate.');
  binding = staged.binding;
  assertPreparedDependencies(bundle);
  resolveOutputPath(request);
  const result = publishRegularFileBinding(binding,candidate,capture.snapshot,{subject:'explainer-output'});
  if (!['committed','committed-with-warning'].includes(result.status)) throw new Error(`Could not publish explainer output (${result.reason?.code || result.status}).`);
} finally {
  if(binding) releaseRegularFileBinding(binding);
  if(owned) removeOwnedRegularFile(candidate,owned,{subject:'explainer-output'});
}
