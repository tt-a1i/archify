(() => {
  const data=(window.TravelData||JSON.parse(document.getElementById('travel-data').textContent));let trip=data.trip;let lastFamily='';
  const isShanghai=()=>['shanghai','disney'].includes(Archify.travel.scene());
  const $=id=>document.getElementById(id),atlas=Archify.travel;
  const panel=document.createElement('section');panel.className='trip-panel';panel.setAttribute('aria-label','一句话行程');
  panel.innerHTML='<form id="trip-form"><label for="trip-prompt">一句话，开始一段旅行</label><textarea id="trip-prompt" rows="2">我有3天时间去法国玩，给我个推荐图</textarea><div class="trip-form-row"><label for="trip-date">出发日期（可选）<input id="trip-date" type="date"></label><button type="submit">生成推荐图 →</button></div><p id="trip-status" role="status">本地精选方案 · 支持上海及法国／巴黎三日游。</p></form><div id="trip-plan" hidden><div class="trip-plan-title"><strong>法国 3 天 · 巴黎慢游</strong><span>6 个景点 / 3 条步行路线</span></div><p class="trip-assumption">按已抵达巴黎、拥有 3 个完整游览日安排，市内住宿；不含往返法国的交通时间。</p><div id="trip-days" class="trip-days" aria-label="按天显示"></div><p id="trip-calendar" role="status"></p><div id="trip-schedule"></div><p class="trip-route-note">3D 空中箭头仅表示景点先后顺序，不代表道路。2D 地图保留 OSM 道路预览。步行按 4.2 km/h 估算，不含等候、馆内步行及实时封路。</p><button id="trip-download" type="button">下载三日行程 JSON</button></div>';
  $('intro').after(panel);
  const titles=['三日总览','第 1 天','第 2 天','第 3 天'];
  titles.forEach((title,day)=>{const b=document.createElement('button');b.type='button';b.textContent=title;b.dataset.day=day;b.addEventListener('click',()=>{const target=isShanghai()?(day===2?'disney':'shanghai'):'paris';if(atlas.scene()!==target)atlas.changeScene(target);$('day').value=String(day);$('search').value='';$('category').value='all';$('day').dispatchEvent(new Event('change'));Archify.travel3d?.focusDay(day);});$('trip-days').append(b);});
  function render(){
    panel.hidden=false;trip=isShanghai()?data.shanghaiTrip:data.trip;
    const family=isShanghai()?'shanghai':'paris';if(family!==lastFamily){$('trip-prompt').value=trip.prompt;$('trip-status').textContent='当前为'+trip.title+'精选方案；尚未确认门票与开放。';lastFamily=family;}
    const isParis=atlas.scene()==='paris',day=Number($('day').value);$('trip-plan').hidden=atlas.scene()==='france';if(atlas.scene()==='france')return;
    document.querySelector('.trip-plan-title strong').textContent=trip.title;document.querySelector('.trip-plan-title span').textContent=isParis?'6 个景点 / 3 条步行路线':'3 天 / 6 处停靠 / 迪士尼独立视窗';
    document.querySelector('.trip-assumption').textContent=trip.assumption||'按已抵达巴黎、拥有 3 个完整游览日安排，市内住宿；不含往返法国的交通时间。';
    document.querySelector('.trip-route-note').textContent=isParis?'3D 箭头仅表示顺序；2D 为 OSM 步行预览，非实时导航。':'箭头仅表示游览顺序，不是步行导航。第 2 天单独显示迪士尼位置；市中心与园区之间需另行安排交通。';
    $('trip-days').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.day)===day)));
    const date=$('trip-date').value,start=date?new Date(date+'T12:00:00'):null;
    const warnings=[];if(start)for(const d of trip.days){const at=new Date(start);at.setDate(at.getDate()+d.day-1);if(isParis&&d.day===2&&[1,2].includes(at.getDay()))warnings.push('第 2 天为'+(at.getDay()===1?'周一，奥赛闭馆':'周二，卢浮宫闭馆')+'：需调整博物馆日，当前排程未确认可用。');if((at.getMonth()===0&&at.getDate()===1)||(at.getMonth()===4&&at.getDate()===1)||(at.getMonth()===11&&at.getDate()===25))warnings.push('行程遇节假日，请逐项核对开放。');}
    $('trip-calendar').textContent=warnings.length?warnings.join(' '):start?'日期已标注；预约库存和临时闭馆仍需在官网核对。':'尚未指定日期。博物馆日需避开周一（奥赛）和周二（卢浮宫），可与其他两天对调。';
    if(!isParis)$('trip-calendar').textContent='建议时段，不是景区营业时间。迪士尼开园、演出与门票以所选日期的官方日历为准；未核验票务。';
    $('trip-schedule').replaceChildren();
    for(const d of trip.days.filter(d=>!day||day===d.day)){
      const section=document.createElement('section');section.className='schedule-day';section.style.setProperty('--day-color',d.color);
      const h=document.createElement('h2');h.textContent=`DAY ${d.day} · ${d.title}`;if(start){const date=new Date(start);date.setDate(date.getDate()+d.day-1);h.textContent+=' · '+date.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});}section.append(h);
      d.stops.forEach((s,i)=>{const p=data.places.find(p=>p.id===s.id),button=document.createElement('button');button.className='schedule-stop';button.dataset.place=p.id;button.classList.toggle('selected',atlas.selected()===p.id);
        const time=document.createElement('span');time.className='stop-time';time.textContent=s.time;const body=document.createElement('span'),name=document.createElement('strong'),note=document.createElement('small');name.textContent=`${i+1}. ${p.name} · ${s.duration}`;note.textContent=s.note;body.append(name,note);button.append(time,body);
        button.addEventListener('click',()=>{if(atlas.scene()!==p.scene)atlas.changeScene(p.scene);if(!atlas.visible().includes(p.id)){$('search').value='';$('category').value='all';$('day').value=String(d.day);$('day').dispatchEvent(new Event('change'));}atlas.select(p.id);Archify.travel3d?.focus(p.id);});section.append(button);
        if(trip.official[p.id]){const link=document.createElement('a');link.href=trip.official[p.id];link.textContent='官方开放与预约 ↗';link.target='_blank';link.rel='noopener noreferrer';link.className='booking-link';section.append(link);}
        if(i<d.stops.length-1){const route=trip.routes.find(r=>r.day===d.day),transfer=document.createElement('p');transfer.className='schedule-transfer';transfer.textContent=isParis?`↓ 道路步行约 ${(route.meters/1000).toFixed(1)} km / ${route.walkMinutes} 分钟 · 入口连接另计`:'↓ 按顺序前往下一站 · 地图连线非道路导航';section.append(transfer);}
      });const extra=document.createElement('p');extra.className='schedule-extra';extra.textContent=d.extra;section.append(extra);$('trip-schedule').append(section);
    }
  }
  $('trip-form').addEventListener('submit',e=>{e.preventDefault();const prompt=$('trip-prompt').value;
    if(!/(上海|shanghai|法国|巴黎|france|paris)/i.test(prompt)||!/(3|三)\s*(天|日|days?)/i.test(prompt)){$('trip-status').textContent='当前支持上海或法国／巴黎 3 天精选方案；未为这条需求生成新行程。';return;}
    const sh=/(上海|shanghai)/i.test(prompt);$('trip-status').textContent=sh?'已生成上海三日精选方案：陆家嘴、东方明珠、环球金融中心、迪士尼、豫园与外滩。':'已生成法国三日精选方案：以巴黎为基地，每天两处主要景点。';atlas.changeScene(sh?'shanghai':'paris');render();Archify.travel3d?.setMode(true);Archify.travel3d?.reset();
  });
  $('trip-date').addEventListener('change',render);
  $('trip-download').addEventListener('click',()=>{const b=new Blob([JSON.stringify({visualStyle:data.visualStyle,title:trip.title,departure:$('trip-date').value||null,days:trip.days,routes:trip.routes.map(({points,...r})=>r),provenance:trip.provenance},null,2)],{type:'application/json'}),url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download=(isShanghai()?'shanghai':'france')+'-three-days.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  window.addEventListener('archify:travel-change',render);window.addEventListener('archify:travel-select',()=>document.querySelectorAll('.schedule-stop').forEach(b=>b.classList.toggle('selected',b.dataset.place===atlas.selected())));
  render();
})();
