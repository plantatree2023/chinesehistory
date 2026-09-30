// 各测试共用的夹具（fixture）与工具函数。
const zlib = require('zlib');
const base = require('@playwright/test');

const { expect } = base;

// 与 js/app.js 中的规则保持一致
const MAX_PER_SCREEN = 6;          // 笔记本、平板、手机
const MAX_PER_SCREEN_LARGE = 8;    // 大屏幕：时间轴区域宽度不小于 LARGE_SCREEN_W
const LARGE_SCREEN_W = 1600;
const maxPerScreenFor = (stageWidth) => (stageWidth >= LARGE_SCREEN_W ? MAX_PER_SCREEN_LARGE : MAX_PER_SCREEN);
const MIN_SUMMARY = 20;
const DATASET = 'cn_zh';
const DATA_URL = `/data/${DATASET}.json`;
const STORAGE_KEY = `zh-history-timeline:v1:${DATASET}`;
const DEBUG_KEY = 'zh-history-timeline:debug';
const DEFAULT_EVENT_COUNT = 100;
const PUNCT = /[\s，。、；：“”‘’《》〈〉（）【】！？·—…,.;:()[\]!?"'-]/;

// 扩展 test：
// - 屏蔽所有非本机请求（维基媒体图片等），测试完全离线、结果稳定；
// - 收集页面脚本错误，测试结束时断言没有任何错误；
// - 选项 debugMode：为 true 时在每次打开页面前开启调试模式（编辑功能只在调试模式下显示），
//   需要编辑的测试用 test.use({ debugMode: true })。
const test = base.test.extend({
  debugMode: [false, { option: true }],
  page: async ({ page, baseURL, debugMode }, use) => {
    // 安全检查：默认测试服务器必须是只读的，否则浏览器模式的测试会把测试数据写进真实数据文件
    if (baseURL) {
      const status = await page.request.get('/api/status');
      expect(status.status(), '测试服务器必须以 --readonly 启动').toBe(404);
    }
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
    if (debugMode) await page.addInitScript((key) => localStorage.setItem(key, '1'), DEBUG_KEY);
    await use(page);
    expect(errors, '页面不应出现脚本错误').toEqual([]);
  },
});

// 等待排版稳定：字体加载完成后，排版计数连续 500ms（大于应用内 150ms 的重排防抖）不再变化。
// 每次调用都重新计时，避免沿用上一次调用的状态而提前返回。
async function waitForStableLayout(page) {
  await page.evaluate(() => document.fonts.ready.then(() => { window.__layoutProbe = null; }));
  await page.waitForFunction(() => {
    const track = document.getElementById('track');
    const n = track && track.dataset.renders;
    if (!n) return false;
    const now = performance.now();
    const s = window.__layoutProbe || (window.__layoutProbe = { n, t: now });
    if (s.n !== n) { s.n = n; s.t = now; return false; }
    return now - s.t > 500;
  }, null, { polling: 100 });
}

// 打开应用并等待首屏排版完成
async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('.card').first()).toBeVisible();
  await waitForStableLayout(page);
}

// 读取默认数据集（data/cn_zh.json）
async function loadDataset(page) {
  const res = await page.request.get(DATA_URL);
  expect(res.ok(), `无法读取 ${DATA_URL}`).toBeTruthy();
  return res.json();
}

// 在打开前写入自定义事件数据（模拟用户在浏览器模式下已添加、修改过的状态）
async function seedEvents(page, mutate) {
  const { events } = await loadDataset(page);
  const mutated = mutate(JSON.parse(JSON.stringify(events)));
  await page.goto('/');
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: JSON.stringify(mutated) });
  await page.reload();
  await expect(page.locator('.card').first()).toBeVisible();
  await waitForStableLayout(page);
}

// 当前时间轴的平移量（px，<= 0）
function trackOffset(page) {
  return page.evaluate(() => {
    const m = new DOMMatrixReadOnly(getComputedStyle(document.getElementById('track')).transform);
    return m.m41;
  });
}

// 把指定横坐标（时间轴坐标）滚动到屏幕中央，并等待平移生效
async function centerOnTrackX(page, x) {
  await page.evaluate((x) => {
    const stage = document.getElementById('stage');
    const cur = new DOMMatrixReadOnly(getComputedStyle(document.getElementById('track')).transform).m41;
    stage.dispatchEvent(new WheelEvent('wheel', { deltaY: x + cur - stage.clientWidth / 2, bubbles: true, cancelable: true }));
  }, x);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// 把标题为 title 的事件卡片滚动到屏幕中央
async function centerOnCard(page, title) {
  const x = await page.evaluate((title) => {
    const card = [...document.querySelectorAll('.card')]
      .find((c) => c.querySelector('.card-title').textContent === title);
    if (!card) throw new Error(`找不到事件卡片：${title}`);
    return card.offsetLeft + card.offsetWidth / 2;
  }, title);
  await centerOnTrackX(page, x);
}

// 排版指标：每屏最多事件数、卡片重叠数、超出显示区域的卡片数、最少可见说明字数
function layoutMetrics(page) {
  return page.evaluate(({ punct }) => {
    const PUNCT = new RegExp(punct);
    const stage = document.getElementById('stage');
    const V = stage.clientWidth;
    const H = stage.clientHeight;
    const cards = [...document.querySelectorAll('.card')];
    const rects = cards.map((c) => ({ l: c.offsetLeft, t: c.offsetTop, r: c.offsetLeft + c.offsetWidth, b: c.offsetTop + c.offsetHeight }));

    // 任意一屏宽度窗口内的卡片数（按卡片中心计）
    const centers = rects.map((r) => (r.l + r.r) / 2).sort((a, b) => a - b);
    let maxPerScreen = 0;
    for (let i = 0, j = 0; i < centers.length; i++) {
      while (j < centers.length && centers[j] - centers[i] < V) j++;
      maxPerScreen = Math.max(maxPerScreen, j - i);
    }

    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t) overlaps++;
      }
    }
    const outOfBounds = rects.filter((r) => r.t < 0 || r.b > H).length;

    // 逐字测量说明文字在屏幕上的位置，只统计真正显示出来（未被截断、未被卡片裁掉）的字，不计标点
    let minVisible = Infinity, worst = '';
    const range = document.createRange();
    for (const card of cards) {
      const p = card.querySelector('.card-short');
      let visible = 0;
      if (p && p.firstChild && getComputedStyle(p).display !== 'none') {
        const pr = p.getBoundingClientRect(), cr = card.getBoundingClientRect();
        const bottom = Math.min(pr.bottom, cr.bottom) + 1, right = Math.min(pr.right, cr.right) + 1;
        const text = p.firstChild;
        for (let k = 0; k < text.length; k++) {
          range.setStart(text, k); range.setEnd(text, k + 1);
          const b = range.getBoundingClientRect();
          if (b.bottom <= bottom && b.right <= right && !PUNCT.test(text.data[k])) visible++;
        }
      }
      if (visible < minVisible) { minVisible = visible; worst = card.querySelector('.card-title').textContent; }
    }
    return { count: cards.length, stageWidth: V, maxPerScreen, overlaps, outOfBounds, minVisible, worst };
  }, { punct: PUNCT.source });
}

// 测试用图片：生成指定尺寸的纯色 PNG
function makePng(w, h, shade = 0) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, shade);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = {
  DEBUG_KEY,
  test, expect,
  MAX_PER_SCREEN, MAX_PER_SCREEN_LARGE, LARGE_SCREEN_W, maxPerScreenFor, MIN_SUMMARY, DATASET, DATA_URL, STORAGE_KEY, DEFAULT_EVENT_COUNT,
  makePng,
  openApp, loadDataset, seedEvents, waitForStableLayout, trackOffset, centerOnTrackX, centerOnCard, layoutMetrics,
};
