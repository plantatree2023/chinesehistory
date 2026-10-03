// 浏览器模式的保存方式：只保存访问者自己的改动（相对数据文件的差异），
// 数据文件以后的更新（新增字段如 transition、修改文字、新事件）对没有改动过的内容仍然生效。
const { test, expect, loadDataset, waitForStableLayout, DEFAULT_EVENT_COUNT, STORAGE_KEY, DATA_URL } = require('./helpers');

test.use({ viewport: { width: 1440, height: 860 }, debugMode: true });

const readStored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);

async function open(page) {
  await page.goto('/');
  await expect(page.locator('.card').first()).toBeVisible();
  await waitForStableLayout(page);
}

async function editTitle(page, search, title) {
  await page.click('#browseBtn');
  await page.fill('#searchInput', search);
  await page.locator('.list-row').first().click();
  await page.click('.list-actions .btn-primary');
  await page.fill('#editForm [name=title]', title);
  await page.click('#editForm button[type=submit]');
  await expect(page.locator('#editModal')).toBeHidden();
}

test('只保存改动过的字段和删除的事件', async ({ page }) => {
  const { events } = await loadDataset(page);
  await open(page);
  await editTitle(page, '贞观之治', '贞观之治（改）');
  await page.fill('#searchInput', '玄武门之变');
  await page.locator('.list-row').first().click();
  await page.click('.list-actions .btn-danger');
  await page.click('#confirmOk');

  const zg = events.find((e) => e.title === '贞观之治');
  const xwm = events.find((e) => e.title === '玄武门之变');
  const stored = await readStored(page);
  expect(stored).toEqual({ version: 2, changed: { [zg.id]: { title: '贞观之治（改）', updatedAt: expect.any(Number) } }, deleted: [xwm.id] });
});

test('数据文件更新后，没有改动过的事件和字段显示新内容，改动保留', async ({ page }) => {
  const { events } = await loadDataset(page);
  const zg = events.find((e) => e.title === '贞观之治');
  await open(page);
  await editTitle(page, '贞观之治', '贞观之治（改）');

  // 模拟之后部署的新数据：贞观之治的说明、另一个事件的标题都有更新，另有一个新事件
  await page.route(`**${DATA_URL}`, async (route) => {
    const data = await (await route.fetch()).json();
    const z = data.events.find((e) => e.id === zg.id);
    z.short = '数据文件中更新后的说明文字，用于验证未改动的字段会跟随数据更新。';
    data.events.find((e) => e.title === '安史之乱').title = '安史之乱（数据更新）';
    data.events.push({ ...data.events[0], id: 'new-in-data', title: '数据中新增的事件', year: 1985, date: '1985年' });
    await route.fulfill({ json: data });
  });
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT + 1);
  await expect(page.locator('.card-title', { hasText: '贞观之治（改）' })).toHaveCount(1);
  await expect(page.locator('.card', { hasText: '贞观之治（改）' }).locator('.card-short')).toContainText('数据文件中更新后的说明文字');
  await expect(page.locator('.card-title', { hasText: '安史之乱（数据更新）' })).toHaveCount(1);
  await expect(page.locator('.card-title', { hasText: '数据中新增的事件' })).toHaveCount(1);
});

test('旧版本保存的整份快照：迁移后时期更迭筛选可用，访问者的改动保留', async ({ page }) => {
  const { events } = await loadDataset(page);
  const transitions = events.filter((e) => e.transition).length;
  expect(transitions).toBeGreaterThan(0);
  // 旧快照：没有 transition 字段，图片还是外部地址，其中一个事件被改过标题、一个被删除
  const snapshot = events.slice(1).map((e) => {
    const { transition, ...rest } = e;
    return { ...rest, images: rest.images.map((im) => ({ ...im, src: 'https://upload.wikimedia.org/x/' + im.src.slice(7) })) };
  });
  snapshot[5].title = '旧快照中改过的标题';
  await page.goto('/');
  await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: STORAGE_KEY, v: JSON.stringify(snapshot) });
  await open(page);

  await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT - 1);
  await expect(page.locator('.card-title', { hasText: '旧快照中改过的标题' })).toHaveCount(1);
  // 外部图片地址不再使用
  const external = await page.evaluate(() => [...document.images].filter((i) => /^https?:/.test(i.getAttribute('src') || '')).length);
  expect(external).toBe(0);

  await page.click('#browseBtn');
  await page.click('#filterToggle');
  const section = page.locator('.filter-section[data-filter="transition"]');
  await expect(section).toContainText(`只看时期更迭的事件（${transitions}）`);
  await section.locator('input[type=checkbox]').check();
  await expect(page.locator('.list-item')).toHaveCount(transitions);

  const stored = await readStored(page);
  expect(stored.version).toBe(2);
  expect(stored.deleted).toEqual([events[0].id]);
  expect(Object.values(stored.changed)).toEqual([{ title: '旧快照中改过的标题' }]);
});

test('清除时期更迭后刷新仍保持清除', async ({ page }) => {
  await open(page);
  await page.click('#browseBtn');
  await page.fill('#searchInput', '秦统一六国');
  await page.locator('.list-row').first().click();
  await page.click('.list-actions .btn-primary');
  await page.selectOption('#editForm [name=transitionFrom]', '');
  await page.selectOption('#editForm [name=transitionTo]', '');
  await page.click('#editForm button[type=submit]');
  await expect(page.locator('.list-transition')).toHaveCount(0);
  // 打开不带参数的首页（直接刷新会按网址恢复侧栏），验证数据在新的访问中仍然保留
  await page.goto('/');
  await expect(page.locator('.card').first()).toBeVisible();
  await page.click('#browseBtn');
  await page.fill('#searchInput', '秦统一六国');
  await expect(page.locator('.list-item')).toHaveCount(1);
  await expect(page.locator('.list-transition')).toHaveCount(0);
});
