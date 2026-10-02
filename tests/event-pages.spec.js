// 事件静态页（tools/build-site.js 为 data/ 下每个数据集的每个事件生成静态页）、sitemap.xml 和 robots.txt：
// 默认数据集 cn_zh 在 e/<事件id>.html，其他数据集在 e/<数据集>/<事件id>.html。
// 在临时目录中构建网站，用简单的静态服务器分别从根路径（Cloudflare）和子路径 /chinesehistory/（GitHub Pages）提供
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { test, expect } = require('./helpers');
const { build, buildEventPages, listDatasets, eventPath, pageStrings, HOMEPAGE, DEFAULT_DATASET, DATASET_ID } = require('../tools/build-site');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DATASETS = listDatasets(DATA_DIR);
const loadData = (ds) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${ds}.json`), 'utf8'));
const SUBPATH = '/chinesehistory/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

let siteDir;
let server;
let origin;
const read = (rel) => fs.readFileSync(path.join(siteDir, rel), 'utf8');
const UNESC = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const meta = (html, re) => { const v = (html.match(re) || [])[1]; return v && v.replace(/&(amp|lt|gt|quot|#39);/g, (m) => UNESC[m]); };

test.beforeAll(async () => {
  siteDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chinesehistory-site-')), 'site');
  build(siteDir);
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith(SUBPATH)) p = p.slice(SUBPATH.length - 1);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(siteDir, p);
    if (!file.startsWith(siteDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(path.dirname(siteDir), { recursive: true, force: true });
});

test('部署的首页简介（description / og / twitter）来自默认数据集的 description 字段', () => {
  const { description } = loadData(DEFAULT_DATASET);
  expect(description).toBeTruthy();
  const html = read('index.html');
  for (const re of [/<meta name="description" content="([^"]*)">/, /<meta property="og:description" content="([^"]*)">/, /<meta name="twitter:description" content="([^"]*)">/]) {
    expect(meta(html, re)).toBe(description);
  }
});

test('构建脚本处理 data/ 下所有数据集，命名规则与网页（js/app.js）相同，默认数据集在最前', () => {
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  expect(app).toContain(`var DATASET_ID = ${DATASET_ID.toString()};`);
  expect(app).toContain(`var DEFAULT_DATASET = window.TIMELINE_DATASET || '${DEFAULT_DATASET}';`);
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  expect([...DATASETS].sort()).toEqual(files.filter((f) => DATASET_ID.test(f)).sort());
  expect(DATASETS[0]).toBe(DEFAULT_DATASET);
  expect(DATASETS).toContain('cn_zh-v0');
});

for (const ds of DATASETS) {
  test(`${ds}：每个事件都生成静态页，标题、描述、canonical、og 信息正确，图片和链接都用本地相对路径`, async () => {
    const data = loadData(ds);
    const dir = ds === DEFAULT_DATASET ? 'e' : `e/${ds}`;
    const up = ds === DEFAULT_DATASET ? '../' : '../../';
    const q = ds === DEFAULT_DATASET ? '' : `data=${ds}&amp;`;
    const L = pageStrings(ds);   // 页面文字按数据集的语言
    const files = fs.readdirSync(path.join(siteDir, dir)).filter((f) => f.endsWith('.html')).sort();
    expect(files).toEqual(data.events.map((ev) => `${ev.id}.html`).sort());
    for (const ev of data.events) {
      const rel = eventPath(ds, ev);
      expect(rel).toBe(`${dir}/${ev.id}.html`);
      const html = read(rel);
      const url = HOMEPAGE + rel;
      expect(meta(html, /<title>([^<]*)<\/title>/), ev.id).toBe(`${ev.title} · ${L.siteName}`);
      expect(html).toContain(`<html lang="${L.htmlLang}">`);
      expect(html).toContain(`<link rel="canonical" href="${url}">`);
      expect(html).toContain(`<meta property="og:url" content="${url}">`);
      expect(meta(html, /<meta property="og:title" content="([^"]*)">/)).toBe(`${ev.title} · ${L.siteName}`);
      expect(html).toMatch(/<meta name="description" content="[^"]+">/);
      expect(html).toContain(`<a class="ev-open" href="${up}?${q}id=${ev.id}">${L.open}</a>`);
      expect(html).toContain(`<link rel="stylesheet" href="${up}css/event.css">`);
      const imgs = (ev.images || []).filter((im) => im.src);
      const og = meta(html, /<meta property="og:image" content="([^"]*)">/);
      if (imgs.length) expect(og).toBe(HOMEPAGE + imgs[0].src);
      else expect(og).toBeUndefined();
      // 图片：相对路径指向 images/<文件名>，带宽高和懒加载，文件存在
      const srcs = [...html.matchAll(/<img src="([^"]+)"([^>]*)>/g)];
      expect(srcs.map((m) => m[1])).toEqual(imgs.map((im) => up + im.src));
      for (const [, src, attrs] of srcs) {
        expect(fs.existsSync(path.join(siteDir, dir, src)), src).toBe(true);
        expect(attrs).toMatch(/width="\d+" height="\d+"/);
        expect(attrs).toContain('loading="lazy"');
      }
      // 不引用外部脚本、样式；页面中的地址除参考链接和 head 中的绝对地址外都是相对路径
      expect(html).not.toMatch(/<script[^>]+src=/);
      expect(html).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="(https?:|\/)/);
      expect(html).not.toMatch(/(src|href)="\/(?!\/)/);
    }
  });
}

test('事件页的文字按数据集的语言显示：中文数据集用中文，英文数据集（cn_en）用英文，没有对应语言时用中文', () => {
  expect(pageStrings('cn_zh')).toMatchObject({ htmlLang: 'zh-CN', siteName: '时间上的中国', open: '在时间轴中查看' });
  expect(pageStrings('cn_zh-v0').htmlLang).toBe('zh-CN');
  expect(pageStrings('cn_en')).toMatchObject({ htmlLang: 'en', siteName: 'China Through Time', open: 'View on the timeline' });
  expect(pageStrings('jp_xx')).toBe(pageStrings('cn_zh'));
  // 英文页面中除时期颜色等以外没有中文；网站名与界面的英文翻译（js/i18n/en.js）一致
  const en = DATASETS.find((d) => d.split('_')[1].split('-')[0] === 'en');
  if (!en) return;
  const html = read(eventPath(en, loadData(en).events[0]));
  expect(html.replace(/<link rel="icon"[^>]*>/, '').replace(/<script>[\s\S]*?<\/script>/g, '')).not.toMatch(/[\u3400-\u9fff]/);
  global.window = {};
  require('../js/i18n/en.js');
  expect(window.TIMELINE_I18N.en.siteName).toBe(pageStrings(en).siteName);
  delete global.window;
});

test('sitemap.xml 列出首页和所有数据集的事件页的绝对地址，robots.txt 指向 sitemap', async () => {
  const xml = read('sitemap.xml');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs[0]).toBe(HOMEPAGE);
  const expected = DATASETS.flatMap((ds) => loadData(ds).events.map((ev) => HOMEPAGE + eventPath(ds, ev)));
  expect(locs.slice(1).sort()).toEqual(expected.sort());
  expect(new Set(locs).size).toBe(locs.length);
  expect(read('robots.txt')).toContain(`Sitemap: ${HOMEPAGE}sitemap.xml`);
});

test('首页带 canonical，指向网站首页', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  expect(html).toContain(`<link rel="canonical" href="${HOMEPAGE}">`);
});

test('新增数据集不需要改代码：自动生成页面；缺少时期、图片、参考链接等字段，或文件有误时也能构建', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chinesehistory-datasets-'));
  try {
    const dataDir = path.join(tmp, 'data');
    const out = path.join(tmp, 'site');
    fs.mkdirSync(dataDir);
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(dataDir, 'jp_ja.json'), JSON.stringify({
      id: 'jp_ja',
      events: [
        { id: 'j002', year: 1603, date: '1603年', title: '江户幕府', short: '德川家康开设幕府。' },
        { id: 'j001', year: 794, title: '平安京', detail: '第一段\n第二段' },
        { title: '没有 id 的事件' },
        { id: 'j002', year: 1700, title: '重复的 id' },
      ],
    }));
    fs.writeFileSync(path.join(dataDir, 'xx_yy.json'), '{ 不是 JSON');
    fs.writeFileSync(path.join(dataDir, 'notes.json'), '{}');   // 名称不符合规则，不是数据集
    const pages = buildEventPages(out, dataDir);
    expect(Object.keys(pages)).toEqual(['jp_ja']);
    expect(fs.readdirSync(path.join(out, 'e'))).toEqual(['jp_ja']);
    expect(fs.readdirSync(path.join(out, 'e', 'jp_ja')).sort()).toEqual(['j001.html', 'j002.html']);
    // 按年份排列：上一个 / 下一个
    const j001 = fs.readFileSync(path.join(out, 'e', 'jp_ja', 'j001.html'), 'utf8');
    expect(j001).toContain('<a class="ev-next" rel="next" href="j002.html">');
    expect(j001).not.toContain('ev-prev');
    expect(j001).not.toContain('ev-era');
    expect(j001).toContain('<p>第一段</p>');
    expect(j001).toContain('href="../../?data=jp_ja&amp;id=j001"');
    expect(j001).toContain('<a href="../../?data=jp_ja">返回首页');
    const xml = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
    expect(xml).toContain(`${HOMEPAGE}e/jp_ja/j001.html`);
    expect(xml).toContain(`${HOMEPAGE}e/jp_ja/j002.html`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test.describe('不运行脚本也能完整显示', () => {
  test.use({ javaScriptEnabled: false });

  test('标题、时间、简介、详细说明、图片、参考链接、所属时期、上一个 / 下一个事件', async ({ page }) => {
    const data = loadData(DEFAULT_DATASET);
    const ev = data.events.find((e) => e.id === 'e052');
    await page.goto(`${origin}/e/e052.html`);
    await expect(page.locator('h1')).toHaveText(ev.title);
    await expect(page.locator('.ev-date')).toContainText(ev.date);
    await expect(page.locator('.ev-short')).toHaveText(ev.short);
    await expect(page.locator('.ev-detail')).toContainText(ev.detail.split('\n')[0].trim().slice(0, 30));
    await expect(page.locator('.ev-era')).toContainText(/唐/);
    await expect(page.locator('.ev-sources a')).toHaveCount(ev.sources.length);
    await expect(page.locator('.ev-open')).toBeVisible();
    // 样式已加载（按钮是圆角按钮）
    expect(await page.locator('.ev-open').evaluate((a) => getComputedStyle(a).borderRadius)).not.toBe('0px');
    // 上一个 / 下一个事件
    await page.click('.ev-next');
    await expect(page).toHaveURL(/\/e\/e\d+\.html$/);
    await expect(page.locator('h1')).not.toHaveText(ev.title);
    await page.click('.ev-prev');
    await expect(page.locator('h1')).toHaveText(ev.title);
    // 第一个事件没有“上一个”，最后一个没有“下一个”
    const sorted = [...data.events].sort((a, b) => a.year - b.year);
    await page.goto(`${origin}/e/${sorted[0].id}.html`);
    await expect(page.locator('.ev-prev')).toHaveCount(0);
    await page.goto(`${origin}/e/${sorted[sorted.length - 1].id}.html`);
    await expect(page.locator('.ev-next')).toHaveCount(0);
  });

  test('其他数据集的页面（e/<数据集>/）样式和图片的相对路径正确，上一个 / 下一个留在同一数据集', async ({ page }) => {
    const ds = DATASETS.find((d) => d !== DEFAULT_DATASET);
    const ev = loadData(ds).events.find((e) => (e.images || []).length);
    await page.goto(`${origin}${SUBPATH}e/${ds}/${ev.id}.html`);
    await expect(page.locator('h1')).toHaveText(ev.title);
    expect(await page.locator('.ev-open').evaluate((a) => getComputedStyle(a).borderRadius)).not.toBe('0px');
    const img = page.locator('.ev-figure img').first();
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
    await page.click('.ev-next');
    await expect(page).toHaveURL(new RegExp(`/e/${ds}/[^/]+\\.html$`));
  });
});

test('深色模式：沿用首页选过的配色', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('zh-history-timeline:theme', 'dark'));
  await page.goto(`${origin}/e/e052.html`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(27, 24, 21)');   // 深色的 --paper
});

for (const ds of DATASETS) {
  for (const base of ['/', SUBPATH]) {
    test(`${ds}：“在时间轴中查看”打开该数据集的时间轴并显示事件详情（${base === '/' ? '根路径' : 'GitHub Pages 子路径'}）`, async ({ page }) => {
      const ev = loadData(ds).events.find((e) => e.id === 'e052') || loadData(ds).events[0];
      const query = ds === DEFAULT_DATASET ? '' : `data=${ds}&`;
      const pageUrl = `${origin}${base}${eventPath(ds, ev)}`;
      // 构建出的网站用 data/ 中的真实数据：去掉测试中的默认数据集替换（window.TIMELINE_DATASET）
      await page.addInitScript(() => { delete window.TIMELINE_DATASET; });
      // 时间轴会在网址中补上 at（当前年份）等参数
      const at = (rest) => (url) => url.href.startsWith(origin + base) && new RegExp(rest).test(url.href.slice((origin + base).length));
      await page.goto(pageUrl);
      await expect(page.locator('h1')).toHaveText(ev.title);
      await page.click('.ev-open');
      await expect(page).toHaveURL(at(`^\\?${query}id=${ev.id}(&|$)`));
      await expect(page.locator('#detailModal')).toBeVisible();
      await expect(page.locator('#detailTitle')).toHaveText(ev.title);
      // 返回首页的链接（其他数据集带 data 参数）
      await page.goto(pageUrl);
      await page.click('.ev-foot a');
      await expect(page).toHaveURL(at(query ? `^\\?data=${ds}(&|$)` : '^(\\?|$)'));
      await expect(page.locator('.card').first()).toBeVisible();
    });
  }
}
