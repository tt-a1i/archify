    Archify.readerLayout = (function () {
      var html = document.documentElement;
      var body = document.body;
      var shell = document.querySelector('.container');
      var diagram = document.querySelector('.diagram-container');
      var svg = diagram && diagram.querySelector(':scope > svg');
      var header = shell && shell.querySelector('.header');
      var cards = shell && shell.querySelector('.cards');
      var viewBox = svg && svg.viewBox && svg.viewBox.baseVal;
      var ratio = viewBox && viewBox.height > 0 ? viewBox.width / viewBox.height : 0;
      var measuredHeightFit = svg && svg.getAttribute('data-reader-fit') === 'intrinsic-height';
      var frame = 0;
      var settleFrame = 0;
      var lastWidth = 0;
      // Widest reader the overflow settle has accepted for this viewport (0 =
      // uncapped). Card copy rewraps as the reader narrows, so recomputing
      // from fixed heights alone would widen again and oscillate; only a
      // resize lifts the cap.
      var settledCap = 0;
      var WIDE_RATIO = 1.55;
      var MIN_DESKTOP_WIDTH = 1024;
      var MIN_READER_WIDTH = 960;
      var MAX_READER_WIDTH = 1920;
      var MIN_PROJECTED_NODE_TEXT_PX = 6;
      var declaredMinimumText = svg ? parseFloat(svg.getAttribute('data-reader-min-text') || '') : null;
      var requestedMinimumText = Number.isFinite(declaredMinimumText)
        ? Math.max(MIN_PROJECTED_NODE_TEXT_PX, declaredMinimumText)
        : MIN_PROJECTED_NODE_TEXT_PX;
      var declaredPrimaryText = svg ? parseFloat(svg.getAttribute('data-reader-primary-text') || '') : null;
      var SAFE_BOTTOM_GAP = 12;
      // Wide viewports move summary cards beside the diagram, so the height
      // budget belongs to the diagram and spare width holds the notes.
      var RAIL_MIN_VIEWPORT = 1280;
      var RAIL_WIDTH = 288;
      var RAIL_GAP = 20;
      // A default rail must leave primary node labels comfortably readable;
      // otherwise it starts collapsed and the reader can still open it.
      var RAIL_COMFORT_PRIMARY_PX = 12;
      var railPanel = shell && shell.querySelector('.reader-rail');
      var railReveal = document.getElementById('rail-reveal');
      var railCollapse = document.getElementById('rail-collapse');
      var railPlacement = document.getElementById('rail-placement');
      var RAIL_COLLAPSED_KEY = 'archify-rail-collapsed';
      var RAIL_PLACEMENT_KEY = 'archify-rail-placement';
      // Memory is the page's source of truth; storage only carries the choice
      // to later artifacts, so a blocked or full localStorage cannot freeze it.
      var preferences = Object.create(null);
      function readPreference(key) {
        if (key in preferences) return preferences[key];
        try { return localStorage.getItem(key); } catch (_) { return null; }
      }
      function writePreference(key, value) {
        preferences[key] = value;
        try { localStorage.setItem(key, value); } catch (_) {}
      }

      if (diagram && ratio >= WIDE_RATIO) {
        diagram.setAttribute('data-wide-diagram', 'true');
        html.setAttribute('data-diagram-shape', 'wide');
      }

      function number(value) {
        var parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      function visible(element) {
        return Boolean(element && !element.hidden && window.getComputedStyle(element).display !== 'none');
      }
      function outerHeight(element) {
        if (!visible(element)) return 0;
        var style = window.getComputedStyle(element);
        return element.getBoundingClientRect().height + number(style.marginTop) + number(style.marginBottom);
      }
      function minimumReadableScale() {
        var sourceMinimum = null;
        var selectors = [
          'text[data-node-label], text[data-boundary-label], text[data-detail="context"]'
        ];
        if (measuredHeightFit && ratio >= WIDE_RATIO && Number.isFinite(declaredMinimumText)) {
          selectors.push('g[data-detail="context"][data-edge-from][data-edge-to] > text');
        }
        Array.from(svg.querySelectorAll(selectors.join(', '))).forEach(function (text) {
          if (text.getAttribute('data-detail') === 'context' && !text.closest('[data-node-id]')) return;
          var sourceFontPx = parseFloat(text.getAttribute('font-size') || '');
          if (Number.isFinite(sourceFontPx)) {
            sourceMinimum = sourceMinimum == null ? sourceFontPx : Math.min(sourceMinimum, sourceFontPx);
          }
        });
        return sourceMinimum != null
          ? Math.min(1, requestedMinimumText / sourceMinimum)
          : 1;
      }
      var sourcePrimary = null;
      if (svg) Array.from(svg.querySelectorAll('text[data-node-label]')).forEach(function (text) {
        var size = parseFloat(text.getAttribute('font-size') || '');
        if (Number.isFinite(size) && size > 0) sourcePrimary = sourcePrimary == null ? size : Math.max(sourcePrimary, size);
      });
      // SVG width at which the largest node label renders at targetPx. Every
      // renderer writes label font sizes, so the rail comfort check works for
      // all diagram types; only the renderer-declared floor needs metadata.
      function labelWidth(targetPx) {
        return sourcePrimary == null || !viewBox ? 0 : viewBox.width * targetPx / sourcePrimary;
      }
      function primaryReadingWidth() {
        if (!measuredHeightFit || !Number.isFinite(declaredPrimaryText) || declaredPrimaryText <= 0) return 0;
        // Primary labels should remain comfortable to read when cards or
        // auxiliary rows make a one-screen fit too small. Ordinary page
        // scroll preserves that reading size; viewport width still caps it.
        // A long title may already use a smaller fitted font. Preserve that
        // hierarchy rather than enlarging every other node to compensate.
        return labelWidth(declaredPrimaryText);
      }
      function eligible() {
        return Boolean(
          shell && diagram && svg && (ratio >= WIDE_RATIO || measuredHeightFit) &&
          window.innerWidth >= MIN_DESKTOP_WIDTH &&
          html.getAttribute('data-embed') !== 'true' &&
          html.getAttribute('data-present') !== 'true' &&
          (!window.matchMedia || !window.matchMedia('print').matches)
        );
      }
      function clear() {
        html.style.removeProperty('--archify-reader-width');
        html.removeAttribute('data-reader-layout');
        html.removeAttribute('data-reader-overflow');
        setRail(false);
        lastWidth = 0;
        settledCap = 0;
      }
      // Rail modes: "true" docks beside the diagram, "collapsed" leaves only the
      // reveal control, "overlay" opens a drawer when docking would break the
      // readable floor, and "bottom" stacks notes and index below the diagram.
      function setRail(mode) {
        if (mode) {
          html.setAttribute('data-reader-rail', mode);
          html.style.setProperty('--archify-rail-width', RAIL_WIDTH + 'px');
          html.style.setProperty('--archify-rail-gap', RAIL_GAP + 'px');
        } else {
          html.removeAttribute('data-reader-rail');
          html.style.removeProperty('--archify-rail-width');
          html.style.removeProperty('--archify-rail-gap');
        }
        if (railReveal) railReveal.hidden = mode !== 'collapsed';
        if (railCollapse) {
          railCollapse.hidden = mode !== 'true' && mode !== 'overlay';
          railCollapse.setAttribute('aria-expanded', String(mode === 'true' || mode === 'overlay'));
        }
        if (railPlacement) {
          railPlacement.hidden = !mode || mode === 'collapsed';
          railPlacement.setAttribute('data-placement', mode === 'bottom' ? 'bottom' : 'right');
          railPlacement.setAttribute('aria-label', viewerText(mode === 'bottom' ? 'viewer.rail.right' : 'viewer.rail.bottom'));
          railPlacement.title = railPlacement.getAttribute('aria-label');
        }
      }
      function hasCards() {
        var outline = document.getElementById('node-outline');
        return Boolean((cards && cards.children.length && !cards.hidden) || (outline && !outline.hidden));
      }
      function chromeMetrics() {
        var bodyStyle = window.getComputedStyle(body);
        var diagramStyle = window.getComputedStyle(diagram);
        return {
          bodyX: number(bodyStyle.paddingLeft) + number(bodyStyle.paddingRight),
          bodyY: number(bodyStyle.paddingTop) + number(bodyStyle.paddingBottom),
          diagramX: number(diagramStyle.paddingLeft) + number(diagramStyle.paddingRight) +
            number(diagramStyle.borderLeftWidth) + number(diagramStyle.borderRightWidth),
          diagramY: number(diagramStyle.paddingTop) + number(diagramStyle.paddingBottom) +
            number(diagramStyle.borderTopWidth) + number(diagramStyle.borderBottomWidth)
        };
      }
      function applyWidth(width, minWidth) {
        var rounded = Math.max(Math.ceil(minWidth || 0), Math.round(width));
        if (Math.abs(rounded - lastWidth) < 1) return false;
        lastWidth = rounded;
        html.style.setProperty('--archify-reader-width', rounded + 'px');
        html.setAttribute('data-reader-layout', 'adaptive');
        return true;
      }
      function settleOverflow(minWidth) {
        if (settleFrame) cancelAnimationFrame(settleFrame);
        settleFrame = requestAnimationFrame(function () {
          settleFrame = 0;
          if (!eligible() || !lastWidth) return;
          var overflow = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
          ) - window.innerHeight;
          if (overflow > 1 && lastWidth > Math.ceil(minWidth)) {
            applyWidth(Math.max(minWidth, lastWidth - overflow * ratio - 4), minWidth);
            settledCap = lastWidth;
            html.setAttribute('data-reader-overflow', 'reduced');
          } else if (overflow > 1) {
            html.setAttribute('data-reader-overflow', 'authored');
          } else {
            html.removeAttribute('data-reader-overflow');
          }
        });
      }
      function measure() {
        frame = 0;
        if (!eligible()) {
          clear();
          return null;
        }
        var chrome = chromeMetrics();
        var viewportCap = Math.max(0, window.innerWidth - chrome.bodyX);
        var readableWidth = viewBox && viewBox.width > 0
          ? viewBox.width * minimumReadableScale() + chrome.diagramX
          : MIN_READER_WIDTH;
        var maxWidth = Math.min(MAX_READER_WIDTH, viewportCap);
        var readableMinimumWidth = measuredHeightFit && ratio < WIDE_RATIO
          ? readableWidth
          : measuredHeightFit && ratio >= WIDE_RATIO && Number.isFinite(declaredMinimumText)
            ? Math.max(MIN_READER_WIDTH, readableWidth)
            : MIN_READER_WIDTH;
        var minWidth;
        if (measuredHeightFit && ratio < WIDE_RATIO) {
          minWidth = Math.min(readableMinimumWidth, viewportCap);
        } else if (measuredHeightFit && ratio >= WIDE_RATIO && Number.isFinite(declaredMinimumText)) {
          minWidth = Math.min(readableMinimumWidth, maxWidth);
        } else {
          minWidth = Math.min(readableMinimumWidth, viewportCap);
        }
        var primaryWidth = primaryReadingWidth();
        if (primaryWidth > 0) minWidth = Math.max(minWidth, Math.min(maxWidth, primaryWidth + chrome.diagramX));
        var railExtra = RAIL_WIDTH + RAIL_GAP;
        var mode = null;
        if (hasCards() && window.innerWidth >= RAIL_MIN_VIEWPORT) {
          var fitsReadable = readableMinimumWidth + railExtra <= maxWidth;
          var comfortWidth = labelWidth(RAIL_COMFORT_PRIMARY_PX);
          var comfortable = fitsReadable && (!comfortWidth || comfortWidth + chrome.diagramX + railExtra <= maxWidth);
          var collapsedPreference = readPreference(RAIL_COLLAPSED_KEY);
          if (readPreference(RAIL_PLACEMENT_KEY) === 'bottom') mode = 'bottom';
          else if (collapsedPreference === '1' || (collapsedPreference !== '0' && !comfortable)) mode = 'collapsed';
          else mode = fitsReadable ? 'true' : 'overlay';
        }
        var docked = mode === 'true';
        setRail(mode);
        chrome = chromeMetrics();
        if (docked) minWidth = Math.min(maxWidth, minWidth + railExtra);
        var stackedBelow = mode === 'bottom' ? outerHeight(railPanel) : docked ? 0 : outerHeight(cards);
        var fixedHeight = chrome.bodyY + chrome.diagramY + SAFE_BOTTOM_GAP +
          outerHeight(header) + stackedBelow;
        var availableSvgHeight = Math.max(1, window.innerHeight - fixedHeight);
        var desiredWidth = availableSvgHeight * ratio + chrome.diagramX + (docked ? railExtra : 0);
        var width = Math.max(minWidth, Math.min(maxWidth, desiredWidth, settledCap || desiredWidth));
        applyWidth(width, minWidth);
        settleOverflow(minWidth);
        return {
          ratio: ratio,
          width: lastWidth,
          availableSvgHeight: Math.round(availableSvgHeight),
          fixedHeight: Math.round(fixedHeight)
        };
      }
      function schedule() {
        if (frame) return;
        frame = requestAnimationFrame(measure);
      }
      function stableSnapshot() {
        var shellRect = shell ? shell.getBoundingClientRect() : { width: 0, height: 0 };
        var diagramRect = diagram ? diagram.getBoundingClientRect() : { width: 0, height: 0 };
        return [
          lastWidth,
          html.getAttribute('data-reader-layout') || '',
          html.getAttribute('data-reader-overflow') || '',
          Math.ceil(document.documentElement.scrollWidth),
          Math.ceil(document.documentElement.scrollHeight),
          Math.ceil(document.body.scrollWidth),
          Math.ceil(document.body.scrollHeight),
          Math.round(shellRect.width * 100) / 100,
          Math.round(shellRect.height * 100) / 100,
          Math.round(diagramRect.width * 100) / 100,
          Math.round(diagramRect.height * 100) / 100
        ].join('|');
      }
      function layoutPending() { return Boolean(frame || settleFrame); }
      function whenStable() {
        return Archify.waitForStableLayout({
          schedule: schedule,
          pending: layoutPending,
          snapshot: stableSnapshot,
          timeoutMessage: 'Adaptive reader layout did not reach stable dimensions.'
        });
      }
      archifyLayoutOwners.reader = { schedule: schedule, pending: layoutPending, snapshot: stableSnapshot };

      window.addEventListener('resize', function () {
        settledCap = 0;
        schedule();
      }, { passive: true });
      window.addEventListener('load', schedule, { once: true });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule).catch(function () {});
      if (typeof ResizeObserver === 'function') {
        var resizeObserver = new ResizeObserver(schedule);
        [header, cards].forEach(function (element) { if (element) resizeObserver.observe(element); });
      }
      if (typeof MutationObserver === 'function') {
        var contentObserver = new MutationObserver(schedule);
        if (cards) contentObserver.observe(cards, { attributes: true, childList: true, subtree: true });
        contentObserver.observe(html, { attributes: true, attributeFilter: ['data-embed', 'data-present'] });
      }
      // Reader choices persist across artifacts; a resize-style remeasure
      // applies them without reloading.
      function chooseRail(key, value) {
        writePreference(key, value);
        settledCap = 0;
        schedule();
      }
      function collapseRail() {
        chooseRail(RAIL_COLLAPSED_KEY, '1');
        if (railReveal) requestAnimationFrame(function () { try { railReveal.focus({ preventScroll: true }); } catch (_) {} });
      }
      if (railReveal) railReveal.addEventListener('click', function () { chooseRail(RAIL_COLLAPSED_KEY, '0'); });
      if (railCollapse) railCollapse.addEventListener('click', collapseRail);
      if (railPlacement) railPlacement.addEventListener('click', function () {
        var toBottom = html.getAttribute('data-reader-rail') !== 'bottom';
        if (!toBottom) writePreference(RAIL_COLLAPSED_KEY, '0');
        chooseRail(RAIL_PLACEMENT_KEY, toBottom ? 'bottom' : 'right');
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && html.getAttribute('data-reader-rail') === 'overlay') collapseRail();
      });
      document.addEventListener('pointerdown', function (event) {
        if (html.getAttribute('data-reader-rail') !== 'overlay' || !railPanel) return;
        if (!railPanel.contains(event.target) && !(railReveal && railReveal.contains(event.target))) chooseRail(RAIL_COLLAPSED_KEY, '1');
      });
      if (typeof ResizeObserver === 'function' && railPanel) new ResizeObserver(schedule).observe(railPanel);
      schedule();

      return {
        measure: measure,
        schedule: schedule,
        whenStable: whenStable,
        active: function () { return html.getAttribute('data-reader-layout') === 'adaptive'; },
        receipt: function () { return { ratio: ratio, width: lastWidth }; }
      };
    })();
