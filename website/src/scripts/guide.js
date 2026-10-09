
    (function () {
      'use strict';
      var recipes = JSON.parse(document.getElementById('guide-data').textContent);
      var types = Array.from(new Set(recipes.map(function (recipe) { return recipe.type; })));
      var colors = { architecture:'var(--hue-cyan)', workflow:'var(--hue-emerald)', sequence:'var(--hue-violet)', dataflow:'var(--hue-amber)', lifecycle:'var(--hue-rose)', erd:'var(--hue-emerald)' };
      var language = ArchifySiteLanguage.read();
      var activeType = 'all';
      var lastRecipe = null;
      var copy = JSON.parse(document.getElementById('site-copy').textContent);
      var languageStateKey = 'archify-guide-language-state.v1';

      // A language navigation may carry one short-lived draft within this tab.
      // Consume before validating so a stale or unrelated visit cannot reuse it.
      function restoreLanguageState() {
        try {
          var raw = sessionStorage.getItem(languageStateKey);
          sessionStorage.removeItem(languageStateKey);
          var state = raw ? JSON.parse(raw) : null;
          if (!state || state.to !== window.location.href || !Number.isFinite(state.at) || Date.now() - state.at > 30000 || state.at > Date.now()) return;
          if (typeof state.scenario === 'string' && state.scenario.length <= 65536) document.getElementById('scenario').value = state.scenario;
          if (state.activeType === 'all' || types.indexOf(state.activeType) >= 0) activeType = state.activeType;
          lastRecipe = recipes.find(function (recipe) { return recipe.id === state.recipe; }) || null;
        } catch (_) {}
      }
      function saveLanguageState(event) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        try {
          var scenario = document.getElementById('scenario').value;
          if (scenario.length > 65536) return;
          var destination = new URL(document.getElementById('language').href);
          var current = new URL(window.location.href);
          current.searchParams.delete('lang');
          destination.search = current.search;
          destination.hash = current.hash;
          sessionStorage.setItem(languageStateKey, JSON.stringify({
            to: destination.href, at: Date.now(), scenario: scenario,
            activeType: activeType, recipe: lastRecipe ? lastRecipe.id : null,
          }));
        } catch (_) {}
      }

      function t(key) { return copy[language][key]; }
      function local(recipe) { return Object.assign({}, recipe, recipe[language]); }
      function normalize(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s_]+/g,' ').trim(); }
      function rank(query) {
        var text = normalize(query);
        return recipes.map(function (recipe,index) {
          var score = 0, matched = [];
          if (text === recipe.id || text === recipe.id.replace(/-/g,' ')) { score = 100; matched = [recipe.id]; }
          else recipe.signals.forEach(function (signal) { if (text.includes(normalize(signal[0]))) { score += signal[1]; matched.push(signal[0]); } });
          return { recipe:recipe, score:score, matched:matched, index:index };
        }).sort(function (a,b) { return b.score - a.score || a.index - b.index; });
      }
      function recommendation(query) {
        var ranked = rank(query), winner = ranked[0].score > 0 ? ranked[0] : { recipe:recipes[0], score:0, matched:[] };
        return { recipe:winner.recipe, confidence:winner.score >= 14 ? 'high' : winner.score >= 7 ? 'medium' : 'low', alternatives:ranked.filter(function (entry) { return entry.recipe.id !== winner.recipe.id && entry.score > 0; }).slice(0,2) };
      }
      function escapeHtml(value) { var node = document.createElement('span'); node.textContent = String(value); return node.innerHTML; }
      function renderSamples() {
        document.getElementById('samples').innerHTML = t('samples').map(function (sample) { return '<button class="chip" type="button" data-query="'+escapeHtml(sample[1])+'">'+escapeHtml(sample[0])+'</button>'; }).join('');
      }
      function renderFilters() {
        var labels = {"en":{"architecture":"Architecture","workflow":"Workflow","sequence":"Sequence","dataflow":"Data flow","lifecycle":"Lifecycle","erd":"Entity-relationship"},"zh":{"architecture":"架构图","workflow":"工作流","sequence":"时序图","dataflow":"数据流","lifecycle":"生命周期","erd":"实体关系图"}};
        document.getElementById('filters').innerHTML = ['all'].concat(types).map(function (type) { return '<button class="filter '+(activeType === type ? 'active':'')+'" type="button" data-filter="'+type+'">'+escapeHtml(type === 'all' ? t('all') : labels[language][type])+'</button>'; }).join('');
      }
      function renderCards() {
        var visible = recipes.filter(function (recipe) { return activeType === 'all' || recipe.type === activeType; });
        document.getElementById('cards').innerHTML = visible.map(function (raw) {
          var recipe = local(raw);
          return '<button class="card" type="button" data-recipe="'+recipe.id+'" style="--type-color:'+colors[recipe.type]+'"><span class="card-type">'+escapeHtml(recipe.type)+'</span><h3>'+escapeHtml(recipe.title)+'</h3><p class="card-question">'+escapeHtml(recipe.question)+'</p><p class="card-summary">'+escapeHtml(recipe.summary)+'</p><span class="card-foot"><span>'+escapeHtml(recipe.presentation.preset)+' · '+escapeHtml(recipe.presentation.motion)+'</span><span>'+escapeHtml(recipe.proof ? t('proofReady') : t('open'))+' ↗</span></span></button>';
        }).join('');
      }
      function renderResult(rawRecipe, confidence, alternatives) {
        var recipe = local(rawRecipe);
        lastRecipe = rawRecipe;
        var alt = alternatives || [];
        var html = '<div class="result-main"><div><span class="result-kicker">'+escapeHtml(t('recommended'))+' · '+escapeHtml(confidence)+' '+escapeHtml(t('confidence'))+'</span><h3>'+escapeHtml(recipe.title)+'</h3><p class="result-question">'+escapeHtml(recipe.question)+'</p><p class="result-summary">'+escapeHtml(recipe.summary)+'</p>'+(recipe.proof ? '<a class="proof-link" href="'+ArchifySiteLanguage.page('gallery', '#proof-'+encodeURIComponent(recipe.proof))+'">'+escapeHtml(t('proofLink'))+'</a>' : '')+'</div><div class="boundary"><div class="boundary-item"><small>'+escapeHtml(t('use'))+'</small><p>'+escapeHtml(recipe.useWhen)+'</p></div><div class="boundary-item avoid"><small>'+escapeHtml(t('avoid'))+'</small><p>'+escapeHtml(recipe.avoidWhen)+'</p></div></div></div>';
        html += '<div class="result-grid"><div class="checklist"><div class="mini-heading">'+escapeHtml(t('must'))+'</div><ul>'+recipe.include.map(function (item) { return '<li>'+escapeHtml(item)+'</li>'; }).join('')+'</ul><div class="presentation"><span class="tag">'+escapeHtml(recipe.type)+'</span><span class="tag">'+escapeHtml(recipe.presentation.preset)+'</span><span class="tag">'+escapeHtml(recipe.presentation.motion)+'</span></div></div>';
        html += '<div class="prompt-box"><div class="prompt-bar"><div class="mini-heading" style="margin:0">'+escapeHtml(t('prompt'))+'</div><button class="copy" id="copy-prompt" type="button">'+escapeHtml(t('copyPrompt'))+'</button></div><p class="prompt-text">'+escapeHtml(recipe.prompt)+'</p></div></div>';
        if (alt.length) html += '<div class="alternatives">'+escapeHtml(t('alternatives'))+alt.map(function (entry) { var item=local(entry.recipe); return '<button type="button" data-alt="'+item.id+'">'+escapeHtml(item.title)+' ['+item.type+']</button>'; }).join('')+'</div>';
        var result = document.getElementById('result');
        result.innerHTML = html;
        result.classList.add('visible');
      }
      function runRecommendation() {
        var query = document.getElementById('scenario').value.trim();
        if (!query) { document.getElementById('scenario').focus(); return; }
        var picked = recommendation(query);
        renderResult(picked.recipe,picked.confidence,picked.alternatives);
      }
      function applyLanguage(next) {
        language = ArchifySiteLanguage.write(next);
        document.documentElement.lang = language === 'zh' ? 'zh-Hans' : 'en';
        document.getElementById('language').textContent = language === 'zh' ? 'EN' : '中文';
        document.getElementById('language').setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换到中文');
        document.querySelectorAll('[data-en][data-zh]').forEach(function (node) { node.textContent=node.getAttribute(language === 'zh' ? 'data-zh' : 'data-en'); });
        document.querySelectorAll('[data-i18n]').forEach(function (node) { node.textContent=t(node.dataset.i18n); });
        document.querySelectorAll('[data-i18n-html]').forEach(function (node) { node.innerHTML=t(node.dataset.i18nHtml); });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(function (node) { node.placeholder=t(node.dataset.i18nPlaceholder); });
        renderSamples(); renderFilters(); renderCards();
        if (lastRecipe) renderResult(lastRecipe,'selected',[]);
      }
      async function copyPrompt() {
        if (!lastRecipe) return;
        var text = local(lastRecipe).prompt, button = document.getElementById('copy-prompt');
        try { await navigator.clipboard.writeText(text); } catch (_) {
          var area=document.createElement('textarea'); area.value=text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove();
        }
        button.textContent=t('copied'); setTimeout(function () { if (button.isConnected) button.textContent=t('copyPrompt'); },1200);
      }
      document.getElementById('recommend').addEventListener('click',runRecommendation);
      document.getElementById('clear').addEventListener('click',function () { document.getElementById('scenario').value=''; document.getElementById('result').classList.remove('visible'); lastRecipe=null; });
      document.getElementById('scenario').addEventListener('keydown',function (event) { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') runRecommendation(); });
      document.getElementById('samples').addEventListener('click',function (event) { var chip=event.target.closest('[data-query]'); if (!chip) return; document.getElementById('scenario').value=chip.dataset.query; runRecommendation(); });
      document.getElementById('filters').addEventListener('click',function (event) { var filter=event.target.closest('[data-filter]'); if (!filter) return; activeType=filter.dataset.filter; renderFilters(); renderCards(); });
      document.getElementById('cards').addEventListener('click',function (event) { var card=event.target.closest('[data-recipe]'); if (!card) return; var recipe=recipes.find(function (item) { return item.id === card.dataset.recipe; }); renderResult(recipe,'selected',[]); document.getElementById('result').scrollIntoView({behavior:'smooth',block:'center'}); });
      document.getElementById('result').addEventListener('click',function (event) { if (event.target.id === 'copy-prompt') copyPrompt(); var alt=event.target.closest('[data-alt]'); if (alt) renderResult(recipes.find(function (item) { return item.id === alt.dataset.alt; }),'selected',[]); });
      document.getElementById('language').addEventListener('click', saveLanguageState);
      restoreLanguageState();
      applyLanguage(language);
    }());
