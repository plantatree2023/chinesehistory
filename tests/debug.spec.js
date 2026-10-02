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
// 执行部署脚本用的 bash：Windows 上 Git Bash 通常不在 PATH 中，从 git 的安装目录找
// （git --exec-path 为 <Git>/mingw64/libexec/git-core，bash 在 <Git>/bin/bash.exe）
function bashPath() {
  if (process.platform !== 'win32') return 'bash';
  const gitRoot = path.resolve(git('--exec-path'), '..', '..', '..');
  return [path.join(gitRoot, 'bin', 'bash.exe'), path.join(gitRoot, 'usr', 'bin', 'bash.exe')].find((p) => fs.existsSync(p)) || 'bash';
}

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
    execFileSync(bashPath(), ['-e', '-c', script], {
      cwd: tmpDir,
      env: { ...process.env, GITHUB_SHA: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', GIT_DIR: path.join(ROOT, '.git') },
      stdio: 'ignore',
    });
    const v = JSON.parse(fs.readFileSync(path.join(tmpDir, '_site', 'version.json'), 'utf8'));
    expect(v).toMatchObject({ commit: 'a1b2c3d', source: 'deploy', commitAt: git('log', '-1', '--format=%cI') });
    expect(v.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(Math.abs(Date.parse(v.updatedAt) - before)).toBeLessThan(60_000);
  });

  test('Cloudflare Pages 构建脚本只输出网站文件，并生成 version.json', async () => {
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
    const copied = yml.match(/cp -r (.+) _site\//)[1].split(/\s+/);
    const { SITE_FILES } = require('../tools/build-site');
    expect(SITE_FILES, '与 GitHub Pages 部署的文件一致').toEqual(copied);

    const out = path.join(tmpDir, 'site');
    const before = Date.now();
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-site.js'), out], {
      env: { ...process.env, CF_PAGES_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567' },
      stdio: 'ignore',
    });
    expect(fs.readdirSync(out).sort()).toEqual([...SITE_FILES, '.nojekyll', '_headers', 'version.json'].sort());
    expect(fs.existsSync(path.join(out, 'js', 'app.js'))).toBe(true);
    const v = JSON.parse(fs.readFileSync(path.join(out, 'version.json'), 'utf8'));
    expect(v).toMatchObject({ commit: '0123456', source: 'deploy', commitAt: git('log', '-1', '--format=%cI') });
    expect(v.updatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(Math.abs(Date.parse(v.updatedAt) - before)).toBeLessThan(60_000);
  });

  test('Cloudflare 的 wrangler 部署只上传 _site，且每个文件不超过 25 MiB', async () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8'));
    expect(cfg.name).toBe('chinesehistory');
    expect(cfg.assets.directory).toBe('./_site');
    expect(cfg.assets.not_found_handling, '不存在的网址显示 404.html').toBe('404-page');
    const { SITE_FILES } = require('../tools/build-site');
    const tooLarge = [];
    const walk = (p) => {
      const st = fs.statSync(p);
      if (st.isDirectory()) fs.readdirSync(p).forEach((n) => walk(path.join(p, n)));
      else if (st.size > 25 * 1024 * 1024) tooLarge.push(path.relative(ROOT, p));
    };
    SITE_FILES.forEach((n) => walk(path.join(ROOT, n)));
    expect(tooLarge).toEqual([]);
  });
});

test('Cloudflare 缓存规则：只有按内容哈希命名的 images/ 文件长期缓存', async () => {
  const rules = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  expect(rules).toEqual(['/images/:file', '  Cache-Control: public, max-age=31536000, immutable']);
  // :file 只匹配 images/ 下一层的文件（不含 images/share/），这些文件必须都是内容哈希命名，否则改了内容浏览器仍用旧缓存
  const top = fs.readdirSync(path.join(ROOT, 'images'), { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  expect(top.length).toBeGreaterThan(0);
  expect(top.filter((n) => !/^[0-9a-f]{12,64}\.(jpg|jpeg|png|webp|gif|svg)$/.test(n))).toEqual([]);
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
    expect(xs[1].id, '清除缓存按钮紧挨在 GitHub 按钮右边').toBe('clearCacheBtn');
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
        // 标题文字完整显示（没有被截断成省略号）
        const clipped = await page.evaluate(() => [...document.querySelectorAll('.brand, .brand-name')].some((e) => e.scrollWidth > e.clientWidth + 0.5));
        expect(clipped, '标题被截断').toBe(false);
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

test.describe('清除缓存按钮', () => {
  test('默认不显示；调试模式下显示在 GitHub 按钮右边', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#clearCacheBtn')).toBeHidden();
    await page.evaluate((k) => localStorage.setItem(k, '1'), DEBUG_KEY);
    await page.reload();
    await expect(page.locator('#clearCacheBtn')).toBeVisible();
    await expect(page.locator('#clearCacheBtn')).toHaveAttribute('aria-label', '清除缓存并刷新');
    const gh = await page.locator('#githubLink').boundingBox();
    const cc = await page.locator('#clearCacheBtn').boundingBox();
    const play = await page.locator('#playToggle').boundingBox();
    expect(gh.x).toBeLessThan(cc.x);
    expect(cc.x).toBeLessThan(play.x);
  });

  test.describe('调试模式', () => {
    test.use({ debugMode: true });

    test('点击后绕过缓存重新下载网页、代码、样式和数据，然后刷新；保存在浏览器中的修改和设置不受影响', async ({ page }) => {
      await openApp(page);
      // 记录以 cache: 'reload'（绕过并更新浏览器缓存）方式发出的请求；记在 sessionStorage 中，刷新后仍可读取
      await page.addInitScript(() => {
        const real = window.fetch;
        window.fetch = function (url, init) {
          if (init && init.cache === 'reload') {
            const list = JSON.parse(sessionStorage.getItem('__refetch') || '[]');
            list.push(new URL(url, location.href).pathname);
            sessionStorage.setItem('__refetch', JSON.stringify(list));
          }
          return real.apply(this, arguments);
        };
      });
      await page.reload();
      await expect(page.locator('.card').first()).toBeVisible();
      await page.evaluate(() => {
        localStorage.setItem('zh-history-timeline:theme', 'dark');
        window.__beforeReload = true;
      });
      const stored = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
      await Promise.all([
        page.waitForEvent('load'),
        page.click('#clearCacheBtn'),
      ]);
      await expect(page.locator('.card').first()).toBeVisible();
      // 已经刷新（页面中的变量不在了）
      expect(await page.evaluate(() => window.__beforeReload)).toBeUndefined();
      const refetched = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__refetch') || '[]'));
      for (const f of ['/', '/css/style.css', '/js/app.js', '/data/cn_zh.json', '/version.json']) {
        expect(refetched, f).toContain(f);
      }
      // 图片、音乐不重新下载
      expect(refetched.filter((p) => /^\/(images|audio)\//.test(p))).toEqual([]);
      // 浏览器中保存的内容（修改、设置）原样保留
      expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()))).toBe(stored);
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    });

    test('某个文件下载失败时仍然刷新', async ({ page }) => {
      await openApp(page);
      await page.route('**/css/style.css', (route) => route.request().resourceType() === 'fetch' ? route.abort() : route.continue());
      await page.evaluate(() => { window.__beforeReload = true; });
      await Promise.all([page.waitForEvent('load'), page.click('#clearCacheBtn')]);
      await expect(page.locator('.card').first()).toBeVisible();
      expect(await page.evaluate(() => window.__beforeReload)).toBeUndefined();
    });
  });
});

test.describe('只有本地启动时提供调试模式', () => {
  const STATIC_ENV = fs.readFileSync(path.join(ROOT, 'js', 'env.js'), 'utf8');
  // 模拟线上（GitHub Pages）或 npm start -- --no-debug：网页拿到的是仓库中的 js/env.js
  const asPublic = (page) => page.route('**/js/env.js', (route) => route.fulfill({ contentType: 'text/javascript', body: STATIC_ENV }));

  test('仓库中的 js/env.js（部署到线上的版本）不提供调试模式', async () => {
    expect(STATIC_ENV).toMatch(/debugAvailable:\s*false/);
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
    expect(yml).toMatch(/cp -r [^\n]*\bjs\b[^\n]*_site/);   // 原样部署
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.start).toBe('node server.js');
    expect(pkg.scripts['start:public']).toBe('node server.js --no-debug');
  });

  test('本地服务器默认提供调试模式；--no-debug 时返回仓库中的文件', async ({ request }) => {
    for (const debug of [true, false]) {
      const server = createServer({ root: ROOT, readonly: true, debug });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      try {
        const res = await request.get(`http://127.0.0.1:${server.address().port}/js/env.js`);
        expect(res.ok()).toBe(true);
        expect(res.headers()['content-type']).toContain('javascript');
        const body = await res.text();
        if (debug) expect(body).toMatch(/debugAvailable:\s*true/);
        else expect(body).toBe(STATIC_ENV);
      } finally {
        await new Promise((r) => server.close(r));
      }
    }
    // 命令行参数
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    expect(src).toMatch(/const debug = !args\.includes\('--no-debug'\)/);
  });

  test('本地启动时显示“调试模式”开关', async ({ page }) => {
    await openApp(page);
    await page.click('#browseBtn');
    await expect(page.locator('.switch')).toBeVisible();
  });

  test('线上不显示开关；即使浏览器中保存了开启状态，调试信息和编辑功能也都不显示', async ({ page }) => {
    await asPublic(page);
    await page.addInitScript((k) => localStorage.setItem(k, '1'), DEBUG_KEY);
    await openApp(page);
    await page.click('#browseBtn');
    await expect(page.locator('.switch')).toBeHidden();
    await expect(page.locator('#debugToggle')).not.toBeChecked();
    for (const sel of [...EDIT_CONTROLS, '#debugBar', '#githubLink', '#clearCacheBtn']) await expect(page.locator(sel), sel).toBeHidden();
    expect(await page.evaluate(() => document.body.classList.contains('debug-mode'))).toBe(false);
    // 通过脚本触发也不会打开编辑页
    await page.evaluate(() => document.getElementById('addBtn').click());
    await expect(page.locator('#editModal')).toBeHidden();
    // 保存的状态保留（回到本地时仍是开启）
    expect(await page.evaluate((k) => localStorage.getItem(k), DEBUG_KEY)).toBe('1');
  });
});

test.describe('网址中的 debugMode 参数', () => {
  const STATIC_ENV = fs.readFileSync(path.join(ROOT, 'js', 'env.js'), 'utf8');
  const asPublic = (page) => page.route('**/js/env.js', (route) => route.fulfill({ contentType: 'text/javascript', body: STATIC_ENV }));

  test('线上带 ?debugMode 时显示调试模式开关；浏览中网址保留该参数，分享链接不带', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await asPublic(page);
    await page.goto('/?debugMode');
    await expect(page.locator('.card').first()).toBeVisible();
    await page.click('#browseBtn');
    await expect(page.locator('.switch')).toBeVisible();
    await page.locator('.switch').click();
    await expect(page.locator('#debugToggle')).toBeChecked();
    await expect(page.locator('#addBtn')).toBeVisible();
    // 打开详情：网址仍带 debugMode
    await page.fill('#searchInput', '贞观之治');
    await page.locator('.list-row').first().click();
    await page.click('.list-actions .btn-ghost');
    await expect.poll(() => new URL(page.url()).searchParams.has('debugMode')).toBe(true);
    expect(new URL(page.url()).searchParams.get('id')).toBeTruthy();
    // 分享链接不带
    await page.click('#detailShare');
    await page.click('.share-btn[data-share="copy"]');
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    expect(shared).toContain('id=');
    expect(shared).not.toContain('debugMode');
  });

  test('?debugMode=0 或没有该参数时，线上不显示开关', async ({ page }) => {
    await asPublic(page);
    for (const url of ['/?debugMode=0', '/']) {
      await page.goto(url);
      await expect(page.locator('.card').first()).toBeVisible();
      await page.click('#browseBtn');
      await expect(page.locator('.switch'), url).toBeHidden();
    }
  });
});
