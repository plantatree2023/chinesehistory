// 维基百科导入脚本（tools/wiki-import.js）：新增 / 更新条目、条目表、dry run、搜索与年份来源、下载图片、错误处理。
// 每个测试启动一个模拟的维基百科 + Wikidata 服务，并对临时数据副本运行脚本；不访问外网，不改动仓库中的真实数据。
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { validateDataset } = require('../server');
const { imageSize } = require('../tools/wiki-import');
const { makePng: png, TEST_DATA_FILE } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'tools', 'wiki-import.js');
// 用测试数据（tests/data/cn_zh-test.json）的副本做导入；副本命名为 cn_zh.json，因为维基语言由文件名决定
const REPO_DATA = TEST_DATA_FILE;
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const LONG_TEXT = '这是一段很长的维基百科简介文字，用来检验详细说明会在句末截断并控制在六百字以内。'.repeat(20);

// 模拟的维基条目：summary（简介）、media（图片列表）、entity（Wikidata 时间）
function page(title, extract, { qid, images = [], thumbnail } = {}) {
  return {
    summary: { type: 'standard', title, titles: { canonical: title.replace(/ /g, '_') }, extract, wikibase_item: qid, thumbnail },
    media: {
      items: images.map((src, i) => ({
        title: `File:${path.basename(src)}`, type: 'image', leadImage: i === 0,
        caption: { text: `图注${i + 1}` }, srcset: [{ src: src.replace(/^https:/, ''), scale: '1x' }],
      })),
    },
  };
}
const time = (t, precision = 9) => ({ claims: { P585: [{ mainsnak: { datavalue: { value: { time: t, precision } } } }] } });
// Wikidata 条目：时间、性质（P31）与语言版本数（sitelinks）
const entity = (t, { p31 = [], links = 0 } = {}) => ({
  claims: { ...(t ? time(t).claims : {}), P31: p31.map((id) => ({ mainsnak: { datavalue: { value: { id } } } })) },
  sitelinks: Object.fromEntries([...Array(links)].map((_, i) => [`l${i}wiki`, { title: 'x' }])),
});

function mockWiki(pages, entities, { searchMap = {}, rateLimitOnce = [], files = IMAGE_FILES } = {}) {
  const hits = [];
  const limited = new Set(rateLimitOnce);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    hits.push(p);
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (limited.has(p)) { limited.delete(p); send(429, { error: 'rate limited' }); return; }
    let m;
    if ((m = /^\/api\/rest_v1\/page\/summary\/(.+)$/.exec(p))) {
      const pg = pages[m[1].replace(/_/g, ' ')];
      return pg ? send(200, pg.summary) : send(404, {});
    }
    if ((m = /^\/api\/rest_v1\/page\/media-list\/(.+)$/.exec(p))) {
      const pg = pages[m[1].replace(/_/g, ' ')];
      return pg ? send(200, pg.media) : send(404, {});
    }
    if (p === '/w/rest.php/v1/search/page') {
      const key = searchMap[url.searchParams.get('q')];
      return send(200, { pages: key ? [{ key, title: key }] : [] });
    }
    if ((m = /^\/img\/(.+)$/.exec(p))) {
      const f = files[m[1]];
      if (!f) return send(404, {});
      res.writeHead(200, { 'Content-Type': f.type });
      res.end(f.body);
      return;
    }
    if ((m = /^\/wiki\/Special:EntityData\/(Q\d+)\.json$/.exec(p))) {
      return entities[m[1]] ? send(200, { entities: { [m[1]]: entities[m[1]] } }) : send(404, {});
    }
    send(404, {});
  });
  return { server, hits };
}

let tmp, dataFile, repoHash, copyHash, wiki;
// 仓库数据中的事件数（导入前）
const REPO_EVENTS = JSON.parse(fs.readFileSync(REPO_DATA, 'utf8')).events;
const REPO_COUNT = REPO_EVENTS.length;
// 新条目的编号：现有最大编号加一
const NEXT_ID = `e${String(Math.max(...REPO_EVENTS.map((e) => Number(e.id.slice(1)))) + 1).padStart(3, '0')}`;

test.beforeEach(() => {
  repoHash = sha256(REPO_DATA);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-import-'));
  // 与仓库相同的目录结构：<根目录>/data/cn_zh.json，下载的图片存到 <根目录>/images/
  dataFile = path.join(tmp, 'data', 'cn_zh.json');
  fs.mkdirSync(path.dirname(dataFile));
  fs.writeFileSync(dataFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(REPO_DATA, 'utf8')), id: 'cn_zh' }, null, 2) + '\n');
  copyHash = sha256(dataFile);
});

test.afterEach(async () => {
  if (wiki) await new Promise((r) => wiki.server.close(r));
  wiki = null;
  fs.rmSync(tmp, { recursive: true, force: true });
  expect(sha256(REPO_DATA), '仓库中的测试数据文件不应被测试改动').toBe(repoHash);
});

// pages 可以是函数：参数为模拟服务的地址，便于让图片地址指向模拟服务
async function startWiki(pages, entities = {}, opts) {
  const live = {};
  wiki = mockWiki(live, entities, opts);
  await new Promise((r) => wiki.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${wiki.server.address().port}`;
  Object.assign(live, typeof pages === 'function' ? pages(base) : pages);
  return base;
}


function run(args, base) {
  return new Promise((resolve) => {
    execFile('node', [SCRIPT, ...args, '--delay', '0'], {
      cwd: ROOT,
      env: { ...process.env, WIKIPEDIA_BASE: base || 'http://127.0.0.1:9', WIKIDATA_BASE: base || 'http://127.0.0.1:9', WIKI_RETRY_BASE_MS: '10' },
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

// 测试图片：仓库中一张已知尺寸的 JPEG，以及生成的 PNG；由模拟服务的 /img/ 提供
const jpegRef = JSON.parse(fs.readFileSync(REPO_DATA, 'utf8')).events.flatMap((e) => e.images).find((i) => /\.jpg$/.test(i.src) && i.w);
const jpeg = fs.readFileSync(path.join(ROOT, jpegRef.src));
const red = png(40, 30, 200);
const IMAGE_FILES = {
  'a.png': { body: red, type: 'image/png' },
  'same-bytes.png': { body: red, type: 'image/png' },
  'b.jpg': { body: jpeg, type: 'image/jpeg' },
  'Flag_of_X.svg': { body: Buffer.from('<svg/>'), type: 'image/svg+xml' },
  'page.html': { body: Buffer.from('<html>not an image</html>'), type: 'text/html' },
};
const LOCAL_SRC = /^images\/[0-9a-f]{16}\.(png|jpg)$/;

const imagesDir = () => path.join(tmp, 'images');
const readData = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const find = (title) => readData().events.find((e) => e.title === title);
const charCount = (t) => t.replace(/[\s，。、；：“”‘’《》（）！？·—…,.;:()!?"'-]/g, '').length;

test.describe('单个关键词', () => {
  test('新增条目：年份来自 Wikidata，生成说明和来源，图片下载到本地，并按年份排序写入', async () => {
    const base = await startWiki((b) => ({
      '测试战役': page('测试战役', `测试战役是一场用于自动化测试的虚构战役（英语：Test Battle），发生于战国时代。${LONG_TEXT}`, {
        qid: 'Q1', images: [`${b}/img/a.png`, `${b}/img/Flag_of_X.svg`, `${b}/img/b.jpg`],
      }),
    }), { Q1: entity('-0260-00-00T00:00:00Z', { p31: ['Q178561'], links: 50 }) });

    const t0 = Math.floor(Date.now() / 1000);
    const r = await run(['--file', dataFile, '测试战役'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('+ 新增 测试战役');
    expect(r.stdout).toContain('已下载 2 张图片到本地');

    const data = readData();
    expect(data.events).toHaveLength(REPO_COUNT + 1);
    const ev = find('测试战役');
    expect(ev).toMatchObject({ id: NEXT_ID, year: -260, date: '前260年', wiki: '测试战役', type: '战争', majorScore: 6 });
    expect(ev).not.toHaveProperty('major');
    // 最后修改时间：当前时间，单位秒
    expect(Number.isInteger(ev.updatedAt) && ev.updatedAt >= t0 && ev.updatedAt <= Math.floor(Date.now() / 1000)).toBe(true);
    // Wikidata 性质为“战役”（Q178561）→ 战争；50 个语言版本 → 重要程度 6；都提示核对
    expect(r.stdout).toContain('类型 战争，重要程度 6');
    expect(r.stdout).toContain('类型“战争”由 Wikidata 性质推断，请核对');
    expect(r.stdout).toContain('重要程度 6 根据 Wikidata 语言版本数（50 个）估算，请核对');
    expect(ev.sources).toEqual([{ url: `${base}/wiki/${encodeURIComponent('测试战役')}` }]);
    expect(ev).not.toHaveProperty('source');
    expect(ev.detail.length).toBeLessThanOrEqual(600);
    expect(ev.detail.length, '超过 350 字的说明不再截短').toBeGreaterThan(350);
    expect(ev.detail).toMatch(/。$/);   // 在句末截断
    expect(ev.detail).not.toContain('英语');
    expect(charCount(ev.short)).toBeGreaterThanOrEqual(20);
    expect(ev.short.length).toBeLessThanOrEqual(60);
    // 旗帜 / SVG 被过滤；图片只保存本地路径与宽高，没有外部地址
    expect(ev.images).toHaveLength(2);
    expect(ev.images[0]).toMatchObject({ w: 40, h: 30, caption: '图注1' });
    expect(ev.images[1]).toMatchObject({ w: jpegRef.w, h: jpegRef.h });
    for (const img of ev.images) {
      expect(img.src).toMatch(LOCAL_SRC);
      expect(Object.keys(img).sort()).toEqual(['caption', 'h', 'src', 'w']);
      expect(fs.existsSync(path.join(tmp, img.src))).toBe(true);
    }
    // 仍按年份排序，且能通过网站服务器的数据校验
    const years = data.events.map((e) => e.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(() => validateDataset('cn_zh', data)).not.toThrow();
  });

  test('更新已存在的条目：只更新来自维基的内容，保留人工内容和已有图片', async () => {
    const before = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const target = before.events.find((e) => e.images.length >= 2);
    target.majorScore = 9;
    target.type = '社会';
    fs.writeFileSync(dataFile, JSON.stringify(before, null, 2));
    const base = await startWiki((b) => ({
      [target.title]: page(target.title, `更新后的简介：${target.title}是一个重要的历史事件，这段文字来自模拟的维基百科。`, {
        images: [`${b}/img/a.png`],
      }),
    }));

    const t0 = Math.floor(Date.now() / 1000);
    const r = await run(['--file', dataFile, target.title], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain(`~ 更新 ${target.title}`);
    const ev = find(target.title);
    expect(readData().events).toHaveLength(before.events.length);
    expect(ev.detail).toContain('更新后的简介');
    // 人工设定的类型和重要程度保留，不查询 Wikidata
    expect(ev).toMatchObject({ id: target.id, year: target.year, date: target.date, short: target.short, majorScore: 9, type: '社会' });
    expect(wiki.hits.some((h) => h.includes('EntityData'))).toBe(false);
    expect(ev.images, '已有图片保持不变').toEqual(target.images);
    // 改动的事件更新最后修改时间（秒），其他事件不变
    expect(ev.updatedAt).toBeGreaterThanOrEqual(t0);
    for (const e of readData().events) if (e.id !== target.id) expect(e.updatedAt, e.title).toBe(before.events.find((b) => b.id === e.id).updatedAt);
    expect(wiki.hits.some((h) => h.startsWith('/img/')), '不应下载图片').toBe(false);
  });

  test('参考链接：更新同一维基站点的链接并保留标题，其他链接不变；没有维基链接时加在最前面；旧的 source 字段并入', async () => {
    const data = readData();
    const a = data.events.find((e) => e.title === '赤壁之战');
    const b = data.events.find((e) => e.title === '官渡之战');
    const c = data.events.find((e) => e.title === '淝水之战');
    a.sources = [{ url: 'https://example.org/chibi', title: '三国志' }, { url: 'https://zh.wikipedia.org/wiki/old', title: '维基：赤壁' }];
    b.sources = [{ url: 'https://example.org/guandu' }];
    delete c.sources;
    c.source = 'https://example.org/feishui';
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    const base = await startWiki({
      赤壁之战: page('赤壁之战', '赤壁之战的简介，来自模拟的维基百科。'),
      官渡之战: page('官渡之战', '官渡之战的简介，来自模拟的维基百科。'),
      淝水之战: page('淝水之战', '淝水之战的简介，来自模拟的维基百科。'),
    });
    // 模拟服务与真实维基不是同一站点：先把 a 的维基链接改成模拟服务的地址
    const d2 = readData();
    d2.events.find((e) => e.title === '赤壁之战').sources[1].url = `${base}/wiki/old`;
    fs.writeFileSync(dataFile, JSON.stringify(d2, null, 2));

    const r = await run(['--file', dataFile, '赤壁之战', '官渡之战', '淝水之战'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const url = (t) => `${base}/wiki/${encodeURIComponent(t)}`;
    expect(find('赤壁之战').sources).toEqual([{ url: 'https://example.org/chibi', title: '三国志' }, { url: url('赤壁之战'), title: '维基：赤壁' }]);
    expect(find('官渡之战').sources).toEqual([{ url: url('官渡之战') }, { url: 'https://example.org/guandu' }]);
    expect(find('淝水之战').sources).toEqual([{ url: url('淝水之战') }, { url: 'https://example.org/feishui' }]);
    expect(find('淝水之战')).not.toHaveProperty('source');
    expect(() => validateDataset('cn_zh', readData())).not.toThrow();
  });

  test('--refresh-images 用维基图片整组替换已有图片', async () => {
    const target = readData().events.find((e) => e.images.length >= 2);
    const base = await startWiki((b) => ({
      [target.title]: page(target.title, `${target.title}的简介文字，用于测试整组替换图片。`, { images: [`${b}/img/b.jpg`, `${b}/img/a.png`] }),
    }));
    const r = await run(['--file', dataFile, '--refresh-images', target.title], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('已下载 2 张图片到本地');
    const imgs = find(target.title).images;
    expect(imgs.map((i) => [i.w, i.h])).toEqual([[jpegRef.w, jpegRef.h], [40, 30]]);
    imgs.forEach((i) => expect(i.src).toMatch(LOCAL_SRC));
  });

  test('已存在但没有图片的条目会从维基补上图片', async () => {
    const target = readData().events.find((e) => e.images.length === 0);
    const base = await startWiki((b) => ({
      [target.title]: page(target.title, `${target.title}的简介文字，用于测试给没有图片的条目补图。`, { images: [`${b}/img/a.png`] }),
    }));
    const r = await run(['--file', dataFile, target.title], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain(`~ 更新 ${target.title}`);
    expect(r.stdout).toContain('已下载 1 张图片到本地');
    expect(find(target.title).images).toEqual([expect.objectContaining({ w: 40, h: 30, src: expect.stringMatching(LOCAL_SRC) })]);
  });

  test('--year 指定年份时同时更新已存在条目的年份', async () => {
    const target = readData().events[50];
    const base = await startWiki({ [target.title]: page(target.title, `${target.title}的简介文字，用于测试指定年份时的更新行为。`) });
    const r = await run(['--file', dataFile, '--year', '-99', target.title], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(find(target.title)).toMatchObject({ year: -99, date: '前99年' });
  });

  test('条目名查不到时使用搜索，并以关键词作为事件名', async () => {
    const base = await startWiki({
      '测试运动会正式名称': page('测试运动会正式名称', '测试运动会正式名称，通称测试运动会，是一项用于自动化测试的虚构赛事活动。', { qid: 'Q2' }),
    }, { Q2: time('+2008-08-08T00:00:00Z', 11) }, { searchMap: { 测试运动会: '测试运动会正式名称' } });
    const r = await run(['--file', dataFile, '测试运动会'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('维基条目：测试运动会正式名称');
    expect(find('测试运动会')).toMatchObject({ year: 2008, date: '2008年', wiki: '测试运动会正式名称' });
  });

  test('搜索到的条目与关键词无关时不写入', async () => {
    const base = await startWiki({
      '无关条目': page('无关条目', '这是一个与查询关键词完全无关的条目，简介中不包含该关键词。', { qid: 'Q3' }),
    }, { Q3: time('+2011-01-01T00:00:00Z') }, { searchMap: { 乱码关键词: '无关条目' } });
    const r = await run(['--file', dataFile, '乱码关键词'], base);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('✗ 乱码关键词：维基百科中找不到对应条目');
    expect(sha256(dataFile)).toBe(copyHash);
  });

  test('年份来源：Wikidata 精度与远古年份、简介文字，以及无法确定时报错', async () => {
    const base = await startWiki({
      '远古人类': page('远古人类', '远古人类是一种用于测试的虚构古人类，生活在非常久远的旧石器时代早期。', { qid: 'Q4' }),
      '某世纪事件': page('某世纪事件', '某世纪事件是一个只知道世纪、不知道确切年份的虚构历史事件。', { qid: 'Q5' }),
      '文字年份事件': page('文字年份事件', '文字年份事件是一场发生于（1850年）的虚构事件，没有 Wikidata 时间。'),
      '无年份条目': page('无年份条目', '无年份条目是一个没有任何年份信息的虚构条目，用于测试报错。'),
    }, { Q4: time('-1700000-00-00T00:00:00Z', 3), Q5: time('+1200-00-00T00:00:00Z', 7) });
    const r = await run(['--file', dataFile, '远古人类', '某世纪事件', '文字年份事件', '无年份条目'], base);
    expect(r.code).toBe(1);
    expect(find('远古人类')).toMatchObject({ year: -1700000, date: '约170万年前' });
    expect(find('某世纪事件')).toMatchObject({ year: 1200, date: '约1200年' });
    expect(find('文字年份事件')).toMatchObject({ year: 1850, date: '1850年' });
    expect(r.stdout).toContain('年份 1850 取自简介文字，请核对');
    expect(r.stdout).toContain('✗ 无年份条目：无法确定年份');
    expect(find('无年份条目')).toBeUndefined();
  });

  test('遇到限流（HTTP 429）自动重试', async () => {
    const base = await startWiki({
      '限流条目': page('限流条目', '限流条目是一个用于测试维基百科限流后自动重试的虚构条目。', { qid: 'Q6' }),
    }, { Q6: time('+1900-00-00T00:00:00Z') }, { rateLimitOnce: ['/api/rest_v1/page/summary/限流条目'] });
    const r = await run(['--file', dataFile, '限流条目'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(wiki.hits.filter((h) => h === '/api/rest_v1/page/summary/限流条目')).toHaveLength(2);
    expect(find('限流条目')).toBeTruthy();
  });
});

test.describe('类型与重要程度', () => {
  test('类型来源：Wikidata 性质 → 事件名关键词 → 年代（前 2000 年以前为史前）→ 简介关键词；无法判断时不填写', async () => {
    const base = await startWiki({
      // 事件名和简介中都没有线索，只能靠 Wikidata 性质（Q131569 条约）判断
      '某份文书': page('某份文书', '某份文书是两方签署的一项虚构文书，用于测试类型推断。', { qid: 'Q21' }),
      '测试之战': page('测试之战', '测试之战是一个没有 Wikidata 性质的虚构事件，用于测试类型推断。', { qid: 'Q22' }),
      '远古遗存': page('远古遗存', '远古遗存是一处虚构的远古人类遗存，用于测试史前类型。', { qid: 'Q23' }),
      '某某事物': page('某某事物', '某某事物是一次重要的发明，用于测试从简介首句推断类型。', { qid: 'Q24' }),
      '无从判断': page('无从判断', '无从判断是一个用于测试的虚构条目，简介中没有任何线索。', { qid: 'Q25' }),
    }, {
      Q21: entity('+1600-00-00T00:00:00Z', { p31: ['Q131569'], links: 3 }),
      Q22: entity('+1601-00-00T00:00:00Z', { links: 20 }),
      Q23: entity('-5000-00-00T00:00:00Z', { links: 120 }),
      Q24: entity('+1602-00-00T00:00:00Z', { links: 200 }),
      Q25: entity('+1603-00-00T00:00:00Z', { links: 1 }),
    });
    const r = await run(['--file', dataFile, '某份文书', '测试之战', '远古遗存', '某某事物', '无从判断'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(find('某份文书')).toMatchObject({ type: '对外交流', majorScore: 3 });
    expect(r.stdout).toContain('类型“对外交流”由 Wikidata 性质推断');
    expect(find('测试之战')).toMatchObject({ type: '战争', majorScore: 5 });
    expect(find('远古遗存')).toMatchObject({ type: '史前', majorScore: 8 });
    expect(find('某某事物')).toMatchObject({ type: '科技', majorScore: 9 });
    expect(find('无从判断')).toMatchObject({ majorScore: 2 });
    expect(find('无从判断')).not.toHaveProperty('type');
    expect(r.stdout).toContain('类型“战争”由事件名 / 简介中的关键词推断');
    expect(r.stdout).toContain('类型“史前”由年代（前 2000 年以前）推断');
    expect(r.stdout).toContain('无法判断类型，未填写');
    expect(() => validateDataset('cn_zh', readData())).not.toThrow();
  });

  test('--type / --score 指定的值优先；类型也可以写 key；已有条目用指定值覆盖', async () => {
    const existing = readData().events.find((e) => e.title === '淝水之战');
    const base = await startWiki({
      '指定类型条目': page('指定类型条目', '指定类型条目是一个用于测试命令行指定类型的虚构事件。', { qid: 'Q31' }),
      '淝水之战': page('淝水之战', '淝水之战的简介，来自模拟的维基百科。'),
    }, { Q31: entity('+1650-00-00T00:00:00Z', { p31: ['Q178561'], links: 200 }) });
    let r = await run(['--file', dataFile, '--type', 'culture', '--score', '3', '指定类型条目'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(find('指定类型条目')).toMatchObject({ type: '文化', majorScore: 3 });
    expect(r.stdout).not.toContain('请核对');

    r = await run(['--file', dataFile, '--score', '9', '淝水之战'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/~ 更新 淝水之战：.*重要程度/);
    expect(find('淝水之战')).toMatchObject({ type: existing.type, majorScore: 9 });

    r = await run(['--file', dataFile, '--type', '不存在的类型', '淝水之战'], base);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('类型“不存在的类型”不在数据集的类型列表中（可用：史前、政治、战争');
    for (const bad of [['--score', '0'], ['--score', '11'], ['--score', '5.5']]) {
      r = await run(['--file', dataFile, ...bad, '淝水之战'], base);
      expect(r.code, bad.join(' ')).toBe(2);
      expect(r.stderr).toContain('重要程度无效');
    }
    r = await run(['--file', dataFile, '--type', '战争', '淝水之战', '赤壁之战'], base);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('只能配合单个关键词');
  });

  test('已有条目缺少类型或重要程度时补上；没有 Wikidata 时重要程度默认为 5', async () => {
    const data = readData();
    const target = data.events.find((e) => e.title === '官渡之战');
    delete target.type;
    delete target.majorScore;
    target.major = true;   // 旧版本字段，更新时去掉
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    const base = await startWiki({ '官渡之战': page('官渡之战', '官渡之战的简介文字，来自模拟的维基百科，没有 Wikidata。') });
    const r = await run(['--file', dataFile, '官渡之战'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('没有 Wikidata 信息，重要程度默认为 5');
    const ev = find('官渡之战');
    expect(ev).toMatchObject({ type: '战争', majorScore: 5 });
    expect(ev).not.toHaveProperty('major');
  });

  test('数据集没有 types 列表时使用该语言的默认类型名', async () => {
    const data = readData();
    delete data.types;
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    const base = await startWiki({ '无列表条目': page('无列表条目', '无列表条目是一次虚构的地震灾害，用于测试默认类型名。', { qid: 'Q41' }) },
      { Q41: entity('+1700-00-00T00:00:00Z', { p31: ['Q7944'], links: 10 }) });
    const r = await run(['--file', dataFile, '无列表条目'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(find('无列表条目')).toMatchObject({ type: '社会', majorScore: 4 });
  });

  test('重要程度估算：语言版本数越多分数越高，范围 2–9', () => {
    const { scoreFromSitelinks } = require('../tools/wiki-import');
    const scores = [0, 1, 2, 5, 10, 20, 50, 80, 100, 150, 400].map(scoreFromSitelinks);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(Math.min(...scores)).toBe(2);
    expect(Math.max(...scores)).toBe(9);
  });
});

test.describe('条目表', () => {
  test('逐条查询：新增、更新、指定年份与失败条目互不影响', async () => {
    const existing = readData().events[10];
    const base = await startWiki({
      '表中新条目': page('表中新条目', '表中新条目是条目表测试中需要新增的虚构历史事件条目。', { qid: 'Q7' }),
      [existing.title]: page(existing.title, `条目表中更新的简介：${existing.title}，内容来自模拟维基百科。`),
      '表中指定年份': page('表中指定年份', '表中指定年份是一个在条目表中直接写明年份的虚构事件条目。'),
    }, { Q7: time('+1500-00-00T00:00:00Z') });
    const list = path.join(tmp, 'topics.txt');
    fs.writeFileSync(list, ['# 注释行', '', '表中新条目', existing.title, '表中指定年份 | -500 | 文化 | 7', '不存在的条目'].join('\n'));

    const r = await run(['--file', dataFile, '--list', list], base);
    expect(r.code, '有失败条目时退出码为 1').toBe(1);
    expect(r.stdout).toContain('+ 新增 表中新条目');
    expect(r.stdout).toContain(`~ 更新 ${existing.title}`);
    expect(r.stdout).toContain('+ 新增 表中指定年份');
    expect(r.stdout).toContain('✗ 不存在的条目');
    expect(find('表中新条目').year).toBe(1500);
    expect(find('表中指定年份')).toMatchObject({ year: -500, date: '前500年', type: '文化', majorScore: 7 });
    expect(find(existing.title).detail).toContain('条目表中更新的简介');
    expect(readData().events).toHaveLength(REPO_COUNT + 2);
  });
});

test.describe('dry run', () => {
  test('只输出将做的修改，不写入文件', async () => {
    const existing = readData().events[20];
    const base = await startWiki({
      '预演新条目': page('预演新条目', '预演新条目是 dry run 测试中的虚构历史事件，不应写入文件。', { qid: 'Q8' }),
      [existing.title]: page(existing.title, `预演更新的简介：${existing.title}，这段内容不应被写入。`),
    }, { Q8: time('+1600-00-00T00:00:00Z') });
    const before = sha256(dataFile);
    const r = await run(['--file', dataFile, '--dry-run', '预演新条目', existing.title], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('+ 新增 预演新条目');
    expect(r.stdout).toContain(`~ 更新 ${existing.title}：详细说明`);
    expect(r.stdout).toContain('[dry-run] 将修改 2 个条目，未写入');
    expect(sha256(dataFile)).toBe(before);
  });
});

test.describe('参数与文件', () => {
  test('缺少必需参数或文件名不符合 <国家>_<语言>.json 时报错（退出码 2）', async () => {
    let r = await run(['淝水之战']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--file');
    r = await run(['--file', dataFile]);
    expect(r.code).toBe(2);
    const bad = path.join(tmp, 'events.json');
    fs.copyFileSync(dataFile, bad);
    r = await run(['--file', bad, '淝水之战']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('<国家>_<语言>.json');
    r = await run(['--file', dataFile, '--year', '0', '淝水之战']);
    expect(r.code).toBe(2);
  });

  test('--help 显示用法', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('--dry-run');
    expect(r.stdout).toContain('--list');
  });
});

test.describe('图片下载', () => {

  test('下载到 images/，按内容命名去重并记录宽高', async () => {
    const base = await startWiki((b) => ({
      '下载图片条目': page('下载图片条目', '下载图片条目是一个用于测试把维基图片下载到本地的虚构历史事件。', {
        qid: 'Q9', images: [`${b}/img/a.png`, `${b}/img/b.jpg`, `${b}/img/same-bytes.png`],
      }),
    }), { Q9: time('+1700-00-00T00:00:00Z') });

    const r = await run(['--file', dataFile, '下载图片条目'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('已下载 3 张图片到本地');

    const imgs = find('下载图片条目').images;
    expect(imgs).toHaveLength(3);
    for (const img of imgs) {
      expect(img.src).toMatch(LOCAL_SRC);
      expect(fs.existsSync(path.join(tmp, img.src)), img.src).toBe(true);
    }
    expect(imgs[0]).toMatchObject({ w: 40, h: 30 });
    expect(imgs[1]).toMatchObject({ w: jpegRef.w, h: jpegRef.h });
    expect(fs.readFileSync(path.join(tmp, imgs[1].src)).equals(jpeg)).toBe(true);
    // 内容相同的两张图只存一份
    expect(imgs[2].src).toBe(imgs[0].src);
    expect(fs.readdirSync(imagesDir()).sort()).toHaveLength(2);
    expect(() => validateDataset('cn_zh', readData())).not.toThrow();

    // 再次运行：图片已在本地，不重复下载，条目无变化
    const again = await run(['--file', dataFile, '下载图片条目'], base);
    expect(again.stdout).toContain('= 无变化 下载图片条目');
    expect(fs.readdirSync(imagesDir())).toHaveLength(2);
  });

  test('单张图片下载失败或不是图片时跳过该图，其余照常', async () => {
    const base = await startWiki((b) => ({
      '部分失败条目': page('部分失败条目', '部分失败条目是一个用于测试图片下载失败时如何处理的虚构历史事件。', {
        qid: 'Q10', images: [`${b}/img/a.png`, `${b}/img/missing.jpg`, `${b}/img/page.html`],
      }),
    }), { Q10: time('+1701-00-00T00:00:00Z') });

    const r = await run(['--file', dataFile, '部分失败条目'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('已下载 1 张图片到本地');
    expect(r.stdout).toContain(`图片下载失败，已跳过：${base}/img/missing.jpg`);
    expect(r.stdout).toContain(`图片下载失败，已跳过：${base}/img/page.html：不是 JPEG / PNG / GIF / WebP 图片`);
    const imgs = find('部分失败条目').images;
    expect(imgs).toHaveLength(1);
    expect(imgs[0].src).toMatch(LOCAL_SRC);
  });

  test('dry run 只显示将下载的数量，不下载也不写入', async () => {
    const base = await startWiki((b) => ({
      '预演下载条目': page('预演下载条目', '预演下载条目是一个用于测试 dry run 时不下载图片的虚构历史事件。', {
        qid: 'Q11', images: [`${b}/img/a.png`, `${b}/img/b.jpg`],
      }),
    }), { Q11: time('+1702-00-00T00:00:00Z') });
    const before = sha256(dataFile);
    const r = await run(['--file', dataFile, '--dry-run', '预演下载条目'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('将下载 2 张图片到本地');
    expect(wiki.hits.some((h) => h.startsWith('/img/')), '不应请求图片').toBe(false);
    expect(fs.existsSync(imagesDir())).toBe(false);
    expect(sha256(dataFile)).toBe(before);
  });

  test('识别 JPEG / PNG / GIF / WebP 的尺寸，其他内容返回空', () => {
    expect(imageSize(png(123, 45))).toEqual({ type: 'png', w: 123, h: 45 });
    expect(imageSize(jpeg)).toEqual({ type: 'jpeg', w: jpegRef.w, h: jpegRef.h });
    const gif = Buffer.alloc(13); gif.write('GIF89a'); gif.writeUInt16LE(640, 6); gif.writeUInt16LE(480, 8);
    expect(imageSize(gif)).toEqual({ type: 'gif', w: 640, h: 480 });
    const vp8x = Buffer.alloc(30); vp8x.write('RIFF'); vp8x.write('WEBP', 8); vp8x.write('VP8X', 12);
    vp8x.writeUIntLE(799, 24, 3); vp8x.writeUIntLE(599, 27, 3);
    expect(imageSize(vp8x)).toEqual({ type: 'webp', w: 800, h: 600 });
    const vp8l = Buffer.alloc(30); vp8l.write('RIFF'); vp8l.write('WEBP', 8); vp8l.write('VP8L', 12);
    vp8l.writeUInt32LE((299) | (199 << 14), 21);
    expect(imageSize(vp8l)).toEqual({ type: 'webp', w: 300, h: 200 });
    expect(imageSize(Buffer.from('<html>not an image</html>'))).toBeNull();
  });
});
