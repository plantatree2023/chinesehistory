// 背景随时期渐变：时间轴背后铺一层按时期颜色生成的渐变（很低的不透明度，保留纸色主调），
// 每个时期的范围内是该时期的颜色，相邻时期之间平滑过渡，随时间轴一起拖动。
const { test, expect, openApp, loadDataset, trackOffset } = require('./helpers');

test.use({ viewport: { width: 1440, height: 860 } });

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// 解析渐变：[{ r, g, b, a, x }]
function parseStops(css) {
  return [...css.matchAll(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\) (-?[\d.]+)px/g)]
    .map((m) => ({ r: +m[1], g: +m[2], b: +m[3], a: +m[4], x: +m[5] }));
}

test('渐变覆盖整条时间轴，按时期顺序使用各时期的颜色，且足够淡', async ({ page }) => {
  await openApp(page);
  const { eras } = await loadDataset(page);
  const info = await page.evaluate(() => {
    const wash = document.getElementById('eraWash');
    const track = document.getElementById('track');
    return {
      css: getComputedStyle(wash).backgroundImage,
      washW: wash.getBoundingClientRect().width,
      washH: wash.getBoundingClientRect().height,
      trackW: track.getBoundingClientRect().width,
      stageH: document.getElementById('stage').clientHeight,
      pointer: getComputedStyle(wash).pointerEvents,
      eras: [...document.querySelectorAll('#eras .era')].map((e) => e.dataset.era),
    };
  });
  expect(info.washW).toBeCloseTo(info.trackW, 0);
  expect(info.washH).toBeCloseTo(info.stageH, 0);
  expect(info.pointer).toBe('none');                 // 不影响拖动和点击

  const stops = parseStops(info.css);
  // 每个在轴上显示的时期两个色标，颜色与时期颜色一致，位置从左到右递增
  const shown = info.eras.map((n) => eras.find((e) => e.name === n));
  expect(stops).toHaveLength(shown.length * 2);
  shown.forEach((era, i) => {
    for (const s of [stops[2 * i], stops[2 * i + 1]]) {
      expect([s.r, s.g, s.b], era.name).toEqual(rgb(era.color));
      expect(s.a).toBeGreaterThan(0.05);
      expect(s.a).toBeLessThanOrEqual(0.3);          // 保留原来的主色调
    }
  });
  for (let i = 1; i < stops.length; i++) expect(stops[i].x).toBeGreaterThanOrEqual(stops[i - 1].x);
});

test('渐变随时间轴一起移动：拖动后屏幕中央的背景颜色变为当前时期的颜色', async ({ page }) => {
  await openApp(page);
  const { eras } = await loadDataset(page);
  const colorAtCenter = () => page.evaluate(() => {
    const wash = document.getElementById('eraWash');
    const x = -new DOMMatrixReadOnly(getComputedStyle(document.getElementById('track')).transform).m41
      + document.getElementById('stage').clientWidth / 2;
    const stops = [...getComputedStyle(wash).backgroundImage.matchAll(/rgba\((\d+), (\d+), (\d+), [\d.]+\) (-?[\d.]+)px/g)]
      .map((m) => ({ c: [+m[1], +m[2], +m[3]], x: +m[4] }));
    // 中央位于某个时期的两个色标之间时，颜色就是该时期的颜色
    for (let i = 0; i + 1 < stops.length; i += 2) if (x >= stops[i].x && x <= stops[i + 1].x) return stops[i].c;
    return null;
  });
  for (const name of ['唐', '清']) {
    await page.click('#browseBtn');
    await page.fill('#searchInput', name === '唐' ? '贞观之治' : '鸦片战争与《南京条约》');
    await page.locator('.list-row').first().click();
    await page.click('#closeSidebar');
    await expect(page.locator('#currentEra')).toHaveText(name);
    await expect.poll(colorAtCenter).toEqual(rgb(eras.find((e) => e.name === name).color));
  }
  expect(await trackOffset(page)).toBeLessThan(0);
});
