    /* ============================================================
       Viewer Chrome Layout — keep HTML controls clear of the canonical SVG
       stage without changing authored geometry. The dock keeps its floating
       appearance while a small bottom stage rail becomes part of the reader
       budget whenever its zero-reserve position would enter the stage.
       ============================================================ */
    Archify.viewerChromeLayout = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container && container.querySelector(':scope > svg');
      var nav = container && container.querySelector('.diagram-nav');
      var legend = svg && svg.querySelector('[data-legend]');
      var frame = 0;
      var settleFrame = 0;
      var reserve = 0;
      var railLatched = false;
      var probingBaseline = false;
      var probePromise = null;
      var baselineIntersectionArea = 0;
      var baselineStageGap = null;
      var restorableReserve = 0;
      var probeFallbackReserve = 0;
      var lastReceipt = null;
      var SAFE_GAP = 10;

      function visible(element) {
        if (!element || element.hidden) return false;
        var style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }
      function usable(rect) {
        return Boolean(rect && rect.width > 0 && rect.height > 0);
      }
      function intersectionArea(a, b) {
        var width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        var height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return width * height;
      }
      function protectedStageRect() {
        if (!svg) return null;
        var rect = svg.getBoundingClientRect();
        var transform = '';
        try { transform = window.getComputedStyle(svg).transform || ''; } catch (_) {}
        var scaleX = 1;
        var scaleY = 1;
        var translateX = 0;
        var translateY = 0;
        var matrix = transform.match(/^matrix\(([^)]+)\)$/);
        var matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/);
        if (matrix) {
          var values = matrix[1].split(',').map(Number);
          if (values.length === 6 && values.every(Number.isFinite)) {
            scaleX = Math.abs(values[0]) || 1;
            scaleY = Math.abs(values[3]) || 1;
            translateX = values[4];
            translateY = values[5];
          }
        } else if (matrix3d) {
          var values3d = matrix3d[1].split(',').map(Number);
          if (values3d.length === 16 && values3d.every(Number.isFinite)) {
            scaleX = Math.abs(values3d[0]) || 1;
            scaleY = Math.abs(values3d[5]) || 1;
            translateX = values3d[12];
            translateY = values3d[13];
          }
        }
        var width = rect.width / scaleX;
        var height = rect.height / scaleY;
        var left = rect.left - translateX;
        var top = rect.top - translateY;
        return {
          x: left,
          y: top,
          left: left,
          top: top,
          right: left + width,
          bottom: top + height,
          width: width,
          height: height
        };
      }
      function eligible() {
        return Boolean(
          container && svg && nav &&
          window.innerWidth > 720 &&
          html.getAttribute('data-embed') !== 'true' &&
          (!window.matchMedia || !window.matchMedia('print').matches) &&
          visible(nav)
        );
      }
      function cameraAtBaseline() {
        var scale = Number(svg && svg.getAttribute('data-view-scale'));
        return !Number.isFinite(scale) || Math.abs(scale - 1) < 0.001;
      }
      function writeReserve(next, options) {
        options = options || {};
        next = Math.max(0, Math.ceil(next));
        if (Math.abs(next - reserve) < 1) return false;
        reserve = next;
        if (reserve) {
          if (options.remember !== false) restorableReserve = reserve;
          container.style.setProperty('--archify-nav-reserve', reserve + 'px');
          container.setAttribute('data-nav-stage-rail', 'true');
          html.setAttribute('data-nav-stage-rail', 'true');
        } else {
          container.style.removeProperty('--archify-nav-reserve');
          container.removeAttribute('data-nav-stage-rail');
          html.removeAttribute('data-nav-stage-rail');
        }
        if (Archify.readerLayout && typeof Archify.readerLayout.schedule === 'function') {
          Archify.readerLayout.schedule();
        }
        if (options.quiet !== true) {
          if (settleFrame) cancelAnimationFrame(settleFrame);
          settleFrame = requestAnimationFrame(function () {
            settleFrame = 0;
            schedule();
          });
        }
        return true;
      }
      function clear(options) {
        options = options || {};
        railLatched = false;
        if (options.preserveBaseline !== true) {
          baselineIntersectionArea = 0;
          baselineStageGap = null;
          restorableReserve = 0;
        }
        writeReserve(0, { quiet: probingBaseline });
        lastReceipt = {
          eligible: false,
          active: false,
          reserve: 0,
          gap: SAFE_GAP,
          baselineStageGap: null,
          stageGap: null,
          stageIntersectionArea: 0,
          baselineIntersectionArea: 0,
          intersectionArea: 0
        };
        return lastReceipt;
      }
      function measure() {
        frame = 0;
        if (probingBaseline) return null;
        if (!eligible()) return clear({ preserveBaseline: !cameraAtBaseline() });

        /* Camera transforms enlarge and translate authored paint inside the
           fixed, clipped root SVG viewport. They must not redefine the
           reader's baseline rail.
           Restore that baseline after temporary mobile/embed/print states.
           Camera Reset preserves the established rail while viewport, mode,
           and content changes remain responsible for baseline reprobes. */
        if (!cameraAtBaseline()) {
          if (reserve === 0 && restorableReserve > 0) {
            if (writeReserve(restorableReserve)) return null;
          }
          var cameraNavRect = nav.getBoundingClientRect();
          var cameraLegendRect = visible(legend) ? legend.getBoundingClientRect() : null;
          var cameraStageRect = protectedStageRect();
          var cameraIntersectionArea = usable(cameraLegendRect) && intersectionArea(cameraNavRect, cameraStageRect) > 0
            ? intersectionArea(cameraNavRect, cameraLegendRect)
            : 0;
          lastReceipt = {
            eligible: true,
            active: reserve > 0,
            reserve: reserve,
            gap: SAFE_GAP,
            baselineStageGap: baselineStageGap == null ? null : Math.round(baselineStageGap * 100) / 100,
            stageGap: Math.round((cameraNavRect.top - cameraStageRect.bottom) * 100) / 100,
            stageIntersectionArea: Math.round(intersectionArea(cameraNavRect, cameraStageRect) * 100) / 100,
            baselineIntersectionArea: Math.round(baselineIntersectionArea * 100) / 100,
            intersectionArea: Math.round(cameraIntersectionArea * 100) / 100
          };
          return lastReceipt;
        }

        var navRect = nav.getBoundingClientRect();
        var legendRect = visible(legend) ? legend.getBoundingClientRect() : null;
        var stageRect = protectedStageRect();
        if (!usable(navRect) || !usable(stageRect)) return clear();

        var actualIntersectionArea = usable(legendRect) ? intersectionArea(navRect, legendRect) : 0;
        var stageGap = navRect.top - stageRect.bottom;
        if (!railLatched && reserve === 0) {
          baselineIntersectionArea = actualIntersectionArea;
          baselineStageGap = stageGap;
          if (stageGap < SAFE_GAP) {
            railLatched = true;
            if (writeReserve(Math.max(0, SAFE_GAP - stageGap))) return null;
          }
        } else if (railLatched && reserve > 0 && stageGap < SAFE_GAP) {
          /* Keep the decision latched while Adaptive Reader incorporates the
             rail. Presentation and rounded layout values can require one
             bounded follow-up before the full stage gap is established. */
          var remaining = Math.max(1, SAFE_GAP - stageGap);
          if (writeReserve(reserve + remaining)) return null;
        }

        navRect = nav.getBoundingClientRect();
        legendRect = visible(legend) ? legend.getBoundingClientRect() : null;
        stageRect = protectedStageRect();
        stageGap = navRect.top - stageRect.bottom;
        lastReceipt = {
          eligible: true,
          active: reserve > 0,
          reserve: reserve,
          gap: SAFE_GAP,
          baselineStageGap: baselineStageGap == null ? null : Math.round(baselineStageGap * 100) / 100,
          stageGap: Math.round(stageGap * 100) / 100,
          stageIntersectionArea: Math.round(intersectionArea(navRect, stageRect) * 100) / 100,
          baselineIntersectionArea: Math.round(baselineIntersectionArea * 100) / 100,
          intersectionArea: Math.round((usable(legendRect) ? intersectionArea(navRect, legendRect) : 0) * 100) / 100
        };
        return lastReceipt;
      }
      function reprobe() {
        if (probingBaseline) return probePromise || Promise.resolve(false);
        if (!cameraAtBaseline()) {
          schedule();
          return Promise.resolve(false);
        }
        if (!reserve && !railLatched && !restorableReserve) {
          schedule();
          return Promise.resolve(false);
        }
        probeFallbackReserve = restorableReserve || reserve;
        probingBaseline = true;
        railLatched = false;
        baselineIntersectionArea = 0;
        baselineStageGap = null;
        restorableReserve = 0;
        writeReserve(0, { quiet: true });
        var readerReady = Archify.readerLayout && typeof Archify.readerLayout.whenStable === 'function'
          ? Archify.readerLayout.whenStable().catch(function () {})
          : Promise.resolve();
        probePromise = readerReady.then(function () {
          probingBaseline = false;
          probePromise = null;
          if (!cameraAtBaseline() && probeFallbackReserve > 0) {
            restorableReserve = probeFallbackReserve;
          }
          probeFallbackReserve = 0;
          schedule();
          return true;
        });
        return probePromise;
      }
      function schedule() {
        if (frame) return;
        frame = requestAnimationFrame(measure);
      }
      function stableSnapshot() {
        var containerRect = container ? container.getBoundingClientRect() : { width: 0, height: 0 };
        var navRect = nav ? nav.getBoundingClientRect() : { top: 0, left: 0 };
        var legendRect = legend ? legend.getBoundingClientRect() : { top: 0, left: 0 };
        return [
          reserve,
          Math.round(containerRect.width * 100) / 100,
          Math.round(containerRect.height * 100) / 100,
          Math.round(navRect.left * 100) / 100,
          Math.round(navRect.top * 100) / 100,
          Math.round(legendRect.left * 100) / 100,
          Math.round(legendRect.top * 100) / 100,
          railLatched ? 'latched' : 'clear',
          lastReceipt ? lastReceipt.stageGap : ''
        ].join('|');
      }
      function whenStable() {
        return Archify.waitForStableLayout({
          schedule: schedule,
          pending: function () { return Boolean(frame || settleFrame || probingBaseline); },
          snapshot: stableSnapshot,
          timeoutMessage: 'Viewer chrome layout did not reach stable dimensions.'
        });
      }

      window.addEventListener('resize', reprobe, { passive: true });
      window.addEventListener('load', schedule, { once: true });
      window.addEventListener('beforeprint', schedule);
      window.addEventListener('afterprint', reprobe);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(reprobe).catch(function () {});
      if (typeof ResizeObserver === 'function') {
        var resizeObserver = new ResizeObserver(schedule);
        [nav, svg, legend].forEach(function (element) { if (element) resizeObserver.observe(element); });
      }
      if (typeof MutationObserver === 'function') {
        var contentObserver = new MutationObserver(function (records) {
          var viewerModeChanged = records.some(function (record) { return record.target === html; });
          if (viewerModeChanged) reprobe();
          else schedule();
        });
        if (legend) contentObserver.observe(legend, { attributes: true, childList: true, subtree: true });
        contentObserver.observe(html, {
          attributes: true,
          attributeFilter: ['data-embed', 'data-present', 'data-preset', 'data-theme']
        });
      }
      schedule();

      return {
        measure: measure,
        schedule: schedule,
        reprobe: reprobe,
        whenStable: whenStable,
        stageRect: protectedStageRect,
        active: function () { return reserve > 0; },
        receipt: function () { return lastReceipt || measure(); }
      };
    })();
