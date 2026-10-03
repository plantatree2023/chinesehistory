// 参考链接：点进网址框时自动粘贴剪贴板中的网址；保存时新增的参考链接同步到同一国家其他语言的数据集，
// 标题翻译成该语言（维基百科 / 百度百科为“Wikipedia (Chinese) - 词条名”的格式，中文数据集中的中文维基百科仍是“维基百科 - 词条名”）。
// 词条名查询（/api/link-title）和翻译（/api/translate）由测试拦截，不访问外网；写入只在浏览器的 localStorage 中。
const { test, expect, readTestData, DATASET, STORAGE_KEY } = require('./helpers');

test.use({ debugMode: true, viewport: { width: 1440, height: 860 } });

const EVENT_ID = 'e003';   // 测试数据中的“山顶洞人”，有一条中文维基百科链接
const EN = DATASET.replace(/^([a-z]{2})_[a-z]{2,3}/, '$1_en');   // cn_en-test
const ZH_KEY = STORAGE_KEY;
const EN_KEY = `zh-history-timeline:v1:${EN}`;
const OLD_LINK = 'https://zh.wikipedia.org/wiki/%E5%B1%B1%E9%A1%B6%E6%B4%9E%E4%BA%BA';
const NEW_WIKI = 'https://zh.wikipedia.org/wiki/%E5%91%A8%E5%8F%A3%E5%BA%97';   // 周口店
const NEW_BAIDU = 'https://baike.baidu.com/item/%E5%91%A8%E5%8F%A3%E5%BA%97%E9%81%97%E5%9D%80/123';   // 周口店遗址
const NEW_OTHER = 'https://www.example.com/zkd.html';

// 英文数据集（cn_en-test）中加入同一事件，参考链接已有英文标题
async function mockEnglish(page, sources) {
  const data = readTestData();
  data.id = EN;
  data.language = 'en';
  const ev = data.events.find((e) => e.id === EVENT_ID);
  ev.title = 'Upper Cave Man';
  ev.sources = sources || [{ url: OLD_LINK, title: 'Wikipedia (Chinese) - Upper Cave Man' }];
  ev.images.forEach((im, i) => { im.caption = `EN caption ${i + 1}`; });
  await page.route(`**/data/${EN}.json`, (route) => route.fulfill({ json: data }));
  return data;
}
// 翻译接口：按 “from>to:原文” 查表，查不到时返回 null；记录请求
async function mockTranslate(page, table) {
  const asked = [];
  await page.route('**/api/translate?**', (route) => {
    const q = new URL(route.request().url()).searchParams;
    const key = `${q.get('from')}>${q.get('to')}:${q.get('text')}`;
    asked.push(key);
    route.fulfill({ json: { text: table[key] || null } });
  });
  return asked;
}
async function openEditor(page, query = '') {
  await page.goto(`/?id=${EVENT_ID}${query}`);
  await expect(page.locator('#detailModal')).toBeVisible();
  await page.click('#detailEdit');
  await expect(page.locator('#editModal')).toBeVisible();
}
async function spareRow(page) {
  const rows = page.locator('#sourceEditor .source-row');
  const n = await rows.count();
  await expect(rows.nth(n - 1).locator('.source-url')).toHaveValue('');
  return rows.nth(n - 1);
}
async function addSource(page, url, title) {
  const row = await spareRow(page);
  if (title) await row.locator('.source-title').fill(title);
  await row.locator('.source-url').fill(url);
  await row.locator('.source-url').dispatchEvent('change');
  return row;
}
async function save(page) {
  await page.click('#editForm button[type=submit]');
  await expect(page.locator('#editModal')).toBeHidden();
}
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);

test('点进空的参考链接网址框时，自动粘贴剪贴板中的网址并填写标题；不是网址、框里已有内容、已有同样的链接时不粘贴', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/api/link-title?**', (route) => route.fulfill({ json: { title: '维基百科 - 周口店' } }));
  await openEditor(page);
  const setClipboard = (t) => page.evaluate((t) => navigator.clipboard.writeText(t), t);
  const blur = () => page.locator('#editForm [name=title]').focus();
  const rows = page.locator('#sourceEditor .source-row');
  await expect(rows).toHaveCount(2);   // 原有的一条 + 预留的空行

  await setClipboard(NEW_WIKI);
  await rows.nth(1).locator('.source-url').click();
  await expect(rows.nth(1).locator('.source-url')).toHaveValue(NEW_WIKI);
  await expect(rows.nth(1).locator('.source-title')).toHaveValue('维基百科 - 周口店');
  await expect(rows.nth(1).locator('.source-open')).toHaveAttribute('href', NEW_WIKI);
  await expect(rows).toHaveCount(3);   // 填入后再预留一行

  // 已有同样的链接：不粘贴
  await blur();
  await rows.nth(2).locator('.source-url').click();
  await page.waitForTimeout(200);
  await expect(rows.nth(2).locator('.source-url')).toHaveValue('');
  // 不是网址：不粘贴
  await blur();
  await setClipboard('一段普通文字');
  await rows.nth(2).locator('.source-url').click();
  await page.waitForTimeout(200);
  await expect(rows.nth(2).locator('.source-url')).toHaveValue('');
  // 框里已有内容：不覆盖
  await blur();
  await setClipboard(NEW_OTHER);
  await rows.nth(0).locator('.source-url').click();
  await page.waitForTimeout(200);
  await expect(rows.nth(0).locator('.source-url')).toHaveValue(OLD_LINK);
});

test('新增的参考链接同步到英文数据集：标题翻译成“Wikipedia (Chinese) - …”等；原有的链接不重复，中文标题不变', async ({ page }) => {
  await mockEnglish(page);
  const asked = await mockTranslate(page, {
    'zh-CN>en:周口店': 'Zhoukoudian',
    'zh-CN>en:周口店遗址': 'Zhoukoudian Site',
    'zh-CN>en:周口店发掘报告': 'Zhoukoudian excavation report',
  });
  await openEditor(page);
  await addSource(page, NEW_WIKI);
  await expect(page.locator('#sourceEditor .source-title').nth(1)).toHaveValue('维基百科 - 周口店');
  await addSource(page, NEW_BAIDU, '百度百科 - 周口店遗址');
  await addSource(page, NEW_OTHER, '周口店发掘报告');
  await addSource(page, 'https://www.example.com/no-title.html');
  await save(page);

  const zh = (await stored(page, ZH_KEY)).changed[EVENT_ID].sources;
  expect(zh.map((s) => s.title)).toEqual([undefined, '维基百科 - 周口店', '百度百科 - 周口店遗址', '周口店发掘报告', undefined]);
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), EN_KEY)).not.toBeNull();
  const en = (await stored(page, EN_KEY)).changed[EVENT_ID];
  expect(en.sources).toEqual([
    { url: OLD_LINK, title: 'Wikipedia (Chinese) - Upper Cave Man' },
    { url: NEW_WIKI, title: 'Wikipedia (Chinese) - Zhoukoudian' },
    { url: NEW_BAIDU, title: 'Baidu Baike - Zhoukoudian Site' },
    { url: NEW_OTHER, title: 'Zhoukoudian excavation report' },
    { url: 'https://www.example.com/no-title.html' },
  ]);
  expect(en.images).toBeUndefined();   // 图片没有变化，不写入
  expect(asked).not.toContain(expect.stringContaining('山顶洞人'));
});

test('翻译不了时保留原文的词条名；英文数据集中已有的网址不重复添加；没有新增链接时不写入', async ({ page }) => {
  await mockEnglish(page, [{ url: OLD_LINK, title: 'Wikipedia (Chinese) - Upper Cave Man' }, { url: NEW_OTHER, title: 'Report' }]);
  await openEditor(page);
  await save(page);
  await page.waitForTimeout(300);
  expect(await page.evaluate((k) => localStorage.getItem(k), EN_KEY)).toBeNull();

  await openEditor(page);
  await addSource(page, NEW_WIKI);
  await addSource(page, NEW_OTHER, '报告');
  await save(page);
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), EN_KEY)).not.toBeNull();
  expect((await stored(page, EN_KEY)).changed[EVENT_ID].sources).toEqual([
    { url: OLD_LINK, title: 'Wikipedia (Chinese) - Upper Cave Man' },
    { url: NEW_OTHER, title: 'Report' },
    { url: NEW_WIKI, title: 'Wikipedia (Chinese) - 周口店' },
  ]);
});

test('英文界面：中文维基百科链接的标题自动填写为“Wikipedia (Chinese) - 英文词条名”；同步到中文数据集时用查询到的中文词条名', async ({ page }) => {
  await mockEnglish(page);
  await page.route('**/api/link-title?**', (route) => route.fulfill({ json: { title: '维基百科 - 周口店' } }));
  await mockTranslate(page, { 'zh-CN>en:周口店': 'Zhoukoudian' });
  await openEditor(page, `&data=${EN}`);
  const row = await addSource(page, NEW_WIKI);
  await expect(row.locator('.source-title')).toHaveValue('Wikipedia (Chinese) - Zhoukoudian');
  await expect(row.locator('.source-hint')).toHaveText('✓ Title filled in automatically (you can edit it)');
  await save(page);

  expect((await stored(page, EN_KEY)).changed[EVENT_ID].sources.pop()).toEqual({ url: NEW_WIKI, title: 'Wikipedia (Chinese) - Zhoukoudian' });
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), ZH_KEY)).not.toBeNull();
  const zh = (await stored(page, ZH_KEY)).changed[EVENT_ID].sources;
  expect(zh).toEqual([{ url: OLD_LINK }, { url: NEW_WIKI, title: '维基百科 - 周口店' }]);
});
