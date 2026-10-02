// 顶栏：标题后显示当前时期（该时期颜色），下沿色条随时期变色；标题使用书法字体；窄屏不溢出、不遮挡按钮。
const { test, expect, openApp, loadDataset, centerOnCard, trackOffset, waitForStableLayout } = require('./helpers');

// 读取顶栏状态：标题中的时期名及颜色、下沿色条颜色
function readHeader(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.topbar');
    const era = document.getElementById('currentEra');
    return {
      era: era.textContent,
      eraColor: getComputedStyle(era).color,
      stripColor: getComputedStyle(bar).borderBottomColor,
      stripWidth: getComputedStyle(bar).borderBottomWidth,
      progressLabel: document.querySelector('.mm-current').textContent,
    };
  });
}

// '#c0892f' -> 'rgb(192, 137, 47)'
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

test.describe('1440×860', () => {
  test.use({ viewport: { width: 1440, height: 860 } });

  test('标题后显示当前时期，下沿色条为该时期颜色，并随浏览切换', async ({ page }) => {
    await openApp(page);
    const { eras } = await loadDataset(page);
    const colorOf = Object.fromEntries(eras.map((e) => [e.name, e.color]));
    const seen = new Set();
    for (const title of ['元谋人', '孔子诞生', '贞观之治', '郑和下西洋', '改革开放']) {
      await centerOnCard(page, title);
      // 颜色带 0.4s 过渡，等待稳定
      await expect(async () => {
        const h = await readHeader(page);
        expect(h.era, title).not.toBe('');
        expect(`▼ ${h.era}`, `${title}：与进度条标签一致`).toBe(h.progressLabel);
        expect(h.stripColor, `${title}：色条颜色`).toBe(rgb(colorOf[h.era]));
        expect(h.stripWidth).toBe('3px');
        expect(h.eraColor, `${title}：时期名不应是默认黑色`).not.toBe('rgb(42, 37, 33)');
      }).toPass({ timeout: 5_000 });
      seen.add((await readHeader(page)).era);
    }
    expect(seen.size).toBe(5);
  });

  test('时期名比标题小一号', async ({ page }) => {
    await openApp(page);
    const [title, era] = await page.evaluate(() => ['.brand-name', '#currentEra']
      .map((sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize)));
    expect(era / title).toBeGreaterThanOrEqual(0.65);
    expect(era / title).toBeLessThanOrEqual(0.8);
  });

  test('右上角不再有单独的时期标签', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.current-era')).toHaveCount(0);
    await expect(page.locator('.topbar .brand #currentEra')).toHaveCount(1);
  });

  test('标题使用本地书法字体', async ({ page, request }) => {
    expect((await request.get('/css/fonts/ma-shan-zheng-title.woff2')).ok()).toBeTruthy();
    await openApp(page);
    const r = await page.evaluate(async () => {
      await document.fonts.ready;
      const brand = document.querySelector('.brand');
      return { family: getComputedStyle(brand).fontFamily, loaded: document.fonts.check("26px 'Ma Shan Zheng Title'", '时间上的中国') };
    });
    expect(r.family).toContain('Ma Shan Zheng Title');
    expect(r.loaded).toBe(true);
  });
});

for (const viewport of [{ width: 390, height: 780 }, { width: 320, height: 640 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test('最长的时期名也不溢出、不遮挡右上角的按钮', async ({ page }) => {
      await openApp(page);
      await page.locator('#stage').focus();
      await page.keyboard.press('End');
      await expect(page.locator('#currentEra')).toHaveText('中华人民共和国');
      const brand = await page.locator('.brand').boundingBox();
      // 右上角最左边的可见按钮（手机上深色模式、分享收进了“更多”菜单）
      const btn = await page.evaluate(() => {
        const xs = [...document.querySelectorAll('.corner-btns > *')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
        return xs.sort((a, b) => a.x - b.x)[0].toJSON();
      });
      expect(btn.x).toBeLessThan((await page.locator('#barsToggle').boundingBox()).x);
      expect(brand.x + brand.width, '标题不应伸到按钮下方').toBeLessThanOrEqual(btn.x);
      const truncated = await page.locator('.brand').evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(truncated, '标题与时期名应完整显示，不被省略号截断').toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    });
  });
}

test.describe('点击标题回到开头', () => {
  test.use({ viewport: { width: 1440, height: 860 } });

  test('标题外观与普通标题完全一致：没有按钮样式，悬浮不变色，左边距不变', async ({ page }) => {
    await openApp(page);
    const read = () => page.evaluate(() => {
      const a = document.getElementById('homeBtn');
      const cs = getComputedStyle(a);
      const name = document.querySelector('.brand-name');
      return {
        tag: a.tagName, padding: cs.padding, margin: cs.margin, border: cs.borderTopWidth, bg: cs.backgroundColor,
        deco: cs.textDecorationLine, display: cs.display, nameColor: getComputedStyle(name).color,
        ink: getComputedStyle(document.body).color, left: Math.round(name.getBoundingClientRect().left),
      };
    });
    const before = await read();
    expect(before).toMatchObject({ tag: 'A', padding: '0px', margin: '0px', border: '0px', bg: 'rgba(0, 0, 0, 0)', deco: 'none', display: 'inline' });
    expect(before.nameColor).toBe(before.ink);
    expect(before.left).toBe(20);                     // 与顶栏左内边距一致（原来的位置）
    await page.hover('.brand-name');
    const hovered = await read();
    expect(hovered.nameColor, '悬浮时不变色').toBe(before.ink);
    // 鼠标点击后不显示焦点轮廓
    await page.click('.brand-name');
    expect(await page.locator('#homeBtn').evaluate((a) => getComputedStyle(a).outlineStyle)).toBe('none');
  });

  test('拖到后面后点击左上角标题，平滑回到时间轴开头', async ({ page }) => {
    await openApp(page);
    await page.locator('#stage').focus();
    await page.keyboard.press('End');
    await expect.poll(() => trackOffset(page)).toBeLessThan(-1000);
    await expect(page.locator('#currentEra')).toHaveText('中华人民共和国');
    await expect(page.locator('#homeBtn')).toHaveAttribute('title', '回到时间轴开头');
    await page.click('.brand-name');
    await expect.poll(() => trackOffset(page)).toBe(0);
    await expect(page.locator('#currentEra')).toHaveText('旧石器时代');
    // 键盘也能使用
    await page.keyboard.press('End');
    await page.locator('#homeBtn').focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => trackOffset(page)).toBe(0);
  });
});

// 直接打开网站时停在时间轴开头，顶栏显示第一个事件的时期；到结尾显示最后一个事件的时期。
// 大屏一屏能放下多个时期的事件，不能只看视野中心。
for (const width of [1024, 1440, 1920, 2560]) {
  test.describe(`${width} 宽：开头与结尾的时期`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('打开时显示旧石器时代，滚到最后显示中华人民共和国', async ({ page }) => {
      await openApp(page);
      await expect.poll(() => trackOffset(page)).toBe(0);
      await expect(page.locator('#currentEra')).toHaveText('旧石器时代');
      await expect(page.locator('.mm-current')).toHaveText('▼ 旧石器时代');
      await waitForStableLayout(page);
      await page.locator('#stage').focus();
      await page.keyboard.press('End');
      await expect.poll(() => trackOffset(page)).toBeLessThan(-1000);
      await expect(page.locator('#currentEra')).toHaveText('中华人民共和国');
    });
  });
}

test.describe('重新排版', () => {
  test.use({ viewport: { width: 1440, height: 860 } });

  test('停在开头 / 结尾时，窗口尺寸变化后仍停在开头 / 结尾', async ({ page }) => {
    await openApp(page);
    await waitForStableLayout(page);
    await expect.poll(() => trackOffset(page)).toBe(0);
    for (const size of [{ width: 1920, height: 900 }, { width: 1100, height: 760 }]) {
      await page.setViewportSize(size);
      await waitForStableLayout(page);
      await expect.poll(() => trackOffset(page)).toBe(0);
      await expect(page.locator('#currentEra')).toHaveText('旧石器时代');
    }
    await page.locator('#stage').focus();
    await page.keyboard.press('End');
    await expect.poll(() => trackOffset(page)).toBeLessThan(-1000);
    await waitForStableLayout(page);
    const atEnd = () => page.evaluate(() => document.getElementById('navRight').classList.contains('at-end'));
    await expect.poll(atEnd).toBe(true);
    await page.setViewportSize({ width: 1600, height: 860 });
    await waitForStableLayout(page);
    await expect.poll(atEnd).toBe(true);
    await expect(page.locator('#currentEra')).toHaveText('中华人民共和国');
  });
});
