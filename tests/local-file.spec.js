// 本地文件模式：通过本地可写服务器（npm start）访问时，新增 / 编辑 / 删除直接写回 data/<数据集>.json，
// 上传的图片保存为 images/ 下的文件。每个测试都启动独立服务器，写入目录是临时副本，不会改动仓库中的真实数据。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createServer } = require('../server');
const http = require('http');
const { test, expect, makePng, DATASET, DEFAULT_EVENT_COUNT } = require('./helpers');
const { imageSize } = require('../lib/images');

const ROOT = path.resolve(__dirname, '..');
const REPO_DATA = path.join(ROOT, 'data', `${DATASET}.json`);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 编辑功能只在调试模式下显示
test.use({ viewport: { width: 1440, height: 860 }, debugMode: true });

let server, origin, tmpDir, tmpData, repoHash;

test.beforeEach(async () => {
  repoHash = sha256(REPO_DATA);
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinesehistory-'));
  tmpData = path.join(tmpDir, 'data', `${DATASET}.json`);
  fs.mkdirSync(path.dirname(tmpData), { recursive: true });
  fs.copyFileSync(REPO_DATA, tmpData);
  server = createServer({ root: ROOT, writeDir: tmpDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  expect(sha256(REPO_DATA), '仓库中的真实数据文件不应被测试改动').toBe(repoHash);
});

const readData = () => JSON.parse(fs.readFileSync(tmpData, 'utf8'));

// 模拟一个外部网站：/photo.png 为图片，/page.html 为网页，其他地址 404
async function startExternalSite() {
  const photo = makePng(64, 48, 90);
  const site = http.createServer((req, res) => {
    if (req.url === '/photo.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(photo); return; }
    if (req.url === '/page.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html></html>'); return; }
    res.writeHead(404).end();
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${site.address().port}`, photo, close: () => new Promise((r) => site.close(r)) };
}
const findEvent = (title) => readData().events.find((e) => e.title === title);

async function openLocal(page) {
  await page.goto(origin + '/');
  await expect(page.locator('.card')).toHaveCount(DEFAULT_EVENT_COUNT);
}

test.describe('界面', () => {
  test('显示本地文件模式说明，并隐藏“恢复默认数据”', async ({ page }) => {
    await openLocal(page);
    await page.click('#browseBtn');
    await expect(page.locator('#storageNote')).toContainText(`data/${DATASET}.json`);
    await expect(page.locator('#resetBtn')).toBeHidden();
  });

  test('新增事件写入数据文件，上传的图片保存为 images/ 下的文件', async ({ page }) => {
    await openLocal(page);
    await page.click('#addBtn');
    await page.fill('#editForm [name=title]', '本地写入测试');
    await page.fill('#editForm [name=yearAbs]', '1500');
    await page.fill('#editForm [name=short]', '用于验证新增事件会被写入本地数据文件的测试说明。');
    // 用仓库中已有的一张图片模拟用户上传
    const sample = path.join(ROOT, 'images', fs.readdirSync(path.join(ROOT, 'images')).find((f) => f.endsWith('.jpg')));
    await page.setInputFiles('#imageFileInput', sample);
    await expect(page.locator('#imageEditor .img-slot')).toHaveCount(1);
    await page.click('#editForm button[type=submit]');

    await expect.poll(() => findEvent('本地写入测试'), { message: '新事件应写入数据文件' }).toBeTruthy();
    const ev = findEvent('本地写入测试');
    expect(ev.year).toBe(1500);
    expect(ev.images).toHaveLength(1);
    expect(ev.images[0].src).toMatch(/^images\/[0-9a-f]{16}\.jpg$/);
    expect(fs.existsSync(path.join(tmpDir, ev.images[0].src)), '上传的图片文件应存在').toBe(true);
    expect(readData().events).toHaveLength(DEFAULT_EVENT_COUNT + 1);

    // 文件中的事件按年份排序，便于查看 git diff
    const years = readData().events.map((e) => e.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));

    // 重新打开页面，数据来自文件
    await page.reload();
    await expect(page.locator('.card-title', { hasText: '本地写入测试' })).toHaveCount(1);
    await expect(page.locator('.card', { hasText: '本地写入测试' }).locator('img.card-img')).toHaveAttribute('src', ev.images[0].src);
  });

  test('在编辑页输入图片网址：由本地服务器下载到 images/，数据中只保存本地路径', async ({ page }) => {
    const ext = await startExternalSite();
    try {
      await openLocal(page);
      await page.click('#addBtn');
      await page.fill('#editForm [name=title]', '网址图片测试');
      await page.fill('#editForm [name=yearAbs]', '1600');
      await page.fill('#editForm [name=short]', '用于验证输入图片网址后会自动下载到本地的测试说明。');

      // 下载失败：显示原因，不加入图片
      await page.fill('#imageUrlInput', `${ext.url}/missing.png`);
      await page.click('#imageUrlAdd');
      await expect(page.locator('#formError')).toContainText('图片下载失败：无法下载图片：网址返回 HTTP 404');
      await page.fill('#imageUrlInput', `${ext.url}/page.html`);
      await page.press('#imageUrlInput', 'Enter');
      await expect(page.locator('#formError')).toContainText('不是 JPEG / PNG / GIF / WebP 图片');
      await expect(page.locator('#imageEditor .img-slot')).toHaveCount(0);

      // 下载成功：编辑框中显示的已是本地图片
      await page.fill('#imageUrlInput', `${ext.url}/photo.png`);
      await page.click('#imageUrlAdd');
      await expect(page.locator('#imageEditor .img-slot')).toHaveCount(1);
      await expect(page.locator('#imageEditor .img-slot img')).toHaveAttribute('src', /^images\/[0-9a-f]{16}\.png$/);
      await expect(page.locator('#imageUrlInput')).toHaveValue('');
      await page.click('#editForm button[type=submit]');

      await expect.poll(() => findEvent('网址图片测试'), { message: '新事件应写入数据文件' }).toBeTruthy();
      const img = findEvent('网址图片测试').images[0];
      expect(img).toMatchObject({ src: expect.stringMatching(/^images\/[0-9a-f]{16}\.png$/), w: 64, h: 48 });
      const saved = fs.readFileSync(path.join(tmpDir, img.src));
      expect(saved.equals(ext.photo)).toBe(true);
      expect(imageSize(saved)).toMatchObject({ w: 64, h: 48 });
    } finally {
      await ext.close();
    }
  });

  test('修改图片标题写入数据文件，只改动标题', async ({ page }) => {
    const before = findEvent('安史之乱');
    await openLocal(page);
    await page.click('#browseBtn');
    await page.fill('#searchInput', '安史之乱');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-primary');
    await page.locator('#imageEditor .slot-caption').nth(1).fill('写入文件的图片标题');
    await page.click('#editForm button[type=submit]');
    await expect.poll(() => findEvent('安史之乱').images[1].caption).toBe('写入文件的图片标题');
    const after = findEvent('安史之乱');
    expect(after.images.map((im) => ({ ...im, caption: null }))).toEqual(before.images.map((im) => ({ ...im, caption: null })));
    expect(after.images[0].caption).toBe(before.images[0].caption);
  });

  test('编辑和删除同样写入数据文件', async ({ page }) => {
    await openLocal(page);
    await page.click('#browseBtn');
    await page.fill('#searchInput', '贞观之治');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-primary');
    await page.fill('#editForm [name=title]', '贞观之治（已编辑）');
    await page.click('#editForm button[type=submit]');
    await expect.poll(() => !!findEvent('贞观之治（已编辑）')).toBe(true);
    expect(findEvent('贞观之治')).toBeUndefined();

    await page.fill('#searchInput', '玄武门');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-danger');
    await page.click('#confirmOk');
    await expect.poll(() => findEvent('玄武门之变')).toBeUndefined();
    expect(readData().events).toHaveLength(DEFAULT_EVENT_COUNT - 1);
    // 时期等非事件数据保持不变
    expect(readData().eras.length).toBeGreaterThan(0);
    expect(readData().id).toBe(DATASET);
  });
});

test.describe('写入接口', () => {
  const put = (request, id, body, headers = {}) => request.put(`${origin}/api/data/${id}`, {
    data: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers },
  });

  test('可写服务器声明可写', async ({ request }) => {
    expect(await (await request.get(`${origin}/api/status`)).json()).toEqual({ writable: true });
  });

  test('拒绝非法数据集名称（防止写到任意路径）', async ({ request }) => {
    for (const id of ['..%2Fserver', 'CN_ZH', 'cn', 'cn_zh.json']) {
      expect((await put(request, id, {})).status(), id).toBe(400);
    }
  });

  test('拒绝来自其他网站的写入请求', async ({ request }) => {
    const data = readData();
    expect((await put(request, DATASET, data, { Origin: 'https://evil.example' })).status()).toBe(403);
    expect((await put(request, DATASET, data, { Host: 'evil.example' })).status()).toBe(403);
    const form = await request.put(`${origin}/api/data/${DATASET}`, { data: JSON.stringify(data), headers: { 'Content-Type': 'text/plain' } });
    expect(form.status(), '非 JSON 请求应被拒绝').toBe(415);
  });

  test('拒绝结构错误的数据，数据文件保持不变', async ({ request }) => {
    const before = fs.readFileSync(tmpData, 'utf8');
    const data = readData();
    const dup = { ...data, events: [...data.events, { ...data.events[0] }] };
    expect((await put(request, DATASET, dup)).status(), '重复 id').toBe(422);
    const inline = { ...data, events: [{ ...data.events[0], images: [{ src: 'data:image/png;base64,AAAA' }] }] };
    expect((await put(request, DATASET, inline)).status(), '内嵌图片').toBe(422);
    expect((await put(request, DATASET, { ...data, id: 'jp_ja' })).status(), 'id 不一致').toBe(422);
    const badTransition = { ...data, events: [{ ...data.events[0], transition: { from: '唐', to: '不存在的时期' } }] };
    expect((await put(request, DATASET, badTransition)).status(), '时期更迭引用不存在的时期').toBe(422);
    const external = { ...data, events: [{ ...data.events[0], images: [{ src: 'https://upload.wikimedia.org/a.jpg', caption: '' }] }] };
    expect((await put(request, DATASET, external)).status(), '外部图片地址').toBe(422);
    expect(fs.readFileSync(tmpData, 'utf8')).toBe(before);
  });

  test('按网址下载图片：只允许 http / https、只接受图片、拒绝跨站请求，成功时返回本地路径与尺寸', async ({ request }) => {
    const ext = await startExternalSite();
    try {
      const fetchUrl = (url, headers = {}) => request.post(`${origin}/api/images/fetch`, {
        data: JSON.stringify({ url }), headers: { 'Content-Type': 'application/json', ...headers },
      });
      const ok = await fetchUrl(`${ext.url}/photo.png`);
      expect(ok.status()).toBe(200);
      const body = await ok.json();
      expect(body).toMatchObject({ path: expect.stringMatching(/^images\/[0-9a-f]{16}\.png$/), w: 64, h: 48 });
      expect(fs.existsSync(path.join(tmpDir, body.path))).toBe(true);

      for (const url of ['file:///etc/passwd', 'ftp://example.com/a.png', 'not a url']) {
        const r = await fetchUrl(url);
        expect(r.status(), url).toBe(400);
      }
      expect((await (await fetchUrl('file:///etc/passwd')).json()).error).toContain('只支持 http / https');
      expect((await fetchUrl(`${ext.url}/page.html`)).status(), '网页不是图片').toBe(400);
      expect((await fetchUrl(`${ext.url}/missing.png`)).status()).toBe(400);
      expect((await fetchUrl(`${ext.url}/photo.png`, { Origin: 'https://evil.example' })).status(), '跨站请求').toBe(403);
    } finally {
      await ext.close();
    }
  });

  test('上传接口校验图片内容并返回尺寸', async ({ request }) => {
    const upload = (dataUrl) => request.post(`${origin}/api/images`, { data: JSON.stringify({ dataUrl }), headers: { 'Content-Type': 'application/json' } });
    const r = await upload(`data:image/png;base64,${makePng(20, 10).toString('base64')}`);
    expect(await r.json()).toMatchObject({ path: expect.stringMatching(/^images\/[0-9a-f]{16}\.png$/), w: 20, h: 10 });
    const fake = await upload(`data:image/png;base64,${Buffer.from('not really a png').toString('base64')}`);
    expect(fake.status(), '内容不是图片').toBe(400);
  });

  test('只接受图片类型的上传', async ({ request }) => {
    const res = await request.post(`${origin}/api/images`, {
      data: JSON.stringify({ dataUrl: 'data:text/html;base64,PGgxPmhpPC9oMT4=' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).toBe(400);
  });
});

test('只读服务器（与 GitHub Pages 一致）不提供写入接口，使用浏览器模式', async ({ page }) => {
  expect((await page.request.get('/api/status')).status()).toBe(404);
  expect((await page.request.put(`/api/data/${DATASET}`, { data: '{}', headers: { 'Content-Type': 'application/json' } })).status()).toBe(404);
  expect((await page.request.post('/api/images/fetch', { data: '{}', headers: { 'Content-Type': 'application/json' } })).status()).toBe(404);
  await page.goto('/');
  await page.click('#browseBtn');
  await expect(page.locator('#storageNote')).toHaveText('修改保存在当前浏览器中');
  await expect(page.locator('#resetBtn')).toBeVisible();
});
