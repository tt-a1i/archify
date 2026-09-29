import {compileWorkflow} from '../../archify/renderers/workflow/workflow-compiler.mjs';

// The flowchart and diorama consume the same ordered stops and stable place IDs.
export function buildFlow(trip, places) {
  const workflow={schema_version:2,diagram_type:'workflow',meta:{title:trip.title,locale:'zh-CN',output:'travel.html',legend:{mode:'hidden'}},
    lanes:[],nodes:[],edges:[]};
  for(const day of trip.days)for(let start=0;start<day.stops.length;start+=6)workflow.lanes.push({id:'day'+day.day+(start?'-'+Math.floor(start/6):''),label:`第 ${day.day} 天 · ${day.title}${start?'（续）':''}`});
  for(const day of trip.days) for(const [i,stop] of day.stops.entries()) {
    workflow.nodes.push({id:stop.id,lane:'day'+day.day+(i>=6?'-'+Math.floor(i/6):''),col:i%6,type:['frontend','backend','external'][(day.day-1)%3],label:places.find(p=>p.id===stop.id).name,sublabel:`${stop.time} · ${stop.duration}`,width:190});
    if(i)workflow.edges.push({from:day.stops[i-1].id,to:stop.id,role:'main',label:'下一站'});
  }
  const result=compileWorkflow({workflow});
  if(!result.ok)throw Error(JSON.stringify(result.diagnostics));
  return {workflow,svg:result.svg};
}
