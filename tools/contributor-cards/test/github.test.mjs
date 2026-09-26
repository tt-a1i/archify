import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {publishCard, commentBody} from '../github.mjs';
const record={repository:'tt-a1i/archify',number:394,author:'tt-a1i',title:'A contribution',mergedAt:'2026-09-12T02:23:34Z',mergeCommit:'a'.repeat(40),url:'https://github.com/tt-a1i/archify/pull/394',templateVersion:1};
const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(1000,16);png.writeUInt32BE(1500,20);
function mock({failComment=false,conflict=false}={}) {
 const state={ref:null,tree:[],blobs:new Map(),comments:[],updates:0,posts:0,refWrites:0,commits:0};
 const api=async(route,{method='GET',body}={})=>{
  const short=route.replace('/repos/tt-a1i/archify','');
  if(short==='/git/ref/heads/contributor-cards') return state.ref?{object:{sha:state.ref}}:null;
  if(short.startsWith('/git/commits/') && method==='GET') return {tree:{sha:'tree'}};
  if(short.startsWith('/git/trees/') && method==='GET') return {tree:state.tree};
  if(short==='/git/blobs') {const b=Buffer.from(body.content,'base64');const sha=createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');state.blobs.set(sha,b);return {sha};}
  if(short==='/git/trees') {state.nextTree=body.tree;return {sha:'nextTree'};}
  if(short==='/git/commits') {state.commits++;return {sha:String(state.commits).padStart(40,'a')};}
  if(short==='/git/refs'||short==='/git/refs/heads/contributor-cards') {
   if(conflict){conflict=false;state.ref='other';state.tree=[{path:'cards/pr-1.png',sha:'other'}];throw new Error('GitHub PATCH ref failed (422)');}
   assert.notEqual(body.force,true);state.refWrites++;state.ref=body.sha;
   state.tree=[...state.tree.filter(e=>!state.nextTree.some(n=>n.path===e.path)),...state.nextTree];return {object:{sha:state.ref}};
  }
  if(short.startsWith('/commits?')) return [{sha:state.ref}];
  if(short.startsWith('/issues/394/comments?')) return state.comments;
  if(short==='/issues/394/comments') {
   if(failComment){failComment=false;throw new Error('temporary comment failure');}
   state.posts++;const comment={id:state.posts,user:{login:'github-actions[bot]'},body:body.body,html_url:'https://github.com/tt-a1i/archify/pull/394#issuecomment-1'};state.comments.push(comment);return comment;
  }
  if(short.startsWith('/issues/comments/')) {state.updates++;Object.assign(state.comments.find(c=>c.id===Number(short.split('/').at(-1))),body);return state.comments.find(c=>c.id===Number(short.split('/').at(-1)));}
  throw new Error('Unexpected API '+method+' '+short);
 };
 return {api,state};
}
const options={verifyImage:async()=>{}};
test('reruns do not duplicate comments or commit identical content',async()=>{
 const {api,state}=mock();
 await publishCard(api,record,png,options);
 await publishCard(api,record,png,options);
 assert.equal(state.posts,1);assert.equal(state.updates,0);assert.equal(state.refWrites,1);
});
test('retry after a comment failure reuses the existing image',async()=>{
 const {api,state}=mock({failComment:true});
 await assert.rejects(publishCard(api,record,png,options),/temporary comment/);
 await publishCard(api,record,png,options);
 assert.equal(state.posts,1);assert.equal(state.refWrites,1);
});
test('concurrent branch updates preserve another PR card and never force-push',async()=>{
 const {api,state}=mock({conflict:true});
 await publishCard(api,record,png,options);
 assert.ok(state.tree.some(e=>e.path==='cards/pr-1.png'));
 assert.equal(state.posts,1);
});
test('a user spoofing the marker cannot become the bot-owned reply',async()=>{
 const {api,state}=mock();
 state.comments.push({id:99,user:{login:'attacker'},body:commentBody(record,'fake')});
 await publishCard(api,record,png,options);
 assert.equal(state.updates,0);assert.equal(state.posts,1);assert.equal(state.comments[0].id,99);
});
test('unavailable public image prevents sending the reply',async()=>{
 const {api,state}=mock();
 await assert.rejects(publishCard(api,record,png,{verifyImage:async()=>{throw new Error('not available');}}));
 assert.equal(state.posts,0);
});
test('updated image updates the existing bot reply',async()=>{
 const {api,state}=mock();
 await publishCard(api,record,png,options);
 const changed=Buffer.concat([png,Buffer.from('new render')]);
 await publishCard(api,record,changed,options);
 assert.equal(state.posts,1);assert.equal(state.updates,1);
});
test('finds the existing bot reply beyond the first comment page',async()=>{
 const {api,state}=mock();
 await publishCard(api,record,png,options);
 const wrapped=async(route,args)=>{
   if(route.includes('/comments?') && route.endsWith('page=1')) return Array.from({length:100},(_,id)=>({id,user:{login:'someone'},body:'Discussion'}));
   if(route.includes('/comments?') && route.endsWith('page=2')) return state.comments;
   return api(route,args);
 };
 await publishCard(wrapped,record,png,options);
 assert.equal(state.posts,1);assert.equal(state.updates,0);
});
