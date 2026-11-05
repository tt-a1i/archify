import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { softwareNoticesHtml } from '../archify/renderers/shared/software-notices.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const previewPath = path.resolve(here, '..', 'archify', 'bin', 'preview.mjs');

// The preview server serves previewPage() verbatim. That function is a
// template literal with its inert license payload supplied, so cooking it yields the
// HTML a browser receives, without starting a server or a build.
function shellPage() {
  const source = fs.readFileSync(previewPath, 'utf8');
  const fnStart = source.indexOf('function previewPage()');
  assert.ok(fnStart >= 0, 'previewPage() not found in preview.mjs');
  const openTick = source.indexOf('`', source.indexOf('return', fnStart));
  assert.ok(openTick > fnStart, 'previewPage() template literal not found');
  let i = openTick + 1;
  let closeTick = -1;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === '`') {
      closeTick = i;
      break;
    }
    i += 1;
  }
  assert.ok(closeTick > openTick, 'previewPage() template literal not terminated');
  return vm.runInNewContext(source.slice(openTick, closeTick + 1), { softwareNoticesHtml });
}

function shellScript() {
  const page = shellPage();
  const script = page.match(/<script>\n([\s\S]*?)\n  <\/script>/)?.[1];
  assert.ok(script, 'preview shell script missing');
  assert.doesNotThrow(() => new vm.Script(script));
  return script;
}

// Minimal DOM for the shell script: the header/body elements it touches and
// an EventSource stub whose 'state' listener the test drives with the exact
// payloads the preview server broadcasts.
function runShell(script) {
  const elements = {};
  function element(id) {
    return (elements[id] ??= {
      id,
      textContent: '',
      hidden: false,
      open: false,
      src: null,
      addEventListener() {},
    });
  }
  const body = { dataset: { state: 'checking', hasArtifact: 'false' } };
  let stateListener = null;
  const sandbox = {
    document: {
      body,
      getElementById: (id) => element(id),
    },
    EventSource: function () {
      this.addEventListener = (_type, fn) => {
        stateListener = fn;
      };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'preview-shell.js' });
  assert.ok(stateListener, 'shell did not subscribe to state events');
  return {
    body,
    status: element('status'),
    artifact: element('artifact'),
    send(state) {
      stateListener({ data: JSON.stringify(state) });
    },
  };
}

function needsFix(revision) {
  return {
    schemaVersion: 1,
    status: 'needs-fix',
    generation: 2,
    revision,
    lastVerified: revision ? { sha256: 'a'.repeat(64) } : null,
    failure: { stage: 'render', message: 'boom' },
  };
}

function verified(revision) {
  return {
    schemaVersion: 1,
    status: 'verified',
    generation: revision,
    revision,
    lastVerified: { sha256: String(revision).repeat(64) },
    failure: null,
  };
}

test('preview shell: a fresh client arriving in needs-fix does not claim a shown revision', () => {
  const shell = runShell(shellScript());
  // The server still reports the last verified revision while the source is
  // broken, but this client never loaded an artifact.
  shell.send(needsFix(1));
  assert.equal(shell.status.textContent, 'Needs fix · no verified revision');
  assert.equal(shell.body.dataset.hasArtifact, 'false');
  assert.equal(shell.artifact.src, null);
});

test('preview shell: a client that verified keeps naming its shown revision in needs-fix', () => {
  const shell = runShell(shellScript());
  shell.send(verified(1));
  assert.equal(shell.status.textContent, 'Verified · rev 1');
  assert.equal(shell.body.dataset.hasArtifact, 'true');
  shell.send(needsFix(1));
  assert.equal(shell.status.textContent, 'Needs fix · showing rev 1');
});

test('preview shell: the shown revision tracks the loaded revision across re-verifies', () => {
  const shell = runShell(shellScript());
  shell.send(verified(1));
  shell.send(needsFix(1));
  shell.send(verified(2));
  shell.send(needsFix(2));
  assert.equal(shell.status.textContent, 'Needs fix · showing rev 2');
});
