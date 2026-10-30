import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script=fileURLToPath(new URL('../scripts/publish-star-history.sh',import.meta.url));
for (const status of [2,128]) test(`star history distinguishes remote absence from failure (${status})`, t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-star-remote-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bin=path.join(root,'bin'),temp=path.join(root,'temp');fs.mkdirSync(bin);fs.mkdirSync(temp);
 fs.writeFileSync(path.join(bin,'git'),`#!/bin/sh\necho "$*" >> "$GIT_LOG"\nif [ "$1" = ls-remote ]; then exit ${status}; fi\nexit 0\n`,{mode:0o755});
 fs.mkdirSync(path.join(root,'assets'));fs.writeFileSync(path.join(root,'assets/light.svg'),'light');fs.writeFileSync(path.join(root,'assets/dark.svg'),'dark');
 const log=path.join(root,'git.log');
 const run=spawnSync('bash',[script,'data','assets/light.svg','assets/dark.svg'],{cwd:root,encoding:'utf8',env:{...process.env,PATH:`${bin}${path.delimiter}${process.env.PATH}`,RUNNER_TEMP:temp,GIT_LOG:log}});
 const calls=fs.readFileSync(log,'utf8');
 if(status===2){assert.equal(run.status,0,run.stderr);assert.match(calls,/switch --orphan data/);}
 else {assert.notEqual(run.status,0,'remote failure must not report a successful publication');assert.doesNotMatch(calls,/^(switch|rm|push)\b/m);assert.deepEqual(fs.readdirSync(temp),[]);}
 assert.equal(fs.readFileSync(path.join(root,'assets/light.svg'),'utf8'),'light');assert.equal(fs.readFileSync(path.join(root,'assets/dark.svg'),'utf8'),'dark');
});
