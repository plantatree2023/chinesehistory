// 维基百科导入脚本（tools/wiki-import.js）：新增 / 更新条目、条目表、dry run、搜索与年份来源、错误处理。
// 每个测试启动一个模拟的维基百科 + Wikidata 服务，并对临时数据副本运行脚本；不访问外网，不改动仓库中的真实数据。
const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { validateDataset } = require('../server');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'tools', 'wiki-import.js');
const REPO_DATA = path.join(ROOT, 'data', 'cn_zh.json');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const LONG_TEXT = '这是一段很长的维基百科简介文字，用来检验详细说明会在句末截断并控制在三百五十字以内。'.repeat(12);

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

function mockWiki(pages, entities, { searchMap = {}, rateLimitOnce = [] } = {}) {
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
    if ((m = /^\/wiki\/Special:EntityData\/(Q\d+)\.json$/.exec(p))) {
      return entities[m[1]] ? send(200, { entities: { [m[1]]: entities[m[1]] } }) : send(404, {});
    }
    send(404, {});
  });
  return { server, hits };
}

let tmp, dataFile, repoHash, wiki;

test.beforeEach(() => {
  repoHash = sha256(REPO_DATA);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-import-'));
  dataFile = path.join(tmp, 'cn_zh.json');
  fs.copyFileSync(REPO_DATA, dataFile);
});

test.afterEach(async () => {
  if (wiki) await new Promise((r) => wiki.server.close(r));
  wiki = null;
  fs.rmSync(tmp, { recursive: true, force: true });
  expect(sha256(REPO_DATA), '仓库中的真实数据文件不应被测试改动').toBe(repoHash);
});

async function startWiki(pages, entities = {}, opts) {
  wiki = mockWiki(pages, entities, opts);
  await new Promise((r) => wiki.server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${wiki.server.address().port}`;
}

function run(args, base) {
  return new Promise((resolve) => {
    execFile('node', [SCRIPT, ...args, '--delay', '0'], {
      cwd: ROOT,
      env: { ...process.env, WIKIPEDIA_BASE: base || 'http://127.0.0.1:9', WIKIDATA_BASE: base || 'http://127.0.0.1:9', WIKI_RETRY_BASE_MS: '10' },
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

const readData = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const find = (title) => readData().events.find((e) => e.title === title);
const charCount = (t) => t.replace(/[\s，。、；：“”‘’《》（）！？·—…,.;:()!?"'-]/g, '').length;

test.describe('单个关键词', () => {
  test('新增条目：年份来自 Wikidata，生成说明、图片和来源，并按年份排序写入', async () => {
    const base = await startWiki({
      '测试战役': page('测试战役', `测试战役是一场用于自动化测试的虚构战役（英语：Test Battle），发生于战国时代。${LONG_TEXT}`, {
        qid: 'Q1', images: ['https://img.example/a.jpg', 'https://img.example/Flag_of_X.svg', 'https://img.example/b.jpg'],
        thumbnail: { source: 'https://img.example/a.jpg', width: 400, height: 300 },
      }),
    }, { Q1: time('-0260-00-00T00:00:00Z') });

    const r = await run(['--file', dataFile, '测试战役'], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('+ 新增 测试战役');

    const data = readData();
    expect(data.events).toHaveLength(101);
    const ev = find('测试战役');
    expect(ev).toMatchObject({ id: 'e101', year: -260, date: '前260年', major: false, wiki: '测试战役' });
    expect(ev.source).toBe(`${base}/wiki/${encodeURIComponent('测试战役')}`);
    expect(ev.detail.length).toBeLessThanOrEqual(350);
    expect(ev.detail).not.toContain('英语');
    expect(charCount(ev.short)).toBeGreaterThanOrEqual(20);
    expect(ev.short.length).toBeLessThanOrEqual(60);
    // 旗帜 / SVG 被过滤；首图带尺寸
    expect(ev.images.map((i) => i.src)).toEqual(['https://img.example/a.jpg', 'https://img.example/b.jpg']);
    expect(ev.images[0]).toMatchObject({ w: 400, h: 300 });
    // 仍按年份排序，且能通过网站服务器的数据校验
    const years = data.events.map((e) => e.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(() => validateDataset('cn_zh', data)).not.toThrow();
  });

  test('更新已存在的条目：只更新来自维基的内容，保留人工内容和本地图片', async () => {
    const before = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const target = before.events.find((e) => e.images[0] && e.images[0].remote && !/^https?:/.test(e.images[0].src));
    target.major = true;
    fs.writeFileSync(dataFile, JSON.stringify(before, null, 2));
    const base = await startWiki({
      [target.title]: page(target.title, `更新后的简介：${target.title}是一个重要的历史事件，这段文字来自模拟的维基百科。`, {
        images: [target.images[0].remote, 'https://img.example/new.jpg'],
      }),
    });

    const r = await run(['--file', dataFile, target.title], base);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain(`~ 更新 ${target.title}`);
    const ev = find(target.title);
    expect(readData().events).toHaveLength(100);
    expect(ev.detail).toContain('更新后的简介');
    expect(ev).toMatchObject({ id: target.id, year: target.year, date: target.date, short: target.short, major: true });
    expect(ev.images[0].src, '已下载的本地图片应保留').toBe(target.images[0].src);
    expect(ev.images[1].src).toBe('https://img.example/new.jpg');
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
    expect(sha256(dataFile)).toBe(repoHash);
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

test.describe('条目表', () => {
  test('逐条查询：新增、更新、指定年份与失败条目互不影响', async () => {
    const existing = readData().events[10];
    const base = await startWiki({
      '表中新条目': page('表中新条目', '表中新条目是条目表测试中需要新增的虚构历史事件条目。', { qid: 'Q7' }),
      [existing.title]: page(existing.title, `条目表中更新的简介：${existing.title}，内容来自模拟维基百科。`),
      '表中指定年份': page('表中指定年份', '表中指定年份是一个在条目表中直接写明年份的虚构事件条目。'),
    }, { Q7: time('+1500-00-00T00:00:00Z') });
    const list = path.join(tmp, 'topics.txt');
    fs.writeFileSync(list, ['# 注释行', '', '表中新条目', existing.title, '表中指定年份 | -500', '不存在的条目'].join('\n'));

    const r = await run(['--file', dataFile, '--list', list], base);
    expect(r.code, '有失败条目时退出码为 1').toBe(1);
    expect(r.stdout).toContain('+ 新增 表中新条目');
    expect(r.stdout).toContain(`~ 更新 ${existing.title}`);
    expect(r.stdout).toContain('+ 新增 表中指定年份');
    expect(r.stdout).toContain('✗ 不存在的条目');
    expect(find('表中新条目').year).toBe(1500);
    expect(find('表中指定年份')).toMatchObject({ year: -500, date: '前500年' });
    expect(find(existing.title).detail).toContain('条目表中更新的简介');
    expect(readData().events).toHaveLength(102);
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
