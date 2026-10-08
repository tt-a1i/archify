
    (function () {
      var cards = Array.prototype.slice.call(document.querySelectorAll('.package-card'));
      var filterButtons = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
      var empty = document.getElementById('empty-state');
      var language = ArchifySiteLanguage.read();

      function applyLanguage(next) {
        language = ArchifySiteLanguage.write(next);
        document.documentElement.lang = language === 'zh' ? 'zh-Hans' : 'en';
        document.querySelectorAll('[data-en][data-zh]').forEach(function (node) {
          var text = node.getAttribute(language === 'zh' ? 'data-zh' : 'data-en');
          // Only fixed page copy opts into markup. Registry strings are text.
          if (node.hasAttribute('data-translation-html')) node.innerHTML = text;
          else node.textContent = text;
        });
        var languageButton = document.getElementById('language');
        languageButton.textContent = language === 'zh' ? 'EN' : '中文';
        languageButton.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换到中文');
      }

      function applyFilter(type, updateUrl) {
        var visible = 0;
        cards.forEach(function (card) {
          var match = type === 'all' || card.getAttribute('data-type') === type;
          card.hidden = !match;
          if (match) visible += 1;
        });
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

      filterButtons.forEach(function (button) {
        button.addEventListener('click', function () { applyFilter(button.getAttribute('data-filter'), true); });
      });

      var allowed = ['all'].concat(Array.prototype.slice.call(document.querySelectorAll('[data-filter]')).map(function (button) {
        return button.getAttribute('data-filter');
      }).filter(function (type) { return type !== 'all'; }));
      var requested = new URLSearchParams(location.search).get('type') || 'all';
      applyFilter(allowed.indexOf(requested) >= 0 ? requested : 'all', false);
      applyLanguage(language);

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
