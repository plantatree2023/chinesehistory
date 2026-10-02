// 默认数据集（data/cn_zh.json，第二版中国数据）：由教材条目与旧版数据集（data/cn_zh-v0.json）合并去重后重写的数据。
// 检查服务器校验通过、旧版数据集的事件都保留下来、文字长度、按年份排序，以及图片都是本地文件且尺寸一致、没有重复；
// 网站不带 ?data= 时打开的就是它。
const fs = require('fs');
const path = require('path');
const { test, expect, waitForStableLayout } = require('./helpers');
const { validateDataset } = require('../server');
const { imageSize } = require('../lib/images');

const ROOT = path.join(__dirname, '..');
const ID = 'cn_zh';
const read = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', `${id}.json`), 'utf8'));
const PUNCT = /[\s，。、；：“”‘’《》〈〉（）【】！？·—…,.;:()[\]!?"'-]/g;

test('cn_zh 通过服务器校验，并保留旧版数据集（cn_zh-v0）的全部事件', () => {
  const v2 = read(ID);
  const v1 = read('cn_zh-v0');
  expect(() => validateDataset(ID, v2)).not.toThrow();
  expect(v2.country).toBe('cn');
  expect(v2.language).toBe('zh');
  expect(v2.eras).toEqual(v1.eras);
  expect(v2.types).toEqual(v1.types);
  const ids = new Set(v2.events.map((e) => e.id));
  for (const e of v1.events) expect(ids.has(e.id), `${e.id} ${e.title}`).toBe(true);
  expect(v2.events.length).toBeGreaterThan(v1.events.length);
});

test('cn_zh 的事件按年份排列，标题不重复，说明长度合适', () => {
  const { events } = read(ID);
  const titles = new Set();
  events.forEach((e, i) => {
    if (i) expect(e.year, `${e.title} 的年份顺序`).toBeGreaterThanOrEqual(events[i - 1].year);
    expect(titles.has(e.title), `标题重复：${e.title}`).toBe(false);
    titles.add(e.title);
    expect(e.short.replace(PUNCT, '').length, `${e.title} 的简要说明`).toBeGreaterThanOrEqual(20);
    expect(e.short.length, `${e.title} 的简要说明`).toBeLessThanOrEqual(60);
    expect(e.detail.length, `${e.title} 的详细说明`).toBeGreaterThan(e.short.length);
    expect(e.detail.length, `${e.title} 的详细说明`).toBeLessThanOrEqual(500);
  });
});

test('cn_zh 的维基百科链接标题为“维基百科 - 条目名”', () => {
  const { events } = read(ID);
  const problems = [];
  for (const e of events) {
    for (const s of e.sources) {
      if (!/^https:\/\/zh\.wikipedia\.org\/wiki\/\S+$/.test(s.url)) continue;
      if (!/^维基百科 - \S.*$/.test(s.title || '')) problems.push(`${e.title}：${s.title || '（无标题）'}`);
    }
  }
  expect(problems).toEqual([]);
});

test('cn_zh 的图片都是 images/ 下的本地文件，尺寸与记录一致，同一事件内没有重复', () => {
  const { events } = read(ID);
  const problems = [];
  for (const e of events) {
    expect(e.images.length, e.title).toBeLessThanOrEqual(9);
    const seen = new Set();
    for (const img of e.images) {
      if (!/^images\/[0-9a-f]{12,16}\.(jpg|png|gif|webp)$/.test(img.src)) { problems.push(`${e.title}：图片路径 ${img.src}`); continue; }
      if (seen.has(img.src)) problems.push(`${e.title}：重复图片 ${img.src}`);
      seen.add(img.src);
      const file = path.join(ROOT, img.src);
      if (!fs.existsSync(file)) { problems.push(`${e.title}：文件不存在 ${img.src}`); continue; }
      const size = imageSize(fs.readFileSync(file));
      if (!size || size.w !== img.w || size.h !== img.h) problems.push(`${e.title}：尺寸与记录不符 ${img.src}`);
    }
  }
  expect(problems).toEqual([]);
});

test('网页可以通过 ?data=cn_zh 打开默认数据集', async ({ page }) => {
  const { events } = read(ID);
  await page.goto(`/?data=${ID}`);
  await expect(page.locator('.card').first()).toBeVisible();
  await waitForStableLayout(page);
  const title = await page.locator('.card .card-title').first().textContent();
  expect(events.map((e) => e.title)).toContain(title);
});

test('网页不带 ?data= 时默认打开 cn_zh（不使用测试数据时）', async ({ page }) => {
  const { events } = read(ID);
  // 测试中默认数据集被换成测试数据（window.TIMELINE_DATASET），这里去掉，检查网站真正的默认值
  await page.addInitScript(() => { delete window.TIMELINE_DATASET; });
  const requested = [];
  page.on('request', (req) => { if (/\/data\/[^/]+\.json$/.test(new URL(req.url()).pathname)) requested.push(new URL(req.url()).pathname); });
  await page.goto('/');
  await expect(page.locator('.card').first()).toBeVisible();
  await waitForStableLayout(page);
  expect(requested).toEqual(['/data/cn_zh.json']);
  const title = await page.locator('.card .card-title').first().textContent();
  expect(events.map((e) => e.title)).toContain(title);
  expect(new URL(page.url()).searchParams.has('data')).toBe(false);
});
