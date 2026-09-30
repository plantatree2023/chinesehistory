// 时间轴时期提示：悬浮显示所处时期，点击固定，点别处 / 拖动取消；朝代交界处判断准确。
const { test, expect, openApp, centerOnTrackX } = require('./helpers');

test.use({ viewport: { width: 1440, height: 860 } });

// 与 js/app.js 中 ERAS 的起始年份一致，用于独立计算期望的时期
const ERA_STARTS = [
  ['旧石器时代', -2000000], ['新石器时代', -10000], ['夏', -2070], ['商', -1600], ['西周', -1046],
  ['春秋', -770], ['战国', -475], ['秦', -221], ['西汉', -206], ['新', 9], ['东汉', 25], ['三国', 220],
  ['晋', 280], ['南北朝', 420], ['隋', 589], ['唐', 618], ['五代十国', 907], ['北宋', 960], ['南宋', 1127],
  ['元', 1279], ['明', 1368], ['清', 1644], ['中华民国', 1912], ['中华人民共和国', 1949],
];
const expectedEra = (year) => ERA_STARTS.filter(([, start]) => year >= start).pop()[0];

const axisY = (page) => page.evaluate(() => {
  const r = document.getElementById('stage').getBoundingClientRect();
  return r.top + r.height / 2;
});
// #eraTip 本身是 0×0 的定位锚点，可见性以其中的提示框为准；固定状态（pinned）仍在 #eraTip 上
const tip = (page) => page.locator('#eraTip .era-tip-box');
const tipAnchor = (page) => page.locator('#eraTip');
const tipName = (page) => page.locator('#eraTip .era-tip-name');

// 把鼠标移到 (x, y) 并等待提示出现；若后台重排恰好把提示收起，则重新悬浮直到稳定显示
async function hoverAxis(page, x, y) {
  await expect(async () => {
    await page.mouse.move(x, y + 1);
    await page.mouse.move(x, y);
    await expect(tip(page)).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test('悬浮在事件位置显示正确的时期（含朝代交界的事件）', async ({ page }) => {
  await openApp(page);
  const y = await axisY(page);
  const events = await page.evaluate(() => window.DEFAULT_EVENTS.slice().sort((a, b) => a.year - b.year)
    .map((e) => ({ title: e.title, year: e.year })));
  const dots = await page.evaluate(() => [...document.querySelectorAll('.dot')].map((d) => parseFloat(d.style.left)));

  // 抽样各年代，并包含正好落在朝代交界的事件（商汤灭夏、东汉建立、中华人民共和国成立）
  for (const i of [0, 1, 10, 14, 20, 30, 45, 60, 75, 90, 99]) {
    await centerOnTrackX(page, dots[i]);
    const x = await page.locator('.dot').nth(i).evaluate((d) => { const r = d.getBoundingClientRect(); return r.left + r.width / 2; });
    await hoverAxis(page, x, y);
    await expect(tipName(page), `${events[i].title}（${events[i].year}）`).toHaveText(expectedEra(events[i].year));
    await expect(page.locator('.era.hot')).toHaveCount(1);
  }
});

test('移开鼠标后提示消失', async ({ page }) => {
  await openApp(page);
  await hoverAxis(page, 700, await axisY(page));
  await page.mouse.move(700, 150);
  await expect(tip(page)).toBeHidden();
  await expect(page.locator('.era.hot')).toHaveCount(0);
});

test('点击固定提示，点击别处取消', async ({ page }) => {
  await openApp(page);
  const y = await axisY(page);
  await page.mouse.click(600, y);
  await expect(tipAnchor(page)).toHaveClass(/pinned/);
  await page.mouse.move(700, 150);
  await expect(tip(page)).toBeVisible();
  await page.mouse.click(700, 120);
  await expect(tip(page)).toBeHidden();
});

test('沿轴线拖动不会固定提示', async ({ page }) => {
  await openApp(page);
  const y = await axisY(page);
  await page.mouse.move(900, y);
  await page.mouse.down();
  await page.mouse.move(500, y, { steps: 8 });
  await page.mouse.up();
  await expect(tipAnchor(page)).not.toHaveClass(/pinned/);
});

test.describe('手机', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });

  test('点按轴线显示提示，且提示框不超出屏幕', async ({ page }) => {
    await openApp(page);
    await page.touchscreen.tap(200, await axisY(page));
    await expect(tip(page)).toBeVisible();
    const box = await page.locator('#eraTip .era-tip-box').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });
});
