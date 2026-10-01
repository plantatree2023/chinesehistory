// 时间轴卡片的图片只在接近视野时加载（视野及左右各约 1.5 屏），不会一次加载全部图片。
// 不依赖浏览器的 loading="lazy"：它对横向平移的时间轴不可靠，曾在手机宽度下一次加载全部图片（几十 MB）。
const { test, expect, openApp, waitForStableLayout, trackOffset } = require('./helpers');

// 记录卡片图片的请求
function trackImages(page) {
  const urls = new Set();
  page.on('request', (r) => { if (r.resourceType() === 'image' && /\/images\//.test(r.url())) urls.add(new URL(r.url()).pathname); });
  return urls;
}
const cardImages = (page) => page.evaluate(() => {
  const vw = document.getElementById('stage').clientWidth;
  return [...document.querySelectorAll('.card')].map((c) => {
    const img = c.querySelector('img.card-img');
    const r = c.getBoundingClientRect();
    return {
      inView: r.right > 0 && r.left < vw,
      far: r.left > vw * 3.5 || r.right < -vw * 2.5,
      hasImg: !!img,
      src: img ? img.getAttribute('src') : null,
      loaded: !!img && img.complete && img.naturalWidth > 0,
    };
  });
});

for (const dataset of ['', 'cn_zh-v2']) {
  for (const viewport of [{ width: 390, height: 780 }, { width: 1440, height: 860 }]) {
    test.describe(`${dataset || 'cn_zh'} ${viewport.width}×${viewport.height}`, () => {
      test.use({ viewport });

      test('只加载视野附近卡片的图片；视野内的图片都已显示；远处的不加载', async ({ page }) => {
        const requested = trackImages(page);
        await page.goto(dataset ? `/?data=${dataset}` : '/');
        await expect(page.locator('.card').first()).toBeVisible();
        await waitForStableLayout(page);
        await page.waitForTimeout(800);
        const cards = await cardImages(page);
        expect(cards.length).toBeGreaterThan(50);
        const visible = cards.filter((c) => c.inView && c.hasImg);
        expect(visible.length).toBeGreaterThan(0);
        await expect.poll(async () => (await cardImages(page)).filter((c) => c.inView && c.hasImg && !c.loaded).length, { message: '视野内的图片应已加载' }).toBe(0);
        expect(cards.filter((c) => c.far && c.src), '远处卡片的图片不应加载').toEqual([]);
        expect(requested.size, `加载了 ${requested.size} 张图片`).toBeLessThanOrEqual(30);
      });

      test('移动时加载新进入视野的图片；跳到末尾时不加载一路经过的图片', async ({ page }) => {
        const requested = trackImages(page);
        await page.goto(dataset ? `/?data=${dataset}` : '/');
        await expect(page.locator('.card').first()).toBeVisible();
        await waitForStableLayout(page);
        const before = requested.size;
        await page.locator('#stage').focus();
        await page.keyboard.press('End');
        await expect.poll(() => page.evaluate(() => document.getElementById('navRight').classList.contains('at-end'))).toBe(true);
        await expect.poll(async () => (await cardImages(page)).filter((c) => c.inView && c.hasImg && !c.loaded).length).toBe(0);
        expect(requested.size - before, '末尾附近的图片').toBeLessThanOrEqual(30);
        // 往回翻一屏：新进入视野的图片加载
        const x0 = await trackOffset(page);
        for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
        await expect.poll(() => trackOffset(page)).toBeGreaterThan(x0 + 50);
        await expect.poll(async () => (await cardImages(page)).filter((c) => c.inView && c.hasImg && !c.loaded).length).toBe(0);
      });
    });
  }
}

test('窗口尺寸变化重新排版后，视野内的图片仍然显示', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 860 });
  await openApp(page);
  await page.setViewportSize({ width: 700, height: 700 });
  await waitForStableLayout(page);
  await expect.poll(async () => (await cardImages(page)).filter((c) => c.inView && c.hasImg && !c.loaded).length).toBe(0);
});
