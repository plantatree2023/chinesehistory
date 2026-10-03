// 图片版权（署名）：图片的 author / license / sourceUrl 在图片查看器、详情页“图片来源”和事件静态页中显示；
// 编辑页的“这张图的版权”一行、维基共享资源网址自动填写、“图片信息”表（版权和对照语言的标题），
// 以及保存时同步到同一国家其他语言的数据集。
// 维基共享资源的查询和图片下载都由测试拦截（helpers 默认屏蔽所有外网请求），不访问外网。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, seedEvents, loadDataset, makePng, readTestData, DATASET, STORAGE_KEY, TEST_DATA_FILE } = require('./helpers');
const { createServer, validateDataset } = require('../server');
const { buildEventPages } = require('../tools/build-site');
const { translateText, parseGoogle } = require('../lib/translate');

test.use({ viewport: { width: 1440, height: 860 } });

const EVENT_ID = 'e003';   // 测试数据中的“山顶洞人”，有 6 张图片
const SIBLING = DATASET.replace(/^([a-z]{2})_[a-z]{2,3}/, '$1_en');   // cn_en-test
const SIBLING_KEY = `zh-history-timeline:v1:${SIBLING}`;
const COMMONS_PAGE = 'https://commons.wikimedia.org/wiki/File:Test_photo.jpg';
const COMMONS_THUMB = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Test_photo.jpg/1200px-Test_photo.jpg';

// 给测试事件的图片加上三种署名：0 有许可证，1 只知道来源网站，2 来源不详；其余不填写
function withCredits(events) {
  const ev = events.find((e) => e.id === EVENT_ID);
  Object.assign(ev.images[0], { author: 'Jane Doe', license: 'CC BY-SA 4.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg' });
  Object.assign(ev.images[1], { license: 'unknown', sourceUrl: 'https://www.example.com/photos/b.html' });
  Object.assign(ev.images[2], { license: 'unknown' });
  return events;
}

// 维基共享资源的查询结果（API）和图片
// labels：结构化数据中的说明（Captions）；description：多语言的描述
async function mockCommons(page, { missing = false, labels = {}, description = 'A test photo' } = {}) {
  const lookups = [];
  await page.route('https://commons.wikimedia.org/w/api.php?**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('action') === 'wbgetentities') {
      const entities = missing ? { '-1': { missing: '' } } : { M123: { labels: Object.fromEntries(Object.entries(labels).map(([language, value]) => [language, { language, value }])) } };
      return route.fulfill({ json: { entities }, headers: { 'access-control-allow-origin': '*' } });
    }
    lookups.push(params.get('titles'));
    const pages = missing ? { '-1': { missing: '' } } : {
      '123': {
        imageinfo: [{
          thumburl: COMMONS_THUMB,
          url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Test_photo.jpg',
          descriptionurl: COMMONS_PAGE,
          extmetadata: {
            Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Tester">Test Author</a><img src=x onerror="window.__xss=1">' },
            LicenseShortName: { value: 'CC BY 4.0' },
            ImageDescription: { value: description },
          },
        }],
      },
    };
    return route.fulfill({ json: { query: { pages } }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://upload.wikimedia.org/**', (route) => route.fulfill({ body: makePng(60, 40, 120), contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }));
  return lookups;
}

// 其他语言的数据集（cn_en-test）：测试事件的图片相同，标题为英文
async function mockSibling(page, mutate) {
  const data = readTestData();
  data.id = SIBLING;
  data.language = 'en';
  data.events = data.events.filter((e) => e.id === EVENT_ID);
  data.events[0].images.forEach((im, i) => { im.caption = i === 1 ? '' : `EN caption ${i + 1}`; });
  if (mutate) mutate(data);
  await page.route(`**/data/${SIBLING}.json`, (route) => route.fulfill({ json: data }));
  return data;
}

async function openDetail(page) {
  await page.goto(`/?id=${EVENT_ID}`);
  await expect(page.locator('#detailModal')).toBeVisible();
}
async function openEditor(page) {
  await openDetail(page);
  await page.click('#detailEdit');
  await expect(page.locator('#editModal')).toBeVisible();
}

test.describe('网站上的署名', () => {
  test('图片查看器：标题下方显示署名（有许可证 / 只知道来源网站 / 来源不详），没有填写的不显示', async ({ page }) => {
    await seedEvents(page, withCredits);
    await openDetail(page);
    await page.click('#detailHero img');
    const credit = page.locator('#lightboxCredit');
    await expect(credit).toHaveText('图：Jane Doe · CC BY-SA 4.0 · 原图 ↗');
    await expect(credit.getByRole('link', { name: 'CC BY-SA 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
    await expect(credit.getByRole('link', { name: '原图 ↗' })).toHaveAttribute('href', 'https://commons.wikimedia.org/wiki/File:A.jpg');
    await page.click('.lb-next');
    await expect(credit).toContainText('图片来源：example.com ↗ · 作者与许可不详');
    await page.click('.lb-next');
    await expect(credit).toContainText('图片来源网络，作者不详');
    await page.click('.lb-next');
    await expect(credit).toBeHidden();
  });

  test('详情页底部列出每张图片的来源；没有任何版权信息时不显示', async ({ page }) => {
    await seedEvents(page, withCredits);
    await openDetail(page);
    const box = page.locator('#detailCredits');
    await expect(box).toBeVisible();
    await expect(page.locator('#detailCreditsTitle')).toHaveText('图片来源（6 张）');
    const items = page.locator('#detailCreditsList li');
    await expect(items).toHaveCount(6);
    await expect(items.nth(0)).toHaveText('图：Jane Doe · CC BY-SA 4.0 · 原图 ↗');
    await expect(items.nth(1)).toHaveText('图片来源：example.com ↗ · 作者与许可不详');
    await expect(items.nth(2)).toHaveText('图片来源网络，作者不详');
    await expect(items.nth(3)).toHaveText('未注明');
    await expect(page.locator('#detailCreditsNote')).toContainText('部分图片来自网络、作者不详');

    await page.goto('/?id=e002');   // 没有填写版权信息的事件
    await expect(page.locator('#detailModal')).toBeVisible();
    await expect(box).toBeHidden();
  });

  test('作者不详的图片：“联系我们”打开反馈，预先选好“图片有问题”和这张图', async ({ page }) => {
    await page.route('**/js/config.js', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: "window.TIMELINE_CONFIG = { feedback: { endpoint: 'https://api.web3forms.com/submit', accessKey: 'test-access-key' } };",
    }));
    await seedEvents(page, withCredits);
    await openDetail(page);
    await page.click('#detailHero img');
    await page.click('.lb-next');
    await page.locator('#lightboxCredit').getByText('版权问题请联系我们').click();
    await expect(page.locator('#lightbox')).toBeHidden();
    await expect(page.locator('#feedbackModal')).toBeVisible();
    await expect(page.locator('#feedbackKinds input[value="图片有问题"]')).toBeChecked();
    await expect(page.locator('#feedbackForm [name=image]')).toHaveValue('2');
  });

  test('事件静态页的图注中显示署名', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credits-'));
    try {
      const dataDir = path.join(dir, 'data');
      fs.mkdirSync(dataDir);
      const data = readTestData();
      data.id = 'cn_zh';
      withCredits(data.events);
      fs.writeFileSync(path.join(dataDir, 'cn_zh.json'), JSON.stringify(data));
      buildEventPages(path.join(dir, 'out'), dataDir);
      const html = fs.readFileSync(path.join(dir, 'out', 'e', `${EVENT_ID}.html`), 'utf8');
      expect(html).toContain('图：Jane Doe · <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener">CC BY-SA 4.0</a>');
      expect(html).toContain('图片来源：<a href="https://www.example.com/photos/b.html" rel="noopener">example.com</a> · 作者与许可不详');
      expect(html).toContain('图片来源网络，作者不详');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('服务器保存时校验图片版权字段', () => {
    const data = readTestData();
    const ev = data.events.find((e) => e.id === EVENT_ID);
    Object.assign(ev.images[0], { author: 'A', license: 'CC0', sourceUrl: 'https://example.com/a' });
    expect(() => validateDataset(DATASET, data)).not.toThrow();
    for (const bad of [{ author: 5 }, { license: '' }, { license: 'x'.repeat(61) }, { sourceUrl: 'javascript:alert(1)' }]) {
      const copy = JSON.parse(JSON.stringify(data));
      Object.assign(copy.events.find((e) => e.id === EVENT_ID).images[0], bad);
      expect(() => validateDataset(DATASET, copy), JSON.stringify(bad)).toThrow();
    }
  });
});

test.describe('编辑页', () => {
  test.use({ debugMode: true });

  test('缩略图显示版权标签（缺少来源或许可证的标红），图片信息表默认折叠，表头统计缺少许可信息的图片', async ({ page }) => {
    await seedEvents(page, withCredits);
    await openEditor(page);
    const chips = page.locator('#imageEditor .img-slot .credit-chip');
    await expect(chips).toHaveCount(6);
    await expect(chips.nth(0)).toHaveText('CC BY-SA 4.0');
    await expect(chips.nth(1)).toHaveText('example.com');
    await expect(chips.nth(2)).toHaveText('⚠ 缺来源');
    await expect(chips.nth(3)).toHaveText('⚠ 缺来源和许可证');
    await expect(page.locator('#imageEditor .credit-chip.credit-missing')).toHaveCount(4);
    // 预览图足够大
    const thumb = await page.locator('#imageEditor .img-slot img').first().boundingBox();
    expect(thumb.width).toBeGreaterThanOrEqual(130);
    // 标签在图片底边、标题栏上方，不挡住标题
    const chipBox = await chips.nth(0).boundingBox();
    const capBox = await page.locator('#imageEditor .slot-caption').nth(0).boundingBox();
    expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(capBox.y);
    expect(capBox.y - (chipBox.y + chipBox.height)).toBeLessThan(8);

    const info = page.locator('#imageInfo');
    await expect(info).not.toHaveAttribute('open', '');
    await expect(page.locator('#imageInfoRows .info-row').first()).toBeHidden();
    await expect(page.locator('#imageInfoTitle')).toHaveText('图片信息 · 6 张，5 张缺少许可信息');
    await page.click('#imageInfo > summary');
    await expect(page.locator('#imageInfoRows .info-row')).toHaveCount(6);
    await expect(page.locator('#imageInfoRows .info-author').first()).toHaveValue('Jane Doe');
    await expect(page.locator('#imageInfoRows .info-license').nth(1)).toHaveValue('unknown');
    await expect(page.locator('#imageInfoRows .info-license').nth(3)).toHaveValue('');
  });

  test('在图片信息表中修改版权和标题，保存后网站显示新的署名', async ({ page }) => {
    await openEditor(page);
    await page.click('#imageInfo > summary');
    const row = page.locator('#imageInfoRows .info-row').nth(0);
    await row.locator('.info-caption').fill('新的图片标题');
    await expect(page.locator('#imageEditor .slot-caption').nth(0)).toHaveValue('新的图片标题');
    await row.locator('.info-author').fill('张三');
    await row.locator('.info-license').selectOption('CC BY 3.0');
    await expect(page.locator('#imageEditor .img-slot').nth(0).locator('.credit-chip')).toHaveText('⚠ 缺来源');
    await row.locator('.info-source').fill('https://commons.wikimedia.org/wiki/File:B.jpg');
    await expect(page.locator('#imageEditor .img-slot').nth(0).locator('.credit-chip')).toHaveText('CC BY 3.0');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();

    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    expect(saved.changed[EVENT_ID].images[0]).toMatchObject({ caption: '新的图片标题', author: '张三', license: 'CC BY 3.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:B.jpg' });
    await expect(page.locator('#detailCreditsList li').first()).toHaveText('图：张三 · CC BY 3.0 · 原图 ↗');
  });

  test('粘贴维基共享资源的文件页网址：自动填写版权，添加后下载图片并写入版权信息', async ({ page }) => {
    const lookups = await mockCommons(page);
    await openEditor(page);
    await page.fill('#imageUrlInput', COMMONS_PAGE);
    await expect(page.locator('#newCreditHint')).toContainText('已从维基共享资源读取作者和许可证');
    await expect(page.locator('#newCreditAuthor')).toHaveValue('Test Author');
    await expect(page.locator('#newCreditLicense')).toHaveValue('CC BY 4.0');
    await expect(page.locator('#newCreditSource')).toHaveValue(COMMONS_PAGE);
    expect(lookups).toEqual(['File:Test_photo.jpg']);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();   // 作者的 HTML 只取文字

    await page.click('#imageUrlAdd');
    await expect(page.locator('#imageEditor .img-slot')).toHaveCount(7);
    await expect(page.locator('#imageEditor .img-slot').nth(6).locator('.credit-chip')).toHaveText('CC BY 4.0');
    // 版权栏清空，图片信息表中新图片的一行高亮
    await expect(page.locator('#newCreditAuthor')).toHaveValue('');
    await expect(page.locator('#newCreditLicense')).toHaveValue('unknown');
    await expect(page.locator('#imageInfoRows .info-row.new')).toHaveCount(1);
    await expect(page.locator('#imageInfo')).not.toHaveAttribute('open', '');   // 保持折叠

    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    const im = saved.changed[EVENT_ID].images[6];
    expect(im).toMatchObject({ author: 'Test Author', license: 'CC BY 4.0', sourceUrl: COMMONS_PAGE, w: 60, h: 40 });
    expect(Object.keys(im).filter((k) => k.startsWith('_'))).toEqual([]);
  });

  test('粘贴维基共享资源的网址：自动填写各语言的标题（优先用说明，没有时用描述的第一句），不覆盖手动输入的标题', async ({ page }) => {
    await mockSibling(page);
    await mockCommons(page, {
      labels: { 'zh-hant': '繁體的說明', 'zh-hans': '简体的说明', de: 'Deutsche Beschriftung' },
      description: { _type: 'lang', en: '<b>Container train</b> crosses the canal and the motorway near Oberhausen, Germany, in August 2016. It carries containers of China Railway Express.', de: 'Eisenbahn' },
    });
    await openEditor(page);
    const inputs = page.locator('#newCaptionInputs .new-caption-input');
    await expect(inputs).toHaveCount(2);
    await page.fill('#imageUrlInput', COMMONS_PAGE);
    await expect(inputs.nth(0)).toHaveValue('简体的说明');   // 中文：简体优先
    // 英文没有说明，用描述；太长时只取第一句（去掉 HTML 和句末的句号）
    await expect(inputs.nth(1)).toHaveValue('Container train crosses the canal and the motorway near Oberhausen, Germany, in August 2016');

    // 换一个网址：自动填写的标题清掉，手动输入的保留，再自动填写时不覆盖手动输入的
    await inputs.nth(0).fill('我的标题');
    await page.fill('#imageUrlInput', 'https://commons.wikimedia.org/wiki/File:Other.jpg');
    await expect(page.locator('#newCreditAuthor')).toHaveValue('Test Author');
    await expect(inputs.nth(0)).toHaveValue('我的标题');
    await expect(inputs.nth(1)).toHaveValue(/^Container train/);
    await page.click('#imageUrlAdd');
    await expect(page.locator('#imageEditor .img-slot')).toHaveCount(7);
    await expect(page.locator('#imageEditor .slot-caption').nth(6)).toHaveValue('我的标题');
    await expect(inputs.nth(0)).toHaveValue('');
  });

  test('点进输入框自动粘贴剪贴板中的维基共享资源网址时，同样自动填写标题和版权', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mockCommons(page, { labels: { 'zh-hans': '剪贴板的图片' } });
    await openEditor(page);
    await page.evaluate((t) => navigator.clipboard.writeText(t), COMMONS_PAGE);
    await page.click('#imageUrlInput');
    await expect(page.locator('#imageUrlInput')).toHaveValue(COMMONS_PAGE);
    await expect(page.locator('#newCreditAuthor')).toHaveValue('Test Author');
    await expect(page.locator('#newCreditLicense')).toHaveValue('CC BY 4.0');
    await expect(page.locator('#newCaptionInputs .new-caption-input').first()).toHaveValue('剪贴板的图片');
  });

  test('维基共享资源查不到时，文件页网址提示错误、不添加图片', async ({ page }) => {
    await mockCommons(page, { missing: true });
    await openEditor(page);
    await page.fill('#imageUrlInput', COMMONS_PAGE);
    await expect(page.locator('#newCreditHint')).toContainText('维基共享资源中找不到这张图片');
    await page.click('#imageUrlAdd');
    await expect(page.locator('#formError')).toContainText('无法读取维基共享资源的图片信息');
    await expect(page.locator('#imageEditor .img-slot')).toHaveCount(6);
  });

  test('普通图片网址：手动填写的版权写入新图片，来源网址默认用图片网址；上传图片也使用版权栏', async ({ page }) => {
    const url = 'https://www.example.com/photos/c.png';
    await page.route(url, (route) => route.fulfill({ body: makePng(50, 30, 60), contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }));
    await openEditor(page);
    await page.fill('#imageUrlInput', url);
    await page.fill('#newCreditAuthor', '李四');
    await page.selectOption('#newCreditLicense', 'CC0');
    await page.click('#imageUrlAdd');
    await expect(page.locator('#imageEditor .img-slot')).toHaveCount(7);

    const file = path.join(os.tmpdir(), `credit-upload-${process.pid}.png`);
    fs.writeFileSync(file, makePng(40, 40, 30));
    try {
      await page.fill('#newCreditSource', 'https://www.example.com/gallery');
      await page.setInputFiles('#imageFileInput', file);
      await expect(page.locator('#imageEditor .img-slot')).toHaveCount(8);
    } finally {
      fs.rmSync(file, { force: true });
    }
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    const imgs = saved.changed[EVENT_ID].images;
    expect(imgs[6]).toMatchObject({ author: '李四', license: 'CC0', sourceUrl: url });
    expect(imgs[7]).toMatchObject({ license: 'unknown', sourceUrl: 'https://www.example.com/gallery' });
    expect(imgs[7].author).toBeUndefined();
  });

  test('“从维基共享资源自动填写”：补上来源是维基共享资源、但缺少作者或许可证的图片', async ({ page }) => {
    await mockCommons(page);
    await seedEvents(page, (events) => {
      Object.assign(events.find((e) => e.id === EVENT_ID).images[3], { sourceUrl: COMMONS_PAGE });
      return events;
    });
    await openEditor(page);
    await expect(page.locator('#imageInfoAuto')).toBeVisible();
    await page.click('#imageInfoAuto');
    await expect(page.locator('#imageEditor .img-slot').nth(3).locator('.credit-chip')).toHaveText('CC BY 4.0');
    await expect(page.locator('#imageInfoAuto')).toBeHidden();
    await expect(page.locator('#imageInfo')).not.toHaveAttribute('open', '');   // 按钮在表头中，点了不展开
  });
});

test.describe('图片信息表：对照语言', () => {
  test.use({ debugMode: true });

  test('显示其他语言数据集中同一张图片的标题和缺少的数量，修改后保存到该语言的数据', async ({ page }) => {
    await mockSibling(page);
    const { events } = await loadDataset(page);
    const zh = events.find((e) => e.id === EVENT_ID).images;
    // 英文标题中第 2 张为空，而中文标题不为空，所以缺 1 张
    expect(zh[1].caption).not.toBe('');
    await openEditor(page);
    await page.click('#imageInfo > summary');
    const compare = page.locator('#imageInfoRows .info-compare');
    await expect(compare).toHaveCount(6);
    await expect(compare.nth(0)).toHaveValue('EN caption 1');
    await expect(compare.nth(1)).toHaveValue('');
    await expect(page.locator('#imageInfoHead .compare-select')).toHaveValue('en');
    await expect(page.locator('#imageInfoLangs .lang-count')).toHaveText('English 缺 1 张');

    await compare.nth(1).fill('Skull model');
    await expect(page.locator('#imageInfoLangs .lang-count')).toHaveText('English ✓ 齐全');
    await page.locator('#imageInfoRows .info-author').nth(0).fill('Jane Doe');
    await page.locator('#imageInfoRows .info-license').nth(0).selectOption('CC BY-SA 4.0');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();

    // 浏览器模式：写入 cn_en-test 在当前浏览器中保存的改动；版权信息与中文相同，标题用对照语言的标题
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), SIBLING_KEY)).not.toBeNull();
    const sib = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SIBLING_KEY);
    const imgs = sib.changed[EVENT_ID].images;
    expect(imgs.map((im) => im.src)).toEqual(zh.map((im) => im.src));
    expect(imgs[0]).toMatchObject({ caption: 'EN caption 1', author: 'Jane Doe', license: 'CC BY-SA 4.0' });
    expect(imgs[1].caption).toBe('Skull model');
    expect(imgs[2].caption).toBe('EN caption 3');
  });

  test('添加图片时可以填写各语言的标题，写入新图片和其他语言的数据', async ({ page }) => {
    await mockSibling(page);
    const url = 'https://www.example.com/photos/d.png';
    await page.route(url, (route) => route.fulfill({ body: makePng(50, 30, 90), contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }));
    await openEditor(page);
    const inputs = page.locator('#newCaptionInputs .new-caption-input');
    await expect(inputs).toHaveCount(2);   // 中文和 English
    await expect(page.locator('#newCaptionInputs .lang-name')).toHaveText(['中文', 'English']);
    await expect(inputs.nth(1)).toHaveAttribute('lang', 'en');
    await inputs.nth(0).fill('新图片');
    await inputs.nth(1).fill('New picture');
    await page.fill('#imageUrlInput', url);
    await page.click('#imageUrlAdd');
    await expect(page.locator('#imageEditor .img-slot')).toHaveCount(7);
    await expect(page.locator('#imageEditor .slot-caption').nth(6)).toHaveValue('新图片');
    await expect(inputs.nth(0)).toHaveValue('');   // 添加后清空
    await expect(inputs.nth(1)).toHaveValue('');
    await page.click('#imageInfo > summary');
    await expect(page.locator('#imageInfoRows .info-compare').nth(6)).toHaveValue('New picture');

    // 上传图片：标题留空时用文件名
    const file = path.join(os.tmpdir(), `caption-upload-${process.pid}.png`);
    fs.writeFileSync(file, makePng(40, 40, 30));
    try {
      await page.setInputFiles('#imageFileInput', file);
      await expect(page.locator('#imageEditor .img-slot')).toHaveCount(8);
    } finally {
      fs.rmSync(file, { force: true });
    }
    await expect(page.locator('#imageEditor .slot-caption').nth(7)).toHaveValue(`caption-upload-${process.pid}`);

    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    expect(saved.changed[EVENT_ID].images[6].caption).toBe('新图片');
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), SIBLING_KEY)).not.toBeNull();
    const sib = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SIBLING_KEY);
    expect(sib.changed[EVENT_ID].images[6].caption).toBe('New picture');
    expect(sib.changed[EVENT_ID].images[7].caption).toBe('');
  });

  test('其他语言的数据中没有这个事件时不显示对照栏，也不写入', async ({ page }) => {
    await mockSibling(page, (data) => { data.events = []; });
    await openEditor(page);
    await page.click('#imageInfo > summary');
    await expect(page.locator('#imageInfoLangs .lang-count')).toHaveText('English：没有这个事件');
    await expect(page.locator('#imageInfoRows .info-compare')).toHaveCount(0);
    await expect(page.locator('#newCaptionInputs .new-caption-input')).toHaveCount(1);   // 只有当前语言
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();
    expect(await page.evaluate((key) => localStorage.getItem(key), SIBLING_KEY)).toBeNull();
  });

  test('没有其他语言的数据集时不显示对照', async ({ page }) => {
    await page.route(`**/data/${SIBLING}.json`, (route) => route.fulfill({ status: 404, body: '' }));
    await openEditor(page);
    await page.click('#imageInfo > summary');
    await expect(page.locator('#imageInfoRows .info-row')).toHaveCount(6);
    await expect(page.locator('#imageInfoLangs')).toBeHidden();
    await expect(page.locator('#imageInfoRows .info-compare')).toHaveCount(0);
  });
});

test.describe('本地文件模式', () => {
  test.use({ debugMode: true });
  let server, origin, tmpDir;

  test.beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinesehistory-credits-'));
    fs.mkdirSync(path.join(tmpDir, 'data'));
    fs.copyFileSync(TEST_DATA_FILE, path.join(tmpDir, 'data', `${DATASET}.json`));
    const en = readTestData();
    en.id = SIBLING;
    en.language = 'en';
    en.events.forEach((e) => e.images.forEach((im, i) => { im.caption = `EN ${e.id} ${i + 1}`; }));
    fs.writeFileSync(path.join(tmpDir, 'data', `${SIBLING}.json`), JSON.stringify(en, null, 2));
    server = createServer({ root: path.resolve(__dirname, '..'), writeDir: tmpDir });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  test.afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('保存时版权信息和对照语言的标题写入其他语言的数据文件', async ({ page }) => {
    const read = (id) => JSON.parse(fs.readFileSync(path.join(tmpDir, 'data', `${id}.json`), 'utf8')).events.find((e) => e.id === EVENT_ID);
    await page.goto(`${origin}/?id=${EVENT_ID}`);
    await expect(page.locator('#detailModal')).toBeVisible();
    await page.click('#detailEdit');
    await page.click('#imageInfo > summary');
    await expect(page.locator('#imageInfoRows .info-compare').nth(0)).toHaveValue(`EN ${EVENT_ID} 1`);
    await page.locator('#imageInfoRows .info-compare').nth(0).fill('Shandingdong cave');
    await page.locator('#imageInfoRows .info-author').nth(1).fill('王五');
    await page.locator('#imageInfoRows .info-license').nth(1).selectOption('unknown');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();

    await expect.poll(() => read(SIBLING).images[0].caption).toBe('Shandingdong cave');
    expect(read(SIBLING).images[1]).toMatchObject({ caption: `EN ${EVENT_ID} 2`, author: '王五', license: 'unknown' });
    expect(read(DATASET).images[1]).toMatchObject({ author: '王五', license: 'unknown' });
    expect(read(DATASET).images[0].caption).not.toBe('Shandingdong cave');
  });
});

// ---------- 自动翻译图片标题 ----------
// 模拟本地服务器的翻译接口：按 “from>to:原文” 查表，查不到时返回 null；记录请求
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

test.describe('自动翻译图片标题', () => {
  test.use({ debugMode: true });

  test('维基共享资源只有繁体中文说明：转换成简体，再从中文翻译成英文', async ({ page }) => {
    await mockSibling(page);
    await mockCommons(page, { labels: { 'zh-hant': '帶有集裝箱的鐵路' }, description: 'untagged' });
    const asked = await mockTranslate(page, {
      'zh-TW>zh-CN:帶有集裝箱的鐵路': '带有集装箱的铁路',
      'zh-CN>en:带有集装箱的铁路': 'Railway with containers',
    });
    await openEditor(page);
    const inputs = page.locator('#newCaptionInputs .new-caption-input');
    await expect(inputs).toHaveCount(2);
    await page.fill('#imageUrlInput', COMMONS_PAGE);
    await expect(inputs.nth(0)).toHaveValue('带有集装箱的铁路');
    await expect(inputs.nth(1)).toHaveValue('Railway with containers');
    expect(asked).toEqual(['zh-TW>zh-CN:帶有集裝箱的鐵路', 'zh-CN>en:带有集装箱的铁路']);
  });

  test('维基共享资源只有英文说明：翻译成首选语言（中文）；已有的英文说明不再翻译', async ({ page }) => {
    await mockSibling(page);
    await mockCommons(page, { labels: { en: 'Container train' }, description: 'untagged' });
    const asked = await mockTranslate(page, { 'auto>zh-CN:Container train': '集装箱列车' });
    await openEditor(page);
    const inputs = page.locator('#newCaptionInputs .new-caption-input');
    await expect(inputs).toHaveCount(2);
    await page.fill('#imageUrlInput', COMMONS_PAGE);
    await expect(inputs.nth(0)).toHaveValue('集装箱列车');
    await expect(inputs.nth(1)).toHaveValue('Container train');
    expect(asked).toEqual(['auto>zh-CN:Container train']);
  });

  test('手动输入中文标题后翻译成其他语言，不覆盖手动输入的；翻译不了时保持空白', async ({ page }) => {
    await mockSibling(page);
    await mockTranslate(page, { 'zh-CN>en:长城': 'Great Wall', 'zh-CN>en:长城远景': 'Great Wall from afar' });
    await openEditor(page);
    const inputs = page.locator('#newCaptionInputs .new-caption-input');
    await expect(inputs).toHaveCount(2);
    await inputs.nth(0).fill('长城');
    await inputs.nth(0).blur();
    await expect(inputs.nth(1)).toHaveValue('Great Wall');
    // 改了中文：自动翻译的英文跟着更新
    await inputs.nth(0).fill('长城远景');
    await inputs.nth(0).blur();
    await expect(inputs.nth(1)).toHaveValue('Great Wall from afar');
    // 手动改过英文后不再覆盖
    await inputs.nth(1).fill('My title');
    await inputs.nth(0).fill('长城');
    await inputs.nth(0).blur();
    await page.waitForTimeout(300);
    await expect(inputs.nth(1)).toHaveValue('My title');
    // 翻译不了（如线上网站没有翻译接口）：保持空白
    await inputs.nth(1).fill('');
    await inputs.nth(0).fill('没有译文');
    await inputs.nth(0).blur();
    await page.waitForTimeout(300);
    await expect(inputs.nth(1)).toHaveValue('');
  });

  test('翻译接口：拼接译文片段，参数不对或查询失败时返回 null（不访问外网）', async () => {
    expect(parseGoogle([[['Great ', '长', null], ['Wall', '城', null]], null, 'zh-CN'])).toBe('Great Wall');
    expect(parseGoogle({})).toBeNull();
    const urls = [];
    const fetchImpl = async (url) => { urls.push(url); return { ok: true, json: async () => [[['Great Wall', '长城']]] }; };
    expect(await translateText('长城', 'zh-CN', 'en', { fetchImpl })).toBe('Great Wall');
    const q = new URL(urls[0]).searchParams;
    expect([q.get('sl'), q.get('tl'), q.get('q')]).toEqual(['zh-CN', 'en', '长城']);
    expect(await translateText('长城', 'zh-CN', 'en', { fetchImpl: async () => { throw new Error('offline'); } })).toBeNull();
    expect(await translateText('长城', 'zh-CN', 'en', { fetchImpl: async () => ({ ok: false }) })).toBeNull();
    expect(await translateText('', 'zh-CN', 'en', { fetchImpl })).toBeNull();
    expect(await translateText('长城', 'zh-CN', '../x', { fetchImpl })).toBeNull();
    expect(urls).toHaveLength(1);
  });

  test('本地服务器提供翻译接口（只读模式也提供）', async ({ request }) => {
    const res = await request.get('/api/translate?text=x&from=zh-CN&to=bad%20lang');
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ text: null });
  });
});
