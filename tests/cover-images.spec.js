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
      .map((img) => { img.loading = 'eager'; return img.decode().catch(() => {}); })));

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

test('重大事件的代表图明显大于普通事件', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 860 });
  await openApp(page);
  const areas = await page.evaluate(() => {
    const out = { major: [], normal: [] };
    for (const card of document.querySelectorAll('.card')) {
      const pic = card.querySelector('.card-img');
      if (!pic || pic.tagName !== 'IMG') continue;
      const b = pic.getBoundingClientRect();
      out[card.classList.contains('major') ? 'major' : 'normal'].push(b.width * b.height);
    }
    return out;
  });
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  expect(areas.major.length).toBeGreaterThan(5);
  // 调整前重大事件平均约 63000px²、普通事件约 52000px²（约 1.2 倍）
  expect(avg(areas.major)).toBeGreaterThan(75000);
  expect(avg(areas.major) / avg(areas.normal)).toBeGreaterThan(1.35);
});

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
