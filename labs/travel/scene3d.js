import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

// Render the same sourced geography and place state as the 2D atlas. No tiles,
// remote models, elevation claims, or second search/filter model are introduced.
const data = JSON.parse(document.getElementById('travel-data').textContent);
const atlas = window.Archify.travel;
const flat = document.querySelector('.diagram-container');
const heading = document.querySelector('.map-heading');
const modeButtons = document.createElement('div');
modeButtons.className = 'view-modes';
modeButtons.innerHTML = '<button id="mode-2d" type="button" aria-pressed="true">2D 地图</button><button id="mode-3d" type="button" aria-pressed="false">3D 探索</button>';
heading.append(modeButtons);
const stage = document.createElement('div');
stage.id = 'stage-3d'; stage.className = 'stage-3d'; stage.hidden = true;
stage.innerHTML = '<div class="three-labels"></div><div class="three-badge">立体旅行地图<span>地理轮廓真实 · 高度为艺术表现</span></div><div class="three-tools" role="toolbar" aria-label="3D 视角控制"><button id="orbit-left" title="向左旋转" aria-label="向左旋转">↶</button><button id="orbit-right" title="向右旋转" aria-label="向右旋转">↷</button><button id="orbit-top">俯视</button><button id="orbit-reset">复位</button><button id="orbit-spin" aria-pressed="false">自动旋转</button><button id="orbit-out" aria-label="3D 缩小">−</button><button id="orbit-in" aria-label="3D 放大">＋</button></div>';
flat.after(stage);
const labelLayer = stage.querySelector('.three-labels');
const footerHint = document.querySelector('.map-footer > span');
const originalHint = footerHint.textContent;
const exportButton = document.getElementById('export');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let renderer, camera, controls, scene, world, frame = 0, active = false, sceneId = '', failed = false;
let markers = [], labels = [], terrainCount = 0, pointerStart = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
const materials = new Map();
function material(color, roughness = .85, metalness = 0) {
  const key = [color,roughness,metalness].join(':');
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({color,roughness,metalness}));
  return materials.get(key);
}
function mesh(group, geometry, color, x, y, z, roughness, metalness) {
  const object = new THREE.Mesh(geometry, material(color,roughness,metalness));
  object.position.set(x,y,z); object.castShadow = true; object.receiveShadow = true; group.add(object); return object;
}
function box(group,w,h,d,color,x=0,y=h/2,z=0) {return mesh(group,new THREE.BoxGeometry(w,h,d),color,x,y,z);}
function beam(group, from, to, radius, color) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta=b.clone().sub(a);
  const object=mesh(group,new THREE.CylinderGeometry(radius,radius,delta.length(),5),color,...a.clone().add(b).multiplyScalar(.5).toArray(),.65,.2);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return object;
}
function landmark(p) {
  const group=new THREE.Group(); group.userData.placeId=p.id;
  const stone=0xd7c49b, dark=0x8d794f, roof=0x55726a;
  if(p.icon==='tower') {
    for(const x of [-1,1])for(const z of [-1,1]) {
      beam(group,[x*25,0,z*25],[x*12,47,z*12],3.2,dark);
      beam(group,[x*12,47,z*12],[x*5,91,z*5],2.2,dark);
      beam(group,[x*5,91,z*5],[0,132,0],1.3,dark);
    }
    box(group,40,5,40,stone,0,34,0);box(group,29,5,29,stone,0,61,0);box(group,14,3,14,stone,0,103,0);
    for(const z of [-1,1]){beam(group,[-19,20,z*19],[12,47,z*12],1.4,dark);beam(group,[19,20,z*19],[-12,47,z*12],1.4,dark);}
    beam(group,[0,130,0],[0,143,0],1.2,dark);
  } else if(p.icon==='museum') {
    box(group,88,24,25,stone,0,12,-24);box(group,20,24,52,stone,-36,12,4);box(group,20,24,52,stone,36,12,4);
    const pyramid=mesh(group,new THREE.ConeGeometry(26,32,4),0x7cb5b1,0,16,10,.25,.25);pyramid.rotation.y=Math.PI/4;
    for(let x=-35;x<=35;x+=14)box(group,5,12,1,roof,x,13,-10);
  } else if(p.icon==='church') {
    box(group,48,29,55,stone,0,14.5,-12);box(group,17,65,22,stone,-20,32.5,17);box(group,17,65,22,stone,20,32.5,17);
    box(group,27,33,23,stone,0,16.5,17);
    const gable=mesh(group,new THREE.ConeGeometry(26,19,4),roof,0,38,-10);gable.rotation.y=Math.PI/4;
    for(const x of [-20,20]){box(group,8,16,1,roof,x,46,28.6);box(group,8,8,1,roof,x,21,28.6);}
    const rose=mesh(group,new THREE.CylinderGeometry(7,7,1,16),0x6d959a,0,24,29);rose.rotation.x=Math.PI/2;
  } else {
    box(group,19,51,30,stone,-22,25.5,0);box(group,19,51,30,stone,22,25.5,0);box(group,63,19,34,stone,0,53,0);box(group,69,5,38,dark,0,65,0);
    for(const x of [-24,24])box(group,7,23,1,dark,x,28,15.6);
  }
  const [x,z]=p.point;group.position.set(x-700,sceneId==='paris'?18:22,z-525);
  group.scale.setScalar(sceneId==='paris'?.95:1.1);
  const marker=mesh(group,new THREE.CylinderGeometry(33,38,3,32),0xe8d6ab,0,1,0);
  marker.userData.base=true;world.add(group);markers.push(group);
  const button=document.createElement('button');button.className='three-label';button.dataset.place=p.id;
  const title=document.createElement('strong');title.textContent=p.name;const detail=document.createElement('span');detail.textContent=p.label;
  button.append(title,detail);button.addEventListener('click',()=>atlas.select(p.id));labelLayer.append(button);
  labels.push({button,p,anchor:new THREE.Vector3(x-700,20,z-525)});
}
function disposeWorld() {
  if(!world)return;
  world.traverse(object=>{object.geometry?.dispose();if(object.userData.disposeMaterial)object.material.dispose();});scene.remove(world);labelLayer.replaceChildren();markers=[];labels=[];
}
function rebuild() {
  if(!renderer)return;
  const next=atlas.scene(),changed=sceneId!==next;sceneId=next;disposeWorld();world=new THREE.Group();scene.add(world);terrainCount=0;
  const base=box(world,1440,12,1080,0xd6e3dd,0,-8,0);base.receiveShadow=true;
  const loader=new SVGLoader();
  for(const [index,region] of data.scenes[sceneId].paths.entries()) {
    const paths=loader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${region.d}" fill="#000" fill-rule="evenodd"/></svg>`).paths;
    for(const path of paths)for(const shape of SVGLoader.createShapes(path)) {
      const depth=sceneId==='paris'?18:22;
      const geometry=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:1,steps:1});
      geometry.translate(-700,-525,0);geometry.rotateX(Math.PI/2);
      const colors=sceneId==='paris'?[0xdbe2c3,0xcbd9b8,0xe5dfbd]:[0xcbd9ae];
      const tile=new THREE.Mesh(geometry,[material(colors[index%colors.length]),material(0x91a67d)]);tile.position.y=depth;tile.receiveShadow=true;tile.castShadow=true;world.add(tile);terrainCount++;
      const border=new THREE.LineSegments(new THREE.EdgesGeometry(geometry,25),new THREE.LineBasicMaterial({color:0x879a7a,transparent:true,opacity:.35}));
      border.position.y=depth+.15;border.userData.disposeMaterial=true;world.add(border);
    }
  }
  const visible=new Set(atlas.visible());
  const points=data.places.filter(p=>p.scene===sceneId&&visible.has(p.id));points.forEach(landmark);
  for(const day of [1,2]) {
    const route=points.filter(p=>p.day===day);if(route.length<2)continue;
    const vertices=route.map(p=>new THREE.Vector3(p.point[0]-700,(sceneId==='paris'?18:22)+2,p.point[1]-525));
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(vertices),new THREE.LineDashedMaterial({color:0xa97940,dashSize:8,gapSize:5}));line.computeLineDistances();line.userData.disposeMaterial=true;world.add(line);
  }
  if(changed)reset();selection();requestFrame();
}
function fitDistance() {return Math.max(1400/Math.max(camera.aspect,.25),1050)*1.85;}
function reset(top=false) {
  if(!camera)return;const distance=fitDistance();controls.target.set(0,0,0);
  camera.position.copy((top?new THREE.Vector3(0,1,.001):new THREE.Vector3(.45,.95,1)).normalize().multiplyScalar(distance));
  controls.update();requestFrame();
}
function selection() {if(!renderer)return;for(const {button,p} of labels)button.classList.toggle('selected',p.id===atlas.selected());requestFrame();}
function renderLabels() {
  const rect=stage.getBoundingClientRect(), occupied=[];
  const ordered=[...labels].sort((a,b)=>Number(b.p.id===atlas.selected())-Number(a.p.id===atlas.selected()));
  for(const label of ordered) {
    const point=label.anchor.clone().project(camera);const x=(point.x*.5+.5)*rect.width,y=(-point.y*.5+.5)*rect.height+16;
    const detailed=controls.getDistance()<1350;
    label.button.classList.toggle('detailed',detailed);
    label.button.hidden=false;const halfWidth=label.button.offsetWidth/2+5;const bounds={left:x-halfWidth,right:x+halfWidth,top:y,bottom:y+label.button.offsetHeight+5};
    const overlaps=occupied.some(b=>bounds.left<b.right&&bounds.right>b.left&&bounds.top<b.bottom&&bounds.bottom>b.top);
    const hide=point.z>1||point.z< -1||x<40||x>rect.width-40||y<0||y>rect.height-85||camera.position.y<0||overlaps;
    label.button.hidden=hide;
    if(!hide){label.button.style.transform=`translate(${x}px,${y}px) translateX(-50%)`;occupied.push(bounds);}
  }
  document.getElementById('detail-level').textContent=controls.getDistance()<1350?'3D · 地标细节':'3D · 拖动自由旋转';
}
function requestFrame() {if(!active||document.hidden||frame)return;frame=requestAnimationFrame(render);}
function render() {frame=0;if(!active||document.hidden)return;const changed=controls.update(Math.min(clock.getDelta(),.05));renderer.render(scene,camera);renderLabels();if(changed||controls.autoRotate)requestFrame();}
function resize() {if(!renderer||!active)return;const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);requestFrame();}
function pick(event) {
  if(!pointerStart||event.button!==0||Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>6)return;
  const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(markers,true)[0];if(!hit)return;
  let object=hit.object;while(object&&!object.userData.placeId)object=object.parent;if(object)atlas.select(object.userData.placeId);
}
function init() {
  try {renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});} catch(error) {
    failed=true;document.getElementById('mode-3d').disabled=true;document.getElementById('mode-3d').title='此浏览器未提供 WebGL 2，继续使用 2D 地图';
    const notice=document.createElement('p');notice.className='three-fallback';notice.setAttribute('role','status');notice.textContent='此浏览器暂不支持 3D，已保留可交互的 2D 地图。';heading.after(notice);return false;
  }
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0xe9efea);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','3D 地图：左键旋转，滚轮缩放，右键平移。方向键平移，R 复位。');stage.prepend(renderer.domElement);
  scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xfffaf0,0x768776,2.4));
  const sun=new THREE.DirectionalLight(0xfff1d4,3.1);sun.position.set(-450,1100,600);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-950,right:950,top:950,bottom:-950,near:1,far:3000});sun.shadow.bias=-.0006;scene.add(sun);
  camera=new THREE.PerspectiveCamera(40,1,1,10000);camera.position.set(900,1100,1300);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.1;controls.minDistance=180;controls.maxDistance=6500;controls.minPolarAngle=.02;controls.maxPolarAngle=Math.PI-.02;controls.autoRotateSpeed=.6;controls.screenSpacePanning=false;controls.listenToKeyEvents(renderer.domElement);
  controls.addEventListener('change',requestFrame);controls.addEventListener('start',requestFrame);
  renderer.domElement.addEventListener('pointerdown',event=>{pointerStart={x:event.clientX,y:event.clientY};renderer.domElement.focus({preventScroll:true});});
  renderer.domElement.addEventListener('pointerup',event=>{pick(event);pointerStart=null;});renderer.domElement.addEventListener('pointercancel',()=>{pointerStart=null;});
  renderer.domElement.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='r'){event.preventDefault();reset();}});
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();setMode(false);document.getElementById('mode-3d').title='3D 上下文已丢失，请刷新页面后重试';document.getElementById('mode-3d').disabled=true;});
  new ResizeObserver(resize).observe(stage);return true;
}
function setMode(want3d) {
  if(want3d&&failed)return;
  if(want3d&&!renderer&&!init())return;
  active=want3d;stage.hidden=!active;flat.hidden=active;
  document.getElementById('mode-3d').setAttribute('aria-pressed',String(active));document.getElementById('mode-2d').setAttribute('aria-pressed',String(!active));
  footerHint.textContent=active?'左键 / 单指旋转 · 滚轮 / 双指缩放 · 右键平移':originalHint;
  exportButton.textContent=active?'导出 3D 视角 PNG':'导出当前地图 SVG';
  if(active){resize();if(!world)rebuild();requestFrame();}else{if(frame)cancelAnimationFrame(frame);frame=0;Archify.view.fitAll();document.getElementById('detail-level').textContent='2D · 缩放探索';}
}
document.getElementById('mode-3d').addEventListener('click',()=>setMode(true));document.getElementById('mode-2d').addEventListener('click',()=>setMode(false));
document.getElementById('orbit-left').addEventListener('click',()=>{controls.rotateLeft(Math.PI/8);controls.update();requestFrame();});
document.getElementById('orbit-right').addEventListener('click',()=>{controls.rotateLeft(-Math.PI/8);controls.update();requestFrame();});
document.getElementById('orbit-top').addEventListener('click',()=>reset(true));document.getElementById('orbit-reset').addEventListener('click',()=>reset());
document.getElementById('orbit-in').addEventListener('click',()=>{controls.dollyIn(1/1.2);controls.update();requestFrame();});document.getElementById('orbit-out').addEventListener('click',()=>{controls.dollyOut(1/1.2);controls.update();requestFrame();});
document.getElementById('orbit-spin').addEventListener('click',event=>{controls.autoRotate=!controls.autoRotate;event.currentTarget.setAttribute('aria-pressed',String(controls.autoRotate));requestFrame();});
reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches&&controls){controls.autoRotate=false;document.getElementById('orbit-spin').setAttribute('aria-pressed','false');}});
window.addEventListener('archify:travel-change',rebuild);window.addEventListener('archify:travel-select',selection);
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=0;}else requestFrame();});
exportButton.addEventListener('click',event=>{
  if(!active)return;event.stopImmediatePropagation();renderer.render(scene,camera);
  const output=document.createElement('canvas');output.width=renderer.domElement.width;output.height=renderer.domElement.height+60;
  const ctx=output.getContext('2d');ctx.fillStyle='#e9efea';ctx.fillRect(0,0,output.width,output.height);ctx.drawImage(renderer.domElement,0,0);
  const ratio=renderer.getPixelRatio();ctx.fillStyle='#263f38';ctx.font=`${14*ratio}px sans-serif`;
  for(const label of labels){if(label.button.hidden)continue;const p=label.anchor.clone().project(camera);ctx.fillText(label.p.name,(p.x*.5+.5)*output.width-24*ratio,(-p.y*.5+.5)*renderer.domElement.height+32*ratio);}
  ctx.font='12px sans-serif';ctx.fillText('Natural Earth · © Ville de Paris (ODbL) · Wikidata (CC0) | Archify Travel · artistic heights',16,output.height-22);
  output.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='archify-travel-'+sceneId+'-3d.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');
},true);
window.Archify.travel3d={setMode,reset,state:()=>({active,failed,scene:sceneId,terrainCount,places:markers.map(m=>m.userData.placeId),camera:camera?.position.toArray(),target:controls?.target.toArray(),distance:controls?.getDistance(),azimuth:controls?.getAzimuthalAngle(),polar:controls?.getPolarAngle(),autoRotate:controls?.autoRotate,framesPending:Boolean(frame)})};
setMode(true);
