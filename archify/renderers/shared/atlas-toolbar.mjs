/** Keep the existing Viewer toolbar in the workbench; commands stay in the committed Viewer. */
export function installAtlasToolbar({ onPreferenceChange = () => {}, onModeChange = () => {} } = {}) {
  const doc = document;
  let current = null;
  let toolbar = null;
  let style = null;
  let preparing = false;
  let openMenu = '';
  let previousPreferences = null;
  let observers = [];
  let scheduled = 0;
  const attached = new Set();
  const cssVariables = new Set();

  const sourceToolbar = (state) => state?.frame?.contentDocument?.querySelector('.toolbar');
  const eligible = () => Boolean(current?.frame?.contentWindow?.ArchifyAddress?.active);
  const menu = (kind) => toolbar?.querySelector('#' + kind + '-menu');
  const trigger = (kind) => toolbar?.querySelector('#btn-' + kind);
  const buttons = (kind) => Array.from(menu(kind)?.querySelectorAll('button') || []).filter((button) => !button.hidden && !button.disabled);
  function key(element) {
    if (element.id) return '#' + element.id;
    for (const name of ['data-preset-value', 'data-format', 'data-action']) {
      if (element.hasAttribute(name)) return '[' + name + '="' + element.getAttribute(name) + '"]';
    }
    return '';
  }
  function close(kind = openMenu, focusTrigger = false) {
    if (!kind) return false;
    menu(kind)?.classList.remove('open');
    trigger(kind)?.setAttribute('aria-expanded', 'false');
    if (openMenu === kind) openMenu = '';
    if (focusTrigger) trigger(kind)?.focus({ preventScroll: true });
    return false;
  }
  function open(kind, focusLast = false) {
    if (!eligible() || (kind === 'export' && preparing)) return false;
    const member = current.frame.contentWindow;
    if (member.document.documentElement.getAttribute('data-embed') === 'true') return false;
    close();
    if (kind === 'export') {
      member.Archify?.semanticLens?.clearPreview?.();
      if (member.Archify?.semanticLens?.isOpen?.()) member.Archify.semanticLens.close({ restoreFocus: false });
      member.Archify?.exportMenu?.syncRouteShare?.();
      member.Archify?.exportMenu?.syncReachShare?.();
    }
    sync();
    const available = buttons(kind);
    if (!available.length) return false;
    openMenu = kind;
    menu(kind).classList.add('open');
    trigger(kind).setAttribute('aria-expanded', 'true');
    const selected = available.find((button) => button.getAttribute('aria-checked') === 'true');
    (focusLast ? available.at(-1) : selected || available[0]).focus({ preventScroll: true });
    return true;
  }
  function relevantRules(rules) {
    return Array.from(rules).map((rule) => {
      if (rule.selectorText) {
        if (!/(?:\.toolbar\b|\.toolbar-|\.preset-|\.export-|\.motion-control-|#(?:theme|preset|present|motion)-(?:icon|label)\b|#btn-)/.test(rule.selectorText)) return '';
        for (const match of rule.cssText.matchAll(/var\((--[\w-]+)/g)) cssVariables.add(match[1]);
        return rule.cssText;
      }
      if (rule.name === 'toolbar-menu-in') return rule.cssText;
      if (!rule.cssRules) return '';
      const nested = relevantRules(rule.cssRules);
      return nested ? rule.cssText.slice(0, rule.cssText.indexOf('{') + 1) + nested + '}' : '';
    }).join('\n');
  }
  function create(source) {
    if (toolbar) return;
    toolbar = source.cloneNode(true);
    toolbar.id = 'atlas-toolbar';
    toolbar.hidden = true;
    toolbar.removeAttribute('inert');
    toolbar.removeAttribute('aria-hidden');
    toolbar.style.cssText = '';
    toolbar.querySelectorAll('.open').forEach((element) => element.classList.remove('open'));
    toolbar.querySelectorAll('[aria-expanded]').forEach((element) => element.setAttribute('aria-expanded', 'false'));
    style = doc.createElement('style');
    style.setAttribute('data-atlas-toolbar-style', '');
    style.textContent = Array.from(source.ownerDocument.styleSheets).map((sheet) => {
      try { return relevantRules(sheet.cssRules); } catch (_) { return ''; }
    }).join('\n') + `
      #atlas-toolbar { position:fixed; right:auto; margin:0; z-index:120; box-sizing:border-box; }
      #atlas-toolbar[hidden] { display:none !important; }
      #atlas-toolbar, #atlas-toolbar * { margin:0; box-sizing:border-box; animation:none !important; transition:none !important; }
      #atlas-toolbar button:disabled { cursor:not-allowed; }
      @media print { #atlas-toolbar { display:none !important; } }
    `;
    doc.head.append(style);
    doc.body.append(toolbar);
    toolbar.addEventListener('click', onClick);
    toolbar.addEventListener('keydown', onToolbarKey);
  }
  function preferences(state) {
    const html = state.frame.contentDocument.documentElement;
    return { theme: html.getAttribute('data-theme'), preset: html.getAttribute('data-preset'), present: html.getAttribute('data-present') === 'true' };
  }
  function sync() {
    if (!toolbar) return;
    const source = sourceToolbar(current);
    const active = eligible();
    if (!source) {
      toolbar.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      close();
      return;
    }
    const win = current.frame.contentWindow;
    const computed = win.getComputedStyle(source);
    toolbar.hidden = computed.display === 'none' || computed.visibility === 'hidden';
    const rect = source.getBoundingClientRect();
    const frameRect = current.frame.getBoundingClientRect();
    toolbar.style.top = frameRect.top + rect.top + 'px';
    toolbar.style.left = frameRect.left + rect.left + 'px';
    toolbar.style.width = rect.width + 'px';
    toolbar.style.fontFamily = computed.fontFamily;
    toolbar.style.fontSize = computed.fontSize;
    const html = current.frame.contentDocument.documentElement;
    const rootStyle = win.getComputedStyle(html);
    cssVariables.forEach((name) => toolbar.style.setProperty(name, rootStyle.getPropertyValue(name)));
    ['data-theme', 'data-preset', 'data-present', 'data-embed'].forEach((name) => {
      const value = html.getAttribute(name);
      if (value == null) doc.documentElement.removeAttribute(name);
      else doc.documentElement.setAttribute(name, value);
    });
    toolbar.querySelectorAll('button').forEach((button) => {
      const selector = key(button);
      const original = selector && source.querySelector(selector);
      if (!original) { button.disabled = true; return; }
      for (const name of ['title', 'aria-label', 'aria-pressed', 'aria-checked', 'data-preset-option']) {
        const value = original.getAttribute(name);
        if (value == null) button.removeAttribute(name);
        else button.setAttribute(name, value);
      }
      button.hidden = original.hidden;
      const exportControl = button.id === 'btn-export' || Boolean(button.closest('#export-menu'));
      button.disabled = !active || original.disabled || (exportControl && preparing);
      if (exportControl && preparing) button.title = (doc.documentElement.lang || html.lang || '').startsWith('zh') ? '切换完成后可导出' : 'Export is available after switching diagrams';
    });
    for (const id of ['theme-label', 'preset-label', 'motion-label', 'present-label']) {
      const target = toolbar.querySelector('#' + id);
      const original = source.querySelector('#' + id);
      if (target && original && target.textContent !== original.textContent) target.textContent = original.textContent;
    }
    const next = preferences(current);
    if (previousPreferences && JSON.stringify(next) !== JSON.stringify(previousPreferences)) {
      const modeChanged = next.present !== previousPreferences.present;
      previousPreferences = next;
      onPreferenceChange(next);
      if (modeChanged) onModeChange(next);
    } else previousPreferences = next;
  }
  function schedule() {
    if (!scheduled) scheduled = requestAnimationFrame(() => { scheduled = 0; sync(); });
  }
  function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !toolbar.contains(button) || button.disabled || !eligible()) return;
    if (button.id === 'btn-export' || button.id === 'btn-preset') {
      const kind = button.id.slice(4);
      if (openMenu === kind) close(kind);
      else open(kind);
      return;
    }
    const selector = key(button);
    const original = selector && sourceToolbar(current)?.querySelector(selector);
    if (!original || original.disabled || original.hidden) return;
    // Use the complete existing command set, including conditional route/reach
    // exports and clipboard fallback, within the original user activation.
    original.click();
    sync();
  }
  function onToolbarKey(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if ((button.id === 'btn-export' || button.id === 'btn-preset') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      open(button.id.slice(4), event.key === 'ArrowUp');
      return;
    }
    const kind = button.closest('#preset-menu') ? 'preset' : button.closest('#export-menu') ? 'export' : '';
    if (!kind) return;
    if (event.key === 'Escape') { event.preventDefault(); close(kind, true); return; }
    if (event.key === 'Tab') { close(kind); return; }
    const available = buttons(kind);
    const index = available.indexOf(button);
    let next;
    if (event.key === 'ArrowDown') next = available[(index + 1) % available.length];
    else if (event.key === 'ArrowUp') next = available[(index - 1 + available.length) % available.length];
    else if (event.key === 'Home') next = available[0];
    else if (event.key === 'End') next = available.at(-1);
    if (next) { event.preventDefault(); next.focus({ preventScroll: true }); }
  }
  function outsideClick(event) { if (!toolbar?.contains(event.target)) close(); }
  function shortcut(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || !eligible()) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const id = { t: 'btn-theme', s: 'btn-preset', f: 'btn-present', e: 'btn-export' }[event.key.toLowerCase()];
    if (!id) return;
    event.preventDefault();
    if (id === 'btn-export') { if (openMenu === 'export') close('export', true); else open('export'); }
    else if (id === 'btn-preset') { current.frame.contentWindow.Archify?.preset?.cycle?.(); sync(); }
    else { sourceToolbar(current)?.querySelector('#' + id)?.click(); sync(); }
  }
  function attach(state) {
    const source = sourceToolbar(state);
    if (!source || attached.has(state)) return;
    create(source);
    const member = state.frame.contentWindow;
    member.ArchifyToolbarHost = {
      open: (kind, last) => current === state && open(kind, last),
      close: (kind, focus) => current === state && close(kind, focus),
      isOpen: (kind) => current === state && openMenu === kind,
      clipboardWindow: () => current === state && eligible() ? window : null,
    };
    source.style.opacity = '0';
    source.style.pointerEvents = 'none';
    source.setAttribute('inert', '');
    source.setAttribute('aria-hidden', 'true');
    attached.add(state);
  }
  function disconnect() {
    observers.forEach((observer) => observer.disconnect());
    observers = [];
    if (current) current.frame.contentWindow.removeEventListener('scroll', schedule, true);
    if (scheduled) cancelAnimationFrame(scheduled);
    scheduled = 0;
  }
  function commit(state) {
    disconnect();
    current = state;
    previousPreferences = null;
    if (!state) { sync(); return; }
    attach(state);
    const source = sourceToolbar(state);
    const win = state.frame.contentWindow;
    const observer = new win.MutationObserver(schedule);
    observer.observe(source, { subtree: true, childList: true, characterData: true, attributes: true });
    observer.observe(state.frame.contentDocument.documentElement, { attributes: true });
    observers.push(observer);
    if (win.ResizeObserver) {
      const resize = new win.ResizeObserver(schedule);
      resize.observe(source);
      observers.push(resize);
    }
    win.addEventListener('scroll', schedule, true);
    sync();
  }
  function detach(state) {
    if (current === state) commit(null);
    attached.delete(state);
    if (state?.frame?.contentWindow) delete state.frame.contentWindow.ArchifyToolbarHost;
  }
  function setPreparing(value) {
    preparing = Boolean(value);
    if (preparing && openMenu === 'export') close('export', true);
    sync();
  }
  doc.addEventListener('click', outsideClick);
  doc.addEventListener('keydown', shortcut);
  window.addEventListener('resize', schedule);
  return {
    attach, commit, detach, setPreparing, sync,
    dispose() {
      disconnect();
      Array.from(attached.keys()).forEach(detach);
      doc.removeEventListener('click', outsideClick);
      doc.removeEventListener('keydown', shortcut);
      window.removeEventListener('resize', schedule);
      toolbar?.remove();
      style?.remove();
    },
  };
}
