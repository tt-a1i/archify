
    (function () {
      'use strict';
      var recipes = JSON.parse(document.getElementById('guide-data').textContent);
      var types = ["architecture","workflow","sequence","dataflow","lifecycle"];
      var colors = { architecture:'#0891b2', workflow:'#047857', sequence:'#6d28d9', dataflow:'#b45309', lifecycle:'#be123c' };
      var language = ArchifySiteLanguage.read();
      var activeType = 'all';
      var lastRecipe = null;
      var copy = {
        en: {
          navGuide:'Guide',navProof:'Proof Lab',navStart:'Start',navInstall:'Install Skill',versionLabel:'Scenario guide / development / v[[ARCHIFY_VERSION]]',eyebrow:'Question-first diagramming', headline:'Choose the question.<br>Get the <em>right diagram.</em>', lede:'Describe what your audience needs to understand. Get one bounded recipe — evidence, anti-patterns, a copy-ready prompt.',
          metricRecipes:'real-world<br>recipes',metricModes:'typed diagram<br>modes',metricRuntime:'runtime<br>dependencies',chooserTitle:'What must the diagram explain?',chooserBody:'Write a situation, not a diagram type.',placeholder:'Example: Show an API request with JWT auth, a Redis cache miss, database fallback, and async tracing.',recommend:'Recommend a recipe →',clear:'Clear',libraryEyebrow:'Recipe library',libraryTitle:'Eleven small, opinionated starting points.',libraryBody:'Each recipe answers one question — bounded, legible, honest about missing evidence.',footerLeft:'Generated from the same recipe source as the Archify CLI.',all:'All recipes',recommended:'Recommended recipe',use:'Use when',avoid:'Avoid when',must:'Evidence to include',presentation:'Presentation',prompt:'Copy-ready prompt',copyPrompt:'Copy prompt',copied:'Copied',alternatives:'Other possible fits:',confidence:'confidence',open:'Open recipe',proofReady:'Verified proof',proofLink:'Open verified example ↗',
          samples:[['API + cache miss','Show an API request with JWT auth, a Redis cache miss, database fallback, and async tracing.'],['Kafka + DLQ','Map Kafka topics, ordered processors, consumer groups, replay, state stores, and the dead-letter queue.'],['Incident response','Show how responders detect, triage, mitigate, escalate, communicate, and verify recovery.']]
        },
        zh: {
          navGuide:'场景指南',navProof:'验证作品集',navStart:'快速上手',navInstall:'安装技能',versionLabel:'场景指南 / 开发版 / v[[ARCHIFY_VERSION]]',eyebrow:'先问题，后图表',headline:'先选对问题，<br>再得到<em>对的图。</em>',lede:'描述受众需要理解的内容，得到一个有边界的配方——证据清单、禁用条件和可复制的提示词。',
          metricRecipes:'个真实场景<br>配方',metricModes:'种类型化<br>图表模式',metricRuntime:'个运行时<br>依赖',chooserTitle:'这张图必须解释什么？',chooserBody:'写清场景，不要只写图表类型。',placeholder:'例如：展示带 JWT 鉴权、Redis 缓存未命中、数据库回退和异步追踪的 API 请求。',recommend:'推荐配方 →',clear:'清空',libraryEyebrow:'配方库',libraryTitle:'十一个小而专的起点。',libraryBody:'每个配方只回答一个问题——有边界、易读、不掩盖证据缺口。',footerLeft:'网页与 Archify CLI 使用同一份配方数据生成。',all:'全部配方',recommended:'推荐配方',use:'适合',avoid:'不要这样用',must:'必须包含的证据',presentation:'表现建议',prompt:'可直接复制的提示词',copyPrompt:'复制提示词',copied:'已复制',alternatives:'其他可能：',confidence:'置信度',open:'打开配方',proofReady:'已验证成品',proofLink:'打开验证成品 ↗',
          samples:[['API + 缓存未命中','展示带 JWT 鉴权、Redis 缓存未命中、数据库回退和异步追踪的 API 请求。'],['Kafka + 死信','梳理 Kafka Topic、有序处理器、消费者组、重放、状态存储和死信队列。'],['事故处置','展示响应者如何发现、分诊、缓解、升级、沟通并验证恢复。']]
        }
      };

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
        var labels = {"en":{"architecture":"Architecture","workflow":"Workflow","sequence":"Sequence","dataflow":"Data flow","lifecycle":"Lifecycle"},"zh":{"architecture":"架构图","workflow":"工作流","sequence":"时序图","dataflow":"数据流","lifecycle":"生命周期"}};
        document.getElementById('filters').innerHTML = ['all'].concat(types).map(function (type) { return '<button class="filter '+(activeType === type ? 'active':'')+'" type="button" data-filter="'+type+'">'+escapeHtml(type === 'all' ? t('all') : labels[language][type])+'</button>'; }).join('');
      }
      function renderCards() {
        var visible = recipes.filter(function (recipe) { return activeType === 'all' || recipe.type === activeType; });
        document.getElementById('cards').innerHTML = visible.map(function (raw, index) {
          var recipe = local(raw);
          return '<button class="card spot" type="button" data-recipe="'+recipe.id+'" style="--type-color:'+colors[recipe.type]+';--i:'+index+'"><span class="card-type">'+escapeHtml(recipe.type)+'</span><h3>'+escapeHtml(recipe.title)+'</h3><p class="card-question">'+escapeHtml(recipe.question)+'</p><p class="card-summary">'+escapeHtml(recipe.summary)+'</p><span class="card-foot"><span>'+escapeHtml(recipe.presentation.preset)+' · '+escapeHtml(recipe.presentation.motion)+'</span><span>'+escapeHtml(recipe.proof ? t('proofReady') : t('open'))+' ↗</span></span></button>';
        }).join('');
      }
      function renderResult(rawRecipe, confidence, alternatives) {
        var recipe = local(rawRecipe);
        lastRecipe = rawRecipe;
        var alt = alternatives || [];
        var html = '<div class="result-main"><div><span class="result-kicker">'+escapeHtml(t('recommended'))+' · '+escapeHtml(confidence)+' '+escapeHtml(t('confidence'))+'</span><h3>'+escapeHtml(recipe.title)+'</h3><p class="result-question">'+escapeHtml(recipe.question)+'</p><p class="result-summary">'+escapeHtml(recipe.summary)+'</p>'+(recipe.proof ? '<a class="proof-link" href="gallery.html#proof-'+encodeURIComponent(recipe.proof)+'">'+escapeHtml(t('proofLink'))+'</a>' : '')+'</div><div class="boundary"><div class="boundary-item"><small>'+escapeHtml(t('use'))+'</small><p>'+escapeHtml(recipe.useWhen)+'</p></div><div class="boundary-item avoid"><small>'+escapeHtml(t('avoid'))+'</small><p>'+escapeHtml(recipe.avoidWhen)+'</p></div></div></div>';
        html += '<div class="result-grid"><div class="checklist"><div class="mini-heading">'+escapeHtml(t('must'))+'</div><ul>'+recipe.include.map(function (item) { return '<li>'+escapeHtml(item)+'</li>'; }).join('')+'</ul><div class="presentation"><span class="tag">'+escapeHtml(recipe.type)+'</span><span class="tag">'+escapeHtml(recipe.presentation.preset)+'</span><span class="tag">'+escapeHtml(recipe.presentation.motion)+'</span><span class="tag">views '+escapeHtml(recipe.presentation.views)+'</span></div></div>';
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
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
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
      document.getElementById('language').addEventListener('click',function () { applyLanguage(language === 'en' ? 'zh':'en'); });
      document.getElementById('scenario').addEventListener('keydown',function (event) { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') runRecommendation(); });
      document.getElementById('samples').addEventListener('click',function (event) { var chip=event.target.closest('[data-query]'); if (!chip) return; document.getElementById('scenario').value=chip.dataset.query; runRecommendation(); });
      document.getElementById('filters').addEventListener('click',function (event) { var filter=event.target.closest('[data-filter]'); if (!filter) return; activeType=filter.dataset.filter; renderFilters(); renderCards(); });
      document.getElementById('cards').addEventListener('click',function (event) { var card=event.target.closest('[data-recipe]'); if (!card) return; var recipe=recipes.find(function (item) { return item.id === card.dataset.recipe; }); renderResult(recipe,'selected',[]); document.getElementById('result').scrollIntoView({behavior:'smooth',block:'center'}); });
      document.getElementById('result').addEventListener('click',function (event) { if (event.target.id === 'copy-prompt') copyPrompt(); var alt=event.target.closest('[data-alt]'); if (alt) renderResult(recipes.find(function (item) { return item.id === alt.dataset.alt; }),'selected',[]); });
      applyLanguage(language);
    }());
