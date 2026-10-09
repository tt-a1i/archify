    /* ============================================================
       Motion Governor — one reader switch and one motion budget. Ambient
       trace yields to the strongest semantic owner; Still also parks bounded
       viewer signals without discarding their static meaning.
       ============================================================ */
    Archify.motionGovernor = (function () {
      var STORAGE_KEY = 'archify-motion';
      var html = document.documentElement;
      var svg = document.querySelector('.diagram-container svg');
      var btn = document.getElementById('btn-motion');
      var label = document.getElementById('motion-label');
      var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      var capable = !!(svg && svg.getAttribute('data-animation') === 'trace');
      var readerPaused = false;
      var suspensions = Object.create(null);
      var explicitOwner = '';
      var owner = '';
      var ownerToken = 0;
      var ownerCleanup = null;
      var lastEffectivePaused = null;
      var entryStarted = false;
      var entryPending = new Set();
      var flowCount = 0;

      // Runtime decoration carries geometry only. Keep each flow beside its
      // authored edge so transforms, clipping and crossover paint order apply.
      function createFlows() {
        Array.prototype.forEach.call(svg.querySelectorAll('path[data-animate="edge"]'), function (shape) {
          var d = shape.getAttribute('data-motion-path') || shape.getAttribute('d');
          if (!d) return;
          var flow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          flow.setAttribute('d', d);
          ['transform', 'mask', 'clip-path', 'vector-effect'].forEach(function (name) {
            if (shape.hasAttribute(name)) flow.setAttribute(name, shape.getAttribute(name));
          });
          flow.setAttribute('class', 'ambient-edge-flow');
          flow.setAttribute('data-ambient-flow-overlay', 'true');
          flow.setAttribute('aria-hidden', 'true');
          shape.parentNode.insertBefore(flow, shape.nextSibling);
          flowCount += 1;
        });
      }
      function settleEntry() {
        entryPending.clear();
        svg.removeEventListener('animationend', onEntryBoundary, true);
        svg.removeEventListener('animationcancel', onEntryBoundary, true);
        html.setAttribute('data-ambient-entry', 'settled');
      }
      function onEntryBoundary(event) {
        if (!entryPending.has(event.target)) return;
        entryPending.delete(event.target);
        if (!entryPending.size) settleEntry();
      }
      function renderAmbient(suppressed) {
        html.setAttribute('data-ambient-motion', suppressed ? 'paused' : (flowCount ? 'running' : 'empty'));
        if (suppressed) {
          entryStarted = true;
          settleEntry();
        } else if (!entryStarted) {
          entryStarted = true;
          entryPending = new Set(Array.prototype.slice.call(svg.querySelectorAll('[data-animate="node"]')));
          if (!entryPending.size) settleEntry();
          else {
            svg.addEventListener('animationend', onEntryBoundary, true);
            svg.addEventListener('animationcancel', onEntryBoundary, true);
            html.setAttribute('data-ambient-entry', 'running');
          }
        }
      }

      function readStored() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
      }
      function writeStored() {
        try {
          if (readerPaused) localStorage.setItem(STORAGE_KEY, 'still');
          else localStorage.removeItem(STORAGE_KEY);
        } catch (_) {}
      }
      function reducedMotion() {
        return !!(motionQuery && motionQuery.matches);
      }
      function hasSuspension() {
        return Object.keys(suspensions).length > 0;
      }
      function effectivePaused() {
        return readerPaused || reducedMotion() || hasSuspension();
      }
      function ownerLabel(value) {
        if (value === 'route') return viewerText('viewer.owner.route');
        if (value === 'lens') return viewerText('viewer.owner.lens');
        if (value === 'relationship') return viewerText('viewer.owner.relationship');
        if (value === 'intent') return viewerText('viewer.owner.intent');
        if (value === 'focus') return viewerText('viewer.owner.focus');
        if (value === 'legend') return viewerText('viewer.owner.legend');
        return viewerText('viewer.owner.reader');
      }
      function render() {
        if (!capable) return;
        var systemPaused = reducedMotion();
        var paused = effectivePaused();
        html.setAttribute('data-motion', paused ? 'still' : 'live');
        renderAmbient(paused || owner || html.hasAttribute('data-embed') || html.hasAttribute('data-share-playback') || html.hasAttribute('data-document-hidden'));
        btn.setAttribute('aria-pressed', paused ? 'false' : 'true');
        btn.disabled = systemPaused;
        label.textContent = viewerText(paused ? 'viewer.motion.still' : 'viewer.motion.live');
        if (paused && lastEffectivePaused !== true && Archify.routeProbe && Archify.routeProbe.isJourneyPlaying && Archify.routeProbe.isJourneyPlaying()) {
          Archify.routeProbe.pauseJourney({ preserveElapsed: true, reason: systemPaused ? 'reduced-motion' : (hasSuspension() ? 'hidden' : 'still') });
        }
        lastEffectivePaused = paused;
        if (Archify.routeProbe && typeof Archify.routeProbe.syncMotion === 'function') Archify.routeProbe.syncMotion();
        if (systemPaused) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.reduced'));
          btn.title = viewerText('viewer.motion.reduced');
        } else if (hasSuspension()) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.hidden'));
          btn.title = viewerText('viewer.motion.hidden');
        } else if (paused) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.resume'));
          btn.title = viewerText('viewer.motion.resume');
        } else if (owner) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.yielding', { owner: ownerLabel(owner) }));
          btn.title = viewerText('viewer.motion.yielding.title', { owner: ownerLabel(owner) });
        } else {
          btn.setAttribute('aria-label', viewerText('viewer.motion.pause'));
          btn.title = viewerText('viewer.motion.pause');
        }
      }
      function setPaused(next, options) {
        options = options || {};
        readerPaused = !!next;
        if (options.persist !== false) writeStored();
        render();
        return readerPaused;
      }
      function publishOwner() {
        owner = explicitOwner || deriveOwner();
        if (owner) html.setAttribute('data-motion-owner', owner);
        else html.removeAttribute('data-motion-owner');
        render();
        return owner;
      }
      function deriveOwner() {
        if (!svg) return '';
        if (svg.hasAttribute('data-route-picking') || svg.hasAttribute('data-route-active')) return 'route';
        if (svg.hasAttribute('data-lens-active')) return 'lens';
        if (svg.hasAttribute('data-relationship-preview-active')) return 'relationship';
        if (svg.hasAttribute('data-intent-trace-active')) return 'intent';
        if (svg.hasAttribute('data-focus-active')) return 'focus';
        if (svg.hasAttribute('data-legend-preview-active')) return 'legend';
        return '';
      }
      function clearClaim(preempted) {
        var cleanup = ownerCleanup;
        ownerCleanup = null;
        explicitOwner = '';
        if (preempted && cleanup) {
          try { cleanup(); } catch (_) {}
        }
      }
      function claim(next, cleanup) {
        if (!capable || !next) return 0;
        clearClaim(true);
        ownerToken += 1;
        explicitOwner = next;
        ownerCleanup = typeof cleanup === 'function' ? cleanup : null;
        publishOwner();
        return ownerToken;
      }
      function release(token) {
        if (!capable || token !== ownerToken || !explicitOwner) return false;
        clearClaim(false);
        ownerToken += 1;
        publishOwner();
        return true;
      }
      function suspend(reason) {
        var key = String(reason || 'runtime');
        var active = true;
        suspensions[key] = (suspensions[key] || 0) + 1;
        render();
        return function () {
          if (!active) return false;
          active = false;
          if (suspensions[key] > 1) suspensions[key] -= 1;
          else delete suspensions[key];
          render();
          return true;
        };
      }
      function syncVisibility() {
        if (document.hidden) {
          suspensions.visibility = true;
          html.setAttribute('data-document-hidden', 'true');
        } else {
          delete suspensions.visibility;
          html.removeAttribute('data-document-hidden');
        }
        render();
      }

      if (!capable) {
        btn.hidden = true;
        html.removeAttribute('data-motion-capable');
        html.removeAttribute('data-motion');
        html.removeAttribute('data-motion-owner');
        html.removeAttribute('data-ambient-motion');
        html.removeAttribute('data-ambient-entry');
        return {
          capable: false,
          pause: function () { return false; },
          resume: function () { return false; },
          toggle: function () { return false; },
          setMode: function () { return 'still'; },
          mode: function () { return 'still'; },
          claim: function () { return 0; },
          release: function () { return false; },
          suspend: function () { return function () { return false; }; },
          isPaused: function () { return true; },
          owner: function () { return ''; }
        };
      }

      createFlows();
      html.setAttribute('data-motion-capable', 'true');
      btn.hidden = false;
      readerPaused = readStored() === 'still';
      btn.addEventListener('click', function () { setPaused(!readerPaused); });
      if (motionQuery) {
        if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', render);
        else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(render);
      }
      document.addEventListener('visibilitychange', syncVisibility);
      if (typeof MutationObserver !== 'undefined') {
        var contextObserver = new MutationObserver(render);
        contextObserver.observe(html, { attributes: true, attributeFilter: ['data-embed', 'data-share-playback'] });
      }
      if (document.documentElement.getAttribute('data-embed') !== 'true' && typeof MutationObserver !== 'undefined' && typeof Node !== 'undefined' && svg instanceof Node) {
        var ownerObserver = new MutationObserver(function () { publishOwner(); });
        ownerObserver.observe(svg, {
          attributes: true,
          attributeFilter: [
            'data-route-picking', 'data-route-active',
            'data-lens-active', 'data-relationship-preview-active', 'data-intent-trace-active',
            'data-focus-active', 'data-legend-preview-active'
          ]
        });
      }
      syncVisibility();
      publishOwner();
      render();

      return {
        capable: true,
        pause: function () { return setPaused(true); },
        resume: function () { return setPaused(false); },
        toggle: function () { return setPaused(!readerPaused); },
        setMode: function (next, options) {
          setPaused(next === 'still', options);
          return effectivePaused() ? 'still' : 'live';
        },
        mode: function () { return effectivePaused() ? 'still' : 'live'; },
        claim: claim,
        release: release,
        suspend: suspend,
        isPaused: effectivePaused,
        owner: function () { return owner; }
      };
    })();