import assert from 'node:assert/strict';
import test from 'node:test';
import { publishCard } from '../github.mjs';
const record={repository:'tt-a1i/archify',number:394,author:'tt-a1i',title:'A contribution',mergedAt:'2026-09-12T02:23:34Z',mergeCommit:'a'.repeat(40),url:'https://github.com/tt-a1i/archify/pull/394',templateVersion:1};
const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(1000,16);png.writeUInt32BE(1500,20);
for (const failure of ['fetch','body']) test(`public card verification retries a transient ${failure} read before replying`,async t=>{
 let reads=0,comments=0;
 t.mock.method(globalThis,'fetch',async()=>{
  reads++;
  if(reads===1 && failure==='fetch') throw new TypeError('fetch failed');
  return {ok:true,arrayBuffer:async()=>{
   if(reads===1 && failure==='body') throw new TypeError('body stream reset');
   return png;
  }};
 });
 const api=async(route,{method='GET'}={})=>{
  if(route.includes('/git/ref/')) return null;
  if(route.includes('/git/')) return {sha:'a'.repeat(40),object:{sha:'a'.repeat(40)}};
  if(route.includes('/commits?')) return [{sha:'a'.repeat(40)}];
  if(route.includes('/comments?')) return [];
  if(route.endsWith('/comments') && method==='POST'){comments++;assert.equal(reads,2,'do not reply until bytes have been verified');return {html_url:'https://github.com/tt-a1i/archify/pull/394#issuecomment-1'};}
  throw new Error('Unexpected API '+route);
 };
 await publishCard(api,record,png);
 assert.equal(reads,2);assert.equal(comments,1);
});
