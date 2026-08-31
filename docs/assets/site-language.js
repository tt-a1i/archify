(function (global) {
  'use strict';

  var STORAGE_KEY = 'archify-lang';
  var LEGACY_STORAGE_KEYS = Object.freeze([
    'archify-gallery-language',
    'archify-guide-language',
  ]);

  function normalize(value) {
    return value === 'zh' || value === 'en' ? value : null;
  }

  function readStored(key) {
    try {
      return normalize(global.localStorage.getItem(key));
    } catch (_) {
      return null;
    }
  }

  function consumeRequestedLanguage() {
    var url;
    try {
      url = new URL(global.location.href);
    } catch (_) {
      return null;
    }
    if (!url.searchParams.has('lang')) return null;

    var requested = normalize(url.searchParams.get('lang'));
    url.searchParams.delete('lang');
    try {
      global.history.replaceState(global.history.state, '', url.pathname + url.search + url.hash);
    } catch (_) {}
    return requested;
  }

  function read() {
    var requested = consumeRequestedLanguage();
    if (requested) return write(requested);

    var stored = readStored(STORAGE_KEY);
    if (stored) return stored;

    for (var index = 0; index < LEGACY_STORAGE_KEYS.length; index += 1) {
      var legacy = readStored(LEGACY_STORAGE_KEYS[index]);
      if (legacy) return write(legacy);
    }
    return 'en';
  }

  function write(next) {
    var language = normalize(next) || 'en';
    try {
      global.localStorage.setItem(STORAGE_KEY, language);
    } catch (_) {}
    return language;
  }

  global.ArchifySiteLanguage = Object.freeze({
    key: STORAGE_KEY,
    read: read,
    write: write,
  });
}(window));
