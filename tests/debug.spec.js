// 调试模式：默认关闭，由侧栏底部的开关开启并保存在浏览器中。
// 开启时在顶栏下方显示网站最近更新时间（version.json），并显示全部编辑功能；关闭时编辑功能全部隐藏，其余功能不受影响。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createServer } = require('../server');
const { test, expect, openApp, waitForStableLayout, layoutMetrics, MAX_PER_SCREEN, DEBUG_KEY, DEFAULT_EVENT_COUNT } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

test.use({ viewport: { width: 1440, height: 860 } });

// 编辑功能的所有入口
const EDIT_CONTROLS = ['#addBtn', '#detailEdit', '#detailDelete', '#resetBtn', '#storageNote'];

test('默认关闭：隐藏全部编辑功能和调试信息，浏览功能不受影响', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#debugToggle')).not.toBeChecked();
  await expect(page.locator('#debugBar')).toBeHidden();
  await expect(page.locator('#addBtn')).toBeHidden();

  // 侧栏：搜索、筛选、查看详情可用；编辑、删除、恢复默认数据不显示
  await page.click('#browseBtn');
  await expect(page.locator('.list-item')).toHaveCount(DEFAULT_EVENT_COUNT);
  await expect(page.locator('#filterToggle')).toBeVisible();
  await expect(page.locator('#resetBtn')).toBeHidden();
  await expect(page.locator('#storageNote')).toBeHidden();
  await page.fill('#searchInput', '贞观之治');
  await page.locator('.list-row').first().click();
  await expect(page.locator('.list-actions .btn-ghost')).toBeVisible();
  await expect(page.locator('.list-actions .btn-primary')).toBeHidden();
  await expect(page.locator('.list-actions .btn-danger')).toBeHidden();

  // 详情：内容照常显示，没有编辑 / 删除按钮
  await page.click('.list-actions .btn-ghost');
  await expect(page.locator('#detailTitle')).toHaveText('贞观之治');
  await expect(page.locator('#detailText')).not.toBeEmpty();
  await expect(page.locator('#detailEdit')).toBeHidden();
  await expect(page.locator('#detailDelete')).toBeHidden();

  // 即使通过脚本触发按钮，也不会打开编辑页或删除
  await page.evaluate(() => { document.getElementById('detailEdit').click(); document.getElementById('detailDelete').click(); document.getElementById('addBtn').click(); });
  await expect(page.locator('#editModal')).toBeHidden();
  await expect(page.locator('#confirmOk')).toBeHidden();
});

test('打开开关后显示全部编辑功能和网站更新时间，关闭后再次隐藏', async ({ page }) => {
  await openApp(page);
  await page.click('#browseBtn');
  await page.locator('.switch').click();
  await expect(page.locator('#debugToggle')).toBeChecked();
  await expect(page.locator('#debugBar')).toBeVisible();
  await expect(page.locator('#resetBtn')).toBeVisible();
  await expect(page.locator('#storageNote')).toHaveText('修改保存在当前浏览器中');
  await page.fill('#searchInput', '贞观之治');
  await page.locator('.list-row').first().click();
  await expect(page.locator('.list-actions .btn-primary')).toBeVisible();
  await expect(page.locator('.list-actions .btn-danger')).toBeVisible();
  await page.click('.list-actions .btn-ghost');
  await expect(page.locator('#detailEdit')).toBeVisible();
  await expect(page.locator('#detailDelete')).toBeVisible();
  await page.click('#detailEdit');
  await expect(page.locator('#editModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#editModal')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#detailModal')).toBeHidden();
  await expect(page.locator('#addBtn')).toBeVisible();

  if (await page.locator('#sidebar').getAttribute('aria-hidden') === 'true') await page.click('#browseBtn');
  await page.locator('.switch').click();
  await expect(page.locator('#debugToggle')).not.toBeChecked();
  for (const sel of [...EDIT_CONTROLS, '#debugBar']) await expect(page.locator(sel), sel).toBeHidden();
  expect(await page.evaluate((k) => localStorage.getItem(k), DEBUG_KEY)).toBeNull();
});

test('开关状态保存在浏览器中，刷新后保持', async ({ page }) => {
  await openApp(page);
  await page.click('#browseBtn');
  await page.locator('.switch').click();
  expect(await page.evaluate((k) => localStorage.getItem(k), DEBUG_KEY)).toBe('1');
  await page.reload();
  await expect(page.locator('.card').first()).toBeVisible();
  await expect(page.locator('#debugToggle')).toBeChecked();
  await expect(page.locator('#addBtn')).toBeVisible();
  await expect(page.locator('#debugBar')).toBeVisible();
});

test.describe('网站更新时间', () => {
  test.use({ debugMode: true, timezoneId: 'Asia/Shanghai' });

  test('本地服务器显示 git 最近一次提交的时间和版本', async ({ page }) => {
    const [at, commit] = git('log', '-1', '--format=%cI%n%h').split('\n');
    const res = await page.request.get('/version.json');
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ updatedAt: at, commit, commitAt: at, source: 'local' });

    await openApp(page);
    const d = new Date(at);
    const bj = new Date(d.getTime() + 8 * 3600e3).toISOString();   // 北京时间（UTC+8）
    const expected = `${bj.slice(0, 10)} ${bj.slice(11, 16)}（UTC+8）`;
    await expect(page.locator('#debugUpdated')).toHaveText(expected);
    await expect(page.locator('#debugUpdated')).toHaveAttribute('datetime', at);
    await expect(page.locator('#debugCommit')).toHaveText(`版本 ${commit}（本地）`);
  });

  test('部署版本：显示 version.json 中的部署时间，按浏览器时区显示', async ({ page }) => {
    await page.route('**/version.json', (route) => route.fulfill({
      json: { updatedAt: '2026-09-30T17:05:09Z', commit: 'abc1234', commitAt: '2026-09-30T17:01:00Z', source: 'deploy' },
    }));
    await openApp(page);
    await expect(page.locator('#debugBar')).toHaveText(/网站最近更新：\s*2026-10-01 01:05（UTC\+8）\s*版本 abc1234\s*$/);
  });

  test('没有 version.json 或内容无效时显示“未知”', async ({ page }) => {
    await page.route('**/version.json', (route) => route.fulfill({ status: 404, body: '' }));
    await openApp(page);
    await expect(page.locator('#debugUpdated')).toHaveText('未知');
    await expect(page.locator('#debugCommit')).toHaveText('');

    await page.unroute('**/version.json');
    await page.route('**/version.json', (route) => route.fulfill({ json: { updatedAt: 'not a date', commit: 'abc1234' } }));
    await page.reload();
    await expect(page.locator('#debugUpdated')).toHaveText('未知');
    await expect(page.locator('#debugCommit')).toHaveText('');
  });

  test('关闭工具栏时调试信息一同隐藏；排版规则仍成立', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#debugBar')).toBeVisible();
    const m = await layoutMetrics(page);
    expect(m.maxPerScreen).toBeLessThanOrEqual(MAX_PER_SCREEN);
    expect(m.outOfBounds).toBe(0);
    expect(m.overlaps).toBe(0);
    await page.click('#barsToggle');
    await expect(page.locator('#debugBar')).toBeHidden();
    await page.click('#barsToggle');
    await expect(page.locator('#debugBar')).toBeVisible();
  });
});

test.describe('手机', () => {
  test.use({ viewport: { width: 390, height: 780 }, debugMode: true });

  test('调试信息不产生横向溢出，卡片不越界', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#debugBar')).toBeVisible();
    await waitForStableLayout(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const bar = await page.locator('#debugBar').boundingBox();
    expect(bar.x + bar.width).toBeLessThanOrEqual(390);
    expect((await layoutMetrics(page)).outOfBounds).toBe(0);
  });
});

test.describe('version.json 的来源', () => {
  let tmpDir;
  test.beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinesehistory-version-')); });
  test.afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  test('已有 version.json 文件（部署产物）时服务器直接返回该文件', async ({ request }) => {
    const deployed = { updatedAt: '2026-01-02T03:04:05Z', commit: 'fedcba9', commitAt: '2026-01-02T03:00:00Z', source: 'deploy' };
    fs.writeFileSync(path.join(tmpDir, 'version.json'), JSON.stringify(deployed));
    const server = createServer({ root: ROOT, writeDir: tmpDir, readonly: true });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const res = await request.get(`http://127.0.0.1:${server.address().port}/version.json`);
      expect(await res.json()).toEqual(deployed);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('不是 git 仓库时返回 404（网页显示“未知”）', async ({ request }) => {
    fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(tmpDir, 'index.html'));
    const server = createServer({ root: tmpDir, readonly: true });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const res = await request.get(`http://127.0.0.1:${server.address().port}/version.json`, { headers: { 'Cache-Control': 'no-cache' } });
      expect(res.status()).toBe(404);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  test('部署流程每次都生成 version.json（在上传网站之前）', async () => {
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
    // 部署在每次 push 到 main 时运行
    expect(yml).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]/);
    const step = yml.match(/- name: Write version info\n\s*run: \|\n((?:\s{10}.*\n)+)/);
    expect(step, '缺少生成 version.json 的步骤').not.toBeNull();
    expect(yml.indexOf('Write version info')).toBeGreaterThan(yml.indexOf('Prepare site'));
    expect(yml.indexOf('Write version info')).toBeLessThan(yml.indexOf('upload-pages-artifact'));

    // 在临时目录中执行该步骤的脚本，检查生成的内容
    const script = step[1].replace(/^ {10}/gm, '');
    fs.mkdirSync(path.join(tmpDir, '_site'));
    const before = Date.now();
    execFileSync('bash', ['-e', '-c', script], {
      cwd: tmpDir,
      env: { ...process.env, GITHUB_SHA: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', GIT_DIR: path.join(ROOT, '.git') },
      stdio: 'ignore',
    });
    const v = JSON.parse(fs.readFileSync(path.join(tmpDir, '_site', 'version.json'), 'utf8'));
    expect(v).toMatchObject({ commit: 'a1b2c3d', source: 'deploy', commitAt: git('log', '-1', '--format=%cI') });
    expect(v.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(Math.abs(Date.parse(v.updatedAt) - before)).toBeLessThan(60_000);
  });
});

test.describe('GitHub 仓库按钮', () => {
  const REPO = 'https://github.com/plantatree2023/chinesehistory';

  test('默认不显示；打开调试模式后显示在右上角所有按钮的最左侧，新窗口打开仓库', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#githubLink')).toBeHidden();
    await page.click('#browseBtn');
    await page.locator('.switch').click();
    await page.keyboard.press('Escape');
    const link = page.locator('#githubLink');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', REPO);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('aria-label', 'GitHub 仓库');
    // 最左侧：比其他所有可见的按钮都靠左
    const xs = await page.evaluate(() => [...document.querySelectorAll('.corner-btns > *')]
      .filter((b) => b.offsetParent).map((b) => ({ id: b.id, x: b.getBoundingClientRect().x })));
    expect(xs[0].id).toBe('githubLink');
    expect(Math.min(...xs.map((b) => b.x))).toBe(xs[0].x);
    // 关闭调试模式后再次隐藏
    await page.click('#browseBtn');
    await page.locator('.switch').click();
    await expect(link).toBeHidden();
  });

  for (const viewport of [{ width: 1440, height: 860 }, { width: 390, height: 780 }, { width: 320, height: 640 }]) {
    test.describe(`${viewport.width}×${viewport.height}`, () => {
      test.use({ viewport, debugMode: true });

      test('调试模式下按钮排成一行、在顶栏内、不遮挡标题', async ({ page }) => {
        await openApp(page);
        const bar = await page.locator('.topbar').boundingBox();
        const brand = await page.locator('.brand').boundingBox();
        const boxes = await page.evaluate(() => [...document.querySelectorAll('.corner-btns > *')]
          .filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().toJSON()));
        expect(boxes.length).toBeGreaterThanOrEqual(5);
        for (let i = 0; i < boxes.length; i++) {
          expect(boxes[i].y).toBeGreaterThanOrEqual(bar.y);
          expect(boxes[i].y + boxes[i].height).toBeLessThanOrEqual(bar.y + bar.height);
          if (i) expect(boxes[i - 1].x + boxes[i - 1].width).toBeLessThan(boxes[i].x);
        }
        expect(brand.x + brand.width, '标题不被按钮遮挡').toBeLessThanOrEqual(boxes[0].x);
        expect(boxes[boxes.length - 1].x + boxes[boxes.length - 1].width).toBeLessThanOrEqual(viewport.width - 8);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      });
    });
  }

  test('隐藏工具栏时 GitHub 按钮一同隐藏', async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem(k, '1'), DEBUG_KEY);
    await openApp(page);
    await expect(page.locator('#githubLink')).toBeVisible();
    await page.click('#barsToggle');
    await expect(page.locator('#githubLink')).toBeHidden();
    await page.click('#barsToggle');
    await expect(page.locator('#githubLink')).toBeVisible();
  });
});
