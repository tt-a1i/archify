// Minimum number of progress point visits for a data point to be reliable.
// Matches ExperimentTargetDelta in profiler.h.
const MIN_DELTA = 5;
const _source_cache = {};
let _source_server_available = null;
// Track which plot name currently has source panel open (null = none)
let _source_open_name = null;
// AI optimization panel state
let _optimize_open_name = null;
const _optimize_cache = {};
let _optimize_server_available = null;
let _llm_config = null;
function getLLMSettings() {
    try {
        let match = document.cookie.match(/(?:^|;\s*)coz-llm=([^;]*)/);
        if (match)
            return JSON.parse(decodeURIComponent(match[1]));
    }
    catch (e) { }
    // Migrate from localStorage if present (one-time)
    try {
        let raw = localStorage.getItem('coz-llm-settings');
        if (raw) {
            let settings = JSON.parse(raw);
            document.cookie = 'coz-llm=' + encodeURIComponent(raw) + ';max-age=31536000;path=/;SameSite=Lax';
            localStorage.removeItem('coz-llm-settings');
            return settings;
        }
    }
    catch (e) { }
    return {};
}
function saveLLMSettings() {
    let s = getLLMSettings();
    let provider = getSelectedProvider();
    s.provider = provider;
    // Save API key per provider
    let apiKeyEl = document.getElementById('ai-api-key');
    if (provider === 'anthropic')
        s.anthropic_key = apiKeyEl ? apiKeyEl.value : '';
    else if (provider === 'openai')
        s.openai_key = apiKeyEl ? apiKeyEl.value : '';
    // Save model per provider
    if (!s.models)
        s.models = {};
    let model = getModelName();
    if (model)
        s.models[provider] = model;
    // Save Bedrock region only — AWS credentials come from env vars, session tokens are ephemeral
    let regionEl = document.getElementById('ai-bedrock-region');
    if (regionEl)
        s.bedrock_region = regionEl.value;
    // Clear any stale AWS credentials from saved settings
    delete s.aws_access_key;
    delete s.aws_secret_key;
    delete s.aws_session_token;
    // Save Ollama host
    s.ollama_host = getOllamaHost();
    document.cookie = 'coz-llm=' + encodeURIComponent(JSON.stringify(s)) + ';max-age=31536000;path=/;SameSite=Lax';
}
// Saved model selections to restore after async model fetches complete
let _saved_model_selections = {};
// ---- End settings persistence ----
// Probe whether the source-snippet endpoint exists
(function probeSourceServer() {
    let xhr = new XMLHttpRequest();
    xhr.open('GET', '/source-snippet?path=__probe__&line=1', true);
    xhr.onload = function () {
        _source_server_available = true;
    };
    xhr.onerror = function () {
        _source_server_available = false;
    };
    xhr.send();
})();
// Probe whether the optimize endpoint exists and fetch LLM config
(function probeLLMConfig() {
    let xhr = new XMLHttpRequest();
    xhr.open('GET', '/llm-config', true);
    xhr.onload = function () {
        if (xhr.status === 200) {
            _optimize_server_available = true;
            try {
                _llm_config = JSON.parse(xhr.responseText);
                updateProviderUI();
            }
            catch (e) {
                _llm_config = null;
            }
        }
        else {
            _optimize_server_available = false;
        }
    };
    xhr.onerror = function () {
        _optimize_server_available = false;
    };
    xhr.send();
})();
function getSelectedProvider() {
    let el = document.getElementById('ai-provider');
    return el ? el.value : 'anthropic';
}
function getApiKey() {
    let el = document.getElementById('ai-api-key');
    return el ? el.value : '';
}
function getModelName() {
    let el = document.getElementById('ai-model');
    return el ? el.value : '';
}
// Hardcoded fallback models (used when dynamic fetch fails or no API key)
const _fallback_models = {
    'anthropic': [
        { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
        { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
        { value: 'claude-haiku-4-20250514', label: 'Claude Haiku 4' },
    ],
    'openai': [
        { value: 'gpt-4o', label: 'gpt-4o' },
        { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
        { value: 'o3-mini', label: 'o3-mini' },
    ],
    'bedrock': [
        { value: 'anthropic.claude-opus-4-20250514-v1:0', label: 'Claude Opus 4' },
        { value: 'anthropic.claude-sonnet-4-20250514-v1:0', label: 'Claude Sonnet 4' },
        { value: 'anthropic.claude-haiku-4-20250514-v1:0', label: 'Claude Haiku 4' },
    ],
    'ollama': []
};
// Dynamically fetched models (populated after API calls)
const _provider_models = {
    'anthropic': [], 'openai': [], 'bedrock': [], 'ollama': []
};
// Cache flags — true means we've done a live fetch this session
let _ollama_models_fetched = false;
let _bedrock_models_fetched = false;
let _anthropic_models_fetched = false;
let _openai_models_fetched = false;
// localStorage helpers for model cache
function _getCachedModels(provider) {
    try {
        let raw = localStorage.getItem('coz-models-' + provider);
        if (raw)
            return JSON.parse(raw);
    }
    catch (e) { }
    return [];
}
function _setCachedModels(provider, models) {
    try {
        localStorage.setItem('coz-models-' + provider, JSON.stringify(models));
    }
    catch (e) { }
}
function populateModelDropdown() {
    let provider = getSelectedProvider();
    let modelEl = document.getElementById('ai-model');
    if (!modelEl)
        return;
    if (provider === 'anthropic') {
        fetchAnthropicModels(modelEl);
        return;
    }
    if (provider === 'openai') {
        fetchOpenAIModels(modelEl);
        return;
    }
    if (provider === 'bedrock') {
        fetchBedrockModels(modelEl);
        return;
    }
    if (provider === 'ollama') {
        fetchOllamaModels(modelEl);
        return;
    }
    _setModelOptions(modelEl, _fallback_models[provider] || []);
}
function _setModelOptions(el, models) {
    el.innerHTML = '';
    for (let i = 0; i < models.length; i++) {
        let opt = document.createElement('option');
        opt.value = models[i].value;
        opt.textContent = models[i].label;
        el.appendChild(opt);
    }
    // Restore saved model selection if available
    let provider = getSelectedProvider();
    let savedModel = _saved_model_selections[provider];
    if (savedModel) {
        for (let i = 0; i < models.length; i++) {
            if (models[i].value === savedModel) {
                el.value = savedModel;
                break;
            }
        }
    }
}
function _setFetchedFlag(provider, value) {
    if (provider === 'ollama')
        _ollama_models_fetched = value;
    else if (provider === 'bedrock')
        _bedrock_models_fetched = value;
    else if (provider === 'anthropic')
        _anthropic_models_fetched = value;
    else if (provider === 'openai')
        _openai_models_fetched = value;
}
function _getFetchedFlag(provider) {
    if (provider === 'ollama')
        return _ollama_models_fetched;
    if (provider === 'bedrock')
        return _bedrock_models_fetched;
    if (provider === 'anthropic')
        return _anthropic_models_fetched;
    if (provider === 'openai')
        return _openai_models_fetched;
    return false;
}
let _force_model_refresh = false;
function _fetchModels(provider, url, modelEl, fallback) {
    let isForced = _force_model_refresh;
    _force_model_refresh = false;
    // If we already fetched live this session and have in-memory models, just use them
    if (!isForced && _provider_models[provider].length > 0 && _getFetchedFlag(provider)) {
        _setModelOptions(modelEl, _provider_models[provider]);
        return;
    }
    if (isForced) {
        // Show loading state on manual refresh
        modelEl.innerHTML = '<option value="">Refreshing models...</option>';
    }
    else {
        // Show cached models instantly (localStorage or fallback) — no "Loading..." flash
        let cached = _getCachedModels(provider);
        if (cached.length > 0) {
            _provider_models[provider] = cached;
            _setModelOptions(modelEl, cached);
        }
        else if (fallback.length > 0) {
            _setModelOptions(modelEl, fallback);
        }
        else {
            modelEl.innerHTML = '<option value="">Loading models...</option>';
        }
    }
    // Fetch from server
    let xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = function () {
        if (getSelectedProvider() !== provider)
            return;
        if (xhr.status === 200) {
            try {
                let data = JSON.parse(xhr.responseText);
                let models = data.models || [];
                if (models.length > 0) {
                    _provider_models[provider] = models;
                    _setFetchedFlag(provider, true);
                    _setCachedModels(provider, models);
                    _setModelOptions(modelEl, models);
                    return;
                }
                // API returned 0 models — show error if present
                let error = data.error || 'No models returned';
                console.warn('[coz] ' + provider + ' models fetch: ' + error);
                if (isForced) {
                    modelEl.innerHTML = '<option value="">Error: ' + error.substring(0, 60) + '</option>';
                }
            }
            catch (e) {
                console.warn('[coz] ' + provider + ' models parse error:', e);
                if (isForced) {
                    modelEl.innerHTML = '<option value="">Error parsing response</option>';
                }
            }
        }
        else {
            console.warn('[coz] ' + provider + ' models HTTP ' + xhr.status);
            if (isForced) {
                modelEl.innerHTML = '<option value="">HTTP error ' + xhr.status + '</option>';
            }
        }
        _setFetchedFlag(provider, true);
        // On non-forced, fallback was already shown; on forced error, add fallbacks below
        if (isForced && fallback.length > 0) {
            for (let i = 0; i < fallback.length; i++) {
                let opt = document.createElement('option');
                opt.value = fallback[i].value;
                opt.textContent = fallback[i].label;
                modelEl.appendChild(opt);
            }
        }
    };
    xhr.onerror = function () {
        console.warn('[coz] ' + provider + ' models network error');
        if (getSelectedProvider() === provider && isForced) {
            modelEl.innerHTML = '<option value="">Network error</option>';
            for (let i = 0; i < fallback.length; i++) {
                let opt = document.createElement('option');
                opt.value = fallback[i].value;
                opt.textContent = fallback[i].label;
                modelEl.appendChild(opt);
            }
        }
        _setFetchedFlag(provider, true);
    };
    xhr.send();
}
function fetchAnthropicModels(modelEl) {
    // Check if there's a key available (form, saved, or env) — if not, skip fetch
    let key = getApiKey();
    if (!key && _llm_config)
        key = _llm_config.anthropic_key || '';
    if (!key) {
        _setModelOptions(modelEl, _fallback_models['anthropic']);
        return;
    }
    // Server uses its own env var; only pass key if user typed one not in env
    let envKey = _llm_config ? _llm_config.anthropic_key || '' : '';
    let url = (key && key !== envKey) ? '/anthropic-models?api_key=' + encodeURIComponent(key) : '/anthropic-models';
    _fetchModels('anthropic', url, modelEl, _fallback_models['anthropic']);
}
function fetchOpenAIModels(modelEl) {
    let key = getApiKey();
    if (!key && _llm_config)
        key = _llm_config.openai_key || '';
    if (!key) {
        _setModelOptions(modelEl, _fallback_models['openai']);
        return;
    }
    let envKey = _llm_config ? _llm_config.openai_key || '' : '';
    let url = (key && key !== envKey) ? '/openai-models?api_key=' + encodeURIComponent(key) : '/openai-models';
    _fetchModels('openai', url, modelEl, _fallback_models['openai']);
}
function fetchBedrockModels(modelEl) {
    // Only pass region — server uses its own AWS env credentials
    let regionEl = document.getElementById('ai-bedrock-region');
    let region = regionEl && regionEl.value ? regionEl.value : '';
    _fetchModels('bedrock', '/bedrock-models?region=' + encodeURIComponent(region), modelEl, _fallback_models['bedrock']);
}
function fetchOllamaModels(modelEl) {
    let host = getOllamaHost();
    _fetchModels('ollama', '/ollama-models?host=' + encodeURIComponent(host), modelEl, _fallback_models['ollama']);
}
function getOllamaHost() {
    let el = document.getElementById('ai-ollama-host');
    return el && el.value ? el.value : 'http://localhost:11434';
}
// Populate initial model dropdown (must be after _provider_models is defined)
populateModelDropdown();
function updateProviderUI() {
    if (!_llm_config)
        return;
    let providerEl = document.getElementById('ai-provider');
    let statusEl = document.getElementById('ai-key-status');
    if (!providerEl)
        return;
    // Load saved settings from cookie
    let saved = getLLMSettings();
    _saved_model_selections = saved.models || {};
    // Determine provider: saved > auto-detect from env > default
    if (saved.provider) {
        providerEl.value = saved.provider;
    }
    else if (_llm_config.anthropic_key_set) {
        providerEl.value = 'anthropic';
    }
    else if (_llm_config.openai_key_set) {
        providerEl.value = 'openai';
    }
    let provider = providerEl.value;
    // Pre-fill API key: saved > env var
    let apiKeyEl = document.getElementById('ai-api-key');
    if (apiKeyEl) {
        if (provider === 'anthropic') {
            apiKeyEl.value = saved.anthropic_key || _llm_config.anthropic_key || '';
        }
        else if (provider === 'openai') {
            apiKeyEl.value = saved.openai_key || _llm_config.openai_key || '';
        }
    }
    // Pre-fill AWS credential fields from env vars only (not saved — session tokens are ephemeral)
    let awsFields = [
        ['ai-aws-access-key', 'aws_access_key'],
        ['ai-aws-secret-key', 'aws_secret_key'],
        ['ai-aws-session-token', 'aws_session_token'],
    ];
    for (let i = 0; i < awsFields.length; i++) {
        let el = document.getElementById(awsFields[i][0]);
        if (el)
            el.value = _llm_config[awsFields[i][1]] || '';
    }
    // Pre-fill region: saved > env var
    let regionEl = document.getElementById('ai-bedrock-region');
    if (regionEl)
        regionEl.value = saved.bedrock_region || _llm_config.bedrock_region || '';
    // Pre-fill Ollama host: saved > env var
    let ollamaEl = document.getElementById('ai-ollama-host');
    if (ollamaEl && saved.ollama_host)
        ollamaEl.value = saved.ollama_host;
    // Update status
    if (statusEl) {
        let hasKey = (provider === 'anthropic' && (apiKeyEl && apiKeyEl.value || _llm_config.anthropic_key_set)) ||
            (provider === 'openai' && (apiKeyEl && apiKeyEl.value || _llm_config.openai_key_set));
        if (hasKey) {
            statusEl.textContent = '(configured)';
            statusEl.className = 'ai-status configured';
        }
    }
    toggleProviderFields();
}
function toggleProviderFields() {
    let provider = getSelectedProvider();
    let keyGroup = document.getElementById('ai-key-group');
    let ollamaGroup = document.getElementById('ai-ollama-group');
    let bedrockGroup = document.getElementById('ai-bedrock-group');
    let statusEl = document.getElementById('ai-key-status');
    let needsKey = (provider === 'anthropic' || provider === 'openai');
    if (keyGroup)
        keyGroup.style.display = needsKey ? 'flex' : 'none';
    if (ollamaGroup)
        ollamaGroup.style.display = provider === 'ollama' ? 'flex' : 'none';
    if (bedrockGroup)
        bedrockGroup.style.display = provider === 'bedrock' ? 'block' : 'none';
    // Set API key for current provider: saved > env var > clear
    if (needsKey) {
        let apiKeyEl = document.getElementById('ai-api-key');
        if (apiKeyEl) {
            let saved = getLLMSettings();
            if (provider === 'anthropic') {
                apiKeyEl.value = saved.anthropic_key || (_llm_config ? _llm_config.anthropic_key || '' : '');
            }
            else if (provider === 'openai') {
                apiKeyEl.value = saved.openai_key || (_llm_config ? _llm_config.openai_key || '' : '');
            }
        }
    }
    // Update status indicator
    if (statusEl) {
        let apiKeyEl = document.getElementById('ai-api-key');
        let hasKey = apiKeyEl && apiKeyEl.value;
        if (hasKey) {
            statusEl.textContent = '(configured)';
            statusEl.className = 'ai-status configured';
        }
        else if (needsKey) {
            statusEl.textContent = '';
            statusEl.className = 'ai-status';
        }
    }
    // Update Bedrock status
    let bedrockStatusEl = document.getElementById('ai-bedrock-status');
    if (bedrockStatusEl && _llm_config) {
        if (_llm_config.bedrock_available) {
            bedrockStatusEl.textContent = '(boto3 available)';
            bedrockStatusEl.className = 'ai-status configured';
        }
        else {
            bedrockStatusEl.textContent = '(boto3 not found)';
            bedrockStatusEl.className = 'ai-status';
        }
    }
    // Populate model dropdown for this provider
    populateModelDropdown();
}
function formatOptimizationText(text) {
    // Extract code blocks first (before markdown transforms corrupt them)
    let codeBlocks = [];
    text = text.replace(/```(\w*)\n([\s\S]*?)```/g, function (_match, _lang, code) {
        let trimmed = code.trim();
        let idx = codeBlocks.length;
        codeBlocks.push(trimmed);
        return '\x00CODEBLOCK' + idx + '\x00';
    });
    // Inline code — protect from further transforms
    let inlineCode = [];
    text = text.replace(/`([^`]+)`/g, function (_match, code) {
        let idx = inlineCode.length;
        inlineCode.push(code);
        return '\x00INLINE' + idx + '\x00';
    });
    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Headers
    text = text.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // List items
    text = text.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    text = text.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
    // Wrap consecutive <li> in <ul>
    text = text.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    // Paragraphs (double newlines)
    text = text.replace(/\n\n/g, '</p><p>');
    // Single newlines (not before/after block elements)
    text = text.replace(/\n/g, '<br>');
    // Restore inline code
    text = text.replace(/\x00INLINE(\d+)\x00/g, function (_m, idx) {
        return '<code>' + escapeHtml(inlineCode[parseInt(idx, 10)]) + '</code>';
    });
    // Restore code blocks with copy buttons
    text = text.replace(/\x00CODEBLOCK(\d+)\x00/g, function (_m, idx) {
        let raw = codeBlocks[parseInt(idx, 10)];
        let encoded = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        return '<div class="code-block-wrap">' +
            '<button class="code-copy-btn" data-code="' + encoded + '" title="Copy code"><i class="fa fa-copy"></i></button>' +
            '<pre class="optimize-code"><code>' + escapeHtml(raw) + '</code></pre>' +
            '</div>';
    });
    return '<p>' + text + '</p>';
}
// Event delegation for code block copy buttons
document.addEventListener('click', function (e) {
    let target = e.target;
    // Walk up to find the button (in case the <i> icon was clicked)
    let btn = target.closest('.code-copy-btn');
    if (!btn)
        return;
    let code = btn.getAttribute('data-code');
    if (!code)
        return;
    // Decode HTML entities back to raw text
    let textarea = document.createElement('textarea');
    textarea.innerHTML = code;
    let rawCode = textarea.value;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(rawCode).then(function () {
            btn.innerHTML = '<i class="fa fa-check"></i>';
            setTimeout(function () {
                btn.innerHTML = '<i class="fa fa-copy"></i>';
            }, 2000);
        });
    }
});
// Expected response length for progress estimation (chars)
const EXPECTED_RESPONSE_LENGTH = 2500;
function fetchOptimizationStream(name, measurements, callbacks) {
    let cacheKey = name + '::' + getSelectedProvider();
    if (cacheKey in _optimize_cache) {
        callbacks.onDone(_optimize_cache[cacheKey]);
        return { abort: function () { } };
    }
    let match = name.match(/^(.+):(\d+)$/);
    if (!match) {
        callbacks.onError('Could not parse file:line from plot name');
        return { abort: function () { } };
    }
    let filePath = match[1];
    let line = parseInt(match[2], 10);
    let speedupData = measurements.map(function (m) {
        return { speedup: m.speedup, progress_speedup: m.progress_speedup };
    });
    let bedrockRegionEl = document.getElementById('ai-bedrock-region');
    let bedrockRegion = bedrockRegionEl && bedrockRegionEl.value ? bedrockRegionEl.value : '';
    let awsAccessKeyEl = document.getElementById('ai-aws-access-key');
    let awsSecretKeyEl = document.getElementById('ai-aws-secret-key');
    let awsSessionTokenEl = document.getElementById('ai-aws-session-token');
    let bodyStr = JSON.stringify({
        path: filePath,
        line: line,
        speedup_data: speedupData,
        provider: getSelectedProvider(),
        api_key: getApiKey(),
        model: getModelName(),
        ollama_host: getOllamaHost(),
        bedrock_region: bedrockRegion,
        aws_access_key: awsAccessKeyEl ? awsAccessKeyEl.value : '',
        aws_secret_key: awsSecretKeyEl ? awsSecretKeyEl.value : '',
        aws_session_token: awsSessionTokenEl ? awsSessionTokenEl.value : ''
    });
    let abortController = new AbortController();
    let fullText = '';
    fetch('/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        signal: abortController.signal
    }).then(function (response) {
        if (!response.ok) {
            callbacks.onError('Server error: ' + response.status);
            return;
        }
        let reader = response.body.getReader();
        let decoder = new TextDecoder();
        let buffer = '';
        function readChunk() {
            reader.read().then(function (result) {
                if (result.done) {
                    // Process any remaining buffer
                    if (buffer.trim()) {
                        processLines(buffer);
                    }
                    if (fullText) {
                        _optimize_cache[cacheKey] = fullText;
                        callbacks.onDone(fullText);
                    }
                    return;
                }
                buffer += decoder.decode(result.value, { stream: true });
                processLines(buffer);
                // Keep only unprocessed remainder
                let lastNewline = buffer.lastIndexOf('\n');
                if (lastNewline >= 0) {
                    buffer = buffer.substring(lastNewline + 1);
                }
                readChunk();
            }).catch(function (err) {
                if (err.name !== 'AbortError') {
                    callbacks.onError(err.message || 'Stream read error');
                }
            });
        }
        function processLines(text) {
            let lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (!line)
                    continue;
                try {
                    let data = JSON.parse(line);
                    if (data.chunk) {
                        fullText += data.chunk;
                        callbacks.onChunk(fullText, data.chunk);
                    }
                    else if (data.error) {
                        callbacks.onError(data.error);
                    }
                    else if (data.done) {
                        _optimize_cache[cacheKey] = fullText;
                        callbacks.onDone(fullText);
                    }
                }
                catch (e) {
                    // Not valid JSON yet, may be partial line
                }
            }
        }
        readChunk();
    }).catch(function (err) {
        if (err.name !== 'AbortError') {
            callbacks.onError(err.message || 'Network error');
        }
    });
    return { abort: function () { abortController.abort(); } };
}
function fetchSourceSnippet(name, callback) {
    if (name in _source_cache) {
        callback(_source_cache[name]);
        return;
    }
    // Parse "file:line" from name
    let match = name.match(/^(.+):(\d+)$/);
    if (!match) {
        _source_cache[name] = null;
        callback(null);
        return;
    }
    let filePath = match[1];
    let line = match[2];
    let xhr = new XMLHttpRequest();
    xhr.open('GET', '/source-snippet?path=' + encodeURIComponent(filePath) + '&line=' + encodeURIComponent(line), true);
    xhr.onload = function () {
        if (xhr.status === 200) {
            let data = JSON.parse(xhr.responseText);
            _source_cache[name] = data;
            callback(data);
        }
        else {
            _source_cache[name] = null;
            callback(null);
        }
    };
    xhr.onerror = function () {
        _source_cache[name] = null;
        callback(null);
    };
    xhr.send();
}
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function highlightSyntax(text) {
    // Tokenize the raw text in a single pass, then escape and wrap each token
    let keywords = /^(if|else|for|while|do|switch|case|break|continue|return|goto|sizeof|typedef|struct|union|enum|class|namespace|template|typename|public|private|protected|virtual|override|const|static|extern|volatile|inline|void|auto|register|unsigned|signed|restrict|nullptr|NULL|true|false|new|delete|throw|try|catch|using)$/;
    let types = /^(int|char|float|double|long|short|bool|size_t|ssize_t|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|FILE|pthread_t|pthread_mutex_t|pthread_cond_t)$/;
    // Single-pass tokenizer regex
    let tokenRe = /(\/\/.*$)|(#\w+)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(\b\d+\.?\d*[fFlLuU]*\b)|(\b[a-zA-Z_]\w*\b)|(\+\=|-\=|\*\=|\/\=|%\=|&\=|\|\=|\^=|==|!=|<=|>=|<<|>>|->)|([^a-zA-Z0-9_\s"'#\/]+|\s+|.)/g;
    let result = '';
    let m;
    while ((m = tokenRe.exec(text)) !== null) {
        let tok = m[0];
        let esc = escapeHtml(tok);
        if (m[1]) { // comment
            result += '<span class="syn-comment">' + esc + '</span>';
        }
        else if (m[2]) { // preprocessor
            result += '<span class="syn-preprocessor">' + esc + '</span>';
        }
        else if (m[3] || m[4]) { // string or char literal
            result += '<span class="syn-string">' + esc + '</span>';
        }
        else if (m[5]) { // number
            result += '<span class="syn-number">' + esc + '</span>';
        }
        else if (m[6]) { // identifier — check if keyword or type
            if (keywords.test(tok)) {
                result += '<span class="syn-keyword">' + esc + '</span>';
            }
            else if (types.test(tok)) {
                result += '<span class="syn-type">' + esc + '</span>';
            }
            else {
                result += esc;
            }
        }
        else if (m[7]) { // operator
            result += '<span class="syn-operator">' + esc + '</span>';
        }
        else {
            result += esc;
        }
    }
    return result;
}
/**
 * Returns if this data point is valid.
 * Infinity / -Infinity occurs when dividing by 0.
 * NaN happens when the data is messed up and we get a NaN into a computation somewhere.
 */
function isValidDataPoint(data) {
    return !isNaN(data) && data !== Infinity && data !== -Infinity;
}
/**
 * Returns true if this experiment data has enough observations to be reliable.
 */
function hasEnoughData(data) {
    if (data.type === 'throughput') {
        return data.delta >= MIN_DELTA;
    }
    // For latency, require minimum arrivals
    return data.arrivals >= MIN_DELTA;
}
/**
 * Get the applicable data point from this particular experiment.
 * Returns -Infinity or Infinity in undefined cases.
 */
function getDataPoint(data) {
    // Discard obviously incorrect data points.
    if (data.duration < 0) {
        return NaN;
    }
    switch (data.type) {
        case 'throughput':
            return data.duration / data.delta;
        case 'latency':
            const arrivalRate = data.arrivals / data.duration;
            // Average latency, according to Little's Law.
            return data.difference / arrivalRate;
    }
}
/**
 * Are we trying to maximize or minimize this progress point?
 */
function shouldMaximize(data) {
    switch (data.type) {
        case 'latency':
            return false;
        case 'throughput':
            return true;
    }
}
function parseLine(s) {
    if (s[0] == '{') {
        return JSON.parse(s);
    }
    else {
        let parts = s.split('\t');
        let obj = { type: parts[0] };
        for (let i = 0; i < parts.length; i++) {
            const equals_index = parts[i].indexOf('=');
            if (equals_index === -1)
                continue;
            let key = parts[i].substring(0, equals_index);
            let value = parts[i].substring(equals_index + 1);
            switch (key) {
                case 'type':
                    if (obj.type === 'progress-point') {
                        key = 'point-type';
                    }
                    break;
                case 'delta':
                case 'time':
                case 'duration':
                case 'arrivals':
                case 'departures':
                case 'difference':
                    value = parseInt(value, 10);
                    break;
                case 'speedup':
                    value = parseFloat(value);
                    break;
            }
            obj[key] = value;
        }
        return obj;
    }
}
function max_normalized_area(d) {
    let max_normalized_area = 0;
    for (let i = 0; i < d.progress_points.length; i++) {
        let area = 0;
        for (let j = 1; j < d.progress_points[i].measurements.length; j++) {
            let prev_data = d.progress_points[i].measurements[j - 1];
            let current_data = d.progress_points[i].measurements[j];
            let avg_progress_speedup = (prev_data.progress_speedup + current_data.progress_speedup) / 2;
            area += avg_progress_speedup * (current_data.speedup - prev_data.speedup);
            let normalized_area = area / current_data.speedup;
            if (normalized_area > max_normalized_area)
                max_normalized_area = normalized_area;
        }
    }
    return max_normalized_area;
}
function max_progress_speedup(d) {
    let max_progress_speedup = 0;
    for (let i in d.progress_points) {
        for (let j in d.progress_points[i].measurements) {
            let progress_speedup = d.progress_points[i].measurements[j].progress_speedup;
            if (progress_speedup > max_progress_speedup)
                max_progress_speedup = progress_speedup;
        }
    }
    return max_progress_speedup;
}
function min_progress_speedup(d) {
    let min_progress_speedup = 0;
    for (let i in d.progress_points) {
        for (let j in d.progress_points[i].measurements) {
            let progress_speedup = d.progress_points[i].measurements[j].progress_speedup;
            if (progress_speedup < min_progress_speedup)
                min_progress_speedup = progress_speedup;
        }
    }
    return min_progress_speedup;
}
const sort_functions = {
    alphabetical: function (a, b) {
        if (a.name > b.name)
            return 1;
        else
            return -1;
    },
    impact: function (a, b) {
        if (max_normalized_area(b) > max_normalized_area(a))
            return 1;
        else
            return -1;
    },
    max_speedup: function (a, b) {
        if (max_progress_speedup(b) > max_progress_speedup(a))
            return 1;
        else
            return -1;
    },
    min_speedup: function (a, b) {
        if (min_progress_speedup(a) > min_progress_speedup(b))
            return 1;
        else
            return -1;
    }
};
class Profile {
    constructor(profile_text, container, legend, get_min_points, display_warning) {
        this._data = {};
        this._disabled_progress_points = [];
        this._progress_points = null;
        this._plot_container = container;
        this._plot_legend = legend;
        this._get_min_points = get_min_points;
        this._display_warning = display_warning;
        let lines = profile_text.split('\n');
        let experiment = null;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].length == 0)
                continue;
            let entry = parseLine(lines[i]);
            if (entry.type === 'startup') {
                // Do nothing
            }
            else if (entry.type === 'shutdown') {
                // Do nothing
            }
            else if (entry.type === 'samples') {
                // Do nothing
            }
            else if (entry.type === 'runtime') {
                // Do nothing
            }
            else if (entry.type === 'experiment') {
                // Skip experiments targeting coz.h instrumentation overhead
                if (entry.selected && entry.selected.indexOf('/coz.h:') !== -1) {
                    experiment = null;
                }
                else {
                    experiment = entry;
                }
            }
            else if (entry.type === 'throughput-point' || entry.type === 'throughput_point' || entry.type === 'progress-point') {
                if (experiment !== null) {
                    this.addThroughputMeasurement(experiment, entry);
                }
            }
            else if (entry.type === 'latency-point' || entry.type === 'latency_point') {
                if (experiment !== null) {
                    this.addLatencyMeasurement(experiment, entry);
                }
            }
            else {
                display_warning('Invalid Profile', 'The profile you loaded contains an invalid line: <pre>' + lines[i] + '</pre>');
            }
        }
        if (experiment == null) {
            display_warning('Empty Profile', 'The profile you loaded does not contain result from any performance experiments. Make sure you specified a progress point, built your program with debug information, and ran your program on an input that took at least a few seconds.');
        }
    }
    ensureDataEntry(selected, point, speedup, initial_value) {
        if (!this._data[selected])
            this._data[selected] = {};
        if (!this._data[selected][point])
            this._data[selected][point] = {};
        if (!this._data[selected][point][speedup])
            this._data[selected][point][speedup] = initial_value;
        return this._data[selected][point][speedup];
    }
    addThroughputMeasurement(experiment, point) {
        let entry = this.ensureDataEntry(experiment.selected, point.name, experiment.speedup, {
            delta: 0,
            duration: 0,
            type: 'throughput'
        });
        // Add new delta and duration to data
        entry.delta += point.delta;
        entry.duration += experiment.duration;
    }
    addLatencyMeasurement(experiment, point) {
        let entry = this.ensureDataEntry(experiment.selected, point.name, experiment.speedup, {
            arrivals: 0,
            departures: 0,
            difference: 0,
            duration: 0,
            type: 'latency'
        });
        entry.arrivals += point.arrivals;
        entry.departures += point.departures;
        // Compute a running weighted average of the difference between arrivals and departures
        if (entry.duration === 0) {
            entry.difference = point.difference;
        }
        else {
            // Compute the new total duration of all experiments combined (including the new one)
            let total_duration = entry.duration + experiment.duration;
            // Scale the difference down by the ratio of the prior and total durations. This scale factor will be closer to 1 than 0, so divide first for better numerical stability
            entry.difference *= entry.duration / total_duration;
            // Add the contribution to average difference from the current experiment. The scale factor will be close to zero, so multiply first for better numerical stability.
            entry.difference += (point.difference * experiment.duration) / total_duration;
        }
        // Update the total duration
        entry.duration += experiment.duration;
    }
    getProgressPoints() {
        if (this._progress_points) {
            return this._progress_points;
        }
        let points = [];
        for (var selected in this._data) {
            for (var point in this._data[selected]) {
                if (points.indexOf(point) === -1)
                    points.push(point);
            }
        }
        // Stable order.
        return this._progress_points = points.sort();
    }
    getSpeedupData(min_points) {
        const progress_points = this.getProgressPoints().filter((pp) => this._disabled_progress_points.indexOf(pp) === -1);
        let result = [];
        for (let selected in this._data) {
            let points = [];
            let points_with_enough = 0;
            progress_point_loop: for (let i = 0; i < progress_points.length; i++) {
                // Set up an empty record for this progress point
                const point = {
                    name: progress_points[i],
                    measurements: new Array()
                };
                points.push(point);
                // Get the data for this progress point, if any
                let point_data = this._data[selected][progress_points[i]];
                // Check to be sure the point was observed and we have baseline (zero speedup) data
                if (point_data !== undefined && point_data[0] !== undefined && hasEnoughData(point_data[0])) {
                    // Compute the baseline data point
                    let baseline_data_point = getDataPoint(point_data[0]);
                    let maximize = shouldMaximize(point_data[0]);
                    if (!isValidDataPoint(baseline_data_point)) {
                        // Baseline data point is invalid (divide by zero, or a NaN)
                        continue progress_point_loop;
                    }
                    // Loop over measurements and compute progress speedups in D3-friendly format
                    let measurements = [];
                    for (let speedup in point_data) {
                        // Skip data points with too few observations
                        if (!hasEnoughData(point_data[speedup])) {
                            continue;
                        }
                        let data_point = getDataPoint(point_data[speedup]);
                        // Skip invalid data.
                        if (!isValidDataPoint(data_point)) {
                            continue;
                        }
                        let progress_speedup = (baseline_data_point - data_point) / baseline_data_point;
                        if (!maximize) {
                            // We are trying to *minimize* this progress point, so negate the speedup.
                            progress_speedup = -progress_speedup;
                        }
                        // Skip really large negative and positive values
                        if (progress_speedup >= -1 && progress_speedup <= 2) {
                            // Add entry to measurements
                            measurements.push({
                                speedup: +speedup,
                                progress_speedup: progress_speedup
                            });
                        }
                    }
                    // Sort measurements by speedup
                    measurements.sort(function (a, b) { return a.speedup - b.speedup; });
                    // Use these measurements if we have enough different points
                    if (measurements.length >= min_points) {
                        points_with_enough++;
                        point.measurements = measurements;
                    }
                }
            }
            if (points_with_enough > 0) {
                result.push({
                    name: selected,
                    progress_points: points
                });
            }
        }
        return result;
    }
    drawLegend() {
        let container = this._plot_legend;
        const progress_points = this.getProgressPoints();
        let legend_entries_sel = container.selectAll('p.legend-entry').data(progress_points);
        legend_entries_sel.enter().append('p').attr('class', 'legend-entry');
        // Remove the noseries class from legend entries
        legend_entries_sel.classed('noseries', false).text('');
        legend_entries_sel.append('i')
            .attr('class', (d, i) => { return `fa fa-circle${this._disabled_progress_points.indexOf(d) !== -1 ? '-o' : ''} series${i % 8}`; })
            .on('click', (d, i) => {
            const ind = this._disabled_progress_points.indexOf(d);
            if (ind !== -1) {
                // Re-enable.
                this._disabled_progress_points.splice(ind, 1);
            }
            else if (this._disabled_progress_points.length + 1 < progress_points.length) {
                // Disable.
                this._disabled_progress_points.push(d);
            }
            else {
                // This is the last enabled progress point. Forbid disabling it.
                this._display_warning("Warning", `At least one progress point must be enabled.`);
            }
            this.drawPlots(true);
            this.drawLegend();
            update();
        });
        legend_entries_sel.append('span')
            .attr('class', 'path')
            .text(function (d) { return d; });
        // Remove defunct legend entries
        legend_entries_sel.exit().remove();
    }
    // Returns the number of plots that would be generated with the given min_points
    countPlots(min_points) {
        return this.getSpeedupData(min_points).length;
    }
    drawPlots(no_animate) {
        const container = this._plot_container;
        const min_points = this._get_min_points();
        const speedup_data = this.getSpeedupData(min_points);
        let min_speedup = Infinity;
        let max_speedup = -Infinity;
        for (let i = 0; i < speedup_data.length; i++) {
            const result = speedup_data[i];
            const result_min = min_progress_speedup(result);
            const result_max = max_progress_speedup(result);
            if (result_min < min_speedup) {
                min_speedup = result_min;
            }
            if (result_max > max_speedup) {
                max_speedup = result_max;
            }
        }
        // Give some wiggle room to display points.
        min_speedup *= 1.05;
        max_speedup *= 1.05;
        /****** Compute dimensions ******/
        const container_width = parseInt(container.style('width'));
        // Add columns while maintaining a target width
        let cols = 1;
        while (container_width / (cols + 1) >= 300)
            cols++;
        const div_width = container_width / cols;
        const div_height = 190;
        const svg_width = div_width - 10;
        const svg_height = div_height - 40;
        const margins = { left: 60, right: 20, top: 10, bottom: 35 };
        const plot_width = svg_width - margins.left - margins.right;
        const plot_height = svg_height - margins.top - margins.bottom;
        const radius = 3;
        const tick_size = 6;
        // Formatters
        const axisFormat = d3.format('.0%');
        const percentFormat = d3.format('+.1%');
        // Scales
        let xscale = d3.scale.linear().domain([0, 1]);
        let yscale = d3.scale.linear().domain([min_speedup, max_speedup]);
        // Axes
        let xaxis = d3.svg.axis()
            .scale(xscale)
            .orient('bottom')
            .ticks(5)
            .tickSize(tick_size)
            .tickFormat(axisFormat);
        //.tickSize(tick_size, 0, 0)
        //.tickFormat(axisFormat);
        let yaxis = d3.svg.axis()
            .scale(yscale)
            .orient('left')
            .ticks(5)
            .tickSize(tick_size, 0, 0)
            .tickFormat(axisFormat);
        // Gridlines
        let xgrid = d3.svg.axis().scale(xscale).orient('bottom').tickFormat('');
        let ygrid = d3.svg.axis().scale(yscale).orient('left').tickFormat('').ticks(5);
        // Tooltip
        let tip = d3.tip()
            .attr('class', 'd3-tip')
            .offset([-5, 0])
            .html(function (d) {
            let name = d.point_name || '';
            // Show just filename:line, not the full path
            let slash = name.lastIndexOf('/');
            if (slash !== -1)
                name = name.substring(slash + 1);
            return '<strong>Progress Point:</strong> ' + name + '<br>' +
                '<strong>Line Speedup:</strong> ' + percentFormat(d.speedup) + '<br>' +
                '<strong>Progress Speedup:</strong> ' + percentFormat(d.progress_speedup);
        });
        // Choose a tooltip direction from the point's position so it is not clipped
        // by the edges of the viewport (see issue #282). The static .direction()
        // callback only sees the datum, so we compute it in the mouseover handler
        // where `this` is the hovered circle. This is only an initial guess; after
        // the tooltip is rendered we measure its real box and flip it if it still
        // overflows the top (see show_tip below), which avoids guessing its height.
        let tip_direction = function (d) {
            // Near the right edge: place the tooltip to the left so it isn't clipped.
            if (d.speedup > 0.8)
                return 'w';
            return 'n';
        };
        let tip_offset = function (dir) {
            if (dir === 's')
                return [5, 0];
            if (dir === 'w')
                return [0, -5];
            return [-5, 0];
        };
        // The currently-visible tip node (d3-tip appends one div per tip instance;
        // pick the one that is actually shown rather than any stale leftovers).
        let active_tip_node = function () {
            let nodes = document.querySelectorAll('.d3-tip');
            for (let i = nodes.length - 1; i >= 0; i--) {
                let el = nodes[i];
                if (el.style.opacity === '1')
                    return el;
            }
            return null;
        };
        // Show the tooltip, then correct for any remaining top-edge clipping by
        // measuring the rendered tooltip (its real height) and flipping it below
        // the point when the 'north' placement overflows the top of the viewport.
        let show_tip = function (d, target) {
            let dir = tip_direction(d);
            tip.direction(dir).offset(tip_offset(dir));
            tip.show(d, target);
            if (dir === 'n') {
                let node = active_tip_node();
                if (node && node.getBoundingClientRect().top < 0) {
                    tip.direction('s').offset(tip_offset('s'));
                    tip.show(d, target);
                }
            }
        };
        /****** Add or update divs to hold each plot ******/
        let plot_div_sel = container.selectAll('div.plot')
            .data(speedup_data, function (d) { return d.name; });
        let plot_x_pos = function (d, i) {
            let col = i % cols;
            return (col * div_width) + 'px';
        };
        let plot_y_pos = function (d, i) {
            let row = (i - (i % cols)) / cols;
            return (row * div_height) + 'px';
        };
        // First, remove divs that are disappearing
        plot_div_sel.exit().transition().duration(200)
            .style('opacity', 0).remove();
        // Insert new divs with zero opacity
        plot_div_sel.enter().append('div')
            .attr('class', 'plot')
            .style('margin-bottom', -div_height + 'px')
            .style('opacity', 0)
            .style('width', div_width);
        // Sort plots by the chosen sorting function
        plot_div_sel.sort(sort_functions[d3.select('#sortby_field').node().value]);
        // Move divs into place. Only animate if we are not on a resizing redraw
        if (!no_animate) {
            plot_div_sel.transition().duration(400).delay(200)
                .style('top', plot_y_pos)
                .style('left', plot_x_pos)
                .style('opacity', 1);
        }
        else {
            plot_div_sel.style('left', plot_x_pos)
                .style('top', plot_y_pos);
        }
        /****** Insert, remove, and update plot titles ******/
        let plot_title_sel = plot_div_sel.selectAll('div.plot-title').data(function (d) { return [d.name]; });
        plot_title_sel.enter().append('div').attr('class', 'plot-title');
        plot_title_sel.text(function (d) { return d; })
            .classed('path', true)
            .attr('title', function (d) { return d; })
            .style('width', div_width + 'px');
        plot_title_sel.exit().remove();
        /****** Add source code toggle buttons ******/
        if (_source_server_available !== false) {
            let source_btn_sel = plot_div_sel.selectAll('span.source-toggle').data(function (d) { return [d.name]; });
            source_btn_sel.enter().append('span')
                .attr('class', 'source-toggle')
                .html('&#60;/&#62;')
                .attr('title', 'View source')
                .on('click', function (name) {
                let wasOpen = (_source_open_name === name);
                // Close all panels everywhere
                container.selectAll('.source-panel').remove();
                container.selectAll('.source-toggle').classed('active', false);
                container.selectAll('div.plot').classed('source-open', false);
                _source_open_name = null;
                if (wasOpen)
                    return;
                // Open this one
                let btn = d3.select(this);
                let plotDiv = d3.select(this.parentNode);
                _source_open_name = name;
                btn.classed('active', true);
                plotDiv.classed('source-open', true);
                fetchSourceSnippet(name, function (snippet) {
                    // Guard: only render if this is still the open panel
                    if (_source_open_name !== name)
                        return;
                    if (!snippet) {
                        btn.classed('active', false).classed('unavailable', true);
                        plotDiv.classed('source-open', false);
                        _source_open_name = null;
                        return;
                    }
                    let html = '';
                    for (let i = 0; i < snippet.lines.length; i++) {
                        let ln = snippet.lines[i];
                        let cls = ln.is_target ? 'source-line target' : 'source-line';
                        html += '<div class="' + cls + '">' +
                            '<span class="line-number">' + ln.number + '</span>' +
                            '<span class="line-text">' + highlightSyntax(ln.text) + '</span></div>';
                    }
                    plotDiv.append('div').attr('class', 'source-panel').html(html);
                });
            });
            source_btn_sel.exit().remove();
        }
        /****** Add AI optimization toggle buttons ******/
        if (_optimize_server_available !== false) {
            let opt_btn_sel = plot_div_sel.selectAll('span.optimize-toggle').data(function (d) { return [d]; });
            opt_btn_sel.enter().append('span')
                .attr('class', 'optimize-toggle')
                .html('<i class="fa fa-magic"></i>')
                .attr('title', 'AI optimization suggestions');
            // Track active abort handle for cancellation
            let _optimize_abort = null;
            opt_btn_sel.on('click', function (d) {
                let name = d.name;
                let wasOpen = (_optimize_open_name === name);
                // Close all optimize panels and cancel pending request
                container.selectAll('.optimize-panel').remove();
                container.selectAll('.optimize-toggle').classed('active', false);
                container.selectAll('div.plot').classed('optimize-open', false);
                if (_optimize_abort) {
                    _optimize_abort.abort();
                    _optimize_abort = null;
                }
                _optimize_open_name = null;
                if (wasOpen)
                    return;
                // Gather measurements from all progress points
                let allMeasurements = [];
                for (let i = 0; i < d.progress_points.length; i++) {
                    if (d.progress_points[i].measurements.length > 0) {
                        allMeasurements = d.progress_points[i].measurements;
                        break;
                    }
                }
                let btn = d3.select(this);
                let plotDiv = d3.select(this.parentNode);
                _optimize_open_name = name;
                btn.classed('active', true);
                plotDiv.classed('optimize-open', true);
                // Show loading state with progress bar and close button
                let loadingModel = getModelName();
                let loadingProvider = getSelectedProvider();
                let loadingLabel = loadingModel || loadingProvider;
                let loadingNote = loadingProvider === 'ollama'
                    ? '<div class="optimize-loading-note">Large models may take a minute to load</div>' : '';
                let panel = plotDiv.append('div').attr('class', 'optimize-panel');
                panel.html('<div class="optimize-header">' +
                    '<span class="optimize-header-title"><i class="fa fa-magic"></i> Analyzing with ' + escapeHtml(loadingLabel) + '</span>' +
                    '<button class="optimize-close-btn" title="Close"><i class="fa fa-times"></i></button>' +
                    '</div>' +
                    '<div class="optimize-progress-wrap">' +
                    '<div class="optimize-progress"><div class="optimize-progress-bar" style="width:0%"></div></div>' +
                    '</div>' +
                    '<div class="optimize-content optimize-streaming"></div>' +
                    loadingNote);
                // Close button handler (for loading state)
                function closePanel() {
                    if (_optimize_abort) {
                        _optimize_abort.abort();
                        _optimize_abort = null;
                    }
                    container.selectAll('.optimize-panel').remove();
                    container.selectAll('.optimize-toggle').classed('active', false);
                    container.selectAll('div.plot').classed('optimize-open', false);
                    _optimize_open_name = null;
                }
                panel.select('.optimize-close-btn').on('click', closePanel);
                let rawText = '';
                _optimize_abort = fetchOptimizationStream(name, allMeasurements, {
                    onChunk: function (fullText, _newChunk) {
                        if (_optimize_open_name !== name)
                            return;
                        rawText = fullText;
                        // Update progress bar (estimate based on chars received)
                        let pct = Math.min(95, Math.round((fullText.length / EXPECTED_RESPONSE_LENGTH) * 100));
                        let bar = panel.select('.optimize-progress-bar');
                        bar.style('width', pct + '%')
                            .classed('indeterminate', false);
                        // Update content with streaming text
                        panel.select('.optimize-content').html(formatOptimizationText(fullText));
                        // Auto-scroll to bottom
                        let contentEl = panel.select('.optimize-content').node();
                        if (contentEl) {
                            let panelEl = panel.node();
                            if (panelEl)
                                panelEl.scrollTop = panelEl.scrollHeight;
                        }
                    },
                    onDone: function (fullText) {
                        if (_optimize_open_name !== name)
                            return;
                        _optimize_abort = null;
                        rawText = fullText;
                        // Set progress to 100%
                        panel.select('.optimize-progress-bar').style('width', '100%');
                        // Final render
                        panel.select('.optimize-content')
                            .classed('optimize-streaming', false)
                            .html(formatOptimizationText(fullText));
                        // Remove progress bar after brief delay
                        setTimeout(function () {
                            panel.select('.optimize-progress-wrap').remove();
                        }, 500);
                        // Update header to show done state with copy button
                        panel.select('.optimize-header').html('<span class="optimize-header-title"><i class="fa fa-magic"></i> AI Suggestion</span>' +
                            '<span class="optimize-header-actions">' +
                            '<button class="optimize-copy-btn" title="Copy to clipboard"><i class="fa fa-copy"></i> Copy</button>' +
                            '<button class="optimize-close-btn" title="Close"><i class="fa fa-times"></i></button>' +
                            '</span>');
                        // Re-bind close button
                        panel.select('.optimize-close-btn').on('click', closePanel);
                        // Copy button handler
                        panel.select('.optimize-copy-btn').on('click', function () {
                            if (navigator.clipboard) {
                                navigator.clipboard.writeText(rawText).then(function () {
                                    let copyBtn = panel.select('.optimize-copy-btn');
                                    copyBtn.html('<i class="fa fa-check"></i> Copied');
                                    setTimeout(function () {
                                        copyBtn.html('<i class="fa fa-copy"></i> Copy');
                                    }, 2000);
                                });
                            }
                        });
                    },
                    onError: function (error) {
                        if (_optimize_open_name !== name)
                            return;
                        _optimize_abort = null;
                        panel.select('.optimize-progress-wrap').remove();
                        panel.select('.optimize-content')
                            .classed('optimize-streaming', false)
                            .attr('class', 'optimize-error')
                            .html('<i class="fa fa-exclamation-triangle"></i> ' + escapeHtml(error));
                        // Update header with close button
                        panel.select('.optimize-header').html('<span class="optimize-header-title" style="color:var(--danger-color,#ef4444)"><i class="fa fa-exclamation-triangle"></i> Error</span>' +
                            '<button class="optimize-close-btn" title="Close"><i class="fa fa-times"></i></button>');
                        panel.select('.optimize-close-btn').on('click', closePanel);
                    }
                });
            });
            opt_btn_sel.exit().remove();
        }
        /****** Update scales ******/
        xscale.domain([0, 1]).range([0, plot_width]);
        yscale.domain([min_speedup, max_speedup]).range([plot_height, 0]);
        /****** Update gridlines ******/
        xgrid.tickSize(-plot_height, 0, 0);
        ygrid.tickSize(-plot_width, 0, 0);
        /****** Insert and update plot svgs ******/
        let plot_svg_sel = plot_div_sel.selectAll('svg').data([1]);
        plot_svg_sel.enter().append('svg');
        plot_svg_sel.attr('width', svg_width)
            .attr('height', svg_height)
            .call(tip);
        plot_svg_sel.exit().remove();
        /****** Add or update plot areas ******/
        let plot_area_sel = plot_svg_sel.selectAll('g.plot_area').data([0]);
        plot_area_sel.enter().append('g').attr('class', 'plot_area');
        plot_area_sel.attr('transform', `translate(${margins.left}, ${margins.top})`);
        plot_area_sel.exit().remove();
        /****** Add or update clip paths ******/
        let clippath_sel = plot_area_sel.selectAll('#clip').data([0]);
        clippath_sel.enter().append('clipPath').attr('id', 'clip');
        clippath_sel.exit().remove();
        /****** Add or update clipping rectangles to clip paths ******/
        let clip_rect_sel = clippath_sel.selectAll('rect').data([0]);
        clip_rect_sel.enter().append('rect');
        clip_rect_sel.attr('x', -radius - 1)
            .attr('y', 0)
            .attr('width', plot_width + 2 * radius + 2)
            .attr('height', plot_height);
        clip_rect_sel.exit().remove();
        /****** Select plots areas, but preserve the real speedup data ******/
        plot_area_sel = plot_div_sel.select('svg').select('g.plot_area');
        /****** Add or update x-grids ******/
        let xgrid_sel = plot_area_sel.selectAll('g.xgrid').data([0]);
        xgrid_sel.enter().append('g').attr('class', 'xgrid');
        xgrid_sel.attr('transform', `translate(0, ${plot_height})`).call(xgrid);
        xgrid_sel.exit().remove();
        /****** Add or update y-grids ******/
        let ygrid_sel = plot_area_sel.selectAll('g.ygrid').data([0]);
        ygrid_sel.enter().append('g').attr('class', 'ygrid');
        ygrid_sel.call(ygrid);
        ygrid_sel.exit().remove();
        /****** Add or update x-axes ******/
        let xaxis_sel = plot_area_sel.selectAll('g.xaxis').data([0]);
        xaxis_sel.enter().append('g').attr('class', 'xaxis');
        xaxis_sel.attr('transform', `translate(0, ${plot_height})`).call(xaxis);
        xaxis_sel.exit().remove();
        /****** Add or update x-axis titles ******/
        let xtitle_sel = plot_area_sel.selectAll('text.xtitle').data([0]);
        xtitle_sel.enter().append('text').attr('class', 'xtitle');
        xtitle_sel.attr('x', xscale(0.5))
            .attr('y', 32) // Approximate height of the x-axis
            .attr('transform', `translate(0, ${plot_height})`)
            .style('text-anchor', 'middle')
            .text('Line speedup');
        xtitle_sel.exit().remove();
        /****** Add or update y-axes ******/
        let yaxis_sel = plot_area_sel.selectAll('g.yaxis').data([0]);
        yaxis_sel.enter().append('g').attr('class', 'yaxis');
        yaxis_sel.call(yaxis);
        yaxis_sel.exit().remove();
        /****** Add or update y-axis title ******/
        let ytitle_sel = plot_area_sel.selectAll('text.ytitle').data([0]);
        ytitle_sel.enter().append('text').attr('class', 'ytitle');
        ytitle_sel.attr('x', -(svg_height - margins.bottom) / 2)
            .attr('y', -45) // Approximate width of y-axis
            .attr('transform', 'rotate(-90)')
            .style('text-anchor', 'middle')
            .style('alignment-baseline', 'central')
            .text('Program Speedup');
        ytitle_sel.exit().remove();
        /****** Add or update x-zero line ******/
        let xzero_sel = plot_area_sel.selectAll('line.xzero').data([0]);
        xzero_sel.enter().append('line').attr('class', 'xzero');
        xzero_sel.attr('x1', xscale(0))
            .attr('y1', 0)
            .attr('x2', xscale(0))
            .attr('y2', plot_height + tick_size);
        xzero_sel.exit().remove();
        /****** Add or update y-zero line ******/
        let yzero_sel = plot_area_sel.selectAll('line.yzero').data([0]);
        yzero_sel.enter().append('line').attr('class', 'yzero');
        yzero_sel.attr('x1', -tick_size)
            .attr('y1', yscale(0))
            .attr('x2', plot_width)
            .attr('y2', yscale(0));
        yzero_sel.exit().remove();
        /****** Add or update series ******/
        let progress_points = this.getProgressPoints();
        let series_sel = plot_area_sel.selectAll('g.series')
            .data(function (d) { return d.progress_points; }, function (d) { return d.name; });
        series_sel.enter().append('g');
        series_sel.attr('class', function (d, k) {
            // Use progress point's position in array to assign it a stable color, no matter
            // which points are enabled for display.
            return `series series${(progress_points.indexOf(d.name)) % 8}`;
        })
            .attr('style', 'clip-path: url(#clip);');
        series_sel.exit().remove();
        /****** Add or update trendlines ******/
        // Configure a loess smoother
        let loess = science.stats.loess()
            .bandwidth(0.4)
            .robustnessIterations(5);
        // Create an svg line to draw the loess curve
        let line = d3.svg.line().x(function (d) { return xscale(d[0]); })
            .y(function (d) { return yscale(d[1]); })
            .interpolate('basis');
        // Apply the loess smoothing to each series, then draw the lines
        let lines_sel = series_sel.selectAll('path').data(function (d) {
            let xvals = d.measurements.map(function (e) { return e.speedup; });
            let yvals = d.measurements.map(function (e) { return e.progress_speedup; });
            let smoothed_y = [];
            try {
                smoothed_y = loess(xvals, yvals);
            }
            catch (e) {
                // Bandwidth too small error. Ignore and proceed with empty smoothed line.
            }
            // Speedup is always zero for a line speedup of zero
            smoothed_y[0] = 0;
            if (xvals.length > 5)
                return [d3.zip(xvals, smoothed_y)];
            else
                return [d3.zip(xvals, yvals)];
        });
        lines_sel.enter().append('path');
        lines_sel.attr('d', line);
        lines_sel.exit().remove();
        /****** Add or update points ******/
        let points_sel = series_sel.selectAll('circle').data(function (d) {
            return d.measurements.map(function (m) {
                return { speedup: m.speedup, progress_speedup: m.progress_speedup, point_name: d.name };
            });
        });
        points_sel.enter().append('circle').attr('r', radius);
        points_sel.attr('cx', function (d) { return xscale(d.speedup); })
            .attr('cy', function (d) { return yscale(d.progress_speedup); })
            .on('mouseover', function (d) {
            d3.select(this).classed('highlight', true);
            show_tip(d, this);
        })
            .on('mouseout', function () {
            d3.select(this).classed('highlight', false);
            tip.hide();
        });
        points_sel.exit().remove();
        // Return the number of plots
        return speedup_data.length;
    }
}
//# sourceMappingURL=profile.js.map