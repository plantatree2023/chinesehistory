// 首次访问提示（电脑：分步指引；手机：底部气泡）、“关于本站”弹窗、手机上的“更多”菜单。
const { test, expect, openApp, DEFAULT_EVENT_COUNT } = require('./helpers');

const ONBOARD_KEY = 'zh-history-timeline:onboarded';
const DESKTOP = { width: 1440, height: 860 };
const PHONE = { width: 390, height: 780 };

// 元素 a 的矩形完全包含 b
const contains = (a, b) => a.x <= b.x + 0.5 && a.y <= b.y + 0.5 && a.x + a.width >= b.x + b.width - 0.5 && a.y + a.height >= b.y + b.height - 0.5;
const inViewport = (box, vp) => box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height;

test.describe('首次访问提示', () => {
  test.use({ onboarding: true });

  test.describe('电脑：分步指引', () => {
    test.use({ viewport: DESKTOP });

    test('第一次打开时显示三步指引，聚光灯依次指向时间轴、卡片、浏览按钮，完成后不再出现', async ({ page }) => {
      await openApp(page);
      const tour = page.locator('#tour');
      await expect(tour).toBeVisible();
      await expect(page.locator('#hintBubble')).toBeHidden();
      expect(await page.evaluate((k) => localStorage.getItem(k), ONBOARD_KEY)).toBe('1');

      await expect(page.locator('#tourStep')).toHaveText('1 / 3');
      await expect(page.locator('#tourText')).toContainText('左右拖动');
      await page.waitForTimeout(400);   // 聚光灯移动的过渡动画
      const axis = await page.locator('#axis').boundingBox();
      const spot1 = await page.locator('#tourSpot').boundingBox();
      expect(spot1.y).toBeLessThan(axis.y);
      expect(spot1.y + spot1.height).toBeGreaterThan(axis.y + axis.height);

      await page.click('#tourNext');
      await expect(page.locator('#tourStep')).toHaveText('2 / 3');
      await expect(page.locator('#tourText')).toContainText('点卡片');
      await page.waitForTimeout(400);
      const spot2 = await page.locator('#tourSpot').boundingBox();
      const cards = await page.locator('#events .card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
      expect(cards.some((c) => contains(spot2, c)), '聚光灯框住一张卡片').toBe(true);

      await page.click('#tourNext');
      await expect(page.locator('#tourStep')).toHaveText('3 / 3');
      await expect(page.locator('#tourNext')).toHaveText('开始浏览');
      await expect(page.locator('#tourSkip')).toBeHidden();
      await page.waitForTimeout(400);
      expect(contains(await page.locator('#tourSpot').boundingBox(), await page.locator('#browseBtn').boundingBox())).toBe(true);
      // 说明框完整显示在窗口内
      expect(inViewport(await page.locator('#tourTip').boundingBox(), DESKTOP)).toBe(true);

      await page.click('#tourNext');
      await expect(tour).toBeHidden();
      await page.reload();
      await expect(page.locator('.card').first()).toBeVisible();
      await page.waitForTimeout(1200);
      await expect(tour).toBeHidden();
    });

    test('可以跳过，也可以按 Esc 关闭；方向键切换步骤而不移动时间轴', async ({ page }) => {
      await openApp(page);
      await expect(page.locator('#tour')).toBeVisible();
      const before = await page.locator('#track').evaluate((t) => t.style.transform);
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('#tourStep')).toHaveText('2 / 3');
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('#tourStep')).toHaveText('1 / 3');
      expect(await page.locator('#track').evaluate((t) => t.style.transform)).toBe(before);
      await page.keyboard.press('Escape');
      await expect(page.locator('#tour')).toBeHidden();
      // 关闭后方向键照常移动时间轴
      await page.locator('#stage').focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => page.locator('#track').evaluate((t) => t.style.transform)).not.toBe(before);

      await page.evaluate((k) => localStorage.removeItem(k), ONBOARD_KEY);
      await page.reload();
      await expect(page.locator('#tour')).toBeVisible();
      await page.click('#tourSkip');
      await expect(page.locator('#tour')).toBeHidden();
    });

    test.describe('自动播放', () => {
      test.use({ autoplay: true });
      test('指引打开时自动播放停住，关闭后继续', async ({ page }) => {
      await openApp(page);
      await expect(page.locator('#tour')).toBeVisible();
      const read = () => page.locator('#track').evaluate((t) => t.style.transform);
      const a = await read();
      await page.waitForTimeout(600);
      expect(await read()).toBe(a);
      await page.keyboard.press('Escape');
      await expect.poll(read).not.toBe(a);
      });
    });

    test('通过分享链接打开详情时不显示，下次访问再提示', async ({ page }) => {
      const id = (await (await page.request.get('/data/cn_zh.json')).json()).events[5].id;
      await page.goto('/?id=' + id);
      await expect(page.locator('#detailModal')).toBeVisible();
      await page.waitForTimeout(1200);
      await expect(page.locator('#tour')).toBeHidden();
      expect(await page.evaluate((k) => localStorage.getItem(k), ONBOARD_KEY)).toBeNull();
    });
  });

  test.describe('手机：底部气泡', () => {
    test.use({ viewport: PHONE });

    test('显示底部气泡（不是分步指引），箭头指向浏览按钮，点“知道了”收起且不再出现', async ({ page }) => {
      await openApp(page);
      const hint = page.locator('#hintBubble');
      await expect(hint).toBeVisible();
      await expect(page.locator('#tour')).toBeHidden();
      const box = await hint.boundingBox();
      const bar = await page.locator('.bottombar').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(16 - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width - 16 + 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
      // 箭头的水平中心在浏览按钮范围内
      const arrowX = await hint.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el, '::after');
        return r.right - parseFloat(s.right) - parseFloat(s.width) / 2;
      });
      const btn = await page.locator('#browseBtn').boundingBox();
      expect(arrowX).toBeGreaterThan(btn.x);
      expect(arrowX).toBeLessThan(btn.x + btn.width);

      await page.click('#hintOk');
      await expect(hint).toBeHidden();
      await page.reload();
      await expect(page.locator('.card').first()).toBeVisible();
      await page.waitForTimeout(1200);
      await expect(hint).toBeHidden();
    });

    test('点页面其他地方时收起', async ({ page }) => {
      await openApp(page);
      await expect(page.locator('#hintBubble')).toBeVisible();
      await page.mouse.click(30, 300);
      await expect(page.locator('#hintBubble')).toBeHidden();
    });
  });
});

test('测试中默认不显示首次访问提示', async ({ page }) => {
  await openApp(page);
  await page.waitForTimeout(1200);
  await expect(page.locator('#tour')).toBeHidden();
  await expect(page.locator('#hintBubble')).toBeHidden();
});

test.describe('关于本站', () => {
  test.describe('电脑', () => {
    test.use({ viewport: DESKTOP });

    test('ⓘ 按钮紧挨在放大缩小按钮左边，打开关于弹窗，显示事件数量和来源', async ({ page }) => {
      await openApp(page);
      await expect(page.locator('#moreBtn')).toBeHidden();
      await expect(page.locator('#themeToggle')).toBeVisible();
      await expect(page.locator('#shareTimeline')).toBeVisible();
      const about = await page.locator('#aboutBtn').boundingBox();
      const bars = await page.locator('#barsToggle').boundingBox();
      const visible = await page.evaluate(() => [...document.querySelectorAll('.corner-btns > *')].filter((b) => b.offsetParent).map((b) => b.id));
      expect(visible.slice(-2)).toEqual(['aboutBtn', 'barsToggle']);
      expect(about.x + about.width).toBeLessThan(bars.x);

      await page.click('#aboutBtn');
      const modal = page.locator('#aboutModal');
      await expect(modal).toBeVisible();
      await expect(modal).toContainText(`目前收录 ${DEFAULT_EVENT_COUNT} 个事件`);
      await expect(modal).toContainText('CC BY-SA 4.0');
      await expect(modal).toContainText('维基共享资源');
      await expect(modal.locator('a[href*="creativecommons.org/licenses/by-sa/4.0"]')).toHaveAttribute('target', '_blank');
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
    });

    test('隐藏工具栏时关于按钮一同隐藏', async ({ page }) => {
      await openApp(page);
      await page.click('#barsToggle');
      await expect(page.locator('#aboutBtn')).toBeHidden();
      await page.click('#barsToggle');
      await expect(page.locator('#aboutBtn')).toBeVisible();
    });
  });

  test.describe('手机：更多菜单', () => {
    test.use({ viewport: PHONE });

    test('深色模式、分享、关于收进“更多”菜单，更多按钮紧挨在放大缩小按钮左边', async ({ page }) => {
      await openApp(page);
      for (const id of ['#themeToggle', '#shareTimeline', '#aboutBtn']) await expect(page.locator(id)).toBeHidden();
      const visible = await page.evaluate(() => [...document.querySelectorAll('.corner-btns > *')].filter((b) => b.offsetParent).map((b) => b.id || b.className));
      expect(visible.slice(-2)).toEqual(['more-wrap', 'barsToggle']);

      const menu = page.locator('#moreMenu');
      await expect(menu).toBeHidden();
      await page.click('#moreBtn');
      await expect(menu).toBeVisible();
      await expect(page.locator('#moreBtn')).toHaveAttribute('aria-expanded', 'true');
      await expect(menu.getByRole('menuitem')).toHaveText(['关于本站', '深色模式', '分享时间线']);
      expect(inViewport(await menu.boundingBox(), PHONE)).toBe(true);

      // 点别处、按 Esc 关闭
      await page.mouse.click(30, 500);
      await expect(menu).toBeHidden();
      await page.click('#moreBtn');
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(page.locator('#moreBtn')).toHaveAttribute('aria-expanded', 'false');
    });

    test('菜单中的三项分别打开关于、切换深色模式、打开分享', async ({ page }) => {
      await openApp(page);
      await page.click('#moreBtn');
      await page.click('#moreAbout');
      await expect(page.locator('#moreMenu')).toBeHidden();
      await expect(page.locator('#aboutModal')).toBeVisible();
      await page.keyboard.press('Escape');

      await page.click('#moreBtn');
      await page.click('#moreTheme');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.click('#moreBtn');
      await expect(page.locator('#moreTheme')).toHaveText('浅色模式');
      await page.click('#moreTheme');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

      await page.click('#moreBtn');
      await page.click('#moreShare');
      await expect(page.locator('#shareModal')).toBeVisible();
    });

    test('关于弹窗在手机上完整显示、可以滚动', async ({ page }) => {
      await openApp(page);
      await page.click('#moreBtn');
      await page.click('#moreAbout');
      const card = await page.locator('.about-card').boundingBox();
      expect(inViewport(card, PHONE)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
    });
  });
});
