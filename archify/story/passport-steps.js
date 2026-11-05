// A reader for explicit, caller-local Story scenes. It never owns graph geometry.
function installPassportSteps(sequences, onChange) {
  const root = document.documentElement, chip = document.querySelector('#focus-chip');
  const diagram = document.querySelector('.diagram-container'), svg = diagram.querySelector('svg');
  const governor = Archify.motionGovernor;
  const text = (key, values) => viewerText('viewer.steps.' + key, values);
  const element = (tag, cls, value) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (value !== undefined) el.textContent = value;
    return el;
  };
  const button = (cls, key) => {
    const el = element('button', cls, text(key)); el.type = 'button'; return el;
  };
  const icon = (path) => '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="' + path + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const icons = {play: icon('m5 3 8 5-8 5Z'), pause: icon('M5 3v10M11 3v10'), replay: icon('M3 6a5 5 0 1 1 0 4M3 2v4h4'), prev: icon('m10 3-5 5 5 5'), next: icon('m6 3 5 5-5 5')};
  const reader = element('section', 'passport-steps'); reader.hidden = true; reader.setAttribute('aria-label', text('label'));
  const scenario = element('select', 'passport-step-scenario'); scenario.setAttribute('aria-label', text('scenario'));
  const current = element('div', 'passport-step-current'), position = element('div', 'passport-step-position');
  const number = element('strong'), total = element('span'), copy = element('div', 'passport-step-copy');
  const title = element('strong'), target = element('span'); position.append(number, total); copy.append(title, target); current.append(position, copy);
  const list = element('ol', 'passport-step-list'); list.id = 'passport-step-list';
  const actions = element('div', 'passport-step-actions'), toggle = button('passport-step-toggle', 'expand');
  toggle.setAttribute('aria-controls', list.id);
  const prev = button('passport-step-arrow', 'previous'), play = button('passport-step-play', 'play'), next = button('passport-step-arrow', 'next');
  prev.setAttribute('aria-label', text('previous')); next.setAttribute('aria-label', text('next'));
  prev.innerHTML = icons.prev; next.innerHTML = icons.next; actions.append(toggle, prev, play, next);
  const status = element('div', 'passport-step-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  reader.append(scenario, current, list, actions, status);
  const details = button('passport-step-details', 'details'), back = button('passport-step-back', 'back'); details.hidden = back.hidden = true;
  chip.querySelector('.relationship-lens-actions').prepend(details); chip.append(reader, back);
  let node = '', choices = [], selected = 0, index = 0, expanded = false, showingDetails = false;
  let playing = false, timer, claim = 0, previousMode = 'still';
  const narrow = () => matchMedia('(max-width: 800px)').matches;
  const sequence = () => choices[selected];
  const visible = () => !!sequence() && !showingDetails && chip.getAttribute('data-explaining') !== 'true';

  function clearHighlight() { svg.querySelectorAll('[data-passport-step]').forEach(el => el.removeAttribute('data-passport-step')); }
  function paint() {
    const show = visible(), step = sequence()?.steps[index];
    root.toggleAttribute('data-passport-steps', show);
    chip.toggleAttribute('data-steps-expanded', show && expanded);
    reader.hidden = !show; back.hidden = !sequence() || !showingDetails; details.hidden = !show || !expanded;
    clearHighlight();
    if (show) {
      const ids = new Set([node]);
      svg.querySelectorAll('[data-edge-id]').forEach(el => {
        if (!step.edges.includes(el.getAttribute('data-edge-id'))) return;
        el.setAttribute('data-passport-step', ''); ids.add(el.getAttribute('data-edge-to'));
      });
      svg.querySelectorAll('[data-node-id]').forEach(el => { if (ids.has(el.getAttribute('data-node-id'))) el.setAttribute('data-passport-step', ''); });
      number.textContent = index + 1; total.textContent = '/ ' + sequence().steps.length;
      title.textContent = step.title; target.textContent = step.targets.join(' + ') + (step.edges.length > 1 ? ' · ' + text('parallel') : '');
      current.hidden = expanded; list.hidden = !expanded;
      list.querySelectorAll('button').forEach((el, i) => el.setAttribute('aria-current', i === index ? 'step' : 'false'));
      toggle.textContent = text(expanded ? 'collapse' : 'expand'); toggle.setAttribute('aria-expanded', String(expanded));
      const action = playing ? 'pause' : index === sequence().steps.length - 1 ? 'replay' : 'play';
      play.innerHTML = icons[action]; play.append(element('span', '', text(action))); play.setAttribute('aria-pressed', String(playing));
      play.setAttribute('aria-label', text(action)); play.title = text('cadence');
      prev.disabled = index === 0; next.disabled = index === sequence().steps.length - 1;
      status.textContent = text('status', {index: index + 1, total: sequence().steps.length, title: step.title, targets: target.textContent, state: text(playing ? 'playing' : 'paused')});
    }
    Archify.focus.reposition(); onChange();
  }
  function rebuild() {
    scenario.replaceChildren(...choices.map((item, i) => { const option = element('option', '', item.title); option.value = i; return option; }));
    scenario.hidden = choices.length < 2; scenario.value = selected;
    list.replaceChildren(...(sequence()?.steps || []).map((step, i) => {
      const row = element('li'), control = element('button', 'passport-step'); control.type = 'button';
      const labels = element('span', 'passport-step-labels');
      labels.append(element('strong', '', step.title), element('small', '', step.targets.join(' + ')));
      control.append(element('span', 'passport-step-number', i + 1), labels);
      control.setAttribute('aria-label', text('stage', {index: i + 1, title: step.title, targets: step.targets.join(' + ')}) + (step.edges.length > 1 ? ' · ' + text('parallel') : ''));
      control.addEventListener('click', () => select(i)); row.append(control); return row;
    }));
    paint();
  }
  function pause(restore = true) {
    clearTimeout(timer); timer = undefined; playing = false;
    if (claim) {
      const token = claim; claim = 0;
      if (governor.release(token) && restore) governor.setMode(previousMode, {persist: false});
    }
    paint();
  }
  function schedule() {
    timer = setTimeout(() => {
      if (!playing || !visible() || document.hidden) { pause(); return; }
      index += 1;
      if (index === sequence().steps.length - 1) pause();
      else { paint(); schedule(); }
    }, 2400);
  }
  function select(nextIndex) {
    pause(); index = Math.max(0, Math.min(sequence().steps.length - 1, nextIndex));
    const fold = expanded && narrow(); if (fold) expanded = false;
    paint(); if (fold) play.focus({preventScroll: true});
  }
  play.addEventListener('click', () => {
    if (playing) { pause(); return; }
    if (document.hidden) return;
    if (index === sequence().steps.length - 1) index = 0;
    if (narrow()) expanded = false;
    previousMode = governor.mode();
    claim = governor.claim('steps', () => { pause(false); governor.setMode(previousMode, {persist: false}); });
    governor.setMode('live', {persist: false}); playing = true; paint(); schedule();
  });
  prev.addEventListener('click', () => select(index - 1)); next.addEventListener('click', () => select(index + 1));
  toggle.addEventListener('click', () => { expanded = !expanded; paint(); });
  scenario.addEventListener('change', () => { pause(); selected = Number(scenario.value); index = 0; rebuild(); });
  details.addEventListener('click', () => { pause(); showingDetails = true; paint(); back.focus({preventScroll: true}); });
  back.addEventListener('click', () => {
    Archify.focus.clearReach({updateUrl: true});
    showingDetails = false; paint(); toggle.focus({preventScroll: true});
  });
  list.addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...list.querySelectorAll('button')], from = buttons.indexOf(event.target);
    if (from < 0) return;
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : from + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
    event.preventDefault(); select(nextIndex);
    if (expanded) buttons[index].focus();
  });

  function sync() {
    const active = !chip.hidden && !root.hasAttribute('data-story-active') && !Archify.focus.relationship() ? Archify.focus.active() : '';
    if (active !== node) {
      pause(); node = active; choices = sequences.filter(item => item.node === node);
      selected = index = 0; expanded = false;
      showingDetails = !!Archify.focus.reachability(); rebuild();
    } else {
      // A native reach deep link or action keeps its original meaning. The
      // caller's stage view resumes only when the reader explicitly returns.
      if (Archify.focus.reachability()) showingDetails = true;
      if (playing && (!visible() || document.hidden)) pause();
      else if (playing && !governor.reducedMotion() && governor.isPaused()) pause(false);
      else paint();
    }
  }
  const observer = new MutationObserver(sync);
  observer.observe(svg, {attributes: true, attributeFilter: ['data-focus-active', 'data-relationship-pin-active', 'data-reach-active']});
  observer.observe(chip, {attributes: true, attributeFilter: ['hidden', 'data-explaining']});
  observer.observe(root, {attributes: true, attributeFilter: ['data-motion', 'data-story-active']});
  document.addEventListener('visibilitychange', () => { if (playing && document.hidden) pause(); });
  window.addEventListener('pagehide', () => pause());

  function place() {
    if (!visible() || node !== Archify.focus.active() || chip.hidden) return false;
    if (narrow()) return true;
    if (chip.hasAttribute('data-manual-placement')) return false;
    const bounds = diagram.getBoundingClientRect(), width = chip.offsetWidth, height = chip.offsetHeight, gap = 16;
    const top = Math.max(gap, gap - bounds.top), bottom = Math.max(top, Math.min(bounds.height, innerHeight - bounds.top) - height - gap);
    const right = Math.max(gap, bounds.width - width - gap);
    // Reserve space for the whole scenario, so the controls do not jump when
    // the reader selects a different stage or advances during playback.
    const edgeIds = new Set(sequence().steps.flatMap(step => step.edges)), nodeIds = new Set([node]);
    const edges = [...svg.querySelectorAll('[data-edge-id]')].filter(el => edgeIds.has(el.getAttribute('data-edge-id')));
    edges.forEach(el => nodeIds.add(el.getAttribute('data-edge-to')));
    const nodes = [...svg.querySelectorAll('[data-node-id]')].filter(el => nodeIds.has(el.getAttribute('data-node-id')));
    const obstacles = [...edges, ...nodes, ...diagram.querySelectorAll('.diagram-nav')].flatMap(el => {
      // A bent route's bounding box contains empty canvas. Measure its segments
      // instead, so the Passport can use that space without covering the route.
      if (typeof el.getTotalLength === 'function') {
        const length = el.getTotalLength(), count = Math.max(1, Math.min(128, Math.ceil(length / 16))), matrix = el.getScreenCTM();
        const points = Array.from({length: count + 1}, (_, i) => { const p = el.getPointAtLength(length * i / count); return new DOMPoint(p.x, p.y).matrixTransform(matrix); });
        return points.slice(1).map((p, i) => ({weight: 1, rect: {left: Math.min(p.x, points[i].x), right: Math.max(p.x, points[i].x), top: Math.min(p.y, points[i].y), bottom: Math.max(p.y, points[i].y)}}));
      }
      return [{rect: el.getBoundingClientRect(), weight: el.hasAttribute('data-node-id') ? 5 : 1}];
    });
    const overlap = (left, y, rect) => Math.max(0, Math.min(left + width, rect.right + 8) - Math.max(left, rect.left - 8)) * Math.max(0, Math.min(y + height, rect.bottom + 8) - Math.max(y, rect.top - 8));
    const candidates = [[gap, top], [right, top], [gap, bottom], [right, bottom]];
    candidates.sort((a, b) => obstacles.reduce((score, item) => score + item.weight * (overlap(bounds.left + a[0], bounds.top + a[1], item.rect) - overlap(bounds.left + b[0], bounds.top + b[1], item.rect)), 0));
    chip.style.left = candidates[0][0] + 'px'; chip.style.top = candidates[0][1] + 'px'; return true;
  }
  const api = {pause, isPlaying: () => playing, place, refresh: sync};
  Archify.passportSteps = api;
  sync(); return api;
}
