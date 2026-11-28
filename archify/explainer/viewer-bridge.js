(()=>{
      // The page around this Viewer names the diagram, so the preset's standalone badges stay off.
      document.documentElement.dataset.hosted='explainer';
      const token=document.querySelector('meta[name=archify-explainer-frame-token]')?.content;
      if (!token) return;
      let pending=null;
      const settle=data=>requestAnimationFrame(()=>{
        if(pending!==data)return;
        if(Array.isArray(data.edges)&&data.edges.length&&Array.isArray(data.nodes)){
          if(window.Archify?.focus?.setMany)window.Archify.focus.setMany(data.nodes,{toggle:false,mode:'selection',updateUrl:false});
          document.querySelectorAll('[data-edge-id]').forEach(edge=>{if(data.edges.includes(edge.dataset.edgeId))edge.setAttribute('data-focus-match','');else edge.removeAttribute('data-focus-match');});
        }
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          if(pending!==data)return;
          pending=null;
          const active=document.querySelector('svg[data-focus-active]');
          const selected=Array.from(document.querySelectorAll('[data-focus-selected]')).map(node=>node.dataset.nodeId);
          const matched=Array.from(document.querySelectorAll('[data-edge-id][data-focus-match]')).map(edge=>edge.dataset.edgeId);
          parent.postMessage({kind:'archify-explainer-focus-result',token,nodes:[...new Set(selected)],edges:[...new Set(matched)],active:active?.dataset.focusActive||''},'*');
        }));
      });
      // The native hash listeners restore focus before the explicit host selection.
      addEventListener('hashchange',()=>{if(pending&&location.hash.slice(1)===pending.hash)settle(pending);});
      addEventListener('message',event=>{
        const data=event.data;
        if(event.source!==parent||data?.kind!=='archify-explainer-host'||data.token!==token)return;
        if(['light','dark'].includes(data.theme))document.documentElement.dataset.theme=data.theme;
        if(['classic','editorial'].includes(data.preset))window.Archify?.preset?.apply?.(data.preset);
        if(typeof data.hash!=='string'||!/^(?:|focus=[^&]+|route=[^&]+~[^&]+)$/.test(data.hash))return;
        pending=data;
        if(location.hash.slice(1)===data.hash)dispatchEvent(new HashChangeEvent('hashchange'));
        else location.hash=data.hash;
      });
      addEventListener('keydown',event=>{if(event.key==='Escape')parent.postMessage({kind:'archify-explainer-escape',token},'*');},true);
      const ready=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>parent.postMessage({kind:'archify-explainer-ready',token},'*')));
      if(document.readyState==='complete')ready();else addEventListener('load',ready,{once:true});
    })();
