    /* ============================================================
       Intent Trace — temporary one-hop topology before durable focus.
       Fine-pointer hover and keyboard focus share the same stable-ID preview;
       touch continues directly to the existing click-to-focus contract.
       ============================================================ */
    Archify.intentTrace = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector(':scope > svg');
      var status = document.getElementById('intent-trace-status');
      var namespace = 'http://www.w3.org/2000/svg';
      var activeId = null;
      var hoveredNode = null;
      var focusedNode = null;
      var enterTimer = null;

      function nodes() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
      }
      function edges() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'));
      }
      function nodeLabel(node, fallback) {
        return node.getAttribute('data-node-label') ||
          (node.getAttribute('aria-label') || fallback).replace(/^Focus\s+/, '').split(',')[0];
      }
      function finePointer() {
        return !window.matchMedia || window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      }
      function reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      }
      function blocked() {
        return html.getAttribute('data-embed') === 'true' ||
          html.getAttribute('data-guide-open') === 'true' ||
          container.classList.contains('is-panning') ||
          svg.hasAttribute('data-lens-active') ||
          svg.hasAttribute('data-story-active') ||
          svg.hasAttribute('data-relationship-preview-active') ||
          !!(Archify.routeProbe && typeof Archify.routeProbe.active === 'function' && Archify.routeProbe.active()) ||
          !!(Archify.focus && typeof Archify.focus.active === 'function' && Archify.focus.active());
      }
      function edgeShapes(edge) {
        if (/^(path|line|polyline)$/i.test(edge.tagName)) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }
      function removeOverlay() {
        Array.prototype.forEach.call(svg.querySelectorAll('[data-intent-trace-overlay]'), function (overlay) {
          overlay.remove();
        });
      }
      function clear(options) {
        options = options || {};
        if (enterTimer) window.clearTimeout(enterTimer);
        enterTimer = null;
        activeId = null;
        svg.removeAttribute('data-intent-trace-active');
        removeOverlay();
        nodes().forEach(function (node) {
          node.removeAttribute('data-intent-trace-match');
          node.removeAttribute('data-intent-trace-selected');
        });
        edges().forEach(function (edge) { edge.removeAttribute('data-intent-trace-match'); });
        if (options.announce !== false) status.textContent = '';
      }
      function traceGeometry(shape, direction) {
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
        clone.removeAttribute('data-intent-trace-match');
        clone.removeAttribute('data-intent-trace-selected');
        clone.setAttribute('class', 'intent-trace-flow');
        clone.setAttribute('data-direction', direction);
        clone.setAttribute('pathLength', '1');
        return clone;
      }
      function show(id, options) {
        options = options || {};
        if (!id || blocked()) {
          clear({ announce: false });
          return false;
        }
        if (activeId === id) return true;
        clear({ announce: false });
        var nodeList = nodes();
        var edgeList = edges();
        var byId = {};
        nodeList.forEach(function (node) { byId[node.getAttribute('data-node-id')] = node; });
        var selected = byId[id];
        if (!selected) return false;

        var overlay = document.createElementNS(namespace, 'g');
        overlay.setAttribute('class', 'intent-trace-overlay');
        overlay.setAttribute('data-intent-trace-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        var related = {};
        var seen = {};
        var counts = { out: 0, in: 0, loop: 0 };
        related[id] = true;

        edgeList.forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          if (from !== id && to !== id) return;
          var direction = from === id && to === id ? 'loop' : (from === id ? 'out' : 'in');
          var key = edge.getAttribute('data-edge-key') ||
            (from + '\u0000' + to + '\u0000' + (edge.getAttribute('data-edge-label') || ''));
          if (!seen[key]) {
            seen[key] = true;
            counts[direction] += 1;
          }
          related[from] = true;
          related[to] = true;
          edge.setAttribute('data-intent-trace-match', '');
          var wrapper = document.createElementNS(namespace, 'g');
          if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
          edgeShapes(edge).forEach(function (shape) {
            wrapper.appendChild(traceGeometry(shape, direction));
          });
          if (wrapper.childNodes.length) overlay.appendChild(wrapper);
        });

        nodeList.forEach(function (node) {
          var nodeId = node.getAttribute('data-node-id');
          if (related[nodeId]) node.setAttribute('data-intent-trace-match', '');
          if (nodeId === id) node.setAttribute('data-intent-trace-selected', '');
        });
        if (overlay.childNodes.length) {
          var firstEdge = edgeList[0];
          var firstNode = svg.querySelector('[data-node-id]');
          if (firstEdge && firstEdge.parentNode) firstEdge.parentNode.insertBefore(overlay, firstEdge);
          else if (firstNode) svg.insertBefore(overlay, firstNode);
          else svg.appendChild(overlay);
        }
        activeId = id;
        svg.setAttribute('data-intent-trace-active', id);
        if (options.announce === true) {
          var total = counts.out + counts.in + counts.loop;
          status.textContent = viewerText('viewer.intent.summary', {
            label: nodeLabel(selected, id),
            out: counts.out,
            in: counts.in,
            loops: counts.loop ? viewerText('viewer.intent.loops', { count: counts.loop }) : '',
            total: total
          });
        }
        return true;
      }
      function schedule(node) {
        if (enterTimer) window.clearTimeout(enterTimer);
        enterTimer = window.setTimeout(function () {
          enterTimer = null;
          if (hoveredNode === node) show(node.getAttribute('data-node-id'), { announce: false });
        }, reducedMotion() ? 0 : 90);
      }
      function sync() {
        var candidate = focusedNode || hoveredNode;
        if (!candidate) {
          clear();
          return;
        }
        show(candidate.getAttribute('data-node-id'), { announce: candidate === focusedNode });
      }

      svg.addEventListener('pointerover', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || !finePointer() || event.pointerType === 'touch') return;
        if (event.relatedTarget && node.contains(event.relatedTarget)) return;
        hoveredNode = node;
        schedule(node);
      });
      svg.addEventListener('pointerout', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || (event.relatedTarget && node.contains(event.relatedTarget))) return;
        if (hoveredNode === node) hoveredNode = null;
        sync();
      });
      svg.addEventListener('focusin', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node) return;
        focusedNode = node;
        show(node.getAttribute('data-node-id'), { announce: true });
      });
      svg.addEventListener('focusout', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || (event.relatedTarget && node.contains(event.relatedTarget))) return;
        if (focusedNode === node) focusedNode = null;
        sync();
      });
      container.addEventListener('pointerdown', function (event) {
        if (!event.target.closest('[data-node-id]')) clear({ announce: false });
      });
      window.addEventListener('blur', function () { clear({ announce: false }); });

      return {
        show: show,
        clear: clear,
        active: function () { return activeId; }
      };
    })();