// 代表图占满卡片的图片区，四边不留空隙：排版尽量让图片区与原图比例一致，
// 比例对不上时图片最多裁去 MAX_CROP，其余部分由虚化的同一张图片（.card-img-bg）铺满，
// 但图片的宽和高都至少占图片区的 MIN_SHOWN（放不下时卡片或文字栏加宽、说明截短）；图片不会过小。
// 所有图片都从本地加载：数据中只有 images/ 下的本地路径，文件齐全且尺寸与记录一致。
// 比例取自事件数据中记录的图片尺寸，并用实际加载后的像素尺寸复核，全程离线。
const fs = require('fs');
const path = require('path');
const { test, expect, openApp, loadDataset, REAL_DATASETS, readRealDataset } = require('./helpers');
const { imageSize } = require('../tools/wiki-import');

const ROOT = path.resolve(__dirname, '..');

const MIN_SIDE = 50;          // 代表图最短边下限（px）
const MAX_CROP = 0.2;         // 图片最多裁去的比例（与 js/app.js 一致）
const MIN_SHOWN = 0.8;        // 图片的宽和高都至少占图片区的比例（与 js/app.js 一致）

for (const viewport of [{ width: 1440, height: 860 }, { width: 1280, height: 640 }, { width: 390, height: 780 }, { width: 360, height: 700 }, { width: 360, height: 600 }]) {
  test(`${viewport.width}×${viewport.height}：代表图占满图片区、不留空隙，裁剪不多`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openApp(page);
    // 等待所有代表图加载完成
    await page.evaluate(() => Promise.all([...document.querySelectorAll('img.card-img, img.card-img-bg')]
      .map((img) => { img.loading = 'eager'; if (img.dataset.src) img.src = img.dataset.src; return img.decode().catch(() => {}); })));   // 远处卡片的图片尚未加载（见 loadNearbyImages），这里全部加载以便检查

    const { events } = await loadDataset(page);
    const report = await page.evaluate(({ tol, minSide, events, MAX_CROP, MIN_SHOWN }) => {
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
        const bg = pic.parentElement.querySelector('.card-img-bg');
        // object-fit: cover 时图片显示出来的比例（其余被裁去）
        const shownPart = (ratio) => Math.min(box.width / box.height / ratio, box.height * ratio / box.width);

        if (cover.w && cover.h) {
          out.checked++;
          const part = shownPart(cover.w / cover.h);
          if (part < 1 - MAX_CROP - tol) out.problems.push(`${title}：图片裁去 ${Math.round((1 - part) * 100)}%`);
        }
        if (pic.tagName === 'IMG' && pic.naturalWidth) {
          out.loadedLocal++;
          if (shownPart(pic.naturalWidth / pic.naturalHeight) < 1 - MAX_CROP - tol) out.problems.push(`${title}：实际图片裁去太多`);
          if (getComputedStyle(pic).objectFit !== 'cover') out.problems.push(`${title}：图片没有铺满图片框`);
        }
        const inside = (a, b) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
        if (!inside(box, media) || !inside(media, cr)) out.problems.push(`${title}：图片超出卡片`);
        // 不留空隙：图片框与图片区一样大，或者由虚化的同一张图片铺满图片区
        const filled = (a) => inside(media, a);
        if (!filled(box) && !(bg && bg.tagName === 'IMG' && bg.getAttribute('src') === pic.getAttribute('src') && filled(bg.getBoundingClientRect()))) {
          out.problems.push(`${title}：图片周围有空隙 ${Math.round(box.width)}×${Math.round(box.height)} / ${Math.round(media.width)}×${Math.round(media.height)}`);
        }
        // 虚化部分不超过图片区的 20%：图片的宽和高都至少占图片区的 80%
        const shown = Math.min(box.width / media.width, box.height / media.height);
        if (shown < MIN_SHOWN - 0.005) out.problems.push(`${title}：图片只占图片区的 ${Math.round(shown * 100)}%`);
        // 文字不被卡片切掉：放不下时说明按整行截短（末尾显示省略号）
        const body = card.querySelector('.card-body').getBoundingClientRect();
        if (body.bottom > cr.bottom + 1 || body.right > cr.right + 1) out.problems.push(`${title}：文字超出卡片`);
        const short = card.querySelector('.card-short');
        if (short && short.scrollHeight > short.clientHeight + 1 && !short.classList.contains('clamped')) out.problems.push(`${title}：说明被切掉`);
        if (Math.min(box.width, box.height) < minSide) out.problems.push(`${title}：图片过小 ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
      return out;
    }, { tol: 0.02, minSide: MIN_SIDE, events, MAX_CROP, MIN_SHOWN });

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

for (const id of REAL_DATASETS) test(`${id}：数据中的图片都是 images/ 下的本地文件：文件存在、可访问、尺寸与记录一致，没有外部地址`, async ({ request }) => {
  const { events } = readRealDataset(id);
  const images = events.flatMap((e) => e.images.map((img) => ({ ...img, title: e.title })));
  expect(images.length).toBeGreaterThan(0);
  const problems = [];
  for (const img of images) {
    if (!/^images\/[A-Za-z0-9._-]+$/.test(img.src)) { problems.push(`${img.title}：不是本地图片 ${img.src}`); continue; }
    const extra = Object.keys(img).filter((k) => !['src', 'w', 'h', 'caption', 'author', 'license', 'sourceUrl', 'title'].includes(k));
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
