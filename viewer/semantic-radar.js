    /* ============================================================
       Semantic Radar — simplified semantic bounds + live viewport.
       The radar is built at runtime so the checked artifact still contains
       one canonical SVG block, and export serialization remains untouched.
       ============================================================ */
    Archify.radar = (function () {
      var container = document.querySelector('.diagram-container');
      var diagram = container.querySelector(':scope > svg');
      var panel = document.getElementById('overview-map');
      var panelHead = panel.querySelector('.overview-map-head');
      var surface = document.getElementById('overview-map-surface');
      var status = document.getElementById('overview-map-status');
      var trigger = document.getElementById('btn-overview-map');
      var closeBtn = document.getElementById('overview-map-close');
      var expandBtn = document.getElementById('overview-map-expand');
      var feedback = document.getElementById('overview-map-feedback');
      var navigation = container.querySelector('.diagram-nav');
      var passport = document.getElementById('focus-chip');
      var namespace = 'http://www.w3.org/2000/svg';
      var viewBox = diagram.viewBox && diagram.viewBox.baseVal;
      var mapSvg = document.createElementNS(namespace, 'svg');
      var nodeLayer = document.createElementNS(namespace, 'g');
      var viewport = document.createElementNS(namespace, 'rect');
      var nodes = [];
      var viewportDrag = null;
      var panelDrag = null;
      var manualPosition = null;
      var lastPlacement = null;
      var requestedOpen = false;
      var passportYielded = false;
      var passportPreviousAriaHidden = null;
      var syncFrame = 0;
      var spaceRetryTimer = 0;
      var spaceRetryCount = 0;
      var placementGap = 16;

      mapSvg.setAttribute('role', 'group');
      mapSvg.setAttribute('aria-label', viewerText('viewer.radar.nodes'));
      mapSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      nodeLayer.setAttribute('class', 'overview-map-nodes');
      viewport.setAttribute('class', 'overview-map-viewport');
      viewport.setAttribute('rx', '3');
      viewport.setAttribute('ry', '3');
      mapSvg.appendChild(nodeLayer);
      mapSvg.appendChild(viewport);
      surface.appendChild(mapSvg);

      function nodeLabel(node, fallback) {
        return node.getAttribute('data-node-label') ||
          (node.getAttribute('aria-label') || fallback).replace(/^Focus\s+/, '').split(',')[0];
      }
      function build() {
        if (!viewBox || viewBox.width <= 0 || viewBox.height <= 0) return false;
        mapSvg.setAttribute('viewBox', [viewBox.x, viewBox.y, viewBox.width, viewBox.height].join(' '));
        nodeLayer.textContent = '';
        nodes = [];
        Array.prototype.forEach.call(diagram.querySelectorAll('[data-node-id]'), function (node) {
          var box;
          try { box = node.getBBox(); } catch (_) { box = null; }
          if (!box || box.width <= 0 || box.height <= 0) return;
          var id = node.getAttribute('data-node-id');
          var rect = document.createElementNS(namespace, 'rect');
          rect.setAttribute('class', 'overview-map-node');
          rect.setAttribute('x', String(box.x));
          rect.setAttribute('y', String(box.y));
          rect.setAttribute('width', String(Math.max(3, box.width)));
          rect.setAttribute('height', String(Math.max(3, box.height)));
          rect.setAttribute('rx', String(Math.max(2, Math.min(8, Math.min(box.width, box.height) * 0.1))));
          rect.setAttribute('data-radar-node-id', id);
          rect.setAttribute('data-kind', node.getAttribute('data-node-kind') || 'neutral');
          rect.setAttribute('tabindex', '0');
          rect.setAttribute('role', 'button');
          rect.setAttribute('aria-label', viewerText('viewer.radar.focus', { label: nodeLabel(node, id) }));
          nodeLayer.appendChild(rect);
          nodes.push({ id: id, node: node, rect: rect });
        });
        status.textContent = viewerText('viewer.radar.fullMap', { count: nodes.length });
        return true;
      }
      function visibleRect(element) {
        if (!element || element.hidden) return null;
        var rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return null;
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
      }
      function panelRectAt(position) {
        return {
          left: position.left,
          top: position.top,
          right: position.left + panel.offsetWidth,
          bottom: position.top + panel.offsetHeight,
          width: panel.offsetWidth,
          height: panel.offsetHeight
        };
      }
      function rectsIntersect(first, second, gap) {
        gap = Number(gap) || 0;
        return first.left < second.right + gap &&
          first.right > second.left - gap &&
          first.top < second.bottom + gap &&
          first.bottom > second.top - gap;
      }
      function intersectionArea(first, second) {
        var width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
        var height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
        return width * height;
      }
      function clamp(value, minimum, maximum) {
        if (maximum < minimum) return minimum;
        return Math.max(minimum, Math.min(maximum, value));
      }
      function placementContext() {
        var containerRect = visibleRect(container);
        if (!containerRect) return null;
        var controlRect = visibleRect(navigation);
        var left = Math.max(placementGap, containerRect.left + placementGap);
        var top = Math.max(placementGap, containerRect.top + placementGap);
        var right = Math.min(window.innerWidth - placementGap, containerRect.right - placementGap);
        var bottom = Math.min(window.innerHeight - placementGap, containerRect.bottom - placementGap);
        if (controlRect) bottom = Math.min(bottom, controlRect.top - placementGap);
        var lens = document.getElementById('focus-chip');
        var lensRect = visibleRect(lens);
        var legendRect = visibleRect(diagram.querySelector('[data-legend]'));
        var active = diagram.querySelector('[data-focus-selected]');
        var activeRect = visibleRect(active);
        return {
          bounds: { left: left, top: top, right: right, bottom: bottom },
          hardBlockers: [lensRect, controlRect, legendRect].filter(Boolean),
          softBlockers: [activeRect].filter(Boolean),
          preferredSide: !activeRect || activeRect.left + activeRect.width / 2 > window.innerWidth / 2 ? 'left' : 'right'
        };
      }
      function positionIsValid(position, context) {
        if (!position || !context) return false;
        var rect = panelRectAt(position);
        var bounds = context.bounds;
        if (rect.left < bounds.left || rect.top < bounds.top || rect.right > bounds.right || rect.bottom > bounds.bottom) return false;
        return context.hardBlockers.every(function (blocker) { return !rectsIntersect(rect, blocker, placementGap); });
      }
      function cornerCandidates(context) {
        var bounds = context.bounds;
        var left = bounds.left;
        var right = Math.max(left, bounds.right - panel.offsetWidth);
        var top = bounds.top;
        var bottom = Math.max(top, bounds.bottom - panel.offsetHeight);
        var preferredLeft = context.preferredSide === 'left' ? left : right;
        var alternateLeft = context.preferredSide === 'left' ? right : left;
        return [
          { left: preferredLeft, top: bottom },
          { left: alternateLeft, top: bottom },
          { left: preferredLeft, top: top },
          { left: alternateLeft, top: top }
        ].filter(function (candidate, index, all) {
          return all.findIndex(function (other) { return other.left === candidate.left && other.top === candidate.top; }) === index;
        });
      }
      function nearbyCandidates(context, reference) {
        var bounds = context.bounds;
        var maximumLeft = bounds.right - panel.offsetWidth;
        var maximumTop = bounds.bottom - panel.offsetHeight;
        var requested = reference ? {
          left: clamp(reference.left, bounds.left, maximumLeft),
          top: clamp(reference.top, bounds.top, maximumTop)
        } : null;
        var horizontal = [bounds.left, maximumLeft];
        var vertical = [bounds.top, maximumTop];
        if (requested) {
          horizontal.push(requested.left);
          vertical.push(requested.top);
        }
        context.hardBlockers.forEach(function (blocker) {
          horizontal.push(
            blocker.left - placementGap - panel.offsetWidth,
            blocker.right + placementGap
          );
          vertical.push(
            blocker.top - placementGap - panel.offsetHeight,
            blocker.bottom + placementGap
          );
        });
        horizontal = horizontal.map(function (left) { return clamp(left, bounds.left, maximumLeft); });
        vertical = vertical.map(function (top) { return clamp(top, bounds.top, maximumTop); });
        var candidates = [];
        horizontal.forEach(function (left) {
          vertical.forEach(function (top) { candidates.push({ left: left, top: top }); });
        });
        return candidates.filter(function (candidate, index, all) {
          return all.findIndex(function (other) { return other.left === candidate.left && other.top === candidate.top; }) === index;
        });
      }
      function placementScore(position, context, reference, softWeight) {
        var rect = panelRectAt(position);
        var referenceLeft = reference ? reference.left : (context.preferredSide === 'left' ? context.bounds.left : context.bounds.right - panel.offsetWidth);
        var referenceTop = reference ? reference.top : context.bounds.bottom - panel.offsetHeight;
        var distance = Math.pow(position.left - referenceLeft, 2) + Math.pow(position.top - referenceTop, 2);
        var softOverlap = context.softBlockers.reduce(function (total, blocker) { return total + intersectionArea(rect, blocker); }, 0);
        return distance + softOverlap * softWeight;
      }
      function chooseRadarPlacement(context, reference, options) {
        options = options || {};
        var softWeight = Number.isFinite(options.softWeight) ? options.softWeight : 100;
        var candidates = nearbyCandidates(context, reference).concat(cornerCandidates(context));
        var valid = candidates.filter(function (candidate) { return positionIsValid(candidate, context); });
        valid.sort(function (first, second) {
          return placementScore(first, context, reference, softWeight) - placementScore(second, context, reference, softWeight);
        });
        return valid.length ? valid[0] : null;
      }
      function applyPlacement(position, remember) {
        var useLeft = position.left + panel.offsetWidth / 2 <= window.innerWidth / 2;
        panel.setAttribute('data-docked', 'true');
        panel.setAttribute('data-dock-side', useLeft ? 'left' : 'right');
        if (useLeft) {
          panel.style.setProperty('--archify-radar-left', Math.round(position.left) + 'px');
          panel.style.removeProperty('--archify-radar-right');
        } else {
          panel.style.setProperty('--archify-radar-right', Math.round(window.innerWidth - position.left - panel.offsetWidth) + 'px');
          panel.style.removeProperty('--archify-radar-left');
        }
        panel.style.setProperty('--archify-radar-top', Math.round(position.top) + 'px');
        if (remember !== false) lastPlacement = { left: position.left, top: position.top };
      }
      function resetDockingStyles() {
        panel.removeAttribute('data-docked');
        panel.removeAttribute('data-dock-side');
        panel.removeAttribute('data-panel-dragging');
        panel.removeAttribute('data-placement-invalid');
        panel.removeAttribute('data-placement-degraded');
        panel.removeAttribute('data-placement-unavailable');
        panel.removeAttribute('data-compact');
        panel.removeAttribute('title');
        panel.style.removeProperty('visibility');
        panel.style.removeProperty('--archify-radar-right');
        panel.style.removeProperty('--archify-radar-left');
        panel.style.removeProperty('--archify-radar-top');
      }
      function updateDocking() {
        var options = arguments[0] || {};
        if (panel.hidden) return false;
        if (panelDrag) return true;
        panel.removeAttribute('data-compact');
        panel.removeAttribute('data-placement-degraded');
        panel.removeAttribute('data-placement-invalid');
        panel.removeAttribute('data-placement-unavailable');
        panel.removeAttribute('title');
        panel.style.removeProperty('visibility');
        var context = placementContext();
        if (!context) {
          resetDockingStyles();
          return false;
        }
        var reference = manualPosition || lastPlacement;
        var placementOptions = { softWeight: manualPosition ? 0 : 100 };
        var placement = manualPosition && positionIsValid(manualPosition, context)
          ? manualPosition
          : chooseRadarPlacement(context, reference, placementOptions);
        var compact = false;
        if (!placement && options.allowCompact !== false) {
          compact = true;
          panel.setAttribute('data-compact', 'true');
          panel.setAttribute('data-placement-degraded', 'true');
          panel.setAttribute('title', viewerText('viewer.radar.compacted'));
          context = placementContext();
          placement = chooseRadarPlacement(context, reference, placementOptions);
        }
        if (!placement) {
          resetDockingStyles();
          panel.setAttribute('data-placement-unavailable', 'true');
          return false;
        }
        if (manualPosition && !compact) manualPosition = { left: placement.left, top: placement.top };
        applyPlacement(placement, true);
        return true;
      }
      function clearSpaceRetry() {
        if (spaceRetryTimer) window.clearTimeout(spaceRetryTimer);
        spaceRetryTimer = 0;
      }
      function yieldPassport() {
        if (!passport || passport.hidden || passportYielded) return passportYielded;
        passportPreviousAriaHidden = passport.getAttribute('aria-hidden');
        passportYielded = true;
        passport.setAttribute('data-radar-yielded', 'true');
        passport.setAttribute('aria-hidden', 'true');
        return true;
      }
      function restorePassport() {
        if (!passport || !passportYielded) return;
        passportYielded = false;
        passport.removeAttribute('data-radar-yielded');
        if (passportPreviousAriaHidden === null) passport.removeAttribute('aria-hidden');
        else passport.setAttribute('aria-hidden', passportPreviousAriaHidden);
        passportPreviousAriaHidden = null;
      }
      function reflectVisible() {
        panel.hidden = false;
        panel.removeAttribute('data-placement-unavailable');
        trigger.setAttribute('aria-expanded', 'true');
        trigger.removeAttribute('data-radar-space-limited');
        trigger.setAttribute('aria-label', viewerText('viewer.radar.close'));
        trigger.title = viewerText('viewer.nav.radar.title');
        feedback.hidden = true;
      }
      function scheduleSpaceRetry() {
        if (!requestedOpen || spaceRetryTimer || spaceRetryCount >= 4) return;
        spaceRetryCount += 1;
        spaceRetryTimer = window.setTimeout(function () {
          spaceRetryTimer = 0;
          attemptRequestedOpen();
        }, 60);
      }
      function reflectUnavailable() {
        restorePassport();
        panel.hidden = true;
        panel.setAttribute('data-placement-unavailable', 'true');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', viewerText('viewer.radar.cancelWaiting'));
        trigger.setAttribute('data-radar-space-limited', 'true');
        trigger.title = viewerText('viewer.radar.needsSpace');
        feedback.hidden = false;
        scheduleSpaceRetry();
      }
      function attemptRequestedOpen(options) {
        options = options || {};
        if (!requestedOpen) return false;
        panel.hidden = false;
        if (!updateDocking(options)) {
          reflectUnavailable();
          return false;
        }
        clearSpaceRetry();
        spaceRetryCount = 0;
        reflectVisible();
        sync();
        if (options.focus === true && !panel.hasAttribute('data-compact')) surface.focus();
        return true;
      }
      function expandCompactRadar() {
        if (!requestedOpen || panel.hidden || !panel.hasAttribute('data-compact')) return false;
        yieldPassport();
        if (!updateDocking({ allowCompact: false })) {
          restorePassport();
          if (!updateDocking()) {
            reflectUnavailable();
            return false;
          }
        }
        reflectVisible();
        sync();
        if (!panel.hasAttribute('data-compact')) surface.focus();
        return !panel.hasAttribute('data-compact');
      }
      function syncNow() {
        syncFrame = 0;
        if (panel.hidden || !Archify.view || typeof Archify.view.logicalViewport !== 'function') return;
        if (!updateDocking()) {
          reflectUnavailable();
          return;
        }
        if (passportYielded && panel.hasAttribute('data-compact')) {
          restorePassport();
          if (!updateDocking()) {
            reflectUnavailable();
            return;
          }
        }
        reflectVisible();
        var visible = Archify.view.logicalViewport();
        if (!visible) return;
        viewport.setAttribute('x', String(visible.x));
        viewport.setAttribute('y', String(visible.y));
        viewport.setAttribute('width', String(visible.width));
        viewport.setAttribute('height', String(visible.height));
        var full = visible.width >= viewBox.width * 0.98 && visible.height >= viewBox.height * 0.98;
        var mobileWide = window.innerWidth <= 720 && container.hasAttribute('data-wide-diagram');
        var viewportCopy = full
          ? viewerText('viewer.radar.viewport.full')
          : (mobileWide
            ? viewerText('viewer.radar.viewport.width', { percent: Math.round(visible.width / viewBox.width * 100) })
            : viewerText('viewer.radar.viewport.scale', { percent: Math.round(visible.scale * 100) }));
        status.textContent = viewerText('viewer.radar.status', { count: nodes.length, viewport: viewportCopy });
        nodes.forEach(function (item) {
          var active = item.node.hasAttribute('data-focus-selected') ||
            item.node.getAttribute('data-story-beat-state') === 'active';
          if (active) item.rect.setAttribute('data-radar-active', 'true');
          else item.rect.removeAttribute('data-radar-active');
        });
      }
      function sync() {
        if (requestedOpen && panel.hidden) {
          attemptRequestedOpen();
          return;
        }
        if (syncFrame) return;
        syncFrame = requestAnimationFrame(syncNow);
      }
      function setOpen(next, options) {
        options = options || {};
        next = Boolean(next);
        if (next && Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (next && Archify.semanticLens && Archify.semanticLens.isOpen()) {
          Archify.semanticLens.close({ restoreFocus: false });
        }
        requestedOpen = next;
        if (next) {
          clearSpaceRetry();
          spaceRetryCount = 0;
          build();
          attemptRequestedOpen(options);
        } else {
          clearSpaceRetry();
          spaceRetryCount = 0;
          viewportDrag = null;
          panelDrag = null;
          container.classList.remove('is-panning');
          panel.hidden = true;
          resetDockingStyles();
          restorePassport();
          feedback.hidden = true;
          trigger.setAttribute('aria-expanded', 'false');
          trigger.removeAttribute('data-radar-space-limited');
          trigger.setAttribute('aria-label', viewerText('viewer.nav.radar'));
          trigger.title = viewerText('viewer.nav.radar.title');
          if (options.restoreFocus === true) trigger.focus();
        }
        return next;
      }
      function toggle() { return setOpen(!requestedOpen, { focus: false }); }
      function close(options) { return setOpen(false, options); }
      function bringNodeIntoWindow(node) {
        var delay = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 540;
        window.setTimeout(function () {
          var rect = node.getBoundingClientRect();
          var safeTop = 64;
          var safeBottom = window.innerHeight - 64;
          if (rect.top >= safeTop && rect.bottom <= safeBottom) return;
          var top = Math.max(0, window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2);
          try { window.scrollTo({ top: top, behavior: delay ? 'smooth' : 'auto' }); }
          catch (_) { window.scrollTo(0, top); }
        }, delay);
      }
      function focusNode(id) {
        var main = diagram.querySelector('[data-node-id="' + id + '"]');
        if (!main) return false;
        if (Archify.guidedViews && typeof Archify.guidedViews.showAll === 'function') {
          Archify.guidedViews.showAll({ clearFocus: false, updateUrl: false });
        }
        if (Archify.focus && typeof Archify.focus.set === 'function') {
          Archify.focus.set(id, { toggle: false });
        }
        if (Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'radar' });
        }
        bringNodeIntoWindow(main);
        try { main.focus({ preventScroll: true }); } catch (_) { try { main.focus(); } catch (_) {} }
        sync();
        return true;
      }
      function diagramPoint(event) {
        var matrix = mapSvg.getScreenCTM();
        if (!matrix) return null;
        var point = mapSvg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        return point.matrixTransform(matrix.inverse());
      }
      function navigate(event) {
        var point = diagramPoint(event);
        if (!point || !Archify.view || typeof Archify.view.centerAt !== 'function') return;
        Archify.view.centerAt(point.x, point.y, { minimumScale: 1.5, instant: true });
        sync();
      }
      function endViewportDrag(event) {
        if (!viewportDrag) return;
        viewportDrag = null;
        panel.removeAttribute('data-dragging');
        container.classList.remove('is-panning');
        try { surface.releasePointerCapture(event.pointerId); } catch (_) {}
      }
      function beginPanelDrag(event) {
        if (event.button !== 0 || event.target.closest('button, a, input, [role="button"]')) return;
        var context = placementContext();
        if (!context) return;
        var rect = panel.getBoundingClientRect();
        event.preventDefault();
        event.stopPropagation();
        panelDrag = {
          pointerId: event.pointerId,
          originX: event.clientX,
          originY: event.clientY,
          start: { left: rect.left, top: rect.top },
          current: { left: rect.left, top: rect.top },
          previousManual: manualPosition ? { left: manualPosition.left, top: manualPosition.top } : null
        };
        panel.setAttribute('data-panel-dragging', 'true');
        try { panelHead.setPointerCapture(event.pointerId); } catch (_) {}
      }
      function movePanelDrag(event) {
        if (!panelDrag || panelDrag.pointerId !== event.pointerId) return;
        var context = placementContext();
        if (!context) return;
        event.preventDefault();
        event.stopPropagation();
        var bounds = context.bounds;
        var position = {
          left: clamp(panelDrag.start.left + event.clientX - panelDrag.originX, bounds.left, bounds.right - panel.offsetWidth),
          top: clamp(panelDrag.start.top + event.clientY - panelDrag.originY, bounds.top, bounds.bottom - panel.offsetHeight)
        };
        panelDrag.current = position;
        if (positionIsValid(position, context)) panel.removeAttribute('data-placement-invalid');
        else panel.setAttribute('data-placement-invalid', 'true');
        applyPlacement(position, false);
      }
      function finishPanelDrag(event, cancel) {
        if (!panelDrag || panelDrag.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        var activeDrag = panelDrag;
        panelDrag = null;
        panel.removeAttribute('data-panel-dragging');
        panel.removeAttribute('data-placement-invalid');
        try { panelHead.releasePointerCapture(event.pointerId); } catch (_) {}
        var context = placementContext();
        if (!context) return;
        if (cancel) {
          manualPosition = activeDrag.previousManual;
          lastPlacement = { left: activeDrag.start.left, top: activeDrag.start.top };
          updateDocking();
          return;
        }
        var requested = activeDrag.current;
        manualPosition = { left: requested.left, top: requested.top };
        updateDocking();
      }

      trigger.addEventListener('click', toggle);
      closeBtn.addEventListener('click', function () { close({ restoreFocus: true }); });
      expandBtn.addEventListener('click', expandCompactRadar);
      panelHead.addEventListener('pointerdown', beginPanelDrag);
      panelHead.addEventListener('pointermove', movePanelDrag);
      panelHead.addEventListener('pointerup', function (event) { finishPanelDrag(event, false); });
      panelHead.addEventListener('pointercancel', function (event) { finishPanelDrag(event, true); });
      surface.addEventListener('pointerdown', function (event) {
        if (event.button !== 0 || event.target.closest('[data-radar-node-id]')) return;
        event.preventDefault();
        viewportDrag = { pointerId: event.pointerId };
        panel.setAttribute('data-dragging', 'true');
        container.classList.add('is-panning');
        try { surface.setPointerCapture(event.pointerId); } catch (_) {}
        navigate(event);
      });
      surface.addEventListener('pointermove', function (event) {
        if (!viewportDrag || viewportDrag.pointerId !== event.pointerId) return;
        navigate(event);
      });
      surface.addEventListener('pointerup', endViewportDrag);
      surface.addEventListener('pointercancel', endViewportDrag);
      surface.addEventListener('click', function (event) {
        var node = event.target.closest('[data-radar-node-id]');
        if (node) focusNode(node.getAttribute('data-radar-node-id'));
      });
      surface.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close({ restoreFocus: true });
          return;
        }
        var node = event.target.closest('[data-radar-node-id]');
        if (node && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          focusNode(node.getAttribute('data-radar-node-id'));
          return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        var visible = Archify.view && Archify.view.logicalViewport ? Archify.view.logicalViewport() : null;
        if (!visible) return;
        event.preventDefault();
        var x = visible.x + visible.width / 2;
        var y = visible.y + visible.height / 2;
        var stepX = Math.max(12, visible.width * 0.24);
        var stepY = Math.max(12, visible.height * 0.24);
        if (event.key === 'ArrowLeft') x -= stepX;
        else if (event.key === 'ArrowRight') x += stepX;
        else if (event.key === 'ArrowUp') y -= stepY;
        else y += stepY;
        Archify.view.centerAt(x, y, { minimumScale: 1.5, instant: true });
        sync();
      });
      document.addEventListener('keydown', function (event) {
        if (!panelDrag || event.key !== 'Escape') return;
        finishPanelDrag({
          pointerId: panelDrag.pointerId,
          preventDefault: function () { event.preventDefault(); },
          stopPropagation: function () { event.stopPropagation(); }
        }, true);
      }, true);
      function reflow() {
        if (!requestedOpen) return;
        clearSpaceRetry();
        spaceRetryCount = 0;
        sync();
      }
      window.addEventListener('resize', reflow);
      window.addEventListener('scroll', reflow, { passive: true });
      if (typeof ResizeObserver === 'function') {
        var radarResizeObserver = new ResizeObserver(function (entries) {
          if (!requestedOpen) return;
          if (panel.hidden && entries.every(function (entry) { return entry.target === panel; })) return;
          reflow();
        });
        [container, navigation, document.getElementById('focus-chip'), panel].filter(Boolean).forEach(function (element) {
          radarResizeObserver.observe(element);
        });
      }
      requestAnimationFrame(build);

      return {
        open: function () { return setOpen(true); },
        close: close,
        toggle: toggle,
        sync: sync,
        focus: focusNode,
        isOpen: function () { return requestedOpen; },
        count: function () { return nodes.length; }
      };
    })();