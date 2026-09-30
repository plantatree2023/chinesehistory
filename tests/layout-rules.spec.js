// 排版规则：任意一屏最多 6 个事件（大屏幕 8 个）、每张卡片至少显示 20 字说明、卡片不重叠也不超出显示区域。
// 这些规则由排版算法在运行时动态保证，因此也要在新增事件、改变窗口大小后验证。
const { test, expect, openApp, seedEvents, waitForStableLayout, layoutMetrics, maxPerScreenFor, MAX_PER_SCREEN, MAX_PER_SCREEN_LARGE, LARGE_SCREEN_W, MIN_SUMMARY, DEFAULT_EVENT_COUNT } = require('./helpers');

function expectRulesHold(m) {
  expect(m.maxPerScreen, `任意一屏（${m.stageWidth}px 宽）内的事件数`).toBeLessThanOrEqual(maxPerScreenFor(m.stageWidth));
  expect(m.minVisible, `卡片可见说明字数（最少的是：${m.worst}）`).toBeGreaterThanOrEqual(MIN_SUMMARY);
  expect(m.overlaps, '重叠的卡片对数').toBe(0);
  expect(m.outOfBounds, '超出显示区域的卡片数').toBe(0);
}

const VIEWPORTS = [
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1680, height: 1050 },
  { width: 1440, height: 860 },
  { width: 1280, height: 640 },
  { width: 1024, height: 768 },
  { width: 390, height: 780 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test('默认数据满足排版规则', async ({ page }) => {
      await openApp(page);
      const m = await layoutMetrics(page);
      expect(m.count).toBe(DEFAULT_EVENT_COUNT);
      expectRulesHold(m);
    });
  });
}

// 一屏宽度内卡片数的平均值（按半屏步长滑动统计）与时间轴总长（屏数）
const density = (page) => page.evaluate(() => {
  const V = document.getElementById('stage').clientWidth;
  const W = document.getElementById('track').offsetWidth;
  const cs = [...document.querySelectorAll('.card')].map((c) => c.offsetLeft + c.offsetWidth / 2);
  const counts = [];
  for (let x = 0; x < W; x += V / 2) counts.push(cs.filter((c) => c >= x && c < x + V).length);
  return { avg: counts.reduce((a, b) => a + b, 0) / counts.length, screens: W / V };
});

test.describe('大屏幕一屏最多 8 个事件', () => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    test(`${viewport.width}×${viewport.height}：放宽到 8 个并实际用满，屏幕填得更满`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openApp(page);
      const m = await layoutMetrics(page);
      expect(m.stageWidth).toBeGreaterThanOrEqual(LARGE_SCREEN_W);
      expect(m.maxPerScreen).toBe(MAX_PER_SCREEN_LARGE);
      // 调整前每屏平均约 5.8 个、时间轴约 17 屏长
      const d = await density(page);
      expect(d.avg).toBeGreaterThan(7);
      expect(d.screens).toBeLessThan(14.5);
    });
  }

  test('分界：时间轴区域宽 1599px 时为 6 个，1600px 时为 8 个', async ({ page }) => {
    // 时间轴区域宽度等于窗口宽度
    await page.setViewportSize({ width: LARGE_SCREEN_W - 1, height: 900 });
    await openApp(page);
    let m = await layoutMetrics(page);
    expect(m.stageWidth).toBe(LARGE_SCREEN_W - 1);
    expect(m.maxPerScreen).toBe(MAX_PER_SCREEN);
    await page.setViewportSize({ width: LARGE_SCREEN_W, height: 900 });
    await expect.poll(async () => (await layoutMetrics(page)).maxPerScreen).toBe(MAX_PER_SCREEN_LARGE);
  });

  test('窗口从大屏幕缩小到笔记本尺寸后重新排版，恢复为 6 个', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openApp(page);
    expect((await layoutMetrics(page)).maxPerScreen).toBe(MAX_PER_SCREEN_LARGE);
    await page.setViewportSize({ width: 1440, height: 860 });
    await waitForStableLayout(page);
    const m = await layoutMetrics(page);
    expect(m.stageWidth).toBe(1440);
    expectRulesHold(m);
    expect(m.maxPerScreen).toBe(MAX_PER_SCREEN);
  });
});

test.describe('动态保证', () => {
  test.use({ viewport: { width: 1440, height: 860 }, debugMode: true });

  test('同一年集中新增 12 个事件后规则仍成立', async ({ page }) => {
    await seedEvents(page, (events) => {
      for (let i = 0; i < 12; i++) {
        events.push({
          id: `burst-${i}`, year: 1937, date: '1937年', title: `测试事件${i}`, short: '短',
          detail: '这是一段用于测试的详细说明文字，用来验证简要说明不足二十字时会自动截取详细说明补足。',
          images: [],
        });
      }
      return events;
    });
    const m = await layoutMetrics(page);
    expect(m.count).toBe(DEFAULT_EVENT_COUNT + 12);
    expectRulesHold(m);
  });

  test('改变窗口大小后重新排版，规则仍成立', async ({ page }) => {
    await openApp(page);
    await page.setViewportSize({ width: 900, height: 700 });
    await waitForStableLayout(page);
    expectRulesHold(await layoutMetrics(page));
  });

  test('说明不足 20 字时编辑器拒绝保存', async ({ page }) => {
    await openApp(page);
    await page.click('#addBtn');
    await page.fill('#editForm [name=title]', '字数不足');
    await page.fill('#editForm [name=yearAbs]', '100');
    await page.fill('#editForm [name=short]', '太短了');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#formError')).toContainText('20');
    await expect(page.locator('#editModal')).toBeVisible();
  });
});
