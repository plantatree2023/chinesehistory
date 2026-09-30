#!/usr/bin/env node
// 从维基百科查询历史事件，新增或更新数据集 JSON 中的条目。
//
// 用法：
//   node tools/wiki-import.js --file data/cn_zh.json 淝水之战 甲午战争
//   node tools/wiki-import.js --file data/cn_zh.json --list topics.txt
//   node tools/wiki-import.js --file data/cn_zh.json --dry-run 淝水之战
//   node tools/wiki-import.js --file data/cn_zh.json --refresh-images 淝水之战
//   node tools/wiki-import.js --file data/cn_zh.json --type 战争 --score 6 淝水之战
//
// 条目表（--list）每行一个关键词，可写成“关键词|年份|类型|重要程度”，后面几项可省略或留空
// （年份公元前写负数；例如“淝水之战|383|战争|6”“淝水之战|||6”），# 开头为注释。
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
// - 类型（type）与重要程度（majorScore，1–10）：新条目自动填写，已有条目缺少时补上，已有的值保留；
//   用 --type / --score 或条目表指定时以指定的为准。
//   类型依次取自：指定 → Wikidata“性质”（P31，如战役、条约、考古学文化）→ 事件名与简介中的关键词
//   （如“之战”“条约”“发明”）→ 年代早于前 2000 年的归为史前；都无法判断时不填写并提示。
//   类型名使用数据集 types 列表中对应 key 的名称（例如 war → 战争）。
//   重要程度根据 Wikidata 中该条目的语言版本数估算（越多说明越受关注），没有 Wikidata 时默认为 5；均会提示核对。
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
const DEFAULT_SCORE = 5;

// 事件类型：key 为各数据集通用的标识，显示名称来自数据集的 types 列表；数据集没有列表时使用这里的默认名称
const TYPE_LABELS = {
  zh: { prehistory: '史前', politics: '政治', war: '战争', culture: '文化', science: '科技', economy: '经济', foreign: '对外交流', society: '社会' },
  'zh-Hant': { prehistory: '史前', politics: '政治', war: '戰爭', culture: '文化', science: '科技', economy: '經濟', foreign: '對外交流', society: '社會' },
  en: { prehistory: 'Prehistory', politics: 'Politics', war: 'War', culture: 'Culture', science: 'Science & technology', economy: 'Economy', foreign: 'Foreign relations', society: 'Society' },
};
// Wikidata“性质”（P31）→ 类型
const P31_TYPES = {
  war: ['Q178561', 'Q198', 'Q180684', 'Q350604', 'Q124734', 'Q188055', 'Q645883', 'Q1261499', 'Q831663', 'Q2001676', 'Q3199915', 'Q1361229'],
  politics: ['Q10931', 'Q45382', 'Q164950', 'Q3024240', 'Q7275', 'Q2738074'],
  foreign: ['Q131569', 'Q625298', 'Q2401485'],
  culture: ['Q571', 'Q7725634', 'Q47461344', 'Q3305213', 'Q838948', 'Q44539', 'Q5393308', 'Q35509'],
  science: ['Q12284', 'Q12280', 'Q12323', 'Q57821', 'Q11016'],
  society: ['Q7944', 'Q8065', 'Q8068', 'Q168247', 'Q44512', 'Q3241045'],
  prehistory: ['Q465299', 'Q839954', 'Q40614'],
};
// 中文关键词 → 类型，按顺序匹配事件名（优先）和简介首句
const ZH_TYPE_WORDS = [
  ['war', /战役|之战|战争|海战|起义|之乱|之变|事变|兵变|北伐|东征|西征|抗[日金元清美]|援朝|侵华|入侵|收复|火烧|围城|屠城|战|役/],
  ['foreign', /条约|条約|出使|来华|西行|访华|建交|外交|下西洋|和亲|入藏|之盟|使团|通商|联合国/],
  ['science', /发明|造纸|印刷|火药|指南针|地动仪|历法|运河|长城|都江堰|水利|工程|原子弹|氢弹|卫星|航天|医|本草|算|天文/],
  ['economy', /经济|贸易|商业|货币|特区|开放|洋务|赋税|税|盐铁|钱/],
  ['culture', /文化运动|儒|佛|道教|诗|词|书法|画|经|史记|文学|思想|哲学|宗教|寺|石窟|艺术|典籍|全书|集|序|孔子|老子|百家|甲骨|文字|青铜|鼎(?!立)|陵|兵马俑|宫殿|紫禁城|故宫|建筑/],
  ['society', /地震|洪水|水灾|旱灾|饥荒|瘟疫|暴动|治水|灾/],
  ['politics', /建立|统一|称帝|变法|改革|革命|登基|迁都|东迁|南迁|分晋|建国|成立|运动|制度|制|朝|政|之治|盛世|分裂|鼎立|入关|灭/],
];

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
    else if (a === '--type') opts.type = value().trim();
    else if (a === '--score') opts.score = parseScore(value());
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
  if ((opts.type || opts.score != null) && (opts.list || opts.keywords.length !== 1)) throw new UsageError('--type / --score 只能配合单个关键词使用；条目表中请写“关键词|年份|类型|重要程度”');
  if (!Number.isFinite(opts.delay) || opts.delay < 0) throw new UsageError('--delay 必须是非负数（毫秒）');
  return opts;
}

function parseYear(text) {
  const y = Number(String(text).trim());
  if (!Number.isInteger(y) || y === 0) throw new UsageError(`年份无效：${text}（公元前写负数，没有公元 0 年）`);
  return y;
}

function parseScore(text) {
  const n = Number(String(text).trim());
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new UsageError(`重要程度无效：${text}（应为 1–10 的整数）`);
  return n;
}

// 条目表：每行“关键词|年份|类型|重要程度”，后几项可省略或留空；忽略空行和 # 注释
function readList(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new UsageError(`无法读取条目表：${file}`); }
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => {
    const [keyword, year, type, score] = line.split('|').map((s) => s.trim());
    if (!keyword) throw new UsageError(`条目表格式错误：${line}`);
    return { keyword, year: year ? parseYear(year) : undefined, type: type || undefined, score: score ? parseScore(score) : undefined };
  });
}

// data/cn_zh.json → { id: 'cn_zh', lang: 'zh', acceptLanguage: 'zh-cn' }
function datasetInfo(file) {
  const id = path.basename(file, '.json');
  if (!DATASET_ID.test(id)) throw new UsageError(`文件名应为 <国家>_<语言>.json，例如 cn_zh.json：${file}`);
  const [lang, script] = id.split('_')[1].split('-');
  const hant = lang === 'zh' && /^(Hant|TW|HK)$/i.test(script || '');
  let acceptLanguage = lang;
  if (lang === 'zh') acceptLanguage = hant ? 'zh-tw' : 'zh-cn';
  return { id, lang, acceptLanguage, typeLabels: TYPE_LABELS[hant ? 'zh-Hant' : lang] || TYPE_LABELS.en };
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
  const e = entityOf(entity, qid);
  if (!e || !e.claims) return null;
  for (const p of YEAR_PROPERTIES) {
    for (const claim of e.claims[p] || []) {
      const t = claim.mainsnak && claim.mainsnak.datavalue && parseWikidataTime(claim.mainsnak.datavalue.value);
      if (t) return { ...t, from: `Wikidata ${p}` };
    }
  }
  return null;
}

function entityOf(entity, qid) {
  return (entity && entity.entities && (entity.entities[qid] || Object.values(entity.entities)[0])) || null;
}

// Wikidata 条目的语言版本数（各语言维基百科的链接数），用来估算重要程度
function sitelinkCount(e) {
  return e && e.sitelinks ? Object.keys(e.sitelinks).filter((k) => /wiki$/.test(k) && !/^(commons|species|meta|mediawiki|wikidata|sources|outreach|incubator)wiki$/.test(k)).length : null;
}

// 语言版本数 → 重要程度（1–10）：先按版本数分档，再向中间值 5 收拢 30%，减少明显偏高 / 偏低的估计。
// 用 cn_zh.json 中人工评定的 100 个事件检验：约 57% 的估计与人工评分相差不超过 1，
// 偏差大的多是来源条目比事件本身宽泛（如“商汤灭夏”对应“商朝”条目），因此估计值只作参考，均会提示核对。
// 例：1 个 → 2，2 个 → 3，约 10 个 → 4，约 20 个 → 5，约 50 个 → 6，约 80 个 → 7，100 个 → 8，150 个以上 → 9
const SCORE_STEPS = [[150, 10], [100, 9], [70, 8], [45, 7], [28, 6], [15, 5], [8, 4], [4, 3], [2, 2]];
const SCORE_SHRINK = 0.7;
function scoreFromSitelinks(n) {
  let step = 1;
  for (const [min, score] of SCORE_STEPS) if (n >= min) { step = score; break; }
  return Math.round(DEFAULT_SCORE + (step - DEFAULT_SCORE) * SCORE_SHRINK);
}

// 推断类型：Wikidata P31 → 关键词 → 史前（前 2000 年以前）；返回 { key, from } 或 null
function inferType({ title, text, year, entity, lang }) {
  const p31 = new Set(((entity && entity.claims && entity.claims.P31) || [])
    .map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id).filter(Boolean));
  const byWords = (where) => {
    if (lang !== 'zh' || !where) return null;
    for (const [key, re] of ZH_TYPE_WORDS) if (re.test(where)) return { key, from: '关键词' };
    return null;
  };
  for (const [key, ids] of Object.entries(P31_TYPES)) if (ids.some((q) => p31.has(q))) return { key, from: 'Wikidata' };
  return byWords(title)
    || (year != null && year < -2000 ? { key: 'prehistory', from: '年代' } : null)
    || byWords(sentences(text || '')[0]);
}

// 类型 key → 数据集中的类型名：优先用数据集 types 列表中同 key 的名称
function typeName(data, info, key) {
  const t = Array.isArray(data.types) && data.types.find((x) => x && x.key === key);
  return t ? t.name : info.typeLabels[key];
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

const FIELD_NAMES = { title: '事件名', year: '年份', date: '时间', short: '简要说明', detail: '详细说明', images: '图片', source: '来源', type: '类型', majorScore: '重要程度', wiki: '维基条目' };

function changedFields(before, after) {
  return Object.keys(FIELD_NAMES).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}

// 指定的类型：可以是数据集中的类型名，也可以是类型 key（如 war）；数据集有类型列表时必须在列表中
function resolveGivenType(data, info, given) {
  const list = Array.isArray(data.types) ? data.types : null;
  if (list) {
    const t = list.find((x) => x && (x.name === given || x.key === given));
    return t ? t.name : null;
  }
  return info.typeLabels[given] || given;
}

// 类型与重要程度：指定的优先，其次保留已有的值，最后根据 Wikidata 和文字推断；返回要写入的字段与提示
async function classify(client, data, info, { summary, text, title, year, existing, given }) {
  const out = {}, notes = [];
  const needType = !given.type && !(existing && existing.type);
  const needScore = given.score == null && !(existing && Number.isInteger(existing.majorScore));
  let entity = null;
  if ((needType || needScore) && summary.wikibase_item) entity = entityOf(await client.entity(summary.wikibase_item), summary.wikibase_item);

  if (given.type) out.type = given.type;
  else if (needType) {
    const t = inferType({ title, text, year, entity, lang: info.lang });
    const name = t && typeName(data, info, t.key);
    if (name) {
      out.type = name;
      notes.push(`类型“${name}”由${{ Wikidata: ' Wikidata 性质', 关键词: '事件名 / 简介中的关键词', 年代: '年代（前 2000 年以前）' }[t.from]}推断，请核对`);
    } else {
      notes.push('无法判断类型，未填写；可用 --type 或条目表第三项指定');
    }
  }

  if (given.score != null) out.majorScore = given.score;
  else if (needScore) {
    const n = sitelinkCount(entity);
    if (n != null) {
      out.majorScore = scoreFromSitelinks(n);
      notes.push(`重要程度 ${out.majorScore} 根据 Wikidata 语言版本数（${n} 个）估算，请核对`);
    } else {
      out.majorScore = DEFAULT_SCORE;
      notes.push(`没有 Wikidata 信息，重要程度默认为 ${DEFAULT_SCORE}，请核对`);
    }
  }
  return { fields: out, notes, entity };
}

// 处理一个关键词：查询维基并新增 / 更新 data.events 中的条目，返回结果说明
async function importOne(client, data, info, { keyword, year, type, score }, opts = {}) {
  const given = { score };
  if (type) {
    given.type = resolveGivenType(data, info, type);
    if (!given.type) {
      const names = data.types.map((t) => t.name).join('、');
      return { ok: false, keyword, message: `类型“${type}”不在数据集的类型列表中（可用：${names}）` };
    }
  }
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
    const cls = await classify(client, data, info, { summary, text, title: existing.title, year: updated.year, existing, given });
    Object.assign(updated, cls.fields);
    delete updated.major;   // 旧版本的重大事件标记，已由 majorScore 代替
    notes.push(...cls.notes);
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

  // Wikidata 同时用于年份、类型和重要程度，只请求一次
  const entityJson = summary.wikibase_item ? await client.entity(summary.wikibase_item) : null;
  if (!when && entityJson) when = yearFromEntity(entityJson, summary.wikibase_item);
  if (!when) {
    when = yearFromText(text, info.lang);
    if (when) notes.push(`年份 ${when.year} 取自简介文字，请核对`);
  }
  if (!when) return { ok: false, keyword, message: `无法确定年份，请用“${keyword}|年份”或 --year 指定` };

  const cls = await classify({ entity: async () => entityJson }, data, info, { summary, text, title: keyword, year: when.year, existing: null, given });
  notes.push(...cls.notes);
  const event = {
    id: nextId(data.events),
    year: when.year,
    date: dateLabel(when.year, when.precision, info.lang),
    title: keyword,
    short: makeShort(text),
    detail: fromWiki.detail,
    images: [],
    source: fromWiki.source,
    ...cls.fields,
    wiki: fromWiki.wiki,
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
    add: `+ 新增 ${r.event.title}${where}：${r.event.date}，${r.event.type ? `类型 ${r.event.type}，` : ''}重要程度 ${r.event.majorScore}，${r.imageCount} 张图片，年份来自${r.yearFrom}`,
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

  const items = opts.list ? readList(opts.list) : opts.keywords.map((keyword) => ({ keyword, year: opts.year, type: opts.type, score: opts.score }));
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

module.exports = { main, parseArgs, readList, datasetInfo, inferType, scoreFromSitelinks, sitelinkCount, cleanExtract, makeDetail, makeShort, makeImages, parseWikidataTime, dateLabel, imageSize, downloadImage, WikiClient };
