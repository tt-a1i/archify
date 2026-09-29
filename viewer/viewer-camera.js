    Archify.view = (function () {
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector('svg');
      var outBtn = container.querySelector('[data-view="out"]');
      var resetBtn = container.querySelector('[data-view="reset"]');
      var resetDetailLabel = resetBtn.querySelector('[data-view-detail]');
      var resetPercentLabel = resetBtn.querySelector('[data-view-percent]');
      var inBtn = container.querySelector('[data-view="in"]');
      var fitAllBtn = container.querySelector('[data-view="fit-all"]');
      var navigation = container.querySelector('.diagram-nav');
      var MIN_SCALE = 0.25;
      var MAX_SCALE = 4;
      var minimumScale = MIN_SCALE;
      var canvasGeometry = null;
      var initialFraming = true;
      // Only a temporary bridge while outside the fixed desktop layout.
      var fixedReading = null;
      var CAMERA_LIMIT = 1000000;
      var grid = document.createElement('div');
      var gridScale = null;
      var gridFixed = null;
      var state = { scale: 1, x: 0, y: 0, mode: 'overview' };
      var drag = null;
      var spacePan = false;
      var panClickPointer = null;
      var cameraTimer = null;
      var cameraFrame = null;
      var cameraGeneration = 0;
      var cameraTransaction = null;
      var clipFrame = 0;
      var interactionFrame = 0;
      var keyboardFrame = 0;
      var keyboardStartedAt = 0;
      var keyboardShift = false;
      var keyboardDirections = Object.create(null);
      var resizeFrame = 0;
      var autoScrollUntil = 0;
      var wheelTimer = null;
      var wheelGeometry = null;
      var wheelMode = '';
      var wheelPanFrame = 0;
      var wheelPanTimestamp = 0;
      var wheelPanTarget = null;
      var wheelPanInputEnded = false;
      var suppressContextMenuUntil = 0;
      var lastControlKey = '';
      var interactionMetrics = { offsetLeft: 0, offsetTop: 0 };

      var viewBox = svg.viewBox && svg.viewBox.baseVal;

      grid.className = 'infinite-canvas-grid';
      grid.setAttribute('aria-hidden', 'true');
      container.insertBefore(grid, svg);

      function boundPosition(value) {
        return Math.max(-CAMERA_LIMIT, Math.min(CAMERA_LIMIT, Number(value) || 0));
      }
      function directNavigationEnabled() {
        return document.documentElement.getAttribute('data-embed') !== 'true' && !mobileScrollMode();
      }
      function boundCamera() {
        state.scale = Number.isFinite(state.scale) && state.scale > 0 ? Math.min(MAX_SCALE, state.scale) : 1;
        state.x = boundPosition(state.x);
        state.y = boundPosition(state.y);
      }
      function mobileScrollMode() {
        return window.innerWidth <= 720 && container.hasAttribute('data-wide-diagram');
      }
      function reducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
      function contentMetrics() {
        if (!viewBox || !Number.isFinite(viewBox.width) || !Number.isFinite(viewBox.height) ||
            viewBox.width <= 0 || viewBox.height <= 0) return null;
        var width = svg.clientWidth || 1;
        var height = svg.clientHeight || 1;
        var scale = Math.min(width / viewBox.width, height / viewBox.height);
        return {
          width: width,
          height: height,
          scale: scale,
          offsetX: (width - viewBox.width * scale) / 2,
          offsetY: (height - viewBox.height * scale) / 2
        };
      }
      // Geometry is refreshed at interaction boundaries, never for every input frame.
      function measureCanvas() {
        var metrics = contentMetrics();
        if (!metrics) return null;
        var rect = container.getBoundingClientRect();
        var style = getComputedStyle(container);
        var visual = window.visualViewport;
        var screenLeft = visual ? visual.offsetLeft : 0;
        var screenTop = visual ? visual.offsetTop : 0;
        var screenRight = screenLeft + (visual ? visual.width : window.innerWidth);
        var screenBottom = screenTop + (visual ? visual.height : window.innerHeight);
        var innerLeft = rect.left + container.clientLeft;
        var innerTop = rect.top + container.clientTop;
        // SVGSVGElement has no offsetLeft/offsetTop. Remove the rendered camera
        // translation from its screen box to recover the untransformed origin.
        var rendered = sampleRenderedState();
        var svgRect = svg.getBoundingClientRect();
        var originX = svgRect.left - rendered.x;
        var originY = svgRect.top - rendered.y;
        var left = Math.max(innerLeft, screenLeft) + (parseFloat(style.paddingLeft) || 0) - originX;
        var top = Math.max(innerTop, screenTop) + (parseFloat(style.paddingTop) || 0) - originY;
        var right = Math.min(innerLeft + container.clientWidth, screenRight) - (parseFloat(style.paddingRight) || 0) - originX;
        var bottom = Math.min(innerTop + container.clientHeight, screenBottom) - (parseFloat(style.paddingBottom) || 0) - originY;
        var fixed = document.documentElement.hasAttribute('data-fixed-canvas');
        var scale = Math.min(fixed ? 1 : MAX_SCALE, (right - left - 32) / (viewBox.width * metrics.scale),
          (bottom - top - 32) / (viewBox.height * metrics.scale));
        var fit = Number.isFinite(scale) && scale > 0 ? {
          scale: scale,
          x: (left + right) / 2 - (metrics.offsetX + viewBox.width * metrics.scale / 2) * scale,
          y: (top + bottom) / 2 - (metrics.offsetY + viewBox.height * metrics.scale / 2) * scale,
          mode: 'fit'
        } : null;
        return { fixed: fixed, metrics: metrics, originX: originX, originY: originY, left: left, top: top, right: right, bottom: bottom, fit: fit };
      }
      function readingAt(geometry) {
        var metrics = geometry.metrics;
        return {
          x: viewBox.x + (((geometry.left + geometry.right) / 2 - state.x) / state.scale - metrics.offsetX) / metrics.scale,
          y: viewBox.y + (((geometry.top + geometry.bottom) / 2 - state.y) / state.scale - metrics.offsetY) / metrics.scale,
          scale: state.scale * metrics.scale,
          mode: state.mode
        };
      }
      function restoreReading(reading, geometry) {
        var metrics = geometry.metrics;
        state = {
          scale: reading.scale / metrics.scale,
          x: (geometry.left + geometry.right) / 2 - ((reading.x - viewBox.x) * metrics.scale + metrics.offsetX) * reading.scale / metrics.scale,
          y: (geometry.top + geometry.bottom) / 2 - ((reading.y - viewBox.y) * metrics.scale + metrics.offsetY) * reading.scale / metrics.scale,
          mode: reading.mode
        };
      }
      function refreshGeometry() {
        var previous = canvasGeometry;
        var next = measureCanvas();
        // Reconstructing an SVG origin from its transformed DOMRect introduces
        // subpixel rounding. It is not a layout change or a new reading anchor.
        var changed = previous && next && (previous.fixed !== next.fixed ||
          Math.abs(previous.left - next.left) > 0.01 || Math.abs(previous.right - next.right) > 0.01 ||
          Math.abs(previous.top - next.top) > 0.01 || Math.abs(previous.bottom - next.bottom) > 0.01 ||
          previous.metrics.scale !== next.metrics.scale);
        if (changed && previous.fixed && !next.fixed && state.mode !== 'semantic' && state.mode !== 'fit') {
          fixedReading = readingAt(previous);
        }
        if (next && next.fixed && next.fit) {
          if (initialFraming || (changed && state.mode === 'fit')) {
            state = next.fit;
            initialFraming = false;
          } else if (changed && state.mode !== 'semantic') {
            var reading = !previous.fixed && fixedReading ? fixedReading : readingAt(previous);
            if (reading) {
              stopCameraMotion('layout', false);
              restoreReading(reading, next);
            }
          }
          fixedReading = null;
        }
        canvasGeometry = next;
        minimumScale = next && next.fit ? Math.min(MIN_SCALE, next.fit.scale) : MIN_SCALE;
      }
      function worldViewport() {
        var geometry = canvasGeometry;
        var metrics = geometry ? geometry.metrics : contentMetrics();
        if (!metrics) return null;
        var x;
        var y;
        var width;
        var height;
        if (mobileScrollMode()) {
          x = viewBox.x + container.scrollLeft / metrics.scale;
          y = viewBox.y;
          width = Math.min(viewBox.width, Math.max(1, container.clientWidth / metrics.scale));
          height = viewBox.height;
        } else {
          if (!geometry) return null;
          x = viewBox.x + (((geometry.left - state.x) / state.scale) - metrics.offsetX) / metrics.scale;
          y = viewBox.y + (((geometry.top - state.y) / state.scale) - metrics.offsetY) / metrics.scale;
          width = Math.max(0, geometry.right - geometry.left) / state.scale / metrics.scale;
          height = Math.max(0, geometry.bottom - geometry.top) / state.scale / metrics.scale;
        }
        return { x: x, y: y, width: width, height: height, scale: state.scale };
      }
      function logicalViewport() {
        var world = worldViewport();
        if (!world || !viewBox) return world;
        var left = Math.max(viewBox.x, world.x);
        var top = Math.max(viewBox.y, world.y);
        var right = Math.min(viewBox.x + viewBox.width, world.x + world.width);
        var bottom = Math.min(viewBox.y + viewBox.height, world.y + world.height);
        var intersects = right > left && bottom > top;
        return {
          x: intersects ? left : Math.max(viewBox.x, Math.min(viewBox.x + viewBox.width, world.x + world.width / 2)),
          y: intersects ? top : Math.max(viewBox.y, Math.min(viewBox.y + viewBox.height, world.y + world.height / 2)),
          width: intersects ? right - left : 0,
          height: intersects ? bottom - top : 0,
          scale: state.scale,
          outside: !intersects,
          world: world
        };
      }
      function renderPercent() {
        var percent = state.scale < 0.01 ? '<1%' : Math.round(state.scale * 100) + '%';
        if (resetPercentLabel && resetPercentLabel.textContent !== percent) resetPercentLabel.textContent = percent;
        return percent;
      }
      function renderControls() {
        var semantic = state.mode === 'semantic' && state.scale > 1.01;
        var detail = 'full';
        var percent = renderPercent();
        var controlKey = [state.mode, semantic, detail, percent].join('|');
        if (controlKey === lastControlKey) return;
        lastControlKey = controlKey;
        var detailHint = viewerText('viewer.nav.detail.full');
        var resolvedLevel = semantic ? viewerText('viewer.nav.level.auto') : '';
        var showDetailLevel = semantic;
        if (resetDetailLabel) {
          resetDetailLabel.textContent = resolvedLevel;
          resetDetailLabel.hidden = !showDetailLevel;
        }
        resetBtn.toggleAttribute('data-detail-visible', showDetailLevel);
        resetBtn.title = viewerText('viewer.nav.camera.title', {
          semantic: semantic ? viewerText('viewer.nav.camera.semantic') : '',
          hint: detailHint
        });
        resetBtn.setAttribute('aria-label', viewerText('viewer.nav.camera', { hint: detailHint }));
        resetBtn.setAttribute('data-detail-level', detail);
        container.setAttribute('data-detail-level', detail);
        container.setAttribute('data-camera-mode', state.mode);
        container.setAttribute('data-camera-indicator', semantic ? 'true' : 'false');
      }
      function clipToViewport(camera) {
        camera = camera || state;
        var fixed = document.documentElement.hasAttribute('data-fixed-canvas') && canvasGeometry;
        if (!fixed && camera.scale <= 1.001) {
          if (svg.style.clipPath) svg.style.removeProperty('clip-path');
          return;
        }
        var width = fixed ? canvasGeometry.metrics.width : (svg.clientWidth || 1);
        var height = fixed ? canvasGeometry.metrics.height : (svg.clientHeight || 1);
        var scale = camera.scale;
        var top = Math.max(0, Math.min(height, ((fixed ? canvasGeometry.top : 0) - camera.y) / scale));
        var left = Math.max(0, Math.min(width, ((fixed ? canvasGeometry.left : 0) - camera.x) / scale));
        var right = Math.max(0, Math.min(width, width - ((fixed ? canvasGeometry.right : width) - camera.x) / scale));
        var bottom = Math.max(0, Math.min(height, height - ((fixed ? canvasGeometry.bottom : height) - camera.y) / scale));
        var nextClip = 'inset(' + [top, right, bottom, left].map(function (value) {
          return Math.round(value * 1000) / 1000 + 'px';
        }).join(' ') + ')';
        if (svg.style.clipPath !== nextClip) svg.style.clipPath = nextClip;
      }
      function cameraSettled(rendered) {
        return Math.abs(rendered.scale - state.scale) < 0.001 &&
          Math.abs(rendered.x - state.x) < 0.05 &&
          Math.abs(rendered.y - state.y) < 0.05;
      }
      function syncViewportClip() {
        if (clipFrame) cancelAnimationFrame(clipFrame);
        clipFrame = 0;
        function sample() {
          clipFrame = 0;
          var rendered = sampleRenderedState();
          clipToViewport(rendered);
          if (!cameraSettled(rendered)) clipFrame = requestAnimationFrame(sample);
        }
        sample();
      }
      function apply(options) {
        options = options || {};
        if (options.interactive !== true) refreshGeometry();
        boundCamera();
        svg.style.transform = 'translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.scale + ')';
        var offsetLeft = options.interactive === true ? interactionMetrics.offsetLeft : (svg.offsetLeft || 0);
        var offsetTop = options.interactive === true ? interactionMetrics.offsetTop : (svg.offsetTop || 0);
        syncGrid(offsetLeft, offsetTop);
        if (options.interactive === true) {
          if (clipFrame) cancelAnimationFrame(clipFrame);
          clipFrame = 0;
          if (document.documentElement.hasAttribute('data-fixed-canvas')) clipToViewport(state);
          else svg.style.removeProperty('clip-path');
          renderPercent();
          if (Archify.radar && typeof Archify.radar.syncViewport === 'function') Archify.radar.syncViewport();
          return;
        }
        syncViewportClip();
        renderControls();
        outBtn.disabled = state.scale <= minimumScale;
        fitAllBtn.hidden = !directNavigationEnabled();
        fitAllBtn.disabled = !canvasGeometry || !canvasGeometry.fit;
        inBtn.disabled = state.scale >= MAX_SCALE;
        container.classList.toggle('is-pannable', directNavigationEnabled());
        svg.setAttribute('data-view-scale', String(state.scale));
        if (Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
        if (Archify.viewerChromeLayout && typeof Archify.viewerChromeLayout.schedule === 'function') {
          Archify.viewerChromeLayout.schedule();
        }
      }
      function syncGrid(offsetLeft, offsetTop) {
        offsetLeft = Number.isFinite(offsetLeft) ? offsetLeft : (svg.offsetLeft || 0);
        offsetTop = Number.isFinite(offsetTop) ? offsetTop : (svg.offsetTop || 0);
        container.style.setProperty('--archify-grid-x', (state.x + offsetLeft) + 'px');
        container.style.setProperty('--archify-grid-y', (state.y + offsetTop) + 'px');
        var fixed = document.documentElement.hasAttribute('data-fixed-canvas');
        if (gridScale === state.scale && gridFixed === fixed) return;
        gridScale = state.scale; gridFixed = fixed;
        var spacing = 24 * state.scale;
        var weight = 1;
        if (fixed) {
          // Nested world-space lattices share an origin. At a level boundary
          // the outgoing half-spacing layer is the incoming full-spacing one.
          spacing *= Math.pow(2, Math.ceil(Math.log2(1 / state.scale)));
          weight = 2 - spacing / 24;
        }
        container.style.setProperty('--archify-grid-minor', spacing + 'px');
        container.style.setProperty('--archify-grid-major', (5 * spacing) + 'px');
        container.style.setProperty('--archify-grid-weight', String(weight));
      }
      function scheduleInteractionApply() {
        if (interactionFrame) return;
        interactionFrame = requestAnimationFrame(function () {
          interactionFrame = 0;
          apply({ interactive: true });
        });
      }
      function captureInteractionGeometry() {
        refreshGeometry();
        interactionMetrics = {
          offsetLeft: svg.offsetLeft || 0,
          offsetTop: svg.offsetTop || 0
        };
        return container.getBoundingClientRect();
      }
      function flushInteractionApply() {
        if (!interactionFrame) return;
        cancelAnimationFrame(interactionFrame);
        interactionFrame = 0;
        apply({ interactive: true });
      }
      function settleInteraction() {
        flushInteractionApply();
        apply();
      }
      function keyboardDirectionActive() {
        return keyboardDirections.ArrowLeft || keyboardDirections.ArrowRight ||
          keyboardDirections.ArrowUp || keyboardDirections.ArrowDown;
      }
      function stopKeyboardPan() {
        if (keyboardFrame) cancelAnimationFrame(keyboardFrame);
        keyboardFrame = 0;
        keyboardStartedAt = 0;
        keyboardDirections = Object.create(null);
        keyboardShift = false;
        if (!container.classList.contains('is-keyboard-panning')) return;
        settleInteraction();
        container.classList.remove('is-keyboard-panning');
      }
      function stepKeyboardPan(timestamp) {
        keyboardFrame = 0;
        if (!keyboardDirectionActive()) {
          stopKeyboardPan();
          return;
        }
        var elapsed = keyboardStartedAt ? Math.min(32, timestamp - keyboardStartedAt) : 0;
        keyboardStartedAt = timestamp;
        var distance = (keyboardShift ? 1100 : 650) * elapsed / 1000;
        var horizontal = (keyboardDirections.ArrowLeft ? 1 : 0) - (keyboardDirections.ArrowRight ? 1 : 0);
        var vertical = (keyboardDirections.ArrowUp ? 1 : 0) - (keyboardDirections.ArrowDown ? 1 : 0);
        state.x += horizontal * distance;
        state.y += vertical * distance;
        state.mode = 'manual';
        apply({ interactive: true });
        keyboardFrame = requestAnimationFrame(stepKeyboardPan);
      }
      function startKeyboardPan() {
        if (container.classList.contains('is-keyboard-panning')) return;
        if (container.classList.contains('is-wheel-moving')) finishWheelGesture(true);
        interruptCamera('keyboard');
        captureInteractionGeometry();
        container.classList.add('is-keyboard-panning');
        keyboardStartedAt = 0;
        keyboardFrame = requestAnimationFrame(stepKeyboardPan);
      }
      function finishWheelGesture(commitPanTarget) {
        if (wheelTimer) clearTimeout(wheelTimer);
        wheelTimer = null;
        if (wheelPanFrame) cancelAnimationFrame(wheelPanFrame);
        wheelPanFrame = 0;
        wheelPanTimestamp = 0;
        if (commitPanTarget && wheelPanTarget) {
          state.x = wheelPanTarget.x;
          state.y = wheelPanTarget.y;
          state.mode = 'manual';
          apply({ interactive: true });
          try { getComputedStyle(svg).transform; } catch (_) {}
        }
        settleInteraction();
        container.classList.remove('is-wheel-moving');
        wheelGeometry = null;
        wheelMode = '';
        wheelPanTarget = null;
        wheelPanInputEnded = false;
        if (Archify.focus && Archify.focus.reposition) Archify.focus.reposition();
      }
      function stepWheelPan(timestamp) {
        wheelPanFrame = 0;
        if (!wheelPanTarget || wheelMode !== 'pan') return;
        var elapsed = wheelPanTimestamp ? Math.min(32, timestamp - wheelPanTimestamp) : 16.67;
        wheelPanTimestamp = timestamp;
        var blend = 1 - Math.exp(-elapsed / 35);
        state.x += (wheelPanTarget.x - state.x) * blend;
        state.y += (wheelPanTarget.y - state.y) * blend;
        state.mode = 'manual';
        var remaining = Math.abs(wheelPanTarget.x - state.x) + Math.abs(wheelPanTarget.y - state.y);
        if (wheelPanInputEnded && remaining < 0.25) {
          finishWheelGesture(true);
          return;
        }
        apply({ interactive: true });
        wheelPanFrame = requestAnimationFrame(stepWheelPan);
      }
      function scheduleWheelPan() {
        if (!wheelPanFrame) wheelPanFrame = requestAnimationFrame(stepWheelPan);
      }
      function sampleRenderedState() {
        var transform = '';
        try { transform = getComputedStyle(svg).transform || ''; } catch (_) {}
        var match = transform.match(/^matrix\(([^)]+)\)$/);
        if (!match) return { scale: state.scale, x: state.x, y: state.y, mode: state.mode };
        var values = match[1].split(',').map(Number);
        if (values.length !== 6 || !values.every(Number.isFinite)) {
          return { scale: state.scale, x: state.x, y: state.y, mode: state.mode };
        }
        return { scale: values[0], x: values[4], y: values[5], mode: state.mode };
      }
      function finishCameraTransaction(transaction, outcome) {
        if (!transaction || transaction.settled) return false;
        transaction.settled = true;
        transaction.state = outcome || 'complete';
        if (transaction.frame) cancelAnimationFrame(transaction.frame);
        if (transaction.timer) clearTimeout(transaction.timer);
        transaction.frame = null;
        transaction.timer = null;
        if (cameraTransaction === transaction) cameraTransaction = null;
        cameraFrame = null;
        cameraTimer = null;
        container.classList.remove('is-camera-moving');
        container.classList.remove('is-camera-transaction');
        container.removeAttribute('data-camera-transaction');
        if (Archify.focus && Archify.focus.reposition) Archify.focus.reposition();
        transaction.resolve({ id: transaction.id, state: transaction.state });
        return true;
      }
      function cameraReceipt(target, options) {
        var resolver;
        var transaction = {
          id: ++cameraGeneration,
          state: 'running',
          target: target,
          settled: false,
          frame: null,
          timer: null,
          finished: new Promise(function (resolve) { resolver = resolve; }),
          resolve: resolver,
          cancel: function (reason, commitTarget) {
            if (transaction.settled) return false;
            if (commitTarget && transaction.target) {
              if (Object.prototype.hasOwnProperty.call(transaction.target, 'scrollLeft')) {
                container.scrollLeft = transaction.target.scrollLeft;
              } else {
                state = {
                  scale: transaction.target.scale,
                  x: transaction.target.x,
                  y: transaction.target.y,
                  mode: transaction.target.mode
                };
                apply();
              }
            }
            return finishCameraTransaction(transaction, reason || 'cancelled');
          }
        };
        return transaction;
      }
      // New camera commands own the viewport; no earlier input loop may write it later.
      function cancelDirectInteraction() {
        if (Archify.radar && typeof Archify.radar.cancelPan === 'function') Archify.radar.cancelPan();
        if (interactionFrame) cancelAnimationFrame(interactionFrame);
        interactionFrame = 0;
        if (keyboardFrame) cancelAnimationFrame(keyboardFrame);
        keyboardFrame = 0;
        keyboardStartedAt = 0;
        keyboardDirections = Object.create(null);
        keyboardShift = false;
        if (wheelTimer) clearTimeout(wheelTimer);
        wheelTimer = null;
        if (wheelPanFrame) cancelAnimationFrame(wheelPanFrame);
        wheelPanFrame = 0;
        wheelPanTimestamp = 0;
        wheelGeometry = null;
        wheelMode = '';
        wheelPanTarget = null;
        wheelPanInputEnded = false;
        if (drag) {
          if (drag.moved && drag.button === 0) panClickPointer = drag.pointerId;
          try { container.releasePointerCapture(drag.pointerId); } catch (_) {}
          drag = null;
        }
        container.classList.remove('is-panning', 'is-keyboard-panning', 'is-wheel-moving');
      }
      function stopCameraMotion(reason, commitTarget) {
        cancelDirectInteraction();
        if (cameraTransaction && !cameraTransaction.settled) {
          cameraTransaction.cancel(reason || 'cancelled', commitTarget === true);
          return;
        }
        if (cameraTimer) clearTimeout(cameraTimer);
        if (cameraFrame) cancelAnimationFrame(cameraFrame);
        cameraTimer = null;
        cameraFrame = null;
        container.classList.remove('is-camera-moving');
        container.classList.remove('is-camera-transaction');
        container.removeAttribute('data-camera-transaction');
      }
      function interruptCamera(reason) {
        initialFraming = false;
        fixedReading = null;
        flushInteractionApply();
        var rendered = sampleRenderedState();
        stopCameraMotion(reason || 'manual', false);
        state = rendered;
        state.mode = 'manual';
        apply();
        renderControls();
        if (Archify.routeProbe && Archify.routeProbe.isJourneyPlaying && Archify.routeProbe.isJourneyPlaying()) {
          Archify.routeProbe.pauseJourney({ preserveElapsed: true, reason: reason || 'manual' });
        }
      }
      function zoomAtLocal(next, anchorX, anchorY, options) {
        options = options || {};
        if (options.manual !== false) interruptCamera();
        var previous = state.scale;
        next = Math.max(Math.min(minimumScale, previous), Math.min(MAX_SCALE, Number(next) || previous));
        if (options.discrete === true && previous >= MIN_SCALE && next >= MIN_SCALE) {
          next = Math.max(minimumScale, Math.round(next * 4) / 4);
        }
        if (next === previous) return;
        var contentX = (anchorX - state.x) / previous;
        var contentY = (anchorY - state.y) / previous;
        state.scale = next;
        state.x = anchorX - contentX * next;
        state.y = anchorY - contentY * next;
        if (options.defer === true) scheduleInteractionApply();
        else apply();
      }
      function zoomStep(direction) {
        return state.scale <= MIN_SCALE && minimumScale < MIN_SCALE
          ? state.scale * (direction > 0 ? 1.25 : 0.8)
          : state.scale + direction * 0.25;
      }
      function zoom(next, options) {
        options = options || {};
        options.discrete = true;
        refreshGeometry();
        var geometry = canvasGeometry;
        var centerX = geometry && geometry.fixed ? (geometry.left + geometry.right) / 2 : (svg.clientWidth || 1) / 2;
        var centerY = geometry && geometry.fixed ? (geometry.top + geometry.bottom) / 2 : (svg.clientHeight || 1) / 2;
        zoomAtLocal(next, centerX, centerY, options);
      }
      function zoomAt(next, clientX, clientY, options) {
        refreshGeometry();
        if (!canvasGeometry) return false;
        var anchorX = Number(clientX) - canvasGeometry.originX;
        var anchorY = Number(clientY) - canvasGeometry.originY;
        if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) return false;
        zoomAtLocal(next, anchorX, anchorY, options);
        return true;
      }
      function panBy(dx, dy, options) {
        options = options || {};
        dx = Number(dx);
        dy = Number(dy);
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || mobileScrollMode()) return false;
        if (options.manual !== false) interruptCamera();
        state.x += dx;
        state.y += dy;
        state.mode = 'manual';
        if (options.defer === true) scheduleInteractionApply();
        else apply();
        return true;
      }
      function fitAll(options) {
        if (!directNavigationEnabled()) return false;
        var geometry = measureCanvas();
        if (!geometry || !geometry.fit) return false;
        if (options && options.automatic === true) stopCameraMotion('fit-all', false);
        else interruptCamera('fit-all');
        state = geometry.fit;
        apply();
        return true;
      }
      function reset(options) {
        initialFraming = false;
        fixedReading = null;
        options = options || {};
        if (options.automatic !== true) interruptCamera();
        else stopCameraMotion('reset', false);
        state = { scale: 1, x: 0, y: 0, mode: 'overview' };
        apply();
      }
      function centerAt(logicalX, logicalY, options) {
        options = options || {};
        logicalX = Number(logicalX);
        logicalY = Number(logicalY);
        var metrics = options.defer === true && canvasGeometry ? canvasGeometry.metrics : contentMetrics();
        if (!metrics || !Number.isFinite(logicalX) || !Number.isFinite(logicalY)) return false;
        if (options.manual !== false) {
          interruptCamera('center');
          if (options.defer === true) captureInteractionGeometry();
        }
        if (mobileScrollMode()) {
          state.scale = 1;
          state.x = 0;
          state.y = 0;
          state.mode = 'manual';
          apply();
          var mobileTarget = (logicalX - viewBox.x) * metrics.scale - container.clientWidth / 2;
          mobileTarget = Math.max(0, Math.min(svg.clientWidth - container.clientWidth, mobileTarget));
          autoScrollUntil = Date.now() + 80;
          try { container.scrollTo({ left: mobileTarget, behavior: options.instant ? 'auto' : 'smooth' }); }
          catch (_) { container.scrollLeft = mobileTarget; }
          return true;
        }
        var requestedMinimum = Math.max(minimumScale, Math.min(MAX_SCALE, Number(options.minimumScale) || 1));
        var requestedScale = Number(options.scale);
        state.scale = options.preserveScale === true ? state.scale
          : Math.max(requestedMinimum, Math.min(MAX_SCALE, Number.isFinite(requestedScale) ? requestedScale : state.scale));
        var contentX = metrics.offsetX + (logicalX - viewBox.x) * metrics.scale;
        var contentY = metrics.offsetY + (logicalY - viewBox.y) * metrics.scale;
        state.x = (canvasGeometry ? (canvasGeometry.left + canvasGeometry.right) / 2 : metrics.width / 2) - contentX * state.scale;
        state.y = (canvasGeometry ? (canvasGeometry.top + canvasGeometry.bottom) / 2 : metrics.height / 2) - contentY * state.scale;
        state.mode = 'manual';
        if (options.defer === true) scheduleInteractionApply();
        else apply();
        if (options.defer !== true && Archify.focus && Archify.focus.reposition) Archify.focus.reposition();
        return true;
      }
      function semanticIds(ids, includeNeighbors) {
        var seeds = Object.create(null);
        var wanted = Object.create(null);
        (ids || []).forEach(function (id) { seeds[id] = true; wanted[id] = true; });
        if (includeNeighbors) {
          Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'), function (edge) {
            var from = edge.getAttribute('data-edge-from');
            var to = edge.getAttribute('data-edge-to');
            if (seeds[from] || seeds[to]) { wanted[from] = true; wanted[to] = true; }
          });
        }
        return wanted;
      }
      function boxesFor(ids, includeNeighbors) {
        var wanted = semanticIds(ids, includeNeighbors);
        return Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'))
          .filter(function (node) { return wanted[node.getAttribute('data-node-id')]; })
          .map(function (node) {
            try { return node.getBBox(); } catch (_) { return null; }
          })
          .filter(Boolean);
      }
      function frameDesktop(ids, options) {
        options = options || {};
        var boxes = boxesFor(ids, options.includeNeighbors === true);
        if (!boxes.length || !viewBox || viewBox.width <= 0 || viewBox.height <= 0) return false;
        var svgWidth = svg.clientWidth || 1;
        var svgHeight = svg.clientHeight || 1;
        var contentScale = Math.min(svgWidth / viewBox.width, svgHeight / viewBox.height);
        var contentOffsetX = (svgWidth - viewBox.width * contentScale) / 2;
        var contentOffsetY = (svgHeight - viewBox.height * contentScale) / 2;
        var minX = Math.min.apply(Math, boxes.map(function (box) { return box.x; }));
        var minY = Math.min.apply(Math, boxes.map(function (box) { return box.y; }));
        var maxX = Math.max.apply(Math, boxes.map(function (box) { return box.x + box.width; }));
        var maxY = Math.max.apply(Math, boxes.map(function (box) { return box.y + box.height; }));
        var bounds = {
          x: contentOffsetX + (minX - viewBox.x) * contentScale,
          y: contentOffsetY + (minY - viewBox.y) * contentScale,
          width: Math.max(1, (maxX - minX) * contentScale),
          height: Math.max(1, (maxY - minY) * contentScale)
        };
        var padding = options.padding || 48;
        var left = padding;
        var right = svgWidth - padding;
        var top = padding;
        var bottom = svgHeight - Math.max(padding, 72);
        var containerRect = container.getBoundingClientRect();
        var visibleTop = Math.max(0, -containerRect.top);
        var visibleBottom = Math.min(svgHeight, window.innerHeight - containerRect.top);
        if (visibleBottom - visibleTop >= 240) {
          top = Math.max(top, visibleTop + padding);
          bottom = Math.min(bottom, visibleBottom - Math.max(padding, 72));
        }
        var fixedCanvas = document.documentElement.hasAttribute('data-fixed-canvas');
        if (fixedCanvas) {
          var geometry = measureCanvas();
          if (geometry) {
            left = geometry.left + padding;
            right = geometry.right - padding;
            top = geometry.top + padding;
            bottom = geometry.bottom - padding;
          }
        }
        var chip = document.getElementById('focus-chip');
        if (chip && !chip.hidden) {
          var lensEnd = chip.offsetLeft + chip.offsetWidth + 24 - (svg.offsetLeft || 0);
          left = Math.max(left, Math.min(svgWidth * 0.42, lensEnd));
        }
        var routeReceipt = document.getElementById('route-probe');
        if (routeReceipt && !routeReceipt.hidden && routeReceipt.hasAttribute('data-route-journey')) {
          var receiptTop = routeReceipt.offsetTop;
          var receiptBottom = receiptTop + routeReceipt.offsetHeight;
          if (receiptTop < svgHeight / 2) top = Math.max(top, receiptBottom + 24);
          else bottom = Math.min(bottom, receiptTop - 24);
        }
        if (right <= left || bottom <= top) return false;
        var maxScale = options.maxScale || (options.includeNeighbors ? 1.9 : 2.15);
        var targetScale = Math.min((right - left) / bounds.width, (bottom - top) / bounds.height) * 0.9;
        targetScale = Math.min(maxScale, targetScale);
        // Fixed SVG units can exceed the visible stage. Keep sub-100% fits
        // precise, including selections whose fit is smaller than one percent.
        if (!fixedCanvas || targetScale >= 1) {
          targetScale = Math.max(1, targetScale);
          if (targetScale < 1.08) targetScale = 1;
          targetScale = Math.round(targetScale * 100) / 100;
        }
        var target = {
          scale: targetScale,
          x: 0,
          y: 0,
          mode: 'semantic'
        };
        target.x = (left + right) / 2 - (bounds.x + bounds.width / 2) * target.scale;
        target.y = (top + bottom) / 2 - (bounds.y + bounds.height / 2) * target.scale;
        var start = sampleRenderedState();
        stopCameraMotion('replaced', false);
        var transaction = cameraReceipt(target, options);
        cameraTransaction = transaction;
        var instant = options.instant === true || reducedMotion() || document.hidden;
        if (instant) {
          state = target;
          apply();
          finishCameraTransaction(transaction, reducedMotion() ? 'reduced-motion' : (document.hidden ? 'hidden' : 'complete'));
          return transaction;
        }
        var duration = Math.max(180, Math.min(520, Number(options.duration) || 420));
        var startedAt = 0;
        state = start;
        state.mode = 'semantic';
        apply();
        container.classList.add('is-camera-moving');
        container.classList.add('is-camera-transaction');
        container.setAttribute('data-camera-transaction', String(transaction.id));
        var step = function (timestamp) {
          if (cameraTransaction !== transaction || transaction.settled) return;
          if (!startedAt) startedAt = timestamp;
          var fraction = Math.max(0, Math.min(1, (timestamp - startedAt) / duration));
          var eased = 1 - Math.pow(1 - fraction, 3);
          state = {
            scale: start.scale + (target.scale - start.scale) * eased,
            x: start.x + (target.x - start.x) * eased,
            y: start.y + (target.y - start.y) * eased,
            mode: 'semantic'
          };
          apply();
          if (fraction < 1) {
            transaction.frame = requestAnimationFrame(step);
            cameraFrame = transaction.frame;
          } else {
            state = target;
            apply();
            finishCameraTransaction(transaction, 'complete');
          }
        };
        transaction.frame = requestAnimationFrame(step);
        cameraFrame = transaction.frame;
        return transaction;
      }
      function reveal(ids, options) {
        initialFraming = false;
        fixedReading = null;
        options = options || {};
        if (window.innerWidth > 720) return frameDesktop(ids, options);
        stopCameraMotion('replaced', false);
        state.scale = 1;
        state.x = 0;
        state.y = 0;
        state.mode = 'semantic';
        apply();
        if (!container.hasAttribute('data-wide-diagram')) {
          var contained = cameraReceipt({ scale: 1, x: 0, y: 0, mode: 'semantic' }, options);
          cameraTransaction = contained;
          finishCameraTransaction(contained, 'complete');
          return contained;
        }
        var boxes = boxesFor(ids, options.includeNeighbors === true);
        if (!boxes.length || !viewBox || viewBox.width <= 0) return false;
        var minX = Math.min.apply(Math, boxes.map(function (box) { return box.x; }));
        var maxX = Math.max.apply(Math, boxes.map(function (box) { return box.x + box.width; }));
        var center = (((minX + maxX) / 2 - viewBox.x) / viewBox.width) * (svg.clientWidth || 1);
        var target = Math.max(0, Math.min(svg.clientWidth - container.clientWidth, center - container.clientWidth / 2));
        var transaction = cameraReceipt({ scrollLeft: target }, options);
        cameraTransaction = transaction;
        var instant = options.instant === true || reducedMotion() || document.hidden;
        autoScrollUntil = Date.now() + (instant ? 50 : 470);
        try { container.scrollTo({ left: target, behavior: instant ? 'auto' : 'smooth' }); }
        catch (_) { container.scrollLeft = target; }
        if (instant) finishCameraTransaction(transaction, reducedMotion() ? 'reduced-motion' : (document.hidden ? 'hidden' : 'complete'));
        else {
          transaction.timer = setTimeout(function () { finishCameraTransaction(transaction, 'complete'); }, 460);
          cameraTimer = transaction.timer;
          container.classList.add('is-camera-moving');
          container.setAttribute('data-camera-transaction', String(transaction.id));
        }
        return transaction;
      }
      function syncSemantic() {
        var active = Archify.focus && typeof Archify.focus.active === 'function' ? Archify.focus.active() : null;
        if (typeof active === 'string') return reveal([active], { includeNeighbors: true, reason: 'focus-sync' });
        if (Array.isArray(active) && active.length) return reveal(active, { reason: 'selection-sync' });
        return false;
      }
      function pinControls() {
        container.style.setProperty('--archify-scroll-x', container.scrollLeft + 'px');
      }
      function syncNavigationDock() {
        if (!navigation) return;
        var rect = container.getBoundingClientRect();
        var margin = window.innerWidth <= 720 ? 8 : 16;
        var viewportEdge = window.innerHeight - margin;
        var wasDocked = navigation.hasAttribute('data-viewport-docked');
        var docked = !document.documentElement.hasAttribute('data-fixed-canvas') && !mobileScrollMode() && rect.top < viewportEdge &&
          (rect.bottom > viewportEdge || (wasDocked && rect.bottom > 0));
        var changed = wasDocked !== docked;
        navigation.toggleAttribute('data-viewport-docked', docked);
        if (docked) {
          var visibleRight = Math.min(rect.right, window.innerWidth);
          navigation.style.setProperty('--archify-nav-viewport-right', Math.max(margin, window.innerWidth - visibleRight + margin) + 'px');
        } else {
          navigation.style.removeProperty('--archify-nav-viewport-right');
        }
        if (changed && Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
      }
      function resetNavigationDockLatch() {
        if (!navigation) return;
        navigation.removeAttribute('data-viewport-docked');
        navigation.style.removeProperty('--archify-nav-viewport-right');
        syncNavigationDock();
      }
      function onScroll() {
        pinControls();
        if (Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
        if (window.innerWidth <= 720 && container.hasAttribute('data-wide-diagram') && Date.now() > autoScrollUntil) {
          interruptCamera();
        }
      }
      function onPointerEnd(event) {
        if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
        var pointerId = drag.pointerId;
        var moved = drag.moved;
        if (moved && drag.button === 0) panClickPointer = pointerId;
        drag = null;
        try { container.releasePointerCapture(pointerId); } catch (_) {}
        if (moved) settleInteraction();
        container.classList.remove('is-panning');
        if (moved) {
          suppressContextMenuUntil = Date.now() + 250;
          container.setAttribute('data-just-panned', 'true');
          setTimeout(function () { container.removeAttribute('data-just-panned'); }, 80);
        }
      }
      function releasePanKey() {
        spacePan = false;
        container.classList.remove('is-pan-ready');
        if (drag && drag.space) onPointerEnd({ pointerId: drag.pointerId });
      }
      function leaveCanvas() {
        releasePanKey();
        if (drag) onPointerEnd({ pointerId: drag.pointerId });
        stopKeyboardPan();
      }
      function cameraControlTarget(target) {
        return target.closest('.diagram-nav, .fixed-legend, .focus-chip, .node-finder, .diagram-guide, .overview-map, .route-probe, .semantic-lens');
      }
      function keyboardInputTarget(target) {
        return target && target.closest && target.closest('input, select, textarea, [contenteditable="true"]');
      }
      function diagramInViewport() {
        var rect = container.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
      }

      inBtn.addEventListener('click', function () { zoom(zoomStep(1)); });
      outBtn.addEventListener('click', function () { zoom(zoomStep(-1)); });
      resetBtn.addEventListener('click', reset);
      fitAllBtn.addEventListener('click', fitAll);
      if (document.documentElement.getAttribute('data-embed') !== 'true') {
        container.setAttribute('tabindex', '0');
        container.setAttribute('role', 'region');
        var heading = document.querySelector('h1');
        container.setAttribute('aria-label', heading ? heading.textContent : document.title);
      }
      container.addEventListener('pointerdown', function (event) {
        panClickPointer = null;
        var directPointerPan = (event.pointerType === 'touch' || event.pointerType === 'pen') && event.button === 0;
        var mousePan = event.button === 2 || event.button === 1 || (event.button === 0 && spacePan);
        if (!directNavigationEnabled() || (!mousePan && !directPointerPan) ||
            cameraControlTarget(event.target) || keyboardInputTarget(event.target) || event.target.closest('button, a')) return;
        event.preventDefault();
        try { container.focus({ preventScroll: true }); } catch (_) { container.focus(); }
        if (container.classList.contains('is-wheel-moving')) finishWheelGesture(true);
        stopKeyboardPan();
        interruptCamera();
        captureInteractionGeometry();
        drag = { pointerId: event.pointerId, button: event.button, space: event.button === 0 && spacePan, startX: event.clientX, startY: event.clientY, x: state.x, y: state.y, moved: false };
        container.classList.add('is-panning');
        try { container.setPointerCapture(event.pointerId); } catch (_) {}
      });
      container.addEventListener('pointermove', function (event) {
        if (!drag || drag.pointerId !== event.pointerId) return;
        var dx = event.clientX - drag.startX;
        var dy = event.clientY - drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        state.x = drag.x + dx;
        state.y = drag.y + dy;
        scheduleInteractionApply();
      });
      container.addEventListener('pointerup', onPointerEnd);
      container.addEventListener('pointercancel', onPointerEnd);
      container.addEventListener('lostpointercapture', onPointerEnd);
      container.addEventListener('click', function (event) {
        if (panClickPointer !== null && event.detail !== 0 && !cameraControlTarget(event.target)) {
          panClickPointer = null;
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      container.addEventListener('contextmenu', function (event) {
        // Some browsers open the menu on press, before the first pan movement.
        if (((drag && drag.button === 2) || Date.now() < suppressContextMenuUntil) && !cameraControlTarget(event.target)) event.preventDefault();
      });
      container.addEventListener('wheel', function (event) {
        if (!directNavigationEnabled() || cameraControlTarget(event.target)) return;
        event.preventDefault();
        try { container.focus({ preventScroll: true }); } catch (_) { container.focus(); }
        var nextWheelMode = event.ctrlKey || event.metaKey ? 'zoom' : 'pan';
        var startingWheel = !container.classList.contains('is-wheel-moving') || wheelMode !== nextWheelMode;
        if (startingWheel) {
          if (container.classList.contains('is-wheel-moving')) finishWheelGesture(true);
          stopKeyboardPan();
          interruptCamera('wheel');
          var rect = captureInteractionGeometry();
          wheelGeometry = {
            left: canvasGeometry ? canvasGeometry.originX : rect.left,
            top: canvasGeometry ? canvasGeometry.originY : rect.top
          };
          wheelMode = nextWheelMode;
          if (wheelMode === 'pan') {
            wheelPanTarget = { x: state.x, y: state.y };
            wheelPanTimestamp = 0;
          }
        }
        container.classList.add('is-wheel-moving');
        if (wheelTimer) clearTimeout(wheelTimer);
        if (wheelMode === 'zoom') {
          zoomAtLocal(state.scale * Math.exp(-event.deltaY * 0.002),
            event.clientX - wheelGeometry.left, event.clientY - wheelGeometry.top,
            { manual: false, defer: true });
          wheelTimer = setTimeout(function () { finishWheelGesture(false); }, 120);
        } else {
          var deltaFactor = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? container.clientHeight : 1);
          wheelPanTarget.x = boundPosition(wheelPanTarget.x - event.deltaX * deltaFactor);
          wheelPanTarget.y = boundPosition(wheelPanTarget.y - event.deltaY * deltaFactor);
          wheelPanInputEnded = false;
          scheduleWheelPan();
          wheelTimer = setTimeout(function () {
            wheelTimer = null;
            wheelPanInputEnded = true;
            scheduleWheelPan();
          }, 80);
        }
        if (startingWheel && wheelMode === 'zoom') flushInteractionApply();
      }, { passive: false });
      window.addEventListener('keydown', function (event) {
        var activeTarget = document.activeElement;
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || !directNavigationEnabled() ||
            drag || keyboardInputTarget(event.target) || activeTarget !== container || !diagramInViewport()) return;
        if (event.key === ' ') {
          event.preventDefault();
          spacePan = true;
          container.classList.add('is-pan-ready');
          return;
        }
        if (!/^Arrow(Left|Right|Up|Down)$/.test(event.key)) return;
        event.preventDefault();
        startKeyboardPan();
        keyboardDirections[event.key] = true;
        keyboardShift = event.shiftKey;
      });
      window.addEventListener('keyup', function (event) {
        if (event.key === ' ') releasePanKey();
        if (event.key === 'Shift') keyboardShift = false;
        if (!/^Arrow(Left|Right|Up|Down)$/.test(event.key)) return;
        delete keyboardDirections[event.key];
        keyboardShift = event.shiftKey;
        if (!keyboardDirectionActive()) stopKeyboardPan();
      });
      window.addEventListener('blur', leaveCanvas);
      container.addEventListener('blur', leaveCanvas);
      container.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('scroll', function () {
        refreshGeometry();
        syncNavigationDock();
        if (Archify.radar) Archify.radar.sync();
      }, { passive: true });
      window.addEventListener('afterprint', function () {
        requestAnimationFrame(function () {
          requestAnimationFrame(resetNavigationDockLatch);
        });
      });
      function onGeometryChange() {
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(function () {
          resizeFrame = 0;
          syncNavigationDock();
          if (state.mode === 'fit') fitAll({ automatic: true });
          else if (state.mode === 'semantic') syncSemantic();
          else apply();
        });
      }
      if (window.ResizeObserver) new ResizeObserver(onGeometryChange).observe(container);
      window.addEventListener('resize', onGeometryChange);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', onGeometryChange);
        window.visualViewport.addEventListener('scroll', onGeometryChange);
      }
      window.addEventListener('hashchange', function () { requestAnimationFrame(syncSemantic); });
      if (Archify.viewerChromeLayout && Archify.viewerChromeLayout.measure) Archify.viewerChromeLayout.measure();
      apply();
      pinControls();
      requestAnimationFrame(syncNavigationDock);
      requestAnimationFrame(syncSemantic);

      return {
        zoomIn: function () { zoom(zoomStep(1)); },
        zoomOut: function () { zoom(zoomStep(-1)); },
        zoomAt: zoomAt,
        panBy: panBy,
        fit: reset,
        fitAll: fitAll,
        reset: reset,
        reveal: reveal,
        centerAt: centerAt,
        settle: settleInteraction,
        logicalViewport: logicalViewport,
        worldViewport: worldViewport,
        sync: syncSemantic,
        state: function () { return { scale: state.scale, x: state.x, y: state.y, mode: state.mode }; }
      };
    })();
