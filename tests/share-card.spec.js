// 社交分享卡片：全站的 og: / twitter: 元数据、1200×630 封面图和 apple-touch-icon（PNG）。
// 分享到微信、微博、Telegram、X 时显示标题、简介和封面图，而不是一行网址。
const fs = require('fs');
const path = require('path');
const { test, expect, DATA_URL, readTestData } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const HOMEPAGE = require('../package.json').homepage;

// 读取 PNG 的宽高（IHDR）
function pngSize(buf) {
  expect(buf.subarray(0, 8).toString('hex'), 'PNG 文件头').toBe('89504e470d0a1a0a');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function metaMap(page) {
  return page.evaluate(() => {
    const m = {};
    document.querySelectorAll('meta[property], meta[name]').forEach((el) => {
      m[el.getAttribute('property') || el.getAttribute('name')] = el.getAttribute('content');
    });
    return m;
  });
}

test('页面有 og: 和 twitter: 元数据，标题、简介与页面一致，网址是部署地址的绝对地址', async ({ page }) => {
  await page.goto('/');
  const m = await metaMap(page);
  const title = await page.title();
  expect(m['og:title']).toBe(title);
  expect(m['twitter:title']).toBe(title);
  expect(m['og:description']).toBeTruthy();
  expect(m['og:description']).toBe(m.description);
  expect(m['twitter:description']).toBe(m.description);
  expect(m['og:type']).toBe('website');
  expect(m['twitter:card']).toBe('summary_large_image');
  expect(m['og:url']).toBe(HOMEPAGE);
  expect(m['og:image']).toBe(HOMEPAGE + 'images/share/cover.png');
  expect(m['twitter:image']).toBe(m['og:image']);
  expect(m['og:image:width']).toBe('1200');
  expect(m['og:image:height']).toBe('630');
  expect(m['og:image:alt']).toBeTruthy();
});

test('index.html 中的简介是通用文字：不提到具体国家、不写数字（实际简介来自数据集的 description）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const descs = [...html.matchAll(/<meta (?:name="description"|property="og:description"|name="twitter:description") content="([^"]*)">/g)].map((m) => m[1]);
  expect(descs).toHaveLength(3);
  expect(new Set(descs).size).toBe(1);
  expect(descs[0]).not.toMatch(/[0-9０-９]|中国|一百|百个/);
});

test('网页加载数据后，简介换成当前数据集的 description；数据集没有该字段时保留通用文字', async ({ page }) => {
  const { description } = readTestData();
  expect(description).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('.card').first()).toBeVisible();
  let m = await metaMap(page);
  expect(m.description).toBe(description);
  expect(m['og:description']).toBe(description);
  expect(m['twitter:description']).toBe(description);

  const generic = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/<meta name="description" content="([^"]*)">/)[1];
  await page.route(`**${DATA_URL}`, async (route) => {
    const data = await (await route.fetch()).json();
    delete data.description;
    await route.fulfill({ json: data });
  });
  await page.reload();
  await expect(page.locator('.card').first()).toBeVisible();
  m = await metaMap(page);
  expect(m.description).toBe(generic);
  expect(m['og:description']).toBe(generic);
});

test('封面图是 1200×630 的 PNG，部署时会一起复制', async ({ page, request }) => {
  await page.goto('/');
  const m = await metaMap(page);
  const rel = m['og:image'].slice(HOMEPAGE.length);
  const res = await request.get('/' + rel);
  expect(res.ok()).toBeTruthy();
  expect(pngSize(await res.body())).toEqual({ width: 1200, height: 630 });
  // 社交平台对分享图大小有限制，保持在 1MB 以内
  expect((await res.body()).length).toBeLessThan(1024 * 1024);
  const { SITE_FILES } = require('../tools/build-site');
  expect(SITE_FILES).toContain(rel.split('/')[0]);
});

test('apple-touch-icon 是 180×180 的 PNG（iOS 主屏幕、微信等不认 data URI 的 SVG 图标）', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(href).not.toMatch(/^data:/);
  const res = await request.get('/' + href);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()['content-type']).toMatch(/image\/png/);
  expect(pngSize(await res.body())).toEqual({ width: 180, height: 180 });
});

test('分享图片由 tools/share-images.js 生成，图片文件都在仓库中', async () => {
  for (const f of ['cover.png', 'apple-touch-icon.png']) {
    expect(fs.existsSync(path.join(ROOT, 'images', 'share', f)), f).toBe(true);
  }
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'share-images.js'), 'utf8');
  expect(src).toMatch(/1200, 630/);
  expect(src).toMatch(/180, 180/);
});
