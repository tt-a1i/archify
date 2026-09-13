    /* ============================================================
       Semantic Lens — a counted, viewer-only legend over data-node-kind.
       One selected kind reveals every authored relationship touching it.
       Two selected kinds compare only direct cross-kind relationships while
       preserving the full diagram as a dimmed spatial reference.
       ============================================================ */
    Archify.semanticLens = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector(':scope > svg');
      var trigger = document.getElementById('btn-semantic-lens');
      var panel = document.getElementById('semantic-lens');
      var closeBtn = document.getElementById('semantic-lens-close');
      var kindsRoot = document.getElementById('semantic-lens-kinds');
      var status = document.getElementById('semantic-lens-status');
      var copyBtn = document.getElementById('semantic-lens-copy');
      var clearBtn = document.getElementById('semantic-lens-clear');
      var legendBridge = svg.querySelector('[data-legend-bridge]');
      var legendEntries = [];
      var hoveredLegendEntry = null;
      var focusedLegendEntry = null;
      var activeLegendPreview = null;
      var lensOpener = trigger;
      var selectedKinds = [];
      var namespace = 'http://www.w3.org/2000/svg';
      var finePointerQuery = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
      var MAX_LENS_FLOW_EDGES = 24;

      function nodesById() {
        var byId = {};
        Array.prototype.forEach.call(svg.querySelectorAll('[data-node-id][data-node-kind]'), function (node) {
          var id = node.getAttribute('data-node-id');
          if (id && !byId[id]) byId[id] = node;
        });
        return byId;
      }
      function collectKinds() {
        var kinds = {};
        var byId = nodesById();
        Object.keys(byId).forEach(function (id) {
          var node = byId[id];
          var value = node.getAttribute('data-node-kind') || 'neutral';
          var kind = kinds[value] || (kinds[value] = { id: value, label: viewerKindLabel(value), nodes: [] });
          kind.nodes.push(node);
        });
        return Object.keys(kinds).map(function (key) { return kinds[key]; }).sort(function (a, b) {
          return b.nodes.length - a.nodes.length || a.label.localeCompare(b.label);
        });
      }
      function edgeGroups() {
        var groups = {};
        Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'), function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var key = edge.getAttribute('data-edge-key') || [from, to, edge.getAttribute('data-edge-label') || ''].join('\u0000');
          if (!groups[key]) groups[key] = { key: key, from: from, to: to, members: [] };
          groups[key].members.push(edge);
        });
        return Object.keys(groups).map(function (key) { return groups[key]; });
      }
      function edgeShapes(edge) {
        if (!edge) return [];
        if (/^(path|line|polyline)$/i.test(edge.tagName || '')) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }
      function legendSourceBounds(entry) {
        var bounds = null;
        Array.prototype.forEach.call(entry.children, function (child) {
          if (child.hasAttribute('data-legend-bridge-runtime')) return;
          var box;
          try { box = child.getBBox(); } catch (_) { return; }
          if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) return;
          var next = { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
          if (!bounds) bounds = next;
          else {
            bounds.left = Math.min(bounds.left, next.left);
            bounds.top = Math.min(bounds.top, next.top);
            bounds.right = Math.max(bounds.right, next.right);
            bounds.bottom = Math.max(bounds.bottom, next.bottom);
          }
        });
        return bounds;
      }
      function layoutLegendEntry(entry) {
        var bounds = legendSourceBounds(entry);
        var hit = entry.querySelector('[data-legend-hit]');
        var badge = entry.querySelector('[data-legend-count-badge]');
        if (!bounds || !hit || !badge) return false;
        var count = entry.getAttribute('data-legend-count') || '0';
        var centerY = (bounds.top + bounds.bottom) / 2;
        var badgeWidth = Math.max(14, count.length * 5 + 8);
        var badgeX = bounds.right + 3;
        var hitX = bounds.left - 5;
        var hitRight = badgeX + badgeWidth + 4;
        hit.setAttribute('x', hitX.toFixed(2));
        hit.setAttribute('y', (centerY - 12).toFixed(2));
        hit.setAttribute('width', Math.max(24, hitRight - hitX).toFixed(2));
        hit.setAttribute('height', '24');
        hit.setAttribute('rx', '4');
        var badgeRect = badge.querySelector('rect');
        var badgeText = badge.querySelector('text');
        badgeRect.setAttribute('x', badgeX.toFixed(2));
        badgeRect.setAttribute('y', (centerY - 7).toFixed(2));
        badgeRect.setAttribute('width', badgeWidth.toFixed(2));
        badgeRect.setAttribute('height', '14');
        badgeRect.setAttribute('rx', '7');
        badgeText.setAttribute('x', (badgeX + badgeWidth / 2).toFixed(2));
        badgeText.setAttribute('y', (centerY + 2.5).toFixed(2));
        return true;
      }
      function layoutLegendBridge() {
        legendEntries.forEach(layoutLegendEntry);
        if (!legendBridge) return;
        Array.prototype.forEach.call(legendBridge.querySelectorAll('[data-legend-zero]'), layoutLegendEntry);
      }
      function decorateLegendBridge() {
        legendEntries = [];
        if (!legendBridge || html.getAttribute('data-embed') === 'true') return false;
        var facts = {};
        collectKinds().forEach(function (kind) { facts[kind.id] = kind; });
        Array.prototype.forEach.call(legendBridge.querySelectorAll('[data-legend-kind]'), function (entry) {
          var kind = entry.getAttribute('data-legend-kind');
          var fact = facts[kind];
          var count = fact ? fact.nodes.length : 0;
          entry.setAttribute('data-legend-count', String(count));
          var hit = document.createElementNS(namespace, 'rect');
          hit.setAttribute('data-legend-bridge-runtime', '');
          hit.setAttribute('data-legend-hit', '');
          hit.setAttribute('aria-hidden', 'true');
          entry.insertBefore(hit, entry.firstChild);
          var badge = document.createElementNS(namespace, 'g');
          badge.setAttribute('data-legend-bridge-runtime', '');
          badge.setAttribute('data-legend-count-badge', '');
          badge.setAttribute('aria-hidden', 'true');
          badge.appendChild(document.createElementNS(namespace, 'rect'));
          var countText = document.createElementNS(namespace, 'text');
          countText.textContent = String(count);
          badge.appendChild(countText);
          entry.appendChild(badge);
          if (!fact || !count) {
            entry.setAttribute('data-legend-zero', '');
            return;
          }
          entry.setAttribute('role', 'button');
          entry.setAttribute('tabindex', legendEntries.length ? '-1' : '0');
          var visibleLabel = entry.getAttribute('data-legend-label') || fact.label;
          entry.setAttribute('aria-label', viewerCount('viewer.lens.legend.inspect', count, { label: visibleLabel }));
          entry.setAttribute('aria-pressed', 'false');
          entry.setAttribute('aria-haspopup', 'dialog');
          entry.setAttribute('aria-controls', 'semantic-lens');
          entry.setAttribute('aria-expanded', 'false');
          legendEntries.push(entry);
        });
        if (!legendEntries.length) return false;
        legendBridge.setAttribute('role', legendEntries.length >= 3 ? 'toolbar' : 'group');
        legendBridge.setAttribute('aria-label', viewerText('viewer.lens.legend'));
        syncLegendBridge();
        layoutLegendBridge();
        try {
          if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutLegendBridge);
        } catch (_) {}
        return true;
      }
      function syncLegendBridge() {
        legendEntries.forEach(function (entry) {
          var selected = selectedKinds.indexOf(entry.getAttribute('data-legend-kind')) >= 0;
          entry.setAttribute('aria-pressed', selected ? 'true' : 'false');
          entry.setAttribute('aria-expanded', !panel.hidden && lensOpener === entry ? 'true' : 'false');
          if (selected) entry.setAttribute('data-legend-selected', '');
          else entry.removeAttribute('data-legend-selected');
        });
      }
      function clearLegendPreview() {
        activeLegendPreview = null;
        svg.removeAttribute('data-legend-preview-active');
        Array.prototype.forEach.call(svg.querySelectorAll('[data-legend-preview-match], [data-legend-preview-selected], [data-legend-preview-peer]'), function (element) {
          element.removeAttribute('data-legend-preview-match');
          element.removeAttribute('data-legend-preview-selected');
          element.removeAttribute('data-legend-preview-peer');
        });
      }
      function strongerLegendOwnerActive() {
        return selectedKinds.length > 0 || !panel.hidden || html.getAttribute('data-present') === 'true' ||
          svg.hasAttribute('data-focus-active') || svg.hasAttribute('data-intent-trace-active') ||
          svg.hasAttribute('data-route-picking') || svg.hasAttribute('data-route-active') ||
          svg.hasAttribute('data-story-active') || svg.hasAttribute('data-relationship-preview-active');
      }
      function previewLegendKind(entry) {
        clearLegendPreview();
        if (!entry || strongerLegendOwnerActive()) return false;
        var kind = entry.getAttribute('data-legend-kind');
        var byId = nodesById();
        var matches = Object.keys(byId).filter(function (id) {
          return (byId[id].getAttribute('data-node-kind') || 'neutral') === kind;
        });
        if (!matches.length) return false;
        var chosen = {};
        matches.forEach(function (id) {
          chosen[id] = true;
          byId[id].setAttribute('data-legend-preview-match', '');
          byId[id].setAttribute('data-legend-preview-selected', '');
        });
        edgeGroups().forEach(function (edge) {
          if (!chosen[edge.from] && !chosen[edge.to]) return;
          edge.members.forEach(function (member) { member.setAttribute('data-legend-preview-match', ''); });
          [edge.from, edge.to].forEach(function (id) {
            if (!byId[id] || chosen[id]) return;
            byId[id].setAttribute('data-legend-preview-match', '');
            byId[id].setAttribute('data-legend-preview-peer', '');
          });
        });
        svg.setAttribute('data-legend-preview-active', kind);
        activeLegendPreview = entry;
        return true;
      }
      function syncLegendPreview() {
        var next = focusedLegendEntry || hoveredLegendEntry;
        if (next === activeLegendPreview) return;
        clearLegendPreview();
        if (next) previewLegendKind(next);
      }
      function activateLegendEntry(entry) {
        if (!entry || entry.getAttribute('role') !== 'button') return false;
        clearLegendPreview();
        select(entry.getAttribute('data-legend-kind'));
        return open({ opener: entry });
      }
      function removeFlowOverlay() {
        Array.prototype.forEach.call(svg.querySelectorAll('[data-semantic-lens-overlay]'), function (element) {
          element.remove();
        });
        svg.removeAttribute('data-lens-flow-count');
        svg.removeAttribute('data-lens-flow-density');
      }
      function flowGeometry(shape, direction, step) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-hidden');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.removeAttribute('data-lens-match');
        clone.setAttribute('class', 'semantic-lens-flow');
        clone.setAttribute('data-direction', direction);
        clone.setAttribute('pathLength', '1');
        clone.style.setProperty('--lens-flow-delay', (step * 0.08).toFixed(2) + 's');
        return clone;
      }
      function renderFlowOverlay(entries) {
        removeFlowOverlay();
        svg.setAttribute('data-lens-flow-count', String(entries.length));
        if (!entries.length || html.getAttribute('data-embed') === 'true') return false;
        if (entries.length > MAX_LENS_FLOW_EDGES) {
          svg.setAttribute('data-lens-flow-density', 'quiet');
          return false;
        }
        var overlay = document.createElementNS(namespace, 'g');
        overlay.setAttribute('class', 'semantic-lens-overlay');
        overlay.setAttribute('data-semantic-lens-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        entries.forEach(function (entry, step) {
          var wrapper = document.createElementNS(namespace, 'g');
          if (entry.edge.members[0].hasAttribute('transform')) {
            wrapper.setAttribute('transform', entry.edge.members[0].getAttribute('transform'));
          }
          edgeShapes(entry.edge.members[0]).forEach(function (shape) {
            wrapper.appendChild(flowGeometry(shape, entry.direction, step));
          });
          if (wrapper.childNodes.length) overlay.appendChild(wrapper);
        });
        if (!overlay.childNodes.length) return false;
        var firstNode = svg.querySelector('[data-node-id]');
        if (firstNode) svg.insertBefore(overlay, firstNode);
        else svg.appendChild(overlay);
        return true;
      }
      function cleanSvgState() {
        removeFlowOverlay();
        svg.removeAttribute('data-lens-active');
        Array.prototype.forEach.call(svg.querySelectorAll('[data-lens-match], [data-lens-selected], [data-lens-peer]'), function (element) {
          element.removeAttribute('data-lens-match');
          element.removeAttribute('data-lens-selected');
          element.removeAttribute('data-lens-peer');
        });
      }
      function renderKinds() {
        kindsRoot.textContent = '';
        collectKinds().forEach(function (kind) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'semantic-lens-kind';
          button.setAttribute('data-kind', kind.id);
          button.setAttribute('aria-pressed', selectedKinds.indexOf(kind.id) >= 0 ? 'true' : 'false');
          button.setAttribute('aria-label', viewerCount('viewer.lens.kind.count', kind.nodes.length, { label: kind.label }));
          button.disabled = selectedKinds.length >= 2 && selectedKinds.indexOf(kind.id) === -1;
          var swatch = document.createElement('span');
          swatch.className = 'semantic-lens-swatch';
          swatch.setAttribute('aria-hidden', 'true');
          var label = document.createElement('strong');
          label.textContent = kind.label;
          var count = document.createElement('em');
          count.textContent = String(kind.nodes.length);
          button.appendChild(swatch);
          button.appendChild(label);
          button.appendChild(count);
          kindsRoot.appendChild(button);
        });
      }
      function updateHash() {
        try {
          var hash = selectedKinds.length
            ? '#lens=' + selectedKinds.map(encodeURIComponent).join('~')
            : '';
          history.replaceState(null, '', location.pathname + location.search + hash);
        } catch (_) {}
      }
      function updateTrigger() {
        var active = selectedKinds.length > 0;
        trigger.setAttribute('aria-pressed', active ? 'true' : 'false');
        trigger.setAttribute('aria-label', viewerText(active ? 'viewer.lens.openActive' : 'viewer.lens.open'));
        copyBtn.hidden = !active;
        syncLegendBridge();
      }
      function overlapArea(a, b) {
        var width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        var height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return width * height;
      }
      function dockPanel(byId) {
        panel.removeAttribute('data-dock-side');
        if (panel.hidden || window.innerWidth <= 720) return 'right';
        var panelRect = panel.getBoundingClientRect();
        var containerRect = container.getBoundingClientRect();
        if (!panelRect.width || !panelRect.height) return 'right';
        var selectedRects = Object.keys(byId).filter(function (id) {
          return selectedKinds.indexOf(byId[id].getAttribute('data-node-kind') || 'neutral') >= 0;
        }).map(function (id) { return byId[id].getBoundingClientRect(); });
        var top = panelRect.top;
        var width = panelRect.width;
        var leftCandidate = { left: containerRect.left + 16, right: containerRect.left + 16 + width, top: top, bottom: panelRect.bottom };
        var rightCandidate = { left: containerRect.right - 16 - width, right: containerRect.right - 16, top: top, bottom: panelRect.bottom };
        var leftScore = selectedRects.reduce(function (score, rect) { return score + overlapArea(leftCandidate, rect); }, 0);
        var rightScore = selectedRects.reduce(function (score, rect) { return score + overlapArea(rightCandidate, rect); }, 0);
        var legend = svg.querySelector('[data-legend]');
        var nav = container.querySelector('.diagram-nav');
        var protectedRects = [legend, nav].filter(function (element) {
          return element && !element.hidden && window.getComputedStyle(element).display !== 'none';
        }).map(function (element) { return element.getBoundingClientRect(); });
        leftScore += protectedRects.reduce(function (score, rect) {
          return score + overlapArea(leftCandidate, rect) * 1000;
        }, 0);
        rightScore += protectedRects.reduce(function (score, rect) {
          return score + overlapArea(rightCandidate, rect) * 1000;
        }, 0);
        var side = leftScore < rightScore ? 'left' : 'right';
        panel.setAttribute('data-dock-side', side);
        return side;
      }
      function applySelection(options) {
        options = options || {};
        cleanSvgState();
        var byId = nodesById();
        var nodeKind = {};
        Object.keys(byId).forEach(function (id) { nodeKind[id] = byId[id].getAttribute('data-node-kind') || 'neutral'; });
        if (!selectedKinds.length) {
          status.textContent = viewerText('viewer.lens.choose');
          updateTrigger();
          renderKinds();
          dockPanel(byId);
          if (options.updateUrl !== false) updateHash();
          return false;
        }

        var chosen = {};
        selectedKinds.forEach(function (kind) { chosen[kind] = true; });
        Object.keys(byId).forEach(function (id) {
          if (!chosen[nodeKind[id]]) return;
          byId[id].setAttribute('data-lens-match', '');
          byId[id].setAttribute('data-lens-selected', '');
        });

        var touching = 0;
        var forward = 0;
        var reverse = 0;
        var crossKind = selectedKinds.length === 2;
        var matchedFlow = [];
        edgeGroups().forEach(function (edge) {
          var fromKind = nodeKind[edge.from];
          var toKind = nodeKind[edge.to];
          var match = false;
          if (crossKind) {
            if (fromKind === selectedKinds[0] && toKind === selectedKinds[1]) { match = true; forward += 1; }
            if (fromKind === selectedKinds[1] && toKind === selectedKinds[0]) { match = true; reverse += 1; }
          } else if (fromKind === selectedKinds[0] || toKind === selectedKinds[0]) {
            match = true;
            touching += 1;
          }
          if (!match) return;
          var direction = 'within';
          if (crossKind) {
            direction = fromKind === selectedKinds[0] ? 'forward' : 'reverse';
          } else {
            direction = fromKind === selectedKinds[0] && toKind !== selectedKinds[0] ? 'out'
              : (toKind === selectedKinds[0] && fromKind !== selectedKinds[0] ? 'in' : 'within');
          }
          matchedFlow.push({ edge: edge, direction: direction });
          edge.members.forEach(function (member) { member.setAttribute('data-lens-match', ''); });
          if (!crossKind) {
            [edge.from, edge.to].forEach(function (id) {
              if (!byId[id]) return;
              byId[id].setAttribute('data-lens-match', '');
              if (!chosen[nodeKind[id]]) byId[id].setAttribute('data-lens-peer', '');
            });
          }
        });

        svg.setAttribute('data-lens-active', selectedKinds.join(' '));
        renderFlowOverlay(matchedFlow);
        if (crossKind) {
          var total = forward + reverse;
          status.textContent = viewerCount('viewer.lens.compare', total, {
            first: viewerKindLabel(selectedKinds[0]),
            second: viewerKindLabel(selectedKinds[1]),
            forward: forward,
            reverse: reverse
          });
        } else {
          var nodeCount = collectKinds().filter(function (kind) { return kind.id === selectedKinds[0]; })[0].nodes.length;
          status.textContent = viewerText('viewer.lens.single', {
            nodes: viewerCount('viewer.lens.node', nodeCount, { label: viewerKindLabel(selectedKinds[0]) }),
            relationships: viewerCount('viewer.lens.relationship', touching)
          });
        }
        updateTrigger();
        renderKinds();
        dockPanel(byId);
        if (options.updateUrl !== false) updateHash();
        return true;
      }
      function prepareForLens() {
        clearLegendPreview();
        if (Archify.focus && typeof Archify.focus.clear === 'function') {
          Archify.focus.clear({ updateUrl: false, preserveView: true });
        }
        if (Archify.routeProbe && typeof Archify.routeProbe.clear === 'function') {
          Archify.routeProbe.clear({ updateUrl: false, restoreFocus: false });
        }
        if (Archify.guidedViews && typeof Archify.guidedViews.showAll === 'function') {
          Archify.guidedViews.showAll({ clearFocus: false, updateUrl: false });
        }
        if (Archify.intentTrace && typeof Archify.intentTrace.clear === 'function') {
          Archify.intentTrace.clear({ announce: false });
        }
      }
      function select(kind, options) {
        options = options || {};
        clearLegendPreview();
        var exists = collectKinds().some(function (entry) { return entry.id === kind; });
        if (!exists) return false;
        var index = selectedKinds.indexOf(kind);
        if (index >= 0) selectedKinds.splice(index, 1);
        else {
          if (selectedKinds.length >= 2) return false;
          if (!selectedKinds.length) prepareForLens();
          selectedKinds.push(kind);
        }
        return applySelection(options);
      }
      function close(options) {
        options = options || {};
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        updateTrigger();
        if (options.restoreFocus !== false && lensOpener && typeof lensOpener.focus === 'function') lensOpener.focus();
        return false;
      }
      function open(options) {
        options = options || {};
        if (html.getAttribute('data-embed') === 'true') return false;
        lensOpener = options.opener || trigger;
        if (Archify.exportMenu && Archify.exportMenu.isOpen()) Archify.exportMenu.close(false);
        if (Archify.finder && Archify.finder.isOpen()) Archify.finder.close({ restoreFocus: false });
        if (Archify.radar && Archify.radar.isOpen()) Archify.radar.close({ restoreFocus: false });
        if (Archify.guide && Archify.guide.isOpen()) Archify.guide.close({ restoreFocus: false });
        renderKinds();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        updateTrigger();
        requestAnimationFrame(function () {
          dockPanel(nodesById());
          var activeButton = kindsRoot.querySelector('[aria-pressed="true"]');
          var firstButton = activeButton || kindsRoot.querySelector('button:not(:disabled)');
          if (firstButton) firstButton.focus();
        });
        return true;
      }
      function toggle() { return panel.hidden ? open({ opener: trigger }) : close(); }
      function clear(options) {
        options = options || {};
        selectedKinds = [];
        cleanSvgState();
        panel.removeAttribute('data-dock-side');
        updateTrigger();
        renderKinds();
        status.textContent = viewerText('viewer.lens.choose');
        if (options.updateUrl !== false) updateHash();
        if (options.preserveView !== true && Archify.view && typeof Archify.view.reset === 'function') {
          Archify.view.reset({ automatic: true });
        }
        if (options.closePanel === true) close({ restoreFocus: false });
        return false;
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
        if (!selectedKinds.length) return Promise.resolve(false);
        var value = location.href.replace(/#.*$/, '') + '#lens=' + selectedKinds.map(encodeURIComponent).join('~');
        var copy = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
          ? navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return fallbackCopy(value); })
          : Promise.resolve(fallbackCopy(value));
        return copy.then(function (copied) {
          copyBtn.textContent = viewerText(copied ? 'viewer.common.copied' : 'viewer.common.copyFailed');
          window.setTimeout(function () { copyBtn.textContent = viewerText('viewer.common.copyLink'); }, 1600);
          return copied;
        });
      }
      function syncFromHash() {
        try {
          var params = new URLSearchParams(location.hash.replace(/^#/, ''));
          var value = params.get('lens');
          if (!value) {
            if (selectedKinds.length) clear({ updateUrl: false, preserveView: true });
            return;
          }
          var available = collectKinds().map(function (kind) { return kind.id; });
          var requested = value.split('~').filter(function (kind, index, list) {
            return available.indexOf(kind) >= 0 && list.indexOf(kind) === index;
          }).slice(0, 2);
          if (!requested.length) return;
          prepareForLens();
          selectedKinds = requested;
          applySelection({ updateUrl: false });
        } catch (_) {}
      }

      trigger.addEventListener('click', toggle);
      if (decorateLegendBridge()) {
        legendBridge.addEventListener('click', function (event) {
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (entry) activateLegendEntry(entry);
        });
        legendBridge.addEventListener('pointerover', function (event) {
          if (event.pointerType === 'touch' || (finePointerQuery && !finePointerQuery.matches)) return;
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (!entry || (event.relatedTarget && entry.contains(event.relatedTarget))) return;
          hoveredLegendEntry = entry;
          syncLegendPreview();
        });
        legendBridge.addEventListener('pointerout', function (event) {
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (!entry || (event.relatedTarget && entry.contains(event.relatedTarget))) return;
          if (hoveredLegendEntry === entry) hoveredLegendEntry = null;
          syncLegendPreview();
        });
        legendBridge.addEventListener('focusin', function (event) {
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (!entry) return;
          focusedLegendEntry = entry;
          legendEntries.forEach(function (candidate) {
            candidate.setAttribute('tabindex', candidate === entry ? '0' : '-1');
          });
          syncLegendPreview();
        });
        legendBridge.addEventListener('focusout', function (event) {
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (!entry || (event.relatedTarget && entry.contains(event.relatedTarget))) return;
          if (focusedLegendEntry === entry) focusedLegendEntry = null;
          syncLegendPreview();
        });
        legendBridge.addEventListener('keydown', function (event) {
          var entry = event.target.closest('[data-legend-kind][role="button"]');
          if (!entry) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateLegendEntry(entry);
            return;
          }
          var index = legendEntries.indexOf(entry);
          var next = null;
          if (event.key === 'ArrowRight') next = (index + 1) % legendEntries.length;
          else if (event.key === 'ArrowLeft') next = (index - 1 + legendEntries.length) % legendEntries.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = legendEntries.length - 1;
          if (next === null) return;
          event.preventDefault();
          legendEntries.forEach(function (candidate, candidateIndex) {
            candidate.setAttribute('tabindex', candidateIndex === next ? '0' : '-1');
          });
          legendEntries[next].focus();
        });
      }
      closeBtn.addEventListener('click', function () { close(); });
      clearBtn.addEventListener('click', function () { clear({ preserveView: true }); });
      copyBtn.addEventListener('click', copyLink);
      kindsRoot.addEventListener('click', function (event) {
        var button = event.target.closest('[data-kind]');
        if (!button || button.disabled) return;
        select(button.getAttribute('data-kind'));
      });
      kindsRoot.addEventListener('keydown', function (event) {
        var buttons = Array.prototype.slice.call(kindsRoot.querySelectorAll('button:not(:disabled)'));
        var index = buttons.indexOf(document.activeElement);
        var next = null;
        if (index >= 0 && (event.key === 'ArrowRight' || event.key === 'ArrowDown')) next = (index + 1) % buttons.length;
        else if (index >= 0 && (event.key === 'ArrowLeft' || event.key === 'ArrowUp')) next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home' && buttons.length) next = 0;
        else if (event.key === 'End' && buttons.length) next = buttons.length - 1;
        if (next !== null) { event.preventDefault(); buttons[next].focus(); }
      });
      panel.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      });
      document.addEventListener('click', function (event) {
        var eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
        var clickedInside = eventPath.indexOf(panel) >= 0 || panel.contains(event.target);
        var clickedLauncher = event.target === trigger || legendEntries.some(function (entry) {
          return event.target === entry || entry.contains(event.target);
        });
        if (!panel.hidden && !clickedInside && !clickedLauncher) close({ restoreFocus: false });
      });
      window.addEventListener('hashchange', syncFromHash);
      window.addEventListener('resize', function () {
        if (!panel.hidden && selectedKinds.length) dockPanel(nodesById());
        layoutLegendBridge();
      });
      renderKinds();
      syncFromHash();

      return {
        open: open,
        close: close,
        toggle: toggle,
        clear: clear,
        clearPreview: clearLegendPreview,
        select: select,
        copyLink: copyLink,
        isOpen: function () { return !panel.hidden; },
        active: function () { return selectedKinds.length ? selectedKinds.slice() : null; },
        kinds: function () { return collectKinds().map(function (kind) { return { id: kind.id, count: kind.nodes.length }; }); }
      };
    })();