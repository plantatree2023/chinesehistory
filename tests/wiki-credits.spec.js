// 从维基百科补全图片版权（lib/wiki-credits.js）：完全相同的图片才算（内容哈希相同，或只是缩放 / 重新压缩过的同一张图），
// 只填写缺少的作者、许可证和来源网址；本地服务器的 /api/wiki-credits 与编辑页的“从维基百科补全”按钮。
// 维基的接口和图片都由测试模拟（fetchImpl / page.route），不访问外网。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { test, expect, seedEvents, makePng, readTestData, STORAGE_KEY } = require('./helpers');
const { createServer } = require('../server');
const W = require('../lib/wiki-credits');

const ROOT = path.resolve(__dirname, '..');
const API = 'http://wiki.test';
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons';

// 同样的像素、不同的字节（换一种压缩级别重新编码）
const reencode = (png) => PNG.sync.write(PNG.sync.read(png), { deflateLevel: 1 });
// 有图案的 JPEG（渐变 + 方块），quality 不同时字节不同、像素几乎一样
function patternJpeg(w, h, quality, invert = false) {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const box = x > w / 3 && x < (2 * w) / 3 && y > h / 3 && y < (2 * h) / 3;
      let v = box ? 230 : Math.round((x / w) * 200);
      if (invert) v = 255 - v;
      data[i] = v; data[i + 1] = Math.round((y / h) * 255); data[i + 2] = 80; data[i + 3] = 255;
    }
  }
  return jpeg.encode({ data, width: w, height: h }, quality).data;
}
const hashName = (buf, ext) => `images/${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}.${ext}`;

// 模拟维基：条目 → 文件列表（generator=images），文件地址 → 图片内容；记录请求
function fakeWiki({ pages = {}, files = {}, langlinks = {} }) {
  const hits = [];
  const fetchImpl = async (url) => {
    hits.push(url);
    const reply = (status, body, binary) => ({
      status, ok: status >= 200 && status < 300, headers: { get: () => null },
      json: async () => body,
      arrayBuffer: async () => { const b = binary || Buffer.from(JSON.stringify(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
    });
    const u = new URL(url);
    if (u.pathname === '/w/api.php') {
      const title = u.searchParams.get('titles');
      if (u.searchParams.get('prop') === 'langlinks') return reply(200, { query: { pages: [{ title, langlinks: langlinks[title] || [] }] } });
      return reply(200, { query: { pages: (pages[title] || []).map((f) => ({ title: f.title, imageinfo: [f.info] })) } });
    }
    const body = files[url];
    return body ? reply(200, null, body) : reply(404, {});
  };
  return { fetchImpl, hits };
}
// 维基文件：原图地址、尺寸和版权
function wikiFile(name, w, h, { artist = 'Wiki Author', license = 'CC BY-SA 4.0' } = {}) {
  return {
    title: `File:${name.replace(/_/g, ' ')}`,
    info: {
      url: `${COMMONS}/a/ab/${name}?utm_source=zh.wikipedia.org`, width: w, height: h,
      descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`,
      extmetadata: { Artist: { value: `<a href="//commons.wikimedia.org/wiki/User:X">${artist}</a>` }, LicenseShortName: { value: license } },
    },
  };
}
const EVENT = (images) => ({ title: '测试事件', sources: [{ url: 'https://zh.wikipedia.org/wiki/%E6%B5%8B%E8%AF%95' }], images });

test.describe('lib/wiki-credits', () => {
  test('缩略图地址：去掉网址参数，标准宽度，不小于原图时用原图；SVG / TIFF 的缩略图格式', () => {
    expect(W.thumbUrl(`${COMMONS}/a/ab/X.jpg?utm_source=x`, 500, 2000)).toBe(`${COMMONS}/thumb/a/ab/X.jpg/500px-X.jpg`);
    expect(W.thumbUrl(`${COMMONS}/a/ab/X.jpg`, 2000, 2000)).toBe(`${COMMONS}/a/ab/X.jpg`);
    expect(W.thumbUrl(`${COMMONS}/a/ab/X.svg`, 330, 1000)).toBe(`${COMMONS}/thumb/a/ab/X.svg/330px-X.svg.png`);
    expect(W.thumbUrl(`${COMMONS}/a/ab/X.tif`, 500, 1000)).toBe(`${COMMONS}/thumb/a/ab/X.tif/lossy-page1-500px-X.tif.jpg`);
    expect(W.compareWidth(500, 2000)).toBe(500);
    expect(W.compareWidth(399, 2000)).toBe(500);    // 非标准宽度改用更大的标准宽度
    expect(W.compareWidth(400, 450)).toBe(450);     // 标准宽度不小于原图：用原图
    expect(W.compareWidth(2500, 3000)).toBe(3000);
  });

  test('版权信息：去掉 HTML，作者不详时不填，许可证统一写法，来源为文件页', () => {
    const c = (artist, license) => W.creditOf({ descriptionurl: '//commons.wikimedia.org/wiki/File:A.jpg', extmetadata: { Artist: { value: artist }, LicenseShortName: { value: license } } });
    expect(c('<a href="x">张三</a> &amp; 李四', 'Public domain')).toEqual({ author: '张三 & 李四', license: 'Public domain', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg' });
    for (const a of ['Unknown', '未知Unknown author', '未知Unknown artist', '佚名', 'Anonymous']) expect(c(a, 'PD-old').author, a).toBeUndefined();
    expect(c('Unknown Chinese artist', 'CC0').author).toBe('Unknown Chinese artist');
    expect(c('', 'PD-old').license).toBe('Public domain');
  });

  test('像素比对：同一张图重新压缩算相同，不同的图不算', () => {
    const sig = (buf) => W.signature(W.decodeImage(buf));
    const a = makePng(40, 30, 200);
    expect(reencode(a).equals(a)).toBe(false);
    expect(W.sameSignature(sig(a), sig(reencode(a)))).toBe(true);
    expect(W.sameSignature(sig(a), sig(makePng(40, 30, 90)))).toBe(false);
    expect(W.sameSignature(sig(patternJpeg(120, 90, 95)), sig(patternJpeg(120, 90, 60)))).toBe(true);
    expect(W.sameSignature(sig(patternJpeg(120, 90, 95)), sig(patternJpeg(120, 90, 95, true)))).toBe(false);
    expect(W.decodeImage(Buffer.from('GIF89a'))).toBeNull();
  });

  test('只填写缺少的字段，已有的不覆盖', () => {
    const images = [{ src: 'images/a.jpg', author: '原作者', license: '' }, { src: 'images/b.jpg' }];
    const n = W.applyCredits(images, {
      'images/a.jpg': { author: '维基作者', license: 'CC0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg' },
    });
    expect(n).toBe(2);
    expect(images[0]).toEqual({ src: 'images/a.jpg', author: '原作者', license: 'CC0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg' });
    expect(images[1]).toEqual({ src: 'images/b.jpg' });
    // 来源是维基百科本地的文件页、这张图在维基共享资源上：改成维基共享资源的文件页；其他网址不改
    const local = [
      { src: 'images/c.jpg', author: 'X', license: 'CC0', sourceUrl: 'https://zh.wikipedia.org/wiki/File:C.jpg' },
      { src: 'images/d.jpg', author: 'X', license: 'CC0', sourceUrl: 'https://www.example.com/d.html' },
    ];
    expect(W.needsCredits(local[0])).toBe(true);
    expect(W.needsCredits(local[1])).toBe(false);
    W.applyCredits(local, {
      'images/c.jpg': { sourceUrl: 'https://commons.wikimedia.org/wiki/File:C.jpg' },
      'images/d.jpg': { sourceUrl: 'https://commons.wikimedia.org/wiki/File:D.jpg' },
    });
    expect(local[0].sourceUrl).toBe('https://commons.wikimedia.org/wiki/File:C.jpg');
    expect(local[1].sourceUrl).toBe('https://www.example.com/d.html');
  });

  test('维基条目：参考链接中的维基百科链接和 wiki 字段', () => {
    const ev = { wiki: '唐朝', sources: [{ url: 'https://en.wikipedia.org/wiki/Tang_dynasty' }, { url: 'https://baike.baidu.com/item/x' }] };
    expect(W.wikiPages(ev, 'zh')).toEqual([{ lang: 'en', title: 'Tang dynasty' }, { lang: 'zh', title: '唐朝' }]);
  });

  test('找完全相同的图片：内容哈希相同或像素相同才算，长宽比不符的不下载，找不到时不返回任何信息', async () => {
    const same = makePng(40, 30, 200);
    const local = { src: hashName(same, 'png'), w: 40, h: 30 };
    const pixel = patternJpeg(250, 188, 95);
    const local2 = { src: 'images/old-name.jpg', w: 250, h: 188 };
    const lonely = { src: 'images/0123456789abcdef.png', w: 40, h: 30 };
    const big = wikiFile('Big.jpg', 1000, 752);
    const wiki = fakeWiki({
      pages: { 测试: [wikiFile('Tall.png', 30, 40), wikiFile('Other.png', 40, 30, { artist: '别人' }), wikiFile('Same.png', 40, 30, { artist: 'Jane <b>Doe</b>' }), big] },
      files: {
        [`${COMMONS}/a/ab/Other.png`]: makePng(40, 30, 10),
        [`${COMMONS}/a/ab/Same.png`]: same,
        [`${COMMONS}/thumb/a/ab/Big.jpg/250px-Big.jpg`]: patternJpeg(250, 188, 70),
      },
    });
    // 本地的旧图片（不按内容哈希命名）放在临时的网站根目录中，按实际内容比对
    const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wiki-credits-'));
    try {
      fs.mkdirSync(path.join(root, 'images'));
      fs.writeFileSync(path.join(root, local2.src), pixel);
      const client = new W.CreditsClient({ fetchImpl: wiki.fetchImpl, wikiBase: () => API, rootDir: root, retryBaseMs: 1 });
      const r = await W.findCredits(client, EVENT([local, local2, lonely]), 'zh');
      expect(r.errors).toEqual([]);
      expect(r.matches[local.src]).toEqual({ file: 'File:Same.png', author: 'Jane Doe', license: 'CC BY-SA 4.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Same.png' });
      expect(r.matches[local2.src]).toMatchObject({ file: 'File:Big.jpg', author: 'Wiki Author' });
      expect(r.matches[lonely.src]).toBeUndefined();
      expect(wiki.hits.some((u) => u.includes('Tall.png'))).toBe(false);   // 长宽比不符：不下载
      // 有图片没找到时，再查条目的其他语言版本
      expect(wiki.hits.some((u) => u.includes('prop=langlinks'))).toBe(true);
      // 版权信息按数据集的语言（中文为简体）查询
      expect(wiki.hits.filter((u) => u.includes('generator=images')).every((u) => u.includes('iiextmetadatalanguage=zh-hans'))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('维基暂时不可用时报告错误，不返回信息', async () => {
    const client = new W.CreditsClient({ fetchImpl: async () => ({ status: 503, ok: false, headers: { get: () => null } }), wikiBase: () => API, retryBaseMs: 1 });
    const r = await W.findCredits(client, EVENT([{ src: 'images/0123456789abcdef.png', w: 40, h: 30 }]), 'zh');
    expect(r.matches).toEqual({});
    expect(r.errors[0]).toContain('HTTP 503');
  });
});

test.describe('本地服务器 /api/wiki-credits', () => {
  test('只读模式也提供：按网站中的本地图片比对，返回完全相同的文件的版权；拒绝跨站请求和错误的请求', async ({ request }) => {
    const im = readTestData().events.flatMap((e) => e.images).find((i) => /\.jpg$/.test(i.src) && i.w && fs.existsSync(path.join(ROOT, i.src)));
    const bytes = fs.readFileSync(path.join(ROOT, im.src));
    const name = 'Local.jpg';
    const wiki = fakeWiki({
      pages: { 测试: [wikiFile(name, im.w, im.h, { license: 'CC BY 2.0' })] },
      files: { [`${COMMONS}/a/ab/${name}`]: bytes },
    });
    const server = createServer({ root: ROOT, readonly: true, wikiCreditsOptions: { fetchImpl: wiki.fetchImpl, wikiBase: () => API, retryBaseMs: 1 } });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const res = await request.post(`${base}/api/wiki-credits`, { data: { lang: 'zh', event: EVENT([{ src: im.src, w: im.w, h: im.h }, { src: 'images/../server.js', w: 1, h: 1 }]) } });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.matches).toEqual({ [im.src]: { file: `File:${name}`, author: 'Wiki Author', license: 'CC BY 2.0', sourceUrl: `https://commons.wikimedia.org/wiki/File:${name}` } });
      const evil = await request.post(`${base}/api/wiki-credits`, { data: { event: EVENT([]) }, headers: { Origin: 'https://evil.example' } });
      expect(evil.status()).toBe(403);
      const bad = await request.post(`${base}/api/wiki-credits`, { data: { lang: 'zh' } });
      expect(bad.status()).toBe(400);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

test.describe('编辑页：从维基百科补全', () => {
  test.use({ debugMode: true, viewport: { width: 1440, height: 860 } });
  const EVENT_ID = 'e003';

  async function openEditor(page) {
    await page.goto(`/?id=${EVENT_ID}`);
    await expect(page.locator('#detailModal')).toBeVisible();
    await page.click('#detailEdit');
    await expect(page.locator('#editModal')).toBeVisible();
  }

  test('只填写缺少的作者、许可证和来源网址，已填写的不改（维基百科本地文件页换成维基共享资源）；保存后才写入', async ({ page }) => {
    await seedEvents(page, (events) => {
      const imgs = events.find((e) => e.id === EVENT_ID).images;
      Object.assign(imgs[1], { author: '原作者' });
      Object.assign(imgs[2], { author: 'C', license: 'CC0', sourceUrl: 'https://zh.wikipedia.org/wiki/File:C.jpg' });
      return events;
    });
    const ev = readTestData().events.find((e) => e.id === EVENT_ID);
    const [a, b, c] = ev.images;
    const requests = [];
    await page.route('**/api/wiki-credits', (route) => {
      requests.push(route.request().postDataJSON());
      route.fulfill({
        json: {
          matches: {
            [a.src]: { file: 'File:A.jpg', author: 'Wiki A', license: 'CC BY-SA 4.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg' },
            [b.src]: { file: 'File:B.jpg', author: 'Wiki B', license: 'Public domain', sourceUrl: 'https://commons.wikimedia.org/wiki/File:B.jpg' },
            [c.src]: { file: 'File:C.jpg', author: 'Wiki C', license: 'CC BY 4.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:C.jpg' },
          },
          errors: [],
        },
      });
    });
    await openEditor(page);
    const btn = page.locator('#imageInfoWiki');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText('从维基百科补全');
    await btn.click();
    await expect(page.locator('#imageEditor .img-slot').nth(0).locator('.credit-chip')).toHaveText('CC BY-SA 4.0');
    expect(requests).toHaveLength(1);
    expect(requests[0].lang).toBe('zh');
    expect(requests[0].event.sources).toEqual(ev.sources);
    expect(requests[0].event.images[0]).toEqual({ src: a.src, w: a.w, h: a.h });
    await expect(page.locator('#imageInfo')).not.toHaveAttribute('open', '');   // 按钮在表头中，点了不展开
    await expect(page.locator('#formError')).toHaveText('');

    await page.click('#editForm button[type=submit]');
    await expect(page.locator('#editModal')).toBeHidden();
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    const imgs = saved.changed[EVENT_ID].images;
    expect(imgs[0]).toMatchObject({ author: 'Wiki A', license: 'CC BY-SA 4.0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg' });
    expect(imgs[1]).toMatchObject({ author: '原作者', license: 'Public domain', sourceUrl: 'https://commons.wikimedia.org/wiki/File:B.jpg' });
    // 来源是维基百科本地的文件页：改成维基共享资源的文件页，作者和许可证不改
    expect(imgs[2]).toMatchObject({ author: 'C', license: 'CC0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:C.jpg' });
    expect(imgs[3].author).toBeUndefined();
  });

  test('没有找到或无法查询时提示，图片不变', async ({ page }) => {
    await openEditor(page);
    await page.click('#imageInfoWiki');   // helpers 默认返回“没有找到”
    await expect(page.locator('#formError')).toHaveText('没有在维基百科中找到与这些图片完全相同的文件');
    await page.route('**/api/wiki-credits', (route) => route.fulfill({ status: 404, body: 'Not Found' }));
    await page.click('#imageInfoWiki');
    await expect(page.locator('#formError')).toHaveText('无法查询维基百科（只有在本地运行网站时才能查询）');
    await expect(page.locator('#imageInfoWiki')).toBeEnabled();
    await expect(page.locator('#imageEditor .img-slot').nth(0).locator('.credit-chip')).toHaveClass(/credit-missing/);
  });
});
