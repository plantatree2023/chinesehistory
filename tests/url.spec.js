// 网址与浏览记录：详情（id）、侧栏（browse）、搜索与筛选、时间轴位置（at）都记录在网址中，
// 可以直接打开、刷新、分享；浏览器的返回 / 前进依次关闭 / 重新打开详情和侧栏；分享链接；浏览器标题。
const { test, expect, openApp, loadDataset, trackOffset } = require('./helpers');

test.use({ viewport: { width: 1440, height: 860 } });

const params = (page) => new URL(page.url()).searchParams;
const query = (page) => new URL(page.url()).search;

async function openFromList(page, title) {
  await page.fill('#searchInput', title);
  await page.locator('.list-row').first().click();
  await page.click('.list-actions .btn-ghost');
  await expect(page.locator('#detailModal')).toBeVisible();
}

test('打开详情时网址带上 id、浏览器标题为事件名；关闭后恢复', async ({ page }) => {
  const { events } = await loadDataset(page);
  const ev = events.find((e) => e.title === '安史之乱');
  await openApp(page);
  await page.click('#browseBtn');
  await openFromList(page, '安史之乱');
  expect(params(page).get('id')).toBe(ev.id);
  await expect(page).toHaveTitle('安史之乱 · 时间上的中国');
  await page.keyboard.press('Escape');
  await expect(page.locator('#detailModal')).toBeHidden();
  await expect.poll(() => params(page).has('id')).toBe(false);
  await expect(page).toHaveTitle('时间上的中国');
});

test('直接打开 ?id=… ：加载后打开该事件的详情，时间轴移到该事件', async ({ page }) => {
  const { events } = await loadDataset(page);
  const ev = events.find((e) => e.title === '安史之乱');
  await page.goto(`/?id=${ev.id}`);
  await expect(page.locator('#detailModal')).toBeVisible();
  await expect(page.locator('#detailTitle')).toHaveText('安史之乱');
  await expect(page).toHaveTitle('安史之乱 · 时间上的中国');
  await expect(page.locator('#currentEra')).toHaveText('唐');
  const card = await page.locator(`.card[data-id="${ev.id}"]`).boundingBox();
  expect(card.x).toBeGreaterThan(0);
  expect(card.x + card.width).toBeLessThan(1440);
  // 直接打开的链接没有可退回的记录：关闭详情只去掉网址中的 id
  await page.keyboard.press('Escape');
  await expect.poll(() => params(page).has('id')).toBe(false);
  await expect(page.locator('.card').first()).toBeVisible();
});

test('找不到的 id：提示并从网址中去掉', async ({ page }) => {
  await page.goto('/?id=not-exist');
  await expect(page.locator('.toast')).toContainText('找不到该事件：not-exist');
  await expect(page.locator('#detailModal')).toBeHidden();
  await expect.poll(() => params(page).has('id')).toBe(false);
});

test('侧栏、搜索词和筛选条件写进网址；刷新后全部恢复；改条件不新增浏览记录', async ({ page }) => {
  const { events, eras } = await loadDataset(page);
  await openApp(page);
  const len0 = await page.evaluate(() => history.length);
  await page.click('#browseBtn');
  expect(query(page)).toBe('?browse');
  expect(await page.evaluate(() => history.length)).toBe(len0 + 1);
  await page.click('#filterToggle');
  await page.check('#filterPanel input[data-filter="major"]');
  await page.locator('.ms[data-name="type"] .ms-trigger').click();
  await page.locator('.ms[data-name="type"] .ms-option[data-value="战争"]').click();
  await page.locator('.ms[data-name="type"] .ms-option[data-value="政治"]').click();
  await page.locator('.ms[data-name="type"] .ms-trigger').click();
  await page.selectOption('#filterPanel select[data-range="from-era"]', 'bce');
  await page.fill('#filterPanel input[data-range="from"]', '221');
  await page.fill('#searchInput', '战');
  const p = params(page);
  expect(p.has('browse')).toBe(true);
  expect(p.get('major')).toBe('1');
  expect(p.get('type')).toBe('war,politics');          // 类型用 key，与语言无关
  expect(p.get('from')).toBe('-221');
  expect(p.get('q')).toBe('战');
  expect(await page.evaluate(() => history.length), '改筛选和搜索不新增浏览记录').toBe(len0 + 1);
  const titles = await page.locator('.list-title').allTextContents();
  expect(titles.length).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#searchInput')).toHaveValue('战');
  await expect(page.locator('#filterPanel input[data-filter="major"]')).toBeChecked();
  await expect(page.locator('.ms[data-name="type"] .ms-tag')).toHaveText(['战争', '政治']);
  await expect(page.locator('#filterPanel input[data-range="from"]')).toHaveValue('221');
  await expect(page.locator('#filterPanel select[data-range="from-era"]')).toHaveValue('bce');
  expect(await page.locator('.list-title').allTextContents()).toEqual(titles);
  expect(eras.length && events.length).toBeTruthy();
});

test('直接打开带筛选的链接（朝代、时间范围、时期更迭）', async ({ page }) => {
  const { events, eras } = await loadDataset(page);
  const eraOf = (y) => eras.filter((e) => y >= e.start).pop().name;
  const want = events.filter((e) => e.transition && ['唐', '北宋'].includes(eraOf(e.year)) && e.year <= 1000)
    .sort((a, b) => a.year - b.year).map((e) => e.title);
  expect(want.length).toBeGreaterThan(0);
  await page.goto('/?browse&era=' + encodeURIComponent('唐') + ',' + encodeURIComponent('北宋') + '&transition=1&to=1000');
  await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('.ms[data-name="era"] .ms-tag')).toHaveText(['唐', '北宋']);
  await expect(page.locator('#filterPanel input[data-filter="transition"]')).toBeChecked();
  await expect(page.locator('.list-title')).toHaveText(want);
  // 无效的值被忽略
  await page.goto('/?browse&era=' + encodeURIComponent('不存在') + '&type=nope&from=abc');
  await expect(page.locator('.ms[data-name="era"] .ms-tag')).toHaveCount(0);
  await expect(page.locator('#filterPanel input[data-range="from"]')).toHaveValue('');
});

test('浏览器返回 / 前进：依次关闭详情、侧栏，再重新打开', async ({ page }) => {
  await openApp(page);
  await page.click('#browseBtn');
  await openFromList(page, '赤壁之战');
  await page.goBack();
  await expect(page.locator('#detailModal')).toBeHidden();
  await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#searchInput')).toHaveValue('赤壁之战');
  await page.goBack();
  await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'true');
  expect(params(page).has('browse')).toBe(false);
  await page.goForward();
  await expect(page.locator('#sidebar')).toHaveAttribute('aria-hidden', 'false');
  await page.goForward();
  await expect(page.locator('#detailModal')).toBeVisible();
  await expect(page.locator('#detailTitle')).toHaveText('赤壁之战');
  // 用关闭按钮关闭：与按返回相同（退回上一条记录），不会留下多余的记录
  await page.locator('#detailModal .modal-close').click();
  await expect(page.locator('#detailModal')).toBeHidden();
  await page.click('#closeSidebar');
  await expect.poll(() => params(page).has('browse')).toBe(false);
  await page.goBack();   // 再退就离开这个“起始”记录之前（about:blank 之类）——这里只确认没有残留的侧栏 / 详情记录
  await expect(page).not.toHaveURL(/browse|id=/);
});

test('时间轴位置写进网址（at=年份），直接打开时恢复到该位置', async ({ page }) => {
  await openApp(page);
  expect(params(page).has('at')).toBe(false);   // 在开头时不写
  await page.locator('#stage').focus();
  await page.keyboard.press('End');
  await expect.poll(() => Number(params(page).get('at'))).toBeGreaterThan(1900);
  await page.goto('/?at=755');
  await expect(page.locator('.card').first()).toBeVisible();
  await expect(page.locator('#currentEra')).toHaveText('唐');
  expect(await trackOffset(page)).toBeLessThan(-1000);
});

test('网址中保留数据集参数 data', async ({ page }) => {
  const { events } = await loadDataset(page);
  await page.goto('/?data=cn_zh');
  await expect(page.locator('.card').first()).toBeVisible();
  await page.click('#browseBtn');
  expect(query(page)).toBe('?data=cn_zh&browse');
  await page.goto(`/?data=cn_zh&id=${events[5].id}`);
  await expect(page.locator('#detailModal')).toBeVisible();
});

test.describe('分享链接', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('点击”分享链接”复制只含该事件的链接（不带侧栏、筛选等）', async ({ page, baseURL }) => {
    const { events } = await loadDataset(page);
    const ev = events.find((e) => e.title === '赤壁之战');
    await openApp(page);
    await page.click('#browseBtn');
    await page.click('#filterToggle');
    await page.check('#filterPanel input[data-filter=”major”]');
    await openFromList(page, '赤壁之战');
    await expect(page.locator('#detailShare')).toBeVisible();     // 所有访问者都能看到（不需要调试模式）
    await page.click('#detailShare');
    // 打开分享菜单后点击”复制链接”按钮
    await page.click('[data-share=”copy”]');
    await expect(page.locator('.toast')).toContainText('链接已复制');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(new URL(`/?id=${ev.id}`, baseURL).href);
    // 打开复制的链接即可看到该事件
    await page.goto(copied);
    await expect(page.locator('#detailTitle')).toHaveText('赤壁之战');
  });
});
