// 工具栏显示 / 隐藏：默认显示，可用按钮或 H 键切换，隐藏后时间轴扩展且排版规则仍成立。
const { test, expect, openApp, waitForStableLayout, layoutMetrics, MAX_PER_SCREEN } = require('./helpers');

const stageHeight = (page) => page.evaluate(() => document.getElementById('stage').clientHeight);

for (const viewport of [{ width: 1440, height: 860 }, { width: 390, height: 780 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test('默认显示工具栏，按钮可隐藏和恢复', async ({ page }) => {
      await openApp(page);
      await expect(page.locator('.topbar')).toBeVisible();
      await expect(page.locator('.bottombar')).toBeVisible();
      const shownHeight = await stageHeight(page);

      await page.click('#barsToggle');
      await expect(page.locator('.topbar')).toBeHidden();
      await expect(page.locator('.bottombar')).toBeHidden();
      await expect(page.locator('#barsToggle')).toBeVisible();
      await expect(page.locator('#barsToggle')).toHaveAttribute('aria-pressed', 'true');
      await waitForStableLayout(page);
      expect(await stageHeight(page)).toBeGreaterThan(shownHeight);
      const m = await layoutMetrics(page);
      expect(m.maxPerScreen).toBeLessThanOrEqual(MAX_PER_SCREEN);
      expect(m.outOfBounds).toBe(0);
      expect(m.overlaps).toBe(0);

      await page.click('#barsToggle');
      await expect(page.locator('.topbar')).toBeVisible();
      await expect(page.locator('.bottombar')).toBeVisible();
      await waitForStableLayout(page);
      expect(await stageHeight(page)).toBe(shownHeight);
      expect((await layoutMetrics(page)).outOfBounds).toBe(0);
    });

    test('H 键切换工具栏，在输入框中输入 h 不触发', async ({ page }) => {
      await openApp(page);
      await page.locator('#stage').focus();
      await page.keyboard.press('h');
      await expect(page.locator('.topbar')).toBeHidden();
      await page.keyboard.press('h');
      await expect(page.locator('.topbar')).toBeVisible();

      await page.click('#addBtn');
      await page.locator('#editForm [name=title]').pressSequentially('hh');
      await expect(page.locator('#editForm [name=title]')).toHaveValue('hh');
      await expect(page.locator('.topbar')).toBeVisible();
    });

    test('切换按钮完整位于顶栏内且垂直居中', async ({ page }) => {
      await openApp(page);
      const bar = await page.locator('.topbar').boundingBox();
      const btn = await page.locator('#barsToggle').boundingBox();
      expect(btn.y).toBeGreaterThanOrEqual(bar.y);
      expect(btn.y + btn.height).toBeLessThanOrEqual(bar.y + bar.height);
      expect(Math.abs((btn.y + btn.height / 2) - (bar.y + bar.height / 2))).toBeLessThanOrEqual(1.5);
    });

    test('刷新后恢复默认显示', async ({ page }) => {
      await openApp(page);
      await page.click('#barsToggle');
      await expect(page.locator('.topbar')).toBeHidden();
      await page.reload();
      await expect(page.locator('.topbar')).toBeVisible();
    });
  });
}
