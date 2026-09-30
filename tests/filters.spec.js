// 侧栏筛选：重大事件、朝代 / 时期（多选）、时间范围；可选项由数据决定，与搜索组合使用。
const { test, expect, openApp, loadDataset, DATA_URL } = require('./helpers');

test.use({ viewport: { width: 1440, height: 860 } });

// 与网站相同的规则：事件属于起始年份不晚于它的最后一个时期
const eraOf = (eras, year) => eras.filter((e) => year >= e.start).pop() || eras[0];

async function openFilters(page) {
  await page.click('#browseBtn');
  await page.click('#filterToggle');
  await expect(page.locator('#filterPanel')).toBeVisible();
}
const listTitles = (page) => page.locator('.list-title').allTextContents();
const expectTitles = async (page, events) => {
  const want = events.slice().sort((a, b) => a.year - b.year).map((e) => e.title);
  await expect.poll(() => listTitles(page)).toEqual(want);
  await expect(page.locator('#eventCount')).toHaveText(`（${want.length} / ${(await page.evaluate(() => document.querySelectorAll('.card').length))}）`);
};
async function setYear(page, which, year) {
  await page.selectOption(`#filterPanel select[data-range="${which}-era"]`, year < 0 ? 'bce' : 'ce');
  await page.fill(`#filterPanel input[data-range="${which}"]`, String(Math.abs(year)));
}

test('筛选面板默认收起，可选项由数据生成', async ({ page }) => {
  await openApp(page);
  const { eras, events } = await loadDataset(page);
  await page.click('#browseBtn');
  await expect(page.locator('#filterPanel')).toBeHidden();
  await page.click('#filterToggle');
  await expect(page.locator('#filterToggle')).toHaveAttribute('aria-expanded', 'true');

  // 朝代标签：数据中有事件的时期，按时期顺序排列，带事件数
  const counts = {};
  for (const ev of events) counts[eraOf(eras, ev.year).name] = (counts[eraOf(eras, ev.year).name] || 0) + 1;
  const expected = eras.filter((e) => counts[e.name]).map((e) => `${e.name}${counts[e.name]}`);
  expect(await page.locator('.filter-chip').allTextContents()).toEqual(expected);
  // 重大事件数量、时间范围提示来自数据
  const majors = events.filter((e) => e.major).length;
  await expect(page.locator('.filter-check')).toContainText(`只看重大事件（${majors}）`);
  await expect(page.locator('.filter-hint')).toContainText('约170万年前 — 公元1980年');
});

test('只看重大事件', async ({ page }) => {
  await openApp(page);
  const { events } = await loadDataset(page);
  await openFilters(page);
  await page.check('#filterPanel input[data-filter="major"]');
  await expectTitles(page, events.filter((e) => e.major));
  await expect(page.locator('#filterBadge')).toHaveText('1');
  await page.uncheck('#filterPanel input[data-filter="major"]');
  await expect(page.locator('.list-item')).toHaveCount(events.length);
  await expect(page.locator('#filterBadge')).toBeHidden();
});

test('按朝代筛选，可同时选多个', async ({ page }) => {
  await openApp(page);
  const { eras, events } = await loadDataset(page);
  await openFilters(page);
  await page.click('.filter-chip[data-era="唐"]');
  await expectTitles(page, events.filter((e) => eraOf(eras, e.year).name === '唐'));
  await expect(page.locator('.filter-chip[data-era="唐"]')).toHaveAttribute('aria-pressed', 'true');

  await page.click('.filter-chip[data-era="明"]');
  await expectTitles(page, events.filter((e) => ['唐', '明'].includes(eraOf(eras, e.year).name)));

  await page.click('.filter-chip[data-era="唐"]');   // 再点一次取消
  await expectTitles(page, events.filter((e) => eraOf(eras, e.year).name === '明'));
  await expect(page.locator('.filter-chip[data-era="唐"]')).toHaveAttribute('aria-pressed', 'false');
});

test('按时间范围筛选：可只填一端，公元前用下拉选择', async ({ page }) => {
  await openApp(page);
  const { events } = await loadDataset(page);
  await openFilters(page);
  await setYear(page, 'from', -221);
  await setYear(page, 'to', 220);
  await expectTitles(page, events.filter((e) => e.year >= -221 && e.year <= 220));

  await page.fill('#filterPanel input[data-range="from"]', '');   // 只保留结束年份
  await expectTitles(page, events.filter((e) => e.year <= 220));

  await page.fill('#filterPanel input[data-range="to"]', '');
  await setYear(page, 'from', 1900);                              // 只保留起始年份
  await expectTitles(page, events.filter((e) => e.year >= 1900));
});

test('起始年份晚于结束年份时提示且没有结果', async ({ page }) => {
  await openApp(page);
  await openFilters(page);
  await setYear(page, 'from', 1900);
  await setYear(page, 'to', 1800);
  await expect(page.locator('.filter-warn')).toBeVisible();
  await expect(page.locator('.list-empty')).toHaveText('没有符合条件的事件');
  await setYear(page, 'to', 1950);
  await expect(page.locator('.filter-warn')).toBeHidden();
});

test('多个筛选条件与搜索同时生效，清除筛选恢复全部', async ({ page }) => {
  await openApp(page);
  const { eras, events } = await loadDataset(page);
  await openFilters(page);
  await page.check('#filterPanel input[data-filter="major"]');
  await page.click('.filter-chip[data-era="秦"]');
  await page.click('.filter-chip[data-era="唐"]');
  await setYear(page, 'to', 900);
  const match = (e) => e.major && ['秦', '唐'].includes(eraOf(eras, e.year).name) && e.year <= 900;
  await expectTitles(page, events.filter(match));
  await expect(page.locator('#filterBadge')).toHaveText('3');

  await page.fill('#searchInput', '贞观');
  await expectTitles(page, events.filter((e) => match(e) && e.title.includes('贞观')));

  await page.fill('#searchInput', '');
  await page.click('#filterClear');
  await expect(page.locator('.list-item')).toHaveCount(events.length);
  await expect(page.locator('#filterBadge')).toBeHidden();
  await expect(page.locator('#filterPanel input[data-filter="major"]')).not.toBeChecked();
  await expect(page.locator('.filter-chip.on')).toHaveCount(0);
  await expect(page.locator('#filterPanel input[data-range="to"]')).toHaveValue('');
});

test('筛选时列表中的编辑和删除仍可用，删除后可选项随数据更新', async ({ page }) => {
  await openApp(page);
  const { eras, events } = await loadDataset(page);
  const qin = events.filter((e) => eraOf(eras, e.year).name === '秦');
  await openFilters(page);
  await page.click('.filter-chip[data-era="秦"]');
  await expect(page.locator('.list-item')).toHaveCount(qin.length);
  await page.locator('.list-row').first().click();
  await page.click('.list-actions .btn-danger');
  await page.click('#confirmOk');
  await expect(page.locator('.list-item')).toHaveCount(qin.length - 1);
  // 时期的事件数随之减少，已选中的条件保留
  await expect(page.locator('.filter-chip[data-era="秦"] .filter-chip-count')).toHaveText(String(qin.length - 1));
  await expect(page.locator('.filter-chip[data-era="秦"]')).toHaveAttribute('aria-pressed', 'true');
});

test('可选项完全由数据集决定（使用另一份数据）', async ({ page }) => {
  // 用一份只有两个时期、没有重大事件的数据替换默认数据集
  const custom = {
    id: 'cn_zh', country: 'cn', language: 'zh',
    eras: [
      { name: '甲时期', start: 100, end: 199, color: '#336699', range: '100年—199年', desc: '测试时期甲' },
      { name: '乙时期', start: 200, end: null, color: '#993366', range: '200年至今', desc: '测试时期乙' },
      { name: '无事件时期', start: 5000, end: 6000, color: '#999999', range: '5000年—6000年', desc: '没有事件的时期' },
    ],
    events: [120, 150, 250].map((year, i) => ({
      id: `t${i}`, year, date: `${year}年`, title: `测试事件${i}`, short: '这是一个用于筛选测试的虚构历史事件，简要说明超过二十个字。',
      detail: '测试用详细说明。', images: [], source: '', major: false,
    })),
  };
  await page.route(`**${DATA_URL}`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(custom) }));
  await openApp(page);
  await openFilters(page);
  expect(await page.locator('.filter-chip').allTextContents()).toEqual(['甲时期2', '乙时期1']);
  await expect(page.locator('.filter-section[data-filter="major"]'), '没有重大事件时不显示该维度').toHaveCount(0);
  await expect(page.locator('.filter-hint')).toContainText('公元120年 — 公元250年');
  await expect(page.locator('#filterPanel input[data-range="from"]')).toHaveAttribute('placeholder', '120');
  await expect(page.locator('#filterPanel select[data-range="from-era"]')).toHaveValue('ce');
  await page.click('.filter-chip[data-era="甲时期"]');
  await expect(page.locator('.list-title')).toHaveText(['测试事件0', '测试事件1']);
});

test.describe('手机', () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test('筛选面板在窄屏下完整可用，不产生横向滚动', async ({ page }) => {
    await openApp(page);
    await openFilters(page);
    await page.click('.filter-chip[data-era="清"]');
    await expect(page.locator('#filterBadge')).toHaveText('1');
    const panel = await page.locator('#filterPanel').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
