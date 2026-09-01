#!/usr/bin/env node
// Repository API inventory for architecture artifacts.
//
// Scans a repository for Spring MVC controllers (@RestController /
// @Controller plus mapping annotations), then injects into a delivered
// Archify HTML artifact:
//   1. a floating toggle button (fixed position, out of document flow so the
//      first-screen containment contract is preserved), and
//   2. a collapsed, module-filterable, searchable endpoint table that the
//      toggle expands below the cards.
//
// The command never edits the artifact when its template anchors are missing:
// it reports a diagnostic and leaves the file untouched. Running it again on
// an already-injected artifact reports `already-injected` without changes.
//
// Only Spring MVC is recognized today. When the repository exposes HTTP
// endpoints through another detected framework (Express, Flask, Gin, Actix,
// ...), the receipt reports `unsupported-framework` without modifying the
// artifact so the agent can tell the user.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SKIPPED_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'target', 'build', 'dist', 'out',
  'vendor', 'bin', 'obj', '.idea', '.vscode', '__pycache__', '.gradle',
]);

const MAPPING_RE = /@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\s*(\(([\s\S]*?)\))?/g;
const VERB_FOR = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

// Other web frameworks we can recognize but do not scan yet.
const OTHER_FRAMEWORKS = [
  { file: 'package.json', re: /"(?:express|koa|fastify|@nestjs\/core|hapi|restify)"/, name: 'Node.js (Express/Koa/NestJS/...)' },
  { file: 'go.mod', re: /gin-gonic\/gin|labstack\/echo|gofiber\/fiber|go-chi\/chi|gorilla\/mux/, name: 'Go (Gin/Echo/Fiber/...)' },
  { file: 'requirements.txt', re: /^(?:flask|fastapi|django|tornado|bottle|sanic|aiohttp)/im, name: 'Python (Flask/FastAPI/Django/...)' },
  { file: 'pyproject.toml', re: /"(?:flask|fastapi|django|tornado|bottle|sanic|aiohttp)["<>= ]/, name: 'Python (Flask/FastAPI/Django/...)' },
  { file: 'Cargo.toml', re: /(?:actix-web|axum|rocket|warp)/, name: 'Rust (Actix/Axum/Rocket/...)' },
];

const MARKER = 'id="api-inventory"';

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function serializeScriptJson(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.java')) {
      out.push(full);
    }
  }
}

// Same-length mask of a Java source: comment bodies and string/char literal
// contents become spaces, so mapping annotations inside comments or strings
// are invisible to the scanner while byte offsets stay valid for slicing the
// argument text back out of the unmasked source.
function maskSource(src) {
  let out = '';
  let state = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (state === 'code') {
      if (c === '/' && next === '/') { state = 'line'; out += '  '; i++; }
      else if (c === '/' && next === '*') { state = 'block'; out += '  '; i++; }
      else if (c === '"' || c === "'") { state = c === '"' ? 'string' : 'char'; out += c; }
      else out += c;
    } else if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c; } else out += ' ';
    } else if (state === 'block') {
      if (c === '*' && next === '/') { state = 'code'; out += '  '; i++; }
      else out += c === '\n' ? '\n' : ' ';
    } else { // string | char
      if ((state === 'string' && c === '"') || (state === 'char' && c === "'")) { state = 'code'; out += c; }
      else if (c === '\\' && next !== undefined) { out += '  '; i++; }
      else out += c === '\n' ? '\n' : ' ';
    }
  }
  return out;
}

// Split masked annotation arguments on top-level commas. String contents are
// blank in the mask, so commas and braces inside literals cannot split a part.
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{' || c === '(') depth++;
    else if (c === '}' || c === ')') depth--;
    else if (c === ',' && depth === 0) { parts.push([start, i]); start = i + 1; }
  }
  parts.push([start, text.length]);
  return parts;
}

// Interpret Spring mapping annotation arguments. Only the `value`/`path`
// attributes — or a positional string / string-array — are endpoint paths;
// other named attributes (consumes, produces, params, headers, ...) must never
// be read as paths. Returns { paths: string[] | null, verbs: string[] | null }
// where null means "not specified".
function parseAnnotationArgs(args) {
  if (!args) return { paths: null, verbs: null };
  const masked = maskSource(args);
  let paths = null;
  let verbs = null;
  let positionalTaken = false;
  for (const [start, end] of splitTopLevel(masked)) {
    const maskedPart = masked.slice(start, end);
    const named = maskedPart.match(/^\s*([A-Za-z_$][\w$]*)\s*=/);
    if (named) {
      const name = named[1];
      const valueStart = start + named[0].length;
      const originalValue = args.slice(valueStart, end);
      const maskedValue = masked.slice(valueStart, end);
      if ((name === 'value' || name === 'path') && !paths) {
        const values = [...originalValue.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
        if (values.length) paths = values;
      } else if (name === 'method' && !verbs) {
        verbs = [...maskedValue.matchAll(/RequestMethod\.(\w+)/g)].map((m) => m[1].toUpperCase());
      }
    } else if (!positionalTaken) {
      positionalTaken = true;
      const trimmed = maskedPart.trim();
      if (trimmed.startsWith('"') || trimmed.startsWith('{')) {
        const values = [...args.slice(start, end).matchAll(/"([^"]*)"/g)].map((m) => m[1]);
        if (values.length) paths = values;
      }
    }
  }
  return { paths, verbs };
}

// Slice the argument text of a mapping match out of the unmasked source. The
// match ran on the masked source, which has identical length and offsets.
function originalArgs(source, match) {
  if (match[3] === undefined) return '';
  const whole = source.slice(match.index, match.index + match[0].length);
  const open = whole.indexOf('(');
  return whole.slice(open + 1, -1);
}

function classJavadocSummary(head) {
  const blocks = [...head.matchAll(/\/\*\*([\s\S]*?)\*\//g)];
  if (!blocks.length) return '';
  for (const line of blocks[blocks.length - 1][1].split('\n')) {
    const text = line.replace(/^\s*\*\s?/, '').trim();
    if (text && !text.startsWith('@')) return text;
  }
  return '';
}

// "module" = the path segment that owns the `src` directory (Maven/Gradle
// multi-module layout). Falls back to the repository directory name.
function moduleFor(repoRoot, filePath) {
  const rel = path.relative(repoRoot, filePath).split(path.sep);
  const srcIndex = rel.indexOf('src');
  if (srcIndex > 0) return rel[srcIndex - 1];
  return path.basename(repoRoot);
}

function scanRepository(repoRoot) {
  const javaFiles = [];
  walk(repoRoot, javaFiles);
  const endpoints = [];
  for (const filePath of javaFiles) {
    let source;
    try {
      source = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const masked = maskSource(source);
    if (!/(?:@RestController|@Controller)\b/.test(masked)) continue;
    const classMatch = masked.match(/public\s+(?:abstract\s+)?class\s+(\w+)/);
    const controllerName = classMatch ? classMatch[1] : path.basename(filePath, '.java');
    const head = classMatch ? source.slice(0, classMatch.index) : '';
    // Class-level @RequestMapping: every base path and every verb restriction
    // composes with each handler mapping, as Spring requires.
    let basePaths = null;
    let classVerbs = null;
    if (classMatch) {
      for (const m of masked.matchAll(MAPPING_RE)) {
        if (m.index >= classMatch.index) break; // matchAll yields ascending indices
        if (m[1] !== 'RequestMapping') continue;
        const parsed = parseAnnotationArgs(originalArgs(source, m));
        basePaths = parsed.paths && parsed.paths.length ? parsed.paths : [''];
        classVerbs = parsed.verbs && parsed.verbs.length ? parsed.verbs : null;
        break; // Spring allows one class-level mapping
      }
    }
    for (const m of masked.matchAll(MAPPING_RE)) {
      if (classMatch && m.index < classMatch.index) continue; // class-level annotations are not handlers
      const parsed = parseAnnotationArgs(originalArgs(source, m));
      let verbs;
      if (m[1] === 'RequestMapping') {
        verbs = parsed.verbs && parsed.verbs.length ? parsed.verbs : null;
      } else {
        verbs = [VERB_FOR[m[1]]];
      }
      // Spring intersects class- and method-level verb restrictions; an empty
      // intersection means the handler is simply not mapped.
      if (classVerbs && verbs) {
        verbs = verbs.filter((v) => classVerbs.includes(v));
        if (!verbs.length) continue;
      } else if (classVerbs) {
        verbs = classVerbs;
      }
      if (!verbs) verbs = ['ANY'];
      const methodPaths = parsed.paths && parsed.paths.length ? parsed.paths : [''];
      for (const base of (basePaths || [''])) {
        for (const p of methodPaths) {
          let full = p ? `${base.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}` : base.replace(/\/+$/, '');
          full = full.replace(/\/+$/, '');
          if (!full.startsWith('/')) full = `/${full}`;
          for (const verb of verbs) {
            endpoints.push({
              m: moduleFor(repoRoot, filePath),
              c: controllerName,
              v: verb,
              p: full,
              d: classJavadocSummary(head),
            });
          }
        }
      }
    }
  }
  endpoints.sort((a, b) => (a.m + a.c + a.p).localeCompare(b.m + b.c + b.p));
  return endpoints;
}

function detectOtherFrameworks(repoRoot) {
  const hits = [];
  for (const probe of OTHER_FRAMEWORKS) {
    const filePath = path.join(repoRoot, probe.file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    if (probe.re.test(content)) hits.push(probe.name);
  }
  return hits;
}

const STRINGS = {
  'zh-CN': {
    fabLabel: '接口',
    expand: '接口',
    collapse: '收起',
    kicker: 'REST API',
    sectionTitle: '接口服务清单',
    scanLine: (controllers, endpoints, verbSummary) => `扫描 ${controllers} 个 Controller 共提取 ${endpoints} 个 HTTP 端点 · ${verbSummary}`,
    searchLabel: '搜索接口',
    searchPlaceholder: '搜索路径 / 控制器 / 说明…',
    filterLabel: '按模块筛选',
    all: '全部',
    thMethod: '方法',
    thPath: '路径',
    thController: '控制器',
    thModule: '模块',
    thDesc: '说明',
    empty: '没有匹配的接口',
    countTemplate: '显示 {shown} / {total} 个端点',
  },
  en: {
    fabLabel: 'API',
    expand: 'API',
    collapse: 'Collapse',
    kicker: 'REST API',
    sectionTitle: 'API Service Inventory',
    scanLine: (controllers, endpoints, verbSummary) => `Scanned ${controllers} controllers · ${endpoints} HTTP endpoints · ${verbSummary}`,
    searchLabel: 'Search endpoints',
    searchPlaceholder: 'Search path / controller / description…',
    filterLabel: 'Filter by module',
    all: 'All',
    thMethod: 'Method',
    thPath: 'Path',
    thController: 'Controller',
    thModule: 'Module',
    thDesc: 'Description',
    empty: 'No matching endpoints',
    countTemplate: 'Showing {shown} of {total} endpoints',
  },
};

function stringsFor(html) {
  const lang = html.match(/<html[^>]*\slang="([^"]*)"/);
  return lang && lang[1].toLowerCase().startsWith('zh') ? STRINGS['zh-CN'] : STRINGS.en;
}

function buildCss() {
  return `
    /* ===== Repository API inventory (injected by archify api-inventory) ===== */
    .api-section { margin-top: 2rem; }
    html[data-present="true"]:not([data-embed="true"]) .api-section { display: none; }
    .api-fab {
      position: fixed; right: 1.25rem; bottom: 1.25rem; z-index: 40;
      display: inline-flex; align-items: center; gap: 0.375rem;
      background: var(--panel); border: 1px solid var(--panel-border);
      border-radius: 999px; color: var(--text-muted);
      padding: 0.5rem 1rem; font-size: 0.8125rem; font-weight: 600;
      cursor: pointer;
      box-shadow: 0 6px 18px color-mix(in srgb, #000 25%, transparent);
    }
    .api-fab:hover { color: var(--text); border-color: var(--frontend-stroke); }
    .api-fab-count { color: var(--frontend-stroke); font-weight: 700; }
    html[data-present="true"]:not([data-embed="true"]) .api-fab { display: none; }
    @media print { .api-fab { display: none; } }
    .api-head {
      display: flex; flex-wrap: wrap; gap: 0.75rem 1rem;
      align-items: flex-end; justify-content: space-between;
      margin-bottom: 1rem;
    }
    .api-kicker {
      font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--text-muted);
    }
    .api-section h2 { font-size: 1.125rem; font-weight: 700; color: var(--text); margin: 0.25rem 0 0.375rem; }
    .api-sub { font-size: 0.8125rem; color: var(--text-muted); margin: 0; }
    .api-search {
      flex: 0 1 18rem; min-width: 12rem;
      background: var(--panel); border: 1px solid var(--panel-border);
      border-radius: 0.5rem; color: var(--text);
      padding: 0.5rem 0.75rem; font-size: 0.8125rem;
      outline: none;
    }
    .api-search:focus { border-color: var(--frontend-stroke); }
    .api-search::placeholder { color: var(--text-faint); }
    .api-chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
    .api-chip {
      background: var(--panel); border: 1px solid var(--panel-border);
      border-radius: 999px; color: var(--text-muted);
      padding: 0.3125rem 0.875rem; font-size: 0.8125rem; cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .api-chip:hover { color: var(--text); }
    .api-chip.is-active {
      border-color: var(--frontend-stroke); color: var(--frontend-stroke); font-weight: 600;
    }
    .api-chip small { opacity: 0.75; margin-left: 0.25rem; }
    .api-table-wrap {
      background: var(--panel); border: 1px solid var(--panel-border);
      border-radius: 0.75rem; overflow: auto; max-height: 32rem;
    }
    .api-table { border-collapse: collapse; width: 100%; font-size: 0.8125rem; }
    .api-table thead th {
      position: sticky; top: 0; z-index: 1;
      background: var(--panel); border-bottom: 1px solid var(--panel-border);
      color: var(--text-muted); font-weight: 600; text-align: left;
      padding: 0.625rem 0.875rem; white-space: nowrap;
    }
    .api-table tbody td {
      padding: 0.5rem 0.875rem; border-bottom: 1px solid var(--grid);
      color: var(--text); vertical-align: top;
    }
    .api-table tbody tr:last-child td { border-bottom: none; }
    .api-table tbody tr:hover td { background: var(--lane-fill); }
    .api-verb {
      display: inline-block; font-size: 0.6875rem; font-weight: 700;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      border-radius: 0.25rem; padding: 0.125rem 0.4375rem; letter-spacing: 0.04em;
    }
    .api-verb.GET    { color: var(--backend-stroke);  background: var(--backend-fill); }
    .api-verb.POST   { color: var(--frontend-stroke); background: var(--frontend-fill); }
    .api-verb.PUT    { color: var(--cloud-stroke);    background: var(--cloud-fill); }
    .api-verb.DELETE { color: var(--security-stroke); background: var(--security-fill); }
    .api-verb.PATCH  { color: var(--cloud-stroke);    background: var(--cloud-fill); }
    .api-verb.ANY    { color: var(--text-muted);      background: var(--external-fill); }
    .api-path {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      white-space: nowrap; font-size: 0.7813rem;
    }
    .api-ctrl { color: var(--text-muted); white-space: nowrap; }
    .api-mod { white-space: nowrap; color: var(--text-muted); }
    .api-desc { color: var(--text-muted); min-width: 8rem; }
    .api-table mark { background: transparent; color: var(--frontend-stroke); font-weight: 700; }
    .api-count { font-size: 0.75rem; color: var(--text-faint); margin: 0.625rem 0 0; }
    .api-empty { padding: 2rem 0.875rem; color: var(--text-faint); text-align: center; display: none; }
`;
}

function buildFab(endpoints, strings) {
  return `    <button class="api-fab" id="api-toggle" type="button" aria-expanded="false" aria-controls="api-inventory"><span id="api-toggle-label">${htmlEscape(strings.fabLabel)}</span><span class="api-fab-count">${endpoints.length}</span></button>
`;
}

function buildSection(endpoints, strings) {
  const controllerSet = new Set();
  const verbCounts = new Map();
  const moduleCounts = new Map();
  for (const e of endpoints) {
    controllerSet.add(e.c);
    verbCounts.set(e.v, (verbCounts.get(e.v) || 0) + 1);
    moduleCounts.set(e.m, (moduleCounts.get(e.m) || 0) + 1);
  }
  const verbSummary = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ANY']
    .filter((v) => verbCounts.has(v))
    .map((v) => `${v} ${verbCounts.get(v)}`)
    .join(' · ');
  const moduleRanking = [...moduleCounts.entries()].sort((a, b) => b[1] - a[1]);
  const chips = [
    { id: 'all', label: strings.all, count: endpoints.length, active: true },
    ...moduleRanking.map(([m, n]) => ({ id: m, label: m, count: n, active: false })),
  ]
    .map((chip) => `        <button class="api-chip${chip.active ? ' is-active' : ''}" data-module="${htmlEscape(chip.id)}" type="button">${htmlEscape(chip.label)}<small>${chip.count}</small></button>`)
    .join('\n');

  return `
    <!-- Repository API inventory (injected by archify api-inventory) -->
    <section class="api-section" id="api-inventory" hidden aria-labelledby="api-inventory-title">
      <div class="api-head">
        <div>
          <span class="api-kicker">${htmlEscape(strings.kicker)}</span>
          <h2 id="api-inventory-title">${htmlEscape(strings.sectionTitle)}</h2>
          <p class="api-sub">${htmlEscape(strings.scanLine(controllerSet.size, endpoints.length, verbSummary))}</p>
        </div>
        <input class="api-search" id="api-search" type="search"
               placeholder="${htmlEscape(strings.searchPlaceholder)}" aria-label="${htmlEscape(strings.searchLabel)}" />
      </div>
      <div class="api-chips" role="group" aria-label="${htmlEscape(strings.filterLabel)}">
${chips}
      </div>
      <div class="api-table-wrap">
        <table class="api-table">
          <thead>
            <tr><th>${strings.thMethod}</th><th>${strings.thPath}</th><th>${strings.thController}</th><th>${strings.thModule}</th><th>${strings.thDesc}</th></tr>
          </thead>
          <tbody id="api-tbody"></tbody>
        </table>
        <p class="api-empty" id="api-empty">${htmlEscape(strings.empty)}</p>
      </div>
      <p class="api-count" id="api-count" role="status" aria-live="polite"></p>
      <script type="application/json" id="api-data">${serializeScriptJson(endpoints)}</script>
    </section>

    <script>
    (function () {
      'use strict';
      var data;
      try { data = JSON.parse(document.getElementById('api-data').textContent); }
      catch (_) { return; }
      var toggle = document.getElementById('api-toggle');
      var toggleLabel = document.getElementById('api-toggle-label');
      var section = document.getElementById('api-inventory');
      var tbody = document.getElementById('api-tbody');
      var empty = document.getElementById('api-empty');
      var countEl = document.getElementById('api-count');
      var search = document.getElementById('api-search');
      var chips = Array.prototype.slice.call(document.querySelectorAll('.api-chip'));
      var state = { module: 'all', query: '' };
      var labels = {
        expand: ${JSON.stringify(strings.expand)},
        collapse: ${JSON.stringify(strings.collapse)},
        countTemplate: ${JSON.stringify(strings.countTemplate)}
      };

      function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      }
      function mark(s, q) {
        s = esc(s);
        if (!q) return s;
        var i = s.toLowerCase().indexOf(q.toLowerCase());
        if (i < 0) return s;
        return s.slice(0, i) + '<mark>' + s.slice(i, i + q.length) + '</mark>' + s.slice(i + q.length);
      }

      function render() {
        var q = state.query.trim().toLowerCase();
        var rows = data.filter(function (e) {
          if (state.module !== 'all' && e.m !== state.module) return false;
          if (!q) return true;
          return (e.p + ' ' + e.c + ' ' + (e.d || '')).toLowerCase().indexOf(q) >= 0;
        });
        if (!rows.length) {
          tbody.innerHTML = '';
          empty.style.display = 'block';
        } else {
          empty.style.display = 'none';
          tbody.innerHTML = rows.map(function (e) {
            return '<tr><td><span class="api-verb ' + esc(e.v) + '">' + esc(e.v) + '</span></td>' +
              '<td class="api-path">' + mark(e.p, q) + '</td>' +
              '<td class="api-ctrl">' + mark(e.c, q) + '</td>' +
              '<td class="api-mod">' + esc(e.m) + '</td>' +
              '<td class="api-desc">' + mark(e.d || '', q) + '</td></tr>';
          }).join('');
        }
        countEl.textContent = labels.countTemplate.replace('{shown}', rows.length).replace('{total}', data.length);
      }

      if (toggle) {
        toggle.addEventListener('click', function () {
          var expanded = !section.hidden;
          section.hidden = expanded;
          toggle.setAttribute('aria-expanded', String(!expanded));
          if (toggleLabel) toggleLabel.textContent = expanded ? labels.expand : labels.collapse;
          if (!expanded && section.scrollIntoView) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      }
      chips.forEach(function (chip) {
        chip.addEventListener('click', function () {
          chips.forEach(function (c) { c.classList.remove('is-active'); });
          chip.classList.add('is-active');
          state.module = chip.getAttribute('data-module');
          render();
        });
      });
      if (search) {
        search.addEventListener('input', function () {
          state.query = search.value;
          render();
        });
      }
      render();
    })();
    </script>
`;
}

function inject(html, endpoints) {
  if (html.includes(MARKER)) return { html, status: 'already-injected' };

  const styleCount = (html.match(/<\/style>/g) || []).length;
  if (styleCount !== 1) {
    return {
      status: 'fail',
      diagnostic: {
        code: 'api-inventory/template-anchor',
        severity: 'error',
        message: `Expected exactly one </style> anchor, found ${styleCount}. Artifact not modified.`,
        subject: { artifact: '' },
        supportedFixes: ['Deliver the artifact again with the current renderer, then rerun api-inventory.'],
      },
    };
  }
  const anchorRe = /\n\n  <\/div>\n\n  <script>\n    var Archify = \{\};/;
  const anchorMatches = html.match(new RegExp(anchorRe.source, 'g')) || [];
  if (anchorMatches.length !== 1) {
    return {
      status: 'fail',
      diagnostic: {
        code: 'api-inventory/template-anchor',
        severity: 'error',
        message: `Expected exactly one container-close anchor before the viewer script, found ${anchorMatches.length}. Artifact not modified.`,
        subject: { artifact: '' },
        supportedFixes: ['Deliver the artifact again with the current renderer, then rerun api-inventory.'],
      },
    };
  }

  const strings = stringsFor(html);
  const fab = buildFab(endpoints, strings);
  const section = buildSection(endpoints, strings);
  const injected = html
    .replace('</style>', () => `${buildCss()}\n  </style>`)
    .replace(anchorRe, () => `\n${fab}${section}\n  </div>\n\n  <script>\n    var Archify = {};`);
  return { html: injected, status: 'injected' };
}

function baseReceipt({ artifactPath, artifact }) {
  return {
    schemaVersion: 1,
    ok: false,
    command: 'api-inventory',
    status: 'fail',
    framework: 'spring-mvc',
    scan: { controllers: 0, endpoints: 0, modules: {} },
    artifact: {
      path: artifactPath,
      sha256: sha256(artifact),
      bytes: artifact.byteLength,
    },
    diagnostics: [],
  };
}

export async function runApiInventory({ repoRoot, artifactPath } = {}) {
  const artifact = artifactPath ? path.resolve(artifactPath) : '';
  const repo = repoRoot ? path.resolve(repoRoot) : '';
  if (!repo || !fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
    const receipt = baseReceipt({ artifactPath: artifact, artifact: Buffer.alloc(0) });
    receipt.diagnostics.push({
      code: 'api-inventory/repo-not-found',
      severity: 'error',
      message: `Repository path not found: ${repo}`,
      subject: { repository: repo },
      supportedFixes: ['Pass the repository root that contains the Spring MVC controllers.'],
    });
    return { exitCode: 1, receipt };
  }
  if (!artifact || !fs.existsSync(artifact)) {
    const receipt = baseReceipt({ artifactPath: artifact, artifact: Buffer.alloc(0) });
    receipt.diagnostics.push({
      code: 'api-inventory/artifact-not-found',
      severity: 'error',
      message: `Artifact not found: ${artifact}`,
      subject: { artifact: artifact },
      supportedFixes: ['Deliver the architecture artifact first, then rerun api-inventory on it.'],
    });
    return { exitCode: 1, receipt };
  }

  let artifactBytes;
  try {
    artifactBytes = fs.readFileSync(artifact);
  } catch (error) {
    const receipt = baseReceipt({ artifactPath: artifact, artifact: Buffer.alloc(0) });
    receipt.diagnostics.push({
      code: 'api-inventory/artifact-unreadable',
      severity: 'error',
      message: `Artifact could not be read: ${error.message}`,
      subject: { artifact },
      evidence: { ...(error.code ? { systemCode: error.code } : {}) },
      supportedFixes: ['Point api-inventory at a readable Archify HTML artifact produced by archify deliver.'],
    });
    return { exitCode: 1, receipt };
  }
  const receipt = baseReceipt({ artifactPath: artifact, artifact: artifactBytes });
  if (!artifactBytes.includes('var Archify = {};')) {
    receipt.diagnostics.push({
      code: 'api-inventory/not-an-archify-artifact',
      severity: 'error',
      message: 'Artifact does not look like an Archify HTML artifact.',
      subject: { artifact },
      supportedFixes: ['Run api-inventory on an HTML artifact produced by archify deliver.'],
    });
    return { exitCode: 1, receipt };
  }

  const endpoints = scanRepository(repo);
  receipt.scan = {
    controllers: new Set(endpoints.map((e) => e.c)).size,
    endpoints: endpoints.length,
    modules: endpoints.reduce((acc, e) => { acc[e.m] = (acc[e.m] || 0) + 1; return acc; }, {}),
  };

  if (!endpoints.length) {
    const otherFrameworks = detectOtherFrameworks(repo);
    receipt.status = otherFrameworks.length ? 'unsupported-framework' : 'no-controllers';
    if (otherFrameworks.length) {
      receipt.diagnostics.push({
        code: 'api-inventory/unsupported-framework',
        severity: 'warning',
        message: `No Spring MVC controllers found, but the repository uses ${otherFrameworks.join(', ')}. API inventory supports Spring MVC only today; the artifact was not modified.`,
        subject: { repository: repo },
        supportedFixes: ['Tell the user API inventory currently supports Spring MVC only and continue the delivery without injection.'],
      });
    } else {
      receipt.diagnostics.push({
        code: 'api-inventory/no-controllers',
        severity: 'info',
        message: 'No Spring MVC controllers found in the repository. The artifact was not modified.',
        subject: { repository: repo },
      });
    }
    return { exitCode: 0, receipt };
  }

  const result = inject(artifactBytes.toString('utf8'), endpoints);
  if (result.status === 'already-injected') {
    receipt.status = 'already-injected';
    receipt.ok = true;
    receipt.diagnostics.push({
      code: 'api-inventory/already-injected',
      severity: 'info',
      message: 'Artifact already contains an API inventory. Artifact not modified.',
      subject: { artifact },
    });
    return { exitCode: 0, receipt };
  }
  if (result.status === 'fail') {
    receipt.diagnostics.push({ ...result.diagnostic, subject: { artifact } });
    return { exitCode: 1, receipt };
  }

  // Never-modify-on-failure contract: write a private same-directory temp file
  // fully, then rename over the artifact. A partial write (ENOSPC mid-file)
  // must leave the delivered artifact byte-for-byte intact.
  const buffer = Buffer.from(result.html, 'utf8');
  const tempPath = `${artifact}.api-inventory-${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, artifact);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Nothing to clean up (the temp file was never created).
    }
    receipt.diagnostics.push({
      code: 'api-inventory/artifact-write-failed',
      severity: 'error',
      message: `Artifact could not be updated: ${error.message}`,
      subject: { artifact },
      evidence: { ...(error.code ? { systemCode: error.code } : {}) },
      supportedFixes: ['Free up disk space or fix permissions in the artifact directory, then rerun api-inventory. The artifact was not modified.'],
    });
    return { exitCode: 1, receipt };
  }
  receipt.status = 'injected';
  receipt.ok = true;
  receipt.artifact = { path: artifact, sha256: sha256(buffer), bytes: buffer.length };
  return { exitCode: 0, receipt };
}
