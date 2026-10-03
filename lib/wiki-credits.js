// 从维基百科补全图片的版权信息（作者、许可证、来源网址）。
// 维基导入脚本（tools/wiki-import.js --credits）和本地服务器的 /api/wiki-credits（编辑页的“从维基百科补全”按钮）共用。
//
// 只认“完全相同”的图片：本地图片按内容哈希命名（lib/images.js 的 saveImage），
// 对事件对应的维基条目中的每个文件，先按原图的长宽比排除尺寸对不上的，再按本地图片的宽度重新下载维基生成的缩略图，
// 内容哈希与本地文件名一致才算同一张图，然后读取该文件的作者和许可证。找不到完全相同的图片时不返回任何信息。
'use strict';

const crypto = require('crypto');
const { USER_AGENT, MAX_IMAGE_BYTES } = require('./images');
const { parseLink } = require('./link-title');

const HASH_NAME = /^images\/([0-9a-f]{16})\.[a-z0-9]+$/;
const MAX_AUTHOR = 200;
const MAX_LICENSE = 60;
const UNKNOWN_AUTHOR = /^(unknown|unknown author|anonymous|author unknown|not known|unbekannt|佚名|作者不详|作者不詳|不详|不詳|未知|无名氏)$/i;

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
  if (author && !UNKNOWN_AUTHOR.test(author)) out.author = author;
  const license = normalizeLicense(htmlText(val('LicenseShortName')));
  if (license) out.license = license;
  const url = ii && (ii.descriptionurl || '');
  if (/^https?:\/\//.test(url)) out.sourceUrl = url;
  else if (/^\/\//.test(url)) out.sourceUrl = 'https:' + url;
  return out;
}

// ---------- 网址 ----------
function localHash(src) {
  const m = String(src || '').match(HASH_NAME);
  return m ? m[1] : null;
}
// 原图地址 → 指定宽度的缩略图地址（维基的命名规则）；宽度不小于原图时用原图
//   https://upload.wikimedia.org/wikipedia/commons/a/ab/Name.jpg
//   → https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Name.jpg/500px-Name.jpg
function thumbUrl(url, width, origWidth) {
  if (origWidth && width >= origWidth) return url;
  const m = String(url || '').match(/^(https?:\/\/[^?#]+?)\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+)$/);
  if (!m) return null;
  const name = m[3];
  let thumbName = `${width}px-${name}`;
  if (/\.svg$/i.test(name)) thumbName += '.png';
  else if (/\.tiff?$/i.test(name)) thumbName = `lossy-page1-${width}px-${name}.jpg`;
  else if (/\.(pdf|djvu)$/i.test(name)) thumbName = `page1-${width}px-${name}.jpg`;
  return `${m[1]}/thumb/${m[2]}/${name}/${thumbName}`;
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
  constructor({ fetchImpl = fetch, wikiBase = (lang) => `https://${lang}.wikipedia.org`, delayMs = 0, retryBaseMs = 2000, timeoutMs = 20000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.wikiBase = wikiBase;
    this.delayMs = delayMs;
    this.retryBaseMs = retryBaseMs;
    this.timeoutMs = timeoutMs;
    this.downloads = new Map();   // 缩略图地址 → 内容哈希（null 表示下载失败）
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

  // 条目中的所有文件：{ title, url, width, height, ...版权信息 }（跟随重定向；分页取完）
  async pageFiles(page) {
    const files = [];
    let cont = {};
    for (let guard = 0; guard < 20; guard++) {
      const q = new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', redirects: '1', titles: page.title,
        generator: 'images', gimlimit: '50', prop: 'imageinfo', iiprop: 'url|size|extmetadata',
        iiextmetadatafilter: 'Artist|LicenseShortName', ...cont,
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

  async hashOf(url) {
    if (this.downloads.has(url)) return this.downloads.get(url);
    let hash = null;
    try {
      const res = await this.request(url);
      if (res) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length <= MAX_IMAGE_BYTES) hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
      }
    } catch { /* 下载失败：当作不相同 */ }
    this.downloads.set(url, hash);
    return hash;
  }
}

// 本地图片（{ src, w, h }）在维基文件中对应的那一个：长宽比一致的文件按本地宽度下载缩略图，内容完全相同才算
async function matchImage(client, im, files) {
  const hash = localHash(im.src);
  if (!hash || !im.w || !im.h) return null;
  for (const f of files) {
    const h = Math.round((f.height * im.w) / f.width);
    if (Math.abs(h - im.h) > 1 && !(im.w === f.width && im.h === f.height)) continue;
    const url = thumbUrl(f.url, im.w, f.width);
    if (url && (await client.hashOf(url)) === hash) return f;
  }
  return null;
}

// 事件的图片在维基条目中找完全相同的文件，返回 { matches: { 图片 src: { file, author?, license?, sourceUrl? } }, pages, errors }。
// only(im) 为 false 的图片不查（例如版权信息已经齐全的）
async function findCredits(client, ev, lang, only = () => true) {
  const images = (ev.images || []).filter((im) => localHash(im.src) && only(im));
  const out = { matches: {}, pages: wikiPages(ev, lang), errors: [] };
  if (!images.length) return out;
  for (const page of out.pages) {
    const left = images.filter((im) => !out.matches[im.src]);
    if (!left.length) break;
    let files;
    try {
      files = await client.pageFiles(page);
    } catch (e) {
      out.errors.push(`${page.lang}.wikipedia ${page.title}：${e.message}`);
      continue;
    }
    for (const im of left) {
      const f = await matchImage(client, im, files);
      if (f) out.matches[im.src] = { file: f.title, ...creditOf(f) };
    }
  }
  return out;
}

// 把查到的版权信息写入图片：只填缺少的字段，已有的不覆盖；返回填写的字段数
function applyCredits(images, matches) {
  let n = 0;
  for (const im of images || []) {
    const m = matches[im.src];
    if (!m) continue;
    for (const k of ['author', 'license', 'sourceUrl']) {
      if (m[k] && !(typeof im[k] === 'string' && im[k].trim())) { im[k] = m[k]; n++; }
    }
  }
  return n;
}

function needsCredits(im) {
  return !im.author || !im.license || !im.sourceUrl;
}

module.exports = { findCredits, applyCredits, needsCredits, matchImage, creditOf, thumbUrl, wikiPages, localHash, htmlText, normalizeLicense, CreditsClient };
