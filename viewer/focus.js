    /* ============================================================
       Explore — stable-ID neighborhood focus + dependency-free pan/zoom.
       Renderer IDs become deep-linkable semantic hooks without turning the
       standalone artifact into a canvas editor.
       ============================================================ */
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
      var activeIds = [];
      var hoveredRelationship = null;
      var focusedRelationship = null;
      var pinnedRelationship = null;
      var pinnedRelationshipKey = null;
      var activeRelationshipPreview = null;
      var relationshipHitOverlay = null;
      var relationshipHitTargets = [];
      var directPreviewTimer = null;
      var reachabilityMode = null;
      var activeReachability = null;
      var svgNamespace = 'http://www.w3.org/2000/svg';
      var reducedMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      var finePointerQuery = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;

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
            history.replaceState(null, '', location.pathname + location.search + '#focus=' + encodeURIComponent(activeIds[0]));
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
            history.replaceState(null, '', location.pathname + location.search + '#focus=' +
              encodeURIComponent(activeIds[0]) + '&reach=' + direction);
          } catch (_) {}
        }
        if (options.reveal !== false && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal(result.nodeIds, { includeNeighbors: false, reason: 'reachability' });
        }
        requestLensPlacement();
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
        var recordsById = {};
        var byId = {};
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
        requestLensPlacement();
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
        requestLensPlacement();
      }
      function syncRelationshipPreview() {
        var next = pinnedRelationship || focusedRelationship || hoveredRelationship;
        if (next === activeRelationshipPreview) return;
        previewRelationship(next, { direct: !!(next && next.hasAttribute('data-relationship-hit-key')) });
      }
      function directRelationshipBlocked() {
        return html.getAttribute('data-embed') === 'true' ||
          html.getAttribute('data-guide-open') === 'true' ||
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
          try { history.replaceState(null, '', location.pathname + location.search + '#relation=' + encodeURIComponent(record.id)); } catch (_) {}
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
      var lensFrame = 0;
      function placeRelationshipLens() {
        lensFrame = 0;
        if (chip.hidden || activeIds.length !== 1) return;
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
        var nodeCenter = nodeRect.top - containerRect.top + nodeRect.height / 2;
        var mobile = window.innerWidth <= 720;
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
        chip.style.removeProperty('top');
        if (options.preserveView !== true && Archify.view && typeof Archify.view.reset === 'function') {
          Archify.view.reset({ automatic: true });
        }
        if (options.updateUrl !== false) {
          try { history.replaceState(null, '', location.pathname + location.search); } catch (_) {}
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
        var byId = {};
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

        clear({ updateUrl: false, preserveView: true });
        activeIds = normalized;
        var selected = {};
        var related = {};
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
          requestLensPlacement();
        }
        if (options.updateUrl !== false) {
          var key = options.urlKey || 'focus';
          var value = options.urlValue || normalized[0];
          try { history.replaceState(null, '', location.pathname + location.search + '#' + key + '=' + encodeURIComponent(value)); } catch (_) {}
        }
        return true;
      }

      function set(id, options) {
        options = options || {};
        options.mode = 'neighborhood';
        return setMany([id], options);
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

      function copyFocusLink() {
        if (activeIds.length !== 1) return Promise.resolve(false);
        var record = pinnedRelationshipRecord();
        var relationId = record && record.id;
        var value = location.href.replace(/#.*$/, '') + (relationId
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
          set(id);
          if (activeIds.indexOf(id) !== -1 && Archify.view && typeof Archify.view.reveal === 'function') {
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
        set(id);
        if (activeIds.indexOf(id) !== -1 && Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'focus' });
        }
      });
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
        requestLensPlacement();
      });
      relationshipList.addEventListener('click', function (event) {
        var button = event.target.closest('[data-relationship-target]');
        if (!button) return;
        var id = button.getAttribute('data-relationship-target');
        if (Archify.guidedViews && typeof Archify.guidedViews.showAll === 'function') {
          Archify.guidedViews.showAll({ clearFocus: false, updateUrl: false });
        }
        set(id, { toggle: false });
        if (Archify.view && typeof Archify.view.reveal === 'function') {
          Archify.view.reveal([id], { includeNeighbors: true, reason: 'relationship' });
        }
        var node = svg.querySelector('[data-node-id="' + id + '"]');
        if (node) {
          try { node.focus({ preventScroll: true }); } catch (_) { try { node.focus(); } catch (_) {} }
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
        if (chip.hidden || !target || typeof target.closest !== 'function' || chip.contains(target)) return;
        if (container.getAttribute('data-just-panned') === 'true') return;
        if (target.closest('[data-node-id], [data-relationship-hit-key], .overview-map')) return;
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
          var params = new URLSearchParams(location.hash.replace(/^#/, ''));
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
        reposition: requestLensPlacement,
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