// 分享到微信好友 / 朋友圈：只在手机上显示。
// 网页不能直接调起微信的分享：在微信里提示点右上角 ···；在其他浏览器中发给好友用系统分享面板，
// 没有系统分享面板时（以及朋友圈）复制链接并提示到微信中发送。
// 分享面板的标题按分享对象显示“分享时间线”或“分享事件”。
const { test, expect, openApp } = require('./helpers');

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const WECHAT_UA = IPHONE_UA.replace('Safari/604.1', 'MicroMessenger/8.0.50(0x1800322e) NetType/WIFI Language/zh_CN');
const PHONE = { viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true };

const friendBtn = '.share-btn[data-share="wechat-friend"]';
const momentsBtn = '.share-btn[data-share="wechat-moments"]';

async function openTimelineShare(page) {
  await page.click('#moreBtn');
  await page.click('#moreShare');
  await expect(page.locator('#shareModal')).toBeVisible();
}

// 记录复制到剪贴板的内容，并可选地去掉系统分享面板
async function stubClipboard(page, { noShare = false } = {}) {
  await page.addInitScript((noShare) => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
    if (noShare) Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  }, noShare);
}

test.describe('电脑上', () => {
  test.use({ viewport: { width: 1440, height: 860 } });

  test('不显示微信好友、朋友圈按钮；分享时间线和分享事件的标题不同', async ({ page }) => {
    await openApp(page);
    await page.click('#shareTimeline');
    await expect(page.locator('#shareTitle')).toHaveText('分享时间线');
    await expect(page.locator(friendBtn)).toBeHidden();
    await expect(page.locator(momentsBtn)).toBeHidden();
    await expect(page.locator('.share-btn[data-share="wechat"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#shareModal')).toBeHidden();

    await page.locator('.card').first().click();
    await expect(page.locator('#detailModal')).toBeVisible();
    await page.click('#detailShare');
    await expect(page.locator('#shareTitle')).toHaveText('分享事件');
  });
});

test.describe('手机浏览器', () => {
  test.use({ ...PHONE, userAgent: IPHONE_UA });

  test('显示微信好友、朋友圈按钮', async ({ page }) => {
    await openApp(page);
    await openTimelineShare(page);
    await expect(page.locator('#shareTitle')).toHaveText('分享时间线');
    await expect(page.locator(friendBtn)).toBeVisible();
    await expect(page.locator(momentsBtn)).toBeVisible();
  });

  test('微信好友：有系统分享面板时用它分享时间线的链接', async ({ page }) => {
    await page.addInitScript(() => {
      window.__shared = [];
      Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__shared.push(d); return Promise.resolve(); } });
    });
    await openApp(page);
    await openTimelineShare(page);
    await page.click(friendBtn);
    await expect(page.locator('#shareModal')).toBeHidden();
    const shared = await page.evaluate(() => window.__shared);
    expect(shared).toEqual([{ title: '时间上的中国', url: new URL('/', page.url()).href }]);
  });

  test('微信好友：取消系统分享面板时不做任何事', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.reject(new DOMException('cancel', 'AbortError')) });
    });
    await openApp(page);
    await openTimelineShare(page);
    await page.click(friendBtn);
    await page.waitForTimeout(200);
    await expect(page.locator('#shareModal')).toBeVisible();
    await expect(page.locator('#shareWechatGuide')).toBeHidden();
  });

  test('微信好友：没有系统分享面板时复制链接，提示粘贴发送，并提供打开微信', async ({ page }) => {
    await stubClipboard(page, { noShare: true });
    await openApp(page);
    await openTimelineShare(page);
    await page.click(friendBtn);
    await expect(page.locator('#shareWechatGuide')).toBeVisible();
    await expect(page.locator('#shareWechatGuideText')).toContainText('链接已复制');
    await expect(page.locator('#shareWechatGuideText')).toContainText('粘贴发送给朋友');
    await expect(page.locator('#shareOpenWechat')).toHaveAttribute('href', 'weixin://');
    expect(await page.evaluate(() => window.__copied)).toEqual([new URL('/', page.url()).href]);
  });

  test('朋友圈：复制事件链接，提示在微信中打开后分享到朋友圈；切换到二维码时提示收起', async ({ page }) => {
    await stubClipboard(page);
    await openApp(page);
    await page.locator('.card').first().click();
    await page.click('#detailShare');
    await expect(page.locator('#shareTitle')).toHaveText('分享事件');
    await page.click(momentsBtn);
    await expect(page.locator('#shareWechatGuideText')).toContainText('分享到朋友圈');
    const copied = await page.evaluate(() => window.__copied);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatch(/\?id=/);

    await page.click('.share-btn[data-share="wechat"]');
    await expect(page.locator('#shareQrcode')).toBeVisible();
    await expect(page.locator('#shareWechatGuide')).toBeHidden();
  });
});

test.describe('微信内置浏览器', () => {
  test.use({ ...PHONE, userAgent: WECHAT_UA });

  for (const [btn, label] of [[friendBtn, '发送给朋友'], [momentsBtn, '分享到朋友圈']]) {
    test(`${label}：关闭分享面板，提示点右上角 ···，点任意处关闭提示`, async ({ page }) => {
      await openApp(page);
      await openTimelineShare(page);
      await page.click(btn);
      await expect(page.locator('#shareModal')).toBeHidden();
      await expect(page.locator('#wechatTip')).toBeVisible();
      await expect(page.locator('#wechatTipText')).toHaveText(`点击右上角 ··· 选择“${label}”`);
      // 提示在右上角
      const box = await page.locator('.wechat-tip-bubble').boundingBox();
      expect(box.x + box.width).toBeGreaterThan(390 - 30);
      expect(box.y).toBeLessThan(30);
      await page.mouse.click(100, 500);
      await expect(page.locator('#wechatTip')).toBeHidden();
    });
  }
});
