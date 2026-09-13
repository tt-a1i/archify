      function cleanExportClone(clone) {
        // View transforms and neighborhood focus are HTML exploration state,
        // never part of a downloaded full-diagram artifact.
        clone.style.removeProperty('transform');
        clone.style.removeProperty('clip-path');
        clone.removeAttribute('data-view-scale');
        clone.removeAttribute('data-focus-active');
        clone.removeAttribute('data-reach-active');
        clone.removeAttribute('data-lens-active');
        clone.removeAttribute('data-lens-flow-count');
        clone.removeAttribute('data-lens-flow-density');
        clone.removeAttribute('data-legend-preview-active');
        clone.removeAttribute('data-relationship-preview-active');
        clone.removeAttribute('data-relationship-direct-active');
        clone.removeAttribute('data-relationship-pin-active');
        clone.removeAttribute('data-intent-trace-active');
        clone.removeAttribute('data-route-picking');
        clone.removeAttribute('data-route-active');
        clone.removeAttribute('data-route-journey');
        clone.removeAttribute('data-share-route');
        clone.removeAttribute('data-share-reach');
        clone.removeAttribute('data-story-active');
        clone.removeAttribute('data-story-playing');
        clone.removeAttribute('data-story-beat');
        clone.removeAttribute('data-story-next');
        clone.removeAttribute('data-story-follow');
        clone.removeAttribute('data-chapter-handoff');
        clone.removeAttribute('data-chapter-anchor');
        clone.removeAttribute('data-chapter-preview');
        Array.prototype.forEach.call(clone.querySelectorAll('[data-chapter-handoff-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-chapter-role]'), function (el) {
          el.removeAttribute('data-chapter-role');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-chapter-preview-role]'), function (el) {
          el.removeAttribute('data-chapter-preview-role');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-story-overlay], [data-story-carrier-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-intent-trace-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-route-probe-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-route-journey-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-semantic-lens-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-legend-bridge-runtime]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-legend-kind]'), function (el) {
          el.removeAttribute('data-legend-kind');
          el.removeAttribute('data-legend-label');
          el.removeAttribute('data-legend-count');
          el.removeAttribute('data-legend-zero');
          el.removeAttribute('data-legend-selected');
          el.removeAttribute('role');
          el.removeAttribute('tabindex');
          el.removeAttribute('aria-label');
          el.removeAttribute('aria-pressed');
          el.removeAttribute('aria-haspopup');
          el.removeAttribute('aria-controls');
          el.removeAttribute('aria-expanded');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-legend-bridge]'), function (el) {
          el.removeAttribute('data-legend-bridge');
          el.removeAttribute('role');
          el.removeAttribute('aria-label');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-relationship-pulse-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-relationship-hit-overlay]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-source-evidence-beacon]'), function (el) {
          el.remove();
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-source-evidence-count]'), function (el) {
          var originalLabel = el.getAttribute('data-source-evidence-original-label');
          if (originalLabel == null || originalLabel === '') el.removeAttribute('aria-label');
          else el.setAttribute('aria-label', originalLabel);
          el.removeAttribute('data-source-evidence-count');
          el.removeAttribute('data-source-evidence-original-label');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-story-step], [data-story-beat-state], [data-story-beat-step]'), function (el) {
          el.removeAttribute('data-story-step');
          el.removeAttribute('data-story-beat-state');
          el.removeAttribute('data-story-beat-step');
          el.style.removeProperty('--story-step');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-focus-match], [data-focus-selected]'), function (el) {
          el.removeAttribute('data-focus-match');
          el.removeAttribute('data-focus-selected');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-reach-match], [data-reach-origin], [data-reach-depth]'), function (el) {
          el.removeAttribute('data-reach-match');
          el.removeAttribute('data-reach-origin');
          el.removeAttribute('data-reach-depth');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-lens-match], [data-lens-selected], [data-lens-peer]'), function (el) {
          el.removeAttribute('data-lens-match');
          el.removeAttribute('data-lens-selected');
          el.removeAttribute('data-lens-peer');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-legend-preview-match], [data-legend-preview-selected], [data-legend-preview-peer]'), function (el) {
          el.removeAttribute('data-legend-preview-match');
          el.removeAttribute('data-legend-preview-selected');
          el.removeAttribute('data-legend-preview-peer');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-relationship-preview], [data-relationship-preview-node], [data-relationship-preview-source], [data-relationship-preview-target]'), function (el) {
          el.removeAttribute('data-relationship-preview');
          el.removeAttribute('data-relationship-preview-node');
          el.removeAttribute('data-relationship-preview-source');
          el.removeAttribute('data-relationship-preview-target');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-intent-trace-match], [data-intent-trace-selected]'), function (el) {
          el.removeAttribute('data-intent-trace-match');
          el.removeAttribute('data-intent-trace-selected');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-route-match], [data-route-start], [data-route-end], [data-route-step], [data-route-candidate], [data-route-journey-state], [data-route-journey-current]'), function (el) {
          el.removeAttribute('data-route-match');
          el.removeAttribute('data-route-start');
          el.removeAttribute('data-route-end');
          el.removeAttribute('data-route-step');
          el.removeAttribute('data-route-candidate');
          el.removeAttribute('data-route-journey-state');
          el.removeAttribute('data-route-journey-current');
          el.style.removeProperty('--route-step');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-share-route-match], [data-share-route-step], [data-share-route-start], [data-share-route-end], [data-share-route-middle]'), function (el) {
          el.removeAttribute('data-share-route-match');
          el.removeAttribute('data-share-route-step');
          el.removeAttribute('data-share-route-start');
          el.removeAttribute('data-share-route-end');
          el.removeAttribute('data-share-route-middle');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-share-reach-match], [data-share-reach-origin], [data-share-reach-depth]'), function (el) {
          el.removeAttribute('data-share-reach-match');
          el.removeAttribute('data-share-reach-origin');
          el.removeAttribute('data-share-reach-depth');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-detail], [data-detail-anchor]'), function (el) {
          el.removeAttribute('data-detail');
          el.removeAttribute('data-detail-anchor');
        });
        Array.prototype.forEach.call(clone.querySelectorAll('[data-node-id][aria-pressed]'), function (el) {
          el.setAttribute('aria-pressed', 'false');
        });
        return !clone.hasAttribute('data-view-scale') &&
          !clone.hasAttribute('data-focus-active') &&
          !clone.hasAttribute('data-reach-active') &&
          !clone.hasAttribute('data-lens-active') &&
          !clone.hasAttribute('data-lens-flow-count') &&
          !clone.hasAttribute('data-lens-flow-density') &&
          !clone.hasAttribute('data-legend-preview-active') &&
          !clone.hasAttribute('data-relationship-preview-active') &&
          !clone.hasAttribute('data-relationship-direct-active') &&
          !clone.hasAttribute('data-intent-trace-active') &&
          !clone.hasAttribute('data-route-picking') &&
          !clone.hasAttribute('data-route-active') &&
          !clone.hasAttribute('data-route-journey') &&
          !clone.hasAttribute('data-share-route') &&
          !clone.hasAttribute('data-share-reach') &&
          !clone.hasAttribute('data-story-active') &&
          !clone.hasAttribute('data-story-playing') &&
          !clone.hasAttribute('data-story-beat') &&
          !clone.hasAttribute('data-story-next') &&
          !clone.hasAttribute('data-story-follow') &&
          !clone.hasAttribute('data-chapter-handoff') &&
          !clone.hasAttribute('data-chapter-anchor') &&
          !clone.hasAttribute('data-chapter-preview') &&
          !clone.style.getPropertyValue('transform') &&
          !clone.style.getPropertyValue('clip-path') &&
          clone.querySelectorAll('[data-story-overlay], [data-story-carrier-overlay], [data-story-carrier-token], [data-story-step], [data-story-beat-state], [data-story-beat-step], [data-chapter-handoff-overlay], [data-chapter-role], [data-chapter-preview-role], [data-focus-match], [data-focus-selected], [data-reach-match], [data-reach-origin], [data-reach-depth], [data-semantic-lens-overlay], [data-lens-match], [data-lens-selected], [data-lens-peer], [data-legend-bridge], [data-legend-kind], [data-legend-bridge-runtime], [data-legend-count], [data-legend-zero], [data-legend-selected], [data-legend-preview-match], [data-legend-preview-selected], [data-legend-preview-peer], [data-relationship-hit-overlay], [data-relationship-pulse-overlay], [data-relationship-preview], [data-relationship-preview-node], [data-relationship-preview-source], [data-relationship-preview-target], [data-intent-trace-overlay], [data-intent-trace-match], [data-intent-trace-selected], [data-route-probe-overlay], [data-route-journey-overlay], [data-route-match], [data-route-start], [data-route-end], [data-route-step], [data-route-candidate], [data-route-journey-state], [data-route-journey-current], [data-share-route-match], [data-share-route-step], [data-share-route-start], [data-share-route-end], [data-share-route-middle], [data-share-reach-match], [data-share-reach-origin], [data-share-reach-depth], [data-source-evidence-beacon], [data-source-evidence-count], [data-source-evidence-original-label], [data-detail], [data-detail-anchor]').length === 0;
      }
