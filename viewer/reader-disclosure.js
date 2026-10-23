(function () {
  'use strict';
  var trigger = document.getElementById('btn-reader-update');
  var dialog = document.getElementById('reader-update');
  var payloadNode = document.getElementById('archify-reader-update-data');
  if (!trigger || !dialog || !payloadNode) return;
  var payload;
  try { payload = JSON.parse(payloadNode.textContent); } catch (_) { trigger.hidden = true; return; }
  var artifact = payload && payload.artifact;
  var update = payload && payload.update;
  var safeHttps = function (value) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.href === value ? url : null;
    } catch (_) { return null; }
  };
  var stableVersion = function (value) { return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value); };
  var exactKeys = function (value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('\0') === keys.slice().sort().join('\0'); };
  var validManifest = function (value) {
    if (!exactKeys(value, ['schemaVersion', 'skillId', 'channel', 'version', 'publishedAt', 'source', 'artifact', 'summary', 'releaseNotes', 'severity'])
      || value.schemaVersion !== 1 || value.skillId !== 'archify' || value.channel !== 'stable' || !stableVersion(value.version)
      || !exactKeys(value.source, ['repository', 'ref', 'treeSha']) || value.source.repository !== 'https://github.com/tt-a1i/archify' || value.source.ref !== 'v' + value.version || !/^[a-f0-9]{40}$/.test(value.source.treeSha)
      || !exactKeys(value.artifact, ['sha256']) || !/^[a-f0-9]{64}$/.test(value.artifact.sha256)
      || typeof value.summary !== 'string' || !value.summary || value.summary.length > 160 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value.summary)
      || value.releaseNotes !== 'https://github.com/tt-a1i/archify/releases/tag/v' + value.version || !['normal', 'security'].includes(value.severity)
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value.publishedAt)) return null;
    var publishedAt = Date.parse(value.publishedAt);
    if (!Number.isFinite(publishedAt) || new Date(publishedAt).toISOString() !== value.publishedAt.replace('Z', '.000Z')) return null;
    return value;
  };
  var compareStableVersion = function (left, right) { var a = left.split('.').map(Number), b = right.split('.').map(Number); for (var i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };
  if (!artifact || payload.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(artifact.contentSha256)
    || !safeHttps(update && update.manifestUrl)) { trigger.hidden = true; return; }
  var facts = document.getElementById('reader-update-facts');
  var status = document.getElementById('reader-update-status');
  var current = document.getElementById('reader-update-current');
  var available = document.getElementById('reader-update-available');
  var summaries = document.getElementById('reader-update-summaries');
  var notes = document.getElementById('reader-update-release-notes');
  var originalFocus = null;
  [['Type', artifact.type], ['Generator', artifact.generatorVersion], ['Content identity', artifact.contentSha256]].forEach(function (pair) {
    var term = document.createElement('dt'); term.textContent = pair[0];
    var definition = document.createElement('dd'); definition.textContent = pair[1];
    facts.appendChild(term); facts.appendChild(definition);
  });
  trigger.textContent = 'Version ' + artifact.generatorVersion;
  trigger.addEventListener('click', function () { originalFocus = trigger; dialog.showModal(); dialog.querySelector('header button').focus(); });
  dialog.addEventListener('close', function () { if (originalFocus) originalFocus.focus(); });
  document.getElementById('reader-update-check').addEventListener('click', function () {
    var button = this;
    if (!stableVersion(artifact.generatorVersion)) {
      status.textContent = 'Update status unavailable for this development artifact. No update result was recorded.';
      return;
    }
    button.disabled = true; status.textContent = 'Checking the fixed stable manifest…';
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 5000);
    fetch(update.manifestUrl, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal })
      .then(function (response) { if (!response.ok) throw new Error('manifest unavailable'); return response.text(); })
      .then(function (text) {
        if (text.length > 65536) throw new Error('manifest too large');
        var manifest = validManifest(JSON.parse(text));
        if (!manifest) throw new Error('invalid manifest');
        if (compareStableVersion(artifact.generatorVersion, manifest.version) >= 0) {
          status.textContent = 'No newer stable version was found.';
          return;
        }
        trigger.textContent = 'New version ' + manifest.version;
        current.textContent = 'Current version: ' + artifact.generatorVersion;
        available.textContent = 'New version: ' + manifest.version;
        summaries.replaceChildren();
        [manifest.summary].slice(0, 3).forEach(function (summary) { var item = document.createElement('li'); item.textContent = summary; summaries.appendChild(item); });
        notes.href = manifest.releaseNotes;
        notes.hidden = false;
        status.textContent = 'A newer stable version is available.';
      })
      .catch(function () { status.textContent = 'Update status unavailable. No update result was recorded.'; })
      .finally(function () { clearTimeout(timeout); button.disabled = false; });
  });
})();
