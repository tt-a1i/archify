    /* ============================================================
       Tree Branches — expand/collapse for hierarchy diagrams. The renderer
       lays out the complete tree once and tags every node, link, and toggle
       with its ancestors; collapsing only hides descendants, so visible nodes
       never move and the reader keeps their place. Selecting a hidden node
       through Finder, Outline, or a shared link expands its ancestors. Export
       always writes the complete tree (see Export Cleanup).
       ============================================================ */
    Archify.treeBranches = (function () {
      var svg = document.querySelector('.diagram-container > svg[data-tree-ui]');
      if (!svg) return { active: false };
      var collapsed = Object.create(null);
      var toggles = Object.create(null);
      Array.prototype.forEach.call(svg.querySelectorAll('[data-tree-toggle]'), function (toggle) {
        toggles[toggle.getAttribute('data-tree-toggle')] = toggle;
      });
      var tagged = svg.querySelectorAll('[data-tree-ancestors]');
      var expandAll = svg.querySelector('[data-tree-expand-all]');

      function ancestors(el) {
        return (el.getAttribute('data-tree-ancestors') || '').split(' ').filter(Boolean);
      }

      function apply() {
        Array.prototype.forEach.call(tagged, function (el) {
          var hidden = ancestors(el).some(function (id) { return collapsed[id]; });
          if (hidden) el.setAttribute('data-tree-hidden', '');
          else el.removeAttribute('data-tree-hidden');
        });
        var any = false;
        Object.keys(toggles).forEach(function (id) {
          var toggle = toggles[id];
          var isCollapsed = Boolean(collapsed[id]);
          any = any || isCollapsed;
          toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
          toggle.setAttribute('aria-label', toggle.getAttribute(isCollapsed ? 'data-tree-label-expand' : 'data-tree-label-collapse') || '');
          var node = svg.querySelector('[data-node-id="' + id + '"]');
          if (node) {
            if (isCollapsed) node.setAttribute('data-tree-collapsed', '');
            else node.removeAttribute('data-tree-collapsed');
          }
        });
        if (any) svg.setAttribute('data-tree-any-collapsed', '');
        else svg.removeAttribute('data-tree-any-collapsed');
      }

      function setCollapsed(id, value) {
        if (!toggles[id]) return false;
        if (value) collapsed[id] = true;
        else delete collapsed[id];
        apply();
        return true;
      }

      function toggle(id) { return setCollapsed(id, !collapsed[id]); }

      // Reveal a node by expanding every collapsed ancestor; nothing else moves.
      function reveal(id) {
        var node = svg.querySelector('[data-node-id="' + id + '"]');
        if (!node) return false;
        var changed = false;
        ancestors(node).forEach(function (ancestor) {
          if (collapsed[ancestor]) { delete collapsed[ancestor]; changed = true; }
        });
        if (changed) apply();
        return changed;
      }

      function restoreAll() {
        collapsed = Object.create(null);
        apply();
      }

      function activate(event) {
        var target = event.target.closest('[data-tree-toggle], [data-tree-expand-all]');
        if (!target || !svg.contains(target)) return false;
        event.preventDefault();
        event.stopPropagation();
        if (target.hasAttribute('data-tree-expand-all')) {
          restoreAll();
          var root = svg.querySelector('[data-tree-toggle]:not([data-tree-ancestors])');
          if (root) root.focus();
        } else {
          toggle(target.getAttribute('data-tree-toggle'));
          target.focus();
        }
        return true;
      }

      // Capture phase so the canvas focus handler never treats a toggle press
      // as a background click that clears the current focus.
      svg.addEventListener('click', activate, true);
      svg.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { activate(event); return; }
        var node = event.target.closest('[data-node-id]');
        if (!node || !svg.contains(node)) return;
        var id = node.getAttribute('data-node-id');
        // Arrow keys follow the tree convention: left collapses, right expands.
        if (event.key === 'ArrowLeft' && toggles[id] && !collapsed[id]) { event.preventDefault(); setCollapsed(id, true); }
        else if (event.key === 'ArrowRight' && collapsed[id]) { event.preventDefault(); setCollapsed(id, false); }
      }, true);

      // Focus reveals ancestors synchronously before positioning its lens.
      // The observer also covers paths that change pressed state directly.
      new MutationObserver(function (records) {
        records.forEach(function (record) {
          var el = record.target;
          if (el.hasAttribute && el.hasAttribute('data-tree-hidden') && el.getAttribute('aria-pressed') === 'true') {
            reveal(el.getAttribute('data-node-id'));
          }
        });
      }).observe(svg, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });

      Object.keys(toggles).forEach(function (id) {
        if (toggles[id].hasAttribute('data-tree-initially-collapsed')) collapsed[id] = true;
      });
      apply();

      return {
        active: true,
        toggle: toggle,
        collapse: function (id) { return setCollapsed(id, true); },
        expand: function (id) { return setCollapsed(id, false); },
        reveal: reveal,
        restoreAll: restoreAll,
        collapsedIds: function () { return Object.keys(collapsed); },
        expandAllControl: expandAll
      };
    })();
