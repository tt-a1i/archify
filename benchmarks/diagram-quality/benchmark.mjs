#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareFromFiles} from './comparison.mjs';
import {attachHumanReview} from './records.mjs';
import {checkCorpus,verifyFiles} from './verification.mjs';
export {sha256,evaluatorHash,checkCorpus,verifyFiles,probeEditability} from './verification.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const allowed={check:['manifest'],verify:['manifest','task','source','artifact','run','chrome','screenshot','output'],compare:['plan','output','reviews'],review:['receipt','review','output']};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export async function main(argv) {
 const [command,...args]=argv,options={};
 if(!allowed[command])throw Object.assign(new Error('Usage: benchmark.mjs check|verify|compare|review --option value'),{code:'USAGE'});
 for(let i=0;i<args.length;i+=2){
  const key=args[i]?.slice(2);
  if(!args[i]?.startsWith('--')||!allowed[command].includes(key)||options[key]!==undefined||!args[i+1]||args[i+1].startsWith('--'))
   throw Object.assign(new Error('Unknown, duplicate or missing option: '+args[i]),{code:'USAGE'});
  options[key]=args[i+1];
 }
 const required={check:[],verify:['task','source','artifact','run'],compare:['plan','output'],review:['receipt','review','output']};
 for(const field of required[command])if(!options[field])throw Object.assign(new Error('Missing --'+field),{code:'USAGE'});
 if(command==='check')return checkCorpus(read(options.manifest||path.join(here,'corpus.json')));
 if(command==='verify')return verifyFiles({...options,format:'archify'});
 if(command==='compare')return compareFromFiles(options);
 const result=attachHumanReview(read(options.receipt),read(options.review));
 fs.writeFileSync(options.output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try {console.log(JSON.stringify(await main(process.argv.slice(2))));}
 catch(error){console.log(JSON.stringify({error:{code:error.code==='USAGE'?'USAGE':'INVALID_MEASUREMENT',message:error.message}}));process.exitCode=2;}
}
