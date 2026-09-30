// 深色模式：默认跟随系统设置；右上角按钮切换并记住选择；各处文字与背景有足够对比度。
const { test, expect, openApp, layoutMetrics, MAX_PER_SCREEN } = require('./helpers');

const THEME_KEY = 'zh-history-timeline:theme';

test.use({ viewport: { width: 1440, height: 860 } });

const theme = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
// 相对亮度（WCAG），用于判断深浅和计算对比度
const luminance = (page, selector, prop) => page.evaluate(({ selector, prop }) => {
  const el = document.querySelector(selector);
  const m = getComputedStyle(el)[prop].match(/[\d.]+/g).map(Number);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
}, { selector, prop });
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

for (const scheme of ['light', 'dark']) {
  test.describe(`系统为${scheme === 'dark' ? '深色' : '浅色'}`, () => {
    test.use({ colorScheme: scheme });

    test('默认跟随系统设置', async ({ page }) => {
      await openApp(page);
      expect(await theme(page)).toBe(scheme);
      const bg = await luminance(page, 'body', 'backgroundColor');
      if (scheme === 'dark') expect(bg).toBeLessThan(0.05); else expect(bg).toBeGreaterThan(0.7);
      await expect(page.locator('#themeToggle')).toHaveAttribute('aria-label', scheme === 'dark' ? '切换到浅色模式' : '切换到深色模式');
      await expect(page.locator(`#themeToggle .icon-${scheme === 'dark' ? 'sun' : 'moon'}`)).toBeVisible();
      await expect(page.locator(`#themeToggle .icon-${scheme === 'dark' ? 'moon' : 'sun'}`)).toBeHidden();
    });

    test('文字与背景的对比度足够，输入框等也使用对应配色', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('zh-history-timeline:debug', '1'));   // 编辑页需要调试模式
      await openApp(page);
      const card = await luminance(page, '.card', 'backgroundColor');
      expect(contrast(await luminance(page, '.card-title', 'color'), card)).toBeGreaterThan(7);
      expect(contrast(await luminance(page, '.card-short', 'color'), card)).toBeGreaterThan(4.5);
      expect(contrast(await luminance(page, '.card-date', 'color'), card)).toBeGreaterThan(4.5);
      expect(contrast(await luminance(page, '.brand-name', 'color'), await luminance(page, 'body', 'backgroundColor'))).toBeGreaterThan(7);
      // 红色按钮上的白字
      expect(contrast(await luminance(page, '#browseBtn', 'color'), await luminance(page, '#browseBtn', 'backgroundColor'))).toBeGreaterThan(4.5);

      await page.click('#browseBtn');
      const panel = await luminance(page, '.sidebar', 'backgroundColor');
      const input = await luminance(page, '#searchInput', 'backgroundColor');
      expect(contrast(await luminance(page, '.list-title', 'color'), panel)).toBeGreaterThan(7);
      if (scheme === 'dark') { expect(panel).toBeLessThan(0.05); expect(input).toBeLessThan(0.05); }
      else expect(input).toBeGreaterThan(0.9);

      await page.locator('.list-row').first().click();
      await page.click('.list-actions .btn-primary');
      const field = await luminance(page, '#editForm [name=title]', 'backgroundColor');
      expect(contrast(await luminance(page, '#editForm [name=title]', 'color'), field)).toBeGreaterThan(7);
      if (scheme === 'dark') expect(field).toBeLessThan(0.05);
    });

    test('排版规则不受配色影响', async ({ page }) => {
      await openApp(page);
      const m = await layoutMetrics(page);
      expect(m.maxPerScreen).toBeLessThanOrEqual(MAX_PER_SCREEN);
      expect(m.overlaps).toBe(0);
      expect(m.outOfBounds).toBe(0);
    });
  });
}

test('点击按钮切换并记住选择，刷新后保持，优先于系统设置', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  expect(await theme(page)).toBe('light');
  await page.click('#themeToggle');
  expect(await theme(page)).toBe('dark');
  await expect(page.locator('#themeToggle')).toHaveAttribute('aria-label', '切换到浅色模式');
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe('dark');
  await page.reload();
  expect(await theme(page)).toBe('dark');
  // 用户选过之后，系统设置变化不再影响
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await theme(page)).toBe('dark');
  await page.click('#themeToggle');
  expect(await theme(page)).toBe('light');
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe('light');
});

test('没有选择过时随系统设置实时变化', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  expect(await theme(page)).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => theme(page)).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => theme(page)).toBe('light');
});

test('页面在绘制前就确定配色（不先闪一下浅色）', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((k) => localStorage.setItem(k, 'dark'), THEME_KEY);
  // 在样式表和脚本加载前读取：html 已带 data-theme="dark"
  // 推迟 app.js：它运行前（按钮标题仍是 HTML 中的初始值）html 就已经是深色
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/js/app.js', async (route) => { await held; await route.continue(); });
  await page.reload({ waitUntil: 'commit' });
  await expect.poll(() => theme(page)).toBe('dark');
  expect(await page.locator('#themeToggle').getAttribute('title')).toBe('切换到深色模式');
  release();
  await expect(page.locator('#themeToggle')).toHaveAttribute('title', '切换到浅色模式');
});
