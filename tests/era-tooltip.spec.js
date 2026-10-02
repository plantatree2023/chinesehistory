// 时间轴时期提示：悬浮显示所处时期，点击固定，点别处 / 拖动取消；朝代交界处判断准确。
const { test, expect, openApp, loadDataset, centerOnTrackX } = require('./helpers');

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
  const events = (await loadDataset(page)).events.slice().sort((a, b) => a.year - b.year);
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

test('提示圆点位于轴线正中', async ({ page }) => {
  await openApp(page);
  await hoverAxis(page, 700, await axisY(page));
  const { circle, axis, band } = await page.evaluate(() => {
    const mid = (r) => r.top + r.height / 2;
    const line = document.querySelector('.era-tip-line');
    const cs = getComputedStyle(line, '::after');
    const lr = line.getBoundingClientRect();
    // 伪元素没有 DOM 节点，用计算样式还原其渲染位置：
    // 外框高度要按 box-sizing 计入边框（content-box 下边框在 height 之外，正是此前圆点偏下的原因）
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const outerHeight = parseFloat(cs.height) + (cs.boxSizing === 'content-box' ? border : 0);
    const translateY = cs.transform === 'none' ? 0 : new DOMMatrixReadOnly(cs.transform).m42;
    const circleCenter = lr.top + parseFloat(cs.top) + translateY + outerHeight / 2;
    return { circle: circleCenter, axis: mid(document.getElementById('axis').getBoundingClientRect()), band: mid(document.querySelector('.era.hot').getBoundingClientRect()) };
  });
  expect(Math.abs(circle - axis), `圆心 ${circle} 与轴线中心 ${axis}`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(circle - band), `圆心 ${circle} 与朝代色带中心 ${band}`).toBeLessThanOrEqual(0.5);
});

test('最早时期之前留有一段渐隐的轴线：表示更早的年代，悬浮时不显示时期', async ({ page }) => {
  await openApp(page);
  const info = await page.evaluate(() => {
    const era = document.querySelector('#eras .era');
    const firstDot = Math.min(...[...document.querySelectorAll('.dot')].map((d) => d.offsetLeft));
    return { eraLeft: era.offsetLeft, firstDot, axisBg: getComputedStyle(document.getElementById('axis')).backgroundImage, viewW: document.getElementById('stage').clientWidth };
  });
  // 至少留出屏宽的 15%（这里约 216px）+ 原有边距，旧石器时代的色带从这里开始
  expect(info.eraLeft).toBeGreaterThan(140 + info.viewW * 0.15 - 40);
  expect(info.firstDot).toBeGreaterThan(info.eraLeft);
  // 渐隐：从透明过渡到轴线颜色，终点在最早时期的起点
  expect(info.axisBg).toMatch(/^linear-gradient\(to right, rgba\(0, 0, 0, 0\)/);
  expect(info.axisBg).toContain(`${Math.round(info.eraLeft)}px`);
  // 悬浮在渐隐段：不显示时期提示；悬浮在旧石器时代色带上：显示
  const y = await axisY(page);
  await page.mouse.move(info.eraLeft / 2, y);
  await page.waitForTimeout(200);
  await expect(tip(page)).toBeHidden();
  await hoverAxis(page, info.eraLeft + 30, y);
  await expect(tipName(page)).toHaveText('旧石器时代');
});

test('点击轴线高亮时期色带时，色带下方的时期名等比放大（横向与纵向同步），不被拉伸变形', async ({ page }) => {
  await page.goto('/?at=700');
  await expect(page.locator('.card').first()).toBeVisible();
  const band = page.locator('.era[data-era="唐"]');
  const label = band.locator('.era-label');
  const before = await label.boundingBox();
  const bb = await band.boundingBox();
  await page.mouse.click(before.x + before.width / 2 + 120, bb.y + bb.height / 2);
  await expect(band).toHaveClass(/hot/);
  await page.waitForTimeout(300);   // 等放大动画结束
  const scale = await band.evaluate((b) => new DOMMatrix(getComputedStyle(b).transform).d);
  expect(scale).toBeGreaterThan(1.3);
  const after = await label.boundingBox();
  // 时期名的宽、高按同一倍数放大
  expect(after.height / before.height).toBeCloseTo(scale, 1);
  expect(after.width / before.width).toBeCloseTo(scale, 1);
  // 仍水平居中在色带下方
  const nb = await band.boundingBox();
  expect(Math.abs((after.x + after.width / 2) - (nb.x + nb.width / 2))).toBeLessThanOrEqual(1);
  // 取消高亮后恢复原样
  await page.mouse.click(400, 120);
  await expect(band).not.toHaveClass(/hot/);
  await page.waitForTimeout(300);
  const back = await label.boundingBox();
  expect(back.width).toBeCloseTo(before.width, 0);
  expect(back.height).toBeCloseTo(before.height, 0);
});

test('第一个时期之前有引导段：颜色由透明渐变为第一个时期的颜色、由细渐粗，与第一个时期的色带无缝衔接', async ({ page }) => {
  const { eras } = await loadDataset(page);
  await openApp(page);
  const info = await page.evaluate(() => {
    const lead = document.querySelector('#eras .era-leadin');
    const first = document.querySelector('#eras .era');
    const cs = getComputedStyle(lead), fs = getComputedStyle(first);
    return {
      leadLeft: lead.offsetLeft, leadRight: lead.offsetLeft + lead.offsetWidth, eraLeft: first.offsetLeft,
      leadTop: lead.offsetTop, leadH: lead.offsetHeight, eraTop: first.offsetTop, eraH: first.offsetHeight,
      bg: cs.backgroundImage, clip: cs.clipPath, pointer: cs.pointerEvents,
      firstRadius: [fs.borderTopLeftRadius, fs.borderBottomLeftRadius, fs.borderTopRightRadius],
      dataEra: lead.dataset.era,
    };
  });
  expect(info.leadLeft).toBe(0);
  expect(Math.abs(info.leadRight - info.eraLeft)).toBeLessThanOrEqual(1);   // 右端接上第一个时期
  expect([info.leadTop, info.leadH]).toEqual([info.eraTop, info.eraH]);    // 与色带同高、同一位置
  expect(info.bg).toMatch(/^linear-gradient/);
  const rgb = `rgb(${[1, 3, 5].map((i) => parseInt(eras[0].color.slice(i, i + 2), 16)).join(', ')})`;
  expect(info.bg, '渐变终点是第一个时期的颜色').toContain(rgb);
  expect(info.clip).toMatch(/^polygon/);                                     // 由细渐粗
  expect(info.firstRadius.slice(0, 2), '第一个时期的色带左端为直角').toEqual(['0px', '0px']);
  expect(info.firstRadius[2]).not.toBe('0px');                               // 右端仍是圆角
  expect(info.pointer).toBe('none');
  expect(info.dataEra).toBeUndefined();                                     // 不是一个时期
});

test('时期更迭事件在轴线上用菱形标记（新时期的颜色），轴线附近不显示“从 → 到”文字；主轴线半透明', async ({ page }) => {
  await openApp(page);
  const { events, eras } = await loadDataset(page);
  const transitions = events.filter((e) => e.transition);
  const dots = await page.evaluate(() => [...document.querySelectorAll('.dot.dot-transition')].map((d) => ({
    radius: getComputedStyle(d).borderTopLeftRadius, transform: getComputedStyle(d).transform, bg: getComputedStyle(d).backgroundColor,
  })));
  expect(dots).toHaveLength(transitions.length);
  for (const d of dots) expect(d.transform).not.toBe('none');   // 旋转 45° 成菱形
  const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  const colors = new Set(transitions.map((e) => rgb(eras.find((x) => x.name === e.transition.to).color)));
  for (const d of dots) expect(colors.has(d.bg), d.bg).toBe(true);
  // 不显示时期更迭的文字标签
  await expect(page.locator('.transition-mark')).toHaveCount(0);
  await expect(page.locator('#events')).not.toContainText('→');
  // 主轴线半透明
  const opacity = await page.locator('#axis').evaluate((a) => Number(getComputedStyle(a).opacity));
  expect(opacity).toBeGreaterThan(0.2);
  expect(opacity).toBeLessThanOrEqual(0.6);
});

test.describe('延续至今的时期', () => {
  test('中华人民共和国色带延伸到轴线末端，末端有“今天”刻度', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => {
      const band = document.querySelector('.era[data-era="中华人民共和国"]');
      const axis = document.getElementById('axis');
      const lastDot = Math.max(...[...document.querySelectorAll('.dot')].map((d) => parseFloat(d.style.left)));
      const ticks = [...document.querySelectorAll('.tick')].map((t) => ({ x: parseFloat(t.style.left), label: t.textContent }));
      return { bandRight: band.offsetLeft + band.offsetWidth, axisRight: axis.offsetWidth, lastDot, ticks };
    });
    expect(r.axisRight - r.bandRight, '色带右端与轴线右端的距离').toBeLessThanOrEqual(2);
    const today = r.ticks.find((t) => t.label === '今天');
    expect(today, '应有“今天”刻度').toBeTruthy();
    expect(today.x).toBeGreaterThan(r.lastDot);
    // 1980 年之后按比例排开的年代刻度
    const later = r.ticks.filter((t) => /^\d+$/.test(t.label) && Number(t.label) > 1980);
    expect(later.length, '1980 年之后的年代刻度').toBeGreaterThan(0);
    expect(later.every((t) => t.x > r.lastDot && t.x < today.x)).toBe(true);
  });

  test('悬浮在最后一个事件之后显示中华人民共和国，年份不超过今年', async ({ page }) => {
    await openApp(page);
    await page.locator('#stage').focus();
    await page.keyboard.press('End');
    await expect.poll(() => page.evaluate(() => {
      const st = document.getElementById('stage');
      const m = new DOMMatrixReadOnly(getComputedStyle(document.getElementById('track')).transform).m41;
      return Math.round(st.clientWidth - m);
    })).toBe(await page.evaluate(() => document.getElementById('track').offsetWidth));
    const stageBox = await page.locator('#stage').boundingBox();
    const y = await axisY(page);
    await hoverAxis(page, stageBox.x + stageBox.width - 60, y);
    await expect(tipName(page)).toHaveText('中华人民共和国');
    const year = Number((await page.locator('#eraTip .era-tip-year').textContent()).match(/(\d+)年/)[1]);
    expect(year).toBeGreaterThan(1980);
    expect(year).toBeLessThanOrEqual(new Date().getFullYear());
  });
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
