// 核心功能：时间轴浏览、事件详情、编辑 / 新增 / 删除、侧栏、数据持久化。
const { test, expect, openApp, loadDataset, trackOffset, waitForStableLayout, DEFAULT_EVENT_COUNT, STORAGE_KEY } = require('./helpers');

test.use({ viewport: { width: 1440, height: 860 } });

// 找一张完整显示在屏幕内的卡片
async function visibleCard(page) {
  const cards = page.locator('.card');
  const vw = page.viewportSize().width;
  for (let i = 0; i < await cards.count(); i++) {
    const box = await cards.nth(i).boundingBox();
    if (box && box.x > 60 && box.x + box.width < vw - 60) return cards.nth(i);
  }
  throw new Error('屏幕内没有完整可见的卡片');
}

test.describe('时间轴浏览', () => {
  test('默认显示 100 个按时间排序的事件', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT);
    const years = (await loadDataset(page)).events.map((e) => e.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  test('拖动可平移时间轴，且拖动不会误打开详情', async ({ page }) => {
    await openApp(page);
    const before = await trackOffset(page);
    await page.mouse.move(1000, 300);
    await page.mouse.down();
    await page.mouse.move(400, 300, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => trackOffset(page)).toBeLessThan(before - 300);
    await expect(page.locator('#detailModal')).toBeHidden();
  });

  test('键盘 End / Home 跳到时间轴两端', async ({ page }) => {
    await openApp(page);
    await page.locator('#stage').focus();
    await page.keyboard.press('End');
    await expect.poll(() => trackOffset(page)).toBeLessThan(-1000);
    await page.keyboard.press('Home');
    await expect.poll(() => trackOffset(page)).toBe(0);
  });
});

test.describe('事件详情', () => {
  test('点击卡片打开详情，说明不超过 350 字', async ({ page }) => {
    await openApp(page);
    const card = await visibleCard(page);
    const title = await card.locator('.card-title').textContent();
    await card.click();
    await expect(page.locator('#detailModal')).toBeVisible();
    await expect(page.locator('#detailTitle')).toHaveText(title);
    const text = await page.locator('#detailText').textContent();
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(350);
    await expect(page.locator('#detailEdit')).toBeVisible();
    await expect(page.locator('#detailDelete')).toBeVisible();
  });

  test('在详情中编辑，修改后刷新页面仍然保留', async ({ page }) => {
    await openApp(page);
    await (await visibleCard(page)).click();
    await page.click('#detailEdit');
    await expect(page.locator('#editModal')).toBeVisible();
    await page.fill('#editForm [name=title]', '测试编辑标题');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('.card-title', { hasText: '测试编辑标题' })).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.card-title', { hasText: '测试编辑标题' })).toHaveCount(1);
  });

  test('在详情中删除事件', async ({ page }) => {
    await openApp(page);
    await (await visibleCard(page)).click();
    await page.click('#detailDelete');
    await page.click('#confirmOk');
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT - 1);
  });
});

test.describe('新增事件', () => {
  test('填写表单后出现在时间轴上，并执行字数与图片数量上限', async ({ page }) => {
    await openApp(page);
    await page.click('#addBtn');
    await page.fill('#editForm [name=title]', '新增测试事件');
    await page.selectOption('#editForm [name=era]', 'bce');
    await page.fill('#editForm [name=yearAbs]', '500');
    await page.fill('#editForm [name=short]', '这是一段用于自动化测试的简要说明文字，长度超过二十个字。');
    await page.fill('#editForm [name=detail]', '详细'.repeat(200));
    expect((await page.inputValue('#editForm [name=detail]')).length).toBe(350);

    for (let i = 0; i < 9; i++) {
      await page.fill('#imageUrlInput', `https://example.com/${i}.jpg`);
      await page.click('#imageUrlAdd');
    }
    await expect(page.locator('#imageEditor .img-slot')).toHaveCount(9);
    await expect(page.locator('#imageUrlAdd')).toBeDisabled();

    await page.click('#editForm button[type=submit]');
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT + 1);
    await expect(page.locator('.card-title', { hasText: '新增测试事件' })).toHaveCount(1);
  });

  test('缺少标题时拒绝保存', async ({ page }) => {
    await openApp(page);
    await page.click('#addBtn');
    await page.fill('#editForm [name=title]', '');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#formError')).toContainText('名称');
    await expect(page.locator('#editModal')).toBeVisible();
  });
});

test.describe('侧栏', () => {
  test('按时间顺序列出全部事件，可搜索', async ({ page }) => {
    await openApp(page);
    await page.click('#browseBtn');
    await expect(page.locator('.list-item')).toHaveCount(DEFAULT_EVENT_COUNT);
    await page.fill('#searchInput', '贞观');
    await expect(page.locator('.list-item')).toHaveCount(1);
    await expect(page.locator('.list-title')).toHaveText('贞观之治');
  });

  test('在侧栏中编辑和删除事件', async ({ page }) => {
    await openApp(page);
    await page.click('#browseBtn');
    await page.locator('.list-row').nth(5).click();
    await page.click('.list-actions .btn-primary');
    await expect(page.locator('#editModal')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.click('.list-actions .btn-danger');
    await page.click('#confirmOk');
    await expect(page.locator('.list-item')).toHaveCount(DEFAULT_EVENT_COUNT - 1);
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT - 1);
  });

  test('恢复默认数据会撤销所有修改', async ({ page }) => {
    await openApp(page);
    await page.click('#browseBtn');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-danger');
    await page.click('#confirmOk');
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT - 1);
    await page.click('#resetBtn');
    await page.click('#confirmOk');
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT);
  });
});

test.describe('数据集', () => {
  test('迁移旧版本保存在浏览器中的修改', async ({ page }) => {
    const { events } = await loadDataset(page);
    const legacy = events.slice(0, 10).map((e) => ({ ...e }));
    legacy[0].title = '旧版本保存的标题';
    await page.goto('/');
    await page.evaluate((v) => localStorage.setItem('zh-history-timeline:v1', v), JSON.stringify(legacy));
    await page.reload();
    await expect(page.locator('.card')).toHaveCount(10);
    await expect(page.locator('.card-title', { hasText: '旧版本保存的标题' })).toHaveCount(1);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toEqual([STORAGE_KEY]);
  });

  test('不存在的数据集显示错误提示', async ({ page }) => {
    await page.goto('/?data=jp_ja');
    await expect(page.locator('.load-error')).toContainText('data/jp_ja.json');
    await expect(page.locator('.card')).toHaveCount(0);
  });

  test('非法的数据集名称回退到默认数据集', async ({ page }) => {
    await page.goto('/?data=../server');
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT);
  });
});

test.describe('手机', () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test('页面没有横向溢出', async ({ page }) => {
    await openApp(page);
    await waitForStableLayout(page);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});
