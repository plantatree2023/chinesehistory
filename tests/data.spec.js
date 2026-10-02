// 数据集字段检查：事件类型（type）、重要程度（majorScore）与参考链接（sources）。其他字段见 cover-images、filters 等测试。
// 数据完整性检查 data/ 下的所有数据集；服务器校验规则用测试数据（tests/data/）检查。
const { test, expect, loadDataset, DATASET, DATA_URL, REAL_DATASETS, readRealDataset, readTestData } = require('./helpers');
const { validateDataset } = require('../server');

for (const id of REAL_DATASETS) test(`${id}：每个事件都有类型和重要程度：类型在 types 列表中，重要程度为 1–10 的整数；不再使用旧的 major 字段`, () => {
  const data = readRealDataset(id);
  const names = data.types.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  // 类型颜色用作标签的文字和描边（浅色背景上），对比度至少 4.5
  const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  for (const t of data.types) {
    expect(t.key, t.name).toMatch(/^[a-z]+$/);
    expect(t.color, t.name).toMatch(/^#[0-9a-f]{6}$/i);
    expect(1.05 / (lum(t.color) + 0.05), `${t.name} 标签的对比度`).toBeGreaterThanOrEqual(4.5);
  }
  for (const ev of data.events) {
    expect(names, `${ev.title} 的类型`).toContain(ev.type);
    expect(Number.isInteger(ev.majorScore) && ev.majorScore >= 1 && ev.majorScore <= 10, `${ev.title} 的重要程度`).toBe(true);
    expect(ev, ev.title).not.toHaveProperty('major');
    // 参考链接：sources 数组，每条都是 http(s) 网址；旧的单个 source 字段不再使用
    expect(ev, ev.title).not.toHaveProperty('source');
    expect(Array.isArray(ev.sources), `${ev.title} 的参考链接`).toBe(true);
    for (const src of ev.sources) expect(src.url, ev.title).toMatch(/^https?:\/\/\S+$/);
  }
  // 每个类型都有事件，三个等级都有事件
  for (const n of names) expect(data.events.some((e) => e.type === n), n).toBe(true);
  const tiers = new Set(data.events.map((e) => (e.majorScore >= 8 ? 3 : e.majorScore >= 6 ? 2 : 1)));
  expect([...tiers].sort()).toEqual([1, 2, 3]);
});

test('data/ 下的所有数据集都通过服务器校验', () => {
  expect(REAL_DATASETS).toContain('cn_zh');
  for (const id of REAL_DATASETS) expect(() => validateDataset(id, readRealDataset(id)), id).not.toThrow();
});

test('服务器校验类型、重要程度和参考链接', async ({ page }) => {
  const data = await loadDataset(page);
  const clone = () => JSON.parse(JSON.stringify(data));
  expect(() => validateDataset(DATASET, data)).not.toThrow();
  const bad = [
    ['重要程度超出范围', (d) => { d.events[0].majorScore = 11; }, 'majorScore'],
    ['重要程度不是整数', (d) => { d.events[0].majorScore = 5.5; }, 'majorScore'],
    ['类型不在列表中', (d) => { d.events[0].type = '不存在的类型'; }, 'type'],
    ['类型为空', (d) => { d.events[0].type = ' '; }, 'type'],
    ['类型名重复', (d) => { d.types.push({ ...d.types[0] }); }, '重复'],
    ['类型颜色格式错误', (d) => { d.types[0].color = 'red'; }, 'color'],
    ['参考链接不是数组', (d) => { d.events[0].sources = 'https://example.org'; }, 'sources'],
    ['参考链接网址无效', (d) => { d.events[0].sources = [{ url: 'javascript:alert(1)' }]; }, 'http'],
    ['参考链接超过 10 条', (d) => { d.events[0].sources = [...Array(11)].map((_, i) => ({ url: `https://example.org/${i}` })); }, '10'],
    ['使用旧的 source 字段', (d) => { d.events[0].source = 'https://example.org'; }, 'sources'],
  ];
  for (const [what, mutate, msg] of bad) {
    const d = clone();
    mutate(d);
    expect(() => validateDataset(DATASET, d), what).toThrow(msg);
  }
  // 两个字段都是可选的：缺少时网页按“未分类”、重要程度 5 显示
  const d = clone();
  delete d.events[0].type;
  delete d.events[0].majorScore;
  delete d.types;
  expect(() => validateDataset(DATASET, d)).not.toThrow();
});

test('测试服务器同时提供测试数据（tests/data/）和 data/ 下的真实数据，测试页面默认使用测试数据', async ({ page, request }) => {
  const served = await (await request.get(DATA_URL)).json();
  expect(served.id).toBe(DATASET);
  expect(served).toEqual(readTestData());
  for (const id of REAL_DATASETS) expect((await (await request.get(`/data/${id}.json`)).json()).id, id).toBe(id);
  await page.goto('/');
  expect(await page.evaluate(() => window.TIMELINE_DATASET)).toBe(DATASET);
});
