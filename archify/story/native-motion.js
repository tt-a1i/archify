    /* ============================================================
       Motion Governor — one reader switch and one motion budget. Ambient
       trace yields to the strongest semantic owner; Still also parks bounded
       viewer signals without discarding their static meaning.
       ============================================================ */
    Archify.motionGovernor = (function () {
      var STORAGE_KEY = 'archify-motion';
      var html = document.documentElement;
      var svg = document.querySelector('.diagram-container svg');
      var btn = document.getElementById('btn-motion');
      var label = document.getElementById('motion-label');
      var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      var rendering = html.hasAttribute('data-motion-render');
      if (rendering) {
        // Render frames seek native animations, including styles from earlier HTML.
        function prepareRules(rules) {
          Array.prototype.forEach.call(rules, function (rule) {
            if (rule.media && rule.media.mediaText === '(prefers-reduced-motion: reduce)') rule.media.mediaText = 'not all';
            if (rule.cssRules) prepareRules(rule.cssRules);
          });
        }
        Array.prototype.forEach.call(document.styleSheets, function (sheet) {
          var rules;
          try { rules = sheet.cssRules; } catch (_) { return; }
          prepareRules(rules);
        });
      }
      var capable = !!(svg && svg.getAttribute('data-animation') === 'trace');
      var readerPaused = false;
      var suspensions = Object.create(null);
      var explicitOwner = '';
      var owner = '';
      var ownerToken = 0;
      var ownerCleanup = null;
      var lastEffectivePaused = null;
      var entryStarted = false;
      var entryPending = new Set();
      var flowCount = 0;

      // Runtime decoration carries geometry and tree visibility only. Keep each
      // flow beside its authored edge so transforms, clipping and crossover
      // paint order apply.
      // Each renderer may declare a choreography that matches what its diagram
      // means. Relay (the default) sends a comet from each source when the
      // signal reaches it; stream adds a packet train for continuous data; walk
      // moves one token along the main state path; sequence plays messages in
      // authored order; sweep runs a playhead along a timeline; replay fills
      // waterfall spans in proportion to their measured time. Motion Governor
      // plans the timeline and per-element keyframes; viewer.css owns looks.
      var SVG_NS = 'http://www.w3.org/2000/svg';
      var choreography = svg ? (svg.getAttribute('data-motion-choreography') || 'relay') : 'relay';
      var RELAY = {
        speed: 280,
        minTravel: 0.42,
        maxTravel: 1.5,
        handoff: 0.1,
        dwell: 0.55,
        maxSpan: 9,
        land: 0.9,
        rest: 1.4,
        minCycle: 3.6
      };
      function stepOf(element, fallback) {
        var step = parseFloat(element && element.style ? element.style.getPropertyValue('--step') : '');
        return Number.isFinite(step) ? step : fallback;
      }
      function byStep(a, b) { return a.step - b.step || a.index - b.index; }
      function addWindow(windows, id, start, end, strong) {
        if (!id) return;
        (windows[id] = windows[id] || []).push({ start: start, end: end, strong: !!strong });
      }
      function planRelay(records, windows) {
        var arrive = Object.create(null);
        var seeded = Object.create(null);
        var targets = Object.create(null);
        records.forEach(function (record) { if (record.from !== record.to) targets[record.to] = true; });
        function seed(id) {
          if (arrive[id] !== undefined) return;
          arrive[id] = 0;
          seeded[id] = true;
        }
        function relax() {
          // Earliest arrival over a few dozen edges; a scan per settle keeps
          // cycles and fan-in deterministic without a priority queue.
          var settled = Object.create(null);
          for (;;) {
            var next = null;
            Object.keys(arrive).forEach(function (id) {
              if (!settled[id] && (next === null || arrive[id] < arrive[next])) next = id;
            });
            if (next === null) return;
            settled[next] = true;
            var depart = arrive[next] + (seeded[next] ? 0 : RELAY.handoff);
            records.forEach(function (record) {
              if (record.from !== next) return;
              var at = depart + record.travel;
              if (arrive[record.to] === undefined || at < arrive[record.to]) arrive[record.to] = at;
            });
          }
        }
        records.forEach(function (record) { if (!targets[record.from]) seed(record.from); });
        relax();
        for (;;) {
          // A closed cycle has no entry; start it at its earliest authored edge.
          var orphan = records.filter(function (record) { return arrive[record.from] === undefined; }).sort(byStep)[0];
          if (!orphan) break;
          seed(orphan.from);
          relax();
        }
        records.forEach(function (record) {
          record.depart = arrive[record.from] + (seeded[record.from] ? 0 : RELAY.handoff);
          record.active = true;
        });
        Object.keys(arrive).forEach(function (id) { addWindow(windows, id, arrive[id], arrive[id]); });
      }
      function planWalk(records, windows) {
        // A state machine is in one state at a time: follow the first authored
        // transition to an unvisited state and let the current state stay lit.
        var targets = Object.create(null);
        records.forEach(function (record) { if (record.from !== record.to) targets[record.to] = true; });
        var ordered = records.slice().sort(byStep);
        var start = (ordered.find(function (record) { return !targets[record.from]; }) || ordered[0]).from;
        var visited = Object.create(null);
        var current = start;
        var clock = 0;
        var enteredAt = 0;
        visited[start] = true;
        for (var hops = 0; hops < 16; hops += 1) {
          var next = ordered.find(function (record) { return record.from === current && !visited[record.to]; });
          if (!next) break;
          next.active = true;
          next.depart = clock + RELAY.dwell;
          addWindow(windows, current, enteredAt, next.depart, true);
          clock = next.depart + next.travel;
          enteredAt = clock;
          current = next.to;
          visited[current] = true;
        }
        addWindow(windows, current, enteredAt, enteredAt + 1.2, true);
      }
      function planSequence(records, windows) {
        var clock = 0;
        records.slice().sort(byStep).forEach(function (record) {
          record.active = true;
          record.depart = clock;
          clock += record.travel + RELAY.handoff;
          addWindow(windows, record.from, record.depart, record.depart);
          addWindow(windows, record.to, record.depart + record.travel, record.depart + record.travel);
        });
      }
      function scalePlan(records, windows, span) {
        var scale = span > RELAY.maxSpan ? RELAY.maxSpan / span : 1;
        if (scale === 1) return span;
        records.forEach(function (record) {
          if (!record.active) return;
          record.depart *= scale;
          record.travel *= scale;
        });
        Object.keys(windows).forEach(function (id) {
          windows[id].forEach(function (window) { window.start *= scale; window.end *= scale; });
        });
        return span * scale;
      }
      function nodeShapes() {
        var shapes = Object.create(null);
        Array.prototype.forEach.call(svg.querySelectorAll('[data-animate="node"]'), function (shape) {
          var wrapper = shape.closest('[data-node-id]');
          var id = wrapper ? wrapper.getAttribute('data-node-id') : '';
          if (id) (shapes[id] = shapes[id] || []).push(shape);
        });
        return shapes;
      }
      function sceneBounds(elements) {
        var box = null;
        elements.forEach(function (element) {
          var b = null;
          try { b = element.getBBox(); } catch (_) {}
          if (!b || !(b.width || b.height)) return;
          if (!box) box = { x: b.x, y: b.y, right: b.x + b.width, bottom: b.y + b.height };
          else {
            box.x = Math.min(box.x, b.x); box.y = Math.min(box.y, b.y);
            box.right = Math.max(box.right, b.x + b.width); box.bottom = Math.max(box.bottom, b.y + b.height);
          }
        });
        return box;
      }
      function overlay(tag, cls, attrs, parent, before) {
        var element = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs).forEach(function (name) { element.setAttribute(name, attrs[name]); });
        element.setAttribute('class', 'ambient-edge-flow ' + cls);
        element.setAttribute('data-ambient-flow-overlay', 'true');
        element.setAttribute('aria-hidden', 'true');
        parent.insertBefore(element, before || null);
        return element;
      }
      // Timeline and waterfall share a playhead: a lit vertical rule and its
      // bloom travel the time axis linearly, because time is the subject.
      function addPlayhead(box, x0, x1, lead, sweep, extras) {
        var anchor = svg.querySelector('[data-node-id]');
        var parent = anchor ? anchor.parentNode : svg;
        var attrs = { x1: x0.toFixed(1), x2: x0.toFixed(1), y1: (box.y - 10).toFixed(1), y2: (box.bottom + 10).toFixed(1) };
        ['playhead-glow', 'playhead'].forEach(function (kind) {
          var line = overlay('line', 'ambient-flow-' + kind, attrs, parent, anchor);
          line.style.setProperty('--flow-name', 'archify-motion-playhead');
          extras.push(line);
        });
        extras.playhead = { distance: x1 - x0, lead: lead, sweep: sweep };
      }
      function planSweep(windows, extras) {
        var events = Array.prototype.filter.call(svg.querySelectorAll('[data-node-id][data-timeline-x]'), function (node) {
          return Number.isFinite(parseFloat(node.getAttribute('data-timeline-x')));
        });
        if (!events.length) return 0;
        var xs = events.map(function (node) { return parseFloat(node.getAttribute('data-timeline-x')); });
        var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
        var lead = 0.35;
        var sweep = Math.min(7, Math.max(3.2, events.length * 0.6));
        events.forEach(function (node, index) {
          var at = lead + (x1 > x0 ? (xs[index] - x0) / (x1 - x0) : 0) * sweep;
          addWindow(windows, node.getAttribute('data-node-id'), at, at + 0.35, true);
        });
        var box = sceneBounds(Array.prototype.slice.call(svg.querySelectorAll('[data-timeline-lane]')));
        if (box && x1 > x0) addPlayhead(box, x0, x1, lead, sweep, extras);
        return lead + sweep + 0.6;
      }
      function planReplay(windows, extras) {
        var spans = [];
        Array.prototype.forEach.call(svg.querySelectorAll('[data-node-id][data-waterfall-start]'), function (node) {
          var start = parseFloat(node.getAttribute('data-waterfall-start'));
          var end = parseFloat(node.getAttribute('data-waterfall-end'));
          var bar = node.querySelector('[data-animate="node"]');
          if (!bar || !Number.isFinite(start) || !(end >= start)) return;
          var width = parseFloat(bar.getAttribute('width'));
          var x = parseFloat(bar.getAttribute('x'));
          if (!(width > 0) || !Number.isFinite(x)) return;
          spans.push({ node: node, bar: bar, start: start, end: end, x: x, width: width });
        });
        if (!spans.length) return 0;
        var t0 = Math.min.apply(null, spans.map(function (span) { return span.start; }));
        var t1 = Math.max.apply(null, spans.map(function (span) { return span.end; }));
        if (!(t1 > t0)) return 0;
        var ruler = spans.reduce(function (best, span) { return span.end - span.start > best.end - best.start ? span : best; });
        var pxPerUnit = ruler.width / Math.max(ruler.end - ruler.start, 1e-9);
        var x0 = ruler.x - (ruler.start - t0) * pxPerUnit;
        var lead = 0.35;
        var replay = Math.min(6, Math.max(3.4, spans.length * 0.45));
        var at = function (t) { return lead + (t - t0) / (t1 - t0) * replay; };
        var settle = lead + replay + 0.9;
        spans.forEach(function (span) {
          var fill = overlay('rect', 'ambient-flow-fill', {
            x: span.bar.getAttribute('x'), y: span.bar.getAttribute('y'),
            width: span.bar.getAttribute('width'), height: span.bar.getAttribute('height'),
            rx: span.bar.getAttribute('rx') || '0'
          }, span.bar.parentNode, span.bar.nextSibling);
          var tone = /(?:^|\s)c-([a-z]+)(?:\s|$)/.exec(span.bar.getAttribute('class') || '');
          if (tone) fill.style.setProperty('--flow-fill', 'var(--' + tone[1] + '-stroke)');
          if (span.node.getAttribute('data-waterfall-status') && span.node.getAttribute('data-waterfall-status') !== 'ok') {
            fill.classList.add('ambient-flow-fill-failed');
          }
          fill.timing = { start: at(span.start), end: Math.max(at(span.end), at(span.start) + 0.08), settle: settle };
          extras.push(fill);
          addWindow(windows, span.node.getAttribute('data-node-id'), fill.timing.end, fill.timing.end);
        });
        var box = sceneBounds(spans.map(function (span) { return span.bar; }));
        if (box) addPlayhead(box, x0, x0 + (t1 - t0) * pxPerUnit, lead, replay, extras);
        return settle;
      }
      function writeKeyframes(records, windows, extras, cycle) {
        function at(seconds) {
          return (Math.min(100, Math.max(0, seconds / cycle * 100))).toFixed(3) + '%';
        }
        var ease = 'animation-timing-function: cubic-bezier(0.45, 0.05, 0.35, 1);';
        var rules = [
          '@keyframes archify-relay-ripple {',
          '  0% { r: 2px; opacity: var(--flow-peak, 0.6); }',
          '  ' + at(0.75) + ', 100% { r: 20px; opacity: 0; }',
          '}'
        ];
        records.forEach(function (record) {
          if (!record.active) return;
          var travel = record.travel;
          rules.push(
            '@keyframes archify-relay-comet-' + record.index + ' {',
            '  0% { stroke-dashoffset: calc(var(--flow-len, 0px) + var(--flow-shift, 0px)); opacity: 0; ' + ease + ' }',
            '  ' + at(Math.min(0.12, travel * 0.2)) + ' { opacity: var(--flow-peak, 0.9); }',
            '  ' + at(travel) + ' { stroke-dashoffset: var(--flow-shift, 0px); opacity: var(--flow-peak, 0.9); }',
            '  ' + at(travel + 0.16) + ', 100% { stroke-dashoffset: var(--flow-shift, 0px); opacity: 0; }',
            '}',
            // A solid wake draws the travelled path behind the head on the same
            // easing; a dashed wake only brightens its authored segments.
            '@keyframes archify-relay-wake-' + record.index + ' {',
            record.dashed
              ? '  0%, ' + at(travel * 0.3) + ' { opacity: 0; }'
              : '  0% { stroke-dashoffset: var(--flow-len, 0px); opacity: var(--flow-peak, 0.3); ' + ease + ' }',
            record.dashed
              ? '  ' + at(travel) + ' { opacity: var(--flow-peak, 0.3); }'
              : '  ' + at(travel) + ' { stroke-dashoffset: 0px; opacity: var(--flow-peak, 0.3); }',
            '  ' + at(travel + 0.9) + ', 100% { stroke-dashoffset: 0px; opacity: 0; }',
            '}'
          );
        });
        var glow = function (strong) {
          return 'filter: var(--ambient-node-base-filter,) drop-shadow(0 0 ' + (strong ? 14 : 10) + 'px var(--arrow-emphasis));';
        };
        var base = 'filter: var(--ambient-node-base-filter, none);';
        Object.keys(windows).forEach(function (id, index) {
          var merged = [];
          windows[id].slice().sort(function (a, b) { return a.start - b.start; }).forEach(function (window) {
            var peakEnd = Math.max(window.end, window.start + 0.42);
            var last = merged[merged.length - 1];
            if (last && window.start <= last.peakEnd + 0.78) {
              last.peakEnd = Math.max(last.peakEnd, peakEnd);
              last.strong = last.strong || window.strong;
            } else merged.push({ start: window.start, peakEnd: peakEnd, strong: window.strong });
          });
          var frames = ['  0%, 100% { ' + base + ' }'];
          merged.forEach(function (window) {
            frames.push(
              '  ' + at(window.start) + ' { ' + base + ' }',
              '  ' + at(window.start + 0.12) + ', ' + at(window.peakEnd) + ' { ' + glow(window.strong) + ' }',
              '  ' + at(window.peakEnd + 0.78) + ' { ' + base + ' }'
            );
          });
          rules.push('@keyframes archify-relay-node-' + index + ' {', frames.join('\n'), '}');
          windows[id].keyframes = 'archify-relay-node-' + index;
        });
        if (extras.playhead) {
          var p = extras.playhead;
          rules.push(
            '@keyframes archify-motion-playhead {',
            '  0% { transform: translateX(0px); opacity: 0; }',
            '  ' + at(Math.max(0.05, p.lead - 0.2)) + ' { transform: translateX(0px); opacity: 0; }',
            '  ' + at(p.lead) + ' { transform: translateX(0px); opacity: var(--flow-peak, 0.9); }',
            '  ' + at(p.lead + p.sweep) + ' { transform: translateX(' + p.distance.toFixed(1) + 'px); opacity: var(--flow-peak, 0.9); }',
            '  ' + at(p.lead + p.sweep + 0.45) + ', 100% { transform: translateX(' + p.distance.toFixed(1) + 'px); opacity: 0; }',
            '}'
          );
        }
        extras.forEach(function (element, index) {
          if (!element.timing) return;
          var t = element.timing;
          rules.push(
            '@keyframes archify-replay-fill-' + index + ' {',
            '  0%, ' + at(t.start) + ' { transform: scaleX(0); opacity: var(--flow-peak, 0.4); }',
            '  ' + at(t.end) + ', ' + at(t.settle) + ' { transform: scaleX(1); opacity: var(--flow-peak, 0.4); }',
            '  ' + at(t.settle + 0.7) + ', 100% { transform: scaleX(1); opacity: 0; }',
            '}'
          );
          element.style.setProperty('--flow-name', 'archify-replay-fill-' + index);
        });
        var style = document.createElement('style');
        style.setAttribute('data-ambient-flow-keyframes', 'true');
        style.textContent = rules.join('\n');
        document.head.appendChild(style);
      }
      function createFlows() {
        var records = [];
        Array.prototype.forEach.call(svg.querySelectorAll('path[data-animate="edge"]'), function (shape, index) {
          var d = shape.getAttribute('data-motion-path') || shape.getAttribute('d');
          if (!d) return;
          var anchor = shape;
          // Tree Branches initializes after these overlays and includes their
          // inherited ancestors in its existing collapse/expand lifecycle.
          function tagOverlay(flow) {
            flow.setAttribute('data-ambient-flow-overlay', 'true');
            flow.setAttribute('aria-hidden', 'true');
            if (shape.hasAttribute('data-tree-ancestors')) {
              flow.setAttribute('data-tree-ancestors', shape.getAttribute('data-tree-ancestors'));
            }
          }
          function addPath(cls) {
            var flow = document.createElementNS(SVG_NS, 'path');
            flow.setAttribute('d', d);
            ['transform', 'mask', 'clip-path', 'vector-effect'].forEach(function (name) {
              if (shape.hasAttribute(name)) flow.setAttribute(name, shape.getAttribute(name));
            });
            flow.setAttribute('class', 'ambient-edge-flow ambient-flow-' + cls);
            tagOverlay(flow);
            shape.parentNode.insertBefore(flow, anchor.nextSibling);
            anchor = flow;
            return flow;
          }
          var wake = addPath('wake');
          var len = 0;
          try { len = wake.getTotalLength(); } catch (_) {}
          if (!(len > 0)) {
            wake.remove();
            return;
          }
          var record = {
            index: records.length,
            len: len,
            from: shape.getAttribute('data-edge-from') || shape.getAttribute('data-composition-edge-from') || '',
            to: shape.getAttribute('data-edge-to') || shape.getAttribute('data-composition-edge-to') || '',
            step: stepOf(shape, index),
            travel: Math.min(RELAY.maxTravel, Math.max(RELAY.minTravel, len / RELAY.speed)),
            depart: 0,
            active: false,
            layers: []
          };
          records.push(record);
          // Dashed authored lines keep their dash language through the relay:
          // the wake brightens only the authored segments and never fills the
          // gaps back into a solid line.
          var authoredDash = '';
          try { authoredDash = window.getComputedStyle(shape).strokeDasharray; } catch (_) {}
          record.dashed = !!(authoredDash && authoredDash !== 'none');
          wake.style.setProperty('--flow-dasharray', record.dashed ? authoredDash : len.toFixed(1) + ' ' + len.toFixed(1));
          // Absolute caps keep the comet a slim streak on long edges instead
          // of growing into a bright slab; the tail disintegrates into a
          // sparkle of fragments behind the head, and --flow-shift trails
          // each layer behind the head tip by its own length.
          var headLen = Math.min(14, Math.max(7, len * 0.03));
          var haloLen = Math.min(22, Math.max(12, len * 0.07));
          var trail = len >= 120
            ? { pattern: '2.5 2 4 3 5.5 4.5 8 ' + (len - 30).toFixed(1), length: 30 }
            : (len >= 60
              ? { pattern: '3 3 7 ' + (len - 13).toFixed(1), length: 13 }
              : { pattern: '5 ' + Math.max(4, len - 5).toFixed(1), length: 5 });
          record.layers.push(
            { flow: wake, kind: 'wake', dash: len, shift: 0 },
            { flow: addPath('glow'), kind: 'comet', dash: haloLen, shift: (haloLen - headLen) / 2 },
            { flow: addPath('halo'), kind: 'comet', dash: haloLen, shift: (haloLen - headLen) / 2 },
            { flow: addPath('tail'), kind: 'comet', dash: trail.length, shift: trail.length - headLen, dasharray: trail.pattern },
            { flow: addPath('head'), kind: 'comet', dash: headLen, shift: 0 }
          );
          if (choreography === 'stream') {
            // A packet train behind the comet reads as a continuous stream.
            [1, 2, 3].forEach(function (order) {
              record.layers.push({ flow: addPath('head packet'), kind: 'comet', dash: Math.max(4, headLen * 0.55), shift: 0, packet: order });
            });
          }
          // The ripple lands where the comet does; keep it out of the edge's
          // mask so it can bloom over the node boundary.
          var end = null;
          try { end = wake.getPointAtLength(len); } catch (_) {}
          if (end) {
            var ripple = document.createElementNS(SVG_NS, 'circle');
            ripple.setAttribute('cx', end.x.toFixed(1));
            ripple.setAttribute('cy', end.y.toFixed(1));
            ripple.setAttribute('r', '2');
            if (shape.hasAttribute('transform')) ripple.setAttribute('transform', shape.getAttribute('transform'));
            ripple.setAttribute('class', 'ambient-edge-flow ambient-flow-ripple');
            tagOverlay(ripple);
            shape.parentNode.insertBefore(ripple, anchor.nextSibling);
            record.ripple = ripple;
          }
        });
        var windows = Object.create(null);
        var extras = [];
        var span = 0;
        if (choreography === 'sweep') span = planSweep(windows, extras);
        else if (choreography === 'replay') span = planReplay(windows, extras);
        else if (records.length) {
          var linked = records.filter(function (record) { return record.from && record.to; });
          if (choreography === 'sequence' || linked.length < records.length) planSequence(records, windows);
          else if (choreography === 'walk') planWalk(records, windows);
          else planRelay(records, windows);
          span = records.reduce(function (max, record) {
            return record.active ? Math.max(max, record.depart + record.travel) : max;
          }, 0);
          span = scalePlan(records, windows, span);
        }
        records.forEach(function (record) {
          if (record.active) return;
          record.layers.forEach(function (layer) { layer.flow.remove(); });
          if (record.ripple) record.ripple.remove();
        });
        var active = records.filter(function (record) { return record.active; });
        if (!active.length && !extras.length) return;
        var cycle = Math.max(RELAY.minCycle, span + RELAY.land + RELAY.rest);
        writeKeyframes(active, windows, extras, cycle);
        svg.style.setProperty('--flow-cycle', cycle.toFixed(3) + 's');
        html.style.setProperty('--flow-cycle-chrome', cycle.toFixed(3) + 's');
        active.forEach(function (record) {
          var gap = Math.min(0.22, record.travel * 0.28);
          record.layers.forEach(function (layer) {
            var flow = layer.flow;
            flow.style.setProperty('--flow-len', record.len.toFixed(1) + 'px');
            flow.style.setProperty('--flow-delay', (record.depart + (layer.packet || 0) * gap).toFixed(3) + 's');
            flow.style.setProperty('--flow-dash', layer.dash.toFixed(1) + 'px');
            flow.style.setProperty('--flow-shift', layer.shift.toFixed(1) + 'px');
            flow.style.setProperty('--flow-name', 'archify-relay-' + layer.kind + '-' + record.index);
            if (layer.dasharray) flow.style.setProperty('--flow-dasharray', layer.dasharray);
          });
          if (record.ripple) {
            record.ripple.style.setProperty('--flow-delay', (record.depart + record.travel).toFixed(3) + 's');
            record.ripple.style.setProperty('--flow-name', 'archify-relay-ripple');
          }
        });
        var shapes = nodeShapes();
        Object.keys(windows).forEach(function (id) {
          (shapes[id] || []).forEach(function (shape) {
            shape.style.setProperty('--flow-node-name', windows[id].keyframes);
          });
        });
        flowCount = active.length + extras.length;
      }
      function settleEntry() {
        entryPending.clear();
        svg.removeEventListener('animationend', onEntryBoundary, true);
        svg.removeEventListener('animationcancel', onEntryBoundary, true);
        html.setAttribute('data-ambient-entry', 'settled');
      }
      function onEntryBoundary(event) {
        if (!entryPending.has(event.target)) return;
        // The entrance settles only when each node's pulse finishes; the
        // shorter fade-rise enter animation may end first without ending it.
        if (event.animationName && !/node-pulse/.test(event.animationName)) return;
        entryPending.delete(event.target);
        if (!entryPending.size) settleEntry();
      }
      function renderAmbient(suppressed) {
        html.setAttribute('data-ambient-motion', flowCount ? (suppressed ? 'paused' : 'running') : 'empty');
        if (suppressed) {
          entryStarted = true;
          settleEntry();
        } else if (!entryStarted) {
          entryStarted = true;
          entryPending = new Set(Array.prototype.slice.call(svg.querySelectorAll('[data-animate="node"]')));
          if (!entryPending.size) settleEntry();
          else {
            svg.addEventListener('animationend', onEntryBoundary, true);
            svg.addEventListener('animationcancel', onEntryBoundary, true);
            html.setAttribute('data-ambient-entry', 'running');
          }
        }
      }

      function readStored() {
        try { return localStorage.getItem(STORAGE_KEY); } catch (_) { return null; }
      }
      function writeStored() {
        try {
          if (readerPaused) localStorage.removeItem(STORAGE_KEY);
          else localStorage.setItem(STORAGE_KEY, 'live');
        } catch (_) {}
      }
      function reducedMotion() {
        return !rendering && !!(motionQuery && motionQuery.matches);
      }
      function hasSuspension() {
        return Object.keys(suspensions).length > 0;
      }
      function effectivePaused() {
        return readerPaused || reducedMotion() || hasSuspension();
      }
      function ownerLabel(value) {
        if (value === 'route') return viewerText('viewer.owner.route');
        if (value === 'lens') return viewerText('viewer.owner.lens');
        if (value === 'relationship') return viewerText('viewer.owner.relationship');
        if (value === 'intent') return viewerText('viewer.owner.intent');
        if (value === 'focus') return viewerText('viewer.owner.focus');
        if (value === 'legend') return viewerText('viewer.owner.legend');
        return viewerText('viewer.owner.reader');
      }
      function render() {
        if (!capable) return;
        var systemPaused = reducedMotion();
        var paused = effectivePaused();
        html.setAttribute('data-motion', paused ? 'still' : 'live');
        renderAmbient(paused || owner || html.hasAttribute('data-embed') || html.hasAttribute('data-share-playback') || html.hasAttribute('data-document-hidden'));
        btn.setAttribute('aria-pressed', paused ? 'false' : 'true');
        btn.disabled = systemPaused;
        label.textContent = viewerText(paused ? 'viewer.motion.still' : 'viewer.motion.live');
        if (paused && lastEffectivePaused !== true && Archify.routeProbe && Archify.routeProbe.isJourneyPlaying && Archify.routeProbe.isJourneyPlaying()) {
          Archify.routeProbe.pauseJourney({ preserveElapsed: true, reason: systemPaused ? 'reduced-motion' : (hasSuspension() ? 'hidden' : 'still') });
        }
        lastEffectivePaused = paused;
        if (Archify.routeProbe && typeof Archify.routeProbe.syncMotion === 'function') Archify.routeProbe.syncMotion();
        if (systemPaused) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.reduced'));
          btn.title = viewerText('viewer.motion.reduced');
        } else if (hasSuspension()) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.hidden'));
          btn.title = viewerText('viewer.motion.hidden');
        } else if (paused) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.resume'));
          btn.title = viewerText('viewer.motion.resume');
        } else if (owner) {
          btn.setAttribute('aria-label', viewerText('viewer.motion.yielding', { owner: ownerLabel(owner) }));
          btn.title = viewerText('viewer.motion.yielding.title', { owner: ownerLabel(owner) });
        } else {
          btn.setAttribute('aria-label', viewerText('viewer.motion.pause'));
          btn.title = viewerText('viewer.motion.pause');
        }
      }
      function setPaused(next, options) {
        options = options || {};
        readerPaused = !!next;
        if (options.persist !== false) writeStored();
        render();
        return readerPaused;
      }
      function publishOwner() {
        owner = explicitOwner || deriveOwner();
        if (owner) html.setAttribute('data-motion-owner', owner);
        else html.removeAttribute('data-motion-owner');
        render();
        return owner;
      }
      function deriveOwner() {
        if (!svg) return '';
        if (svg.hasAttribute('data-route-picking') || svg.hasAttribute('data-route-active')) return 'route';
        if (svg.hasAttribute('data-lens-active')) return 'lens';
        if (svg.hasAttribute('data-relationship-preview-active')) return 'relationship';
        if (svg.hasAttribute('data-intent-trace-active')) return 'intent';
        if (svg.hasAttribute('data-focus-active')) return 'focus';
        if (svg.hasAttribute('data-legend-preview-active')) return 'legend';
        return '';
      }
      function clearClaim(preempted) {
        var cleanup = ownerCleanup;
        ownerCleanup = null;
        explicitOwner = '';
        if (preempted && cleanup) {
          try { cleanup(); } catch (_) {}
        }
      }
      function claim(next, cleanup) {
        if (!capable || !next) return 0;
        clearClaim(true);
        ownerToken += 1;
        explicitOwner = next;
        ownerCleanup = typeof cleanup === 'function' ? cleanup : null;
        publishOwner();
        return ownerToken;
      }
      function release(token) {
        if (!capable || token !== ownerToken || !explicitOwner) return false;
        clearClaim(false);
        ownerToken += 1;
        publishOwner();
        return true;
      }
      function suspend(reason) {
        var key = String(reason || 'runtime');
        var active = true;
        suspensions[key] = (suspensions[key] || 0) + 1;
        render();
        return function () {
          if (!active) return false;
          active = false;
          if (suspensions[key] > 1) suspensions[key] -= 1;
          else delete suspensions[key];
          render();
          return true;
        };
      }
      function syncVisibility() {
        if (document.hidden && !rendering) {
          suspensions.visibility = true;
          html.setAttribute('data-document-hidden', 'true');
        } else {
          delete suspensions.visibility;
          html.removeAttribute('data-document-hidden');
        }
        render();
      }

      if (!capable) {
        btn.hidden = true;
        html.removeAttribute('data-motion-capable');
        html.removeAttribute('data-motion');
        html.removeAttribute('data-motion-owner');
        html.removeAttribute('data-ambient-motion');
        html.removeAttribute('data-ambient-entry');
        return {
          capable: false,
          pause: function () { return false; },
          resume: function () { return false; },
          toggle: function () { return false; },
          setMode: function () { return 'still'; },
          mode: function () { return 'still'; },
          claim: function () { return 0; },
          release: function () { return false; },
          suspend: function () { return function () { return false; }; },
          isPaused: function () { return true; },
          reducedMotion: reducedMotion,
          owner: function () { return ''; }
        };
      }

      createFlows();
      html.setAttribute('data-motion-capable', 'true');
      btn.hidden = false;
      readerPaused = readStored() !== 'live';
      btn.addEventListener('click', function () { setPaused(!readerPaused); });
      if (motionQuery) {
        if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', render);
        else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(render);
      }
      document.addEventListener('visibilitychange', syncVisibility);
      if (typeof MutationObserver !== 'undefined') {
        var contextObserver = new MutationObserver(render);
        contextObserver.observe(html, { attributes: true, attributeFilter: ['data-embed', 'data-share-playback'] });
      }
      if (document.documentElement.getAttribute('data-embed') !== 'true' && typeof MutationObserver !== 'undefined' && typeof Node !== 'undefined' && svg instanceof Node) {
        var ownerObserver = new MutationObserver(function () { publishOwner(); });
        ownerObserver.observe(svg, {
          attributes: true,
          attributeFilter: [
            'data-route-picking', 'data-route-active',
            'data-lens-active', 'data-relationship-preview-active', 'data-intent-trace-active',
            'data-focus-active', 'data-legend-preview-active'
          ]
        });
      }
      syncVisibility();
      publishOwner();
      render();

      return {
        capable: true,
        pause: function () { return setPaused(true); },
        resume: function () { return setPaused(false); },
        toggle: function () { return setPaused(!readerPaused); },
        setMode: function (next, options) {
          setPaused(next === 'still', options);
          return effectivePaused() ? 'still' : 'live';
        },
        mode: function () { return effectivePaused() ? 'still' : 'live'; },
        claim: claim,
        release: release,
        suspend: suspend,
        isPaused: effectivePaused,
        reducedMotion: reducedMotion,
        owner: function () { return owner; }
      };
    })();
