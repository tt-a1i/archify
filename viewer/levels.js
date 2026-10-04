    Archify.levels = (function () {
      var data = document.getElementById('archify-levels-data');
      var inert = {
        count: 0,
        root: null,
        active: function () { return null; },
        path: function () { return []; },
        labelOf: function () { return null; },
        drillTargets: function () { return []; },
        show: function () { return false; },
        up: function () { return false; }
      };
      if (!data) return inert;

      var manifest = null;
      try { manifest = JSON.parse(data.textContent || 'null'); } catch (_) { manifest = null; }
      if (!manifest || !manifest.levels || !manifest.levels.length) return inert;

      var container = Archify.stage.container();
      var shell = document.querySelector('.container');
      var rail = document.getElementById('level-rail');
      var crumbs = document.getElementById('level-crumbs');
      var children = document.getElementById('level-children');
      if (!container || !rail || !crumbs || !children) return inert;

      var byId = Object.create(null);
      manifest.levels.forEach(function (level) { byId[level.id] = level; });
      var root = manifest.root;
      var activeId = null;

      // The manifest declares each child's parent; the viewer needs the
      // inverse to know which node on the visible level opens something.
      var drillTargets = Object.create(null);
      manifest.levels.forEach(function (level) {
        if (!level.drillFrom) return;
        var parent = level.drillFrom.level;
        if (!drillTargets[parent]) drillTargets[parent] = Object.create(null);
        drillTargets[parent][level.drillFrom.node] = level.id;
      });

      function svgFor(id) {
        return container.querySelector('svg[data-level="' + id + '"]');
      }
      function cardsFor(id) {
        return shell ? shell.querySelector('.cards[data-level="' + id + '"]') : null;
      }
      function pathTo(id) {
        var chain = [];
        var guard = 0;
        var cursor = byId[id];
        while (cursor && guard < manifest.levels.length + 1) {
          chain.unshift(cursor.id);
          cursor = cursor.drillFrom ? byId[cursor.drillFrom.level] : null;
          guard += 1;
        }
        return chain;
      }

      function setVisible(element, visible) {
        if (!element) return;
        if (visible) {
          element.removeAttribute('hidden');
          element.removeAttribute('aria-hidden');
          element.setAttribute('data-level-active', 'true');
        } else {
          element.setAttribute('hidden', 'hidden');
          element.setAttribute('aria-hidden', 'true');
          element.removeAttribute('data-level-active');
        }
      }

      // Transient reader state belongs to the level it was raised on. Clearing
      // it through each module's own public API avoids reaching into their
      // internals and leaves every owner consistent.
      function clearTransientState() {
        try { if (Archify.focus) { Archify.focus.clearReach(); Archify.focus.clear(); } } catch (_) {}
        try { if (Archify.semanticLens) Archify.semanticLens.clear(); } catch (_) {}
        try { if (Archify.routeProbe) Archify.routeProbe.clear(); } catch (_) {}
        try { if (Archify.finder) Archify.finder.close(); } catch (_) {}
        try { if (Archify.radar) Archify.radar.close(); } catch (_) {}
      }

      // Which node opens which level is a fixed property of the document, not
      // of what is on screen, so every level is marked once. Marking only the
      // active level would leave stale attributes behind on switch.
      var SVG_NS = 'http://www.w3.org/2000/svg';

      // The badge is an overlay in the node's own corner: authored geometry is
      // read, never rewritten, and the glyph carries the drill target so one
      // click is enough. Double-click and Ctrl/Cmd+Enter keep working.
      function drillBadge(node, childId, label) {
        var existing = node.querySelector('[data-drill-badge]');
        if (existing) existing.remove();
        var rect = node.querySelector('rect');
        if (!rect) return;
        var x = parseFloat(rect.getAttribute('x'));
        var y = parseFloat(rect.getAttribute('y'));
        var width = parseFloat(rect.getAttribute('width'));
        if (!isFinite(x) || !isFinite(y) || !isFinite(width)) return;

        var badge = document.createElementNS(SVG_NS, 'g');
        badge.setAttribute('class', 'level-drill-badge');
        // The target rides on data-drill-badge, not data-drill-to: the latter
        // means "a node that opens a level" and is queried as such.
        badge.setAttribute('data-drill-badge', childId);
        badge.setAttribute('role', 'button');
        badge.setAttribute('tabindex', '0');
        badge.setAttribute('aria-label', viewerText('viewer.levels.openNamed', { label: label }));
        badge.setAttribute('transform', 'translate(' + (x + width - 15) + ' ' + (y + 15) + ')');
        var title = document.createElementNS(SVG_NS, 'title');
        title.textContent = viewerText('viewer.levels.openNamed', { label: label });
        badge.appendChild(title);
        var disc = document.createElementNS(SVG_NS, 'circle');
        disc.setAttribute('class', 'level-drill-badge-disc');
        disc.setAttribute('r', '10');
        badge.appendChild(disc);
        var glyph = document.createElementNS(SVG_NS, 'g');
        glyph.setAttribute('class', 'level-drill-badge-glyph');
        var lens = document.createElementNS(SVG_NS, 'circle');
        lens.setAttribute('cx', '-1'); lens.setAttribute('cy', '-1'); lens.setAttribute('r', '3.7');
        glyph.appendChild(lens);
        var marks = document.createElementNS(SVG_NS, 'path');
        marks.setAttribute('d', 'M1.7 1.7 L4.5 4.5 M-2.9 -1 H0.9 M-1 -2.9 V0.9');
        glyph.appendChild(marks);
        badge.appendChild(glyph);
        node.appendChild(badge);
      }

      function markDrillable() {
        manifest.levels.forEach(function (level) {
          var svg = svgFor(level.id);
          if (!svg) return;
          var targets = drillTargets[level.id] || Object.create(null);
          Array.prototype.forEach.call(svg.querySelectorAll('[data-node-id]'), function (node) {
            var child = targets[node.getAttribute('data-node-id')];
            // An attribute plus an overlay badge; authored geometry is untouched.
            if (child) {
              node.setAttribute('data-drill-to', child);
              drillBadge(node, child, byId[child] ? byId[child].label : child);
            } else {
              node.removeAttribute('data-drill-to');
              var stale = node.querySelector('[data-drill-badge]');
              if (stale) stale.remove();
            }
          });
        });
      }

      // A framed stage with its own zoom-out control: once you are inside a
      // level, leaving it is the mirror of the badge that opened it.
      var zoomOut = document.createElement('div');
      zoomOut.className = 'level-zoom-out no-print';
      zoomOut.hidden = true;
      var zoomOutBtn = document.createElement('button');
      zoomOutBtn.type = 'button';
      zoomOutBtn.className = 'level-zoom-out-btn';
      zoomOutBtn.setAttribute('data-level-up', '');
      // Built through the DOM rather than an inline markup string: a literal
      // svg tag in this source would be counted as a level by the artifact check.
      var zoomOutIcon = document.createElementNS(SVG_NS, 'svg');
      zoomOutIcon.setAttribute('viewBox', '-8 -8 16 16');
      zoomOutIcon.setAttribute('aria-hidden', 'true');
      zoomOutIcon.setAttribute('focusable', 'false');
      var zoomOutLens = document.createElementNS(SVG_NS, 'circle');
      zoomOutLens.setAttribute('cx', '-1');
      zoomOutLens.setAttribute('cy', '-1');
      zoomOutLens.setAttribute('r', '3.7');
      zoomOutIcon.appendChild(zoomOutLens);
      var zoomOutMarks = document.createElementNS(SVG_NS, 'path');
      zoomOutMarks.setAttribute('d', 'M1.7 1.7 L4.5 4.5 M-2.9 -1 H0.9');
      zoomOutIcon.appendChild(zoomOutMarks);
      zoomOutBtn.appendChild(zoomOutIcon);
      var zoomOutLabel = document.createElement('span');
      zoomOutBtn.appendChild(zoomOutLabel);
      zoomOut.appendChild(zoomOutBtn);
      container.appendChild(zoomOut);
      zoomOutBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        up();
      });

      function renderZoomOut() {
        var level = byId[activeId];
        var parent = level && level.drillFrom ? byId[level.drillFrom.level] : null;
        if (!parent) {
          zoomOut.hidden = true;
          container.removeAttribute('data-level-drilled');
          return;
        }
        zoomOutLabel.textContent = parent.label;
        zoomOutBtn.title = viewerText('viewer.levels.back', { label: parent.label });
        zoomOutBtn.setAttribute('aria-label', viewerText('viewer.levels.back', { label: parent.label }));
        zoomOut.hidden = false;
        container.setAttribute('data-level-drilled', 'true');
      }

      function renderRail() {
        var chain = pathTo(activeId);
        crumbs.textContent = '';
        chain.forEach(function (id, index) {
          var item = document.createElement('li');
          var level = byId[id];
          var current = id === activeId;
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'level-crumb';
          button.textContent = level.label;
          button.setAttribute('data-level-target', id);
          if (current) {
            button.setAttribute('aria-current', 'true');
            button.disabled = true;
            if (level.note) button.title = level.note;
          } else {
            button.title = viewerText('viewer.levels.back', { label: level.label });
          }
          if (index > 0) item.setAttribute('data-level-depth', String(index));
          item.appendChild(button);
          crumbs.appendChild(item);
        });

        children.textContent = '';
        var targets = drillTargets[activeId] || Object.create(null);
        var targetNodes = Object.keys(targets);
        if (targetNodes.length) {
          var openLabel = document.createElement('span');
          openLabel.className = 'level-children-label';
          openLabel.textContent = viewerText('viewer.levels.open');
          children.appendChild(openLabel);
        }
        targetNodes.forEach(function (nodeId) {
          var childId = targets[nodeId];
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'level-child';
          button.setAttribute('data-level-target', childId);
          button.textContent = byId[childId].label;
          button.title = viewerText('viewer.levels.openFrom', {
            label: byId[childId].label,
            node: nodeId,
          });
          children.appendChild(button);
        });
        children.hidden = children.childNodes.length === 0;
        rail.hidden = false;
      }

      function show(id, options) {
        if (!byId[id] || id === activeId) return false;
        var nextSvg = svgFor(id);
        if (!nextSvg) return false;

        clearTransientState();

        manifest.levels.forEach(function (level) {
          setVisible(svgFor(level.id), level.id === id);
          setVisible(cardsFor(level.id), level.id === id);
        });
        activeId = id;
        renderRail();
        renderZoomOut();

        document.documentElement.setAttribute('data-active-level', id);
        Archify.stage.notify({ level: id, previous: options && options.previous });

        if (!options || options.updateHash !== false) {
          viewerReplaceHash({ level: id === root ? null : id });
        }
        return true;
      }

      function up() {
        var level = byId[activeId];
        return level && level.drillFrom ? show(level.drillFrom.level) : false;
      }

      rail.addEventListener('click', function (event) {
        var button = event.target.closest('[data-level-target]');
        if (!button) return;
        event.preventDefault();
        show(button.getAttribute('data-level-target'));
      });

      // The badge is an explicit control, so one click on it drills. Capture
      // phase with propagation stopped keeps the same click from also being
      // read as "focus this node" by the passport.
      function drillFromBadge(event) {
        var badge = event.target.closest && event.target.closest('[data-drill-badge]');
        if (!badge) return false;
        event.preventDefault();
        event.stopPropagation();
        show(badge.getAttribute('data-drill-badge'));
        return true;
      }
      container.addEventListener('click', drillFromBadge, true);
      container.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        drillFromBadge(event);
      }, true);

      // Anywhere else on a drillable node, drilling stays a deliberate second
      // gesture: a single click already means focus.
      container.addEventListener('dblclick', function (event) {
        var node = event.target.closest('[data-drill-to]');
        if (!node) return;
        event.preventDefault();
        show(node.getAttribute('data-drill-to'));
      });

      container.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
        var node = event.target.closest && event.target.closest('[data-drill-to]');
        if (!node) return;
        event.preventDefault();
        show(node.getAttribute('data-drill-to'));
      });

      // Absent means "keep the level already on stage". An explicit level that
      // is not in the manifest falls back to root; a hash written by focus or
      // route, with no level param, must not.
      function requestedLevel() {
        var hash = window.location.hash || '';
        if (!/(?:^|[#&])level=/.test(hash)) return { present: false, id: null };
        var match = /(?:^|[#&])level=([^&]*)/.exec(hash);
        var id = match ? decodeURIComponent(match[1]) : '';
        return { present: true, id: byId[id] ? id : null };
      }

      window.addEventListener('hashchange', function () {
        var requested = requestedLevel();
        if (!requested.present) return;
        var next = requested.id || root;
        if (next !== activeId) show(next, { updateHash: false });
      });

      markDrillable();

      // Establish the starting level without rewriting a deep link that
      // already names it.
      var requested = requestedLevel();
      var initial = requested.present ? (requested.id || root) : (manifest.active || root);
      activeId = null;
      show(initial, { updateHash: initial !== root && !requested.present });
      if (activeId !== initial) show(root, { updateHash: false });

      return {
        count: manifest.levels.length,
        root: root,
        active: function () { return activeId; },
        path: function () { return pathTo(activeId); },
        labelOf: function (id) { return byId[id] ? byId[id].label : null; },
        drillTargets: function (id) {
          var targets = drillTargets[id || activeId] || {};
          return Object.keys(targets).map(function (nodeId) {
            return { node: nodeId, level: targets[nodeId] };
          });
        },
        show: show,
        up: up
      };
    })();
