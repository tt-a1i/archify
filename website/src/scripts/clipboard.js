// Shared only by the website copy controls. A failed browser API must never
// become a successful UI receipt; the legacy fallback can also fail or throw.
window.ArchifyClipboard = {
  async copy(text, isCurrent = () => true) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    if (!isCurrent()) return false;
    const focus = document.activeElement;
    const area = document.createElement('textarea');
    area.value = text;
    area.readOnly = true;
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    try {
      document.body.appendChild(area);
      area.focus({ preventScroll: true });
      area.select();
      return document.execCommand('copy') === true;
    } catch (_) {
      return false;
    } finally {
      area.remove();
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus({ preventScroll: true });
    }
  }
};
