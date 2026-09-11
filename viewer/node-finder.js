    /* ============================================================
       Node Finder — stable-ID search over the existing semantic SVG.
       Search never changes the IR or SVG geometry: selecting a result resets
       the viewport, releases a guided view, and delegates to semantic focus.
       ============================================================ */
    Archify.finder = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector('svg');
      var trigger = document.getElementById('btn-node-finder');
      var panel = document.getElementById('node-finder');
      var heading = document.getElementById('node-finder-title');
      var closeBtn = document.getElementById('node-finder-close');
      var input = document.getElementById('node-finder-input');
      var results = document.getElementById('node-finder-results');
      var empty = document.getElementById('node-finder-empty');
      var status = document.getElementById('node-finder-status');
      var visibleItems = [];

      function defaultContext() {
        return {
          kind: 'focus',
          title: viewerText('viewer.finder.title'),
          placeholder: viewerText('viewer.finder.placeholder'),
          empty: viewerText('viewer.finder.empty'),
          resultsLabel: viewerText('viewer.finder.results'),
          availableNoun: viewerText('viewer.finder.noun.nodes'),
          allowedIds: null,
          badges: null
        };
      }

      var context = defaultContext();

      function semanticType(node) {
        var authored = node.getAttribute('data-node-kind');
        if (authored) return authored;
        var types = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
        return types.find(function (type) { return node.querySelector('.c-' + type); }) || 'node';
      }

      function connectionsFor(id) {
        var count = 0;
        var seen = {};
        Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'), function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var key = from + '\u0000' + to;
          if ((from === id || to === id) && !seen[key]) {
            seen[key] = true;
            count += 1;
          }
        });
        return count;
      }

      var items = Array.prototype.map.call(svg.querySelectorAll('[data-node-id]'), function (node) {
        var id = node.getAttribute('data-node-id');
        var label = node.getAttribute('data-node-label') || (node.getAttribute('aria-label') || id).replace(/^Focus\s+/, '');
        var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        var sublabel = node.getAttribute('data-node-sublabel') || '';
        var context = node.getAttribute('data-node-context') || '';
        var tag = node.getAttribute('data-node-tag') || '';
        var brand = node.getAttribute('data-node-brand') || '';
        var type = semanticType(node);
        var sources = Archify.sourceEvidence.node(id);
        var sourceSearch = sources.map(function (source) {
          return [source.path, source.label, source.line, source.endLine].filter(Boolean).join(' ');
        }).join(' ');
        return {
          id: id,
          label: label,
          type: type,
          sublabel: sublabel,
          context: context,
          tag: tag,
          brand: brand,
          sources: sources,
          links: connectionsFor(id),
          search: (id + ' ' + label + ' ' + type + ' ' + sublabel + ' ' + context + ' ' + tag + ' ' + sourceSearch + ' ' + text).toLowerCase() + ' ' + brand.toLowerCase(),
          node: node
        };
      });

      function resultButtons() {
        return Array.prototype.slice.call(results.querySelectorAll('.node-finder-result'));
      }

      function resolveContext(options) {
        var requested = options && options.context ? options.context : null;
        if (!requested && Archify.routeProbe && typeof Archify.routeProbe.finderContext === 'function') {
          requested = Archify.routeProbe.finderContext();
        }
        if (!requested) return defaultContext();
        var resolved = defaultContext();
        Object.keys(requested).forEach(function (key) { resolved[key] = requested[key]; });
        return resolved;
      }

      function availableItems() {
        if (!context.allowedIds) return items.slice();
        return items.filter(function (item) { return context.allowedIds.indexOf(item.id) !== -1; });
      }

      function applyContext() {
        panel.setAttribute('data-context', context.kind);
        heading.textContent = context.title;
        input.placeholder = context.placeholder;
        empty.textContent = context.empty;
        results.setAttribute('aria-label', context.resultsLabel);
      }

      function select(id) {
        var item = items.find(function (candidate) { return candidate.id === id; });
        if (!item) return false;
        var routeSelection = context.kind === 'route-source' || context.kind === 'route-target';
        if (routeSelection) {
          if (!Archify.routeProbe || typeof Archify.routeProbe.choose !== 'function' || !Archify.routeProbe.choose(id)) return false;
          if (Archify.routeProbe.active() === 'target' && Archify.view && typeof Archify.view.reveal === 'function') {
            Archify.view.reveal([id], { includeNeighbors: true, reason: 'route-pick' });
          }
          close({ restoreFocus: false });
          try { item.node.focus({ preventScroll: true }); } catch (_) { try { item.node.focus(); } catch (_) {} }
          return true;
        }
        if (Archify.guidedViews && typeof Archify.guidedViews.showAll === 'function') {
          Archify.guidedViews.showAll({ clearFocus: false, updateUrl: false });
        }
        if (Archify.view && typeof Archify.view.reset === 'function') Archify.view.reset({ automatic: true });
        Archify.focus.set(id, { toggle: false });
        if (Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'finder' });
        }
        close({ restoreFocus: false });
        try { item.node.focus({ preventScroll: true }); } catch (_) { try { item.node.focus(); } catch (_) {} }
        return true;
      }

      function render(query) {
        query = (query || '').trim().toLowerCase();
        var available = availableItems();
        visibleItems = available.filter(function (item) { return !query || item.search.indexOf(query) !== -1; });
        results.textContent = '';
        visibleItems.forEach(function (item) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'node-finder-result';
          button.setAttribute('data-node-id', item.id);
          var badge = context.badges && context.badges[item.id]
            ? context.badges[item.id]
            : context.kind === 'focus'
              ? viewerCount('viewer.finder.link', item.links)
              : String(item.links);
          var action = context.kind === 'route-source'
            ? viewerText('viewer.finder.result.routeStart', { label: item.label })
            : context.kind === 'route-target'
              ? viewerText('viewer.finder.result.routeTarget', { label: item.label, links: badge })
              : viewerCount('viewer.finder.result.focus', item.links, { label: item.label });
          button.setAttribute('aria-label', action);

          var name = document.createElement('strong');
          name.textContent = item.label;
          var links = document.createElement('em');
          links.textContent = badge;
          links.title = context.kind === 'focus' ? badge : action;
          var meta = document.createElement('small');
          meta.textContent = [viewerKindLabel(item.type), item.id, item.sublabel, item.tag].filter(Boolean).join(' \u00b7 ');
          meta.title = [viewerKindLabel(item.type), item.id, item.context, item.sublabel, item.tag].filter(Boolean).join(' \u00b7 ');
          button.appendChild(name);
          button.appendChild(links);
          button.appendChild(meta);
          button.addEventListener('click', function () { select(item.id); });
          results.appendChild(button);
        });
        empty.hidden = visibleItems.length !== 0;
        status.textContent = query
          ? viewerText('viewer.finder.status.filtered', {
              visible: visibleItems.length,
              available: available.length,
              noun: context.availableNoun
            })
          : viewerText('viewer.finder.status.all', { available: available.length, noun: context.availableNoun });
      }

      function open(options) {
        if (html.getAttribute('data-embed') === 'true') return false;
        if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (Archify.exportMenu && Archify.exportMenu.isOpen()) Archify.exportMenu.close(false);
        if (Archify.semanticLens && Archify.semanticLens.isOpen()) Archify.semanticLens.close({ restoreFocus: false });
        context = resolveContext(options || {});
        applyContext();
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        if (context.kind.indexOf('route-') === 0 && Archify.routeProbe && typeof Archify.routeProbe.finderOpening === 'function') {
          Archify.routeProbe.finderOpening();
        }
        input.value = '';
        render('');
        requestAnimationFrame(function () { input.focus(); });
        return true;
      }

      function close(options) {
        options = options || {};
        var routeContext = context.kind.indexOf('route-') === 0;
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        input.value = '';
        if (routeContext && Archify.routeProbe && typeof Archify.routeProbe.finderClosed === 'function') {
          Archify.routeProbe.finderClosed({ restoreFocus: options.restoreFocus !== false });
        } else if (options.restoreFocus !== false) {
          trigger.focus();
        }
      }

      function toggle() { return panel.hidden ? open() : (close(), false); }

      trigger.addEventListener('click', toggle);
      closeBtn.addEventListener('click', function () { close(); });
      input.addEventListener('input', function () { render(input.value); });
      input.addEventListener('keydown', function (event) {
        var buttons = resultButtons();
        if (event.key === 'ArrowDown' && buttons.length) {
          event.preventDefault();
          buttons[0].focus();
        } else if (event.key === 'Enter' && visibleItems.length) {
          event.preventDefault();
          select(visibleItems[0].id);
        }
      });
      results.addEventListener('keydown', function (event) {
        var buttons = resultButtons();
        var index = buttons.indexOf(document.activeElement);
        if (index < 0 || !buttons.length) return;
        var next = null;
        if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
        else if (event.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = buttons.length - 1;
        if (next !== null) {
          event.preventDefault();
          buttons[next].focus();
        }
      });
      panel.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      });
      document.addEventListener('click', function (event) {
        if (!panel.hidden && !panel.contains(event.target) && !event.target.closest('[data-node-finder-trigger]')) close({ restoreFocus: false });
      });

      render('');
      return {
        open: open,
        close: close,
        toggle: toggle,
        select: select,
        isOpen: function () { return !panel.hidden; },
        context: function () { return context.kind; },
        count: items.length
      };
    })();