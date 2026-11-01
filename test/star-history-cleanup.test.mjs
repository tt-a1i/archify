import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script=fileURLToPath(new URL('../scripts/publish-star-history.sh',import.meta.url));
test('star history publication cleans its emptied temporary snapshot', t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-star-cleanup-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bin=path.join(root,'bin'),temp=path.join(root,'temp'); fs.mkdirSync(bin);fs.mkdirSync(temp);
 fs.writeFileSync(path.join(bin,'git'),'#!/bin/sh\nexit 0\n',{mode:0o755});
 fs.mkdirSync(path.join(root,'assets'));fs.writeFileSync(path.join(root,'assets/light.svg'),'light');fs.writeFileSync(path.join(root,'assets/dark.svg'),'dark');
 const result=spawnSync('bash',[script,'data','assets/light.svg','assets/dark.svg'],{cwd:root,encoding:'utf8',env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,RUNNER_TEMP:temp}});
 assert.equal(result.status,0,result.stderr);
 assert.equal(fs.readFileSync(path.join(root,'assets/light.svg'),'utf8'),'light');assert.equal(fs.readFileSync(path.join(root,'assets/dark.svg'),'utf8'),'dark');
 assert.deepEqual(fs.readdirSync(temp),[],'completed publication leaves no snapshot directory');
});
