#!/usr/bin/env node
// Supplemental registered viewport, using the frozen common checker's own browser.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [skill, artifact, out] = process.argv.slice(2);
if (!skill || !artifact || !out) throw new Error('usage: capture-1920.mjs SKILL ARTIFACT OUT');
const {ChromeVisualBrowser} = await import(pathToFileURL(path.resolve(skill,'bin/visual-check.mjs')));
const hash = () => createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
const before=hash();fs.mkdirSync(out,{recursive:true});const started=performance.now();
const browser=new ChromeVisualBrowser(process.env.ARCHIFY_CHROME);
const rows=[];
try { for(const theme of ['light','dark']) {
  const screenshot=path.resolve(out,`1920x1080.${theme}.png`);
  const metrics=await browser.inspect({artifactPath:path.resolve(artifact),width:1920,height:1080,theme,screenshotPath:screenshot});
  rows.push({theme,width:1920,height:1080,screenshot:path.basename(screenshot),sha256:createHash('sha256').update(fs.readFileSync(screenshot)).digest('hex'),metrics});
}} finally {await browser.close();}
if(hash()!==before) throw new Error('Artifact changed during capture');
fs.writeFileSync(path.join(out,'1920-captures.json'),JSON.stringify({artifact_sha256:before,duration_ms:performance.now()-started,rows,visual_review:'pending'},null,2)+'\n');
