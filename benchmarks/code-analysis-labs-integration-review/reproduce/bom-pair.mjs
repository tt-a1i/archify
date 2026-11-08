import {captureChangeSide,buildChangeQuestion} from './candidate/archify/modules/code-analysis/lib/change-question.mjs';
import {loadConfig} from './candidate/archify/modules/code-analysis/lib/analysis.mjs';
import fs from 'node:fs';
const root=new URL('./fixtures/py-bom',import.meta.url).pathname,config=loadConfig();
const base=captureChangeSide(root,config,'py'),head=captureChangeSide(root,config,'py');
const q=buildChangeQuestion({question:'Does unchanged source remain fresh?',entry:'entry.py',base,head,config});
const r={revision:'996e073ded7b99cbe885fbc4afab5d125412f6c1',expected:{status:'ready',baseIdentity:'valid',headIdentity:'valid',baseCoverage:'available',headCoverage:'available'},observed:{status:q.status,baseIdentity:q.sides.base.sourceIdentity,headIdentity:q.sides.head.sourceIdentity,baseCoverage:q.definitionCoverage.base,headCoverage:q.definitionCoverage.head},brief:q};
fs.writeFileSync(new URL('./bom-pair.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify({...r,brief:undefined},null,2));
