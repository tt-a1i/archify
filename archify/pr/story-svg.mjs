import fs from 'node:fs';
import path from 'node:path';
import { runGit } from '../renderers/shared/repository-evidence.mjs';
import { layoutReportFromSvg } from '../renderers/shared/layout-report.mjs';
import { softwareNotices } from '../renderers/shared/software-notices.mjs';
import { assertCamoSafeSvg, loadViewerStyles, parseStylesheet, resolveThemeVariables } from '../renderers/shared/svg-bake.mjs';
import { failPrPack } from './errors.mjs';
import { assertNoRiskVerdict } from './markdown.mjs';

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 560;
const CAPTION_BAND_BOTTOM = 104;
const VIEWPORT = { x: 18, y: 112, width: 924, height: 432 };
const PLOT = { x: 38, y: 124, w: 884, h: 400 };
const LEFT_PLOT = { x: 40, y: 152, w: 422, h: 332 };
const CENTER_FOCUS = { x: 200, y: 150, w: 560, h: 360 };
const CODE_X = 530;
const CODE_Y = 144;
const CODE_DIVIDER_X = 506;
const CODE_WIDTH = 396;
const CODE_FONT_FAMILY = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono CJK SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace";
const STORY_FONT_FALLBACK = `'JetBrains Mono', system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`;

// Primer Octicons git-pull-request-16 (MIT)
const PR_ICON_PATH = 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z';
const OCTICON_NOTICE = '\n\nPrimer Octicons git-pull-request-16 icon (MIT License, GitHub, Inc.).';

const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeCssAttr = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function textUnits(text) {
  return [...String(text ?? '')].reduce((sum, ch) => sum + (/[\u2E80-\uFFFF]/.test(ch) ? 1 : 0.58), 0);
}

function fitFontSize(text, maxWidth, preferred, minimum) {
  const units = Math.max(1, textUnits(text));
  const raw = maxWidth / units;
  return Math.max(minimum, Math.min(preferred, Math.floor(raw * 10) / 10));
}

function parseAttributes(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g)) attrs[match[1]] = match[2];
  return attrs;
}

function findBalancedTag(source, attrName, attrValue, tag = 'g') {
  const start = new RegExp(`<${tag}\\b[^>]*\\b${escapeRegex(attrName)}="${escapeRegex(attrValue)}"[^>]*>`).exec(source);
  if (!start) return null;
  if (start[0].endsWith('/>')) return { start: start.index, end: start.index + start[0].length, svg: start[0] };
  const tokens = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  tokens.lastIndex = start.index;
  let depth = 0;
  for (let match = tokens.exec(source); match; match = tokens.exec(source)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) {
      const end = match.index + match[0].length;
      return { start: start.index, end, svg: source.slice(start.index, end) };
    }
  }
  return null;
}

function injectIntoNodeGroup(source, nodeId, markup) {
  const group = findBalancedTag(source, 'data-node-id', nodeId);
  if (!group) return null;
  return source.slice(0, group.end - 4) + markup + source.slice(group.end - 4);
}

function boundsOf(boxes) {
  if (!boxes.length) return { x: 0, y: 0, width: 100, height: 100 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: Math.max(1, maxX - x), height: Math.max(1, maxY - y) };
}

function fitCamera(box, area, maxScale = 2) {
  const scale = Math.min(maxScale, area.w / (box.width + 28), area.h / (box.height + 28));
  return {
    scale,
    x: area.x + area.w / 2 - (box.x + box.width / 2) * scale,
    y: area.y + area.h / 2 - (box.y + box.height / 2) * scale,
  };
}

const formatTransform = (camera) => `translate(${camera.x.toFixed(3)}px,${camera.y.toFixed(3)}px) scale(${camera.scale.toFixed(5)})`;

// Validates source path and reads lines at pinned Git revision (or manifest dir when local).
function loadDetailSourceLines(detail, { revisions, manifestDir, requireSource = false } = {}) {
  const filePath = detail?.path;
  const parts = typeof filePath === 'string' ? filePath.split('/') : [];
  if (
    typeof filePath !== 'string'
    || !filePath.trim()
    || path.isAbsolute(filePath)
    || filePath.includes('\\')
    || parts.some((segment) => segment === '' || segment === '.' || segment === '..')
    || /[\0\r\n:]/.test(filePath)
  ) {
    failPrPack('pr-story/invalid-source-path', 'manifest', `Invalid story.detail path "${filePath}".`, {
      subject: { path: '/story/detail/path' },
      supportedFixes: ['use a clean POSIX repository-relative path without "." or ".."'],
    });
  }

  let content = null;
  if (revisions?.repoRoot) {
    const sha = detail.revision === 'base' ? revisions.baseSha : revisions.headSha;
    if (!sha) {
      failPrPack('pr-story/source-not-found', 'views', `Cannot read ${filePath} at ${detail.revision || 'head'}: missing commit SHA.`, {
        subject: { path: filePath, revision: detail.revision || 'head' },
        supportedFixes: ['declare baseSha/headSha or baseRef/headRef in the manifest'],
      });
    }
    const result = runGit(revisions.repoRoot, ['show', '--no-textconv', `${sha}:${filePath}`]);
    if (result.status !== 0) {
      failPrPack('pr-story/source-not-found', 'views', `Could not read ${filePath} at ${sha.slice(0, 7)}: ${(result.stderr || '').trim() || 'missing file'}.`, {
        subject: { path: filePath, revision: sha },
        supportedFixes: ['cite an existing file path at that revision'],
      });
    }
    content = result.stdout;
  } else if (manifestDir) {
    const candidate = path.resolve(manifestDir, filePath);
    const rel = path.relative(manifestDir, candidate);
    if (!rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      content = fs.readFileSync(candidate, 'utf8');
    }
  }

  if (content === null) {
    if (requireSource) {
      failPrPack('pr-story/source-repo-required', 'revisions', `story.detail cites "${filePath}", which requires --repo-root <path> to read source lines cleanly.`, {
        subject: { path: filePath },
        supportedFixes: ['pass --repo-root with the matching Git checkout'],
      });
    }
    return null;
  }

  if (content.includes('\0')) {
    failPrPack('pr-story/source-not-found', 'views', `story.detail target "${filePath}" is a binary file.`, {
      subject: { path: filePath },
      supportedFixes: ['cite a text source file'],
    });
  }
  return content.split(/\r?\n/);
}

function checkNoRiskVerdict(text, field) {
  if (!text) return;
  try {
    assertNoRiskVerdict(text, field);
  } catch (error) {
    if (error.code === 'pr-pack/risk-verdict') {
      failPrPack('pr-pack/risk-verdict', 'manifest', error.message, {
        subject: { field },
        evidence: { verdict: error.verdict },
        supportedFixes: ['replace the verdict with objective counts or evidence'],
      });
    }
    throw error;
  }
}

function checkTimestamp(value, duration, label) {
  if (!Number.isFinite(value) || value < 0 || value > duration) {
    failPrPack('pr-story/invalid-timing', 'manifest', `story ${label} (${value}) must be between 0 and duration (${duration}).`, {
      subject: { path: `/story/${label}` },
      evidence: { value, duration },
      supportedFixes: [`set ${label} within 0..${duration}`],
    });
  }
}

export function validatePrStory(story, pack, { revisions, manifestDir, requireDetailSource = false } = {}) {
  if (!story) return null;

  checkNoRiskVerdict(story.title, 'story/title');
  checkNoRiskVerdict(story.caption, 'story/caption');
  for (const [index, step] of story.steps.entries()) {
    checkNoRiskVerdict(step.title, `story/steps/${index}/title`);
    checkNoRiskVerdict(step.body, `story/steps/${index}/body`);
  }
  if (story.detail) {
    checkNoRiskVerdict(story.detail.title, 'story/detail/title');
    checkNoRiskVerdict(story.detail.note, 'story/detail/note');
  }

  const declaredViews = new Set((pack.views || []).map((v) => v.id));
  const ensureDeclared = (viewId, field) => {
    if (!declaredViews.has(viewId)) {
      failPrPack('pr-story/unknown-view', 'manifest', `story ${field} references unknown view "${viewId}".`, {
        subject: { view: viewId, field },
        supportedFixes: ['declare the view id under manifest.views or update the reference'],
      });
    }
  };

  for (const [i, stage] of story.stages.entries()) ensureDeclared(stage.view, `stages/${i}/view`);
  const stageViews = new Set(story.stages.map((s) => s.view));
  const ensureStaged = (viewId, field) => {
    ensureDeclared(viewId, field);
    if (!stageViews.has(viewId)) {
      failPrPack('pr-story/unknown-view', 'manifest', `story ${field} references view "${viewId}", which is not listed in story.stages.`, {
        subject: { view: viewId, field },
        supportedFixes: [`add { "view": "${viewId}" } to story.stages`],
      });
    }
  };

  if (story.pair) {
    ensureStaged(story.pair.before, 'pair/before');
    ensureStaged(story.pair.after, 'pair/after');
    if (story.pair.before === story.pair.after) {
      failPrPack('pr-story/invalid-timing', 'manifest', 'story.pair.before and story.pair.after must name different views.', {
        subject: { view: story.pair.before },
        supportedFixes: ['assign separate before and after views'],
      });
    }
  }
  for (const [i, op] of (story.relabel || []).entries()) ensureStaged(op.view, `relabel/${i}/view`);
  for (const [i, op] of (story.enter || []).entries()) ensureStaged(op.view, `enter/${i}/view`);
  for (const [i, op] of (story.connect || []).entries()) ensureStaged(op.view, `connect/${i}/view`);
  for (const [i, op] of (story.fade || []).entries()) ensureStaged(op.view, `fade/${i}/view`);
  for (const [i, op] of (story.focus || []).entries()) ensureStaged(op.view, `focus/${i}/view`);
  for (const [i, op] of (story.traces || []).entries()) ensureStaged(op.view, `traces/${i}/view`);
  for (const [i, op] of (story.metrics || []).entries()) ensureStaged(op.view, `metrics/${i}/view`);
  if (story.detail) ensureStaged(story.detail.view, 'detail/view');

  const duration = story.duration;
  let prevAt = -1;
  for (const [i, step] of story.steps.entries()) {
    checkTimestamp(step.at, duration, `steps/${i}/at`);
    if (step.at >= duration) {
      failPrPack('pr-story/invalid-timing', 'manifest', `story step ${i} at=${step.at} must be strictly less than duration ${duration}.`, {
        subject: { path: `/story/steps/${i}/at` },
        supportedFixes: ['place every step start before story.duration'],
      });
    }
    if (step.at <= prevAt) {
      failPrPack('pr-story/invalid-timing', 'manifest', `story.steps timestamps must increase strictly (step ${i} at=${step.at} <= ${prevAt}).`, {
        subject: { path: `/story/steps/${i}/at` },
        supportedFixes: ['sort steps in strictly ascending order of at'],
      });
    }
    prevAt = step.at;
  }

  for (const [i, stage] of story.stages.entries()) {
    const start = stage.start ?? 0;
    const end = stage.end ?? duration;
    checkTimestamp(start, duration, `stages/${i}/start`);
    checkTimestamp(end, duration, `stages/${i}/end`);
    if (start >= end) {
      failPrPack('pr-story/invalid-timing', 'manifest', `story stage "${stage.view}" start (${start}) must be less than end (${end}).`, {
        subject: { path: `/story/stages/${i}` },
        supportedFixes: ['set stage.start strictly earlier than stage.end'],
      });
    }
  }

  if (story.pair) {
    checkTimestamp(story.pair.at, duration, 'pair/at');
    const until = story.pair.until ?? duration;
    checkTimestamp(until, duration, 'pair/until');
    if (story.pair.at >= until) {
      failPrPack('pr-story/invalid-timing', 'manifest', `story.pair.at (${story.pair.at}) must be less than until (${until}).`, {
        subject: { path: '/story/pair' },
        supportedFixes: ['set pair.at strictly earlier than pair.until'],
      });
    }
  }

  for (const [i, op] of (story.relabel || []).entries()) checkTimestamp(op.at, duration, `relabel/${i}/at`);
  for (const [i, op] of (story.enter || []).entries()) checkTimestamp(op.at, duration, `enter/${i}/at`);
  for (const [i, op] of (story.connect || []).entries()) checkTimestamp(op.at, duration, `connect/${i}/at`);
  for (const [i, op] of (story.fade || []).entries()) checkTimestamp(op.at, duration, `fade/${i}/at`);
  for (const [i, op] of (story.focus || []).entries()) checkTimestamp(op.at, duration, `focus/${i}/at`);
  for (const [i, op] of (story.metrics || []).entries()) checkTimestamp(op.at, duration, `metrics/${i}/at`);

  for (const [i, trace] of (story.traces || []).entries()) {
    if (trace.edges.length !== trace.times.length) {
      failPrPack('pr-story/trace-mismatch', 'manifest', `story trace ${i} has ${trace.edges.length} edge(s) but ${trace.times.length} timestamp(s).`, {
        subject: { path: `/story/traces/${i}` },
        supportedFixes: ['give every trace edge one matching timestamp in times[]'],
      });
    }
    for (const [ti, time] of trace.times.entries()) checkTimestamp(time, duration, `traces/${i}/times/${ti}`);
    if (trace.end !== undefined) {
      checkTimestamp(trace.end, duration, `traces/${i}/end`);
      if (trace.end <= Math.max(...trace.times)) {
        failPrPack('pr-story/invalid-timing', 'manifest', `story trace ${i} end (${trace.end}) must follow all hop timestamps.`, {
          subject: { path: `/story/traces/${i}/end` },
          supportedFixes: ['set trace.end after the last hop time'],
        });
      }
    }
  }

  let detailLines = null;
  if (story.detail) {
    checkTimestamp(story.detail.start, duration, 'detail/start');
    checkTimestamp(story.detail.end, duration, 'detail/end');
    if (story.detail.start >= story.detail.end) {
      failPrPack('pr-story/invalid-timing', 'manifest', `story.detail.start (${story.detail.start}) must be less than end (${story.detail.end}).`, {
        subject: { path: '/story/detail' },
        supportedFixes: ['set detail.start strictly before detail.end'],
      });
    }
    for (const [si, sel] of (story.detail.selections || []).entries()) {
      checkTimestamp(sel.at, duration, `detail/selections/${si}/at`);
    }
    detailLines = loadDetailSourceLines(story.detail, { revisions, manifestDir, requireSource: requireDetailSource });
    if (detailLines) {
      const checkLineRange = (line, where) => {
        if (!Number.isInteger(line) || line < 1 || line > detailLines.length) {
          failPrPack('pr-story/source-line-out-of-range', 'views', `story.detail ${where} line ${line} is outside "${story.detail.path}" (1..${detailLines.length}).`, {
            subject: { path: story.detail.path, line, maxLine: detailLines.length },
            supportedFixes: [`cite line numbers between 1 and ${detailLines.length}`],
          });
        }
      };
      for (const line of story.detail.lines) checkLineRange(line, 'lines');
      for (const line of story.detail.highlight || []) checkLineRange(line, 'highlight');
      for (const [si, sel] of (story.detail.selections || []).entries()) {
        for (const line of sel.lines) checkLineRange(line, `selections/${si}/lines`);
      }
    }
  }

  return { detailLines };
}

function storyPalette(theme, preset, styles) {
  const vars = resolveThemeVariables(styles.rules, { theme, preset });
  const bg = vars.get('--bg') || (theme === 'dark' ? '#0f172a' : '#ffffff');
  const text = vars.get('--text') || (theme === 'dark' ? '#eef2f8' : '#172033');
  const muted = vars.get('--text-muted') || (theme === 'dark' ? '#a6b4c8' : '#647184');
  const accent = vars.get('--backend-stroke') || (theme === 'dark' ? '#34d399' : '#159f88');
  const amber = vars.get('--cloud-stroke') || (theme === 'dark' ? '#f3b64f' : '#ac7007');
  const removed = vars.get('--security-stroke') || (theme === 'dark' ? '#f291a4' : '#c64458');
  const line = vars.get('--lane-stroke') || vars.get('--grid') || (theme === 'dark' ? '#293548' : '#e3e8ee');
  return { bg, text, muted, accent, amber, removed, line };
}

function computeNativeContentBounds(svg, layout) {
  const boxes = [];
  const changedNodes = new Set(
    [...svg.matchAll(/<g\b[^>]*\bdata-node-id="([^"]+)"[^>]*>/g)]
      .filter((m) => /\bdata-change="(?:added|modified|removed)"/.test(m[0]))
      .map((m) => m[1]),
  );
  for (const node of layout.nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    const badgeTop = changedNodes.has(node.id) ? 14 : 0;
    boxes.push({ x: node.x, y: node.y - badgeTop, width: node.width, height: node.height + badgeTop });
  }
  for (const edge of layout.edges) {
    for (const [px, py] of edge.points || []) {
      if (Number.isFinite(px) && Number.isFinite(py)) boxes.push({ x: px - 14, y: py - 14, width: 28, height: 28 });
    }
  }
  for (const match of svg.matchAll(/<rect\b([^>]*\bdata-composition-frame-kind="([^"]*)"[^>]*)>/g)) {
    const attrs = parseAttributes(match[1]);
    const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((k) => Number(attrs[k]));
    if ([x, y, width, height].every(Number.isFinite)) boxes.push({ x, y, width, height });
  }
  for (const match of svg.matchAll(/<g\b[^>]*\bdata-domain-band="[^"]*"[^>]*>[\s\S]*?<rect\b([^>]*)>/g)) {
    const attrs = parseAttributes(match[1]);
    const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((k) => Number(attrs[k]));
    if ([x, y, width, height].every(Number.isFinite)) boxes.push({ x, y: y - 10, width, height: height + 10 });
  }
  return boundsOf(boxes);
}

function expandLabeledNodeBadges(svg, layout, isZh) {
  const labels = isZh
    ? { added: '+ 新增', modified: '~ 修改', removed: '− 删除' }
    : { added: '+ Added', modified: '~ Modified', removed: '− Removed' };
  const pillW = isZh ? 54 : 62;
  let result = svg;
  for (const node of layout.nodes) {
    if (!node.width || node.width < 104) continue;
    const group = findBalancedTag(result, 'data-node-id', node.id);
    if (!group) continue;
    const head = group.svg.slice(0, group.svg.indexOf('>') + 1);
    const state = /\bdata-change="(added|modified|removed)"/.exec(head)?.[1];
    if (!state) continue;
    const badges = [...group.svg.matchAll(new RegExp(`<g\\b[^>]*data-change-badge="${state}"[^>]*>[\\s\\S]*?</g>`, 'g'))];
    const badge = badges.at(-1);
    if (!badge) continue;
    const rectMatch = /<rect\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"[^>]*\bwidth="([^"]+)"/.exec(badge[0]);
    if (!rectMatch) continue;
    const x = Number(rectMatch[1]) + Number(rectMatch[3]) - pillW;
    const y = Number(rectMatch[2]) - 2.5;
    const revised = `<g data-change-badge="${state}" data-story-node-badge="" pointer-events="none"><rect x="${x}" y="${y}" width="${pillW}" height="18" rx="6" class="c-mask"/><rect x="${x}" y="${y}" width="${pillW}" height="18" rx="6" class="c-change-badge-${state}" stroke-width="1"/><text x="${x + pillW / 2}" y="${y + 12.5}" class="t-change-badge-${state}" font-size="10.5" font-weight="600" text-anchor="middle">${labels[state]}</text></g>`;
    const updated = group.svg.slice(0, badge.index) + revised + group.svg.slice(badge.index + badge[0].length);
    result = result.slice(0, group.start) + updated + result.slice(group.end);
  }
  return result;
}

function namespaceSubSvgIds(svg, key) {
  const ids = new Set();
  for (const match of svg.matchAll(/\sid="([^"]+)"/g)) ids.add(match[1]);
  if (!ids.size) return svg;
  return svg
    .replace(/\sid="([^"]+)"/g, (m, id) => (ids.has(id) ? ` id="${key}-${id}"` : m))
    .replace(/#([A-Za-z0-9_.:-]+)/g, (m, ref) => (ids.has(ref) ? `#${key}-${ref}` : m));
}

function scopeEmbeddedStyles(svg, key) {
  return svg.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (_, css) => {
    const clean = css.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '');
    const scoped = parseStylesheet(clean).map((rule) => {
      const decls = rule.declarations.map((d) => `${d.property}:${d.value}${d.important ? '!important' : ''}`).join(';');
      if (!decls) return '';
      const body = `[data-native-key="${key}"] :is(${rule.selector}){${decls}}`;
      return rule.media ? `${rule.media}{${body}}` : body;
    }).filter(Boolean).join('');
    return scoped ? `<style><![CDATA[${scoped}]]></style>` : '';
  });
}

function annotateEdgePaths(svg) {
  const paths = new Map();
  let tagIndex = 0;
  let out = svg.replace(/<path\b[^>]*>/g, (tag) => {
    const attrs = parseAttributes(tag);
    if (!attrs.d) return tag;
    const from = attrs['data-edge-from'] ?? attrs['data-composition-edge-from'];
    const to = attrs['data-edge-to'] ?? attrs['data-composition-edge-to'];
    const explicitId = attrs['data-edge-id'] ?? attrs['data-composition-edge-id'];
    const edgeKey = attrs['data-edge-key'];
    if (!explicitId && from === undefined && to === undefined) return tag;
    const canonicalId = explicitId || `${from}~${to}`;
    const info = { id: canonicalId, d: attrs.d, marker: attrs['marker-end'] || null, from, to, key: edgeKey };
    if (!paths.has(canonicalId)) paths.set(canonicalId, info);
    if (edgeKey !== undefined && !paths.has(`edge:${edgeKey}`)) paths.set(`edge:${edgeKey}`, info);
    if (from !== undefined && to !== undefined && !paths.has(`${from}~${to}`)) paths.set(`${from}~${to}`, info);
    tagIndex += 1;
    if (/\bdata-story-edge-id=/.test(tag)) return tag;
    const storyAttr = ` data-story-edge-id="${escapeXml(canonicalId)}" data-story-path-idx="${tagIndex}"`;
    return tag.endsWith('/>') ? `${tag.slice(0, -2)}${storyAttr}/>` : `${tag.slice(0, -1)}${storyAttr}>`;
  });
  // Also tag crossover wrapper <g> if it holds a path with data-edge-id / from~to
  out = out.replace(/<g\b([^>]*data-graph-role="automatic-crossover"[^>]*)>([\s\S]*?)<\/g>/g, (all, attrs, body) => {
    const id = /data-story-edge-id="([^"]+)"/.exec(body)?.[1];
    return id ? `<g${attrs} data-story-edge-wrap="${escapeXml(id)}">${body}</g>` : all;
  });
  return { svg: out, paths };
}

function prepareSubSvg({ view, rawSvg, nodeBadges, isZh }) {
  const layout = layoutReportFromSvg(rawSvg, view.type);
  const viewBoxMatch = rawSvg.match(/\bviewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1].trim().split(/[\s,]+/).map(Number) : [0, 0, ...(layout.viewBox || [800, 400])];
  let svg = rawSvg
    .replace(/<\?xml[^>]*>\s*/g, '')
    .replace(/<metadata\b[^>]*id="archify-software-notices"[^>]*>[\s\S]*?<\/metadata>/g, '')
    .replace(/<rect\b[^>]*class="archify-bake-background"[^>]*\/>/g, '')
    .replace(/<rect\b[^>]*fill="url\(#grid\)"[^>]*\/>/g, '');
  if (nodeBadges !== 'compact' && !['erd', 'class'].includes(view.type)) {
    svg = expandLabeledNodeBadges(svg, layout, isZh);
  }
  const key = `native-${view.id}`;
  svg = namespaceSubSvgIds(svg, key);
  svg = scopeEmbeddedStyles(svg, key);
  const annotated = annotateEdgePaths(svg);
  svg = annotated.svg;
  const close = svg.indexOf('>');
  const openTag = svg.slice(0, close + 1)
    .replace(/\s(?:x|y|width|height)="[^"]*"/g, '')
    .replace(/>$/, ` x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" height="${viewBox[3]}">`);
  svg = openTag + svg.slice(close + 1);
  return {
    id: view.id,
    key,
    type: view.type,
    svg,
    nodes: layout.nodes,
    edges: layout.edges,
    paths: annotated.paths,
    viewBox,
    contentBox: computeNativeContentBounds(svg, layout),
    extraBoxes: [],
  };
}

class StoryTimeline {
  constructor(duration, iteration) {
    this.duration = duration;
    this.iteration = iteration;
    this.keyframesCss = [];
    // Tracks per selector per property so combined timelines never clash.
    this.tracks = new Map();
    this.index = 0;
  }

  // Adds a partial keyframe track on a selector for a single channel ('opacity', 'transform', 'dash', 'marker', 'motion').
  add(selector, channel, points, ease = 'cubic-bezier(.65,0,.35,1)') {
    if (!this.tracks.has(selector)) this.tracks.set(selector, new Map());
    const channels = this.tracks.get(selector);
    const existing = channels.get(channel);
    if (!existing) {
      channels.set(channel, { points: [...points], ease });
      return;
    }
    // Merge later points (such as fading out during detail after enter) preserving earlier points before overlap.
    const anchor = points.find((p, idx) => idx > 0 && p.styleText !== points[0].styleText);
    const startIndex = anchor ? Math.max(0, points.indexOf(anchor) - 1) : 0;
    const anchorTime = points[startIndex].t;
    const kept = existing.points.filter((p) => p.t < anchorTime - 0.0001);
    const holdValue = kept.at(-1)?.styleText;
    const spliced = points.slice(startIndex).map((p, idx) => (idx === 0 && holdValue ? { ...p, styleText: holdValue } : p));
    existing.points = [...kept, ...spliced];
  }

  emitCss() {
    const bindings = [];
    for (const [selector, channels] of this.tracks.entries()) {
      const anims = [];
      for (const { points, ease } of channels.values()) {
        const sorted = [...points].sort((a, b) => a.t - b.t);
        const name = `sf${this.index++}`;
        const stops = sorted.map(({ t, styleText, easing }) => {
          const pct = `${((Math.max(0, Math.min(this.duration, t)) / this.duration) * 100).toFixed(5)}%`;
          return `${pct}{${styleText};animation-timing-function:${easing || ease}}`;
        }).join('');
        this.keyframesCss.push(`@keyframes ${name}{${stops}}`);
        anims.push(`${name} ${this.duration}s linear ${this.iteration}`);
      }
      bindings.push(`${selector}{animation:${anims.join(',')}}`);
    }
    return [...this.keyframesCss, ...bindings];
  }
}

function wrapSourceLines(text, maxUnits = 27.5) {
  const rows = [];
  let remaining = String(text ?? '').replace(/\t/g, '  ');
  let first = true;
  while (textUnits(remaining) > maxUnits && remaining.length > 8) {
    let cut = 0;
    while (cut < remaining.length && textUnits(remaining.slice(0, cut + 1)) <= maxUnits) cut += 1;
    const boundary = Math.max(remaining.lastIndexOf(', ', cut), remaining.lastIndexOf(' ', cut));
    if (boundary > 8) cut = boundary + 1;
    if (cut <= 0) cut = 1;
    rows.push({ first, text: remaining.slice(0, cut) });
    first = false;
    remaining = `      ${remaining.slice(cut).trimStart()}`;
  }
  rows.push({ first, text: remaining });
  return rows;
}

function buildDetailMarkup(detail, fileLines, timeline, duration, palette) {
  const rows = [];
  const highlights = new Set(detail.highlight || []);
  for (const number of detail.lines) {
    const raw = fileLines[number - 1] ?? '';
    for (const part of wrapSourceLines(raw)) {
      rows.push({ line: part.first ? number : '', sourceLine: number, text: part.text, highlighted: highlights.has(number) });
    }
  }
  const font = rows.length > 14 ? 10.8 : rows.length > 10 ? 11.8 : 12.8;
  const gap = rows.length > 14 ? 19 : rows.length > 10 ? 22 : 25.5;
  const selections = detail.selections?.length
    ? detail.selections
    : [{ at: detail.start, lines: detail.highlight || [] }];

  let content = `<line x1="${CODE_DIVIDER_X}" x2="${CODE_DIVIDER_X}" y1="125" y2="528" stroke="${palette.line}" stroke-width="1"/>`;
  content += `<text x="${CODE_X}" y="${CODE_Y}" font-size="${fitFontSize(detail.title, CODE_WIDTH, 15, 11)}" fill="${palette.text}" font-weight="600">${escapeXml(detail.title)}</text>`;
  if (detail.note) {
    content += `<text x="${CODE_X}" y="${CODE_Y + 25}" font-size="${fitFontSize(detail.note, CODE_WIDTH, 11.5, 9)}" fill="${palette.muted}">${escapeXml(detail.note)}</text>`;
  }

  const rowStartY = CODE_Y + (detail.note ? 66 : 44);
  rows.forEach((row, index) => {
    const yy = rowStartY + index * gap;
    if (selections.some((sel) => sel.lines.includes(row.sourceLine))) {
      const id = `story-source-hl-${index}`;
      const initialOpacity = selections[0].lines.includes(row.sourceLine) ? 1 : 0;
      content += `<rect id="${id}" x="${CODE_X + 29}" y="${yy - Math.round(gap * 0.68)}" width="${CODE_WIDTH - 29}" height="${gap}" fill="${palette.accent}" fill-opacity="0.1" style="opacity:${initialOpacity}"/>`;
      if (selections.length > 1) {
        let current = initialOpacity;
        const pts = [{ t: 0, styleText: `opacity:${current}` }];
        for (const sel of selections.slice(1)) {
          const next = sel.lines.includes(row.sourceLine) ? 1 : 0;
          pts.push({ t: sel.at, styleText: `opacity:${current}` }, { t: Math.min(duration, sel.at + 0.45), styleText: `opacity:${next}` });
          current = next;
        }
        pts.push({ t: duration, styleText: `opacity:${current}` });
        timeline.add(`#${id}`, 'opacity', pts);
      }
    }
    if (row.line) content += `<text x="${CODE_X}" y="${yy}" font-size="10.5" fill="${palette.muted}">${row.line}</text>`;
    content += `<text x="${CODE_X + 34}" y="${yy}" font-size="${font}" fill="${palette.text}" xml:space="preserve" style="font-family:${CODE_FONT_FAMILY};white-space:pre">${escapeXml(row.text)}</text>`;
  });

  const inAt = Math.min(duration, detail.start + 0.5);
  const inDone = Math.min(duration, detail.start + 1.5);
  const outAt = detail.end < duration ? detail.end : duration;
  const pts = [
    { t: 0, styleText: 'opacity:0;transform:translateX(22px)' },
    { t: inAt, styleText: 'opacity:0;transform:translateX(22px)' },
    { t: inDone, styleText: 'opacity:1;transform:translateX(0px)' },
    { t: outAt, styleText: 'opacity:1;transform:translateX(0px)' },
  ];
  if (detail.end < duration) {
    pts.push({ t: Math.min(duration, detail.end + 0.55), styleText: 'opacity:0;transform:translateX(12px)' });
  }
  pts.push({ t: duration, styleText: detail.end < duration ? 'opacity:0;transform:translateX(12px)' : 'opacity:1;transform:translateX(0px)' });
  timeline.add('#story-source-detail', 'motion', pts);
  return `<g id="story-source-detail" style="opacity:0">${content}</g>`;
}

export function compilePrStorySvg({ story, pack, bakedViews, theme, preset = 'classic', styles = loadViewerStyles(), revisions, manifestDir }) {
  const { detailLines } = validatePrStory(story, pack, { revisions, manifestDir, requireDetailSource: true });
  const duration = story.duration;
  const iteration = story.loop === false ? '2 both' : 'infinite';
  const palette = storyPalette(theme, preset, styles);
  const viewById = new Map(pack.views.map((v) => [v.id, v]));
  const storyLocale = pack.views.find((v) => v.diagram?.meta?.locale)?.diagram.meta.locale || '';
  const isZh = storyLocale.toLowerCase().startsWith('zh');

  const parts = {};
  for (const stage of story.stages) {
    const view = viewById.get(stage.view);
    const rawSvg = bakedViews.get(stage.view)?.get(theme);
    if (!rawSvg) {
      failPrPack('pr-story/missing-baked-view', 'export', `Baked ${theme} SVG for view "${stage.view}" was not generated before story compilation.`, {
        subject: { view: stage.view, theme },
        supportedFixes: [`ensure theme "${theme}" renders cleanly for view "${stage.view}"`],
      });
    }
    const viewIsZh = (view.diagram?.meta?.locale || storyLocale).toLowerCase().startsWith('zh');
    parts[stage.view] = prepareSubSvg({ view, rawSvg, nodeBadges: story.nodeBadges || 'labeled', isZh: viewIsZh || isZh });
  }

  const timeline = new StoryTimeline(duration, iteration);
  const staticCss = [
    styles.fontCss,
    `svg{font-family:${STORY_FONT_FALLBACK}}`,
    `[data-native-key] [data-legend]{display:none}`,
    `[data-story-node-badge] text{font-size:10.5px!important}`,
  ];

  // Attach metric readouts directly under the node in its prepared sub-SVG.
  for (const [mi, item] of (story.metrics || []).entries()) {
    const part = parts[item.view];
    const node = part.nodes.find((n) => n.id === item.node);
    if (!node) {
      failPrPack('pr-story/unknown-node', 'views', `story metrics[${mi}] references unknown node "${item.node}" in view "${item.view}".`, {
        subject: { view: item.view, node: item.node },
        supportedFixes: ['cite a node id that renders in that view'],
      });
    }
    const x = node.x + node.width * (item.slot === 'left' ? 0.25 : item.slot === 'right' ? 0.75 : 0.5);
    const y = node.y + node.height + 24;
    const prefix = `story-measure-${item.id || `${item.view}-${item.node}-${mi}`}`;
    const afterColor = item.tone === 'neutral' ? palette.text : palette.accent;
    const beforeLabel = `${item.before}`;
    const afterLabel = `${item.before} → ${item.after}`;
    const markup = `<g id="${prefix}-before"><text x="${x}" y="${y}" font-size="11" fill="${palette.muted}" font-weight="500" text-anchor="middle">${escapeXml(item.label)}</text><text x="${x}" y="${y + 24}" font-size="20" fill="${palette.text}" font-weight="600" text-anchor="middle">${escapeXml(beforeLabel)}</text></g>`
      + `<g id="${prefix}-after" style="opacity:0"><text x="${x}" y="${y}" font-size="11" fill="${palette.muted}" font-weight="500" text-anchor="middle">${escapeXml(item.label)}</text><text x="${x}" y="${y + 24}" font-size="20" fill="${afterColor}" font-weight="650" text-anchor="middle">${escapeXml(afterLabel)}</text></g>`;
    const injected = injectIntoNodeGroup(part.svg, item.node, markup);
    if (injected) part.svg = injected;
    const transitionEnd = Math.min(duration, item.at + 0.8);
    timeline.add(`#${prefix}-before`, 'opacity', [
      { t: 0, styleText: 'opacity:1' },
      { t: item.at, styleText: 'opacity:1' },
      { t: transitionEnd, styleText: 'opacity:0' },
      { t: duration, styleText: 'opacity:0' },
    ]);
    timeline.add(`#${prefix}-after`, 'opacity', [
      { t: 0, styleText: 'opacity:0' },
      { t: item.at, styleText: 'opacity:0' },
      { t: transitionEnd, styleText: 'opacity:1' },
      { t: duration, styleText: 'opacity:1' },
    ]);
    const extraBox = { x: node.x, y: node.y, width: node.width, height: node.height + 62 };
    part.contentBox = boundsOf([part.contentBox, extraBox]);
    part.extraBoxes.push({ id: item.node, ...extraBox });
  }

  const pair = story.pair || null;
  let pairCamera = null;
  if (pair) {
    pairCamera = fitCamera(boundsOf([parts[pair.before].contentBox, parts[pair.after].contentBox]), PLOT, 1.5);
  }

  const cameras = {};
  const stageById = new Map(story.stages.map((s) => [s.view, s]));
  for (const stage of story.stages) {
    const part = parts[stage.view];
    const isPaired = pair && (stage.view === pair.before || stage.view === pair.after);
    cameras[stage.view] = isPaired ? pairCamera : fitCamera(part.contentBox, PLOT, 1.5);
  }

  // Stage visibility + shared node hiding
  const stageOpacity = {};
  for (const stage of story.stages) {
    if (pair && (stage.view === pair.before || stage.view === pair.after)) {
      if (stage.view === pair.before) {
        const outEnd = Math.min(duration, pair.at + 0.9);
        stageOpacity[stage.view] = 1;
        timeline.add(`#view-${stage.view}`, 'opacity', [
          { t: 0, styleText: 'opacity:1' },
          { t: pair.at, styleText: 'opacity:1' },
          { t: outEnd, styleText: 'opacity:0' },
          { t: duration, styleText: 'opacity:0' },
        ]);
      } else {
        const until = pair.until ?? stage.end ?? duration;
        const inEnd = Math.min(duration, pair.at + 1.15);
        stageOpacity[stage.view] = 0;
        const pts = [
          { t: 0, styleText: 'opacity:0' },
          { t: pair.at, styleText: 'opacity:0' },
          { t: inEnd, styleText: 'opacity:1' },
          { t: until, styleText: 'opacity:1' },
        ];
        if (until < duration) {
          const fadeEnd = Math.min(duration, until + 0.9);
          pts.push({ t: fadeEnd, styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' });
        } else {
          pts.push({ t: duration, styleText: 'opacity:1' });
        }
        timeline.add(`#view-${stage.view}`, 'opacity', pts);
      }
      continue;
    }

    const start = stage.start ?? 0;
    const end = stage.end ?? duration;
    stageOpacity[stage.view] = start > 0 ? 0 : 1;
    if (start > 0 || end < duration) {
      const pts = start > 0
        ? [{ t: 0, styleText: 'opacity:0' }, { t: start, styleText: 'opacity:0' }, { t: Math.min(duration, start + 1.1), styleText: 'opacity:1' }]
        : [{ t: 0, styleText: 'opacity:1' }];
      pts.push({ t: end, styleText: 'opacity:1' });
      if (end < duration) pts.push({ t: Math.min(duration, end + 0.85), styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' });
      else pts.push({ t: duration, styleText: 'opacity:1' });
      timeline.add(`#view-${stage.view}`, 'opacity', pts);
    }
  }

  // Camera pans from focus + detail
  const cameraMoves = Object.fromEntries(story.stages.map((s) => [s.view, [{ t: 0, camera: cameras[s.view] }]]));
  const focusOps = [
    ...(story.focus || []).map((f) => ({ ...f, kind: 'focus' })),
    ...(story.detail ? [{ view: story.detail.view, nodes: story.detail.nodes, at: story.detail.start, area: 'left', kind: 'detail' }] : []),
  ].sort((a, b) => a.at - b.at);

  for (const op of focusOps) {
    const part = parts[op.view];
    const selected = [];
    for (const nodeId of op.nodes) {
      const node = part.nodes.find((n) => n.id === nodeId);
      if (!node) {
        failPrPack('pr-story/unknown-node', 'views', `story ${op.kind} references unknown node "${nodeId}" in view "${op.view}".`, {
          subject: { view: op.view, node: nodeId },
          supportedFixes: ['cite node ids declared in that view'],
        });
      }
      selected.push({ x: node.x, y: node.y - 12, width: node.width, height: node.height + 12 });
      const extra = part.extraBoxes.find((b) => b.id === nodeId);
      if (extra) selected.push(extra);
    }
    const targetArea = op.area === 'left' ? LEFT_PLOT : CENTER_FOCUS;
    const nextCamera = fitCamera(boundsOf(selected), targetArea, 1.55);
    const prevCamera = cameraMoves[op.view].at(-1).camera;
    const panEnd = Math.min(duration, op.at + 1.45);
    if (op.at === 0 && cameraMoves[op.view].length === 1) {
      cameraMoves[op.view][0] = { t: 0, camera: nextCamera };
    } else {
      cameraMoves[op.view].push({ t: op.at, camera: prevCamera }, { t: panEnd, camera: nextCamera });
    }
  }

  for (const [viewId, points] of Object.entries(cameraMoves)) {
    if (points.length <= 1) continue;
    points.push({ t: duration, camera: points.at(-1).camera });
    timeline.add(`#camera-${viewId}`, 'transform', points.map((p) => ({ t: p.t, styleText: `transform:${formatTransform(p.camera)}` })));
  }

  // Shared pair node transitions
  const sharedLayers = [];
  const hiddenByView = new Map();
  if (pair) {
    const hiddenBefore = new Set();
    const hiddenAfter = new Set();
    hiddenByView.set(pair.before, hiddenBefore);
    hiddenByView.set(pair.after, hiddenAfter);
    const beforePart = parts[pair.before];
    const afterPart = parts[pair.after];
    const transitionDur = pair.duration ?? 1.6;
    const afterCameraLater = cameraMoves[pair.after].filter((p) => p.t > pair.at + transitionDur);

    for (const shared of pair.shared) {
      const a = beforePart.nodes.find((n) => n.id === shared.id);
      const b = afterPart.nodes.find((n) => n.id === shared.id);
      const original = findBalancedTag(beforePart.svg, 'data-node-id', shared.id);
      if (!a || !b || !original) {
        failPrPack('pr-story/unknown-node', 'views', `story.pair.shared node "${shared.id}" must exist in both "${pair.before}" and "${pair.after}".`, {
          subject: { node: shared.id, before: pair.before, after: pair.after },
          supportedFixes: ['include shared.id in both pair.before and pair.after views'],
        });
      }
      hiddenBefore.add(shared.id);
      hiddenAfter.add(shared.id);
      staticCss.push(`#view-${pair.before} [data-node-id="${escapeCssAttr(shared.id)}"]{visibility:hidden}`);
      staticCss.push(`#view-${pair.after} [data-node-id="${escapeCssAttr(shared.id)}"]{visibility:hidden}`);

      let markup = original.svg.replace(/\sid="[^"]*"/g, '');
      const poseFor = (camera) => {
        const scale = camera.scale * (b.width / a.width);
        return {
          scale,
          x: camera.x + (b.x + b.width / 2) * camera.scale - (a.x + a.width / 2) * scale,
          y: camera.y + (b.y + b.height / 2) * camera.scale - (a.y + a.height / 2) * scale,
        };
      };
      const midAt = Math.min(duration, pair.at + transitionDur * 0.5);
      const doneAt = Math.min(duration, pair.at + transitionDur);

      if (shared.label) {
        const tag = /<text\b[^>]*data-node-label[^>]*>/.exec(markup)?.[0] || '';
        const x = Number(/\bx="([^"]+)"/.exec(tag)?.[1] || a.x + a.width / 2);
        const y = Number(/\by="([^"]+)"/.exec(tag)?.[1] || a.y + a.height / 2 - 2);
        const fontSize = /\bfont-size="([^"]+)"/.exec(tag)?.[1] || '13';
        markup = markup.replace(tag, tag.replace(/>$/, ' data-story-shared-old-label="">'))
          .replace(/<\/g>$/, `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${palette.text}" font-weight="600" data-node-label="" id="story-shared-label-${shared.id}" text-anchor="middle" style="opacity:0">${escapeXml(shared.label)}</text></g>`);
        timeline.add(`#story-shared-${shared.id} [data-story-shared-old-label]`, 'opacity', [
          { t: 0, styleText: 'opacity:1' }, { t: pair.at, styleText: 'opacity:1' }, { t: midAt, styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' },
        ]);
        timeline.add(`#story-shared-label-${shared.id}`, 'opacity', [
          { t: 0, styleText: 'opacity:0' }, { t: midAt, styleText: 'opacity:0' }, { t: doneAt, styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' },
        ]);
      }

      if (shared.subtitle) {
        const subTag = /<text\b[^>]*data-detail="context"[^>]*>/.exec(markup)?.[0] || '';
        const sx = Number(/\bx="([^"]+)"/.exec(subTag)?.[1] || a.x + a.width / 2);
        const sy = Number(/\by="([^"]+)"/.exec(subTag)?.[1] || a.y + a.height / 2 + 14);
        const fontSize = /\bfont-size="([^"]+)"/.exec(subTag)?.[1] || '10.5';
        markup = markup.replace(/<\/g>$/, `<text x="${sx}" y="${sy}" font-size="${fontSize}" fill="${palette.muted}" font-weight="400" id="story-shared-sub-${shared.id}" text-anchor="middle" style="opacity:0">${escapeXml(shared.subtitle)}</text></g>`);
        timeline.add(`#story-shared-${shared.id} [data-node-id="${escapeCssAttr(shared.id)}"] > text:not([data-node-label]):not(#story-shared-sub-${shared.id})`, 'opacity', [
          { t: 0, styleText: 'opacity:1' }, { t: pair.at, styleText: 'opacity:1' }, { t: doneAt, styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' },
        ]);
        timeline.add(`#story-shared-sub-${shared.id}`, 'opacity', [
          { t: 0, styleText: 'opacity:0' }, { t: pair.at, styleText: 'opacity:0' }, { t: doneAt, styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' },
        ]);
      }

      const targetGroup = findBalancedTag(afterPart.svg, 'data-node-id', shared.id);
      const targetState = targetGroup ? /\bdata-change="(added|modified|removed)"/.exec(targetGroup.svg.slice(0, targetGroup.svg.indexOf('>') + 1))?.[1] : null;
      const targetBadge = targetGroup && targetState ? findBalancedTag(targetGroup.svg, 'data-change-badge', targetState)?.svg : null;
      if (targetBadge && !/data-change-badge=/.test(markup)) {
        const map = `translate(${a.x} ${a.y}) scale(${(a.width / b.width).toFixed(5)}) translate(${-b.x} ${-b.y})`;
        markup = markup.replace(/<\/g>$/, `<g data-native-key="${afterPart.key}"><g id="story-shared-badge-${shared.id}" transform="${map}" style="opacity:0">${targetBadge}</g></g></g>`);
        timeline.add(`#story-shared-badge-${shared.id}`, 'opacity', [
          { t: 0, styleText: 'opacity:0' }, { t: pair.at, styleText: 'opacity:0' }, { t: doneAt, styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' },
        ]);
      }

      sharedLayers.push(`<g data-native-key="${beforePart.key}"><g id="story-shared-${shared.id}" style="transform:${formatTransform(cameras[pair.before])};transform-origin:0 0">${markup}</g></g>`);
      const targetPose = poseFor(cameras[pair.after]);
      const movePts = [
        { t: 0, styleText: `transform:${formatTransform(cameras[pair.before])}` },
        { t: pair.at, styleText: `transform:${formatTransform(cameras[pair.before])}` },
        { t: doneAt, styleText: `transform:${formatTransform(targetPose)}` },
        ...afterCameraLater.map((p) => ({ t: p.t, styleText: `transform:${formatTransform(poseFor(p.camera))}` })),
      ];
      movePts.push({ t: duration, styleText: movePts.at(-1).styleText });
      timeline.add(`#story-shared-${shared.id}`, 'transform', movePts);

      if (pair.until && pair.until < duration) {
        const outEnd = Math.min(duration, pair.until + 0.85);
        timeline.add(`#story-shared-${shared.id}`, 'opacity', [
          { t: 0, styleText: 'opacity:1' },
          { t: pair.until, styleText: 'opacity:1' },
          { t: outEnd, styleText: 'opacity:0' },
          { t: duration, styleText: 'opacity:0' },
        ]);
      }
    }
  }

  // Relabel subtitle crossfades
  for (const [index, op] of (story.relabel || []).entries()) {
    const part = parts[op.view];
    const node = part.nodes.find((n) => n.id === op.node);
    if (!node) {
      failPrPack('pr-story/unknown-node', 'views', `story relabel[${index}] references unknown node "${op.node}" in view "${op.view}".`, {
        subject: { view: op.view, node: op.node },
        supportedFixes: ['cite an existing node id in that view'],
      });
    }
    const group = findBalancedTag(part.svg, 'data-node-id', op.node);
    const subMatch = group ? /(<text\b[^>]*data-detail="context"[^>]*>)([^<]*)(<\/text>)/.exec(group.svg) : null;
    if (!subMatch) {
      failPrPack('pr-story/unknown-node', 'views', `story relabel[${index}] node "${op.node}" has no sublabel text to relabel.`, {
        subject: { view: op.view, node: op.node },
        supportedFixes: ['give that node a sublabel or remove the relabel entry'],
      });
    }
    const oldId = `story-relabel-old-${index}`;
    const newId = `story-relabel-new-${index}`;
    const sx = Number(/\bx="([^"]+)"/.exec(subMatch[1])?.[1] || node.x + node.width / 2);
    const sy = Number(/\by="([^"]+)"/.exec(subMatch[1])?.[1] || node.y + node.height / 2 + 14);
    const updatedGroup = group.svg.replace(subMatch[0], `${subMatch[1].replace(/>$/, ` id="${oldId}">`)}${subMatch[2]}${subMatch[3]}`)
      .replace(/<\/g>$/, `<text x="${sx}" y="${sy}" font-size="11" fill="${palette.muted}" text-anchor="middle" id="${newId}" style="opacity:0">${escapeXml(op.subtitle)}</text></g>`);
    part.svg = part.svg.slice(0, group.start) + updatedGroup + part.svg.slice(group.end);
    const doneAt = Math.min(duration, op.at + 0.8);
    timeline.add(`#${oldId}`, 'opacity', [{ t: 0, styleText: 'opacity:1' }, { t: op.at, styleText: 'opacity:1' }, { t: doneAt, styleText: 'opacity:0' }, { t: duration, styleText: 'opacity:0' }]);
    timeline.add(`#${newId}`, 'opacity', [{ t: 0, styleText: 'opacity:0' }, { t: op.at, styleText: 'opacity:0' }, { t: doneAt, styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' }]);
  }

  // Enter reveals
  for (const [oi, op] of (story.enter || []).entries()) {
    const part = parts[op.view];
    const stagger = op.stagger ?? 0.3;
    for (const [i, nodeId] of op.nodes.entries()) {
      const node = part.nodes.find((n) => n.id === nodeId);
      if (!node) {
        failPrPack('pr-story/unknown-node', 'views', `story enter[${oi}] references unknown node "${nodeId}" in view "${op.view}".`, {
          subject: { view: op.view, node: nodeId },
          supportedFixes: ['cite an existing node id in that view'],
        });
      }
      const start = Math.min(duration, op.at + i * stagger);
      const end = Math.min(duration, start + 1.05);
      const sel = `#view-${op.view} [data-node-id="${escapeCssAttr(nodeId)}"]`;
      staticCss.push(`${sel}{transform-origin:${node.x + node.width / 2}px ${node.y + node.height / 2}px}`);
      timeline.add(sel, 'opacity', [
        { t: 0, styleText: 'opacity:0' },
        { t: start, styleText: 'opacity:0' },
        { t: end, styleText: 'opacity:1' },
        { t: duration, styleText: 'opacity:1' },
      ], 'cubic-bezier(.2,.8,.25,1)');
      timeline.add(sel, 'transform', [
        { t: 0, styleText: 'transform:translateY(14px) scale(.96)' },
        { t: start, styleText: 'transform:translateY(14px) scale(.96)' },
        { t: end, styleText: 'transform:translateY(0px) scale(1)' },
        { t: duration, styleText: 'transform:translateY(0px) scale(1)' },
      ], 'cubic-bezier(.2,.8,.25,1)');
    }
  }

  // Connect stroke-dashoffset draws
  for (const [ci, op] of (story.connect || []).entries()) {
    const part = parts[op.view];
    const stagger = op.stagger ?? 0.4;
    for (const [i, edgeRef] of op.edges.entries()) {
      const route = part.paths.get(edgeRef);
      if (!route) {
        failPrPack('pr-story/unknown-edge', 'views', `story connect[${ci}] references unknown edge "${edgeRef}" in view "${op.view}".`, {
          subject: { view: op.view, edge: edgeRef },
          supportedFixes: ['pass an authored edge id or "from~to" endpoint key present in that view'],
        });
      }
      const start = Math.min(duration, op.at + i * stagger);
      const end = Math.min(duration, start + 1.1);
      const edgeKey = route.id;
      const escapedKey = escapeCssAttr(edgeKey);
      // Add pathLength="1" onto matching path(s) in this view
      part.svg = part.svg.replace(
        new RegExp(`(<path\\b[^>]*data-story-edge-id="${escapeRegex(escapeXml(edgeKey))}"[^>]*?)(/?>)`, 'g'),
        (m, open, close) => (/\bpathLength=/.test(open) ? m : `${open} pathLength="1"${close}`),
      );
      const wrapSel = `#view-${op.view} [data-story-edge-wrap="${escapedKey}"], #view-${op.view} [data-edge-id="${escapedKey}"], #view-${op.view} [data-story-edge-id="${escapedKey}"]`;
      const strokeSel = `#view-${op.view} path[data-story-edge-id="${escapedKey}"]`;
      timeline.add(wrapSel, 'opacity', [
        { t: 0, styleText: 'opacity:0' },
        { t: start, styleText: 'opacity:0' },
        { t: Math.min(duration, start + 0.15), styleText: 'opacity:1' },
        { t: duration, styleText: 'opacity:1' },
      ]);
      timeline.add(strokeSel, 'dash', [
        { t: 0, styleText: 'stroke-dasharray:1;stroke-dashoffset:1' },
        { t: start, styleText: 'stroke-dasharray:1;stroke-dashoffset:1' },
        { t: end, styleText: 'stroke-dasharray:1;stroke-dashoffset:0' },
        { t: duration, styleText: 'stroke-dasharray:1;stroke-dashoffset:0' },
      ]);
      if (route.marker) {
        timeline.add(strokeSel, 'marker', [
          { t: 0, styleText: 'marker-end:none', easing: 'step-end' },
          { t: Math.max(0, end - 0.02), styleText: 'marker-end:none', easing: 'step-end' },
          { t: end, styleText: `marker-end:${route.marker}`, easing: 'step-end' },
          { t: duration, styleText: `marker-end:${route.marker}`, easing: 'step-end' },
        ], 'step-end');
      }
    }
  }

  // Explicit fade operations
  for (const [fi, op] of (story.fade || []).entries()) {
    const part = parts[op.view];
    const doneAt = Math.min(duration, op.at + 1);
    for (const nodeId of op.nodes || []) {
      if (!part.nodes.some((n) => n.id === nodeId)) {
        failPrPack('pr-story/unknown-node', 'views', `story fade[${fi}] references unknown node "${nodeId}" in view "${op.view}".`, {
          subject: { view: op.view, node: nodeId },
          supportedFixes: ['cite node ids declared in that view'],
        });
      }
      timeline.add(`#view-${op.view} [data-node-id="${escapeCssAttr(nodeId)}"]`, 'opacity', [
        { t: 0, styleText: 'opacity:1' }, { t: op.at, styleText: 'opacity:1' }, { t: doneAt, styleText: `opacity:${op.to}` }, { t: duration, styleText: `opacity:${op.to}` },
      ]);
    }
    for (const edgeRef of op.edges || []) {
      const route = part.paths.get(edgeRef);
      if (!route) {
        failPrPack('pr-story/unknown-edge', 'views', `story fade[${fi}] references unknown edge "${edgeRef}" in view "${op.view}".`, {
          subject: { view: op.view, edge: edgeRef },
          supportedFixes: ['cite an authored edge id or "from~to" present in that view'],
        });
      }
      const ek = escapeCssAttr(route.id);
      timeline.add(`#view-${op.view} [data-story-edge-wrap="${ek}"], #view-${op.view} [data-edge-id="${ek}"], #view-${op.view} [data-story-edge-id="${ek}"]`, 'opacity', [
        { t: 0, styleText: 'opacity:1' }, { t: op.at, styleText: 'opacity:1' }, { t: doneAt, styleText: `opacity:${op.to}` }, { t: duration, styleText: `opacity:${op.to}` },
      ]);
    }
  }

  // Detail left-node + right-code reveal (fades unrelated view context while preserving focused node & its metrics)
  let detailMarkup = '';
  if (story.detail) {
    const { detail } = story;
    const part = parts[detail.view];
    const focused = new Set(detail.nodes);
    const hidden = hiddenByView.get(detail.view) || new Set();
    const fadeOutAt = Math.min(duration, detail.start + 0.95);
    const fadeBackAt = detail.end < duration ? detail.end : null;
    const addDetailFade = (selector) => {
      const pts = [{ t: 0, styleText: 'opacity:1' }, { t: detail.start, styleText: 'opacity:1' }, { t: fadeOutAt, styleText: 'opacity:0' }];
      if (fadeBackAt !== null) pts.push({ t: fadeBackAt, styleText: 'opacity:0' }, { t: Math.min(duration, fadeBackAt + 0.6), styleText: 'opacity:1' }, { t: duration, styleText: 'opacity:1' });
      else pts.push({ t: duration, styleText: 'opacity:0' });
      timeline.add(selector, 'opacity', pts);
    };
    for (const node of part.nodes) {
      if (focused.has(node.id) || hidden.has(node.id)) continue;
      addDetailFade(`#view-${detail.view} [data-node-id="${escapeCssAttr(node.id)}"]`);
    }
    const seenEdgeIds = new Set();
    for (const route of part.paths.values()) {
      if (seenEdgeIds.has(route.id)) continue;
      seenEdgeIds.add(route.id);
      if (focused.has(route.from) && focused.has(route.to)) continue;
      const ek = escapeCssAttr(route.id);
      addDetailFade(`#view-${detail.view} [data-story-edge-wrap="${ek}"], #view-${detail.view} [data-edge-id="${ek}"], #view-${detail.view} [data-story-edge-id="${ek}"]`);
    }
    addDetailFade(`#view-${detail.view} text.t-dim, #view-${detail.view} [data-graph-role="structural-frame"], #view-${detail.view} [data-domain-band]`);
    detailMarkup = buildDetailMarkup(detail, detailLines, timeline, duration, palette);
  }

  // Pure-CSS infinite offset-path tokens embedded inside their camera group so camera pans track automatically.
  const tokenMarkupByView = new Map();
  for (const [ti, trace] of (story.traces || []).entries()) {
    const part = parts[trace.view];
    const travel = trace.travel ?? 1.5;
    const hopCircles = [];
    for (let i = 0; i < trace.edges.length; i += 1) {
      const edgeRef = trace.edges[i];
      const hopStart = trace.times[i];
      const route = part.paths.get(edgeRef);
      if (!route) {
        failPrPack('pr-story/unknown-edge', 'views', `story trace[${ti}] references unknown edge "${edgeRef}" in view "${trace.view}".`, {
          subject: { view: trace.view, edge: edgeRef },
          supportedFixes: ['cite an authored edge id or "from~to" present in that view'],
        });
      }
      const tokenId = `story-token-${ti}-${i}`;
      const cleanPath = route.d.replace(/[^0-9A-Za-z.,\s+-]/g, ' ').trim();
      const hopMoveEnd = Math.min(duration, hopStart + travel);
      const nextStart = i + 1 < trace.times.length ? trace.times[i + 1] : null;
      const hopHideAt = nextStart !== null
        ? nextStart
        : Math.min(duration, trace.end ?? hopMoveEnd + 0.25);

      const opacityPts = [];
      if (i === 0 && hopStart === 0) {
        opacityPts.push({ t: 0, styleText: 'opacity:1' });
      } else {
        opacityPts.push({ t: 0, styleText: 'opacity:0' });
        if (i === 0) {
          const fadeIn = Math.max(0, hopStart - 0.25);
          if (fadeIn > 0) opacityPts.push({ t: fadeIn, styleText: 'opacity:0' });
          opacityPts.push({ t: hopStart, styleText: 'opacity:1' });
        } else {
          opacityPts.push({ t: Math.max(0, hopStart - 0.01), styleText: 'opacity:0' }, { t: hopStart, styleText: 'opacity:1' });
        }
      }
      opacityPts.push({ t: hopHideAt, styleText: 'opacity:1' });
      if (nextStart !== null) {
        opacityPts.push({ t: Math.min(duration, nextStart + 0.01), styleText: 'opacity:0' });
      } else {
        opacityPts.push({ t: Math.min(duration, hopHideAt + 0.3), styleText: 'opacity:0' });
      }
      opacityPts.push({ t: duration, styleText: 'opacity:0' });
      timeline.add(`#${tokenId}`, 'opacity', opacityPts);

      timeline.add(`#${tokenId}`, 'offsetDistance', [
        { t: 0, styleText: 'offset-distance:0%' },
        { t: hopStart, styleText: 'offset-distance:0%' },
        { t: hopMoveEnd, styleText: 'offset-distance:100%' },
        { t: duration, styleText: 'offset-distance:100%' },
      ], 'cubic-bezier(.4,0,.2,1)');

      staticCss.push(`#${tokenId}{offset-path:path("${escapeCssAttr(cleanPath)}");offset-rotate:0deg}`);
      hopCircles.push(`<circle id="${tokenId}" data-story-token="" cx="0" cy="0" r="5" fill="${palette.accent}" stroke="${palette.bg}" stroke-width="2" style="opacity:0"/>`);
    }
    const existing = tokenMarkupByView.get(trace.view) || '';
    tokenMarkupByView.set(trace.view, existing + hopCircles.join(''));
  }

  // Assemble stages inside clipped diagram viewport
  const stageLayers = [];
  for (const stage of story.stages) {
    const part = parts[stage.view];
    const tokens = tokenMarkupByView.get(stage.view) || '';
    const tokenWrap = tokens ? `<g data-story-tokens="">${tokens}</g>` : '';
    stageLayers.push(
      `<g id="view-${stage.view}" class="view-stage" data-native-key="${part.key}" style="opacity:${stageOpacity[stage.view]}">`
      + `<g id="camera-${stage.view}" style="transform:${formatTransform(cameras[stage.view])};transform-origin:0 0">${part.svg}${tokenWrap}</g></g>`,
    );
  }

  // Top caption band & progress pills
  const totalSteps = story.steps.length;
  const pillPitch = totalSteps > 7 ? Math.floor(136 / totalSteps) : 19;
  const pillW = Math.max(6, Math.min(13, pillPitch - 5));
  const pillStartX = 930 - (totalSteps - 1) * pillPitch - pillW;
  const headlineBudget = Math.max(240, pillStartX - 88);

  const captionLayers = story.steps.map((step, index) => {
    const id = `story-caption-${index}`;
    const change = step.change || 'modified';
    const tone = change === 'added' ? palette.accent : change === 'removed' ? palette.removed : palette.text;
    const barColor = change === 'added' ? palette.accent : change === 'removed' ? palette.removed : palette.amber;
    const end = index + 1 < totalSteps ? Math.max(step.at + 0.5, story.steps[index + 1].at - 0.55) : duration;
    const headlineFont = fitFontSize(step.title, headlineBudget, 20, 14);
    const bodyFont = fitFontSize(step.body, 886, 14.5, 11.5);

    let inner = `<line x1="30" x2="30" y1="29" y2="96" stroke="${barColor}" stroke-width="2"/>`;
    inner += `<g transform="translate(44 35)" fill="${palette.muted}"><path d="${PR_ICON_PATH}"/></g>`;
    inner += `<text x="70" y="49" font-size="${headlineFont}" fill="${tone}" font-weight="650" class="caption-title">${escapeXml(step.title)}</text>`;
    inner += `<text x="44" y="79" font-size="${bodyFont}" fill="${palette.muted}" class="caption-body">${escapeXml(step.body)}</text>`;
    for (let p = 0; p < totalSteps; p += 1) {
      inner += `<rect x="${pillStartX + p * pillPitch}" y="42" width="${pillW}" height="3" rx="1.5" fill="${p <= index ? palette.accent : palette.line}"/>`;
    }

    const pts = [];
    if (step.at === 0) {
      pts.push({ t: 0, styleText: 'opacity:1;transform:translateY(0px)' });
    } else {
      pts.push(
        { t: 0, styleText: 'opacity:0;transform:translateY(8px)' },
        { t: step.at, styleText: 'opacity:0;transform:translateY(8px)' },
        { t: Math.min(duration, step.at + 0.6), styleText: 'opacity:1;transform:translateY(0px)' },
      );
    }
    pts.push({ t: end, styleText: 'opacity:1;transform:translateY(0px)' });
    if (index + 1 < totalSteps) {
      const hiddenAt = Math.min(duration, end + 0.4);
      pts.push({ t: hiddenAt, styleText: 'opacity:0;transform:translateY(-6px)' }, { t: duration, styleText: 'opacity:0;transform:translateY(-6px)' });
    } else {
      pts.push({ t: duration, styleText: 'opacity:1;transform:translateY(0px)' });
    }
    timeline.add(`#${id}`, 'motion', pts, 'cubic-bezier(.22,.7,.2,1)');
    return `<g id="${id}" class="story-caption" style="opacity:${step.at === 0 ? 1 : 0}">${inner}</g>`;
  });

  const reducedMotionRule = '@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important}[data-story-tokens],[data-story-token]{display:none}.story-caption{opacity:0!important}.story-caption:first-of-type{opacity:1!important;transform:none!important}}';
  const css = [...staticCss, ...timeline.emitCss(), reducedMotionRule].join('\n');
  if (css.includes(']]>')) {
    throw new Error('story-svg: generated stylesheet contains forbidden CDATA terminator');
  }

  const storyTitle = story.title || pack.manifest.title;
  const storyDesc = `${storyTitle}: ${story.steps.map((s) => s.title).join(' -> ')}`;
  const metadata = `<metadata id="archify-software-notices">${escapeXml(softwareNotices + OCTICON_NOTICE)}</metadata>`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" role="img" aria-labelledby="archify-story-title archify-story-desc" data-theme="${theme}" data-preset="${escapeXml(preset)}" data-archify-bake="story" data-story-loop="${story.loop === false ? 'finite' : 'infinite'}">`
    + `<title id="archify-story-title">${escapeXml(storyTitle)}</title>`
    + `<desc id="archify-story-desc">${escapeXml(storyDesc)}</desc>`
    + `<style><![CDATA[\n${css}\n]]></style>`
    + `<defs><clipPath id="story-diagram-viewport" clipPathUnits="userSpaceOnUse"><rect x="${VIEWPORT.x}" y="${VIEWPORT.y}" width="${VIEWPORT.width}" height="${VIEWPORT.height}"/></clipPath></defs>`
    + `<rect width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" fill="${palette.bg}"/>`
    + `<g data-story-layer="diagram" clip-path="url(#story-diagram-viewport)">${stageLayers.join('')}${sharedLayers.join('')}${detailMarkup}</g>`
    + `<g data-story-layer="captions">${captionLayers.join('')}</g>`
    + `${metadata}</svg>\n`;

  assertCamoSafeSvg(svg, { assert: true });
  return {
    svg,
    id: story.id || 'walkthrough',
    title: storyTitle,
    duration,
    loop: story.loop !== false,
    captionBandBottom: CAPTION_BAND_BOTTOM,
    viewportTop: VIEWPORT.y,
  };
}
