    /* ============================================================
       Route Probe — shortest directed path over compiled semantics.
       The graph is read from renderer-owned stable IDs and relationship
       endpoints. BFS order follows authored DOM edge order, so equal-length
       choices are deterministic without adding weights or a graph runtime.
       ============================================================ */
    Archify.routeProbe = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector(':scope > svg');
      var trigger = document.getElementById('btn-route-probe');
      var panel = document.getElementById('route-probe');
      var title = document.getElementById('route-probe-title');
      var path = document.getElementById('route-probe-path');
      var status = document.getElementById('route-probe-status');
      var findBtn = document.getElementById('route-probe-find');
      var copyBtn = document.getElementById('route-probe-copy');
      var clearBtn = document.getElementById('route-probe-clear');
      var journeyControls = document.getElementById('route-journey-controls');
      var journeyPrevBtn = document.getElementById('route-journey-prev');
      var journeyPlayBtn = document.getElementById('route-journey-play');
      var journeyPlayIcon = document.getElementById('route-journey-play-icon');
      var journeyPlayLabel = document.getElementById('route-journey-play-label');
      var journeyNextBtn = document.getElementById('route-journey-next');
      var journeyOverviewBtn = document.getElementById('route-journey-overview');
      var namespace = 'http://www.w3.org/2000/svg';
      var mode = 'idle';
      var startId = null;
      var endId = null;
      var activeNodeIds = [];
      var activeEdges = [];
      var journeyIndex = -1;
      var journeyPlaying = false;
      var journeyComplete = false;
      var journeyGeneration = 0;
      var journeyTimer = null;
      var journeyStartedAt = 0;
      var journeyElapsedMs = 0;
      var journeyOwnerToken = 0;
      var JOURNEY_DWELL_MS = 1100;

      function nodes() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
      }
      function edges() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'));
      }
      function nodesById() {
        var out = Object.create(null);
        nodes().forEach(function (node) { out[node.getAttribute('data-node-id')] = node; });
        return out;
      }
      function nodeLabel(node, fallback) {
        return node.getAttribute('data-node-label') ||
          (node.getAttribute('aria-label') || fallback).replace(/^Focus\s+/, '').split(',')[0];
      }
      function exportSnapshot() {
        if (mode !== 'result' || activeNodeIds.length < 2 || activeEdges.length !== activeNodeIds.length - 1) return null;
        var allNodes = nodes();
        var byId = nodesById();
        var seenNodeIds = Object.create(null);
        var seenEdgeKeys = Object.create(null);
        if (startId !== activeNodeIds[0] || endId !== activeNodeIds[activeNodeIds.length - 1] ||
            activeNodeIds.some(function (id) {
              if (seenNodeIds[id] || allNodes.filter(function (node) {
                return node.getAttribute('data-node-id') === id;
              }).length !== 1) return true;
              seenNodeIds[id] = true;
              return !byId[id];
            }) ||
            activeEdges.some(function (edge, index) {
              if (!edge || !svg.contains(edge)) return true;
              var edgeKey = edge.getAttribute('data-edge-key');
              var edgeId = edge.getAttribute('data-edge-id') || '';
              if (!edgeKey || seenEdgeKeys[edgeKey]) return true;
              seenEdgeKeys[edgeKey] = true;
              var fragments = Array.prototype.slice.call(svg.querySelectorAll('[data-edge-key]')).filter(function (candidate) {
                return candidate.getAttribute('data-edge-key') === edgeKey;
              });
              var drawableFragments = fragments.filter(hasDrawableGeometry);
              return !fragments.length || !fragments.every(function (fragment) {
                return fragment.getAttribute('data-edge-from') === activeNodeIds[index] &&
                  fragment.getAttribute('data-edge-to') === activeNodeIds[index + 1] &&
                  (fragment.getAttribute('data-edge-id') || '') === edgeId;
              }) || drawableFragments.length !== 1 || drawableFragments[0] !== edge ||
                edge.getAttribute('data-edge-from') !== activeNodeIds[index] ||
                edge.getAttribute('data-edge-to') !== activeNodeIds[index + 1];
            })) return null;
        return {
          source: { id: startId, label: nodeLabel(byId[startId], startId) },
          target: { id: endId, label: nodeLabel(byId[endId], endId) },
          nodeIds: activeNodeIds.slice(),
          hops: activeEdges.length,
          edges: activeEdges.map(function (edge) {
            return {
              key: edge.getAttribute('data-edge-key'),
              id: edge.getAttribute('data-edge-id') || '',
              from: edge.getAttribute('data-edge-from'),
              to: edge.getAttribute('data-edge-to'),
              label: edge.getAttribute('data-edge-label') || ''
            };
          })
        };
      }
      function edgeShapes(edge) {
        if (/^(path|line|polyline)$/i.test(edge.tagName)) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }
      function removeOverlay() {
        Array.prototype.forEach.call(svg.querySelectorAll('[data-route-probe-overlay]'), function (overlay) {
          overlay.remove();
        });
      }
      function removeJourneyPulse(options) {
        options = options || {};
        Array.prototype.forEach.call(svg.querySelectorAll('[data-route-journey-overlay]'), function (overlay) {
          overlay.remove();
        });
        if (journeyOwnerToken && options.release !== false && Archify.motionGovernor) {
          var token = journeyOwnerToken;
          journeyOwnerToken = 0;
          Archify.motionGovernor.release(token);
        }
      }
      function stopJourneyTimer(options) {
        options = options || {};
        journeyGeneration += 1;
        if (journeyTimer) {
          if (options.preserveElapsed === true && journeyStartedAt) {
            journeyElapsedMs = Math.min(JOURNEY_DWELL_MS, journeyElapsedMs + Math.max(0, Date.now() - journeyStartedAt));
          }
          window.clearTimeout(journeyTimer);
        }
        journeyTimer = null;
        journeyStartedAt = 0;
        if (options.preserveElapsed !== true) journeyElapsedMs = 0;
      }
      function clearJourneyPresentation(options) {
        options = options || {};
        removeJourneyPulse();
        svg.removeAttribute('data-route-journey');
        panel.removeAttribute('data-route-journey');
        nodes().forEach(function (node) {
          node.removeAttribute('data-route-journey-state');
          node.removeAttribute('data-route-journey-current');
        });
        edges().forEach(function (edge) {
          edge.removeAttribute('data-route-journey-state');
          edge.removeAttribute('data-route-journey-current');
        });
        Array.prototype.forEach.call(path.querySelectorAll('[data-route-journey-index]'), function (button, index) {
          button.removeAttribute('data-route-journey-state');
          button.removeAttribute('aria-current');
          button.setAttribute('tabindex', index === 0 ? '0' : '-1');
        });
        if (options.keepControls !== true) journeyControls.hidden = true;
        journeyControls.setAttribute('data-playing', 'false');
      }
      function resetJourneyState() {
        stopJourneyTimer();
        journeyPlaying = false;
        journeyComplete = false;
        journeyIndex = -1;
        clearJourneyPresentation();
      }
      function cleanSvgState() {
        resetJourneyState();
        svg.removeAttribute('data-route-picking');
        svg.removeAttribute('data-route-active');
        removeOverlay();
        nodes().forEach(function (node) {
          node.removeAttribute('data-route-match');
          node.removeAttribute('data-route-start');
          node.removeAttribute('data-route-end');
          node.removeAttribute('data-route-step');
          node.removeAttribute('data-route-candidate');
          node.style.removeProperty('--route-step');
        });
        edges().forEach(function (edge) {
          edge.removeAttribute('data-route-match');
          edge.removeAttribute('data-route-step');
          edge.style.removeProperty('--route-step');
        });
        panel.removeAttribute('data-route-dock');
      }
      function replaceRouteHash(value) {
        try {
          history.replaceState(null, '', location.pathname + location.search + (value ? '#route=' + value : ''));
        } catch (_) {}
      }
      function renderPlaceholder(copy) {
        path.textContent = '';
        var placeholder = document.createElement('span');
        placeholder.className = 'route-probe-placeholder';
        placeholder.textContent = copy;
        path.appendChild(placeholder);
      }
      function renderPath(ids, options) {
        options = options || {};
        var byId = nodesById();
        path.textContent = '';
        ids.forEach(function (id, index) {
          if (index) {
            var arrow = document.createElement('span');
            arrow.className = 'route-probe-arrow';
            arrow.setAttribute('aria-hidden', 'true');
            arrow.textContent = '\u2192';
            path.appendChild(arrow);
          }
          var item = document.createElement(options.interactive === true ? 'button' : 'span');
          if (options.interactive === true) {
            item.type = 'button';
            item.setAttribute('data-route-journey-index', String(index));
            item.setAttribute('data-route-node-id', id);
            item.setAttribute('tabindex', index === 0 ? '0' : '-1');
            item.setAttribute('aria-label', viewerText('viewer.route.position', {
              index: index + 1,
              total: ids.length,
              label: nodeLabel(byId[id], id)
            }));
          }
          item.className = 'route-probe-node';
          item.textContent = nodeLabel(byId[id], id);
          item.title = nodeLabel(byId[id], id) + ' · ' + id;
          if (index === 0) item.setAttribute('data-endpoint', 'start');
          if (index === ids.length - 1 && ids.length > 1) item.setAttribute('data-endpoint', 'end');
          path.appendChild(item);
        });
      }
      function setTrigger(active) {
        trigger.setAttribute('aria-pressed', active ? 'true' : 'false');
        trigger.setAttribute('aria-label', viewerText(active ? 'viewer.route.trigger.clear' : 'viewer.guide.route.aria'));
      }
      function clear(options) {
        options = options || {};
        var wasActive = mode !== 'idle';
        if (Archify.finder && Archify.finder.isOpen() && typeof Archify.finder.context === 'function' && Archify.finder.context().indexOf('route-') === 0) {
          Archify.finder.close({ restoreFocus: false });
        }
        mode = 'idle';
        startId = null;
        endId = null;
        activeNodeIds = [];
        activeEdges = [];
        cleanSvgState();
        panel.hidden = true;
        panel.setAttribute('data-state', 'idle');
        panel.removeAttribute('data-finder-open');
        title.textContent = viewerText('viewer.route.start');
        renderPlaceholder(viewerText('viewer.route.pickTwo'));
        status.textContent = viewerText('viewer.route.instructions');
        findBtn.hidden = true;
        findBtn.textContent = viewerText('viewer.route.start.find');
        findBtn.setAttribute('aria-label', viewerText('viewer.route.start.find.aria'));
        copyBtn.hidden = true;
        copyBtn.textContent = viewerText('viewer.route.copy');
        if (Archify.exportMenu && typeof Archify.exportMenu.syncRouteShare === 'function') Archify.exportMenu.syncRouteShare();
        setTrigger(false);
        if (wasActive && options.preserveView !== true && Archify.view && typeof Archify.view.reset === 'function') {
          Archify.view.reset({ automatic: true });
        }
        if (options.updateUrl !== false) replaceRouteHash('');
        if (options.restoreFocus === true) trigger.focus();
      }
      function outgoingByNode() {
        var byId = nodesById();
        var outgoing = {};
        edges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          if (!byId[from] || !byId[to] || from === to) return;
          if (!outgoing[from]) outgoing[from] = [];
          outgoing[from].push({ edge: edge, to: to });
        });
        return outgoing;
      }
      function reachableFrom(source) {
        var outgoing = outgoingByNode();
        var reached = {};
        var queue = [source];
        reached[source] = true;
        for (var cursor = 0; cursor < queue.length; cursor += 1) {
          var links = outgoing[queue[cursor]] || [];
          links.forEach(function (link) {
            if (reached[link.to]) return;
            reached[link.to] = true;
            queue.push(link.to);
          });
        }
        return reached;
      }
      function hopDistancesFrom(source) {
        var outgoing = outgoingByNode();
        var distances = {};
        var queue = [source];
        distances[source] = 0;
        for (var cursor = 0; cursor < queue.length; cursor += 1) {
          var links = outgoing[queue[cursor]] || [];
          links.forEach(function (link) {
            if (Object.prototype.hasOwnProperty.call(distances, link.to)) return;
            distances[link.to] = distances[queue[cursor]] + 1;
            queue.push(link.to);
          });
        }
        return distances;
      }
      function shortestDirectedPath(source, target) {
        if (source === target) return null;
        var outgoing = outgoingByNode();
        var previous = {};
        var queue = [source];
        previous[source] = null;
        for (var cursor = 0; cursor < queue.length && !Object.prototype.hasOwnProperty.call(previous, target); cursor += 1) {
          var links = outgoing[queue[cursor]] || [];
          links.some(function (link) {
            if (Object.prototype.hasOwnProperty.call(previous, link.to)) return false;
            previous[link.to] = { from: queue[cursor], edge: link.edge };
            queue.push(link.to);
            return link.to === target;
          });
        }
        if (!Object.prototype.hasOwnProperty.call(previous, target)) return null;
        var nodeIds = [target];
        var routeEdges = [];
        var current = target;
        while (current !== source) {
          var step = previous[current];
          if (!step) return null;
          routeEdges.unshift(step.edge);
          nodeIds.unshift(step.from);
          current = step.from;
        }
        return { nodes: nodeIds, edges: routeEdges };
      }
      function traceGeometry(shape, step) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-labelledby');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.removeAttribute('data-route-match');
        clone.removeAttribute('data-route-step');
        clone.setAttribute('class', 'route-probe-flow');
        clone.setAttribute('pathLength', '1');
        clone.style.setProperty('--route-step', String(step));
        return clone;
      }
      function renderOverlay(routeEdges) {
        removeOverlay();
        if (!routeEdges.length) return;
        var overlay = document.createElementNS(namespace, 'g');
        overlay.setAttribute('class', 'route-probe-overlay');
        overlay.setAttribute('data-route-probe-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        routeEdges.forEach(function (edge, step) {
          var wrapper = document.createElementNS(namespace, 'g');
          if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
          edgeShapes(edge).forEach(function (shape) { wrapper.appendChild(traceGeometry(shape, step)); });
          if (wrapper.childNodes.length) overlay.appendChild(wrapper);
        });
        var firstNode = svg.querySelector('[data-node-id]');
        if (firstNode) svg.insertBefore(overlay, firstNode);
        else svg.appendChild(overlay);
      }
      function journeyButtons() {
        return Array.prototype.slice.call(path.querySelectorAll('[data-route-journey-index]'));
      }
      function journeyMotionAllowed() {
        return html.getAttribute('data-embed') !== 'true' &&
          !document.hidden &&
          Archify.motionGovernor &&
          Archify.motionGovernor.capable === true &&
          !Archify.motionGovernor.isPaused();
      }
      function routeOverviewStatus() {
        return viewerText('viewer.route.overview.status', {
          nodes: viewerCount('viewer.route.overview.node', activeNodeIds.length),
          hops: viewerCount('viewer.route.overview.hop', activeEdges.length)
        });
      }
      function centerJourneyButton(button) {
        if (!button) return;
        var target = button.offsetLeft - Math.max(0, (path.clientWidth - button.offsetWidth) / 2);
        path.scrollLeft = Math.max(0, target);
      }
      function focusJourneyButton(index) {
        var buttons = journeyButtons();
        if (!buttons.length) return false;
        var next = Math.max(0, Math.min(buttons.length - 1, index));
        buttons.forEach(function (button, buttonIndex) {
          button.setAttribute('tabindex', buttonIndex === next ? '0' : '-1');
        });
        try { buttons[next].focus({ preventScroll: true }); } catch (_) { buttons[next].focus(); }
        centerJourneyButton(buttons[next]);
        return true;
      }
      function renderJourneyControls() {
        var hasRoute = mode === 'result' && activeNodeIds.length > 1;
        var canPlay = hasRoute && journeyMotionAllowed();
        journeyControls.hidden = !hasRoute;
        journeyControls.setAttribute('data-playing', journeyPlaying ? 'true' : 'false');
        journeyPrevBtn.disabled = !hasRoute || journeyIndex <= 0;
        journeyNextBtn.disabled = !hasRoute || journeyIndex >= activeNodeIds.length - 1;
        journeyOverviewBtn.disabled = !hasRoute || journeyIndex < 0;
        journeyPlayBtn.disabled = !canPlay;
        journeyPlayBtn.setAttribute('aria-pressed', journeyPlaying ? 'true' : 'false');
        if (journeyPlaying) {
          journeyPlayIcon.textContent = '\u275a\u275a';
          journeyPlayLabel.textContent = viewerText('viewer.route.pause.label');
          journeyPlayBtn.setAttribute('aria-label', viewerText('viewer.route.pause'));
          journeyPlayBtn.title = viewerText('viewer.route.pause');
        } else if (journeyComplete || journeyIndex === activeNodeIds.length - 1) {
          journeyPlayIcon.textContent = '\u21bb';
          journeyPlayLabel.textContent = viewerText('viewer.route.replay.label');
          journeyPlayBtn.setAttribute('aria-label', viewerText('viewer.route.replay'));
          journeyPlayBtn.title = viewerText(canPlay ? 'viewer.route.replay' : 'viewer.route.motionRequired');
        } else {
          journeyPlayIcon.textContent = '\u25b6';
          journeyPlayLabel.textContent = viewerText('viewer.route.journey');
          journeyPlayBtn.setAttribute('aria-label', viewerText('viewer.route.play'));
          journeyPlayBtn.title = viewerText(canPlay ? 'viewer.route.play' : 'viewer.route.motionRequired');
        }
      }
      function journeyGeometry(shape) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-labelledby');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.removeAttribute('data-route-match');
        clone.removeAttribute('data-route-step');
        clone.removeAttribute('data-route-journey-state');
        clone.removeAttribute('data-route-journey-current');
        clone.setAttribute('class', 'route-journey-flow');
        clone.setAttribute('pathLength', '1');
        return clone;
      }
      function renderJourneyPulse(edge) {
        removeJourneyPulse();
        if (!edge || !journeyMotionAllowed()) return false;
        var overlay = document.createElementNS(namespace, 'g');
        overlay.setAttribute('class', 'route-journey-overlay');
        overlay.setAttribute('data-route-journey-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        var wrapper = document.createElementNS(namespace, 'g');
        if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
        edgeShapes(edge).forEach(function (shape) { wrapper.appendChild(journeyGeometry(shape)); });
        if (!wrapper.childNodes.length) return false;
        overlay.appendChild(wrapper);
        var firstNode = svg.querySelector('[data-node-id]');
        if (firstNode) svg.insertBefore(overlay, firstNode);
        else svg.appendChild(overlay);
        if (Archify.motionGovernor && Archify.motionGovernor.capable) {
          var token = 0;
          token = Archify.motionGovernor.claim('route', function () {
            if (journeyOwnerToken === token) journeyOwnerToken = 0;
            removeJourneyPulse({ release: false });
          });
          journeyOwnerToken = token;
        }
        overlay.addEventListener('animationend', function () {
          if (overlay.isConnected) removeJourneyPulse();
        }, { once: true });
        window.setTimeout(function () {
          if (overlay.isConnected) removeJourneyPulse();
        }, 860);
        return true;
      }
      function applyJourneyState(index, options) {
        options = options || {};
        if (mode !== 'result' || !activeNodeIds.length) return false;
        var byId = nodesById();
        journeyIndex = Math.max(0, Math.min(activeNodeIds.length - 1, index));
        removeJourneyPulse();
        svg.setAttribute('data-route-journey', (journeyIndex + 1) + '/' + activeNodeIds.length);
        panel.setAttribute('data-route-journey', String(journeyIndex));
        activeNodeIds.forEach(function (id, step) {
          var node = byId[id];
          if (!node) return;
          var state = step < journeyIndex ? 'past' : (step === journeyIndex ? 'current' : 'future');
          node.setAttribute('data-route-journey-state', state);
          if (step === journeyIndex) node.setAttribute('data-route-journey-current', '');
          else node.removeAttribute('data-route-journey-current');
        });
        activeEdges.forEach(function (edge, step) {
          var destination = step + 1;
          var state = destination < journeyIndex ? 'past' : (destination === journeyIndex ? 'current' : 'future');
          edge.setAttribute('data-route-journey-state', state);
          if (destination === journeyIndex) edge.setAttribute('data-route-journey-current', '');
          else edge.removeAttribute('data-route-journey-current');
        });
        var buttons = journeyButtons();
        buttons.forEach(function (button, step) {
          var state = step < journeyIndex ? 'past' : (step === journeyIndex ? 'current' : 'future');
          button.setAttribute('data-route-journey-state', state);
          button.setAttribute('tabindex', step === journeyIndex ? '0' : '-1');
          if (step === journeyIndex) button.setAttribute('aria-current', 'step');
          else button.removeAttribute('aria-current');
        });
        if (options.center !== false) centerJourneyButton(buttons[journeyIndex]);
        var phase = viewerText(journeyPlaying
          ? 'viewer.route.phase.playing'
          : journeyComplete
            ? 'viewer.route.phase.complete'
            : 'viewer.route.phase.inspecting');
        status.textContent = viewerText('viewer.route.step', {
          index: journeyIndex + 1,
          total: activeNodeIds.length,
          phase: phase,
          label: nodeLabel(byId[activeNodeIds[journeyIndex]], activeNodeIds[journeyIndex])
        });
        if (options.pulse === true && journeyIndex > 0) renderJourneyPulse(activeEdges[journeyIndex - 1]);
        if (options.reveal !== false && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal(activeNodeIds.slice(Math.max(0, journeyIndex - 1), Math.min(activeNodeIds.length, journeyIndex + 2)), {
            includeNeighbors: false,
            reason: 'route-journey',
            maxScale: 1.65,
            padding: 64,
            duration: 360,
            instant: !journeyMotionAllowed()
          });
        }
        renderJourneyControls();
        requestDocking();
        return true;
      }
      function pauseJourney(options) {
        options = options || {};
        if (!journeyPlaying && options.complete !== true) {
          renderJourneyControls();
          return false;
        }
        stopJourneyTimer({ preserveElapsed: options.complete !== true && options.preserveElapsed !== false });
        journeyPlaying = false;
        journeyComplete = options.complete === true;
        if (journeyComplete) journeyElapsedMs = 0;
        removeJourneyPulse();
        if (journeyIndex >= 0) applyJourneyState(journeyIndex, { center: false, pulse: false, reveal: false });
        else renderJourneyControls();
        return true;
      }
      function selectJourneyIndex(index) {
        if (mode !== 'result') return false;
        stopJourneyTimer();
        journeyPlaying = false;
        journeyComplete = false;
        return applyJourneyState(index, { pulse: true, reveal: true });
      }
      function showJourneyOverview(options) {
        options = options || {};
        if (mode !== 'result') return false;
        stopJourneyTimer();
        journeyPlaying = false;
        journeyComplete = false;
        journeyIndex = -1;
        clearJourneyPresentation({ keepControls: true });
        status.textContent = routeOverviewStatus();
        renderJourneyControls();
        if (options.reveal !== false && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal(activeNodeIds, { includeNeighbors: false, reason: 'route', instant: !journeyMotionAllowed() });
        }
        requestDocking();
        return true;
      }
      function scheduleJourney() {
        if (!journeyPlaying || !journeyMotionAllowed()) {
          pauseJourney({ preserveElapsed: true });
          return false;
        }
        var generation = ++journeyGeneration;
        var remaining = Math.max(0, JOURNEY_DWELL_MS - journeyElapsedMs);
        journeyStartedAt = Date.now();
        journeyTimer = window.setTimeout(function () {
          if (generation !== journeyGeneration || !journeyPlaying) return;
          journeyTimer = null;
          journeyStartedAt = 0;
          journeyElapsedMs = 0;
          if (journeyIndex >= activeNodeIds.length - 1) {
            pauseJourney({ complete: true, preserveElapsed: false });
            return;
          }
          applyJourneyState(journeyIndex + 1, { pulse: true, reveal: true });
          // Camera and motion-owner handoff are allowed to synchronously
          // settle the previous step. The new step always starts with a fresh
          // dwell; never carry cleanup time into the next scheduler lease.
          journeyElapsedMs = 0;
          journeyStartedAt = 0;
          scheduleJourney();
        }, remaining);
        return true;
      }
      function playJourney() {
        if (mode !== 'result' || activeNodeIds.length < 2 || !journeyMotionAllowed()) {
          renderJourneyControls();
          return false;
        }
        if (journeyPlaying) return true;
        if (journeyComplete || journeyIndex >= activeNodeIds.length - 1) {
          journeyIndex = -1;
          journeyElapsedMs = 0;
          journeyComplete = false;
        }
        journeyPlaying = true;
        if (journeyIndex < 0) applyJourneyState(0, { pulse: false, reveal: true });
        else applyJourneyState(journeyIndex, { center: false, pulse: false, reveal: false });
        scheduleJourney();
        return true;
      }
      function toggleJourney() {
        return journeyPlaying ? pauseJourney({ preserveElapsed: true }) : playJourney();
      }
      function previousJourney() {
        return selectJourneyIndex(Math.max(0, journeyIndex < 0 ? 0 : journeyIndex - 1));
      }
      function nextJourney() {
        return selectJourneyIndex(Math.min(activeNodeIds.length - 1, journeyIndex + 1));
      }
      function overlapArea(a, b) {
        var width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        var height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return width * height;
      }
      function updateDocking() {
        if (panel.hidden) {
          panel.removeAttribute('data-route-dock');
          return;
        }
        var containerRect = container.getBoundingClientRect();
        var width = panel.offsetWidth;
        var height = panel.offsetHeight;
        if (!width || !height) return;
        var currentRect = panel.getBoundingClientRect();
        var left = currentRect.left;
        var topCandidate = {
          left: left,
          right: left + width,
          top: containerRect.top + 8,
          bottom: containerRect.top + 8 + height
        };
        var nav = container.querySelector('.diagram-nav');
        var navRect = nav ? nav.getBoundingClientRect() : null;
        var bottom = navRect ? navRect.top - 9 : containerRect.bottom - 8;
        var bottomCandidate = {
          left: left,
          right: left + width,
          top: bottom - height,
          bottom: bottom
        };
        var byId = nodesById();
        var relevant = activeNodeIds.length ? activeNodeIds : (startId ? [startId] : []);
        var blockers = relevant.map(function (id) { return byId[id]; }).filter(Boolean).map(function (node) {
          return node.getBoundingClientRect();
        });
        function score(candidate) {
          var value = blockers.reduce(function (sum, rect) { return sum + overlapArea(candidate, rect); }, 0);
          if (navRect) value += overlapArea(candidate, navRect) * 4;
          if (candidate.top < containerRect.top || candidate.bottom > containerRect.bottom) value += 1000000;
          return value;
        }
        if (score(topCandidate) <= score(bottomCandidate)) panel.setAttribute('data-route-dock', 'top');
        else panel.setAttribute('data-route-dock', 'bottom');
      }
      function requestDocking() {
        requestAnimationFrame(updateDocking);
        window.setTimeout(updateDocking, 120);
        window.setTimeout(updateDocking, 560);
      }
      function chooseStart(id) {
        var byId = nodesById();
        if (!byId[id]) return false;
        cleanSvgState();
        startId = id;
        endId = null;
        mode = 'target';
        var reached = reachableFrom(id);
        byId[id].setAttribute('data-route-start', '');
        byId[id].setAttribute('data-route-match', '');
        Object.keys(reached).forEach(function (candidateId) {
          if (candidateId !== id && byId[candidateId]) byId[candidateId].setAttribute('data-route-candidate', '');
        });
        svg.setAttribute('data-route-picking', 'target');
        panel.setAttribute('data-state', 'target');
        title.textContent = viewerText('viewer.route.destination', { label: nodeLabel(byId[id], id) });
        renderPath([id]);
        var count = Math.max(0, Object.keys(reached).length - 1);
        status.textContent = count
          ? viewerCount('viewer.route.destination.count', count)
          : viewerText('viewer.route.noOutgoing');
        findBtn.hidden = false;
        findBtn.textContent = viewerText('viewer.route.destination.find');
        findBtn.setAttribute('aria-label', viewerText('viewer.route.destination.find.aria'));
        requestDocking();
        return true;
      }
      function showResult(result, options) {
        options = options || {};
        var byId = nodesById();
        cleanSvgState();
        mode = 'result';
        startId = result.nodes[0];
        endId = result.nodes[result.nodes.length - 1];
        activeNodeIds = result.nodes.slice();
        activeEdges = result.edges.slice();
        result.nodes.forEach(function (id, step) {
          var node = byId[id];
          if (!node) return;
          node.setAttribute('data-route-match', '');
          node.setAttribute('data-route-step', String(step));
          node.style.setProperty('--route-step', String(step));
          if (step === 0) node.setAttribute('data-route-start', '');
          if (step === result.nodes.length - 1) node.setAttribute('data-route-end', '');
        });
        result.edges.forEach(function (edge, step) {
          edge.setAttribute('data-route-match', '');
          edge.setAttribute('data-route-step', String(step));
          edge.style.setProperty('--route-step', String(step));
        });
        svg.setAttribute('data-route-active', startId + '~' + endId);
        renderOverlay(result.edges);
        renderPath(result.nodes, { interactive: true });
        panel.setAttribute('data-state', 'result');
        panel.hidden = false;
        title.textContent = viewerText('viewer.route.result.title', {
          source: nodeLabel(byId[startId], startId),
          target: nodeLabel(byId[endId], endId)
        });
        findBtn.hidden = true;
        copyBtn.hidden = false;
        setTrigger(true);
        if (Archify.exportMenu && typeof Archify.exportMenu.syncRouteShare === 'function') Archify.exportMenu.syncRouteShare();
        if (options.updateUrl !== false) {
          replaceRouteHash(encodeURIComponent(startId) + '~' + encodeURIComponent(endId));
        }
        showJourneyOverview({ reveal: false });
        if (Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal(result.nodes, { includeNeighbors: false, reason: 'route' });
        }
        return true;
      }
      function choose(id, options) {
        options = options || {};
        var byId = nodesById();
        if (!byId[id]) return false;
        if (mode === 'source') return chooseStart(id);
        if (mode !== 'target') return false;
        if (id === startId) {
          panel.setAttribute('data-state', 'error');
          title.textContent = viewerText('viewer.route.differentDestination');
          status.textContent = viewerText('viewer.route.distinct');
          return false;
        }
        var result = shortestDirectedPath(startId, id);
        if (!result) {
          panel.setAttribute('data-state', 'error');
          title.textContent = viewerText('viewer.route.unreachable', { label: nodeLabel(byId[id], id) });
          status.textContent = viewerText('viewer.route.unreachable.detail', {
            target: nodeLabel(byId[id], id),
            source: nodeLabel(byId[startId], startId)
          });
          return false;
        }
        return showResult(result, options);
      }
      function begin(options) {
        options = options || {};
        if (html.getAttribute('data-embed') === 'true') return false;
        if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (Archify.semanticLens && Archify.semanticLens.active()) {
          Archify.semanticLens.clear({ updateUrl: false, preserveView: true, closePanel: true });
        }
        var focused = options.source || (Archify.focus && typeof Archify.focus.active === 'function' ? Archify.focus.active() : null);
        if (Array.isArray(focused)) focused = null;
        clear({ updateUrl: false, preserveView: true, restoreFocus: false });
        if (Archify.intentTrace && typeof Archify.intentTrace.clear === 'function') Archify.intentTrace.clear({ announce: false });
        if (Archify.guidedViews && typeof Archify.guidedViews.showAll === 'function') {
          Archify.guidedViews.showAll({ clearFocus: false, updateUrl: false });
        }
        if (Archify.focus && typeof Archify.focus.clear === 'function') {
          Archify.focus.clear({ updateUrl: false, preserveView: true });
        }
        if (Archify.finder && Archify.finder.isOpen()) Archify.finder.close({ restoreFocus: false });
        if (Archify.radar && Archify.radar.isOpen()) Archify.radar.close({ restoreFocus: false });
        mode = 'source';
        panel.hidden = false;
        panel.setAttribute('data-state', 'source');
        svg.setAttribute('data-route-picking', 'source');
        title.textContent = viewerText('viewer.route.start');
        renderPlaceholder(viewerText('viewer.route.pickOne'));
        status.textContent = viewerText('viewer.route.start.instructions');
        findBtn.hidden = false;
        findBtn.textContent = viewerText('viewer.route.start.find');
        findBtn.setAttribute('aria-label', viewerText('viewer.route.start.find.aria'));
        copyBtn.hidden = true;
        setTrigger(true);
        if (focused && nodesById()[focused]) chooseStart(focused);
        if (options.focusNode === true && !focused) {
          var first = nodes()[0];
          if (first) {
            try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (_) {} }
          }
        }
        return true;
      }
      function toggle(options) {
        if (mode !== 'idle') {
          clear({ restoreFocus: true });
          return false;
        }
        return begin(options);
      }
      function finderContext() {
        var byId = nodesById();
        if (mode === 'source') {
          var outgoing = outgoingByNode();
          var sourceIds = nodes().map(function (node) { return node.getAttribute('data-node-id'); }).filter(function (id) {
            return outgoing[id] && outgoing[id].length;
          });
          var sourceBadges = {};
          sourceIds.forEach(function (id) { sourceBadges[id] = viewerText('viewer.route.finder.source.badge'); });
          return {
            kind: 'route-source',
            title: viewerText('viewer.route.finder.source.title'),
            placeholder: viewerText('viewer.route.finder.source.placeholder'),
            empty: viewerText('viewer.route.finder.source.empty'),
            resultsLabel: viewerText('viewer.route.finder.source.results'),
            availableNoun: viewerText('viewer.route.finder.source.noun'),
            allowedIds: sourceIds,
            badges: sourceBadges
          };
        }
        if (mode === 'target' && startId && byId[startId]) {
          var distances = hopDistancesFrom(startId);
          var targetIds = Object.keys(distances).filter(function (id) { return id !== startId && byId[id]; });
          var targetBadges = {};
          targetIds.forEach(function (id) {
            targetBadges[id] = viewerCount('viewer.route.hop', distances[id]);
          });
          return {
            kind: 'route-target',
            title: viewerText('viewer.route.finder.target.title', { label: nodeLabel(byId[startId], startId) }),
            placeholder: viewerText('viewer.route.finder.target.placeholder'),
            empty: viewerText('viewer.route.finder.target.empty'),
            resultsLabel: viewerText('viewer.route.finder.target.results'),
            availableNoun: viewerText('viewer.route.finder.target.noun'),
            allowedIds: targetIds,
            badges: targetBadges
          };
        }
        return null;
      }
      function finderOpening() {
        panel.setAttribute('data-finder-open', 'true');
      }
      function finderClosed(options) {
        options = options || {};
        panel.removeAttribute('data-finder-open');
        requestDocking();
        if (options.restoreFocus === true && !findBtn.hidden) findBtn.focus();
      }
      function openFinder() {
        var context = finderContext();
        if (!context || !Archify.finder) return false;
        return Archify.finder.open({ context: context });
      }
      function fallbackCopy(value) {
        var field = document.createElement('textarea');
        field.value = value;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (_) {}
        field.remove();
        return copied;
      }
      function copyLink() {
        if (mode !== 'result') return Promise.resolve(false);
        var value = location.href.replace(/#.*$/, '') + '#route=' + encodeURIComponent(startId) + '~' + encodeURIComponent(endId);
        var copy = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
          ? navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return fallbackCopy(value); })
          : Promise.resolve(fallbackCopy(value));
        return copy.then(function (copied) {
          copyBtn.textContent = viewerText(copied ? 'viewer.common.copied' : 'viewer.common.copyFailed');
          copyBtn.setAttribute('aria-label', viewerText(copied ? 'viewer.route.copy.success' : 'viewer.route.copy.failed'));
          window.setTimeout(function () {
            copyBtn.textContent = viewerText('viewer.route.copy');
            copyBtn.setAttribute('aria-label', viewerText('viewer.route.copy.aria'));
          }, 1600);
          return copied;
        });
      }
      function interceptSelection(event) {
        if (mode !== 'source' && mode !== 'target') return;
        if (container.getAttribute('data-just-panned') === 'true') return;
        var node = event.target.closest('[data-node-id]');
        if (!node) return;
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        choose(node.getAttribute('data-node-id'));
      }
      function syncFromHash() {
        try {
          var params = new URLSearchParams(location.hash.replace(/^#/, ''));
          var route = params.get('route');
          if (!route) {
            if (mode !== 'idle') clear({ updateUrl: false, restoreFocus: false });
            return;
          }
          var parts = route.split('~');
          if (parts.length !== 2) return;
          var byId = nodesById();
          if (!byId[parts[0]] || !byId[parts[1]]) return;
          begin({ source: parts[0], focusNode: false });
          choose(parts[1], { updateUrl: false });
        } catch (_) {}
      }
      function escapeRoute(options) {
        options = options || {};
        if (journeyPlaying) {
          pauseJourney({ preserveElapsed: true });
          if (options.restoreFocus === true) journeyPlayBtn.focus();
          return 'paused';
        }
        if (journeyIndex >= 0) {
          showJourneyOverview({ reveal: true });
          if (options.restoreFocus === true) journeyOverviewBtn.focus();
          return 'overview';
        }
        clear({ restoreFocus: options.restoreFocus === true });
        return 'cleared';
      }
      function syncJourneyMotion() {
        if (journeyPlaying && !journeyMotionAllowed()) pauseJourney({ preserveElapsed: true });
        renderJourneyControls();
        return journeyMotionAllowed();
      }

      trigger.addEventListener('click', function () { toggle({ focusNode: false }); });
      findBtn.addEventListener('click', openFinder);
      clearBtn.addEventListener('click', function () { clear({ restoreFocus: true }); });
      copyBtn.addEventListener('click', copyLink);
      journeyPrevBtn.addEventListener('click', previousJourney);
      journeyPlayBtn.addEventListener('click', toggleJourney);
      journeyNextBtn.addEventListener('click', nextJourney);
      journeyOverviewBtn.addEventListener('click', function () { showJourneyOverview({ reveal: true }); });
      path.addEventListener('click', function (event) {
        var button = event.target.closest('[data-route-journey-index]');
        if (!button) return;
        selectJourneyIndex(Number(button.getAttribute('data-route-journey-index')));
      });
      path.addEventListener('focusin', function (event) {
        if (journeyPlaying && event.target.closest('[data-route-journey-index]')) pauseJourney({ preserveElapsed: true });
      });
      path.addEventListener('keydown', function (event) {
        var button = event.target.closest('[data-route-journey-index]');
        if (!button) return;
        var index = Number(button.getAttribute('data-route-journey-index'));
        var next = null;
        if (event.key === 'ArrowRight') next = Math.min(activeNodeIds.length - 1, index + 1);
        else if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = activeNodeIds.length - 1;
        if (next !== null) {
          event.preventDefault();
          focusJourneyButton(next);
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectJourneyIndex(index);
        }
      });
      svg.addEventListener('click', interceptSelection, true);
      svg.addEventListener('keydown', interceptSelection, true);
      container.addEventListener('scroll', updateDocking, { passive: true });
      window.addEventListener('resize', requestDocking);
      window.addEventListener('beforeprint', function () {
        if (journeyPlaying) pauseJourney({ preserveElapsed: true, reason: 'print' });
        else removeJourneyPulse();
      });
      window.addEventListener('hashchange', function () { requestAnimationFrame(syncFromHash); });
      syncFromHash();

      return {
        begin: begin,
        choose: choose,
        clear: clear,
        toggle: toggle,
        escape: escapeRoute,
        copyLink: copyLink,
        playJourney: playJourney,
        pauseJourney: pauseJourney,
        showOverview: showJourneyOverview,
        selectJourneyIndex: selectJourneyIndex,
        syncMotion: syncJourneyMotion,
        isJourneyPlaying: function () { return journeyPlaying; },
        finderContext: finderContext,
        finderOpening: finderOpening,
        finderClosed: finderClosed,
        openFinder: openFinder,
        exportSnapshot: exportSnapshot,
        active: function () { return mode === 'idle' ? null : mode; },
        result: function () {
          return mode === 'result'
            ? { source: startId, target: endId, nodes: activeNodeIds.slice(), hops: activeEdges.length, journey: journeyIndex, playing: journeyPlaying }
            : null;
        }
      };
    })();