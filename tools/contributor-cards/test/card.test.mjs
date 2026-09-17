import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recordFromPull, cardHtml, renderCard, prNumber, validRepository } from '../card.mjs';
export const pull = {
  number: 394, title: 'chore(review): reduce repeated CodeRabbit evidence requests',
  merged: true, merged_at: '2026-09-12T02:23:34Z', merge_commit_sha: '6db72a9aea3d0f67a6a034e41f8a5491476a11c1',
  user: { login: 'tt-a1i', type: 'User' }, base: { repo: { full_name: 'tt-a1i/archify' } },
};

test('only authentic merged records are accepted; metadata is not inferred from example text', () => {
  assert.equal(recordFromPull(pull, 'tt-a1i/archify').author, 'tt-a1i');
  for (const patch of [{merged:false},{merged_at:null},{merge_commit_sha:'bad'},{user:{login:'bot[bot]',type:'Bot'}},{user:{login:'../bad',type:'User'}},{title:''},{base:{repo:{full_name:'someone/else'}}}]) {
    assert.throws(() => recordFromPull({...pull,...patch}, 'tt-a1i/archify'));
  }
  for (const value of ['0','-1','1; echo bad','1/2','01','1\n']) assert.throws(()=>prNumber(value));
  for (const value of ['../repo','https://github.com/x/y','x/y/z']) assert.throws(()=>validRepository(value));
});

test('untrusted PR text is escaped, assets are embedded, and no false verified status is emitted', async () => {
  const record = recordFromPull({...pull,title:'修复 · <img src=x onerror="alert(1)"> {{AUTHOR}}'}, 'tt-a1i/archify');
  const html = await cardHtml(record);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; {{AUTHOR}}'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('·'));
  assert.ok(!html.includes('Merged and verified'));
  assert.ok(!html.includes('Sample record'));
  assert.ok(!html.includes('./assets/'));
  assert.ok(html.includes('Content-Security-Policy'));
  assert.ok(html.includes('2026-09-12 UTC'));
});

test('real browser fits long GitHub usernames, long unbroken titles and Chinese descriptions', {timeout:90000}, async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(),'archify-card-test-'));
  try {
    for (const [number, login, title] of [
      [394,'tt-a1i',pull.title],
      [395,'W'.repeat(39),'W'.repeat(256)],
      [396,'contributor','修复复杂架构图中的边界重叠问题，并改善中文说明和长标题在贡献卡上的排版效果。'.repeat(3)],
      [397,'contributor','<script>document.body.remove()</script> & safe text'],
    ]) {
      const record=recordFromPull({...pull,number,title,user:{type:'User',login}},'tt-a1i/archify');
      const result=await renderCard(record,output);
      assert.deepEqual(result.receipt.clipped,[]);
      if(number===395) { assert.equal(result.receipt.fitted[0].wrapped,true); assert.equal(result.receipt.fitted[1].truncated,true); }
      assert.ok(result.receipt.text.includes('@'+login));
      assert.ok(result.receipt.text.includes('Merged'));
      const png=await fs.readFile(result.stem+'.png');
      assert.equal(png.readUInt32BE(16),1000);
      assert.equal(png.readUInt32BE(20),1500);
    }
  } finally { await fs.rm(output,{recursive:true,force:true}); }
});

test('titles that become empty cannot create a blank contribution field', async () => {
  for (const title of ['·', ' • ', '\u202e\u2066', '\u0001 · • \u200f']) {
    assert.throws(() => recordFromPull({...pull, title}, 'tt-a1i/archify'), /no displayable text/);
    const record = recordFromPull(pull, 'tt-a1i/archify');
    await assert.rejects(cardHtml({...record, title}), /no displayable text/);
  }
});
