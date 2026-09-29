import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(new URL('../../archify/package.json', import.meta.url));
const { buildSync } = require('esbuild');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const json = name => JSON.parse(read('data/' + name));
export function project([lng, lat], bounds) {
  const [west, south, east, north] = bounds;
  const cos = Math.cos((south + north) / 2 * Math.PI / 180);
  const scale = Math.min(1160 / ((east - west) * cos), 820 / (north - south));
  return [700 + (lng - (west + east) / 2) * cos * scale, 525 - (lat - (south + north) / 2) * scale];
}
export function geometryPath(geometry, bounds) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  if (!['Polygon', 'MultiPolygon'].includes(geometry.type)) throw new Error('Unsupported geography');
  return polygons.map(polygon => polygon.map(ring => ring.map((point, i) => {
    const [x, y] = project(point, bounds);
    return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ') + 'Z').join(' ')).join(' ');
}
const bounds = { france: [-5.5, 41.2, 9.8, 51.3], paris: [2.224, 48.815, 2.47, 48.903] };
const editorial = {
  Q90: ['巴黎', 'paris', 'city', 'tower', '从城市轮廓走进博物馆、广场与塞纳河两岸。', '进入巴黎地图'],
  Q456: ['里昂', 'france', 'city', 'church', '在法国东南部停留，探索旧城与城市文化。', '城市概览'],
  Q42807: ['尼姆', 'france', 'city', 'arch', '把南法古城加入旅程，感受罗马建筑留下的城市印记。', '城市概览'],
  Q12191: ['南特', 'france', 'city', 'museum', '从法国西部出发，安排一站城市漫步。', '城市概览'],
  Q243: ['埃菲尔铁塔', null, 'landmark', 'tower', '在铁塔周边散步，从不同角度观察巴黎的经典地标。', '第 1 天 · 地标漫步'],
  Q19675: ['卢浮宫', null, 'museum', 'museum', '把博物馆留作旅程中的一段慢时光。参观安排请查官方信息。', '第 2 天 · 艺术与历史'],
  Q2981: ['巴黎圣母院', null, 'heritage', 'church', '在西岱岛周边探索巴黎的历史。开放与预约信息请以官网为准。', '第 2 天 · 艺术与历史'],
  Q64436: ['凯旋门', null, 'landmark', 'arch', '从星形广场认识城市轴线，作为地标漫步的另一站。', '第 1 天 · 地标漫步'],
};
const places = json('places.json').map(p => {
  const [name, target, category, icon, description, caption] = editorial[p.id];
  const scene = category === 'city' ? 'france' : 'paris';
  return { ...p, name, target: p.id === 'Q90' ? target : null, category, icon, description, caption, scene,
    point: project(p.coordinates, bounds[scene]), day: category === 'city' ? 0 : ['Q243','Q64436'].includes(p.id) ? 1 : 2 };
});
const scenes = {
  france: { name: '法国', english: 'FRANCE', subtitle: '从国家全景，走进一座城市。', paths: json('france.geojson').features.map(f => ({ d: geometryPath(f.geometry, bounds.france), name: '法国本土与科西嘉岛' })) },
  paris: { name: '巴黎', english: 'PARIS', subtitle: '20 个街区轮廓，4 处旅程中的停靠。', paths: json('paris-arrondissements.geojson').features.map(f => ({ d: geometryPath(f.geometry, bounds.paris), name: f.properties.l_ar, number: f.properties.c_ar, center: project([f.properties.geom_x_y.lon, f.properties.geom_x_y.lat], bounds.paris) })) },
};
const payload = JSON.stringify({ scenes, places, sources: json('sources.json') }).replace(/</g, '\\u003c');
const camera = fs.readFileSync(path.join(root, '../../viewer/viewer-camera.js'), 'utf8');
const threeBundle = buildSync({ entryPoints: [path.join(root, 'scene3d.js')], bundle: true,
  format: 'iife', write: false, minify: true, legalComments: 'inline', target: 'es2020',
  supported: { 'template-literal': false } }).outputFiles[0].text;
const threeLicense = read('node_modules/three/LICENSE').replace(/</g, '&lt;');
const html = `<!doctype html>
<html lang="zh-CN" data-fixed-canvas><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Archify Travel · 法国与巴黎</title><style>${read('style.css')}</style></head>
<body><header><a class="brand" href="#scene=france">ARCHIFY <span>TRAVEL ATLAS</span></a><div class="edition">旅行地图实验室 / 01</div><button id="export" type="button">导出当前地图 SVG</button></header>
<main><aside class="sidebar"><nav class="breadcrumb" aria-label="地图层级"><button id="country" type="button">法国</button><span id="crumb" hidden> / 巴黎</span></nav><div class="eyebrow">A LITTLE CURIOSITY, A LONG WAY</div><h1 id="title">法国</h1><div id="english" class="english">FRANCE</div><p id="intro"></p>
<div class="scope"><button id="france-tab" aria-pressed="true">国家总览</button><button id="paris-tab" aria-pressed="false">巴黎城市</button></div>
<label class="search-label" for="search">寻找下一站</label><input id="search" type="search" placeholder="搜索城市或景点…" autocomplete="off">
<div class="filters"><label>类别<select id="category"><option value="all">全部地点</option><option value="city">城市</option><option value="landmark">地标</option><option value="museum">博物馆</option><option value="heritage">历史建筑</option></select></label><label>行程<select id="day"><option value="0">全部日期</option><option value="1">第 1 天</option><option value="2">第 2 天</option></select></label></div>
<div class="list-heading"><span id="list-title">探索目的地</span><span id="count" aria-live="polite"></span></div><div id="places"></div><section id="detail" hidden aria-label="地点详情"></section><p class="editorial">行程为示例游览顺序，连线不代表道路或导航。其他城市本期提供位置与简介；巴黎提供城市层级。</p></aside>
<section class="map-column" aria-label="互动旅行地图"><div class="map-heading"><span id="map-level">国家 / FRANCE</span><span id="detail-level" aria-live="polite">全景</span></div><div class="diagram-container" tabindex="0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 1050" role="group" aria-label="法国互动地图"><defs>
<pattern id="sea" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#b8cecc"/></pattern>
<symbol id="tower" viewBox="-40 -90 80 100"><path d="M-30 0L-12-34 -6-67 0-88 6-67 12-34 30 0Z" fill="#cfa86b" stroke="#5a5641" stroke-width="3"/><path d="M-20-16H20M-15-34H15M-9-55H9M-7 0Q0-30 7 0M-12-34L12-16M12-34L-12-16" fill="none" stroke="#5a5641" stroke-width="3"/></symbol>
<symbol id="museum" viewBox="-50 -70 100 80"><path d="M-44 0V-35L0-56 44-35V0Z" fill="#ddc8a2" stroke="#70694d" stroke-width="2"/><path d="M-45-35H45M-34-29V-5M-20-29V-5M20-29V-5M34-29V-5" stroke="#70694d" stroke-width="4"/><path d="M-24 0L0-37 24 0Z" fill="#9bcac7" stroke="#477f7b" stroke-width="2"/></symbol>
<symbol id="church" viewBox="-45 -80 90 90"><path d="M-34 0V-65H-13V-38H13V-65H34V0Z" fill="#ddd0b1" stroke="#726b54" stroke-width="3"/><circle cx="0" cy="-24" r="9" fill="#799c9c"/><path d="M-5 0V-9Q0-20 5-9V0M-27-51H-20M20-51H27" fill="none" stroke="#726b54" stroke-width="4"/></symbol>
<symbol id="arch" viewBox="-45 -65 90 75"><path d="M-35 0V-54H35V0H13V-23Q0-44-13-23V0Z" fill="#d9c39a" stroke="#71634b" stroke-width="3"/><path d="M-39-54H39M-30-43H30M-27-33V-8M27-33V-8" stroke="#ad966e" stroke-width="4"/></symbol></defs><g id="scene"></g></svg>
<div class="compass" aria-hidden="true">N<br><span>↑</span></div><div class="diagram-nav" role="toolbar" aria-label="地图缩放"><button data-view="fit-all" title="适应全图">全图</button><button data-view="out" aria-label="缩小">−</button><button data-view="reset" title="重置 100%"><span data-view-detail hidden></span><span data-view-percent>100%</span></button><button data-view="in" aria-label="放大">＋</button></div></div>
<div class="map-footer"><span>拖动：右键 / 空格＋左键　·　缩放：Ctrl / ⌘＋滚轮</span><button id="sources-toggle" aria-expanded="false" aria-controls="sources">© Paris · Natural Earth · Wikidata ↗</button></div><div id="sources" hidden>边界：<a href="https://www.naturalearthdata.com/">Natural Earth</a>（公共领域） · 行政区：<a href="https://opendata.paris.fr/explore/dataset/arrondissements/">© Ville de Paris</a>（<a href="https://opendatacommons.org/licenses/odbl/">ODbL</a>） · 坐标：<a href="https://www.wikidata.org/wiki/Wikidata:Licensing">Wikidata / CC0</a>。数据快照：2026-09-29；范围为法国本土及科西嘉岛。地标插画为原创装饰，不代表建筑占地。所有底图数据随源码提供。</div></section></main>
<script id="travel-data" type="application/json">${payload}</script><script>var Archify = {};function viewerText(key, values) { return key === 'viewer.nav.camera' || key === 'viewer.nav.camera.title' ? '重置到 100%' : key === 'viewer.nav.detail.full' ? '地图详情' : ''; }
${camera}
${read('runtime.js')}
</script><script>${threeBundle.replace(/<\/script/gi, '<\\/script')}</script>
<script type="text/plain" id="three-license">${threeLicense}</script></body></html>`;
if (process.argv.includes('--check')) {
  if (read('index.html') !== html) throw new Error('Travel artifact is stale; run node labs/travel/build.mjs');
} else {
  fs.writeFileSync(path.join(root, 'index.html'), html);
  console.log('Built labs/travel/index.html (offline, shared Archify camera)');
}
