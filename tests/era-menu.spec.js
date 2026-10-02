// 朝代 / 时期菜单：电脑上顶栏时期名右侧的 ▾ 打开列表（色块、时期名、年代）；手机上底栏左侧的“■ 唐 ▾”打开底部色块面板。
// 选择后跳到该时期（顶栏显示所选时期），菜单关闭；Esc、点外面关闭；可用键盘操作。
const { test, expect, openApp, loadDataset, trackOffset } = require('./helpers');

const eraNames = (page) => page.locator('#eraMenuList .era-item').evaluateAll((els) => els.map((e) => e.dataset.era));

test.describe('电脑', () => {
  test.use({ viewport: { width: 1440, height: 860 } });

  test('时期名右侧的按钮打开列表：每项有色块、时期名、年代，当前时期高亮；底栏按钮不显示', async ({ page }) => {
    const { eras } = await loadDataset(page);
    await openApp(page);
    await expect(page.locator('#eraBarBtn')).toBeHidden();
    const btn = page.locator('#eraMenuBtn');
    await expect(btn).toBeVisible();
    const era = await page.locator('#currentEra').boundingBox();
    const b = await btn.boundingBox();
    expect(b.x).toBeGreaterThan(era.x + era.width - 1);
    expect(Math.abs((b.y + b.height / 2) - (era.y + era.height / 2))).toBeLessThanOrEqual(4);
    // 图标样式，不是按钮外观：没有边框、背景和阴影
    const look = await btn.evaluate((e) => { const c = getComputedStyle(e); return { border: c.borderTopStyle, bg: c.backgroundColor, shadow: c.boxShadow }; });
    expect(look).toEqual({ border: 'none', bg: 'rgba(0, 0, 0, 0)', shadow: 'none' });
    await btn.click();
    await expect(page.locator('#eraMenu')).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#eraScrim')).toBeHidden();
    expect(await eraNames(page)).toEqual(eras.map((e) => e.name));
    const first = page.locator('#eraMenuList .era-item').first();
    await expect(first.locator('.era-range')).toHaveText(eras[0].range);
    await expect(first.locator('.era-swatch')).toBeVisible();
    await expect(page.locator('#eraMenuList .era-item.on')).toHaveText(new RegExp('^' + eras[0].name));
    // 列表在按钮下方
    const m = await page.locator('#eraMenu').boundingBox();
    expect(m.y).toBeGreaterThan(b.y + b.height);
  });

  test('选择后跳到该时期，顶栏显示所选时期，菜单关闭', async ({ page }) => {
    await openApp(page);
    const names = await eraNames(page);
    for (const n of names) {
      await page.click('#eraMenuBtn');
      await page.click(`#eraMenuList .era-item[data-era="${n}"]`);
      await expect(page.locator('#eraMenu')).toBeHidden();
      await expect(page.locator('#currentEra'), n).toHaveText(n);
    }
    // 再往回跳
    await page.click('#eraMenuBtn');
    await page.click('#eraMenuList .era-item[data-era="唐"]');
    await expect(page.locator('#currentEra')).toHaveText('唐');
    await page.click('#eraMenuBtn');
    await expect(page.locator('#eraMenuList .era-item.on')).toHaveAttribute('data-era', '唐');
  });

  test('Esc 或点外面关闭，不移动；键盘：方向键选择、Enter 跳转', async ({ page }) => {
    await openApp(page);
    const x0 = await trackOffset(page);
    await page.click('#eraMenuBtn');
    await page.keyboard.press('Escape');
    await expect(page.locator('#eraMenu')).toBeHidden();
    await expect(page.locator('#eraMenuBtn')).toBeFocused();
    await page.click('#eraMenuBtn');
    await page.mouse.click(1000, 500);
    await expect(page.locator('#eraMenu')).toBeHidden();
    expect(await trackOffset(page)).toBe(x0);
    // 键盘
    await page.locator('#eraMenuBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#eraMenuList .era-item.on')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    expect(await trackOffset(page), '方向键不平移时间轴').toBe(x0);
    const target = await page.evaluate(() => document.activeElement.dataset.era);
    await page.keyboard.press('Enter');
    await expect(page.locator('#currentEra')).toHaveText(target);
  });

  test('另一份数据（真实数据 cn_zh）：开头附近的时期也能跳准', async ({ page }) => {
    await page.goto('/?data=cn_zh');
    await expect(page.locator('.card').first()).toBeVisible();
    for (const n of ['新石器时代', '夏', '中华民国', '旧石器时代']) {
      await page.click('#eraMenuBtn');
      await page.click(`#eraMenuList .era-item[data-era="${n}"]`);
      await expect(page.locator('#currentEra'), n).toHaveText(n);
    }
  });
});

test.describe('手机', () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test('底栏左侧显示当前时期的按钮，点开底部色块面板；选择后跳转并关闭；点遮罩关闭', async ({ page }) => {
    const { eras } = await loadDataset(page);
    await openApp(page);
    await expect(page.locator('#eraMenuBtn')).toBeHidden();
    const bar = page.locator('#eraBarBtn');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText(eras[0].name);
    await expect(page.locator('#browseBtn')).toHaveText('浏览所有历史事件');
    const bb = await bar.boundingBox(), browse = await page.locator('#browseBtn').boundingBox();
    expect(bb.x + bb.width).toBeLessThan(browse.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await bar.click();
    const sheet = page.locator('#eraMenu');
    await expect(sheet).toBeVisible();
    await expect(page.locator('#eraScrim')).toBeVisible();
    await expect(page.locator('#eraMenu .era-menu-head')).toHaveText('跳转到朝代 / 时期');
    const s = await sheet.boundingBox();
    expect(Math.round(s.y + s.height)).toBe(780);   // 贴着屏幕底部
    expect(s.width).toBeGreaterThanOrEqual(388);
    // 色块：背景为时期颜色，不显示年代
    const tang = page.locator('#eraMenuList .era-item[data-era="唐"]');
    await expect(tang.locator('.era-range')).toBeHidden();
    const tangColor = eras.find((e) => e.name === '唐').color;
    const rgb = `rgb(${[1, 3, 5].map((i) => parseInt(tangColor.slice(i, i + 2), 16)).join(', ')})`;
    expect(await tang.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(rgb);
    await tang.click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('#currentEra')).toHaveText('唐');
    await expect(bar).toContainText('唐');
    // 点遮罩关闭
    await bar.click();
    await page.mouse.click(195, 60);
    await expect(sheet).toBeHidden();
    await expect(page.locator('#eraScrim')).toBeHidden();
  });

  test('地址栏收起 / 展开（只改变高度）时面板不关闭；横竖屏切换（宽度变化）时关闭', async ({ page }) => {
    await openApp(page);
    await page.click('#eraBarBtn');
    const sheet = page.locator('#eraMenu');
    await expect(sheet).toBeVisible();
    await page.setViewportSize({ width: 390, height: 840 });   // 地址栏收起
    await page.setViewportSize({ width: 390, height: 780 });   // 地址栏展开
    await page.waitForTimeout(300);
    await expect(sheet).toBeVisible();
    await expect(page.locator('#eraScrim')).toBeVisible();
    await page.setViewportSize({ width: 780, height: 390 });   // 横屏
    await expect(sheet).toBeHidden();
    await expect(page.locator('#eraScrim')).toBeHidden();
  });

  test('切换时期时底栏两个按钮的宽度不变，高度一致', async ({ page }) => {
    await openApp(page);
    const boxes = async () => ({
      era: await page.locator('#eraBarBtn').boundingBox(),
      browse: await page.locator('#browseBtn').boundingBox(),
    });
    const first = await boxes();
    expect(Math.abs(first.era.height - first.browse.height)).toBeLessThanOrEqual(1);
    for (const n of await eraNames(page)) {
      await page.click('#eraBarBtn');
      await page.click(`#eraMenuList .era-item[data-era="${n}"]`);
      await expect(page.locator('#eraBarBtn'), n).toContainText(n);
      const b = await boxes();
      expect(b.era.width, n).toBeCloseTo(first.era.width, 0);
      expect(b.browse.width, n).toBeCloseTo(first.browse.width, 0);
      expect(b.browse.x, n).toBeCloseTo(first.browse.x, 0);
    }
  });

  test('每个时期都能跳准', async ({ page }) => {
    await openApp(page);
    for (const n of await eraNames(page)) {
      await page.click('#eraBarBtn');
      await page.click(`#eraMenuList .era-item[data-era="${n}"]`);
      await expect(page.locator('#currentEra'), n).toHaveText(n);
    }
  });
});

test.describe('320 宽', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test('底栏按钮和“浏览事件”按钮都完整显示，最长的时期名也不横向溢出', async ({ page }) => {
    await openApp(page);
    await page.locator('#stage').focus();
    await page.keyboard.press('End');
    await expect(page.locator('#eraBarBtn')).toContainText('中华人民共和国');
    expect(await page.locator('#browseBtn').evaluate((b) => b.innerText.replace(/\s+/g, ''))).toBe('浏览事件');   // 显示的文字
    const bb = await page.locator('#eraBarBtn').boundingBox(), browse = await page.locator('#browseBtn').boundingBox();
    expect(bb.x).toBeGreaterThanOrEqual(0);
    expect(browse.x + browse.width).toBeLessThanOrEqual(320);
    expect(await page.locator('#browseBtn').evaluate((b) => b.scrollWidth <= b.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    expect(await page.locator('#eraBarName').evaluate((n) => n.scrollWidth <= n.clientWidth + 1), '时期名完整显示').toBe(true);
  });
});
