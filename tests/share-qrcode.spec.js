// 微信分享的二维码库：保存在本地（js/vendor/），页面一开始加载就异步下载，但不阻塞页面显示；
// 打开微信分享时库还没加载完就先显示“正在生成二维码…”，加载完成后显示二维码；加载失败时提示复制链接。
const fs = require('fs');
const path = require('path');
const { test, expect, openApp } = require('./helpers');


const ROOT = path.resolve(__dirname, '..');
test.use({ viewport: { width: 1440, height: 860 } });

const LIB = '**/js/vendor/qrcode.min.js';
const libBody = fs.readFileSync(path.join(ROOT, 'js', 'vendor', 'qrcode.min.js'), 'utf8');

async function openWechat(page) {
  await page.click('#shareTimeline');
  await expect(page.locator('#shareModal')).toBeVisible();
  await page.click('.share-btn[data-share="wechat"]');
  await expect(page.locator('#shareQrcode')).toBeVisible();
}

test('二维码库保存在本地、async 加载，页面不再引用外部 CDN 的脚本', async ({ page }) => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  expect(html).not.toMatch(/<script[^>]+src="https?:/);
  expect(html).toMatch(/<script src="js\/vendor\/qrcode\.min\.js" id="qrcodeLib" async/);
  expect(fs.existsSync(path.join(ROOT, 'js', 'vendor', 'LICENSE-qrcodejs.txt'))).toBe(true);
  // 页面加载时就开始下载（不等打开分享）
  const requested = page.waitForRequest((r) => r.url().endsWith('/js/vendor/qrcode.min.js'));
  await page.goto('/');
  await requested;
});

test('二维码库下载很慢时不影响页面显示；库加载完成前打开微信分享先显示等待提示，完成后显示二维码', async ({ page }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route(LIB, async (route) => { await gate; await route.fulfill({ contentType: 'text/javascript', body: libBody }); });
  // 库还没返回：时间轴照常显示（浏览器的 load 事件会等 async 脚本，这里只等到 DOMContentLoaded）
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.card').first()).toBeVisible();
  expect(await page.evaluate(() => typeof window.QRCode)).toBe('undefined');
  await openWechat(page);
  await expect(page.locator('#shareQrcodeContainer')).toHaveText('正在生成二维码…');
  release();
  await expect(page.locator('#shareQrcodeContainer canvas, #shareQrcodeContainer img').first()).toBeAttached();
  await expect(page.locator('#shareQrcodeContainer .qrcode-wait')).toHaveCount(0);
});

test('库已加载时打开微信分享直接显示二维码；再次打开不会重复生成', async ({ page }) => {
  await openApp(page);
  await expect.poll(() => page.evaluate(() => typeof window.QRCode)).toBe('function');
  await openWechat(page);
  await expect(page.locator('#shareQrcodeContainer canvas')).toHaveCount(1);
  await page.click('#shareModal .modal-close');
  await openWechat(page);
  await expect(page.locator('#shareQrcodeContainer canvas')).toHaveCount(1);
});

test('二维码库加载失败时提示复制链接，页面其他功能正常', async ({ page }) => {
  await page.route(LIB, (route) => route.abort());
  await openApp(page);
  await openWechat(page);
  await expect(page.locator('#shareQrcodeContainer')).toContainText('二维码生成失败，请复制链接');
  await expect(page.locator('#shareQrcodeContainer')).toContainText('http');
});
