    Archify.readerLayout = (function () {
      var html = document.documentElement;
      var body = document.body;
      var shell = document.querySelector('.container');
      var diagram = document.querySelector('.diagram-container');
      var svg = diagram && diagram.querySelector(':scope > svg');
      var legend = svg && svg.querySelector('[data-legend]');
      var header = shell && shell.querySelector('.header');
      var cards = shell && shell.querySelector('.cards');
      var viewBox = svg && svg.viewBox && svg.viewBox.baseVal;
      var ratio = viewBox && viewBox.height > 0 ? viewBox.width / viewBox.height : 0;
      var readerFit = svg && svg.getAttribute('data-reader-fit');
      var widthFirstReading = readerFit === 'width-first';
      var automaticSequence = widthFirstReading && svg.hasAttribute('data-sequence-column-fit');
      var readingScroll = widthFirstReading;
      var measuredHeightFit = readerFit === 'intrinsic-height' || widthFirstReading;
      var frame = 0;
      var settleFrame = 0;
      var lastWidth = 0;
      var automaticAreaHeight = 0;
      // Widest reader the overflow settle has accepted for this viewport (0 =
      // uncapped). Card copy rewraps as the reader narrows, so recomputing
      // from fixed heights alone would widen again and oscillate; only a
      // resize lifts the cap.
      var settledCap = 0;
      var WIDE_RATIO = 1.55;
      var MIN_DESKTOP_WIDTH = 1024;
      var MIN_READER_WIDTH = 960;
      var MAX_READER_WIDTH = 1920;
      var MAX_AUTOMATIC_SCALE = 1.5;
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
      // Smallest scale that keeps node text at the requested floor and
      // context relationship labels readable. A declared wide reader holds
      // relationship labels to the requested floor too; every other reader
      // still keeps them at the 6px hard floor the browser gate enforces, so
      // a first-screen fit can never push them below it.
      function minimumReadableScale() {
        var nodeMinimum = null;
        var edgeMinimum = null;
        var selectors = 'text[data-node-label], text[data-boundary-label], text[data-detail="context"], g[data-detail="context"] text';
        Array.from(svg.querySelectorAll(selectors)).forEach(function (text) {
          if (text.getAttribute('data-detail') === 'fine' || text.closest('[data-detail="fine"]')) return;
          var sourceFontPx = parseFloat(text.getAttribute('font-size') || '');
          if (!Number.isFinite(sourceFontPx)) return;
          var primary = text.hasAttribute('data-node-label') || text.hasAttribute('data-boundary-label');
          var context = text.getAttribute('data-detail') === 'context' || Boolean(text.closest('g[data-detail="context"]'));
          if (!primary && context && text.closest('[data-edge-from][data-edge-to]')) {
            edgeMinimum = edgeMinimum == null ? sourceFontPx : Math.min(edgeMinimum, sourceFontPx);
          } else if (primary || text.closest('[data-node-id]')) {
            nodeMinimum = nodeMinimum == null ? sourceFontPx : Math.min(nodeMinimum, sourceFontPx);
          }
        });
        var edgeTarget = measuredHeightFit && ratio >= WIDE_RATIO && Number.isFinite(declaredMinimumText)
          ? requestedMinimumText
          : MIN_PROJECTED_NODE_TEXT_PX;
        var scale = 0;
        if (nodeMinimum != null) scale = Math.max(scale, requestedMinimumText / nodeMinimum);
        if (edgeMinimum != null) scale = Math.max(scale, edgeTarget / edgeMinimum);
        return scale > 0 ? Math.min(1, scale) : 1;
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
        html.style.removeProperty('--archify-diagram-max-width');
        html.style.removeProperty('--archify-diagram-min-height');
        html.removeAttribute('data-reader-area');
        html.removeAttribute('data-reader-narrow');
        html.removeAttribute('data-reader-layout');
        html.removeAttribute('data-reader-overflow');
        setRail(false);
        lastWidth = 0;
        automaticAreaHeight = 0;
        settledCap = 0;
        clearLegend();
      }
      function clearLegend() {
        if (!legend || !legend.hasAttribute('data-reader-legend-corner')) return;
        legend.removeAttribute('data-reader-legend-corner');
        legend.style.removeProperty('--archify-reader-legend-transform');
      }
      // Keep the original legend in its SVG: renderer hover/focus selectors and
      // canonical export still own that same group. Ordinary capped reading
      // and fitted automatic sequences borrow the outer corner at 25–100%.
      function syncLegend() {
        var cameraScale = Number(svg && svg.getAttribute('data-view-scale')) || 1;
        var cornerReading = html.getAttribute('data-reader-area') === 'true' || automaticSequence && !readingScroll;
        if (!legend || !eligible() || !cornerReading || cameraScale > 1.001) {
          clearLegend();
          return;
        }
        var box = legend.getBBox();
        var parentMatrix = legend.parentNode.getScreenCTM();
        if (!parentMatrix || !box.width || !box.height) {
          clearLegend();
          return;
        }
        var rect = diagram.getBoundingClientRect();
        var style = window.getComputedStyle(diagram);
        var scale = Math.min(svg.clientWidth / viewBox.width, svg.clientHeight / viewBox.height);
        if (!Number.isFinite(scale) || scale <= 0) {
          clearLegend();
          return;
        }
        var left = rect.left + number(style.borderLeftWidth) + number(style.paddingLeft);
        var right = rect.right - number(style.borderRightWidth) - number(style.paddingRight);
        var bottom = rect.bottom - number(style.borderBottomWidth) - number(style.paddingBottom);
        var top = bottom - box.height * scale;
        var nav = diagram.querySelector('.diagram-nav');
        var navRect = visible(nav) ? nav.getBoundingClientRect() : null;
        // Long or multi-row legends retain their canonical position if the
        // spare corner cannot hold them clear of the dock and content area.
        if (left + box.width * scale > right || top < rect.top + number(style.paddingTop) + number(style.borderTopWidth) ||
            (navRect && left < navRect.right + 10 && left + box.width * scale > navRect.left - 10 &&
              top < navRect.bottom + 10 && bottom > navRect.top - 10)) {
          clearLegend();
          return;
        }
        var matrix = parentMatrix.inverse().translate(left, top).scale(scale).translate(-box.x, -box.y);
        var value = 'matrix(' + [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].join(',') + ')';
        if (legend.style.getPropertyValue('--archify-reader-legend-transform') !== value) {
          legend.style.setProperty('--archify-reader-legend-transform', value);
        }
        if (!legend.hasAttribute('data-reader-legend-corner')) legend.setAttribute('data-reader-legend-corner', '');
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
          railPlacement.hidden = !mode || mode === 'collapsed' || (mode === 'bottom' && window.innerWidth < RAIL_MIN_VIEWPORT);
          railPlacement.setAttribute('data-placement', mode === 'bottom' ? 'bottom' : 'right');
          railPlacement.setAttribute('aria-label', viewerText(mode === 'bottom' ? 'viewer.rail.right' : 'viewer.rail.bottom'));
          railPlacement.title = railPlacement.getAttribute('aria-label');
        }
      }
      var outline = document.getElementById('node-outline');
      function hasCards() {
        return Boolean((cards && cards.children.length && !cards.hidden) || (outline && !outline.hidden));
      }
      // Bottom notes and index are reading material below the fold: the first
      // screen belongs to the interactive diagram and its controls.
      function belowFold() {
        return html.getAttribute('data-reader-rail') === 'bottom' ? outerHeight(railPanel) : 0;
      }
      // A docked rail may run past a short diagram down to the viewport floor,
      // so the index uses that space instead of scrolling inside the diagram's
      // height; it never pushes the page into overflow.
      function fitDockedRail() {
        if (html.getAttribute('data-reader-rail') !== 'true' || !railPanel) return;
        var top = railPanel.getBoundingClientRect().top + window.scrollY;
        var floor = window.innerHeight - number(window.getComputedStyle(body).paddingBottom) - top;
        html.style.setProperty('--archify-rail-max', Math.max(diagram.getBoundingClientRect().height, floor) + 'px');
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
      // `width` is the diagram's reading width. The page shell never narrows
      // below the desktop reader floor, so a narrow, tall diagram keeps a
      // usable header, toolbar, and controls; its SVG is centred instead.
      function applyWidth(width, minWidth) {
        var rounded = Math.max(Math.ceil(minWidth || 0), Math.round(width));
        var changed = Math.abs(rounded - lastWidth) >= 1;
        lastWidth = rounded;
        var shellFloor = Math.min(MIN_READER_WIDTH, Math.max(0, window.innerWidth - chromeMetrics().bodyX));
        html.style.setProperty('--archify-reader-width', Math.max(rounded, shellFloor) + 'px');
        var railShare = html.getAttribute('data-reader-rail') === 'true' ? RAIL_WIDTH + RAIL_GAP : 0;
        var diagramWidth = Math.max(1, rounded - railShare - chromeMetrics().diagramX);
        // Content fitting and automatic enlargement never reduce the outer
        // reader region. The SVG alone takes the narrower reading width.
        var automaticWidthCap = measuredHeightFit && viewBox && viewBox.width > 0
          ? viewBox.width * MAX_AUTOMATIC_SCALE : 0;
        if (automaticWidthCap && diagramWidth > automaticWidthCap) {
          diagramWidth = automaticWidthCap;
          html.style.setProperty('--archify-diagram-min-height', automaticAreaHeight + 'px');
          html.setAttribute('data-reader-area', 'true');
        } else {
          // Ordinary automatic diagrams retain their existing document flow.
          // Settling can also stop binding the cap without a new measure.
          html.style.removeProperty('--archify-diagram-min-height');
          html.removeAttribute('data-reader-area');
        }
        if (diagramWidth < Math.max(rounded, shellFloor) - railShare - chromeMetrics().diagramX) {
          html.style.setProperty('--archify-diagram-max-width', diagramWidth + 'px');
          html.setAttribute('data-reader-narrow', 'true');
        } else {
          html.style.removeProperty('--archify-diagram-max-width');
          html.removeAttribute('data-reader-narrow');
        }
        html.setAttribute('data-reader-layout', 'adaptive');
        syncLegend();
        return changed;
      }
      function settleOverflow(minWidth) {
        if (settleFrame) cancelAnimationFrame(settleFrame);
        settleFrame = requestAnimationFrame(function () {
          settleFrame = 0;
          if (!eligible() || !lastWidth) return;
          fitDockedRail();
          var overflow = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight
          ) - window.innerHeight - belowFold();
          // visual-check fails any page whose rounded-up height exceeds the
          // viewport, so even a 1px remainder must be reduced or declared.
          if (overflow > 0 && !readingScroll && lastWidth > Math.ceil(minWidth)) {
            applyWidth(Math.max(minWidth, lastWidth - overflow * ratio - 4), minWidth);
            settledCap = lastWidth;
            html.setAttribute('data-reader-overflow', 'reduced');
          } else if (overflow > 0) {
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
        // Sequence first-screen fitting preserves source text sizes instead
        // of shrinking to the shared hard readability floor.
        var readableWidth = viewBox && viewBox.width > 0
          ? viewBox.width * (automaticSequence ? 1 : minimumReadableScale()) + chrome.diagramX
          : MIN_READER_WIDTH;
        var maxWidth = Math.min(MAX_READER_WIDTH, viewportCap);
        var readableMinimumWidth = automaticSequence || measuredHeightFit && ratio < WIDE_RATIO
          ? readableWidth
          : measuredHeightFit && ratio >= WIDE_RATIO && Number.isFinite(declaredMinimumText)
            ? Math.max(MIN_READER_WIDTH, readableWidth)
            : MIN_READER_WIDTH;
        var minWidth;
        if (automaticSequence) {
          minWidth = Math.min(readableMinimumWidth, maxWidth);
        } else if (measuredHeightFit && ratio < WIDE_RATIO) {
          minWidth = Math.min(readableMinimumWidth, viewportCap);
        } else if (measuredHeightFit && ratio >= WIDE_RATIO && Number.isFinite(declaredMinimumText)) {
          minWidth = Math.min(readableMinimumWidth, maxWidth);
        } else {
          minWidth = Math.min(readableMinimumWidth, viewportCap);
        }
        var primaryWidth = primaryReadingWidth();
        var railExtra = RAIL_WIDTH + RAIL_GAP;
        var mode = null;
        // Notes default below the diagram; the right rail is the reader's
        // opt-in and needs a wide viewport.
        if (hasCards() && (readPreference(RAIL_PLACEMENT_KEY) !== 'right' || window.innerWidth < RAIL_MIN_VIEWPORT)) {
          mode = 'bottom';
        } else if (hasCards()) {
          var fitsReadable = readableMinimumWidth + railExtra <= maxWidth;
          var comfortWidth = labelWidth(RAIL_COMFORT_PRIMARY_PX);
          var comfortable = fitsReadable && (!comfortWidth || comfortWidth + chrome.diagramX + railExtra <= maxWidth);
          var collapsedPreference = readPreference(RAIL_COLLAPSED_KEY);
          if (collapsedPreference === '1' || (collapsedPreference !== '0' && !comfortable)) mode = 'collapsed';
          else mode = fitsReadable ? 'true' : 'overlay';
        }
        // Height-fit families with notes below the fold may shrink to their
        // readable floor. Width-first families choose their reading width
        // below and retain page scrolling instead.
        if (mode === 'bottom') primaryWidth = 0;
        if (primaryWidth > 0) minWidth = Math.max(minWidth, Math.min(maxWidth, primaryWidth + chrome.diagramX));
        var docked = mode === 'true';
        setRail(mode);
        chrome = chromeMetrics();
        if (docked) minWidth = Math.min(maxWidth, minWidth + railExtra);
        var stackedBelow = mode === 'bottom' ? 0 : docked ? 0 : outerHeight(cards);
        var fixedHeight = chrome.bodyY + chrome.diagramY + SAFE_BOTTOM_GAP +
          outerHeight(header) + stackedBelow;
        var availableSvgHeight = Math.max(1, window.innerHeight - fixedHeight);
        var desiredWidth = availableSvgHeight * ratio + chrome.diagramX + (docked ? railExtra : 0);
        // Compact automatic sequences fit the first screen without shrinking
        // their authored text. Longer sequences retain reading width and page
        // scroll; other width-first families keep their existing strategy.
        var sequenceFits = automaticSequence && Math.min(desiredWidth, maxWidth) >=
          readableWidth + (docked ? railExtra : 0);
        readingScroll = widthFirstReading && !sequenceFits;
        if (readingScroll) desiredWidth = maxWidth;
        // Only a binding enlargement cap needs a separate normal reader area.
        // Uncapped diagrams keep their existing natural height and Chrome fit.
        automaticAreaHeight = availableSvgHeight + chrome.diagramY;
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
          Math.round(diagramRect.height * 100) / 100,
          legend && legend.hasAttribute('data-reader-legend-corner') ? legend.style.getPropertyValue('--archify-reader-legend-transform') : ''
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
      window.addEventListener('beforeprint', clearLegend);
      window.addEventListener('afterprint', schedule);
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
        syncLegend: syncLegend,
        active: function () { return html.getAttribute('data-reader-layout') === 'adaptive'; },
        receipt: function () { return { ratio: ratio, width: lastWidth }; }
      };
    })();
