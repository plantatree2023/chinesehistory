// 下拉刷新（触屏设备）：竖直下拉超过阈值后松开即刷新页面；拉得不够、横向拖动时间轴、
// 侧栏或弹窗打开时不刷新。用 Chromium 的 DevTools 协议发送真实的触摸事件。
const { test, expect, openApp, trackOffset } = require('./helpers');

test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });

// 从 (x, y) 拖到 (x + dx, y + dy)，分 steps 步，最后松开
async function swipe(page, x, y, dx, dy, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  const at = (i) => [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i) });
    await page.waitForTimeout(16);
  }
  return {
    end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  };
}
// 页面是否被重新加载：加载前在 window 上做标记，刷新后标记消失
const mark = (page) => page.evaluate(() => { window.__notReloaded = true; });
const reloaded = (page) => page.evaluate(() => !window.__notReloaded);

test('下拉超过阈值：显示“释放刷新”，松开后刷新页面', async ({ page }) => {
  await openApp(page);
  await mark(page);
  const s = await swipe(page, 200, 250, 0, 220);
  await expect(page.locator('#ptr')).toHaveClass(/ready/);
  await expect(page.locator('#ptr .ptr-text')).toHaveText('释放刷新');
  const box = await page.locator('#ptr').boundingBox();
  expect(box.y).toBeGreaterThan(0);                           // 提示条已移入屏幕
  await Promise.all([page.waitForEvent('load'), s.end()]);
  await expect(page.locator('.card').first()).toBeVisible();
  expect(await reloaded(page)).toBe(true);
});

test('拉得不够时显示“下拉刷新”，松开后收回、不刷新', async ({ page }) => {
  await openApp(page);
  await mark(page);
  const s = await swipe(page, 200, 250, 0, 80);
  await expect(page.locator('#ptr')).toHaveClass(/pulling/);
  await expect(page.locator('#ptr .ptr-text')).toHaveText('下拉刷新');
  await s.end();
  await expect(page.locator('#ptr')).not.toHaveClass(/pulling/);
  await page.waitForTimeout(500);
  expect(await reloaded(page)).toBe(false);
  // 平时提示条在屏幕外
  const box = await page.locator('#ptr').boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(0);
});

test('横向拖动时间轴不会触发刷新（即使带一点向下的偏移）', async ({ page }) => {
  await openApp(page);
  await mark(page);
  const before = await trackOffset(page);
  const s = await swipe(page, 330, 300, -260, 60);
  await expect(page.locator('#ptr')).not.toHaveClass(/pulling/);
  await s.end();
  await page.waitForTimeout(500);
  expect(await reloaded(page)).toBe(false);
  expect(await trackOffset(page)).toBeLessThan(before - 100);
});

test('侧栏打开时下拉不刷新', async ({ page }) => {
  await openApp(page);
  await page.click('#browseBtn');
  await mark(page);
  const s = await swipe(page, 200, 300, 0, 250);
  await expect(page.locator('#ptr')).not.toHaveClass(/pulling/);
  await s.end();
  await page.waitForTimeout(500);
  expect(await reloaded(page)).toBe(false);
});

test('详情弹窗打开时下拉不刷新', async ({ page }) => {
  await openApp(page);
  await page.click('#browseBtn');
  await page.locator('.list-row').first().click();
  await page.click('.list-actions .btn-ghost');
  await expect(page.locator('#detailModal')).toBeVisible();
  await mark(page);
  const s = await swipe(page, 200, 300, 0, 250);
  await s.end();
  await page.waitForTimeout(500);
  expect(await reloaded(page)).toBe(false);
});

test('关闭了浏览器自带的下拉刷新，避免重复触发', async ({ page }) => {
  await openApp(page);
  const v = await page.evaluate(() => [getComputedStyle(document.documentElement).overscrollBehaviorY, getComputedStyle(document.body).overscrollBehaviorY]);
  expect(v).toEqual(['none', 'none']);
});
