// 界面语言（i18n）：语言由数据集名称决定（cn_zh → 中文，cn_en → 英文），界面文字以中文为原文，
// 其他语言在 js/i18n/<语言>.js 中按原文给出译文；右上角的语言菜单（手机在“更多”菜单中）可以切换语言，所有访问者可用。
// 界面测试使用固定的英文测试数据 tests/data/cn_en-test.json；数据完整性检查遍历 data/ 下的所有数据集
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test, expect, REAL_DATASETS, readRealDataset } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const EN_DATASET = 'cn_en-test';
const EN_TEST_FILE = path.join(__dirname, 'data', `${EN_DATASET}.json`);
const CJK = /[㐀-鿿]/;
const DESKTOP = { width: 1400, height: 860 };
const PHONE = { width: 390, height: 800 };

// 在 Node 中载入 js/i18n/ 下的所有语言文件
function loadLocales() {
  const sandbox = { window: {} };
  for (const f of fs.readdirSync(path.join(ROOT, 'js', 'i18n'))) {
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'i18n', f), 'utf8'), sandbox);
  }
  return sandbox.window.TIMELINE_I18N;
}
const LOCALES = loadLocales();
const OTHER_LANGS = Object.keys(LOCALES).filter((l) => l !== 'zh');
const langOf = (ds) => ds.split('_')[1].split('-')[0];

// js/app.js 中 _('…') 和 _in(语言, '…') 的原文，以及显示时经过 _() 的反馈类型
function appStrings() {
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const keys = new Set([...app.matchAll(/\b_(?:\(|in\(\s*\w+\s*,)\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => vm.runInNewContext(`'${m[1]}'`)));
  for (const name of ['EVENT_KINDS', 'SITE_KINDS']) {
    const list = app.match(new RegExp(`var ${name} = (\\[[^\\]]*\\]);`));
    expect(list, name).toBeTruthy();
    JSON.parse(list[1].replace(/'/g, '"')).forEach((k) => keys.add(k));
  }
  return [...keys];
}

// 页面中残留的中文：文字节点、title / aria-label / placeholder / alt 属性和网页标题；语言名称（如“中文”）除外
function leftoverChinese(page) {
  return page.evaluate((langNames) => {
    const CJK = /[㐀-鿿]/;
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode;
      const text = n.nodeValue.trim();
      if (CJK.test(text) && !/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName) && !langNames.includes(text)) out.push(text.slice(0, 60));
    }
    document.querySelectorAll('*').forEach((el) => ['title', 'aria-label', 'placeholder', 'alt'].forEach((a) => {
      const v = el.getAttribute(a);
      if (v && CJK.test(v)) out.push(`${a}: ${v.slice(0, 60)}`);
    }));
    if (CJK.test(document.title)) out.push(`<title>: ${document.title}`);
    return out;
  }, Object.values(LOCALES).flatMap((l) => [l.name, l.shortName]));
}

async function openEnglish(page, query = '') {
  await page.goto(`/?data=${EN_DATASET}${query}`);
  await expect(page.locator('.card').first()).toBeVisible();
}

test('每种语言都有名称、网页语言代码、网站名称、年份格式和文字长度设置', () => {
  expect(Object.keys(LOCALES)).toEqual(expect.arrayContaining(['zh', 'en']));
  for (const [lang, L] of Object.entries(LOCALES)) {
    expect(L.name && L.shortName && L.htmlLang && L.siteName, lang).toBeTruthy();
    for (const f of ['formatYear', 'tickLabel', 'approxYear']) expect(typeof L[f], `${lang}.${f}`).toBe('function');
    for (const k of ['minSummary', 'summaryCut', 'maxTitle', 'maxDate', 'maxShort', 'maxDetail', 'maxCaption', 'maxSourceTitle']) {
      expect(Number.isInteger(L.limits[k]) && L.limits[k] > 0, `${lang}.limits.${k}`).toBe(true);
    }
  }
  const en = LOCALES.en;
  expect([-1700000, -500000, -221, 618, 1949].map(en.formatYear)).toEqual(['c. 1.7 million years ago', 'c. 500,000 years ago', '221 BC', 'AD 618', '1949']);
  expect([-1000000, -500000, -221, 1949].map(en.tickLabel)).toEqual(['1M yrs ago', '500k yrs ago', '221 BC', '1949']);
  expect(en.approxYear(-221.4, 2026)).toBe('c. 221 BC');
  expect(en.approxYear(3000, 2026)).toBe('c. 2026');
});

test('js/app.js 中 _() 的每条原文在每种语言中都有译文，{名称} 占位符一致，译文中没有中文', () => {
  const keys = appStrings();
  expect(keys.length).toBeGreaterThan(150);
  for (const lang of OTHER_LANGS) {
    const strings = LOCALES[lang].strings;
    for (const k of keys) {
      expect(Object.prototype.hasOwnProperty.call(strings, k), `${lang} 缺少译文：${k}`).toBe(true);
      const vars = (s) => (s.match(/\{\w+\}/g) || []).sort();
      if (strings[k] !== '') expect(vars(strings[k]), `${lang}：${k}`).toEqual(vars(k));
      expect(strings[k], `${lang}：${k}`).not.toMatch(CJK);
    }
  }
});

test.describe('英文界面', () => {
  test.use({ viewport: DESKTOP });

  test('网页语言、标题、字体：标题 Cinzel，正文 EB Garamond；年份用英文格式', async ({ page }) => {
    await openEnglish(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle('China Through Time');
    await expect(page.locator('.brand-home')).toContainText('China Through Time');
    const font = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(await font('.brand')).toMatch(/^"?Cinzel/);
    expect(await font('.card-title')).toMatch(/^"?EB Garamond/);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('700 20px Cinzel'))).toBe(true);
    // 刻度和卡片上的年份
    await expect(page.locator('.card-date').first()).toHaveText(/years ago|BC|^\d/);
  });

  test('打开各个面板后页面中都没有中文（数据、菜单、筛选、详情、编辑页、关于、分享）', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('zh-history-timeline:debug', '1'));
    await openEnglish(page);
    expect(await leftoverChinese(page)).toEqual([]);
    // 详情与编辑页
    await page.locator('.card').first().click();
    await expect(page.locator('#detailModal')).toBeVisible();
    expect(await leftoverChinese(page)).toEqual([]);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.locator('#editModal')).toBeVisible();
    expect(await leftoverChinese(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // 浏览全部事件与筛选
    await page.goto(`/?data=${EN_DATASET}&browse`);
    await page.click('#filterToggle');
    await expect(page.locator('#filterPanel')).toBeVisible();
    await expect(page.locator('#filterPanel')).toContainText('Major events only');
    expect(await leftoverChinese(page)).toEqual([]);
    await page.fill('#searchInput', 'zzzz');
    await expect(page.locator('#eventList')).toContainText('No matching events');
    // 关于、分享
    await page.goto(`/?data=${EN_DATASET}`);
    await page.click('#aboutBtn');
    await expect(page.locator('#aboutSummary')).toHaveText(/It currently holds \d+ events/);
    expect(await leftoverChinese(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await page.click('#shareTimeline');
    expect(await leftoverChinese(page)).toEqual([]);
  });

  test('编辑页的长度上限按语言放宽', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('zh-history-timeline:debug', '1'));
    await openEnglish(page);
    const limits = LOCALES.en.limits;
    expect(await page.evaluate(() => {
      const f = document.getElementById('editForm');
      return [f.title.maxLength, f.date.maxLength, f.short.maxLength, f.detail.maxLength];
    })).toEqual([limits.maxTitle, limits.maxDate, limits.maxShort, limits.maxDetail]);
  });
});

test.describe('切换语言（所有访问者可用）', () => {
  test.use({ viewport: DESKTOP });

  test('电脑：右上角下拉菜单列出所有语言并标出当前语言，选择后换成同一国家另一种语言的数据集，保留时间位置', async ({ page }) => {
    // 切换后的真实数据集换成测试数据，测试不依赖 data/ 中的文件
    await page.route('**/data/cn_en.json', (route) => route.fulfill({ path: EN_TEST_FILE }));
    await page.goto('/?at=-500');
    await expect(page.locator('.card').first()).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/debug-mode/);
    const btn = page.locator('#langBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('中文');
    // 在放大缩小按钮左边
    const box = await btn.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual((await page.locator('#barsToggle').boundingBox()).x);
    await btn.click();
    const items = page.locator('#langMenu [role=menuitemradio]');
    await expect(items).toHaveCount(Object.keys(LOCALES).length);
    await expect(page.locator('#langMenu [aria-checked=true]')).toHaveText(/中文/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#langMenu')).toBeHidden();
    await btn.click();
    await page.locator('#langMenu [data-lang=en]').click();
    await page.waitForURL(/data=cn_en(&|$)/);
    const url = new URL(page.url());
    expect(url.searchParams.get('at')).toBeTruthy();
    expect(url.searchParams.has('debugMode')).toBe(false);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#langBtn')).toContainText('English');
  });

  test('从英文切回中文：去掉英文数据集参数', async ({ page }) => {
    await page.route('**/data/cn_zh.json', (route) => route.fulfill({ path: path.join(__dirname, 'data', 'cn_zh-test.json') }));
    await openEnglish(page);
    await page.click('#langBtn');
    await expect(page.locator('#langMenu [aria-checked=true]')).toHaveText(/English/);
    await page.locator('#langMenu [data-lang=zh]').click();
    await page.waitForURL((u) => u.searchParams.get('data') !== EN_DATASET);
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.locator('.card').first()).toBeVisible();
  });

  test('隐藏工具栏时不显示语言菜单', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.card').first()).toBeVisible();
    await page.click('#barsToggle');
    await expect(page.locator('#langBtn')).toBeHidden();
  });

  // 顶栏标题（含当前时期）不被右上角的按钮挡住：中英文、调试模式与否、几种窗口宽度
  for (const width of [1400, 1024, 760]) {
    for (const debug of [false, true]) {
      test(`${width}px${debug ? '，调试模式' : ''}：中英文标题都不和右上角按钮重叠`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        if (debug) await page.addInitScript(() => localStorage.setItem('zh-history-timeline:debug', '1'));
        for (const url of ['/', `/?data=${EN_DATASET}`]) {
          await page.goto(url);
          await expect(page.locator('.card').first()).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const b = await page.locator('.brand').boundingBox();
          const c = await page.locator('.corner-btns').boundingBox();
          expect(b.x + b.width, url).toBeLessThanOrEqual(c.x);
        }
      });
    }
  }

  test('调试模式：切换语言时保留调试模式', async ({ page }) => {
    await page.route('**/data/cn_en.json', (route) => route.fulfill({ path: EN_TEST_FILE }));
    await page.addInitScript(() => localStorage.setItem('zh-history-timeline:debug', '1'));
    await page.goto('/?debugMode');
    await expect(page.locator('.card').first()).toBeVisible();
    await page.click('#langBtn');
    await page.locator('#langMenu [data-lang=en]').click();
    await page.waitForURL(/data=cn_en(&|$)/);
    expect(new URL(page.url()).searchParams.has('debugMode')).toBe(true);
    await expect(page.locator('body')).toHaveClass(/debug-mode/);
  });

  test.describe('手机', () => {
    test.use({ viewport: PHONE });

    test('语言切换在“更多”菜单中', async ({ page }) => {
      await page.route('**/data/cn_en.json', (route) => route.fulfill({ path: EN_TEST_FILE }));
      await page.goto('/');
      await expect(page.locator('.card').first()).toBeVisible();
      await expect(page.locator('#langBtn')).toBeHidden();
      await page.click('#moreBtn');
      const seg = page.locator('#langSeg [role=radio]');
      await expect(seg).toHaveCount(Object.keys(LOCALES).length);
      await expect(page.locator('#langSeg [aria-checked=true]')).toHaveText('中');
      // 菜单完整显示在屏幕内
      const box = await page.locator('#moreMenu').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
      for (const b of await seg.all()) expect((await b.boundingBox()).width).toBeGreaterThan(20);
      await page.locator('#langSeg [data-lang=en]').click();
      await page.waitForURL(/data=cn_en(&|$)/);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    });

    for (const debug of [false, true]) {
      test(`英文标题完整显示，不和右上角按钮重叠${debug ? '（调试模式）' : ''}`, async ({ page }) => {
        if (debug) await page.addInitScript(() => localStorage.setItem('zh-history-timeline:debug', '1'));
        await openEnglish(page);
        const brand = page.locator('.brand');
        expect(await brand.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        const b = await brand.boundingBox();
        const c = await page.locator('.corner-btns').boundingBox();
        expect(b.x + b.width).toBeLessThanOrEqual(c.x);
      });
    }
  });
});

// ---------- 数据：翻译的数据集与中文数据集一一对应 ----------
const TRANSLATED = REAL_DATASETS.filter((ds) => langOf(ds) !== 'zh' && REAL_DATASETS.includes(`${ds.split('_')[0]}_zh`));

test('data/ 中有英文数据集 cn_en，测试数据中有英文测试数据集', () => {
  expect(REAL_DATASETS).toContain('cn_en');
  const data = JSON.parse(fs.readFileSync(EN_TEST_FILE, 'utf8'));
  expect(data.language).toBe('en');
  expect(data.events.length).toBeGreaterThan(20);
});

// 中文数据集可以单独修改（新增、删除事件），翻译版不要求逐条同步：翻译版中的每个事件都在中文数据集中，年份相同
for (const ds of TRANSLATED) test(`${ds}：事件都来自中文数据集（id、年份相同），时期和类型一一对应，文字中没有中文`, () => {
  const data = readRealDataset(ds);
  const zh = readRealDataset(`${ds.split('_')[0]}_zh`);
  expect(data.id).toBe(ds);
  expect(data.language).toBe(langOf(ds));
  expect(data.music).toEqual(zh.music);
  expect(data.texture).toEqual(zh.texture);
  expect(data.eras.map((e) => [e.start, e.end, e.color])).toEqual(zh.eras.map((e) => [e.start, e.end, e.color]));
  expect(data.types.map((t) => [t.key, t.color])).toEqual(zh.types.map((t) => [t.key, t.color]));
  const eraNames = data.eras.map((e) => e.name);
  const typeName = Object.fromEntries(zh.types.map((t, i) => [t.name, data.types[i].name]));
  const zhById = new Map(zh.events.map((e) => [e.id, e]));
  expect(data.events.length).toBeGreaterThan(0);
  for (const ev of data.events) {
    const z = zhById.get(ev.id);
    expect(z, `${ev.id} 不在中文数据集中`).toBeTruthy();
    expect(ev.year, ev.id).toBe(z.year);
    expect(Object.values(typeName), ev.id).toContain(ev.type);
    if (ev.transition) {
      expect(eraNames, ev.id).toContain(ev.transition.from);
      expect(eraNames, ev.id).toContain(ev.transition.to);
    }
    for (const k of ['title', 'date', 'short', 'detail']) {
      expect(typeof ev[k] === 'string' && ev[k].trim().length > 0, `${ev.id}.${k}`).toBe(true);
    }
  }
  const text = JSON.stringify([data.description, data.eras, data.types,
    data.events.map((e) => [e.title, e.date, e.short, e.detail, e.type, (e.images || []).map((im) => im.caption), (e.sources || []).map((s) => s.title)])]);
  expect(text).not.toMatch(CJK);
});
