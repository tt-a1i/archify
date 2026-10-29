import fs from 'node:fs';
import {renderExplainer} from '/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/archify/explainer/render.mjs';
const root='/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading/openrsync-slash';
const page=fs.readFileSync(root+'/candidate.html','utf8'),prepared=JSON.parse(page.match(/<script type="application\/json" id="archify-explainer-prepared">([\s\S]*?)<\/script>/)[1]);
prepared.preparedSources.sources.probe.text=fs.readFileSync(root+'/source/probe-1.json','utf8');prepared.preparedSources.sources.probe.lines=[1,14];
const output='/Users/tsk/.local/share/archify-tuning/rounds/2026-10-30-reading-round32';
fs.writeFileSync(output+'/fixture-prepared.json',JSON.stringify(prepared,null,2)+'\n');fs.writeFileSync(output+'/fixture-base.html',renderExplainer(prepared.document,{preparedSources:prepared.preparedSources,preparedDiagrams:prepared.preparedDiagrams,sourceText:JSON.stringify(prepared.document)}));
