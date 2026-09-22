    /* ============================================================
       Explore — stable-ID neighborhood focus + dependency-free pan/zoom.
       Renderer IDs become deep-linkable semantic hooks without turning the
       standalone artifact into a canvas editor.
       ============================================================ */
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

    Archify.internalStructure = (function () {
      var html = document.documentElement;
      var payload = readPayload();
      var diagram = document.querySelector('.diagram-container');
      var guided = document.querySelector('.guided-views');
      var cards = document.querySelector('.cards');
      var chip = document.getElementById('focus-chip');
      var detail = document.getElementById('focus-detail');
      var quicklook = null;
      var structureRoot = null;
      var structureActions = null;
      var structureBody = null;
      var structureTitle = null;
      var structureSummary = null;
      var structureModes = null;
      var structureTree = null;
      var structureDetail = null;
      var structureFeedback = null;
      var structureCopy = null;
      var structureRelations = null;
      var structureSourcesAction = null;
      var currentSurface = 'graph';
      var currentNodeId = null;
      var currentSection = null;
      var currentItemId = null;
      var domainStates = Object.create(null);
      var graphState = null;
      var graphScrollY = 0;
      var surfaceRevision = 0;
      var surfaceReady = Promise.resolve(true);
      var pendingOpen = null;
      var pendingGraphInformation = null;
      var pendingGraphSource = null;
      var standaloneSaveFrame = null;
      var standaloneSyncRevision = 0;
      var connected = false;
      var sectionKinds = ['code', 'state'];

      function stateForNode(id) {
        if (!own(domainStates, id)) {
          domainStates[id] = {
            code: { item: null, expanded: Object.create(null) },
            state: { item: null, expanded: Object.create(null) }
          };
        }
        return domainStates[id];
      }

      function readPayload() {
        var data = document.getElementById('archify-internal-structure-data');
        if (!data) return null;
        try {
          var chunks = JSON.parse(data.textContent || 'null');
          var parsed = Array.isArray(chunks) ? JSON.parse(chunks.join('')) : chunks;
          if (!parsed || parsed.schemaVersion !== 1 || !parsed.nodes ||
              typeof parsed.nodes !== 'object' || Array.isArray(parsed.nodes)) return null;
          return parsed;
        } catch (_) { return null; }
      }

      function own(object, key) {
        return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
      }

      function node(id) {
        if (typeof id !== 'string' || !payload || !own(payload.nodes, id)) return null;
        var value = payload.nodes[id];
        return value && typeof value === 'object' ? value : null;
      }

      function structureNodes() {
        return payload ? Object.keys(payload.nodes) : [];
      }

      function textElement(name, className, parent, value) {
        var element = document.createElement(name);
        if (className) element.className = className;
        if (value != null) element.textContent = String(value);
        if (parent) parent.appendChild(element);
        return element;
      }

      function labelFor(id) {
        var match = null;
        Array.prototype.some.call(document.querySelectorAll('[data-node-id]'), function (candidate) {
          if (candidate.getAttribute('data-node-id') !== id) return false;
          match = candidate;
          return true;
        });
        if (!match) return id || viewerText('viewer.internalStructure.overview');
        return match.getAttribute('data-node-label') ||
          (match.getAttribute('aria-label') || id).replace(/^Focus\s+/, '');
      }

      function diagramHasNode(id) {
        var found = false;
        Array.prototype.some.call(document.querySelectorAll('[data-node-id]'), function (candidate) {
          if (candidate.getAttribute('data-node-id') !== id) return false;
          found = true;
          return true;
        });
        return found;
      }

      function sectionLabel(kind) {
        return viewerText('viewer.internalStructure.section.' + kind);
      }

      function sourceFor(id, reference) {
        var sources = Archify.sourceEvidence && typeof Archify.sourceEvidence.node === 'function'
          ? Archify.sourceEvidence.node(id) : [];
        for (var index = 0; index < sources.length; index += 1) {
          if (sources[index] && sources[index].id === reference) return sources[index];
        }
        return null;
      }

      function sourceLocation(source) {
        if (!source) return '';
        var range = source.line
          ? ':L' + source.line + (source.endLine && source.endLine !== source.line ? '-L' + source.endLine : '')
          : '';
        var location = (source.path || source.label || '') + range;
        return source.symbol ? location + ' · ' + source.symbol : location;
      }

      function activateSource(id, reference) {
        if (currentSurface === 'structure') {
          pendingGraphSource = { id: id, reference: reference };
          showNodeInformation('sources');
          return true;
        }
        var sourceTab = document.getElementById('atlas-tab-sources');
        if (sourceTab && typeof sourceTab.click === 'function') sourceTab.click();
        var target = null;
        Array.prototype.some.call(document.querySelectorAll('[data-source-id]'), function (candidate) {
          if (candidate.getAttribute('data-source-id') !== reference) return false;
          target = candidate;
          return true;
        });
        if (!target) return false;
        if (!target.hasAttribute('tabindex') && target.tagName !== 'A') target.tabIndex = -1;
        target.scrollIntoView({ block: 'nearest' });
        try { target.focus({ preventScroll: true }); }
        catch (_) { try { target.focus(); } catch (_) {} }
        return true;
      }

      function appendSourceAction(parent, id, reference) {
        var source = sourceFor(id, reference);
        if (!source) return null;
        var roleLabel = source.role
          ? viewerText('viewer.internalStructure.sourceRole.' + source.role)
          : viewerText('viewer.internalStructure.evidenceLink');
        var label = roleLabel + ' · ' + sourceLocation(source);
        var action;
        if (source.href) {
          action = textElement('a', 'node-structure-source', parent, label);
          action.href = source.href;
          action.target = '_blank';
          action.rel = 'noopener noreferrer';
          action.referrerPolicy = 'no-referrer';
        } else {
          action = textElement('button', 'node-structure-source', parent, label);
          action.type = 'button';
          action.addEventListener('click', function () { activateSource(id, reference); });
        }
        action.setAttribute('data-structure-source-ref', reference);
        return action;
      }

      function installStyles() {
        if (document.querySelector('style[data-internal-structure-style]')) return;
        var style = document.createElement('style');
        style.setAttribute('data-internal-structure-style', '');
        style.textContent = [
          '.node-structure-quicklook[hidden],.node-internal-structure[hidden],.node-structure-body[hidden],.node-structure-actions button[hidden]{display:none!important}',
          '.node-structure-quicklook{display:grid;gap:.55rem;margin-top:.7rem;padding-top:.72rem;border-top:1px solid var(--toolbar-border);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
          '.node-structure-quicklook h3{margin:0;color:var(--text-muted);font-size:.62rem;font-weight:750;letter-spacing:.08em;text-transform:uppercase}',
          '.node-structure-entry-list{display:grid;gap:.45rem}.node-structure-entry{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.1rem .55rem;width:100%;min-height:44px;padding:.55rem .62rem;border:1px solid var(--toolbar-border);border-radius:.65rem;background:color-mix(in srgb,var(--panel) 78%,transparent);color:var(--text);font:inherit;text-align:left;cursor:pointer}',
          '.node-structure-entry:hover{border-color:color-mix(in srgb,var(--frontend-stroke) 55%,var(--toolbar-border));background:color-mix(in srgb,var(--panel) 62%,var(--frontend-fill))}.node-structure-entry strong{font-size:.72rem;line-height:1.4}.node-structure-entry small{grid-column:1;color:var(--text-muted);font-size:.61rem;line-height:1.45}.node-structure-entry-count{grid-column:2;grid-row:1/3;align-self:center;color:var(--text-muted);font-size:.61rem}',
          '.node-structure-actions button,.node-structure-source{border:0;background:none;color:color-mix(in srgb,var(--frontend-stroke) 80%,var(--text));font:inherit;cursor:pointer;text-align:left}.node-structure-source{user-select:text;-webkit-user-select:text}',
          'html[data-reader-surface="structure"] .guided-views,html[data-reader-surface="structure"] .diagram-container,html[data-reader-surface="structure"] .cards{display:none!important}',
          '.node-internal-structure{box-sizing:border-box;width:100%;max-width:var(--archify-reader-width,1440px);margin:0 auto;padding:1.35rem 0 3rem;color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
          'html[data-atlas-layout="rail"] .node-internal-structure{margin-left:var(--atlas-reader-offset);margin-right:0}',
          '.node-structure-workspace{min-width:0}.node-structure-document{width:min(100%,76rem);min-width:0;margin:0 auto}',
          '.node-structure-actions{display:flex;flex-wrap:wrap;gap:.5rem 1.45rem;align-items:center;margin-bottom:1.2rem}.node-structure-actions button{min-height:44px;padding:.35rem 0;font-size:.78rem;font-weight:650}',
          '.node-structure-lead{max-width:52rem;padding-bottom:1.2rem}.node-structure-eyebrow{margin:0 0 .35rem;color:color-mix(in srgb,var(--frontend-stroke) 82%,var(--text));font-size:.67rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}',
          '.node-structure-title{margin:0;color:var(--text);font-size:clamp(1.55rem,3vw,2.45rem);line-height:1.15;letter-spacing:-.025em;overflow-wrap:anywhere}.node-structure-summary{margin:.75rem 0 0;color:var(--text-muted);font-size:.92rem;line-height:1.65}.node-structure-status{margin:.65rem 0 0;color:var(--security-stroke);font-size:.76rem;line-height:1.55}',
          '.node-structure-modes{display:inline-flex;gap:.2rem;margin:.1rem 0 1rem;padding:.22rem;border:1px solid var(--toolbar-border);border-radius:.72rem;background:color-mix(in srgb,var(--panel) 76%,transparent)}.node-structure-mode{min-height:44px;padding:.42rem .8rem;border:0;border-radius:.52rem;background:transparent;color:var(--text-muted);font:650 .76rem/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}.node-structure-mode[aria-selected="true"]{background:var(--panel);color:var(--text);box-shadow:0 1px 4px color-mix(in srgb,var(--text) 12%,transparent)}',
          '.node-structure-body{display:grid;grid-template-columns:minmax(15rem,21rem) minmax(0,1fr);min-height:28rem;border:1px solid var(--toolbar-border);border-radius:1rem;background:color-mix(in srgb,var(--panel) 82%,transparent);overflow:hidden}',
          '.node-structure-tree-panel{min-width:0;padding:1rem;border-right:1px solid var(--toolbar-border);background:color-mix(in srgb,var(--panel) 88%,transparent)}.node-structure-tree-heading,.node-structure-detail-label{margin:0 0 .7rem;color:var(--text-muted);font-size:.62rem;font-weight:750;letter-spacing:.08em;text-transform:uppercase}',
          '.node-structure-tree,.node-structure-tree-group{display:grid;gap:.12rem;margin:0;padding:0;list-style:none}.node-structure-tree-group{padding-left:1rem;border-left:1px solid color-mix(in srgb,var(--toolbar-border) 76%,transparent)}.node-structure-treeitem{display:grid;grid-template-columns:1rem minmax(0,1fr);gap:.35rem;align-items:center;width:100%;min-height:44px;padding:.35rem .45rem;border:0;border-radius:.48rem;background:transparent;color:var(--text-muted);font:inherit;text-align:left;cursor:pointer}.node-structure-treeitem::before{content:"";width:.38rem;height:.38rem;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:rotate(-45deg);opacity:.55}.node-structure-treeitem[aria-expanded="true"]::before{transform:rotate(45deg)}.node-structure-treeitem:not([aria-expanded])::before{border:0;border-radius:50%;background:currentColor;transform:none;opacity:.42}.node-structure-treeitem[aria-selected="true"]{background:color-mix(in srgb,var(--frontend-fill) 64%,var(--panel));color:var(--text);font-weight:680}',
          '.node-structure-detail{display:grid;align-content:start;gap:1rem;min-width:0;padding:clamp(1rem,3vw,2rem)}.node-structure-item-heading{display:flex;flex-wrap:wrap;gap:.45rem .7rem;align-items:center}.node-structure-item-heading h3{margin:0;color:var(--text);font-size:1.35rem;line-height:1.25}.node-structure-kind{padding:.18rem .42rem;border:1px solid var(--toolbar-border);border-radius:999px;color:var(--text-muted);font-size:.62rem}.node-structure-item-summary{margin:0;color:var(--text-muted);font-size:.88rem;line-height:1.7}.node-structure-code{display:block;max-width:100%;padding:.62rem .72rem;border:1px solid var(--toolbar-border);border-radius:.55rem;background:color-mix(in srgb,var(--panel) 70%,transparent);color:var(--text);font:.76rem/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}',
          '.node-structure-section-block{display:grid;gap:.5rem;padding-top:.85rem;border-top:1px solid var(--toolbar-border)}.node-structure-section-block h4{margin:0;color:var(--text-muted);font-size:.66rem;font-weight:750;letter-spacing:.06em;text-transform:uppercase}.node-structure-relations{display:grid;gap:.42rem;margin:0;padding:0;list-style:none}.node-structure-relation{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.18rem .55rem;padding:.55rem .62rem;border:1px solid var(--toolbar-border);border-radius:.55rem}.node-structure-relation-kind{color:color-mix(in srgb,var(--frontend-stroke) 82%,var(--text));font-size:.66rem;font-weight:750}.node-structure-relation strong{font-size:.76rem}.node-structure-relation small{grid-column:2;color:var(--text-muted);font-size:.66rem}',
          '.node-structure-sources{display:flex;flex-wrap:wrap;gap:.35rem .75rem}.node-structure-source{display:inline-flex;align-items:center;min-height:44px;padding:.1rem 0;font-size:.69rem;line-height:1.45;text-decoration:none;overflow-wrap:anywhere}',
          '.node-structure-entry:focus-visible,.node-structure-actions button:focus-visible,.node-structure-source:focus-visible,.node-structure-mode:focus-visible,.node-structure-treeitem:focus-visible,.node-structure-title:focus-visible{outline:2px solid var(--frontend-stroke);outline-offset:2px}',
          '@media(max-width:1023px){.node-internal-structure{padding-top:1rem}.node-structure-body{grid-template-columns:minmax(0,1fr)}.node-structure-tree-panel{border-right:0;border-bottom:1px solid var(--toolbar-border)}.node-structure-tree{max-height:none}.node-structure-detail{min-height:18rem}}',
          '@media(max-width:720px){.node-internal-structure{padding:1rem 0 2rem}.node-structure-title{font-size:1.55rem}.node-structure-summary{font-size:.86rem}.node-structure-body{border-radius:.75rem}}',
          '@media print{.node-internal-structure{display:none!important}html[data-reader-surface="structure"] .diagram-container{display:block!important}}'
        ].join('');
        document.head.appendChild(style);
      }

      function sectionItems(structure, section) {
        return Array.isArray(structure && structure.items) ? structure.items.filter(function (item) {
          return item && item.domain === section;
        }) : [];
      }

      function validSections(structure) {
        return sectionKinds.filter(function (section) { return sectionItems(structure, section).length; })
          .map(function (section) { return { kind: section, items: sectionItems(structure, section) }; });
      }

      function sectionHint(kind) {
        return viewerText('viewer.internalStructure.section.' + kind + 'Hint');
      }

      function ensureQuicklook() {
        if (quicklook || !detail || !payload || !structureNodes().length) return quicklook;
        installStyles();
        quicklook = textElement('section', 'node-structure-quicklook', null);
        quicklook.id = 'focus-internal-structure';
        quicklook.hidden = true;
        quicklook.setAttribute('aria-labelledby', 'focus-internal-structure-heading');
        var heading = textElement('h3', '', quicklook, viewerText('viewer.internalStructure.overview'));
        heading.id = 'focus-internal-structure-heading';
        var entries = textElement('div', 'node-structure-entry-list', quicklook);
        entries.id = 'focus-internal-structure-entries';
        var feedback = textElement('p', 'node-structure-status', quicklook);
        feedback.id = 'focus-structure-feedback';
        feedback.setAttribute('role', 'status');
        detail.after(quicklook);
        return quicklook;
      }

      function clearQuicklook() {
        if (!quicklook) return;
        quicklook.hidden = true;
        var entries = document.getElementById('focus-internal-structure-entries');
        var feedback = document.getElementById('focus-structure-feedback');
        if (entries) entries.textContent = '';
        if (feedback) feedback.textContent = '';
      }

      function renderQuicklook(id) {
        var structure = node(id);
        var root = ensureQuicklook();
        if (!root || !structure) { clearQuicklook(); return false; }
        var entries = document.getElementById('focus-internal-structure-entries');
        var feedback = document.getElementById('focus-structure-feedback');
        entries.textContent = '';
        validSections(structure).forEach(function (section) {
          var action = textElement('button', 'node-structure-entry', entries);
          action.type = 'button';
          action.id = 'focus-internal-structure-' + section.kind;
          action.setAttribute('data-structure-entry', section.kind);
          textElement('strong', '', action, sectionLabel(section.kind));
          textElement('small', '', action, sectionHint(section.kind));
          textElement('span', 'node-structure-entry-count', action,
            viewerText('viewer.internalStructure.itemCount', { count: section.items.length }));
          action.addEventListener('click', function () { open(id, { section: section.kind }); });
        });
        feedback.textContent = '';
        root.hidden = !entries.children.length;
        return !root.hidden;
      }

      function ensureStructureRoot() {
        if (structureRoot) return structureRoot;
        installStyles();
        var shell = document.querySelector('.container');
        if (!shell) return null;
        structureRoot = textElement('main', 'node-internal-structure no-print', null);
        structureRoot.id = 'node-internal-structure';
        structureRoot.hidden = true;
        structureRoot.inert = true;
        structureRoot.setAttribute('inert', '');
        structureRoot.setAttribute('aria-hidden', 'true');
        var workspace = textElement('div', 'node-structure-workspace', structureRoot);
        var structureDocument = textElement('div', 'node-structure-document', workspace);
        structureActions = textElement('div', 'node-structure-actions', structureDocument);
        var back = textElement('button', '', structureActions, viewerText('viewer.internalStructure.backToDiagram'));
        back.id = 'node-structure-back';
        back.type = 'button';
        back.addEventListener('click', function () { close({ restoreFocus: true }); });
        structureCopy = textElement('button', '', structureActions, viewerText('viewer.internalStructure.copyLink'));
        structureCopy.id = 'node-structure-copy';
        structureCopy.type = 'button';
        structureCopy.addEventListener('click', copyLink);
        structureRelations = textElement('button', '', structureActions, viewerText('viewer.passport.relations'));
        structureRelations.id = 'node-structure-relations';
        structureRelations.type = 'button';
        structureRelations.addEventListener('click', function () { showNodeInformation('relationships'); });
        structureSourcesAction = textElement('button', '', structureActions, viewerText('viewer.internalStructure.evidenceLink'));
        structureSourcesAction.id = 'node-structure-sources';
        structureSourcesAction.type = 'button';
        structureSourcesAction.addEventListener('click', function () { showNodeInformation('sources'); });
        var lead = textElement('header', 'node-structure-lead', structureDocument);
        textElement('p', 'node-structure-eyebrow', lead, viewerText('viewer.internalStructure.overview'));
        structureTitle = textElement('h2', 'node-structure-title', lead);
        structureTitle.id = 'node-structure-title';
        structureTitle.tabIndex = -1;
        structureSummary = textElement('p', 'node-structure-summary', lead, viewerText('viewer.internalStructure.summary'));
        structureFeedback = textElement('p', 'node-structure-status', lead);
        structureFeedback.id = 'node-structure-feedback';
        structureFeedback.setAttribute('role', 'status');
        structureModes = textElement('div', 'node-structure-modes', structureDocument);
        structureModes.setAttribute('role', 'tablist');
        structureModes.setAttribute('aria-label', viewerText('viewer.internalStructure.overview'));
        structureBody = textElement('div', 'node-structure-body', structureDocument);
        structureBody.id = 'node-structure-body';
        structureBody.setAttribute('role', 'tabpanel');
        var treePanel = textElement('nav', 'node-structure-tree-panel', structureBody);
        treePanel.setAttribute('aria-label', viewerText('viewer.internalStructure.tree'));
        textElement('p', 'node-structure-tree-heading', treePanel, viewerText('viewer.internalStructure.tree'));
        structureTree = textElement('div', '', treePanel);
        structureTree.id = 'node-structure-tree';
        structureDetail = textElement('article', 'node-structure-detail', structureBody);
        structureDetail.id = 'node-structure-detail';
        structureRoot.setAttribute('aria-labelledby', structureTitle.id);
        shell.after(structureRoot);
        return structureRoot;
      }

      function appendSources(parent, id, references) {
        if (!Array.isArray(references) || !references.length) return;
        var sources = textElement('div', 'node-structure-sources', parent);
        references.forEach(function (reference) { appendSourceAction(sources, id, reference); });
        if (!sources.children.length) sources.remove();
      }

      function structureHash(id, section, item) {
        var current = new URLSearchParams(ArchifyAddress.location.hash.replace(/^#/, ''));
        var next = new URLSearchParams();
        if (current.get('diagram')) next.set('diagram', current.get('diagram'));
        next.set('focus', id);
        next.set('inspect', 'structure');
        if (section) next.set('section', section);
        if (item) next.set('item', item);
        return '#' + next.toString();
      }

      function graphHash(id) {
        var current = new URLSearchParams(ArchifyAddress.location.hash.replace(/^#/, ''));
        var next = new URLSearchParams();
        if (current.get('diagram')) next.set('diagram', current.get('diagram'));
        if (id) next.set('focus', id);
        return '#' + next.toString();
      }

      function standaloneHistoryState(base, surface, href, nodeId, graphHref, reading) {
        var state = base && typeof base === 'object' && !Array.isArray(base)
          ? Object.assign({}, base) : {};
        state.archifyInternalStructure = {
          surface: surface,
          href: href,
          nodeId: nodeId,
          graphHref: graphHref || null,
          reading: reading
        };
        return state;
      }

      function storedStandaloneReading(state, href) {
        var record = state && state.archifyInternalStructure;
        if (!record || (record.surface !== 'graph' && record.surface !== 'structure') ||
            record.href !== href || !record.reading || record.reading.surface !== record.surface) return null;
        return record.reading;
      }

      function replaceStandaloneReading(url) {
        if (ArchifyAddress.context || pendingOpen) return false;
        var record = history.state && history.state.archifyInternalStructure;
        if (!record || record.surface !== currentSurface ||
            (currentSurface === 'structure' && record.nodeId !== currentNodeId)) return false;
        var href;
        try { href = new URL(url || location.href, location.href).href; }
        catch (_) { return false; }
        var reading = snapshot();
        var next = standaloneHistoryState(history.state, currentSurface, href,
          currentSurface === 'structure' ? currentNodeId : reading.nodeId,
          record.graphHref, reading);
        history.replaceState(next, '', url || location.href);
        return true;
      }

      function scheduleStandaloneReadingSave() {
        if (ArchifyAddress.context || standaloneSaveFrame !== null) return;
        standaloneSaveFrame = requestAnimationFrame(function () {
          standaloneSaveFrame = null;
          var record = history.state && history.state.archifyInternalStructure;
          if (!record || record.href !== location.href || record.surface !== currentSurface) return;
          replaceStandaloneReading(location.href);
        });
      }

      function itemById(structure, itemId) {
        var items = Array.isArray(structure && structure.items) ? structure.items : [];
        for (var index = 0; index < items.length; index += 1) {
          if (items[index] && items[index].id === itemId) return items[index];
        }
        return null;
      }

      function relationLabel(kind) {
        return viewerText('viewer.internalStructure.relation.' + kind);
      }

      function kindLabel(kind) {
        return viewerText('viewer.internalStructure.kind.' + kind);
      }

      function updateModes() {
        if (!structureModes) return;
        Array.prototype.forEach.call(structureModes.querySelectorAll('[data-structure-section]'), function (button) {
          var selected = button.getAttribute('data-structure-section') === currentSection;
          button.setAttribute('aria-selected', selected ? 'true' : 'false');
          button.tabIndex = selected ? 0 : -1;
          button.setAttribute('aria-controls', 'node-structure-body');
          if (selected) structureBody.setAttribute('aria-labelledby', button.id);
        });
      }

      function renderDetail(structure, item) {
        if (!structureDetail || !item) return false;
        structureDetail.textContent = '';
        textElement('p', 'node-structure-detail-label', structureDetail, viewerText('viewer.internalStructure.detail'));
        var heading = textElement('div', 'node-structure-item-heading', structureDetail);
        var title = textElement('h3', '', heading, item.label);
        title.id = 'node-structure-item-title';
        textElement('span', 'node-structure-kind', heading, kindLabel(item.kind));
        var summaryBlock = textElement('section', 'node-structure-section-block', structureDetail);
        textElement('h4', '', summaryBlock, viewerText('viewer.internalStructure.agentSummary'));
        textElement('p', 'node-structure-item-summary', summaryBlock, item.summary);
        if (item.signature || item.valueType) {
          var contract = textElement('section', 'node-structure-section-block', structureDetail);
          textElement('h4', '', contract, item.signature
            ? viewerText('viewer.internalStructure.signature')
            : viewerText('viewer.internalStructure.valueType'));
          textElement('code', 'node-structure-code', contract, item.signature || item.valueType);
        }
        var related = (structure.relations || []).filter(function (relation) {
          return relation && (relation.from === item.id || relation.to === item.id);
        });
        if (related.length) {
          var relationBlock = textElement('section', 'node-structure-section-block', structureDetail);
          textElement('h4', '', relationBlock, viewerText('viewer.internalStructure.relations'));
          var relationList = textElement('ul', 'node-structure-relations', relationBlock);
          related.forEach(function (relation) {
            var outgoing = relation.from === item.id;
            var peer = itemById(structure, outgoing ? relation.to : relation.from);
            var row = textElement('li', 'node-structure-relation', relationList);
            textElement('span', 'node-structure-relation-kind', row,
              (outgoing ? '→ ' : '← ') + relationLabel(relation.kind));
            textElement('strong', '', row, peer ? peer.label : (outgoing ? relation.to : relation.from));
            if (relation.label) textElement('small', '', row, relation.label);
            appendSources(row, currentNodeId, relation.sourceRefs);
          });
        }
        if (Array.isArray(item.sourceRefs) && item.sourceRefs.length) {
          var evidence = textElement('section', 'node-structure-section-block', structureDetail);
          textElement('h4', '', evidence, viewerText('viewer.internalStructure.sourceVerified'));
          appendSources(evidence, currentNodeId, item.sourceRefs);
        }
        structureDetail.setAttribute('aria-labelledby', title.id);
        return true;
      }

      function visibleTreeItems() {
        return structureTree ? Array.prototype.slice.call(structureTree.querySelectorAll('[role="treeitem"]')) : [];
      }

      function focusTreeNeighbor(button, offset) {
        var visible = visibleTreeItems();
        var index = visible.indexOf(button);
        var target = visible[index + offset];
        if (target) focusTreeItem(target);
      }

      function focusTreeItem(target) {
        if (!target) return;
        visibleTreeItems().forEach(function (button) { button.tabIndex = button === target ? 0 : -1; });
        target.focus();
      }

      function selectItem(itemId, options) {
        options = options || {};
        var structure = node(currentNodeId);
        var item = itemById(structure, itemId);
        if (!item || item.domain !== currentSection) return false;
        currentItemId = item.id;
        stateForNode(currentNodeId)[currentSection].item = item.id;
        Array.prototype.forEach.call(structureTree.querySelectorAll('[role="treeitem"]'), function (button) {
          var selected = button.getAttribute('data-structure-item') === item.id;
          button.setAttribute('aria-selected', selected ? 'true' : 'false');
          button.tabIndex = selected ? 0 : -1;
        });
        renderDetail(structure, item);
        if (options.updateUrl !== false && !pendingOpen) {
          var url = ArchifyAddress.location.pathname + ArchifyAddress.location.search + structureHash(currentNodeId, currentSection, currentItemId);
          if (ArchifyAddress.context) {
            ArchifyAddress.replaceState(history.state, '', url);
            ArchifyAddress.settled();
          } else replaceStandaloneReading(url);
        }
        return true;
      }

      function renderTree(structure) {
        structureTree.textContent = '';
        var items = sectionItems(structure, currentSection);
        var children = Object.create(null);
        items.forEach(function (item) {
          var parent = item.parent || '';
          if (!children[parent]) children[parent] = [];
          children[parent].push(item);
        });
        var state = stateForNode(currentNodeId)[currentSection];
        (children[''] || []).forEach(function (root) {
          if (!own(state.expanded, root.id)) state.expanded[root.id] = true;
        });
        var rootList = textElement('ul', 'node-structure-tree', structureTree);
        rootList.setAttribute('role', 'tree');
        rootList.setAttribute('aria-label', sectionLabel(currentSection));

        function appendBranch(parent, item, level) {
          var wrapper = textElement('li', '', parent);
          wrapper.setAttribute('role', 'none');
          var descendants = children[item.id] || [];
          var button = textElement('button', 'node-structure-treeitem', wrapper, item.label);
          button.type = 'button';
          button.id = 'node-structure-treeitem-' + item.id;
          button.setAttribute('role', 'treeitem');
          button.setAttribute('aria-level', String(level));
          button.setAttribute('data-structure-item', item.id);
          button.setAttribute('aria-selected', item.id === currentItemId ? 'true' : 'false');
          button.tabIndex = item.id === currentItemId ? 0 : -1;
          if (descendants.length) button.setAttribute('aria-expanded', state.expanded[item.id] ? 'true' : 'false');
          button.addEventListener('click', function () {
            if (item.id === currentItemId && descendants.length) {
              state.expanded[item.id] = !state.expanded[item.id];
              renderTree(structure);
              var restored = document.getElementById('node-structure-treeitem-' + item.id);
              if (restored) focusTreeItem(restored);
            }
            selectItem(item.id);
          });
          button.addEventListener('keydown', function (event) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              focusTreeNeighbor(button, event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'ArrowRight' && descendants.length) {
              event.preventDefault();
              if (!state.expanded[item.id]) { state.expanded[item.id] = true; renderTree(structure); }
              var child = document.getElementById('node-structure-treeitem-' + descendants[0].id);
              if (child) focusTreeItem(child);
            } else if (event.key === 'ArrowLeft') {
              event.preventDefault();
              if (descendants.length && state.expanded[item.id]) {
                state.expanded[item.id] = false; renderTree(structure);
                var same = document.getElementById('node-structure-treeitem-' + item.id);
                if (same) focusTreeItem(same);
              } else if (item.parent) {
                var parentButton = document.getElementById('node-structure-treeitem-' + item.parent);
                if (parentButton) focusTreeItem(parentButton);
              }
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              selectItem(item.id);
            }
          });
          if (descendants.length && state.expanded[item.id]) {
            var group = textElement('ul', 'node-structure-tree-group', wrapper);
            group.setAttribute('role', 'group');
            descendants.forEach(function (child) { appendBranch(group, child, level + 1); });
          }
        }
        (children[''] || []).forEach(function (item) { appendBranch(rootList, item, 1); });
      }

      function renderModes(structure) {
        var sections = validSections(structure);
        structureModes.hidden = sections.length < 2;
        var existing = Array.prototype.map.call(structureModes.querySelectorAll('[data-structure-section]'), function (button) {
          return button.getAttribute('data-structure-section');
        });
        var expected = sections.map(function (section) { return section.kind; });
        if (existing.join('|') !== expected.join('|')) {
          structureModes.textContent = '';
          sections.forEach(function (section) {
            var button = textElement('button', 'node-structure-mode', structureModes, sectionLabel(section.kind));
            button.id = 'node-structure-mode-' + section.kind;
            button.type = 'button';
            button.setAttribute('role', 'tab');
            button.setAttribute('data-structure-section', section.kind);
            button.addEventListener('click', function () { showSection(section.kind, { focusMode: true }); });
            button.addEventListener('keydown', function (event) {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              var buttons = Array.prototype.slice.call(structureModes.querySelectorAll('[data-structure-section]'));
              var index = buttons.indexOf(button);
              var next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
              event.preventDefault();
              event.stopPropagation();
              showSection(buttons[next].getAttribute('data-structure-section'), { focusMode: true });
            });
          });
        }
        updateModes();
      }

      function revealItemAncestors(structure, item, state) {
        var cursor = item;
        while (cursor && cursor.parent) {
          state.expanded[cursor.parent] = true;
          cursor = itemById(structure, cursor.parent);
        }
      }

      function showSection(section, options) {
        options = options || {};
        var structure = node(currentNodeId);
        var sections = validSections(structure);
        if (!structureRoot || currentSurface !== 'structure' ||
            !sections.some(function (candidate) { return candidate.kind === section; })) return false;
        currentSection = section;
        var items = sectionItems(structure, section);
        var state = stateForNode(currentNodeId)[section];
        var requested = options.item || state.item;
        var selected = itemById(structure, requested);
        if (!selected || selected.domain !== section) selected = items.filter(function (item) { return !item.parent; })[0] || items[0];
        currentItemId = selected.id;
        state.item = selected.id;
        if (options.item) revealItemAncestors(structure, selected, state);
        updateModes();
        renderTree(structure);
        renderDetail(structure, selected);
        structureRoot.setAttribute('data-structure-section', section);
        if (options.updateUrl !== false && !pendingOpen) {
          var url = ArchifyAddress.location.pathname + ArchifyAddress.location.search + structureHash(currentNodeId, section, selected.id);
          if (ArchifyAddress.context) {
            ArchifyAddress.replaceState(history.state, '', url);
            ArchifyAddress.settled();
          } else replaceStandaloneReading(url);
        }
        if (options.focusMode) {
          var mode = document.getElementById('node-structure-mode-' + section);
          if (mode) mode.focus({ preventScroll: true });
        }
        return true;
      }

      function renderStructure(id, requestedSection, requestedItem) {
        var root = ensureStructureRoot();
        var structure = node(id);
        if (!root || !structure) return false;
        var sections = validSections(structure);
        if (!sections.length) return false;
        currentNodeId = id;
        currentSection = sections.some(function (section) { return section.kind === requestedSection; })
          ? requestedSection : sections[0].kind;
        var items = sectionItems(structure, currentSection);
        var state = stateForNode(id)[currentSection];
        var selected = itemById(structure, requestedItem || state.item);
        if (!selected || selected.domain !== currentSection) selected = items.filter(function (item) { return !item.parent; })[0] || items[0];
        currentItemId = selected.id;
        state.item = selected.id;
        if (requestedItem) revealItemAncestors(structure, selected, state);
        structureTitle.textContent = labelFor(id) + ' · ' + viewerText('viewer.internalStructure.overview');
        structureSummary.textContent = viewerText('viewer.internalStructure.summary');
        structureFeedback.textContent = '';
        structureCopy.hidden = false;
        structureRelations.hidden = false;
        structureSourcesAction.hidden = false;
        structureBody.hidden = false;
        renderModes(structure);
        renderTree(structure);
        renderDetail(structure, selected);
        root.setAttribute('data-node-id', id);
        root.setAttribute('data-structure-state', 'ready');
        root.setAttribute('data-structure-section', currentSection);
        return true;
      }

      function showNodeInformation(kind) {
        if (ArchifyAddress.context) {
          ArchifyAddress.send('structure-return', { information: kind });
          return;
        }
        pendingGraphInformation = kind;
        close({ restoreFocus: false });
        if (currentSurface === 'graph') applyGraphInformation();
      }

      function applyGraphInformation() {
        var kind = pendingGraphInformation;
        if (!kind || currentSurface !== 'graph') return false;
        pendingGraphInformation = null;
        var requestedSource = pendingGraphSource;
        pendingGraphSource = null;
        var tab = document.getElementById('atlas-tab-' + kind);
        if (tab && typeof tab.click === 'function') {
          tab.click();
          var inspector = document.querySelector('.atlas-inspector');
          if (inspector) inspector.scrollIntoView({ block: 'start' });
          if (kind === 'sources' && requestedSource) activateSource(requestedSource.id, requestedSource.reference);
          return true;
        }
        if (kind === 'relationships') {
          var relations = document.getElementById('btn-focus-relations');
          if (relations && relations.getAttribute('aria-expanded') !== 'true') relations.click();
          if (chip) chip.scrollIntoView({ block: 'nearest' });
        } else {
          var evidence = document.getElementById('focus-evidence');
          if (evidence && !evidence.hidden) evidence.scrollIntoView({ block: 'nearest' });
          if (requestedSource) activateSource(requestedSource.id, requestedSource.reference);
        }
        return true;
      }

      function renderError(id, key, state) {
        var root = ensureStructureRoot();
        if (!root) return false;
        structureTitle.textContent = labelFor(id);
        structureSummary.textContent = viewerText(key || 'viewer.internalStructure.error');
        structureFeedback.textContent = '';
        structureCopy.hidden = true;
        structureRelations.hidden = state !== 'empty';
        structureSourcesAction.hidden = state !== 'empty';
        structureBody.hidden = true;
        structureModes.textContent = '';
        structureDetail.textContent = '';
        structureTree.textContent = '';
        structureRoot.setAttribute('data-node-id', id || 'unknown');
        structureRoot.setAttribute('data-structure-state', state || 'error');
        structureRoot.removeAttribute('data-structure-section');
        currentSection = null;
        currentItemId = null;
        return true;
      }

      function rememberElement(element) {
        return element ? {
          element: element,
          hidden: element.hidden,
          inert: element.hasAttribute('inert'),
          ariaHidden: element.getAttribute('aria-hidden')
        } : null;
      }

      function hideElement(state) {
        if (!state) return;
        state.element.hidden = true;
        state.element.inert = true;
        state.element.setAttribute('aria-hidden', 'true');
      }

      function restoreElement(state) {
        if (!state) return;
        state.element.hidden = state.hidden;
        state.element.inert = state.inert;
        if (state.ariaHidden == null) state.element.removeAttribute('aria-hidden');
        else state.element.setAttribute('aria-hidden', state.ariaHidden);
      }

      function prepareStructurePrint() {
        if (currentSurface !== 'structure') return;
        (graphState || []).forEach(restoreElement);
      }

      function finishStructurePrint() {
        if (currentSurface !== 'structure') return;
        (graphState || []).forEach(hideElement);
      }

      function dispatchReady(nodeId, section) {
        window.dispatchEvent(new CustomEvent('archify:structure-ready', {
          detail: { nodeId: nodeId, section: section, surface: 'structure' }
        }));
      }

      function settled(nodeId, section, emitReady, emitError) {
        var revision = ++surfaceRevision;
        return Promise.resolve().then(function () {
          if (Archify.readerLayout && typeof Archify.readerLayout.schedule === 'function') Archify.readerLayout.schedule();
          return Archify.readerLayout && typeof Archify.readerLayout.whenStable === 'function'
            ? Archify.readerLayout.whenStable() : null;
        }).then(function () {
          if (revision !== surfaceRevision || currentSurface !== 'structure' || currentNodeId !== nodeId) return;
          if (emitReady !== false) dispatchReady(nodeId, section);
          if (ArchifyAddress.context) ArchifyAddress.settled();
        }).catch(function (error) {
          if (revision !== surfaceRevision || currentSurface !== 'structure' || currentNodeId !== nodeId) return;
          if (emitError !== false) {
            window.dispatchEvent(new CustomEvent('archify:structure-error', {
              detail: { nodeId: nodeId, message: error && error.message ? error.message : String(error) }
            }));
          }
          throw error;
        });
      }

      function activateStructure(id, section, options) {
        options = options || {};
        if (!structureRoot) return false;
        if (currentSurface === 'structure' && currentNodeId === id) {
          if (section && (section !== currentSection || options.item !== currentItemId)) showSection(section, { updateUrl: false, item: options.item });
          if (options.forceSettle) surfaceReady = settled(id, currentSection, options.emitReady, options.emitError);
          return true;
        }
        if (currentSurface === 'structure') {
          currentNodeId = id;
          currentSection = section;
          updateModes();
          if (options.scroll !== false) window.scrollTo(0, 0);
          if (options.focus !== false) structureTitle.focus({ preventScroll: true });
          surfaceReady = settled(id, currentSection, options.emitReady, options.emitError);
          return true;
        }
        graphScrollY = window.scrollY;
        graphState = [rememberElement(guided), rememberElement(diagram), rememberElement(cards)];
        graphState.forEach(hideElement);
        currentSurface = 'structure';
        currentNodeId = id;
        html.setAttribute('data-reader-surface', 'structure');
        structureRoot.hidden = false;
        structureRoot.inert = false;
        structureRoot.removeAttribute('inert');
        structureRoot.removeAttribute('aria-hidden');
        if (section) currentSection = section;
        updateModes();
        if (options.scroll !== false) window.scrollTo(0, 0);
        if (options.focus !== false) structureTitle.focus({ preventScroll: true });
        surfaceReady = settled(id, currentSection, options.emitReady, options.emitError);
        return true;
      }

      function deactivateStructure(options) {
        options = options || {};
        if (currentSurface !== 'structure') return false;
        surfaceRevision += 1;
        pendingOpen = null;
        structureRoot.hidden = true;
        structureRoot.inert = true;
        structureRoot.setAttribute('inert', '');
        structureRoot.setAttribute('aria-hidden', 'true');
        (graphState || []).forEach(restoreElement);
        graphState = null;
        currentSurface = 'graph';
        currentNodeId = null;
        currentSection = null;
        currentItemId = null;
        html.setAttribute('data-reader-surface', 'graph');
        if (Archify.readerLayout && typeof Archify.readerLayout.schedule === 'function') Archify.readerLayout.schedule();
        if (options.restoreScroll !== false) requestAnimationFrame(function () { window.scrollTo(0, graphScrollY); });
        if (options.restoreFocus) {
          var id = Archify.focus && Archify.focus.active();
          var target = null;
          Array.prototype.some.call(document.querySelectorAll('[data-node-id]'), function (candidate) {
            if (candidate.getAttribute('data-node-id') !== id) return false;
            target = candidate;
            return true;
          });
          if (target) target.focus({ preventScroll: true });
        }
        return true;
      }

      function userError(id, error) {
        var feedback = document.getElementById('focus-structure-feedback');
        if (feedback) feedback.textContent = viewerText('viewer.internalStructure.error');
        window.dispatchEvent(new CustomEvent('archify:structure-error', {
          detail: { nodeId: id, message: error && error.message ? error.message : String(error) }
        }));
      }

      function addressError(id, message) {
        var error = new Error(message);
        window.dispatchEvent(new CustomEvent('archify:structure-error', {
          detail: { nodeId: id || null, message: message }
        }));
        return surfaceReady.then(function () { throw error; });
      }

      function open(id, options) {
        options = options || {};
        var structure = node(id);
        if (!structure) return Promise.resolve(false);
        var sections = validSections(structure);
        if (!sections.length) return Promise.resolve(false);
        var requested = options.section || (currentSurface === 'structure' && currentNodeId === id ? currentSection : null);
        var section = sections.some(function (candidate) { return candidate.kind === requested; })
          ? requested : sections[0].kind;
        var requestedItem = options.item || (currentSurface === 'structure' && currentNodeId === id ? currentItemId : null);
        if (currentSurface === 'structure' && currentNodeId === id) {
          if (section !== currentSection || requestedItem !== currentItemId) showSection(section, { item: requestedItem });
          if (pendingOpen) {
            return surfaceReady.then(function () {
              return currentSurface === 'structure' && currentNodeId === id;
            }).catch(function () { return false; });
          }
          return Promise.resolve(true);
        }
        if (ArchifyAddress.context) {
          ArchifyAddress.send('navigate', { focus: id, inspect: 'structure', section: section, item: requestedItem || undefined });
          return Promise.resolve(true);
        }
        var trigger = pendingOpen ? pendingOpen.trigger : document.activeElement;
        var originalState = history.state;
        var graphHref = location.href;
        var graphReading = snapshot();
        var graphEntryCommitted = false;
        try {
          if (!renderStructure(id, section, requestedItem)) throw new Error('Internal structure could not be rendered.');
          var url = location.pathname + location.search + structureHash(id, section, currentItemId);
          if (!activateStructure(id, section, { emitReady: false, emitError: false })) {
            throw new Error('Internal structure surface could not be activated.');
          }
          var expectedRevision = surfaceRevision;
          pendingOpen = { revision: expectedRevision, trigger: trigger };
          return surfaceReady.then(function () {
            if (!pendingOpen || pendingOpen.revision !== expectedRevision ||
                expectedRevision !== surfaceRevision || currentSurface !== 'structure' || currentNodeId !== id) return false;
            url = location.pathname + location.search + structureHash(id, currentSection, currentItemId);
            var structureHref = new URL(url, location.href).href;
            var graphEntry = standaloneHistoryState(originalState, 'graph', graphHref, id, null, graphReading);
            var structureEntry = standaloneHistoryState(originalState, 'structure', structureHref, id, graphHref, snapshot());
            history.replaceState(graphEntry, '', graphHref);
            graphEntryCommitted = true;
            history.pushState(structureEntry, '', url);
            pendingOpen = null;
            dispatchReady(id, currentSection);
            return true;
          }).catch(function (error) {
            if (expectedRevision !== surfaceRevision || currentSurface !== 'structure' || currentNodeId !== id) return false;
            if (graphEntryCommitted) {
              try { history.replaceState(originalState, '', graphHref); } catch (_) {}
            }
            deactivateStructure({ restoreFocus: false, restoreScroll: true });
            if (trigger && trigger.isConnected && typeof trigger.focus === 'function') {
              try { trigger.focus({ preventScroll: true }); } catch (_) { try { trigger.focus(); } catch (_) {} }
            }
            userError(id, error);
            return false;
          });
        } catch (error) {
          if (currentSurface === 'structure' && currentNodeId === id) {
            deactivateStructure({ restoreFocus: false, restoreScroll: false });
          }
          userError(id, error);
          return Promise.resolve(false);
        }
      }

      function close(options) {
        options = options || {};
        if (currentSurface !== 'structure') return false;
        var id = currentNodeId;
        if (ArchifyAddress.context) {
          ArchifyAddress.send('structure-return');
          return true;
        }
        if (pendingOpen) {
          var trigger = pendingOpen.trigger;
          deactivateStructure({ restoreFocus: false });
          if (options.restoreFocus !== false && trigger && trigger.isConnected && typeof trigger.focus === 'function') {
            try { trigger.focus({ preventScroll: true }); } catch (_) { try { trigger.focus(); } catch (_) {} }
          }
          return true;
        }
        var provenance = history.state && history.state.archifyInternalStructure;
        if (provenance && provenance.nodeId === id && provenance.graphHref) {
          replaceStandaloneReading(location.href);
          history.back();
          return true;
        }
        var url = location.pathname + location.search + graphHash(id);
        history.replaceState(history.state, '', url);
        deactivateStructure({ restoreFocus: options.restoreFocus !== false });
        return true;
      }

      function copyLink() {
        if (!currentNodeId || !structureCopy) return Promise.resolve(false);
        var value = ArchifyAddress.share(structureHash(currentNodeId, currentSection, currentItemId));
        var copy = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
          ? navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return fallbackCopy(value); })
          : Promise.resolve(fallbackCopy(value));
        return copy.then(function (copied) {
          structureCopy.textContent = viewerText(copied ? 'viewer.internalStructure.copySuccess' : 'viewer.internalStructure.copyFailed');
          structureFeedback.textContent = copied ? '' : viewerText('viewer.internalStructure.copyFailed');
          window.setTimeout(function () {
            if (structureCopy) structureCopy.textContent = viewerText('viewer.internalStructure.copyLink');
          }, 1600);
          return copied;
        });
      }

      function syncAddress() {
        var params;
        try { params = new URLSearchParams(ArchifyAddress.location.hash.replace(/^#/, '')); }
        catch (error) { return Promise.reject(error); }
        var inspect = params.get('inspect');
        var id = params.get('focus');
        var requestedSection = params.get('section');
        var requestedItem = params.get('item');
        if ((inspect && inspect !== 'structure') || (!inspect && (requestedSection || requestedItem)) ||
            (requestedItem && !requestedSection)) {
          renderError(id, 'viewer.internalStructure.error');
          activateStructure(id || '', null, { focus: false, emitReady: false });
          return addressError(id, 'Invalid internal structure address.');
        }
        if (inspect !== 'structure') {
          if (currentSurface === 'structure') deactivateStructure({ restoreFocus: false });
          return Promise.resolve({ surface: 'graph', nodeId: null, section: null });
        }
        if (!id) {
          renderError('', 'viewer.internalStructure.error');
          activateStructure('', null, { focus: false, emitReady: false });
          return addressError('', 'Internal structure requires a focused node.');
        }
        if (!diagramHasNode(id)) {
          renderError(id, 'viewer.internalStructure.error');
          activateStructure(id, null, { focus: false, emitReady: false });
          return addressError(id, 'Unknown internal structure node ' + id + '.');
        }
        var structure = node(id);
        if (!structure) {
          renderError(id, 'viewer.internalStructure.empty', 'empty');
          activateStructure(id, null, { focus: false, emitReady: true });
          return surfaceReady.then(function () {
            return { surface: 'structure', nodeId: id, section: null, empty: true };
          });
        }
        var sections = validSections(structure);
        if (requestedSection && !sections.some(function (section) { return section.kind === requestedSection; })) {
          renderError(id, 'viewer.internalStructure.error');
          activateStructure(id, null, { focus: false, emitReady: false });
          return addressError(id, 'Unknown internal structure section ' + requestedSection + '.');
        }
        var section = requestedSection || sections[0].kind;
        var selected = requestedItem ? itemById(structure, requestedItem) : null;
        if (requestedItem && (!selected || selected.domain !== section)) {
          renderError(id, 'viewer.internalStructure.error');
          activateStructure(id, null, { focus: false, emitReady: false });
          return addressError(id, 'Unknown internal structure item ' + requestedItem + '.');
        }
        if (currentSurface === 'structure' && currentNodeId === id && structureRoot &&
            structureRoot.getAttribute('data-structure-state') === 'ready') {
          if (section !== currentSection || (requestedItem && requestedItem !== currentItemId)) showSection(section, { updateUrl: false, item: requestedItem });
          return surfaceReady.then(function () {
            return { surface: 'structure', nodeId: id, section: currentSection, item: currentItemId };
          });
        }
        var replacingError = currentSurface === 'structure' && currentNodeId === id;
        if (!renderStructure(id, section, requestedItem)) return Promise.reject(new Error('Internal structure could not be rendered.'));
        activateStructure(id, section, { focus: false, forceSettle: replacingError, item: requestedItem });
        return surfaceReady.then(function () {
          return { surface: 'structure', nodeId: id, section: currentSection, item: currentItemId };
        });
      }

      function focusStructure(descriptor) {
        if (currentSurface !== 'structure' || !structureTitle) return false;
        var target = descriptor && descriptor.id ? document.getElementById(descriptor.id) : null;
        if (!target && descriptor && descriptor.section && structureRoot) {
          Array.prototype.some.call(structureRoot.querySelectorAll('[data-structure-section]'), function (candidate) {
            if (candidate.getAttribute('data-structure-section') !== descriptor.section) return false;
            target = candidate;
            return true;
          });
        }
        if (!target || target.closest('[hidden]')) target = structureTitle;
        try { target.focus({ preventScroll: true }); }
        catch (_) { try { target.focus(); } catch (_) { return false; } }
        return true;
      }

      function snapshot() {
        var active = document.activeElement;
        var focus = active && active.id ? { id: active.id } : null;
        if (!focus && active && active.getAttribute && active.getAttribute('data-structure-section')) {
          focus = { section: active.getAttribute('data-structure-section') };
        }
        var selected = Archify.focus && Archify.focus.active();
        var domains = currentSurface === 'structure' ? stateForNode(currentNodeId) : null;
        var result = {
          surface: currentSurface,
          nodeId: currentSurface === 'structure' ? currentNodeId : (typeof selected === 'string' ? selected : null),
          section: currentSection,
          item: currentItemId,
          domains: currentSurface === 'structure' ? {
            code: { item: domains.code.item, expanded: Object.assign({}, domains.code.expanded) },
            state: { item: domains.state.item, expanded: Object.assign({}, domains.state.expanded) }
          } : null,
          scrollTop: window.scrollY,
          focus: focus
        };
        if (!ArchifyAddress.context) {
          result.scrollLeft = window.scrollX;
          result.camera = Archify.view && typeof Archify.view.snapshot === 'function' ? Archify.view.snapshot() : null;
          var selectedTab = document.querySelector('[data-atlas-tab][aria-selected="true"]');
          result.tabId = selectedTab && selectedTab.id ? selectedTab.id : null;
          result.panelScroll = {};
          Array.prototype.forEach.call(document.querySelectorAll('.atlas-inspector-panel[id]'), function (panel) {
            result.panelScroll[panel.id] = panel.scrollTop;
          });
        }
        return result;
      }

      function restoreStandaloneReading(state, options) {
        if (ArchifyAddress.context) return;
        if (state.surface === 'graph' && typeof state.nodeId === 'string' && Archify.focus &&
            Archify.focus.active() !== state.nodeId) {
          Archify.focus.set(state.nodeId, { updateUrl: false, toggle: false });
        }
        if (state.tabId) {
          var tab = document.getElementById(state.tabId);
          if (tab && tab.getAttribute('aria-selected') !== 'true' && typeof tab.click === 'function') tab.click();
        }
        if (state.camera && Archify.view && typeof Archify.view.restore === 'function') Archify.view.restore(state.camera);
        if (state.panelScroll) {
          Object.keys(state.panelScroll).forEach(function (id) {
            var panel = document.getElementById(id);
            if (panel && Number.isFinite(state.panelScroll[id])) panel.scrollTop = state.panelScroll[id];
          });
        }
        window.scrollTo(Number.isFinite(state.scrollLeft) ? state.scrollLeft : 0,
          Number.isFinite(state.scrollTop) ? state.scrollTop : 0);
        if (options.focus === false || !state.focus) return;
        if (state.surface === 'structure') {
          focusStructure(state.focus);
          return;
        }
        if (!state.focus.id) return;
        var target = document.getElementById(state.focus.id);
        if (target && !target.closest('[hidden]')) {
          try { target.focus({ preventScroll: true }); }
          catch (_) { try { target.focus(); } catch (_) {} }
        }
      }

      function restore(state, options) {
        options = options || {};
        if (!state || (state.surface !== 'structure' && state.surface !== 'graph')) return Promise.resolve(false);
        if (state.surface === 'graph') {
          if (currentSurface === 'structure') deactivateStructure({ restoreFocus: false, restoreScroll: false });
          return new Promise(function (resolve) {
            requestAnimationFrame(function () {
              if (!ArchifyAddress.context) restoreStandaloneReading(state, options);
              else {
                if (Number.isFinite(state.scrollTop)) window.scrollTo(0, state.scrollTop);
                if (options.focus !== false && state.focus && state.focus.id) {
                  var graphTarget = document.getElementById(state.focus.id);
                  if (graphTarget && !graphTarget.closest('[hidden]')) graphTarget.focus({ preventScroll: true });
                }
              }
              resolve(true);
            });
          });
        }
        if (!node(state.nodeId)) return Promise.resolve(false);
        if (state.domains) {
          var restoredDomains = stateForNode(state.nodeId);
          for (var domain of sectionKinds) {
            var saved = state.domains[domain];
            if (saved && typeof saved === 'object') {
              restoredDomains[domain].item = typeof saved.item === 'string' ? saved.item : null;
              restoredDomains[domain].expanded = saved.expanded && typeof saved.expanded === 'object'
                ? Object.assign(Object.create(null), saved.expanded) : Object.create(null);
            }
          }
        }
        if (!renderStructure(state.nodeId, state.section, state.domains ? null : state.item)) return Promise.resolve(false);
        activateStructure(state.nodeId, state.section, { focus: false, scroll: false, item: state.item });
        requestAnimationFrame(function () {
          if (!ArchifyAddress.context) {
            restoreStandaloneReading(state, options);
            return;
          }
          if (Number.isFinite(state.scrollTop)) window.scrollTo(0, state.scrollTop);
          if (options.focus === false || !state.focus) return;
          var target = state.focus.id ? document.getElementById(state.focus.id) : null;
          if (!target && state.focus.section) {
            Array.prototype.some.call(structureRoot.querySelectorAll('[data-structure-section]'), function (candidate) {
              if (candidate.getAttribute('data-structure-section') !== state.focus.section) return false;
              target = candidate;
              return true;
            });
          }
          if (target && !target.closest('[hidden]')) target.focus({ preventScroll: true });
        });
        return surfaceReady.then(function () { return true; });
      }

      function connect() {
        if (connected) return;
        connected = true;
        if (payload && structureNodes().length) {
          installStyles();
          ensureQuicklook();
          html.setAttribute('data-reader-surface', 'graph');
        }
        function syncWithoutUnhandledRejection() {
          if (!ArchifyAddress.context) {
            syncStandaloneHistoryWithoutUnhandledRejection();
            return;
          }
          syncAddress().catch(function () {});
        }
        function syncStandaloneHistoryWithoutUnhandledRejection() {
          if (standaloneSaveFrame !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(standaloneSaveFrame);
            standaloneSaveFrame = null;
          }
          var expectedRevision = ++standaloneSyncRevision;
          var expectedHref = location.href;
          var reading = ArchifyAddress.context ? null : storedStandaloneReading(history.state, expectedHref);
          syncAddress().then(function () {
            if (expectedRevision !== standaloneSyncRevision || location.href !== expectedHref) return null;
            return reading ? restore(reading, { focus: true }) : null;
          }).then(function () {
            if (expectedRevision === standaloneSyncRevision && location.href === expectedHref) applyGraphInformation();
          }).catch(function () {});
        }
        window.addEventListener('hashchange', syncWithoutUnhandledRejection);
        window.addEventListener('popstate', syncStandaloneHistoryWithoutUnhandledRejection);
        window.addEventListener('beforeprint', prepareStructurePrint);
        window.addEventListener('afterprint', finishStructurePrint);
        if (!ArchifyAddress.context) {
          window.addEventListener('scroll', scheduleStandaloneReadingSave, { passive: true });
          document.addEventListener('scroll', scheduleStandaloneReadingSave, true);
          document.addEventListener('focusin', scheduleStandaloneReadingSave, true);
          document.addEventListener('pointerup', scheduleStandaloneReadingSave, true);
          document.addEventListener('wheel', scheduleStandaloneReadingSave, { capture: true, passive: true });
        }
        document.addEventListener('keydown', function (event) {
          if (event.key !== 'Escape' || currentSurface !== 'structure') return;
          event.preventDefault();
          event.stopImmediatePropagation();
          close({ restoreFocus: true });
        });
        syncStandaloneHistoryWithoutUnhandledRejection();
      }

      return {
        available: function () { return Boolean(payload && structureNodes().length); },
        node: node,
        renderQuicklook: renderQuicklook,
        clearQuicklook: clearQuicklook,
        open: open,
        close: close,
        surface: function () { return currentSurface; },
        section: function () { return currentSection; },
        syncAddress: syncAddress,
        snapshot: snapshot,
        restore: restore,
        focus: focusStructure,
        connect: connect
      };
    })();

    Archify.focus = (function () {
      var html = document.documentElement;
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector('svg');
      var chip = document.getElementById('focus-chip');
      var label = document.getElementById('focus-label');
      var detail = document.getElementById('focus-detail');
      var kind = document.getElementById('focus-kind');
      var context = document.getElementById('focus-context');
      var tag = document.getElementById('focus-tag');
      var semanticId = document.getElementById('focus-id');
      var evidence = document.getElementById('focus-evidence');
      var repositoryLink = document.getElementById('focus-repository');
      var evidenceLinks = document.getElementById('focus-evidence-links');
      var summary = document.getElementById('focus-summary');
      var reachSection = document.getElementById('focus-reach');
      var reachStatus = document.getElementById('focus-reach-status');
      var upstreamBtn = document.getElementById('btn-reach-upstream');
      var downstreamBtn = document.getElementById('btn-reach-downstream');
      var upstreamCount = document.getElementById('focus-reach-upstream-count');
      var downstreamCount = document.getElementById('focus-reach-downstream-count');
      var relationshipList = document.getElementById('relationship-lens-list');
      var copyBtn = document.getElementById('btn-focus-copy');
      var relationsBtn = document.getElementById('btn-focus-relations');
      var clearBtn = document.getElementById('btn-focus-clear');
      var moveBtn = document.getElementById('btn-focus-move');
      var activeIds = [];
      var hoveredRelationship = null;
      var focusedRelationship = null;
      var pinnedRelationship = null;
      var pinnedRelationshipKey = null;
      var activeRelationshipPreview = null;
      var relationshipHitOverlay = null;
      var relationshipHitTargets = [];
      var directPreviewTimer = null;
      var lensDrag = null;
      var manualLensPosition = null;
      var reachabilityMode = null;
      var activeReachability = null;
      var svgNamespace = 'http://www.w3.org/2000/svg';
      var reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      var finePointerQuery = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;

      function atlasInspection() {
        return Boolean(ArchifyAddress.context);
      }

      function nodes() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
      }
      function edges() {
        return Array.prototype.slice.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'));
      }
      function nodeLabel(node, fallback) {
        return node.getAttribute('data-node-label') || (node.getAttribute('aria-label') || fallback).replace(/^Focus\s+/, '');
      }
      function reachabilityRelationships() {
        var seen = Object.create(null);
        var relationships = [];
        edges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var key = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + (edge.getAttribute('data-edge-label') || ''));
          if (!from || !to || seen[key]) return;
          seen[key] = true;
          relationships.push({ key: key, from: from, to: to });
        });
        return relationships;
      }
      function computeReachability(originId, direction, relationships) {
        if (typeof originId !== 'string' || !originId ||
            (direction !== 'upstream' && direction !== 'downstream') ||
            !Array.isArray(relationships)) return null;
        var records = [];
        var seenKeys = Object.create(null);
        relationships.forEach(function (relationship, index) {
          if (!relationship || typeof relationship.from !== 'string' || !relationship.from ||
              typeof relationship.to !== 'string' || !relationship.to) return;
          var key = typeof relationship.key === 'string' && relationship.key
            ? relationship.key : String(index);
          if (seenKeys[key]) return;
          seenKeys[key] = true;
          records.push({ key: key, from: relationship.from, to: relationship.to });
        });

        var depths = Object.create(null);
        var order = [];
        var queue = [originId];
        depths[originId] = 0;
        for (var cursor = 0; cursor < queue.length; cursor += 1) {
          var current = queue[cursor];
          records.forEach(function (relationship) {
            var next = null;
            if (direction === 'downstream' && relationship.from === current) next = relationship.to;
            else if (direction === 'upstream' && relationship.to === current) next = relationship.from;
            if (next == null || Object.prototype.hasOwnProperty.call(depths, next)) return;
            depths[next] = depths[current] + 1;
            queue.push(next);
          });
        }
        queue.forEach(function (id) { order.push(id); });

        var edgeKeys = [];
        records.forEach(function (relationship) {
          if (Object.prototype.hasOwnProperty.call(depths, relationship.from) &&
              Object.prototype.hasOwnProperty.call(depths, relationship.to)) edgeKeys.push(relationship.key);
        });
        var maxDepth = order.reduce(function (maximum, id) {
          return Math.max(maximum, depths[id]);
        }, 0);
        return {
          direction: direction,
          originId: originId,
          nodeIds: order,
          edgeKeys: edgeKeys,
          depths: depths,
          maxDepth: maxDepth
        };
      }
      function reachabilityFor(id, direction) {
        return computeReachability(id, direction, reachabilityRelationships());
      }
      function resetReachabilityButtons() {
        upstreamBtn.setAttribute('aria-pressed', 'false');
        downstreamBtn.setAttribute('aria-pressed', 'false');
      }
      function clearReachability(options) {
        options = options || {};
        reachabilityMode = null;
        activeReachability = null;
        svg.removeAttribute('data-reach-active');
        chip.removeAttribute('data-reach-mode');
        nodes().forEach(function (node) {
          node.removeAttribute('data-reach-match');
          node.removeAttribute('data-reach-origin');
          node.removeAttribute('data-reach-depth');
        });
        edges().forEach(function (edge) {
          edge.removeAttribute('data-reach-match');
          edge.removeAttribute('data-reach-depth');
        });
        resetReachabilityButtons();
        reachStatus.textContent = '';
        reachStatus.hidden = true;
        if (Archify.exportMenu && typeof Archify.exportMenu.syncReachShare === 'function') {
          Archify.exportMenu.syncReachShare();
        }
        if (options.updateUrl === true && activeIds.length === 1) {
          try {
            ArchifyAddress.replaceState(null, '', ArchifyAddress.location.pathname + ArchifyAddress.location.search + '#focus=' + encodeURIComponent(activeIds[0]));
          } catch (_) {}
        }
      }
      function renderReachabilityControls(id) {
        var upstream = reachabilityFor(id, 'upstream');
        var downstream = reachabilityFor(id, 'downstream');
        var upstreamReach = upstream ? Math.max(0, upstream.nodeIds.length - 1) : 0;
        var downstreamReach = downstream ? Math.max(0, downstream.nodeIds.length - 1) : 0;
        upstreamCount.textContent = String(upstreamReach);
        downstreamCount.textContent = String(downstreamReach);
        upstreamBtn.disabled = upstreamReach === 0;
        downstreamBtn.disabled = downstreamReach === 0;
        upstreamBtn.setAttribute('aria-label', upstreamReach
          ? viewerCount('viewer.passport.reach.upstream', upstreamReach)
          : viewerText('viewer.passport.reach.noUpstream'));
        downstreamBtn.setAttribute('aria-label', downstreamReach
          ? viewerCount('viewer.passport.reach.downstream', downstreamReach)
          : viewerText('viewer.passport.reach.noDownstream'));
        reachSection.hidden = false;
      }
      function applyReachability(direction, options) {
        options = options || {};
        if (activeIds.length !== 1 || (direction !== 'upstream' && direction !== 'downstream')) return false;
        if (reachabilityMode === direction && options.toggle !== false) {
          clearReachability({ updateUrl: options.updateUrl !== false });
          return true;
        }
        var result = reachabilityFor(activeIds[0], direction);
        if (!result || result.nodeIds.length <= 1) return false;
        if (Archify.guidedViews && typeof Archify.guidedViews.showAll === 'function') {
          Archify.guidedViews.showAll({ clearFocus: false, updateUrl: false, resetView: false });
        }
        clearRelationshipPreview({ clearPin: true });
        clearReachability({ updateUrl: false });
        reachabilityMode = direction;
        activeReachability = result;
        var edgeKeySet = Object.create(null);
        result.edgeKeys.forEach(function (key) { edgeKeySet[key] = true; });
        svg.setAttribute('data-reach-active', direction);
        chip.setAttribute('data-reach-mode', direction);
        nodes().forEach(function (node) {
          var id = node.getAttribute('data-node-id');
          if (!Object.prototype.hasOwnProperty.call(result.depths, id)) return;
          node.setAttribute('data-reach-match', '');
          node.setAttribute('data-reach-depth', String(result.depths[id]));
          if (id === result.originId) node.setAttribute('data-reach-origin', '');
        });
        edges().forEach(function (edge) {
          var key = edge.getAttribute('data-edge-key') || (
            edge.getAttribute('data-edge-from') + '\u0000' +
            edge.getAttribute('data-edge-to') + '\u0000' +
            (edge.getAttribute('data-edge-label') || '')
          );
          if (!edgeKeySet[key]) return;
          edge.setAttribute('data-reach-match', '');
          var fromDepth = result.depths[edge.getAttribute('data-edge-from')];
          var toDepth = result.depths[edge.getAttribute('data-edge-to')];
          edge.setAttribute('data-reach-depth', String(Math.max(fromDepth || 0, toDepth || 0)));
        });
        resetReachabilityButtons();
        var activeButton = direction === 'upstream' ? upstreamBtn : downstreamBtn;
        activeButton.setAttribute('aria-pressed', 'true');
        var reachableCount = result.nodeIds.length - 1;
        var directionLabel = viewerText(direction === 'upstream'
          ? 'viewer.passport.upstream'
          : 'viewer.passport.downstream');
        reachStatus.textContent = viewerText('viewer.passport.reach.status', {
          direction: directionLabel,
          nodes: reachableCount,
          links: result.edgeKeys.length,
          hops: result.maxDepth
        });
        reachStatus.hidden = false;
        if (Archify.exportMenu && typeof Archify.exportMenu.syncReachShare === 'function') {
          Archify.exportMenu.syncReachShare();
        }
        if (options.updateUrl !== false) {
          try {
            ArchifyAddress.replaceState(null, '', ArchifyAddress.location.pathname + ArchifyAddress.location.search + '#focus=' +
              encodeURIComponent(activeIds[0]) + '&reach=' + direction);
          } catch (_) {}
        }
        if (options.reveal !== false && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal(result.nodeIds, { includeNeighbors: false, reason: 'reachability' });
        }
        placeRelationshipLens();
        return true;
      }
      function reachabilitySnapshot() {
        if (!activeReachability || activeIds.length !== 1 ||
            (reachabilityMode !== 'upstream' && reachabilityMode !== 'downstream') ||
            activeReachability.direction !== reachabilityMode ||
            activeReachability.originId !== activeIds[0] ||
            svg.getAttribute('data-reach-active') !== reachabilityMode) return null;

        var originId = activeReachability.originId;
        var nodeIds = activeReachability.nodeIds.slice();
        var edgeKeys = activeReachability.edgeKeys.slice();
        if (nodeIds.length < 2 || nodeIds[0] !== originId || !edgeKeys.length ||
            !activeReachability.depths || !Number.isInteger(activeReachability.maxDepth) ||
            activeReachability.maxDepth < 1) return null;

        var allNodes = nodes();
        var allEdges = edges();
        var seenNodeIds = Object.create(null);
        var seenEdgeKeys = Object.create(null);
        var nodeIdSet = Object.create(null);
        var depths = Object.create(null);
        var originNode = null;
        var measuredMaxDepth = 0;

        if (nodeIds.some(function (id) {
          var depth = activeReachability.depths[id];
          var matches = allNodes.filter(function (node) {
            return node.getAttribute('data-node-id') === id;
          });
          if (typeof id !== 'string' || !id || seenNodeIds[id] || matches.length !== 1 ||
              !matches[0].hasAttribute('data-reach-match') ||
              !Number.isInteger(depth) || depth < 0 || depth > activeReachability.maxDepth ||
              (id === originId
                ? (!matches[0].hasAttribute('data-reach-origin') || depth !== 0)
                : depth < 1)) return true;
          seenNodeIds[id] = true;
          nodeIdSet[id] = true;
          depths[id] = depth;
          measuredMaxDepth = Math.max(measuredMaxDepth, depth);
          if (id === originId) originNode = matches[0];
          return false;
        }) || !originNode || measuredMaxDepth !== activeReachability.maxDepth ||
            allNodes.filter(function (node) { return node.hasAttribute('data-reach-match'); }).length !== nodeIds.length) return null;

        var edgeRecords = [];
        if (edgeKeys.some(function (key) {
          if (typeof key !== 'string' || !key || seenEdgeKeys[key]) return true;
          var fragments = allEdges.filter(function (edge) {
            return edge.getAttribute('data-edge-key') === key;
          });
          var drawableFragments = fragments.filter(hasDrawableGeometry);
          if (!fragments.length || drawableFragments.length !== 1 ||
              !fragments.every(function (fragment) { return fragment.hasAttribute('data-reach-match'); })) return true;
          var first = fragments[0];
          var from = first.getAttribute('data-edge-from');
          var to = first.getAttribute('data-edge-to');
          var id = first.getAttribute('data-edge-id') || '';
          var labelValue = first.getAttribute('data-edge-label') || '';
          if (!nodeIdSet[from] || !nodeIdSet[to] || !fragments.every(function (fragment) {
            return fragment.getAttribute('data-edge-from') === from &&
              fragment.getAttribute('data-edge-to') === to &&
              (fragment.getAttribute('data-edge-id') || '') === id;
          })) return true;
          seenEdgeKeys[key] = true;
          edgeRecords.push({
            key: key,
            id: id,
            from: from,
            to: to,
            label: labelValue,
            depth: Math.max(depths[from], depths[to])
          });
          return false;
        })) return null;

        var liveEdgeKeys = Object.create(null);
        if (allEdges.some(function (edge) {
          if (!edge.hasAttribute('data-reach-match')) return false;
          var key = edge.getAttribute('data-edge-key');
          if (!key || !seenEdgeKeys[key]) return true;
          liveEdgeKeys[key] = true;
          return false;
        }) || Object.keys(liveEdgeKeys).length !== edgeKeys.length) return null;

        return {
          direction: reachabilityMode,
          origin: { id: originId, label: nodeLabel(originNode, originId) },
          nodeIds: nodeIds,
          depths: depths,
          maxDepth: activeReachability.maxDepth,
          edges: edgeRecords
        };
      }
      function setPassportValue(element, value) {
        var normalized = value == null ? '' : String(value).trim();
        element.textContent = normalized;
        element.hidden = !normalized;
      }
      function renderSourceEvidence(id) {
        evidenceLinks.textContent = '';
        repositoryLink.removeAttribute('href');
        repositoryLink.removeAttribute('aria-label');
        repositoryLink.textContent = '';
        var sources = Archify.sourceEvidence.node(id);
        var repository = Archify.sourceEvidence.repository();
        if (!repository || !sources.length) {
          evidence.hidden = true;
          return;
        }
        repositoryLink.textContent = repository.label + ' @ ' + repository.shortRevision;
        if (repository.href) {
          repositoryLink.href = repository.href;
          repositoryLink.setAttribute('aria-label', viewerText('viewer.passport.repository.open', { revision: repository.revision }));
        }
        evidence.title = viewerText('viewer.passport.verificationScope');
        sources.forEach(function (source) {
          var link = document.createElement(source.href ? 'a' : 'div');
          link.className = 'semantic-passport-source';
          if (source.href) {
            link.href = source.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.referrerPolicy = 'no-referrer';
            link.setAttribute('aria-label', viewerText('viewer.passport.source.open', { path: source.path, revision: repository.shortRevision }));
          }
          if (source.id) link.setAttribute('data-source-id', source.id);
          var name = document.createElement('strong');
          name.textContent = source.label || source.path.split('/').pop() || source.path;
          var location = document.createElement('code');
          location.textContent = source.line
            ? 'L' + source.line + (source.endLine && source.endLine !== source.line ? '–' + source.endLine : '') + (source.href ? ' ↗' : '')
            : source.href ? viewerText('viewer.passport.source.openLink') : '';
          var sourcePath = document.createElement('small');
          sourcePath.textContent = source.path;
          link.appendChild(name);
          link.appendChild(location);
          link.appendChild(sourcePath);
          evidenceLinks.appendChild(link);
        });
        evidence.hidden = false;
      }
      function renderPassport(id, node) {
        setPassportValue(detail, node.getAttribute('data-node-sublabel'));
        Archify.internalStructure.renderQuicklook(id);
        setPassportValue(kind, viewerKindLabel(node.getAttribute('data-node-kind') || 'node'));
        setPassportValue(context, node.getAttribute('data-node-context'));
        setPassportValue(tag, node.getAttribute('data-node-tag'));
        setPassportValue(document.getElementById('focus-brand'), node.getAttribute('data-node-brand'));
        semanticId.textContent = id;
        semanticId.hidden = false;
        renderSourceEvidence(id);
      }
      function relationshipsFor(id, byId) {
        var seen = {};
        var relationships = [];
        edges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          if (from !== id && to !== id) return;
          var edgeLabel = edge.getAttribute('data-edge-label') || '';
          var edgeKey = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + edgeLabel);
          var edgeId = edge.getAttribute('data-edge-id') || '';
          if (seen[edgeKey]) return;
          seen[edgeKey] = true;
          var direction = from === id && to === id ? 'loop' : (from === id ? 'out' : 'in');
          var neighborId = direction === 'in' ? from : to;
          var neighbor = byId[neighborId];
          relationships.push({
            key: edgeKey,
            id: edgeId,
            from: from,
            to: to,
            direction: direction,
            neighborId: neighborId,
            neighborLabel: neighbor ? nodeLabel(neighbor, neighborId) : neighborId,
            label: edgeLabel || viewerText(direction === 'loop'
              ? 'viewer.passport.relationship.loopsBack'
              : direction === 'out'
                ? 'viewer.passport.relationship.connectsTo'
                : 'viewer.passport.relationship.connectsFrom')
          });
        });
        return relationships;
      }
      function relationshipEdgeShapes(edge) {
        if (!edge) return [];
        if (/^(path|line|polyline)$/i.test(edge.tagName || '')) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }
      function relationshipHitRecords() {
        var recordsByKey = {};
        var recordsById = Object.create(null);
        var byId = Object.create(null);
        nodes().forEach(function (node) { byId[node.getAttribute('data-node-id')] = node; });
        var records = [];
        edges().forEach(function (edge) {
          var shapes = relationshipEdgeShapes(edge);
          if (!shapes.length) return;
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var labelValue = edge.getAttribute('data-edge-label') || '';
          var edgeId = edge.getAttribute('data-edge-id') || '';
          var key = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + labelValue);
          var existing = recordsByKey[key];
          if (existing) {
            if (existing.from !== from || existing.to !== to || existing.labelValue !== labelValue || existing.id !== edgeId) {
              existing.invalid = true;
              return;
            }
            shapes.forEach(function (shape) {
              if (existing.shapes.indexOf(shape) === -1) existing.shapes.push(shape);
            });
            return;
          }
          var record = {
            key: key,
            id: edgeId,
            from: from,
            to: to,
            fromLabel: byId[from] ? nodeLabel(byId[from], from) : from,
            toLabel: byId[to] ? nodeLabel(byId[to], to) : to,
            labelValue: labelValue,
            label: labelValue || viewerText(from === to
              ? 'viewer.passport.relationship.loopsBack'
              : 'viewer.passport.relationship.connectsTo'),
            edge: edge,
            shapes: shapes,
            invalid: false
          };
          recordsByKey[key] = record;
          if (edgeId) {
            if (recordsById[edgeId]) {
              recordsById[edgeId].invalid = true;
              record.invalid = true;
            } else {
              recordsById[edgeId] = record;
            }
          }
          records.push(record);
        });
        return records.filter(function (record) { return !record.invalid && record.from && record.to; });
      }
      function relationshipRecordForKey(key) {
        return relationshipHitRecords().find(function (record) { return record.key === key; }) || null;
      }
      function pinnedRelationshipRecord() {
        return pinnedRelationshipKey ? relationshipRecordForKey(pinnedRelationshipKey) : null;
      }
      function renderRelationshipCopyAction() {
        var record = pinnedRelationshipRecord();
        if (record && record.id) {
          copyBtn.textContent = viewerText('viewer.passport.copyRelation');
          copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copyPinned'));
        } else if (pinnedRelationshipKey) {
          copyBtn.textContent = viewerText('viewer.passport.copyNode');
          copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copySource'));
        } else {
          copyBtn.textContent = viewerText('viewer.passport.copy');
          copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copy.focus'));
        }
      }
      function relationshipHitGeometry(shape, className) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('filter');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('tabindex');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-labelledby');
        clone.removeAttribute('aria-hidden');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.setAttribute('class', className || 'relationship-hit-rail');
        return clone;
      }
      function removeRelationshipPulse() {
        Array.prototype.forEach.call(svg.querySelectorAll('[data-relationship-pulse-overlay]'), function (element) {
          element.remove();
        });
      }
      function relationshipPulseGeometry(shape) {
        var clone = shape.cloneNode(false);
        clone.removeAttribute('id');
        clone.removeAttribute('class');
        clone.removeAttribute('style');
        clone.removeAttribute('transform');
        clone.removeAttribute('filter');
        clone.removeAttribute('marker-start');
        clone.removeAttribute('marker-mid');
        clone.removeAttribute('marker-end');
        clone.removeAttribute('role');
        clone.removeAttribute('tabindex');
        clone.removeAttribute('aria-label');
        clone.removeAttribute('aria-hidden');
        clone.removeAttribute('data-animate');
        clone.removeAttribute('data-edge-from');
        clone.removeAttribute('data-edge-to');
        clone.removeAttribute('data-edge-key');
        clone.removeAttribute('data-edge-id');
        clone.removeAttribute('data-edge-label');
        clone.removeAttribute('data-focus-match');
        clone.removeAttribute('data-relationship-preview');
        clone.setAttribute('class', 'relationship-flow-pulse');
        clone.setAttribute('pathLength', '1');
        return clone;
      }
      function relationshipTokenKind(edge) {
        var shapes = relationshipEdgeShapes(edge);
        var classEvidence = [edge.getAttribute('class') || ''].concat(shapes.map(function (shape) {
          return shape.getAttribute('class') || '';
        })).join(' ');
        var from = edge.getAttribute('data-edge-from') || '';
        var to = edge.getAttribute('data-edge-to') || '';
        var source = nodes().find(function (node) { return node.getAttribute('data-node-id') === from; });
        var target = nodes().find(function (node) { return node.getAttribute('data-node-id') === to; });
        var sourceKind = source ? source.getAttribute('data-node-kind') || 'neutral' : 'neutral';
        var targetKind = target ? target.getAttribute('data-node-kind') || 'neutral' : 'neutral';
        if (/\ba-security\b/.test(classEvidence) || sourceKind === 'security' || targetKind === 'security' || targetKind === 'failure') return 'security';
        if (/\ba-dashed\b/.test(classEvidence) || sourceKind === 'messagebus' || targetKind === 'messagebus') return 'event';
        if (sourceKind === 'database' || targetKind === 'database') return 'data';
        if (targetKind === 'waiting' || targetKind === 'success') return 'state';
        return 'call';
      }
      function relationshipTokenPath(shape) {
        if (!shape) return '';
        var tagName = String(shape.tagName || '').toLowerCase();
        if (tagName === 'path') return shape.getAttribute('d') || '';
        if (tagName === 'line') {
          return 'M ' + shape.getAttribute('x1') + ' ' + shape.getAttribute('y1') +
            ' L ' + shape.getAttribute('x2') + ' ' + shape.getAttribute('y2');
        }
        if (tagName === 'polyline' && shape.points && shape.points.numberOfItems > 1) {
          var commands = [];
          for (var i = 0; i < shape.points.numberOfItems; i += 1) {
            var point = shape.points.getItem(i);
            commands.push((i === 0 ? 'M ' : 'L ') + point.x + ' ' + point.y);
          }
          return commands.join(' ');
        }
        return '';
      }
      function relationshipTokenPart(tagName, className, attrs) {
        var part = document.createElementNS(svgNamespace, tagName);
        part.setAttribute('class', className);
        Object.keys(attrs || {}).forEach(function (name) { part.setAttribute(name, attrs[name]); });
        return part;
      }
      function relationshipTokenGeometry(shape, kind, key, options) {
        options = options || {};
        var pathData = relationshipTokenPath(shape);
        if (!pathData) return null;
        var token = document.createElementNS(svgNamespace, 'g');
        token.setAttribute('class', 'semantic-flow-token ' + (options.className || 'relationship-flow-token'));
        token.setAttribute('data-token-kind', kind);
        token.setAttribute('data-token-edge-key', key);
        token.setAttribute('aria-hidden', 'true');
        token.appendChild(relationshipTokenPart('circle', 'semantic-flow-token-halo', { cx: '0', cy: '0', r: '7' }));
        if (kind === 'data') {
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '-5', y: '-4', width: '10', height: '8', rx: '2' }));
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-ink', { d: 'M -2.8 -1.2 h 5.6 M -2.8 1.4 h 3.8' }));
        } else if (kind === 'event') {
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '-7', y: '-3', width: '4', height: '6', rx: '1' }));
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '-2', y: '-3', width: '4', height: '6', rx: '1' }));
          token.appendChild(relationshipTokenPart('rect', 'relationship-flow-token-shape', { x: '3', y: '-3', width: '4', height: '6', rx: '1' }));
        } else if (kind === 'security') {
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-shape', { d: 'M 0 -5 L 4 -3.4 V 0 c 0 3 -1.6 4.5 -4 5.5 C -2.4 4.5 -4 3 -4 0 v -3.4 Z' }));
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-ink', { d: 'm -2 .2 1.4 1.4 L 2 -1.4' }));
        } else if (kind === 'state') {
          token.appendChild(relationshipTokenPart('circle', 'relationship-flow-token-shape', { cx: '0', cy: '0', r: '5' }));
          token.appendChild(relationshipTokenPart('circle', 'relationship-flow-token-dot', { cx: '0', cy: '0', r: '1.35' }));
        } else {
          token.appendChild(relationshipTokenPart('path', 'relationship-flow-token-ink', { d: 'M -5 -3 L -1 0 L -5 3 M 0 -3 L 4 0 L 0 3' }));
        }
        var motion = document.createElementNS(svgNamespace, 'animateMotion');
        motion.setAttribute('path', pathData);
        motion.setAttribute('dur', options.duration || '1.2s');
        motion.setAttribute('begin', '0s');
        motion.setAttribute('fill', 'freeze');
        motion.setAttribute('rotate', 'auto');
        motion.setAttribute('calcMode', 'spline');
        motion.setAttribute('keyTimes', '0;1');
        motion.setAttribute('keySplines', '.2 0 .2 1');
        token.appendChild(motion);
        return token;
      }
      function createSemanticFlowToken(edge, shape, options) {
        if (!edge || !shape) return null;
        var key = edge.getAttribute('data-edge-key') || (
          edge.getAttribute('data-edge-from') + '\u0000' +
          edge.getAttribute('data-edge-to') + '\u0000' +
          (edge.getAttribute('data-edge-label') || '')
        );
        return relationshipTokenGeometry(shape, relationshipTokenKind(edge), key, options);
      }
      Archify.flowTokens = {
        create: createSemanticFlowToken,
        kind: function (edge) { return relationshipTokenKind(edge); },
        path: relationshipTokenPath
      };
      function renderRelationshipPulse(key) {
        removeRelationshipPulse();
        if (!key || document.documentElement.getAttribute('data-embed') === 'true') return false;
        if (document.hidden || (Archify.motionGovernor && Archify.motionGovernor.isPaused())) return false;
        if (reducedMotionQuery && reducedMotionQuery.matches) return false;
        var matchingEdges = edges().filter(function (edge) {
          return edge.getAttribute('data-edge-key') === key;
        });
        if (!matchingEdges.length) return false;
        var overlay = document.createElementNS(svgNamespace, 'g');
        overlay.setAttribute('class', 'relationship-pulse-overlay');
        overlay.setAttribute('data-relationship-pulse-overlay', '');
        overlay.setAttribute('data-relationship-pulse-key', key);
        overlay.setAttribute('aria-hidden', 'true');
        var tokenAdded = false;
        matchingEdges.forEach(function (edge) {
          var wrapper = document.createElementNS(svgNamespace, 'g');
          if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
          var shapes = relationshipEdgeShapes(edge);
          shapes.forEach(function (shape) {
            wrapper.appendChild(relationshipPulseGeometry(shape));
          });
          if (!tokenAdded && shapes.length) {
            var tokenKind = relationshipTokenKind(edge);
            var token = relationshipTokenGeometry(shapes[0], tokenKind, key);
            if (token) {
              wrapper.appendChild(token);
              overlay.setAttribute('data-relationship-token-kind', tokenKind);
              tokenAdded = true;
            }
          }
          if (wrapper.childNodes.length) overlay.appendChild(wrapper);
        });
        if (!overlay.childNodes.length) return false;
        var finishPulse = function () {
          if (overlay.parentNode) overlay.remove();
        };
        overlay.addEventListener('animationend', finishPulse, { once: true });
        overlay.addEventListener('animationcancel', finishPulse, { once: true });
        var firstNode = svg.querySelector('[data-node-id]');
        if (firstNode) svg.insertBefore(overlay, firstNode);
        else svg.appendChild(overlay);
        return true;
      }
      function clearRelationshipPreview(options) {
        options = options || {};
        if (directPreviewTimer) window.clearTimeout(directPreviewTimer);
        directPreviewTimer = null;
        removeRelationshipPulse();
        activeRelationshipPreview = null;
        svg.removeAttribute('data-relationship-preview-active');
        svg.removeAttribute('data-relationship-direct-active');
        if (options.clearPin === true) {
          pinnedRelationship = null;
          pinnedRelationshipKey = null;
          svg.removeAttribute('data-relationship-pin-active');
        }
        chip.removeAttribute('data-relationship-previewing');
        edges().forEach(function (edge) { edge.removeAttribute('data-relationship-preview'); });
        nodes().forEach(function (node) {
          node.removeAttribute('data-relationship-preview-node');
          node.removeAttribute('data-relationship-preview-source');
          node.removeAttribute('data-relationship-preview-target');
        });
        Array.prototype.forEach.call(relationshipList.querySelectorAll('[data-preview-active]'), function (button) {
          button.removeAttribute('data-preview-active');
        });
        relationshipHitTargets.forEach(function (target) {
          target.setAttribute('aria-pressed', pinnedRelationshipKey && target.getAttribute('data-relationship-key') === pinnedRelationshipKey ? 'true' : 'false');
          target.removeAttribute('data-preview-active');
        });
        renderRelationshipCopyAction();
        placeRelationshipLens();
      }
      function previewRelationship(button, options) {
        options = options || {};
        if (pinnedRelationshipKey && pinnedRelationship && button !== pinnedRelationship) return;
        clearRelationshipPreview();
        if (!button) return;
        var key = button.getAttribute('data-relationship-key');
        var from = button.getAttribute('data-relationship-from');
        var to = button.getAttribute('data-relationship-to');
        if (!key || !from || !to) return;
        svg.setAttribute('data-relationship-preview-active', key);
        if (options.direct === true) svg.setAttribute('data-relationship-direct-active', key);
        edges().forEach(function (edge) {
          if (edge.getAttribute('data-edge-key') === key) edge.setAttribute('data-relationship-preview', '');
        });
        nodes().forEach(function (node) {
          var id = node.getAttribute('data-node-id');
          if (id !== from && id !== to) return;
          node.setAttribute('data-relationship-preview-node', '');
          if (id === from) node.setAttribute('data-relationship-preview-source', '');
          if (id === to) node.setAttribute('data-relationship-preview-target', '');
        });
        button.setAttribute('data-preview-active', 'true');
        if (!chip.hidden && options.direct !== true) chip.setAttribute('data-relationship-previewing', 'true');
        activeRelationshipPreview = button;
        renderRelationshipPulse(key);
        placeRelationshipLens();
      }
      function syncRelationshipPreview() {
        var next = pinnedRelationship || focusedRelationship || hoveredRelationship;
        if (next === activeRelationshipPreview) return;
        previewRelationship(next, { direct: !!(next && next.hasAttribute('data-relationship-hit-key')) });
      }
      function directRelationshipBlocked() {
        return html.getAttribute('data-embed') === 'true' ||
          html.getAttribute('data-structure-open') === 'true' ||
          container.classList.contains('is-panning') ||
          (activeIds.length > 0 && !pinnedRelationshipKey) ||
          svg.hasAttribute('data-story-active') ||
          svg.hasAttribute('data-route-picking') ||
          svg.hasAttribute('data-route-active') ||
          svg.hasAttribute('data-lens-active') ||
          svg.hasAttribute('data-chapter-preview');
      }
      function scheduleDirectRelationshipPreview(target) {
        if (directPreviewTimer) window.clearTimeout(directPreviewTimer);
        if (pinnedRelationshipKey) return;
        directPreviewTimer = window.setTimeout(function () {
          directPreviewTimer = null;
          if (pinnedRelationshipKey || hoveredRelationship !== target || directRelationshipBlocked()) return;
          previewRelationship(target, { direct: true });
        }, reducedMotionQuery && reducedMotionQuery.matches ? 0 : 90);
      }
      function relationshipHitTarget(key) {
        return relationshipHitTargets.find(function (target) {
          return target.getAttribute('data-relationship-key') === key;
        }) || null;
      }
      function revealPinnedRelationship(record) {
        function reveal() {
          if (!record || pinnedRelationshipKey !== record.key) return true;
          if (!Archify.view || typeof Archify.view.reveal !== 'function') return false;
          Archify.view.reveal([record.from, record.to], { reason: 'relationship-direct' });
          return true;
        }
        if (!reveal()) requestAnimationFrame(reveal);
      }
      function inspectRelationship(key, options) {
        options = options || {};
        if (html.getAttribute('data-embed') === 'true') return false;
        if (directPreviewTimer) window.clearTimeout(directPreviewTimer);
        directPreviewTimer = null;
        hoveredRelationship = null;
        focusedRelationship = null;
        if (pinnedRelationshipKey === key) {
          if (options.toggle === false) return true;
          clear({ updateUrl: options.updateUrl !== false });
          return true;
        }
        var record = relationshipRecordForKey(key);
        if (!record) return false;
        if (Archify.guidedViews && typeof Archify.guidedViews.showAll === 'function') {
          Archify.guidedViews.showAll({ clearFocus: false, updateUrl: false });
        }
        set(record.from, { toggle: false, updateUrl: false });
        var row = Array.prototype.slice.call(relationshipList.querySelectorAll('[data-relationship-key]')).find(function (candidate) {
          return candidate.getAttribute('data-relationship-key') === key;
        });
        if (!row) return false;
        previewRelationship(row);
        pinnedRelationship = row;
        pinnedRelationshipKey = key;
        svg.setAttribute('data-relationship-pin-active', key);
        var target = relationshipHitTarget(key);
        if (target) target.setAttribute('aria-pressed', 'true');
        renderRelationshipCopyAction();
        summary.textContent = viewerText('viewer.passport.relationship.pinned', {
          from: record.fromLabel,
          to: record.toLabel,
          label: record.label
        });
        revealPinnedRelationship(record);
        if (options.updateUrl !== false && record.id) {
          try { ArchifyAddress.replaceState(null, '', ArchifyAddress.location.pathname + ArchifyAddress.location.search + '#relation=' + encodeURIComponent(record.id)); } catch (_) {}
        }
        return true;
      }
      function inspectRelationshipById(id, options) {
        var record = relationshipHitRecords().find(function (item) { return item.id === id; });
        return record ? inspectRelationship(record.key, options) : false;
      }
      function installRelationshipHitTargets() {
        if (html.getAttribute('data-embed') === 'true') return 0;
        var records = relationshipHitRecords();
        if (!records.length) return 0;
        relationshipHitOverlay = document.createElementNS(svgNamespace, 'g');
        relationshipHitOverlay.setAttribute('class', 'relationship-hit-overlay');
        relationshipHitOverlay.setAttribute('data-relationship-hit-overlay', '');
        relationshipHitOverlay.setAttribute('role', 'group');
        relationshipHitOverlay.setAttribute('aria-label', viewerText('viewer.passport.relationship.explorer'));
        var relationshipHelp = document.createElementNS(svgNamespace, 'desc');
        relationshipHelp.id = 'archify-relationship-help';
        relationshipHelp.textContent = viewerText('viewer.passport.relationship.help');
        relationshipHitOverlay.appendChild(relationshipHelp);
        records.forEach(function (record, index) {
          var target = document.createElementNS(svgNamespace, 'g');
          target.setAttribute('class', 'relationship-hit-target');
          target.setAttribute('data-relationship-hit-key', record.key);
          target.setAttribute('data-relationship-key', record.key);
          target.setAttribute('data-relationship-from', record.from);
          target.setAttribute('data-relationship-to', record.to);
          if (record.id) target.setAttribute('data-relationship-id', record.id);
          target.setAttribute('role', 'button');
          target.setAttribute('tabindex', index === 0 ? '0' : '-1');
          target.setAttribute('aria-pressed', 'false');
          target.setAttribute('aria-describedby', relationshipHelp.id);
          var description = viewerText('viewer.passport.relationship.inspect', {
            index: index + 1,
            total: records.length,
            from: record.fromLabel,
            to: record.toLabel,
            label: record.label
          });
          target.setAttribute('aria-label', description);
          var title = document.createElementNS(svgNamespace, 'title');
          title.textContent = record.fromLabel + ' \u2192 ' + record.toLabel + ' \u00b7 ' + record.label;
          target.appendChild(title);
          record.shapes.forEach(function (shape) {
            target.appendChild(relationshipHitGeometry(shape));
            target.appendChild(relationshipHitGeometry(shape, 'relationship-focus-rail'));
          });
          if (target.childNodes.length > 1) {
            relationshipHitTargets.push(target);
            relationshipHitOverlay.appendChild(target);
          }
        });
        if (!relationshipHitTargets.length) return 0;
        var firstNode = svg.querySelector('[data-node-id]');
        var nodeLayer = firstNode;
        while (nodeLayer && nodeLayer.parentNode && nodeLayer.parentNode !== svg) nodeLayer = nodeLayer.parentNode;
        if (nodeLayer && nodeLayer.parentNode === svg) svg.insertBefore(relationshipHitOverlay, nodeLayer);
        else svg.appendChild(relationshipHitOverlay);

        relationshipHitOverlay.addEventListener('pointerdown', function (event) {
          if (event.target.closest('[data-relationship-hit-key]')) event.stopPropagation();
        });
        relationshipHitOverlay.addEventListener('pointerover', function (event) {
          if (event.pointerType === 'touch') return;
          if (finePointerQuery && !finePointerQuery.matches) return;
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || directRelationshipBlocked() || pinnedRelationshipKey) return;
          if (event.relatedTarget && target.contains(event.relatedTarget)) return;
          hoveredRelationship = target;
          scheduleDirectRelationshipPreview(target);
        });
        relationshipHitOverlay.addEventListener('pointerout', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || (event.relatedTarget && target.contains(event.relatedTarget))) return;
          if (hoveredRelationship === target) hoveredRelationship = null;
          syncRelationshipPreview();
        });
        relationshipHitOverlay.addEventListener('focusin', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || directRelationshipBlocked()) return;
          focusedRelationship = target;
          if (!pinnedRelationshipKey) previewRelationship(target, { direct: true });
        });
        relationshipHitOverlay.addEventListener('focusout', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || (event.relatedTarget && target.contains(event.relatedTarget))) return;
          if (focusedRelationship === target) focusedRelationship = null;
          syncRelationshipPreview();
        });
        relationshipHitOverlay.addEventListener('click', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target || directRelationshipBlocked()) return;
          event.preventDefault();
          event.stopPropagation();
          focusedRelationship = null;
          hoveredRelationship = null;
          inspectRelationship(target.getAttribute('data-relationship-key'));
        });
        relationshipHitOverlay.addEventListener('keydown', function (event) {
          var target = event.target.closest('[data-relationship-hit-key]');
          if (!target) return;
          if (event.key === 'Escape' && pinnedRelationshipKey) {
            event.preventDefault();
            clear({ updateUrl: false });
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            focusedRelationship = null;
            hoveredRelationship = null;
            inspectRelationship(target.getAttribute('data-relationship-key'));
            return;
          }
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
          var index = relationshipHitTargets.indexOf(target);
          if (event.key === 'Home') index = 0;
          else if (event.key === 'End') index = relationshipHitTargets.length - 1;
          else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % relationshipHitTargets.length;
          else index = (index - 1 + relationshipHitTargets.length) % relationshipHitTargets.length;
          event.preventDefault();
          relationshipHitTargets.forEach(function (item, itemIndex) { item.setAttribute('tabindex', itemIndex === index ? '0' : '-1'); });
          try { relationshipHitTargets[index].focus({ preventScroll: true }); }
          catch (_) { try { relationshipHitTargets[index].focus(); } catch (_) {} }
        });
        return relationshipHitTargets.length;
      }
      function renderRelationshipLens(id, byId) {
        hoveredRelationship = null;
        focusedRelationship = null;
        clearRelationshipPreview({ clearPin: true });
        renderPassport(id, byId[id]);
        var relationships = relationshipsFor(id, byId);
        chip.removeAttribute('data-relations-expanded');
        relationsBtn.setAttribute('aria-expanded', 'false');
        relationsBtn.textContent = viewerCount('viewer.passport.relationship.count', relationships.length);
        relationsBtn.setAttribute('aria-label', viewerCount('viewer.passport.relationship.show', relationships.length));
        var counts = { out: 0, in: 0, loop: 0 };
        relationships.forEach(function (relationship) { counts[relationship.direction] += 1; });
        summary.textContent = viewerText('viewer.passport.relationship.summary', {
          out: counts.out,
          in: counts.in,
          loops: counts.loop ? viewerText('viewer.passport.relationship.loops', { count: counts.loop }) : ''
        });
        renderReachabilityControls(id);
        relationshipList.textContent = '';
        if (!relationships.length) {
          var empty = document.createElement('p');
          empty.className = 'relationship-lens-empty';
          empty.textContent = viewerText('viewer.passport.relationship.none');
          relationshipList.appendChild(empty);
          return;
        }

        [
          { id: 'out', label: viewerText('viewer.passport.relationship.group.out') },
          { id: 'in', label: viewerText('viewer.passport.relationship.group.in') },
          { id: 'loop', label: viewerText('viewer.passport.relationship.group.loop') }
        ].forEach(function (group) {
          var items = relationships.filter(function (relationship) { return relationship.direction === group.id; });
          if (!items.length) return;
          var section = document.createElement('div');
          section.className = 'relationship-lens-group';
          var heading = document.createElement('span');
          heading.className = 'relationship-lens-group-title';
          heading.textContent = group.label + ' · ' + items.length;
          section.appendChild(heading);
          items.forEach(function (relationship) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'relationship-lens-row';
            button.setAttribute('data-direction', relationship.direction);
            button.setAttribute('data-relationship-target', relationship.neighborId);
            button.setAttribute('data-relationship-key', relationship.key);
            button.setAttribute('data-relationship-from', relationship.from);
            button.setAttribute('data-relationship-to', relationship.to);
            if (relationship.id) button.setAttribute('data-relationship-id', relationship.id);
            button.setAttribute('aria-label', viewerText('viewer.passport.relationship.row', {
              group: group.label,
              relationship: relationship.label,
              neighbor: relationship.neighborLabel
            }));
            var direction = document.createElement('span');
            direction.className = 'relationship-lens-direction';
            direction.setAttribute('aria-hidden', 'true');
            direction.textContent = viewerText(relationship.direction === 'out'
              ? 'viewer.passport.relationship.direction.out'
              : relationship.direction === 'in'
                ? 'viewer.passport.relationship.direction.in'
                : 'viewer.passport.relationship.direction.loop');
            var target = document.createElement('strong');
            target.textContent = relationship.neighborLabel;
            var relation = document.createElement('small');
            relation.textContent = relationship.label;
            button.appendChild(direction);
            button.appendChild(target);
            button.appendChild(relation);
            section.appendChild(button);
          });
          relationshipList.appendChild(section);
        });
      }
      function lensPlacementBounds() {
        var containerRect = container.getBoundingClientRect();
        if (containerRect.width <= 0 || containerRect.height <= 0 || chip.offsetWidth <= 0 || chip.offsetHeight <= 0) return null;
        var padding = window.innerWidth <= 720 ? 8 : 16;
        var visibleLeft = Math.max(padding, -containerRect.left + padding);
        var visibleRight = Math.min(
          container.clientWidth - padding,
          window.innerWidth - containerRect.left - padding
        );
        var visibleTop = Math.max(padding, -containerRect.top + padding);
        var visibleBottom = Math.min(
          container.clientHeight - padding,
          window.innerHeight - containerRect.top - padding
        );
        var minLeft = visibleLeft;
        var minTop = Math.min(visibleTop, Math.max(padding, visibleBottom - chip.offsetHeight));
        return {
          containerRect: containerRect,
          minLeft: minLeft,
          maxLeft: Math.max(minLeft, visibleRight - chip.offsetWidth),
          minTop: minTop,
          maxTop: Math.max(minTop, visibleBottom - chip.offsetHeight)
        };
      }
      function manualLensPlacementAvailable() {
        return window.innerWidth > 720 && (!finePointerQuery || finePointerQuery.matches);
      }
      function clampLensPosition(position, bounds) {
        if (!position || !bounds) return null;
        return {
          left: Math.max(bounds.minLeft, Math.min(bounds.maxLeft, position.left)),
          top: Math.max(bounds.minTop, Math.min(bounds.maxTop, position.top))
        };
      }
      function currentLensPosition() {
        var bounds = lensPlacementBounds();
        if (!bounds) return null;
        var rect = chip.getBoundingClientRect();
        return clampLensPosition({
          left: rect.left - bounds.containerRect.left,
          top: rect.top - bounds.containerRect.top
        }, bounds);
      }
      function applyManualLensPosition(position) {
        if (!manualLensPlacementAvailable()) return false;
        var bounds = lensPlacementBounds();
        var clamped = clampLensPosition(position, bounds);
        if (!clamped) return false;
        manualLensPosition = clamped;
        chip.setAttribute('data-manual-placement', 'true');
        chip.style.left = Math.round(clamped.left) + 'px';
        chip.style.top = Math.round(clamped.top) + 'px';
        if (Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
        return true;
      }
      function resetLensPlacement(options) {
        options = options || {};
        manualLensPosition = null;
        chip.removeAttribute('data-manual-placement');
        chip.style.removeProperty('left');
        chip.style.removeProperty('top');
        if (options.reposition !== false && !chip.hidden) requestLensPlacement();
      }
      function beginLensDrag(event) {
        if (!manualLensPlacementAvailable() || event.button !== 0 || lensDrag) return;
        var start = currentLensPosition();
        if (!start) return;
        event.preventDefault();
        event.stopPropagation();
        lensDrag = {
          pointerId: event.pointerId,
          originX: event.clientX,
          originY: event.clientY,
          start: start,
          previousManual: manualLensPosition ? { left: manualLensPosition.left, top: manualLensPosition.top } : null,
          moved: false
        };
        chip.setAttribute('data-panel-dragging', 'true');
        try { moveBtn.setPointerCapture(event.pointerId); } catch (_) {}
      }
      function moveLensDrag(event) {
        if (!lensDrag || lensDrag.pointerId !== event.pointerId) return;
        var dx = event.clientX - lensDrag.originX;
        var dy = event.clientY - lensDrag.originY;
        if (!lensDrag.moved && Math.hypot(dx, dy) <= 3) return;
        lensDrag.moved = true;
        event.preventDefault();
        event.stopPropagation();
        applyManualLensPosition({ left: lensDrag.start.left + dx, top: lensDrag.start.top + dy });
      }
      function finishLensDrag(event, cancel) {
        if (!lensDrag || lensDrag.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        var activeDrag = lensDrag;
        lensDrag = null;
        chip.removeAttribute('data-panel-dragging');
        try { moveBtn.releasePointerCapture(event.pointerId); } catch (_) {}
        if (!cancel) return;
        manualLensPosition = activeDrag.previousManual
          ? { left: activeDrag.previousManual.left, top: activeDrag.previousManual.top }
          : null;
        if (manualLensPosition && manualLensPlacementAvailable()) {
          applyManualLensPosition(manualLensPosition);
        } else {
          chip.removeAttribute('data-manual-placement');
          chip.style.removeProperty('left');
          chip.style.removeProperty('top');
          if (!chip.hidden) requestLensPlacement();
        }
      }
      function moveLensWithKeyboard(event) {
        if (event.key === 'Home') {
          event.preventDefault();
          resetLensPlacement();
          return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey || !manualLensPlacementAvailable()) return;
        var directions = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1]
        };
        var direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        var current = manualLensPosition || currentLensPosition();
        if (!current) return;
        var distance = event.shiftKey ? 4 : 16;
        applyManualLensPosition({
          left: current.left + direction[0] * distance,
          top: current.top + direction[1] * distance
        });
      }
      var lensFrame = 0;
      function placeRelationshipLens() {
        if (lensFrame) {
          cancelAnimationFrame(lensFrame);
          lensFrame = 0;
        }
        if (chip.hidden || activeIds.length !== 1 || !container.contains(chip)) return;
        var node = svg.querySelector('[data-node-id="' + activeIds[0] + '"]');
        if (!node) return;
        var containerRect = container.getBoundingClientRect();
        var nodeRect = node.getBoundingClientRect();
        if (containerRect.bottom <= 0 || containerRect.top >= window.innerHeight) return;
        var padding = window.innerWidth <= 720 ? 8 : 16;
        var visibleTop = Math.max(padding, -containerRect.top + padding);
        var visibleBottom = Math.min(containerRect.height - padding, window.innerHeight - containerRect.top - padding);
        var maxTop = Math.max(padding, visibleBottom - chip.offsetHeight);
        var minTop = Math.min(visibleTop, maxTop);
        var mobile = window.innerWidth <= 720;
        if (!manualLensPlacementAvailable()) {
          chip.removeAttribute('data-manual-placement');
          chip.style.removeProperty('left');
        } else if (manualLensPosition) {
          applyManualLensPosition(manualLensPosition);
          return;
        }
        var nodeCenter = nodeRect.top - containerRect.top + nodeRect.height / 2;
        var previewingOnMobile = mobile && chip.getAttribute('data-relationship-previewing') === 'true';
        var compactOnMobile = mobile && chip.getAttribute('data-relations-expanded') !== 'true';
        var preferred;
        if (compactOnMobile) {
          var nodeTop = nodeRect.top - containerRect.top;
          var nodeBottom = nodeRect.bottom - containerRect.top;
          var gap = 10;
          var above = nodeTop - chip.offsetHeight - gap;
          var below = nodeBottom + gap;
          if (above >= visibleTop) preferred = above;
          else if (below + chip.offsetHeight <= visibleBottom - 56) preferred = below;
          else preferred = nodeCenter < (visibleTop + visibleBottom) / 2
            ? Math.max(minTop, visibleBottom - chip.offsetHeight - 56)
            : visibleTop;
        } else if (previewingOnMobile) {
          var pinnedTop = visibleTop;
          var pinnedBottom = Math.max(minTop, visibleBottom - chip.offsetHeight - 56);
          preferred = nodeCenter < (visibleTop + visibleBottom) / 2 ? pinnedBottom : pinnedTop;
        } else {
          preferred = nodeCenter - chip.offsetHeight / 2;
        }
        var top = Math.max(minTop, Math.min(maxTop, preferred));
        var chipRect = chip.getBoundingClientRect();
        var safeGap = 10;
        var protectViewerChrome = !mobile || compactOnMobile || previewingOnMobile;
        var protectedRects = (protectViewerChrome
          ? [svg.querySelector('[data-legend]'), container.querySelector('.diagram-nav')]
          : [])
          .filter(function (element) {
            if (!element || element.hidden) return false;
            var style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map(function (element) { return element.getBoundingClientRect(); })
          .filter(function (rect) {
            return rect.width > 0 && rect.height > 0 &&
              chipRect.left < rect.right + safeGap && chipRect.right > rect.left - safeGap;
          });
        if (protectedRects.length) {
          var candidates = [top, minTop, maxTop];
          protectedRects.forEach(function (rect) {
            candidates.push(
              rect.top - containerRect.top - chip.offsetHeight - safeGap,
              rect.bottom - containerRect.top + safeGap
            );
          });
          var valid = candidates.map(function (candidate) {
            return Math.max(minTop, Math.min(maxTop, candidate));
          }).filter(function (candidate, index, all) {
            if (all.indexOf(candidate) !== index) return false;
            var candidateTop = containerRect.top + candidate;
            var candidateBottom = candidateTop + chip.offsetHeight;
            return protectedRects.every(function (rect) {
              return candidateBottom <= rect.top - safeGap || candidateTop >= rect.bottom + safeGap;
            });
          });
          valid.sort(function (first, second) {
            return Math.abs(first - preferred) - Math.abs(second - preferred);
          });
          if (valid.length) top = valid[0];
        }
        chip.style.top = Math.round(top) + 'px';
        if (Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
      }
      function requestLensPlacement() {
        if (lensFrame) return;
        lensFrame = requestAnimationFrame(placeRelationshipLens);
      }
      function clear(options) {
        options = options || {};
        if (lensDrag) {
          var dragPointerId = lensDrag.pointerId;
          lensDrag = null;
          chip.removeAttribute('data-panel-dragging');
          try { moveBtn.releasePointerCapture(dragPointerId); } catch (_) {}
        }
        var restoreNode = options.restoreFocus === true && activeIds.length === 1
          ? svg.querySelector('[data-node-id="' + activeIds[0] + '"]')
          : null;
        clearReachability({ updateUrl: false });
        if (Archify.intentTrace && typeof Archify.intentTrace.clear === 'function') {
          Archify.intentTrace.clear({ announce: false });
        }
        hoveredRelationship = null;
        focusedRelationship = null;
        clearRelationshipPreview({ clearPin: true });
        activeIds = [];
        svg.removeAttribute('data-focus-active');
        nodes().forEach(function (node) {
          node.removeAttribute('data-focus-match');
          node.removeAttribute('data-focus-selected');
          node.setAttribute('aria-pressed', 'false');
        });
        edges().forEach(function (edge) { edge.removeAttribute('data-focus-match'); });
        chip.hidden = true;
        label.textContent = '';
        detail.textContent = '';
        detail.hidden = true;
        Archify.internalStructure.clearQuicklook();
        kind.textContent = '';
        kind.hidden = true;
        context.textContent = '';
        context.hidden = true;
        tag.textContent = '';
        tag.hidden = true;
        semanticId.textContent = '';
        semanticId.hidden = true;
        evidence.hidden = true;
        evidenceLinks.textContent = '';
        repositoryLink.removeAttribute('href');
        repositoryLink.textContent = '';
        summary.textContent = '';
        reachSection.hidden = true;
        upstreamCount.textContent = '0';
        downstreamCount.textContent = '0';
        upstreamBtn.disabled = true;
        downstreamBtn.disabled = true;
        relationshipList.textContent = '';
        copyBtn.textContent = viewerText('viewer.passport.copy');
        copyBtn.setAttribute('aria-label', viewerText('viewer.passport.copy.focus'));
        relationsBtn.textContent = viewerText('viewer.passport.relations');
        relationsBtn.setAttribute('aria-label', viewerText('viewer.passport.relations.show'));
        relationsBtn.setAttribute('aria-expanded', 'false');
        chip.removeAttribute('data-relations-expanded');
        if (options.preserveLensPlacement !== true) resetLensPlacement({ reposition: false });
        if (options.preserveView !== true && atlasInspection() && Archify.view) Archify.view.hold();
        if (options.preserveView !== true && !atlasInspection() && Archify.view && typeof Archify.view.reset === 'function') {
          Archify.view.reset({ automatic: true });
        }
        if (options.updateUrl !== false) {
          try { ArchifyAddress.replaceState(null, '', ArchifyAddress.location.pathname + ArchifyAddress.location.search); } catch (_) {}
          Archify.internalStructure.syncAddress().catch(function () {});
        }
        if (restoreNode) {
          try { restoreNode.focus({ preventScroll: true }); }
          catch (_) { try { restoreNode.focus(); } catch (_) {} }
        }
      }

      function setMany(ids, options) {
        options = options || {};
        if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (Archify.semanticLens && Archify.semanticLens.active()) {
          Archify.semanticLens.clear({ updateUrl: false, preserveView: true, closePanel: true });
        }
        if (options.preserveRoute !== true && Archify.routeProbe && typeof Archify.routeProbe.clear === 'function') {
          Archify.routeProbe.clear({ updateUrl: false, restoreFocus: false });
        }
        var nodeList = nodes();
        var byId = Object.create(null);
        nodeList.forEach(function (node) { byId[node.getAttribute('data-node-id')] = node; });
        var normalized = [];
        (ids || []).forEach(function (id) {
          if (byId[id] && normalized.indexOf(id) === -1) normalized.push(id);
        });
        if (!normalized.length) return false;
        if (normalized.length === activeIds.length && normalized.every(function (id, index) { return activeIds[index] === id; }) && options.toggle !== false) {
          clear();
          return true;
        }

        var preserveLensPlacement = activeIds.length === 1 && normalized.length === 1 && !chip.hidden;
        clear({ updateUrl: false, preserveView: true, preserveLensPlacement: preserveLensPlacement });
        activeIds = normalized;
        var selected = Object.create(null);
        var related = Object.create(null);
        var seenEdges = {};
        var matchedEdges = 0;
        normalized.forEach(function (id) { selected[id] = true; related[id] = true; });
        var selectionMode = options.mode === 'selection' || normalized.length > 1;

        edges().forEach(function (edge) {
          var from = edge.getAttribute('data-edge-from');
          var to = edge.getAttribute('data-edge-to');
          var match = selectionMode ? selected[from] && selected[to] : selected[from] || selected[to];
          if (!match) return;
          edge.setAttribute('data-focus-match', '');
          if (!selectionMode) { related[from] = true; related[to] = true; }
          var edgeKey = edge.getAttribute('data-edge-key') || (from + '\u0000' + to + '\u0000' + (edge.getAttribute('data-edge-label') || ''));
          if (!seenEdges[edgeKey]) { seenEdges[edgeKey] = true; matchedEdges += 1; }
        });
        nodeList.forEach(function (node) {
          var nodeId = node.getAttribute('data-node-id');
          if (related[nodeId]) node.setAttribute('data-focus-match', '');
          if (selected[nodeId]) {
            node.setAttribute('data-focus-selected', '');
            node.setAttribute('aria-pressed', 'true');
          }
        });
        svg.setAttribute('data-focus-active', normalized.join(' '));
        var defaultLabel = normalized.length === 1
          ? nodeLabel(byId[normalized[0]], normalized[0])
          : viewerText('viewer.guided.chapter.selectedNodes', { count: normalized.length });
        label.textContent = options.label || defaultLabel;
        chip.hidden = options.hideChip === true || normalized.length !== 1 || selectionMode;
        if (!chip.hidden) {
          renderRelationshipLens(normalized[0], byId);
          placeRelationshipLens();
        }
        if (options.updateUrl !== false) {
          var key = options.urlKey || 'focus';
          var value = options.urlValue || normalized[0];
          try { ArchifyAddress.replaceState(null, '', ArchifyAddress.location.pathname + ArchifyAddress.location.search + '#' + key + '=' + encodeURIComponent(value)); } catch (_) {}
          Archify.internalStructure.syncAddress().catch(function () {});
        }
        return true;
      }

      function set(id, options) {
        options = options || {};
        options.mode = 'neighborhood';
        return setMany([id], options);
      }

      function copyFocusLink() {
        if (activeIds.length !== 1) return Promise.resolve(false);
        var record = pinnedRelationshipRecord();
        var relationId = record && record.id;
        var value = ArchifyAddress.share(relationId
          ? '#relation=' + encodeURIComponent(relationId)
          : '#focus=' + encodeURIComponent(activeIds[0]) + (reachabilityMode ? '&reach=' + reachabilityMode : ''));
        var copy = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
          ? navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return fallbackCopy(value); })
          : Promise.resolve(fallbackCopy(value));
        return copy.then(function (copied) {
          copyBtn.textContent = viewerText(copied ? 'viewer.common.copied' : 'viewer.common.copyFailed');
          copyBtn.setAttribute('aria-label', copied
            ? viewerText(relationId ? 'viewer.passport.copy.pinned.success' : 'viewer.passport.copy.focused.success')
            : viewerText(relationId ? 'viewer.passport.copy.pinned.failed' : 'viewer.passport.copy.focused.failed'));
          window.setTimeout(function () {
            renderRelationshipCopyAction();
          }, 1600);
          return copied;
        });
      }

      svg.addEventListener('click', function (event) {
        if (container.getAttribute('data-just-panned') === 'true') return;
        var node = event.target.closest('[data-node-id]');
        if (node) {
          var id = node.getAttribute('data-node-id');
          if (atlasInspection() && Archify.view) Archify.view.hold();
          set(id);
          if (!atlasInspection() && activeIds.indexOf(id) !== -1 && Archify.view && typeof Archify.view.reveal === 'function') {
            Archify.view.reveal([id], { includeNeighbors: true, reason: 'focus' });
          }
        }
        else if (activeIds.length) clear();
      });
      svg.addEventListener('keydown', function (event) {
        var node = event.target.closest('[data-node-id]');
        if (!node || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        var id = node.getAttribute('data-node-id');
        if (atlasInspection() && Archify.view) Archify.view.hold();
        set(id);
        if (!atlasInspection() && activeIds.indexOf(id) !== -1 && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'focus' });
        }
      });
      moveBtn.addEventListener('pointerdown', beginLensDrag);
      moveBtn.addEventListener('pointermove', moveLensDrag);
      moveBtn.addEventListener('pointerup', function (event) { finishLensDrag(event, false); });
      moveBtn.addEventListener('pointercancel', function (event) { finishLensDrag(event, true); });
      moveBtn.addEventListener('lostpointercapture', function (event) { finishLensDrag(event, true); });
      moveBtn.addEventListener('dblclick', function (event) {
        event.preventDefault();
        event.stopPropagation();
        resetLensPlacement();
      });
      moveBtn.addEventListener('keydown', moveLensWithKeyboard);
      clearBtn.addEventListener('click', function () { clear({ restoreFocus: true }); });
      copyBtn.addEventListener('click', copyFocusLink);
      upstreamBtn.addEventListener('click', function () { applyReachability('upstream'); });
      downstreamBtn.addEventListener('click', function () { applyReachability('downstream'); });
      relationsBtn.addEventListener('click', function () {
        var expanded = chip.getAttribute('data-relations-expanded') === 'true';
        if (expanded) chip.removeAttribute('data-relations-expanded');
        else chip.setAttribute('data-relations-expanded', 'true');
        relationsBtn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        relationsBtn.setAttribute('aria-label', viewerText(expanded
          ? 'viewer.passport.relations.show'
          : 'viewer.passport.relations.hide'));
        placeRelationshipLens();
      });
      relationshipList.addEventListener('click', function (event) {
        var button = event.target.closest('[data-relationship-target]');
        if (!button) return;
        var id = button.getAttribute('data-relationship-target');
        var relationshipKey = button.getAttribute('data-relationship-key');
        if (atlasInspection() && Archify.view) Archify.view.hold();
        if (Archify.guidedViews && typeof Archify.guidedViews.showAll === 'function') {
          Archify.guidedViews.showAll({ clearFocus: false, updateUrl: false, resetView: !atlasInspection() });
        }
        set(id, { toggle: false });
        if (!atlasInspection() && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'relationship' });
        }
        var nextFocus = atlasInspection()
          ? Array.prototype.filter.call(relationshipList.querySelectorAll('[data-relationship-key]'), function (row) {
            return row.getAttribute('data-relationship-key') === relationshipKey;
          })[0] || relationsBtn
          : svg.querySelector('[data-node-id="' + id + '"]');
        if (nextFocus) {
          try { nextFocus.focus({ preventScroll: true }); } catch (_) { try { nextFocus.focus(); } catch (_) {} }
        }
      });
      relationshipList.addEventListener('pointerover', function (event) {
        if (event.pointerType === 'touch') return;
        if (finePointerQuery && !finePointerQuery.matches) return;
        var button = event.target.closest('[data-relationship-key]');
        if (!button || !relationshipList.contains(button)) return;
        if (event.relatedTarget && button.contains(event.relatedTarget)) return;
        hoveredRelationship = button;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('pointerout', function (event) {
        var button = event.target.closest('[data-relationship-key]');
        if (!button || (event.relatedTarget && button.contains(event.relatedTarget))) return;
        if (hoveredRelationship === button) hoveredRelationship = null;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('focusin', function (event) {
        var button = event.target.closest('[data-relationship-key]');
        if (!button) return;
        focusedRelationship = button;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('focusout', function (event) {
        var button = event.target.closest('[data-relationship-key]');
        if (!button || (event.relatedTarget && button.contains(event.relatedTarget))) return;
        if (focusedRelationship === button) focusedRelationship = null;
        syncRelationshipPreview();
      });
      relationshipList.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
        var buttons = Array.prototype.slice.call(relationshipList.querySelectorAll('[data-relationship-target]'));
        if (!buttons.length) return;
        var index = buttons.indexOf(document.activeElement);
        if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = buttons.length - 1;
        else if (event.key === 'ArrowDown') index = Math.min(buttons.length - 1, Math.max(0, index + 1));
        else index = Math.max(0, index < 0 ? 0 : index - 1);
        event.preventDefault();
        buttons[index].focus();
      });
      document.addEventListener('click', function (event) {
        var target = event.target;
        if (Archify.internalStructure.surface() === 'structure') return;
        if (chip.hidden || !target || typeof target.closest !== 'function' || chip.contains(target)) return;
        if (container.getAttribute('data-just-panned') === 'true') return;
        if (target.closest('[data-node-id], [data-relationship-hit-key], .overview-map, .atlas-navigation, .atlas-compact-navigation, .atlas-directory, .atlas-breadcrumb, .atlas-parent-context, .atlas-rail, .atlas-inspector, .atlas-directory-section')) return;
        clear();
      }, true);
      window.addEventListener('scroll', requestLensPlacement, { passive: true });
      window.addEventListener('resize', requestLensPlacement);
      container.addEventListener('scroll', requestLensPlacement, { passive: true });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) removeRelationshipPulse();
      });
      function syncRelationshipMotionPreference(event) {
        if (event.matches) removeRelationshipPulse();
      }
      if (reducedMotionQuery) {
        if (typeof reducedMotionQuery.addEventListener === 'function') {
          reducedMotionQuery.addEventListener('change', syncRelationshipMotionPreference);
        } else if (typeof reducedMotionQuery.addListener === 'function') {
          reducedMotionQuery.addListener(syncRelationshipMotionPreference);
        }
      }

      installRelationshipHitTargets();

      function syncFocusFromHash() {
        try {
          var params = new URLSearchParams(ArchifyAddress.location.hash.replace(/^#/, ''));
          var relation = params.get('relation');
          var initial = params.get('focus');
          var reach = params.get('reach');
          if (relation) {
            if (html.getAttribute('data-embed') === 'true' ||
                !inspectRelationshipById(relation, { updateUrl: false, toggle: false })) clear({ updateUrl: false });
          }
          else if (initial) {
            if (set(initial, { updateUrl: false, toggle: false }) &&
                (reach === 'upstream' || reach === 'downstream')) {
              applyReachability(reach, { updateUrl: false, toggle: false, reveal: false });
            }
          }
          else if (!params.get('view')) clear({ updateUrl: false });
        } catch (_) {}
      }

      window.addEventListener('hashchange', syncFocusFromHash);
      syncFocusFromHash();

      return {
        set: set,
        setMany: setMany,
        clear: clear,
        copyLink: copyFocusLink,
        reach: applyReachability,
        clearReach: clearReachability,
        reachabilitySnapshot: reachabilitySnapshot,
        inspectRelationship: inspectRelationship,
        inspectRelationshipById: inspectRelationshipById,
        reposition: placeRelationshipLens,
        relationship: function () {
          var record = pinnedRelationshipRecord();
          return record ? { id: record.id || null, key: record.key, from: record.from, to: record.to, label: record.label } : null;
        },
        reachability: function () {
          return activeReachability ? {
            direction: activeReachability.direction,
            originId: activeReachability.originId,
            nodeIds: activeReachability.nodeIds.slice(),
            edgeKeys: activeReachability.edgeKeys.slice(),
            maxDepth: activeReachability.maxDepth
          } : null;
        },
        active: function () { return activeIds.length === 0 ? null : (activeIds.length === 1 ? activeIds[0] : activeIds.slice()); }
      };
    })();
    Archify.internalStructure.connect();
