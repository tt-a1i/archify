// This is included only in architecture deliveries explicitly bound to a local
// repository. The command intentionally uses the current directory: an HTML
// file can travel to another machine and must not disclose a local path.
import { escapeHtml } from '../shared/i18n.mjs';
import { createTranslator, messagesFor } from '../../modules/code-analysis/overlay/i18n.mjs';

export function staticAnalysisEntry(locale) {
  const tr = createTranslator(messagesFor(locale));
  const text = {
    entry: tr('Code Analysis'), title: tr('Analyze code locally'),
    description: tr('A static page cannot read local files. Run this command in the repository root to start local code analysis.'),
    copy: tr('Copy command'), copied: tr('Copied'),
    failed: tr('Copy failed. Select and copy the command manually.'), close: tr('Close'),
  };
  // All text is fixed application copy, not authored repository data.
  return `
<style>
#archify-code-analysis-guide { max-width: min(30rem, calc(100vw - 2rem)); padding: 1.4rem; border: 1px solid var(--toolbar-border); border-radius: .8rem; background: var(--toolbar-menu-bg); color: var(--toolbar-text); font: inherit; box-shadow: 0 1rem 3rem #0004; }
#archify-code-analysis-guide::backdrop { background: #0006; }
#archify-code-analysis-guide h2 { margin: 0 0 .75rem; font-size: 1.1rem; }
#archify-code-analysis-guide p { line-height: 1.5; }
#archify-code-analysis-guide textarea { box-sizing: border-box; width: 100%; resize: none; padding: .65rem; border: 1px solid var(--toolbar-border); border-radius: .4rem; background: var(--toolbar-bg); color: var(--toolbar-text); font: inherit; }
#archify-code-analysis-guide button { margin: .5rem .5rem 0 0; padding: .5rem .75rem; border: 1px solid var(--toolbar-border); border-radius: .4rem; background: var(--toolbar-bg); color: var(--toolbar-text); cursor: pointer; }
#archify-code-analysis-guide button:focus-visible, #archify-code-analysis-guide textarea:focus-visible { outline: 2px solid var(--frontend-stroke); outline-offset: 2px; }
</style>
<dialog id="archify-code-analysis-guide" aria-labelledby="archify-code-analysis-title" aria-describedby="archify-code-analysis-description">
  <h2 id="archify-code-analysis-title">${escapeHtml(text.title)}</h2>
  <p id="archify-code-analysis-description">${escapeHtml(text.description)}</p>
  <textarea readonly rows="1" aria-label="${escapeHtml(text.entry)}">archify map .</textarea>
  <div><button type="button" data-copy>${escapeHtml(text.copy)}</button><button type="button" data-close>${escapeHtml(text.close)}</button></div>
  <small role="status" aria-live="polite"></small>
</dialog>
<script>
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    // An injected analysis report has its own live/offline controls.
    if (document.getElementById('bauify-analysis') || document.getElementById('code-analysis-start')) return;
    var toolbar = document.querySelector('.toolbar');
    var dialog = document.getElementById('archify-code-analysis-guide');
    if (!toolbar || !dialog) return;
    var button = document.createElement('button');
    button.id = 'archify-code-analysis-entry'; button.type = 'button';
    button.textContent = ${JSON.stringify(text.entry)};
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', dialog.id);
    toolbar.appendChild(button);
    button.addEventListener('click', function () { dialog.showModal(); });
    dialog.querySelector('[data-close]').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('close', function () { button.focus(); });
    dialog.querySelector('[data-copy]').addEventListener('click', async function () {
      var field = dialog.querySelector('textarea');
      var status = dialog.querySelector('[role=status]');
      try { await navigator.clipboard.writeText(field.value); status.textContent = ${JSON.stringify(text.copied)}; }
      catch (_) { field.focus(); field.select(); status.textContent = ${JSON.stringify(text.failed)}; }
    });
  });
}());
</script>`;
}
