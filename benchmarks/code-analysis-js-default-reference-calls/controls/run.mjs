// Authored ESM controls only; never import/execute upstream project code.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const cases={
 stable:'function chosen(){return "original";} export default chosen;',
 localAlias:'function chosen(){return "original";} export {chosen as default};',
 shadow:'function chosen(){return "original";} function unused(chosen){chosen=()=>"replacement";} export default chosen;',
 assignment:'function chosen(){return "original";} function replacement(){return "replacement";} chosen=replacement; export default chosen;',
 destructure:'function chosen(){return "original";} function replacement(){return "replacement";} [chosen]=[replacement]; export default chosen;',
 objectDestructure:'function chosen(){return "original";} function replacement(){return "replacement";} ({value:chosen}={value:replacement}); export default chosen;',
 loop:'function chosen(){return "original";} function replacement(){return "replacement";} for(chosen of [replacement]){} export default chosen;',
 directEval:'function chosen(){return "original";} function replacement(){return "replacement";} eval("chosen=replacement"); export default chosen;',
};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-default-reference-oracle-'));const rows=[];
try{for(const[name,source]of Object.entries(cases)){
 const target=path.join(root,name+'.mjs'),entry=path.join(root,name+'-entry.mjs');fs.writeFileSync(target,source);fs.writeFileSync(entry,`import run from './${name}.mjs';console.log(run());`);
 const r=spawnSync(process.execPath,[entry],{encoding:'utf8'});const expected=['stable','localAlias','shadow'].includes(name)?'original':'replacement';if(r.status!==0||r.stdout.trim()!==expected)throw new Error(name+': '+r.stderr);
 rows.push({name,source,exit:r.status,actual:r.stdout.trim(),expected,newSourceNavigation:['stable','localAlias','shadow'].includes(name)?'chosen declaration':'unknown; value changed or opaque eval'});
}}finally{fs.rmSync(root,{recursive:true,force:true});}
const report={stage:'Replay of authored controls frozen before product implementation',node:process.version,scope:'Authored ESM execution establishes value/namespace controls; upstream source is not executed.',rows};if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(rows.map(r=>({name:r.name,result:r.actual}))));
