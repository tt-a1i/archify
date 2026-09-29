import {compileWorkflow} from '../../archify/renderers/workflow/workflow-compiler.mjs';

// The flowchart and diorama consume the same ordered stops and stable place IDs.
export function buildFlow(trip, places) {
  const workflow={schema_version:2,diagram_type:'workflow',meta:{title:trip.title,locale:'zh-CN',output:'travel.html',legend:{mode:'hidden'}},
    lanes:trip.days.map(d=>({id:'day'+d.day,label:`第 ${d.day} 天 · ${d.title}`})),nodes:[],edges:[]};
  for(const day of trip.days) for(const [i,stop] of day.stops.entries()) {
    workflow.nodes.push({id:stop.id,lane:'day'+day.day,col:i,type:['frontend','backend','external'][day.day-1],label:places.find(p=>p.id===stop.id).name,sublabel:`${stop.time} · ${stop.duration}`,width:190});
    if(i)workflow.edges.push({from:day.stops[i-1].id,to:stop.id,role:'main',label:'下一站'});
  }
  const result=compileWorkflow({workflow});
  if(!result.ok)throw Error(JSON.stringify(result.diagnostics));
  return {workflow,svg:result.svg};
}
