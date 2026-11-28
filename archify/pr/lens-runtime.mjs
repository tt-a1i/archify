export function alignPayloadLines(left, right) {
  const width = right.length + 1;
  const size = (left.length + 1) * width;
  // The limit includes the extra row and column used by the recurrence.
  if (size > 1_000_000) return null;
  const counts = new Uint32Array(size);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      const index = i * width + j;
      counts[index] = left[i] === right[j] ? counts[index + width + 1] + 1 : Math.max(counts[index + width], counts[index + 1]);
    }
  }
  const pairs = [];
  for (let i = 0, j = 0; i < left.length || j < right.length;) {
    if (i < left.length && j < right.length && left[i] === right[j]) pairs.push([left[i++], right[j++]]);
    else if (i < left.length && (j === right.length || counts[(i + 1) * width + j] >= counts[i * width + j + 1])) pairs.push([left[i++], null]);
    else pairs.push([null, right[j++]]);
  }
  return pairs;
}


// Serialized into the offline document. Keep browser dependencies inside this function.
export function runLens(alignPayloadLines) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const all = (scope, selector) => [...scope.querySelectorAll(selector)];
  const model = JSON.parse($('lens-data').textContent);
  const root = document.documentElement;
  const canvas = $('canvas');
  const shadow = canvas.attachShadow({ mode: 'open' });
  const storageKey = `archify-pr-lens:${model.digest}`;
  const stepIds = new Set(model.steps.map((step) => step.id));
  const reviewed = new Set();
  let storage;
  try {
    storage = window.sessionStorage;
    const saved = storage.getItem(storageKey);
    if (saved) {
      try {
        const entries = JSON.parse(saved);
        if (Array.isArray(entries) && entries.every((id) => stepIds.has(id))) {
          for (const id of entries) reviewed.add(id);
        }
      } catch {
        // A malformed value is equivalent to an unreviewed walkthrough.
      }
    }
    storage.setItem(storageKey, JSON.stringify([...reviewed]));
  } catch {
    storage = null;
  }
  $('storage-note').hidden = Boolean(storage);

  let selected = 0;
  let activeView = -1;
  let pinned;
  let hovered;
  let focused;
  let graph;
  const mode = () => root.dataset.mode;
  const step = () => model.steps[selected];

  function add(parent, tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    parent.append(item);
    return item;
  }

  function showChanges(parent, changes) {
    if (!changes.length) return;
    const list = add(parent, 'ul', undefined, 'changes');
    for (const row of changes) {
      const item = add(list, 'li');
      add(item, 'span', row.change, `mark ${row.change}`);
      add(item, 'b', row.subject);
      add(item, 'span', [row.kind, row.detail].filter(Boolean).join(' · '), 'muted');
    }
  }

  const range = model.revisions;
  const short = (sha) => sha?.slice(0, 10);
  const meta = $('meta');
  if (model.pullRequest?.number) add(meta, 'span', `PR #${model.pullRequest.number} · Declared`, 'pr-number');
  for (const text of [model.repository, model.pullRequest?.author && `${model.pullRequest.author} · Declared`]) {
    if (text) add(meta, 'span', text);
  }
  const side = (name) => {
    const ref = range[`${name}Ref`];
    const sha = range[`${name}Sha`];
    return [ref, short(sha)].filter(Boolean).join(' @ ') || 'unspecified';
  };
  add(meta, 'span', `${range.verified ? 'Pinned' : 'Declared'} · ${side('base')} → ${side('head')}`);
  $('title').textContent = model.title;
  $('summary').textContent = model.summary || '';
  $('summary').hidden = !model.summary;
  const countLabels = { filesChanged: 'files', additions: 'additions', deletions: 'deletions' };
  for (const { key, value, origin } of model.counts) {
    const label = Object.hasOwn(countLabels, key) ? countLabels[key] : key;
    add($('counts'), 'li', `${value} ${label} · ${origin}`, key === 'additions' ? 'added' : key === 'deletions' ? 'removed' : '');
  }
  for (const fact of model.pullRequest?.facts || []) add($('facts'), 'li', fact);
  showChanges($('unassigned'), model.unassigned);
  for (const citation of model.unassignedCitations) {
    const hunk = model.hunks[citation.hunkIndex];
    add($('unassigned'), 'p', pinnedCitation(citation, hunk), 'filebar');
    if (hunk) {
      const scroll = add($('unassigned'), 'div', undefined, 'evidence-scroll');
      scroll.setAttribute('data-evidence-scroll', '');
      scroll.setAttribute('aria-label', 'Diff with base and head line numbers');
      scroll.setAttribute('role', 'region');
      scroll.tabIndex = 0;
      scroll.append(diffRows(hunk));
    } else add($('unassigned'), 'p', citation.reason, 'empty');
  }
  $('unassigned').hidden = model.unassigned.length === 0;
  $('notice-text').textContent = model.notices;
  $('notices-button').onclick = () => $('notices').showModal();
  $('close-notices').onclick = () => $('notices').close();

  const rows = model.steps.map((entry, index) => {
    const row = add($('steps'), 'li', undefined, 'step');
    const button = add(row, 'button', undefined, 'step-button');
    add(button, 'span', String(index + 1).padStart(2, '0'), 'ordinal').setAttribute('aria-hidden', 'true');
    add(button, 'span', entry.title, 'step-title');
    if (entry.citations[0]) add(button, 'code', cite(entry.citations[0]), 'step-path');
    if (entry.body) add(row, 'p', entry.body, 'step-body');
    showChanges(row, entry.changes);
    const footer = add(row, 'div', undefined, 'step-meta');
    if (entry.change) add(footer, 'span', entry.change, `mark ${entry.change}`);
    const label = add(footer, 'label', undefined, 'review');
    const checkbox = add(label, 'input');
    checkbox.type = 'checkbox';
    checkbox.checked = reviewed.has(entry.id);
    checkbox.setAttribute('aria-label', `Reviewed: ${entry.title}`);
    label.append('Reviewed');
    button.onclick = () => setStep(index);
    checkbox.onchange = () => {
      if (checkbox.checked) reviewed.add(entry.id);
      else reviewed.delete(entry.id);
      try {
        storage?.setItem(storageKey, JSON.stringify([...reviewed]));
      } catch {
        storage = null;
        $('storage-note').hidden = false;
      }
      showProgress();
    };
    return { row, button };
  });

  const tabs = model.views.map((view, index) => {
    const tab = add($('view-tabs'), 'button', view.title);
    const detail = [view.type, view.storyOnly && 'Story helper'].filter(Boolean).join(' · ');
    add(tab, 'small', detail);
    tab.setAttribute('aria-label', `${view.title} · ${detail}`);
    tab.id = `view-${index}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', 'canvas');
    tab.dataset.viewId = view.id;
    tab.onclick = () => setView(index);
    return tab;
  });

  const evidenceTabs = all($('evidence-tabs'), '[role="tab"]');
  for (const tab of evidenceTabs) tab.onclick = () => selectEvidenceTab(tab);
  function selectEvidenceTab(active) {
    for (const tab of evidenceTabs) {
      const current = tab === active;
      tab.tabIndex = current ? 0 : -1;
      tab.setAttribute('aria-selected', String(current));
      $(tab.getAttribute('aria-controls')).hidden = !current;
    }
  }
  selectEvidenceTab(evidenceTabs[0]);

  function showProgress() {
    $('progress-label').textContent = `${reviewed.size} / ${model.steps.length} reviewed`;
    $('progress').max = model.steps.length;
    $('progress').value = reviewed.size;
  }

  function setStep(index) {
    if (index < 0 || index >= rows.length) return;
    selected = index;
    pinned = hovered = focused = undefined;
    for (const [i, { row, button }] of rows.entries()) {
      row.classList.toggle('active', i === index);
      button.setAttribute('aria-current', i === index ? 'step' : 'false');
    }
    $('previous').disabled = index === 0;
    $('next').disabled = index === rows.length - 1;
    $('step-count').textContent = `${index + 1} / ${rows.length}`;
    const list = $('steps');
    const listRect = list.getBoundingClientRect();
    const rowRect = rows[index].row.getBoundingClientRect();
    if (rowRect.top < listRect.top) list.scrollTop -= listRect.top - rowRect.top;
    else if (rowRect.bottom > listRect.bottom) list.scrollTop += Math.min(rowRect.top - listRect.top, rowRect.bottom - listRect.bottom);
    setView(step().viewIndex);
    fillSelector('slices', step().citations, (entry) => [entry.id, cite(entry)].filter(Boolean).join(' · '));
    fillSelector('payloads', step().payloads, (entry) => entry.label);
    showDiff();
    showPayload();
  }

  function showActiveTab() {
    const tab = tabs[activeView];
    const list = tab.parentElement;
    const bounds = list.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    if (rect.left < bounds.left || rect.width > bounds.width) list.scrollLeft += rect.left - bounds.left;
    else if (rect.right > bounds.right) list.scrollLeft += rect.right - bounds.right;
  }

  function setView(index) {
    if (activeView !== index) {
      activeView = index;
      pinned = hovered = focused = undefined;
      for (const [i, tab] of tabs.entries()) {
        tab.setAttribute('aria-selected', String(i === index));
        tab.tabIndex = i === index ? 0 : -1;
      }
      canvas.setAttribute('aria-labelledby', tabs[index].id);
      showActiveTab();
      shadow.replaceChildren($(`scene-${index}`).content.cloneNode(true));
      canvas.scrollLeft = 0;
      const svg = shadow.querySelector('svg');
      const { nodes, edges } = model.views[index];
      const groups = new Map();
      for (const part of all(svg, '[data-lens-owner]')) {
        const key = part.dataset.lensOwner;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(part);
      }
      for (const owner of [...nodes, ...edges]) {
        const [control] = groups.get(owner.key);
        control.setAttribute('role', 'button');
        control.setAttribute('tabindex', '0');
        control.setAttribute('aria-pressed', 'false');
        if (!control.hasAttribute('aria-label')) {
          control.setAttribute('aria-label', owner.label || owner.id || [owner.from, owner.to].join(' → '));
        }
      }
      graph = {
        svg, nodes, edges, groups,
        decorations: all(svg, '[data-lens-participant], [data-lens-decoration], [data-lens-lane]'),
        sideLabels: all(svg, '[data-lens-before]').map((node) => ({ node, delta: node.textContent })),
      };
    }
    showDiagram();
  }

  function showDiagram() {
    const { svg, nodes, edges, groups, decorations, sideLabels } = graph;
    const version = mode();
    const linked = step().viewIndex === activeView;
    svg.dataset.theme = root.dataset.theme;
    svg.dataset.mode = version;
    const absentChange = version === 'before' ? 'added' : version === 'after' ? 'removed' : null;
    const missingNodes = new Set(nodes.filter((node) => node.change === absentChange).map((node) => node.id));
    const missing = new Set(nodes.filter((node) => missingNodes.has(node.id)).map((node) => node.key));
    for (const edge of edges) {
      if (edge.change === absentChange || missingNodes.has(edge.from) || missingNodes.has(edge.to)) missing.add(edge.key);
    }
    const inspect = [hovered, focused, pinned].find((key) => key && !missing.has(key));
    const current = linked ? step() : null;
    const primary = new Set(inspect ? [inspect] : (current?.focus || []).filter((key) => !missing.has(key)));
    const focusNodes = new Set(nodes.filter((node) => primary.has(node.key)).map((node) => node.id));
    const nearNodes = new Set();
    const near = new Set();
    for (const edge of edges) {
      if (missing.has(edge.key)) continue;
      if (primary.has(edge.key) || focusNodes.has(edge.from) || focusNodes.has(edge.to)) {
        near.add(edge.key);
        nearNodes.add(edge.from);
        nearNodes.add(edge.to);
      }
    }
    for (const node of nodes) if (nearNodes.has(node.id)) near.add(node.key);
    svg.toggleAttribute('data-lens-inspecting', primary.size > 0);
    for (const [key, parts] of groups) {
      const absent = missing.has(key);
      for (const part of parts) {
        part.toggleAttribute('data-lens-absent', absent);
        if (absent) part.setAttribute('aria-hidden', 'true');
        else part.removeAttribute('aria-hidden');
        if (primary.has(key) || near.has(key)) part.dataset.lensHighlight = primary.has(key) ? 'focus' : 'near';
        else delete part.dataset.lensHighlight;
      }
      const control = parts[0];
      control.setAttribute('tabindex', absent ? '-1' : '0');
      control.setAttribute('aria-pressed', String(pinned === key && !absent));
    }
    for (const node of decorations) {
      const owners = node.dataset.lensDecoration?.split(' ');
      const frame = node.hasAttribute('data-lens-lane') && node.querySelector('[data-graph-role="structural-frame"]');
      const absent = missingNodes.has(node.dataset.lensParticipant)
        || (owners?.every((key) => missing.has(key)) ?? false)
        || Boolean(frame && frame.dataset.change === absentChange);
      node.toggleAttribute('data-lens-absent', absent);
      if (absent || !frame) node.setAttribute('aria-hidden', 'true');
      else node.removeAttribute('aria-hidden');
    }
    for (const { node, delta } of sideLabels) {
      const text = version === 'delta' ? delta : node.dataset[version === 'before' ? 'lensBefore' : 'lensAfter'];
      if (node.textContent !== text) node.textContent = text;
    }
    const label = current && (version === 'before' ? current.beforeLabel : version === 'after' ? current.afterLabel : current.title);
    $('diagram-caption').textContent = label || (version === 'delta' ? model.views[activeView].caption : 'Projection of the change-marked view') || 'Change-marked view';
    if (version !== 'delta' && label) $('diagram-caption').textContent += ' · Projection of the change-marked view';
  }

  function cite(entry) {
    return `${entry.path}${entry.line === undefined ? '' : `:${entry.line}`} · ${entry.side}`;
  }

  function fillSelector(id, entries, label) {
    const select = $(id);
    select.replaceChildren();
    entries.forEach((entry, index) => { add(select, 'option', label(entry)).value = index; });
    select.parentElement.hidden = entries.length < 2;
  }

  function diffRows(hunk) {
    const result = document.createElement('div');
    result.className = 'diff-content';
    add(result, 'code', hunk.header, 'hunk');
    for (const row of hunk.rows) {
      const line = add(result, 'div', undefined, `diff-line ${row.kind}`);
      add(line, 'span', row.oldLine ?? '', 'line-number');
      add(line, 'span', row.newLine ?? '', 'line-number');
      add(line, 'span', { addition: '+', deletion: '−', context: ' ', marker: '' }[row.kind], 'sign');
      add(line, 'code', row.text);
    }
    return result;
  }

  function showDiff() {
    const entry = step().citations[Number($('slices').value)];
    const hunk = model.hunks[entry?.hunkIndex];
    const content = $('diff');
    content.replaceChildren();
    content.scrollTop = content.scrollLeft = 0;
    $('diff-path').textContent = entry ? pinnedCitation(entry, hunk) : '';
    if (hunk) content.append(diffRows(hunk));
    else add(content, 'p', entry ? entry.reason : 'No source citations for this step.', 'empty');
  }

  function pinnedCitation(entry, hunk) {
    const file = hunk || entry;
    if (!file.oldPath && !file.newPath) return cite(entry);
    const line = entry.line === undefined ? '' : ` line ${entry.line}`;
    return `Base ${file.oldPath || '∅'} @ ${range.baseSha} → Head ${file.newPath || '∅'} @ ${range.headSha} · ${entry.side}${line}`;
  }

  function jsonLines(payload, side) {
    return Object.hasOwn(payload, side) ? JSON.stringify(payload[side], null, 2).split('\n') : [];
  }

  function showPayload() {
    const entry = step().payloads[Number($('payloads').value)];
    const container = $('payload');
    container.replaceChildren();
    if (!entry) {
      add(container, 'p', 'No authored payload for this step.', 'empty');
      return;
    }
    const { payload } = entry;
    add(container, 'p', [entry.label, payload.summary, payload.contentType].filter(Boolean).join(' · '), 'payload-note');
    if (Object.hasOwn(payload, 'before') || Object.hasOwn(payload, 'after')) {
      const left = jsonLines(payload, 'before');
      const right = jsonLines(payload, 'after');
      const aligned = alignPayloadLines(left, right);
      if (!aligned) add(container, 'p', 'Alignment unavailable for this payload size.', 'payload-note');
      const table = add(container, 'div', undefined, 'payload-table');
      const heading = add(table, 'div', undefined, 'payload-row payload-head');
      add(heading, 'span', step().beforeLabel || 'Before');
      add(heading, 'span', step().afterLabel || 'After');
      if (!left.length || !right.length) {
        const omitted = add(table, 'div', undefined, 'payload-row');
        add(omitted, 'span', left.length ? '' : 'No before value supplied', 'muted');
        add(omitted, 'span', right.length ? '' : 'No after value supplied', 'muted');
      }
      const pairs = aligned || Array.from({ length: Math.max(left.length, right.length) }, (_, i) => [left[i] ?? null, right[i] ?? null]);
      for (const [before, after] of pairs) {
        const row = add(table, 'div', undefined, 'payload-row');
        add(row, 'code', before ?? '', before !== null && after === null && aligned ? 'deletion' : '');
        add(row, 'code', after ?? '', after !== null && before === null && aligned ? 'addition' : '');
      }
    }
    if (Object.hasOwn(payload, 'sample')) {
      add(container, 'h3', 'Sample', 'payload-note');
      add(container, 'pre', jsonLines(payload, 'sample').join('\n'), 'sample');
    }
  }

  function choices(field, update) {
    const buttons = all(document, `[data-${field}-choice]`);
    for (const button of buttons) button.onclick = () => {
      const value = button.getAttribute(`data-${field}-choice`);
      root.dataset[field] = value;
      for (const choice of buttons) choice.setAttribute('aria-pressed', String(choice === button));
      update();
    };
  }
  choices('mode', showDiagram);
  choices('theme', showDiagram);
  $('previous').onclick = () => setStep(selected - 1);
  $('next').onclick = () => setStep(selected + 1);
  $('slices').onchange = showDiff;
  $('payloads').onchange = showPayload;

  const ownerOf = (target) => target?.closest?.('[data-lens-owner]:not([data-lens-absent])')?.dataset.lensOwner;
  function inspectFrom(event, kind, target) {
    const key = ownerOf(target);
    if (kind === 'pointer') {
      if (event.pointerType === 'touch' || hovered === key) return;
      hovered = key;
    } else {
      if (focused === key) return;
      focused = key;
    }
    showDiagram();
  }
  shadow.addEventListener('pointerover', (event) => inspectFrom(event, 'pointer', event.target));
  shadow.addEventListener('pointerout', (event) => inspectFrom(event, 'pointer', event.relatedTarget));
  shadow.addEventListener('focusin', (event) => inspectFrom(event, 'focus', event.target));
  shadow.addEventListener('focusout', (event) => inspectFrom(event, 'focus', event.relatedTarget));
  function pin(target) {
    const key = ownerOf(target);
    if (!key) return false;
    pinned = key;
    showDiagram();
    return true;
  }
  shadow.addEventListener('click', (event) => pin(event.target));

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
    const { target } = event;
    const key = event.key.toLowerCase();
    if (key === 'escape' && !$('notices').open) {
      pinned = hovered = focused = undefined;
      showDiagram();
      return;
    }
    if ($('notices').open) return;
    if ((key === 'enter' || key === ' ') && pin(event.composedPath()[0])) {
      event.preventDefault();
      return;
    }
    const tablist = target.closest?.('[role="tablist"]');
    if (tablist && ['arrowleft', 'arrowright', 'home', 'end'].includes(key)) {
      const buttons = all(tablist, '[role="tab"]');
      const i = buttons.indexOf(target);
      const next = key === 'home' ? 0 : key === 'end' ? buttons.length - 1
        : (i + (key === 'arrowleft' ? -1 : 1) + buttons.length) % buttons.length;
      event.preventDefault();
      buttons[next].click();
      buttons[next].focus();
      return;
    }
    if (target.closest?.('input, select, textarea, [contenteditable], [data-evidence-scroll]')) return;
    if (!['j', 'k', 'arrowleft', 'arrowright'].includes(key)) return;
    if (target === canvas && canvas.scrollWidth > canvas.clientWidth && key.startsWith('arrow')) return;
    event.preventDefault();
    setStep(selected + (key === 'j' || key === 'arrowright' ? 1 : -1));
    if (target.closest?.('.step-button')) rows[selected].button.focus();
  });

  showProgress();
  setStep(0);
  window.addEventListener('resize', showActiveTab);
}
