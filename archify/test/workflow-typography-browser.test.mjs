import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { typographyFixture, runWorkflow } from './helpers/workflow-typography.mjs';

const chrome = Object.hasOwn(process.env, 'ARCHIFY_CHROME') ? findChrome() : null;

async function inspectTypography(browser) {
  const session = await browser.sessionPromise;
  const result = await browser.cdp.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    await document.fonts.ready;
    await Archify.layoutStability.whenStable();
    const svg = document.querySelector('.diagram-container > svg');
    const box = element => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const inside = (inner, outer, tolerance = 0.75) => inner.left >= outer.left - tolerance
      && inner.right <= outer.right + tolerance && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance;
    const overlaps = (a, b) => a.left < b.right - 0.25 && b.left < a.right - 0.25
      && a.top < b.bottom - 0.25 && b.top < a.bottom - 0.25;
    const sourceFont = text => parseFloat(getComputedStyle(text).fontSize);
    const projectedFont = text => {
      const matrix = text.getScreenCTM();
      return sourceFont(text) * Math.hypot(matrix.a, matrix.b);
    };
    const visibleState = text => {
      const own = getComputedStyle(text);
      let opacity = 1;
      let visible = true;
      for (let element = text; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        opacity *= Number(style.opacity);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') visible = false;
        if (element === svg) break;
      }
      const rect = box(text);
      return { computedOpacity: Number(own.opacity), computedVisibility: own.visibility,
        computedDisplay: own.display, effectiveOpacity: opacity,
        visible: visible && opacity > 0.01 && rect.width > 0 && rect.height > 0 };
    };
    const nodes = [...svg.querySelectorAll('[data-node-id]')].map(node => {
      const shape = box(node.querySelector(':scope > rect.c-mask'));
      const texts = [...node.querySelectorAll(':scope > text')].map(text => ({
        text: text.textContent, box: box(text), sourceFont: sourceFont(text), projectedFont: projectedFont(text),
        caption: !text.hasAttribute('data-node-label'),
        role: text.hasAttribute('data-node-label') ? 'label' : text.dataset.detail === 'fine' ? 'tag' : 'sublabel',
        ...visibleState(text),
      }));
      return { id: node.dataset.nodeId, shape, texts,
        overflow: texts.filter(text => !inside(text.box, shape)).map(text => text.text),
        overlaps: texts.flatMap((text, index) => texts.slice(index + 1)
          .filter(other => overlaps(text.box, other.box)).map(other => [text.text, other.text])),
      };
    });
    const maskOverflow = [...svg.querySelectorAll('g[data-edge-id]')].flatMap(group => {
      const mask = group.querySelector(':scope > rect.c-mask');
      const text = group.querySelector(':scope > text');
      return mask && text && !inside(box(text), box(mask)) ? [text.textContent] : [];
    });
    const captionFonts = nodes.flatMap(node => node.texts.filter(text => text.caption).map(text => text.projectedFont));
    const visibleCaptionFonts = nodes.flatMap(node => node.texts.filter(text => text.caption && text.visible).map(text => text.projectedFont));
    const texts = [...svg.querySelectorAll('text')];
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      svg: box(svg), nodes, maskOverflow,
      outsideSvg: texts.filter(text => !inside(box(text), box(svg))).map(text => text.textContent),
      headerNodeOverlap: texts.filter(text => !text.closest('[data-node-id]'))
        .filter(text => nodes.some(node => overlaps(box(text), node.shape))).map(text => text.textContent),
      textContent: texts.map(text => text.textContent), captionMin: Math.min(...captionFonts),
      visibleCaptionMin: Math.min(...visibleCaptionFonts),
    };
  })()` }, session);
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

async function revealFirstNodeTag(browser) {
  const session = await browser.sessionPromise;
  const result = await browser.cdp.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    const svg = document.querySelector('.diagram-container > svg');
    const node = svg.querySelector('[data-node-id]');
    const tags = [...node.querySelectorAll(':scope > text[data-detail="fine"]')];
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const revealed = await new Promise(resolve => {
      const start = performance.now();
      const sample = () => {
        const visible = tags.length && tags.every(tag => Number(getComputedStyle(tag).opacity) >= 0.99
          && getComputedStyle(tag).visibility === 'visible' && getComputedStyle(tag).display !== 'none');
        if (visible || performance.now() - start > 2000) resolve(Boolean(visible));
        else requestAnimationFrame(sample);
      };
      sample();
    });
    return { nodeId: node.dataset.nodeId, focused: node.hasAttribute('data-focus-selected'), revealed };
  })()` }, session);
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}

for (const [name, scale] of [['ordinary', 1.5], ['ordinary', 2], ['dense', 1.5], ['cjk', 1.5]]) {
  test(`real browser preserves text bounds and improves measured workflow typography: ${name}/${scale}`, {
    skip: !chrome, timeout: 120000,
  }, async t => {
    const doc = typographyFixture(name);
    const before = runWorkflow(t, doc);
    assert.equal(before.status, 0, before.stderr);
    doc.meta.typography_scale = scale;
    const after = runWorkflow(t, doc);
    assert.equal(after.status, 0, after.stderr);
    const browser = new ChromeVisualBrowser(chrome);
    t.after(() => browser.close());
    // 可选测试证据目录只保存本测试的合成输入、产物、截图和实际浏览器测量。
    let evidence;
    if (process.env.ARCHIFY_TYPOGRAPHY_EVIDENCE_DIR) {
      fs.mkdirSync(process.env.ARCHIFY_TYPOGRAPHY_EVIDENCE_DIR, { recursive: true });
      evidence = fs.mkdtempSync(path.join(process.env.ARCHIFY_TYPOGRAPHY_EVIDENCE_DIR, `${name}-scale-${scale}-`));
      fs.copyFileSync(before.output, path.join(evidence, 'before.html'));
      fs.copyFileSync(after.output, path.join(evidence, 'after.html'));
    }
    const records = [];
    for (const [width, height] of [[1440, 900], [1920, 1080]]) {
      for (const theme of ['light', 'dark']) {
        const pair = {};
        for (const [version, artifact] of [['before', before], ['after', after]]) {
          await browser.inspect({ artifactPath: artifact.output, width, height, theme,
            ...(evidence ? { screenshotPath: path.join(evidence, `${version}-${width}x${height}-${theme}.png`) } : {}),
          });
          pair[version] = await inspectTypography(browser);
          records.push({ version, typographyScale: version === 'before' ? 1 : scale, width, height, theme, ...pair[version] });
          if (evidence) fs.writeFileSync(path.join(evidence, 'measurements.json'), JSON.stringify(records, null, 2));
          const observed = pair[version];
          assert.ok(observed.scrollWidth <= width, `${name}/${version}/${theme}: 页面横向溢出`);
          assert.deepEqual(observed.maskOverflow, [], `${name}/${version}/${theme}: 标签超出遮罩`);
          assert.deepEqual(observed.outsideSvg, [], `${name}/${version}/${theme}: 文字被画布裁切`);
          assert.deepEqual(observed.headerNodeOverlap, [], `${name}/${version}/${theme}: 标题或边标签遮挡节点`);
          for (const node of observed.nodes) {
            assert.deepEqual(node.overflow, [], `${name}/${version}/${node.id}: 文字超出节点 ${JSON.stringify(node)}`);
            assert.deepEqual(node.overlaps, [], `${name}/${version}/${node.id}: 文字行重叠`);
          }
          // 默认截图已经保存；在其后实际聚焦节点，验证 READ 模式隐藏的 tag 能正常显示。
          const focus = await revealFirstNodeTag(browser);
          assert.equal(focus.focused, true, JSON.stringify(focus));
          assert.equal(focus.revealed, true, JSON.stringify(focus));
          const focused = (await inspectTypography(browser)).nodes.find(node => node.id === focus.nodeId);
          const tags = focused.texts.filter(text => text.role === 'tag');
          assert.ok(tags.length && tags.every(text => text.visible && text.effectiveOpacity >= 0.99));
          assert.deepEqual(focused.overflow, []);
          assert.deepEqual(focused.overlaps, []);
          records.at(-1).focusedNode = focused;
          if (evidence) fs.writeFileSync(path.join(evidence, 'measurements.json'), JSON.stringify(records, null, 2));
        }
        assert.deepEqual(pair.after.textContent, pair.before.textContent, '不能删减作者文字');
        assert.ok(pair.after.captionMin >= pair.before.captionMin - 0.1, '实际投影字号不能因画布增长反而变小');
        assert.ok(pair.after.visibleCaptionMin >= pair.before.visibleCaptionMin - 0.1, '默认可见说明文字不能缩小');
        if (name === 'dense') {
          assert.ok(pair.after.captionMin >= 9, `实际 caption 字号未达到用例目标: ${pair.after.captionMin}`);
          assert.ok(pair.after.captionMin >= pair.before.captionMin + 1);
          assert.ok(pair.after.visibleCaptionMin >= 9);
        }
        t.diagnostic(`${name}/${scale}/${width}x${height}/${theme}: visible caption ${pair.before.visibleCaptionMin.toFixed(2)} -> ${pair.after.visibleCaptionMin.toFixed(2)}; all authored captions/tags ${pair.before.captionMin.toFixed(2)} -> ${pair.after.captionMin.toFixed(2)} CSS px`);
      }
    }
  });
}
