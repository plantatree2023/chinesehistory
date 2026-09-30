#!/usr/bin/env node
// 从维基百科查询历史事件，新增或更新数据集 JSON 中的条目。
//
// 用法：
//   node tools/wiki-import.js --file data/cn_zh.json 淝水之战 甲午战争
//   node tools/wiki-import.js --file data/cn_zh.json --list topics.txt
//   node tools/wiki-import.js --file data/cn_zh.json --dry-run 淝水之战
//   node tools/wiki-import.js --file data/cn_zh.json --refresh-images 淝水之战
//
// 条目表（--list）每行一个关键词，可用“关键词|年份”指定年份（公元前写负数），# 开头为注释。
//
// 规则：
// - 关键词先按条目名查询，查不到再用维基搜索；语言由文件名 <国家>_<语言>.json 决定。
// - 图片一律下载到本地：维基图片（维基生成的缩略图）下载到数据文件上一级目录的 images/
//   （data/cn_zh.json → images/），按内容哈希命名、同一张图只存一份，并记录宽高；网站只从本地加载图片。
//   单张图片下载失败时跳过该图片并给出提示。
// - 已存在的条目（事件名与关键词相同，或对应同一维基条目）：更新详细说明、来源等来自维基的内容，
//   保留事件名、年份、简要说明、重大事件标记等人工内容；若指定了年份，则同时更新年份。
//   已有图片默认保留（没有图片的条目会从维基补上）；加 --refresh-images 则用维基的图片整组替换。
// - 新条目：事件名使用关键词；年份依次取自：指定的年份 → Wikidata（时间点 / 开始时间 / 成立时间 / 出生日期等）
//   → 简介文字中的第一个年份（会提示核对）；都无法确定时不新增并报错。
// - 写入前用网站服务器的同一套规则校验数据，并原子写入；--dry-run 只输出将做的修改，不下载图片、不写文件。
//
// 退出码：0 全部成功；1 有关键词失败（其余成功的仍会写入）；2 参数或文件错误。
//
// 环境变量（主要供测试使用）：WIKIPEDIA_BASE、WIKIDATA_BASE 替换接口地址，WIKI_RETRY_BASE_MS 调整重试等待。
'use strict';

const fs = require('fs');
const path = require('path');
const { validateDataset, writeAtomic, DATASET_ID } = require('../server');
const { imageSize, saveImage, MAX_IMAGE_BYTES, USER_AGENT } = require('../lib/images');

const MAX_IMAGES = 9;
const MAX_DETAIL = 350;
const MAX_SHORT = 60;
const MIN_SUMMARY = 20;
const PUNCT = /[\s，。、；：“”‘’《》〈〉（）【】！？·—…,.;:()[\]!?"'-]/g;
// 维基条目中与内容无关的图标、旗帜、徽章等
const SKIP_IMAGE = /(flag|emblem|coat_of_arms|logo|icon|seal_of|commons-|wikisource|wiktionary|symbol_|nuvola|crystal_|question_book|portal|disambig|edit-clear|padlock|ambox|loudspeaker|speaker_icon|gnome-|increase|decrease|steady)/i;
// Wikidata 中表示事件时间的属性，按优先级排列：时间点、开始时间、成立时间、出版日期、出生日期、最早日期
const YEAR_PROPERTIES = ['P585', 'P580', 'P571', 'P577', 'P569', 'P1319'];

class UsageError extends Error {}

// ---------- 参数 ----------
function parseArgs(argv) {
  const opts = { keywords: [], dryRun: false, refreshImages: false, delay: 1000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new UsageError(`${a} 缺少参数值`);
      return argv[++i];
    };
    if (a === '--file' || a === '-f') opts.file = value();
    else if (a === '--list' || a === '-l') opts.list = value();
    else if (a === '--year') opts.year = parseYear(value());
    else if (a === '--delay') opts.delay = Number(value());
    else if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--refresh-images') opts.refreshImages = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('-')) throw new UsageError(`未知参数：${a}`);
    else opts.keywords.push(a);
  }
  if (opts.help) return opts;
  if (!opts.file) throw new UsageError('必须用 --file 指定数据集文件，例如 --file data/cn_zh.json');
  if (!opts.keywords.length && !opts.list) throw new UsageError('请提供至少一个关键词，或用 --list 指定条目表');
  if (opts.year != null && (opts.list || opts.keywords.length !== 1)) throw new UsageError('--year 只能配合单个关键词使用；条目表中请写“关键词|年份”');
  if (!Number.isFinite(opts.delay) || opts.delay < 0) throw new UsageError('--delay 必须是非负数（毫秒）');
  return opts;
}

function parseYear(text) {
  const y = Number(String(text).trim());
  if (!Number.isInteger(y) || y === 0) throw new UsageError(`年份无效：${text}（公元前写负数，没有公元 0 年）`);
  return y;
}

// 条目表：每行“关键词”或“关键词|年份”，忽略空行和 # 注释
function readList(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new UsageError(`无法读取条目表：${file}`); }
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => {
    const [keyword, year] = line.split('|').map((s) => s.trim());
    if (!keyword) throw new UsageError(`条目表格式错误：${line}`);
    return { keyword, year: year ? parseYear(year) : undefined };
  });
}

// data/cn_zh.json → { id: 'cn_zh', lang: 'zh', acceptLanguage: 'zh-cn' }
function datasetInfo(file) {
  const id = path.basename(file, '.json');
  if (!DATASET_ID.test(id)) throw new UsageError(`文件名应为 <国家>_<语言>.json，例如 cn_zh.json：${file}`);
  const [lang, script] = id.split('_')[1].split('-');
  let acceptLanguage = lang;
  if (lang === 'zh') acceptLanguage = /^(Hant|TW|HK)$/i.test(script || '') ? 'zh-tw' : 'zh-cn';
  return { id, lang, acceptLanguage };
}

// ---------- 维基百科接口 ----------
class WikiClient {
  constructor({ lang, acceptLanguage }) {
    this.wikiBase = (process.env.WIKIPEDIA_BASE || `https://${lang}.wikipedia.org`).replace(/\/$/, '');
    this.wikidataBase = (process.env.WIKIDATA_BASE || 'https://www.wikidata.org').replace(/\/$/, '');
    this.acceptLanguage = acceptLanguage;
    this.retryBase = Number(process.env.WIKI_RETRY_BASE_MS) || 2000;
  }

  // GET 请求；404 返回 null；限流（429）、服务器错误和网络错误时按指数退避重试
  async request(url, accept) {
    const attempts = 6;
    for (let i = 0; i < attempts; i++) {
      let res;
      try {
        res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': this.acceptLanguage, Accept: accept } });
      } catch (e) {
        if (i === attempts - 1) throw new Error(`网络错误：${e.message}`);
        await sleep(this.retryBase * 2 ** i);
        continue;
      }
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        if (i === attempts - 1) throw new Error(`维基百科暂时不可用（HTTP ${res.status}），请稍后再试`);
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Math.min(60_000, retryAfter > 0 ? retryAfter * 1000 : this.retryBase * 2 ** i));
        continue;
      }
      if (!res.ok) throw new Error(`请求失败（HTTP ${res.status}）：${url}`);
      return res;
    }
    return null;
  }

  async getJson(url) {
    const res = await this.request(url, 'application/json');
    if (!res) return null;
    try { return await res.json(); } catch { throw new Error(`返回内容不是 JSON：${url}`); }
  }

  // 下载二进制文件（图片），超过大小上限时报错
  async getBinary(url, maxBytes) {
    const res = await this.request(url, 'image/*');
    if (!res) throw new Error('图片不存在（HTTP 404）');
    const length = Number(res.headers.get('content-length'));
    if (length > maxBytes) throw new Error('图片过大');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('图片过大');
    return buf;
  }

  summary(title) {
    return this.getJson(`${this.wikiBase}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  }
  mediaList(title) {
    return this.getJson(`${this.wikiBase}/api/rest_v1/page/media-list/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  }
  async search(keyword) {
    // 全文搜索（含重定向与正文），例如“北京奥运会”→“2008年夏季奥林匹克运动会”
    const r = await this.getJson(`${this.wikiBase}/w/rest.php/v1/search/page?q=${encodeURIComponent(keyword)}&limit=1`);
    return r && r.pages && r.pages[0] ? r.pages[0].key : null;
  }
  entity(qid) {
    return this.getJson(`${this.wikidataBase}/wiki/Special:EntityData/${encodeURIComponent(qid)}.json`);
  }

  // 关键词 → 条目摘要：先按条目名（含重定向）查询，查不到或是消歧义页时改用搜索。
  // 搜索结果必须在简介中提到该关键词，否则视为找不到，避免把无关条目写入数据
  async resolve(keyword) {
    let s = await this.summary(keyword);
    if (s && s.type !== 'disambiguation' && s.extract) return s;
    const key = await this.search(keyword);
    if (!key || key === keyword) return null;
    s = await this.summary(key);
    if (!s || s.type === 'disambiguation' || !s.extract) return null;
    return s.extract.toLowerCase().includes(keyword.toLowerCase()) ? s : null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 从维基内容生成事件字段 ----------
function charCount(text) {
  return (text || '').replace(PUNCT, '').length;
}

// 去掉“（英语：…）”、拼音注音等括注，合并多余空白
function cleanExtract(text) {
  return String(text || '')
    .replace(/（(?:英语|英文|拉丁语|法语|日语|拼音|俄语|满语|蒙古语|藏语|意大利语|葡萄牙语|德语|朝鲜语|韩语|越南语|粤拼|注音|威妥玛拼音|国际音标)[：:][^（）]*）/g, '')
    .replace(/（[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü ]+）/g, '')
    .replace(/\(\s*\)|（\s*）/g, '')
    .replace(/([\u3400-\u9fff，。、；：”）])[ \t]+(?=[\u3400-\u9fff（“])/g, '$1')   // 删去括注后残留在汉字之间的空格
    .replace(/\s*\n+\s*/g, '\n')
    .trim();
}

function sentences(text) {
  return text.match(/[^。！？!?]+[。！？!?]?/g) || [];
}

// 详细说明：在句末处截断到 350 字以内；首句过长时硬截断
function makeDetail(text) {
  if (text.length <= MAX_DETAIL) return text;
  let out = '';
  for (const s of sentences(text)) {
    if (out.length + s.length > MAX_DETAIL) break;
    out += s;
  }
  return out.length >= 120 ? out.trim() : text.slice(0, MAX_DETAIL - 1) + '…';
}

// 简要说明：取开头的句子，至少 20 字（不计标点），不超过 60 字
function makeShort(text) {
  let out = '';
  for (const s of sentences(text.replace(/\n/g, ''))) {
    out += s;
    if (charCount(out) >= MIN_SUMMARY) break;
  }
  out = out.trim();
  return out.length > MAX_SHORT ? out.slice(0, MAX_SHORT - 1) + '…' : out;
}

function absoluteUrl(src) {
  return src.startsWith('//') ? 'https:' + src : src;
}

// 图片：首图在前，过滤图标、旗帜和 SVG，最多 9 张；首图带尺寸，供时间轴按原比例排版
function makeImages(summary, media) {
  const items = (media && media.items) || [];
  const ordered = [...items.filter((m) => m.leadImage), ...items.filter((m) => !m.leadImage)];
  const seen = new Set();
  const images = [];
  for (const m of ordered) {
    if (images.length >= MAX_IMAGES) break;
    const title = m.title || '';
    if (m.type !== 'image' || seen.has(title) || SKIP_IMAGE.test(title) || /\.svg$/i.test(title)) continue;
    const src = m.srcset && m.srcset[0] && m.srcset[0].src;
    if (!src) continue;
    seen.add(title);
    const image = { src: absoluteUrl(src).split('?')[0], caption: ((m.caption && m.caption.text) || '').replace(/\s+/g, ' ').trim().slice(0, 80) };
    if (m.leadImage && summary.thumbnail) {
      image.w = summary.thumbnail.width;
      image.h = summary.thumbnail.height;
    }
    images.push(image);
  }
  if (!images.length && summary.thumbnail) {
    images.push({ src: absoluteUrl(summary.thumbnail.source).split('?')[0], w: summary.thumbnail.width, h: summary.thumbnail.height, caption: '' });
  }
  return images;
}

// Wikidata 时间值 "+0383-11-30T00:00:00Z" / "-0221-00-00T00:00:00Z" → { year, precision }
function parseWikidataTime(value) {
  const m = value && /^([+-])(\d+)-/.exec(value.time || '');
  if (!m) return null;
  const year = (m[1] === '-' ? -1 : 1) * Number(m[2]);
  return year ? { year, precision: value.precision } : null;
}

function yearFromEntity(entity, qid) {
  const e = entity && entity.entities && (entity.entities[qid] || Object.values(entity.entities)[0]);
  if (!e || !e.claims) return null;
  for (const p of YEAR_PROPERTIES) {
    for (const claim of e.claims[p] || []) {
      const t = claim.mainsnak && claim.mainsnak.datavalue && parseWikidataTime(claim.mainsnak.datavalue.value);
      if (t) return { ...t, from: `Wikidata ${p}` };
    }
  }
  return null;
}

// 从中文简介中找第一个年份，例如“（前221年）”“1949年”
function yearFromText(text, lang) {
  if (lang !== 'zh') return null;
  const m = /(公元前|前)?(\d{1,4})年/.exec(text);
  if (!m) return null;
  return { year: (m[1] ? -1 : 1) * Number(m[2]), precision: 9, from: '简介文字', uncertain: true };
}

// 显示用的时间文字；精度粗于“年”时加“约”
function dateLabel(year, precision, lang) {
  const approx = precision != null && precision < 9;
  if (lang === 'zh') {
    if (year <= -10000) {
      const wan = -year / 10000;
      return `约${Number.isInteger(wan) ? wan : wan.toFixed(1)}万年前`;
    }
    return `${approx ? '约' : ''}${year < 0 ? `前${-year}` : year}年`;
  }
  return `${approx ? 'c. ' : ''}${year < 0 ? `${-year} BCE` : year}`;
}

function pageUrl(base, title) {
  return `${base}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

// 从来源链接取出维基条目名，用于识别同一条目
function titleFromSource(source) {
  const m = /\/wiki\/([^?#]+)/.exec(source || '');
  if (!m) return null;
  try { return decodeURIComponent(m[1]).replace(/_/g, ' '); } catch { return null; }
}

// ---------- 下载图片 ----------
// 下载一张图片到 imagesDir，返回数据中使用的 { src: 'images/<哈希>.<扩展名>', w, h }
async function downloadImage(client, url, imagesDir) {
  return saveImage(await client.getBinary(url, MAX_IMAGE_BYTES), imagesDir);
}

// 下载维基图片列表（candidates 中的 src 为维基地址），返回本地图片与统计；dry run 时只计数
async function downloadAll(client, candidates, imagesDir, dryRun) {
  const stats = { images: [], downloaded: 0, planned: 0, failed: [] };
  for (const c of candidates) {
    if (dryRun) { stats.planned++; continue; }
    try {
      stats.images.push({ ...(await downloadImage(client, c.src, imagesDir)), caption: c.caption || '' });
      stats.downloaded++;
    } catch (e) {
      stats.failed.push(`${c.src}：${e.message}`);
    }
  }
  return stats;
}

// ---------- 合并到数据集 ----------
function findExisting(events, keyword, wikiTitle) {
  const norm = (t) => (t || '').replace(/_/g, ' ');
  return events.find((e) => e.title === keyword)
    || events.find((e) => norm(e.wiki) === norm(wikiTitle))
    || events.find((e) => norm(titleFromSource(e.source)) === norm(wikiTitle))
    || null;
}

function nextId(events) {
  const used = new Set(events.map((e) => e.id));
  let n = events.reduce((max, e) => Math.max(max, (/^e(\d+)$/.exec(e.id) || [0, 0])[1] * 1), 0) + 1;
  while (used.has(`e${String(n).padStart(3, '0')}`)) n++;
  return `e${String(n).padStart(3, '0')}`;
}

const FIELD_NAMES = { title: '事件名', year: '年份', date: '时间', short: '简要说明', detail: '详细说明', images: '图片', source: '来源', wiki: '维基条目' };

function changedFields(before, after) {
  return Object.keys(FIELD_NAMES).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

// 处理一个关键词：查询维基并新增 / 更新 data.events 中的条目，返回结果说明
async function importOne(client, data, info, { keyword, year }, opts = {}) {
  const summary = await client.resolve(keyword);
  if (!summary) return { ok: false, keyword, message: '维基百科中找不到对应条目' };

  const wikiTitle = (summary.titles && summary.titles.canonical ? summary.titles.canonical.replace(/_/g, ' ') : summary.title);
  const text = cleanExtract(summary.extract);
  const media = await client.mediaList(wikiTitle);
  const candidates = makeImages(summary, media);   // 维基图片地址，下载后才写入数据
  const fromWiki = {
    detail: makeDetail(text),
    source: pageUrl(client.wikiBase, wikiTitle),
    wiki: wikiTitle,
  };

  const existing = findExisting(data.events, keyword, wikiTitle);
  const notes = [];
  let when = year != null ? { year, precision: 9, from: '指定' } : null;

  if (existing) {
    const updated = { ...existing, ...fromWiki };
    if (when) Object.assign(updated, { year: when.year, date: dateLabel(when.year, when.precision, info.lang) });
    if (charCount(existing.short) < MIN_SUMMARY) updated.short = makeShort(text);
    let imageCount = (existing.images || []).length;
    if (opts.refreshImages || !imageCount) {
      const dl = await downloadAll(client, candidates, opts.imagesDir, opts.dryRun);
      notes.push(...imageNotes(dl));
      // dry run 不下载，保持原有图片；下载全部失败时也不清空原有图片
      if (!opts.dryRun && dl.images.length) updated.images = dl.images;
      imageCount = opts.dryRun ? dl.planned : updated.images.length;
    }
    const fields = changedFields(existing, updated);
    data.events[data.events.indexOf(existing)] = updated;
    const planned = opts.dryRun && (opts.refreshImages || !(existing.images || []).length) && candidates.length;
    const action = fields.length || planned ? 'update' : 'same';
    return { ok: true, keyword, action, event: updated, fields: planned && !fields.includes('images') ? [...fields, 'images'] : fields, wikiTitle, notes, imageCount };
  }

  if (!when && summary.wikibase_item) when = yearFromEntity(await client.entity(summary.wikibase_item), summary.wikibase_item);
  if (!when) {
    when = yearFromText(text, info.lang);
    if (when) notes.push(`年份 ${when.year} 取自简介文字，请核对`);
  }
  if (!when) return { ok: false, keyword, message: `无法确定年份，请用“${keyword}|年份”或 --year 指定` };

  const event = {
    id: nextId(data.events),
    year: when.year,
    date: dateLabel(when.year, when.precision, info.lang),
    title: keyword,
    short: makeShort(text),
    ...fromWiki,
    images: [],
    major: false,
  };
  const dl = await downloadAll(client, candidates, opts.imagesDir, opts.dryRun);
  event.images = dl.images;
  notes.push(...imageNotes(dl));
  data.events.push(event);
  return { ok: true, keyword, action: 'add', event, fields: Object.keys(FIELD_NAMES), wikiTitle, notes, yearFrom: when.from, imageCount: opts.dryRun ? dl.planned : dl.images.length };
}

function imageNotes(stats) {
  const notes = [];
  if (stats.downloaded) notes.push(`已下载 ${stats.downloaded} 张图片到本地`);
  if (stats.planned) notes.push(`将下载 ${stats.planned} 张图片到本地`);
  for (const f of stats.failed) notes.push(`图片下载失败，已跳过：${f}`);
  return notes;
}

function describe(r) {
  if (!r.ok) return `✗ ${r.keyword}：${r.message}`;
  const where = r.wikiTitle && r.wikiTitle !== r.keyword ? `（维基条目：${r.wikiTitle}）` : '';
  const head = {
    add: `+ 新增 ${r.event.title}${where}：${r.event.date}，${r.imageCount} 张图片，年份来自${r.yearFrom}`,
    update: `~ 更新 ${r.event.title}${where}：${r.fields.map((f) => FIELD_NAMES[f]).join('、')}`,
    same: `= 无变化 ${r.event.title}${where}`,
  }[r.action];
  return [head, ...r.notes.map((n) => `    ! ${n}`)].join('\n');
}

// ---------- 主流程 ----------
async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    // 打印文件开头的说明注释
    const lines = fs.readFileSync(__filename, 'utf8').split('\n').slice(1);
    const header = lines.slice(0, lines.findIndex((l) => !l.startsWith('//')));
    console.log(header.map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  const info = datasetInfo(opts.file);
  let data;
  try { data = JSON.parse(fs.readFileSync(opts.file, 'utf8')); } catch (e) { throw new UsageError(`无法读取数据集 ${opts.file}：${e.message}`); }
  if (!data || !Array.isArray(data.events)) throw new UsageError(`数据集格式不正确：${opts.file}`);

  const items = opts.list ? readList(opts.list) : opts.keywords.map((keyword) => ({ keyword, year: opts.year }));
  const client = new WikiClient(info);
  // 网站根目录 = 数据文件所在目录的上一级（data/cn_zh.json → 根目录），图片存到根目录下的 images/
  opts.imagesDir = path.resolve(path.dirname(opts.file), '..', 'images');
  const results = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && opts.delay) await sleep(opts.delay);   // 两次查询之间稍作间隔，避免触发维基限流
    let r;
    try {
      r = await importOne(client, data, info, items[i], opts);
    } catch (e) {
      r = { ok: false, keyword: items[i].keyword, message: e.message };
    }
    results.push(r);
    console.log(describe(r));
  }

  const changed = results.filter((r) => r.ok && r.action !== 'same').length;
  const failed = results.filter((r) => !r.ok).length;
  if (changed) {
    data.events.sort((a, b) => a.year - b.year);   // 按年份排序，便于查看 git diff
    validateDataset(info.id, data);
    if (opts.dryRun) console.log(`\n[dry-run] 将修改 ${changed} 个条目，未写入 ${opts.file}`);
    else {
      writeAtomic(path.resolve(opts.file), JSON.stringify(data, null, 2) + '\n');
      console.log(`\n已写入 ${opts.file}：修改 ${changed} 个条目`);
    }
  } else {
    console.log(`\n没有需要写入的修改${opts.dryRun ? '（dry-run）' : ''}`);
  }
  if (failed) console.log(`${failed} 个关键词失败`);
  return failed ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((e) => {
    console.error(`错误：${e.message}`);
    if (!(e instanceof UsageError) && !(e && e.status)) console.error(e.stack);
    process.exitCode = 2;
  });
}

module.exports = { main, parseArgs, readList, datasetInfo, cleanExtract, makeDetail, makeShort, makeImages, parseWikidataTime, dateLabel, imageSize, downloadImage, WikiClient };
