// 从维基百科补全图片的版权信息（作者、许可证、来源网址）。
// 维基导入脚本（tools/wiki-import.js --credits）和本地服务器的 /api/wiki-credits（编辑页的“从维基百科补全”按钮）共用。
//
// 只认“完全相同”的图片：对事件对应的维基条目中的每个文件，先按原图的长宽比排除尺寸对不上的，
// 再下载维基生成的缩略图（不小于本地图片宽度的标准尺寸，或原图）与本地图片比对：
//   - 内容哈希相同（本地图片按内容哈希命名，见 lib/images.js 的 saveImage）；或
//   - 两张图解码后缩小到 32×32 逐格比较，颜色几乎没有差别（只是缩放或重新压缩过的同一张图；支持 JPEG、PNG）。
// 然后读取该文件的作者、许可证和文件页网址。找不到完全相同的图片时不返回任何信息。
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const { USER_AGENT, MAX_IMAGE_BYTES } = require('./images');
const { parseLink } = require('./link-title');

const HASH_NAME = /^images\/([0-9a-f]{16})\.[a-z0-9]+$/;
const LOCAL_IMAGE = /^images\/[^/\\]+$/;
const MAX_AUTHOR = 200;
const MAX_LICENSE = 60;
// 作者不详的写法（可能几种语言连在一起，如“未知Unknown author”）：去掉这些词后什么都不剩就当作没有作者
// “Own work”（自己的作品）没有写出名字，也当作没有作者
const UNKNOWN_AUTHOR_WORDS = /unknown|author|artist|photographer|anonymous|not known|not provided|own work|unbekannt|inconnu|佚名|匿名|作者|摄影者|攝影者|不详|不詳|未知|未提供|无名氏|無名氏|自己的作品|^[无無]$|或|or|[\s​:：,，;；.。()（）/-]/gi;
// 版权信息的语言：中文用简体（数据集的中文是简体），其他语言用该语言
function metadataLanguage(lang) {
  return lang === 'zh' ? 'zh-hans' : lang;
}
// 维基缩略图的标准宽度（其他宽度 upload.wikimedia.org 不再生成）
const THUMB_STEPS = [250, 330, 500, 960, 1280, 1920];
// 像素比对：缩小到 SIG×SIG，平均每格每个颜色通道的差别不超过 SIG_MEAN，且差别超过 SIG_CELL 的不超过 SIG_OUTLIERS
const SIG = 32;
const SIG_MEAN = 3;
const SIG_CELL = 24;
const SIG_OUTLIERS = 0.02;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 文字处理 ----------
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k] || m;
  });
}
// 维基返回的 HTML 片段 → 纯文字（去掉标签和样式脚本内容）
function htmlText(html) {
  return decodeEntities(String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}
// 与编辑页（js/app.js 的 normalizeLicense）一致：公有领域统一写成 Public domain，CC0 统一写法
function normalizeLicense(name) {
  name = String(name || '').trim();
  if (!name) return '';
  if (/^(public domain|pd\b|pd-)/i.test(name)) return 'Public domain';
  if (/^cc0/i.test(name)) return 'CC0';
  return name.slice(0, MAX_LICENSE);
}
// 文件信息（imageinfo）→ { author, license, sourceUrl }，空的不返回
function creditOf(ii) {
  const md = (ii && ii.extmetadata) || {};
  const val = (k) => (md[k] && typeof md[k].value === 'string' ? md[k].value : '');
  const out = {};
  const author = htmlText(val('Artist')).slice(0, MAX_AUTHOR);
  if (author && author.replace(UNKNOWN_AUTHOR_WORDS, '')) out.author = author;
  const license = normalizeLicense(htmlText(val('LicenseShortName')));
  if (license) out.license = license;
  const url = ii && (ii.descriptionurl || '');
  if (/^https?:\/\//.test(url)) out.sourceUrl = url;
  else if (/^\/\//.test(url)) out.sourceUrl = 'https:' + url;
  return out;
}

// ---------- 像素比对 ----------
// 图片数据 → { width, height, data: RGBA }；不支持的格式或解码失败时返回 null
function decodeImage(buf) {
  try {
    if (buf[0] === 0xff && buf[1] === 0xd8) return jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    if (buf[0] === 0x89 && buf[1] === 0x50) return PNG.sync.read(buf);
  } catch { /* 解码失败：当作无法比对 */ }
  return null;
}
// 按面积平均缩小到 SIG×SIG 的 RGB（透明部分按白底合成）；无法解码时返回 null
function signature(img) {
  if (!img || !img.width || !img.height) return null;
  const { width: w, height: h, data } = img;
  const sum = new Float64Array(SIG * SIG * 3);
  const count = new Float64Array(SIG * SIG);
  for (let y = 0; y < h; y++) {
    const row = Math.floor((y * SIG) / h) * SIG;
    for (let x = 0; x < w; x++) {
      const c = row + Math.floor((x * SIG) / w);
      const i = (y * w + x) * 4;
      const a = data[i + 3] / 255;
      for (let k = 0; k < 3; k++) sum[c * 3 + k] += data[i + k] * a + 255 * (1 - a);
      count[c]++;
    }
  }
  for (let c = 0; c < SIG * SIG; c++) for (let k = 0; k < 3; k++) sum[c * 3 + k] /= count[c] || 1;
  return sum;
}
function sameSignature(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let total = 0;
  let outliers = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    total += d;
    if (d > SIG_CELL) outliers++;
  }
  return total / a.length <= SIG_MEAN && outliers <= a.length * SIG_OUTLIERS;
}
// 图片的内容哈希（完整十六进制）与缩小后的像素（无法解码时为 null）
function describeImage(buf) {
  return { hash: crypto.createHash('sha256').update(buf).digest('hex'), sig: signature(decodeImage(buf)) };
}

// ---------- 网址 ----------
// 文件名中的内容哈希（images/<sha256 前 16 位>.<扩展名>）；不是这样命名的返回 null
function localHash(src) {
  const m = String(src || '').match(HASH_NAME);
  return m ? m[1] : null;
}
// 原图地址 → 指定宽度的缩略图地址（维基的命名规则）；宽度不小于原图时用原图
//   https://upload.wikimedia.org/wikipedia/commons/a/ab/Name.jpg
//   → https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Name.jpg/500px-Name.jpg
function thumbUrl(url, width, origWidth) {
  url = String(url || '').split(/[?#]/)[0];   // imageinfo 的地址带 ?utm_source=… 参数
  if (!url) return null;
  if (origWidth && width >= origWidth) return url;
  const m = url.match(/^(https?:\/\/[^?#]+?)\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+)$/);
  if (!m) return null;
  const name = m[3];
  let thumbName = `${width}px-${name}`;
  if (/\.svg$/i.test(name)) thumbName += '.png';
  else if (/\.tiff?$/i.test(name)) thumbName = `lossy-page1-${width}px-${name}.jpg`;
  else if (/\.(pdf|djvu)$/i.test(name)) thumbName = `page1-${width}px-${name}.jpg`;
  return `${m[1]}/thumb/${m[2]}/${name}/${thumbName}`;
}
// 比对时下载的缩略图宽度：不小于本地宽度的标准尺寸（本地宽度本身是标准尺寸时就是它）；
// 不比原图小或超出标准尺寸时用原图宽度（thumbUrl 返回原图地址）
function compareWidth(width, origWidth) {
  const step = THUMB_STEPS.find((w) => w >= width);
  return step && step < origWidth ? step : origWidth;
}
// 事件对应的维基条目：参考链接中的维基百科链接，以及 wiki 字段（数据集语言的维基百科）
function wikiPages(ev, lang) {
  const pages = [];
  const add = (l, title) => {
    if (!l || !title || pages.some((p) => p.lang === l && p.title === title)) return;
    pages.push({ lang: l, title });
  };
  for (const s of ev.sources || (ev.source ? [{ url: ev.source }] : [])) {
    const info = parseLink(s && s.url);
    if (info && info.site === 'wikipedia' && info.name) add(info.lang, info.name);
  }
  if (ev.wiki) add(lang, ev.wiki);
  return pages;
}

// ---------- 查询 ----------
class CreditsClient {
  // rootDir：网站根目录（本地图片 images/… 所在处），给了时按图片文件的实际内容比对；否则只能按文件名中的哈希比对
  constructor({ fetchImpl = fetch, wikiBase = (lang) => `https://${lang}.wikipedia.org`, rootDir = null, delayMs = 0, retryBaseMs = 2000, timeoutMs = 20000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.wikiBase = wikiBase;
    this.rootDir = rootDir;
    this.delayMs = delayMs;
    this.retryBaseMs = retryBaseMs;
    this.timeoutMs = timeoutMs;
    this.downloads = new Map();   // 缩略图地址 → { hash, sig }（null 表示下载失败）
    this.locals = new Map();      // 本地图片 src → { hash, sig }
  }

  // GET：404 返回 null；限流（429）和服务器错误时按指数退避重试
  async request(url) {
    const attempts = 4;
    for (let i = 0; i < attempts; i++) {
      if (this.delayMs) await sleep(this.delayMs);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      let res;
      try {
        res = await this.fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal });
      } catch (e) {
        clearTimeout(timer);
        if (i === attempts - 1) throw new Error(`网络错误：${e.message}`);
        await sleep(this.retryBaseMs * 2 ** i);
        continue;
      }
      clearTimeout(timer);
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (i === attempts - 1) throw new Error(`维基暂时不可用（HTTP ${res.status}），请稍后再试`);
        const retryAfter = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        await sleep(Math.min(60000, retryAfter > 0 ? retryAfter * 1000 : this.retryBaseMs * 2 ** i));
        continue;
      }
      if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）`);
      return res;
    }
    return null;
  }

  // 条目中的所有文件：{ title, url, width, height, ...版权信息 }（跟随重定向；分页取完）。
  // 版权信息中的模板文字（如“原上传者为…”“Own work”）按 lang（数据集的语言）返回
  async pageFiles(page, lang = page.lang) {
    const files = [];
    let cont = {};
    for (let guard = 0; guard < 20; guard++) {
      const q = new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', redirects: '1', titles: page.title,
        generator: 'images', gimlimit: '50', prop: 'imageinfo', iiprop: 'url|size|extmetadata',
        iiextmetadatafilter: 'Artist|LicenseShortName', iiextmetadatalanguage: metadataLanguage(lang), ...cont,
      });
      const res = await this.request(`${this.wikiBase(page.lang)}/w/api.php?${q}`);
      if (!res) break;
      const json = await res.json();
      for (const p of (json.query && json.query.pages) || []) {
        const ii = p.imageinfo && p.imageinfo[0];
        if (!ii || !ii.url || !ii.width || !ii.height) continue;
        const f = files.find((x) => x.title === p.title);
        if (f) Object.assign(f, ii); else files.push({ title: p.title, ...ii });
      }
      if (!json.continue) break;
      cont = json.continue;
    }
    return files;
  }

  // 文件的版权信息（按 lang 的语言）：{ 文件名: { author?, license?, sourceUrl? } }；查不到的文件不返回
  async fileCredits(titles, lang) {
    const out = {};
    for (let i = 0; i < titles.length; i += 50) {
      const q = new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', iiprop: 'url|extmetadata',
        iiextmetadatafilter: 'Artist|LicenseShortName', iiextmetadatalanguage: metadataLanguage(lang), titles: titles.slice(i, i + 50).join('|'),
      });
      const res = await this.request(`${this.wikiBase(lang)}/w/api.php?${q}`);
      if (!res) continue;
      const json = await res.json();
      const from = {};
      for (const n of (json.query && json.query.normalized) || []) from[n.to] = n.from;
      for (const p of (json.query && json.query.pages) || []) {
        const ii = p.imageinfo && p.imageinfo[0];
        if (ii) out[from[p.title] || p.title] = creditOf(ii);
      }
    }
    return out;
  }

  // 条目在其他语言维基百科中的对应条目（langs 中的语言，不含条目本身的语言）
  async langPages(page, langs) {
    const want = langs.filter((l) => l !== page.lang);
    if (!want.length) return [];
    const q = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', redirects: '1', titles: page.title, prop: 'langlinks', lllimit: 'max' });
    const res = await this.request(`${this.wikiBase(page.lang)}/w/api.php?${q}`);
    if (!res) return [];
    const json = await res.json();
    const links = ((json.query && json.query.pages) || []).flatMap((p) => p.langlinks || []);
    return want.map((l) => links.find((x) => x.lang === l)).filter((x) => x && x.title).map((x) => ({ lang: x.lang, title: x.title }));
  }

  // 下载的维基图片：{ hash, sig }；下载失败时为 null
  async remote(url) {
    if (this.downloads.has(url)) return this.downloads.get(url);
    let info = null;
    try {
      const res = await this.request(url);
      if (res) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length <= MAX_IMAGE_BYTES) info = describeImage(buf);
      }
    } catch { /* 下载失败：当作不相同 */ }
    this.downloads.set(url, info);
    return info;
  }

  // 本地图片：{ hash, sig }。有网站根目录时读取文件（早期不按内容哈希命名的图片也能比对），
  // 否则只有文件名中的哈希；都没有时为 null
  local(src) {
    if (this.locals.has(src)) return this.locals.get(src);
    let info = null;
    if (this.rootDir && LOCAL_IMAGE.test(String(src || ''))) {
      try { info = describeImage(fs.readFileSync(path.join(this.rootDir, src))); } catch { /* 文件不存在时按文件名 */ }
    }
    const named = localHash(src);
    if (!info && named) info = { hash: named, sig: null };
    this.locals.set(src, info);
    return info;
  }
}

// 本地图片（{ src, w, h }）在维基文件中对应的那一个：长宽比一致的文件下载缩略图，内容哈希相同或像素几乎一样才算
async function matchImage(client, im, files) {
  const mine = client.local(im.src);
  if (!mine || !im.w || !im.h) return null;
  for (const f of files) {
    const h = Math.round((f.height * im.w) / f.width);
    if (Math.abs(h - im.h) > 1 && !(im.w === f.width && im.h === f.height)) continue;
    const url = thumbUrl(f.url, compareWidth(im.w, f.width), f.width);
    const got = url && (await client.remote(url));
    if (got && (got.hash.startsWith(mine.hash) || sameSignature(got.sig, mine.sig))) return f;
  }
  return null;
}

// 事件的图片在维基条目中找完全相同的文件，返回 { matches: { 图片 src: { file, author?, license?, sourceUrl? } }, pages, errors }。
// 先查事件的维基条目，还有没找到的图片时再查第一个条目在 OTHER_LANGS 中其他语言的对应条目。
// only(im) 为 false 的图片不查（例如版权信息已经齐全的）
const OTHER_LANGS = ['zh', 'en'];
async function findCredits(client, ev, lang, only = () => true) {
  const images = (ev.images || []).filter((im) => client.local(im.src) && only(im));
  const out = { matches: {}, pages: wikiPages(ev, lang), errors: [] };
  if (!images.length) return out;
  let extended = false;
  for (let i = 0; i < out.pages.length; i++) {
    const page = out.pages[i];
    const left = images.filter((im) => !out.matches[im.src]);
    if (!left.length) break;
    let files;
    try {
      files = await client.pageFiles(page, lang);
    } catch (e) {
      out.errors.push(`${page.lang}.wikipedia ${page.title}：${e.message}`);
      continue;
    }
    for (const im of left) {
      const f = await matchImage(client, im, files);
      if (f) out.matches[im.src] = { file: f.title, ...creditOf(f) };
    }
    if (!extended && i === out.pages.length - 1 && images.some((im) => !out.matches[im.src])) {
      extended = true;
      let more = [];
      try { more = await client.langPages(out.pages[0], OTHER_LANGS); } catch (e) { out.errors.push(`${out.pages[0].lang}.wikipedia ${out.pages[0].title}：${e.message}`); }
      for (const p of more) if (!out.pages.some((x) => x.lang === p.lang && x.title === p.title)) out.pages.push(p);
    }
  }
  return out;
}

// 来源网址是维基百科本地的文件页（如 https://zh.wikipedia.org/wiki/File:X.jpg），而不是维基共享资源
const WIKIPEDIA_FILE_PAGE = /^https?:\/\/[a-z-]+\.(m\.)?wikipedia\.org\/wiki\/(File|Image|文件|檔案|档案|图像|圖像):/i;
const COMMONS_FILE_PAGE = /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/;
// 把查到的版权信息写入图片：只填缺少的字段，已有的不覆盖；返回填写的字段数。
// 唯一的例外：来源网址是维基百科本地的文件页、而这张图在维基共享资源上时，改成维基共享资源的文件页
function applyCredits(images, matches) {
  let n = 0;
  for (const im of images || []) {
    const m = matches[im.src];
    if (!m) continue;
    for (const k of ['author', 'license', 'sourceUrl']) {
      if (m[k] && !(typeof im[k] === 'string' && im[k].trim())) { im[k] = m[k]; n++; }
    }
    if (COMMONS_FILE_PAGE.test(m.sourceUrl || '') && WIKIPEDIA_FILE_PAGE.test(im.sourceUrl || '')) { im.sourceUrl = m.sourceUrl; n++; }
  }
  return n;
}

function needsCredits(im) {
  return !im.author || !im.license || !im.sourceUrl || WIKIPEDIA_FILE_PAGE.test(im.sourceUrl);
}

module.exports = {
  findCredits, applyCredits, needsCredits, matchImage, creditOf, thumbUrl, compareWidth, wikiPages, localHash,
  htmlText, normalizeLicense, metadataLanguage, decodeImage, signature, sameSignature, describeImage, CreditsClient,
};
