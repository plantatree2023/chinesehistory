// 404 页面（404.html）：断开的时间轴；文字集中在 STRINGS 中，不写具体年份和时期，便于其他语言使用；
// 提供“回到时间轴”和“随便看一个事件”；深浅两种配色下文字有足够对比度；部署时由 Cloudflare / GitHub Pages 用于不存在的网址
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cn_zh.json'), 'utf8'));

const luminance = (page, selector, prop) => page.evaluate(({ selector, prop }) => {
  const m = getComputedStyle(document.querySelector(selector))[prop].match(/[\d.]+/g).map(Number);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
}, { selector, prop });
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

test.use({ viewport: { width: 1280, height: 800 } });

test('显示标题、说明和回到时间轴的链接', async ({ page }) => {
  await page.goto('/404.html');
  await expect(page.locator('#heading')).toHaveText('这一页不在时间轴上');
  await expect(page.locator('#message')).not.toBeEmpty();
  await expect(page).toHaveTitle(/页面不存在/);
  await expect(page.locator('#homeLink')).toHaveText('回到时间轴');
  expect(await page.locator('#homeLink').getAttribute('href')).toBe('/');
  expect(await page.locator('#brand').getAttribute('href')).toBe('/');
  await expect(page.locator('.code')).toHaveText('404');
});

test('不写具体年份和时期名，文字都在 STRINGS 中', async ({ page }) => {
  await page.goto('/404.html');
  await expect(page.locator('#heading')).not.toBeEmpty();
  const text = (await page.locator('body').innerText()).replace('404', '');
  expect(text).not.toMatch(/\d/);
  for (const era of data.eras) expect(text, `不应出现时期名“${era.name}”`).not.toContain(era.name);
  // 页面中的文字都来自脚本中的 STRINGS，HTML 里没有写死的中文
  const html = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8').replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
  expect(html).not.toMatch(/[一-鿿]/);
});

test('“随便看一个事件”打开数据集中某个事件的详情', async ({ page }) => {
  await page.goto('/404.html');
  const link = page.locator('#randomLink');
  await expect(link).toBeVisible();
  await expect(link).toHaveText('随便看一个事件');
  const href = await link.getAttribute('href');
  const id = new URL(href, 'http://x/').searchParams.get('id');
  expect(data.events.map((e) => e.id)).toContain(id);
  await link.click();
  await expect(page.locator('#detailModal')).toBeVisible();
});

test('取不到数据时只显示“回到时间轴”', async ({ page }) => {
  await page.route('**/data/*.json', (route) => route.fulfill({ status: 500, body: '' }));
  await page.goto('/404.html');
  await expect(page.locator('#heading')).not.toBeEmpty();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#randomLink')).toBeHidden();
  await expect(page.locator('#homeLink')).toBeVisible();
});

test('不请求外部资源', async ({ page }) => {
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1')) external.push(r.url()); });
  await page.goto('/404.html');
  await page.waitForLoadState('networkidle');
  expect(external).toEqual([]);
});

test.describe('手机', () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test('没有横向溢出，按钮都在屏幕内', async ({ page }) => {
    await page.goto('/404.html');
    await expect(page.locator('#randomLink')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const sel of ['#homeLink', '#randomLink', '.axis .q', '#heading']) {
      const b = await page.locator(sel).boundingBox();
      expect(b.x, sel).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, sel).toBeLessThanOrEqual(390);
    }
  });
});

for (const theme of ['light', 'dark']) {
  test(`${theme === 'dark' ? '深色' : '浅色'}模式：沿用网站的选择，文字对比度足够`, async ({ page }) => {
    await page.addInitScript((t) => { try { localStorage.setItem('zh-history-timeline:theme', t); } catch (e) {} }, theme);
    await page.goto('/404.html');
    await expect(page.locator('#randomLink')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
    const bg = await luminance(page, 'body', 'backgroundColor');
    if (theme === 'dark') expect(bg).toBeLessThan(0.05); else expect(bg).toBeGreaterThan(0.7);
    expect(contrast(await luminance(page, '#heading', 'color'), bg)).toBeGreaterThan(7);
    expect(contrast(await luminance(page, '#message', 'color'), bg)).toBeGreaterThan(4.5);
    expect(contrast(await luminance(page, '#brand', 'color'), bg)).toBeGreaterThan(4.5);
    expect(contrast(await luminance(page, '#randomLink', 'color'), bg)).toBeGreaterThan(4.5);
    expect(contrast(await luminance(page, '.code', 'color'), bg)).toBeGreaterThan(3);
    expect(contrast(await luminance(page, '#homeLink', 'color'), await luminance(page, '#homeLink', 'backgroundColor'))).toBeGreaterThan(4.5);
    expect(contrast(await luminance(page, '.axis .q', 'color'), await luminance(page, '.axis .q', 'backgroundColor'))).toBeGreaterThan(3);
  });
}
