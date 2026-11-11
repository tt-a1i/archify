(function () {
  "use strict";

  const reviewData = JSON.parse(document.getElementById("review-data").textContent);

  // ── Indexes ────────────────────────────────────────────────
  // Groups items into a Map of arrays, keeping their order within each key.
  function groupBy(items, keyOf) {
    const groups = new Map();

    for (const item of items) {
      const key = keyOf(item);

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    return groups;
  }

  const nodeById = new Map(reviewData.nodes.map((node) => [node.id, node]));
  // Findings address nodes by their position in the review file (/nodes/<index>).
  const nodeIndex = new Map(reviewData.nodes.map((node, i) => [node.id, i]));
  const edgeById = new Map(reviewData.edges.map((edge) => [edge.id, edge]));
  const repoById = new Map(reviewData.repos.map((repo) => [repo.id, repo]));
  const outEdges = groupBy(reviewData.edges, (edge) => edge.from);
  const inEdges = groupBy(reviewData.edges, (edge) => edge.to);
  const outgoingEdges = (id) => outEdges.get(id) || [];
  const incomingEdges = (id) => inEdges.get(id) || [];
  const testsOf = (id) => incomingEdges(id).filter((edge) => edge.kind === "tests" && nodeById.get(edge.from)?.kind === "test");
  const testedBy = (id) => outgoingEdges(id).filter((edge) => edge.kind === "tests");
  // Copies tagged with the list they came from, so the review data keeps its shape.
  const allFindings = [
    ...reviewData.errors.map((finding) => ({ ...finding, level: "error" })),
    ...reviewData.warnings.map((finding) => ({ ...finding, level: "warning" })),
  ];

  const STATUS_LABEL = {
    verified: "Verified",
    contradicted: "Contradicted",
    unresolved: "Unresolved",
    agent: "Agent statement",
  };
  const CHANGE_LABEL = {
    added: "Added",
    modified: "Modified",
    deleted: "Deleted",
    unchanged: "Unchanged",
    renamed: "Renamed",
  };
  const isProblemStatus = (status) => status === "contradicted" || status === "unresolved";

  // ── Icons ──────────────────────────────────────────────────
  const ICON_PATHS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    xcircle: '<circle cx="12" cy="12" r="9.5"/><path d="m15 9-6 6M9 9l6 6"/>',
    checkcircle: '<circle cx="12" cy="12" r="9.5"/><path d="m8.5 12.2 2.4 2.4 4.8-5"/>',
    help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.6-3 4"/><path d="M12 17.2h.01"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4M12 8h.01"/>',
    commit: '<circle cx="12" cy="12" r="3.2"/><path d="M3 12h5.8M15.2 12H21"/>',
    repo: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/>',
    test: '<path d="M9 3h6M10 3v6.5L4.6 18.4A1.8 1.8 0 0 0 6.2 21h11.6a1.8 1.8 0 0 0 1.6-2.6L14 9.5V3"/><path d="M7 15h10"/>',
    component: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    endpoint: '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19 14.5 14.5 0 0 1 0-19"/>',
    entry: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
    external: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9"/>',
    other: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="3"/>',
    config: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    data: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    graph: '<circle cx="5.5" cy="6" r="2.5"/><circle cx="18.5" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="m7 8.2 3.8 7.6M17 8.2l-3.8 7.6M8 6h8"/>',
    flows: '<rect x="2.5" y="4" width="6" height="6" rx="1.5"/><rect x="15.5" y="14" width="6" height="6" rx="1.5"/><path d="M8.5 7h4a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2"/>',
    diff: '<path d="M12 3v10M7 8h10M7 20h10"/>',
    claims: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    logo: '<path d="M6 7h8M6 12h12M6 17h6"/><circle cx="18" cy="7" r="1.6" fill="currentColor"/>',
    note: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    branch: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5c0 4-6 3-11 5.5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
    target: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    tree: '<path d="M3 3h6v6H3zM15 15h6v6h-6zM6 9v6a3 3 0 0 0 3 3h6"/>',
  };
  const icon = (name, extraClass = "") =>
    `<svg class="i ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.other}</svg>`;
  const KIND_ICON = {
    entry: "entry",
    code: "code",
    component: "component",
    endpoint: "endpoint",
    test: "test",
    external: "external",
    config: "config",
    migration: "data",
    data: "data",
    schema: "data",
    store: "data",
    doc: "doc",
    docs: "doc",
    function: "code",
    handler: "code",
    module: "code",
    type: "code",
    hook: "code",
    route: "entry",
    page: "entry",
    ui: "component",
    screen: "component",
  };
  const kindIcon = (kind) => KIND_ICON[kind] || "other";
  const STATUS_ICON = {
    verified: "checkcircle",
    contradicted: "xcircle",
    unresolved: "help",
    agent: "chat",
  };

  // ── DOM helpers ────────────────────────────────────────────
  // Hyperscript: attrs maps class, html, style objects and on* handlers;
  // null and false attributes and children are skipped.
  function el(tag, attrs, ...children) {
    const element = document.createElement(tag);

    for (const [name, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;

      if (name === "class") element.className = value;
      else if (name === "html") element.innerHTML = value;
      else if (name === "style" && typeof value === "object") Object.assign(element.style, value);
      else if (name.startsWith("on")) element.addEventListener(name.slice(2), value);
      else element.setAttribute(name, value === true ? "" : value);
    }

    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;

      element.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }

    return element;
  }

  function htmlFragment(html) {
    const template = document.createElement("template");

    template.innerHTML = html;

    return template.content;
  }

  const HTML_ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
  const plural = (count, one, many) => `${count} ${count === 1 ? one : many || one + "s"}`;
  const SHORT_SHA_LENGTH = 7;
  const shortSha = (sha) => (sha === "WORKTREE" ? "WORKTREE" : (sha || "").slice(0, SHORT_SHA_LENGTH));
  // "12" for a one-line [12, 12] range, "12–15" otherwise.
  const rangeText = (range) => (range[0] === range[1] ? range[0] : range[0] + "–" + range[1]);
  const rangesText = (ranges) => ranges.map(rangeText).join(", ");

  function linesText(ref) {
    if (!ref) return "";
    if (ref.lines) return `:${rangeText(ref.lines)}`;
    if (ref.line) return `:${ref.line}`;

    return "";
  }

  function refText(ref) {
    if (!ref) return "";
    if (ref.type === "commit") return `${ref.repo} @ ${shortSha(ref.sha)}`;

    return `${ref.file}${linesText(ref)}`;
  }

  function basename(path) {
    const slash = path.lastIndexOf("/");

    return slash < 0 ? path : path.slice(slash + 1);
  }

  function dirname(path) {
    const slash = path.lastIndexOf("/");

    return slash < 0 ? "" : path.slice(0, slash + 1);
  }

  function statusBadge(status) {
    return el("span", { class: `badge ${status}`, html: icon(STATUS_ICON[status], "sm") + escapeHTML(STATUS_LABEL[status] || status) });
  }

  function changeBadge(change) {
    return el("span", { class: `badge ${change}` }, CHANGE_LABEL[change] || change);
  }

  function agentTag(text = "Agent says") {
    return el("div", { class: "agent-tag", html: icon("chat") + escapeHTML(text) });
  }

  // Colours an agent-reported test result by whether it reads as a pass or a failure.
  function observedClass(value) {
    const text = String(value).toLowerCase();

    if (/(^|\b)(pass|passed|ok|green|success)/.test(text)) return "passed";
    if (/(fail|failed|error|red)/.test(text)) return "failed";

    return "";
  }

  const observedMeta = (node) => node.meta && node.meta.find((meta) => meta.key === "observed");

  function observedBadge(node) {
    const observed = observedMeta(node);

    if (!observed) return null;

    return el("span", { class: "badge agent " + observedClass(observed.value) }, "agent says: " + observed.value);
  }

  // ── State & routing ────────────────────────────────────────
  const SIDEBAR_MIN_WIDTH = 220;
  const SIDEBAR_MAX_WIDTH = 600;
  const SIDEBAR_DEFAULT_WIDTH = 320;
  const INSPECTOR_MIN_WIDTH = 380;
  const MAIN_MIN_WIDTH = 360;
  // Larger graphs open with the legend folded so it does not cover nodes.
  const LEGEND_FOLDED_ABOVE_NODES = 20;

  function clampSidebarWidth(width) {
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width || SIDEBAR_DEFAULT_WIDTH));
  }

  // Preferences are a convenience: storage may be blocked, so fall back silently.
  function loadPref(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function savePref(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable: the preference lasts for this page only.
    }
  }

  const state = {
    // Flows read the change in order; a review without flows opens on its graph.
    view: reviewData.flows.length ? "flows" : "graph",
    selection: null, // {type: node|edge|hunk|findings|file, id}
    // What the Flows view picked; the graph shows only it and what the reviewer opens around it.
    focus: null, // {type: node|edge|flow, id}
    // Nodes opened with +N, and nodes shown because they were selected outside the graph's scope.
    expanded: new Set(),
    revealed: new Set(),
    showUnchanged: true,
    // Flows hold no tests, so a scoped graph brings in the tests of what it shows.
    showTests: reviewData.flows.length > 0,
    showImports: false,
    hideReviewed: false,
    // Reviewed flows opened again for this page only; they stay reviewed.
    openFlows: new Set(),
    // The node inspector's tab; every newly selected node opens on its code.
    inspectorTab: "code",
    direction: "RIGHT",
    query: "",
    diffFilter: "all",
    commitFilter: "",
    claimFilter: "all",
    openFiles: new Set(),
    theme: loadPref("cv-theme", "auto"),
    sidebar: loadPref("cv-sidebar", "1") === "1",
    sidebarWidth: clampSidebarWidth(+loadPref("cv-sidebar-w", "320")),
    inspectorWidth: +loadPref("cv-inspector-w", "0") || 0, // 0: CSS default
    codeMode: loadPref("cv-code", "diff") === "after" ? "after" : "diff",
    legend: loadPref("cv-legend", reviewData.nodes.length > LEGEND_FOLDED_ABOVE_NODES ? "0" : "1") === "1",
  };
  const VIEWS = [
    { id: "flows", label: "Flows", icon: "flows", count: () => reviewData.flows.length },
    { id: "graph", label: "Graph", icon: "graph", count: () => reviewData.nodes.length },
    { id: "diff", label: "Diff map", icon: "diff", count: () => reviewData.files.length },
    { id: "claims", label: "Claims", icon: "claims", count: () => reviewData.claims.length },
    { id: "other", label: "Docs & config", icon: "doc", count: () => nonCodeNodes().length },
  ];
  // The non-code tab only appears when the review has such nodes.
  const isViewShown = (view) => view.id !== "other" || view.count() > 0;

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const view = params.get("view");

    if (VIEWS.some((candidate) => candidate.id === view && isViewShown(candidate))) state.view = view;

    state.focus = typedId(params.get("focus"));
    state.selection = typedId(params.get("sel"));
  }

  // "node:fn-a" as {type: "node", id: "fn-a"}, or null.
  function typedId(text) {
    if (!text) return null;

    const colon = text.indexOf(":");

    return { type: text.slice(0, colon), id: text.slice(colon + 1) };
  }

  function writeHash() {
    const params = new URLSearchParams();

    params.set("view", state.view);
    if (state.focus) params.set("focus", `${state.focus.type}:${state.focus.id}`);
    if (state.selection && state.selection.type !== "findings") params.set("sel", `${state.selection.type}:${state.selection.id}`);
    history.replaceState(null, "", "#" + params.toString());
  }

  function applyTheme() {
    const root = document.documentElement;

    if (state.theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", state.theme);
    savePref("cv-theme", state.theme);
  }

  // ── Review marks ───────────────────────────────────────────
  // What the reviewer has read, kept per review file across regenerated
  // pages. Each mark stores the fingerprint of what was read, so a node or
  // hunk whose code changed since counts as unread again.
  const MARKS_KEY = "cv-marks:" + reviewData.repos.map((repo) => repo.abs).join("|") + "|" + reviewData.reviewName;

  function loadMarks() {
    const empty = { nodes: {}, hunks: {}, flows: {} };

    try {
      return { ...empty, ...JSON.parse(localStorage.getItem(MARKS_KEY) || "{}") };
    } catch {
      return empty;
    }
  }

  const marks = loadMarks();

  function saveMarks() {
    savePref(MARKS_KEY, JSON.stringify(marks));
  }

  const FNV_OFFSET = 0x811c9dc5;
  const FNV_PRIME = 0x01000193;
  const FINGERPRINT_RADIX = 36;

  // FNV-1a: short, stable and enough to notice that a piece of code changed.
  function fingerprint(text) {
    let hash = FNV_OFFSET;

    for (const char of text) {
      hash = Math.imul(hash ^ char.charCodeAt(0), FNV_PRIME);
    }

    return (hash >>> 0).toString(FINGERPRINT_RADIX);
  }

  const rowsText = (rows) => (rows || []).map((row) => row.t + (row.h || "")).join("\n");

  function nodeFingerprint(node) {
    const excerpt = node.excerpt && reviewData.excerpts[node.excerpt];
    const code = excerpt ? rowsText(excerpt.rows) : node.label;

    return fingerprint([node.change, node.ref ? node.ref.repo + " " + refText(node.ref) : "", code].join("\n"));
  }

  const hunkFingerprint = (hunk) => fingerprint(rowsText(hunk.rows));
  const flowFingerprint = (flow) => fingerprint(flow.path.join(" "));

  // A mark counts only while what it fingerprinted is unchanged.
  const isMarked = (store, id, currentFingerprint) => marks[store][id] === currentFingerprint;

  function setMark(store, id, currentFingerprint, isOn) {
    if (isOn) marks[store][id] = currentFingerprint;
    else delete marks[store][id];
    saveMarks();
  }

  const isNodeRead = (id) => nodeById.has(id) && isMarked("nodes", id, nodeFingerprint(nodeById.get(id)));
  const setNodeRead = (id, isRead) => setMark("nodes", id, nodeFingerprint(nodeById.get(id)), isRead);
  const isFlowReviewed = (flow) => isMarked("flows", flow.id, flowFingerprint(flow));
  const setFlowReviewed = (flow, isReviewed) => setMark("flows", flow.id, flowFingerprint(flow), isReviewed);
  // A file without hunks (binary, pure rename) is marked by its own id.
  const ownMarkFingerprint = (file, hunk) => (hunk ? hunkFingerprint(hunk) : fingerprint(file.status + file.path));
  const isOwnMarked = (file, hunk) => isMarked("hunks", hunk ? hunk.id : file.id, ownMarkFingerprint(file, hunk));
  const setOwnMark = (file, hunk, isOn) => setMark("hunks", hunk ? hunk.id : file.id, ownMarkFingerprint(file, hunk), isOn);

  // The nodes whose reading covers a hunk: its own nodes and whole-file nodes.
  const coveringNodes = (file, hunk) => [...new Set([...(hunk ? hunk.nodes : []), ...(file.fileNodes || [])])];

  // Reviewed when every covering node is read; a change no node covers needs its own mark.
  function isHunkReviewed(file, hunk) {
    const nodeIds = coveringNodes(file, hunk);

    if (!nodeIds.length) return isOwnMarked(file, hunk);

    return nodeIds.every(isNodeRead);
  }

  function isFileReviewed(file) {
    if (!file.hunks.length) return isHunkReviewed(file, null);

    return file.hunks.every((hunk) => isHunkReviewed(file, hunk));
  }

  // ── Shell ──────────────────────────────────────────────────
  const app = document.getElementById("app");
  let viewEl;
  let inspectorEl;
  let inspectorHandle;
  let tabbarEl;
  let toolbarEl;
  let bodyEl;
  let sidebarButton;
  let readPillEl;

  function render() {
    applyTheme();
    app.innerHTML = "";
    app.appendChild(topbar());
    updateReadPill();

    const banner = errorBanner();

    if (banner) app.appendChild(banner);
    else app.style.gridTemplateRows = "auto 1fr";

    bodyEl = el("div", { class: "body" + (state.sidebar ? "" : " no-sb") });
    bodyEl.style.setProperty("--sb-w", state.sidebarWidth + "px");
    bodyEl.appendChild(sidebar());
    bodyEl.appendChild(sidebarResizer());

    const main = el("div", { class: "main" });

    tabbarEl = el("div", { class: "tabbar" });
    viewEl = el("div", { class: "view" });
    main.append(tabbarEl, viewEl);
    bodyEl.appendChild(main);

    inspectorEl = el("aside", { class: "inspector" });
    inspectorHandle = inspectorResizer();
    applyInspectorWidth();
    bodyEl.appendChild(inspectorEl);
    app.appendChild(bodyEl);

    renderTabs();
    renderView();
    renderInspector();
  }

  const THEME_ICON = { auto: "monitor", light: "sun", dark: "moon" };
  const NEXT_THEME = { auto: "light", light: "dark", dark: "auto" };

  function topbar() {
    const counts = reviewData.counts;
    const errorCount = reviewData.errors.length;
    const warningCount = reviewData.warnings.length;
    const pill = (tone, iconName, count, label, onclick, title) => {
      const isAlerting = count > 0 && (tone === "bad" || tone === "warn");

      return el("button", {
        class: `pill ${tone}${isAlerting ? " has" : ""}`,
        onclick,
        title,
        html: `${icon(iconName, "sm")}<b>${count}</b><span>${escapeHTML(label)}</span>`,
      });
    };
    const repoNames = reviewData.repos.map((repo) => repo.id).join(" · ");

    sidebarButton = el("button", {
      class: "icon-btn" + (state.sidebar ? " on" : ""),
      title: "Toggle side panel ( [ )",
      "aria-pressed": String(state.sidebar),
      html: icon("sidebar"),
      onclick: toggleSidebar,
    });

    return el("header", { class: "topbar" },
      sidebarButton,
      el("div", { class: "brand" }, el("span", { class: "brand-mark", html: icon("logo") }), "task-view"),
      el("div", { class: "crumbs" },
        el("span", { class: "sep" }, "/"),
        el("span", { class: "path", title: reviewData.reviewPath }, repoNames),
        el("span", { class: "sep" }, "/"),
        el("span", { class: "path", title: reviewData.reviewPath }, reviewData.reviewName)),
      el("div", { class: "spacer" }),
      el("div", { class: "pills" },
        pill("ok", "checkcircle", counts.verified, "verified", () => openFindings("all"), "References the tool resolved and checked"),
        pill("bad", "xcircle", counts.contradicted, "contradicted", () => openFindings("contradicted"), "References whose check failed"),
        pill("warn", "help", counts.unresolved, "unresolved", () => openFindings("unresolved"), "References that could not be found"),
        pill("agent", "chat", counts.agentStatements, "agent statements", null, "Content the tool cannot check: shown as the agent's word"),
        el("span", { class: "tb-sep" }),
        pill(
          errorCount ? "bad" : "ok",
          errorCount ? "xcircle" : "checkcircle",
          errorCount,
          plural(errorCount, "error").replace(/^\d+ /, ""),
          () => openFindings("errors"),
          "Errors in the review file",
        ),
        pill(
          warningCount ? "warn" : "ok",
          "alert",
          warningCount,
          plural(warningCount, "warning").replace(/^\d+ /, ""),
          () => openFindings("warnings"),
          "Diff-level findings and warnings",
        ),
        el("span", { class: "tb-sep" }),
        readPillEl = el("span", { class: "pill read", title: "Nodes you marked read (r on a selected node)" })),
      el("button", {
        class: "icon-btn",
        title: `Theme: ${state.theme}`,
        html: icon(THEME_ICON[state.theme]),
        onclick: () => {
          state.theme = NEXT_THEME[state.theme];
          render();
        },
      }));
  }

  function updateReadPill() {
    const readCount = reviewData.nodes.filter((node) => isNodeRead(node.id)).length;

    readPillEl.classList.toggle("done", readCount === reviewData.nodes.length);
    readPillEl.innerHTML = `${icon("check", "sm")}<b>${readCount}/${reviewData.nodes.length}</b><span>read</span>`;
  }

  // Redraws everything that shows review marks after one changed, keeping
  // the graph's camera and the view's scroll position.
  function refreshMarks() {
    updateReadPill();
    renderInspector();

    if (state.view === "graph") {
      if (!graph) return;

      removeOverlayLabels(graph.nodes());
      addOverlayLabels(graph.nodes());
      requestOverlaySync();

      return;
    }

    const scrollTop = viewEl.scrollTop;

    renderView();
    viewEl.scrollTop = scrollTop;
  }

  function toggleNodeRead(id) {
    setNodeRead(id, !isNodeRead(id));
    refreshMarks();
  }

  function errorBanner() {
    if (reviewData.exitCode === 0 || reviewData.errors.length === 0) return null;

    return el("div", { class: "banner", html: icon("alert") },
      el("div", null,
        el("b", null, `This review file has ${plural(reviewData.errors.length, "error")}.`),
        " The views show the account as written; elements marked contradicted or unresolved are not facts. Ask the agent to fix the file and validate again."),
      el("button", { class: "link", onclick: () => openFindings("errors") }, "Show errors →"));
  }

  // ── Sidebar ────────────────────────────────────────────────
  function toggleSidebar() {
    state.sidebar = !state.sidebar;
    savePref("cv-sidebar", state.sidebar ? "1" : "0");
    bodyEl.classList.toggle("no-sb", !state.sidebar);
    sidebarButton.classList.toggle("on", state.sidebar);
    sidebarButton.setAttribute("aria-pressed", String(state.sidebar));
  }

  // Drag handle on a panel edge; double-click resets the width. sign is 1
  // when dragging right widens the panel, -1 when dragging left does.
  function dragHandle(className, sign, getWidth, setWidth, onDone, onReset) {
    const handle = el("div", {
      class: className,
      role: "separator",
      "aria-orientation": "vertical",
      title: "Drag to resize, double-click to reset",
    });

    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      const startWidth = getWidth();

      bodyEl.classList.add("resizing");
      handle.classList.add("dragging");

      const move = (moveEvent) => setWidth(startWidth + sign * (moveEvent.clientX - startX));
      const release = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", release);
        handle.removeEventListener("pointercancel", release);
        bodyEl.classList.remove("resizing");
        handle.classList.remove("dragging");
        onDone();
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", release);
      handle.addEventListener("pointercancel", release);
    });
    handle.addEventListener("dblclick", onReset);

    return handle;
  }

  function sidebarResizer() {
    const setWidth = (width) => {
      state.sidebarWidth = clampSidebarWidth(width);
      bodyEl.style.setProperty("--sb-w", state.sidebarWidth + "px");
    };
    const reset = () => {
      setWidth(SIDEBAR_DEFAULT_WIDTH);
      savePref("cv-sidebar-w", String(SIDEBAR_DEFAULT_WIDTH));
    };

    return dragHandle("sb-resizer", 1, () => state.sidebarWidth, setWidth, () => savePref("cv-sidebar-w", String(state.sidebarWidth)), reset);
  }

  function sidebar() {
    const panel = el("aside", { class: "sidebar" });

    panel.appendChild(el("section", { class: "sb-section" },
      el("h3", { class: "sb-title", html: icon("chat", "sm") + "Summary" }),
      summaryBlock()));

    panel.appendChild(el("section", { class: "sb-section" },
      el("h3", { class: "sb-title", html: icon("repo", "sm") + `Repositories<span class="count">${reviewData.repos.length}</span>` }),
      reviewData.repos.map((repo) => repoCard(repo))));

    panel.appendChild(findingsSection());

    if (reviewData.notes.length) {
      panel.appendChild(el("section", { class: "sb-section" },
        el("h3", { class: "sb-title", html: icon("note", "sm") + `Agent notes<span class="count">${reviewData.notes.length}</span>` }),
        el("ul", { class: "notes" }, reviewData.notes.map((note) => el("li", null, note)))));
    }

    panel.appendChild(el("section", { class: "sb-section muted", style: { fontSize: "11.5px" } },
      `Generated ${new Date(reviewData.generated).toLocaleString()} · task-view ${reviewData.version}`));

    return panel;
  }

  const SUMMARY_CLAMP_CHARS = 280;

  function summaryBlock() {
    const text = el("p", { class: "summary-text clamp" }, reviewData.summary);
    const box = el("div", { class: "agent-says" }, agentTag(), text);

    if (reviewData.summary.length <= SUMMARY_CLAMP_CHARS) {
      text.classList.remove("clamp");

      return box;
    }

    const more = el("button", {
      class: "link more",
      onclick: () => {
        const isClamped = text.classList.toggle("clamp");

        more.textContent = isClamped ? "Show more" : "Show less";
      },
    }, "Show more");

    box.appendChild(more);

    return box;
  }

  // Switches to the diff map, or re-renders it when it is already showing.
  function showDiffMap() {
    if (state.view !== "diff") setView("diff");
    else renderView();
  }

  function filterDiffByCommit(repo, commit) {
    state.commitFilter = `${repo.id}@${commit.sha}`;
    state.diffFilter = "all";
    reviewData.files.filter((file) => file.repo === repo.id).forEach((file) => state.openFiles.add(file.id));
    showDiffMap();
  }

  // One commit of a repo card; filterable commits narrow the diff map on click.
  function commitRow(repo, commit, isFilterable) {
    const date = commit.date ? "· " + new Date(commit.date).toLocaleString() : "";
    const title = commit.worktree
      ? "Uncommitted work on disk"
      : `${commit.sha}\n${commit.subject}\n${commit.author || ""} ${date}`;

    return el("div", {
      class: "commit" + (commit.worktree ? " wt" : "") + (isFilterable ? " clickable" : ""),
      onclick: isFilterable ? () => filterDiffByCommit(repo, commit) : null,
      title,
    },
    el("span", { class: "dot" }),
    el("span", { class: "sha" }, commit.worktree ? "worktree" : commit.short),
    el("span", { class: "subj" }, commit.subject || ""));
  }

  const UNCOMMITTED_PREVIEW_COUNT = 4;

  function repoCard(repo) {
    const isContext = repo.role === "context";
    const card = el("div", { class: "repo-card" });

    card.appendChild(el("div", { class: "repo-head" },
      el("span", { html: icon(isContext ? "eye" : "repo", "sm"), style: { color: "var(--text-3)" } }),
      el("span", { class: "repo-name" }, repo.id),
      el("span", { class: isContext ? "badge context" : "badge role" }, isContext ? "context" : "changed"),
      isContext ? null : el("span", { class: "repo-stats" },
        el("span", { class: "muted" }, plural(repo.files, "file")),
        el("span", { class: "plus" }, `+${repo.added}`),
        el("span", { class: "minus" }, `−${repo.removed}`))));
    card.appendChild(el("div", { class: "repo-path", title: repo.abs }, repo.path));

    const isFilterable = !isContext && repo.commits.length > 1;
    const list = el("div", { class: "commits" }, repo.commits.map((commit) => commitRow(repo, commit, isFilterable)));

    if (repo.base) {
      list.appendChild(el("div", { class: "commit base", title: `Initial state: ${repo.base.sha}\n${repo.base.subject || ""}` },
        el("span", { class: "dot" }),
        el("span", { class: "sha" }, repo.base.short),
        el("span", { class: "subj" }, `base · ${repo.base.subject || ""}`)));
    }
    card.appendChild(list);

    if (repo.uncommitted && repo.uncommitted.length) {
      const preview = repo.uncommitted.slice(0, UNCOMMITTED_PREVIEW_COUNT).join(", ");
      const more = repo.uncommitted.length > UNCOMMITTED_PREVIEW_COUNT ? " …" : "";

      card.appendChild(el("div", {
        class: "callout warn",
        style: { margin: "0 8px 8px", padding: "7px 9px", fontSize: "11.5px" },
        html: icon("alert", "sm"),
      },
      el("div", null,
        `${plural(repo.uncommitted.length, "uncommitted path")} not part of the review: `,
        el("span", { class: "mono" }, preview + more))));
    }

    return card;
  }

  const GROUPED_WARNING_CODES = ["unmentioned_hunk", "unreferenced_test_hunk", "unlisted_repo", "uncommitted_changes", "head_ahead"];
  const FINDING_GROUPS = [
    {
      id: "contradicted",
      label: "Contradicted references",
      level: "err",
      icon: "xcircle",
      match: (finding) => finding.level === "error" && finding.status === "contradicted",
    },
    {
      id: "unresolved",
      label: "Unresolved references",
      level: "err",
      icon: "help",
      match: (finding) => finding.level === "error" && finding.status === "unresolved",
    },
    {
      id: "chain",
      label: "Other errors",
      level: "err",
      icon: "alert",
      match: (finding) => finding.level === "error" && !finding.status,
    },
    {
      id: "unmentioned_hunk",
      label: "Unmentioned changes",
      level: "warn",
      icon: "diff",
      match: (finding) => finding.code === "unmentioned_hunk",
    },
    {
      id: "unreferenced_test_hunk",
      label: "Unreferenced test code",
      level: "warn",
      icon: "test",
      match: (finding) => finding.code === "unreferenced_test_hunk",
    },
    {
      id: "unlisted_repo",
      label: "Unlisted repos",
      level: "warn",
      icon: "repo",
      match: (finding) => finding.code === "unlisted_repo",
    },
    {
      id: "uncommitted",
      label: "Work outside the review",
      level: "warn",
      icon: "branch",
      match: (finding) => finding.code === "uncommitted_changes" || finding.code === "head_ahead",
    },
    {
      id: "other",
      label: "Other warnings",
      level: "warn",
      icon: "alert",
      match: (finding) => finding.level === "warning" && !GROUPED_WARNING_CODES.includes(finding.code),
    },
  ];

  function changedTests() {
    return reviewData.nodes.filter((node) => node.kind === "test" && node.change !== "unchanged" && node.result.status === "verified");
  }

  function findingsSection() {
    const section = el("section", { class: "sb-section" },
      el("h3", { class: "sb-title", html: icon("alert", "sm") + `Findings<span class="count">${allFindings.length}</span>` }));
    const groups = FINDING_GROUPS
      .map((group) => ({ group, count: allFindings.filter(group.match).length }))
      .filter(({ count }) => count);

    groups.forEach(({ group, count }) => {
      section.appendChild(el("button", {
        class: `finding-group ${group.level}`,
        onclick: () => openFindings(group.id),
        html: icon(group.icon) + `<span>${escapeHTML(group.label)}</span><span class="n">${count}</span>`,
      }));
    });
    if (!groups.length) section.appendChild(el("div", { class: "all-clear", html: icon("checkcircle") + "The account matches the diff" }));

    const tests = changedTests();

    if (tests.length) {
      section.appendChild(el("button", {
        class: "finding-group info",
        onclick: () => openFindings("tests"),
        html: icon("test") + `<span>Changed tests</span><span class="n">${tests.length}</span>`,
      }));
    }

    return section;
  }

  // ── Tabs & toolbar ─────────────────────────────────────────
  function renderTabs() {
    tabbarEl.innerHTML = "";
    VIEWS.forEach((view, i) => {
      if (!isViewShown(view)) return;

      tabbarEl.appendChild(el("button", {
        class: "tab" + (state.view === view.id ? " on" : ""),
        title: `${view.label} (${i + 1})`,
        onclick: () => setView(view.id),
        html: `${icon(view.icon)}${escapeHTML(view.label)}<span class="n">${view.count()}</span>`,
      }));
    });
    toolbarEl = el("div", { class: "toolbar" });
    tabbarEl.appendChild(toolbarEl);
  }

  function setView(id) {
    if (state.view === id) return;

    state.view = id;
    renderTabs();
    renderView();
    writeHash();
  }

  function renderView() {
    destroyGraph();
    viewEl.innerHTML = "";
    viewEl.scrollTop = 0;
    toolbarEl.innerHTML = "";

    const renderers = { graph: graphView, flows: flowsView, diff: diffView, claims: claimsView, other: otherView };

    renderers[state.view]();
  }

  function select(selection) {
    const isNewNode = selection && selection.type === "node" && !(state.selection && state.selection.type === "node" && state.selection.id === selection.id);

    if (isNewNode) state.inspectorTab = "code";
    state.selection = selection;
    // Flows picks what the graph shows; selecting inside the graph only changes the inspector.
    if (state.view === "flows" && isGraphSelection(selection)) setFocus(selection);
    renderInspector();
    if (state.view === "graph" && revealInGraph(selection)) {
      syncFilterToggles();
      refreshGraph();
    } else {
      highlightSelection();
    }
    writeHash();
  }

  // Scopes the graph to a step, an edge or a flow; null leaves nothing to show.
  function setFocus(focus) {
    state.focus = focus;
    state.expanded = new Set();
    state.revealed = new Set();
    if (state.view === "graph") renderView();
    else highlightSelection();
    writeHash();
  }

  const isGraphSelection = (selection) => selection && (selection.type === "node" || selection.type === "edge");

  // ── Graph view ─────────────────────────────────────────────
  let graph = null;
  let overlay = null;
  let overlayLayer = null;
  // The HTML card drawn over each graph node, by graph node id.
  const overlayLabels = new Map();
  // Bumped per layout so a slower, superseded run never settles the camera.
  let layoutRun = 0;
  let tooltipEl = null;

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  const measureContext = document.createElement("canvas").getContext("2d");

  function textWidth(text, font) {
    measureContext.font = font;

    return measureContext.measureText(text).width;
  }

  function nodeSubtitle(node) {
    if (node.ref && node.ref.file) return `${basename(node.ref.file)}${linesText(node.ref)}`;
    if (node.ref && node.ref.type === "commit") return `commit ${shortSha(node.ref.sha)}`;

    return node.kind;
  }

  // Wide enough for the longer of label and subtitle; an observed test result adds a line.
  const NODE_BOX = { minWidth: 150, maxWidth: 290, padding: 74, height: 52, observedHeight: 66 };

  function nodeSize(node) {
    const labelWidth = textWidth(node.label, "600 12.5px " + cssVar("--font"));
    const subWidth = textWidth(nodeSubtitle(node), "10.5px " + cssVar("--mono"));
    const width = Math.max(NODE_BOX.minWidth, Math.min(NODE_BOX.maxWidth, Math.max(labelWidth, subWidth) + NODE_BOX.padding));
    const hasObserved = node.kind === "test" && node.meta && node.meta.some((meta) => meta.key === "observed");

    return { width: Math.round(width), height: hasObserved ? NODE_BOX.observedHeight : NODE_BOX.height };
  }

  // Many edges: fade them so the nodes stay readable.
  const DENSE_GRAPH_EDGES = 40;
  const DENSE_EDGE_OPACITY = 0.55;

  function graphStyle() {
    const fill = {
      added: cssVar("--added-fill"),
      modified: cssVar("--modified-fill"),
      deleted: cssVar("--deleted-fill"),
      unchanged: cssVar("--unchanged-fill"),
    };

    return [
      {
        selector: "node",
        style: {
          shape: "round-rectangle",
          "corner-radius": 8,
          width: "data(w)",
          height: "data(h)",
          "background-color": (graphNode) => fill[graphNode.data("change")] || fill.unchanged,
          "border-width": 1.5,
          "border-color": cssVar("--text-3"),
          "border-style": "solid",
          label: "",
          "transition-property": "opacity",
          "transition-duration": "120ms",
        },
      },
      { selector: "node.test", style: { "corner-radius": 26 } },
      { selector: "node.verified", style: { "border-width": 1.5, "border-color": cssVar("--text-2") } },
      { selector: "node.contradicted", style: { "border-width": 2.5, "border-color": cssVar("--bad") } },
      { selector: "node.unresolved", style: { "border-width": 2, "border-color": cssVar("--warn"), "border-style": "dashed" } },
      { selector: "node.agent", style: { "border-width": 2, "border-color": cssVar("--agent"), "border-style": "dotted" } },
      {
        selector: "node.repo",
        style: {
          shape: "round-rectangle",
          "corner-radius": 14,
          "background-color": cssVar("--panel"),
          "background-opacity": 0.65,
          "border-width": 1,
          "border-color": cssVar("--repo-border"),
          "border-style": "solid",
          padding: 30,
          "compound-sizing-wrt-labels": "exclude",
        },
      },
      { selector: "node.repo.context", style: { "border-style": "dashed", "background-opacity": 0.35 } },
      {
        selector: "node:selected",
        style: {
          "underlay-color": cssVar("--accent"),
          "underlay-padding": 5,
          "underlay-opacity": 0.22,
          "underlay-shape": "round-rectangle",
          "underlay-corner-radius": 11,
        },
      },
      { selector: "node.repo:selected", style: { "underlay-opacity": 0 } },
      {
        selector: "edge",
        style: {
          width: 1.6,
          "line-color": cssVar("--text-3"),
          "target-arrow-color": cssVar("--text-3"),
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.9,
          "curve-style": "bezier",
          "control-point-step-size": 40,
          label: "data(kind)",
          "font-size": 10,
          "font-family": cssVar("--font"),
          color: cssVar("--text-2"),
          "text-background-color": cssVar("--bg"),
          "text-background-opacity": 1,
          "text-background-padding": 3,
          "text-background-shape": "round-rectangle",
          "text-border-width": 1,
          "text-border-color": cssVar("--border"),
          "text-border-opacity": 1,
          "line-style": "dotted",
          "min-zoomed-font-size": 7,
          "line-opacity": reviewData.edges.length > DENSE_GRAPH_EDGES ? DENSE_EDGE_OPACITY : 1,
          "transition-property": "opacity",
          "transition-duration": "120ms",
        },
      },
      { selector: "edge.verified", style: { "line-style": "solid", "line-color": cssVar("--text-2"), "target-arrow-color": cssVar("--text-2") } },
      {
        selector: "edge.contradicted",
        style: {
          "line-style": "solid",
          width: 2.2,
          "line-color": cssVar("--bad"),
          "target-arrow-color": cssVar("--bad"),
          color: cssVar("--bad"),
        },
      },
      {
        selector: "edge.unresolved",
        style: {
          "line-style": "dashed",
          "line-color": cssVar("--warn"),
          "target-arrow-color": cssVar("--warn"),
          color: cssVar("--warn"),
        },
      },
      { selector: "edge.tests", style: { "target-arrow-shape": "triangle-backcurve" } },
      { selector: "edge.focus", style: { "line-opacity": 1, "z-index": 10, "min-zoomed-font-size": 0 } },
      {
        selector: "edge:selected",
        style: {
          width: 3,
          "line-color": cssVar("--accent"),
          "target-arrow-color": cssVar("--accent"),
          color: cssVar("--accent-text"),
        },
      },
      { selector: ".dim, .miss", style: { opacity: 0.22 } },
      {
        selector: "node.hit",
        style: {
          "underlay-color": cssVar("--warn"),
          "underlay-padding": 5,
          "underlay-opacity": 0.28,
          "underlay-shape": "round-rectangle",
        },
      },
      // Elements a filter just added stay invisible until the layout has placed them.
      { selector: ".entering", style: { opacity: 0 } },
    ];
  }

  // The graph opens on source code only; tests and import lines sit behind
  // toggles, each named by the state key that shows its group.
  const DOC_FILE = /\.(md|mdx|markdown|rst|adoc|txt)$/i;
  const GROUP_TOGGLES = { test: "showTests", imports: "showImports" };

  function nodeGroup(node) {
    if (node.kind === "test") return "test";
    if (node.kind === "imports") return "imports";

    const isDoc = kindIcon(node.kind) === "doc" || (node.ref && node.ref.file && DOC_FILE.test(node.ref.file));

    if (isDoc) return "doc";

    return "source";
  }

  // Docs, and config no code reads, never link to code: they get their own
  // tab instead of floating unconnected in the graph.
  function isNonCode(node) {
    const isUnlinkedConfig = node.kind === "config" && !outgoingEdges(node.id).length && !incomingEdges(node.id).length;

    return nodeGroup(node) === "doc" || isUnlinkedConfig;
  }

  const nonCodeNodes = () => reviewData.nodes.filter(isNonCode);

  // The Unchanged, Tests and Imports switches.
  function passesToggles(node) {
    const group = nodeGroup(node);
    const changeShown = state.showUnchanged || node.change !== "unchanged";
    const toggleKey = GROUP_TOGGLES[group];
    const groupShown = !toggleKey || state[toggleKey];

    return changeShown && groupShown;
  }

  // A review with flows scopes its graph to what Flows picked; without flows
  // nothing could pick, so the whole graph shows.
  const isScoped = () => reviewData.flows.length > 0;

  // The nodes a focus stands for: a step, an edge's two ends or a whole flow.
  function focusNodeIds(focus) {
    if (!focus) return [];
    if (focus.type === "node") return [focus.id];
    if (focus.type === "edge") {
      const edge = edgeById.get(focus.id);

      return edge ? [edge.from, edge.to] : [];
    }

    const flow = reviewData.flows.find((candidate) => candidate.id === focus.id);

    return flow ? flow.path : [];
  }

  // Nodes one edge away, either direction; docs and config never join the graph.
  const graphNeighbours = (id) => [...outgoingEdges(id).map((edge) => edge.to), ...incomingEdges(id).map((edge) => edge.from)]
    .filter((other) => nodeById.has(other) && !isNonCode(nodeById.get(other)));

  // The base nodes plus, ring after ring, what every visible node brings
  // along (attachedOf: its tests) and the neighbours of every visible
  // expanded node. An expanded node counts only while visible, so closing a
  // node also drops what the nodes it opened had opened.
  function scopedNodeIds(baseIds, expanded, neighboursOf, attachedOf, isShown) {
    const visible = new Set(baseIds);
    const nextRing = () => [...visible]
      .flatMap((id) => [...attachedOf(id), ...(expanded.has(id) ? neighboursOf(id) : [])])
      .filter((id) => !visible.has(id) && isShown(id));

    for (let ring = nextRing(); ring.length; ring = nextRing()) {
      ring.forEach((id) => visible.add(id));
    }

    return visible;
  }

  // The ids of the nodes the graph shows.
  function graphNodeIds() {
    const isCode = (id) => nodeById.has(id) && !isNonCode(nodeById.get(id));

    if (!isScoped()) return new Set(reviewData.nodes.filter((node) => !isNonCode(node) && passesToggles(node)).map((node) => node.id));

    const baseIds = [...focusNodeIds(state.focus), ...state.revealed].filter(isCode);

    const testIds = (id) => testsOf(id).map((edge) => edge.from);

    return scopedNodeIds(baseIds, state.expanded, graphNeighbours, testIds, (id) => passesToggles(nodeById.get(id)));
  }

  // Brings a selection the graph does not show into it: added to the scope,
  // or, in a whole graph, by turning its filters on. True when one changed.
  function revealInGraph(selection) {
    if (!isGraphSelection(selection)) return false;

    const edge = selection.type === "edge" ? edgeById.get(selection.id) : null;
    const shownIds = graphNodeIds();
    const hidden = (edge ? [edge.from, edge.to] : [selection.id])
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .filter((node) => !isNonCode(node) && !shownIds.has(node.id));

    hidden.forEach((node) => {
      const group = nodeGroup(node);

      if (isScoped()) {
        state.revealed.add(node.id);

        return;
      }
      if (node.change === "unchanged") state.showUnchanged = true;
      if (GROUP_TOGGLES[group]) state[GROUP_TOGGLES[group]] = true;
    });

    return hidden.length > 0;
  }

  function graphElements() {
    const shownIds = graphNodeIds();
    const visible = reviewData.nodes.filter((node) => shownIds.has(node.id));
    const visibleIds = new Set(visible.map((node) => node.id));
    // One repo: the header already names it, so skip the box.
    const listedRepos = new Set(reviewData.nodes.filter((node) => node.ref && repoById.get(node.ref.repo)).map((node) => node.ref.repo));
    const boxRepos = listedRepos.size > 1;
    const parentRepo = (node) => (boxRepos && node.ref && repoById.get(node.ref.repo) ? node.ref.repo : null);
    const usedRepos = new Set(visible.map(parentRepo).filter(Boolean));
    const nodeElements = visible.map((node) => {
      const repo = parentRepo(node);
      const size = nodeSize(node);

      return {
        group: "nodes",
        data: { id: node.id, change: node.change, w: size.width, h: size.height, parent: repo ? "repo:" + repo : undefined },
        classes: [node.result.status, node.kind === "test" ? "test" : "", "change-" + node.change].join(" "),
      };
    });
    const repoElements = reviewData.repos
      .filter((repo) => usedRepos.has(repo.id))
      .map((repo) => ({
        group: "nodes",
        data: { id: "repo:" + repo.id, repo: repo.id },
        classes: "repo" + (repo.role === "context" ? " context" : ""),
      }));
    const edgeElements = reviewData.edges
      .filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to))
      .map((edge) => ({
        group: "edges",
        data: { id: edge.id, source: edge.from, target: edge.to, kind: edge.kind },
        classes: [edge.result.status, edge.kind === "tests" ? "tests" : ""].join(" "),
      }));

    return [...nodeElements, ...repoElements, ...edgeElements];
  }

  const GRAPH_CAMERA = {
    padding: 48,
    zoomIn: 1.25,
    zoomOut: 0.8,
    searchHitZoom: 0.9,
    maxStartZoom: 1.15,
    minReadableZoom: 0.5,
    largeGraphZoom: 0.62,
  };
  const ANIMATION_MS = { pan: 220, zoom: 160, keepInView: 200, relayout: 320 };
  const RELAYOUT_EASING = "ease-in-out-cubic";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  function focusFirstSearchHit() {
    const hit = graph.nodes(".hit").first();

    if (!hit.length) return;

    select({ type: "node", id: hit.id() });
    graph.animate({ center: { eles: hit }, zoom: Math.max(graph.zoom(), GRAPH_CAMERA.searchHitZoom) }, { duration: ANIMATION_MS.pan });
  }

  function graphToolbar() {
    const directionButton = (direction, label, title) => el("button", {
      class: state.direction === direction ? "on" : "",
      onclick: (event) => {
        if (state.direction === direction) return;

        state.direction = direction;
        event.currentTarget.parentElement.querySelectorAll("button").forEach((button) => button.classList.toggle("on", button === event.currentTarget));
        refreshGraph();
      },
      title,
    }, label);
    const directionToggle = el("div", { class: "seg" },
      directionButton("RIGHT", "→", "Left to right"),
      directionButton("DOWN", "↓", "Top to bottom"));
    const graphNodes = reviewData.nodes.filter((node) => !isNonCode(node));
    const unchangedCount = graphNodes.filter((node) => node.change === "unchanged").length;
    const testCount = graphNodes.filter((node) => nodeGroup(node) === "test").length;
    const importsCount = graphNodes.filter((node) => nodeGroup(node) === "imports").length;
    const toggle = (key, label, count, title) => el("label", { class: "toggle", title },
      el("input", {
        type: "checkbox",
        checked: state[key],
        onchange: (event) => {
          state[key] = event.target.checked;
          refreshGraph();
        },
        "data-toggle": key,
      }),
      el("span", { class: "sw" }),
      `${label} (${count})`);
    const search = el("input", {
      class: "search",
      type: "search",
      placeholder: "Find node…  /",
      value: state.query || "",
      oninput: (event) => {
        state.query = event.target.value;
        applySearch();
      },
      onkeydown: (event) => {
        if (event.key === "Enter" && graph) focusFirstSearchHit();
        if (event.key === "Escape") {
          search.value = "";
          state.query = "";
          applySearch();
          search.blur();
        }
      },
    });

    // A review without tests or imports gets no switch for them. Native append
    // would print a skipped switch as the text "null", so drop it first.
    const toolbarItems = [
      ...(isScoped() ? [focusChip(), el("button", {
        class: "link",
        title: "Close every node you opened",
        onclick: () => {
          state.expanded = new Set();
          refreshGraph();
        },
      }, "Collapse all"), el("span", { class: "tb-sep" })] : []),
      search,
      el("span", { class: "tb-sep" }),
      toggle("showUnchanged", "Unchanged", unchangedCount, "Show nodes the change does not modify"),
      testCount ? toggle("showTests", "Tests", testCount, "Show test nodes") : null,
      importsCount ? toggle("showImports", "Imports", importsCount, "Show nodes for import and other top-level lines") : null,
      el("span", { class: "tb-sep" }),
      directionToggle,
    ];

    toolbarEl.append(...toolbarItems.filter(Boolean));
  }

  const FOCUS_ICON = { node: "target", edge: "arrow", flow: "flows" };

  function focusLabel(focus) {
    if (focus.type === "node") return nodeById.get(focus.id)?.label || focus.id;
    if (focus.type === "edge") {
      const edge = edgeById.get(focus.id);

      return edge ? `${nodeById.get(edge.from).label} → ${nodeById.get(edge.to).label}` : focus.id;
    }

    return reviewData.flows.find((flow) => flow.id === focus.id)?.title || focus.id;
  }

  // What Flows picked, with × to clear it.
  function focusChip() {
    return el("span", { class: "focus-chip", title: "Picked in Flows: the graph grows from it" },
      el("span", { html: icon(FOCUS_ICON[state.focus.type], "sm") }),
      el("span", { class: "fl" }, focusLabel(state.focus)),
      el("button", { class: "icon-btn", title: "Clear: pick again in Flows", html: icon("close", "sm"), onclick: () => setFocus(null) }));
  }

  function graphControls() {
    return el("div", { class: "graph-controls" },
      el("button", { class: "icon-btn", title: "Zoom in", html: icon("plus"), onclick: () => zoomBy(GRAPH_CAMERA.zoomIn) }),
      el("button", { class: "icon-btn", title: "Zoom out", html: icon("minus"), onclick: () => zoomBy(GRAPH_CAMERA.zoomOut) }),
      el("button", {
        class: "icon-btn",
        title: "Fit to screen",
        html: icon("fit"),
        onclick: () => graph && graph.animate({ fit: { padding: GRAPH_CAMERA.padding } }, { duration: ANIMATION_MS.pan }),
      }));
  }

  function repoTag(repo) {
    const isContext = repo.role === "context";
    const role = isContext ? "context · read only" : escapeHTML(repo.worktree ? "worktree" : shortSha(repo.commits[0]?.sha));

    return el("div", { class: "gl", html: icon(isContext ? "eye" : "repo", "sm") + `<span>${escapeHTML(repo.id)}</span><span class="role">${role}</span>` });
  }

  // Icon, label, subtitle and problem marker shared by graph overlay cards and flow cards.
  function nodeCardBody(node, statusIconClass) {
    const observed = observedMeta(node);
    const status = node.result.status;

    return [
      el("div", { class: "ic", html: icon(kindIcon(node.kind)) }),
      el("div", { class: "tx" },
        el("div", { class: "lb" }, node.label),
        el("div", { class: "sb" }, `${node.kind} · ${nodeSubtitle(node)}`),
        observed ? el("span", { class: "says " + observedClass(observed.value) }, `agent says: ${observed.value}`) : null),
      isProblemStatus(status) ? el("div", { class: `st ${status}`, html: icon(STATUS_ICON[status], statusIconClass) }) : null,
      isNodeRead(node.id) ? el("div", { class: "rd", title: "Read", html: icon("check") }) : null,
    ];
  }

  const readClass = (node) => (isNodeRead(node.id) ? " read" : "");

  // The HTML drawn over a graph node: a node card, or the name tag of a repo
  // box. shownIds are the nodes on the graph, for the card's +N count.
  function overlayLabel(graphNode, shownIds) {
    if (graphNode.hasClass("repo")) return repoTag(repoById.get(graphNode.data("repo")));

    const node = nodeById.get(graphNode.id());

    return el("div", {
      class: `gn ${node.change} ${node.result.status}${readClass(node)}`,
      style: { width: graphNode.data("w") + "px", height: graphNode.data("h") + "px" },
    }, nodeCardBody(node, ""), isScoped() ? hopButton(node, shownIds) : null);
  }

  // +N opens a node's hidden neighbours; − closes what it opened.
  function hopButton(node, shownIds) {
    const isExpanded = state.expanded.has(node.id);
    const hiddenCount = new Set(graphNeighbours(node.id).filter((id) => !shownIds.has(id) && passesToggles(nodeById.get(id)))).size;

    if (!isExpanded && !hiddenCount) return null;

    return el("button", {
      class: "hop" + (isExpanded ? " open" : ""),
      title: isExpanded ? "Hide the neighbours this node opened" : `Show ${plural(hiddenCount, "hidden neighbour")}`,
      onclick: (event) => {
        event.stopPropagation();
        if (isExpanded) state.expanded.delete(node.id);
        else state.expanded.add(node.id);
        refreshGraph();
      },
    }, isExpanded ? "−" : `+${hiddenCount}`);
  }

  const REPO_TAG_OFFSET = { x: 14, y: 7 };

  // Top-left corner, in graph coordinates, of a graph node's overlay label.
  function labelPosition(graphNode) {
    if (graphNode.hasClass("repo")) {
      const box = graphNode.boundingBox({ includeLabels: false, includeOverlays: false, includeUnderlays: false });

      return { left: box.x1 + REPO_TAG_OFFSET.x, top: box.y1 + REPO_TAG_OFFSET.y };
    }

    const position = graphNode.position();

    return { left: position.x - graphNode.data("w") / 2, top: position.y - graphNode.data("h") / 2 };
  }

  const SELECTION_EDGE_MARGIN = 20;

  // Keep the selection in view when the inspector opens.
  function keepSelectionInView() {
    const selected = graph.$(":selected");

    if (!selected.length) return;

    const box = selected.renderedBoundingBox();
    const width = graph.width();
    const height = graph.height();
    const isNearEdge = box.x2 > width - SELECTION_EDGE_MARGIN
      || box.x1 < SELECTION_EDGE_MARGIN
      || box.y1 < SELECTION_EDGE_MARGIN
      || box.y2 > height - SELECTION_EDGE_MARGIN;

    if (isNearEdge) graph.animate({ center: { eles: selected } }, { duration: ANIMATION_MS.keepInView });
  }

  function graphLayoutOptions() {
    // Spacing must be set on every compound too: ELK reads it per graph level.
    const spacing = {
      "elk.direction": state.direction,
      "elk.layered.spacing.nodeNodeBetweenLayers": 96,
      "elk.spacing.nodeNode": 30,
      "elk.layered.spacing.edgeNodeBetweenLayers": 28,
      "elk.spacing.edgeNode": 24,
      "elk.spacing.componentComponent": 56,
      "elk.padding": "[top=50,left=30,bottom=30,right=30]",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    };

    return {
      name: typeof cytoscapeElk !== "undefined" ? "elk" : "breadthfirst",
      // settleCamera places the camera instead, so it can clamp the zoom in
      // the same motion as the nodes move.
      fit: false,
      animate: false,
      nodeDimensionsIncludeLabels: false,
      nodeLayoutOptions: (layoutNode) => (layoutNode.isParent() ? spacing : {}),
      elk: {
        algorithm: "layered",
        "elk.hierarchyHandling": "INCLUDE_CHILDREN",
        "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
        ...spacing,
      },
    };
  }

  // The camera a laid-out graph settles on: fitted to box, never closer than
  // maxStartZoom, and when fitting would shrink it to a speck, readable at
  // anchor (a point in graph coordinates, or null) instead.
  function settledCamera(box, anchor, width, height) {
    const padding = GRAPH_CAMERA.padding;
    const fitZoom = Math.min((width - 2 * padding) / box.w, (height - 2 * padding) / box.h);
    const isUnreadable = fitZoom < GRAPH_CAMERA.minReadableZoom && anchor;
    const zoom = isUnreadable ? GRAPH_CAMERA.largeGraphZoom : Math.min(fitZoom, GRAPH_CAMERA.maxStartZoom);
    const center = isUnreadable ? anchor : { x: box.x1 + box.w / 2, y: box.y1 + box.h / 2 };

    return { zoom, pan: { x: width / 2 - zoom * center.x, y: height / 2 - zoom * center.y } };
  }

  // Moves the camera onto the laid-out graph; positionOf gives a node's final position.
  function settleCamera(positionOf, isAnimated) {
    const leafNodes = graph.nodes().not(".repo");

    if (leafNodes.empty()) return;

    // A scoped graph opens on what Flows picked, a whole one on the first flow's entry.
    const anchorId = focusNodeIds(state.focus)[0] || reviewData.flows[0]?.path[0];
    const entry = anchorId ? graph.getElementById(anchorId) : graph.collection();
    const anchorNode = entry.length ? entry : leafNodes.first();
    const box = graph.elements().boundingBoxAt(positionOf);
    const camera = settledCamera(box, positionOf(anchorNode), graph.width(), graph.height());

    if (!isAnimated) {
      graph.viewport(camera);

      return;
    }

    graph.animate(camera, { duration: ANIMATION_MS.relayout, easing: RELAYOUT_EASING });
  }

  // Lays the graph out and settles the camera. Animated, the nodes and the
  // camera glide from where they are, while nodes marked entering appear at
  // their final place and fade in.
  function runGraphLayout(isAnimated) {
    const run = ++layoutRun;
    const finalPositions = new Map();
    const layout = graph.layout({
      ...graphLayoutOptions(),
      animate: isAnimated,
      animationDuration: ANIMATION_MS.relayout,
      animationEasing: RELAYOUT_EASING,
      animateFilter: (layoutNode) => !layoutNode.hasClass("entering"),
      transform: (layoutNode, position) => {
        finalPositions.set(layoutNode.id(), position);

        return position;
      },
    });

    layout.on("layoutready", () => {
      if (run !== layoutRun) return;

      settleCamera((graphNode) => finalPositions.get(graphNode.id()) || graphNode.position(), isAnimated);
      graph.elements(".entering").removeClass("entering");
      requestOverlaySync();
    });

    // Dimming is applied before the layout so entering nodes fade straight
    // to their final opacity instead of fading in and then dimming.
    highlightSelection();
    applySearch();
    layout.run();
  }

  // Brings the graph in line with the filters without rebuilding it, so the
  // nodes that stay glide to their new places instead of the view jumping.
  function refreshGraph() {
    if (!graph) {
      renderView();

      return;
    }

    const wanted = graphElements();
    const wantedIds = new Set(wanted.map((element) => element.data.id));
    const leaving = graph.elements().filter((element) => !wantedIds.has(element.id()));
    const entering = wanted
      .filter((element) => graph.getElementById(element.data.id).empty())
      .map((element) => ({ ...element, classes: element.classes + " entering" }));

    graph.stop(true);
    graph.elements().stop(true);
    hideTooltip();
    removeOverlayLabels(graph.nodes());
    graph.remove(leaving);
    graph.add(entering);
    // The +N counts change on nodes that stay, so every card is redrawn.
    addOverlayLabels(graph.nodes());
    runGraphLayout(!reducedMotion.matches);
  }

  function addOverlayLabels(graphNodes) {
    const shownIds = new Set(graph.nodes().map((graphNode) => graphNode.id()));

    graphNodes.forEach((graphNode) => {
      const label = overlayLabel(graphNode, shownIds);

      // Hidden from the start so an entering card never flashes before its first sync.
      label.classList.toggle("entering", graphNode.hasClass("entering"));
      overlayLayer.appendChild(label);
      overlayLabels.set(graphNode.id(), label);
    });
  }

  function removeOverlayLabels(graphNodes) {
    graphNodes.forEach((graphNode) => {
      overlayLabels.get(graphNode.id())?.remove();
      overlayLabels.delete(graphNode.id());
    });
  }

  // Shows each filter switch as on or off after a selection turned filters on.
  function syncFilterToggles() {
    for (const input of toolbarEl.querySelectorAll("input[data-toggle]")) {
      input.checked = state[input.dataset.toggle];
    }
  }

  function graphView() {
    if (isScoped() && !state.focus) {
      viewEl.appendChild(el("div", { class: "empty" },
        el("div", null,
          htmlFragment(icon("graph")),
          el("div", null, "Pick a step, an edge or a flow title in Flows to see it here."),
          el("button", { class: "link", onclick: () => setView("flows") }, "Go to Flows →"))));

      return;
    }

    graphToolbar();

    if (typeof cytoscape === "undefined") {
      viewEl.appendChild(el("div", { class: "empty" }, "Graph renderer failed to load."));

      return;
    }

    const wrap = el("div", { class: "graph-wrap" });
    const container = el("div", { class: "cy" });

    overlayLayer = el("div", { class: "cy-layer" });
    overlay = el("div", { class: "cy-overlay" });
    overlay.appendChild(overlayLayer);
    wrap.append(container, overlay);
    wrap.appendChild(graphControls());
    wrap.appendChild(legend());
    viewEl.appendChild(wrap);

    if (typeof cytoscapeElk !== "undefined" && !cytoscape.__elk) {
      cytoscape.use(cytoscapeElk);
      cytoscape.__elk = true;
    }

    graph = cytoscape({
      container,
      elements: graphElements(),
      style: graphStyle(),
      wheelSensitivity: 0.25,
      minZoom: 0.15,
      maxZoom: 2.5,
      boxSelectionEnabled: false,
      autoungrabify: false,
    });

    // HTML overlay for rich node content.
    addOverlayLabels(graph.nodes());

    let frameRequest = 0;
    const syncOverlay = () => {
      frameRequest = 0;

      // The inspector asks for a sync after its transition, even once another view replaced the graph.
      if (!graph) return;

      const pan = graph.pan();
      const zoom = graph.zoom();

      overlayLayer.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
      graph.nodes().forEach((graphNode) => {
        const label = overlayLabels.get(graphNode.id());

        if (!label) return;

        const position = labelPosition(graphNode);

        label.style.left = position.left + "px";
        label.style.top = position.top + "px";
        label.classList.toggle("dim", graphNode.hasClass("dim") || graphNode.hasClass("miss"));
        label.classList.toggle("entering", graphNode.hasClass("entering"));
      });
    };
    const scheduleSync = () => {
      if (!frameRequest) frameRequest = requestAnimationFrame(syncOverlay);
    };

    graph.on("render viewport position", scheduleSync);
    overlay.__sync = scheduleSync;

    const resizeObserver = new ResizeObserver(() => {
      if (!graph) return;

      graph.resize();
      scheduleSync();
      keepSelectionInView();
    });

    resizeObserver.observe(container);
    graph.on("destroy", () => resizeObserver.disconnect());

    graph.on("tap", "node", (event) => {
      const id = event.target.id();

      if (id.startsWith("repo:")) return;

      select({ type: "node", id });
    });
    graph.on("tap", "edge", (event) => select({ type: "edge", id: event.target.id() }));
    graph.on("tap", (event) => {
      if (event.target === graph) select(null);
    });

    graph.on("mouseover", "node, edge", (event) => {
      const target = event.target;

      if (target.isNode() && target.hasClass("repo")) return;

      showTooltip(event.originalEvent, target.isNode() ? nodeTooltip(nodeById.get(target.id())) : edgeTooltip(edgeById.get(target.id())));
      container.style.cursor = "pointer";
    });
    graph.on("mousemove", "node, edge", (event) => moveTooltip(event.originalEvent));
    graph.on("mouseout", "node, edge", () => {
      hideTooltip();
      container.style.cursor = "";
    });

    runGraphLayout(false);
  }

  // The overlay of the last graph view registers its sync; it outlives the graph.
  function requestOverlaySync() {
    if (overlay && overlay.__sync) overlay.__sync();
  }

  function applySearch() {
    if (!graph) return;

    const query = (state.query || "").trim().toLowerCase();

    graph.batch(() => {
      graph.nodes().removeClass("hit miss");
      if (!query) return;

      graph.nodes().not(".repo").forEach((graphNode) => {
        const node = nodeById.get(graphNode.id());
        const text = `${node.label} ${node.id} ${node.kind} ${node.ref && node.ref.file ? node.ref.file : ""}`.toLowerCase();

        graphNode.addClass(text.includes(query) ? "hit" : "miss");
      });
    });
    requestOverlaySync();
  }

  function zoomBy(factor) {
    if (!graph) return;

    const level = graph.zoom() * factor;

    graph.animate({ zoom: { level, renderedPosition: { x: graph.width() / 2, y: graph.height() / 2 } } }, { duration: ANIMATION_MS.zoom });
  }

  function destroyGraph() {
    if (graph) {
      graph.destroy();
      graph = null;
    }
    overlayLabels.clear();
    hideTooltip();
  }

  // Selects the element and dims everything outside its neighbourhood.
  function highlightGraphSelection() {
    graph.elements().unselect().removeClass("dim focus");

    const selection = state.selection;

    if (!isGraphSelection(selection)) return;

    const element = graph.getElementById(selection.id);

    if (!element || !element.length) return;

    element.select();

    const kept = selection.type === "node" ? element.closedNeighborhood() : element.union(element.connectedNodes());

    kept.edges().addClass("focus");

    const parents = kept.nodes().parents();

    graph.elements().not(kept).not(parents).addClass("dim");
  }

  function highlightSelection() {
    if (graph) {
      graph.batch(highlightGraphSelection);
      requestOverlaySync();
    }

    // Flows marks what it picked for the graph, whatever the graph selected since.
    const focus = state.focus;
    const isFocused = (type, id) => Boolean(focus && focus.type === type && focus.id === id);
    const selection = state.selection;
    const isNodeSelection = selection && selection.type === "node";

    document.querySelectorAll(".ncard").forEach((card) => card.classList.toggle("sel", isFocused("node", card.dataset.node)));
    document.querySelectorAll(".ek[data-edge]").forEach((label) => label.classList.toggle("sel", isFocused("edge", label.dataset.edge)));
    document.querySelectorAll(".flow[data-flow]").forEach((card) => card.classList.toggle("focused", isFocused("flow", card.dataset.flow)));
    document.querySelectorAll(".orow").forEach((row) => row.classList.toggle("sel", Boolean(isNodeSelection && row.dataset.node === selection.id)));
  }

  function legend() {
    const swatch = (style) => el("span", { class: "sw", style });
    const lineSample = (style) => el("span", { class: "ln", style });
    // Swaps only the legend, so showing or hiding it leaves the graph untouched.
    const setLegendShown = (event, isShown) => {
      state.legend = isShown;
      savePref("cv-legend", isShown ? "1" : "0");
      event.currentTarget.closest(".legend, .legend-btn").replaceWith(legend());
    };

    if (!state.legend) {
      return el("button", { class: "legend-btn", onclick: (event) => setLegendShown(event, true), html: icon("info", "sm") + "Legend" });
    }

    return el("div", { class: "legend" },
      el("button", { class: "icon-btn legend-x", title: "Hide legend", html: icon("close", "sm"), onclick: (event) => setLegendShown(event, false) }),
      el("h6", null, "Reference status"),
      el("div", { class: "lg" }, swatch({ border: "1.5px solid var(--text-2)" }), "Verified"),
      el("div", { class: "lg" }, swatch({ border: "2.5px solid var(--bad)" }), "Contradicted"),
      el("div", { class: "lg" }, swatch({ border: "2px dashed var(--warn)" }), "Unresolved"),
      el("div", { class: "lg" }, swatch({ border: "2px dotted var(--agent)" }), el("i", null, "Agent statement")),
      el("h6", null, "Change"),
      el("div", { class: "lg" }, swatch({ background: "var(--added-fill)", border: "1px solid var(--added)" }), "Added"),
      el("div", { class: "lg" }, swatch({ background: "var(--modified-fill)", border: "1px solid var(--modified)" }), "Modified"),
      el("div", { class: "lg" }, swatch({ background: "var(--deleted-fill)", border: "1px solid var(--deleted)" }), "Deleted"),
      el("div", { class: "lg" }, swatch({ background: "var(--unchanged-fill)", border: "1px solid var(--text-3)" }), "Unchanged"),
      el("h6", null, "Edges"),
      el("div", { class: "lg" }, lineSample({}), "Verified site"),
      el("div", { class: "lg" }, lineSample({ borderTopStyle: "dotted", borderTopColor: "var(--text-3)" }), "No reference"));
  }

  // ── Tooltip ────────────────────────────────────────────────
  function showTooltip(event, html) {
    if (!tooltipEl) {
      tooltipEl = el("div", { class: "tooltip" });
      document.body.appendChild(tooltipEl);
    }
    tooltipEl.innerHTML = html;
    tooltipEl.classList.add("on");
    moveTooltip(event);
  }

  const TOOLTIP_OFFSET = 14;
  const WINDOW_MARGIN = 8;

  // Places the tooltip beside the pointer, flipped to the other side near the window edge.
  function moveTooltip(event) {
    if (!tooltipEl || !event) return;

    const rect = tooltipEl.getBoundingClientRect();
    const right = event.clientX + TOOLTIP_OFFSET;
    const below = event.clientY + TOOLTIP_OFFSET;
    const left = right + rect.width > innerWidth - WINDOW_MARGIN ? event.clientX - rect.width - TOOLTIP_OFFSET : right;
    const top = below + rect.height > innerHeight - WINDOW_MARGIN ? event.clientY - rect.height - TOOLTIP_OFFSET : below;

    tooltipEl.style.left = left + "px";
    tooltipEl.style.top = top + "px";
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.remove("on");
  }

  function reasonHTML(result) {
    if (result.status === "contradicted") return `<div class="tt-r tt-bad">✕ ${escapeHTML(result.reason || "contradicted")}</div>`;
    if (result.status === "unresolved") return `<div class="tt-r tt-warn">? ${escapeHTML(result.reason || "unresolved")}</div>`;
    if (result.status === "agent") return `<div class="tt-r"><i>No reference: the agent's word</i></div>`;

    return "";
  }

  function nodeTooltip(node) {
    const refLocation = node.ref ? " · " + escapeHTML(node.ref.repo + " " + refText(node.ref)) : "";

    return `<div class="tt-t">${escapeHTML(node.label)}</div><div>${escapeHTML(CHANGE_LABEL[node.change])} ${escapeHTML(node.kind)}${refLocation}</div>${reasonHTML(node.result)}`;
  }

  function edgeTooltip(edge) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    const refLocation = edge.ref ? `<div>${escapeHTML(edge.ref.repo + " " + refText(edge.ref))}</div>` : "";

    return `<div class="tt-t">${escapeHTML(fromNode.label)} → ${escapeHTML(edge.kind)} → ${escapeHTML(toNode.label)}</div>${refLocation}${reasonHTML(edge.result)}`;
  }

  // ── Node cards (flows) ─────────────────────────────────────
  // isSmall: a narrower card hanging off a flow step as one of its tests.
  function nodeCard(node, isSmall) {
    return el("button", {
      class: `ncard ${node.change} ${node.result.status}${node.kind === "test" ? " test" : ""}${readClass(node)}`,
      "data-node": node.id,
      onclick: () => select({ type: "node", id: node.id }),
      onmouseenter: (event) => showTooltip(event, nodeTooltip(node)),
      onmousemove: moveTooltip,
      onmouseleave: hideTooltip,
      style: isSmall ? { width: "200px" } : null,
    }, nodeCardBody(node, "sm"));
  }

  // ── Flows view ─────────────────────────────────────────────
  function flowsView() {
    if (!reviewData.flows.length) {
      viewEl.appendChild(el("div", { class: "empty" }, el("div", null, htmlFragment(icon("flows")), el("div", null, "The agent described no flows."))));

      return;
    }

    viewEl.appendChild(el("div", { class: "flows" }, reviewData.flows.map((flow) => flowCard(flow))));
    highlightSelection();
  }

  // The flow's steps, the edges between them (`tests` edges aside) and each
  // step's depth from the entry. Edges are followed either way, as the
  // validator does, since a flow runs against some of them (an endpoint
  // reaches the handler that serves it).
  function flowStructure(flow) {
    const steps = [...new Set(flow.path.filter((id) => nodeById.has(id)))];
    const inFlow = new Set(steps);
    const links = reviewData.edges.filter((edge) => edge.kind !== "tests" && edge.from !== edge.to && inFlow.has(edge.from) && inFlow.has(edge.to));
    const depth = new Map(steps.length ? [[steps[0], 0]] : []);
    const queue = steps.slice(0, 1);

    while (queue.length) {
      const step = queue.shift();
      const neighbours = links.flatMap((edge) => {
        if (edge.from === step) return [edge.to];
        if (edge.to === step) return [edge.from];

        return [];
      });

      neighbours.filter((next) => !depth.has(next)).forEach((next) => {
        depth.set(next, depth.get(step) + 1);
        queue.push(next);
      });
    }

    return { steps, links, depth };
  }

  // An edge is laid out from the step nearer the entry to the farther one;
  // backward when that runs against the edge's own direction.
  function isBackwardLink(edge, depth) {
    const fromDepth = depth.has(edge.from) ? depth.get(edge.from) : Infinity;
    const toDepth = depth.has(edge.to) ? depth.get(edge.to) : Infinity;

    return toDepth < fromDepth;
  }

  function flowCard(flow) {
    const issueCount = flow.path.filter((id) => isProblemStatus(nodeById.get(id)?.result.status)).length;
    const readCount = flow.path.filter(isNodeRead).length;
    const isReviewed = isFlowReviewed(flow);
    const isOpen = !isReviewed || state.openFlows.has(flow.id);
    const card = el("section", { class: "flow" + (isReviewed ? " reviewed" : "") + (isOpen ? "" : " folded"), "data-flow": flow.id });
    const toggleOpenFlow = () => {
      if (isOpen) state.openFlows.delete(flow.id);
      else state.openFlows.add(flow.id);
      refreshMarks();
    };

    card.appendChild(el("div", { class: "flow-head" },
      isReviewed
        ? el("button", { class: "icon-btn chev", title: isOpen ? "Fold" : "Unfold", html: icon("chevron", "sm"), onclick: toggleOpenFlow })
        : el("span", { html: icon("flows"), style: { color: "var(--accent)" } }),
      el("h3", null, el("button", {
        class: "flow-title",
        title: "Show this flow in the graph",
        onclick: () => setFocus({ type: "flow", id: flow.id }),
      }, flow.title)),
      el("span", { class: "badge mono" }, flow.id),
      el("div", { class: "meta" },
        el("span", { class: "badge" + (readCount === flow.path.length ? " verified" : ""), title: "Steps you marked read" }, `${readCount}/${flow.path.length} steps read`),
        issueCount ? el("span", { class: "badge contradicted" }, plural(issueCount, "issue")) : null,
        el("button", {
          class: "read-btn" + (isReviewed ? " on" : ""),
          "aria-pressed": String(isReviewed),
          title: isReviewed ? "Mark not reviewed" : "Mark reviewed and fold",
          html: icon("check", "sm") + (isReviewed ? "Reviewed" : "Mark reviewed"),
          onclick: () => {
            setFlowReviewed(flow, !isReviewed);
            state.openFlows.delete(flow.id);
            refreshMarks();
          },
        }))));

    if (!isOpen) return card;

    const structure = flowStructure(flow);

    if (typeof ELK === "undefined") {
      card.appendChild(linearLane(structure));

      return card;
    }

    const lane = el("div", { class: "lane dag" });

    card.appendChild(lane);
    // Cards are measured once the card is in the page, which the caller does
    // before this microtask runs; a frame callback would stall in a hidden tab.
    Promise.resolve().then(() => layoutFlowLane(lane, flow, structure));

    return card;
  }

  // The flow as a row in path order, for a page whose layout engine is missing or failed.
  function linearLane(structure) {
    return el("div", { class: "lane" }, structure.steps.map((id, i) => [
      i > 0 ? connector(structure.steps[i - 1], id) : null,
      el("div", { class: "step" }, nodeCard(nodeById.get(id))),
    ]));
  }

  const FLOW_LAYOUT = {
    padding: 8,
    betweenLayers: 84,
    betweenNodes: 26,
    arrowLength: 8,
    arrowHalfWidth: 4.5,
  };
  // Laid-out positions by flow, so redrawing a flow (a read mark changed)
  // places its cards at once instead of flickering through a new layout.
  const flowLayouts = new Map();
  let elkEngine = null;

  // ELK graph ids are namespaced: a node id and an edge id may be equal.
  const flowNodeKey = (id) => "n:" + id;
  const flowEdgeKey = (edge) => "e:" + edge.id;

  function flowElkGraph(structure, sizes) {
    return {
      id: "flow",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.padding": `[top=${FLOW_LAYOUT.padding},left=${FLOW_LAYOUT.padding},bottom=${FLOW_LAYOUT.padding},right=${FLOW_LAYOUT.padding}]`,
        "elk.layered.spacing.nodeNodeBetweenLayers": String(FLOW_LAYOUT.betweenLayers),
        "elk.spacing.nodeNode": String(FLOW_LAYOUT.betweenNodes),
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      },
      children: structure.steps.map((id, i) => ({
        id: flowNodeKey(id),
        width: sizes.get(id).width,
        height: sizes.get(id).height,
        // The entry always opens the flow, even when an unreached step has no incoming edge either.
        layoutOptions: i === 0 ? { "elk.layered.layering.layerConstraint": "FIRST" } : {},
      })),
      edges: structure.links.map((edge) => {
        const isBackward = isBackwardLink(edge, structure.depth);

        return {
          id: flowEdgeKey(edge),
          sources: [flowNodeKey(isBackward ? edge.to : edge.from)],
          targets: [flowNodeKey(isBackward ? edge.from : edge.to)],
        };
      }),
    };
  }

  // Draws the flow's cards, then lays them out with ELK and draws the edges.
  async function layoutFlowLane(lane, flow, structure) {
    const canvas = el("div", { class: "dag-canvas pending" });
    const cards = new Map(structure.steps.map((id) => {
      const isGap = !structure.depth.has(id);
      const step = el("div", {
        class: "dag-step" + (isGap ? " gap" : ""),
        title: isGap ? "No edge joins this step to the flow's entry" : null,
      }, nodeCard(nodeById.get(id)));

      return [id, step];
    }));

    canvas.append(...cards.values());
    lane.appendChild(canvas);

    const sizes = new Map([...cards].map(([id, step]) => [id, { width: step.offsetWidth, height: step.offsetHeight }]));
    const layoutKey = flow.id + JSON.stringify([...sizes.values()]);

    try {
      if (!flowLayouts.has(layoutKey)) {
        elkEngine = elkEngine || new ELK();
        flowLayouts.set(layoutKey, await elkEngine.layout(flowElkGraph(structure, sizes)));
      }
    } catch {
      lane.replaceWith(linearLane(structure));

      return;
    }

    // The view may have been redrawn while ELK worked.
    if (!lane.isConnected) return;

    drawFlowLayout(canvas, cards, structure, flowLayouts.get(layoutKey));
    canvas.classList.remove("pending");
  }

  function drawFlowLayout(canvas, cards, structure, layout) {
    canvas.style.setProperty("width", layout.width + "px");
    canvas.style.setProperty("height", layout.height + "px");
    layout.children.forEach((child) => {
      const step = cards.get(child.id.slice(flowNodeKey("").length));

      step.style.left = child.x + "px";
      step.style.top = child.y + "px";
    });

    const svg = document.createElementNS(SVG_NS, "svg");
    const edgeByKey = new Map(structure.links.map((edge) => [flowEdgeKey(edge), edge]));

    svg.setAttribute("class", "dag-edges");
    svg.setAttribute("width", layout.width);
    svg.setAttribute("height", layout.height);
    canvas.prepend(svg);
    layout.edges.forEach((laidOut) => {
      const edge = edgeByKey.get(laidOut.id);
      const points = (laidOut.sections || []).flatMap((section) => [section.startPoint, ...(section.bendPoints || []), section.endPoint]);

      if (!edge || points.length < 2) return;

      // The arrowhead marks the edge's own target, which is the route's start when it was laid out backward.
      const arrowPoints = isBackwardLink(edge, structure.depth) ? [...points].reverse() : points;
      const group = svgEl("g", { class: `dag-edge ${edge.ref ? edge.result.status : "agent"}` });

      const [tail, tip] = arrowPoints.slice(-SEGMENT_POINTS);

      group.append(
        svgEl("polyline", { points: points.map((point) => `${point.x},${point.y}`).join(" ") }),
        svgEl("polygon", { points: arrowHead(tail, tip) }));
      svg.appendChild(group);

      const middle = routeMidpoint(points);

      canvas.appendChild(el("span", {
        class: "ek",
        "data-edge": edge.id,
        style: { left: middle.x + "px", top: middle.y + "px" },
        onclick: () => select({ type: "edge", id: edge.id }),
        onmouseenter: (event) => showTooltip(event, edgeTooltip(edge)),
        onmouseleave: hideTooltip,
      }, edge.kind));
    });
    highlightSelection();
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  const SEGMENT_POINTS = 2;

  function svgEl(tag, attrs) {
    const element = document.createElementNS(SVG_NS, tag);

    Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));

    return element;
  }

  // The triangle at tip, pointing along the segment from tail.
  function arrowHead(tail, tip) {
    const length = Math.hypot(tip.x - tail.x, tip.y - tail.y) || 1;
    const along = { x: (tip.x - tail.x) / length, y: (tip.y - tail.y) / length };
    const base = { x: tip.x - along.x * FLOW_LAYOUT.arrowLength, y: tip.y - along.y * FLOW_LAYOUT.arrowLength };
    const across = { x: -along.y * FLOW_LAYOUT.arrowHalfWidth, y: along.x * FLOW_LAYOUT.arrowHalfWidth };

    return [tip, { x: base.x + across.x, y: base.y + across.y }, { x: base.x - across.x, y: base.y - across.y }]
      .map((point) => `${point.x},${point.y}`)
      .join(" ");
  }

  // The point halfway along a polyline, where the edge's label sits.
  function routeMidpoint(points) {
    const segments = points.slice(1).map((point, i) => ({ from: points[i], to: point, length: Math.hypot(point.x - points[i].x, point.y - points[i].y) }));
    const half = segments.reduce((sum, segment) => sum + segment.length, 0) / 2;
    let walked = 0;

    for (const segment of segments) {
      if (walked + segment.length >= half) {
        const share = segment.length ? (half - walked) / segment.length : 0;

        return { x: segment.from.x + (segment.to.x - segment.from.x) * share, y: segment.from.y + (segment.to.y - segment.from.y) * share };
      }
      walked += segment.length;
    }

    return points[0];
  }

  // The link between two neighbouring steps of a linear lane, drawn from the edge that joins them either way.
  function connector(fromId, toId) {
    const forward = outgoingEdges(fromId).find((edge) => edge.to === toId);
    const reverse = !forward && outgoingEdges(toId).find((edge) => edge.to === fromId);
    const edge = forward || reverse;
    const link = el("div", { class: `connector ${edge ? edge.result.status : "none"}${reverse ? " rev" : ""}` }, el("div", { class: "line" }));

    if (!edge) return link;

    link.appendChild(el("span", {
      class: "ek",
      "data-edge": edge.id,
      onclick: () => select({ type: "edge", id: edge.id }),
      onmouseenter: (event) => showTooltip(event, edgeTooltip(edge)),
      onmouseleave: hideTooltip,
    }, edge.kind));

    return link;
  }

  const STATUS_COLOR = {
    verified: "var(--ok)",
    contradicted: "var(--bad)",
    unresolved: "var(--warn)",
    agent: "var(--agent)",
  };

  function nodeChip(node) {
    const isRead = isNodeRead(node.id);

    return el("button", {
      class: "chip" + (node.kind === "test" ? " test" : "") + (isRead ? " read" : ""),
      onclick: () => select({ type: "node", id: node.id }),
      title: `${node.kind} · ${STATUS_LABEL[node.result.status]}${isRead ? " · read" : ""}`,
    },
    el("span", { class: "dot", style: { background: STATUS_COLOR[node.result.status] } }),
    node.label,
    isRead ? el("span", { class: "rd", html: icon("check", "sm") }) : null);
  }

  // ── Docs & config view ─────────────────────────────────────
  function otherView() {
    const nodes = nonCodeNodes();

    if (!nodes.length) {
      viewEl.appendChild(el("div", { class: "empty" }, el("div", null, htmlFragment(icon("doc")), el("div", null, "No documentation or standalone config nodes."))));

      return;
    }

    const byKind = groupBy(nodes, (node) => node.kind);

    viewEl.appendChild(el("div", { class: "others" }, [...byKind].map(([kind, kindNodes]) => el("section", { class: "dm-repo" },
      el("div", { class: "dm-repo-head", html: icon(kindIcon(kind), "sm") },
        el("span", { class: "name" }, kind),
        el("span", { class: "spacer" }),
        el("span", { class: "muted", style: { fontSize: "12px" } }, `${kindNodes.filter((node) => isNodeRead(node.id)).length}/${kindNodes.length} read`)),
      kindNodes.map(otherRow)))));
    highlightSelection();
  }

  function otherRow(node) {
    return el("button", { class: "orow" + readClass(node), "data-node": node.id, onclick: () => select({ type: "node", id: node.id }) },
      el("span", { class: "rd", title: isNodeRead(node.id) ? "Read" : "Not read yet", html: icon(isNodeRead(node.id) ? "checkcircle" : "other", "sm") }),
      el("span", { class: "sdot " + node.result.status, title: STATUS_LABEL[node.result.status] }),
      el("div", { class: "otx" },
        el("div", { class: "lb" }, node.label),
        node.why ? el("div", { class: "why" }, node.why) : null),
      changeBadge(node.change),
      el("span", { class: "where" }, node.ref ? refText(node.ref) : "no ref"));
  }

  // ── Diff map ───────────────────────────────────────────────
  const COMMIT_OPTION_MAX_CHARS = 80;

  // Commit filter choices: only repos the change spans with more than one commit.
  function commitOptions() {
    return reviewData.repos
      .filter((repo) => repo.role !== "context" && repo.commits.length >= 2)
      .flatMap((repo) => repo.commits.map((commit) => ({
        value: `${repo.id}@${commit.sha}`,
        label: `${repo.id} · ${commit.worktree ? "worktree" : commit.short} · ${commit.subject || ""}`.slice(0, COMMIT_OPTION_MAX_CHARS),
      })));
  }

  function hunkInCommit(file, hunk) {
    if (!state.commitFilter) return true;

    const [repo, sha] = state.commitFilter.split("@");

    return file.repo === repo && (hunk.commits || []).includes(sha);
  }

  const DIFF_FILTER_LABEL = { all: "All files", uncovered: "Needs attention", covered: "Covered" };

  function diffToolbar() {
    const choices = commitOptions();

    if (choices.length) {
      toolbarEl.appendChild(el("select", {
        class: "select",
        title: "Show the hunks each commit wrote",
        onchange: (event) => {
          state.commitFilter = event.target.value;
          renderView();
        },
      },
      el("option", { value: "" }, "All commits"),
      choices.map((choice) => el("option", { value: choice.value, selected: state.commitFilter === choice.value }, choice.label))));
      toolbarEl.appendChild(el("span", { class: "tb-sep" }));
    }

    toolbarEl.appendChild(el("div", { class: "seg" },
      Object.entries(DIFF_FILTER_LABEL).map(([filter, label]) => el("button", {
        class: state.diffFilter === filter ? "on" : "",
        onclick: () => {
          state.diffFilter = filter;
          renderView();
        },
      }, label))));
    toolbarEl.appendChild(el("span", { class: "tb-sep" }));
    toolbarEl.appendChild(el("label", { class: "toggle", title: "Hide files whose changes you have reviewed" },
      el("input", {
        type: "checkbox",
        checked: state.hideReviewed,
        onchange: (event) => {
          state.hideReviewed = event.target.checked;
          renderView();
        },
      }),
      el("span", { class: "sw" }),
      "Hide reviewed"));
    toolbarEl.appendChild(el("span", { class: "tb-sep" }));
    toolbarEl.appendChild(el("button", {
      class: "icon-btn",
      title: "Expand all",
      html: icon("layers"),
      onclick: () => {
        const isAllOpen = reviewData.files.every((file) => state.openFiles.has(file.id));

        reviewData.files.forEach((file) => {
          if (isAllOpen) state.openFiles.delete(file.id);
          else state.openFiles.add(file.id);
        });
        renderView();
      },
    }));
  }

  function coverageSummary() {
    // A file without hunks (binary, pure rename) counts once with its own coverage.
    const hunks = reviewData.files.flatMap((file) => (file.hunks.length ? file.hunks : [{ coverage: file.coverage }]));
    const coverage = { covered: 0, partial: 0, uncovered: 0 };

    hunks.forEach((hunk) => {
      coverage[hunk.coverage]++;
    });

    const total = hunks.length || 1;
    const added = reviewData.files.reduce((sum, file) => sum + file.added, 0);
    const removed = reviewData.files.reduce((sum, file) => sum + file.removed, 0);
    const reviewedCount = reviewData.files.filter(isFileReviewed).length;

    return el("div", { class: "dm-summary" },
      el("div", { class: "dm-stat", title: "Files whose changes are all reviewed: every covering node read, or marked here" },
        el("span", { class: "v" + (reviewedCount === reviewData.files.length ? " plus" : "") }, `${reviewedCount}/${reviewData.files.length}`),
        el("span", { class: "k" }, "reviewed")),
      el("div", { class: "dm-stat" }, el("span", { class: "v" }, reviewData.files.length - reviewedCount), el("span", { class: "k" }, "to review")),
      el("div", { class: "dm-stat" }, el("span", { class: "v" }, reviewData.files.length), el("span", { class: "k" }, "files")),
      el("div", { class: "dm-stat" }, el("span", { class: "v" }, hunks.length), el("span", { class: "k" }, "hunks")),
      el("div", { class: "dm-stat" }, el("span", { class: "v plus" }, "+" + added), el("span", { class: "k" }, "added")),
      el("div", { class: "dm-stat" }, el("span", { class: "v minus" }, "−" + removed), el("span", { class: "k" }, "removed")),
      el("div", { class: "covbar" },
        el("div", { class: "bar" }, ["covered", "partial", "uncovered"].map((level) =>
          el("span", { class: "c-" + level, style: { width: (coverage[level] / total) * 100 + "%" } }))),
        el("div", { class: "lbl" },
          el("span", null, el("i", { class: "c-covered" }), `${coverage.covered} covered by nodes`),
          el("span", null, el("i", { class: "c-partial" }), `${coverage.partial} partly covered`),
          el("span", null, el("i", { class: "c-uncovered" }), `${coverage.uncovered} unmentioned`))));
  }

  function matchesDiffFilter(file) {
    if (state.diffFilter === "uncovered") return file.coverage !== "covered";
    if (state.diffFilter === "covered") return file.coverage === "covered";

    return true;
  }

  function matchesCommitFilter(file) {
    return !state.commitFilter || file.hunks.some((hunk) => hunkInCommit(file, hunk));
  }

  // One repo's part of the diff map, or null when it has no files or the commit filter excludes it.
  function repoDiffSection(repo) {
    const repoFiles = reviewData.files.filter((file) => file.repo === repo.id);

    if (!repoFiles.length) return null;
    if (state.commitFilter && !state.commitFilter.startsWith(repo.id + "@")) return null;

    const matchingFiles = repoFiles.filter((file) => matchesDiffFilter(file) && matchesCommitFilter(file));
    const shownFiles = matchingFiles.filter((file) => !state.hideReviewed || !isFileReviewed(file));
    const emptyNote = matchingFiles.length ? "Every file here is reviewed." : "No files match this filter.";
    const section = el("section", { class: "dm-repo" });

    section.appendChild(el("div", { class: "dm-repo-head", html: icon("repo", "sm") },
      el("span", { class: "name" }, repo.id),
      el("span", { class: "muted mono" }, repo.path),
      el("span", { class: "spacer" }),
      el("span", { class: "badge mono" }, repo.worktree ? "worktree" : shortSha(repo.commits[0]?.sha)),
      el("span", { class: "muted", style: { fontSize: "12px" } }, plural(repoFiles.length, "file"))));
    if (!shownFiles.length) section.appendChild(el("div", { class: "code-note" }, emptyNote));
    shownFiles.forEach((file) => section.append(...fileRow(file)));

    return section;
  }

  function diffView() {
    diffToolbar();

    const wrap = el("div", { class: "diffmap" }, coverageSummary());

    if (!reviewData.files.length) {
      wrap.appendChild(el("div", { class: "empty" }, "No changed files in the listed repos."));
      viewEl.appendChild(wrap);

      return;
    }

    for (const repo of reviewData.repos) {
      const section = repoDiffSection(repo);

      if (section) wrap.appendChild(section);
    }
    viewEl.appendChild(wrap);
  }

  // Flips a file or evidence row open or closed (as rendered) and re-renders the view.
  function toggleOpen(id, isOpen) {
    if (isOpen) state.openFiles.delete(id);
    else state.openFiles.add(id);
    renderView();
  }

  const STATUS_LETTER = { added: "A", modified: "M", deleted: "D", renamed: "R" };
  const COVERAGE_ICON = {
    covered: ["checkcircle", "var(--ok)"],
    partial: ["alert", "var(--warn)"],
    uncovered: ["xcircle", "var(--bad)"],
  };
  const COVERAGE_BADGE = { covered: "verified", partial: "unresolved", uncovered: "contradicted" };

  // Hunk markers along a file's length, placed by final-state lines (initial for deletions).
  function trackSegments(file) {
    const lineCount = Math.max(file.lines, 1);

    if (!file.hunks.length) return [el("span", { class: "seg-h c-" + file.coverage, style: { left: 0, width: "100%", opacity: 0.5 } })];

    return file.hunks.map((hunk) => {
      const isDeleted = file.status === "deleted";
      const start = isDeleted ? hunk.oldStart : hunk.newStart;
      const length = isDeleted ? hunk.oldCount : Math.max(hunk.newCount, 1);

      return el("span", {
        class: "seg-h c-" + hunk.coverage,
        style: { left: ((start - 1) / lineCount) * 100 + "%", width: (length / lineCount) * 100 + "%" },
      });
    });
  }

  // The file's row in the diff map, plus its hunks when the row is open.
  function fileRow(file) {
    const isOpen = state.openFiles.has(file.id);
    const coverageIcon = COVERAGE_ICON[file.coverage];
    const details = [
      file.oldPath ? `renamed from ${file.oldPath}` : null,
      file.untracked ? "untracked" : null,
      file.binary ? "binary" : null,
      file.language || "plain text",
      file.hasTests ? "test file" : null,
    ];
    const isReviewed = isFileReviewed(file);
    const row = el("div", { class: "frow" + (isOpen ? " open" : "") + (isReviewed ? " reviewed" : ""), onclick: () => toggleOpen(file.id, isOpen) },
      el("span", { class: "chev", html: icon("chevron", "sm") }),
      el("span", { class: "fstat " + file.status, title: CHANGE_LABEL[file.status] }, STATUS_LETTER[file.status]),
      el("div", { style: { minWidth: 0 } },
        el("div", { class: "fpath", title: file.path },
          el("bdi", null, el("span", { class: "dir" }, dirname(file.path)), el("span", { class: "base" }, basename(file.path)))),
        el("div", { class: "fsub" }, details.filter(Boolean).join(" · "))),
      el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
        el("span", { html: icon(coverageIcon[0], "sm"), style: { color: coverageIcon[1] } }),
        el("div", { class: "track", style: { flex: 1 } }, trackSegments(file))),
      el("div", { class: "fnums" },
        isReviewed ? el("span", { class: "rd", title: "Reviewed", html: icon("checkcircle", "sm") }) : null,
        el("span", { class: "plus" }, `+${file.added}`), " ", el("span", { class: "minus" }, `−${file.removed}`)));

    if (!isOpen) return [row];

    const body = el("div", { class: "hunks" });

    if (file.fileNodes && file.fileNodes.length) {
      body.appendChild(el("div", { class: "hunk-head", style: { border: 0, background: "none", padding: 0 } },
        el("span", { class: "muted" }, "Whole file covered by"),
        file.fileNodes.map((id) => nodeChip(nodeById.get(id)))));
    }
    if (!file.hunks.length) {
      body.appendChild(el("div", { class: "code-note" },
        file.binary ? "Binary file: no line diff." : "Renamed without content change.",
        coveringNodes(file, null).length ? null : ownMarkButton(file, null)));
    }
    file.hunks.filter((hunk) => hunkInCommit(file, hunk)).forEach((hunk) => body.appendChild(hunkBox(file, hunk)));

    return [row, body];
  }

  // "12–15" for count lines starting at start, "12" for a single line.
  function lineSpan(start, count) {
    return `${start}${count > 1 ? "–" + (start + count - 1) : ""}`;
  }

  function hunkRange(hunk) {
    if (hunk.newCount === 0) return `−${lineSpan(hunk.oldStart, hunk.oldCount)} (removed after line ${hunk.newStart})`;

    const removed = hunk.oldCount ? `  −${lineSpan(hunk.oldStart, hunk.oldCount)}` : "";

    return `+${lineSpan(hunk.newStart, hunk.newCount)}${removed}`;
  }

  const HUNK_COVERAGE_LABEL = { covered: "Covered", partial: "Partly covered", uncovered: "Not mentioned by any node" };

  // Marks a change no node covers (a hunk, or a file without hunks when hunk
  // is null) as reviewed; covered changes are reviewed through their nodes.
  function ownMarkButton(file, hunk) {
    const isOn = isOwnMarked(file, hunk);

    return el("button", {
      class: "read-btn" + (isOn ? " on" : ""),
      "aria-pressed": String(isOn),
      title: "No node covers this change, so mark it here",
      html: icon("check", "sm") + (isOn ? "Reviewed" : "Mark reviewed"),
      onclick: (event) => {
        event.stopPropagation();
        setOwnMark(file, hunk, !isOn);
        refreshMarks();
      },
    });
  }

  // How a hunk's review is shown: a mark button when no node covers it,
  // else a badge once every covering node is read.
  function hunkReviewControl(file, hunk) {
    if (!coveringNodes(file, hunk).length) return ownMarkButton(file, hunk);
    if (!isHunkReviewed(file, hunk)) return null;

    return el("span", { class: "badge verified", title: "Every node covering this change is read", html: icon("check", "sm") + "Reviewed via nodes" });
  }

  function hunkBox(file, hunk) {
    const showUncovered = hunk.uncovered && hunk.coverage === "partial";
    const box = el("div", { class: "hunk " + hunk.coverage, id: "hunk-" + hunk.id });

    box.appendChild(el("div", { class: "hunk-head" },
      el("span", { class: "rng" }, hunkRange(hunk)),
      el("span", { class: "badge " + COVERAGE_BADGE[hunk.coverage] }, HUNK_COVERAGE_LABEL[hunk.coverage]),
      showUncovered
        ? el("span", { class: "muted", style: { fontSize: "11.5px" } }, `uncovered ${hunk.oldSide ? "initial " : ""}lines ${rangesText(hunk.uncovered)}`)
        : null,
      el("span", { class: "spacer" }),
      (hunk.commits || []).map((sha) => el("span", {
        class: "badge mono",
        title: "Written by " + (sha === "WORKTREE" ? "uncommitted work" : sha),
      }, sha === "WORKTREE" ? "worktree" : shortSha(sha))),
      hunk.nodes.map((id) => nodeChip(nodeById.get(id))),
      hunkReviewControl(file, hunk),
      el("button", {
        class: "icon-btn",
        title: "Open in inspector",
        html: icon("arrow", "sm"),
        onclick: (event) => {
          event.stopPropagation();
          select({ type: "hunk", id: hunk.id });
        },
      })));
    box.appendChild(codeTable(hunk.rows, null));

    return box;
  }

  // ── Code excerpt ───────────────────────────────────────────
  const ROW_SIGN = { add: "+", del: "−" };
  const CODE_COLUMNS = { after: 2, diff: 4 };

  function codeRow(row, site, after) {
    if (row.t === "gap") return el("tr", { class: "gap" }, el("td", { colspan: after ? CODE_COLUMNS.after : CODE_COLUMNS.diff }, "⋯"));

    const isSite = site && row.n === site.line;
    const codeHTML = isSite && site.contains ? markContains(row.h || "", site.contains) : row.h || "";
    const lineCells = after
      ? [el("td", { class: "ln", title: row.t === "add" ? "Changed line" : null }, row.n || "")]
      : [el("td", { class: "ln" }, row.o || ""), el("td", { class: "ln" }, row.n || ""), el("td", { class: "sg" }, ROW_SIGN[row.t] || "")];

    return el("tr", { class: `${row.t}${row.f ? " f" : ""}${isSite ? " site" : ""}` },
      ...lineCells,
      el("td", { class: "cd", html: codeHTML || " " }));
  }

  // site: the referenced line to highlight and the text to mark on it, or null.
  // after: the final-state code alone, one line-number column, no signs.
  function codeTable(rows, site, after) {
    const tbody = el("tbody", null, rows.map((row) => codeRow(row, site, after)));

    return el("div", { class: "code-scroll" }, el("table", { class: "code" + (after ? " after" : "") }, tbody));
  }

  // The code after the change: the whole file for a `file` ref, otherwise
  // the excerpt without its removed lines.
  function afterRows(excerpt) {
    return excerpt.after || (excerpt.rows || []).filter((row) => row.t !== "del");
  }

  // Wraps the first plain-text occurrence of needle in <mark>, across spans.
  function markContains(html, needle) {
    const container = document.createElement("div");

    container.innerHTML = html;

    const matchStart = container.textContent.indexOf(needle);

    if (matchStart < 0) return html;

    const matchEnd = matchStart + needle.length;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const pieces = [];
    let offset = 0;
    let textNode;

    while ((textNode = walker.nextNode())) {
      const length = textNode.nodeValue.length;
      const start = Math.max(matchStart, offset);
      const end = Math.min(matchEnd, offset + length);

      if (start < end) pieces.push([textNode, start - offset, end - offset]);
      offset += length;
    }

    // Split from the last piece back so earlier offsets stay valid.
    for (const [piece, start, end] of pieces.reverse()) {
      const marked = piece.splitText(start);

      marked.splitText(end - start);

      const mark = document.createElement("mark");

      marked.parentNode.replaceChild(mark, marked);
      mark.appendChild(marked);
    }

    return container.innerHTML;
  }

  // The location the copy button puts on the clipboard: file plus first line.
  function copyLocation(file, ref) {
    if (ref && ref.lines) return `${file}:${ref.lines[0]}`;
    if (ref && ref.line) return `${file}:${ref.line}`;

    return String(file);
  }

  const STATE_KIND_LABEL = { final: "final state", initial: "initial state", at: "at commit" };
  const CODE_MODES = [
    ["diff", "Diff", "Changed lines with what they replaced"],
    ["after", "After", "The code as it is after the change"],
  ];

  // Diff / After tabs; switching saves the mode and calls onChange to redraw the code.
  function codeModeTabs(onChange) {
    const buttons = CODE_MODES.map(([mode, label, title]) => el("button", {
      class: state.codeMode === mode ? "on" : "",
      role: "tab",
      title,
      "aria-selected": String(state.codeMode === mode),
      onclick: () => {
        state.codeMode = mode;
        savePref("cv-code", mode);
        buttons.forEach((button, i) => {
          const isOn = CODE_MODES[i][0] === mode;

          button.classList.toggle("on", isOn);
          button.setAttribute("aria-selected", String(isOn));
        });
        onChange();
      },
    }, label));

    return el("div", { class: "seg code-tabs", role: "tablist" }, ...buttons);
  }

  // excerptId keys reviewData.excerpts; options.actualLine moves the site mark
  // to the line where the checked text was actually found.
  function excerptBox(excerptId, ref, options = {}) {
    const excerpt = excerptId && reviewData.excerpts[excerptId];

    if (!excerpt) return null;

    const stateLabel = excerpt.state === "WORKTREE" ? "worktree" : shortSha(excerpt.state);
    const head = el("div", { class: "code-head", html: icon("file", "sm") },
      el("span", { class: "fp", title: `${excerpt.repo}: ${excerpt.file}` }, `${excerpt.file}${linesText(ref)}`),
      excerpt.oldPath ? el("span", { class: "badge renamed", title: "Renamed from " + excerpt.oldPath }, "renamed") : null,
      el("span", { class: "badge mono", title: STATE_KIND_LABEL[excerpt.stateKind] || "" }, `${stateLabel}`),
      el("span", { class: "badge" }, excerpt.language || "plain text"),
      el("button", {
        class: "icon-btn copy",
        title: "Copy path",
        html: icon("copy", "sm"),
        onclick: () => navigator.clipboard && navigator.clipboard.writeText(copyLocation(excerpt.file, ref)),
      }));
    const box = el("div", { class: "code-box" }, head);

    if (excerpt.note) {
      box.appendChild(el("div", { class: "code-note" }, excerpt.note));

      return box;
    }

    const site = ref && ref.type === "site" ? { line: options.actualLine || ref.line, contains: ref.contains } : null;
    // Diff / After tabs only when the excerpt shows a change in the final state.
    const hasTabs = excerpt.stateKind === "final" && (excerpt.rows || []).some((row) => row.t === "add" || row.t === "del");
    const content = el("div");
    const showCode = () => {
      const after = hasTabs && state.codeMode === "after";
      const isTruncated = after && excerpt.after ? excerpt.afterTruncated : excerpt.truncated;

      content.innerHTML = "";
      content.appendChild(codeTable(after ? afterRows(excerpt) : excerpt.rows || [], site, after));
      if (isTruncated) content.appendChild(el("div", { class: "trunc" }, "Excerpt truncated."));
    };

    if (hasTabs) head.insertBefore(codeModeTabs(showCode), head.querySelector(".fp").nextSibling);
    showCode();
    box.appendChild(content);

    return box;
  }

  // ── Claims ─────────────────────────────────────────────────
  const CLAIM_FILTERS = ["all", "verified", "contradicted", "unresolved", "agent"];

  function claimsView() {
    if (!reviewData.claims.length) {
      viewEl.appendChild(el("div", { class: "empty" }, el("div", null, htmlFragment(icon("claims")), el("div", null, "The agent made no claims."))));

      return;
    }

    const counts = {};

    reviewData.claims.forEach((claim) => {
      counts[claim.status] = (counts[claim.status] || 0) + 1;
    });
    toolbarEl.appendChild(el("div", { class: "seg" },
      CLAIM_FILTERS.filter((status) => status === "all" || counts[status]).map((status) => el("button", {
        class: state.claimFilter === status ? "on" : "",
        onclick: () => {
          state.claimFilter = status;
          renderView();
        },
      }, status === "all" ? `All ${reviewData.claims.length}` : `${STATUS_LABEL[status]} ${counts[status]}`))));

    const wrap = el("div", { class: "claims" });

    reviewData.claims.forEach((claim, claimIndex) => {
      if (state.claimFilter !== "all" && claim.status !== state.claimFilter) return;

      wrap.appendChild(claimCard(claim, claimIndex));
    });
    viewEl.appendChild(wrap);
  }

  // claimIndex keys the open state of the claim's evidence rows ("ev:<claim>:<evidence>").
  function claimCard(claim, claimIndex) {
    const card = el("article", { class: "claim " + claim.status });
    const evidenceNote = claim.evidence.length
      ? el("span", { class: "muted", style: { fontSize: "12px" } }, plural(claim.evidence.length, "piece") + " of evidence")
      : el("span", { class: "muted", style: { fontSize: "12px" } }, "no evidence: the agent's word");

    card.appendChild(el("div", { class: "claim-head" },
      el("div", { class: "claim-icon " + claim.status, html: icon(STATUS_ICON[claim.status]) }),
      el("div", { style: { flex: 1, minWidth: 0 } },
        el("div", { class: "claim-text" + (claim.status === "agent" ? " agent" : "") }, claim.text),
        el("div", { class: "claim-about" },
          statusBadge(claim.status),
          evidenceNote,
          claim.about.length ? el("span", { class: "muted", style: { fontSize: "12px", marginLeft: "6px" } }, "about") : null,
          claim.about.map((id) => nodeById.get(id) && nodeChip(nodeById.get(id)))))));

    if (!claim.evidence.length) return card;

    card.appendChild(el("div", { class: "evidence" },
      claim.evidence.map((evidence, evidenceIndex) => evidenceRows(evidence, `ev:${claimIndex}:${evidenceIndex}`))));

    return card;
  }

  // An evidence row, plus the resolved fact below it when openKey is open.
  function evidenceRows(evidence, openKey) {
    const isOpen = state.openFiles.has(openKey);
    const row = el("div", { class: "ev-row" + (isOpen ? " open" : ""), onclick: () => toggleOpen(openKey, isOpen) },
      el("span", { class: "chev", html: icon("chevron", "sm") }),
      el("span", { class: "sdot " + evidence.result.status, title: STATUS_LABEL[evidence.result.status] }),
      el("span", { class: "badge mono" }, evidence.ref.type),
      el("span", { class: "ev-loc" }, el("b", { style: { color: "var(--accent-text)" } }, evidence.ref.repo), " ", refText(evidence.ref)),
      evidence.ref.contains ? el("span", { class: "ev-contains", title: evidence.ref.contains }, evidence.ref.contains) : null,
      el("span", { class: "spacer" }),
      statusBadge(evidence.result.status));

    if (!isOpen) return [row];

    return [row, el("div", { class: "ev-body" }, resolvedFact(evidence.ref, evidence.result, evidence.excerpt))];
  }

  function commitFact(ref, result) {
    const repo = repoById.get(ref.repo);
    const commit = repo && repo.commits.find((candidate) => candidate.sha === result.state || candidate.sha.startsWith(ref.sha));
    const row = commit
      ? el("div", { class: "commit" }, el("span", { class: "dot" }), el("span", { class: "sha" }, commit.short), el("span", { class: "subj" }, commit.subject))
      : el("div", { class: "code-note" }, "Commit not in the list.");

    return el("div", { class: "repo-card" }, el("div", { class: "commits" }, row));
  }

  // What the tool found for a ref: the failure reason, then the commit or code it resolved to.
  function resolvedFact(ref, result, excerptId) {
    const isSiteMoved = result.codes && result.codes.includes("site_offset");
    const resolved = ref.type === "commit"
      ? commitFact(ref, result)
      : excerptBox(excerptId, ref, { actualLine: result.actualLine })
        || (result.status === "verified" ? el("div", { class: "code-note" }, "No excerpt available.") : null);

    return [
      isProblemStatus(result.status) ? reasonCallout(result) : null,
      isSiteMoved
        ? el("div", { class: "callout warn", style: { marginBottom: "8px" }, html: icon("alert", "sm") },
          el("div", null, `Found on line ${result.actualLine}, not ${ref.line}.`))
        : null,
      resolved,
    ].filter(Boolean);
  }

  function reasonCallout(result) {
    const isContradicted = result.status === "contradicted";

    return el("div", { class: `callout ${isContradicted ? "bad" : "warn"}`, style: { marginBottom: "8px" }, html: icon(isContradicted ? "xcircle" : "help") },
      el("div", null,
        el("div", null, el("b", null, STATUS_LABEL[result.status] + ": "), result.reason || ""),
        result.hint ? el("div", { class: "hint" }, "Hint for the agent: ", result.hint) : null,
        result.codes && result.codes.length ? el("div", { class: "code" }, result.codes.join(" · ")) : null));
  }

  // ── Inspector ──────────────────────────────────────────────
  // Leaves at least MAIN_MIN_WIDTH px for the view between the panels.
  function clampInspectorWidth(width) {
    const max = window.innerWidth - (state.sidebar ? state.sidebarWidth : 0) - MAIN_MIN_WIDTH;

    return Math.round(Math.max(INSPECTOR_MIN_WIDTH, Math.min(max, width)));
  }

  function applyInspectorWidth() {
    if (state.inspectorWidth) inspectorEl.style.setProperty("--ins-w", state.inspectorWidth + "px");
    else inspectorEl.style.removeProperty("--ins-w");
  }

  // Drag handle on the inspector's left edge.
  function inspectorResizer() {
    const setWidth = (width) => {
      state.inspectorWidth = clampInspectorWidth(width);
      applyInspectorWidth();
    };
    const reset = () => {
      state.inspectorWidth = 0;
      applyInspectorWidth();
      savePref("cv-inspector-w", "0");
    };

    return dragHandle("ins-resizer", -1, () => inspectorEl.getBoundingClientRect().width, setWidth,
      () => savePref("cv-inspector-w", String(state.inspectorWidth)), reset);
  }

  function inspectorContent(selection) {
    if (!selection) return null;
    if (selection.type === "node" && nodeById.has(selection.id)) return nodeInspector(nodeById.get(selection.id));
    if (selection.type === "edge" && edgeById.has(selection.id)) return edgeInspector(edgeById.get(selection.id));
    if (selection.type === "hunk") return hunkInspector(selection.id);
    if (selection.type === "findings") return findingsInspector(selection.id);

    return null;
  }

  // Matches the inspector's CSS width transition.
  const INSPECTOR_TRANSITION_MS = 200;

  function renderInspector() {
    inspectorEl.innerHTML = "";

    const content = inspectorContent(state.selection);

    if (!content) {
      inspectorEl.classList.remove("on");

      return;
    }

    inspectorEl.classList.add("on");
    inspectorEl.append(inspectorHandle, ...content);
    // Re-place the overlay labels once the graph has been resized for the inspector.
    setTimeout(requestOverlaySync, INSPECTOR_TRANSITION_MS);
  }

  function inspectorHead(iconName, iconClass, title, subtitle, badges) {
    return el("div", { class: "ins-head" },
      el("div", { class: "ins-icon " + (iconClass || ""), html: icon(iconName, "lg") }),
      el("div", { class: "ins-title" },
        el("h2", null, title),
        subtitle ? el("div", { class: "sub" }, subtitle) : null,
        badges ? el("div", { class: "ins-badges" }, badges) : null),
      el("button", { class: "icon-btn", title: "Close (Esc)", html: icon("close"), onclick: () => select(null) }));
  }

  const inspectorSection = (title, iconName, ...children) =>
    el("section", { class: "ins-sec" }, el("h4", { html: (iconName ? icon(iconName, "sm") : "") + escapeHTML(title) }), ...children);

  const READ_STATE_TITLE = {
    final: "Read in the final state",
    initial: "Read in the initial state (deleted node)",
    at: "Read at an intermediate commit",
  };
  const READ_STATE_PREFIX = { initial: "initial ", at: "at " };

  // Where a ref points, and which state of the repo it was read in.
  function locationLine(ref, result) {
    if (!ref) return null;

    const repo = repoById.get(ref.repo);

    return el("div", { class: "loc" },
      el("span", { class: "repo" }, ref.repo),
      el("span", { class: "sep" }, "›"),
      ref.type === "commit" ? el("span", null, "commit " + shortSha(ref.sha)) : el("span", null, ref.file + linesText(ref)),
      el("span", { class: "badge mono", title: "Reference type" }, ref.type),
      result && result.state
        ? el("span", { class: "badge mono", title: READ_STATE_TITLE[result.stateKind] }, (READ_STATE_PREFIX[result.stateKind] || "") + shortSha(result.state))
        : null,
      repo && repo.role === "context" ? el("span", { class: "badge context" }, "context repo") : null);
  }

  // Findings whose JSON path is the element's path or inside it.
  function elementFindings(path) {
    return allFindings.filter((finding) => finding.path && (finding.path === path || finding.path.startsWith(path + "/")));
  }

  // The agent's why and meta for a node, or null when it wrote neither.
  function agentAccount(node) {
    const hasMeta = node.meta && node.meta.length;

    if (!node.why && !hasMeta) return null;

    const metaEntry = (meta) => [
      el("dt", null, meta.key),
      el("dd", { class: "says" },
        meta.key === "observed"
          ? el("span", { class: "says-badge badge agent " + observedClass(meta.value) }, "agent says: " + meta.value)
          : el("span", { class: meta.key === "command" ? "mono" : "" }, meta.value)),
    ];

    return [
      node.why ? el("div", { class: "agent-says" }, agentTag("Why · agent says"), el("p", null, node.why)) : null,
      hasMeta ? el("dl", { class: "kvs", style: { marginTop: node.why ? "10px" : 0 } }, node.meta.map(metaEntry)) : null,
    ];
  }

  function testRow(test) {
    return el("div", { class: "rel-row", onclick: () => select({ type: "node", id: test.id }) },
      el("span", { class: "sdot " + test.result.status, title: "Test node: " + STATUS_LABEL[test.result.status] }),
      el("span", null, test.label),
      el("span", { class: "badge " + test.change }, CHANGE_LABEL[test.change]),
      observedBadge(test),
      el("span", { class: "where" }, test.ref ? basename(test.ref.file || "") + linesText(test.ref) : ""));
  }

  // The `tests` edges a node's Tests tab lists: into a code node, or out of a test node.
  const testEdges = (node) => (node.kind === "test" ? testedBy(node.id) : testsOf(node.id));

  // The tests of a code node, or for a test node the nodes it tests.
  function testsList(node) {
    const edges = testEdges(node);

    if (node.kind === "test") {
      return edges.length
        ? el("div", { class: "rel" }, edges.map((edge) => relationRow(edge, "out")))
        : el("div", { class: "muted" }, "No `tests` edges from this test.");
    }

    const emptyNote = node.change === "unchanged" ? "No tests attached." : "No test node has a `tests` edge to this node.";

    return edges.length
      ? el("div", { class: "rel" }, edges.map((edge) => testRow(nodeById.get(edge.from))))
      : el("div", { class: "muted", style: { fontSize: "12.5px" } }, emptyNote);
  }

  function readButton(node) {
    const isRead = isNodeRead(node.id);

    return el("button", {
      class: "read-btn" + (isRead ? " on" : ""),
      title: isRead ? "Mark unread (r)" : "Mark read (r)",
      "aria-pressed": String(isRead),
      html: icon("check", "sm") + (isRead ? "Read" : "Mark read"),
      onclick: () => toggleNodeRead(node.id),
    });
  }

  // Tab bar over the active tab's content; tabs are { id, label, content() }.
  function inspectorTabs(tabs) {
    const active = tabs.find((tab) => tab.id === state.inspectorTab) || tabs[0];
    const bar = el("div", { class: "seg ins-tabs", role: "tablist" }, tabs.map((tab) => el("button", {
      class: tab === active ? "on" : "",
      role: "tab",
      "aria-selected": String(tab === active),
      onclick: () => {
        state.inspectorTab = tab.id;
        renderInspector();
      },
    }, tab.label)));

    return [bar, el("div", { class: "ins-sec ins-tab" }, active.content())];
  }

  function nodeInspector(node) {
    const status = node.result.status;
    const head = inspectorHead(kindIcon(node.kind), node.change, node.label, `${node.id} · ${node.kind}`, [changeBadge(node.change), statusBadge(status)]);
    const body = el("div", { class: "ins-body" });

    head.insertBefore(readButton(node), head.lastChild);

    if (isProblemStatus(status)) body.appendChild(el("div", { class: "ins-sec" }, reasonCallout(node.result)));
    if (status === "agent") {
      body.appendChild(el("div", { class: "ins-sec" },
        el("div", { class: "callout info", html: icon("chat") },
          el("div", null, "This node has no reference. Its existence and change state are the agent's word."))));
    }

    if (node.ref) body.appendChild(el("div", { class: "ins-sec" }, locationLine(node.ref, node.result)));

    const account = agentAccount(node);
    // A ref finding that repeats the node's result is already shown in the callout.
    const repeatsRefResult = (finding) => finding.status && finding.path.endsWith("/ref") && node.result.codes && node.result.reason === finding.message;
    const nodeFindings = elementFindings(`/nodes/${nodeIndex.get(node.id)}`)
      .filter((finding) => !repeatsRefResult(finding))
      .filter((finding) => finding.level === "warning" || !finding.status);
    // `tests` edges are listed in the Tests tab, not again as relations.
    const isTest = node.kind === "test";
    const incoming = incomingEdges(node.id).filter((edge) => isTest || edge.kind !== "tests");
    const outgoing = outgoingEdges(node.id).filter((edge) => !isTest || edge.kind !== "tests");
    const relationCount = incoming.length + outgoing.length;
    const tabs = [
      node.excerpt && {
        id: "code",
        label: node.change === "deleted" ? "Code (initial state)" : "Code",
        content: () => excerptBox(node.excerpt, node.ref, { actualLine: node.result.actualLine }),
      },
      account && { id: "account", label: "Agent's account", content: () => account },
      { id: "tests", label: `Tests ${testEdges(node).length}`, content: () => testsList(node) },
      relationCount && {
        id: "relations",
        label: `Relations ${relationCount}`,
        content: () => el("div", { class: "rel" }, incoming.map((edge) => relationRow(edge, "in")), outgoing.map((edge) => relationRow(edge, "out"))),
      },
      nodeFindings.length && {
        id: "findings",
        label: `Findings ${nodeFindings.length}`,
        content: () => el("div", { class: "flist" }, nodeFindings.map((finding) => findingItem(finding, false))),
      },
    ].filter(Boolean);

    body.append(...inspectorTabs(tabs));

    return [head, body];
  }

  // direction: "in" for an edge into the inspected node, "out" for one leaving it.
  function relationRow(edge, direction) {
    const isIncoming = direction === "in";
    const other = nodeById.get(isIncoming ? edge.from : edge.to);

    return el("div", { class: "rel-row", onclick: () => select({ type: "edge", id: edge.id }), title: STATUS_LABEL[edge.result.status] },
      el("span", { class: "sdot " + edge.result.status }),
      el("span", { class: "dir", title: isIncoming ? "incoming" : "outgoing" }, isIncoming ? "←" : "→"),
      el("span", { class: "k" }, edge.kind),
      el("span", { class: "other", title: other.label }, other.label),
      el("span", { class: "where" }, edge.ref ? basename(edge.ref.file || "") + linesText(edge.ref) : "no ref"));
  }

  function edgeInspector(edge) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    const head = inspectorHead("arrow", "", `${fromNode.label} → ${toNode.label}`, `edge · ${edge.kind}`, [
      el("span", { class: "badge mono" }, edge.kind),
      statusBadge(edge.result.status),
    ]);
    const body = el("div", { class: "ins-body" });

    if (isProblemStatus(edge.result.status)) body.appendChild(el("div", { class: "ins-sec" }, reasonCallout(edge.result)));
    if (!edge.ref) {
      body.appendChild(el("div", { class: "ins-sec" },
        el("div", { class: "callout info", html: icon("chat") },
          el("div", null, "No site reference: this relation is the agent's word, drawn dotted."))));
    }
    body.appendChild(inspectorSection("Between", "graph",
      el("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
        nodeChip(fromNode),
        el("span", { class: "muted" }, edge.kind + " →"),
        nodeChip(toNode))));

    if (!edge.ref) return [head, body];

    body.appendChild(inspectorSection("Site", "target", locationLine(edge.ref, edge.result),
      edge.ref.contains
        ? el("div", { style: { marginTop: "8px" } }, el("span", { class: "muted", style: { fontSize: "12px" } }, "contains "), el("code", { class: "ev-contains" }, edge.ref.contains))
        : null));

    // Edge ids are "e" plus the edge's index in the review file.
    const warnings = allFindings.filter((finding) => finding.path === `/edges/${edge.id.slice(1)}/ref` && finding.level === "warning");

    if (warnings.length) {
      body.appendChild(inspectorSection("Findings", "alert", el("div", { class: "flist" }, warnings.map((finding) => findingItem(finding, false)))));
    }
    if (edge.excerpt) body.appendChild(inspectorSection("Code", "code", excerptBox(edge.excerpt, edge.ref, { actualLine: edge.result.actualLine })));

    return [head, body];
  }

  const HUNK_INSPECTOR_LABEL = { covered: "Covered", partial: "Partly covered", uncovered: "Unmentioned" };

  function hunkInspector(id) {
    const file = reviewData.files.find((candidate) => candidate.hunks.some((hunk) => hunk.id === id));

    if (!file) return null;

    const hunk = file.hunks.find((candidate) => candidate.id === id);
    const head = inspectorHead("diff", file.status, basename(file.path), `${file.repo} › ${file.path}`, [
      changeBadge(file.status),
      el("span", { class: "badge " + COVERAGE_BADGE[hunk.coverage] }, HUNK_INSPECTOR_LABEL[hunk.coverage]),
      hunkReviewControl(file, hunk),
    ]);
    const body = el("div", { class: "ins-body" });

    if (hunk.coverage !== "covered") {
      const isUncovered = hunk.coverage === "uncovered";
      const message = isUncovered
        ? "No node's range or file ref covers this change. The agent did not describe it."
        : `Lines ${rangesText(hunk.uncovered)} are outside every node.`;

      body.appendChild(el("div", { class: "ins-sec" }, el("div", { class: "callout " + (isUncovered ? "bad" : "warn"), html: icon("alert") }, el("div", null, message))));
    }
    body.appendChild(inspectorSection("Hunk", "diff",
      el("div", { class: "loc" },
        el("span", { class: "repo" }, file.repo),
        el("span", { class: "sep" }, "›"),
        el("span", null, file.path),
        el("span", { class: "badge mono" }, hunkRange(hunk)))));
    if (hunk.nodes.length) {
      body.appendChild(inspectorSection("Covered by", "layers",
        el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } }, hunk.nodes.map((nodeId) => nodeChip(nodeById.get(nodeId))))));
    }
    body.appendChild(inspectorSection("Change", "code", el("div", { class: "code-box" }, codeTable(hunk.rows, null))));

    return [head, body];
  }

  function openFindings(group) {
    select({ type: "findings", id: group });
  }

  // The title and findings for a group id from the topbar pills or the sidebar.
  function findingsOfGroup(group) {
    if (group === "errors") return { title: "Errors", findings: allFindings.filter((finding) => finding.level === "error") };
    if (group === "warnings") return { title: "Warnings", findings: allFindings.filter((finding) => finding.level === "warning") };
    if (group === "all") return { title: "All findings", findings: allFindings };

    const findingGroup = FINDING_GROUPS.find((candidate) => candidate.id === group);

    return findingGroup ? { title: findingGroup.label, findings: allFindings.filter(findingGroup.match) } : null;
  }

  function findingsInspector(group) {
    if (group === "tests") return changedTestsInspector();

    const selected = findingsOfGroup(group);

    if (!selected) return null;

    const { title, findings } = selected;
    const head = inspectorHead("alert", "", title, `${plural(findings.length, "finding")} from validate`, null);
    const list = findings.length
      ? el("div", { class: "flist" }, findings.map((finding) => findingItem(finding, true)))
      : el("div", { class: "all-clear", html: icon("checkcircle") + "Nothing here." });
    const body = el("div", { class: "ins-body" },
      el("div", { class: "ins-sec" }, list),
      el("div", { class: "ins-sec muted", style: { fontSize: "12px" } },
        "Findings check the account against the repos, never whether the code is correct. Hints are written for the agent."));

    return [head, body];
  }

  function changedTestsInspector() {
    const head = inspectorHead("test", "", "Changed tests", "Test nodes that changed in the diff, next to the code they claim to test", null);
    const rows = changedTests().map((test) => {
      const targets = testedBy(test.id).map((edge) => nodeById.get(edge.to));

      return el("div", { class: "rel-row", style: { flexWrap: "wrap" }, onclick: () => select({ type: "node", id: test.id }) },
        el("span", { class: "sdot " + test.result.status }),
        el("b", null, test.label),
        el("span", { class: "badge " + test.change }, CHANGE_LABEL[test.change]),
        observedBadge(test),
        el("span", { class: "where" }, targets.length ? "tests " + targets.map((target) => target.label).join(", ") : "tests nothing"));
    });
    const body = el("div", { class: "ins-body" }, el("div", { class: "ins-sec" }, el("div", { class: "rel" }, rows)));

    return [head, body];
  }

  // The line range a hunk spans: initial-state lines for removals and old-side hunks.
  function hunkLines(hunk) {
    if (hunk.oldSide || !hunk.newCount) return [hunk.oldStart, hunk.oldStart + hunk.oldCount - 1];

    return [hunk.newStart, hunk.newStart + hunk.newCount - 1];
  }

  const HUNK_SCROLL_DELAY_MS = 30;
  const HUNK_FLASH_MS = 1600;

  // Opens the file in the diff map and scrolls to the hunk (if any), flashing it.
  function showHunk(file, hunk) {
    state.openFiles.add(file.id);
    state.diffFilter = "all";
    showDiffMap();
    setTimeout(() => {
      const hunkEl = hunk && document.getElementById("hunk-" + hunk.id);

      if (!hunkEl) return;

      hunkEl.scrollIntoView({ behavior: "smooth", block: "center" });
      hunkEl.animate([{ outline: "2px solid var(--accent)" }, { outline: "2px solid transparent" }], { duration: HUNK_FLASH_MS });
    }, HUNK_SCROLL_DELAY_MS);
  }

  // The "Show …" action for a finding at /<collection>/<index> in the review file.
  function pathTarget(collection, index) {
    if (collection === "nodes") {
      return {
        label: "Show node",
        go: () => {
          const node = reviewData.nodes[+index];

          if (isNonCode(node)) {
            setView("other");
            select({ type: "node", id: node.id });

            return;
          }

          // Scoped first, so the graph opens on the node instead of an empty prompt.
          setFocus({ type: "node", id: node.id });
          if (state.view !== "graph" && state.view !== "flows") setView("graph");
          select({ type: "node", id: node.id });
        },
      };
    }
    if (collection === "edges") {
      return {
        label: "Show edge",
        go: () => {
          setFocus({ type: "edge", id: "e" + index });
          if (state.view !== "graph" && state.view !== "flows") setView("graph");
          select({ type: "edge", id: "e" + index });
        },
      };
    }

    return {
      label: "Show claim",
      go: () => {
        state.claimFilter = "all";
        state.openFiles.add(`ev:${index}:0`);
        setView("claims");
        renderView();
      },
    };
  }

  // The "Show …" action for a finding: its element in the review file, or its file in the diff map.
  function findingTarget(finding) {
    const match = finding.path && finding.path.match(/^\/(nodes|edges|claims)\/(\d+)/);

    if (match) return pathTarget(match[1], match[2]);
    if (!finding.repo || !finding.file) return null;

    const file = reviewData.files.find((candidate) => candidate.repo === finding.repo && candidate.path === finding.file);

    if (!file) return null;

    const overlapsFinding = (hunk) => {
      const [start, end] = hunkLines(hunk);

      return finding.lines[0] <= end && finding.lines[1] >= start;
    };
    const hunk = finding.lines ? file.hunks.find(overlapsFinding) : null;

    return { label: "Show in diff map", go: () => showHunk(file, hunk) };
  }

  // withGo adds the "Show …" link; element inspectors leave it out.
  function findingItem(finding, withGo) {
    const fileLocation = finding.repo && finding.file
      ? `${finding.repo} › ${finding.file}${finding.lines ? ":" + rangeText(finding.lines) : ""}`
      : finding.repo;
    const where = [finding.path, fileLocation].filter(Boolean).join("  ");
    const target = withGo && findingTarget(finding);

    return el("div", { class: "fitem " + (finding.level === "error" ? "err" : "warn") },
      el("div", { class: "top" },
        el("span", { class: "code-n" }, finding.code),
        finding.status ? statusBadge(finding.status) : null,
        el("span", { class: "where" }, where)),
      el("div", { class: "msg" }, finding.message),
      finding.hint ? el("div", { class: "hint" }, "Hint: ", finding.hint) : null,
      target ? el("div", { class: "go" }, el("button", { class: "link", onclick: target.go }, target.label + " →")) : null);
  }

  // ── Keyboard ───────────────────────────────────────────────
  const VIEW_KEYS = VIEWS.map((view, i) => String(i + 1));

  document.addEventListener("keydown", (event) => {
    const isTyping = event.target.closest && event.target.closest("input, textarea, select");

    if (isTyping) return;

    const isPlainKey = !event.metaKey && !event.ctrlKey;

    if (event.key === "Escape") select(null);
    if (event.key === "[" && isPlainKey) toggleSidebar();
    if (event.key === "/" && state.view === "graph") {
      const search = document.querySelector(".search");

      if (search) {
        event.preventDefault();
        search.focus();
      }
    }

    const isNodeSelected = state.selection && state.selection.type === "node" && nodeById.has(state.selection.id);

    if (event.key === "r" && isPlainKey && isNodeSelected) toggleNodeRead(state.selection.id);

    const viewIndex = VIEW_KEYS.indexOf(event.key);

    if (viewIndex >= 0 && isPlainKey && isViewShown(VIEWS[viewIndex])) setView(VIEWS[viewIndex].id);
  });

  // Graph colours are read from CSS variables, so an OS theme switch needs a redraw.
  const darkScheme = matchMedia("(prefers-color-scheme: dark)");

  if (darkScheme.addEventListener) {
    darkScheme.addEventListener("change", () => {
      if (state.theme === "auto" && state.view === "graph") renderView();
    });
  }

  readHash();
  revealInGraph(state.selection);
  render();
})();
