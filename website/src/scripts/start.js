
    (function () {
      'use strict';

      var DATA = JSON.parse(document.getElementById('start-data').textContent);
      var KNOWN_TYPES = new Set(Object.keys(DATA));
      var KNOWN_AGENTS = new Set(['cursor', 'codex', 'claude-code', 'opencode', 'github-copilot']);
      var KNOWN_INPUTS = new Set(['description', 'repository']);
      var KNOWN_SOURCES = new Set(['artifact', 'gallery', 'readme', 'direct']);
      var EVENT_KEY = 'archify.start.events.v1';
      var params = new URLSearchParams(window.location.search);
      var requestedType = params.get('type');
      var requestedAgent = params.get('agent');
      var requestedSource = params.get('source');
      var requestedInput = params.get('input');
      var type = KNOWN_TYPES.has(requestedType) ? requestedType : 'architecture';
      var agent = KNOWN_AGENTS.has(requestedAgent) ? requestedAgent : 'codex';
      var source = KNOWN_SOURCES.has(requestedSource) ? requestedSource : 'direct';
      var input = KNOWN_INPUTS.has(requestedInput) ? requestedInput : 'description';
      var language = ArchifySiteLanguage.read();

      var title = document.getElementById('recipe-title');
      var question = document.getElementById('recipe-question');
      var prompt = document.getElementById('recipe-prompt');
      var includeList = document.getElementById('include-list');
      var proofLink = document.getElementById('proof-link');
      var proofMeta = document.getElementById('proof-meta');
      var copyReceipts = new Map();
      var languageButton = document.getElementById('language');
      var agentState = document.getElementById('agent-state');
      var installCommand = document.getElementById('install-command');
      var projectCommand = document.getElementById('project-command');

      function copyForElement(element) {
        return language === 'zh' ? element.dataset.zh : element.dataset.en;
      }

      function updateStaticCopy() {
        document.documentElement.lang = language === 'zh' ? 'zh-Hans' : 'en';
        document.querySelectorAll('[data-en][data-zh]').forEach(function (element) {
          element.textContent = copyForElement(element);
        });
        languageButton.textContent = language === 'zh' ? 'EN' : '中文';
        languageButton.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换到中文');
      }

      function updateUrl() {
        var next = new URL(window.location.href);
        next.searchParams.set('type', type);
        next.searchParams.set('agent', agent);
        next.searchParams.delete('lang');
        next.searchParams.set('source', source);
        next.searchParams.set('input', input);
        history.replaceState(null, '', next.pathname + next.search + next.hash);
      }

      function recordStep(step) {
        var detail = {
          schemaVersion: 1,
          step: step,
          source: source,
          type: type,
          agent: agent,
          language: language
        };
        try {
          var events = JSON.parse(sessionStorage.getItem(EVENT_KEY) || '[]');
          if (!Array.isArray(events)) events = [];
          events.push(detail);
          sessionStorage.setItem(EVENT_KEY, JSON.stringify(events.slice(-24)));
        } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('archify:start-funnel', { detail: detail })); } catch (_) {}
      }

      window.ArchifyStartMetrics = {
        snapshot: function () {
          try {
            var events = JSON.parse(sessionStorage.getItem(EVENT_KEY) || '[]');
            return Array.isArray(events) ? events.slice() : [];
          } catch (_) { return []; }
        }
      };

      function currentPrompt() {
        return input === 'description'
          ? DATA[type][language].descriptionPrompt
          : DATA[type][language].repositoryPrompt;
      }

      var copyAttempt = 0;
      function render() {
        copyAttempt++;
        language = ArchifySiteLanguage.write(language);
        var recipe = DATA[type];
        var copy = recipe[language];
        updateStaticCopy();
        document.querySelectorAll('[data-type]').forEach(function (button) {
          var active = button.dataset.type === type;
          button.setAttribute('aria-selected', String(active));
          button.tabIndex = active ? 0 : -1;
        });
        document.querySelectorAll('[data-agent]').forEach(function (button) {
          var active = button.dataset.agent === agent;
          button.setAttribute('aria-selected', String(active));
          button.tabIndex = active ? 0 : -1;
        });
        document.querySelectorAll('[data-input]').forEach(function (button) {
          var active = button.dataset.input === input;
          button.setAttribute('aria-selected', String(active));
          button.tabIndex = active ? 0 : -1;
        });
        var agentName = document.querySelector('[data-agent="' + agent + '"]').textContent;
        agentState.textContent = agentName + (language === 'zh' ? ' · 同一份 Skill' : ' · same Skill');
        installCommand.textContent = 'npx -y skills@latest add https://archify.si --skill archify --agent ' + agent + ' --global --copy --yes';
        projectCommand.textContent = 'npx -y skills@latest add https://archify.si --skill archify --agent ' + agent + ' --copy --yes';
        title.textContent = copy.title;
        question.textContent = copy.question;
        prompt.textContent = currentPrompt();
        includeList.replaceChildren.apply(includeList, copy.include.map(function (item) {
          var entry = document.createElement('li');
          entry.textContent = item;
          return entry;
        }));
        proofLink.href = ArchifySiteLanguage.page('gallery', '#proof-' + encodeURIComponent(recipe.proof));
        proofMeta.textContent = language === 'zh'
          ? '验证成品 · ' + recipe.presentation.preset + ' · ' + recipe.presentation.motion
          : 'Verified proof · ' + recipe.presentation.preset + ' · ' + recipe.presentation.motion;
        copyReceipts.forEach(function (receipt, status) {
          if (receipt.text !== textForStep(receipt.step)) {
            status.textContent = '';
            copyReceipts.delete(status);
          }
        });
        updateUrl();
      }

      function starterText() {
        var agentName = document.querySelector('[data-agent="' + agent + '"]').textContent;
        if (language === 'zh') {
          return '为 ' + agentName + ' 安装 Archify：\n' + document.getElementById('agent-install-prompt').textContent.trim()
            + (input === 'description' ? '\n\n然后在任意新对话中直接告诉 ' : '\n\n然后在目标仓库中让 ') + agentName + '：\n' + currentPrompt();
        }
        return 'Install Archify for ' + agentName + ':\n' + document.getElementById('agent-install-prompt').textContent.trim()
          + (input === 'description' ? '\n\nThen start any new chat and tell ' : '\n\nThen, in your target repository, ask ') + agentName + ':\n' + currentPrompt();
      }

      function textForStep(step) {
        if (step === 'agent_install_prompt_copy') return document.getElementById('agent-install-prompt').textContent.trim();
        if (step === 'global_install_copy') return installCommand.textContent.trim();
        if (step === 'project_install_copy') return projectCommand.textContent.trim();
        if (step === 'prompt_copy') return currentPrompt();
        return starterText();
      }

      async function copyText(step, statusId) {
        var text = textForStep(step);
        var copyStatus = document.getElementById(statusId);
        var attempt = ++copyAttempt;
        copyStatus.textContent = '';
        copyReceipts.delete(copyStatus);
        var isCurrent = function () { return attempt === copyAttempt; };
        var ok = await ArchifyClipboard.copy(text, isCurrent);
        if (!isCurrent()) return;
        copyReceipts.set(copyStatus, { text: text, step: step });
        if (ok && step) recordStep(step);
        copyStatus.textContent = ok
          ? (language === 'zh' ? '已复制到剪贴板。' : 'Copied to clipboard.')
          : (language === 'zh' ? '复制失败，请手动选择文本。' : 'Copy failed. Select the text manually.');
      }

      document.querySelectorAll('[data-type]').forEach(function (button) {
        button.addEventListener('click', function () {
          if (type === button.dataset.type) return;
          type = button.dataset.type;
          render();
        });
        button.addEventListener('keydown', function (event) {
          var buttons = Array.from(document.querySelectorAll('[data-type]'));
          var index = buttons.indexOf(button);
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % buttons.length;
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (index - 1 + buttons.length) % buttons.length;
          else if (event.key === 'Home') index = 0;
          else if (event.key === 'End') index = buttons.length - 1;
          else return;
          event.preventDefault();
          buttons[index].click();
          buttons[index].focus();
        });
      });

      document.querySelectorAll('[data-agent]').forEach(function (button) {
        button.addEventListener('click', function () {
          if (agent === button.dataset.agent) return;
          agent = button.dataset.agent;
          render();
        });
        button.addEventListener('keydown', function (event) {
          var buttons = Array.from(document.querySelectorAll('[data-agent]'));
          var index = buttons.indexOf(button);
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % buttons.length;
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (index - 1 + buttons.length) % buttons.length;
          else if (event.key === 'Home') index = 0;
          else if (event.key === 'End') index = buttons.length - 1;
          else return;
          event.preventDefault();
          buttons[index].click();
          buttons[index].focus();
        });
      });

      document.querySelectorAll('[data-input]').forEach(function (button) {
        button.addEventListener('click', function () {
          if (input === button.dataset.input) return;
          input = button.dataset.input;
          render();
        });
        button.addEventListener('keydown', function (event) {
          var buttons = Array.from(document.querySelectorAll('[data-input]'));
          var index = buttons.indexOf(button);
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % buttons.length;
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (index - 1 + buttons.length) % buttons.length;
          else if (event.key === 'Home') index = 0;
          else if (event.key === 'End') index = buttons.length - 1;
          else return;
          event.preventDefault();
          buttons[index].click();
          buttons[index].focus();
        });
      });

      document.querySelectorAll('[data-copy-source]').forEach(function (button) {
        button.addEventListener('click', function () {
          var step = {
            'install-command': 'global_install_copy',
            'project-command': 'project_install_copy',
            'agent-install-prompt': 'agent_install_prompt_copy'
          }[button.dataset.copySource];
          copyText(step, button.getAttribute('aria-describedby'));
        });
      });
      document.getElementById('copy-prompt').addEventListener('click', function () {
        copyText('prompt_copy', 'copy-status');
      });
      document.getElementById('copy-starter').addEventListener('click', function () {
        copyText('starter_copy', 'copy-status');
      });
      proofLink.addEventListener('click', function () { recordStep('proof_open'); });

      render();
      recordStep('start_view');
    })();
