// 代表图完整显示：图片框按原图比例绘制、不被裁切、不会过小。
// 所有图片都从本地加载：数据中只有 images/ 下的本地路径，文件齐全且尺寸与记录一致。
// 比例取自事件数据中记录的图片尺寸，并用实际加载后的像素尺寸复核，全程离线。
const fs = require('fs');
const path = require('path');
const { test, expect, openApp, loadDataset } = require('./helpers');
const { imageSize } = require('../tools/wiki-import');

const ROOT = path.resolve(__dirname, '..');

const MIN_SIDE = 50;          // 代表图最短边下限（px）
const RATIO_TOLERANCE = 0.04; // 显示比例与原图比例的允许误差

for (const viewport of [{ width: 1440, height: 860 }, { width: 1280, height: 640 }, { width: 390, height: 780 }]) {
  test(`${viewport.width}×${viewport.height}：代表图按原比例完整显示`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openApp(page);
    // 等待所有代表图加载完成
    await page.evaluate(() => Promise.all([...document.querySelectorAll('img.card-img')]
      .map((img) => { img.loading = 'eager'; if (img.dataset.src) img.src = img.dataset.src; return img.decode().catch(() => {}); })));   // 远处卡片的图片尚未加载（见 loadNearbyImages），这里全部加载以便检查

    const { events } = await loadDataset(page);
    const report = await page.evaluate(({ tol, minSide, events }) => {
      const byId = Object.fromEntries(events.map((e) => [e.id, e]));
      const out = { checked: 0, loadedLocal: 0, problems: [] };
      for (const card of document.querySelectorAll('.card')) {
        const ev = byId[card.dataset.id];
        const cover = ev && ev.images[0];
        const pic = card.querySelector('.card-img');
        if (!cover || !pic) continue;
        const title = ev.title;
        const box = pic.getBoundingClientRect();
        const media = pic.parentElement.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        const shown = box.width / box.height;

        if (cover.w && cover.h) {
          out.checked++;
          const expected = cover.w / cover.h;
          if (Math.abs(shown / expected - 1) > tol) out.problems.push(`${title}：比例 ${shown.toFixed(2)}，原图 ${expected.toFixed(2)}`);
        }
        if (pic.tagName === 'IMG' && pic.naturalWidth) {
          out.loadedLocal++;
          const natural = pic.naturalWidth / pic.naturalHeight;
          if (Math.abs(shown / natural - 1) > tol) out.problems.push(`${title}：显示比例与实际图片不符`);
        }
        const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
        if (!inside(box, media) || !inside(box, cr)) out.problems.push(`${title}：图片被裁切`);
        if (Math.min(box.width, box.height) < minSide) out.problems.push(`${title}：图片过小 ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
      return out;
    }, { tol: RATIO_TOLERANCE, minSide: MIN_SIDE, events });

    const covers = events.filter((e) => e.images.length).length;
    expect(report.checked, '每张代表图都应带尺寸信息').toBe(covers);
    expect(report.loadedLocal, '每张代表图都应从本地加载成功').toBe(covers);
    expect(await page.locator('.card .img-placeholder').count(), '只有没有图片的事件显示占位图').toBe(events.length - covers);
    expect(report.problems).toEqual([]);
  });
}

// 图片按重要程度（majorScore）分三级：1–5 小、6–7 中、8–10 大；每种屏幕上三级都应明显不同
const tierOf = (score) => (score >= 8 ? 3 : score >= 6 ? 2 : 1);
for (const [viewport, minLarge] of [[{ width: 1440, height: 860 }, 88000], [{ width: 1280, height: 640 }, 40000], [{ width: 390, height: 780 }, 30000]]) {
  test(`${viewport.width}×${viewport.height}：代表图大小按重要程度分三级`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openApp(page);
    const { events } = await loadDataset(page);
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));
    const cards = await page.evaluate(() => [...document.querySelectorAll('.card')].map((card) => {
      const pic = card.querySelector('img.card-img');
      const b = pic && pic.getBoundingClientRect();
      return { id: card.dataset.id, cls: card.className, area: b ? b.width * b.height : null };
    }));
    const areas = { 1: [], 2: [], 3: [] };
    for (const c of cards) {
      const tier = tierOf(byId[c.id].majorScore);
      expect(c.cls, byId[c.id].title).toContain(`tier-${tier}`);
      expect(c.cls.includes('major'), byId[c.id].title).toBe(tier === 3);
      if (c.area) areas[tier].push(c.area);
    }
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const [small, medium, large] = [avg(areas[1]), avg(areas[2]), avg(areas[3])];
    expect(medium / small).toBeGreaterThan(1.25);
    expect(large / medium).toBeGreaterThan(1.3);
    expect(large / small).toBeGreaterThan(1.8);
    // 大图（重大事件）比之前（桌面平均约 83000px²）进一步放大
    expect(large).toBeGreaterThan(minLarge);
  });
}

test('数据中的图片都是 images/ 下的本地文件：文件存在、可访问、尺寸与记录一致，没有外部地址', async ({ page, request }) => {
  const { events } = await loadDataset(page);
  const images = events.flatMap((e) => e.images.map((img) => ({ ...img, title: e.title })));
  expect(images.length).toBeGreaterThan(0);
  const problems = [];
  for (const img of images) {
    if (!/^images\/[A-Za-z0-9._-]+$/.test(img.src)) { problems.push(`${img.title}：不是本地图片 ${img.src}`); continue; }
    const extra = Object.keys(img).filter((k) => !['src', 'w', 'h', 'caption', 'title'].includes(k));
    if (extra.length) problems.push(`${img.title}：多余字段 ${extra.join(',')}`);
    const file = path.join(ROOT, img.src);
    if (!fs.existsSync(file)) { problems.push(`${img.title}：文件不存在 ${img.src}`); continue; }
    const size = imageSize(fs.readFileSync(file));
    if (!size || size.w !== img.w || size.h !== img.h) problems.push(`${img.title}：尺寸与记录不符 ${img.src}`);
  }
  expect(problems).toEqual([]);
  // 抽查通过网站服务访问
  for (const src of [...new Set(images.map((i) => i.src))].slice(0, 20)) {
    expect((await request.get('/' + src)).ok(), src).toBeTruthy();
  }
});

test('页面不请求任何外部图片', async ({ page }) => {
  const external = [];
  page.on('request', (req) => { if (req.resourceType() === 'image' && !req.url().startsWith('http://127.0.0.1')) external.push(req.url()); });
  await openApp(page);
  await page.locator('#stage').focus();
  await page.keyboard.press('End');
  await page.waitForTimeout(500);
  expect(external).toEqual([]);
});
