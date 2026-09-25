    /* ============================================================
       Node Outline — a rail index of the semantic nodes, grouped by their
       authored context. Hover previews neighbors through Intent Trace;
       selection delegates to the Finder's focus-and-reveal path. It reads
       the canonical SVG and never changes geometry or export state.
       ============================================================ */
    Archify.outline = (function () {
      var panel = document.getElementById('node-outline');
      var list = document.getElementById('node-outline-list');
      var count = document.getElementById('node-outline-count');
      var svg = document.querySelector('.diagram-container > svg');
      if (!panel || !list || !svg) return { count: 0 };
      var TONES = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
      var nodes = Array.from(svg.querySelectorAll('[data-node-id]')).filter(function (node) {
        return !node.closest('[data-legend-hit], .legend') && node.getAttribute('data-node-label');
      });
      var buttons = Object.create(null);

      function tone(node) {
        var shape = node.querySelector('[class*="c-"]:not(.c-mask)');
        var match = shape && /(?:^|\s)c-([a-z]+)/.exec(shape.getAttribute('class') || '');
        return match && TONES.indexOf(match[1]) !== -1 ? match[1] : 'external';
      }
      function preview(id) {
        if (Archify.intentTrace && typeof Archify.intentTrace.show === 'function') Archify.intentTrace.show(id);
      }
      function clearPreview() {
        if (Archify.intentTrace && typeof Archify.intentTrace.clear === 'function') Archify.intentTrace.clear({ announce: false });
      }
      function select(id) {
        clearPreview();
        if (Archify.finder && typeof Archify.finder.select === 'function' && Archify.finder.select(id)) return;
        if (Archify.focus && typeof Archify.focus.set === 'function') Archify.focus.set(id, { toggle: false });
      }

      var groups = [];
      var byContext = Object.create(null);
      nodes.forEach(function (node) {
        // Group by the outermost context (lane or stage); deeper segments
        // such as workflow groups and columns would split the index into
        // one-node sections.
        var context = (node.getAttribute('data-node-context') || '').split(' \u203a ')[0];
        if (!byContext[context]) {
          byContext[context] = { label: context, nodes: [] };
          groups.push(byContext[context]);
        }
        byContext[context].nodes.push(node);
      });

      groups.forEach(function (group) {
        var section = document.createElement('li');
        section.className = 'node-outline-group';
        if (groups.length > 1 && group.label) {
          var heading = document.createElement('span');
          heading.className = 'node-outline-heading';
          var headingLabel = document.createElement('span');
          headingLabel.textContent = group.label;
          var headingCount = document.createElement('small');
          headingCount.textContent = String(group.nodes.length);
          heading.appendChild(headingLabel);
          heading.appendChild(headingCount);
          section.appendChild(heading);
        }
        var items = document.createElement('ul');
        group.nodes.forEach(function (node) {
          var id = node.getAttribute('data-node-id');
          var item = document.createElement('li');
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'node-outline-item';
          button.setAttribute('data-outline-node', id);
          button.style.setProperty('--outline-tone', 'var(--' + tone(node) + '-stroke)');
          var dot = document.createElement('span');
          dot.className = 'node-outline-dot';
          dot.setAttribute('aria-hidden', 'true');
          var label = document.createElement('strong');
          label.textContent = node.getAttribute('data-node-label');
          button.appendChild(dot);
          button.appendChild(label);
          var sublabel = node.getAttribute('data-node-sublabel');
          if (sublabel) {
            var detail = document.createElement('small');
            detail.textContent = sublabel;
            button.appendChild(detail);
          }
          button.addEventListener('pointerenter', function () { preview(id); });
          button.addEventListener('focus', function () { preview(id); });
          button.addEventListener('pointerleave', clearPreview);
          button.addEventListener('blur', clearPreview);
          button.addEventListener('click', function () { select(id); });
          buttons[id] = button;
          item.appendChild(button);
          items.appendChild(item);
        });
        section.appendChild(items);
        list.appendChild(section);
      });

      var previewing = null;
      function syncCurrent() {
        nodes.forEach(function (node) {
          var button = buttons[node.getAttribute('data-node-id')];
          if (!button) return;
          if (node.getAttribute('aria-pressed') === 'true') button.setAttribute('aria-current', 'true');
          else button.removeAttribute('aria-current');
        });
        // Mirror a diagram-side hover so the index answers "where is this?".
        var active = buttons[svg.getAttribute('data-intent-trace-active') || ''] || null;
        if (active === previewing) return;
        if (previewing) previewing.removeAttribute('data-previewing');
        previewing = active;
        if (!active) return;
        active.setAttribute('data-previewing', '');
        if (!active.matches(':hover') && panel.offsetParent) {
          var box = list.getBoundingClientRect();
          var item = active.getBoundingClientRect();
          if (item.top < box.top || item.bottom > box.bottom - 24) {
            list.scrollTop += item.top - box.top - box.height / 2 + item.height / 2;
          }
        }
      }
      if (typeof MutationObserver === 'function') {
        new MutationObserver(syncCurrent).observe(svg, { attributes: true, subtree: true, attributeFilter: ['aria-pressed', 'data-intent-trace-active'] });
      }
      if (count) count.textContent = String(nodes.length);
      panel.hidden = nodes.length < 2;
      syncCurrent();
      if (Archify.readerLayout && typeof Archify.readerLayout.schedule === 'function') Archify.readerLayout.schedule();

      return { count: nodes.length, select: select };
    })();
