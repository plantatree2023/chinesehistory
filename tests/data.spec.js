// 数据集字段检查：事件类型（type）与重要程度（majorScore）。其他字段见 cover-images、filters 等测试。
const { test, expect, loadDataset } = require('./helpers');
const { validateDataset } = require('../server');

test('每个事件都有类型和重要程度：类型在 types 列表中，重要程度为 1–10 的整数；不再使用旧的 major 字段', async ({ page }) => {
  const data = await loadDataset(page);
  const names = data.types.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  // 类型颜色用作标签底色（上面是白字），对比度至少 4.5
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
  }
  // 每个类型都有事件，三个等级都有事件
  for (const n of names) expect(data.events.some((e) => e.type === n), n).toBe(true);
  const tiers = new Set(data.events.map((e) => (e.majorScore >= 8 ? 3 : e.majorScore >= 6 ? 2 : 1)));
  expect([...tiers].sort()).toEqual([1, 2, 3]);
});

test('服务器校验类型和重要程度', async ({ page }) => {
  const data = await loadDataset(page);
  const clone = () => JSON.parse(JSON.stringify(data));
  expect(() => validateDataset('cn_zh', data)).not.toThrow();
  const bad = [
    ['重要程度超出范围', (d) => { d.events[0].majorScore = 11; }, 'majorScore'],
    ['重要程度不是整数', (d) => { d.events[0].majorScore = 5.5; }, 'majorScore'],
    ['类型不在列表中', (d) => { d.events[0].type = '不存在的类型'; }, 'type'],
    ['类型为空', (d) => { d.events[0].type = ' '; }, 'type'],
    ['类型名重复', (d) => { d.types.push({ ...d.types[0] }); }, '重复'],
    ['类型颜色格式错误', (d) => { d.types[0].color = 'red'; }, 'color'],
  ];
  for (const [what, mutate, msg] of bad) {
    const d = clone();
    mutate(d);
    expect(() => validateDataset('cn_zh', d), what).toThrow(msg);
  }
  // 两个字段都是可选的：缺少时网页按“未分类”、重要程度 5 显示
  const d = clone();
  delete d.events[0].type;
  delete d.events[0].majorScore;
  delete d.types;
  expect(() => validateDataset('cn_zh', d)).not.toThrow();
});
