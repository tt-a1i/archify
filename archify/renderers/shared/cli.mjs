import { softwareNoticesHtml } from './software-notices.mjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyTemplate, renderCards, esc } from './utils.mjs';
import { createReaderUpdateDisclosure } from './reader-disclosure.mjs';
import { validateSchema } from './validator.mjs';
import { verifyRepositoryEvidence } from './repository-evidence.mjs';
import { installRendererDiagnosticBoundary, throwDiagnosticError, throwDiagnosticProblems, recordDiagnostic } from './diagnostics.mjs';
import { validateEngineeringProfile } from './engineering-profiles.mjs';
import {
  resolveOutputPath,
  validateAuthoredOutputPath,
} from './output-path.mjs';
import {
  captureAtomicOutput,
  captureRegularFileBinding,
  publishRegularFileBinding,
  releaseRegularFileBinding,
  removeOwnedRegularFile,
  verifyAtomicOutput,
} from './atomic-output.mjs';
import { resolveLocale, translateMessage, registerLocale, localeDiagnostics } from './i18n.mjs';
import { prepareDiagramBrandMarks } from './brand-marks.mjs';

const outputPathGuards = new Map();
let renderCandidateSequence = 0;

// meta.locale is renderer-owned Viewer UI, not authored content. Each message
// resolves as: valid meta.translations value → bundled catalog enrolled in
// locales/manifest.json → English (see i18n.mjs). Every fallback is disclosed
// by human renderers on stderr. Diagnostic JSON mode records warnings without
// mixing text into failure receipts; validate/deliver disclose them publicly.
function applyLocaleTranslations(diagramType, diagram) {
  const locale = diagram.meta?.locale;
  if (!locale) return;
  registerLocale(locale, diagram.meta.translations);
  for (const diagnostic of localeDiagnostics(diagramType, diagram.meta)) {
    recordDiagnostic(diagnostic);
    if (process.env.ARCHIFY_DIAGNOSTIC_FORMAT !== 'json') {
      console.warn(`archify: ${diagnostic.message}`);
    }
  }
}

// Common CLI head: node render-<type>.mjs [input.json] [output.html]
// Keep this synchronous because callers also use it to establish the guarded
// output path before testing a last-moment filesystem alias change.
export function loadDiagram({ rendererDir, diagramType, defaultExample, argv = process.argv }) {
  // Compilers also import this module for SVG helpers. Only CLI execution
  // should install a process-level handler, before reading or validating input.
  installRendererDiagnosticBoundary();
  const skillRoot = path.resolve(rendererDir, '../..');
  const inputPath = path.resolve(argv[2] || path.join(skillRoot, 'examples', defaultExample));
  let input;
  try {
    input = fs.readFileSync(inputPath, 'utf8');
  } catch (error) {
    if (!isFilesystemError(error)) throw error;
    const message = `Input could not be read: ${error.message}`;
    throwDiagnosticError(message, [{
      code: 'input/read', message,
      subject: { input: inputPath },
      evidence: { systemCode: error.code, reason: error.message },
      supportedFixes: ['provide one readable JSON input file'],
    }]);
  }
  let diagram;
  try {
    diagram = JSON.parse(input);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const message = `Input JSON could not be parsed: ${error.message}`;
    throwDiagnosticError(message, [{
      code: 'input/json-parse', message,
      subject: { input: inputPath },
      evidence: { reason: error.message },
      supportedFixes: ['repair the JSON syntax and run validation again'],
    }]);
  }
  const authoredOutput = diagram?.meta?.output;
  if (authoredOutput !== undefined) validateAuthoredOutputPath(authoredOutput);
  validateSchema(diagramType, diagram);
  applyLocaleTranslations(diagramType, diagram);
  validateCrossCollectionContracts(diagramType, diagram);
  validateEngineeringProfile(diagramType, diagram);
  const sourceEvidence = verifyRepositoryEvidence(diagramType, diagram, process.env.ARCHIFY_REPO_ROOT);
  const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8').replace('</head>', `${softwareNoticesHtml}\n</head>`);
  const outputRequest = {
    requestedOutput: argv[3],
    authoredOutput: diagram.meta?.output,
    defaultOutput: `${diagramType}.html`,
    inputPaths: [inputPath],
    cwd: process.cwd(),
  };
  let outPath;
  try {
    ({ outputPath: outPath } = resolveOutputPath(outputRequest));
  } catch (error) {
    throwOutputError(error, path.resolve(outputRequest.requestedOutput || outputRequest.authoredOutput || outputRequest.defaultOutput));
  }
  outputPathGuards.set(outPath, outputRequest);
  return { diagram, template, outPath, sourceEvidence };
}

// Brand URL capture is the only asynchronous authoring step. Typed renderers
// opt into it through this wrapper without changing loadDiagram's long-lived
// synchronous safety contract.
export async function loadDiagramWithBrandMarks(options) {
  const loaded = loadDiagram(options);
  await prepareDiagramBrandMarks(options.diagramType, loaded.diagram);
  return loaded;
}

const START_TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'tree', 'class', 'timeline', 'waterfall']);

function isFilesystemError(error) {
  return typeof error?.code === 'string'
    && typeof error?.syscall === 'string'
    && typeof error?.errno === 'number';
}

function throwOutputError(error, output) {
  if (error?.archifyDiagnostics || !isFilesystemError(error)) throw error;
  const message = `Output could not be written: ${error.message}`;
  throwDiagnosticError(message, [{
    code: 'output/write', message,
    subject: { output },
    evidence: { systemCode: error.code, reason: error.message },
    supportedFixes: ['choose a writable HTML file path and ensure its parent directories can be created'],
  }]);
}

function throwAtomicOutputFailure(result, output) {
  const reason = result.reason || { code: 'unclassified' };
  const changed = result.status === 'different';
  const candidate = reason.code.startsWith('candidate-');
  const nonRegular = ['target-not-regular-file', 'candidate-not-regular-file'].includes(reason.code);
  const hardlinked = ['target-hardlinked', 'candidate-hardlinked'].includes(reason.code);
  const message = changed
    ? 'Output target changed while the rendered artifact was being prepared.'
    : nonRegular
      ? candidate
        ? 'Temporary output candidate is no longer a regular file.'
        : 'Output already exists and is not a regular file.'
      : hardlinked
        ? candidate
          ? 'Temporary output candidate has multiple hard-link names.'
          : 'Output already exists through multiple hard-link names.'
        : 'Output target stability could not be determined safely before commit.';
  throwDiagnosticError(message, [{
    code: changed
      ? 'output/target-changed'
      : nonRegular
        ? 'output/target-not-regular-file'
        : hardlinked
          ? 'output/target-hardlinked'
          : 'output/target-indeterminate',
    message,
    subject: { output },
    evidence: { relation: reason },
    supportedFixes: [hardlinked
      ? 'choose a non-hardlinked output path; atomic replacement cannot update every hard-link name'
      : 'retry after other processes stop replacing or redirecting the output path'],
  }]);
}

function stageRenderedHtml(outputPath, html, mode) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    renderCandidateSequence += 1;
    const candidatePath = path.join(
      path.dirname(outputPath),
      `.archify-render-${process.pid}-${Date.now().toString(36)}-${renderCandidateSequence}.tmp`,
    );
    let descriptor;
    let identity;
    try {
      const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
      descriptor = fs.openSync(
        candidatePath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
        mode ?? 0o666,
      );
      let metadata;
      try {
        metadata = fs.fstatSync(descriptor, { bigint: true });
      } catch (error) {
        // A transient first inspection failure must not strand the exclusive
        // candidate. A successful retry binds cleanup to the still-open file;
        // if both inspections fail, preserving the unknown entry is safer.
        try {
          const retry = fs.fstatSync(descriptor, { bigint: true });
          if (retry.isFile() && retry.ino !== 0n) {
            identity = { device: retry.dev, inode: retry.ino };
          }
        } catch {}
        throw error;
      }
      if (!metadata.isFile() || metadata.ino === 0n) {
        throw new Error('Temporary render candidate identity could not be verified safely.');
      }
      identity = { device: metadata.dev, inode: metadata.ino };
      fs.writeFileSync(descriptor, html);
      // Creation modes are filtered through the process umask. An atomic
      // replacement must retain the exact permissions of an existing target,
      // while a brand-new target should keep normal umask behavior.
      if (mode !== null) fs.fchmodSync(descriptor, mode);
      fs.closeSync(descriptor);
      descriptor = undefined;
      return { candidatePath, identity };
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
      if (error.code === 'EEXIST') continue;
      if (identity) {
        const cleanup = removeOwnedRegularFile(candidatePath, identity);
        if (!['removed', 'absent', 'preserved'].includes(cleanup.status)) {
          const cleanupError = new Error(`${error.message}; temporary render candidate cleanup also failed.`);
          cleanupError.cause = error;
          throw cleanupError;
        }
      }
      throw error;
    }
  }
  const error = new Error(`Could not reserve a temporary render candidate beside "${outputPath}".`);
  error.code = 'EEXIST';
  error.errno = -17;
  error.syscall = 'open';
  throw error;
}

// Common CLI tail: fill the template and write the standalone HTML file.
export function writeDiagram({ outPath, template, diagramType, meta, svg, cards, sourceEvidence = null, diagram = null }) {
  if (!START_TYPES.has(diagramType)) throw new Error(`writeDiagram: unknown diagram type ${JSON.stringify(diagramType)}`);
  const outputGuard = outputPathGuards.get(outPath);
  const html = applyTemplate(template, {
    title: meta.title,
    subtitle: meta.subtitle,
    svg,
    cards: renderCards(cards),
    locale: meta.locale,
    visualPreset: meta.visual_preset || 'classic',
    sourceEvidence,
    explanations: diagram ? collectExplanations(diagramType, diagram) : null,
    readerUpdate: createReaderUpdateDisclosure({
      artifactType: diagramType,
      content: JSON.stringify({
        diagramType,
        title: meta.title,
        subtitle: meta.subtitle || '',
        svg: svg.replace(/<g aria-hidden="true" data-semantic-sigil="[^"]+"[^>]*>[\s\S]*?<\/g>/g, ''),
        cards,
      }),
    }),
  });
  let candidatePath;
  let candidateIdentity;
  let candidateBinding;
  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const outputCapture = captureAtomicOutput(outPath);
    if (outputCapture.status !== 'captured') throwAtomicOutputFailure(outputCapture, outPath);
    const beforeStage = verifyAtomicOutput(outputCapture.snapshot);
    if (beforeStage.status !== 'match') throwAtomicOutputFailure(beforeStage, outPath);
    ({ candidatePath, identity: candidateIdentity } = stageRenderedHtml(
      outputCapture.commitPath,
      html,
      outputCapture.mode,
    ));

    // The renderer may spend substantial time building HTML after loadDiagram
    // establishes the guard. Re-run it after staging so a last-moment alias
    // cannot redirect the commit onto an input file.
    if (outputGuard) resolveOutputPath(outputGuard);
    const candidateCapture = captureRegularFileBinding(candidatePath, {
      subject: 'candidate',
      expectedSha256: createHash('sha256').update(html).digest('hex'),
      expectedBytes: Buffer.byteLength(html),
      expectedIdentity: candidateIdentity,
      ...(outputCapture.mode === null ? {} : { expectedMode: outputCapture.mode }),
    });
    if (candidateCapture.status !== 'captured') throwAtomicOutputFailure(candidateCapture, outPath);
    candidateBinding = candidateCapture.binding;
    const beforeCommit = verifyAtomicOutput(outputCapture.snapshot);
    if (beforeCommit.status !== 'match') throwAtomicOutputFailure(beforeCommit, outPath);
    const publication = publishRegularFileBinding(
      candidateBinding,
      candidatePath,
      outputCapture.snapshot,
      { subject: 'candidate' },
    );
    if (!['committed', 'committed-with-warning'].includes(publication.status)) {
      throwAtomicOutputFailure(publication, outPath);
    }
    const releasedCandidate = releaseRegularFileBinding(candidateBinding);
    candidateBinding = undefined;
    if (releasedCandidate.status !== 'released') throwAtomicOutputFailure(releasedCandidate, outPath);
    candidatePath = undefined;
    candidateIdentity = undefined;
  } catch (error) {
    throwOutputError(error, outPath);
  } finally {
    outputPathGuards.delete(outPath);
    if (candidateBinding) releaseRegularFileBinding(candidateBinding);
    if (candidatePath && candidateIdentity) {
      const cleanup = removeOwnedRegularFile(candidatePath, candidateIdentity);
      if (!['removed', 'absent', 'preserved'].includes(cleanup.status)) {
        throwAtomicOutputFailure(cleanup, outPath);
      }
    }
  }
  console.log(outPath);
}

const SEMANTIC_COLLECTIONS = {
  architecture: 'components',
  workflow: 'nodes',
  sequence: 'participants',
  dataflow: 'nodes',
  lifecycle: 'states',
  erd: 'entities',
  tree: 'nodes',
  class: 'types',
  timeline: 'events',
  waterfall: 'spans',
};

// Authored `explanation` prose is passport-only reader context. It never
// enters the SVG, so it is collected here by stable node id and handed to the
// template as one JSON block; documents without explanations emit nothing.
export function collectExplanations(diagramType, diagram) {
  const collection = SEMANTIC_COLLECTIONS[diagramType];
  const nodes = collection && Array.isArray(diagram?.[collection]) ? diagram[collection] : [];
  const explanations = {};
  nodes.forEach((node) => {
    if (typeof node?.explanation !== 'string' || node.explanation.trim() === '') return;
    explanations[node.id] = node.explanation.trim();
  });
  return Object.keys(explanations).length ? explanations : null;
}

const RELATIONSHIP_COLLECTIONS = {
  architecture: 'connections',
  workflow: 'edges',
  sequence: 'messages',
  dataflow: 'flows',
  lifecycle: 'transitions',
  erd: 'relationships',
  class: 'relationships',
};

// Relationship IDs are optional for backwards compatibility, but once an
// author supplies one it becomes the durable identity used by viewer links.
// Keep uniqueness enforcement in the shared zero-install path so every typed
// renderer fails the same way even when development dependencies are absent.
export function validateRelationshipIds(diagramType, diagram) {
  const collection = RELATIONSHIP_COLLECTIONS[diagramType];
  const relationships = collection && Array.isArray(diagram[collection]) ? diagram[collection] : [];
  const seen = new Set();
  const problems = [];

  relationships.forEach((relationship, index) => {
    if (relationship.id === undefined || relationship.id === null || relationship.id === '') return;
    if (seen.has(relationship.id)) {
      problems.push(`/${collection}/${index}/id duplicates relationship id ${JSON.stringify(relationship.id)}`);
    }
    seen.add(relationship.id);
  });

  if (problems.length) {
    throwDiagnosticProblems('Relationship identity validation failed', problems, {
      code: 'relationship/duplicate-id',
      subject: { diagramType, collection },
    });
  }
}

// Share relationship-ID semantic checks between the loader
// and workflow compiler without performing filesystem operations (see #429).
export function validateCrossCollectionContracts(diagramType, diagram) {
  validateRelationshipIds(diagramType, diagram);
}

// Accessible name for the generated diagram SVG.
export function svgRootAttrs(meta, explicitQualityProfile) {
  // Motion is a Viewer capability for every diagram; Live/Still controls playback.
  const animation = ' data-animation="trace"';
  const preset = ` data-preset="${esc(meta.visual_preset || 'classic')}"`;
  const engineeringProfile = meta.engineering_profile
    ? ` data-engineering-profile="${esc(meta.engineering_profile)}"`
    : '';
  // 子图返回上一级：作者写在 meta.parentHref；Viewer 也会读 URL ?from= 作兜底
  // 再过一遍同目录规则，避免未走 schema 的调用把 ../ 或协议写进 SVG。
  const parentHrefRaw = meta.parentHref != null ? String(meta.parentHref).trim() : '';
  const parentHref = parentHrefRaw && isSiblingHtmlHref(parentHrefRaw)
    ? ` data-parent-href="${esc(parentHrefRaw)}"`
    : '';
  const requestedProfile = explicitQualityProfile || process.env.ARCHIFY_QUALITY_PROFILE || meta.quality_profile;
  const qualityProfile = requestedProfile === 'showcase' ? 'showcase' : 'standard';
  const advisory = requestedProfile ? '' : ' data-quality-gates="advisory"';
  return `role="img" lang="${esc(resolveLocale(meta.locale))}" aria-labelledby="archify-diagram-title archify-diagram-description"${animation}${preset}${engineeringProfile}${parentHref} data-quality-profile="${esc(qualityProfile)}"${advisory}`;
}

// Keep the accessible name inside the SVG so it survives standalone SVG
// export and embedding. The fixed IDs are deterministic because an Archify
// artifact intentionally contains one primary diagram SVG.
export function svgAccessibleText(meta, kind) {
  const description = meta.subtitle || translateMessage(meta.locale, `diagram.description.${kind}`);
  return `        <title id="archify-diagram-title">${esc(meta.title)}</title>\n        <desc id="archify-diagram-description">${esc(description)}</desc>`;
}

export function animateAttr(meta, kind, step) {
  // Ambient trace must finish inside the fixed six-second WebM capture. The
  // cap affects visual delay only; authored order and semantic identity stay
  // untouched in the JSON, DOM, and relationship contracts.
  const safeStep = Number.isFinite(step) && step >= 0 ? Math.min(12, Math.floor(step)) : 0;
  return ` data-animate="${kind}" style="--step:${safeStep}"`;
}

// Stable semantic hooks for the standalone HTML explorer. IDs already pass
// the schema's conservative identifier pattern; escape again at the markup
// boundary so these helpers remain safe if that contract expands later.

/**
 * 同目录 HTML 目标：文件名.html，可选 ?query / #fragment。
 * 拒绝协议、`//`、`/` 路径段和 `..`，避免跳出产物目录。
 */
export function isSiblingHtmlHref(value) {
  if (typeof value !== 'string') return false;
  const href = value.trim();
  if (!href || href.length > 512) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.html(?:\?[A-Za-z0-9._~/=&%+!?$-]*)?(?:#[A-Za-z0-9._~/=&%+!?$-]*)?$/.test(href);
}

/**
 * 规范化节点上的 drilldowns 数组，供 SVG data-node-drilldowns 与 Passport 共用。
 * 只保留同目录 .html 目标；顺序即 Passport 展示顺序，首项为 Ctrl/双击默认跳转。
 */
export function normalizeDrilldowns(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const href = entry.href != null ? String(entry.href).trim() : '';
      const label = entry.label != null ? String(entry.label).trim() : '';
      if (!href || !label || !isSiblingHtmlHref(href)) return null;
      const out = { href, label };
      if (entry.diagram_type != null && String(entry.diagram_type).trim() !== '') {
        out.diagram_type = String(entry.diagram_type).trim();
      }
      return out;
    })
    .filter(Boolean);
}

/**
 * 解析节点最终子图列表：`drilldowns` 优先；否则把节点 `href` 收成一项，label 默认用节点名。
 * 两边都写时必须忽略 href，避免作者以为简写会覆盖数组。
 */
export function resolveNodeDrilldowns(node = {}) {
  const fromArray = normalizeDrilldowns(node.drilldowns);
  if (fromArray.length) return fromArray;
  const href = node.href != null ? String(node.href).trim() : '';
  if (!isSiblingHtmlHref(href)) return [];
  const label = node.label != null && String(node.label).trim() !== ''
    ? String(node.label).trim()
    : href.replace(/\.html(?:[?#].*)?$/i, '');
  return [{ href, label }];
}

/**
 * 单目标节点包一层原生 SVG `<a>`，导出/无 Viewer JS 时单击仍能跳。
 * 多目标不包，避免浏览器把整节点当成唯一链接。
 */
export function wrapSingleChildAnchor(markup, targets) {
  if (!Array.isArray(targets) || targets.length !== 1) return markup;
  const target = targets[0];
  return `<a class="archify-drilldown-link" data-archify-drilldown="1" href="${esc(target.href)}" aria-label="${esc(target.label)}">\n        ${markup}\n        </a>`;
}

/**
 * 节点角标：提示「可下钻」。放在盒内右下，避开左上 sigil / 右上 brand。
 * 必须画进 SVG，canonical 导出后标记仍在。
 */
export function renderDrilldownMark(box) {
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) {
    return '';
  }
  const mx = box.x + box.width - 11;
  const my = box.y + box.height - 11;
  return `<g class="archify-drilldown-mark" data-detail="fine" transform="translate(${mx} ${my})" aria-hidden="true">
          <circle r="6" class="archify-drilldown-mark-disc"/>
          <path d="M-1.8 -1.6 L2.4 0 L-1.8 1.6" fill="none" class="archify-drilldown-mark-arrow"/>
        </g>`;
}

export function focusNodeAttrs(id, label, metadata = {}, locale) {
  const optional = [
    ['data-node-kind', metadata.kind],
    ['data-node-sublabel', metadata.sublabel],
    ['data-node-tag', metadata.tag],
    ['data-node-context', metadata.context],
    ['data-node-brand', metadata.brand],
    ['data-node-brand-id', metadata.brandId],
    ['data-node-brand-status', metadata.brandStatus],
    ['data-node-brand-source', metadata.brandSource],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([name, value]) => ` ${name}="${esc(String(value))}"`)
    .join('');
  // 多目标下钻：JSON 写入属性；Viewer 在 Passport 列链接，Ctrl/双击走首项。
  // 单目标时同时包 <a>，所以这里仍写出数组，Alt-click / Passport 才能读到同一份契约。
  const drilldowns = resolveNodeDrilldowns({
    drilldowns: metadata.drilldowns,
    href: metadata.href,
    label,
  });
  const drilldownAttr = drilldowns.length
    ? ` data-node-drilldowns="${esc(JSON.stringify(drilldowns))}"`
    : '';
  const detail = [metadata.sublabel, metadata.context, metadata.brand]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .join(', ');
  const aria = detail
    ? translateMessage(locale, 'node.focus.detail', { label, detail })
    : translateMessage(locale, 'node.focus', { label });
  return `id="node-${esc(id)}" data-node-id="${esc(id)}" data-node-label="${esc(label)}" tabindex="0" role="button" aria-label="${esc(aria)}" aria-pressed="false"${optional}${drilldownAttr}`;
}

// Native SVG titles preserve a compact details-on-demand fallback when the
// canonical SVG is embedded inline outside the full Archify viewer.
export function focusNodeTitle(label, metadata = {}) {
  const parts = [label, metadata.sublabel, metadata.context, metadata.tag, metadata.brand]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return `<title>${esc(parts.join(' · '))}</title>`;
}

export function focusEdgeAttrs(from, to, label, key, id) {
  const named = label ? ` data-edge-label="${esc(label)}"` : '';
  const keyed = key !== undefined && key !== null ? ` data-edge-key="${esc(String(key))}"` : '';
  const identified = id !== undefined && id !== null && String(id).trim() !== ''
    ? ` data-edge-id="${esc(String(id))}"`
    : '';
  return `data-edge-from="${esc(from)}" data-edge-to="${esc(to)}"${named}${keyed}${identified}`;
}
