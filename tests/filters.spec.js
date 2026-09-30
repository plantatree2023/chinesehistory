// 侧栏筛选：重大事件（重要程度 8–10）、事件类型（下拉多选）、时期更迭、朝代 / 时期（下拉多选）、时间范围；
// 可选项由数据决定，与搜索组合使用。
// 以及时期更迭字段（transition）的显示、编辑和数据一致性。
const { test, expect, openApp, loadDataset, DATA_URL } = require('./helpers');

test.use({ viewport: { width: 1440, height: 860 } });

// 与网站相同的规则：事件属于起始年份不晚于它的最后一个时期
const eraOf = (eras, year) => eras.filter((e) => year >= e.start).pop() || eras[0];
// '#c0892f' -> 'rgb(192, 137, 47)'
// 重大事件：重要程度 majorScore 为 8–10（与网站的三级图片大小一致）
const isMajor = (e) => e.majorScore >= 8;
// 浏览器给出的颜色（'rgb(…)' 或 color-mix 得到的 'color(srgb 0–1 …)'）→ 'rgb(r, g, b)'，便于比较
const norm = (css) => {
  const m = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(css);
  return m ? `rgb(${m.slice(1, 4).map((v) => Math.round(v * 255)).join(', ')})` : css;
};
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

const eraMenu = (page) => page.locator('.ms[data-name="era"] .ms-menu');
const eraTrigger = (page) => page.locator('.ms[data-name="era"] .ms-trigger');
const eraOption = (page, name) => page.locator(`.ms[data-name="era"] .ms-option[data-value="${name}"]`);

async function openFilters(page) {
  await page.click('#browseBtn');
  await page.click('#filterToggle');
  await expect(page.locator('#filterPanel')).toBeVisible();
}
// 在朝代下拉列表中切换选项（需要时先展开）
async function pickEras(page, ...names) {
  if (await eraMenu(page).isHidden()) await eraTrigger(page).click();
  for (const name of names) await eraOption(page, name).click();
}
const listTitles = (page) => page.locator('.list-title').allTextContents();
async function expectTitles(page, events) {
  const want = events.slice().sort((a, b) => a.year - b.year).map((e) => e.title);
  await expect.poll(() => listTitles(page)).toEqual(want);
  const total = await page.locator('.card').count();
  await expect(page.locator('#eventCount')).toHaveText(`（${want.length} / ${total}）`);
}
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

  // 朝代选项：数据中有事件的时期，按时期顺序排列，带事件数和该时期的颜色
  const counts = {};
  for (const ev of events) counts[eraOf(eras, ev.year).name] = (counts[eraOf(eras, ev.year).name] || 0) + 1;
  const withEvents = eras.filter((e) => counts[e.name]);
  await eraTrigger(page).click();
  expect(await page.locator('.ms[data-name="era"] .ms-option').allTextContents()).toEqual(withEvents.map((e) => `${e.name}${counts[e.name]}`));
  for (const era of withEvents) {
    const color = await eraOption(page, era.name).locator('.ms-swatch').evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(color, `${era.name} 的颜色`).toBe(rgb(era.color));
  }
  // 重大事件、时期更迭数量与时间范围提示来自数据
  await expect(page.locator('.filter-section[data-filter="major"]')).toContainText(`只看重大事件（${events.filter(isMajor).length}）`);
  await expect(page.locator('.filter-section[data-filter="transition"]')).toContainText(`只看时期更迭的事件（${events.filter((e) => e.transition).length}）`);
  await expect(page.locator('.filter-hint')).toContainText('约170万年前 — 公元1980年');
});

test('同类型的筛选放在一起：勾选框（重大事件、时期更迭）在最前，然后是下拉列表，最后是时间范围', async ({ page }) => {
  await openApp(page);
  await openFilters(page);
  const sections = await page.locator('#filterPanel .filter-section').evaluateAll((els) => els.map((el) => ({
    id: el.dataset.filter,
    kind: el.dataset.kind,
    // 实际的控件类型，用来核对 kind 是否写对
    control: el.querySelector('input[type=checkbox]') ? 'toggle' : el.querySelector('.ms') ? 'select' : el.querySelector('input[data-range]') ? 'range' : '?',
  })));
  expect(sections.map((x) => x.id)).toEqual(['major', 'transition', 'type', 'era', 'range']);
  for (const x of sections) expect(x.kind, x.id).toBe(x.control);
  // 通用规则：每种控件只出现在连续的一段里，且按 勾选框 → 下拉列表 → 范围 排列
  const order = ['toggle', 'select', 'range'];
  const kinds = sections.map((x) => x.kind);
  for (let i = 1; i < kinds.length; i++) expect(order.indexOf(kinds[i]), kinds.join(',')).toBeGreaterThanOrEqual(order.indexOf(kinds[i - 1]));
});

test.describe('事件类型下拉列表', () => {
  const typeTrigger = (page) => page.locator('.ms[data-name="type"] .ms-trigger');
  const typeOption = (page, name) => page.locator(`.ms[data-name="type"] .ms-option[data-value="${name}"]`);

  test('选项按数据集 types 的顺序排列，带事件数和类型颜色（描边、不填充，与朝代的实心色块区分）；可多选', async ({ page }) => {
    await openApp(page);
    const { types, events } = await loadDataset(page);
    await openFilters(page);
    const counts = {};
    for (const ev of events) counts[ev.type] = (counts[ev.type] || 0) + 1;
    await typeTrigger(page).click();
    const shown = types.filter((t) => counts[t.name]);
    expect(await page.locator('.ms[data-name="type"] .ms-option').allTextContents()).toEqual(shown.map((t) => `${t.name}${counts[t.name]}`));
    for (const t of shown) {
      const sw = await typeOption(page, t.name).locator('.ms-swatch').evaluate((n) => {
        const cs = getComputedStyle(n);
        return { border: cs.borderTopColor, width: cs.borderTopWidth, bg: cs.backgroundColor, radius: cs.borderTopLeftRadius };
      });
      sw.border = norm(sw.border);
      expect(sw, `${t.name} 的颜色`).toEqual({ border: rgb(t.color), width: '2px', bg: 'rgba(0, 0, 0, 0)', radius: '0px' });
    }
    // 朝代的色块仍是实心的
    await typeTrigger(page).click();
    await eraTrigger(page).click();
    const era = await page.locator('.ms[data-name="era"] .ms-option .ms-swatch').first().evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(era).not.toBe('rgba(0, 0, 0, 0)');
    await eraTrigger(page).click();
    await typeTrigger(page).click();
    await typeOption(page, '科技').click();
    await expectTitles(page, events.filter((e) => e.type === '科技'));
    await typeOption(page, '经济').click();
    await expectTitles(page, events.filter((e) => ['科技', '经济'].includes(e.type)));
    await expect(typeTrigger(page).locator('.ms-tag')).toHaveText(['科技', '经济']);
    // 列表中每项都显示类型标签：类型色的文字和描边，透明底
    const tag = await page.locator('.list-type').first().evaluate((n) => { const cs = getComputedStyle(n); return [cs.color, cs.borderTopColor, cs.backgroundColor]; });
    expect(tag.map(norm)).toEqual([rgb(types.find((t) => t.name === '科技').color), rgb(types.find((t) => t.name === '科技').color), 'rgba(0, 0, 0, 0)']);
    await expect(page.locator('.list-type')).toHaveText(events.filter((e) => ['科技', '经济'].includes(e.type)).sort((a, b) => a.year - b.year).map((e) => e.type));
    await expect(page.locator('#filterBadge')).toHaveText('1');
  });

  test('与朝代、重大事件筛选组合', async ({ page }) => {
    await openApp(page);
    const { eras, events } = await loadDataset(page);
    await openFilters(page);
    await typeTrigger(page).click();
    await typeOption(page, '战争').click();
    await typeTrigger(page).click();
    await pickEras(page, '清', '中华民国');
    await expectTitles(page, events.filter((e) => e.type === '战争' && ['清', '中华民国'].includes(eraOf(eras, e.year).name)));
    await page.check('#filterPanel input[data-filter="major"]');
    await expectTitles(page, events.filter((e) => e.type === '战争' && isMajor(e) && ['清', '中华民国'].includes(eraOf(eras, e.year).name)));
    await expect(page.locator('#filterBadge')).toHaveText('3');
  });

  test('没有类型的事件归为“未分类”，不在类型列表中的类型也能筛选', async ({ page }) => {
    await page.route(`**${DATA_URL}`, async (route) => {
      const data = await (await route.fetch()).json();
      delete data.events[0].type;
      data.types = data.types.filter((t) => t.name !== '社会');   // “社会”不在列表中
      await route.fulfill({ json: data });
    });
    await openApp(page);
    const { events } = await loadDataset(page);
    await openFilters(page);
    await typeTrigger(page).click();
    const labels = await page.locator('.ms[data-name="type"] .ms-option .ms-label').allTextContents();
    expect(labels.slice(-2)).toEqual(['社会', '未分类']);
    await typeOption(page, '').click();
    await expect(page.locator('.list-title')).toHaveText([events[0].title]);
    await typeOption(page, '').click();
    await typeOption(page, '社会').click();
    await expect(page.locator('.list-item')).toHaveCount(events.filter((e) => e.type === '社会').length);
  });
});

test.describe('朝代下拉列表', () => {
  test('默认收起；点击展开，已选项以该时期颜色的标签显示在按钮上', async ({ page }) => {
    await openApp(page);
    const { eras } = await loadDataset(page);
    const color = (name) => rgb(eras.find((e) => e.name === name).color);
    await openFilters(page);
    await expect(eraMenu(page)).toBeHidden();
    await expect(eraTrigger(page)).toContainText('全部朝代 / 时期');

    await pickEras(page, '唐', '明');
    await expect(eraOption(page, '唐')).toHaveAttribute('aria-selected', 'true');
    await expect(eraOption(page, '宋')).toHaveCount(0);
    const tags = eraTrigger(page).locator('.ms-tag');
    await expect(tags).toHaveText(['唐', '明']);
    expect(await tags.evaluateAll((ns) => ns.map((n) => getComputedStyle(n).backgroundColor))).toEqual([color('唐'), color('明')]);
    await expect(eraMenu(page), '多选时列表保持展开').toBeVisible();
  });

  test('Esc、点击列表外或再次点击按钮时收起；Esc 不会关闭侧栏', async ({ page }) => {
    await openApp(page);
    await openFilters(page);
    await eraTrigger(page).click();
    await expect(eraMenu(page)).toBeVisible();
    await eraOption(page, '秦').press('Escape');
    await expect(eraMenu(page)).toBeHidden();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);

    await eraTrigger(page).click();
    await page.locator('.filter-title').first().click();   // 列表以外
    await expect(eraMenu(page)).toBeHidden();

    await eraTrigger(page).click();
    await eraTrigger(page).click();
    await expect(eraMenu(page)).toBeHidden();
    await expect(eraTrigger(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('按朝代筛选，可同时选多个，再点一次取消', async ({ page }) => {
    await openApp(page);
    const { eras, events } = await loadDataset(page);
    await openFilters(page);
    await pickEras(page, '唐');
    await expectTitles(page, events.filter((e) => eraOf(eras, e.year).name === '唐'));
    await pickEras(page, '明');
    await expectTitles(page, events.filter((e) => ['唐', '明'].includes(eraOf(eras, e.year).name)));
    await pickEras(page, '唐');
    await expectTitles(page, events.filter((e) => eraOf(eras, e.year).name === '明'));
    await expect(eraOption(page, '唐')).toHaveAttribute('aria-selected', 'false');
  });
});

test('只看重大事件', async ({ page }) => {
  await openApp(page);
  const { events } = await loadDataset(page);
  await openFilters(page);
  await page.check('#filterPanel input[data-filter="major"]');
  await expectTitles(page, events.filter(isMajor));
  await expect(page.locator('#filterBadge')).toHaveText('1');
  await page.uncheck('#filterPanel input[data-filter="major"]');
  await expect(page.locator('.list-item')).toHaveCount(events.length);
  await expect(page.locator('#filterBadge')).toBeHidden();
});

test.describe('时期更迭', () => {
  test('只看时期更迭的事件，列表中显示“从 → 到”', async ({ page }) => {
    await openApp(page);
    const { events } = await loadDataset(page);
    const changes = events.filter((e) => e.transition);
    await openFilters(page);
    await page.check('#filterPanel input[data-filter="transition"]');
    await expectTitles(page, changes);
    const sorted = changes.slice().sort((a, b) => a.year - b.year);
    await expect(page.locator('.list-transition')).toHaveText(sorted.map((e) => `${e.transition.from} → ${e.transition.to}`));
  });

  test('与朝代筛选组合：进入“秦”的更迭事件', async ({ page }) => {
    await openApp(page);
    const { eras, events } = await loadDataset(page);
    await openFilters(page);
    await page.check('#filterPanel input[data-filter="transition"]');
    await pickEras(page, '秦');
    await expectTitles(page, events.filter((e) => e.transition && eraOf(eras, e.year).name === '秦'));
    await expect(page.locator('.list-transition')).toHaveText(['战国 → 秦']);
  });

  test('详情中显示时期更迭，普通事件不显示', async ({ page }) => {
    await openApp(page);
    await page.click('#browseBtn');
    await page.fill('#searchInput', '秦统一六国');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-ghost');
    await expect(page.locator('#detailTransition')).toHaveText('时期更迭：战国 → 秦');
    await page.keyboard.press('Escape');
    await page.fill('#searchInput', '孔子诞生');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-ghost');
    await expect(page.locator('#detailTransition')).toBeHidden();
  });

  test.describe('调试模式', () => {
    test.use({ debugMode: true });

    test('在编辑页设置和清除时期更迭，筛选随之更新', async ({ page }) => {
      await openApp(page);
      const { events } = await loadDataset(page);
      const count = events.filter((e) => e.transition).length;
      await page.click('#browseBtn');
      await page.fill('#searchInput', '贞观之治');
      await page.locator('.list-row').first().click();
      await page.click('.list-actions .btn-primary');
      // 下拉选项来自数据集的时期
      const { eras } = await loadDataset(page);
      await expect(page.locator('#editForm [name=transitionFrom] option')).toHaveText(['无', ...eras.map((e) => e.name)]);

      await page.selectOption('#editForm [name=transitionFrom]', '隋');
      await page.click('#editForm button[type=submit]');
      await expect(page.locator('#formError')).toContainText('同时选择');
      await page.selectOption('#editForm [name=transitionTo]', '隋');
      await page.click('#editForm button[type=submit]');
      await expect(page.locator('#formError')).toContainText('不能相同');
      await page.selectOption('#editForm [name=transitionTo]', '唐');
      await page.click('#editForm button[type=submit]');
      await expect(page.locator('#editModal')).toBeHidden();
      await expect(page.locator('.list-transition')).toHaveText(['隋 → 唐']);

      await page.fill('#searchInput', '');
      await page.click('#filterToggle');
      await expect(page.locator('.filter-section[data-filter="transition"]')).toContainText(`（${count + 1}）`);

      // 清除（保存后该行仍处于展开状态，只有收起时才需要点开）
      await page.fill('#searchInput', '贞观之治');
      if (!(await page.locator('.list-actions').isVisible())) await page.locator('.list-row').first().click();
      await page.click('.list-actions .btn-primary');
      await expect(page.locator('#editForm [name=transitionFrom]')).toHaveValue('隋');
      await page.selectOption('#editForm [name=transitionFrom]', '');
      await page.selectOption('#editForm [name=transitionTo]', '');
      await page.click('#editForm button[type=submit]');
      await expect(page.locator('.list-transition')).toHaveCount(0);
      await expect(page.locator('.filter-section[data-filter="transition"]')).toContainText(`（${count}）`);
    });
  });

  test('数据中的时期更迭：from / to 都是已有时期、互不相同，且事件年份落在 to 时期内', async ({ page }) => {
    const { eras, events } = await loadDataset(page);
    const names = new Set(eras.map((e) => e.name));
    const changes = events.filter((e) => e.transition);
    expect(changes.length).toBeGreaterThan(0);
    const problems = changes.filter((e) => !names.has(e.transition.from) || !names.has(e.transition.to)
      || e.transition.from === e.transition.to || eraOf(eras, e.year).name !== e.transition.to).map((e) => e.title);
    expect(problems).toEqual([]);
  });
});

test('按时间范围筛选：可只填一端，公元前用下拉选择', async ({ page }) => {
  await openApp(page);
  const { events } = await loadDataset(page);
  await openFilters(page);
  await setYear(page, 'from', -221);
  await setYear(page, 'to', 220);
  await expectTitles(page, events.filter((e) => e.year >= -221 && e.year <= 220));
  await page.fill('#filterPanel input[data-range="from"]', '');
  await expectTitles(page, events.filter((e) => e.year <= 220));
  await page.fill('#filterPanel input[data-range="to"]', '');
  await setYear(page, 'from', 1900);
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
  await pickEras(page, '秦', '唐');
  await setYear(page, 'to', 900);
  const match = (e) => isMajor(e) && ['秦', '唐'].includes(eraOf(eras, e.year).name) && e.year <= 900;
  await expectTitles(page, events.filter(match));
  await expect(page.locator('#filterBadge')).toHaveText('3');

  await page.fill('#searchInput', '贞观');
  await expectTitles(page, events.filter((e) => match(e) && e.title.includes('贞观')));

  await page.fill('#searchInput', '');
  await page.click('#filterClear');
  await expect(page.locator('.list-item')).toHaveCount(events.length);
  await expect(page.locator('#filterBadge')).toBeHidden();
  await expect(page.locator('#filterPanel input[data-filter="major"]')).not.toBeChecked();
  await expect(page.locator('.ms[data-name="era"] .ms-option.on')).toHaveCount(0);
  await expect(eraTrigger(page)).toContainText('全部朝代 / 时期');
  await expect(page.locator('#filterPanel input[data-range="to"]')).toHaveValue('');
});

test.describe('调试模式', () => {
  test.use({ debugMode: true });

  test('筛选时列表中的编辑和删除仍可用，删除后可选项随数据更新', async ({ page }) => {
    await openApp(page);
    const { eras, events } = await loadDataset(page);
    const qin = events.filter((e) => eraOf(eras, e.year).name === '秦');
    await openFilters(page);
    await pickEras(page, '秦');
    await expect(page.locator('.list-item')).toHaveCount(qin.length);
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-danger');
    await page.click('#confirmOk');
    await expect(page.locator('.list-item')).toHaveCount(qin.length - 1);
    // 时期的事件数随之减少，已选中的条件保留
    await expect(eraOption(page, '秦').locator('.ms-count')).toHaveText(String(qin.length - 1));
    await expect(eraOption(page, '秦')).toHaveAttribute('aria-selected', 'true');
    await expect(eraTrigger(page).locator('.ms-tag')).toHaveText(['秦']);
  });
});

test('可选项完全由数据集决定（使用另一份数据）', async ({ page }) => {
  // 用一份只有两个有事件的时期、没有重大事件和时期更迭的数据替换默认数据集
  const custom = {
    id: 'cn_zh', country: 'cn', language: 'zh',
    eras: [
      { name: '甲时期', start: 100, end: 199, color: '#336699', range: '100年—199年', desc: '测试时期甲' },
      { name: '乙时期', start: 200, end: null, color: '#993366', range: '200年至今', desc: '测试时期乙' },
      { name: '无事件时期', start: 5000, end: 6000, color: '#999999', range: '5000年—6000年', desc: '没有事件的时期' },
    ],
    events: [120, 150, 250].map((year, i) => ({
      id: `t${i}`, year, date: `${year}年`, title: `测试事件${i}`, short: '这是一个用于筛选测试的虚构历史事件，简要说明超过二十个字。',
      detail: '测试用详细说明。', images: [], source: '', majorScore: 4,
    })),
  };
  await page.route(`**${DATA_URL}`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(custom) }));
  await openApp(page);
  await openFilters(page);
  await eraTrigger(page).click();
  expect(await page.locator('.ms[data-name="era"] .ms-option').allTextContents()).toEqual(['甲时期2', '乙时期1']);
  await expect(page.locator('.filter-section[data-filter="major"]'), '没有重大事件时不显示该维度').toHaveCount(0);
  await expect(page.locator('.filter-section[data-filter="transition"]'), '没有时期更迭时不显示该维度').toHaveCount(0);
  await expect(page.locator('.filter-section[data-filter="type"]'), '没有类型时不显示该维度').toHaveCount(0);
  await expect(page.locator('.filter-hint')).toContainText('公元120年 — 公元250年');
  await expect(page.locator('#filterPanel input[data-range="from"]')).toHaveAttribute('placeholder', '120');
  await expect(page.locator('#filterPanel select[data-range="from-era"]')).toHaveValue('ce');
  await eraOption(page, '甲时期').click();
  await expect(page.locator('.list-title')).toHaveText(['测试事件0', '测试事件1']);
});

test.describe('手机', () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test('筛选面板和下拉列表在窄屏下完整可用，不产生横向滚动', async ({ page }) => {
    await openApp(page);
    await openFilters(page);
    await pickEras(page, '清');
    await expect(page.locator('#filterBadge')).toHaveText('1');
    for (const sel of ['#filterPanel', '.ms[data-name="era"] .ms-menu']) {
      const box = await page.locator(sel).boundingBox();
      expect(box.x, sel).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, sel).toBeLessThanOrEqual(390);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
