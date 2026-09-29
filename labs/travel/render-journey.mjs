import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateJourney} from './journey.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
try{
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw Error('Usage: node labs/travel/render-journey.mjs input.journey.json output.html (or --check)');
  if(fs.statSync(input).size>32*1024*1024)throw Error('Input exceeds 32 MiB; split detailed geometry by day.');
  const candidate=validateJourney(JSON.parse(fs.readFileSync(input,'utf8')));
  if(output!=='--check'){
    if(path.resolve(input)===path.resolve(output))throw Error('Output must not replace source JSON');
    const result=spawnSync(process.execPath,[path.join(root,'build.mjs'),'--candidate',path.resolve(input),'--output',path.resolve(output)],{encoding:'utf8',windowsHide:true});
    if(result.status!==0)throw Error(result.stderr||result.error?.message||'Build failed');
  }
  console.log(JSON.stringify({ok:true,days:candidate.days.length,stops:candidate.days.reduce((n,d)=>n+d.stops.length,0),output:output==='--check'?null:path.resolve(output),generator:'host-authored-journey-v1',validation:'passed',visualReview:'not-performed'},null,2));
}catch(error){console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;}
