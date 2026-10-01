// 核心功能：时间轴浏览、事件详情、编辑 / 新增 / 删除、侧栏、数据持久化。
const fs = require('fs');
const http = require('http');
const path = require('path');
const { test, expect, makePng, openApp, loadDataset, trackOffset, waitForStableLayout, DEFAULT_EVENT_COUNT, STORAGE_KEY } = require('./helpers');

test.use({ viewport: { width: 1440, height: 860 } });

// 找一张完整显示在屏幕内的卡片
async function visibleCard(page) {
  const cards = page.locator('.card');
  const vw = page.viewportSize().width;
  for (let i = 0; i < await cards.count(); i++) {
    const box = await cards.nth(i).boundingBox();
    if (box && box.x > 60 && box.x + box.width < vw - 60) return cards.nth(i);
  }
  throw new Error('屏幕内没有完整可见的卡片');
}

test.describe('时间轴浏览', () => {
  test('标题为“时间上的中国”', async ({ page }) => {
    await openApp(page);
    await expect(page).toHaveTitle('时间上的中国');
    await expect(page.locator('.topbar .brand-name')).toHaveText('时间上的中国');
  });

  test(`默认显示 ${DEFAULT_EVENT_COUNT} 个按时间排序的事件`, async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT);
    const years = (await loadDataset(page)).events.map((e) => e.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  test('拖动可平移时间轴，且拖动不会误打开详情', async ({ page }) => {
    await openApp(page);
    const before = await trackOffset(page);
    await page.mouse.move(1000, 300);
    await page.mouse.down();
    await page.mouse.move(400, 300, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => trackOffset(page)).toBeLessThan(before - 300);
    await expect(page.locator('#detailModal')).toBeHidden();
  });

  test('左右翻页按钮为圆形，箭头居中，点击可前后翻页', async ({ page }) => {
    await openApp(page);
    for (const id of ['#navLeft', '#navRight']) {
      const btn = page.locator(id);
      const box = await btn.boundingBox();
      expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(0.5);
      expect(await btn.evaluate((b) => getComputedStyle(b).borderRadius)).toBe('50%');
      const icon = await btn.locator('svg').boundingBox();
      expect(Math.abs(icon.x + icon.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs(icon.y + icon.height / 2 - (box.y + box.height / 2))).toBeLessThanOrEqual(1);
    }
    const start = await trackOffset(page);
    await page.click('#navRight');
    await expect.poll(() => trackOffset(page)).toBeLessThan(start - 500);
    const moved = await trackOffset(page);
    await page.click('#navLeft');
    await expect.poll(() => trackOffset(page)).toBeGreaterThan(moved + 500);
  });

  test('到达最左 / 最右时隐藏对应的翻页按钮', async ({ page }) => {
    await openApp(page);
    const left = page.locator('#navLeft'), right = page.locator('#navRight');
    // 开头：只显示向右
    await expect(left).toBeHidden();
    await expect(right).toBeVisible();
    await right.click();
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();
    // 末尾：只显示向左
    await page.locator('#stage').focus();
    await page.keyboard.press('End');
    await expect(right).toBeHidden();
    await expect(left).toBeVisible();
    await left.click();
    await expect(right).toBeVisible();
    // 回到开头后向左按钮再次隐藏
    await page.keyboard.press('Home');
    await expect(left).toBeHidden();
  });

  test('键盘 End / Home 跳到时间轴两端', async ({ page }) => {
    await openApp(page);
    await page.locator('#stage').focus();
    await page.keyboard.press('End');
    await expect.poll(() => trackOffset(page)).toBeLessThan(-1000);
    await page.keyboard.press('Home');
    await expect.poll(() => trackOffset(page)).toBe(0);
  });
});

test.describe('事件详情', () => {
  test.use({ debugMode: true });

  test('点击卡片打开详情，说明不超过 350 字', async ({ page }) => {
    await openApp(page);
    const card = await visibleCard(page);
    const title = await card.locator('.card-title').textContent();
    await card.click();
    await expect(page.locator('#detailModal')).toBeVisible();
    await expect(page.locator('#detailTitle')).toHaveText(title);
    const text = await page.locator('#detailText').textContent();
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(350);
    await expect(page.locator('#detailEdit')).toBeVisible();
    await expect(page.locator('#detailDelete')).toBeVisible();
  });

  test('在详情中编辑，修改后刷新页面仍然保留', async ({ page }) => {
    await openApp(page);
    await (await visibleCard(page)).click();
    await page.click('#detailEdit');
    await expect(page.locator('#editModal')).toBeVisible();
    await page.fill('#editForm [name=title]', '测试编辑标题');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('.card-title', { hasText: '测试编辑标题' })).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.card-title', { hasText: '测试编辑标题' })).toHaveCount(1);
  });

  test('在编辑页修改图片标题，图片查看器中显示，刷新后保留', async ({ page }) => {
    await openApp(page);
    await page.click('#browseBtn');
    await page.fill('#searchInput', '安史之乱');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-primary');
    const captions = page.locator('#imageEditor .slot-caption');
    expect(await captions.count()).toBeGreaterThan(1);
    await captions.nth(1).fill('  新的图片标题  ');
    await captions.nth(0).fill('');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();

    const check = async () => {
      await page.click('.list-actions .btn-ghost');
      await page.locator('#detailGallery img').first().click();
      // 首尾空格在保存时去掉；后面是查看器的序号
      await expect(page.locator('#lightboxCaption')).toHaveText(/^新的图片标题 {2}\(2\/\d+\)$/);
      await page.locator('#lightbox').click({ position: { x: 5, y: 5 } });
      await expect(page.locator('#lightbox')).toBeHidden();
    };
    await check();
    // 打开不带参数的首页（直接刷新会按网址恢复侧栏和详情，这里要验证的是数据在新的访问中仍然保留）
    await page.goto('/');
    await expect(page.locator('.card').first()).toBeVisible();
    await page.click('#browseBtn');
    await page.fill('#searchInput', '安史之乱');
    await page.locator('.list-row').first().click();
    await check();
    // 编辑页中显示保存后的标题
    await page.keyboard.press('Escape');
    await page.click('.list-actions .btn-primary');
    await expect(captions.nth(1)).toHaveValue('新的图片标题');
    await expect(captions.nth(0)).toHaveValue('');
  });

  test('详情显示类型、不显示重要程度（内部信息）；在编辑页修改后卡片大小等级随之变化', async ({ page }) => {
    const { events, types } = await loadDataset(page);
    const target = events.find((e) => e.title === '贞观之治');
    await openApp(page);
    await page.click('#browseBtn');
    await page.fill('#searchInput', '贞观之治');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-ghost');
    await expect(page.locator('#detailTags .type-tag')).toHaveText(target.type);
    // 重要程度是内部信息：详情中不显示（只在编辑页中可见）
    await expect(page.locator('#detailModal')).not.toContainText('重要程度');
    await expect(page.locator('#detailModal')).not.toContainText(`${target.majorScore} / 10`);
    await expect(page.locator(`.card[data-id="${target.id}"]`)).toHaveClass(/tier-3/);

    await page.click('#detailEdit');
    // 类型选项来自数据集的 types，另有“未分类”
    await expect(page.locator('#editForm [name=type] option')).toHaveText(['未分类', ...types.map((t) => t.name)]);
    await expect(page.locator('#editForm [name=type]')).toHaveValue(target.type);
    await expect(page.locator('#editForm [name=majorScore]')).toHaveValue(String(target.majorScore));
    await page.selectOption('#editForm [name=type]', '文化');
    await page.selectOption('#editForm [name=majorScore]', '6');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator(`.card[data-id="${target.id}"]`)).toHaveClass(/tier-2/);
    await expect(page.locator(`.card[data-id="${target.id}"]`)).not.toHaveClass(/major/);
    if (await page.locator('.list-actions').isHidden()) await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-ghost');
    await expect(page.locator('#detailTags')).toHaveText('文化');

    // 清除类型、降为 3 分，刷新后保留
    await page.click('#detailEdit');
    await page.selectOption('#editForm [name=type]', '');
    await page.selectOption('#editForm [name=majorScore]', '3');
    await page.click('#editForm button[type=submit]');
    await page.reload();
    await expect(page.locator(`.card[data-id="${target.id}"]`)).toHaveClass(/tier-1/);
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
    expect(stored.changed[target.id]).toEqual({ type: null, majorScore: 3 });
  });

  test('新增事件默认重要程度 5（小图）、未分类', async ({ page }) => {
    await openApp(page);
    await page.click('#addBtn');
    await expect(page.locator('#editForm [name=majorScore]')).toHaveValue('5');
    await expect(page.locator('#editForm [name=type]')).toHaveValue('');
  });

  test('点保存后立即离开页面（不等保存动画）修改也不会丢失', async ({ page }) => {
    const { events } = await loadDataset(page);
    const target = events.find((e) => e.title === '安史之乱');
    await openApp(page);
    await page.click('#browseBtn');
    await page.fill('#searchInput', '安史之乱');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-primary');
    await page.fill('#editForm [name=short]', '立即离开页面测试：这段简要说明在保存后马上刷新也应该保留下来。');
    // 让页面的下一帧迟迟不到（模拟设备繁忙），点保存后马上打开新页面
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    await page.click('#editForm button[type=submit]');
    await page.goto('/');
    await expect(page.locator('.card').first()).toBeVisible();
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
    expect(stored.changed[target.id].short).toBe('立即离开页面测试：这段简要说明在保存后马上刷新也应该保留下来。');
    await expect(page.locator(`.card[data-id="${target.id}"]`)).toContainText('立即离开页面测试');
  });

  test('参考链接：可添加多条、修改、删除，详情中逐条显示，刷新后保留', async ({ page }) => {
    const { events } = await loadDataset(page);
    const target = events.find((e) => e.title === '安史之乱');
    const wiki = target.sources[0].url;
    await openApp(page);
    await page.click('#browseBtn');
    await page.fill('#searchInput', '安史之乱');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-primary');

    const rows = page.locator('#sourceEditor .source-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator('.source-url')).toHaveValue(wiki);
    // 添加两条：一条带标题，一条不带
    await page.click('#sourceAdd');
    await expect(rows.nth(1).locator('.source-url')).toBeFocused();
    await rows.nth(1).locator('.source-url').fill(' https://example.org/anshi ');
    await rows.nth(1).locator('.source-title').fill(' 《旧唐书·安禄山传》 ');
    await page.click('#sourceAdd');
    await rows.nth(2).locator('.source-url').fill('https://example.com/b');
    // 空行不保存
    await page.click('#sourceAdd');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();

    const openDetailFromList = async () => {
      if (await page.locator('.list-actions').isHidden()) await page.locator('.list-row').first().click();
      await page.click('.list-actions .btn-ghost');
    };
    await openDetailFromList();
    const links = page.locator('#detailSource .source-list a');
    await expect(links).toHaveText(['维基百科', '《旧唐书·安禄山传》', 'https://example.com/b']);
    await expect(links.nth(1)).toHaveAttribute('href', 'https://example.org/anshi');
    await expect(links.nth(1)).toHaveAttribute('target', '_blank');
    await expect(page.locator('#detailSource')).toContainText('CC BY-SA');

    // 修改第二条、删除第一条（维基百科）
    await page.click('#detailEdit');
    await expect(rows).toHaveCount(3);
    await rows.nth(1).locator('.source-title').fill('旧唐书');
    await rows.nth(0).locator('.source-remove').click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.source-title')).toHaveValue('旧唐书');
    await page.click('#editForm button[type=submit]');
    // 打开不带参数的首页（直接刷新会按网址恢复侧栏和详情，这里要验证的是数据在新的访问中仍然保留）
    await page.goto('/');
    await expect(page.locator('.card').first()).toBeVisible();
    await page.click('#browseBtn');
    await page.fill('#searchInput', '安史之乱');
    await openDetailFromList();
    await expect(links).toHaveText(['旧唐书', 'https://example.com/b']);
    await expect(page.locator('#detailSource'), '没有维基百科链接时不显示许可说明').not.toContainText('CC BY-SA');
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORAGE_KEY);
    expect(stored.changed[target.id].sources).toEqual([{ url: 'https://example.org/anshi', title: '旧唐书' }, { url: 'https://example.com/b' }]);
  });

  test('参考链接网址无效时拒绝保存；最多 10 条', async ({ page }) => {
    await openApp(page);
    await page.click('#addBtn');
    await page.fill('#editForm [name=title]', '链接测试事件');
    await page.fill('#editForm [name=short]', '用于测试参考链接校验的说明文字，长度超过二十个字。');
    await page.click('#sourceAdd');
    await page.locator('#sourceEditor .source-url').fill('ftp://example.org/x');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#formError')).toContainText('参考链接必须以 http:// 或 https:// 开头');
    await expect(page.locator('#editModal')).toBeVisible();
    // 只填标题、没有网址也不行
    await page.locator('#sourceEditor .source-url').fill('');
    await page.locator('#sourceEditor .source-title').fill('只有标题');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#formError')).toContainText('只有标题');
    for (let i = 1; i < 10; i++) await page.click('#sourceAdd');
    await expect(page.locator('#sourceEditor .source-row')).toHaveCount(10);
    await expect(page.locator('#sourceAdd')).toBeDisabled();
  });

  test('点击保存后立即显示“保存中”，完成后显示“已保存”再关闭编辑页', async ({ page }) => {
    await openApp(page);
    await (await visibleCard(page)).click();
    await page.click('#detailEdit');
    await page.fill('#editForm [name=title]', '保存动画测试');
    // 点击后的第一帧：按钮已显示转圈和“保存中…”，而时间轴还没有开始重新排版（排版要花几百毫秒）
    const first = await page.evaluate(() => new Promise((resolve) => {
      const renders = document.getElementById('track').dataset.renders;
      // 记录按钮文字的每一次变化，以及编辑页关闭时按钮显示的文字
      const label = document.querySelector('#saveBtn .btn-label');
      window.__labels = [];
      new MutationObserver(() => window.__labels.push(label.textContent)).observe(label, { childList: true, characterData: true, subtree: true });
      new MutationObserver(() => {
        if (document.getElementById('editModal').hidden && !window.__closedWith) window.__closedWith = window.__labels.slice();
      }).observe(document.getElementById('editModal'), { attributes: true, attributeFilter: ['hidden'] });
      document.getElementById('saveBtn').click();
      requestAnimationFrame(() => {
        const btn = document.getElementById('saveBtn');
        resolve({
          label: btn.querySelector('.btn-label').textContent,
          spinner: getComputedStyle(btn.querySelector('.btn-spinner')).display !== 'none',
          disabled: btn.disabled,
          busy: document.getElementById('editForm').getAttribute('aria-busy'),
          relayoutStarted: document.getElementById('track').dataset.renders !== renders,
        });
      });
    }));
    expect(first).toEqual({ label: '保存中…', spinner: true, disabled: true, busy: 'true', relayoutStarted: false });
    await expect(page.locator('#editModal')).toBeHidden();
    // 顺序：保存中… → ✓ 已保存 → （关闭编辑页时恢复）保存
    expect(await page.evaluate(() => window.__closedWith)).toEqual(['保存中…', '✓ 已保存', '保存']);
    await expect(page.locator('.toast')).toContainText('已保存修改');
    await expect(page.locator('.card-title', { hasText: '保存动画测试' })).toHaveCount(1);
    // 再次打开编辑页时按钮恢复正常
    await page.click('#detailEdit');
    await expect(page.locator('#saveBtn .btn-label')).toHaveText('保存');
    await expect(page.locator('#saveBtn')).toBeEnabled();
  });

  test('在详情中删除事件', async ({ page }) => {
    await openApp(page);
    await (await visibleCard(page)).click();
    await page.click('#detailDelete');
    await page.click('#confirmOk');
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT - 1);
  });
});

test.describe('新增事件', () => {
  test.use({ debugMode: true });

  test('填写表单后出现在时间轴上，并执行字数与图片数量上限', async ({ page }) => {
    await openApp(page);
    await page.click('#addBtn');
    await page.fill('#editForm [name=title]', '新增测试事件');
    await page.selectOption('#editForm [name=era]', 'bce');
    await page.fill('#editForm [name=yearAbs]', '500');
    await page.fill('#editForm [name=short]', '这是一段用于自动化测试的简要说明文字，长度超过二十个字。');
    await page.fill('#editForm [name=detail]', '详细'.repeat(200));
    expect((await page.inputValue('#editForm [name=detail]')).length).toBe(350);

    // 一次上传 10 张，只保留 9 张
    const dir = path.join(__dirname, '..', 'images');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).slice(0, 10).map((f) => path.join(dir, f));
    await page.setInputFiles('#imageFileInput', files);
    await expect(page.locator('#imageEditor .img-slot')).toHaveCount(9);
    await expect(page.locator('#formError')).toContainText('最多只能添加 9 张图片');
    await expect(page.locator('#imageFileInput')).toBeDisabled();

    await page.click('#editForm button[type=submit]');
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT + 1);
    await expect(page.locator('.card-title', { hasText: '新增测试事件' })).toHaveCount(1);
  });

  test('输入图片网址：浏览器下载后保存在本地，数据中没有外部网址', async ({ page }) => {
    // 模拟外部网站（端口不同即为跨站）：/cors.png 允许跨域下载，/no-cors.png 不允许
    const photo = makePng(80, 60, 120);
    const site = http.createServer((req, res) => {
      const cors = req.url === '/cors.png' ? { 'Access-Control-Allow-Origin': '*' } : {};
      res.writeHead(200, { 'Content-Type': 'image/png', ...cors });
      res.end(photo);
    });
    await new Promise((r) => site.listen(0, '127.0.0.1', r));
    const ext = `http://127.0.0.1:${site.address().port}`;
    try {
      await openApp(page);
      await page.click('#addBtn');
      await page.fill('#editForm [name=title]', '浏览器网址图片');
      await page.fill('#editForm [name=yearAbs]', '1500');
      await page.fill('#editForm [name=short]', '用于验证浏览器模式下输入图片网址会先下载到本地的说明。');

      await page.fill('#imageUrlInput', `${ext}/no-cors.png`);
      await page.click('#imageUrlAdd');
      await expect(page.locator('#formError')).toContainText('不允许直接下载图片');
      await expect(page.locator('#imageEditor .img-slot')).toHaveCount(0);

      await page.fill('#imageUrlInput', `ftp://127.0.0.1/a.png`);
      await page.click('#imageUrlAdd');
      await expect(page.locator('#formError')).toContainText('http:// 或 https://');

      await page.fill('#imageUrlInput', `${ext}/cors.png`);
      await page.click('#imageUrlAdd');
      await expect(page.locator('#imageEditor .img-slot')).toHaveCount(1);
      await expect(page.locator('#imageEditor .img-slot img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
      await page.click('#editForm button[type=submit]');
      await expect(page.locator('.card-title', { hasText: '浏览器网址图片' })).toHaveCount(1);

      const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
      const saved = Object.values(stored.changed).find((e) => e.title === '浏览器网址图片');
      expect(saved.images).toHaveLength(1);
      expect(saved.images[0]).toMatchObject({ src: expect.stringMatching(/^data:image\/jpeg;base64,/), w: 80, h: 60 });
    } finally {
      await new Promise((r) => site.close(r));
    }
  });

  test('缺少标题时拒绝保存', async ({ page }) => {
    await openApp(page);
    await page.click('#addBtn');
    await page.fill('#editForm [name=title]', '');
    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#formError')).toContainText('名称');
    await expect(page.locator('#editModal')).toBeVisible();
  });
});

test.describe('侧栏', () => {
  test.use({ debugMode: true });

  test('按时间顺序列出全部事件，可搜索', async ({ page }) => {
    await openApp(page);
    await page.click('#browseBtn');
    await expect(page.locator('.list-item')).toHaveCount(DEFAULT_EVENT_COUNT);
    await page.fill('#searchInput', '贞观');
    await expect(page.locator('.list-item')).toHaveCount(1);
    await expect(page.locator('.list-title')).toHaveText('贞观之治');
  });

  test('在侧栏中编辑和删除事件', async ({ page }) => {
    await openApp(page);
    await page.click('#browseBtn');
    await page.locator('.list-row').nth(5).click();
    await page.click('.list-actions .btn-primary');
    await expect(page.locator('#editModal')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.click('.list-actions .btn-danger');
    await page.click('#confirmOk');
    await expect(page.locator('.list-item')).toHaveCount(DEFAULT_EVENT_COUNT - 1);
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT - 1);
  });

  test('恢复默认数据会撤销所有修改', async ({ page }) => {
    await openApp(page);
    await page.click('#browseBtn');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-danger');
    await page.click('#confirmOk');
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT - 1);
    await page.click('#resetBtn');
    await page.click('#confirmOk');
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT);
  });
});

test.describe('数据集', () => {
  test('迁移旧版本保存在浏览器中的修改', async ({ page }) => {
    const { events } = await loadDataset(page);
    const legacy = events.slice(0, 10).map((e) => ({ ...e }));
    legacy[0].title = '旧版本保存的标题';
    await page.goto('/');
    await page.evaluate((v) => localStorage.setItem('zh-history-timeline:v1', v), JSON.stringify(legacy));
    await page.reload();
    await expect(page.locator('.card')).toHaveCount(10);
    await expect(page.locator('.card-title', { hasText: '旧版本保存的标题' })).toHaveCount(1);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys).toEqual([STORAGE_KEY]);
  });

  test('不存在的数据集显示错误提示', async ({ page }) => {
    await page.goto('/?data=jp_ja');
    await expect(page.locator('.load-error')).toContainText('data/jp_ja.json');
    await expect(page.locator('.card')).toHaveCount(0);
  });

  test('非法的数据集名称回退到默认数据集', async ({ page }) => {
    await page.goto('/?data=../server');
    await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT);
  });
});

test.describe('手机', () => {
  test.use({ viewport: { width: 390, height: 780 } });

  test('页面没有横向溢出', async ({ page }) => {
    await openApp(page);
    await waitForStableLayout(page);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});
