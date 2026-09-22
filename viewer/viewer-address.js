    // Standalone viewers use their document address. Atlas members operate on
    // a logical address; only the parent may write browser history.
    window.ArchifyAddress = (function () {
      var data = document.getElementById('archify-atlas-context');
      var context = data ? JSON.parse(data.textContent) : null;
      var pending = [];
      var session = null;
      var logical = null;
      var restoring = Boolean(context);
      var revoked = false;
      var activated = false;
      var prepared = false;
      var preparing = false;
      var preparation = 0;
      var reading = null;
      var connected = false;
      var paintWaiters = new Map();
      var scrollFrame = null;
      if (context) document.documentElement.setAttribute('data-atlas-member', 'true');
      function active() { return !context || (!revoked && Boolean(session) && activated); }
      function send(type, payload) {
        if (!session || revoked || (type !== 'ready' && type !== 'error' && (!active() || restoring))) return;
        parent.postMessage(Object.assign({ type: type, archifyAtlas: 1,
          sessionId: session.sessionId, entryId: session.entryId, transaction: session.transaction
        }, payload || {}), '*');
      }
      function run(callback) {
        if (revoked) return;
        if (!context || session) callback();
        else pending.push(callback);
      }
      function replaceState(state, unused, url) {
        if (!context) { history.replaceState(state, unused, url); return; }
        if (!active() || restoring) return;
        logical = new URL(url, logical.href);
        logical.hash = qualify(logical.hash);
        send('state', { href: logical.href });
      }
      function qualify(hash) {
        var params = new URLSearchParams(hash.replace(/^#/, ''));
        params.set('diagram', context.diagram);
        return '#' + params.toString();
      }
      function share(hash) {
        var url = new URL(context ? logical.href : location.href);
        url.hash = context ? qualify(hash) : hash;
        return url.href;
      }
      function snapshot() {
        if (restoring || !context || !active() || !window.Archify) return null;
        var result = { camera: window.Archify.view.snapshot(), scrollX: scrollX, scrollY: scrollY };
        var structure = window.Archify.internalStructure;
        if (structure && typeof structure.snapshot === 'function') {
          var structureReading = structure.snapshot();
          if (structureReading) result.structure = structureReading;
        }
        return result;
      }
      function requestedSurface() {
        return logical && new URLSearchParams(logical.hash.replace(/^#/, '')).get('inspect') === 'structure' ? 'structure' : 'graph';
      }
      function surfaceReady() {
        var structure = window.Archify && window.Archify.internalStructure;
        return structure && typeof structure.surface === 'function' ? structure.surface() === requestedSurface() : requestedSurface() === 'graph';
      }
      function nextPaint() {
        if (revoked) return Promise.resolve();
        return new Promise(function (resolve) {
          var id = requestAnimationFrame(function () { paintWaiters.delete(id); resolve(); });
          paintWaiters.set(id, resolve);
        });
      }
      function cancelPaints() {
        paintWaiters.forEach(function (resolve, id) {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
          resolve();
        });
        paintWaiters.clear();
      }
      function stableLayout() {
        return Promise.resolve(document.fonts && document.fonts.ready).then(function () {
          return window.Archify.readerLayout.whenStable();
        }).then(function () {
          return window.Archify.viewerChromeLayout.whenStable();
        }).then(function () {
          return window.Archify.readerLayout.whenStable();
        });
      }
      function prepare(options) {
        if (!context || revoked || !session) return Promise.resolve(false);
        options = options || {};
        var version = ++preparation;
        cancelPaints();
        prepared = false;
        restoring = true;
        if (Object.prototype.hasOwnProperty.call(options, 'snapshot')) reading = options.snapshot;
        if (options.href) {
          logical = new URL(options.href, logical.href);
          logical.hash = qualify(logical.hash);
        }
        function current() { return !revoked && Boolean(session) && preparation === version; }
        var surfaceTask;
        try {
          var params = logical.searchParams;
          var api = window.Archify;
          if (api.theme && api.theme.apply && /^(light|dark)$/.test(params.get('theme'))) api.theme.apply(params.get('theme'));
          if (api.preset && api.preset.apply && params.get('preset')) api.preset.apply(params.get('preset'));
          if (api.presentation && api.presentation.active() !== (params.get('present') === '1')) {
            if (params.get('present') === '1') api.presentation.enter();
            else api.presentation.exit();
          }
          if (api.motionGovernor && /^(live|still)$/.test(options.motion)) api.motionGovernor.setMode(options.motion, { persist: false });
          if (api.internalStructure && typeof api.internalStructure.syncAddress === 'function') {
            surfaceTask = api.internalStructure.syncAddress({ history: false, focus: false });
          } else if (requestedSurface() === 'structure') {
            throw new Error(api.locale === 'zh-CN' ? '此查看器无法显示内部结构。' : 'This viewer cannot display internal structure.');
          }
        } catch (error) { return Promise.reject(error); }
        return Promise.resolve(surfaceTask).then(function () {
          if (!current()) return false;
          return stableLayout();
        }).then(function () {
          if (!current()) return false;
          return nextPaint().then(nextPaint);
        }).then(function () {
          if (!current()) return false;
          if (reading && window.Archify.view.restore) window.Archify.view.restore(reading.camera);
          if (reading) window.scrollTo(reading.scrollX || 0, reading.scrollY || 0);
          var structure = window.Archify.internalStructure;
          if (reading && reading.structure && structure && typeof structure.restore === 'function') {
            return structure.restore(reading.structure, { focus: false });
          }
        }).then(function () {
          if (!current()) return false;
          // Legacy active initialization retains its established pause behavior.
          // Staging is suspended by the Motion Governor without writing a reader preference.
          if (activated) window.Archify.motionGovernor.pause();
          restoring = false;
          if (!reading && requestedSurface() === 'graph') window.Archify.view.sync({ initial: true, instant: true });
          return stableLayout().then(nextPaint);
        }).then(function () {
          if (!current()) return false;
          if (!surfaceReady()) throw new Error(window.Archify.locale === 'zh-CN' ? '请求的阅读内容尚未就绪。' : 'The requested reading surface is not ready.');
          prepared = true;
          return true;
        });
      }
      function canActivate(options) {
        if (!context || !session || revoked || activated || !prepared || restoring) return false;
        try { return surfaceReady() && (!options || !options.href || new URL(options.href, logical.href).href === logical.href); }
        catch (_) { return false; }
      }
      function activate(options) {
        if (!canActivate(options)) return false;
        activated = true;
        preparing = false;
        window.dispatchEvent(new Event('archify:atlas-activate'));
        window.ArchifyAddress.settled();
        return true;
      }
      function navigate(href) {
        if (!context || !active() || restoring) return false;
        var url = new URL(href, logical.href);
        var diagram = new URLSearchParams(url.hash.replace(/^#/, '')).get('diagram');
        if (url.origin !== logical.origin || url.pathname !== logical.pathname || (diagram && diagram !== context.diagram)) return false;
        url.hash = qualify(url.hash);
        if (url.href === logical.href) return true;
        logical = url;
        window.dispatchEvent(new Event('hashchange'));
        send('state', { href: logical.href });
        window.ArchifyAddress.settled();
        return true;
      }
      function onScroll() {
        if (!active() || scrollFrame !== null) return;
        scrollFrame = requestAnimationFrame(function () {
          scrollFrame = null;
          window.ArchifyAddress.settled();
        });
      }
      function onMessage(event) {
        var message = event.data;
        if (event.source !== parent || !message || message.archifyAtlas !== 1 || revoked || session) return;
        if (message.type !== 'init' || !message.sessionId || !message.entryId || !message.transaction) return;
        session = message;
        activated = message.active !== false;
        try {
          logical = new URL(message.href);
          logical.hash = qualify(logical.hash);
          pending.splice(0).forEach(function (callback) { callback(); });
          prepare({ snapshot: message.snapshot || null, motion: message.motion }).then(function (ready) {
            if (!ready) return;
            send('ready', { surface: requestedSurface() });
            window.ArchifyAddress.settled();
          }).catch(function (error) { send('error', { message: error.message }); });
        } catch (error) { send('error', { message: error.message }); }
      }
      function connect() {
        if (!context || revoked || connected) return;
        connected = true;
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('message', onMessage);
        parent.postMessage({ archifyAtlas: 1, type: 'bridge-ready', diagram: context.diagram }, '*');
      }
      function revoke() {
        if (!context || revoked) return;
        revoked = true; restoring = true; session = null; activated = false; prepared = false;
        preparation++;
        pending.length = 0;
        cancelPaints();
        if (scrollFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(scrollFrame);
        scrollFrame = null;
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('message', onMessage);
        window.dispatchEvent(new Event('archify:atlas-revoke'));
      }
      return {
        get location() { return context ? (logical || new URL('about:blank')) : location; },
        get context() { return context; },
        get restoring() { return restoring; },
        get active() { return active(); },
        get exportAllowed() { return active() && !preparing; },
        preference: function (name, value) {
          if (!context || restoring || !active()) return;
          logical.searchParams.set(name, value);
          send('state', { href: logical.href });
        },
        run: run, connect: connect, revoke: revoke, prepare: prepare, canActivate: canActivate, activate: activate, navigate: navigate,
        setPreparing: function (value) { preparing = Boolean(value); },
        replaceState: replaceState, share: share, send: send, snapshot: snapshot,
        settled: function () {
          var reading = snapshot();
          if (reading) send('snapshot', { snapshot: reading, href: logical.href });
        }
      };
    })();
