/* Optional interval editing in the shared Viewer. */
(function (root) {
  function attach({
    plot,
    input,
    toolbar,
    status,
    rerender,
    validateDocument,
    getAcceptedSpec,
  }) {
    let enabled = false,
      drag = null,
      selected = null;
    const history = [];
    const button = (label, action) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.dataset.editorAction = action;
      toolbar.append(b);
      return b;
    };
    const toggle = button(viewerText("viewer.interval.edit"), "toggle"),
      undo = button(viewerText("viewer.interval.undo"), "undo"),
      download = button(viewerText("viewer.interval.download"), "download");
    toggle.setAttribute("aria-pressed", "false");
    undo.disabled = true;
    plot.tabIndex = 0;
    const say = (s) => {
      status.textContent = s;
    };
    const round = (n) => Number(n.toFixed(2));
    const itemAt = (spec, path) =>
      path.reduce((value, key) => value[key], spec);
    const screenPoint = (svg, e) => {
      const p = svg.createSVGPoint();
      p.x = e.clientX;
      p.y = e.clientY;
      return p.matrixTransform(svg.getScreenCTM().inverse());
    };
    const position = (value, spec, width) => {
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        if (value.endsWith("%")) return (parseFloat(value) * width) / 100;
        if (value.endsWith("u")) return parseFloat(value);
        if (spec.anchors && Object.hasOwn(spec.anchors, value))
          return position(spec.anchors[value].at, spec, width);
      }
      throw Error(viewerText("viewer.interval.positionError"));
    };
    const moved = (value, delta, spec, width) => {
      const next = round(position(value, spec, width) + delta);
      if (typeof value === "string" && value.endsWith("%"))
        return `${round((next / width) * 100)}%`;
      if (typeof value === "string" && value.endsWith("u")) return `${next}u`;
      return next;
    };
    const addOffset = (value, dx, dy) => [
      round((value?.[0] ?? 0) + dx),
      round((value?.[1] ?? 0) + dy),
    ];
    const rangeWidth = (spec) => spec.unitWidth ?? Archify.intervalLayout(spec).width;
    const apply = (state, dx, dy) => {
      const before = input.value,
        spec = JSON.parse(before),
        svg = plot.querySelector("svg");
      if (
        (!dx && !dy) ||
        (!dx &&
          ["at", "from", "to", "body"].includes(state.mode) &&
          state.kind !== "object")
      )
        return;
      const width = rangeWidth(spec);
      const dxUnits = dx / Number(svg.dataset.xScale);
      const item = itemAt(spec, state.path);
      let materialized = false;
      const shift = (value) => {
        if (
          typeof value === "string" &&
          !value.endsWith("%") &&
          !value.endsWith("u")
        )
          materialized = true;
        return moved(value, dxUnits, spec, width);
      };
      if (state.mode === "label")
        item.labelOffset = addOffset(item.labelOffset ?? state.layoutOffset, dx, dy);
      else if (state.mode === "callout") {
        if (item.y_pos === undefined)
          item.y_pos = (item.offsetY ?? -28) > 0 ? "bottom" : "top";
        item.offsetX = round((item.offsetX ?? 28) + dx);
        item.offsetY = round((item.offsetY ?? -28) + dy);
      } else if (state.mode === "at") item.at = shift(item.at);
      else if (state.mode === "from" || state.mode === "to")
        item[state.mode] = shift(item[state.mode]);
      else if (state.mode === "body") {
        if (dx) {
          item.from = shift(item.from);
          item.to = shift(item.to);
        }
        if (state.kind === "object")
          item.offsetY = round((item.offsetY ?? 0) + dy);
      }
      const frozeRange =
        spec.unitWidth === undefined &&
        dx &&
        ["at", "from", "to", "body"].includes(state.mode);
      if (frozeRange) spec.unitWidth = round(width);
      if (JSON.stringify(spec) === JSON.stringify(JSON.parse(before))) return;
      validateDocument(spec);
      Archify.intervalLayout(spec);
      history.push(before);
      input.value = JSON.stringify(spec, null, 2);
      undo.disabled = false;
      rerender();
      say(
        [
          materialized ? viewerText("viewer.interval.materialized") : "",
          frozeRange ? viewerText("viewer.interval.rangePinned") : "",
        ]
          .filter(Boolean)
          .join(" ") || viewerText("viewer.interval.updated"),
      );
    };
    const targetFor = (e) => {
      const handle = e.target.closest("[data-edit-handle]");
      const element = e.target.closest("[data-edit-path]");
      if (!element) return null;
      const group = handle?.closest("g[data-edit-path]") || element;
      const kind =
        element.dataset.kind || element.closest("g[data-kind]")?.dataset.kind;
      const edit = element.dataset.editKind;
      const path = JSON.parse(
        handle?.dataset.editPath || element.dataset.editPath,
      );
      const mode =
        handle?.dataset.editHandle ||
        (edit === "body" && element.dataset.editAtPath ? "at" : edit);
      if (!["label", "callout", "at", "body", "from", "to"].includes(mode))
        return null;
      if (kind === "callout-index" && mode === "callout") return null;
      if (mode === "body" && !["span", "object"].includes(kind)) return null;
      if (mode === "label" && ["label", "text"].includes(path.at(-1)))
        path.pop();
      const label = group.matches("text[data-layout-offset]")
        ? group
        : group.querySelector("text[data-layout-offset]");
      const layoutOffset = label
        ? JSON.parse(label.dataset.layoutOffset)
        : undefined;
      return { group, path, mode, kind, layoutOffset };
    };
    const refresh = () => {
      plot.classList.toggle("editing", enabled);
      for (const old of plot.querySelectorAll(".edit-handle")) old.remove();
      if (!enabled) return;
      const svg = plot.querySelector("svg");
      if (!svg) return;
      let spec;
      try {
        spec = JSON.parse(input.value);
      } catch {
        return;
      }
      const width = rangeWidth(spec),
        origin = Number(svg.dataset.xOrigin);
      for (const group of plot.querySelectorAll(
        'g[data-kind="span"][data-edit-path],g[data-kind="object"][data-edit-path]',
      )) {
        const rect = group.querySelector("rect");
        if (!rect) continue;
        const y = Number(rect.getAttribute("y")),
          h = Number(rect.getAttribute("height"));
        const item = itemAt(spec, JSON.parse(group.dataset.editPath));
        for (const [mode, cx] of [
          [
            "from",
            origin +
              position(item.from, spec, width) * Number(svg.dataset.xScale),
          ],
          [
            "to",
            origin +
              position(item.to, spec, width) * Number(svg.dataset.xScale),
          ],
        ]) {
          const circle = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle",
          );
          circle.setAttribute("cx", cx);
          circle.setAttribute("cy", y + h / 2);
          circle.setAttribute("r", 7);
          circle.setAttribute("class", "edit-handle");
          circle.dataset.editHandle = mode;
          circle.dataset.editPath = group.dataset.editPath;
          group.append(circle);
        }
      }
    };
    plot.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".interval-editor")) {
        e.stopImmediatePropagation();
        return;
      }
      if (!enabled || e.button !== 0) return;
      const state = targetFor(e);
      if (!state) return;
      e.stopImmediatePropagation();
      const svg = plot.querySelector("svg"),
        start = screenPoint(svg, e);
      drag = { ...state, svg, start };
      selected = { path: state.path, mode: state.mode, kind: state.kind, layoutOffset: state.layoutOffset };
      plot.focus({ preventScroll: true });
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    plot.addEventListener("pointermove", (e) => {
      if (!drag) return;
      e.stopImmediatePropagation();
      const p = screenPoint(drag.svg, e),
        dx = round(p.x - drag.start.x),
        dy = round(p.y - drag.start.y);
      if (drag.mode === "from" || drag.mode === "to") {
        const handle = drag.group.querySelector(
          `[data-edit-handle="${drag.mode}"]`,
        );
        if (handle) handle.setAttribute("transform", `translate(${dx} 0)`);
      } else
        drag.group.setAttribute(
          "transform",
          `translate(${dx} ${["label", "callout"].includes(drag.mode) || drag.kind === "object" ? dy : 0})`,
        );
    });
    const endDrag = (e) => {
      if (!drag) return;
      e.stopImmediatePropagation();
      const state = drag,
        p = screenPoint(state.svg, e),
        dx = round(p.x - state.start.x),
        dy = round(p.y - state.start.y);
      state.group.removeAttribute("transform");
      state.group
        .querySelectorAll(".edit-handle")
        .forEach((h) => h.removeAttribute("transform"));
      drag = null;
      if (e.type === "pointercancel") return;
      try {
        apply(state, dx, dy);
      } catch (error) {
        say(
          viewerText("viewer.interval.editFailed", { reason: error.message }),
        );
      }
    };
    plot.addEventListener("pointerup", endDrag);
    plot.addEventListener("pointercancel", endDrag);
    plot.addEventListener("keydown", (e) => {
      if (
        !enabled ||
        !selected ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      )
        return;
      const step = e.shiftKey ? 10 : 1,
        dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
        dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      if (dy && ["at", "from", "to"].includes(selected.mode)) return;
      e.preventDefault();
      try {
        apply(selected, dx, dy);
      } catch (error) {
        say(
          viewerText("viewer.interval.editFailed", { reason: error.message }),
        );
      }
    });
    toggle.onclick = () => {
      enabled = !enabled;
      toggle.setAttribute("aria-pressed", String(enabled));
      toggle.textContent = viewerText(
        enabled ? "viewer.interval.done" : "viewer.interval.edit",
      );
      say(enabled ? viewerText("viewer.interval.dragHint") : "");
      refresh();
    };
    undo.onclick = () => {
      if (!history.length) return;
      input.value = history.pop();
      undo.disabled = !history.length;
      rerender();
      say(viewerText("viewer.interval.undone"));
    };
    download.onclick = () => {
      try {
        let spec;
        let validDraft = true;
        try {
          spec = JSON.parse(input.value);
          validateDocument(spec);
          rerender();
        } catch (_) {
          spec = getAcceptedSpec();
          validDraft = false;
        }
        const source = JSON.stringify(spec, null, 2) + "\n",
          url = URL.createObjectURL(
            new Blob([source], { type: "application/json" }),
          );
        const link = document.createElement("a");
        link.href = url;
        link.download = "diagram.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        say(
          viewerText(
            validDraft
              ? "viewer.interval.downloaded"
              : "viewer.interval.downloadedLastValid",
          ),
        );
      } catch (error) {
        say(
          viewerText("viewer.interval.downloadFailed", {
            reason: error.message,
          }),
        );
      }
    };
    return {
      refresh,
      clearSelection: () => {
        selected = null;
      },
    };
  }
  Archify.intervalEditor = { attach };
})(typeof globalThis !== "undefined" ? globalThis : this);

(function () {
  const source = document.getElementById("archify-interval-data");
  if (!source) return;
  const plot = document.querySelector(".diagram-container");
  if (!plot) return;
  let payload;
  try {
    payload = JSON.parse(source.textContent);
  } catch (error) {
    return;
  }
  let acceptedSpec = payload.spec;
  const validateDocument = (spec) => {
    if (Archify.validateInterval(spec)) return;
    const issue = Archify.validateInterval.errors?.[0];
    throw Error(
      `${issue?.instancePath || "/"} ${issue?.message || viewerText("viewer.interval.invalid")}`,
    );
  };
  try {
    validateDocument(acceptedSpec);
  } catch (error) {
    return;
  }
  Archify.interval = {};
  document.documentElement.dataset.interval = "true";
  for (const id of [
    "btn-route-probe",
    "btn-overview-map",
    "btn-semantic-lens",
    "btn-node-finder",
    "btn-diagram-guide",
  ]) {
    const button = document.getElementById(id);
    if (button) {
      button.hidden = true;
      button.disabled = true;
    }
  }
  const element = (tag, className, parent) => {
    const node = document.createElement(tag);
    node.className = className;
    parent.append(node);
    return node;
  };
  // Editing is an authoring mode; ordinary rendered pages remain read-only.
  if (new URLSearchParams(window.location.search).get("edit") !== "1") return;
  const panel = element("details", "interval-editor no-print", plot);
  const summary = element("summary", "interval-tools-summary", panel);
  summary.textContent = viewerText("viewer.interval.tools");
  panel.addEventListener("toggle", () => Archify.readerLayout?.schedule());
  panel.dataset.jsonOpen = "false";
  const toolbar = element("div", "interval-toolbar", panel);
  const jsonToggle = element("button", "interval-json-toggle", panel);
  jsonToggle.type = "button";
  jsonToggle.textContent = viewerText("viewer.interval.editJson");
  jsonToggle.setAttribute("aria-expanded", "false");
  const input = element("textarea", "interval-json", panel);
  input.setAttribute("aria-label", viewerText("viewer.interval.jsonLabel"));
  input.spellcheck = false;
  const apply = element("button", "interval-apply", panel);
  apply.type = "button";
  apply.textContent = viewerText("viewer.interval.applyJson");
  const status = element("p", "interval-status", panel);
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const warningText = element("p", "interval-warnings", panel);
  warningText.setAttribute("role", "status");
  warningText.setAttribute("aria-live", "polite");
  warningText.textContent = (payload.warnings || []).join(" ");
  input.value = JSON.stringify(acceptedSpec, null, 2);
  let controller;
  function rerender() {
    const spec = JSON.parse(input.value);
    validateDocument(spec);
    const result = Archify.intervalLayout(spec);
    const presetChanged =
      spec.meta.visual_preset !== acceptedSpec.meta.visual_preset;
    const current = plot.querySelector("svg");
    const replacement = new DOMParser().parseFromString(
      result.svg,
      "image/svg+xml",
    ).documentElement;
    if (replacement.tagName === "parsererror")
      throw Error(viewerText("viewer.interval.invalidSvg"));
    const accessible = Array.from(current.children).filter(
      (node) => node.tagName === "title" || node.tagName === "desc",
    );
    current.setAttribute("viewBox", replacement.getAttribute("viewBox"));
    current.dataset.xOrigin = replacement.getAttribute("data-x-origin");
    current.dataset.xScale = replacement.getAttribute("data-x-scale");
    current.replaceChildren(...accessible, ...Array.from(replacement.children));
    const title = current.querySelector("#archify-diagram-title");
    const heading = document.querySelector(".header h1");
    if (title) title.textContent = spec.meta.title;
    if (heading) heading.textContent = spec.meta.title;
    document.title = spec.meta.title;
    const description = current.querySelector("#archify-diagram-description");
    let subtitle = document.querySelector(".header .subtitle");
    if (description)
      description.textContent =
        spec.meta.subtitle || viewerText("viewer.interval.description");
    if (spec.meta.subtitle) {
      if (!subtitle) {
        subtitle = document.createElement("p");
        subtitle.className = "subtitle";
        document.querySelector(".header")?.append(subtitle);
      }
      subtitle.textContent = spec.meta.subtitle;
    } else subtitle?.remove();
    warningText.textContent = result.warnings.join(" ");
    if (presetChanged && Archify.preset)
      Archify.preset.apply(spec.meta.visual_preset || "classic");
    acceptedSpec = structuredClone(spec);
    controller?.refresh();
    controller?.clearSelection();
  }
  controller = Archify.intervalEditor.attach({
    plot,
    input,
    toolbar,
    status,
    rerender,
    validateDocument,
    getAcceptedSpec: () => acceptedSpec,
  });
  jsonToggle.onclick = () => {
    const open = panel.dataset.jsonOpen !== "true";
    panel.dataset.jsonOpen = String(open);
    jsonToggle.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
  };
  apply.onclick = () => {
    try {
      rerender();
      status.textContent = viewerText("viewer.interval.applied");
    } catch (error) {
      status.textContent = viewerText("viewer.interval.jsonError", {
        reason: error.message,
      });
    }
  };
})();
