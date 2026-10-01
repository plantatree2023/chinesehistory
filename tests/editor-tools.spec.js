// 编辑页的辅助功能（调试模式；建议模式中不提供）：
// - 点击图片缩略图放大，左右切换；查看器中可“设为代表图”“从本事件移除”（只改草稿，保存后生效）；
// - 参考链接每行有 ↗ 打开按钮；粘贴维基百科 / 百度百科链接后自动填写“维基百科 - 词条名”（先按链接，再由本地服务器查询）；
// - “图片”标题行右侧的搜图按钮，▾ 选择搜索网站并记住选择。
const { test, expect, openApp, loadDataset, STORAGE_KEY } = require('./helpers');
const { createServer } = require('../server');
const { parseLink, lookupLinkTitle, titleFromWikipediaApi, titleFromBaiduHtml } = require('../lib/link-title');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
test.use({ viewport: { width: 1280, height: 900 } });

async function openEditorOf(page, title) {
  await openApp(page);
  await page.click('#browseBtn');
  await page.fill('#searchInput', title);
  await page.locator('.list-row').first().click();
  await page.click('.list-actions .btn-primary');
  await expect(page.locator('#editModal')).toBeVisible();
  // 等弹出动画结束再量位置
  await page.locator('#editForm').evaluate((f) => Promise.all(f.getAnimations({ subtree: true }).map((a) => a.finished)));
}
const lbCaption = (page) => page.locator('#lightboxCaption');
const thumbs = (page) => page.locator('#imageEditor .img-slot img.slot-zoom');

test.describe('编辑页', () => {
  test.use({ debugMode: true });

  test.describe('图片查看器', () => {
    test('点击缩略图放大，左右切换，显示编辑中的标题', async ({ page }) => {
      const { events } = await loadDataset(page);
      const ev = events.find((e) => e.title === '安史之乱');
      await openEditorOf(page, '安史之乱');
      // 先改一下第二张的标题：查看器显示编辑中的内容
      await page.locator('#imageEditor .slot-caption').nth(1).fill('改过的标题');
      await thumbs(page).nth(1).click();
      await expect(page.locator('#lightbox')).toBeVisible();
      await expect(lbCaption(page)).toHaveText(`改过的标题  (2/${ev.images.length})`);
      await expect(page.locator('#lbActions')).toBeVisible();
      await page.click('#lightbox .lb-next');
      await expect(lbCaption(page)).toContainText(`(3/${ev.images.length})`);
      await page.keyboard.press('ArrowLeft');
      await expect(lbCaption(page)).toContainText(`(2/${ev.images.length})`);
      // Esc 只关闭查看器，编辑页仍在
      await page.keyboard.press('Escape');
      await expect(page.locator('#lightbox')).toBeHidden();
      await expect(page.locator('#editModal')).toBeVisible();
    });

    test('设为代表图：移到第一张，仍显示这张，按钮变为“已是代表图”；缩略图随之更新', async ({ page }) => {
      const { events } = await loadDataset(page);
      const ev = events.find((e) => e.title === '安史之乱');
      const n = ev.images.length;
      await openEditorOf(page, '安史之乱');
      await thumbs(page).nth(2).click();
      await expect(page.locator('#lbCover')).toHaveText('★ 设为代表图');
      await expect(page.locator('#lbCover')).toBeEnabled();
      await page.click('#lbCover');
      await expect(lbCaption(page)).toContainText(`(1/${n})`);
      await expect(page.locator('#lightboxImg')).toHaveAttribute('src', ev.images[2].src);
      await expect(page.locator('#lbCover')).toHaveText('★ 已是代表图');
      await expect(page.locator('#lbCover')).toBeDisabled();
      // 编辑页缩略图：第一张是原来的第三张，带“代表图”标记
      await expect(thumbs(page).first()).toHaveAttribute('src', ev.images[2].src);
      await expect(page.locator('#imageEditor .img-slot').first().locator('.badge')).toHaveText('代表图');
      // 切到下一张：可以再设为代表图
      await page.click('#lightbox .lb-next');
      await expect(page.locator('#lbCover')).toBeEnabled();
    });

    test('从本事件移除：显示下一张；移除最后一张时显示上一张；全部移除后关闭查看器', async ({ page }) => {
      const { events } = await loadDataset(page);
      const ev = events.find((e) => e.title === '安史之乱');
      const n = ev.images.length;
      expect(n).toBeGreaterThanOrEqual(3);
      await openEditorOf(page, '安史之乱');
      await thumbs(page).nth(1).click();
      await page.click('#lbRemove');
      // 原第三张变为第二张，显示它
      await expect(page.locator('#lightboxImg')).toHaveAttribute('src', ev.images[2].src);
      await expect(lbCaption(page)).toContainText(`(2/${n - 1})`);
      await expect(thumbs(page)).toHaveCount(n - 1);
      // 跳到最后一张再移除：显示上一张
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');   // 1 → 最后一张
      await expect(lbCaption(page)).toContainText(`(${n - 1}/${n - 1})`);
      await page.click('#lbRemove');
      await expect(lbCaption(page)).toContainText(`(${n - 2}/${n - 2})`);
      for (let k = n - 2; k > 0; k--) await page.click('#lbRemove');
      await expect(page.locator('#lightbox')).toBeHidden();
      await expect(thumbs(page)).toHaveCount(0);
      await expect(page.locator('#editModal')).toBeVisible();
    });

    test('只改草稿：取消后不生效；保存后才写入', async ({ page }) => {
      const { events } = await loadDataset(page);
      const ev = events.find((e) => e.title === '安史之乱');
      await openEditorOf(page, '安史之乱');
      await thumbs(page).nth(1).click();
      await page.click('#lbRemove');
      await page.keyboard.press('Escape');          // 关闭查看器
      expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBeNull();
      await page.click('#editForm .detail-actions [data-close]');   // 取消
      await expect(page.locator('#editModal')).toBeHidden();
      await page.click('.list-actions .btn-primary');
      await expect(thumbs(page)).toHaveCount(ev.images.length);
      // 这次设为代表图后保存
      await thumbs(page).nth(1).click();
      await page.click('#lbCover');
      await page.keyboard.press('Escape');
      await page.click('#editForm button[type=submit]');
      await expect(page.locator('#editModal')).toBeHidden();
      const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
      expect(stored.changed[ev.id].images[0].src).toBe(ev.images[1].src);
    });

    test('从详情页打开的查看器没有这两个按钮', async ({ page }) => {
      await openEditorOf(page, '安史之乱');
      await page.keyboard.press('Escape');            // 关闭编辑页，回到侧栏
      await page.click('.list-actions .btn-ghost');   // 查看详情
      await page.locator('#detailGallery img').first().click();
      await expect(page.locator('#lightbox')).toBeVisible();
      await expect(page.locator('#lbActions')).toBeHidden();
    });
  });

  test.describe('参考链接', () => {
    test('每行有 ↗ 打开按钮（新标签页）；网址无效时不可点', async ({ page }) => {
      const { events } = await loadDataset(page);
      const ev = events.find((e) => e.title === '安史之乱');
      await openEditorOf(page, '安史之乱');
      const first = page.locator('#sourceEditor .source-row').first().locator('.source-open');
      await expect(first).toHaveAttribute('href', ev.sources[0].url);
      await expect(first).toHaveAttribute('target', '_blank');
      await expect(first).toHaveAttribute('rel', /noopener/);
      await page.click('#sourceAdd');
      const row = page.locator('#sourceEditor .source-row').last();
      await expect(row.locator('.source-open')).toHaveAttribute('aria-disabled', 'true');
      await expect(row.locator('.source-open')).not.toHaveAttribute('href', /.+/);
      await row.locator('.source-url').fill('https://example.org/a');
      await expect(row.locator('.source-open')).toHaveAttribute('href', 'https://example.org/a');
      await expect(row.locator('.source-open')).not.toHaveAttribute('aria-disabled', 'true');
    });

    test('粘贴维基百科链接：先按链接填写词条名，再用本地服务器查询结果更新（简体、跟随重定向）', async ({ page }) => {
      const asked = [];
      let release;
      const gate = new Promise((r) => { release = r; });
      await page.route('**/api/link-title?**', async (route) => {
        asked.push(new URL(route.request().url()).searchParams.get('url'));
        await gate;
        route.fulfill({ json: { title: '维基百科 - 安史之乱' } });
      });
      await openEditorOf(page, '安史之乱');
      await page.click('#sourceAdd');
      const row = page.locator('#sourceEditor .source-row').last();
      const link = 'https://zh.wikipedia.org/wiki/%E5%AE%89%E5%8F%B2%E4%B9%8B%E4%BA%82';   // 安史之亂
      await row.locator('.source-url').fill(link);
      await row.locator('.source-url').dispatchEvent('change');
      await expect(row.locator('.source-title')).toHaveValue('维基百科 - 安史之亂');
      await expect(row.locator('.source-hint')).toHaveText('⟳ 正在查询词条名…');
      release();
      await expect(row.locator('.source-title')).toHaveValue('维基百科 - 安史之乱');
      await expect(row.locator('.source-hint')).toHaveText('✓ 已自动填写标题（可修改）');
      expect(asked).toEqual([link]);
      // 保存时不带内部状态
      await page.click('#editForm button[type=submit]');
      await expect(page.locator('#editModal')).toBeHidden();
      const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
      const saved = Object.values(stored.changed)[0].sources;
      expect(saved[saved.length - 1]).toEqual({ url: link, title: '维基百科 - 安史之乱' });
    });

    test('百度百科：粘贴（paste 事件）后自动填写；查询失败时保留按链接填写的标题', async ({ page }) => {
      await page.route('**/api/link-title?**', (route) => route.fulfill({ json: { title: null } }));
      await openEditorOf(page, '安史之乱');
      await page.click('#sourceAdd');
      const row = page.locator('#sourceEditor .source-row').last();
      const input = row.locator('.source-url');
      await input.focus();
      await page.evaluate(() => {
        const el = document.activeElement;
        el.value = 'https://baike.baidu.com/item/%E5%AE%89%E5%8F%B2%E4%B9%8B%E4%B9%B1/3221';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('paste', { bubbles: true }));
      });
      await expect(row.locator('.source-title')).toHaveValue('百度百科 - 安史之乱');
      await expect(row.locator('.source-hint')).toHaveText('✓ 已自动填写标题（可修改）');
    });

    test('不覆盖手动输入的标题；手动修改后不再自动更新；其他网站的链接不查询', async ({ page }) => {
      const asked = [];
      await page.route('**/api/link-title?**', (route) => { asked.push(route.request().url()); route.fulfill({ json: { title: '维基百科 - 查询结果' } }); });
      await openEditorOf(page, '安史之乱');
      await page.click('#sourceAdd');
      const row = page.locator('#sourceEditor .source-row').last();
      await row.locator('.source-title').fill('我自己的标题');
      await row.locator('.source-url').fill('https://zh.wikipedia.org/wiki/唐朝');
      await row.locator('.source-url').dispatchEvent('change');
      await page.waitForTimeout(200);
      await expect(row.locator('.source-title')).toHaveValue('我自己的标题');
      expect(asked).toEqual([]);
      // 其他网站
      await page.click('#sourceAdd');
      const row2 = page.locator('#sourceEditor .source-row').last();
      await row2.locator('.source-url').fill('https://example.org/x');
      await row2.locator('.source-url').dispatchEvent('change');
      await page.waitForTimeout(200);
      await expect(row2.locator('.source-title')).toHaveValue('');
      expect(asked).toEqual([]);
    });
  });

  test.describe('搜图按钮', () => {
    test('在“图片”标题行最右侧；用事件名称搜索；▾ 选择网站并记住；菜单只有网站名', async ({ page }) => {
      await openEditorOf(page, '安史之乱');
      const text = await page.locator('.img-field-head > span').boundingBox();
      const field = await page.locator('.img-field-head').locator('xpath=..').boundingBox();
      const search = await page.locator('#imgSearch').boundingBox();
      expect(Math.abs(search.x + search.width - (field.x + field.width))).toBeLessThanOrEqual(2);   // 紧贴右边界（允许亚像素误差）
      expect(Math.abs((search.y + search.height / 2) - (text.y + text.height / 2))).toBeLessThanOrEqual(3);   // 与文字同一行
      expect(search.x).toBeGreaterThan(text.x + text.width);
      const main = page.locator('#imgSearchMain');
      await expect(main).toContainText('Google 搜图');
      await expect(main).toHaveAttribute('href', 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent('安史之乱'));
      await expect(main).toHaveAttribute('target', '_blank');
      // 跟随事件名称
      await page.fill('#editForm [name=title]', '安史之乱 唐朝');
      await expect(main).toHaveAttribute('href', /q=%E5%AE%89%E5%8F%B2%E4%B9%8B%E4%B9%B1%20%E5%94%90%E6%9C%9D$/);
      // 菜单
      await page.click('#imgSearchMore');
      const items = page.locator('#imgSearchMenu .img-search-item');
      await expect(items).toHaveText(['Google 图片', 'Bing 图片', '百度图片', 'Google · 维基共享资源']);
      await expect(page.locator('#imgSearchMenu .img-search-item.on')).toHaveText('Google 图片');
      // 选择百度：打开新标签页、记住选择、主按钮改为百度
      // 新标签页请求的地址（测试中外部网站被拦截，只检查请求的网址）
      const opened = page.context().waitForEvent('request', (r) => r.url().startsWith('https://image.baidu.com/'));
      await items.nth(2).click();
      expect((await opened).url()).toContain('word=' + encodeURIComponent('安史之乱 唐朝'));
      await expect(page.locator('#imgSearchMenu')).toBeHidden();
      await expect(main).toContainText('百度搜图');
      await expect(main).toHaveAttribute('href', /^https:\/\/image\.baidu\.com\/search\/index\?tn=baiduimage&word=/);
      expect(await page.evaluate(() => localStorage.getItem('zh-history-timeline:imageSearch'))).toBe('baidu');
      // 维基共享资源
      await page.click('#imgSearchMore');
      await expect(page.locator('#imgSearchMenu .img-search-item').nth(3)).toHaveAttribute('href', /site%3Acommons\.wikimedia\.org/);
      // Esc 只关闭菜单
      await page.keyboard.press('Escape');
      await expect(page.locator('#imgSearchMenu')).toBeHidden();
      await expect(page.locator('#editModal')).toBeVisible();
      // 重新打开编辑页仍是百度
      await page.keyboard.press('Escape');
      await page.click('.list-actions .btn-primary');
      await expect(main).toContainText('百度搜图');
    });

    test('事件名称为空时不打开搜索，提示先填写', async ({ page }) => {
      await openApp(page);
      await page.click('#addBtn');
      await expect(page.locator('#imgSearchMain')).toHaveAttribute('aria-disabled', 'true');
      await page.click('#imgSearchMain');
      await expect(page.locator('#toast')).toHaveText('请先填写事件名称');
    });
  });
});

test.describe('建议模式不提供这些功能', () => {
  test('没有搜图、图片编辑；参考链接没有 ↗，粘贴链接不自动查询', async ({ page }) => {
    const asked = [];
    await page.route('**/js/config.js', (route) => route.fulfill({ contentType: 'application/javascript', body: "window.TIMELINE_CONFIG = { feedback: { endpoint: 'https://api.web3forms.com/submit', accessKey: 'k' } };" }));
    await page.route('**/api/link-title?**', (route) => { asked.push(1); route.fulfill({ json: { title: 'x' } }); });
    await openApp(page);
    await page.click('#browseBtn');
    await page.fill('#searchInput', '安史之乱');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-ghost');
    await page.click('#detailFeedback');
    await page.click('#feedbackSuggestEdit');
    await expect(page.locator('#imgSearch')).toBeHidden();
    await expect(page.locator('#imageEditor')).toBeHidden();
    await expect(page.locator('#sourceEditor .source-open').first()).toBeHidden();
    await page.click('#sourceAdd');
    const row = page.locator('#sourceEditor .source-row').last();
    await row.locator('.source-url').fill('https://zh.wikipedia.org/wiki/唐朝');
    await row.locator('.source-url').dispatchEvent('change');
    await page.waitForTimeout(200);
    await expect(row.locator('.source-title')).toHaveValue('');
    expect(asked).toEqual([]);
  });
});

test.describe('词条名查询（lib/link-title.js 与 /api/link-title）', () => {
  test('按链接识别网站和词条名', () => {
    expect(parseLink('https://zh.wikipedia.org/wiki/%E5%AE%89%E5%8F%B2%E4%B9%8B%E4%BA%82')).toMatchObject({ site: 'wikipedia', label: '维基百科', lang: 'zh', name: '安史之亂' });
    expect(parseLink('https://zh.m.wikipedia.org/zh-cn/唐朝')).toMatchObject({ site: 'wikipedia', lang: 'zh', name: '唐朝' });
    expect(parseLink('https://en.wikipedia.org/wiki/An_Lushan_rebellion')).toMatchObject({ lang: 'en', name: 'An Lushan rebellion' });
    expect(parseLink('https://baike.baidu.com/item/%E5%B1%B1%E9%A1%B6%E6%B4%9E%E4%BA%BA/1219?fr=aladdin')).toMatchObject({ site: 'baidu', label: '百度百科', name: '山顶洞人' });
    expect(parseLink('https://baike.baidu.com/view/12345.htm')).toMatchObject({ site: 'baidu', name: null });
    expect(parseLink('https://example.org/wiki/x')).toBeNull();
    expect(parseLink('not a url')).toBeNull();
  });

  test('维基百科：取 API 返回的简体标题；百度百科：取网页标题；被拦截、找不到、出错时为 null', async () => {
    expect(titleFromWikipediaApi({ query: { pages: { 1: { title: '安史之亂', varianttitles: { 'zh-cn': '安史之乱' } } } } })).toBe('安史之乱');
    expect(titleFromWikipediaApi({ query: { pages: { '-1': { title: 'X', missing: '' } } } })).toBeNull();
    expect(titleFromBaiduHtml('<html><head><title>山顶洞人_百度百科</title>')).toBe('山顶洞人');
    expect(titleFromBaiduHtml('<title>百度安全验证</title>')).toBeNull();

    const calls = [];
    const fake = (body, ok = true) => async (url) => { calls.push(url); return { ok, json: async () => body, text: async () => body }; };
    expect(await lookupLinkTitle('https://zh.wikipedia.org/wiki/安史之亂', { fetchImpl: fake({ query: { pages: { 1: { title: '安史之乱', varianttitles: { 'zh-cn': '安史之乱' } } } } }) })).toBe('维基百科 - 安史之乱');
    expect(calls[0]).toMatch(/^https:\/\/zh\.wikipedia\.org\/w\/api\.php\?.*redirects=1.*titles=%E5%AE%89/);
    expect(await lookupLinkTitle('https://baike.baidu.com/item/山顶洞人/1219', { fetchImpl: fake('<title>山顶洞人_百度百科</title>') })).toBe('百度百科 - 山顶洞人');
    expect(await lookupLinkTitle('https://baike.baidu.com/item/x', { fetchImpl: fake('<title>百度安全验证</title>') })).toBeNull();
    expect(await lookupLinkTitle('https://zh.wikipedia.org/wiki/x', { fetchImpl: fake({}, false) })).toBeNull();
    expect(await lookupLinkTitle('https://zh.wikipedia.org/wiki/x', { fetchImpl: async () => { throw new Error('offline'); } })).toBeNull();
    const before = calls.length;
    expect(await lookupLinkTitle('https://example.org/x', { fetchImpl: fake('') })).toBeNull();
    expect(calls.length, '其他网站不联网').toBe(before);
  });

  test('本地服务器 /api/link-title：只读模式也提供，拒绝跨站请求', async ({ request }) => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ query: { pages: { 1: { title: '唐朝' } } } }) });
    const server = createServer({ root: ROOT, readonly: true, linkTitleOptions: { fetchImpl } });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const res = await request.get(`${base}/api/link-title?url=${encodeURIComponent('https://zh.wikipedia.org/wiki/唐朝')}`);
      expect(await res.json()).toEqual({ title: '维基百科 - 唐朝' });
      const bad = await request.get(`${base}/api/link-title?url=x`, { headers: { Origin: 'https://evil.example' } });
      expect(bad.status()).toBe(403);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
