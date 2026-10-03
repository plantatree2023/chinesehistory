// 调试模式的资料检查与更新时间：
// - 事件的 updatedAt（Unix 时间戳，单位秒）在编辑页保存（内容有变化时）时更新，服务器拒绝毫秒等无效值；
// - 主页卡片：编辑按钮、带年份的更新日期、⚠ 问题数（鼠标悬停 / 手机上点一下显示下拉列表）；
// - 详情页、编辑页的资料检查框：缺少版权信息、缺少当前语言的图片标题，实时计算，不写进数据。
const { test, expect, seedEvents, centerOnCard, loadDataset, DATASET, STORAGE_KEY } = require('./helpers');
const { validateDataset } = require('../server');

const EVENT_ID = 'e003';     // 测试数据中的“山顶洞人”：6 张图片都没有版权信息，第 3、4 张没有标题
const TITLE = '山顶洞人';
const CLEAN_ID = 'e002';     // 测试中把它的图片资料补全
const UPDATED = 1790000000;  // 上海时间 2026-09-21 22:13

test.use({ viewport: { width: 1440, height: 860 }, timezoneId: 'Asia/Shanghai' });

function prepare(events) {
  events.find((e) => e.id === EVENT_ID).updatedAt = UPDATED;
  const clean = events.find((e) => e.id === CLEAN_ID);
  clean.images.forEach((im, i) => Object.assign(im, { caption: im.caption || `图 ${i + 1}`, license: 'CC0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg' }));
  return events;
}
const card = (page, id) => page.locator(`.card[data-id="${id}"]`);

test('不在调试模式时不显示编辑按钮、更新时间和资料检查', async ({ page }) => {
  await seedEvents(page, prepare);
  await expect(card(page, EVENT_ID).locator('.card-debug')).toBeHidden();
  await page.goto(`/?id=${EVENT_ID}`);
  await expect(page.locator('#detailModal')).toBeVisible();
  await expect(page.locator('#detailCheck')).toBeHidden();
});

test.describe('调试模式', () => {
  test.use({ debugMode: true });

  test('主页卡片：编辑按钮、带年份的更新日期在状态图标左边，悬停 ⚠ 显示下拉列表', async ({ page }) => {
    await seedEvents(page, prepare);
    await centerOnCard(page, TITLE);
    const c = card(page, EVENT_ID);
    await expect(c.locator('.card-edit')).toBeVisible();
    await expect(c.locator('.card-updated')).toHaveText('2026-09-21');
    const icon = c.locator('.card-alert');
    await expect(icon).toHaveText('⚠ 8');   // 6 张缺版权 + 2 张缺中文标题
    const dateBox = await c.locator('.card-updated').boundingBox(), iconBox = await icon.boundingBox();
    expect(dateBox.x + dateBox.width).toBeLessThanOrEqual(iconBox.x);

    await expect(page.locator('#alertPop')).toHaveCount(0);
    await icon.hover();
    const pop = page.locator('#alertPop');
    await expect(pop).toBeVisible();
    await expect(pop.locator('.check-title')).toHaveText('⚠ 资料检查：8 项待补');
    await expect(pop.locator('.check-updated')).toHaveText('最后更新 2026-09-21 22:13');
    await expect(pop.locator('.check-row')).toHaveCount(6);
    await expect(pop.locator('.check-row').nth(2).locator('.check-tag')).toHaveText(['缺来源和许可证', '缺中文标题']);
    // 移开后收起
    await page.mouse.move(5, 5);
    await expect(pop).toBeHidden();

    // 资料齐全的卡片显示 ✓，没有更新时间时不显示日期
    const clean = card(page, CLEAN_ID);
    await centerOnCard(page, await clean.locator('.card-title').textContent());
    await expect(clean.locator('.card-alert')).toHaveText('✓');
    await expect(clean.locator('.card-updated')).toHaveCount(0);
  });

  test('卡片上的编辑按钮直接打开编辑页，点卡片其他地方仍打开详情', async ({ page }) => {
    await seedEvents(page, prepare);
    await centerOnCard(page, TITLE);
    await card(page, EVENT_ID).locator('.card-edit').click();
    await expect(page.locator('#editModal')).toBeVisible();
    await expect(page.locator('#detailModal')).toBeHidden();
    await expect(page.locator('#editForm [name=title]')).toHaveValue(TITLE);
    await page.click('#editModal .modal-close');
    await card(page, EVENT_ID).locator('.card-title').click();
    await expect(page.locator('#detailModal')).toBeVisible();
  });

  test('详情页的资料检查框逐张列出问题，“去编辑页补全”打开编辑页', async ({ page }) => {
    await seedEvents(page, prepare);
    await page.goto(`/?id=${EVENT_ID}`);
    const box = page.locator('#detailCheck');
    await expect(box).toBeVisible();
    await expect(box.locator('.check-title')).toHaveText('⚠ 资料检查：8 项待补');
    await expect(box.locator('.check-updated')).toHaveText('最后更新 2026-09-21 22:13');
    await expect(box.locator('.check-which')).toHaveText(['第 1 张（代表图）', '第 2 张', '第 3 张', '第 4 张', '第 5 张', '第 6 张']);
    await box.locator('.check-edit').click();
    await expect(page.locator('#editModal')).toBeVisible();
    await expect(page.locator('#detailModal')).toBeHidden();

    // 资料齐全时只显示“齐全”和更新时间
    await page.goto(`/?id=${CLEAN_ID}`);
    await expect(page.locator('#detailCheck .check-title')).toHaveText('✓ 资料检查：图片资料齐全');
    await expect(page.locator('#detailCheck .check-updated')).toHaveText('没有更新时间');
    await expect(page.locator('#detailCheck .check-row')).toHaveCount(0);
  });

  test('编辑页的资料检查框随填写实时更新；保存时更新 updatedAt（秒），检查结果不写进数据', async ({ page }) => {
    await seedEvents(page, prepare);
    await page.goto(`/?id=${EVENT_ID}`);
    await page.click('#detailEdit');
    const box = page.locator('#editCheck');
    await expect(box.locator('.check-title')).toHaveText('⚠ 资料检查：8 项待补');
    await expect(box.locator('.check-updated')).toHaveText('最后更新 2026-09-21 22:13');

    // 第 3 张补标题
    await page.locator('#imageEditor .slot-caption').nth(2).fill('新标题');
    await expect(box.locator('.check-title')).toHaveText('⚠ 资料检查：7 项待补');
    await expect(box.locator('.check-row').nth(2).locator('.check-tag')).toHaveText(['缺来源和许可证']);
    // “去填写”展开图片信息表，补第 1 张的版权
    await box.locator('.check-row').first().locator('.check-go').click();
    await expect(page.locator('#imageInfo')).toHaveAttribute('open', '');
    await expect(page.locator('#imageInfoRows .info-license').first()).toBeFocused();
    const row = page.locator('#imageInfoRows .info-row').first();
    await row.locator('.info-license').selectOption('CC BY 3.0');
    await expect(box.locator('.check-row').first().locator('.check-tag')).toHaveText(['缺来源']);
    await row.locator('.info-source').fill('https://commons.wikimedia.org/wiki/File:B.jpg');
    await expect(box.locator('.check-title')).toHaveText('⚠ 资料检查：6 项待补');
    await expect(box.locator('.check-which').first()).toHaveText('第 2 张');

    const before = Math.floor(Date.now() / 1000);
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    const ev = saved.changed[EVENT_ID];
    expect(Number.isInteger(ev.updatedAt)).toBe(true);
    expect(ev.updatedAt).toBeGreaterThanOrEqual(before);
    expect(ev.updatedAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    // 只多了真正改动的字段，没有检查结果
    expect(Object.keys(ev).sort()).toEqual(['images', 'updatedAt']);
    expect(JSON.stringify(ev)).not.toMatch(/缺|check|issue/i);
    // 详情页随之更新
    await expect(page.locator('#detailCheck .check-title')).toHaveText('⚠ 资料检查：6 项待补');
  });

  test('没有改动时保存不更新 updatedAt', async ({ page }) => {
    await seedEvents(page, prepare);
    await page.goto(`/?id=${EVENT_ID}`);
    await page.click('#detailEdit');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    const stored = Array.isArray(saved) ? saved.find((e) => e.id === EVENT_ID) : saved.changed[EVENT_ID];
    expect(stored.updatedAt).toBe(UPDATED);
  });

  test('新增的事件带 updatedAt', async ({ page }) => {
    await seedEvents(page, prepare);
    const before = Math.floor(Date.now() / 1000);
    await page.click('#addBtn');
    await page.fill('#editForm [name=title]', '测试新事件');
    await page.fill('#editForm [name=yearAbs]', '1900');
    await page.fill('#editForm [name=detail]', '这是一段用于测试的详细说明文字，至少需要二十个字才可以保存成功。');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    const all = Array.isArray(saved) ? saved : Object.values(saved.changed);
    const ev = all.find((e) => e.title === '测试新事件');
    expect(ev.updatedAt).toBeGreaterThanOrEqual(before);
  });

  test.describe('手机', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('点一下 ⚠ 显示下拉列表，再点一下收起，不打开详情', async ({ page }) => {
      await seedEvents(page, prepare);
      await centerOnCard(page, TITLE);
      const icon = card(page, EVENT_ID).locator('.card-alert');
      await icon.tap();
      await expect(page.locator('#alertPop')).toBeVisible();
      await expect(page.locator('#detailModal')).toBeHidden();
      await icon.tap({ force: true });
      await expect(page.locator('#alertPop')).toBeHidden();
      await expect(page.locator('#detailModal')).toBeHidden();
    });
  });
});

test('服务器校验 updatedAt：必须是以秒为单位的正整数', async ({ page }) => {
  const data = await loadDataset(page);
  const withTime = (v) => { const d = JSON.parse(JSON.stringify(data)); d.events[0].updatedAt = v; return d; };
  expect(() => validateDataset(DATASET, withTime(UPDATED))).not.toThrow();
  for (const bad of [Date.now(), 1790000000.5, -1, '1790000000']) {
    expect(() => validateDataset(DATASET, withTime(bad)), String(bad)).toThrow('updatedAt');
  }
});
