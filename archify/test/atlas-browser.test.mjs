import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  ChromeVisualBrowser,
  findChrome,
  runVisualCheck,
} from "../bin/visual-check.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test(
  "offline layered reading preserves overview state, keyboard access and themes",
  { skip: !chrome },
  async (t) => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "archify-layered-browser-"),
    );
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const child = path.join(dir, "sequence.html");
    execFileSync(process.execPath, [
      path.join(root, "bin/archify.mjs"),
      "deliver",
      "sequence",
      path.join(root, "examples/cache-miss-request.sequence.json"),
      child,
    ]);
    const html = fs.readFileSync(child, "utf8"),
      nodes = [...html.matchAll(/data-node-id="([^"]+)"/g)].map((m) => m[1]);
    const manifest = {
      schema_version: 1,
      title: "Request details",
      overview: "overview",
      diagrams: ["overview", "detail", "alternative"].map((id) => ({
        id,
        title: id,
        file: child,
      })),
      links: [
        { node: nodes[0], details: ["detail"] },
        { node: nodes[1], details: ["detail", "alternative"] },
      ],
    };
    const input = path.join(dir, "atlas.json"),
      output = path.join(dir, "atlas.html");
    fs.writeFileSync(input, JSON.stringify(manifest));
    execFileSync(process.execPath, [
      path.join(root, "bin/archify.mjs"),
      "atlas",
      input,
      output,
    ]);
    const browser = new ChromeVisualBrowser(chrome);
    t.after(() => browser.close());
    const session = await browser.sessionPromise,
      send = (method, params = {}) => browser.cdp.send(method, params, session);
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    const ready = () =>
      evaluate(
        `new Promise((resolve,reject)=>{let count=0;const timer=setInterval(()=>{const f=document.querySelector('iframe:not([hidden])');if(f?.dataset.ready==='true'){clearInterval(timer);resolve(true)}else if(++count>100){clearInterval(timer);reject(Error('frame timeout'))}},50)})`,
      );
    await send("Network.enable");
    await send("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.navigate", { url: pathToFileURL(output).href });
    await ready();
    const frame = `document.querySelector('iframe:not([hidden])')`;
    await evaluate(`${frame}.contentWindow.Archify.view.zoomIn()`);
    const before = await evaluate(
      `${frame}.contentDocument.querySelector('.diagram-container svg').style.transform`,
    );
    await evaluate(
      `${frame}.contentDocument.querySelector('[data-node-id="${nodes[0]}"]').focus()`,
    );
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await new Promise((r) => setTimeout(r, 100));
    await ready();
    assert.equal(await evaluate(`${frame}.dataset.diagramId`), "detail");
    await evaluate(`document.getElementById('theme').click()`);
    const theme = await evaluate(`document.documentElement.dataset.theme`);
    assert.equal(
      await evaluate(`${frame}.contentDocument.documentElement.dataset.theme`),
      theme,
    );
    await evaluate(`document.getElementById('back').click()`);
    await new Promise((r) => setTimeout(r, 100));
    await ready();
    assert.equal(await evaluate(`${frame}.dataset.diagramId`), "overview");
    assert.equal(
      await evaluate(
        `${frame}.contentDocument.querySelector('.diagram-container svg').style.transform`,
      ),
      before,
    );
    assert.equal(
      await evaluate(`${frame}.contentDocument.activeElement.dataset.nodeId`),
      nodes[0],
    );
    await evaluate(
      `${frame}.contentDocument.querySelector('[data-node-id="${nodes[1]}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`,
    );
    assert.equal(
      await evaluate(`document.getElementById('details').open`),
      true,
    );
    assert.equal(
      await evaluate(`document.getElementById('choices').children.length`),
      2,
    );
    await evaluate(
      `document.getElementById('choices').lastElementChild.click()`,
    );
    await new Promise((r) => setTimeout(r, 100));
    await ready();
    assert.equal(await evaluate(`${frame}.dataset.diagramId`), "alternative");
    await evaluate(`${frame}.contentWindow.Archify.theme.toggle()`);
    await new Promise((r) => setTimeout(r, 100));
    assert.notEqual(
      await evaluate(`document.documentElement.dataset.theme`),
      theme,
    );
    for (const [width, height] of [
      [1440, 900],
      [1600, 1000],
      [1920, 1080],
      [2048, 1320],
    ]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((r) => setTimeout(r, 350));
      assert.equal(
        await evaluate(
          `document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight`,
        ),
        true,
      );
      assert.equal(
        await evaluate(
          `(()=>{const w=${frame}.contentWindow,d=w.document.documentElement;return d.scrollWidth<=w.innerWidth&&d.scrollHeight<=w.innerHeight})()`,
        ),
        true,
      );
    }
    if (process.env.ARCHIFY_READING_EVIDENCE) {
      fs.mkdirSync(process.env.ARCHIFY_READING_EVIDENCE, { recursive: true });
      for (const mode of ["light", "dark"]) {
        await evaluate(
          `if(document.documentElement.dataset.theme!=='${mode}')document.getElementById('theme').click()`,
        );
        await new Promise((r) => setTimeout(r, 150));
        const shot = await send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(
          path.join(
            process.env.ARCHIFY_READING_EVIDENCE,
            `layered-${mode}.png`,
          ),
          Buffer.from(shot.data, "base64"),
        );
      }
    }
  },
);

test(
  "real visual-check catches unreadable sequence message text",
  { skip: !chrome },
  async (t) => {
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "archify-message-browser-"),
    );
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const child = path.join(dir, "sequence.html");
    execFileSync(process.execPath, [
      path.join(root, "bin/archify.mjs"),
      "render",
      "sequence",
      path.join(root, "examples/cache-miss-request.sequence.json"),
      child,
    ]);
    // Simulate a regression in an artifact, independently of renderer constants.
    fs.writeFileSync(
      child,
      fs
        .readFileSync(child, "utf8")
        .replace(
          /(<text[^>]*class="t-backend"[^>]*font-size=")11("[^>]*>)/g,
          "$13$2",
        ),
    );
    const result = await runVisualCheck({
      artifactPath: child,
      chromePath: chrome,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.receipt.readability.status, "fail");
    assert.ok(
      result.receipt.readability.viewports.some(
        (v) => v.minimumProjectedNodeTextDetail === "message",
      ),
    );
  },
);
