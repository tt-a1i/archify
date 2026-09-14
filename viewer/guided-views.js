    Archify.guidedViews = (function () {
      var data = document.getElementById('archify-guided-views-data');
      var panel = document.getElementById('guided-views');
      var prev = document.getElementById('guided-view-prev');
      var next = document.getElementById('guided-view-next');
      var all = document.getElementById('guided-view-all');
      var play = document.getElementById('guided-view-play');
      var playIcon = document.getElementById('guided-view-play-icon');
      var playLabel = document.getElementById('guided-view-play-label');
      var beatLink = document.getElementById('guided-view-beat-link');
      var beatLinkLabel = document.getElementById('guided-view-beat-link-label');
      var progressBar = document.getElementById('guided-view-progress-bar');
      var count = document.getElementById('guided-view-count');
      var handoffReceipt = document.getElementById('guided-view-handoff');
      var label = document.getElementById('guided-view-label');
      var note = document.getElementById('guided-view-note');
      var trail = document.getElementById('guided-view-trail');
      var storyCaption = document.getElementById('guided-story-caption');
      var storyCaptionIndex = document.getElementById('guided-story-caption-index');
      var storyCaptionRoute = document.getElementById('guided-story-caption-route');
      var storyCaptionDetail = document.getElementById('guided-story-caption-detail');
      var storyCaptionNext = document.getElementById('guided-story-caption-next');
      var storyCaptionNextLabel = document.getElementById('guided-story-caption-next-label');
      var chapterIndex = document.getElementById('guided-view-index');
      var chapterList = document.getElementById('guided-view-chapters');
      var shareCue = document.getElementById('share-chapter-cue');
      var shareCueState = document.getElementById('share-chapter-state');
      var shareCueCount = document.getElementById('share-chapter-count');
      var shareCueLabel = document.getElementById('share-chapter-label');
      var shareCueNote = document.getElementById('share-chapter-note');
      var shareCueRoute = document.getElementById('share-chapter-route');
      var shareCueProgress = document.getElementById('share-chapter-progress-bar');
      var svg = document.querySelector('.diagram-container svg');
      var views = [];
      var activeIndex = -1;
      var playing = false;
      var storyBeatTimer = null;
      var storyBeatIndex = -1;
      var storyBeatStartedAt = 0;
      var storyBeatElapsedMs = 0;
      var storyBeatDwellMs = 0;
      var storyPlaybackGeneration = 0;
      var storyFollowGeneration = 0;
      var storyPlaybackScope = 'story';
      var storyPlaybackComplete = false;
      var beatLinkFeedbackTimer = null;
      var momentRestoreGeneration = 0;
      var storySteps = [];
      var storyPulseOwnerToken = 0;
      var storyPulseGeneration = 0;
      var autoplayPending = false;
      var VIEW_INTERVAL_MS = 3200;
      var STORY_FOLLOW_MIN_DWELL_MS = 1100;
      var STORY_FOLLOW_DURATION_MS = 320;
      var chapterButtons = [];
      var handoffGeneration = 0;
      var currentHandoff = null;
      var previewGeneration = 0;
      var pointerPreviewIntent = null;
      var focusPreviewIntent = null;
      var activePreviewIndex = -1;
      var previewOwnerToken = 0;

      try { views = JSON.parse(data.textContent || '[]'); } catch (_) { views = []; }
      if (!views.length) return { count: 0, active: function () { return null; } };
      var canonicalNodeIds = {};
      Array.prototype.forEach.call(svg.querySelectorAll('[data-node-id]'), function (node) {
        canonicalNodeIds[node.getAttribute('data-node-id')] = true;
      });
      views.forEach(function (view) {
        var seen = {};
        view.focus = (view.focus || []).filter(function (id) {
          if (!canonicalNodeIds[id] || seen[id]) return false;
          seen[id] = true;
          return true;
        });
      });
      // Establish the compact cold state before exposing the panel so the
      // full Director cannot flash during first paint. Hash restoration runs
      // in the same task and replaces this state before paint when valid.
      panel.setAttribute('data-active-view', 'all');
      panel.hidden = false;
      panel.setAttribute('data-view-interval-ms', String(VIEW_INTERVAL_MS));
      panel.setAttribute('data-story-follow-min-dwell-ms', String(STORY_FOLLOW_MIN_DWELL_MS));
      buildChapterIndex();

      function reducedMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      }

      function findNode(id) {
        return Array.prototype.find.call(svg.querySelectorAll('[data-node-id]'), function (node) {
          return node.getAttribute('data-node-id') === id;
        }) || null;
      }

      function chapterDelta(previous, destination) {
        var previousFocus = previous ? previous.focus : [];
        var destinationFocus = destination ? destination.focus : [];
        var previousIds = {};
        var destinationIds = {};
        previousFocus.forEach(function (id) { previousIds[id] = true; });
        destinationFocus.forEach(function (id) { destinationIds[id] = true; });
        return {
          stay: previousFocus.filter(function (id) { return destinationIds[id]; }),
          enter: destinationFocus.filter(function (id) { return !previousIds[id]; }),
          leave: previousFocus.filter(function (id) { return !destinationIds[id]; })
        };
      }

      function chapterAnchor(previous, destination, outgoingBeatIndex, delta) {
        if (!previous || !destination) return '';
        var stayIds = {};
        delta.stay.forEach(function (id) { stayIds[id] = true; });
        var activeBeat = outgoingBeatIndex >= 0 ? previous.focus[outgoingBeatIndex] : '';
        if (activeBeat && stayIds[activeBeat]) return activeBeat;
        for (var index = previous.focus.length - 1; index >= 0; index -= 1) {
          if (stayIds[previous.focus[index]]) return previous.focus[index];
        }
        return '';
      }

      function handoffMotionAllowed() {
        if (document.hidden || reducedMotion()) return false;
        if (document.documentElement.getAttribute('data-embed') === 'true') return false;
        if (window.matchMedia && window.matchMedia('print').matches) return false;
        return !(Archify.motionGovernor && Archify.motionGovernor.capable && Archify.motionGovernor.isPaused());
      }

      function classifyHandoff(delta, anchor) {
        var roles = {};
        delta.stay.forEach(function (id) { roles[id] = 'stay'; });
        delta.enter.forEach(function (id) { roles[id] = 'enter'; });
        delta.leave.forEach(function (id) { roles[id] = 'leave'; });
        Array.prototype.forEach.call(svg.querySelectorAll('[data-node-id]'), function (node) {
          var id = node.getAttribute('data-node-id');
          var role = roles[id] || '';
          if (role) node.setAttribute('data-chapter-role', role);
          else node.removeAttribute('data-chapter-role');
        });
        svg.setAttribute('data-chapter-handoff', anchor ? 'anchor' : 'no-anchor');
        if (anchor) svg.setAttribute('data-chapter-anchor', anchor);
        else svg.removeAttribute('data-chapter-anchor');
      }

      function drawHandoffAnchor(id) {
        var node = findNode(id);
        if (!node) return null;
        var box;
        try { box = node.getBBox(); } catch (_) { return null; }
        var overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        var ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        overlay.setAttribute('class', 'chapter-handoff-overlay');
        overlay.setAttribute('data-chapter-handoff-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        ring.setAttribute('class', 'chapter-handoff-anchor');
        ring.setAttribute('x', String(box.x - 8));
        ring.setAttribute('y', String(box.y - 8));
        ring.setAttribute('width', String(box.width + 16));
        ring.setAttribute('height', String(box.height + 16));
        ring.setAttribute('rx', '10');
        overlay.appendChild(ring);
        svg.appendChild(overlay);
        return overlay;
      }

      function clearHandoffPresentation() {
        svg.removeAttribute('data-chapter-handoff');
        svg.removeAttribute('data-chapter-anchor');
        Array.prototype.forEach.call(svg.querySelectorAll('[data-chapter-handoff-overlay]'), function (overlay) { overlay.remove(); });
        Array.prototype.forEach.call(svg.querySelectorAll('[data-chapter-role]'), function (node) { node.removeAttribute('data-chapter-role'); });
        if (handoffReceipt) {
          handoffReceipt.hidden = true;
          handoffReceipt.textContent = '';
        }
      }

      function completeHandoff(handoff, outcome) {
        if (!handoff || currentHandoff !== handoff) return false;
        if (handoff.holdTimer) clearTimeout(handoff.holdTimer);
        handoff.holdTimer = null;
        currentHandoff = null;
        clearHandoffPresentation();
        if (handoff.ownerToken && Archify.motionGovernor) Archify.motionGovernor.release(handoff.ownerToken);
        handoff.resolve({ id: handoff.id, state: outcome || 'complete', anchor: handoff.anchor || null });
        syncStoryControlsDisabled();
        syncChapterPreview();
        return true;
      }

      function settleHandoff(reason) {
        var handoff = currentHandoff;
        if (!handoff) return false;
        if (handoff.holdTimer) clearTimeout(handoff.holdTimer);
        handoff.holdTimer = null;
        if (handoff.camera && handoff.camera.cancel) handoff.camera.cancel(reason || 'settled', true);
        else if (Archify.view && Archify.view.reveal) Archify.view.reveal(handoff.focus, { instant: true, reason: reason || 'settled' });
        completeHandoff(handoff, reason || 'settled');
        return true;
      }

      function cancelHandoff(reason) {
        var handoff = currentHandoff;
        if (!handoff) return false;
        if (handoff.holdTimer) clearTimeout(handoff.holdTimer);
        handoff.holdTimer = null;
        if (handoff.camera && handoff.camera.cancel) handoff.camera.cancel(reason || 'manual', false);
        completeHandoff(handoff, reason || 'manual');
        return true;
      }

      function afterHandoff(callback) {
        if (!currentHandoff) { callback(); return; }
        currentHandoff.finished.then(callback);
      }

      function beginHandoff(previousIndex, nextIndex, previous, destination, outgoingBeatIndex, reason) {
        if (!Archify.view || !Archify.view.reveal) return null;
        if (!previous || previousIndex === nextIndex) {
          Archify.view.reveal(destination.focus, { reason: reason });
          return null;
        }
        var delta = chapterDelta(previous, destination);
        var anchor = chapterAnchor(previous, destination, outgoingBeatIndex, delta);
        if (!handoffMotionAllowed()) {
          Archify.view.reveal(destination.focus, { instant: true, reason: reason });
          return null;
        }
        var resolver;
        var handoff = {
          id: ++handoffGeneration,
          mode: anchor ? 'holding' : 'no-anchor',
          anchor: anchor,
          focus: destination.focus.slice(),
          holdTimer: null,
          camera: null,
          ownerToken: 0,
          finished: new Promise(function (resolve) { resolver = resolve; }),
          resolve: resolver
        };
        currentHandoff = handoff;
        classifyHandoff(delta, anchor);
        if (anchor) {
          drawHandoffAnchor(anchor);
          var node = findNode(anchor);
          var nodeLabel = node ? (node.getAttribute('data-node-label') || anchor) : anchor;
          handoffReceipt.textContent = viewerText('viewer.guided.handoff', {
            from: (previousIndex + 1 < 10 ? '0' : '') + (previousIndex + 1),
            to: (nextIndex + 1 < 10 ? '0' : '') + (nextIndex + 1),
            label: nodeLabel
          });
          handoffReceipt.hidden = false;
        }
        if (Archify.motionGovernor) {
          handoff.ownerToken = Archify.motionGovernor.claim('handoff', function () {
            if (currentHandoff === handoff) settleHandoff('preempted');
          });
        }
        var startCamera = function () {
          if (currentHandoff !== handoff) return;
          handoff.holdTimer = null;
          handoff.mode = 'settling';
          svg.setAttribute('data-chapter-handoff', anchor ? 'settling' : 'no-anchor');
          handoff.camera = Archify.view.reveal(destination.focus, { reason: reason, duration: 420 });
          if (handoff.camera && handoff.camera.finished) {
            handoff.camera.finished.then(function (outcome) {
              if (currentHandoff === handoff) completeHandoff(handoff, outcome && outcome.state || 'complete');
            });
          } else {
            completeHandoff(handoff, 'complete');
          }
        };
        if (anchor) handoff.holdTimer = setTimeout(startCamera, 110);
        else startCamera();
        return handoff;
      }

      function centerChapterButton(button) {
        if (!button || !chapterList) return false;
        var target = Math.max(0, button.offsetLeft - (chapterList.clientWidth - button.offsetWidth) / 2);
        if (typeof chapterList.scrollTo === 'function') chapterList.scrollTo({ left: target, behavior: 'auto' });
        else chapterList.scrollLeft = target;
        return true;
      }

      function focusChapterButton(index) {
        if (!chapterButtons.length) return false;
        index = Math.max(0, Math.min(chapterButtons.length - 1, index));
        chapterButtons.forEach(function (button, buttonIndex) {
          button.setAttribute('tabindex', buttonIndex === index ? '0' : '-1');
        });
        chapterButtons[index].focus();
        centerChapterButton(chapterButtons[index]);
        return true;
      }

      function buildChapterIndex() {
        chapterButtons = [];
        chapterList.textContent = '';
        views.forEach(function (view, index) {
          var item = document.createElement('li');
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'guided-view-chapter';
          button.setAttribute('data-guided-view-id', view.id);
          button.setAttribute('aria-pressed', 'false');
          button.setAttribute('tabindex', index === 0 ? '0' : '-1');
          button.setAttribute('aria-label', viewerText('viewer.guided.chapter.open', {
            index: index + 1,
            total: views.length,
            label: view.label,
            count: view.focus.length
          }));
          button.title = view.label + ' — ' + (view.note || viewerText('viewer.guided.chapter.selectedNodes', { count: view.focus.length }));
          var position = document.createElement('span');
          position.className = 'guided-view-chapter-index';
          position.setAttribute('aria-hidden', 'true');
          position.textContent = (index + 1 < 10 ? '0' : '') + (index + 1);
          var title = document.createElement('span');
          title.className = 'guided-view-chapter-title';
          title.textContent = view.label;
          var stops = document.createElement('em');
          stops.className = 'guided-view-chapter-count';
          stops.textContent = viewerCount('viewer.guided.chapter.stop', view.focus.length);
          var delta = document.createElement('span');
          delta.className = 'guided-view-chapter-delta';
          delta.hidden = true;
          delta.setAttribute('aria-hidden', 'true');
          ['stay', 'enter', 'leave'].forEach(function (kind) {
            var value = document.createElement('span');
            value.setAttribute('data-delta-kind', kind);
            delta.appendChild(value);
          });
          button.appendChild(position);
          button.appendChild(title);
          button.appendChild(stops);
          button.appendChild(delta);
          item.appendChild(button);
          chapterList.appendChild(item);
          chapterButtons.push(button);
        });
      }

      function syncChapterIndex() {
        chapterButtons.forEach(function (button, index) {
          var current = index === activeIndex;
          var stops = button.querySelector('.guided-view-chapter-count');
          var deltaLabel = button.querySelector('.guided-view-chapter-delta');
          var position = activeIndex < 0 ? 'available' : (current ? 'current' : (index < activeIndex ? 'before' : 'after'));
          button.setAttribute('data-chapter-position', position);
          button.setAttribute('aria-pressed', current ? 'true' : 'false');
          button.setAttribute('tabindex', current || (activeIndex < 0 && index === 0) ? '0' : '-1');
          if (current) {
            stops.hidden = false;
            deltaLabel.hidden = true;
            button.removeAttribute('data-chapter-delta');
            button.setAttribute('aria-label', viewerText('viewer.guided.chapter.current', {
              index: index + 1,
              total: views.length,
              label: views[index].label,
              count: views[index].focus.length
            }));
            button.title = viewerText('viewer.guided.chapter.current.title', {
              label: views[index].label,
              count: views[index].focus.length
            });
          } else {
            var delta = chapterDelta(activeIndex >= 0 ? views[activeIndex] : null, views[index]);
            var compact = '=' + delta.stay.length + ' +' + delta.enter.length + ' \u2212' + delta.leave.length;
            var expanded = viewerText('viewer.guided.chapter.delta.expanded', {
              stay: delta.stay.length,
              enter: delta.enter.length,
              leave: delta.leave.length
            });
            stops.hidden = true;
            deltaLabel.hidden = false;
            deltaLabel.querySelector('[data-delta-kind="stay"]').textContent = '=' + delta.stay.length;
            deltaLabel.querySelector('[data-delta-kind="enter"]').textContent = '+' + delta.enter.length;
            deltaLabel.querySelector('[data-delta-kind="leave"]').textContent = '\u2212' + delta.leave.length;
            button.setAttribute('data-chapter-delta', compact);
            button.setAttribute('aria-label', viewerText('viewer.guided.chapter.delta.aria', {
              index: index + 1,
              total: views.length,
              label: views[index].label,
              delta: expanded
            }));
            button.title = viewerText('viewer.guided.chapter.delta.title', {
              label: views[index].label,
              delta: compact
            });
          }
          if (current) button.setAttribute('aria-current', 'step');
          else button.removeAttribute('aria-current');
          if (button.parentElement) button.parentElement.setAttribute('data-chapter-position', position);
        });
        if (activeIndex >= 0) centerChapterButton(chapterButtons[activeIndex]);
      }

      function chapterPreviewBlocked() {
        if (document.hidden || playing || currentHandoff) return true;
        if (document.documentElement.getAttribute('data-embed') === 'true') return true;
        if (window.matchMedia && window.matchMedia('print').matches) return true;
        if (svg.hasAttribute('data-route-picking') || svg.hasAttribute('data-route-active')) return true;
        if (svg.hasAttribute('data-lens-active') || svg.hasAttribute('data-legend-preview-active')) return true;
        if (svg.hasAttribute('data-relationship-preview-active') || svg.hasAttribute('data-intent-trace-active')) return true;
        return activeIndex < 0 && svg.hasAttribute('data-focus-active');
      }

      function clearChapterPreviewPresentation() {
        svg.removeAttribute('data-chapter-preview');
        Array.prototype.forEach.call(svg.querySelectorAll('[data-chapter-preview-role]'), function (node) {
          node.removeAttribute('data-chapter-preview-role');
        });
        chapterButtons.forEach(function (button) { button.removeAttribute('data-preview-active'); });
        activePreviewIndex = -1;
        if (previewOwnerToken && Archify.motionGovernor) {
          var token = previewOwnerToken;
          previewOwnerToken = 0;
          Archify.motionGovernor.release(token);
        }
      }

      function clearChapterPreview(options) {
        options = options || {};
        previewGeneration += 1;
        if (options.clearIntents !== false) {
          pointerPreviewIntent = null;
          focusPreviewIntent = null;
        }
        clearChapterPreviewPresentation();
        return true;
      }

      function winningChapterPreviewIntent() {
        return [pointerPreviewIntent, focusPreviewIntent].filter(function (intent) {
          return intent && intent.index >= 0 && intent.index < views.length && intent.index !== activeIndex;
        }).sort(function (left, right) { return right.generation - left.generation; })[0] || null;
      }

      function showChapterPreview(index) {
        if (index < 0 || index >= views.length || index === activeIndex || chapterPreviewBlocked()) {
          clearChapterPreviewPresentation();
          return false;
        }
        if (activePreviewIndex === index && svg.getAttribute('data-chapter-preview') === views[index].id) return true;
        clearChapterPreviewPresentation();
        var delta = chapterDelta(activeIndex >= 0 ? views[activeIndex] : null, views[index]);
        var roles = {};
        delta.stay.forEach(function (id) { roles[id] = 'stay'; });
        delta.enter.forEach(function (id) { roles[id] = 'enter'; });
        delta.leave.forEach(function (id) { roles[id] = 'leave'; });
        Array.prototype.forEach.call(svg.querySelectorAll('[data-node-id]'), function (node) {
          var role = roles[node.getAttribute('data-node-id')];
          if (role) node.setAttribute('data-chapter-preview-role', role);
        });
        svg.setAttribute('data-chapter-preview', views[index].id);
        chapterButtons[index].setAttribute('data-preview-active', 'true');
        activePreviewIndex = index;
        if (Archify.motionGovernor && Archify.motionGovernor.capable) {
          previewOwnerToken = Archify.motionGovernor.claim('chapter-preview', function () {
            previewOwnerToken = 0;
            clearChapterPreviewPresentation();
          });
        }
        return true;
      }

      function syncChapterPreview() {
        var intent = winningChapterPreviewIntent();
        if (!intent || chapterPreviewBlocked()) {
          clearChapterPreviewPresentation();
          return false;
        }
        return showChapterPreview(intent.index);
      }

      function setChapterPreviewIntent(source, index) {
        var intent = { index: index, generation: ++previewGeneration };
        if (source === 'pointer') pointerPreviewIntent = intent;
        else focusPreviewIntent = intent;
        if (playing) pausePlayback();
        return syncChapterPreview();
      }

      function clearChapterPreviewIntent(source, index) {
        var intent = source === 'pointer' ? pointerPreviewIntent : focusPreviewIntent;
        if (intent && (typeof index !== 'number' || intent.index === index)) {
          if (source === 'pointer') pointerPreviewIntent = null;
          else focusPreviewIntent = null;
          previewGeneration += 1;
        }
        return syncChapterPreview();
      }

      function hoverCapable() {
        return !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
      }

      function sharePlaybackRequested() {
        try { return new URLSearchParams(location.search).get('play') === '1'; }
        catch (_) { return false; }
      }

      autoplayPending = sharePlaybackRequested();
      if (autoplayPending) {
        document.documentElement.setAttribute('data-share-playback', 'true');
        setAutoplayState('pending');
      }

      function setAutoplayState(state) {
        if (state) panel.setAttribute('data-autoplay', state);
        else panel.removeAttribute('data-autoplay');
        renderShareCue();
      }

      function shareCueStatus(state) {
        return {
          pending: viewerText('viewer.guided.state.ready'),
          playing: viewerText('viewer.guided.state.playing'),
          complete: viewerText('viewer.guided.state.settled'),
          interrupted: viewerText('viewer.guided.state.paused'),
          pinned: viewerText('viewer.guided.state.pinned'),
          'reduced-motion': viewerText('viewer.guided.state.still')
        }[state] || viewerText('viewer.guided.state.ready');
      }

      function shareCueBeatCopy(state, view, stops) {
        var total = stops.length;
        var activeStop = storyBeatIndex >= 0 ? stops[storyBeatIndex] : null;
        if ((state === 'playing' || state === 'interrupted') && activeStop) {
          return viewerText('viewer.guided.share.step', {
            index: (storyBeatIndex + 1 < 10 ? '0' : '') + (storyBeatIndex + 1),
            total: (total < 10 ? '0' : '') + total,
            label: activeStop.textContent
          });
        }
        if (state === 'pinned' && activeStop) {
          return storyBeatCopy(storySteps[storyBeatIndex], total);
        }
        if (state === 'reduced-motion' && activeStop && hashBeatMatchesCurrent()) {
          return viewerText('viewer.guided.share.staticMoment', {
            step: viewerText('viewer.guided.share.step', {
              index: (storyBeatIndex + 1 < 10 ? '0' : '') + (storyBeatIndex + 1),
              total: (total < 10 ? '0' : '') + total,
              label: activeStop.textContent
            })
          });
        }
        if (state === 'complete') return viewerText('viewer.guided.share.complete', {
          count: total,
          note: view.note || viewerText('viewer.guided.share.settled')
        });
        if (state === 'reduced-motion') return viewerText('viewer.guided.share.staticPath', { count: total });
        if (state === 'pending') return viewerText('viewer.guided.share.ready', { count: total });
        return view.note || viewerText('viewer.guided.chapter.selectedNodes', { count: view.focus.length });
      }

      function renderShareCue() {
        if (!shareCue) return;
        var view = activeIndex >= 0 ? views[activeIndex] : null;
        var shareMode = document.documentElement.getAttribute('data-share-playback') === 'true';
        var embedMode = document.documentElement.getAttribute('data-embed') === 'true';
        var pinnedMode = !shareMode && embedMode && hashBeatMatchesCurrent();
        if (pinnedMode) document.documentElement.setAttribute('data-share-moment', 'true');
        else document.documentElement.removeAttribute('data-share-moment');
        shareCue.hidden = !(embedMode && view && (shareMode || pinnedMode));
        if (shareCue.hidden) return;
        var state = pinnedMode ? 'pinned' : (panel.getAttribute('data-autoplay') || 'pending');
        var stops = Array.prototype.slice.call(trail.querySelectorAll('[data-story-node]'));
        var route = stops.map(function (stop, index) {
          if (index === 0) return stop.textContent;
          var kind = stop.getAttribute('data-story-link');
          var separator = kind === 'forward' ? '\u2192' : (kind === 'reverse' ? '\u2190' : (kind === 'multiple' ? '\u21c4' : '\u00b7'));
          return separator + ' ' + stop.textContent;
        }).join(' ');
        var beatCopy = shareCueBeatCopy(state, view, stops);
        shareCue.setAttribute('data-state', state);
        shareCue.setAttribute('aria-live', state === 'playing' ? 'off' : 'polite');
        shareCueState.textContent = shareCueStatus(state);
        shareCueCount.textContent = viewerText('viewer.guided.share.chapter', {
          index: (activeIndex + 1 < 10 ? '0' : '') + (activeIndex + 1),
          total: (views.length < 10 ? '0' : '') + views.length
        });
        shareCueLabel.textContent = view.label;
        shareCueNote.textContent = beatCopy;
        shareCueRoute.textContent = route;
        shareCue.setAttribute('aria-label', viewerText('viewer.guided.share.aria', {
          state: shareCueStatus(state),
          index: activeIndex + 1,
          total: views.length,
          label: view.label,
          beat: beatCopy,
          route: route
        }));
      }

      function setShareCueProgress(fraction) {
        if (!shareCueProgress) return;
        shareCueProgress.style.animation = 'none';
        shareCueProgress.style.setProperty('--guided-progress-start', String(Math.max(0, Math.min(1, fraction))));
        shareCueProgress.style.transform = 'scaleX(' + Math.max(0, Math.min(1, fraction)) + ')';
      }

      function startShareCueProgress(fraction, duration) {
        if (!shareCueProgress) return;
        setShareCueProgress(fraction || 0);
        void shareCueProgress.offsetWidth;
        shareCueProgress.style.animation = 'archify-guided-progress ' + Math.max(1, duration || VIEW_INTERVAL_MS) + 'ms linear forwards';
      }

      function storyNodeLabel(node, fallback) {
        if (!node) return fallback;
        return node.getAttribute('data-node-label') ||
          (node.getAttribute('aria-label') || fallback).replace(/^Focus\s+/, '');
      }

      function storyEdgeKey(edge) {
        return edge.getAttribute('data-edge-key') || (
          edge.getAttribute('data-edge-from') + '\u0000' +
          edge.getAttribute('data-edge-to') + '\u0000' +
          (edge.getAttribute('data-edge-label') || '')
        );
      }

      function uniqueStoryEdges(edgeList) {
        var positions = {};
        var unique = [];
        edgeList.forEach(function (edge) {
          var key = storyEdgeKey(edge);
          if (!Object.prototype.hasOwnProperty.call(positions, key)) {
            positions[key] = unique.length;
            unique.push(edge);
            return;
          }
          var index = positions[key];
          if (!storyGeometry(unique[index]).length && storyGeometry(edge).length) unique[index] = edge;
        });
        return unique;
      }

      function storyStep(view, index, edgeList, byId) {
        var id = view.focus[index];
        var node = byId[id];
        var previousId = index > 0 ? view.focus[index - 1] : '';
        var forward = [];
        var reverse = [];
        if (previousId) {
          edgeList.forEach(function (edge) {
            var from = edge.getAttribute('data-edge-from');
            var to = edge.getAttribute('data-edge-to');
            if (from === previousId && to === id) forward.push(edge);
            else if (from === id && to === previousId) reverse.push(edge);
          });
        }
        forward = uniqueStoryEdges(forward);
        reverse = uniqueStoryEdges(reverse);
        var edges = forward.concat(reverse).sort(function (left, right) {
          return edgeList.indexOf(left) - edgeList.indexOf(right);
        });
        var relation = index === 0 ? 'start' : (!edges.length ? 'group' : (
          edges.length === 1 && forward.length === 1 ? 'forward' :
          (edges.length === 1 && reverse.length === 1 ? 'reverse' : 'multiple')
        ));
        return {
          index: index,
          nodeId: id,
          nodeLabel: storyNodeLabel(byId[id], id),
          previousId: previousId,
          previousLabel: previousId ? storyNodeLabel(byId[previousId], previousId) : '',
          relation: relation,
          edges: edges,
          edgeKeys: edges.map(storyEdgeKey),
          edgeLabels: edges.map(function (edge) { return edge.getAttribute('data-edge-label') || ''; }).filter(function (value, edgeIndex, values) {
            return value && values.indexOf(value) === edgeIndex;
          }),
          responsibility: node ? (node.getAttribute('data-node-sublabel') || '') : '',
          context: node ? (node.getAttribute('data-node-context') || '') : ''
        };
      }

      function storyBeatCopy(step, total) {
        if (!step) return '';
        var position = (step.index + 1 < 10 ? '0' : '') + (step.index + 1);
        var countValue = (total < 10 ? '0' : '') + total;
        if (step.relation === 'start') return viewerText('viewer.guided.beat.start', { index: position, total: countValue, label: step.nodeLabel });
        if (step.relation === 'forward') return viewerText('viewer.guided.beat.forward', { index: position, total: countValue, from: step.previousLabel, to: step.nodeLabel });
        if (step.relation === 'reverse') return viewerText('viewer.guided.beat.reverse', { index: position, total: countValue, from: step.nodeLabel, to: step.previousLabel });
        if (step.relation === 'multiple') return viewerText('viewer.guided.beat.multiple', { index: position, total: countValue, from: step.previousLabel, to: step.nodeLabel, count: step.edges.length });
        return viewerText('viewer.guided.beat.group', { index: position, total: countValue, from: step.previousLabel, to: step.nodeLabel });
      }

      function storyBeatAria(step, total) {
        var prefix = viewerText('viewer.guided.beat.aria.prefix', { index: step.index + 1, total: total, label: step.nodeLabel });
        if (step.relation === 'start') return prefix + viewerText('viewer.guided.beat.aria.start');
        if (step.relation === 'forward') return prefix + viewerText('viewer.guided.beat.aria.forward', { from: step.previousLabel });
        if (step.relation === 'reverse') return prefix + viewerText('viewer.guided.beat.aria.reverse', { from: step.previousLabel, to: step.nodeLabel });
        if (step.relation === 'multiple') return prefix + viewerText('viewer.guided.beat.aria.multiple', { from: step.previousLabel, count: step.edges.length });
        return prefix + viewerText('viewer.guided.beat.aria.group', { from: step.previousLabel });
      }

      function storyCaptionRouteCopy(step) {
        if (step.relation === 'start') return step.nodeLabel + ' · ' + viewerText('viewer.guided.caption.start');
        if (step.relation === 'reverse') return step.previousLabel + ' ← ' + step.nodeLabel;
        if (step.relation === 'multiple') return step.previousLabel + ' ⇄ ' + step.nodeLabel;
        if (step.relation === 'group') return step.previousLabel + ' · ' + step.nodeLabel;
        return step.previousLabel + ' → ' + step.nodeLabel;
      }

      function storyCaptionDetailCopy(step) {
        var facts = [];
        if (step.relation === 'group') facts.push(viewerText('viewer.guided.caption.grouped'));
        else if (step.edgeLabels.length) facts.push(step.edgeLabels.slice(0, 3).join(' + ') + (step.edgeLabels.length > 3 ? viewerText('viewer.guided.caption.more', { count: step.edgeLabels.length - 3 }) : ''));
        else if (step.relation === 'reverse') facts.push(viewerText('viewer.guided.caption.reverse'));
        else if (step.relation === 'multiple') facts.push(viewerText('viewer.guided.caption.relationships', { count: step.edges.length }));
        else if (step.relation !== 'start') facts.push(viewerText('viewer.guided.caption.relationship'));
        if (step.relation === 'reverse') facts.push(viewerText('viewer.guided.caption.direction', { from: step.nodeLabel, to: step.previousLabel }));
        if (step.responsibility) facts.push(step.responsibility);
        if (step.context) facts.push(step.context);
        if (!facts.length) facts.push(viewerText('viewer.guided.caption.starting'));
        return facts.join(' · ');
      }

      function renderStoryCaption(step, total, nextStep) {
        if (!storyCaption) return;
        if (!step) {
          storyCaption.hidden = true;
          storyCaption.removeAttribute('data-story-caption');
          storyCaptionNext.hidden = true;
          storyCaptionNextLabel.textContent = '';
          return;
        }
        storyCaption.hidden = false;
        storyCaption.setAttribute('data-story-caption', step.relation);
        storyCaption.setAttribute('aria-live', playing ? 'off' : 'polite');
        storyCaptionIndex.textContent = (step.index + 1 < 10 ? '0' : '') + (step.index + 1) + ' / ' + (total < 10 ? '0' : '') + total;
        storyCaptionRoute.textContent = storyCaptionRouteCopy(step);
        storyCaptionDetail.textContent = storyCaptionDetailCopy(step);
        storyCaptionNext.hidden = !nextStep;
        storyCaptionNextLabel.textContent = nextStep
          ? ((nextStep.index + 1 < 10 ? '0' : '') + (nextStep.index + 1) + ' · ' + nextStep.nodeLabel)
          : '';
        storyCaption.style.animation = 'none';
        void storyCaption.offsetWidth;
        storyCaption.style.removeProperty('animation');
      }

      function storyMomentLink() {
        var view = activeIndex >= 0 ? views[activeIndex] : null;
        var step = storyBeatIndex >= 0 ? storySteps[storyBeatIndex] : null;
        if (!view || !step) return '';
        var url = new URL(location.href);
        url.searchParams.delete('play');
        url.hash = 'view=' + encodeURIComponent(view.id) + '&beat=' + encodeURIComponent(step.nodeId);
        return url.href;
      }

      function fallbackCopyStoryMoment(value) {
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

      function resetBeatLinkFeedback() {
        if (beatLinkFeedbackTimer) clearTimeout(beatLinkFeedbackTimer);
        beatLinkFeedbackTimer = null;
        beatLink.removeAttribute('data-copy-state');
        beatLinkLabel.textContent = viewerText('viewer.guided.copyMoment');
      }

      function syncBeatLink() {
        var step = storyBeatIndex >= 0 ? storySteps[storyBeatIndex] : null;
        var available = !!(activeIndex >= 0 && step && !currentHandoff);
        beatLink.disabled = !available;
        if (!beatLink.hasAttribute('data-copy-state')) beatLinkLabel.textContent = viewerText('viewer.guided.copyMoment');
        var description = available
          ? viewerText('viewer.guided.beatLink', { index: step.index + 1, total: storySteps.length, label: step.nodeLabel })
          : viewerText('viewer.guided.selectBeatLink');
        beatLink.setAttribute('aria-label', description);
        beatLink.title = description;
      }

      function setBeatLinkFeedback(copied) {
        resetBeatLinkFeedback();
        beatLink.setAttribute('data-copy-state', copied ? 'copied' : 'failed');
        beatLinkLabel.textContent = viewerText(copied ? 'viewer.guided.copied' : 'viewer.guided.copyFailed');
        beatLink.setAttribute('aria-label', viewerText(copied ? 'viewer.guided.momentCopied' : 'viewer.guided.momentCopyFailed'));
        beatLinkFeedbackTimer = setTimeout(function () {
          resetBeatLinkFeedback();
          syncBeatLink();
        }, 1600);
      }

      function copyStoryMomentLink() {
        if (playing) pausePlayback();
        var value = storyMomentLink();
        if (!value) return Promise.resolve(false);
        var copy = navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
          ? navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return fallbackCopyStoryMoment(value); })
          : Promise.resolve(fallbackCopyStoryMoment(value));
        return copy.then(function (copied) {
          setBeatLinkFeedback(copied);
          return copied;
        });
      }

      function hashBeatMatchesCurrent() {
        var view = activeIndex >= 0 ? views[activeIndex] : null;
        var step = storyBeatIndex >= 0 ? storySteps[storyBeatIndex] : null;
        if (!view || !step) return false;
        try {
          var params = new URLSearchParams(location.hash.replace(/^#/, ''));
          return params.get('view') === view.id && params.get('beat') === step.nodeId;
        } catch (_) { return false; }
      }

      function storyMotionAllowed() {
        if (document.hidden || reducedMotion()) return false;
        if (document.documentElement.getAttribute('data-motion') !== 'live') return false;
        if (document.documentElement.getAttribute('data-embed') === 'true' &&
            document.documentElement.getAttribute('data-share-playback') !== 'true') return false;
        if (window.matchMedia && window.matchMedia('print').matches) return false;
        return !(Archify.motionGovernor && Archify.motionGovernor.isPaused());
      }

      function storyAutomaticPlaybackAllowed() {
        if (document.hidden || reducedMotion()) return false;
        if (window.matchMedia && window.matchMedia('print').matches) return false;
        if (Archify.motionGovernor && Archify.motionGovernor.capable) return !Archify.motionGovernor.isPaused();
        return true;
      }

      function clearStoryPulse(options) {
        options = options || {};
        storyPulseGeneration += 1;
        Array.prototype.forEach.call(svg.querySelectorAll('.story-trail-flow[data-story-pulse]'), function (flow) {
          flow.removeAttribute('data-story-pulse');
        });
        Array.prototype.forEach.call(svg.querySelectorAll('[data-story-carrier-overlay]'), function (overlay) {
          overlay.remove();
        });
        if (storyPulseOwnerToken && options.release !== false && Archify.motionGovernor) {
          var token = storyPulseOwnerToken;
          storyPulseOwnerToken = 0;
          Archify.motionGovernor.release(token);
        } else if (options.release === false) storyPulseOwnerToken = 0;
      }

      function pulseStoryStep(step) {
        clearStoryPulse();
        if (!step || (step.relation !== 'forward' && step.relation !== 'reverse') || step.edges.length !== 1 || !storyMotionAllowed()) return false;
        var flows = Array.prototype.slice.call(svg.querySelectorAll('.story-trail-flow[data-story-beat-step="' + step.index + '"]'));
        if (!flows.length) return false;
        var pulseGeneration = storyPulseGeneration;
        if (Archify.motionGovernor && Archify.motionGovernor.capable) {
          storyPulseOwnerToken = Archify.motionGovernor.claim('story', function () {
            clearStoryPulse({ release: false });
          });
        }
        flows.forEach(function (flow) { flow.setAttribute('data-story-pulse', 'true'); });
        if (Archify.flowTokens && typeof Archify.flowTokens.create === 'function') {
          var edge = step.edges[0];
          var shapes = storyGeometry(edge);
          var carrier = shapes.length ? Archify.flowTokens.create(edge, shapes[0], {
            className: 'story-flow-token',
            duration: '0.78s'
          }) : null;
          if (carrier) {
            var carrierOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            var carrierWrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            carrierOverlay.setAttribute('class', 'story-carrier-overlay');
            carrierOverlay.setAttribute('data-story-carrier-overlay', '');
            carrierOverlay.setAttribute('aria-hidden', 'true');
            if (edge.hasAttribute('transform')) carrierWrapper.setAttribute('transform', edge.getAttribute('transform'));
            carrier.setAttribute('data-story-carrier-token', '');
            carrier.setAttribute('data-story-beat-step', String(step.index));
            carrierWrapper.appendChild(carrier);
            carrierOverlay.appendChild(carrierWrapper);
            var firstNode = svg.querySelector('[data-node-id]');
            while (firstNode && firstNode.parentNode !== svg) firstNode = firstNode.parentNode;
            if (firstNode) svg.insertBefore(carrierOverlay, firstNode);
            else svg.appendChild(carrierOverlay);
          }
        }
        void flows[0].getBoundingClientRect();
        flows[0].addEventListener('animationend', function () {
          if (pulseGeneration === storyPulseGeneration) clearStoryPulse();
        }, { once: true });
        return true;
      }

      function stopStoryBeatTimer(options) {
        options = options || {};
        storyPlaybackGeneration += 1;
        if (storyBeatTimer && options.preserveElapsed === true && storyBeatStartedAt) {
          storyBeatElapsedMs = Math.min(storyBeatDwellMs, storyBeatElapsedMs + Math.max(0, Date.now() - storyBeatStartedAt));
        }
        if (storyBeatTimer) clearTimeout(storyBeatTimer);
        storyBeatTimer = null;
        storyBeatStartedAt = 0;
      }

      function centerStoryStop(stop) {
        if (!stop || !trail) return false;
        var bounds = stop.getBoundingClientRect();
        var viewportLeft = trail.getBoundingClientRect().left + trail.clientLeft;
        var target = Math.max(0, trail.scrollLeft + bounds.left - viewportLeft - (trail.clientWidth - bounds.width) / 2);
        trail.scrollLeft = target;
        return true;
      }

      function storyBeatDwell(total) {
        return Math.max(STORY_FOLLOW_MIN_DWELL_MS, VIEW_INTERVAL_MS / Math.max(1, total));
      }

      function clearStoryFollow() {
        storyFollowGeneration += 1;
        svg.removeAttribute('data-story-follow');
        panel.removeAttribute('data-story-follow');
        panel.removeAttribute('data-story-follow-node');
      }

      function storyFrameIds(step) {
        if (!step) return [];
        var ids = [];
        if (step.index > 0 && storySteps[step.index - 1]) ids.push(storySteps[step.index - 1].nodeId);
        ids.push(step.nodeId);
        if (step.index + 1 < storySteps.length) ids.push(storySteps[step.index + 1].nodeId);
        return ids;
      }

      function followStoryStep(step, options) {
        options = options || {};
        if (!step || document.hidden) return false;
        if (!Archify.view || typeof Archify.view.reveal !== 'function') {
          var deferredIndex = step.index;
          var deferredGeneration = ++storyFollowGeneration;
          requestAnimationFrame(function () {
            if (deferredGeneration !== storyFollowGeneration || storyBeatIndex !== deferredIndex) return;
            if (Archify.view && typeof Archify.view.reveal === 'function') followStoryStep(step, options);
          });
          return true;
        }
        if (window.matchMedia && window.matchMedia('print').matches) return false;
        var embed = document.documentElement.getAttribute('data-embed') === 'true';
        var explicitEmbedPlayback = document.documentElement.getAttribute('data-share-playback') === 'true';
        if (embed && !explicitEmbedPlayback && options.linked !== true) return false;
        var ids = storyFrameIds(step);
        var generation = ++storyFollowGeneration;
        svg.setAttribute('data-story-follow', step.nodeId);
        panel.setAttribute('data-story-follow', 'moving');
        panel.setAttribute('data-story-follow-node', step.nodeId);
        var receipt = Archify.view.reveal(ids, {
          reason: options.manual === true ? 'story-beat' : 'story-follow',
          padding: 64,
          maxScale: 1.65,
          duration: STORY_FOLLOW_DURATION_MS,
          instant: options.instant === true || reducedMotion() || document.documentElement.getAttribute('data-motion') !== 'live'
        });
        if (receipt && receipt.finished && typeof receipt.finished.then === 'function') {
          receipt.finished.then(function (result) {
            if (generation !== storyFollowGeneration || storyBeatIndex !== step.index) return;
            svg.removeAttribute('data-story-follow');
            panel.setAttribute('data-story-follow', result && result.state === 'complete' ? 'settled' : 'interrupted');
          });
        } else if (generation === storyFollowGeneration) {
          panel.setAttribute('data-story-follow', 'settled');
        }
        return receipt;
      }

      function setStoryBeat(index, options) {
        options = options || {};
        var stops = Array.prototype.slice.call(trail.querySelectorAll('[data-story-node]'));
        if (!stops.length) return false;
        resetBeatLinkFeedback();
        storyBeatIndex = Math.max(0, Math.min(stops.length - 1, index));
        var nextStep = storyBeatIndex + 1 < storySteps.length ? storySteps[storyBeatIndex + 1] : null;
        svg.setAttribute('data-story-beat', (storyBeatIndex + 1) + '/' + stops.length);
        panel.setAttribute('data-story-beat', (storyBeatIndex + 1) + '/' + stops.length);
        if (nextStep) {
          svg.setAttribute('data-story-next', nextStep.nodeId);
          panel.setAttribute('data-story-next', nextStep.nodeId);
        } else {
          svg.removeAttribute('data-story-next');
          panel.removeAttribute('data-story-next');
        }
        function storyBeatState(step) {
          if (step < storyBeatIndex) return 'past';
          if (step === storyBeatIndex) return 'active';
          if (step === storyBeatIndex + 1) return 'next';
          return 'pending';
        }
        Array.prototype.forEach.call(svg.querySelectorAll('[data-story-step]'), function (node) {
          var step = Number(node.getAttribute('data-story-step'));
          node.setAttribute('data-story-beat-state', storyBeatState(step));
        });
        Array.prototype.forEach.call(svg.querySelectorAll('[data-story-beat-step]'), function (edge) {
          var step = Number(edge.getAttribute('data-story-beat-step'));
          edge.setAttribute('data-story-beat-state', storyBeatState(step));
        });
        stops.forEach(function (stop, step) {
          stop.setAttribute('data-story-beat-state', storyBeatState(step));
          if (step === storyBeatIndex) stop.setAttribute('aria-current', 'step');
          else stop.removeAttribute('aria-current');
        });
        note.setAttribute('aria-live', 'off');
        note.textContent = storyBeatCopy(storySteps[storyBeatIndex], stops.length);
        renderStoryCaption(storySteps[storyBeatIndex], stops.length, nextStep);
        if (options.center === true) centerStoryStop(stops[storyBeatIndex]);
        if (options.pulse === true) pulseStoryStep(storySteps[storyBeatIndex]);
        else clearStoryPulse();
        if (options.follow === true) followStoryStep(storySteps[storyBeatIndex], {
          manual: options.manual === true,
          linked: options.linked === true,
          instant: options.followInstant === true
        });
        renderShareCue();
        syncBeatLink();
        return true;
      }

      function settleStoryBeats() {
        stopStoryBeatTimer();
        clearStoryPulse();
        clearStoryFollow();
        resetBeatLinkFeedback();
        storyBeatIndex = -1;
        storyBeatElapsedMs = 0;
        storyBeatDwellMs = 0;
        svg.removeAttribute('data-story-beat');
        svg.removeAttribute('data-story-next');
        panel.removeAttribute('data-story-beat');
        panel.removeAttribute('data-story-next');
        Array.prototype.forEach.call(svg.querySelectorAll('[data-story-beat-state]'), function (el) {
          el.removeAttribute('data-story-beat-state');
        });
        Array.prototype.forEach.call(trail.querySelectorAll('[data-story-beat-state]'), function (stop) {
          stop.removeAttribute('data-story-beat-state');
          stop.removeAttribute('aria-current');
        });
        note.setAttribute('aria-live', 'polite');
        if (activeIndex >= 0) note.textContent = views[activeIndex].note || viewerText('viewer.guided.chapter.selectedNodes', { count: views[activeIndex].focus.length });
        renderStoryCaption(null, 0);
        renderShareCue();
        syncBeatLink();
      }

      function clearStoryTrail() {
        stopStoryBeatTimer();
        clearStoryPulse();
        clearStoryFollow();
        resetBeatLinkFeedback();
        storyBeatIndex = -1;
        storyBeatElapsedMs = 0;
        storyBeatDwellMs = 0;
        storySteps = [];
        svg.removeAttribute('data-story-active');
        svg.removeAttribute('data-story-playing');
        svg.removeAttribute('data-story-beat');
        svg.removeAttribute('data-story-next');
        panel.removeAttribute('data-story-beat');
        panel.removeAttribute('data-story-next');
        Array.prototype.forEach.call(svg.querySelectorAll('[data-story-overlay]'), function (overlay) {
          overlay.remove();
        });
        Array.prototype.forEach.call(svg.querySelectorAll('[data-story-step], [data-story-beat-state]'), function (node) {
          node.removeAttribute('data-story-step');
          node.removeAttribute('data-story-beat-state');
          node.style.removeProperty('--story-step');
        });
        Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-story-beat-step]'), function (edge) {
          edge.removeAttribute('data-story-beat-step');
          edge.removeAttribute('data-story-beat-state');
        });
        trail.textContent = '';
        trail.hidden = true;
        trail.removeAttribute('aria-label');
        renderStoryCaption(null, 0);
        syncBeatLink();
      }

      function storyGeometry(edge) {
        if (/^(path|line|polyline)$/i.test(edge.tagName)) return [edge];
        return Array.prototype.slice.call(edge.querySelectorAll('path, line, polyline'));
      }

      function renderStoryTrail(view) {
        if (Archify.semanticLens && typeof Archify.semanticLens.clearPreview === 'function') Archify.semanticLens.clearPreview();
        clearStoryTrail();
        if (!view) return;

        var nodeList = Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'));
        var edgeList = Array.prototype.slice.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'));
        var byId = {};
        nodeList.forEach(function (node) { byId[node.getAttribute('data-node-id')] = node; });
        storySteps = view.focus.map(function (_, index) { return storyStep(view, index, edgeList, byId); });
        var labels = [];
        storySteps.forEach(function (step, index) {
          var id = step.nodeId;
          var node = byId[id];
          if (!node) return;
          node.setAttribute('data-story-step', String(index));
          node.style.setProperty('--story-step', String(index));
          var nodeLabel = step.nodeLabel;
          labels.push(nodeLabel);
          var stop = document.createElement('button');
          stop.type = 'button';
          stop.className = 'guided-view-stop';
          stop.setAttribute('data-story-node', id);
          stop.setAttribute('data-story-index', String(index));
          stop.setAttribute('data-story-relation', step.relation);
          stop.setAttribute('data-story-number', (index + 1 < 10 ? '0' : '') + (index + 1));
          if (index > 0) stop.setAttribute('data-story-link', step.relation);
          stop.style.setProperty('--story-step', String(index));
          stop.setAttribute('aria-label', storyBeatAria(step, storySteps.length));
          stop.title = storyBeatCopy(step, storySteps.length);
          stop.textContent = nodeLabel;
          trail.appendChild(stop);
        });
        trail.hidden = labels.length === 0;
        trail.setAttribute('aria-label', viewerText('viewer.guided.storyTrail', { label: view.label, count: labels.length }));
        trail.scrollLeft = 0;
        svg.setAttribute('data-story-active', view.id);

        var overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        overlay.setAttribute('class', 'story-trail-overlay');
        overlay.setAttribute('data-story-overlay', '');
        overlay.setAttribute('aria-hidden', 'true');
        var copied = 0;
        storySteps.forEach(function (step) {
          step.edges.forEach(function (edge) {
            var edgeBeat = step.index;
            edge.setAttribute('data-story-beat-step', String(edgeBeat));
            var wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            if (edge.hasAttribute('transform')) wrapper.setAttribute('transform', edge.getAttribute('transform'));
            storyGeometry(edge).forEach(function (shape) {
              var clone = shape.cloneNode(false);
              clone.removeAttribute('id');
              clone.removeAttribute('marker-start');
              clone.removeAttribute('marker-mid');
              clone.removeAttribute('marker-end');
              clone.removeAttribute('aria-label');
              clone.removeAttribute('role');
              clone.removeAttribute('data-animate');
              clone.removeAttribute('data-edge-from');
              clone.removeAttribute('data-edge-to');
              clone.removeAttribute('data-edge-key');
              clone.removeAttribute('data-edge-id');
              clone.removeAttribute('data-edge-label');
              clone.setAttribute('class', 'story-trail-flow');
              clone.setAttribute('data-story-beat-step', String(edgeBeat));
              clone.style.setProperty('--story-step', String(edgeBeat));
              wrapper.appendChild(clone);
              copied += 1;
            });
            if (wrapper.childNodes.length) overlay.appendChild(wrapper);
          });
        });
        if (copied) {
          var firstEdge = edgeList[0];
          if (firstEdge && firstEdge.parentNode) firstEdge.parentNode.insertBefore(overlay, firstEdge);
          else svg.insertBefore(overlay, svg.firstChild);
        }
      }

      function syncStoryPlayback() {
        var shouldPlay = playing && activeIndex >= 0;
        if (shouldPlay && svg.getAttribute('data-story-playing') !== 'true') svg.setAttribute('data-story-playing', 'true');
        else if (!shouldPlay && svg.hasAttribute('data-story-playing')) svg.removeAttribute('data-story-playing');
      }

      function resetProgress(fraction) {
        fraction = Math.max(0, Math.min(1, Number(fraction) || 0));
        progressBar.style.animation = 'none';
        progressBar.style.setProperty('--guided-progress-start', String(fraction));
        progressBar.style.transform = 'scaleX(' + fraction + ')';
      }

      function startProgress(fraction, duration) {
        resetProgress(fraction);
        void progressBar.offsetWidth;
        progressBar.style.animation = 'archify-guided-progress ' + Math.max(1, duration || VIEW_INTERVAL_MS) + 'ms linear forwards';
      }

      function currentStoryProgress() {
        var total = storySteps.length;
        if (!total || storyBeatIndex < 0) return 0;
        var elapsed = storyBeatElapsedMs;
        if (playing && storyBeatTimer && storyBeatStartedAt) elapsed += Math.max(0, Date.now() - storyBeatStartedAt);
        var dwell = storyBeatDwellMs || storyBeatDwell(total);
        return Math.max(0, Math.min(1, (storyBeatIndex + Math.min(1, elapsed / dwell)) / total));
      }

      function renderPlayback() {
        var automaticPlaybackAllowed = storyAutomaticPlaybackAllowed();
        panel.setAttribute('data-playing', playing ? 'true' : 'false');
        syncStoryPlayback();
        play.disabled = !playing && !automaticPlaybackAllowed;
        play.setAttribute('aria-pressed', playing ? 'true' : 'false');
        play.setAttribute('aria-label', viewerText(playing
          ? 'viewer.guided.pause'
          : !automaticPlaybackAllowed
            ? 'viewer.guided.motionUnavailable'
            : storyPlaybackComplete
              ? 'viewer.guided.replay'
              : 'viewer.guided.play'));
        play.title = viewerText(playing
          ? 'viewer.guided.pause.title'
          : !automaticPlaybackAllowed
            ? 'viewer.guided.enableMotion'
            : storyPlaybackComplete
              ? 'viewer.guided.replay.title'
              : 'viewer.guided.play.title');
        playIcon.textContent = playing ? '\u2016' : '\u25b6';
        playLabel.textContent = viewerText(playing
          ? 'viewer.guided.pauseStory'
          : storyPlaybackComplete
            ? 'viewer.guided.replayStory'
            : 'viewer.guided.playStory');
        if (storyCaption && !storyCaption.hidden) storyCaption.setAttribute('aria-live', playing ? 'off' : 'polite');
      }

      function render() {
        var view = views[activeIndex];
        count.textContent = activeIndex < 0 ? '0 / ' + views.length : (activeIndex + 1) + ' / ' + views.length;
        label.textContent = view ? view.label : viewerText('viewer.guided.explore');
        note.setAttribute('aria-live', storyBeatIndex >= 0 ? 'off' : 'polite');
        note.textContent = storyBeatIndex >= 0
          ? storyBeatCopy(storySteps[storyBeatIndex], storySteps.length)
          : (view
            ? (view.note || viewerText('viewer.guided.chapter.selectedNodes', { count: view.focus.length }))
            : viewerText('viewer.guided.intro'));
        prev.disabled = activeIndex < 0;
        next.disabled = activeIndex >= views.length - 1;
        all.disabled = activeIndex < 0;
        panel.setAttribute('data-active-view', view ? view.id : 'all');
        syncChapterIndex();
        renderShareCue();
        renderPlayback();
        syncBeatLink();
      }

      function pausePlayback(options) {
        options = options || {};
        var progress = options.complete === true ? 1 : currentStoryProgress();
        if (panel.getAttribute('data-autoplay') === 'playing') {
          setShareCueProgress(progress);
          setAutoplayState(options.complete === true ? 'complete' : 'interrupted');
        }
        stopStoryBeatTimer({ preserveElapsed: options.complete !== true });
        clearStoryPulse();
        clearStoryFollow();
        playing = false;
        storyPlaybackComplete = options.complete === true;
        resetProgress(progress);
        renderPlayback();
        renderShareCue();
      }

      function finishStoryChapter() {
        if (!playing) return false;
        if (storyPlaybackScope === 'chapter') {
          pausePlayback({ complete: true });
          return true;
        }
        if (activeIndex < views.length - 1) {
          var destinationIndex = activeIndex + 1;
          activate(destinationIndex, { playback: true });
          afterHandoff(function () {
            if (!playing || activeIndex !== destinationIndex) return;
            storyBeatElapsedMs = 0;
            setStoryBeat(0, { pulse: true, follow: true });
            scheduleStoryPlayback();
          });
          return true;
        }
        pausePlayback({ complete: true });
        return true;
      }

      function scheduleStoryPlayback() {
        var total = storySteps.length;
        if (!playing || !total || reducedMotion()) {
          if (playing) pausePlayback();
          return false;
        }
        storyBeatDwellMs = storyBeatDwell(total);
        if (storyBeatIndex < 0) {
          storyBeatElapsedMs = 0;
          setStoryBeat(0, { pulse: true, follow: true });
        }
        storyBeatElapsedMs = Math.max(0, Math.min(storyBeatDwellMs, storyBeatElapsedMs));
        var remainingDwell = Math.max(1, storyBeatDwellMs - storyBeatElapsedMs);
        var progress = (storyBeatIndex + storyBeatElapsedMs / storyBeatDwellMs) / total;
        var remainingChapter = remainingDwell + Math.max(0, total - storyBeatIndex - 1) * storyBeatDwellMs;
        startProgress(progress, remainingChapter);
        if (panel.getAttribute('data-autoplay') === 'playing') startShareCueProgress(progress, remainingChapter);
        var generation = ++storyPlaybackGeneration;
        storyBeatStartedAt = Date.now();
        storyBeatTimer = setTimeout(function () {
          if (!playing || generation !== storyPlaybackGeneration) return;
          storyBeatTimer = null;
          storyBeatStartedAt = 0;
          storyBeatElapsedMs = 0;
          if (storyBeatIndex < total - 1) {
            setStoryBeat(storyBeatIndex + 1, { pulse: true, follow: true });
            scheduleStoryPlayback();
          } else finishStoryChapter();
        }, remainingDwell);
        return true;
      }

      function startPlayback() {
        if (!storyAutomaticPlaybackAllowed()) {
          renderPlayback();
          return false;
        }
        autoplayPending = false;
        setAutoplayState(null);
        setShareCueProgress(0);
        document.documentElement.removeAttribute('data-share-playback');
        storyPlaybackScope = 'story';
        if (storyPlaybackComplete) showAll({ updateUrl: false });
        storyPlaybackComplete = false;
        if (activeIndex < 0) activate(0, { playback: true });
        playing = true;
        renderPlayback();
        afterHandoff(function () {
          if (!playing) return;
          if (storyBeatIndex >= 0) followStoryStep(storySteps[storyBeatIndex]);
          scheduleStoryPlayback();
        });
        return true;
      }

      function startCurrentViewPlayback() {
        if (document.hidden) return false;
        autoplayPending = false;
        document.documentElement.setAttribute('data-share-playback', 'true');
        storyPlaybackScope = 'chapter';
        storyPlaybackComplete = false;
        if (activeIndex < 0) activate(0, { playback: true, updateUrl: false });
        if (!storyAutomaticPlaybackAllowed()) {
          var preserveMoment = hashBeatMatchesCurrent();
          setShareCueProgress(preserveMoment && storySteps.length ? (storyBeatIndex + 1) / storySteps.length : 1);
          setAutoplayState('reduced-motion');
          playing = false;
          if (preserveMoment) {
            clearStoryPulse();
            renderShareCue();
          } else settleStoryBeats();
          renderPlayback();
          return false;
        }
        playing = true;
        setAutoplayState('playing');
        renderPlayback();
        afterHandoff(function () {
          if (!playing) return;
          if (storyBeatIndex >= 0) followStoryStep(storySteps[storyBeatIndex]);
          scheduleStoryPlayback();
        });
        return true;
      }

      function maybeStartSharePlayback() {
        if (!autoplayPending || document.hidden) return false;
        return startCurrentViewPlayback();
      }

      function togglePlayback() {
        return playing ? (pausePlayback(), false) : startPlayback();
      }

      function syncStoryControlsDisabled() {
        Array.prototype.forEach.call(trail.querySelectorAll('[data-story-node]'), function (stop) {
          stop.disabled = !!currentHandoff;
        });
        syncBeatLink();
      }

      function selectStoryBeat(index) {
        if (currentHandoff || activeIndex < 0 || index < 0 || index >= storySteps.length) return false;
        momentRestoreGeneration += 1;
        clearChapterPreview({ clearIntents: true });
        if (playing) pausePlayback();
        else {
          stopStoryBeatTimer();
          clearStoryPulse();
        }
        storyPlaybackComplete = false;
        storyPlaybackScope = 'story';
        storyBeatElapsedMs = 0;
        storyBeatDwellMs = storyBeatDwell(storySteps.length);
        var view = views[activeIndex];
        Archify.focus.setMany(view.focus, {
          toggle: false,
          updateUrl: false,
          mode: 'selection',
          label: view.label,
          hideChip: true
        });
        setStoryBeat(index, { manual: true, center: true, pulse: true, follow: true });
        resetProgress(index / storySteps.length);
        renderPlayback();
        return true;
      }

      function selectStoryBeatById(id, options) {
        options = options || {};
        var index = storySteps.findIndex(function (step) { return step.nodeId === id; });
        if (index < 0) return false;
        if (playing) pausePlayback();
        else {
          stopStoryBeatTimer();
          clearStoryPulse();
        }
        storyPlaybackComplete = false;
        storyPlaybackScope = 'story';
        storyBeatElapsedMs = 0;
        storyBeatDwellMs = storyBeatDwell(storySteps.length);
        setStoryBeat(index, {
          manual: false,
          center: true,
          pulse: false,
          follow: options.follow === true,
          linked: options.linked === true,
          followInstant: options.followInstant === true
        });
        resetProgress(index / storySteps.length);
        renderPlayback();
        return true;
      }

      function updateUrl(view) {
        try {
          history.replaceState(null, '', location.pathname + location.search + (view ? '#view=' + encodeURIComponent(view.id) : ''));
        } catch (_) {}
      }

      function showAll(options) {
        options = options || {};
        if (options.restore !== true) momentRestoreGeneration += 1;
        clearChapterPreview({ clearIntents: true });
        if (playing && options.playback !== true) pausePlayback();
        if (options.playback !== true) storyPlaybackComplete = false;
        cancelHandoff('overview');
        activeIndex = -1;
        renderStoryTrail(null);
        if (options.clearFocus !== false) Archify.focus.clear({ updateUrl: false });
        if (options.resetView !== false && Archify.view && typeof Archify.view.reset === 'function') {
          Archify.view.reset({ automatic: true });
        }
        render();
        if (options.updateUrl !== false) updateUrl(null);
      }

      function activate(index, options) {
        options = options || {};
        if (options.restore !== true) momentRestoreGeneration += 1;
        if (playing && options.playback !== true) pausePlayback();
        if (options.playback !== true) storyPlaybackComplete = false;
        if (index < 0) { showAll(options); return true; }
        if (index >= views.length) return false;
        clearChapterPreview({ clearIntents: true });
        var previousIndex = activeIndex;
        var previous = previousIndex >= 0 ? views[previousIndex] : null;
        var outgoingBeatIndex = storyBeatIndex;
        cancelHandoff('replaced');
        activeIndex = index;
        var view = views[index];
        Archify.focus.setMany(view.focus, {
          toggle: false,
          updateUrl: false,
          mode: 'selection',
          label: view.label,
          hideChip: true
        });
        renderStoryTrail(view);
        beginHandoff(previousIndex, index, previous, view, outgoingBeatIndex, options.playback === true ? 'playback' : 'guided');
        syncStoryControlsDisabled();
        render();
        if (options.updateUrl !== false) updateUrl(view);
        return true;
      }

      function activateById(id, options) {
        var index = views.findIndex(function (view) { return view.id === id; });
        return index >= 0 && activate(index, options);
      }

      prev.addEventListener('click', function () { activate(activeIndex - 1); });
      next.addEventListener('click', function () { activate(activeIndex + 1); });
      all.addEventListener('click', function () { showAll(); });
      play.addEventListener('click', togglePlayback);
      beatLink.addEventListener('click', copyStoryMomentLink);
      trail.addEventListener('focusin', function (event) {
        if (!event.target.closest('[data-story-node]')) return;
        if (playing) pausePlayback();
      });
      trail.addEventListener('click', function (event) {
        var stop = event.target.closest('[data-story-node]');
        if (!stop || stop.disabled) return;
        selectStoryBeat(Number(stop.getAttribute('data-story-index')));
      });
      trail.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        var stop = event.target.closest('[data-story-node]');
        if (!stop || stop.disabled) return;
        event.preventDefault();
        selectStoryBeat(Number(stop.getAttribute('data-story-index')));
      });
      chapterList.addEventListener('click', function (event) {
        var button = event.target.closest('[data-guided-view-id]');
        if (!button) return;
        activateById(button.getAttribute('data-guided-view-id'));
      });
      chapterList.addEventListener('pointerover', function (event) {
        var button = event.target.closest('[data-guided-view-id]');
        if (!button || !hoverCapable() || event.pointerType === 'touch') return;
        if (event.relatedTarget && button.contains(event.relatedTarget)) return;
        setChapterPreviewIntent('pointer', chapterButtons.indexOf(button));
      });
      chapterList.addEventListener('pointerout', function (event) {
        var button = event.target.closest('[data-guided-view-id]');
        if (!button || (event.relatedTarget && button.contains(event.relatedTarget))) return;
        clearChapterPreviewIntent('pointer', chapterButtons.indexOf(button));
      });
      chapterIndex.addEventListener('focusin', function (event) {
        var button = event.target.closest('[data-guided-view-id]');
        if (!button) return;
        setChapterPreviewIntent('focus', chapterButtons.indexOf(button));
      });
      chapterIndex.addEventListener('focusout', function (event) {
        var button = event.target.closest('[data-guided-view-id]');
        if (!button || (event.relatedTarget && button.contains(event.relatedTarget))) return;
        clearChapterPreviewIntent('focus', chapterButtons.indexOf(button));
      });
      chapterList.addEventListener('keydown', function (event) {
        var button = event.target.closest('[data-guided-view-id]');
        var index = chapterButtons.indexOf(button);
        if (index < 0) return;
        var target = null;
        if (event.key === 'ArrowRight') target = Math.min(chapterButtons.length - 1, index + 1);
        else if (event.key === 'ArrowLeft') target = Math.max(0, index - 1);
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = chapterButtons.length - 1;
        if (target === null) return;
        event.preventDefault();
        focusChapterButton(target);
      });

      // A direct node exploration supersedes the curated view. Capture phase
      // releases the view before the focus explorer writes its own deep link.
      function releaseForNode(event) {
        if (activeIndex >= 0 && event.target.closest('[data-node-id]')) {
          pausePlayback();
          showAll({ clearFocus: false, updateUrl: false });
        }
      }
      svg.addEventListener('click', releaseForNode, true);
      svg.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') releaseForNode(event);
      }, true);

      document.addEventListener('keydown', function (event) {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (document.documentElement.getAttribute('data-guide-open') === 'true') return;
        var target = event.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        if (event.key === ']') {
          event.preventDefault();
          if (activeIndex < views.length - 1) activate(activeIndex + 1);
        } else if (event.key === '[') {
          event.preventDefault();
          if (activeIndex >= 0) activate(activeIndex - 1);
        } else if (event.key.toLowerCase() === 'p') {
          event.preventDefault();
          togglePlayback();
        } else if (event.key === 'Escape' && activePreviewIndex >= 0) {
          event.preventDefault();
          event.stopImmediatePropagation();
          clearChapterPreview({ clearIntents: true });
        } else if (event.key === 'Escape' && activeIndex >= 0) {
          event.preventDefault();
          showAll();
        }
      }, true);

      function syncViewFromHash() {
        try {
          var params = new URLSearchParams(location.hash.replace(/^#/, ''));
          var initial = params.get('view');
          var requestedBeat = params.get('beat');
          var restoreGeneration = ++momentRestoreGeneration;
          if (initial) {
            var activated = activateById(initial, { updateUrl: false, restore: true });
            if (!activated) {
              showAll({ updateUrl: false, restore: true });
              return;
            }
            if (requestedBeat) afterHandoff(function () {
              if (restoreGeneration !== momentRestoreGeneration) return;
              var latest = new URLSearchParams(location.hash.replace(/^#/, ''));
              if (latest.get('view') !== initial || latest.get('beat') !== requestedBeat) return;
              if (activeIndex < 0 || views[activeIndex].id !== initial) return;
              selectStoryBeatById(requestedBeat, { linked: true, follow: true, followInstant: true });
            });
          } else if (params.get('focus') || params.get('relation')) {
            activeIndex = -1;
            render();
          } else {
            showAll({ updateUrl: false, restore: true });
          }
        } catch (_) { showAll({ updateUrl: false, restore: true }); }
      }

      window.addEventListener('hashchange', syncViewFromHash);
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
          clearChapterPreview({ clearIntents: true });
          if (playing) pausePlayback();
          else clearStoryPulse();
          settleHandoff('hidden');
        }
        else if (!document.hidden) maybeStartSharePlayback();
      });
      if (window.matchMedia) {
        var guidedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        var onGuidedMotionChange = function () {
          if (guidedMotionQuery.matches) {
            if (playing) pausePlayback();
            else clearStoryPulse();
            settleHandoff('reduced-motion');
          }
        };
        if (typeof guidedMotionQuery.addEventListener === 'function') guidedMotionQuery.addEventListener('change', onGuidedMotionChange);
        else if (typeof guidedMotionQuery.addListener === 'function') guidedMotionQuery.addListener(onGuidedMotionChange);
      }
      if (document.documentElement.getAttribute('data-embed') !== 'true' && typeof MutationObserver !== 'undefined' && typeof Node !== 'undefined' && svg instanceof Node && document.documentElement instanceof Node) {
        var chapterPreviewOwnerObserver = new MutationObserver(syncChapterPreview);
        chapterPreviewOwnerObserver.observe(svg, {
          attributes: true,
          attributeFilter: [
            'data-route-picking', 'data-route-active', 'data-lens-active',
            'data-legend-preview-active', 'data-relationship-preview-active',
            'data-intent-trace-active', 'data-focus-active'
          ]
        });
        var storyMotionObserver = new MutationObserver(function () {
          if (document.documentElement.getAttribute('data-motion') !== 'live') clearStoryPulse();
          renderPlayback();
        });
        storyMotionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
      }
      if (typeof ResizeObserver === 'function') {
        var chapterViewportWidth = chapterList.clientWidth;
        var trailViewportWidth = trail.clientWidth;
        var storyScrollObserver = new ResizeObserver(function () {
          var chapterWidth = chapterList.clientWidth;
          var trailWidth = trail.clientWidth;
          if (chapterWidth !== chapterViewportWidth && activeIndex >= 0) centerChapterButton(chapterButtons[activeIndex]);
          if (trailWidth !== trailViewportWidth && storyBeatIndex >= 0) {
            centerStoryStop(trail.querySelectorAll('[data-story-node]')[storyBeatIndex]);
          }
          chapterViewportWidth = chapterWidth;
          trailViewportWidth = trailWidth;
        });
        storyScrollObserver.observe(chapterList);
        storyScrollObserver.observe(trail);
      }
      window.addEventListener('beforeprint', function () {
        clearChapterPreview({ clearIntents: true });
        if (playing) pausePlayback();
        else clearStoryPulse();
        settleHandoff('print');
      });
      syncViewFromHash();
      if (autoplayPending) {
        requestAnimationFrame(function () {
          requestAnimationFrame(maybeStartSharePlayback);
        });
      }

      return {
        count: views.length,
        activate: activateById,
        showAll: showAll,
        play: startPlayback,
        playCurrent: startCurrentViewPlayback,
        pause: pausePlayback,
        beatLink: storyMomentLink,
        copyBeatLink: copyStoryMomentLink,
        cancelHandoff: cancelHandoff,
        settleHandoff: settleHandoff,
        clearPreview: function () { return clearChapterPreview({ clearIntents: true }); },
        isPlaying: function () { return playing; },
        handoff: function () {
          return currentHandoff ? { id: currentHandoff.id, mode: currentHandoff.mode, anchor: currentHandoff.anchor || null } : null;
        },
        active: function () { return activeIndex < 0 ? null : views[activeIndex].id; },
        preview: function () { return activePreviewIndex < 0 ? null : views[activePreviewIndex].id; },
        delta: function (id) {
          var index = views.findIndex(function (view) { return view.id === id; });
          if (index < 0) return null;
          var value = chapterDelta(activeIndex >= 0 ? views[activeIndex] : null, views[index]);
          return { stay: value.stay.slice(), enter: value.enter.slice(), leave: value.leave.slice() };
        },
        beat: function () {
          var step = storyBeatIndex >= 0 ? storySteps[storyBeatIndex] : null;
          return step ? {
            index: step.index,
            position: step.index + 1,
            total: storySteps.length,
            nodeId: step.nodeId,
            relation: step.relation,
            edgeKeys: step.edgeKeys.slice()
          } : null;
        },
        focus: function () { return activeIndex < 0 ? [] : views[activeIndex].focus.slice(); }
      };
    })();