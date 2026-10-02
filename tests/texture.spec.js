// 背景纹理：由数据集的 texture 字段配置（每个国家 / 语言可以不同），只从本地 textures/ 加载；
// 纹理清淡、不随时间轴移动、不挡住操作，深浅两种配色都适配。
const fs = require('fs');
const path = require('path');
const { validateDataset } = require('../server');
const { test, expect, openApp, loadDataset, trackOffset, DATA_URL } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
test.use({ viewport: { width: 1440, height: 860 } });

const layerState = (page) => page.evaluate(() => {
  const el = document.getElementById('bgTexture');
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    hidden: el.hidden, display: cs.display,
    mask: cs.maskImage || cs.webkitMaskImage, size: cs.maskSize || cs.webkitMaskSize,
    opacity: Number(cs.opacity), color: cs.backgroundColor, pointer: cs.pointerEvents,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
});

// 用另一份数据打开：修改数据集中的 texture
const withTexture = (page, texture) => page.route(`**${DATA_URL}`, async (route) => {
  const data = await (await route.fetch()).json();
  if (texture === undefined) delete data.texture; else data.texture = texture;
  await route.fulfill({ json: data });
});

test('按数据集配置显示本地纹理：大小和不透明度来自数据，铺满时间轴区域', async ({ page }) => {
  const { texture } = await loadDataset(page);
  expect(texture.src).toMatch(/^textures\//);
  await openApp(page);
  const s = await layerState(page);
  expect(s.hidden).toBe(false);
  expect(s.display).not.toBe('none');
  expect(s.mask).toContain(texture.src);
  expect(s.size).toContain(`${texture.size}px`);
  expect(s.opacity).toBeCloseTo(texture.opacity, 5);
  expect(s.opacity, '纹理要清淡').toBeLessThanOrEqual(0.3);
  const stage = await page.locator('#stage').boundingBox();
  expect(s.rect).toEqual({ x: stage.x, y: stage.y, w: stage.width, h: stage.height });
  // 纹理文件确实能加载
  const res = await page.request.get('/' + texture.src);
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toBe('image/svg+xml');
});

test('纹理在卡片和时间轴后面，不挡住点击；拖动时间轴时纹理不动', async ({ page }) => {
  await openApp(page);
  expect((await layerState(page)).pointer).toBe('none');
  const card = page.locator('.card').first();
  const box = await card.boundingBox();
  const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y).closest('.card'), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(hit).toBe(true);
  const before = (await layerState(page)).rect;
  await page.locator('#stage').focus();
  await page.keyboard.press('End');
  await expect.poll(() => trackOffset(page)).toBeLessThan(-1000);
  expect((await layerState(page)).rect).toEqual(before);
});

test('颜色随配色变化：浅色模式为深色线条，深色模式为浅色线条', async ({ page }) => {
  const lum = (rgb) => { const m = rgb.match(/[\d.]+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  await openApp(page);
  const light = (await layerState(page)).color;
  await page.click('#themeToggle');
  await expect.poll(async () => (await layerState(page)).color).not.toBe(light);
  const dark = (await layerState(page)).color;
  expect(lum(light)).toBeLessThan(128);
  expect(lum(dark)).toBeGreaterThan(128);
});

test('其他数据集可以使用自己的纹理；没有配置时不显示', async ({ page }) => {
  await withTexture(page, { src: 'textures/cn-huiwen.svg' });
  await openApp(page);
  const s = await layerState(page);
  expect(s.mask).toContain('textures/cn-huiwen.svg');
  expect(s.size, '没有 size 时使用图片本身的大小').toBe('auto');
  expect(s.opacity).toBeCloseTo(0.06, 5);

  await page.unroute(`**${DATA_URL}`);
  await withTexture(page, undefined);
  await page.reload();
  await expect(page.locator('.card').first()).toBeVisible();
  expect((await layerState(page)).display).toBe('none');
});

test('服务器校验纹理：只能是 textures/ 下的本地图片，大小、不透明度在范围内', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cn_zh.json'), 'utf8'));
  expect(() => validateDataset('cn_zh', data)).not.toThrow();
  const bad = [
    [{ src: 'https://example.com/a.svg' }, 'texture.src'],
    [{ src: 'images/a.svg' }, 'texture.src'],
    [{ src: 'textures/../x.svg' }, 'texture.src'],
    [{ src: 'textures/a.gif' }, 'texture.src'],
    ['textures/a.svg', 'texture.src'],
    [{ src: 'textures/a.svg', size: 0 }, 'texture.size'],
    [{ src: 'textures/a.svg', size: '100' }, 'texture.size'],
    [{ src: 'textures/a.svg', opacity: 0.5 }, 'texture.opacity'],
    [{ src: 'textures/a.svg', opacity: -0.1 }, 'texture.opacity'],
  ];
  for (const [texture, msg] of bad) {
    expect(() => validateDataset('cn_zh', { ...data, texture }), JSON.stringify(texture)).toThrow(msg);
  }
  const { texture, ...noTexture } = data;
  expect(() => validateDataset('cn_zh', noTexture)).not.toThrow();
});

test('纹理文件：数据引用的文件存在；都是不引用外部资源的 SVG，体积小；部署时会一起发布', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cn_zh.json'), 'utf8'));
  expect(fs.existsSync(path.join(ROOT, data.texture.src))).toBe(true);
  const files = fs.readdirSync(path.join(ROOT, 'textures'));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    expect(f).toMatch(/^[a-z]{2}-[a-z0-9-]+\.svg$/);
    const svg = fs.readFileSync(path.join(ROOT, 'textures', f), 'utf8');
    expect(svg, f).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+"/);
    expect(svg.replace('http://www.w3.org/2000/svg', ''), `${f} 不引用外部资源`).not.toMatch(/https?:|href=/);
    expect(svg.length, f).toBeLessThan(20 * 1024);
  }
  expect(require('../tools/build-site').SITE_FILES).toContain('textures');   // 部署时复制（tools/build-site.js）
});
