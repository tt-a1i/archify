// 在本地生成 HTML 的开发者控制台执行，然后实际点击 Zoom in / Zoom out。
// 下一条性能记录等镜头 CSS 变换稳定后结束；不含浏览器控制工具的往返时间。
// firstFrameMs/twoFrameFeedbackMs 是 rAF 回调时刻，不是实际像素呈现延迟。
// 页面刷新会移除此监听器和所有内存记录，不改变生成 HTML。
(() => {
  const svg = document.querySelector('.diagram-container > svg');
  const records = [];
  const handler = event => {
    const button = event.target.closest('[data-view]');
    if (!button || button.disabled) return;
    const record = { action: button.dataset.view, trusted: event.isTrusted };
    const started = performance.now();
    let firstFrame = null, lastFrame = started, maximumFrameGap = 0;
    requestAnimationFrame(() => {
      firstFrame = performance.now() - started;
      requestAnimationFrame(() => {
        record.twoFrameFeedbackMs = performance.now() - started;
      });
    });
    const sample = () => {
      const now = performance.now();
      maximumFrameGap = Math.max(maximumFrameGap, now - lastFrame);
      lastFrame = now;
      const actual = new DOMMatrix(getComputedStyle(svg).transform).a;
      const target = Number(svg.dataset.viewScale || 1);
      if ((now - started > 32 && Math.abs(actual - target) < 0.001)
          || now - started > 3000) {
        Object.assign(record, { firstFrameMs: firstFrame, settledMs: now - started,
          maximumFrameGapMs: maximumFrameGap, targetScale: target,
          completed: Math.abs(actual - target) < 0.001 });
        records.push(record);
      } else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  };
  document.addEventListener('click', handler, true);
  window.__archifyTypographyTiming = {
    records,
    stop: () => document.removeEventListener('click', handler, true),
  };
})()
