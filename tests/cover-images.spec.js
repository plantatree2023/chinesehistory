// 代表图完整显示：图片框按原图比例绘制、不被裁切、不会过小。
// 比例取自事件数据中记录的图片尺寸，本地图片再用实际加载后的像素尺寸复核，全程离线。
const { test, expect, openApp, loadDataset } = require('./helpers');

const MIN_SIDE = 50;          // 代表图最短边下限（px）
const RATIO_TOLERANCE = 0.04; // 显示比例与原图比例的允许误差

for (const viewport of [{ width: 1440, height: 860 }, { width: 1280, height: 640 }, { width: 390, height: 780 }]) {
  test(`${viewport.width}×${viewport.height}：代表图按原比例完整显示`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openApp(page);
    // 等待所有本地代表图加载完成（外部图片已被屏蔽，会显示为占位图）
    await page.evaluate(() => Promise.all([...document.querySelectorAll('img.card-img')]
      .filter((img) => !/^https?:/.test(img.getAttribute('src')))
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

    expect(report.checked, '应检查到带尺寸信息的代表图').toBeGreaterThan(50);
    expect(report.loadedLocal, '应有本地代表图成功加载').toBeGreaterThan(30);
    expect(report.problems).toEqual([]);
  });
}

test('数据中的本地图片文件都存在且可访问', async ({ page, request }) => {
  const { events } = await loadDataset(page);
  const paths = [...new Set(events
    .flatMap((e) => e.images.map((i) => i.src))
    .filter((src) => !/^https?:/.test(src)))];
  expect(paths.length).toBeGreaterThan(0);
  const missing = [];
  for (const p of paths) {
    const res = await request.get('/' + p);
    if (!res.ok()) missing.push(`${p} (${res.status()})`);
  }
  expect(missing).toEqual([]);
});
