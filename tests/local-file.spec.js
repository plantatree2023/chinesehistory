// 本地文件模式：通过本地可写服务器（npm start）访问时，新增 / 编辑 / 删除直接写回 data/<数据集>.json，
// 上传的图片保存为 images/ 下的文件。每个测试都启动独立服务器，写入目录是临时副本，不会改动仓库中的真实数据。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createServer } = require('../server');
const { test, expect, DATASET, DEFAULT_EVENT_COUNT } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const REPO_DATA = path.join(ROOT, 'data', `${DATASET}.json`);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test.use({ viewport: { width: 1440, height: 860 } });

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
    expect(fs.readFileSync(tmpData, 'utf8')).toBe(before);
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
  await page.goto('/');
  await page.click('#browseBtn');
  await expect(page.locator('#storageNote')).toHaveText('修改保存在当前浏览器中');
  await expect(page.locator('#resetBtn')).toBeVisible();
});
