    /* ============================================================
       Export — Share Card / PNG / JPEG / WebP / SVG / WebM and clipboard

       Raster exports are always rendered at 4x source resolution for
       maximum sharpness. The trick: we set the serialized SVG's
       `width`/`height` to viewBox * 4 so the browser rasterizes the
       vectors at that resolution natively. drawImage then draws at
       the image's natural size (no upscaling = no blur).

       JPEG/WebP paint the current theme's background explicitly since
       those formats have no alpha channel.
       ============================================================ */
    (function () {
      var RASTER_SCALE = 4;
      var MOTION_DURATION = 6000;
      var MOTION_FPS = 30;
      var SHARE_CARD_WIDTH = 1200;
      var SHARE_CARD_HEIGHT = 630;
      var SHARE_CARD_PADDING = 36;
      var SHARE_CARD_HEADER = 112;

      function exportError(key, values) {
        var error = new Error(viewerText(key, values));
        error.archifyViewerMessage = true;
        return error;
      }

      function exportMessage(error) {
        return error && error.archifyViewerMessage
          ? error.message
          : viewerText('viewer.export.unknown');
      }

      function diagramFilename() {
        var title = (document.title || 'diagram')
          .replace(/\s+Architecture(\s+Diagram)?$/i, '')
          .replace(/\s+Diagram$/i, '')
          .trim();
        return title.replace(/[^a-z0-9_\-]+/gi, '-')
                    .toLowerCase()
                    .replace(/^-+|-+$/g, '') || 'diagram';
      }

      function currentBg() {
        return getComputedStyle(document.body).backgroundColor || '#ffffff';
      }

/* ARCHIFY:EXPORT_CLEANUP */

      /**
       * Serialize the main SVG into a standalone document.
       *
       * Two modes:
       * - Default (opts.autoTheme=false) — locks the serialized SVG to the
       *   viewer's current theme. Used by the raster pipeline
       *   (PNG/JPEG/WebP/clipboard) because canvas rasterization needs
       *   deterministic colors; a raster cannot react to
       *   prefers-color-scheme after encoding.
       * - autoTheme=true — emits BOTH dark and light variable sets plus a
       *   `@media (prefers-color-scheme)` rule so the resulting SVG
       *   self-themes when embedded in GitHub READMEs or other hosts that
       *   expose a color scheme. Used for "Download SVG".
       */
      function applyRouteSnapshot(clone, snapshot) {
        if (!snapshot || !Array.isArray(snapshot.nodeIds) || !Array.isArray(snapshot.edges) ||
            snapshot.nodeIds.length < 2 || snapshot.edges.length !== snapshot.nodeIds.length - 1 ||
            snapshot.hops !== snapshot.edges.length ||
            !snapshot.source || !snapshot.target ||
            snapshot.source.id !== snapshot.nodeIds[0] ||
            snapshot.target.id !== snapshot.nodeIds[snapshot.nodeIds.length - 1]) return false;

        clone.removeAttribute('data-animation');
        Array.prototype.forEach.call(clone.querySelectorAll('[data-animate]'), function (element) {
          element.removeAttribute('data-animate');
          element.style.removeProperty('--step');
        });

        var cloneNodes = Array.prototype.slice.call(clone.querySelectorAll('[data-node-id]'));
        var cloneEdges = Array.prototype.slice.call(clone.querySelectorAll('[data-edge-key]'));
        var nodeIds = Object.create(null);
        var edgeKeys = Object.create(null);
        var nodeMatches = [];
        var edgeMatches = [];

        for (var nodeIndex = 0; nodeIndex < snapshot.nodeIds.length; nodeIndex++) {
          var nodeId = snapshot.nodeIds[nodeIndex];
          if (typeof nodeId !== 'string' || !nodeId || nodeIds[nodeId]) return false;
          var matchedNodes = cloneNodes.filter(function (candidate) {
            return candidate.getAttribute('data-node-id') === nodeId;
          });
          if (matchedNodes.length !== 1) return false;
          nodeIds[nodeId] = true;
          nodeMatches.push(matchedNodes);
        }

        for (var edgeIndex = 0; edgeIndex < snapshot.edges.length; edgeIndex++) {
          var edge = snapshot.edges[edgeIndex];
          var fromId = snapshot.nodeIds[edgeIndex];
          var toId = snapshot.nodeIds[edgeIndex + 1];
          if (!edge || typeof edge.key !== 'string' || !edge.key || edgeKeys[edge.key] ||
              edge.from !== fromId || edge.to !== toId) return false;
          var matchedEdges = cloneEdges.filter(function (candidate) {
            return candidate.getAttribute('data-edge-key') === edge.key;
          });
          var drawableMatches = matchedEdges.filter(hasDrawableGeometry);
          if (!matchedEdges.length || drawableMatches.length !== 1 || !matchedEdges.every(function (candidate) {
            return candidate.getAttribute('data-edge-from') === edge.from &&
              candidate.getAttribute('data-edge-to') === edge.to &&
              (candidate.getAttribute('data-edge-id') || '') === (edge.id || '');
          })) return false;
          edgeKeys[edge.key] = true;
          edgeMatches.push(matchedEdges);
        }

        clone.setAttribute('data-share-route', '');
        nodeMatches.forEach(function (matches, step) {
          matches.forEach(function (element) {
            element.setAttribute('data-share-route-match', '');
            element.setAttribute('data-share-route-step', String(step));
            if (step === 0) element.setAttribute('data-share-route-start', '');
            else if (step === snapshot.nodeIds.length - 1) element.setAttribute('data-share-route-end', '');
            else element.setAttribute('data-share-route-middle', '');
          });
        });
        edgeMatches.forEach(function (matches, step) {
          matches.forEach(function (element) {
            element.setAttribute('data-share-route-match', '');
            element.setAttribute('data-share-route-step', String(step));
          });
        });

        return clone.hasAttribute('data-share-route') &&
          !clone.hasAttribute('data-animation') &&
          !clone.hasAttribute('data-route-active') &&
          !clone.hasAttribute('data-route-journey') &&
          clone.querySelectorAll('[data-animate], [data-route-match], [data-route-step], [data-route-start], [data-route-end], [data-route-journey-state], [data-route-journey-current], [data-route-journey-overlay]').length === 0 &&
          clone.querySelectorAll('[data-share-route-match]').length ===
            nodeMatches.reduce(function (count, matches) { return count + matches.length; }, 0) +
            edgeMatches.reduce(function (count, matches) { return count + matches.length; }, 0);
      }

      function applyReachSnapshot(clone, snapshot) {
        if (!snapshot || (snapshot.direction !== 'upstream' && snapshot.direction !== 'downstream') ||
            !snapshot.origin || typeof snapshot.origin.id !== 'string' || !snapshot.origin.id ||
            typeof snapshot.origin.label !== 'string' || !snapshot.origin.label.trim() ||
            !Array.isArray(snapshot.nodeIds) || snapshot.nodeIds.length < 2 ||
            !Array.isArray(snapshot.edges) || !snapshot.edges.length ||
            !snapshot.depths || typeof snapshot.depths !== 'object' ||
            !Number.isInteger(snapshot.maxDepth) || snapshot.maxDepth < 1 ||
            snapshot.nodeIds[0] !== snapshot.origin.id) return false;

        clone.removeAttribute('data-animation');
        Array.prototype.forEach.call(clone.querySelectorAll('[data-animate]'), function (element) {
          element.removeAttribute('data-animate');
          element.style.removeProperty('--step');
        });

        var cloneNodes = Array.prototype.slice.call(clone.querySelectorAll('[data-node-id]'));
        var cloneEdges = Array.prototype.slice.call(clone.querySelectorAll('[data-edge-key]'));
        var nodeIds = Object.create(null);
        var edgeKeys = Object.create(null);
        var nodeMatches = [];
        var edgeMatches = [];
        var measuredMaxDepth = 0;

        for (var nodeIndex = 0; nodeIndex < snapshot.nodeIds.length; nodeIndex++) {
          var nodeId = snapshot.nodeIds[nodeIndex];
          var depth = snapshot.depths[nodeId];
          if (typeof nodeId !== 'string' || !nodeId || nodeIds[nodeId] ||
              !Number.isInteger(depth) || depth < 0 || depth > snapshot.maxDepth ||
              (nodeId === snapshot.origin.id ? depth !== 0 : depth < 1)) return false;
          var matchedNodes = cloneNodes.filter(function (candidate) {
            return candidate.getAttribute('data-node-id') === nodeId;
          });
          if (matchedNodes.length !== 1) return false;
          nodeIds[nodeId] = true;
          measuredMaxDepth = Math.max(measuredMaxDepth, depth);
          nodeMatches.push({ elements: matchedNodes, id: nodeId, depth: depth });
        }
        if (measuredMaxDepth !== snapshot.maxDepth) return false;

        for (var edgeIndex = 0; edgeIndex < snapshot.edges.length; edgeIndex++) {
          var edge = snapshot.edges[edgeIndex];
          if (!edge || typeof edge.key !== 'string' || !edge.key || edgeKeys[edge.key] ||
              !nodeIds[edge.from] || !nodeIds[edge.to] ||
              !Number.isInteger(edge.depth) || edge.depth < 1 || edge.depth > snapshot.maxDepth ||
              edge.depth !== Math.max(snapshot.depths[edge.from], snapshot.depths[edge.to])) return false;
          var matchedEdges = cloneEdges.filter(function (candidate) {
            return candidate.getAttribute('data-edge-key') === edge.key;
          });
          var drawableMatches = matchedEdges.filter(hasDrawableGeometry);
          if (!matchedEdges.length || drawableMatches.length !== 1 || !matchedEdges.every(function (candidate) {
            return candidate.getAttribute('data-edge-from') === edge.from &&
              candidate.getAttribute('data-edge-to') === edge.to &&
              (candidate.getAttribute('data-edge-id') || '') === (edge.id || '');
          })) return false;
          edgeKeys[edge.key] = true;
          edgeMatches.push({ elements: matchedEdges, depth: edge.depth });
        }

        clone.setAttribute('data-share-reach', snapshot.direction);
        nodeMatches.forEach(function (match) {
          match.elements.forEach(function (element) {
            element.setAttribute('data-share-reach-match', '');
            element.setAttribute('data-share-reach-depth', String(match.depth));
            if (match.id === snapshot.origin.id) element.setAttribute('data-share-reach-origin', '');
          });
        });
        edgeMatches.forEach(function (match) {
          match.elements.forEach(function (element) {
            element.setAttribute('data-share-reach-match', '');
            element.setAttribute('data-share-reach-depth', String(match.depth));
          });
        });

        return clone.getAttribute('data-share-reach') === snapshot.direction &&
          !clone.hasAttribute('data-animation') &&
          !clone.hasAttribute('data-reach-active') &&
          clone.querySelectorAll('[data-animate], [data-reach-match], [data-reach-origin], [data-reach-depth]').length === 0 &&
          clone.querySelectorAll('[data-share-reach-origin]').length === 1 &&
          clone.querySelectorAll('[data-share-reach-match]').length ===
            nodeMatches.reduce(function (count, match) { return count + match.elements.length; }, 0) +
            edgeMatches.reduce(function (count, match) { return count + match.elements.length; }, 0);
      }

      function serializeSvg(scale, opts) {
        // scale: integer multiplier for intrinsic SVG pixel dimensions used by
        // the raster path. Defaults to 1 (natural size) for SVG download.
        scale = scale || 1;
        opts = opts || {};
        var autoTheme = opts.autoTheme === true;
        var svg = document.querySelector('.diagram-container svg');
        var clone = svg.cloneNode(true);

        var canonicalStateClean = cleanExportClone(clone);

        var vb = svg.viewBox.baseVal;
        var finiteSvgDimensions = Number.isFinite(vb.x) && Number.isFinite(vb.y) &&
          Number.isFinite(vb.width) && Number.isFinite(vb.height) && vb.width > 0 && vb.height > 0;
        var routeStateClean = opts.routeSnapshot
          ? canonicalStateClean && finiteSvgDimensions && applyRouteSnapshot(clone, opts.routeSnapshot)
          : null;
        var reachStateClean = opts.reachSnapshot
          ? canonicalStateClean && finiteSvgDimensions && !opts.routeSnapshot && applyReachSnapshot(clone, opts.reachSnapshot)
          : null;
        // Scale width/height so the browser rasterizes the vectors at target
        // resolution directly. viewBox stays unchanged so coordinates don't
        // shift. This is the key to sharp rasters — do NOT scale later via
        // canvas upscaling.
        clone.setAttribute('width', vb.width * scale);
        clone.setAttribute('height', vb.height * scale);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        // Only the SVG-relevant rules: semantic classes, markers, and the
        // theme variable blocks. Toolbar/cards/print CSS can never apply
        // inside a standalone SVG and would only bloat the export.
        var hostStyle = (function () {
          var out = [];
          Array.prototype.forEach.call(document.styleSheets, function (sheet) {
            var rules;
            try { rules = sheet.cssRules; } catch (_) { return; } // cross-origin
            if (!rules) return;
            Array.prototype.forEach.call(rules, function (rule) {
              if (rule.type === 7 && /^archify-/.test(rule.name || '')) {
                out.push(rule.cssText);
                return;
              }
              if (rule.type !== 1) return; // plain style rules only
              var sel = rule.selectorText || '';
              if (/(^|,)\s*(svg|:root|\[data-theme|\[data-preset|\.c-|\.t-|\.a-|\.m-)/.test(sel)) {
                out.push(rule.cssText);
              }
            });
          });
          return out.join('\n');
        })();

        // Derive the variable list from the stylesheet so newly added theme
        // variables can never be missed by the export pipeline again
        // (--lane-fill/--lane-stroke once were).
        var varNames = (function () {
          var seen = {};
          var names = [];
          (hostStyle.match(/--[a-zA-Z0-9-]+(?=\s*:)/g) || []).forEach(function (n) {
            if (!seen[n]) { seen[n] = true; names.push(n); }
          });
          return names;
        })();

        // Resolve the full variable set for a given data-theme via an
        // off-DOM probe, independent of what the viewer is currently set to.
        function resolveVars(themeAttr) {
          var probe = document.createElement('div');
          probe.setAttribute('data-theme', themeAttr);
          probe.setAttribute('data-preset', document.documentElement.getAttribute('data-preset') || 'classic');
          probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;';
          document.body.appendChild(probe);
          try {
            var c = getComputedStyle(probe);
            return varNames.map(function (n) {
              return n + ': ' + c.getPropertyValue(n).trim() + ';';
            }).join(' ');
          } finally {
            document.body.removeChild(probe);
          }
        }

        // Keep the same font bytes, character coverage, and attribution in
        // standalone SVGs and the SVG images used by every raster export.
        var fontCss = document.getElementById('archify-fonts').textContent;

        var style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        var bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('width', '100%');
        bgRect.setAttribute('height', '100%');

        if (autoTheme) {
          // Dual-theme SVG. Dark is the default (so hosts without
          // prefers-color-scheme still render), light swaps in via media
          // query, and svg[data-theme="..."] still lets downstream
          // consumers force a specific theme.
          var darkVars = resolveVars('dark');
          var lightVars = resolveVars('light');

          style.textContent =
            fontCss + "\n" +
            "svg { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono CJK SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace; }\n" +
            hostStyle + "\n" +
            ":root, svg { " + darkVars + " }\n" +
            "@media (prefers-color-scheme: light) { :root, svg { " + lightVars + " } }\n" +
            "svg[data-theme=\"light\"] { " + lightVars + " }\n" +
            "svg[data-theme=\"dark\"] { " + darkVars + " }\n" +
            "rect.c-bg-rect { fill: var(--bg); }\n";

          // Don't lock the serialized SVG to the viewer's current theme.
          clone.removeAttribute('data-theme');
          // Background follows the CSS variable, not a fixed color, so it
          // swaps with the media query.
          bgRect.setAttribute('class', 'c-bg-rect');
        } else {
          // Raster path: lock to the viewer's current theme.
          var theme = document.documentElement.getAttribute('data-theme') || 'dark';
          var themeHost = document.querySelector('[data-theme="' + theme + '"]') || document.documentElement;
          var computed = getComputedStyle(themeHost);
          var vars = varNames.map(function (n) {
            return n + ': ' + computed.getPropertyValue(n).trim() + ';';
          }).join(' ');

          // IMPORTANT: inject the resolved variables AFTER hostStyle,
          // otherwise hostStyle's ":root, [data-theme=\"dark\"] { ... }" rule
          // overrides our chosen theme via later-in-cascade equal-specificity.
          // Keep this order.
          style.textContent =
            fontCss + "\n" +
            "svg { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', 'Noto Sans Mono CJK SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', monospace; }\n" +
            hostStyle + "\n" +
            ":root, svg { " + vars + " }\n";

          bgRect.setAttribute('fill', computed.getPropertyValue('--bg').trim() || '#ffffff');
        }

        if (opts.routeSnapshot) {
          style.textContent += "\nsvg[data-share-route] [data-node-id], svg[data-share-route] [data-edge-from] { opacity: 0.18; }\n" +
            "svg[data-share-route] [data-share-route-match] { opacity: 1; }\n" +
            "svg[data-share-route] [data-share-route-start] > :is(rect, circle, polygon):not(.c-mask) { stroke-width: 3; stroke-dasharray: 5 3; }\n" +
            "svg[data-share-route] [data-share-route-middle] > :is(rect, circle, polygon):not(.c-mask) { stroke-width: 2.2; }\n" +
            "svg[data-share-route] [data-share-route-end] > :is(rect, circle, polygon):not(.c-mask) { stroke-width: 3.4; stroke-dasharray: 1 0; }\n";
        }
        if (opts.reachSnapshot) {
          style.textContent += "\nsvg[data-share-reach] [data-node-id], svg[data-share-reach] [data-edge-from] { opacity: 0.14; }\n" +
            "svg[data-share-reach] [data-share-reach-match] { opacity: 1; }\n" +
            "svg[data-share-reach] [data-edge-from][data-share-reach-match] { stroke-width: 1.55; }\n" +
            "svg[data-share-reach=\"upstream\"] [data-share-reach-origin] > :is(rect, circle, polygon):not(.c-mask) { stroke: var(--database-stroke); stroke-width: 3.4; stroke-dasharray: 5 3; }\n" +
            "svg[data-share-reach=\"downstream\"] [data-share-reach-origin] > :is(rect, circle, polygon):not(.c-mask) { stroke: var(--backend-stroke); stroke-width: 3.4; stroke-dasharray: 1 0; }\n" +
            "svg[data-preset=\"blueprint\"][data-share-reach] [data-share-reach-origin], svg[data-preset=\"blueprint\"][data-share-reach] [data-edge-from][data-share-reach-match] { filter: none; }\n";
        }

        clone.insertBefore(style, clone.firstChild);
        clone.insertBefore(bgRect, style.nextSibling);

        return {
          svgString: new XMLSerializer().serializeToString(clone),
          width: vb.width * scale,
          height: vb.height * scale,
          canonicalStateClean: canonicalStateClean,
          routeStateClean: routeStateClean,
          reachStateClean: reachStateClean
        };
      }

      function download(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }

      // Conservative upper bound on total canvas pixels. Older Safari on iOS
      // silently produces a blank canvas above ~16 Mpx; Chrome / Firefox /
      // desktop Safari are far higher but start failing on memory-constrained
      // devices. We pick the largest integer scale in {4,3,2,1} whose target
      // pixel count fits under this cap.
      var MAX_CANVAS_PIXELS = 16 * 1024 * 1024;

      function pickSafeScale(vbW, vbH) {
        for (var s = RASTER_SCALE; s >= 1; s--) {
          if (vbW * s * vbH * s <= MAX_CANVAS_PIXELS) return s;
        }
        return 1;
      }

      function rasterize(format) {
        // Serialize at a safe scale (RASTER_SCALE=4 by default, reduced if the
        // resulting canvas would exceed MAX_CANVAS_PIXELS). The SVG itself is
        // rasterized at target resolution natively; drawImage draws at natural
        // size — no upsampling blur.
        var svg = document.querySelector('.diagram-container svg');
        var vb = svg.viewBox.baseVal;
        var scale = pickSafeScale(vb.width, vb.height);
        var data = serializeSvg(scale);
        var svgBlob = new Blob([data.svgString], { type: 'image/svg+xml;charset=utf-8' });
        var svgUrl = URL.createObjectURL(svgBlob);

        return new Promise(function (resolve, reject) {
          var img = new Image();
          img.onload = function () {
            try {
              var canvas = document.createElement('canvas');
              canvas.width = data.width;
              canvas.height = data.height;
              var ctx = canvas2dOrThrow(canvas, format);
              if (format === 'jpeg') {
                ctx.fillStyle = currentBg();
                ctx.fillRect(0, 0, canvas.width, canvas.height);
              }
              // Draw at natural size — SVG was already rasterized at target res.
              ctx.drawImage(img, 0, 0);
              URL.revokeObjectURL(svgUrl);
              var mime = format === 'jpeg' ? 'image/jpeg' :
                         format === 'webp' ? 'image/webp' : 'image/png';
              var quality = format === 'png' ? undefined : 0.95;
              canvas.toBlob(function (blob) {
                if (!blob) reject(exportError('viewer.export.error.toBlobNull', { label: format }));
                else resolve(blob);
              }, mime, quality);
            } catch (error) {
              URL.revokeObjectURL(svgUrl);
              reject(error);
            }
          };
          img.onerror = function (e) {
            URL.revokeObjectURL(svgUrl);
            reject(e);
          };
          img.src = svgUrl;
        });
      }

      function fitCanvasText(ctx, text, maxWidth, startSize, minSize, weight) {
        var value = String(text || '').trim();
        var size = startSize;
        var family = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
        while (size > minSize) {
          ctx.font = (weight || '600') + ' ' + size + 'px ' + family;
          if (ctx.measureText(value).width <= maxWidth) return value;
          size -= 1;
        }
        ctx.font = (weight || '600') + ' ' + minSize + 'px ' + family;
        if (ctx.measureText(value).width <= maxWidth) return value;
        var suffix = '\u2026';
        while (value.length > 1 && ctx.measureText(value + suffix).width > maxWidth) {
          value = value.slice(0, -1);
        }
        return value + suffix;
      }

      function canvas2dOrThrow(canvas, label) {
        if (!canvas || typeof canvas.getContext !== 'function') {
          throw exportError('viewer.export.error.canvasUnavailable', { label: label });
        }
        var ctx = canvas.getContext('2d');
        if (!ctx) throw exportError('viewer.export.error.contextUnavailable', { label: label });
        if (typeof canvas.toBlob !== 'function') throw exportError('viewer.export.error.toBlobUnavailable', { label: label });
        return ctx;
      }

      function renderShareCard(options) {
        options = options || {};
        var routeSnapshot = options.routeSnapshot || null;
        var reachSnapshot = options.reachSnapshot || null;
        if (routeSnapshot && reachSnapshot) return Promise.reject(exportError('viewer.export.error.variantsCombined'));
        var svg = document.querySelector('.diagram-container svg');
        var vb = svg.viewBox.baseVal;
        var sourceScale = Math.min(2, pickSafeScale(vb.width, vb.height));
        var data = serializeSvg(sourceScale, { routeSnapshot: routeSnapshot, reachSnapshot: reachSnapshot });
        if (!data.canonicalStateClean) return Promise.reject(exportError('viewer.export.error.viewerState'));
        if (routeSnapshot && !data.routeStateClean) return Promise.reject(exportError('viewer.export.error.routeState'));
        if (reachSnapshot && !data.reachStateClean) return Promise.reject(exportError('viewer.export.error.reachState'));
        var svgBlob = new Blob([data.svgString], { type: 'image/svg+xml;charset=utf-8' });
        var svgUrl = URL.createObjectURL(svgBlob);

        return new Promise(function (resolve, reject) {
          var img = new Image();
          img.onload = function () {
            try {
              var canvas = document.createElement('canvas');
              canvas.width = SHARE_CARD_WIDTH;
              canvas.height = SHARE_CARD_HEIGHT;
              var ctx = canvas2dOrThrow(canvas, viewerText('viewer.export.shareCard'));
              var computed = getComputedStyle(document.documentElement);
              var bg = computed.getPropertyValue('--bg').trim() || currentBg();
              var text = computed.getPropertyValue('--text').trim() || '#ffffff';
              var muted = computed.getPropertyValue('--text-muted').trim() || '#94a3b8';
              var border = computed.getPropertyValue('--panel-border').trim() || '#334155';
              var accentProperty = reachSnapshot
                ? (reachSnapshot.direction === 'upstream' ? '--database-stroke' : '--backend-stroke')
                : '--frontend-stroke';
              var accent = computed.getPropertyValue(accentProperty).trim() || '#22d3ee';
              var titleNode = document.querySelector('.header h1');
              var subtitleNode = document.querySelector('.header .subtitle');
              var title = titleNode ? titleNode.textContent : document.title;
              var directionLabel = reachSnapshot
                ? viewerText('viewer.export.direction.' + reachSnapshot.direction)
                : '';
              var subtitle = routeSnapshot
                ? viewerCount('viewer.export.card.routeSummary', routeSnapshot.hops, {
                    source: routeSnapshot.source.label,
                    target: routeSnapshot.target.label
                  })
                : reachSnapshot
                  ? viewerText('viewer.export.card.reachSummary', {
                      direction: directionLabel,
                      origin: reachSnapshot.origin.label,
                      nodes: viewerCount('viewer.export.card.node', reachSnapshot.nodeIds.length - 1),
                      links: viewerCount('viewer.export.card.link', reachSnapshot.edges.length),
                      hops: viewerCount('viewer.export.card.hop', reachSnapshot.maxDepth)
                    })
                  : subtitleNode ? subtitleNode.textContent : '';
              var preset = document.documentElement.getAttribute('data-preset') || 'classic';
              var theme = document.documentElement.getAttribute('data-theme') || 'dark';
              var presetKey = preset === 'signal-flow'
                ? 'viewer.preset.flow.short'
                : 'viewer.preset.' + preset;
              var presetLabel = viewerText(presetKey).toUpperCase();
              var themeLabel = viewerText('viewer.theme.' + theme).toUpperCase();
              var cardLabel = routeSnapshot
                ? viewerText('viewer.export.card.routeBadge', {
                    hops: viewerCount('viewer.export.card.hop', routeSnapshot.hops).toUpperCase()
                  })
                : reachSnapshot
                  ? viewerText('viewer.export.card.reachBadge', { direction: directionLabel.toUpperCase() })
                  : viewerText('viewer.export.card.defaultBadge', { preset: presetLabel, theme: themeLabel });

              ctx.fillStyle = bg;
              ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

              ctx.fillStyle = accent;
              ctx.fillRect(SHARE_CARD_PADDING, 27, 42, 3);

              ctx.textBaseline = 'alphabetic';
              ctx.fillStyle = text;
              var fittedTitle = fitCanvasText(ctx, title, SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2 - 330, 29, 18, '700');
              ctx.fillText(fittedTitle, SHARE_CARD_PADDING, 62);

              ctx.fillStyle = muted;
              var fittedSubtitle = fitCanvasText(ctx, subtitle, SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2 - 280, 13, 11, '500');
              ctx.fillText(fittedSubtitle, SHARE_CARD_PADDING, 87);

              ctx.font = "600 12px 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
              ctx.textAlign = 'right';
              ctx.fillStyle = accent;
              ctx.fillText(cardLabel, SHARE_CARD_WIDTH - SHARE_CARD_PADDING, 50);
              ctx.textAlign = 'left';

              var availableWidth = SHARE_CARD_WIDTH - SHARE_CARD_PADDING * 2;
              var availableHeight = SHARE_CARD_HEIGHT - SHARE_CARD_HEADER - SHARE_CARD_PADDING;
              var fit = Math.min(availableWidth / data.width, availableHeight / data.height);
              var drawWidth = data.width * fit;
              var drawHeight = data.height * fit;
              var drawX = SHARE_CARD_PADDING + (availableWidth - drawWidth) / 2;
              var drawY = SHARE_CARD_HEADER + (availableHeight - drawHeight) / 2;

              ctx.strokeStyle = border;
              ctx.lineWidth = 1;
              ctx.strokeRect(drawX - 0.5, drawY - 0.5, drawWidth + 1, drawHeight + 1);
              ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
              URL.revokeObjectURL(svgUrl);

              canvas.toBlob(function (blob) {
                if (!blob) reject(exportError('viewer.export.error.toBlobNull', { label: viewerText('viewer.export.shareCard') }));
                else resolve(blob);
              }, 'image/png');
            } catch (error) {
              URL.revokeObjectURL(svgUrl);
              reject(error);
            }
          };
          img.onerror = function (e) {
            URL.revokeObjectURL(svgUrl);
            reject(e);
          };
          img.src = svgUrl;
        });
      }

      function rasterizeShareCard(options) {
        options = options || {};
        if (!options.variant) return renderShareCard();
        if (options.variant !== 'route' && options.variant !== 'reach') {
          return Promise.reject(exportError('viewer.export.unknownVariant', { variant: options.variant }));
        }
        if (options.variant === 'route') {
          var routeSnapshot = Archify.routeProbe && Archify.routeProbe.exportSnapshot();
          if (!routeSnapshot) return Promise.reject(exportError('viewer.export.routeRequired'));
          return renderShareCard({ routeSnapshot: routeSnapshot });
        }
        var snapshot = Archify.focus && typeof Archify.focus.reachabilitySnapshot === 'function'
          ? Archify.focus.reachabilitySnapshot()
          : null;
        if (!snapshot) return Promise.reject(exportError('viewer.export.reachRequired'));
        return renderShareCard({ reachSnapshot: snapshot });
      }

      function motionMimeType() {
        if (typeof MediaRecorder === 'undefined') return '';
        var candidates = [
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm'
        ];
        for (var i = 0; i < candidates.length; i++) {
          if (!MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
        }
        return '';
      }

      function canRecordMotion() {
        var svg = document.querySelector('.diagram-container svg');
        return !!(svg && svg.getAttribute('data-animation') === 'trace' &&
          typeof MediaRecorder !== 'undefined' && motionMimeType() &&
          typeof HTMLCanvasElement !== 'undefined' &&
          typeof HTMLCanvasElement.prototype.captureStream === 'function');
      }

      // Record the live CSS animation without Puppeteer, ffmpeg, or a network
      // dependency. SVG files loaded through Image are commonly rasterized as
      // one cached bitmap, so repeatedly drawing that Image does not reliably
      // advance its CSS animation. Keep one crisp static SVG background, then
      // render an explicit time-varying signal scene over the real authored
      // relationship geometry on every captured canvas frame.
      function recordWebm(options) {
        options = options || {};
        if (!canRecordMotion()) {
          return Promise.reject(exportError('viewer.export.error.webmRequirements'));
        }
        var duration = Math.max(250, Number(options.duration) || MOTION_DURATION);
        var fps = Math.max(1, Number(options.fps) || MOTION_FPS);
        var svg = document.querySelector('.diagram-container svg');
        var vb = svg.viewBox.baseVal;
        var scale = Math.min(1, 1280 / vb.width);
        var data = serializeSvg(scale);
        var sourceUrl = URL.createObjectURL(new Blob([data.svgString], { type: 'image/svg+xml;charset=utf-8' }));

        function createMotionScene(root) {
          var rootMatrix = root.getCTM ? root.getCTM() : null;

          function pointInRoot(element, point) {
            if (!rootMatrix || !element.getCTM || !point.matrixTransform) return { x: point.x, y: point.y };
            try {
              var elementMatrix = element.getCTM();
              if (!elementMatrix) return { x: point.x, y: point.y };
              var mapped = point.matrixTransform(rootMatrix.inverse().multiply(elementMatrix));
              return { x: mapped.x, y: mapped.y };
            } catch (_) {
              return { x: point.x, y: point.y };
            }
          }

          function samplesFor(element) {
            if (typeof element.getTotalLength !== 'function' || typeof element.getPointAtLength !== 'function') return [];
            var length;
            try { length = element.getTotalLength(); } catch (_) { return []; }
            if (!Number.isFinite(length) || length <= 0) return [];
            var count = Math.max(12, Math.min(72, Math.ceil(length / 12)));
            var points = [];
            for (var i = 0; i <= count; i++) {
              points.push(pointInRoot(element, element.getPointAtLength(length * i / count)));
            }
            return points;
          }

          function authoredStep(element, fallback) {
            var raw = element.style.getPropertyValue('--step') || getComputedStyle(element).getPropertyValue('--step');
            var value = Number(raw);
            return Number.isFinite(value) ? value : fallback;
          }

          var edges = Array.prototype.slice.call(root.querySelectorAll('[data-animate="edge"]')).map(function (element, index) {
            var computed = getComputedStyle(element);
            return {
              points: samplesFor(element),
              color: computed.stroke && computed.stroke !== 'none' ? computed.stroke : '#22d3ee',
              width: Math.max(1.5, parseFloat(computed.strokeWidth) || 1.5),
              delay: Math.min(12, authoredStep(element, index)) * 0.16
            };
          }).filter(function (edge) { return edge.points.length > 1; });

          var nodes = Array.prototype.slice.call(root.querySelectorAll('[data-node-id][data-animate="node"]')).map(function (element, index) {
            var box;
            try { box = element.getBBox(); } catch (_) { return null; }
            var painted = element.querySelector('[class*="c-"]') || element;
            var computed = getComputedStyle(painted);
            return {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              color: computed.stroke && computed.stroke !== 'none' ? computed.stroke : '#22d3ee',
              delay: Math.min(12, authoredStep(element, index)) * 0.16
            };
          }).filter(Boolean);

          return { edges: edges, nodes: nodes, x: vb.x, y: vb.y, width: vb.width, height: vb.height };
        }

        function pointAlong(points, progress) {
          var scaled = Math.max(0, Math.min(1, progress)) * (points.length - 1);
          var index = Math.min(points.length - 2, Math.floor(scaled));
          var mix = scaled - index;
          return {
            x: points[index].x + (points[index + 1].x - points[index].x) * mix,
            y: points[index].y + (points[index + 1].y - points[index].y) * mix
          };
        }

        function roundedRectPath(ctx, x, y, width, height, radius) {
          var r = Math.max(0, Math.min(radius, width / 2, height / 2));
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + width - r, y);
          ctx.quadraticCurveTo(x + width, y, x + width, y + r);
          ctx.lineTo(x + width, y + height - r);
          ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
          ctx.lineTo(x + r, y + height);
          ctx.quadraticCurveTo(x, y + height, x, y + height - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
          ctx.closePath();
        }

        function drawMotionFrame(ctx, backgroundImage, motionScene, elapsed) {
          ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.drawImage(backgroundImage, 0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.save();
          ctx.scale(ctx.canvas.width / motionScene.width, ctx.canvas.height / motionScene.height);
          ctx.translate(-motionScene.x, -motionScene.y);

          motionScene.edges.forEach(function (edge) {
            var duration = 1.75;
            var progress = (elapsed - edge.delay) / duration;
            if (progress < 0 || progress > 1) return;
            var head = Math.max(0, Math.min(1, progress));
            var tail = Math.max(0, head - 0.24);
            var opacity = Math.sin(Math.PI * Math.min(1, progress));

            ctx.save();
            ctx.strokeStyle = edge.color;
            ctx.fillStyle = edge.color;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.lineWidth = Math.max(3.2, edge.width * 2.2);
            ctx.globalAlpha = 0.42 + opacity * 0.5;
            ctx.shadowColor = edge.color;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            for (var i = 0; i <= 14; i++) {
              var trailPoint = pointAlong(edge.points, tail + (head - tail) * i / 14);
              if (i === 0) ctx.moveTo(trailPoint.x, trailPoint.y);
              else ctx.lineTo(trailPoint.x, trailPoint.y);
            }
            ctx.stroke();

            var point = pointAlong(edge.points, head);
            ctx.globalAlpha = 0.95;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          });

          motionScene.nodes.forEach(function (node) {
            var progress = (elapsed - node.delay) / 2.6;
            if (progress < 0 || progress > 1) return;
            var pulse = Math.sin(Math.PI * progress);
            if (pulse <= 0.02) return;
            ctx.save();
            ctx.strokeStyle = node.color;
            ctx.lineWidth = 1.4 + pulse * 1.8;
            ctx.globalAlpha = pulse * 0.5;
            ctx.shadowColor = node.color;
            ctx.shadowBlur = 12 * pulse;
            var inset = 2 + pulse * 3;
            roundedRectPath(ctx, node.x - inset, node.y - inset, node.width + inset * 2, node.height + inset * 2, 8);
            ctx.stroke();
            ctx.restore();
          });

          ctx.restore();
        }

        var motionScene = createMotionScene(svg);

        return new Promise(function (resolve, reject) {
          var backgroundImage = new Image();
          backgroundImage.onload = function () {
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(2, Math.round(data.width / 2) * 2);
            canvas.height = Math.max(2, Math.round(data.height / 2) * 2);
            var ctx = canvas.getContext('2d');
            var stream = canvas.captureStream(fps);
            var mime = motionMimeType();
            var recorder;
            try {
              recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
            } catch (err) {
              URL.revokeObjectURL(sourceUrl);
              stream.getTracks().forEach(function (track) { track.stop(); });
              reject(err);
              return;
            }
            var chunks = [];
            var raf = 0;
            var stopped = false;
            var startedAt = performance.now();
            function cleanup() {
              if (stopped) return;
              stopped = true;
              cancelAnimationFrame(raf);
              URL.revokeObjectURL(sourceUrl);
              stream.getTracks().forEach(function (track) { track.stop(); });
            }
            function draw(now) {
              var elapsed = Math.max(0, ((Number(now) || performance.now()) - startedAt) / 1000);
              drawMotionFrame(ctx, backgroundImage, motionScene, elapsed);
              raf = requestAnimationFrame(draw);
            }
            recorder.ondataavailable = function (event) {
              if (event.data && event.data.size) chunks.push(event.data);
            };
            recorder.onerror = function (event) {
              cleanup();
              reject(event.error || exportError('viewer.export.error.mediaRecorder'));
            };
            recorder.onstop = function () {
              cleanup();
              var blob = new Blob(chunks, { type: recorder.mimeType || mime });
              if (!blob.size) reject(exportError('viewer.export.error.emptyWebm'));
              else resolve(blob);
            };
            drawMotionFrame(ctx, backgroundImage, motionScene, 0);
            recorder.start(250);
            startedAt = performance.now();
            raf = requestAnimationFrame(draw);
            setTimeout(function () {
              if (recorder.state === 'inactive') return;
              // Chromium normally emits the final chunk during stop(), but
              // some embedded browser shells need an explicit encoder flush
              // first. Keep the short grace window bounded and harmless for
              // browsers that already delivered timeslice chunks.
              try { recorder.requestData(); } catch (_) {}
              setTimeout(function () {
                if (recorder.state !== 'inactive') recorder.stop();
              }, 120);
            }, duration);
          };
          backgroundImage.onerror = function () {
            URL.revokeObjectURL(sourceUrl);
            reject(exportError('viewer.export.error.webmBackground'));
          };
          backgroundImage.src = sourceUrl;
        });
      }

      var menu = document.getElementById('export-menu');
      var btn = document.getElementById('btn-export');
      var routeShareItem = menu.querySelector('button[data-action="route-share-card"]');
      var reachShareItem = menu.querySelector('button[data-action="reach-share-card"]');
      var items = function () {
        return Array.prototype.slice.call(menu.querySelectorAll('button[role="menuitem"]'));
      };

      function syncRouteShareItem() {
        var snapshot = Archify.routeProbe && typeof Archify.routeProbe.exportSnapshot === 'function'
          ? Archify.routeProbe.exportSnapshot()
          : null;
        routeShareItem.hidden = !snapshot;
        routeShareItem.disabled = !snapshot;
        return snapshot;
      }

      function syncReachShareItem() {
        var snapshot = Archify.focus && typeof Archify.focus.reachabilitySnapshot === 'function'
          ? Archify.focus.reachabilitySnapshot()
          : null;
        reachShareItem.hidden = !snapshot;
        reachShareItem.disabled = !snapshot;
        return snapshot;
      }

      // ---- Clipboard support ----------------------------------------------
      function canCopyImage() {
        return typeof ClipboardItem !== 'undefined' &&
               navigator.clipboard &&
               typeof navigator.clipboard.write === 'function';
      }

      // ---- Raster format detection ----------------------------------------
      // canvas.toBlob('image/webp') silently returns a PNG on browsers without
      // WebP encoding (older Safari), so detect explicitly.
      function supports(format) {
        if (format === 'share-card') return true;
        if (format === 'svg' || format === 'png') return true;
        if (format === 'webm') return canRecordMotion();
        var mime = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
        try {
          var c = document.createElement('canvas');
          c.width = c.height = 2;
          return c.toDataURL(mime).indexOf('data:' + mime) === 0;
        } catch (_) { return false; }
      }

      // Gray out unsupported items.
      items().forEach(function (it) {
        if (it.dataset.format && !supports(it.dataset.format)) {
          it.disabled = true;
          it.title = viewerText('viewer.export.unsupported');
        }
        if ((it.dataset.action === 'copy' || it.dataset.action === 'copy-share-card') && !canCopyImage()) {
          it.disabled = true;
          it.title = viewerText('viewer.export.clipboardUnsupported');
        }
      });

      // ---- Toast ----------------------------------------------------------
      // A live region only announces CHANGES to an existing node, so the toast
      // element is created once up front and updated in place.
      var toastEl = document.createElement('div');
      toastEl.className = 'archify-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
      var toastTimer = null;

      function toast(msg) {
        toastEl.textContent = '';
        requestAnimationFrame(function () {
          toastEl.textContent = msg;
          toastEl.classList.add('show');
        });
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1500);
      }

      function open(focusLast) {
        if (Archify.preset && Archify.preset.isOpen()) Archify.preset.close(false);
        if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        if (Archify.semanticLens && Archify.semanticLens.isOpen()) Archify.semanticLens.close({ restoreFocus: false });
        syncRouteShareItem();
        syncReachShareItem();
        menu.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        var available = items().filter(function (i) { return !i.hidden && !i.disabled; });
        var target = focusLast ? available[available.length - 1] : available[0];
        if (target) target.focus();
      }
      function close(focusTrigger) {
        menu.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        if (focusTrigger) btn.focus();
      }
      function isOpen() { return menu.classList.contains('open'); }

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isOpen()) close(false);
        else open();
      });
      // APG menu-button pattern: ArrowDown/ArrowUp on the trigger opens the menu.
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!isOpen()) open(e.key === 'ArrowUp');
        }
      });
      document.addEventListener('click', function (e) {
        if (!menu.contains(e.target) && e.target !== btn) close(false);
      });

      // Keyboard navigation inside the menu.
      //   Menu items: Up/Down, Home/End.
      //   Esc closes + returns focus to trigger; Tab closes.
      menu.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
        if (e.key === 'Tab')    { close(false); return; }

        var available = items().filter(function (i) { return !i.hidden && !i.disabled; });
        var current = available.indexOf(document.activeElement);
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            if (available.length) available[(current + 1 + available.length) % available.length].focus();
            break;
          case 'ArrowUp':
            e.preventDefault();
            if (available.length) available[(current - 1 + available.length) % available.length].focus();
            break;
          case 'Home':
            e.preventDefault();
            if (available[0]) available[0].focus();
            break;
          case 'End':
            e.preventDefault();
            if (available.length) available[available.length - 1].focus();
            break;
        }
      });

      function runExport(format) {
        var base = diagramFilename();
        close(true);
        clearExportReceipt();
        if (format === 'webm') toast(viewerText('viewer.export.recording'));
        return (format === 'share-card'
          ? rasterizeShareCard().then(function (blob) {
              recordExportReceipt('share-card', blob, true, { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT });
              download(blob, base + '-share-card.png');
              toast(viewerText('viewer.export.downloadedShare'));
            })
          : format === 'svg'
          ? Promise.resolve(serializeSvg(1, { autoTheme: true })).then(function (d) {
              var blob = new Blob([d.svgString], { type: 'image/svg+xml;charset=utf-8' });
              recordExportReceipt('svg', blob, d.canonicalStateClean);
              download(blob, base + '.svg');
            })
          : format === 'webm'
            ? recordWebm().then(function (blob) {
                document.documentElement.setAttribute('data-last-motion-bytes', String(blob.size));
                recordExportReceipt('webm', blob, true);
                download(blob, base + '.webm');
                toast(viewerText('viewer.export.downloadedWebm'));
              })
          : rasterize(format).then(function (blob) {
              recordExportReceipt(format, blob, true);
              download(blob, base + '.' + format);
            })
        ).catch(function (err) {
          console.error(err);
          var technicalMessage = err && err.message ? err.message : format;
          var message = exportMessage(err);
          document.documentElement.setAttribute('data-last-export-error-format', format);
          document.documentElement.setAttribute('data-last-export-error', technicalMessage);
          if (format === 'webm') {
            var motionItem = menu.querySelector('button[data-format="webm"]');
            if (motionItem) {
              motionItem.disabled = true;
              motionItem.title = viewerText('viewer.export.motionUnavailable');
              motionItem.style.opacity = '0.5';
            }
            toast(viewerText('viewer.export.webmUnavailable'));
            return;
          }
          alert(viewerText('viewer.export.failed', { message: message }));
        });
      }

      function runRouteShareCard() {
        close(false);
        clearExportReceipt();
        var snapshot = Archify.routeProbe && Archify.routeProbe.exportSnapshot();
        var blobPromise = snapshot
          ? renderShareCard({ routeSnapshot: snapshot })
          : Promise.reject(exportError('viewer.export.routeRequired'));
        return blobPromise.then(function (blob) {
          recordExportReceipt('share-card', blob, false, { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT }, 'route', true);
          download(blob, diagramFilename() + '-route-share-card.png');
          toast(viewerText('viewer.export.downloadedRoute'));
          return blob;
        }).catch(function (err) {
          console.error(err);
          var technicalMessage = err && err.message ? err.message : 'share-card';
          var message = exportMessage(err);
          document.documentElement.setAttribute('data-last-export-error-format', 'share-card');
          document.documentElement.setAttribute('data-last-export-error', technicalMessage);
          alert(viewerText('viewer.export.routeFailed', { message: message }));
        });
      }

      function runReachShareCard() {
        close(false);
        clearExportReceipt();
        var snapshot = Archify.focus && typeof Archify.focus.reachabilitySnapshot === 'function'
          ? Archify.focus.reachabilitySnapshot()
          : null;
        var blobPromise = snapshot
          ? renderShareCard({ reachSnapshot: snapshot })
          : Promise.reject(exportError('viewer.export.reachRequired'));
        return blobPromise.then(function (blob) {
          recordExportReceipt('share-card', blob, false, { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT }, 'reach', false, true);
          download(blob, diagramFilename() + '-' + snapshot.direction + '-reach-share-card.png');
          toast(viewerText('viewer.export.downloadedReach'));
          return blob;
        }).catch(function (err) {
          console.error(err);
          var technicalMessage = err && err.message ? err.message : 'share-card';
          var message = exportMessage(err);
          document.documentElement.setAttribute('data-last-export-error-format', 'share-card');
          document.documentElement.setAttribute('data-last-export-error', technicalMessage);
          alert(viewerText('viewer.export.reachFailed', { message: message }));
        });
      }

      // A compact, machine-readable receipt for local QA and generated proof
      // galleries. It exposes no diagram contents, only the completed format,
      // byte count, and whether temporary viewer state was excluded.
      function recordExportReceipt(format, blob, canonical, dimensions, variant, routeStateClean, reachStateClean) {
        document.documentElement.setAttribute('data-last-export-format', format);
        document.documentElement.setAttribute('data-last-export-bytes', String(blob.size));
        document.documentElement.setAttribute('data-last-export-canonical', canonical ? 'true' : 'false');
        if (variant) {
          document.documentElement.setAttribute('data-last-export-variant', variant);
        } else {
          document.documentElement.removeAttribute('data-last-export-variant');
        }
        if (routeStateClean === true) {
          document.documentElement.setAttribute('data-last-export-route-state-clean', 'true');
        } else {
          document.documentElement.removeAttribute('data-last-export-route-state-clean');
        }
        if (reachStateClean === true) {
          document.documentElement.setAttribute('data-last-export-reach-state-clean', 'true');
        } else {
          document.documentElement.removeAttribute('data-last-export-reach-state-clean');
        }
        if (dimensions) {
          document.documentElement.setAttribute('data-last-export-width', String(dimensions.width));
          document.documentElement.setAttribute('data-last-export-height', String(dimensions.height));
        } else {
          document.documentElement.removeAttribute('data-last-export-width');
          document.documentElement.removeAttribute('data-last-export-height');
        }
      }

      function clearExportReceipt() {
        document.documentElement.removeAttribute('data-last-export-format');
        document.documentElement.removeAttribute('data-last-export-bytes');
        document.documentElement.removeAttribute('data-last-export-canonical');
        document.documentElement.removeAttribute('data-last-export-width');
        document.documentElement.removeAttribute('data-last-export-height');
        document.documentElement.removeAttribute('data-last-export-variant');
        document.documentElement.removeAttribute('data-last-export-route-state-clean');
        document.documentElement.removeAttribute('data-last-export-reach-state-clean');
        document.documentElement.removeAttribute('data-last-export-error-format');
        document.documentElement.removeAttribute('data-last-export-error');
      }

      function writePngToClipboard(blobPromise) {
        // WebKit requires ClipboardItem to be constructed synchronously inside
        // the user gesture. Chromium accepts the same pending Promise<Blob>;
        // engines that reject promise values fall back to an awaited Blob.
        try {
          return navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
        } catch (_) {
          return blobPromise.then(function (blob) {
            return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          });
        }
      }

      function runCopyShareCard() {
        close(true);
        clearExportReceipt();
        if (!canCopyImage()) {
          alert(viewerText('viewer.export.clipboardUnsupported.period'));
          return;
        }
        var blobPromise = rasterizeShareCard();
        return writePngToClipboard(blobPromise).then(function () {
          return blobPromise.then(function (blob) {
            recordExportReceipt('share-card', blob, true, { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT });
            toast(viewerText('viewer.export.copiedShare'));
          });
        }).catch(function (err) {
          console.error(err);
          var technicalMessage = err && err.message ? err.message : 'share-card';
          var message = exportMessage(err);
          document.documentElement.setAttribute('data-last-export-error-format', 'share-card');
          document.documentElement.setAttribute('data-last-export-error', technicalMessage);
          alert(viewerText('viewer.export.copyFailed', { message: message }));
        });
      }

      function runCopy() {
        close(true);
        clearExportReceipt();
        if (!canCopyImage()) {
          alert(viewerText('viewer.export.clipboardUnsupported.short'));
          return;
        }
        var blobPromise = rasterize('png');
        return writePngToClipboard(blobPromise).then(function () {
          toast(viewerText('viewer.export.copiedPng'));
        }).catch(function (err) {
          console.error(err);
          alert(viewerText('viewer.export.copyFailed', {
            message: exportMessage(err)
          }));
        });
      }

      menu.addEventListener('click', function (e) {
        var routeShareCardBtn = e.target.closest('button[data-action="route-share-card"]');
        if (routeShareCardBtn && !routeShareCardBtn.disabled && !routeShareCardBtn.hidden) { runRouteShareCard(); return; }

        var reachShareCardBtn = e.target.closest('button[data-action="reach-share-card"]');
        if (reachShareCardBtn && !reachShareCardBtn.disabled && !reachShareCardBtn.hidden) { runReachShareCard(); return; }

        var copyShareCardBtn = e.target.closest('button[data-action="copy-share-card"]');
        if (copyShareCardBtn && !copyShareCardBtn.disabled) { runCopyShareCard(); return; }

        var copyBtn = e.target.closest('button[data-action="copy"]');
        if (copyBtn && !copyBtn.disabled) { runCopy(); return; }

        var formatBtn = e.target.closest('button[data-format]');
        if (formatBtn && !formatBtn.disabled) { runExport(formatBtn.dataset.format); }
      });

      Archify.motion = { canRecord: canRecordMotion, recordWebm: recordWebm };
      Archify.exportMenu = {
        open: open,
        close: close,
        isOpen: isOpen,
        run: runExport,
        shareCard: rasterizeShareCard,
        downloadRouteShareCard: runRouteShareCard,
        downloadReachShareCard: runReachShareCard,
        syncRouteShare: syncRouteShareItem,
        syncReachShare: syncReachShareItem,
        copyShareCard: runCopyShareCard
      };

      // Auto-open on page load for demo/screenshot purposes: ?openExport=1
      // Wait for fonts (so the menu doesn't flash before typography lands)
      // and paint before opening. Fallback timeout for browsers without the
      // Font Loading API.
      try {
        if (new URLSearchParams(window.location.search).get('openExport') === '1') {
          var openWhenReady = function () {
            requestAnimationFrame(function () { requestAnimationFrame(open); });
          };
          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(openWhenReady);
          } else {
            setTimeout(openWhenReady, 200);
          }
        }
      } catch (_) {}
    })();