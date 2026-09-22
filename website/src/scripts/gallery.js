
    (function () {
      var cards = Array.prototype.slice.call(document.querySelectorAll('.showcase-card'));
      var filterButtons = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
      var empty = document.getElementById('empty-state');
      var previewTheme = 'dark';
      var language = ArchifySiteLanguage.read();

      function applyLanguage(next) {
        language = ArchifySiteLanguage.write(next);
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
        document.querySelectorAll('[data-en][data-zh]').forEach(function (node) {
          node.innerHTML = node.getAttribute(language === 'zh' ? 'data-zh' : 'data-en');
        });
        var languageButton = document.getElementById('language');
        languageButton.textContent = language === 'zh' ? 'EN' : '中文';
        languageButton.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换到中文');
      }

      function applyFilter(type, updateUrl) {
        var visible = 0;
        var replay = [];
        cards.forEach(function (card) {
          var match = type === 'all' || card.getAttribute('data-type') === type;
          card.hidden = !match;
          if (match) {
            if (card.classList.contains('visible')) {
              card.classList.remove('visible');
              card.style.setProperty('--i', Math.min(visible, 14));
              replay.push(card);
            }
            visible += 1;
          }
        });
        if (replay.length) {
          void document.body.offsetHeight;
          replay.forEach(function (card) { card.classList.add('visible'); });
        }
        filterButtons.forEach(function (button) {
          button.setAttribute('aria-pressed', button.getAttribute('data-filter') === type ? 'true' : 'false');
        });
        empty.classList.toggle('visible', visible === 0);
        if (updateUrl) {
          var url = new URL(location.href);
          if (type === 'all') url.searchParams.delete('type');
          else url.searchParams.set('type', type);
          history.replaceState(null, '', url.pathname + url.search + url.hash);
        }
      }

      function applyPreviewTheme(next) {
        previewTheme = next === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-preview-theme', previewTheme);
        document.getElementById('preview-theme').textContent = 'Preview: ' + previewTheme;
        document.querySelectorAll('iframe[data-src-base]').forEach(function (frame) {
          frame.src = frame.getAttribute('data-src-base') + '?embed=1&theme=' + previewTheme;
        });
      }

      filterButtons.forEach(function (button) {
        button.addEventListener('click', function () { applyFilter(button.getAttribute('data-filter'), true); });
      });
      document.getElementById('language').addEventListener('click', function () { applyLanguage(language === 'en' ? 'zh' : 'en'); });
      document.getElementById('preview-theme').addEventListener('click', function () { applyPreviewTheme(previewTheme === 'dark' ? 'light' : 'dark'); });

      var allowed = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'];
      var requested = new URLSearchParams(location.search).get('type') || 'all';
      applyFilter(allowed.indexOf(requested) >= 0 ? requested : 'all', false);
      applyLanguage(language);

      if (matchMedia('(pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        cards.forEach(function (card) {
          card.addEventListener('mouseenter', function () {
            var frame = card.querySelector('iframe[data-src-base]');
            if (frame && frame.src.indexOf('play=1') < 0) {
              frame.src = frame.getAttribute('data-src-base') + '?embed=1&theme=' + previewTheme + '&play=1';
            }
          });
        });
      }

      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add('visible');
              observer.unobserve(entry.target);
            }
          });
        }, { threshold: 0.08 });
        cards.forEach(function (card) { observer.observe(card); });
      } else {
        cards.forEach(function (card) { card.classList.add('visible'); });
      }
    })();
