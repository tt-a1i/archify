
  /* ══════════════════════════════════════
     POLISH (shared) — spotlight, reveals, count-up, tilt.
     Zero dependencies; safe on every site page.
  ══════════════════════════════════════ */
  (function () {
    'use strict';
    var reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var finePointer = matchMedia('(pointer: fine)').matches;

    /* Spotlight — cursor-tracked glow on .spot cards */
    if (finePointer && !reducedMotion) {
      var spotEl = null, spotX = 0, spotY = 0, spotRaf = 0;
      document.addEventListener('pointermove', function (e) {
        spotEl = e.target.closest ? e.target.closest('.spot') : null;
        spotX = e.clientX; spotY = e.clientY;
        if (!spotRaf) spotRaf = requestAnimationFrame(function () {
          spotRaf = 0;
          if (!spotEl) return;
          var r = spotEl.getBoundingClientRect();
          spotEl.style.setProperty('--mx', (spotX - r.left) + 'px');
          spotEl.style.setProperty('--my', (spotY - r.top) + 'px');
        });
      }, { passive: true });
    }

    /* Reveal — .fade-up gains .visible once, on approach */
    var revealObs = null;
    if ('IntersectionObserver' in window) {
      revealObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add('visible'); revealObs.unobserve(entry.target); }
        });
      }, { threshold: .12, rootMargin: '0px 0px -40px 0px' });
    }
    function observe(el) {
      if (revealObs) revealObs.observe(el); else el.classList.add('visible');
    }
    document.querySelectorAll('.fade-up').forEach(observe);
    window.ArchifyPolish = { observe: observe, reducedMotion: reducedMotion };

    /* Count-up — [data-count] numbers animate once when they enter view */
    var nums = document.querySelectorAll('[data-count]');
    if (nums.length && !reducedMotion && 'IntersectionObserver' in window) {
      var nObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          nObs.unobserve(en.target);
          var el = en.target;
          var end = +el.dataset.count, pad = +(el.dataset.pad || 0);
          var t0 = performance.now(), dur = 1100;
          var tick = function (t) {
            var p = Math.min((t - t0) / dur, 1);
            el.textContent = String(Math.round(end * (1 - Math.pow(1 - p, 3)))).padStart(pad, '0');
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      }, { threshold: .5 });
      nums.forEach(function (n) { n.textContent = '0'.repeat(+n.dataset.pad || 1); nObs.observe(n); });
    }

    /* Tilt — [data-tilt] leans slightly toward the cursor inside [data-tilt-scope] (or its parent) */
    if (finePointer && !reducedMotion) {
      document.querySelectorAll('[data-tilt]').forEach(function (plate) {
        var scope = plate.closest('[data-tilt-scope]') || plate.parentElement;
        if (!scope) return;
        var tx = 0, ty = 0, cx = 0, cy = 0, tiltRaf = 0;
        var loop = function () {
          cx += (tx - cx) * .08; cy += (ty - cy) * .08;
          if (Math.abs(tx - cx) < .005 && Math.abs(ty - cy) < .005) {
            tiltRaf = 0;
            if (tx === 0 && ty === 0) plate.style.transform = '';
            return;
          }
          plate.style.transform = 'perspective(1400px) rotateY(' + cx + 'deg) rotateX(' + cy + 'deg)';
          tiltRaf = requestAnimationFrame(loop);
        };
        scope.addEventListener('pointermove', function (e) {
          var r = plate.getBoundingClientRect();
          tx = Math.max(-1.4, Math.min(1.4, ((e.clientX - (r.left + r.width / 2)) / r.width) * 2.4));
          ty = Math.max(-1.2, Math.min(1.2, -((e.clientY - (r.top + r.height / 2)) / r.height) * 2.4));
          if (!tiltRaf) tiltRaf = requestAnimationFrame(loop);
        }, { passive: true });
        scope.addEventListener('pointerleave', function () {
          tx = 0; ty = 0;
          if (!tiltRaf) tiltRaf = requestAnimationFrame(loop);
        });
      });
    }
  })();

  /* ══ L2: crosshair, scroll progress, scramble, magnetic ══ */
  (function () {
    'use strict';
    var reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var finePointer = matchMedia('(pointer: fine)').matches;

    /* Crosshair + coordinate readout — drafting instrument cursor */
    if (finePointer && !reducedMotion) {
      var cx = document.createElement('div'), cy = document.createElement('div'), cr = document.createElement('div');
      cx.className = 'crosshair crosshair-x'; cy.className = 'crosshair crosshair-y'; cr.className = 'crosshair-read';
      document.body.appendChild(cx); document.body.appendChild(cy); document.body.appendChild(cr);
      var glow = document.createElement('div');
      glow.className = 'grid-glow';
      glow.setAttribute('aria-hidden', 'true');
      document.body.appendChild(glow);
      var px = 0, py = 0, chRaf = 0;
      document.addEventListener('pointermove', function (e) {
        px = e.clientX; py = e.clientY;
        document.body.classList.add('has-crosshair');
        if (!chRaf) chRaf = requestAnimationFrame(function () {
          chRaf = 0;
          cx.style.transform = 'translateY(' + py + 'px)';
          cy.style.transform = 'translateX(' + px + 'px)';
          glow.style.setProperty('--gx', px + 'px');
          glow.style.setProperty('--gy', py + 'px');
          var lx = Math.min(px + 16, innerWidth - 150), ly = Math.min(py + 18, innerHeight - 30);
          cr.style.transform = 'translate(' + lx + 'px,' + ly + 'px)';
          cr.textContent = 'x:' + String(px).padStart(4, '0') + ' y:' + String(py).padStart(4, '0') + (hoverTag ? '  ·  ' + hoverTag : '');
        });
      }, { passive: true });
      var hoverTag = '';
      document.addEventListener('pointerover', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('a,button,[role="button"],iframe') : null;
        document.body.classList.toggle('crosshair-on', !!t);
        if (t) {
          var label = (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22);
          hoverTag = t.tagName === 'IFRAME' ? 'live doc' : (label || t.tagName.toLowerCase());
        } else hoverTag = '';
      }, { passive: true });
      document.addEventListener('mouseleave', function () { document.body.classList.remove('has-crosshair'); });
      document.addEventListener('pointerdown', function () { document.body.classList.add('has-crosshair'); });
    }

    /* Scroll progress line */
    var bar = document.createElement('div');
    bar.className = 'scroll-progress';
    document.body.appendChild(bar);
    var progRaf = 0;
    var setProgress = function () {
      progRaf = 0;
      var max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(scrollY / max, 1) : 0) + ')';
      document.body.classList.toggle('nav-scrolled', scrollY > 24);
    };
    addEventListener('scroll', function () { if (!progRaf) progRaf = requestAnimationFrame(setProgress); }, { passive: true });
    setProgress();

    /* Scramble — mono labels decode when they enter view */
    var GLYPHS = '▚▞▛░▒<>/=+*·_';
    var scramble = function (el) {
      if (el._scrambling) return;
      el._scrambling = true;
      var text = el.dataset.scrambled || el.textContent;
      var language = document.documentElement.lang;
      var t0 = performance.now();
      var frame = function (t) {
        // Language handlers replace localized labels; untranslated words still need to finish.
        if (document.documentElement.lang !== language && el.matches('[data-i18n], [data-en][data-zh]')) { el._scrambling = false; return; }
        var p = Math.min((t - t0) / 520, 1);
        var n = Math.floor(p * text.length);
        el.textContent = text.slice(0, n) + text.slice(n).replace(/[^\s]/g, function () { return GLYPHS[(Math.random() * GLYPHS.length) | 0]; });
        if (p < 1) requestAnimationFrame(frame); else { el.textContent = text; el._scrambling = false; }
      };
      requestAnimationFrame(frame);
    };
    if (!reducedMotion && 'IntersectionObserver' in window) {
      var sObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { sObs.unobserve(en.target); scramble(en.target); }
        });
      }, { threshold: .6 });
      document.querySelectorAll('.section-label, .lead-label, .rail-label, .export-label-row, .shortcut-title, .card-kicker, .mini-heading, .controls-note, .type-label span, .type-label strong, .panel-kicker span, .agent-picker-head span, .footer-word').forEach(function (el) {
        if (el.children.length === 0 && el.textContent.trim()) sObs.observe(el);
      });
    }

    /* Typed line — [data-typed] with "|" items, zh via data-typed-zh; re-runs on lang flip */
    document.querySelectorAll('[data-typed]').forEach(function (el) {
      var target = el.querySelector('.typed-text') || el;
      var timer = 0;
      var items = function () {
        var zh = /^zh/.test(document.documentElement.lang || '');
        var raw = (zh && el.dataset.typedZh) || el.dataset.typed || '';
        return raw.split('|').map(function (x) { return x.trim(); }).filter(Boolean);
      };
      var run = function () {
        clearTimeout(timer);
        var list = items();
        if (!list.length) return;
        if (reducedMotion) { target.textContent = list[0]; return; }
        var i = 0, pos = 0, dir = 1;
        var tick = function () {
          var str = list[i % list.length];
          pos += dir;
          target.textContent = str.slice(0, Math.max(0, pos));
          var wait = dir > 0 ? 46 : 15;
          if (dir > 0 && pos >= str.length) { dir = -1; wait = 2000; }
          else if (dir < 0 && pos <= 0) { dir = 1; i++; wait = 420; }
          timer = setTimeout(tick, wait);
        };
        tick();
      };
      run();
      new MutationObserver(function (muts) {
        muts.forEach(function (m) { if (m.attributeName === 'lang') run(); });
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    });

    /* Nav links decode on hover */
    if (finePointer && !reducedMotion) {
      document.querySelectorAll('.nav-link').forEach(function (link) {
        link.addEventListener('pointerenter', function () { scramble(link); });
      });
    }

    /* Sheet marks — fixed margin annotations; right one tracks scroll depth */
    (function () {
      var mkL = document.createElement('div'), mkR = document.createElement('div');
      mkL.className = 'sheet-mark sheet-mark-l'; mkR.className = 'sheet-mark sheet-mark-r';
      mkL.setAttribute('aria-hidden', 'true'); mkR.setAttribute('aria-hidden', 'true');
      mkL.textContent = 'ARCHIFY · FIELD SHEET';
      document.body.appendChild(mkL); document.body.appendChild(mkR);
      var markRaf = 0;
      var setMark = function () {
        markRaf = 0;
        mkR.textContent = 'Y·' + String(Math.round(scrollY)).padStart(5, '0') + 'PX';
      };
      addEventListener('scroll', function () { if (!markRaf) markRaf = requestAnimationFrame(setMark); }, { passive: true });
      setMark();
    })();

    /* Word-split reveal — [data-split] headings materialize word by word (CJK per char) */
    (function () {
      var splitWords = function (el) {
        if (el.querySelector('.w')) return;
        var wi = 0;
        var walk = function (node) {
          Array.prototype.slice.call(node.childNodes).forEach(function (n) {
            if (n.nodeType === 3) {
              var frag = document.createDocumentFragment();
              n.textContent.split(/(\s+|[\u3400-\u9fff\uf900-\ufaff])/g).forEach(function (tok) {
                if (!tok) return;
                if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(tok)); return; }
                var w = document.createElement('span');
                w.className = 'w';
                w.style.setProperty('--wi', wi++);
                w.textContent = tok;
                frag.appendChild(w);
              });
              node.replaceChild(frag, n);
            } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
          });
        };
        walk(el);
      };
      var splitAll = function () { document.querySelectorAll('[data-split]').forEach(splitWords); };
      splitAll();
      new MutationObserver(splitAll).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    })();

    /* Magnetic — primary actions lean toward the cursor */
    if (finePointer && !reducedMotion) {
      document.querySelectorAll('.btn-primary, .cta-install, .action-primary').forEach(function (btn) {
        btn.addEventListener('pointermove', function (e) {
          var r = btn.getBoundingClientRect();
          var dx = Math.max(-3, Math.min(3, (e.clientX - (r.left + r.width / 2)) * .1));
          var dy = Math.max(-3, Math.min(3, (e.clientY - (r.top + r.height / 2)) * .16));
          btn.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        });
        btn.addEventListener('pointerleave', function () { btn.style.transform = ''; });
      });
    }
  })();
