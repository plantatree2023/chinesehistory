// 反馈 / 建议修改：所有访问者可用（不需要调试模式），通过 Web3Forms 发送到维护者邮箱。
// 测试中替换 js/config.js 为测试用的 Access Key，并拦截发送请求（不会真的发出）。
const { test, expect, openApp, loadDataset } = require('./helpers');

test.use({ viewport: { width: 1440, height: 860 } });

const ENDPOINT = 'https://api.web3forms.com/submit';
const KEY = 'test-access-key';

// 启用反馈并记录发送的内容；fail 为 true 时模拟发送失败
async function enableFeedback(page, { fail = false } = {}) {
  const sent = [];
  await page.route('**/js/config.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.TIMELINE_CONFIG = { feedback: { endpoint: '${ENDPOINT}', accessKey: '${KEY}' } };`,
  }));
  await page.route(ENDPOINT, async (route) => {
    const req = route.request();
    sent.push({ method: req.method(), headers: req.headers(), body: JSON.parse(req.postData()) });
    if (fail) await route.fulfill({ status: 500, json: { success: false, message: '服务暂时不可用' } });
    else await route.fulfill({ json: { success: true, message: 'Email sent successfully!' } });
  });
  return sent;
}

async function openDetailOf(page, title) {
  await page.click('#browseBtn');
  await page.fill('#searchInput', title);
  await page.locator('.list-row').first().click();
  await page.click('.list-actions .btn-ghost');
  await expect(page.locator('#detailTitle')).toHaveText(title);
}

test('没有配置 Access Key 时不显示任何反馈入口', async ({ page }) => {
  await openApp(page);
  await openDetailOf(page, '安史之乱');
  await expect(page.locator('#detailFeedback')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#siteFeedback')).toBeHidden();
  // 仓库中的配置：Web3Forms 接口
  const cfg = await page.evaluate(() => window.TIMELINE_CONFIG.feedback);
  expect(cfg.endpoint).toBe(ENDPOINT);
});

test.describe('已配置', () => {
  test('详情页底部的“反馈 / 建议修改”所有访问者可见（不需要调试模式），自动带上事件', async ({ page }) => {
    const sent = await enableFeedback(page);
    const { events } = await loadDataset(page);
    const target = events.find((e) => e.title === '安史之乱');
    await openApp(page);
    await openDetailOf(page, '安史之乱');
    await expect(page.locator('#detailEdit')).toBeHidden();       // 不是调试模式
    await expect(page.locator('#detailFeedback')).toBeVisible();
    await page.click('#detailFeedback');
    await expect(page.locator('#feedbackModal')).toBeVisible();
    await expect(page.locator('#feedbackTarget')).toContainText('安史之乱');
    await expect(page.locator('#feedbackKinds .kind-option')).toHaveText(['事实错误', '错别字', '图片有问题', '链接失效', '其他']);
    await expect(page.locator('#feedbackProposeNew')).toBeHidden();

    // 必填检查
    await page.click('#feedbackSend');
    await expect(page.locator('#feedbackError')).toHaveText('请选择反馈类型');
    await page.locator('.kind-option', { hasText: '错别字' }).click();
    await page.click('#feedbackSend');
    await expect(page.locator('#feedbackError')).toHaveText('请填写说明');
    expect(sent).toHaveLength(0);

    await page.fill('#feedbackForm [name=message]', '第二段的“节度史”应为“节度使”。');
    await page.fill('#feedbackForm [name=contact]', 'reader@example.com');
    await page.click('#feedbackSend');
    await expect(page.locator('#feedbackModal')).toBeHidden();
    await expect(page.locator('#toast')).toHaveText('已发送，谢谢你的反馈！');
    await expect(page.locator('#detailModal'), '详情仍然打开').toBeVisible();
    expect(sent).toHaveLength(1);
    const { method, headers, body } = sent[0];
    expect(method).toBe('POST');
    expect(headers['content-type']).toContain('application/json');
    expect(body).toMatchObject({
      access_key: KEY,
      subject: '[时间上的中国] 事件反馈（错别字）：安史之乱',
      botcheck: '',
      '反馈类型': '错别字',
      '事件': '安史之乱',
      '事件 id': target.id,
      '说明': '第二段的“节度史”应为“节度使”。',
      '联系方式': 'reader@example.com',
      email: 'reader@example.com',   // 邮箱可以直接回复
      '数据集': 'cn_zh',
    });
    expect(body['页面']).toContain('id=');
  });

  test('图片有问题：选择第几张图，可建议图片网址（不开放上传）；联系方式不是邮箱时不作为回复地址', async ({ page }) => {
    const sent = await enableFeedback(page);
    const { events } = await loadDataset(page);
    const target = events.find((e) => e.title === '安史之乱');
    await openApp(page);
    await openDetailOf(page, '安史之乱');
    await page.click('#detailFeedback');
    await expect(page.locator('#feedbackImages')).toBeHidden();
    await page.locator('.kind-option', { hasText: '图片有问题' }).click();
    await expect(page.locator('#feedbackImages')).toBeVisible();
    await expect(page.locator('#feedbackModal input[type=file]')).toHaveCount(0);
    const options = await page.locator('#feedbackForm [name=image] option').allTextContents();
    expect(options).toHaveLength(target.images.length + 1);
    expect(options[2]).toMatch(/^第 2 张/);
    await page.selectOption('#feedbackForm [name=image]', '2');
    await page.fill('#feedbackForm [name=imageUrl]', 'ftp://bad');
    await page.fill('#feedbackForm [name=message]', '第二张图与事件无关。');
    await page.click('#feedbackSend');
    await expect(page.locator('#feedbackError')).toContainText('http');
    await page.fill('#feedbackForm [name=imageUrl]', 'https://example.org/better.jpg');
    await page.fill('#feedbackForm [name=contact]', '微信 abc123');
    await page.click('#feedbackSend');
    await expect(page.locator('#feedbackModal')).toBeHidden();
    const body = sent[0].body;
    expect(body['有问题的图片']).toBe(`第 2 张（${target.images[1].src}${target.images[1].caption ? '，' + target.images[1].caption : ''}）`);
    expect(body['建议的图片网址']).toBe('https://example.org/better.jpg');
    expect(body['联系方式']).toBe('微信 abc123');
    expect(body.email).toBeUndefined();
  });

  test('发送失败时提示原因，填写的内容保留，可以再次发送', async ({ page }) => {
    await enableFeedback(page, { fail: true });
    await openApp(page);
    await openDetailOf(page, '安史之乱');
    await page.click('#detailFeedback');
    await page.locator('.kind-option', { hasText: '其他' }).click();
    await page.fill('#feedbackForm [name=message]', '测试失败的情况');
    await page.click('#feedbackSend');
    await expect(page.locator('#feedbackError')).toContainText('发送失败：服务暂时不可用');
    await expect(page.locator('#feedbackModal')).toBeVisible();
    await expect(page.locator('#feedbackForm [name=message]')).toHaveValue('测试失败的情况');
    await expect(page.locator('#feedbackSend')).toBeEnabled();
  });

  test('直接建议修改：复用编辑页，预填当前内容；只发送改动的字段及改前改后、说明和联系方式', async ({ page }) => {
    const sent = await enableFeedback(page);
    const { events } = await loadDataset(page);
    const target = events.find((e) => e.title === '安史之乱');
    await openApp(page);
    await openDetailOf(page, '安史之乱');
    await page.click('#detailFeedback');
    await page.click('#feedbackSuggestEdit');
    await expect(page.locator('#feedbackModal')).toBeHidden();
    const f = page.locator('#editForm');
    await expect(page.locator('#editModal')).toBeVisible();
    await expect(page.locator('#editTitle')).toHaveText('建议修改：安史之乱');
    // 预填当前内容
    await expect(f.locator('[name=title]')).toHaveValue(target.title);
    await expect(f.locator('[name=yearAbs]')).toHaveValue(String(Math.abs(target.year)));
    await expect(f.locator('[name=short]')).toHaveValue(target.short);
    await expect(f.locator('[name=detail]')).toHaveValue(target.detail);
    await expect(f.locator('[name=type]')).toHaveValue(target.type);
    await expect(f.locator('#sourceEditor .source-row')).toHaveCount(target.sources.length);
    // 只供维护者的字段不显示；图片不能上传
    await expect(f.locator('[name=majorScore]')).toBeHidden();
    await expect(f.locator('[name=transitionFrom]')).toBeHidden();
    await expect(f.locator('#imageEditor')).toBeHidden();
    await expect(f.locator('#imageFileInput')).toBeHidden();
    await expect(f.locator('[name=suggestNote]')).toBeVisible();
    await expect(page.locator('#saveBtn')).toHaveText('提交建议');

    // 没改动不能提交
    await page.fill('#editForm [name=suggestNote]', '说明');
    await page.click('#saveBtn');
    await expect(page.locator('#formError')).toHaveText('还没有修改任何内容');
    // 修改简要说明、年份，添加参考链接；说明必填
    await f.locator('[name=short]').fill('唐朝由盛转衰的转折点，安禄山、史思明先后起兵，历时七年余。');
    await f.locator('[name=yearAbs]').fill('756');
    await page.click('#sourceAdd');
    await f.locator('#sourceEditor .source-row').last().locator('.source-url').fill('https://example.org/anshi');
    await page.fill('#editForm [name=suggestNote]', '');
    await page.click('#saveBtn');
    await expect(page.locator('#formError')).toHaveText('请填写修改说明');
    await page.fill('#editForm [name=suggestNote]', '据《资治通鉴》，起兵时间为 755 年末，这里只是测试。');
    await page.selectOption('#editForm [name=suggestImage]', '1');
    await page.fill('#editForm [name=suggestContact]', 'reader@example.com');
    await page.click('#saveBtn');
    await expect(page.locator('#editModal')).toBeHidden();
    await expect(page.locator('#toast')).toHaveText('建议已提交，谢谢！');
    expect(sent).toHaveLength(1);
    const body = sent[0].body;
    expect(body).toMatchObject({ subject: '[时间上的中国] 建议修改：安史之乱', '反馈类型': '建议修改', '事件 id': target.id, '说明': '据《资治通鉴》，起兵时间为 755 年末，这里只是测试。', email: 'reader@example.com' });
    const changes = JSON.parse(body['修改内容（JSON）']);
    expect(changes.map((c) => c.field)).toEqual(['year', 'short', 'sources']);
    expect(changes[0]).toEqual({ field: 'year', label: '年份', before: '公元755年', after: '公元756年' });
    expect(changes[1].before).toBe(target.short);
    expect(changes[2].after).toContain('https://example.org/anshi');
    expect(body['修改内容']).toContain('【简要说明】\n改前：' + target.short);
    expect(body['有问题的图片']).toMatch(/^第 1 张/);
    // 网站中的数据没有改变
    await expect(page.locator('#detailText')).toContainText(target.detail.slice(0, 10));
    await expect(page.locator(`.card[data-id="${target.id}"]`)).toContainText(target.short.slice(0, 8));
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('zh-history-timeline:v1')))).toEqual([]);
  });

  test('侧栏底部：整站反馈和建议新增事件（不针对具体事件）', async ({ page }) => {
    const sent = await enableFeedback(page);
    await openApp(page);
    await page.click('#browseBtn');
    await expect(page.locator('#siteFeedback')).toBeVisible();
    await page.click('#siteFeedback');
    await expect(page.locator('#feedbackTitle')).toHaveText('网站反馈');
    await expect(page.locator('#feedbackKinds .kind-option')).toHaveText(['网站问题', '功能建议', '其他']);
    await expect(page.locator('#feedbackSuggestEdit')).toBeHidden();
    await page.locator('.kind-option', { hasText: '功能建议' }).click();
    await page.fill('#feedbackForm [name=message]', '希望能按地区筛选。');
    await page.click('#feedbackSend');
    await expect(page.locator('#feedbackModal')).toBeHidden();
    expect(sent[0].body).toMatchObject({ subject: '[时间上的中国] 网站反馈（功能建议）', '反馈类型': '功能建议', '说明': '希望能按地区筛选。' });
    expect(sent[0].body['事件']).toBeUndefined();

    // 建议新增事件：空白的编辑页（建议模式）
    await page.click('#siteFeedback');
    await page.click('#feedbackProposeNew');
    await expect(page.locator('#editTitle')).toHaveText('建议新增事件');
    const f = page.locator('#editForm');
    await expect(f.locator('[name=title]')).toHaveValue('');
    await expect(page.locator('#suggestImageField')).toBeHidden();
    await page.click('#saveBtn');
    await expect(page.locator('#formError')).toHaveText('请填写事件名称');
    const cardsBefore = await page.locator('.card').count();
    await f.locator('[name=title]').fill('测试建议新增的事件');
    await f.locator('[name=yearAbs]').fill('1069');
    await f.locator('[name=short]').fill('这是测试中建议新增的事件，不应出现在时间轴上。');
    await page.fill('#editForm [name=suggestImageUrl]', 'https://example.org/new.jpg');
    await page.click('#saveBtn');
    await expect(page.locator('#editModal')).toBeHidden();
    const body = sent[1].body;
    expect(body.subject).toBe('[时间上的中国] 建议新增事件：测试建议新增的事件');
    expect(body['建议的事件']).toContain('【事件名称】测试建议新增的事件');
    expect(body['建议的事件']).toContain('【年份】公元1069年');
    expect(JSON.parse(body['建议的事件（JSON）'])).toMatchObject({ title: '测试建议新增的事件', year: 1069 });
    expect(body['建议的图片网址']).toBe('https://example.org/new.jpg');
    // 没有新增到时间轴上
    await expect(page.locator('.card', { hasText: '测试建议新增的事件' })).toHaveCount(0);
    expect(await page.locator('.card').count()).toBe(cardsBefore);
  });

  test.describe('调试模式', () => {
    test.use({ debugMode: true });

    test('建议模式之后再打开编辑页，恢复为正常编辑（显示全部字段，保存写入数据）', async ({ page }) => {
      await enableFeedback(page);
      await openApp(page);
      await openDetailOf(page, '安史之乱');
      await page.click('#detailFeedback');
      await page.click('#feedbackSuggestEdit');
      await expect(page.locator('#saveBtn')).toHaveText('提交建议');
      await page.keyboard.press('Escape');
      await page.click('#detailEdit');
      await expect(page.locator('#editTitle')).toHaveText('编辑事件');
      await expect(page.locator('#saveBtn')).toHaveText('保存');
      await expect(page.locator('#editForm [name=majorScore]')).toBeVisible();
      await expect(page.locator('#imageEditor')).toBeVisible();
      await expect(page.locator('#editForm [name=suggestNote]')).toBeHidden();
    });
  });

  test.describe('手机', () => {
    test.use({ viewport: { width: 390, height: 780 } });

    test('反馈弹窗和建议模式在窄屏下完整可用，不产生横向滚动', async ({ page }) => {
      await enableFeedback(page);
      await openApp(page);
      await openDetailOf(page, '安史之乱');
      await page.click('#detailFeedback');
      await expect(page.locator('#feedbackSend')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      const box = await page.locator('#feedbackForm').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await page.click('#feedbackSuggestEdit');
      await expect(page.locator('#saveBtn')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  });
});
