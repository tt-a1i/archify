(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('travel-data').textContent);
  const $ = id => document.getElementById(id);
  const svg = document.querySelector('.diagram-container > svg');
  const canvas = document.querySelector('.diagram-container');
  let scene = 'france', selected = null, visible = [], saved = new Set();
  try { const ids = JSON.parse(localStorage.getItem('archify-travel-saved') || '[]'); if (Array.isArray(ids)) saved = new Set(ids.filter(id => data.places.some(p => p.id === id))); } catch (_) {}
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function writeHash() { const h = '#scene=' + scene + (selected ? '&place=' + selected : ''); try { history.replaceState(null, '', h); } catch (_) {} }
  function detail(id) {
    const p = data.places.find(p => p.id === id);
    if (!p || !visible.includes(p)) { selected = null; $('detail').hidden = true; return; }
    selected = id;
    $('detail').hidden = false;
    $('detail').innerHTML = `<h2>${esc(p.name)}</h2><p>${esc(p.label)}</p><p>${esc(p.description)}</p><p>${p.coordinates[1].toFixed(5)}° N · ${p.coordinates[0].toFixed(5)}° E</p>${p.target ? '<button id="enter-city">进入巴黎城市地图 →</button>' : ''}<button id="save" aria-pressed="${saved.has(id)}">${saved.has(id) ? '已加入想去清单 ✓' : '加入想去清单'}</button><a href="${esc(p.source)}" target="_blank" rel="noopener noreferrer">查看坐标来源 · Wikidata ↗</a>`;
    $('enter-city')?.addEventListener('click', () => changeScene('paris'));
    $('save').addEventListener('click', () => { if (saved.has(id)) saved.delete(id); else saved.add(id); try { localStorage.setItem('archify-travel-saved', JSON.stringify([...saved])); } catch (_) {} detail(id); });
    document.querySelectorAll('[data-place]').forEach(el => el.classList.toggle('selected', el.dataset.place === id));
    writeHash();
  }
  function draw() {
    const s = data.scenes[scene], query = $('search').value.trim().toLowerCase(), category = $('category').value, day = Number($('day').value);
    // Search spans the atlas; choosing a result enters its scene. Filters remain explicit.
    visible = data.places.filter(p => (query ? (p.name + p.label).toLowerCase().includes(query) : p.scene === scene) && (category === 'all' || p.category === category) && (!day || p.day === day));
    const mapPlaces = visible.filter(p => p.scene === scene);
    $('count').textContent = `${visible.length} 处`;
    $('places').replaceChildren();
    for (const [i, p] of visible.entries()) {
      const b = document.createElement('button'); b.className = 'place-row'; b.dataset.place = p.id;
      b.innerHTML = `<span class="place-number">${String(i + 1).padStart(2,'0')}</span><span><span class="place-name">${esc(p.name)}</span><span class="place-caption">${esc(p.caption)}</span></span><span class="place-arrow">↗</span>`;
      b.addEventListener('click', () => { if (p.scene !== scene) changeScene(p.scene, p.id); else detail(p.id); }); $('places').append(b);
    }
    if (!visible.length) { const p = document.createElement('p'); p.className='empty'; p.textContent='没有匹配的地点，请调整搜索或筛选。'; $('places').append(p); }
    const polygons = s.paths.map(p => `<path class="${scene === 'france' ? 'land' : 'district'}" d="${p.d}"><title>${esc(p.name)}</title></path>${p.center ? `<text class="district-label" x="${p.center[0]}" y="${p.center[1]}" text-anchor="middle">${p.number}</text>` : ''}`).join('');
    const lines = [1,2].map(d => { const points = mapPlaces.filter(p => p.day === d); return points.length > 1 ? `<polyline class="route-line" points="${points.map(p => p.point.join(',')).join(' ')}"><title>第 ${d} 天游览顺序示意，不代表道路</title></polyline>` : ''; }).join('');
    const markers = mapPlaces.map(p => { const [x,y] = p.point; const offset = p.id === 'Q64436' ? -35 : p.id === 'Q19675' ? -15 : 0;
      return `<g class="poi" data-place="${p.id}" role="button" tabindex="0" aria-label="${esc(p.name)}，查看详情" transform="translate(${x} ${y})"><path class="leader" d="M0 0L${offset} -20"/><circle class="pin" r="6"/><use href="#${p.icon}" x="${offset - 42}" y="-102" width="84" height="86" aria-hidden="true"/><text class="name" text-anchor="middle" x="${offset}" y="30">${esc(p.name)}</text><text class="local-name" text-anchor="middle" x="${offset}" y="49">${esc(p.label)}</text><text class="detail-label" text-anchor="middle" x="${offset}" y="67">${esc(p.caption)}</text></g>`;
    }).join('');
    $('scene').innerHTML = `<rect width="1400" height="1050" fill="#e9efea"/><rect x="55" y="55" width="1290" height="940" fill="url(#sea)"/><rect class="map-border" x="55" y="55" width="1290" height="940"/>${polygons}<text class="map-title" x="100" y="120">${s.english}</text>${scene === 'france' ? '<text class="sea-label" x="140" y="670">ATLANTIC OCEAN</text>' : ''}${lines}${markers}<text class="map-note" x="85" y="963">${scene === 'france' ? '法国本土与科西嘉岛 · 点击巴黎进入城市地图' : '真实行政区边界 · 虚线为游览顺序 · 放大显示更多细节'}</text>`;
    $('scene').querySelectorAll('.poi').forEach(el => { el.addEventListener('click', () => detail(el.dataset.place)); el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); detail(el.dataset.place); } }); });
    if (selected && mapPlaces.some(p => p.id === selected)) detail(selected); else { selected=null; $('detail').hidden=true; writeHash(); }
    syncDepth();
  }
  function changeScene(next, id = null, write = true) {
    if (!data.scenes[next]) next = 'france';
    scene = next; selected = null; $('search').value = ''; $('category').value = 'all'; $('day').value = '0';
    const s = data.scenes[scene]; $('title').textContent = s.name; $('english').textContent = s.english; $('intro').textContent = s.subtitle; $('crumb').hidden = scene !== 'paris';
    $('map-level').textContent = (scene === 'france' ? '国家 / ' : '城市 / ') + s.english;
    $('france-tab').setAttribute('aria-pressed', String(scene === 'france')); $('paris-tab').setAttribute('aria-pressed', String(scene === 'paris'));
    $('day').disabled = scene !== 'paris'; svg.setAttribute('aria-label', s.name + '互动地图');
    draw(); if (id) detail(id); Archify.view.fitAll(); if (write) writeHash();
  }
  function syncDepth() { const scale = Archify.view.state().scale; const depth = scale < .8 ? 'overview' : scale < 1.5 ? 'read' : 'detail'; canvas.dataset.travelDepth = depth; $('detail-level').textContent = {overview:'全景 · 放大探索',read:'地点 · 城市细节',detail:'细节 · 景点与行程'}[depth]; }
  new MutationObserver(syncDepth).observe(svg, {attributes:true,attributeFilter:['data-view-scale']});
  for (const id of ['search','category','day']) $(id).addEventListener(id === 'search' ? 'input' : 'change', draw);
  $('country').addEventListener('click', () => changeScene('france')); $('france-tab').addEventListener('click', () => changeScene('france')); $('paris-tab').addEventListener('click', () => changeScene('paris'));
  $('sources-toggle').addEventListener('click', () => { $('sources').hidden = !$('sources').hidden; $('sources-toggle').setAttribute('aria-expanded', String(!$('sources').hidden)); });
  $('export').addEventListener('click', () => {
    const clone = svg.cloneNode(true); clone.removeAttribute('style'); clone.querySelectorAll('[tabindex]').forEach(el => el.removeAttribute('tabindex'));
    const style = document.createElementNS('http://www.w3.org/2000/svg','style'); style.textContent = document.querySelector('style').textContent; clone.prepend(style);
    const credit = document.createElementNS('http://www.w3.org/2000/svg','text'); credit.setAttribute('x','85'); credit.setAttribute('y','1020'); credit.setAttribute('font-size','12'); credit.textContent='Natural Earth (public domain) · © Ville de Paris (ODbL) · Wikidata (CC0) · 2026-09-29'; clone.append(credit);
    const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'})); const a=document.createElement('a');a.href=url;a.download='archify-travel-'+scene+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  function restore() { const params = new URLSearchParams(location.hash.slice(1)); changeScene(params.get('scene') || 'france', params.get('place'), false); }
  window.addEventListener('hashchange', restore); restore();
  Archify.travel = { scene: () => scene, selected: () => selected, visible: () => visible.map(p=>p.id), changeScene };
})();
