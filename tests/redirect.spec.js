// 旧地址跳转（tools/build-redirect.js，部署到 GitHub Pages）：旧地址的首页和事件页带着网址参数和 # 跳到新地址的同一页，
// 其他地址由 404.html 按路径跳转；跳转页带 canonical。用拦截请求模拟两个网站，不访问外网
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect, readRealDataset } = require('./helpers');
const { buildRedirect } = require('../tools/build-redirect');
const { build, HOMEPAGE } = require('../tools/build-site');

const OLD = 'https://plantatree2023.github.io/chinesehistory/';
// 跳转网站和正式网站都按 data/ 中的真实数据生成，事件取自默认数据集
const data = readRealDataset('cn_zh');

let outDir;
test.beforeAll(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chinesehistory-redirect-'));
  buildRedirect(outDir);
});
test.afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

// 旧网站：按 GitHub Pages 的规则返回跳转网站中的文件（目录返回 index.html，不存在时返回 404.html）；新网站返回一个占位页
async function serveSites(page) {
  await page.route(`${OLD}**`, (route) => {
    let rel = decodeURIComponent(new URL(route.request().url()).pathname.slice('/chinesehistory/'.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(outDir, rel);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(file) });
    return route.fulfill({ status: 404, contentType: 'text/html', body: fs.readFileSync(path.join(outDir, '404.html')) });
  });
  await page.route(`${HOMEPAGE}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>new site</p>' }));
}

test('新地址是 history.zhongshutime.com', async () => {
  expect(HOMEPAGE).toBe('https://history.zhongshutime.com/');
});

test('旧首页带着参数和 # 跳到新首页（已分享的链接仍然有效）', async ({ page }) => {
  await serveSites(page);
  const ev = data.events[0];
  await page.goto(`${OLD}?id=${ev.id}&at=-200#x`);
  await page.waitForURL(`${HOMEPAGE}?id=${ev.id}&at=-200#x`);
  await page.goto(`${OLD}index.html?data=cn_zh-v0`);
  await page.waitForURL(`${HOMEPAGE}?data=cn_zh-v0`);
});

test('旧事件页跳到新地址的同一事件页', async ({ page }) => {
  await serveSites(page);
  const ev = data.events[3];
  await page.goto(`${OLD}e/${ev.id}.html`);
  await page.waitForURL(`${HOMEPAGE}e/${ev.id}.html`);
});

test('其他地址由 404.html 按路径跳转', async ({ page }) => {
  await serveSites(page);
  await page.goto(`${OLD}images/share/cover.png?v=2`);
  await page.waitForURL(`${HOMEPAGE}images/share/cover.png?v=2`);
});

test('正式网站的每个网页都有跳转页，跳转页带 canonical 和 meta refresh', async () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'chinesehistory-site-'));
  try {
    build(site);
    const list = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((d) => {
      const r = rel ? `${rel}/${d.name}` : d.name;
      return d.isDirectory() ? list(dir, r) : (d.name.endsWith('.html') ? [r] : []);
    });
    expect(list(outDir).sort()).toEqual(list(site).sort());
    const ev = data.events[0];
    const html = fs.readFileSync(path.join(outDir, 'e', `${ev.id}.html`), 'utf8');
    expect(html).toContain(`<link rel="canonical" href="${HOMEPAGE}e/${ev.id}.html">`);
    expect(html).toContain(`<meta http-equiv="refresh" content="0; url=${HOMEPAGE}e/${ev.id}.html">`);
    expect(fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')).toContain(`<link rel="canonical" href="${HOMEPAGE}">`);
    // 跳转网站只有跳转页，不再包含网站文件
    expect(fs.existsSync(path.join(outDir, 'js'))).toBe(false);
    expect(fs.existsSync(path.join(outDir, 'images'))).toBe(false);
  } finally {
    fs.rmSync(site, { recursive: true, force: true });
  }
});
