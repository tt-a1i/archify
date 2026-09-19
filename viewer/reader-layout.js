    Archify.readerLayout = (function () {
      var html = document.documentElement;
      var body = document.body;
      var shell = document.querySelector('.container');
      var diagram = document.querySelector('.diagram-container');
      var svg = diagram && diagram.querySelector(':scope > svg');
      var header = shell && shell.querySelector('.header');
      var guided = shell && shell.querySelector('.guided-views');
      var cards = shell && shell.querySelector('.cards');
      var viewBox = svg && svg.viewBox && svg.viewBox.baseVal;
      var ratio = viewBox && viewBox.height > 0 ? viewBox.width / viewBox.height : 0;
      var measuredHeightFit = svg && svg.getAttribute('data-reader-fit') === 'intrinsic-height';
      var frame = 0;
      var settleFrame = 0;
      var lastWidth = 0;
      var lastWorldReceipt = null;
      var WIDE_RATIO = 1.55;
      var MIN_DESKTOP_WIDTH = 1024;
      var MIN_READER_WIDTH = 960;
      var MAX_READER_WIDTH = 1920;
      var MIN_PROJECTED_NODE_TEXT_PX = 6;
      var SAFE_BOTTOM_GAP = 12;
      var worldContract = archifyReadabilityContract || {};

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
        Array.from(svg.querySelectorAll(
          'text[data-node-label], text[data-boundary-label], text[data-detail="context"]'
        )).forEach(function (text) {
          if (text.getAttribute('data-detail') === 'context' && !text.closest('[data-node-id]')) return;
          var sourceFontPx = parseFloat(text.getAttribute('font-size') || '');
          if (Number.isFinite(sourceFontPx)) {
            sourceMinimum = sourceMinimum == null ? sourceFontPx : Math.min(sourceMinimum, sourceFontPx);
          }
        });
        return sourceMinimum != null
          ? Math.min(1, MIN_PROJECTED_NODE_TEXT_PX / sourceMinimum)
          : 1;
      }
      function eligible() {
        return Boolean(
          ordinaryStandalone() && (ratio >= WIDE_RATIO || measuredHeightFit) &&
          window.innerWidth >= MIN_DESKTOP_WIDTH
        );
      }
      function ordinaryStandalone() {
        return Boolean(
          shell && diagram && svg &&
          window.innerWidth > (worldContract.minimumDesktopViewportWidthExclusive || 720) &&
          html.getAttribute('data-embed') !== 'true' &&
          html.getAttribute('data-present') !== 'true' &&
          (!window.matchMedia || !window.matchMedia('print').matches)
        );
      }
      function clearReader() {
        html.style.removeProperty('--archify-reader-width');
        html.removeAttribute('data-reader-layout');
        html.removeAttribute('data-reader-overflow');
        lastWidth = 0;
      }
      function clearWorldProfile() {
        html.style.removeProperty('--archify-stage-height');
        html.removeAttribute('data-world-measuring');
        html.removeAttribute('data-world-profile');
        diagram.removeAttribute('data-world-profile');
        lastWorldReceipt = null;
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
      function applyWidth(width) {
        var rounded = Math.round(width);
        if (Math.abs(rounded - lastWidth) < 1) return false;
        lastWidth = rounded;
        html.style.setProperty('--archify-reader-width', rounded + 'px');
        html.setAttribute('data-reader-layout', 'adaptive');
        return true;
      }
      function minimumSourceFont() {
        var selectors = Array.isArray(worldContract.labelSelectors) ? worldContract.labelSelectors : [];
        var elements = selectors.length ? svg.querySelectorAll(selectors.join(',')) : [];
        var minimum = null;
        Array.prototype.forEach.call(elements, function (element) {
          var value = number(window.getComputedStyle(element).fontSize || element.getAttribute('font-size'));
          if (value > 0 && (minimum === null || value < minimum)) minimum = value;
        });
        return minimum === null ? 0 : minimum;
      }
      function measureWorldProfile() {
        if (!ordinaryStandalone() || !viewBox || viewBox.width <= 0 || viewBox.height <= 0) {
          clearWorldProfile();
          return null;
        }
        var scrollState = ['guided-view-trail'].map(function (id) {
          var element = document.getElementById(id);
          return element ? { element: element, left: element.scrollLeft } : null;
        }).filter(Boolean);
        function finishProspectiveMeasurement() {
          html.removeAttribute('data-world-measuring');
          scrollState.forEach(function (state) { state.element.scrollLeft = state.left; });
        }
        html.setAttribute('data-world-measuring', 'true');
        var bodyStyle = window.getComputedStyle(body);
        var shellStyle = window.getComputedStyle(shell);
        var diagramStyle = window.getComputedStyle(diagram);
        var stageTop = diagram.getBoundingClientRect().top;
        var belowStageRequiredHeight = outerHeight(cards) + number(shellStyle.paddingBottom) + number(bodyStyle.paddingBottom);
        var availableStageHeight = Math.floor(
          window.innerHeight - stageTop - belowStageRequiredHeight -
          (worldContract.stageBottomGapCssPx || 24)
        );
        var minimumStageHeight = worldContract.minimumAvailableStageHeight || 360;
        if (!Number.isFinite(availableStageHeight) || availableStageHeight < minimumStageHeight) {
          finishProspectiveMeasurement();
          clearWorldProfile();
          return null;
        }
        var stageHeight = Math.min(worldContract.maximumStageHeight || 900, availableStageHeight);
        var horizontalChrome = number(diagramStyle.paddingLeft) + number(diagramStyle.paddingRight) +
          number(diagramStyle.borderLeftWidth) + number(diagramStyle.borderRightWidth);
        var verticalChrome = number(diagramStyle.paddingTop) + number(diagramStyle.paddingBottom) +
          number(diagramStyle.borderTopWidth) + number(diagramStyle.borderBottomWidth);
        var prospectiveStageWidth = Math.min(
          1440,
          window.innerWidth - number(bodyStyle.paddingLeft) - number(bodyStyle.paddingRight)
        );
        var safeStageWidth = Math.max(1, prospectiveStageWidth - horizontalChrome);
        var safeStageHeight = Math.max(1, stageHeight - verticalChrome);
        var sourceFont = minimumSourceFont();
        var derived = typeof archifyDeriveLargeWorldReadability === 'function'
          ? archifyDeriveLargeWorldReadability({
              safeStageWidth: safeStageWidth,
              safeStageHeight: safeStageHeight,
              canonicalWorldWidth: viewBox.width,
              canonicalWorldHeight: viewBox.height,
              minimumTargetSourceFontWorldUnits: sourceFont,
              targetBoundsWidth: 1,
              targetBoundsHeight: 1
            })
          : null;
        finishProspectiveMeasurement();
        if (!derived) {
          clearWorldProfile();
          return null;
        }
        var profile = derived.worldProfile;
        if (profile === 'large') html.style.setProperty('--archify-stage-height', stageHeight + 'px');
        else html.style.removeProperty('--archify-stage-height');
        html.setAttribute('data-world-profile', profile);
        diagram.setAttribute('data-world-profile', profile);
        lastWorldReceipt = {
          worldProfile: profile,
          stageTop: stageTop,
          belowStageRequiredHeight: belowStageRequiredHeight,
          availableStageHeight: availableStageHeight,
          stageHeight: stageHeight,
          safeStageWidth: safeStageWidth,
          safeStageHeight: safeStageHeight,
          canonicalWorldWidth: viewBox.width,
          canonicalWorldHeight: viewBox.height,
          minimumSourceFontWorldUnits: sourceFont,
          worldScaleFit: derived.worldScaleFit,
          projectedTextPx: derived.projectedTextPx,
          minimumProjectedTextPx: worldContract.minimumProjectedTextPx || 6,
          obscurers: ['diagram-padding', 'navigation-dock']
        };
        return lastWorldReceipt;
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
          if (overflow > 1 && lastWidth > minWidth) {
            applyWidth(Math.max(minWidth, lastWidth - overflow * ratio - 4));
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
          clearReader();
        } else {
          var chrome = chromeMetrics();
          var viewportCap = Math.max(0, window.innerWidth - chrome.bodyX);
          var readableWidth = viewBox && viewBox.width > 0
            ? viewBox.width * minimumReadableScale() + chrome.diagramX
            : MIN_READER_WIDTH;
          var minWidth = Math.min(
            measuredHeightFit && ratio < WIDE_RATIO ? readableWidth : MIN_READER_WIDTH,
            viewportCap
          );
          var maxWidth = Math.min(MAX_READER_WIDTH, viewportCap);
          var fixedHeight = chrome.bodyY + chrome.diagramY + SAFE_BOTTOM_GAP +
            outerHeight(header) + outerHeight(guided) + outerHeight(cards);
          var availableSvgHeight = Math.max(1, window.innerHeight - fixedHeight);
          var desiredWidth = availableSvgHeight * ratio + chrome.diagramX;
          var width = Math.max(minWidth, Math.min(maxWidth, desiredWidth));
          applyWidth(width);
          settleOverflow(minWidth);
        }
        var world = measureWorldProfile();
        return {
          ratio: ratio,
          width: lastWidth,
          worldProfile: world ? world.worldProfile : null,
          stageHeight: world ? world.stageHeight : 0,
          projectedTextPx: world ? world.projectedTextPx : null
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
          html.getAttribute('data-world-profile') || '',
          html.style.getPropertyValue('--archify-stage-height'),
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
      function whenStable() {
        return Archify.waitForStableLayout({
          schedule: schedule,
          pending: function () { return Boolean(frame || settleFrame); },
          snapshot: stableSnapshot,
          timeoutMessage: 'Adaptive reader layout did not reach stable dimensions.'
        });
      }

      window.addEventListener('resize', schedule, { passive: true });
      window.addEventListener('load', schedule, { once: true });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule).catch(function () {});
      if (typeof ResizeObserver === 'function') {
        var resizeObserver = new ResizeObserver(schedule);
        [header, guided, cards].forEach(function (element) { if (element) resizeObserver.observe(element); });
      }
      if (typeof MutationObserver === 'function') {
        var contentObserver = new MutationObserver(schedule);
        if (guided) contentObserver.observe(guided, { attributes: true, childList: true, subtree: true });
        if (cards) contentObserver.observe(cards, { attributes: true, childList: true, subtree: true });
        contentObserver.observe(html, { attributes: true, attributeFilter: ['data-embed', 'data-present'] });
      }
      schedule();

      return {
        measure: measure,
        schedule: schedule,
        whenStable: whenStable,
        active: function () { return html.getAttribute('data-reader-layout') === 'adaptive'; },
        receipt: function () {
          var receipt = { ratio: ratio, width: lastWidth };
          if (lastWorldReceipt) Object.keys(lastWorldReceipt).forEach(function (key) { receipt[key] = lastWorldReceipt[key]; });
          return receipt;
        }
      };
    })();
