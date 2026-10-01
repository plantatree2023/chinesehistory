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

    test('切换工具栏的瞬间时间轴不会错位：重新排版前轴线、事件点、卡片作为整体移动，随后立即重新排版', async ({ page }) => {
      await openApp(page);
      // 记录轴线中心、事件点中心、卡片位置（相对轴线）
      const snapshot = () => {
        const axis = document.getElementById('axis').getBoundingClientRect();
        const ay = axis.top + axis.height / 2;
        return {
          renders: document.getElementById('track').dataset.renders,
          axisVsStage: (() => { const st = document.getElementById('stage').getBoundingClientRect(); return Math.round(ay - (st.top + st.height / 2)); })(),
          dots: [...document.querySelectorAll('.dot')].slice(0, 20).map((d) => { const r = d.getBoundingClientRect(); return Math.round(r.top + r.height / 2 - ay); }),
          cards: [...document.querySelectorAll('.card')].slice(0, 20).map((c) => Math.round(c.getBoundingClientRect().top - ay)),
        };
      };
      const before = await page.evaluate(`(${snapshot})()`);
      // 点击后的第一帧（还没重新排版）
      const first = await page.evaluate(`new Promise((resolve) => {
        document.getElementById('barsToggle').click();
        requestAnimationFrame(() => resolve((${snapshot})()));
      })`);
      expect(first.renders, '第一帧还没有重新排版').toBe(before.renders);
      expect(first.dots, '事件点仍在轴线上').toEqual(before.dots);
      expect(first.cards, '卡片与轴线的相对位置不变（连线不断开）').toEqual(before.cards);
      expect(Math.abs(first.axisVsStage), '轴线保持在舞台垂直中央').toBeLessThanOrEqual(1);
      // 随后重新排版（不等 150ms 防抖），排版规则成立
      await expect.poll(() => page.evaluate(() => document.getElementById('track').dataset.renders)).not.toBe(before.renders);
      await waitForStableLayout(page);
      const after = await page.evaluate(`(${snapshot})()`);
      expect(Math.abs(after.axisVsStage)).toBeLessThanOrEqual(1);
      expect(after.dots.every((d) => Math.abs(d) <= 1)).toBe(true);
      const m = await layoutMetrics(page);
      expect(m.outOfBounds).toBe(0);
      expect(m.overlaps).toBe(0);
    });

    test.describe('调试模式', () => {
      test.use({ debugMode: true });

      test('添加按钮悬浮在底栏上方，不占用底栏；隐藏工具栏后移到右下角', async ({ page }) => {
        await openApp(page);
        const bar = await page.locator('.bottombar').boundingBox();
        const fab = await page.locator('#addBtn').boundingBox();
        expect(bar.height).toBeLessThanOrEqual(56);                    // 底栏比原来（约 66px）矮
        expect(fab.y + fab.height).toBeLessThanOrEqual(bar.y - 8);      // 完全在底栏上方
        expect(fab.x + fab.width).toBeLessThanOrEqual(viewport.width - 12);
        // 底栏右侧不再为添加按钮留空：浏览按钮靠近右边缘
        const browse = await page.locator('#browseBtn').boundingBox();
        expect(viewport.width - (browse.x + browse.width)).toBeLessThanOrEqual(24);

        await page.click('#barsToggle');
        await expect(page.locator('.bottombar')).toBeHidden();
        const low = await page.locator('#addBtn').boundingBox();
        expect(low.y + low.height).toBeLessThanOrEqual(viewport.height - 10);
        expect(viewport.height - (low.y + low.height)).toBeLessThanOrEqual(24);
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
    });

    test('右上角的两个按钮完整位于顶栏内、垂直居中、互不重叠', async ({ page }) => {
      await openApp(page);
      const bar = await page.locator('.topbar').boundingBox();
      const boxes = [];
      for (const id of ['#themeToggle', '#barsToggle']) {
        const btn = await page.locator(id).boundingBox();
        expect(btn.y).toBeGreaterThanOrEqual(bar.y);
        expect(btn.y + btn.height).toBeLessThanOrEqual(bar.y + bar.height);
        expect(Math.abs((btn.y + btn.height / 2) - (bar.y + bar.height / 2))).toBeLessThanOrEqual(1.5);
        boxes.push(btn);
      }
      expect(boxes[0].x + boxes[0].width + 4).toBeLessThanOrEqual(boxes[1].x);
    });

    test('切换按钮图标：显示时为向外的四角，隐藏后为向内收的四角', async ({ page }) => {
      await openApp(page);
      const btn = page.locator('#barsToggle');
      await expect(btn.locator('.icon-expand')).toBeVisible();
      await expect(btn.locator('.icon-collapse')).toBeHidden();
      await btn.click();
      await expect(btn.locator('.icon-expand')).toBeHidden();
      await expect(btn.locator('.icon-collapse')).toBeVisible();
      await expect(btn).toHaveAttribute('aria-label', '显示工具栏');
      expect(await btn.evaluate((b) => getComputedStyle(b).transform)).toBe('none');   // 不再旋转
      await expect(page.locator('#themeToggle')).toBeHidden();                         // 隐藏时只留恢复按钮
      await btn.click();
      await expect(btn.locator('.icon-expand')).toBeVisible();
      await expect(page.locator('#themeToggle')).toBeVisible();
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
