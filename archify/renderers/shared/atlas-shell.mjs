import { esc } from './utils.mjs';
import { packAtlasBundle, readAtlasBundle } from './atlas-bundle.mjs';
import {
  decodeAtlasPayloadBrowser,
  readAtlasGzipFallbackSource,
  serializeAtlasPayload,
} from './atlas-envelope.mjs';
import { installAtlasNavigation } from './atlas-navigation.mjs';
import { installAtlasWorkbench } from './atlas-workbench.mjs';
import { installAtlasToolbar } from './atlas-toolbar.mjs';

export function renderAtlasShell(bundle, { compressed = true } = {}) {
  const payload = serializeAtlasPayload(packAtlasBundle(bundle), { compressed });
  const fallback = readAtlasGzipFallbackSource();
  return `<!doctype html>
<html lang="${esc(bundle.meta.locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script>try{let t=new URL(location.href).searchParams.get('theme');if(!['light','dark'].includes(t))t=localStorage.getItem('archify-theme');document.documentElement.dataset.theme=['light','dark'].includes(t)?t:matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}catch{document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}</script>
<title>${esc(bundle.meta.title)}</title><link rel="icon" href="data:,">
<style>
html,body{margin:0;height:100%;font:14px system-ui,sans-serif;background:#0d1117;color:#e6edf3}
html{font-size:16px}
body{display:flex;flex-direction:column}main{flex:1;min-height:0;position:relative}iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
iframe[data-atlas-state=staging]{visibility:hidden;pointer-events:none}
#atlas-error{position:absolute;z-index:3;top:80px;left:max(24px,calc((100% - 960px)/2));right:24px;padding:20px;max-width:65ch;background:#161b22;border:1px solid #30363d;border-radius:8px}#atlas-error[hidden]{display:none}#atlas-error button{font:inherit;padding:8px 12px;margin-right:8px;cursor:pointer}
html[data-theme="light"],html[data-theme="light"] body{background:#f8fafc;color:#17202b}
html[data-theme=light] #atlas-error{background:#fff;border-color:#d0d7de}
@media(min-width:1292px){#atlas-error{left:332px}}
</style></head><body>

<main id="atlas-viewer"><section id="atlas-error" role="alert" hidden></section></main>
<script id="archify-atlas-data" type="application/json">${payload}</script>
<script>${fallback}</script>
<script>(${startAtlasRuntime.toString()})(${decodeAtlasPayloadBrowser.toString()},globalThis.ArchifyGzipFallback,${atlasRuntime.toString()},${installAtlasNavigation.toString()},${installAtlasWorkbench.toString()},${installAtlasToolbar.toString()},${readAtlasBundle.toString()});</script></body></html>`;
}

async function startAtlasRuntime(decodePayload, fallbackGunzip, run, installNavigation, installWorkbench, installToolbar, readBundle) {
  const data = document.getElementById('archify-atlas-data');
  const errorView = document.getElementById('atlas-error');
  try {
    const decoded = await decodePayload(data.textContent, fallbackGunzip);
    data.textContent = decoded.source;
    document.documentElement.dataset.atlasDecoder = decoded.decoder;
    try { delete globalThis.ArchifyGzipFallback; } catch {}
    run(installNavigation, installWorkbench, installToolbar, readBundle, decoded.payload);
  } catch (error) {
    try { delete globalThis.ArchifyGzipFallback; } catch {}
    const zh = document.documentElement.lang === 'zh-CN';
    errorView.hidden = false;
    errorView.textContent = `${zh ? '无法打开架构图集' : 'Unable to open this atlas'}: ${error.message} `;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = zh ? '重试' : 'Retry';
    retry.addEventListener('click', () => location.reload());
    errorView.append(retry);
  }
}

function atlasRuntime(installNavigation, installWorkbench, installToolbar, readBundle, decodedPayload) {
  'use strict';
  const viewer = document.getElementById('atlas-viewer');
  const errorView = document.getElementById('atlas-error');
  let reader;
  try { reader = readBundle(decodedPayload === undefined
    ? JSON.parse(document.getElementById('archify-atlas-data').textContent) : decodedPayload); }
  catch (error) {
    const zh = document.documentElement.lang === 'zh-CN';
    errorView.hidden = false;
    errorView.textContent = `${zh ? '无法打开架构图集' : 'Unable to open this atlas'}: ${error.message} `;
    button(zh ? '重试' : 'Retry', () => location.reload(), errorView);
    return;
  }
  const bundle = reader.bundle;
  const zh = bundle.meta.locale === 'zh-CN';
  let active = null, pending = null, queued = null, sequence = 0, revision = 0, sharedMotion = null;
  let requestedGraphInformation = null;
  let handledHistory = null;
  const visits = new Map();
  const preferences = new Map();
  const preferenceKeys = ['theme', 'preset', 'present', 'embed'];
  const uid = () => `${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`;
  const diagramAt = href => new URLSearchParams(new URL(href).hash.slice(1)).get('diagram') ?? bundle.entry;
  const isStructure = href => new URLSearchParams(new URL(href).hash.slice(1)).get('inspect') === 'structure';
  const isCurrent = state => Boolean(state && state === active && !state.revoked && state.phase === 'ready' &&
    history.state?.entryId === state.entryId && diagramAt(location.href) === state.diagram);
  const workbench = installWorkbench({ bundle, navigate, back, onLayoutChange: invalidateLayout });
  const toolbar = installToolbar({ onPreferenceChange: updatePreferences });
  const initial = new URL(location.href);
  let theme = initial.searchParams.get('theme');
  if (!['light', 'dark'].includes(theme)) {
    try { theme = localStorage.getItem('archify-theme'); } catch {}
    if (!['light', 'dark'].includes(theme)) theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    initial.searchParams.set('theme', theme);
  }
  if (!initial.searchParams.has('preset')) initial.searchParams.set('preset', bundle.meta.visual_preset);
  for (const key of preferenceKeys) preferences.set(key, initial.searchParams.get(key));
  document.documentElement.dataset.theme = theme;

  function preferred(href) {
    const url = new URL(href);
    for (const [key, value] of preferences) {
      if (value == null || value === false) url.searchParams.delete(key);
      else url.searchParams.set(key, value === true ? '1' : value);
    }
    return url;
  }
  function canonicalStructureUrl(href) {
    const url = new URL(href);
    const params = new URLSearchParams(url.hash.slice(1));
    if (params.get('inspect') !== 'structure') return url;
    const diagram = params.get('diagram') ?? bundle.entry;
    const focus = params.get('focus');
    const reference = bundle.references.find(item => item.occurrence.diagram === diagram && item.occurrence.node === focus);
    if (!reference) return url;
    params.set('diagram', reference.target.diagram);
    params.set('focus', reference.target.node);
    url.hash = params.toString();
    return url;
  }
  function updatePreferences(values, confirm = true) {
    let changed = false;
    for (const key of preferenceKeys) {
      if (!Object.hasOwn(values, key)) continue;
      const value = typeof values[key] === 'boolean' ? (values[key] ? '1' : null) : values[key];
      if (preferences.get(key) !== value) { preferences.set(key, value); changed = true; }
    }
    if (!changed) return;
    document.documentElement.dataset.theme = preferences.get('theme');
    revision++;
    if (confirm && pending?.phase === 'ready') confirmReady(pending);
    workbench.sync?.();
  }
  function invalidateLayout() {
    revision++;
    if (pending?.phase === 'ready') confirmReady(pending);
  }
  function button(label, callback, container) {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = label; node.addEventListener('click', callback);
    container.append(node);
  }
  function setStatus(text = '') {
    workbench.setStatus(text);
  }
  function setPreparing(value) {
    active?.frame.contentWindow?.ArchifyAddress?.setPreparing(value);
    toolbar.setPreparing(value);
  }
  function captureVisit(state = active, writeHistory = true) {
    if (!state || state !== active || state.revoked || state.phase !== 'ready') return;
    const bridge = state.frame.contentWindow?.ArchifyAddress;
    const reading = bridge?.snapshot();
    if (!reading) return;
    const visit = { href: preferred(bridge.location.href).href,
      snapshot: { ...reading, navigation: state.navigation?.snapshot() } };
    state.href = visit.href;
    visits.set(state.entryId, visit);
    if (writeHistory && history.state?.entryId === state.entryId) {
      history.replaceState({ ...history.state, snapshot: visit.snapshot }, '', visit.href);
    }
    return visit;
  }
  function revoke(state) {
    if (!state || state.revoked) return;
    state.revoked = true;
    state.frame.inert = true;
    state.frame.setAttribute('aria-hidden', 'true');
    state.frame.contentWindow?.ArchifyAddress?.revoke();
  }
  function dispose(state) {
    if (!state) return;
    revoke(state);
    clearTimeout(state.timer); clearTimeout(state.feedbackTimer);
    workbench.detach(state); toolbar.detach(state);
    state.navigation?.dispose();
    state.frame.remove();
  }
  function cancelPending() {
    const previous = pending;
    pending = null; queued = null;
    dispose(previous);
    setStatus(); setPreparing(false);
  }
  function validationError(href) {
    const diagram = diagramAt(href);
    const member = Object.hasOwn(bundle.members, diagram) ? bundle.members[diagram] : null;
    if (!member) return zh ? '未知架构图' : 'Unknown diagram';
    const params = new URLSearchParams(new URL(href).hash.slice(1));
    if ((params.has('inspect') && params.get('inspect') !== 'structure') ||
        (params.get('inspect') === 'structure' && !params.get('focus')) ||
        (params.has('section') && (params.get('inspect') !== 'structure' ||
          !['code', 'state'].includes(params.get('section')))) ||
        (params.has('item') && (!params.has('section') || params.get('inspect') !== 'structure'))) {
      return zh ? '无效的内部结构地址' : 'Invalid internal structure address';
    }
    if ((params.has('route') && params.get('route').split('~').length !== 2) ||
        (params.has('focus') && !params.get('focus')) ||
        (params.has('reach') && (!params.get('focus') || !['upstream', 'downstream'].includes(params.get('reach')))) ||
        (params.has('lens') && params.get('lens').split('~').some(kind => !['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'].includes(kind)))) {
      return zh ? '无效的阅读状态' : 'Invalid reading state';
    }
    for (const field of ['focus', 'route', 'beat']) {
      const value = params.get(field);
      if (value && (field === 'route' ? value.split('~') : [value]).some(id => !member.nodes.includes(id))) return `${zh ? '未知节点' : 'Unknown node'} (${field}=${value})`;
    }
    if (params.has('relation') && !member.relations.includes(params.get('relation'))) return zh ? '未知关系' : 'Unknown relationship';
    if (params.has('view') && !member.views.includes(params.get('view'))) return zh ? '未知章节' : 'Unknown chapter';
    const structure = member.structureNodes?.[params.get('focus')];
    if (params.get('inspect') === 'structure' && !structure) return zh ? '该节点没有内部结构' : 'This node has no internal structure';
    if (params.has('section') && (!structure || !Array.isArray(structure[params.get('section')]))) return zh ? '未知内部结构分区' : 'Unknown internal structure section';
    if (params.has('item') && !structure?.[params.get('section')]?.includes(params.get('item'))) return zh ? '未知内部结构条目' : 'Unknown internal structure item';
    return null;
  }
  function failure(state, message) {
    if (state && pending !== state) return;
    const retry = state ? { href: state.href, mode: state.mode, entry: state.entry, snapshot: state.snapshot } : null;
    cancelPending();
    if (!isCurrent(active)) {
      dispose(active); active = null;
      workbench.commit(null); toolbar.commit(null);
    }
    errorView.hidden = false; errorView.replaceChildren();
    const text = document.createElement('p');
    const diagram = retry ? diagramAt(retry.href) : diagramAt(location.href);
    text.textContent = `${bundle.members[diagram]?.title || diagram}: ${message}`;
    errorView.append(text);
    button(zh ? '重试' : 'Retry', () => retry ? start(retry) : traverse(), errorView);
    button(zh ? '选择架构图' : 'Choose diagram', () => workbench.openDirectory(true), errorView);
  }
  function back() {
    if (history.state?.hasPrevious) { captureVisit(); history.back(); }
  }
  function returnGraph(information) {
    if (!isCurrent(active) || !isStructure(active.href)) return;
    requestedGraphInformation = ['relationships', 'sources'].includes(information)
      ? { kind: information, entryId: history.state?.structureSourceEntryId || active.entryId }
      : null;
    cancelPending();
    if (history.state?.structureSourceEntryId && history.state.hasPrevious) { back(); return; }
    const params = new URLSearchParams(new URL(active.frame.contentWindow.ArchifyAddress.location.href).hash.slice(1));
    navigate({ diagram: active.diagram, focus: params.get('focus') || undefined });
  }
  function navigate(diagram, focus, relation) {
    const target = typeof diagram === 'object' && diagram !== null ? { ...diagram } : { diagram, focus, relation };
    diagram = target.diagram ?? active?.diagram ?? diagramAt(location.href);
    focus = target.focus;
    relation = target.relation;
    let url = preferred(location.href);
    const params = new URLSearchParams({ diagram, ...(focus ? { focus } : {}), ...(relation ? { relation } : {}),
      ...(target.inspect !== undefined ? { inspect: target.inspect } : {}), ...(target.section !== undefined ? { section: target.section } : {}),
      ...(target.item !== undefined ? { item: target.item } : {}) });
    url.hash = params.toString();
    // A reference keeps its local graph identity; only its structure opens the
    // canonical definition. No structure body is copied into the occurrence.
    url = canonicalStructureUrl(url.href);
    diagram = diagramAt(url.href);
    focus = new URLSearchParams(url.hash.slice(1)).get('focus') || undefined;
    const error = validationError(url.href);
    if (error) { setStatus(`${diagram}: ${error}`); return; }
    if (isCurrent(active) && active.diagram === diagram) {
      const current = new URLSearchParams(new URL(active.frame.contentWindow.ArchifyAddress.location.href).hash.slice(1));
      const sameSurface = (current.get('inspect') === 'structure') === (target.inspect === 'structure');
      if (sameSurface && (target.inspect !== 'structure' || current.get('focus') === focus)) {
        cancelPending(); errorView.hidden = true;
        if (target.inspect === 'structure'
          ? (target.section !== undefined && target.section !== current.get('section')) ||
            (target.item !== undefined && target.item !== current.get('item'))
          : focus || relation) {
          active.frame.contentWindow.ArchifyAddress.navigate(url.href);
          captureVisit();
        }
        return;
      }
    }
    if (pending && pending.mode !== 'history' && preferred(pending.href).href === url.href) return;
    if (queued?.href === url.href) return;
    cancelPending();
    const replace = isCurrent(active) && active.diagram === diagram && isStructure(active.href) && target.inspect !== 'structure';
    const entry = replace
      ? { atlas: 1, entryId: active.entryId, hasPrevious: Boolean(history.state?.hasPrevious) }
      : { atlas: 1, entryId: uid(), hasPrevious: true,
          ...(target.inspect === 'structure' && isCurrent(active) && !isStructure(active.href) ? { structureSourceEntryId: active.entryId } : {}) };
    const intent = { href: url.href, mode: replace ? 'replace' : 'explicit', entry,
      fromMember: Boolean(active && document.activeElement === active.frame) };
    if (isCurrent(active) && active.frame.contentDocument.documentElement.hasAttribute('data-atlas-export-busy')) {
      queued = intent;
      setPreparing(true);
      setStatus(zh ? `导出完成后进入 ${bundle.members[diagram].title}…` : `Opening ${bundle.members[diagram].title} after export…`);
      return;
    }
    start(intent);
  }
  function start(intent) {
    cancelPending();
    if (requestedGraphInformation && intent.entry.entryId !== requestedGraphInformation.entryId) {
      requestedGraphInformation = null;
    }
    // With no retained graph, the error is the visible recovery surface. Keep
    // it until a ready replacement commits, rather than expose an empty stage.
    if (active) errorView.hidden = true;
    const href = canonicalStructureUrl(preferred(intent.href).href).href;
    const diagram = diagramAt(href);
    const frame = document.createElement('iframe');
    const state = { ...intent, href, frame, diagram, entryId: intent.entry.entryId,
      sessionId: uid(), transaction: uid(), phase: 'boot', revision };
    pending = state;
    const error = validationError(href);
    if (error) { failure(state, error); return; }
    frame.title = bundle.members[diagram].title;
    frame.dataset.atlasState = 'staging'; frame.inert = true;
    frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1;
    setPreparing(true);
    state.feedbackTimer = setTimeout(() => {
      if (pending === state) setStatus(zh ? `正在打开 ${bundle.members[diagram].title}…` : `Opening ${bundle.members[diagram].title}…`);
    }, 300);
    state.timer = setTimeout(() => {
      if (pending === state) failure(state, zh ? '架构图加载超时' : 'Viewer startup timed out');
    }, 15000);
    try { frame.srcdoc = reader.memberHtml(diagram); viewer.append(frame); }
    catch (error) { failure(state, error.message); }
  }
  function buildNavigation(state) {
    toolbar.attach(state);
    state.navigation = installNavigation({ bundle, diagram: state.diagram, frame: state.frame, workbench,
      hasPrevious: Boolean(state.entry.hasPrevious),
      navigate: (...args) => { if (isCurrent(state)) navigate(...args); },
      back: () => { if (isCurrent(state)) back(); },
      onStateChange: () => captureVisit(state),
      setDirectoryOpen: open => workbench.openDirectory(open),
    });
    state.navigation.restore(state.snapshot?.navigation, { focus: false });
    workbench.attach(state);
  }
  function confirmReady(state) {
    if (pending !== state) return;
    if (state.revision !== revision) {
      if (state.confirming) return;
      const attempt = revision;
      state.confirming = true;
      state.href = preferred(state.href).href;
      state.frame.contentWindow.ArchifyAddress.prepare({ href: state.href, snapshot: state.snapshot, motion: sharedMotion }).then(ready => {
        if (pending !== state) return;
        if (ready === false) return;
        state.revision = attempt; state.confirming = false;
        confirmReady(state);
      }).catch(error => failure(state, error.message));
      return;
    }
    commit(state);
  }
  function commit(state) {
    if (pending !== state || state.revision !== revision) return;
    const previous = active;
    // Posted preference messages can lag a user's last input. Read the old
    // realm once more before accepting readiness, while it still owns the visit.
    if (isCurrent(previous)) {
      const member = previous.frame.contentWindow;
      const logical = new URL(member.ArchifyAddress.location.href);
      updatePreferences(Object.fromEntries(preferenceKeys.map(key => [key, logical.searchParams.get(key)])), false);
      const motion = member.Archify?.motionGovernor?.readerMode();
      if (motion && motion !== sharedMotion) { sharedMotion = motion; revision++; }
      if (state.revision !== revision) { confirmReady(state); return; }
    }
    if (!state.frame.contentWindow.ArchifyAddress.canActivate({ href: preferred(state.href).href })) {
      failure(state, zh ? '架构图尚未就绪，请重试' : 'The diagram is not ready. Please retry.');
      return;
    }
    const restoreFocus = Boolean(previous && workbench.canRestoreFocus(previous.frame) &&
      (state.fromMember || document.activeElement === previous.frame));
    captureVisit(previous);
    // This synchronous task is the sole visible commit. A candidate never owns
    // the current entry, output capabilities or user input while it initializes.
    revoke(previous);
    const href = preferred(state.href).href;
    const entry = { ...state.entry, ...(state.snapshot ? { snapshot: state.snapshot } : {}) };
    if (state.mode === 'explicit') history.pushState(entry, '', href);
    else history.replaceState(entry, '', href);
    pending = null; active = state; state.phase = 'ready'; state.href = href;
    clearTimeout(state.timer); clearTimeout(state.feedbackTimer);
    state.frame.contentWindow.ArchifyAddress.activate({ href });
    state.frame.dataset.atlasState = 'active'; state.frame.inert = false;
    state.frame.removeAttribute('aria-hidden'); state.frame.removeAttribute('tabindex');
    state.navigation.restore(state.snapshot?.navigation, { focus: false });
    workbench.commit(state); toolbar.commit(state);
    document.title = `${bundle.members[state.diagram].title} · ${bundle.meta.title}`;
    errorView.hidden = true; setStatus(); setPreparing(false);
    sharedMotion = state.frame.contentWindow.Archify?.motionGovernor?.readerMode() || sharedMotion;
    dispose(previous);
    if (restoreFocus) {
      const structure = state.frame.contentWindow.Archify?.internalStructure;
      if (isStructure(state.href) && state.snapshot?.structure?.focus && typeof structure?.focus === 'function') {
        structure.focus(state.snapshot.structure.focus);
      } else if (state.snapshot?.navigation?.focus) state.navigation.restoreFocus?.(state.snapshot.navigation.focus);
      else state.navigation.focus?.();
    }
    if (!isStructure(href) && requestedGraphInformation?.entryId === state.entryId) {
      workbench.openDirectory(false);
      state.navigation.showInformation?.(requestedGraphInformation.kind, { focus: true });
      requestedGraphInformation = null;
    }
    captureVisit(state);
  }
  function traverse(event) {
    // Native history has already moved. Snapshot without rewriting that entry,
    // revoke synchronously, and only then begin asynchronous target preparation.
    captureVisit(active, false); revoke(active);
    cancelPending(); toolbar.commit(null);
    // An independent hash edit is a fresh visit, even when external code kept
    // our history.state object. It must not alias the previous member's cache.
    const entry = event?.type === 'hashchange'
      ? { atlas: 1, entryId: uid(), hasPrevious: Boolean(active) || Boolean(history.state?.hasPrevious) }
      : history.state?.atlas === 1 ? history.state : { atlas: 1, entryId: uid(), hasPrevious: false };
    const cached = event?.type === 'popstate' && !validationError(location.href) ? visits.get(entry.entryId) : null;
    const saved = cached && diagramAt(cached.href) === diagramAt(location.href) ? cached : null;
    const url = preferred(saved?.href || location.href);
    const params = new URLSearchParams(url.hash.slice(1));
    params.set('diagram', diagramAt(url.href)); url.hash = params.toString();
    history.replaceState(entry, '', url.href);
    handledHistory = { href: url.href, entryId: entry.entryId };
    start({ mode: 'history', href: url.href, entry, snapshot: saved?.snapshot || entry.snapshot });
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (message?.archifyAtlas !== 1) return;
    const state = pending?.frame.contentWindow === event.source ? pending :
      active?.frame.contentWindow === event.source ? active : null;
    if (!state || state.revoked) return;
    if (message.type === 'bridge-ready') {
      if (state !== pending || state.phase !== 'boot' || message.diagram !== state.diagram) return;
      state.phase = 'initializing'; state.revision = revision;
      state.href = preferred(state.href).href;
      try {
        buildNavigation(state);
        event.source.postMessage({ archifyAtlas: 1, type: 'init', active: false, sessionId: state.sessionId,
          entryId: state.entryId, transaction: state.transaction, href: state.href, snapshot: state.snapshot, motion: sharedMotion }, '*');
      } catch (error) { failure(state, error.message); }
      return;
    }
    if (message.sessionId !== state.sessionId || message.entryId !== state.entryId || message.transaction !== state.transaction) return;
    if (state === pending) {
      if (message.type === 'error') failure(state, message.message);
      else if (message.type === 'ready' && state.phase === 'initializing') {
        if (message.surface !== undefined && message.surface !== (isStructure(state.href) ? 'structure' : 'graph')) {
          failure(state, zh ? '阅读内容尚未就绪，请重试' : 'The requested reading surface is not ready. Please retry.');
          return;
        }
        state.phase = 'ready'; confirmReady(state);
      }
      return;
    }
    if (!isCurrent(state)) return;
    if (message.type === 'navigate') {
      navigate({ diagram: message.diagram ?? state.diagram, focus: message.focus, relation: message.relation,
        inspect: message.inspect, section: message.section, item: message.item });
      return;
    }
    if (message.type === 'structure-return') { returnGraph(message.information); return; }
    if (message.type === 'appearance' && ['live', 'still'].includes(message.motion)) {
      if (sharedMotion !== message.motion) {
        sharedMotion = message.motion; invalidateLayout();
      }
      return;
    }
    if (message.type === 'export-idle' && queued) {
      const intent = queued; queued = null; start(intent); return;
    }
    if (message.type === 'state' || message.type === 'snapshot') {
      let url;
      try { url = new URL(message.href); } catch { return; }
      if (url.origin !== location.origin || url.pathname !== location.pathname || diagramAt(url.href) !== state.diagram) return;
      const logical = new URL(state.frame.contentWindow.ArchifyAddress.location.href);
      updatePreferences(Object.fromEntries(preferenceKeys.map(key => [key, logical.searchParams.get(key)])));
      captureVisit(state); toolbar.sync(); workbench.sync?.();
    }
  });
  window.addEventListener('popstate', traverse);
  window.addEventListener('hashchange', () => {
    // A history traversal also emits hashchange, including when its target
    // failed synchronously and therefore has no active or pending viewer.
    if (handledHistory?.href === location.href && handledHistory.entryId === history.state?.entryId) return;
    if (isCurrent(active) && active.href === location.href) return;
    if (pending?.mode === 'history' && pending.entryId === history.state?.entryId && pending.href === location.href) return;
    traverse({ type: 'hashchange' });
  });
  window.addEventListener('resize', invalidateLayout);
  history.replaceState(history.state, '', preferred(initial.href).href);
  traverse();
}
