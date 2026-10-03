(function () {
  'use strict';

  // 数据集：data/<国家>_<语言>.json（国家为 ISO 3166 代码，语言为 ISO 639 代码），
  // 可通过网址参数 ?data=jp_ja 切换，默认 cn_zh（中国 · 中文）；测试通过 window.TIMELINE_DATASET 换成测试数据
  var DATASET_ID = /^[a-z]{2}_[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
  var DEFAULT_DATASET = window.TIMELINE_DATASET || 'cn_zh';
  var dataset = (function () {
    var id = new URLSearchParams(location.search).get('data');
    return id && DATASET_ID.test(id) ? id : DEFAULT_DATASET;
  })();
  var STORAGE_KEY = 'zh-history-timeline:v1:' + dataset;

  // ---------- 界面语言（i18n） ----------
  // 语言由数据集名称中的语言部分决定（cn_zh → zh，cn_en → en）。界面文字以中文为原文写在 index.html 和本文件中，
  // 其他语言在 js/i18n/<语言>.js 的 strings 中按中文原文给出译文；没有对应语言或译文时显示中文
  var I18N = window.TIMELINE_I18N || {};
  var LANG = (function () {
    var lang = dataset.split('_')[1].split('-')[0];
    return I18N[lang] ? lang : 'zh';
  })();
  var LOCALE = I18N[LANG] || {};
  var LIMITS = LOCALE.limits || {};
  // _('已删除“{title}”', { title: ... })：返回当前语言的文字，{名称} 替换为对应的值（与 gettext 的写法相同）
  function _(text, vars) {
    var strings = LOCALE.strings || {};
    var out = Object.prototype.hasOwnProperty.call(strings, text) ? strings[text] : text;   // 译文可以是空字符串（如英文中不需要的“年”）
    return vars ? out.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? String(vars[k]) : m; }) : out;
  }
  // index.html 中的界面文字按中文原文查找译文：文字节点，以及 title、aria-label、placeholder 属性；
  // 含有标签（链接、加粗等）的段落用 data-i18n 标出，按整段 innerHTML（空白合并为一个空格）查找译文
  function translateStatic() {
    var root = document.documentElement;
    root.classList.remove('i18n-pending');
    if (LANG === 'zh') return;
    root.lang = LOCALE.htmlLang || LANG;
    if (LOCALE.siteName) document.title = LOCALE.siteName;
    var CJK = /[\u3400-\u9fff\uff01-\uff5e\u3001-\u303f]/;
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.innerHTML = _(node.innerHTML.replace(/\s+/g, ' ').trim());
    });
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!CJK.test(n.nodeValue) || /^(SCRIPT|STYLE)$/.test(p.nodeName) || (p.closest && p.closest('[data-i18n]'))) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      var text = n.nodeValue.trim();
      n.nodeValue = n.nodeValue.replace(text, _(text));
    });
    ['title', 'aria-label', 'placeholder'].forEach(function (attr) {
      document.querySelectorAll('body [' + attr + ']').forEach(function (node) {
        var v = node.getAttribute(attr);
        if (CJK.test(v)) node.setAttribute(attr, _(v));
      });
    });
  }
  translateStatic();
  var LEGACY_STORAGE_KEY = 'zh-history-timeline:v1';   // 旧版本（仅中国数据）使用的键
  var MAX_IMAGES = 9;
  var MAX_DETAIL = LIMITS.maxDetail || 600;
  // 任意一屏宽度内最多显示的事件数：大屏幕（时间轴区域宽度不小于 LARGE_SCREEN_W）上放宽到 8 个，
  // 其余（笔记本、平板、手机）为 6 个。窗口大小变化时会重新排版
  var MAX_PER_SCREEN = 6, MAX_PER_SCREEN_LARGE = 8, LARGE_SCREEN_W = 1600;
  function maxPerScreen(width) { return width >= LARGE_SCREEN_W ? MAX_PER_SCREEN_LARGE : MAX_PER_SCREEN; }
  var MAX_CAPTION = LIMITS.maxCaption || 60;     // 图片标题最多字数
  var MIN_SUMMARY = LIMITS.minSummary || 20;     // 卡片说明文字至少的字数（不计标点）
  var SUMMARY_CUT = LIMITS.summaryCut || 60;     // 简要说明不足时从详细说明截取的长度
  // 编辑页的长度上限按语言设置（index.html 中写的是中文的上限）
  (function () {
    var form = document.getElementById('editForm');
    [['title', 'maxTitle'], ['date', 'maxDate'], ['short', 'maxShort'], ['detail', 'maxDetail']].forEach(function (p) {
      if (form && LIMITS[p[1]]) form[p[0]].maxLength = LIMITS[p[1]];
    });
  })();

  // 朝代 / 时期色带（用于时间轴着色与“当前时代”提示），从数据集加载
  var ERAS = [];

  var CURRENT_YEAR = new Date().getFullYear();
  // 时期的结束年份；数据中 end 为 null 表示延续至今
  function eraEnd(era) { return era.end == null ? CURRENT_YEAR : era.end; }

  var TICK_YEARS = [-1500000, -1000000, -500000, -200000, -100000, -50000, -20000, -10000, -5000, -4000, -3000];
  for (var ty = -2500; ty <= 1900; ty += 100) TICK_YEARS.push(ty);
  for (ty = 1910; ty < CURRENT_YEAR; ty += 10) TICK_YEARS.push(ty);

  // ---------- 工具 ----------
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function uid() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // 年份的显示方式由当前语言决定（js/i18n/<语言>.js）
  var ZH = I18N.zh || {};
  function formatYear(y) { return (LOCALE.formatYear || ZH.formatYear)(y); }
  function tickLabel(y) { return (LOCALE.tickLabel || ZH.tickLabel)(y); }
  function eraByName(name) {
    for (var i = 0; i < ERAS.length; i++) if (ERAS[i].name === name) return ERAS[i];
    return { name: name, color: '#8a8178' };
  }
  function eraOf(y) {
    for (var i = ERAS.length - 1; i >= 0; i--) if (y >= ERAS[i].start) return ERAS[i];
    return ERAS[0];
  }

  // 不计标点和空白的字数
  function charCount(t) {
    return (t || '').replace(/[\s，。、；：“”‘’《》〈〉（）【】！？·—…,.;:()\[\]!?"'-]/g, '').length;
  }
  // 卡片上显示的说明：简要说明不足 20 字时从详细说明中截取补足
  function summaryOf(ev) {
    var short = (ev.short || '').trim();
    if (charCount(short) >= MIN_SUMMARY) return short;
    var detail = (ev.detail || '').replace(/\s+/g, LANG === 'zh' ? '' : ' ').trim();   // 中文去掉空白，其他语言保留词间空格
    if (!detail) return short;
    var text = short && detail.indexOf(short) === -1 ? short + (LANG === 'zh' ? '' : ' ') + detail : detail;
    return text.length > SUMMARY_CUT ? text.slice(0, SUMMARY_CUT - 2) + '…' : text;
  }

  function transitionText(t) { return t.from + ' → ' + t.to; }

  // 参考链接：sources 为 [{ url, title }]；兼容旧版本保存在浏览器中的单个 source 字段
  var MAX_SOURCES = 10;
  function sourcesOf(ev) {
    if (Array.isArray(ev.sources)) return ev.sources.filter(function (s) { return s && s.url; });
    return ev.source ? [{ url: ev.source }] : [];
  }
  function isWikipedia(s) { return /^https?:\/\/[^/]*wikipedia\.org\//.test(s.url); }
  function sourceLabel(s) {
    if (s.title) return s.title;
    return isWikipedia(s) ? _('维基百科') : s.url;
  }

  // 事件类型：顺序和颜色来自数据集的 types；数据中出现但不在列表里的类型排在后面（灰色），没有类型的归为“未分类”
  var TYPES = [];
  var UNTYPED_COLOR = '#8a8178';
  function typeInfo(name) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].name === name) return TYPES[i];
    return { name: name, color: UNTYPED_COLOR };
  }
  function typeParamOf(name) {
    if (!name) return 'none';
    var t = typeInfo(name);
    return t.key || name;
  }
  function typeNameOfParam(v) {
    if (v === 'none') return '';
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].key === v || TYPES[i].name === v) return TYPES[i].name;
    return events.some(function (ev) { return ev.type === v; }) ? v : null;
  }
  // 逗号分隔的列表参数
  function listParam(p, name) {
    var v = p.get(name);
    return v ? v.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; }) : [];
  }
  function typesWithEvents(counts) {
    var out = TYPES.filter(function (t) { return counts[t.name] > 0; });
    Object.keys(counts).forEach(function (name) {
      if (name && !TYPES.some(function (t) { return t.name === name; })) out.push({ name: name, color: UNTYPED_COLOR });
    });
    if (counts['']) out.push({ name: '', label: _('未分类'), color: UNTYPED_COLOR });
    return out;
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // 图片元素，加载失败时回退到占位图。
  // deferred 为 true 时先不设置 src（地址放在 data-src），由 loadNearbyImages 在卡片接近视野时再加载
  function imageEl(image, cls, fallbackChar, deferred) {
    if (image && image.src) {
      var img = el('img', cls);
      if (deferred) img.dataset.src = image.src;
      else img.src = image.src;
      img.alt = image.caption || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.draggable = false;
      // 图片都从本地加载；加载失败（文件缺失等）时显示同尺寸的占位图
      img.addEventListener('error', function () {
        var ph = placeholder(cls, fallbackChar);
        ph.style.cssText = img.style.cssText;
        img.replaceWith(ph);
      }, { once: true });
      return img;
    }
    return placeholder(cls, fallbackChar);
  }
  function placeholder(cls, ch) {
    var d = el('div', (cls || '') + ' img-placeholder', (ch || '史').charAt(0));
    d.setAttribute('aria-hidden', 'true');
    return d;
  }

  // ---------- 数据 ----------
  // 两种保存方式：
  // - 本地文件模式：页面由本地服务器（npm start）提供且可写时，修改直接写回 data/<数据集>.json，
  //   上传的图片保存为 images/ 下的文件；
  // - 浏览器模式：其他情况（如 GitHub Pages），修改保存在当前浏览器的 localStorage 中。
  var meta = null;          // 数据集中除事件外的信息（id、国家、语言、时期）
  var defaultEvents = [];   // 数据文件中的事件
  var events = [];
  var fileMode = false;
  var ready = false;

  // 浏览器模式只保存访问者自己的改动（相对数据文件的差异），数据文件以后的更新（新增字段、新事件等）仍会生效：
  // { version: 2, changed: { id: 修改后或新增的事件 }, deleted: [被删除的默认事件 id] }
  // 修改过的默认事件只记录与数据文件不同的字段（值为 null 表示该字段被删除），其余字段始终取数据文件中的值；
  // 新增的事件记录完整内容。
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
        .map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v);
  }
  function defaultsById() {
    var map = {};
    defaultEvents.forEach(function (ev) { map[ev.id] = ev; });
    return map;
  }
  // 事件相对数据文件中同一事件的差异，没有差异时返回 null
  function eventDiff(ev, def) {
    var ch = {}, any = false;
    Object.keys(ev).forEach(function (k) {
      if (k !== 'id' && canonical(ev[k]) !== canonical(def[k])) { ch[k] = ev[k]; any = true; }
    });
    Object.keys(def).forEach(function (k) {
      if (!(k in ev)) { ch[k] = null; any = true; }
    });
    return any ? ch : null;
  }
  function applyChanges(changed, deleted) {
    var defs = defaultsById(), gone = {}, out = [];
    (deleted || []).forEach(function (id) { gone[id] = true; });
    defaultEvents.forEach(function (def) {
      if (gone[def.id]) return;
      var ch = changed[def.id];
      if (!ch) { out.push(clone(def)); return; }
      var ev = clone(def);
      Object.keys(ch).forEach(function (k) {
        if (ch[k] === null) delete ev[k]; else ev[k] = clone(ch[k]);
      });
      out.push(ev);
    });
    Object.keys(changed).forEach(function (id) {
      if (!defs[id] && !gone[id] && changed[id] && changed[id].title) out.push(clone(changed[id]));
    });
    return out;
  }
  // 旧格式（整个事件数组的快照）：与数据文件相同的事件不再算作改动；
  // 仍引用外部图片的旧快照事件改用数据文件中的本地图片
  function migrateSnapshot(list) {
    var defs = defaultsById(), changed = {}, seen = {};
    list.forEach(function (ev) {
      if (!ev || !ev.id) return;
      seen[ev.id] = true;
      var def = defs[ev.id];
      if (!def) { changed[ev.id] = ev; return; }
      var copy = clone(ev);
      var external = (copy.images || []).some(function (im) { return !/^(images\/|data:)/.test(im.src || ''); });
      if (external) copy.images = clone(def.images || []);
      Object.keys(def).forEach(function (k) { if (!(k in copy)) copy[k] = def[k]; });
      var ch = eventDiff(copy, def);
      if (ch) changed[ev.id] = ch;
    });
    var deleted = defaultEvents.filter(function (d) { return !seen[d.id]; }).map(function (d) { return d.id; });
    return { changed: changed, deleted: deleted };
  }
  function diffFromDefaults() {
    var defs = defaultsById(), changed = {}, present = {};
    events.forEach(function (ev) {
      present[ev.id] = true;
      var def = defs[ev.id];
      var ch = def ? eventDiff(ev, def) : ev;
      if (ch) changed[ev.id] = ch;
    });
    return {
      version: 2,
      changed: changed,
      deleted: defaultEvents.filter(function (d) { return !present[d.id]; }).map(function (d) { return d.id; })
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      // 迁移旧版本保存的修改（旧版本只有中国数据）
      if (!raw && dataset === DEFAULT_DATASET) {
        raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (raw) localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      if (raw) {
        var data = JSON.parse(raw);
        if (Array.isArray(data)) {
          var m = migrateSnapshot(data);
          var list = applyChanges(m.changed, m.deleted);
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, changed: m.changed, deleted: m.deleted }));
          return list;
        }
        if (data && data.version === 2 && data.changed && typeof data.changed === 'object') {
          return applyChanges(data.changed, data.deleted);
        }
      }
    } catch (e) { /* 忽略，使用默认数据 */ }
    return clone(defaultEvents);
  }
  function save() {
    if (fileMode) {
      saveToFile().catch(function (e) { toast(_('写入数据文件失败：{error}', { error: e.message })); });
      return true;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(diffFromDefaults()));
      return true;
    } catch (e) {
      toast(_('浏览器存储空间不足，修改仅在本次访问中有效'));
      return false;
    }
  }

  function requestJson(url, method, body) {
    return fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
        return json;
      });
    });
  }
  // 把内嵌（上传）的图片存为 images/ 下的文件，事件中只保留路径
  function uploadInlineImages() {
    var jobs = [];
    events.forEach(function (ev) {
      (ev.images || []).forEach(function (im) {
        if (/^data:/.test(im.src)) jobs.push(im);
      });
    });
    return jobs.reduce(function (p, im) {
      return p.then(function () {
        return requestJson('api/images', 'POST', { dataUrl: im.src }).then(function (r) { im.src = r.path; });
      });
    }, Promise.resolve());
  }
  // 依次写入，避免连续修改时后发的请求被先发的覆盖
  var saveQueue = Promise.resolve();
  // 返回这一次写入的结果（失败时 reject）；队列本身吞掉错误，不影响之后的写入
  function saveToFile() {
    var run = saveQueue.then(function () {
      return uploadInlineImages().then(function () {
        var payload = Object.assign({}, meta, { events: sorted() });
        return requestJson('api/data/' + dataset, 'PUT', payload);
      });
    });
    saveQueue = run.catch(function () {});
    return run;
  }
  function sorted() {
    return events.slice().sort(function (a, b) { return a.year - b.year; });
  }
  function findEvent(id) {
    for (var i = 0; i < events.length; i++) if (events[i].id === id) return events[i];
    return null;
  }

  // ---------- 时间轴布局 ----------
  var stage = $('stage'), track = $('track');
  var layout = { xs: [], list: [], anchors: [], width: 0 };
  var offset = 0;          // track 的 translateX
  var PAD = 140;

  // 非线性刻度：史前压缩（对数），有文字记载后线性
  var LIN = 0.9, LOG = 380;
  function rawPos(y) {
    if (y >= -3000) return (y + 3000) * LIN;
    return -Math.log10(-y / 3000) * LOG;
  }
  function yearOfRaw(r) {
    return r >= 0 ? r / LIN - 3000 : -3000 * Math.pow(10, -r / LOG);
  }

  // 卡片形状：图文关系有三种（上图下文 / 左图右文 / 右图左文），
  // 代表图按原始比例完整显示，大小由剩余空间决定
  var KINDS = ['stack', 'left', 'right'];
  // 图片按事件的重要程度（majorScore，1–10）分三个等级显示：
  // 1–5 小、6–7 中、8–10 大（重大事件）。sizes 为图片面积候选（px²，优先用大的），
  // maxImgW 为图片最大宽度，heightFrac 为图片最大高度占可用高度（轴线一侧）的比例，weight 越大越坚持用大图。
  // 窄屏上小、中两级的面积按屏幕宽度缩小（系数的 shrink 次方），让三个等级在任何屏幕上都有明显差别
  var DEFAULT_SCORE = 5;
  var TIERS = {
    1: { sizes: [40000, 31000, 23000, 16000, 11000], maxImgW: 380, heightFrac: 0.52, shrink: 1, weight: 80 },
    2: { sizes: [66000, 52000, 40000, 29000, 20000], maxImgW: 460, heightFrac: 0.72, shrink: 1.4, weight: 110 },
    3: { sizes: [210000, 170000, 136000, 108000, 84000, 62000], maxImgW: 700, heightFrac: 1, shrink: 0, weight: 300 }
  };
  var SIDE_TEXT_W = 150, MIN_STACK_W = 172, MIN_IMG_SIDE = 56;
  var CROP_COST = 250;   // 排版时图片被裁去 10% 记 25 分（见 shapeFor）
  var GROW_COST = 30;    // 为占满图片区把图片放大一倍记 30 分
  var MAX_GROW = 1.5;    // 为占满图片区，图片面积最多放大的倍数
  var MAX_CROP = 0.2;    // 卡片图片最多裁去 20%，其余用虚化的同一张图片铺满（见 imageFit）
  var MIN_SHOWN = 0.8;   // 图片的宽和高都至少占图片区的 80%（虚化部分不超过 20%）
  var WIDEN_STEP = 24;   // 图片太小时卡片或文字栏每次加宽的像素
  function scoreOf(ev) {
    var n = ev && ev.majorScore;
    return typeof n === 'number' && n >= 1 && n <= 10 ? Math.round(n) : DEFAULT_SCORE;
  }
  function tierOf(ev) {
    var n = scoreOf(ev);
    return n >= 8 ? 3 : n >= 6 ? 2 : 1;
  }
  function isMajor(ev) { return tierOf(ev) === 3; }

  var ratioCache = {};
  function coverRatio(ev) {
    var im = ev.images && ev.images[0];
    if (!im) return 4 / 3;
    if (im.w && im.h) return im.w / im.h;
    return ratioCache[im.src] || 4 / 3;
  }
  // 数据中没有记录尺寸的图片，加载后测量比例并重新排版
  function ensureRatios() {
    events.forEach(function (ev) {
      var im = ev.images && ev.images[0];
      if (!im || (im.w && im.h) || ratioCache[im.src] !== undefined) return;
      ratioCache[im.src] = 4 / 3;
      var probe = new Image();
      probe.onload = function () {
        if (probe.naturalWidth && probe.naturalHeight) {
          ratioCache[im.src] = probe.naturalWidth / probe.naturalHeight;
          scheduleRelayout();
        }
      };
      probe.src = im.src;
    });
  }

  function cardBody(ev) {
    var body = el('div', 'card-body');
    body.appendChild(el('div', 'card-date', ev.date || formatYear(ev.year)));
    body.appendChild(el('div', 'card-title', ev.title));
    var summary = summaryOf(ev);
    if (summary) body.appendChild(el('p', 'card-short', summary));
    return body;
  }
  // 在隐藏元素中实际排版，测量文字区高度
  var measurer = null, textCache = {};
  function textHeight(ev, width, kind) { return textLayout(ev, width, kind).h; }
  // 文字区的高度 h，其中日期和标题占 fixed，说明每行高 lh（说明可以截短，见 clampedText）
  function textLayout(ev, width, kind) {
    // 宽度按 4px 向下取整再测量：窄一点只会让测得的高度偏大（更保守），而缓存命中率高得多
    width = Math.floor(width / 4) * 4;
    var key = [ev.id, width, kind, tierOf(ev), ev.date, ev.title, summaryOf(ev)].join('|');
    if (textCache[key]) return textCache[key];
    if (!measurer) {
      measurer = el('div');
      measurer.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;display:flex;flex-direction:column;border:1px solid transparent;';
      document.body.appendChild(measurer);
    }
    measurer.className = 'measure k-' + kind + ' tier-' + tierOf(ev) + (isMajor(ev) ? ' major' : '');
    measurer.style.width = (width + 2) + 'px';
    measurer.innerHTML = '';
    var body = cardBody(ev);
    measurer.appendChild(body);
    var h = Math.ceil(body.getBoundingClientRect().height);
    var short = body.querySelector('.card-short');
    var shortH = short ? short.getBoundingClientRect().height : 0;
    var lh = short ? parseFloat(getComputedStyle(short).lineHeight) || 18 : 18;
    textCache[key] = { h: h, fixed: h - shortH, lh: lh };
    measurer.innerHTML = '';
    return textCache[key];
  }
  // 文字区最高 maxTh 时，说明截短成几行（lines，null 表示不用截短，0 表示不显示）以及截短后的高度；
  // 说明不到 minLines 行（默认 2）时返回 null
  function clampedText(ev, width, kind, maxTh, minLines) {
    var t = textLayout(ev, width, kind);
    if (t.h <= maxTh) return { h: t.h, lines: null };
    var lines = Math.floor((maxTh - t.fixed) / t.lh + 0.01);
    if (lines < (minLines == null ? 2 : minLines)) return null;
    return { h: Math.ceil(t.fixed + lines * t.lh), lines: lines };
  }

  // 按图片比例、面积和最大高度计算卡片尺寸，放不下返回 null。
  // 图片区（iw × ih）四边都由图片占满，不留空隙：上下排时图片区与卡片同宽（不窄于 MIN_STACK_W），
  // 左右排时与卡片同高（不矮于文字区）。图片区与原图比例一致时完整显示，所以图片较小时先放大，
  // 但面积尽量不超过 MAX_GROW 倍（免得小图变成大图）；仍对不上比例时（如手机上文字较长）
  // 图片裁去一部分（crop 为裁去的比例，排版时尽量避免），裁得太多时周围用虚化的图片铺满（见 imageFit），
  // 但图片的宽和高都至少占图片区的 MIN_SHOWN：达不到时加宽卡片（上下排）或文字栏（左右排），让文字变矮
  function shapeFor(ev, r, area, kind, maxH, maxW) {
    var iw = Math.sqrt(area * r), ih = Math.sqrt(area / r), th, cw, avail, want, h;
    var tier = TIERS[tierOf(ev)];
    var maxIh = maxH * tier.heightFrac;
    var fill = coverFill(ev);
    if (iw > tier.maxImgW) { iw = tier.maxImgW; ih = iw / r; }
    if (ih > maxIh) { ih = maxIh; iw = ih * r; }
    if (kind === 'stack') {
      for (var k = 0; k < 2; k++) {
        cw = Math.max(iw, MIN_STACK_W);
        th = textHeight(ev, cw, 'stack');
        avail = maxH - th - 2;
        if (ih <= avail) break;
        ih = avail; iw = ih * r;
      }
      want = iw * Math.min(ih, avail);
      for (; cw <= maxW - 2; cw += WIDEN_STEP) {
        th = textHeight(ev, cw, 'stack');
        avail = maxH - th - 2;
        // 宽度固定为卡片宽度，高度尽量按原图比例
        h = Math.min(cw / r, avail, Math.max(want * MAX_GROW / cw, ih, fill * cw / r));
        if (h >= fill * cw / r - 0.5 && h >= MIN_IMG_SIDE) {
          return { kind: kind, iw: cw, ih: h, want: want, crop: cropOf(cw, h, r), w: Math.round(cw + 2), h: Math.round(h + th + 2) };
        }
      }
      return null;
    }
    if (ih + 2 > maxH) { ih = maxH - 2; iw = ih * r; }
    want = iw * ih;
    for (var tw = SIDE_TEXT_W; tw + MIN_IMG_SIDE + 2 <= maxW; tw += WIDEN_STEP) {
      th = textHeight(ev, tw, 'side');
      if (th + 2 > maxH) continue;
      // 高度固定为卡片高度（不矮于文字区），宽度尽量按原图比例
      h = Math.max(ih, th);
      var w = Math.min(h * r, maxW - tw - 2, Math.max(want * MAX_GROW / h, iw, fill * h * r));
      if (w >= fill * h * r - 0.5 && w >= MIN_IMG_SIDE) {
        return { kind: kind, iw: w, ih: h, tw: tw, want: want, crop: cropOf(w, h, r), w: Math.round(w + tw + 2), h: Math.round(h + 2) };
      }
    }
    return null;
  }
  // 图片区与原图比例最多相差的倍数（的倒数；多留 1% 给取整）；没有图片的事件显示占位图，不限
  function coverFill(ev) {
    var im = ev.images && ev.images[0];
    return im && im.src ? (1 - MAX_CROP) * (MIN_SHOWN + 0.01) : 0;
  }
  // 排版放不下时的候选：最宽的上下排，或者图片占满卡片高度的左右排，说明截短（clamp 为行数），
  // 图片的宽和高仍至少占图片区的 MIN_SHOWN；按裁剪多少排序
  function fallbackShapes(ev, r, maxH, maxW) {
    var fill = coverFill(ev), out = [], t, h, w;
    var cw = Math.max(MIN_STACK_W, maxW - 2);
    for (var c = cw; c >= MIN_STACK_W; c -= WIDEN_STEP) {
      // 图片尽量按原比例，说明至少留两行
      var tl = textLayout(ev, c, 'stack');
      h = Math.min(c / r, maxH - 2 - Math.min(tl.h, Math.ceil(tl.fixed + 2 * tl.lh)));
      t = clampedText(ev, c, 'stack', maxH - h - 2);
      if (t && h >= fill * c / r - 0.5 && h >= MIN_IMG_SIDE) { out.push({ kind: 'stack', iw: c, ih: h, clamp: t.lines, crop: cropOf(c, h, r), w: Math.round(c + 2), h: Math.round(h + t.h + 2) }); break; }
    }
    // 左右排：卡片高度先按图片原比例，说明放不下时再加高（图片左右裁去一些）
    var maxIw = maxW - SIDE_TEXT_W - 2;
    h = Math.min(maxH - 2, maxIw / r);
    t = clampedText(ev, SIDE_TEXT_W, 'side', h);
    if (!t) { h = Math.min(maxH - 2, maxIw / r / fill); t = clampedText(ev, SIDE_TEXT_W, 'side', h); }
    w = Math.min(h * r, maxIw);
    if (t && w >= fill * h * r - 0.5 && w >= MIN_IMG_SIDE) out.push({ kind: 'left', iw: w, ih: h, clamp: t.lines, crop: cropOf(w, h, r), w: Math.round(w + SIDE_TEXT_W + 2), h: Math.round(h + 2) });
    if (!out.length) {
      // 极端情况（屏幕很矮）：最宽的上下排，图片高度按比例的 MIN_SHOWN，说明能放几行放几行（可能不显示）
      h = Math.min(fill * cw / r, maxH - 2);
      t = clampedText(ev, cw, 'stack', maxH - h - 2, 0) || { h: maxH - h - 2, lines: 0 };
      out.push({ kind: 'stack', iw: cw, ih: h, clamp: t.lines, crop: cropOf(cw, h, r), w: Math.round(cw + 2), h: Math.round(Math.min(maxH, h + t.h + 2)) });
    }
    out.forEach(function (sh) { sh.cost = sh.crop * CROP_COST; });
    return out.sort(function (a, b) { return a.cost - b.cost; });
  }
  // 比例为 r 的图片按 cover 铺满 w × h 时裁去的比例
  function cropOf(w, h, r) { return 1 - Math.min(w / h / r, h * r / w); }

  // 图片区 w × h、原图比例 r：图片按 cover 占满图片区时裁去的部分不超过 MAX_CROP 则返回 null（图片占满图片区）；
  // 否则返回图片框的尺寸（只裁去 MAX_CROP，图片框在图片区中居中，周围由虚化的同一张图片铺满）
  function imageFit(w, h, r) {
    var m = w / h;
    if (m > r) {
      if (h * r / w >= 1 - MAX_CROP) return null;
      return { w: h * r / (1 - MAX_CROP), h: h };
    }
    if (w / r / (1 - MAX_CROP) >= h) return null;
    return { w: w, h: w / r / (1 - MAX_CROP) };
  }

  // 稳定的伪随机数，让同一数据每次排版一致
  function jitter(i, k) {
    var x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }
  function hit(a, b, g) {
    return a.l < b.r + g && a.r + g > b.l && a.t < b.b + g && a.b + g > b.t;
  }
  function segRect(x1, y1, x2, y2) {
    return { l: Math.min(x1, x2) - 1, r: Math.max(x1, x2) + 1, t: Math.min(y1, y2), b: Math.max(y1, y2) };
  }

  var CARD_GAP = 16, LINK_GAP = 7;

  function computeLayout() {
    var list = sorted();
    var H = stage.clientHeight || 600;
    var axisY = H / 2;
    var s = clamp(H / 680, 0.82, 1.12);
    var band = Math.round(30 * s);          // 轴线附近留给刻度和朝代名的空间
    var half = axisY - 12;                  // 卡片离舞台边缘至少 12px
    var maxW = Math.max(150, viewW() - 48);
    // 第一个事件之前多留一段（屏宽的 15%，60–260px）：轴线在这里渐隐，表示更早的年代，时间轴不会戛然而止
    var lead = PAD + clamp(viewW() * 0.15, 60, 260);
    var narrow = clamp(viewW() / 1100, 0.5, 1);   // 窄屏上小、中两级图片的面积系数
    var minGap = Math.round(40 * s);
    var cards = [], links = [];             // 已放置的卡片与连线（用于碰撞检测）
    var xs = [], anchors = [], placed = [];
    var base = list.length ? rawPos(list[0].year) : 0;
    var prevX = -Infinity, prevSide = 0, prevSame = 0;

    // 放入新卡片后，任意一屏宽度内的卡片（按中心计）不超过 limit 个（大屏幕 8 个，其余 6 个）
    var centers = [], centersMax = -Infinity;
    var screenW = viewW();
    var limit = maxPerScreen(screenW);
    function densityOk(cx) {
      var near = [cx];
      for (var i = centers.length - 1; i >= 0; i--) {
        if (Math.abs(centers[i] - cx) < screenW) near.push(centers[i]);
      }
      if (near.length <= limit) return true;
      near.sort(function (a, b) { return a - b; });
      for (var j = 0; j + limit < near.length; j++) {
        if (near[j + limit] - near[j] < screenW) return false;
      }
      return true;
    }

    function free(rect, isCard) {
      var i, g = isCard ? CARD_GAP : LINK_GAP;
      for (i = cards.length - 1; i >= 0 && i >= cards.length - 30; i--) if (hit(rect, cards[i], g)) return false;
      for (i = links.length - 1; i >= 0 && i >= links.length - 90; i--) if (hit(rect, links[i], isCard ? LINK_GAP : 3)) return false;
      return true;
    }

    var prevKind = null;
    list.forEach(function (ev, i) {
      var r = coverRatio(ev);
      var maxH = Math.floor(half - band);
      var shapes = [];
      var tier = TIERS[tierOf(ev)], tiers = tier.sizes;
      var k2 = s * s * Math.pow(narrow, tier.shrink);
      tiers.forEach(function (area) {
        KINDS.forEach(function (kind) {
          var sh = shapeFor(ev, r, area * k2, kind, maxH, maxW);
          if (!sh || sh.w > maxW) return;
          // 按图片面积计分，越大越好（重大事件更坚持用大图）；为了占满图片区而放大的部分不算分，还略微扣分，免得小图越放越大；
          // 图片被裁得越多越差；
          // 与上一个事件换一种图文关系；竖图适合左右排，横图适合上下排
          sh.cost = (1 - sh.want / (tiers[0] * k2)) * tier.weight + sh.crop * CROP_COST + (sh.iw * sh.ih / sh.want - 1) * GROW_COST + (kind === prevKind ? 14 : 0)
            + (kind === 'stack' ? (r < 0.85 ? 18 : 0) : (r > 1.7 ? 18 : 0))
            + (kind === 'right' ? 4 : 0);
          shapes.push(sh);
        });
      });
      if (!shapes.length) {
        // 哪种都放不下（手机上文字很长时）：图片按原比例尽量放大，说明截短到放得下
        shapes = fallbackShapes(ev, r, maxH, maxW);
      }
      var x0 = Math.max(lead + (rawPos(ev.year) - base) * 1, prevX + minGap, lead);
      var best = null;

      var maxShapeW = 0;
      shapes.forEach(function (sh) { maxShapeW = Math.max(maxShapeW, sh.w); });
      for (var tries = 0; tries < 2000 && !best; tries++) {
        // 快速跳过：这一步中所有候选位置的中心都不超过 x0 + 56 + 最宽卡片的一半；
        // 若连这个最靠右的中心都超出“一屏最多 limit 个”的限制，其余候选也都不行，
        // 直接算出需要右移多少步（结果与逐步右移完全相同，只是省去无用的尝试）
        var maxCx = x0 + 56 + maxShapeW / 2;
        if (centers.length >= limit && maxCx >= centersMax && !densityOk(maxCx)) {
          var sortedC = centers.slice().sort(function (a, b) { return a - b; });
          var need = sortedC[sortedC.length - limit] + screenW;
          var k = Math.max(1, Math.ceil((need - maxCx) / 14));
          x0 += 14 * k;
          tries += k - 1;
          continue;
        }
        shapes.forEach(function (sh) {
          var w = sh.w, h = sh.h;
          [-1, 1].forEach(function (side) {
            for (var d = band; d + h <= half; d += Math.round(20 * s)) {
              var top = side < 0 ? axisY - d - h : axisY + d;
              var edgeY = side < 0 ? top + h : top;           // 卡片靠近轴线的一边
              var cy = top + h / 2;
              var opts = [];
              // 直线：锚点落在卡片水平范围内
              [0.5, 0.3, 0.7, 0.15, 0.85].forEach(function (f) {
                opts.push({ left: x0 - w * f, kind: 'straight', cost: Math.abs(f - 0.5) * 30 });
              });
              // 折线（只折一次）：竖直出发，再水平连到卡片侧边
              [22, 56].forEach(function (e) {
                opts.push({ left: x0 + e, kind: 'side', cost: 30 + e * 0.3 });
                opts.push({ left: x0 - w - e, kind: 'side', cost: 40 + e * 0.3 });
              });
              opts.forEach(function (o) {
                var L = Math.round(o.left);
                if (L < 10) return;
                var rect = { l: L, r: L + w, t: top, b: top + h };
                var segs, pts, ay = axisY + side * 8;
                if (o.kind === 'straight') {
                  pts = [[x0, ay], [x0, edgeY]];
                } else {
                  if (d < band + 12) return;
                  var ex = L > x0 ? L : L + w;
                  pts = [[x0, ay], [x0, cy], [ex, cy]];
                }
                if (!densityOk(L + w / 2)) return;
                if (!free(rect, true)) return;
                segs = [];
                for (var k = 1; k < pts.length; k++) {
                  var sr = segRect(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
                  if (!free(sr, false)) return;
                  segs.push(sr);
                }
                var cost = sh.cost + (d - band) * 0.55 + o.cost
                  + Math.max(0, L + w - x0) * 0.05
                  + (side === prevSide ? 14 + prevSame * 26 : 0)
                  + jitter(i, d + o.left) * 16;
                if (!best || cost < best.cost) best = { cost: cost, rect: rect, segs: segs, pts: pts, side: side, shape: sh };
              });
            }
          });
        });
        if (!best) x0 += 14;
      }
      if (!best) {                       // 理论上不会发生：兜底放在轴上方
        var fs = shapes[shapes.length - 1], tp = axisY - band - fs.h;
        best = { rect: { l: x0 - fs.w / 2, r: x0 + fs.w / 2, t: tp, b: tp + fs.h }, segs: [], pts: [[x0, axisY], [x0, tp + fs.h]], side: -1, shape: fs };
      }
      cards.push(best.rect);
      centers.push((best.rect.l + best.rect.r) / 2);
      centersMax = Math.max(centersMax, (best.rect.l + best.rect.r) / 2);
      Array.prototype.push.apply(links, best.segs);
      prevSame = best.side === prevSide ? prevSame + 1 : 0;
      prevSide = best.side;
      prevKind = best.shape.kind;
      prevX = x0;
      xs.push(x0);
      anchors.push({ r: rawPos(ev.year), x: x0 });
      placed.push({ shape: best.shape, rect: best.rect, pts: best.pts, side: best.side });
    });

    var right = xs.length ? xs[xs.length - 1] : 0;
    cards.forEach(function (c) { right = Math.max(right, c.r); });
    layout.list = list;
    layout.xs = xs;
    layout.anchors = anchors;
    layout.placed = placed;
    layout.height = H;
    layout.width = right + PAD;
    layout.sizeKey = viewW() + 'x' + H;   // 排版所依据的舞台尺寸
    // 最后一个事件之后的轴线对应到今天：在轴线末端附近加一个“今天”的锚点
    var lastA = anchors[anchors.length - 1];
    layout.todayX = null;
    if (lastA && rawPos(CURRENT_YEAR) > lastA.r && layout.width - PAD / 2 > lastA.x + 40) {
      layout.todayX = layout.width - PAD / 2;
      anchors.push({ r: rawPos(CURRENT_YEAR), x: layout.todayX });
    }
  }

  // 任意年份 -> 横坐标（在事件锚点间插值，保证刻度与事件位置一致）
  function xOfYear(y) {
    var a = layout.anchors, r = rawPos(y);
    if (!a.length) return 0;
    if (r <= a[0].r) return a[0].x - (a[0].r - r);
    for (var i = 1; i < a.length; i++) {
      if (r <= a[i].r) {
        var span = a[i].r - a[i - 1].r;
        if (span <= 0) return a[i].x;
        return a[i - 1].x + (a[i].x - a[i - 1].x) * (r - a[i - 1].r) / span;
      }
    }
    var last = a[a.length - 1];
    return last.x + (r - last.r);
  }
  // 横坐标 -> 年份（xOfYear 的反函数，在事件锚点间插值）
  function yearOfX(x) {
    var a = layout.anchors;
    if (!a.length) return null;
    if (x <= a[0].x) return yearOfRaw(a[0].r - (a[0].x - x));
    for (var i = 1; i < a.length; i++) {
      if (x <= a[i].x) {
        var span = a[i].x - a[i - 1].x;
        var r = span <= 0 ? a[i].r : a[i - 1].r + (a[i].r - a[i - 1].r) * (x - a[i - 1].x) / span;
        return yearOfRaw(r);
      }
    }
    var last = a[a.length - 1];
    return yearOfRaw(last.r + (x - last.x));
  }
  // 横坐标 -> 最近事件的年份（用于显示当前时代）
  function yearAtX(x) {
    var list = layout.list, xs = layout.xs;
    if (!list.length) return null;
    var best = 0, bd = Infinity;
    for (var i = 0; i < xs.length; i++) {
      var d = Math.abs(xs[i] - x);
      if (d < bd) { bd = d; best = i; }
    }
    return list[best].year;
  }

  // 背景色随时期渐变：每个时期的颜色以很低的不透明度铺在该时期的范围内，相邻时期之间平滑过渡，
  // 整体仍是纸色主调。随时间轴一起拖动。
  var WASH_ALPHA = 0.24;
  function hexToRgba(hex, a) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return null;
    return 'rgba(' + parseInt(m[1], 16) + ', ' + parseInt(m[2], 16) + ', ' + parseInt(m[3], 16) + ', ' + a + ')';
  }
  function renderEraWash(W) {
    var wash = $('eraWash');
    var stops = [];
    ERAS.forEach(function (era) {
      var c = hexToRgba(era.color, WASH_ALPHA);
      var x1 = clamp(xOfYear(era.start), 0, W);
      var x2 = era.end == null ? W : clamp(xOfYear(era.end), 0, W);
      if (!c || x2 - x1 < 2) return;
      var fade = Math.min(160, (x2 - x1) / 3);   // 时期两端留出过渡区，与相邻时期的颜色渐变衔接
      stops.push(c + ' ' + Math.round(x1 + fade) + 'px', c + ' ' + Math.round(x2 - fade) + 'px');
    });
    wash.style.backgroundImage = stops.length ? 'linear-gradient(to right, ' + stops.join(', ') + ')' : '';
  }

  // 全屏模式下每个时期开始处左上角的时期名和起点竖线（只在 body.bars-hidden 时由 CSS 显示）。
  // 时期太短、放不下名字时不显示，避免与下一个时期的名字重叠
  function renderEraNames(W) {
    var box = $('eraNames'), lines = $('eraLines');
    box.innerHTML = '';
    lines.innerHTML = '';
    var fontSize = window.matchMedia('(max-width: 640px)').matches ? 22 : 29;   // 与 css 中 .era-start-name 的字号一致
    ERAS.forEach(function (era) {
      var x1 = clamp(xOfYear(era.start), 0, W);
      var x2 = era.end == null ? W : clamp(xOfYear(era.end), 0, W);
      if (x2 - x1 < era.name.length * fontSize + 24) return;
      var d = el('div', 'era-start-name', era.name);
      d.dataset.era = era.name;
      d.style.left = x1 + 'px';
      d.style.setProperty('--era-color', era.color);
      box.appendChild(d);
      // 起点竖线放在卡片下层（#eraLines 在 #events 之前），不横穿卡片
      var line = el('div', 'era-start-line');
      line.dataset.era = era.name;
      line.style.left = x1 + 'px';
      line.style.setProperty('--era-color', era.color);
      lines.appendChild(line);
    });
  }

  function renderTimeline() {
    ensureRatios();
    computeLayout();
    pendingImages = [];   // 卡片重新生成，旧的待加载列表作废（已加载过的图片浏览器有缓存）
    track.dataset.renders = (+track.dataset.renders || 0) + 1;   // 排版次数，供自动化测试判断排版是否稳定
    if (tour && tour.open) setTimeout(placeTour, 0);   // 分步指引打开时，聚光灯跟随重新排版后的位置
    var W = layout.width;
    track.style.width = W + 'px';
    // 时间轴高度固定为排版时的高度，并在舞台中垂直居中：舞台高度变化（如隐藏工具栏）到重新排版之间，
    // 轴线、卡片和连线作为一个整体移动，不会错位
    track.style.height = layout.height + 'px';
    track.style.top = '50%';
    track.style.marginTop = (-layout.height / 2) + 'px';
    $('axis').style.width = W + 'px';
    $('axisHit').style.width = W + 'px';

    // 朝代色带
    renderEraWash(W);
    // 最早时期之前的一段轴线从左向右渐显
    var firstX = ERAS.length ? clamp(xOfYear(ERAS[0].start), 0, W) : 0;
    layout.firstEraX = firstX;
    $('axis').style.background = firstX > 0 ? 'linear-gradient(to right, transparent, var(--axis) ' + Math.round(firstX) + 'px)' : '';
    var eras = $('eras');
    eras.innerHTML = '';
    // 第一个时期之前的引导段：从轴线起点到第一个时期，颜色由透明渐变为该时期的颜色、由细渐粗，
    // 与第一个时期的色带（左端改为直角）无缝衔接，不是突然出现一段色带
    if (firstX > 0 && ERAS.length) {
      var lead = el('div', 'era-leadin');
      lead.setAttribute('aria-hidden', 'true');
      lead.style.width = firstX + 'px';
      lead.style.setProperty('--lead-color', ERAS[0].color);
      eras.appendChild(lead);
    }
    var minX = 0, maxX = W;
    ERAS.forEach(function (era) {
      var x1 = clamp(xOfYear(era.start), minX, maxX);
      var x2 = era.end == null ? maxX : clamp(xOfYear(era.end), minX, maxX);   // 延续至今的时期画到轴线末端
      if (x2 - x1 < 2) return;
      var d = el('div', 'era');
      d.dataset.era = era.name;
      d.style.left = x1 + 'px';
      d.style.width = (x2 - x1 - 2) + 'px';
      d.style.background = era.color;
      d.title = era.name;
      if (x2 - x1 > era.name.length * 12 + 6) d.appendChild(el('span', 'era-label', era.name));
      eras.appendChild(d);
    });
    renderEraNames(W);

    // 刻度
    var ticks = $('ticks');
    ticks.innerHTML = '';
    var lastX = -Infinity;
    var todayX = layout.todayX;
    TICK_YEARS.forEach(function (y) {
      var x = xOfYear(y);
      if (x < 20 || x > W - 20 || x - lastX < 96) return;
      if (todayX != null && todayX - x < 96) return;   // 给“今天”刻度让位
      if (layout.xs.some(function (ex) { return Math.abs(ex - x) < 22; })) return;   // 避开事件连线
      lastX = x;
      var t = el('div', 'tick');
      t.style.left = x + 'px';
      t.appendChild(el('span', null, tickLabel(y)));
      ticks.appendChild(t);
    });
    if (todayX != null) {
      var today = el('div', 'tick tick-today');
      today.style.left = todayX + 'px';
      today.appendChild(el('span', null, _('今天')));
      ticks.appendChild(today);
    }

    // 事件卡片 + 连线
    var box = $('events');
    box.innerHTML = '';
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'links');
    svg.setAttribute('width', W);
    svg.setAttribute('height', layout.height);
    box.appendChild(svg);
    layout.list.forEach(function (ev, i) {
      var pl = layout.placed[i], r = pl.rect;
      var path = document.createElementNS(NS, 'polyline');
      path.setAttribute('points', pl.pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '));
      path.style.setProperty('--link-color', eraOf(ev.year).color);   // 连线用事件所属时期的颜色
      svg.appendChild(path);

      // 时期更迭事件在轴线上用菱形标记（填充新时期的颜色）
      var dot = el('div', 'dot' + (ev.transition ? ' dot-transition' : ''));
      dot.style.left = layout.xs[i] + 'px';
      if (ev.transition) dot.style.setProperty('--to-color', eraByName(ev.transition.to).color);
      box.appendChild(dot);

      var sh = pl.shape;
      var card = el('button', 'card k-' + sh.kind + ' tier-' + tierOf(ev) + (isMajor(ev) ? ' major' : '') + (pl.side < 0 ? ' up' : ' down'));
      card.type = 'button';
      card.dataset.id = ev.id;
      card.style.left = r.l + 'px';
      card.style.top = r.t + 'px';
      card.style.width = (r.r - r.l) + 'px';
      card.style.height = (r.b - r.t) + 'px';
      card.setAttribute('aria-label', (ev.date || formatYear(ev.year)) + ' ' + ev.title);
      var media = el('div', 'card-media');
      if (sh.kind === 'stack') media.style.height = Math.round(sh.ih) + 'px';
      else media.style.width = Math.round(sh.iw) + 'px';
      var pic = imageEl(ev.images && ev.images[0], 'card-img', ev.title, true);
      if (pic.dataset.src) pendingImages.push({ img: pic, l: r.l, r: r.r });
      var fit = imageFit(sh.iw, sh.ih, coverRatio(ev));
      if (fit && pic.tagName === 'IMG') {
        // 原图比例与图片区相差太多：图片只裁去 MAX_CROP，其余部分用同一张图片放大虚化铺满，不露出空白
        pic.style.width = Math.round(fit.w) + 'px';
        pic.style.height = Math.round(fit.h) + 'px';
        var bg = imageEl(ev.images[0], 'card-img-bg', '', true);
        bg.alt = '';
        bg.setAttribute('aria-hidden', 'true');
        pendingImages.push({ img: bg, l: r.l, r: r.r });
        media.appendChild(bg);
      }
      media.appendChild(pic);
      card.appendChild(media);
      var body = cardBody(ev);
      if (sh.tw && sh.tw !== SIDE_TEXT_W) body.style.width = sh.tw + 'px';   // 左右排时加宽了文字栏
      if (sh.clamp != null) {   // 放不下时说明截短（详情页显示全文）
        var shortEl = body.querySelector('.card-short');
        if (shortEl && sh.clamp === 0) shortEl.hidden = true;
        else if (shortEl) { shortEl.classList.add('clamped'); shortEl.style.webkitLineClamp = sh.clamp; shortEl.style.lineClamp = sh.clamp; }
      }
      card.appendChild(body);
      card.addEventListener('click', function () {
        if (drag.moved) return;
        openDetail(ev.id);
      });
      card.addEventListener('mouseenter', function () { path.classList.add('hot'); dot.classList.add('hot'); });
      card.addEventListener('mouseleave', function () { path.classList.remove('hot'); dot.classList.remove('hot'); });
      box.appendChild(card);
    });

    renderMinimap();
    setOffset(offset);
    loadNearbyImages();
  }

  // 时间轴卡片的图片：只加载视野及左右各 IMAGE_AHEAD 屏范围内的卡片图片，其余等移近时再加载。
  // 不依赖浏览器的 loading="lazy"：它对横向平移（transform）的时间轴判断不可靠，
  // 在部分屏幕宽度下会一次加载全部图片（数百张、几十 MB）。
  var IMAGE_AHEAD = 1.5;
  var pendingImages = [];    // [{ img, l, r }]，l / r 为卡片在时间轴上的左右位置
  var imagesQueued = false;
  function loadNearbyImages() {
    imagesQueued = false;
    if (!pendingImages.length) return;
    // 跳转动画（End、点标题回到开头、点进度条等）一闪而过的卡片不加载，到达后再加载
    if (anim) { queueNearbyImages(); return; }
    var w = viewW(), from = -offset - w * IMAGE_AHEAD, to = -offset + w * (1 + IMAGE_AHEAD);
    pendingImages = pendingImages.filter(function (p) {
      if (p.r < from || p.l > to) return true;
      if (p.img.dataset.src) { p.img.src = p.img.dataset.src; delete p.img.dataset.src; }
      return false;
    });
  }
  function queueNearbyImages() {
    if (imagesQueued || !pendingImages.length) return;
    imagesQueued = true;
    requestAnimationFrame(loadNearbyImages);
  }

  // ---------- 平移 / 拖拽 ----------
  function viewW() { return stage.clientWidth; }
  function minOffset() { return Math.min(0, viewW() - layout.width); }
  function setOffset(v) {
    offset = clamp(v, minOffset(), 0);
    syncUrlSoon();
    track.style.transform = 'translate3d(' + offset + 'px,0,0)';
    updateViewIndicators();
    queueNearbyImages();
    if (tipShown) hideEraTip();
  }
  var anim = null;
  // 手动浏览（拖动、滚轮、方向键、进度条、翻页按钮、跳到某个事件等）都会先调用 stopAnim，同时暂停自动播放
  function stopAnim() {
    if (anim) cancelAnimationFrame(anim);
    anim = null;
    if (typeof setPlaying === 'function') {
      if (playing) setPlaying(false);
      noteActivity();   // 停止操作一段时间后自动继续播放（用户手动暂停时除外）
    }
  }
  function animateTo(target, dur) {
    stopAnim();
    target = clamp(target, minOffset(), 0);
    var from = offset, t0 = performance.now();
    dur = dur || 600;
    (function step(now) {
      var p = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      setOffset(from + (target - from) * e);
      if (p < 1) anim = requestAnimationFrame(step); else anim = null;
    })(t0);
  }
  function centerOnX(x, smooth) {
    var target = viewW() / 2 - x;
    if (smooth) animateTo(target); else setOffset(target);
  }
  function focusEvent(id) {
    var i = layout.list.findIndex(function (e) { return e.id === id; });
    if (i < 0) return;
    centerOnX(layout.xs[i], true);
    var node = track.querySelector('.card[data-id="' + id + '"]');
    if (node) {
      node.classList.remove('flash');
      void node.offsetWidth;
      node.classList.add('flash');
    }
  }

  var drag = { active: false, moved: false, startX: 0, startOffset: 0, lastX: 0, lastT: 0, v: 0, pid: null };
  stage.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || e.target.closest('.nav-arrow')) return;
    stopAnim();
    drag.active = true;
    drag.moved = false;
    drag.startX = drag.lastX = e.clientX;
    drag.startOffset = offset;
    drag.lastT = performance.now();
    drag.v = 0;
    drag.pid = e.pointerId;
  });
  stage.addEventListener('pointermove', function (e) {
    if (!drag.active || e.pointerId !== drag.pid) return;
    var dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) > 6) {
      drag.moved = true;
      stage.classList.add('dragging');
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
    if (drag.moved) {
      var now = performance.now();
      var dt = Math.max(1, now - drag.lastT);
      drag.v = 0.8 * ((e.clientX - drag.lastX) / dt) + 0.2 * drag.v;
      drag.lastX = e.clientX;
      drag.lastT = now;
      setOffset(drag.startOffset + dx);
    }
  });
  function endDrag(e) {
    if (!drag.active || (e && e.pointerId !== drag.pid)) return;
    drag.active = false;
    stage.classList.remove('dragging');
    if (drag.moved) {
      // 惯性滑动
      var v = drag.v * 16;
      if (performance.now() - drag.lastT > 80) v = 0;
      (function glide() {
        if (Math.abs(v) < 0.4) { anim = null; return; }
        setOffset(offset + v);
        v *= 0.93;
        anim = requestAnimationFrame(glide);
      })();
      // 让随后的 click 事件被忽略
      setTimeout(function () { drag.moved = false; }, 0);
    }
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    stopAnim();
    var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (e.deltaMode === 1) d *= 32;
    setOffset(offset - d);
  }, { passive: false });
  // 方向键 / Home / End 浏览：时间轴区域和底部进度条获得焦点时都可用（点击进度条后也能继续用键盘）
  function navKeys(e) {
    if (e.key === 'ArrowRight') { animateTo(offset - viewW() * 0.6, 400); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { animateTo(offset + viewW() * 0.6, 400); e.preventDefault(); }
    else if (e.key === 'Home') { animateTo(0); e.preventDefault(); }
    else if (e.key === 'End') { animateTo(minOffset()); e.preventDefault(); }
  }
  stage.addEventListener('keydown', navKeys);
  $('minimap').addEventListener('keydown', navKeys);
  // 点击左上角标题：回到时间轴开头
  $('homeBtn').addEventListener('click', function (e) { e.preventDefault(); stopAnim(); animateTo(0, 600); });
  $('navLeft').addEventListener('click', function () { animateTo(offset + viewW() * 0.7, 500); });
  $('navRight').addEventListener('click', function () { animateTo(offset - viewW() * 0.7, 500); });

  // ---------- 悬浮 / 点击时间轴：显示该时间点所处时期 ----------
  var tip = $('eraTip'), tipBox = tip.querySelector('.era-tip-box');
  var tipShown = false, tipPinned = false, hotEra = null;

  function approxYear(y) { return (LOCALE.approxYear || ZH.approxYear)(y, CURRENT_YEAR); }

  function showEraTip(clientX, pinned) {
    if (!layout.anchors.length) return;
    var sr = stage.getBoundingClientRect();
    var vx = clamp(clientX - sr.left, 0, sr.width);
    var tx = vx - offset, y = yearOfX(tx);
    if (y == null) return;
    if (tx < layout.firstEraX - 4) { hideEraTip(); return; }   // 最早时期之前的渐隐段不显示时期
    // 指针靠近某个事件点时，直接使用该事件的年份
    for (var i = 0; i < layout.xs.length; i++) {
      if (Math.abs(layout.xs[i] - tx) <= 7) { y = layout.list[i].year; break; }
    }
    y = clamp(y, ERAS[0].start, CURRENT_YEAR);
    var era = eraOf(y);
    tipBox.innerHTML = '';
    tipBox.style.borderLeftColor = era.color;
    var head = el('div', 'era-tip-head');
    head.appendChild(el('span', 'era-tip-name', era.name));
    head.appendChild(el('span', 'era-tip-range', era.range));
    tipBox.appendChild(head);
    tipBox.appendChild(el('div', 'era-tip-desc', era.desc));
    tipBox.appendChild(el('div', 'era-tip-year', _('此处：{year}', { year: Math.round(y) === y && y > -10000 ? formatYear(y) : approxYear(y) })));
    tip.hidden = false;
    tip.style.left = vx + 'px';
    var bw = tipBox.offsetWidth;
    tipBox.style.left = (clamp(vx - bw / 2, 8, Math.max(8, sr.width - bw - 8)) - vx) + 'px';
    tip.classList.toggle('pinned', !!pinned);
    tipShown = true;
    tipPinned = !!pinned;
    if (hotEra !== era.name) {
      Array.prototype.forEach.call(document.querySelectorAll('.era.hot'), function (n) { n.classList.remove('hot'); });
      var band = document.querySelector('.era[data-era="' + era.name + '"]');
      if (band) band.classList.add('hot');
      hotEra = era.name;
    }
  }
  function hideEraTip() {
    tip.hidden = true;
    tip.classList.remove('pinned');
    tipShown = tipPinned = false;
    hotEra = null;
    Array.prototype.forEach.call(document.querySelectorAll('.era.hot'), function (n) { n.classList.remove('hot'); });
  }

  var axisHit = $('axisHit');
  axisHit.addEventListener('mousemove', function (e) {
    if (drag.active || tipPinned) return;
    showEraTip(e.clientX, false);
  });
  axisHit.addEventListener('mouseleave', function () { if (!tipPinned) hideEraTip(); });
  axisHit.addEventListener('click', function (e) {
    if (drag.moved || Math.abs(e.clientX - drag.startX) > 6) return;   // 拖动后的点击不固定提示
    showEraTip(e.clientX, true);
  });
  // 点击其他地方取消固定显示
  document.addEventListener('pointerdown', function (e) {
    if (tipPinned && e.target !== axisHit) hideEraTip();
  }, true);

  // ---------- 小地图 & 当前时代 ----------
  var minimap = $('minimap'), minimapView = $('minimapView');
  // 进度条：按时期分段着色，只有当前时期满色显示，上方标出时期名
  var mmEras = null, mmLabel = null, mmCurrent = null;
  var topbar = document.querySelector('.topbar'), headerEra = null;
  function renderMinimap() {
    Array.prototype.slice.call(minimap.querySelectorAll('i, .mm-eras, .mm-current')).forEach(function (n) { n.remove(); });
    var W = layout.width || 1;
    mmEras = el('div', 'mm-eras');
    ERAS.forEach(function (era) {
      var x1 = clamp(xOfYear(era.start), 0, W);
      var x2 = era.end == null ? W : clamp(xOfYear(era.end), 0, W);
      if (x2 - x1 < 1) return;
      var seg = el('div', 'mm-era');
      seg.dataset.era = era.name;
      seg.style.left = (x1 / W * 100) + '%';
      seg.style.width = ((x2 - x1) / W * 100) + '%';
      seg.style.background = era.color;
      mmEras.appendChild(seg);
    });
    minimap.insertBefore(mmEras, minimapView);
    layout.xs.forEach(function (x) {
      var m = el('i');
      m.style.left = (x / W * 100) + '%';
      minimap.insertBefore(m, minimapView);
    });
    mmLabel = el('div', 'mm-current');
    minimap.appendChild(mmLabel);
    mmCurrent = null;
  }
  function updateViewIndicators() {
    var W = layout.width || 1;
    var left = -offset / W, width = Math.min(1, viewW() / W);
    minimapView.style.left = (left * 100) + '%';
    minimapView.style.width = (width * 100) + '%';
    var span = layout.width - viewW();
    minimap.setAttribute('aria-valuenow', String(span > 0 ? Math.round(-offset / span * 100) : 0));
    // 到达最左 / 最右时隐藏对应的翻页按钮
    $('navLeft').classList.toggle('at-end', offset >= -0.5);
    $('navRight').classList.toggle('at-end', offset <= minOffset() + 0.5);
    // 当前时期取视野中心的事件所在的时期；离开头或结尾不到半屏时，参照点从中心逐渐移到视野左端 / 右端，
    // 因此最左时显示第一个事件的时期（旧石器时代），最右时显示最后一个事件的时期
    var half = viewW() / 2, scrolled = -offset, rest = Math.max(0, span - scrolled);
    var ref = scrolled + half - Math.max(0, half - scrolled) + Math.max(0, half - rest);
    var y = yearAtX(ref);
    var era = y == null ? null : eraOf(y);
    if ((era ? era.name : '') !== headerEra) {
      headerEra = era ? era.name : '';
      $('currentEra').textContent = headerEra;
      updateEraMenuCurrent(era);
      // 顶栏下沿色条与标题中的时期名使用该时期的颜色
      if (era) topbar.style.setProperty('--era-color', era.color);
      else topbar.style.removeProperty('--era-color');
    }
    if (!mmEras) return;
    if (era && era.name !== mmCurrent) {
      mmCurrent = era.name;
      Array.prototype.forEach.call(mmEras.children, function (seg) {
        seg.classList.toggle('on', seg.dataset.era === era.name);
      });
      mmLabel.textContent = '▼ ' + era.name;
    }
    if (!era) { mmLabel.textContent = ''; mmCurrent = null; return; }
    // 标签放在当前时期色段的正上方，不超出进度条两端
    var seg = mmEras.querySelector('.mm-era.on');
    var mw = minimap.clientWidth, lw = mmLabel.offsetWidth;
    var cx = seg ? seg.offsetLeft + seg.offsetWidth / 2 : (left + width / 2) * mw;
    mmLabel.style.left = clamp(cx - lw / 2, 0, Math.max(0, mw - lw)) + 'px';
  }
  // ---------- 朝代 / 时期菜单 ----------
  // 电脑：顶栏时期名右侧的 ▾ 打开列表（色块、时期名、年代）；手机（窄屏）：底栏左侧的“■ 唐 ▾”打开底部色块面板。
  // 选择后跳到该时期的第一个事件（没有事件的时期跳到其起始位置），关闭菜单。Esc、点外面或手机上向下滑动面板关闭。
  var eraMenu = $('eraMenu'), eraMenuList = $('eraMenuList'), eraMenuTrigger = null;
  function renderEraMenu() {
    eraMenuList.innerHTML = '';
    ERAS.forEach(function (era) {
      var b = el('button', 'era-item');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.dataset.era = era.name;
      b.style.setProperty('--era-c', era.color);
      b.appendChild(el('span', 'era-swatch'));
      b.appendChild(el('span', 'era-name', era.name));
      if (era.range) b.appendChild(el('span', 'era-range', era.range));
      b.title = era.range ? _('{name}（{range}）', { name: era.name, range: era.range }) : era.name;
      b.addEventListener('click', function () { closeEraMenu(false); jumpToEra(era); });
      eraMenuList.appendChild(b);
    });
    updateEraMenuCurrent(headerEra ? eraByName(headerEra) : null);
  }
  function updateEraMenuCurrent(era) {
    $('eraBarName').textContent = era ? era.name : '';
    $('eraBarSwatch').style.background = era ? era.color : 'transparent';
    Array.prototype.forEach.call(eraMenuList.children, function (b) {
      var on = !!era && b.dataset.era === era.name;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }
  // 跳到时期：让该时期的第一个事件落在顶栏判断“当前时期”的参照点上（见 updateViewIndicators：
  // 一般是视野中心，离开头 / 结尾不到半屏时参照点向两端移动），这样跳转后顶栏显示的就是所选时期
  function jumpToEra(era) {
    var i = layout.list.findIndex(function (e) { return eraOf(e.year) === era; });
    var x = i >= 0 ? layout.xs[i] : xOfYear(era.start);
    if (x == null) return;
    var w = viewW(), half = w / 2, span = Math.max(0, layout.width - w);
    var s = x - half;                                  // 参照点在中心
    if (s < half) s = x / 2;                           // 开头附近：参照点 = 2 × 已滚动距离
    else if (span - s < half) s = (x - w + span) / 2;  // 结尾附近
    animateTo(-clamp(s, 0, span));
  }
  function isNarrow() { return window.matchMedia('(max-width: 640px)').matches; }
  function openEraMenu(trigger) {
    eraMenuTrigger = trigger;
    eraMenu.hidden = false;
    var narrow = isNarrow();
    eraMenu.classList.toggle('sheet', narrow);
    $('eraScrim').hidden = !narrow;
    if (!narrow) {
      var r = trigger.getBoundingClientRect();
      eraMenu.style.left = Math.max(8, Math.min(r.left - 12, window.innerWidth - eraMenu.offsetWidth - 8)) + 'px';
      eraMenu.style.top = (r.bottom + 8) + 'px';
    } else {
      eraMenu.style.left = eraMenu.style.top = '';
    }
    trigger.setAttribute('aria-expanded', 'true');
    var cur = eraMenuList.querySelector('.era-item.on') || eraMenuList.firstChild;
    if (cur) { cur.scrollIntoView({ block: 'nearest' }); cur.focus({ preventScroll: true }); }
  }
  function closeEraMenu(restoreFocus) {
    if (eraMenu.hidden) return;
    eraMenu.hidden = true;
    $('eraScrim').hidden = true;
    if (eraMenuTrigger) {
      eraMenuTrigger.setAttribute('aria-expanded', 'false');
      if (restoreFocus) eraMenuTrigger.focus();
    }
  }
  function toggleEraMenu(trigger) {
    if (!eraMenu.hidden) closeEraMenu(true); else openEraMenu(trigger);
  }
  $('eraMenuBtn').addEventListener('click', function () { toggleEraMenu(this); });
  $('eraBarBtn').addEventListener('click', function () { toggleEraMenu(this); });
  $('eraScrim').addEventListener('click', function () { closeEraMenu(false); });
  document.addEventListener('pointerdown', function (e) {
    if (eraMenu.hidden || eraMenu.contains(e.target) || e.target.closest('#eraMenuBtn, #eraBarBtn')) return;
    closeEraMenu(false);
  }, true);
  // 菜单中的键盘操作：上下（手机面板为方向键）移动，Home / End，Esc 关闭；Enter / 空格选择（按钮本身的行为）
  eraMenu.addEventListener('keydown', function (e) {
    var items = Array.prototype.slice.call(eraMenuList.children);
    var i = items.indexOf(document.activeElement);
    var step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEraMenu(true); return; }
    var next = step ? clamp(i + step, 0, items.length - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();   // 不让方向键同时平移时间轴
    items[next].focus();
  });
  // 手机面板：从顶部把手向下滑动关闭
  var sheetDrag = null;
  eraMenu.addEventListener('touchstart', function (e) {
    if (!eraMenu.classList.contains('sheet') || !e.target.closest('.era-menu-grab, .era-menu-head')) return;
    sheetDrag = e.touches[0].clientY;
  }, { passive: true });
  eraMenu.addEventListener('touchend', function (e) {
    if (sheetDrag != null && e.changedTouches[0].clientY - sheetDrag > 60) closeEraMenu(false);
    sheetDrag = null;
  });
  // 只在宽度变化（如横竖屏切换）时关闭：手机浏览器地址栏收起 / 展开只改变高度，不能让刚打开的菜单一闪就消失
  var eraMenuW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth === eraMenuW) return;
    eraMenuW = window.innerWidth;
    closeEraMenu(false);
  });

  var mmDown = false;
  function minimapJump(e) {
    var r = minimap.getBoundingClientRect();
    var p = clamp((e.clientX - r.left) / r.width, 0, 1);
    setOffset(viewW() / 2 - p * layout.width);
  }
  minimap.addEventListener('pointerdown', function (e) {
    mmDown = true; stopAnim(); minimapJump(e);
    minimap.focus({ preventScroll: true });
    try { minimap.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  });
  minimap.addEventListener('pointermove', function (e) { if (mmDown) minimapJump(e); });
  minimap.addEventListener('pointerup', function () { mmDown = false; });
  minimap.addEventListener('pointercancel', function () { mmDown = false; });

  // 重新排版并保持当前屏幕中心的年代不变
  var relayoutT;
  // urgent：由用户操作（如显示 / 隐藏工具栏）引起的尺寸变化，不等防抖，画出新状态后立即重新排版
  var urgentRelayout = false;
  function scheduleRelayout(urgent) {
    if (!ready) return;
    if (urgent) urgentRelayout = true;
    clearTimeout(relayoutT);
    var run = function () {
      urgentRelayout = false;
      // 停在开头 / 结尾时重新排版后仍停在开头 / 结尾，否则保持视野中心的事件不变
      var atStart = offset >= -0.5, atEnd = !atStart && offset <= minOffset() + 0.5;
      var centerYear = yearAtX(-offset + viewW() / 2);
      renderTimeline();
      if (atStart) setOffset(0);
      else if (atEnd) setOffset(minOffset());
      else if (centerYear != null) setOffset(viewW() / 2 - xOfYear(centerYear));
    };
    if (urgentRelayout) relayoutT = setTimeout(function () { requestAnimationFrame(function () { setTimeout(run, 0); }); }, 0);
    else relayoutT = setTimeout(run, 150);
  }
  // 舞台尺寸变化（窗口缩放、字体加载后顶栏高度变化等）都会重新排版。
  // 与“排版时实际使用的尺寸”比较，而不是排版之后再读取的尺寸：
  // 否则尺寸恰好在排版过程中变化时，会被误认为已经排过，导致卡片超出显示区域。
  function onStageResize() {
    if (stage.clientWidth + 'x' + stage.clientHeight === layout.sizeKey) return;
    scheduleRelayout();
  }
  if (window.ResizeObserver) new ResizeObserver(onStageResize).observe(stage);
  else window.addEventListener('resize', onStageResize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { textCache = {}; scheduleRelayout(); });

  // ---------- 弹窗通用 ----------
  var openStack = [];
  function openModal(id) {
    var m = $(id);
    m.hidden = false;
    if (openStack.indexOf(id) < 0) openStack.push(id);
  }
  function closeModal(id) {
    var wasOpen = !$(id).hidden;
    $(id).hidden = true;
    openStack = openStack.filter(function (x) { return x !== id; });
    if (id === 'detailModal' && wasOpen) onLayerClosed('detail');
  }
  Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) {
    m.addEventListener('click', function (e) {
      if (m.id === 'editModal' && form.classList.contains('saving')) return;   // 保存过程中不关闭
      if (e.target.closest('[data-close]')) closeModal(m.id);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (form.classList.contains('saving')) return;   // 保存过程中不关闭编辑页
    if (!$('lightbox').hidden) { closeLightbox(); return; }
    if (openStack.length) { closeModal(openStack[openStack.length - 1]); return; }
    if (sidebarOpen) closeSidebar();
  });

  var confirmCb = null;
  function confirmDialog(text, cb) {
    $('confirmText').textContent = text;
    confirmCb = cb;
    openModal('confirmModal');
    $('confirmOk').focus();
  }
  $('confirmOk').addEventListener('click', function () {
    closeModal('confirmModal');
    var cb = confirmCb; confirmCb = null;
    if (cb) cb();
  });

  // ---------- 详情 ----------
  var detailId = null;
  function openDetail(id) {
    var ev = findEvent(id);
    if (!ev) return;
    var wasOpen = !$('detailModal').hidden;
    detailId = id;
    var imgs = ev.images || [];
    detailHero.imgs = imgs;
    detailHero.title = ev.title;
    showDetailHero(0);
    $('detailDate').textContent = ev.date || formatYear(ev.year);
    var tagBox = $('detailTags');
    tagBox.innerHTML = '';
    if (ev.type) {
      var tag = el('span', 'type-tag', ev.type);
      tag.style.setProperty('--chip-color', typeInfo(ev.type).color);
      tagBox.appendChild(tag);
    }
    $('detailTransition').hidden = !ev.transition;
    $('detailTransition').textContent = ev.transition ? _('时期更迭：{text}', { text: transitionText(ev.transition) }) : '';
    $('detailTitle').textContent = ev.title;
    $('detailText').textContent = ev.detail || ev.short || '';
    var g = $('detailGallery');
    g.innerHTML = '';
    imgs.slice(1, MAX_IMAGES).forEach(function (im, i) {
      var f = el('figure');
      var img = imageEl(im, '', ev.title);
      img.title = im.caption || '';
      img.addEventListener('click', function () { openLightbox(imgs, i + 1); });
      f.appendChild(img);
      g.appendChild(f);
    });
    var src = $('detailSource');
    src.innerHTML = '';
    var links = sourcesOf(ev);
    if (links.length) {
      src.appendChild(el('span', 'source-label', _('参考链接：')));
      var ul = el('ul', 'source-list');
      links.forEach(function (s) {
        var li = el('li');
        var a = el('a', null, sourceLabel(s));
        a.href = s.url; a.target = '_blank'; a.rel = 'noopener';
        li.appendChild(a);
        ul.appendChild(li);
      });
      src.appendChild(ul);
      if (links.some(isWikipedia)) src.appendChild(el('p', 'source-note', _('来自维基百科的文字与图片遵循 CC BY-SA 等相应许可')));
    }
    renderDetailCredits(ev);
    openModal('detailModal');
    $('detailModal').querySelector('.modal-card').scrollTop = 0;
    if (wasOpen) syncUrl(false); else onLayerOpened('detail');
  }
  // 详情页顶部的大图：有多张图片时可以左右滑动（或点下面的圆点）切换，点大图打开图片查看器并显示同一张
  var detailHero = { imgs: [], i: 0, title: '' };
  function showDetailHero(i) {
    var imgs = detailHero.imgs, n = imgs.length;
    detailHero.i = n ? (i + n) % n : 0;
    var hero = $('detailHero');
    hero.innerHTML = '';
    var h = imageEl(imgs[detailHero.i], '', detailHero.title);
    if (n) h.addEventListener('click', function () { openLightbox(imgs, detailHero.i); });
    hero.appendChild(h);
    hero.classList.toggle('swipeable', n > 1);
    if (n < 2) return;
    var dots = el('div', 'hero-dots');
    imgs.forEach(function (im, k) {
      var b = el('button', 'hero-dot' + (k === detailHero.i ? ' active' : ''));
      b.type = 'button';
      b.setAttribute('aria-label', _('第 {n} 张图片', { n: k + 1 }));
      if (k === detailHero.i) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', function () { showDetailHero(k); });
      dots.appendChild(b);
    });
    hero.appendChild(dots);
  }
  addSwipe($('detailHero'), {
    enabled: function () { return detailHero.imgs.length > 1; },
    target: function () { return $('detailHero').firstChild; },
    swipe: function (step) { showDetailHero(detailHero.i + step); }
  });

  $('detailEdit').addEventListener('click', function () {
    closeModal('detailModal');
    openEditor(detailId);
  });
  $('detailDelete').addEventListener('click', function () { askDelete(detailId); });

  function askDelete(id) {
    if (!debugMode) return;
    var ev = findEvent(id);
    if (!ev) return;
    confirmDialog(_('确定要删除“{title}”吗？此操作无法撤销。', { title: ev.title }), function () {
      events = events.filter(function (e) { return e.id !== id; });
      save();
      closeModal('detailModal');
      var keep = offset;
      renderTimeline();
      setOffset(keep);
      renderList();
      toast(_('已删除“{title}”', { title: ev.title }));
    });
  }

  // ---------- 图片版权（署名） ----------
  // 每张图片可以记录 author（作者）、license（许可证）、sourceUrl（来源网址，维基共享资源的文件页或图片所在的网页）。
  // license 为 'unknown' 表示已确认作者和许可不详（网上找的图片）；三项都没有时表示还没有填写，不显示署名。
  // 版权信息与语言无关：同一国家各语言的数据集中，同一张图片的这三项保持一致（编辑页保存时同步，见 saveSiblings）。
  var UNKNOWN_LICENSE = 'unknown';
  var PUBLIC_DOMAIN = 'Public domain';
  var LICENSE_OPTIONS = ['CC BY-SA 4.0', 'CC BY-SA 3.0', 'CC BY-SA 2.5', 'CC BY-SA 2.0', 'CC BY 4.0', 'CC BY 3.0', 'CC BY 2.5', 'CC BY 2.0', 'CC0', PUBLIC_DOMAIN];
  var MAX_AUTHOR = 200, MAX_LICENSE = 60;
  function licenseLabel(l) {
    return l === PUBLIC_DOMAIN ? _('公有领域') : l === UNKNOWN_LICENSE ? _('不详') : l;
  }
  // 知识共享许可证的说明页；其他许可证没有链接
  function licenseUrl(l) {
    var m = /^CC (BY(?:-SA)?) (\d\.\d)$/.exec(l || '');
    if (m) return 'https://creativecommons.org/licenses/' + m[1].toLowerCase() + '/' + m[2] + '/';
    return l === 'CC0' ? 'https://creativecommons.org/publicdomain/zero/1.0/' : '';
  }
  // 署名的三种情况：known 有许可证；site 许可不详但知道来源网址；unknown 来源网络、作者不详；没有填写时为 ''
  function creditKind(im) {
    if (!im) return '';
    if (im.license && im.license !== UNKNOWN_LICENSE) return 'known';
    if (im.license === UNKNOWN_LICENSE || im.author || im.sourceUrl) return im.sourceUrl ? 'site' : 'unknown';
    return '';
  }
  // 编辑页缩略图上的版权标签：缺少来源网址或许可证时显示红色提示（许可证选“不详”算已填写）；
  // 都有时绿色显示许可证，许可证不详时灰色显示来源网站
  function creditChip(im) {
    var noSource = !im.sourceUrl, noLicense = !im.license;
    if (noSource || noLicense) {
      return el('span', 'credit-chip credit-missing', noSource && noLicense ? _('⚠ 缺来源和许可证') : noSource ? _('⚠ 缺来源') : _('⚠ 缺许可证'));
    }
    return im.license === UNKNOWN_LICENSE
      ? el('span', 'credit-chip credit-site', urlHost(im.sourceUrl))
      : el('span', 'credit-chip credit-known', licenseLabel(im.license));
  }
  function urlHost(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; }
  }
  function extLink(text, href) {
    var a = el('a', null, text);
    a.href = href; a.target = '_blank'; a.rel = 'noopener';
    return a;
  }
  // 署名的各部分（文字或链接），用“ · ”连接显示；withContact 为 true 时，作者不详的图片带“联系我们”（打开反馈）
  function creditParts(im, withContact, onContact) {
    var kind = creditKind(im), parts = [];
    if (kind === 'known') {
      if (im.author) parts.push(_('图：{author}', { author: im.author }));
      var lu = licenseUrl(im.license);
      parts.push(lu ? extLink(licenseLabel(im.license), lu) : licenseLabel(im.license));
      if (im.sourceUrl) parts.push(extLink(_('原图 ↗'), im.sourceUrl));
      return parts;
    }
    if (kind === 'site') {
      var p = document.createDocumentFragment();
      p.appendChild(document.createTextNode(_('图片来源：')));
      p.appendChild(extLink(urlHost(im.sourceUrl) + ' ↗', im.sourceUrl));
      parts.push(p);
      parts.push(im.author ? _('作者：{author}，许可不详', { author: im.author }) : _('作者与许可不详'));
      if (withContact && onContact) parts.push(contactLink(_('版权问题请联系我们'), onContact));
      return parts;
    }
    if (kind === 'unknown') {
      parts.push(im.author ? _('图片来源网络，作者：{author}', { author: im.author }) : _('图片来源网络，作者不详'));
      if (withContact && onContact) parts.push(contactLink(_('如您是作者，请联系我们'), onContact));
    }
    return parts;
  }
  function contactLink(text, onContact) {
    var a = el('a', 'credit-contact', text);
    a.href = '#';
    a.addEventListener('click', function (e) { e.preventDefault(); onContact(); });
    return a;
  }
  function fillCredit(box, parts) {
    box.innerHTML = '';
    parts.forEach(function (p, i) {
      if (i) box.appendChild(document.createTextNode(' · '));
      box.appendChild(typeof p === 'string' ? document.createTextNode(p) : p);
    });
    box.hidden = !parts.length;
  }
  // 详情页底部的“图片来源”：列出每张图片的署名（没有任何图片填写版权信息时不显示）
  function renderDetailCredits(ev) {
    var box = $('detailCredits');
    var imgs = ev.images || [];
    var any = imgs.some(creditKind);
    box.hidden = !any;
    if (!any) return;
    $('detailCreditsTitle').textContent = _('图片来源（{n} 张）', { n: imgs.length });
    var ol = $('detailCreditsList');
    ol.innerHTML = '';
    imgs.forEach(function (im) {
      var li = el('li');
      var parts = creditParts(im, false);
      if (parts.length) fillCredit(li, parts); else li.textContent = _('未注明');
      ol.appendChild(li);
    });
    var vague = imgs.some(function (im) { var k = creditKind(im); return k === 'site' || k === 'unknown'; });
    var note = $('detailCreditsNote');
    note.hidden = !vague;
    note.innerHTML = '';
    if (vague) {
      note.appendChild(document.createTextNode(_('部分图片来自网络、作者不详，如有侵权请')));
      if (feedbackOn) note.appendChild(contactLink(_('联系我们'), function () { openFeedback(ev.id, 0); }));
      else note.appendChild(document.createTextNode(_('联系我们')));
      note.appendChild(document.createTextNode(_('删除。')));
    }
  }

  // ---------- 左右滑动切换图片 ----------
  // 手指（或按住鼠标）横向拖动超过阈值后松开即切换：向左滑看下一张（step = 1），向右滑看上一张（step = -1）。
  // 拖动时图片跟着手指移动；竖直方向的移动交给浏览器滚动（CSS 中 touch-action: pan-y），不切换。
  // 滑动结束后的那次 click 被拦下，不会打开查看器或关闭查看器。
  var SWIPE_MIN = 50;   // 切换所需的横向距离（px）
  var swipeClickBlock = false;
  window.addEventListener('click', function (e) {
    if (!swipeClickBlock) return;
    swipeClickBlock = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  function addSwipe(box, o) {
    var st = null;
    function move(dx) {
      var t = o.target();
      if (!t) return;
      t.style.transition = dx ? 'none' : '';
      t.style.transform = dx ? 'translateX(' + dx + 'px)' : '';
    }
    box.addEventListener('pointerdown', function (e) {
      if (st || !e.isPrimary || e.button !== 0 || !o.enabled() || e.target.closest('button, a, input, .lb-credit')) { st = null; return; }
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, mode: null };
    });
    box.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id || st.mode === 'v') return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.mode) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        st.mode = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        if (st.mode === 'v') return;
        try { box.setPointerCapture(e.pointerId); } catch (err) { /* 指针已结束 */ }
      }
      st.dx = dx;
      move(dx);
    });
    function end(e, cancel) {
      if (!st || e.pointerId !== st.id) return;
      var s = st;
      st = null;
      if (s.mode !== 'h') return;
      move(0);
      swipeClickBlock = !cancel;
      setTimeout(function () { swipeClickBlock = false; }, 0);
      if (!cancel && Math.abs(s.dx) >= SWIPE_MIN) o.swipe(s.dx < 0 ? 1 : -1);
    }
    box.addEventListener('pointerup', function (e) { end(e, false); });
    box.addEventListener('pointercancel', function (e) { end(e, true); });
  }

  // ---------- 图片查看 ----------
  // edit 为 true 时从编辑页打开：imgs 是编辑中的图片（draftImages），显示“设为代表图”“从本事件移除”
  var lb = { imgs: [], i: 0, edit: false };
  function openLightbox(imgs, i, edit) {
    lb.imgs = imgs; lb.i = i; lb.edit = !!edit;
    showLightbox();
    $('lightbox').hidden = false;
  }
  function showLightbox() {
    var im = lb.imgs[lb.i];
    $('lbActions').hidden = !lb.edit;
    if (lb.edit) {
      var isCover = lb.i === 0;
      $('lbCover').disabled = isCover;
      $('lbCover').textContent = isCover ? _('★ 已是代表图') : _('★ 设为代表图');
    }
    var img = $('lightboxImg');
    img.src = im.src;
    img.alt = im.caption || '';
    $('lightboxCaption').textContent = (im.caption || '') + (lb.imgs.length > 1 ? '  (' + (lb.i + 1) + '/' + lb.imgs.length + ')' : '');
    // 署名：从详情打开时，作者不详的图片带“联系我们”（打开这张图片的反馈）
    var evId = lb.edit ? null : detailId, n = lb.i + 1;
    fillCredit($('lightboxCredit'), creditParts(im, !!(evId && feedbackOn), function () {
      closeLightbox();
      openFeedback(evId, n);
    }));
    var many = lb.imgs.length > 1;
    document.querySelector('.lb-prev').hidden = !many;
    document.querySelector('.lb-next').hidden = !many;
  }
  // 从详情打开时，关闭后详情页的大图停在查看器最后显示的那张
  function closeLightbox() {
    $('lightbox').hidden = true;
    if (!lb.edit && lb.imgs === detailHero.imgs && lb.i !== detailHero.i) showDetailHero(lb.i);
  }
  function stepLightbox(step) {
    lb.i = (lb.i + step + lb.imgs.length) % lb.imgs.length;
    showLightbox();
  }
  $('lightbox').addEventListener('click', function (e) {
    if (e.target.closest('.lb-actions')) return;
    if (e.target.closest('.lb-prev')) stepLightbox(-1);
    else if (e.target.closest('.lb-next')) stepLightbox(1);
    else if (e.target.tagName !== 'IMG') closeLightbox();
  });
  document.addEventListener('keydown', function (e) {
    if ($('lightbox').hidden) return;
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  });
  addSwipe($('lightbox'), {
    enabled: function () { return lb.imgs.length > 1; },
    target: function () { return $('lightboxImg'); },
    swipe: stepLightbox
  });

  // 编辑页的图片查看器：设为代表图 —— 当前图片移到第一张，仍显示这张图；
  // 从本事件移除 —— 从编辑中的图片里去掉（图片文件不删除），显示下一张（是最后一张时显示上一张），没有图片时关闭。
  // 两者都只改编辑页中的草稿，编辑页的缩略图随之更新；点“保存”后才写入数据，点“取消”则全部作废。
  $('lbCover').addEventListener('click', function () {
    if (!lb.edit || lb.i === 0) return;
    lb.imgs.unshift(lb.imgs.splice(lb.i, 1)[0]);
    lb.i = 0;
    renderImageEditor();
    showLightbox();
  });
  $('lbRemove').addEventListener('click', function () {
    if (!lb.edit) return;
    lb.imgs.splice(lb.i, 1);
    renderImageEditor();
    if (!lb.imgs.length) { closeLightbox(); return; }
    if (lb.i >= lb.imgs.length) lb.i = lb.imgs.length - 1;
    showLightbox();
  });

  // ---------- 编辑 / 新建 ----------
  var form = $('editForm');
  var editingId = null;
  var suggestMode = null, suggestBase = null;   // 建议模式（见 openEditor）
  var draftImages = [];

  // mode：缺省为编辑（只在调试模式下可用）；'suggest' 为访问者建议修改该事件，'propose' 为建议新增事件
  // （建议模式不修改数据，而是把改动通过反馈发送给维护者，见下方“反馈”部分）
  function openEditor(id, mode) {
    if (mode ? !feedbackOn : !debugMode) return;
    var ev = id ? findEvent(id) : null;
    suggestMode = mode || null;
    suggestBase = mode === 'suggest' ? ev : null;
    editingId = mode ? null : (ev ? ev.id : null);
    form.classList.toggle('suggest-mode', !!mode);
    setSaveState(null);
    $('editTitle').textContent = mode === 'suggest' ? _('建议修改：{title}', { title: ev.title }) : mode === 'propose' ? _('建议新增事件') : ev ? _('编辑事件') : _('添加新事件');
    form.reset();
    form.title.value = ev ? ev.title : '';
    var y = ev ? ev.year : 1980;
    form.era.value = y < 0 ? 'bce' : 'ce';
    form.yearAbs.value = Math.abs(y) || 1;
    form.date.value = ev ? (ev.date || '') : '';
    form.short.value = ev ? (ev.short || '') : '';
    form.detail.value = ev ? (ev.detail || '') : '';
    draftSources = ev ? clone(sourcesOf(ev)) : [];
    renderSourceEditor();
    form.majorScore.value = String(ev ? scoreOf(ev) : DEFAULT_SCORE);
    var typeSel = form.type;
    typeSel.innerHTML = '';
    typeSel.appendChild(new Option(_('未分类'), ''));
    TYPES.forEach(function (t) { typeSel.appendChild(new Option(t.name, t.name)); });
    // 数据中出现、但不在类型列表里的类型也保留为选项，避免编辑时丢失
    if (ev && ev.type && !TYPES.some(function (t) { return t.name === ev.type; })) typeSel.appendChild(new Option(ev.type, ev.type));
    typeSel.value = ev && ev.type ? ev.type : '';
    ['transitionFrom', 'transitionTo'].forEach(function (name, i) {
      var sel = form[name];
      sel.innerHTML = '';
      sel.appendChild(new Option(_('无'), ''));
      ERAS.forEach(function (era) { sel.appendChild(new Option(era.name, era.name)); });
      sel.value = ev && ev.transition ? (i ? ev.transition.to : ev.transition.from) : '';
    });
    draftImages = ev ? clone(ev.images || []) : [];
    $('imageUrlInput').value = '';
    resetNewCredit();
    $('imageInfo').open = false;   // 图片信息表默认折叠
    loadSiblings(mode ? null : (ev ? ev.id : null), !mode);
    $('formError').textContent = '';
    if (mode) fillSuggestFields(mode === 'suggest' ? ev : null);
    setImageSearchMenu(false);
    updateImageSearch();
    renderImageEditor();
    updateCounters();
    openModal('editModal');
    form.scrollTop = 0;
    setTimeout(function () { form.title.focus(); }, 50);
  }

  function updateCounters() {
    Array.prototype.forEach.call(form.querySelectorAll('.counter'), function (c) {
      var f = form[c.dataset.for];
      c.textContent = f.value.length + ' / ' + f.maxLength;
    });
  }
  form.addEventListener('input', updateCounters);

  // 拖动排序（代表图之后的图片）：from 移到 to 之前的位置（to 为移动前的下标），不会移到第一张
  var dragImageFrom = null;
  function dropAfter(slot, e) {
    var r = slot.getBoundingClientRect();
    return e.clientX > r.left + r.width / 2;
  }
  function clearImageDropMarks(except) {
    Array.prototype.forEach.call($('imageEditor').querySelectorAll('.drop-before, .drop-after, .dragging'), function (s) {
      if (s !== except) s.classList.remove('drop-before', 'drop-after', 'dragging');
    });
    if (except) except.classList.remove('drop-before', 'drop-after');
  }
  function moveDraftImage(from, to) {
    if (from < 1 || from >= draftImages.length) return;
    to = Math.max(1, Math.min(draftImages.length, to));
    var item = draftImages.splice(from, 1)[0];
    if (to > from) to--;
    draftImages.splice(to, 0, item);
    renderImageEditor();
  }
  function renderImageEditor() {
    var box = $('imageEditor');
    box.innerHTML = '';
    draftImages.forEach(function (im, i) {
      var slot = el('div', 'img-slot');
      var pic = imageEl(im, '', _('图'));
      // 点击缩略图放大查看，可左右切换、设为代表图或移除（建议模式不显示图片编辑）
      pic.classList.add('slot-zoom');
      pic.title = i > 0 ? _('点击放大；拖动调整顺序') : _('点击放大');
      pic.addEventListener('click', function () { openLightbox(draftImages, i, true); });
      slot.appendChild(pic);
      // 代表图后面的图片可以拖动排序（只在它们之间移动，代表图固定在第一张；用“★”或查看器中的“设为代表图”更换代表图）
      if (i > 0) {
        slot.dataset.index = String(i);
        pic.draggable = true;
        pic.addEventListener('dragstart', function (e) {
          dragImageFrom = i;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(i));
          slot.classList.add('dragging');
        });
        pic.addEventListener('dragend', function () { dragImageFrom = null; clearImageDropMarks(); });
        slot.addEventListener('dragover', function (e) {
          if (dragImageFrom == null) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          clearImageDropMarks(slot);
          slot.classList.add(dropAfter(slot, e) ? 'drop-after' : 'drop-before');
        });
        slot.addEventListener('dragleave', function (e) {
          if (!slot.contains(e.relatedTarget)) slot.classList.remove('drop-before', 'drop-after');
        });
        slot.addEventListener('drop', function (e) {
          if (dragImageFrom == null) return;
          e.preventDefault();
          var from = dragImageFrom;
          var to = i + (dropAfter(slot, e) ? 1 : 0);   // 放在目标图片之前 / 之后
          dragImageFrom = null;
          moveDraftImage(from, to);
        });
      }
      if (i === 0) slot.appendChild(el('span', 'badge', _('代表图')));
      slot.appendChild(creditChip(im));
      var acts = el('div', 'slot-actions');
      if (i > 0) {
        var up = el('button', null, '★');
        up.type = 'button'; up.title = _('设为代表图');
        up.addEventListener('click', function () {
          draftImages.unshift(draftImages.splice(i, 1)[0]);
          renderImageEditor();
        });
        acts.appendChild(up);
      }
      var rm = el('button', null, '✕');
      rm.type = 'button'; rm.title = _('移除');
      rm.addEventListener('click', function () {
        draftImages.splice(i, 1);
        renderImageEditor();
      });
      acts.appendChild(rm);
      slot.appendChild(acts);
      // 图片标题：显示在图片查看器中，保存时随事件写入数据
      var cap = el('input', 'slot-caption');
      cap.type = 'text';
      cap.maxLength = MAX_CAPTION;
      cap.placeholder = _('图片标题');
      cap.value = im.caption || '';
      cap.setAttribute('aria-label', _('第 {n} 张图片的标题', { n: i + 1 }));
      cap.title = im.caption || '';   // 悬停时显示完整标题（输入框可能显示不全）
      cap.dataset.index = String(i);
      cap.addEventListener('input', function () {
        im.caption = cap.value; cap.title = cap.value;
        syncCaptionInput('#imageInfoRows .info-caption', i, cap.value);
        updateLangCounts();
      });
      slot.appendChild(cap);
      box.appendChild(slot);
    });
    var full = draftImages.length >= MAX_IMAGES;
    $('imageUrlInput').disabled = full || urlBusy;
    $('imageUrlAdd').disabled = full || urlBusy;
    $('imageFileInput').disabled = full;
    renderImageInfo();
  }


  // 输入图片网址：先下载到本地再加入，数据中不保存外部网址。
  // - 本地文件模式：由本地服务器下载并保存到 images/（服务器不受浏览器的跨域限制）；
  // - 浏览器模式：由浏览器下载（需对方网站允许跨域），压缩后与上传的图片一样保存在当前浏览器中。
  var urlBusy = false;
  function fetchImageUrl(url) {
    if (fileMode) {
      return requestJson('api/images/fetch', 'POST', { url: url }).then(function (r) {
        return { src: r.path, w: r.w, h: r.h };
      });
    }
    return fetch(url, { mode: 'cors' }).catch(function () {
      throw new Error(_('该网站不允许直接下载图片，请先保存到电脑再上传'));
    }).then(function (res) {
      if (!res.ok) throw new Error(_('网址返回 HTTP {status}', { status: res.status }));
      return res.blob();
    }).then(function (blob) {
      if (!/^image\//.test(blob.type)) throw new Error(_('该网址不是图片'));
      return new Promise(function (resolve, reject) {
        resizeFile(blob, 900, function (data, w, h) {
          if (data) resolve({ src: data, w: w, h: h });
          else reject(new Error(_('无法识别该图片')));
        });
      });
    });
  }
  // 维基共享资源的文件页网址（如 https://commons.wikimedia.org/wiki/File:xxx.jpg）不是图片本身：
  // 先查询这张图片的作者、许可证和图片地址，再下载图片；直接的图片地址（upload.wikimedia.org）也会查询版权信息
  function addImageUrl() {
    var inp = $('imageUrlInput'), btn = $('imageUrlAdd');
    var url = inp.value.trim();
    if (!url || urlBusy) return;
    if (!/^https?:\/\//i.test(url)) { $('formError').textContent = _('请输入以 http:// 或 https:// 开头的图片网址'); return; }
    if (draftImages.length >= MAX_IMAGES) { $('formError').textContent = _('最多只能添加 9 张图片'); return; }
    urlBusy = true;
    btn.textContent = _('下载中…');
    $('formError').textContent = '';
    renderImageEditor();
    var file = commonsFileName(url), page = file && !isCommonsUpload(url);
    var info = !file ? Promise.resolve(null) : commonsInfoFor(url).then(function (r) {
      fillNewCredit(r, url);
      return r;
    }, function (e) {
      if (page) throw new Error(_('无法读取维基共享资源的图片信息：{error}', { error: e.message }));
      return null;   // 直接的图片地址：查不到版权信息也照常下载
    });
    info.then(function (r) {
      return fetchImageUrl(page ? r.imageUrl : url).then(function (img) {
        if (draftImages.length >= MAX_IMAGES) return;
        var cap = takeNewCaption();
        var im = Object.assign({ src: img.src, w: img.w, h: img.h, caption: cap.caption }, takeNewCredit(r ? r.sourceUrl : url));
        im._new = true;
        im._tr = cap.tr;
        draftImages.push(im);
        inp.value = '';
        resetNewCredit();
      });
    }).catch(function (e) {
      $('formError').textContent = _('图片下载失败：{error}', { error: e.message });
    }).then(function () {
      urlBusy = false;
      btn.textContent = _('添加网址');
      renderImageEditor();
    });
  }
  $('imageUrlAdd').addEventListener('click', addImageUrl);
  // 点进“粘贴图片网址”输入框时，如果框是空的、剪贴板里是网址，自动粘贴进来（浏览器可能先询问是否允许读取剪贴板；
  // 不允许或剪贴板不是网址时什么也不做）
  $('imageUrlInput').addEventListener('focus', function () {
    var inp = this;
    if (inp.value.trim() || !navigator.clipboard || !navigator.clipboard.readText) return;
    navigator.clipboard.readText().then(function (text) {
      text = (text || '').trim();
      if (!inp.value.trim() && /^https?:\/\/\S+$/i.test(text)) { inp.value = text; inp.select(); onNewImageUrl(); }   // 和手动粘贴一样自动填写标题和版权
    }, function () { /* 没有权限：忽略 */ });
  });
  $('imageUrlInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addImageUrl(); }
  });

  // 上传的图片压缩后以 dataURL 保存在本地
  function resizeFile(file, maxSide, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, maxSide / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', 0.8), c.width, c.height);
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }
  $('imageFileInput').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = '';
    var room = MAX_IMAGES - draftImages.length;
    // 上传的图片使用“这张图的版权”一行填写的信息（同时上传多张时每张都用这一份），然后清空这一行
    var credit = takeNewCredit(''), newCap = takeNewCaption();
    if (files.length) resetNewCredit();
    if (files.length > room) $('formError').textContent = _('最多只能添加 9 张图片，多余的已忽略');
    files.slice(0, room).forEach(function (f) {
      if (!/^image\//.test(f.type)) return;
      resizeFile(f, 900, function (data, w, h) {
        if (!data || draftImages.length >= MAX_IMAGES) return;
        var im = Object.assign({ src: data, w: w, h: h, caption: newCap.caption || f.name.replace(/\.[^.]+$/, '').slice(0, MAX_CAPTION) }, credit);
        im._new = true;
        im._tr = Object.assign({}, newCap.tr);
        draftImages.push(im);
        renderImageEditor();
      });
    });
  });

  // ---------- 编辑页：图片版权与多语言标题 ----------
  // “这张图的版权”一行：添加网址或上传图片时写入新图片，然后清空；粘贴维基共享资源的网址时自动填写（可以再改）。
  // 新图片的许可证默认为“不详”（网站上显示“来源网络，作者不详”）；来源网址留空时用粘贴的图片网址
  function licenseOptions(sel, value, withEmpty) {
    sel.innerHTML = '';
    if (withEmpty) sel.appendChild(new Option(_('未填写'), ''));
    sel.appendChild(new Option(licenseLabel(UNKNOWN_LICENSE), UNKNOWN_LICENSE));
    LICENSE_OPTIONS.forEach(function (l) { sel.appendChild(new Option(licenseLabel(l), l)); });
    // 数据中的其他许可证（如 GFDL）也保留为选项，编辑时不丢失
    if (value && value !== UNKNOWN_LICENSE && LICENSE_OPTIONS.indexOf(value) < 0) sel.appendChild(new Option(value, value));
    sel.value = value || '';
  }
  var newCreditFor = '';   // 自动填写的版权信息对应的网址（网址改了就清掉自动填写的内容）
  function setNewCreditHint(text, cls) {
    var h = $('newCreditHint');
    h.textContent = text || '';
    h.className = 'new-credit-hint' + (cls ? ' ' + cls : '');
    h.hidden = !text;
  }
  // “这张图的标题”一行：当前语言和其他语言（数据集中有这个事件的语言，与图片信息表的对照语言相同）各一个输入框。
  // 输入的内容保存在 newCaptions 中；语言不变时不重建输入框（保持光标）
  var newCaptions = {}, newCaptionLangs = null;
  function renderNewCaption() {
    var langs = [LANG].concat(availableLangs());
    var key = langs.join(',');
    if (key === newCaptionLangs) return;
    newCaptionLangs = key;
    var box = $('newCaptionInputs');
    box.innerHTML = '';
    langs.forEach(function (lang) {
      var s = siblings[lang];
      // 语言名称单独放在一个元素中（各语言用自己的名称），输入框由外层 label 关联
      var item = el('label', 'new-caption-item');
      item.appendChild(el('span', 'lang-name', s ? s.name : (LOCALE.name || LANG)));
      var input = el('input', 'new-caption-input');
      input.type = 'text';
      input.maxLength = s ? s.maxCaption : MAX_CAPTION;
      input.placeholder = lang === LANG ? _('图片标题（上传时留空用文件名）') : _('未翻译');
      input.lang = (I18N[lang] && I18N[lang].htmlLang) || lang;
      input.dataset.lang = lang;
      input.value = newCaptions[lang] || '';
      input.addEventListener('input', function () { newCaptions[lang] = input.value; });
      // 首选语言的标题改完（离开输入框）后，翻译成其他语言（只填空的或自动填写的）
      if (lang === primaryLang()) input.addEventListener('change', function () { translateFromPrimary(null); });
      item.appendChild(input);
      box.appendChild(item);
    });
  }
  // 维基共享资源的标题自动填入各语言的输入框：只填空的或上次自动填写的（不覆盖手动输入的）。
  // 首选语言（数据集的 primaryLanguage，中国是中文）没有标题时从其他语言翻译，只有繁体等变体时转换成数据集的写法；
  // 维基共享资源上没有的其他语言从首选语言翻译
  var newCaptionAuto = {}, captionGen = 0;
  function primaryLang() {
    var p = meta && meta.primaryLanguage;
    return p && I18N[p] ? p : LANG;
  }
  function langCode(lang) { return (I18N[lang] && I18N[lang].htmlLang) || lang; }
  function captionInput(lang) { return $('newCaptionInputs').querySelector('input[data-lang="' + lang + '"]'); }
  function setAutoCaption(lang, text) {
    var max = (I18N[lang] && I18N[lang].limits && I18N[lang].limits.maxCaption) || 60;
    text = shortCaption(text, max);
    var cur = newCaptions[lang] || '';
    if (!text || (cur && cur !== newCaptionAuto[lang])) return false;
    newCaptions[lang] = newCaptionAuto[lang] = text;
    var input = captionInput(lang);
    if (input) input.value = text;
    return true;
  }
  // 翻译（本地服务器的 /api/translate；线上网站没有这个接口，翻译不了时返回 null）
  // 翻译不了时在标题栏下方说明原因：没有翻译接口（线上网站，或本地服务器还是旧版本）/ 连不上翻译网站
  function translateCaption(text, from, to) {
    var q = new URLSearchParams({ text: text, from: from, to: to });
    return fetch('api/translate?' + q.toString()).then(function (res) {
      if (!res.ok) { setCaptionHint(_('自动翻译需要在本地用 npm start 启动网站（更新代码后要重新启动）')); return null; }
      return res.json().then(function (r) {
        var t = r && typeof r.text === 'string' && r.text.trim() ? r.text.trim() : null;
        setCaptionHint(t ? '' : _('自动翻译失败：连不上翻译网站，请手动填写'));
        return t;
      });
    }).catch(function () { return null; });
  }
  function setCaptionHint(text) {
    var h = $('newCaptionHint');
    h.textContent = text || '';
    h.className = 'new-credit-hint' + (text ? ' warn' : '');
    h.hidden = !text;
  }
  // 翻译到 lang 时在输入框中显示“翻译中…”
  // fallback：翻译不了时填入的文字（转换繁简失败时用原文）
  function translateInto(lang, text, from, gen, fallback) {
    var input = captionInput(lang), ph = input && input.placeholder;
    if (input && !input.value) input.placeholder = _('翻译中…');
    return translateCaption(text, from, langCode(lang)).then(function (t) {
      if (input) input.placeholder = ph;
      if (gen === captionGen && (t || fallback)) setAutoCaption(lang, t || fallback);
    });
  }
  // 首选语言的标题翻译成其他语言：只填空的或自动填写的；skip 中的语言（维基共享资源上已有）不翻译
  function translateFromPrimary(skip) {
    var p = primaryLang(), text = (newCaptions[p] || '').trim(), gen = captionGen;
    if (!text) return Promise.resolve();
    return Promise.all(Object.keys(I18N).filter(function (l) {
      if (l === p || (skip && skip[l])) return false;
      var cur = newCaptions[l] || '';
      return !cur || cur === newCaptionAuto[l];
    }).map(function (l) { return translateInto(l, text, langCode(p), gen); }));
  }
  function fillNewCaptions(captions) {
    var p = primaryLang(), gen = captionGen, have = {};
    Object.keys(I18N).forEach(function (lang) {
      var c = captions[lang];
      // 首选语言只有其他写法（如繁体）时先转换，见下面
      if (!c || (lang === p && !sameScript(c.code, lang))) return;
      setAutoCaption(lang, c.text);
      have[lang] = true;
    });
    var first;
    var pc = captions[p];
    if (pc && !have[p]) {
      setAutoCaption(p, pc.text);   // 先填原文，转换好后替换
      first = translateInto(p, pc.text, p === 'zh' ? 'zh-TW' : 'auto', gen);
    }
    else if (!pc) {
      // 首选语言没有标题：从其他语言翻译（英文优先）
      var src = captions.en || captions[Object.keys(captions)[0]];
      if (src) first = translateInto(p, src.text, 'auto', gen);
    }
    return Promise.resolve(first).then(function () {
      if (gen === captionGen) return translateFromPrimary(have);
    });
  }
  // 维基共享资源的语言代码（如 zh-hant）与数据集的写法（zh → zh-CN 简体）是否一致
  // 中文：只有明确标为简体（zh-hans、zh-cn）的才算简体，标为 zh 的可能是繁体，也要转换
  function sameScript(code, lang) {
    if (lang !== 'zh') return true;
    return /hans|cn|sg/i.test(code || '') === /hans|cn|sg/i.test(langCode(lang));
  }
  // 清掉自动填写的标题（网址改了），手动输入的保留
  function clearAutoCaptions() {
    captionGen++;
    Object.keys(newCaptionAuto).forEach(function (lang) {
      if (newCaptions[lang] !== newCaptionAuto[lang]) return;
      newCaptions[lang] = '';
      var input = $('newCaptionInputs').querySelector('input[data-lang="' + lang + '"]');
      if (input) input.value = '';
    });
    newCaptionAuto = {};
  }
  function firstSentence(text) {
    var m = (text || '').match(/^.+?[。！？]|^.+?[.!?](?=\s|$)/);
    return m ? m[0] : (text || '');
  }
  // 太长的标题只取第一句，仍然太长时截断；去掉句末的句号
  function shortCaption(text, max) {
    text = (text || '').replace(/\s+/g, ' ').trim();
    if (text.length > max) text = firstSentence(text);
    text = text.replace(/[。.]$/, '').trim();
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }
  // 取出“这张图的标题”一行的内容：{ caption, tr（其他语言的标题） }
  function takeNewCaption() {
    var tr = {};
    availableLangs().forEach(function (lang) { tr[lang] = (newCaptions[lang] || '').trim(); });
    return { caption: (newCaptions[LANG] || '').trim().slice(0, MAX_CAPTION), tr: tr };
  }
  function resetNewCredit() {
    captionGen++;
    setCaptionHint('');
    newCaptions = {};
    newCaptionAuto = {};
    Array.prototype.forEach.call($('newCaptionInputs').querySelectorAll('input'), function (input) { input.value = ''; });
    $('newCreditAuthor').value = '';
    licenseOptions($('newCreditLicense'), UNKNOWN_LICENSE, false);
    $('newCreditSource').value = '';
    $('newCredit').classList.remove('auto');
    newCreditFor = '';
    setNewCreditHint('');
  }
  function fillNewCredit(info, url) {
    $('newCreditAuthor').value = info.author || '';
    licenseOptions($('newCreditLicense'), info.license || UNKNOWN_LICENSE, false);
    $('newCreditSource').value = info.sourceUrl || '';
    $('newCredit').classList.add('auto');
    newCreditFor = url;
    fillNewCaptions(info.captions || {});
  }
  // 取出“这张图的版权”一行的内容（作为新图片的 author / license / sourceUrl）
  function takeNewCredit(defaultSource) {
    var out = {};
    var author = $('newCreditAuthor').value.trim().slice(0, MAX_AUTHOR);
    var source = $('newCreditSource').value.trim() || defaultSource || '';
    if (author) out.author = author;
    out.license = $('newCreditLicense').value || UNKNOWN_LICENSE;
    if (/^https?:\/\/\S+$/i.test(source)) out.sourceUrl = source;
    return out;
  }
  // 保存前去掉编辑页内部使用的字段，整理版权信息（空的不保存）
  function cleanImage(im) {
    var out = {};
    Object.keys(im).forEach(function (k) { if (k.charAt(0) !== '_') out[k] = im[k]; });
    out.caption = (im.caption || '').trim();
    ['author', 'license', 'sourceUrl'].forEach(function (k) {
      var v = typeof out[k] === 'string' ? out[k].trim() : '';
      if (v) out[k] = v; else delete out[k];
    });
    if (out.sourceUrl && !/^https?:\/\/\S+$/i.test(out.sourceUrl)) delete out.sourceUrl;
    return out;
  }

  // 维基共享资源：从网址中取出文件名。支持文件页（/wiki/File:xxx、?title=File:xxx、维基百科的 #/media/File:xxx）
  // 和图片地址（upload.wikimedia.org/wikipedia/commons/…）
  function commonsFileName(u) {
    var url;
    try { url = new URL(u); } catch (e) { return null; }
    var dec = function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } };
    var FILE = /^(?:File|Image|文件|檔案|图像|圖像):(.+)$/i, m;
    if (/(^|\.)(wikimedia|wikipedia)\.org$/.test(url.hostname)) {
      var hash = dec(url.hash).match(/^#\/media\/(.+)$/);
      if (hash && (m = FILE.exec(hash[1]))) return m[1];
      var wiki = dec(url.pathname).match(/^\/wiki\/(.+)$/);
      if (wiki && (m = FILE.exec(wiki[1]))) return m[1];
      if ((m = FILE.exec(url.searchParams.get('title') || ''))) return m[1];
    }
    if (url.hostname === 'upload.wikimedia.org' && (m = /^\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(url.pathname))) return dec(m[1]);
    return null;
  }
  function isCommonsUpload(u) { return /^https?:\/\/upload\.wikimedia\.org\//i.test(u); }
  function htmlText(html) {
    // DOMParser 解析的文档不执行脚本、不加载图片
    var doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function normalizeLicense(name) {
    name = (name || '').trim();
    if (!name) return '';
    if (/^(public domain|pd\b|pd-)/i.test(name)) return PUBLIC_DOMAIN;
    if (/^cc0/i.test(name)) return 'CC0';
    return name.slice(0, MAX_LICENSE);
  }
  // 某种语言的文字：{ 语言代码: 文字 } 中先找完全相同的代码，再找带地区 / 文字的代码（简体优先，如 zh-hans、zh-cn）
  function pickLangKey(map, lang) {
    if (!map || typeof map !== 'object') return '';
    if (map[lang]) return lang;
    var keys = Object.keys(map).filter(function (k) { return k.toLowerCase().indexOf(lang + '-') === 0 && map[k]; });
    keys.sort(function (a, b) { return /hans|cn|sg/i.test(b) - /hans|cn|sg/i.test(a); });
    return keys[0] || '';
  }
  function pickLang(map, lang) {
    var k = pickLangKey(map, lang);
    return k ? map[k] : '';
  }
  // 图片在维基共享资源上的各语言标题：优先用“说明”（Captions，结构化数据的简短标题），没有时用“描述”（Description）。
  // 返回 { 语言: { text, code（实际的语言代码，如 zh-hant） } }；也包括网站还不支持的语言（用于翻译）
  function commonsCaptions(labels, desc) {
    var out = {};
    var langs = Object.keys(I18N);
    [labels, desc].forEach(function (m) {
      Object.keys(m || {}).forEach(function (k) { var l = k.split('-')[0].toLowerCase(); if (l !== '_type' && langs.indexOf(l) < 0) langs.push(l); });
    });
    langs.forEach(function (lang) {
      var lk = pickLangKey(labels, lang), dk = pickLangKey(desc, lang);
      var text = lk ? (labels[lk].value || '') : dk ? firstSentence(htmlText(desc[dk])) : '';   // 描述常有好几句，只取第一句
      if (text) out[lang] = { text: text, code: lk || dk };
    });
    return out;
  }
  // 结构化数据中的说明（Captions）：查不到时返回空，不影响版权信息
  function lookupCommonsLabels(file) {
    var q = new URLSearchParams({
      action: 'wbgetentities', format: 'json', origin: '*', sites: 'commonswiki', props: 'labels', titles: 'File:' + file
    });
    return fetch('https://commons.wikimedia.org/w/api.php?' + q.toString()).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (json) {
      var ents = (json && json.entities) || {};
      var ent = ents[Object.keys(ents)[0]];
      return (ent && ent.labels) || {};
    }).catch(function () { return {}; });
  }
  // 查询维基共享资源（浏览器直接访问其 API，支持跨域）：返回作者、许可证、文件页网址、用于下载的图片地址（宽不超过 1200）
  // 和各语言的标题（captions）
  function lookupCommons(file) {
    var q = new URLSearchParams({
      action: 'query', format: 'json', origin: '*', prop: 'imageinfo',
      iiprop: 'url|extmetadata', iiurlwidth: '1200', iiextmetadatamultilang: '1', titles: 'File:' + file
    });
    var labels = lookupCommonsLabels(file);
    return fetch('https://commons.wikimedia.org/w/api.php?' + q.toString()).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (json) {
      return labels.then(function (l) { return { json: json, labels: l }; });
    }).then(function (r) {
      var json = r.json;
      var pages = (json && json.query && json.query.pages) || {};
      var page = pages[Object.keys(pages)[0]];
      var ii = page && page.imageinfo && page.imageinfo[0];
      if (!ii) throw new Error(_('维基共享资源中找不到这张图片'));
      var md = ii.extmetadata || {};
      // 多语言的字段是 { 语言代码: 文字 }，取当前语言（没有时取英文或第一个）
      var val = function (k) {
        var v = md[k] && md[k].value;
        if (!v || typeof v !== 'object') return v;
        var langs = Object.keys(v).filter(function (x) { return x !== '_type'; });
        return pickLang(v, LANG) || v.en || (langs.length ? v[langs[0]] : '');
      };
      var desc = md.ImageDescription && md.ImageDescription.value;
      if (typeof desc === 'string') desc = null;   // 没有标明语言的描述不使用
      return {
        captions: commonsCaptions(r.labels, desc),
        author: htmlText(val('Artist')).slice(0, MAX_AUTHOR),
        license: normalizeLicense(htmlText(val('LicenseShortName'))) || UNKNOWN_LICENSE,
        sourceUrl: ii.descriptionurl || ('https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file.replace(/ /g, '_'))),
        imageUrl: ii.thumburl || ii.url
      };
    });
  }
  var commonsCache = {};
  function commonsInfoFor(url) {
    var file = commonsFileName(url);
    if (!file) return Promise.reject(new Error(_('不是维基共享资源的网址')));
    var key = file.replace(/_/g, ' ');
    if (!commonsCache[key]) {
      commonsCache[key] = lookupCommons(file);
      commonsCache[key].catch(function () { delete commonsCache[key]; });
    }
    return commonsCache[key];
  }
  // 粘贴或输入网址后：维基共享资源的网址自动填写版权（停顿 400 毫秒后查询，网址改了就作废）
  var urlTimer = null;
  // 网址改了：清掉上一个网址自动填写的版权和标题（手动输入的标题保留）
  function resetCreditForUrl() {
    var keep = {};
    Object.keys(newCaptions).forEach(function (l) { if (newCaptions[l] !== newCaptionAuto[l]) keep[l] = newCaptions[l]; });
    clearAutoCaptions();
    resetNewCredit();
    newCaptions = keep;
    Object.keys(keep).forEach(function (l) {
      var input = $('newCaptionInputs').querySelector('input[data-lang="' + l + '"]');
      if (input) input.value = keep[l];
    });
  }
  function onNewImageUrl() {
    var url = $('imageUrlInput').value.trim();
    if (newCreditFor && newCreditFor !== url) resetCreditForUrl();
    clearTimeout(urlTimer);
    if (!commonsFileName(url) || newCreditFor === url) return;
    urlTimer = setTimeout(function () {
      setNewCreditHint(_('⟳ 正在读取维基共享资源的图片信息…'));
      commonsInfoFor(url).then(function (info) {
        if ($('imageUrlInput').value.trim() !== url) return;
        fillNewCredit(info, url);
        setNewCreditHint(_('✓ 已从维基共享资源读取作者和许可证，点“添加网址”下载图片'), 'ok');
      }, function (e) {
        if ($('imageUrlInput').value.trim() !== url) return;
        setNewCreditHint(_('无法读取维基共享资源的图片信息：{error}', { error: e.message }), 'warn');
      });
    }, 400);
  }
  $('imageUrlInput').addEventListener('input', onNewImageUrl);
  $('imageUrlInput').addEventListener('change', onNewImageUrl);
  $('newCredit').addEventListener('input', function () { $('newCredit').classList.remove('auto'); });

  // ---------- 图片信息表 ----------
  // 每张图一行：缩略图、当前语言的标题、对照语言的标题、作者、许可证、来源网址。默认折叠，表头显示缺少的信息。
  // 对照语言是同一国家其他语言的数据集（cn_zh → cn_en，测试数据 cn_zh-test → cn_en-test），编辑页打开时加载；
  // 保存时把图片（及对照语言的标题、版权信息）同步到这些数据集中的同一事件（事件不存在时不同步）
  var siblings = {};      // 语言 → { id, lang, name, maxCaption, ev（该数据集中的同一事件，没有时为 null）, defaults }
  var siblingToken = 0;
  var COMPARE_KEY = 'zh-history-timeline:compareLang';
  var compareLang = (function () { try { return localStorage.getItem(COMPARE_KEY) || ''; } catch (e) { return ''; } })();
  function siblingId(lang) { return dataset.replace(/^([a-z]{2})_[a-z]{2,3}/, '$1_' + lang); }
  function storageKeyOf(id) { return 'zh-history-timeline:v1:' + id; }
  // 浏览器模式下该数据集保存的改动（{ changed, deleted }），没有或格式不对时返回空
  function storedChanges(id) {
    try {
      var data = JSON.parse(localStorage.getItem(storageKeyOf(id)) || 'null');
      if (data && data.version === 2 && data.changed && typeof data.changed === 'object') return data;
    } catch (e) { /* 忽略 */ }
    return null;
  }
  function eventWithChanges(defs, id, stored) {
    var def = defs.filter(function (e) { return e.id === id; })[0];
    if (stored && (stored.deleted || []).indexOf(id) >= 0) return null;
    var ch = stored && stored.changed[id];
    if (!def) return ch && ch.title ? clone(ch) : null;
    var ev = clone(def);
    if (ch) Object.keys(ch).forEach(function (k) { if (ch[k] === null) delete ev[k]; else ev[k] = clone(ch[k]); });
    return ev;
  }
  function loadSiblings(id, enabled) {
    var token = ++siblingToken;
    siblings = {};
    if (!enabled) return;
    Object.keys(I18N).filter(function (l) { return l !== LANG; }).forEach(function (lang) {
      var sid = siblingId(lang);
      if (sid === dataset || !DATASET_ID.test(sid)) return;
      fetch('data/' + sid + '.json', { cache: 'no-cache' }).then(function (res) {
        return res.ok ? res.json() : null;
      }).then(function (data) {
        if (token !== siblingToken || !data || !Array.isArray(data.events)) return;
        var ev = id ? eventWithChanges(data.events, id, fileMode ? null : storedChanges(sid)) : null;
        siblings[lang] = {
          id: sid, lang: lang, name: I18N[lang].name || lang,
          maxCaption: (I18N[lang].limits && I18N[lang].limits.maxCaption) || 60,
          ev: ev, defaults: data.events
        };
        renderImageInfo();
      }).catch(function () { /* 没有该语言的数据集：不显示对照 */ });
    });
  }
  // 对照语言的标题：第一次用到时取该语言数据集中同一张图片（按 src）的标题
  function trOf(im, lang) {
    im._tr = im._tr || {};
    if (!(lang in im._tr)) {
      var s = siblings[lang], m = s && s.ev && (s.ev.images || []).filter(function (x) { return x.src === im.src; })[0];
      im._tr[lang] = m ? (m.caption || '') : '';
    }
    return im._tr[lang];
  }
  function missingCaptions(lang) {
    return draftImages.filter(function (im) { return (im.caption || '').trim() && !trOf(im, lang).trim(); }).length;
  }
  function availableLangs() {
    return Object.keys(siblings).filter(function (l) { return siblings[l].ev; });
  }
  function syncCaptionInput(selector, i, value) {
    var other = document.querySelector(selector + '[data-index="' + i + '"]');
    if (other && other.value !== value) { other.value = value; other.title = value; }
  }
  // 表头和缩略图标签：缺少许可信息的数量、各语言缺少的标题数
  function updateInfoSummary() {
    var missing = draftImages.filter(function (im) { return creditKind(im) !== 'known'; }).length;
    var t = $('imageInfoTitle');
    t.textContent = _('图片信息 · {n} 张', { n: draftImages.length });
    if (missing) {
      t.appendChild(document.createTextNode(_('，')));
      t.appendChild(el('span', 'info-warn', _('{n} 张缺少许可信息', { n: missing })));
    }
    var canAuto = draftImages.some(needsCommonsFill);
    $('imageInfoAuto').hidden = !canAuto;
  }
  function updateLangCounts() {
    var box = $('imageInfoLangs');
    var langs = Object.keys(siblings);
    box.hidden = !langs.length;
    box.innerHTML = '';
    if (!langs.length) return;
    box.appendChild(el('span', null, _('其他语言的标题：')));
    langs.forEach(function (lang) {
      // 语言名称单独放在一个元素中（各语言用自己的名称，如“English”“中文”），后面是缺少的数量
      var s = siblings[lang], b = el('button', 'lang-count');
      b.type = 'button';
      b.dataset.lang = lang;
      b.appendChild(el('span', 'lang-name', s.name));
      var n = s.ev ? missingCaptions(lang) : 0;
      b.appendChild(document.createTextNode(!s.ev ? _('：没有这个事件') : n ? _(' 缺 {n} 张', { n: n }) : _(' ✓ 齐全')));
      b.classList.toggle('missing', n > 0);
      b.classList.toggle('on', lang === compareLang);
      b.disabled = !s.ev;
      b.addEventListener('click', function () { setCompareLang(lang); });
      box.appendChild(b);
    });
  }
  function setCompareLang(lang) {
    compareLang = lang;
    try { localStorage.setItem(COMPARE_KEY, lang); } catch (e) { /* 忽略 */ }
    renderImageInfo();
  }
  function needsCommonsFill(im) {
    return !!(im.sourceUrl && commonsFileName(im.sourceUrl) && (!im.author || creditKind(im) !== 'known'));
  }
  function renderImageInfo() {
    var head = $('imageInfoHead'), rows = $('imageInfoRows');
    var langs = availableLangs();
    var cmp = langs.indexOf(compareLang) >= 0 ? compareLang : langs[0];
    var table = $('imageInfo');
    table.classList.toggle('with-compare', !!cmp);
    head.innerHTML = '';
    rows.innerHTML = '';
    head.appendChild(el('span'));
    head.appendChild(el('span', null, _('标题（{lang}）', { lang: LOCALE.name || LANG })));
    if (cmp) {
      var cmpHead = el('span', 'compare-head', _('对照：'));
      var sel = document.createElement('select');
      sel.className = 'compare-select';
      sel.setAttribute('aria-label', _('对照语言'));
      langs.forEach(function (l) { sel.appendChild(new Option(siblings[l].name, l)); });
      sel.value = cmp;
      sel.addEventListener('change', function () { setCompareLang(sel.value); });
      cmpHead.appendChild(sel);
      head.appendChild(cmpHead);
    }
    [_('作者'), _('许可证'), _('来源网址')].forEach(function (t) { head.appendChild(el('span', null, t)); });
    draftImages.forEach(function (im, i) {
      var row = el('div', 'info-row' + (im._new ? ' new' : ''));
      var n = { n: i + 1 };
      row.appendChild(imageEl(im, 'info-thumb', _('图')));
      var cap = el('input', 'info-caption');
      cap.type = 'text'; cap.maxLength = MAX_CAPTION; cap.placeholder = _('图片标题');
      cap.value = im.caption || ''; cap.title = cap.value; cap.dataset.index = String(i);
      cap.setAttribute('aria-label', _('第 {n} 张图片的标题', n));
      cap.addEventListener('input', function () {
        im.caption = cap.value; cap.title = cap.value;
        syncCaptionInput('#imageEditor .slot-caption', i, cap.value);
        updateLangCounts();
      });
      row.appendChild(cap);
      if (cmp) {
        var s = siblings[cmp], tr = el('input', 'info-compare');
        tr.type = 'text'; tr.maxLength = s.maxCaption;
        tr.placeholder = _('未翻译');
        tr.value = trOf(im, cmp);
        tr.lang = I18N[cmp].htmlLang || cmp;
        tr.setAttribute('aria-label', _('第 {n} 张图片的对照语言标题', n));
        var markTr = function () { tr.classList.toggle('warn', !!(im.caption || '').trim() && !tr.value.trim()); };
        markTr();
        tr.addEventListener('input', function () { im._tr[cmp] = tr.value; markTr(); updateLangCounts(); });
        row.appendChild(tr);
      }
      var author = el('input', 'info-author');
      author.type = 'text'; author.maxLength = MAX_AUTHOR; author.placeholder = _('作者（不知道可以留空）');
      author.value = im.author || '';
      author.setAttribute('aria-label', _('第 {n} 张图片的作者', n));
      author.addEventListener('input', function () { im.author = author.value; creditChanged(i); });
      row.appendChild(author);
      var lic = document.createElement('select');
      lic.className = 'info-license';
      lic.setAttribute('aria-label', _('第 {n} 张图片的许可证', n));
      licenseOptions(lic, im.license || '', true);
      var markLic = function () { lic.classList.toggle('warn', creditKind(im) !== 'known'); };
      markLic();
      lic.addEventListener('change', function () { if (lic.value) im.license = lic.value; else delete im.license; markLic(); creditChanged(i); });
      row.appendChild(lic);
      var src = el('input', 'info-source');
      src.type = 'url'; src.placeholder = _('来源网址');
      src.value = im.sourceUrl || '';
      src.setAttribute('aria-label', _('第 {n} 张图片的来源网址', n));
      src.addEventListener('input', function () { im.sourceUrl = src.value.trim(); markLic(); creditChanged(i); });
      row.appendChild(src);
      if (im._new) row.appendChild(el('div', 'info-note', im.license && im.license !== UNKNOWN_LICENSE
        ? _('✓ 刚添加的图片，版权信息来自上面的版权栏') : _('刚添加的图片：可以在这里补充作者和许可证')));
      rows.appendChild(row);
    });
    updateInfoSummary();
    updateLangCounts();
    renderNewCaption();
  }
  // 版权信息改动后：更新这张图的缩略图标签和表头（不重建输入框，保持光标）
  function creditChanged(i) {
    var slot = $('imageEditor').querySelectorAll('.img-slot')[i], im = draftImages[i];
    if (slot) {
      var old = slot.querySelector('.credit-chip');
      if (old) old.remove();
      slot.insertBefore(creditChip(im), slot.querySelector('.slot-caption'));
    }
    updateInfoSummary();
  }
  // “从维基共享资源自动填写”：来源网址是维基共享资源、但缺少作者或许可证的图片，查询后补上（已填写的作者不覆盖）
  $('imageInfoAuto').addEventListener('click', function (e) {
    e.preventDefault();   // 按钮在 summary 中，不切换折叠
    var btn = this, list = draftImages.filter(needsCommonsFill);
    if (!list.length || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = _('查询中…');
    Promise.all(list.map(function (im) {
      return commonsInfoFor(im.sourceUrl).then(function (info) {
        if (!im.author && info.author) im.author = info.author;
        if (creditKind(im) !== 'known') im.license = info.license;
        im.sourceUrl = info.sourceUrl || im.sourceUrl;
        return true;
      }, function () { return false; });
    })).then(function (ok) {
      btn.disabled = false;
      btn.textContent = _('从维基共享资源自动填写');
      var failed = ok.filter(function (x) { return !x; }).length;
      if (failed) $('formError').textContent = _('有 {n} 张图片没有查到维基共享资源的信息', { n: failed });
      renderImageEditor();
    });
  });

  // 保存后同步其他语言的数据集：同一事件的图片换成当前的图片（顺序、尺寸、版权信息），标题用对照语言的标题
  // （没有编辑过的取该语言原来的标题，新图片为空）。内容没有变化时不写入
  function saveSiblings(id, images, trs) {
    var jobs = Object.keys(siblings).map(function (lang) {
      var s = siblings[lang];
      if (!s.ev || s.ev.id !== id) return null;
      var old = s.ev.images || [];
      var next = images.map(function (im, i) {
        var o = clone(im);
        var tr = trs[i] && trs[i][lang];
        if (tr == null) {
          var m = old.filter(function (x) { return x.src === im.src; })[0];
          tr = m ? m.caption || '' : '';
        }
        o.caption = String(tr).trim();
        return o;
      });
      if (canonical(next) === canonical(old)) return null;
      return writeSiblingImages(s, id, next).then(function () { s.ev.images = clone(next); });
    }).filter(Boolean);
    return Promise.all(jobs);
  }
  function writeSiblingImages(s, id, images) {
    if (fileMode) {
      return fetch('data/' + s.id + '.json', { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (data) {
        var ev = data.events.filter(function (e) { return e.id === id; })[0];
        if (!ev) return null;
        ev.images = images;
        return requestJson('api/data/' + s.id, 'PUT', data);
      });
    }
    // 浏览器模式：写入该数据集在当前浏览器中保存的改动（只记录与数据文件不同的字段）
    var stored = storedChanges(s.id) || { version: 2, changed: {}, deleted: [] };
    var cur = eventWithChanges(s.defaults, id, stored);
    if (!cur) return Promise.resolve();
    cur.images = images;
    var def = s.defaults.filter(function (e) { return e.id === id; })[0];
    var ch = def ? eventDiff(cur, def) : cur;
    if (ch) stored.changed[id] = ch; else delete stored.changed[id];
    try {
      localStorage.setItem(storageKeyOf(s.id), JSON.stringify(stored));
    } catch (e) {
      return Promise.reject(new Error(_('浏览器存储空间不足')));
    }
    return Promise.resolve();
  }

  // ---------- 编辑页：参考链接（可增删改） ----------
  var draftSources = [];
  // 编辑模式下末尾总保留一个空行（预留的添加位置）；在最后一行填入内容后自动再预留一个。
  // 空行不保存（见 cleanSources）。建议模式同样预留。
  function needsSpareSource() {
    if (draftSources.length >= MAX_SOURCES) return false;
    var last = draftSources[draftSources.length - 1];
    return !last || !!((last.url || '').trim() || (last.title || '').trim());
  }
  function addSpareSourceIfNeeded() {
    if (!needsSpareSource()) return;
    var spare = { url: '', title: '' };
    draftSources.push(spare);
    $('sourceEditor').appendChild(sourceRow(spare, draftSources.length - 1));   // 只追加一行，不重绘（保留光标和正在进行的查询）
  }
  function renderSourceEditor() {
    var box = $('sourceEditor');
    box.innerHTML = '';
    if (needsSpareSource()) draftSources.push({ url: '', title: '' });
    draftSources.forEach(function (src, i) { box.appendChild(sourceRow(src, i)); });
  }
  function sourceRow(src, i) {
    var li = el('li', 'source-row');
    var url = el('input', 'source-url');
    url.type = 'url';
    url.placeholder = 'https://…';
    url.value = src.url || '';
    url.setAttribute('aria-label', _('第 {n} 条参考链接的网址', { n: i + 1 }));
    url.addEventListener('input', function () { src.url = url.value; addSpareSourceIfNeeded(); });
    var title = el('input', 'source-title');
    title.type = 'text';
    title.maxLength = LIMITS.maxSourceTitle || 60;
    title.placeholder = _('标题（可选）');
    title.value = src.title || '';
    title.setAttribute('aria-label', _('第 {n} 条参考链接的标题', { n: i + 1 }));
    var hint = el('div', 'source-hint');
    title.addEventListener('input', function () {
      src.title = title.value;
      if (src._hint) { src._hint = null; showSourceHint(src, hint); }   // 手动修改后不再显示自动填写的提示
      addSpareSourceIfNeeded();
    });
    // 在新标签页中打开链接（建议模式不显示）；网址无效时不可点
    var open = el('a', 'icon-btn source-open', '↗');
    open.target = '_blank';
    open.rel = 'noopener';
    open.title = _('在新标签页中打开');
    open.setAttribute('aria-label', _('打开第 {n} 条参考链接', { n: i + 1 }));
    var syncOpen = function () {
      var u = (src.url || '').trim();
      if (/^https?:\/\/\S+$/.test(u)) { open.href = u; open.removeAttribute('aria-disabled'); }
      else { open.removeAttribute('href'); open.setAttribute('aria-disabled', 'true'); }
    };
    syncOpen();
    url.addEventListener('input', syncOpen);
    // 维基百科 / 百度百科链接：粘贴后或离开输入框时自动填写标题（建议模式不自动填写）
    url.addEventListener('paste', function () { setTimeout(function () { autoSourceTitle(src, title, hint); }, 0); });
    url.addEventListener('change', function () { autoSourceTitle(src, title, hint); });
    var rm = el('button', 'icon-btn source-remove', '×');
    rm.type = 'button';
    rm.title = _('删除这条链接');
    rm.setAttribute('aria-label', _('删除第 {n} 条参考链接', { n: i + 1 }));
    rm.addEventListener('click', function () {
      draftSources.splice(i, 1);
      renderSourceEditor();
    });
    li.appendChild(url);
    li.appendChild(title);
    li.appendChild(open);
    li.appendChild(rm);
    li.appendChild(hint);
    showSourceHint(src, hint);
    return li;
  }
  // 搜图：用编辑页中的“事件名称”在所选网站搜索图片（新标签页打开）；选择保存在浏览器中
  var IMAGE_SEARCH_KEY = 'zh-history-timeline:imageSearch';
  var IMAGE_SEARCH = [
    { id: 'google', menu: _('Google 图片'), label: _('Google 搜图'), url: function (q) { return 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(q); } },
    { id: 'bing', menu: _('Bing 图片'), label: _('Bing 搜图'), url: function (q) { return 'https://www.bing.com/images/search?q=' + encodeURIComponent(q); } },
    { id: 'baidu', menu: _('百度图片'), label: _('百度搜图'), url: function (q) { return 'https://image.baidu.com/search/index?tn=baiduimage&word=' + encodeURIComponent(q); } },
    { id: 'commons', menu: _('Google · 维基共享资源'), label: _('维基共享资源'), url: function (q) { return 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(q + ' site:commons.wikimedia.org'); } }
  ];
  var imageSearchId = 'google';
  try { var savedSearch = localStorage.getItem(IMAGE_SEARCH_KEY); if (IMAGE_SEARCH.some(function (e) { return e.id === savedSearch; })) imageSearchId = savedSearch; } catch (e) { /* noop */ }
  function imageSearchEngine() { return IMAGE_SEARCH.filter(function (e) { return e.id === imageSearchId; })[0]; }
  function updateImageSearch() {
    var q = form.title.value.trim();
    var eng = imageSearchEngine();
    $('imgSearchLabel').textContent = eng.label;
    var main = $('imgSearchMain');
    main.title = q ? _('用“{q}”搜索图片', { q: q }) : _('请先填写事件名称');
    if (q) { main.href = eng.url(q); main.removeAttribute('aria-disabled'); }
    else { main.removeAttribute('href'); main.setAttribute('aria-disabled', 'true'); }
    var menu = $('imgSearchMenu');
    menu.innerHTML = '';
    IMAGE_SEARCH.forEach(function (e) {
      var a = el('a', 'img-search-item' + (e.id === imageSearchId ? ' on' : ''), e.menu);
      a.setAttribute('role', 'menuitemradio');
      a.setAttribute('aria-checked', e.id === imageSearchId ? 'true' : 'false');
      a.dataset.engine = e.id;
      a.target = '_blank';
      a.rel = 'noopener';
      if (q) a.href = e.url(q);
      menu.appendChild(a);
    });
  }
  function setImageSearchMenu(open) {
    $('imgSearchMenu').hidden = !open;
    $('imgSearchMore').setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  form.title.addEventListener('input', updateImageSearch);
  $('imgSearchMain').addEventListener('click', function (e) {
    if (!form.title.value.trim()) { e.preventDefault(); toast(_('请先填写事件名称')); }
  });
  $('imgSearchMore').addEventListener('click', function () { setImageSearchMenu($('imgSearchMenu').hidden); });
  // 选择网站：记住选择，并直接用该网站搜索（没有事件名称时只记住选择）
  $('imgSearchMenu').addEventListener('click', function (e) {
    var a = e.target.closest('.img-search-item');
    if (!a) return;
    imageSearchId = a.dataset.engine;
    try { localStorage.setItem(IMAGE_SEARCH_KEY, imageSearchId); } catch (err) { /* noop */ }
    if (!form.title.value.trim()) { e.preventDefault(); toast(_('请先填写事件名称')); }
    setImageSearchMenu(false);
    setTimeout(updateImageSearch, 0);   // 等链接打开后再更新菜单
  });
  document.addEventListener('click', function (e) {
    if (!$('imgSearchMenu').hidden && !e.target.closest('#imgSearch')) setImageSearchMenu(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('imgSearchMenu').hidden) { e.stopImmediatePropagation(); setImageSearchMenu(false); $('imgSearchMore').focus(); }
  }, true);

  // 参考链接的自动标题：维基百科 / 百度百科链接先按链接中的词条名立即填写“维基百科 - 词条名”，
  // 再请本地服务器查询（跟随重定向、取简体标题；百度百科读取网页标题）后更新；查询失败时保留按链接填写的标题。
  // 只在标题为空、或仍是上次自动填写的内容时填写，不覆盖手动输入的标题。
  // _auto、_hint 只在编辑页中使用，保存时由 cleanSources 去掉。
  function parseEncyclopediaLink(u) {
    var x;
    try { x = new URL(u); } catch (e) { return null; }
    if (!/^https?:$/.test(x.protocol)) return null;
    var dec = function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } };
    var host = x.hostname.toLowerCase(), m;
    if (/(^|\.)wikipedia\.org$/.test(host)) {
      m = x.pathname.match(/^\/(?:wiki|zh|zh-[a-z]+)\/(.+)$/);
      var raw = m ? m[1] : x.searchParams.get('title');
      return { label: _('维基百科'), name: raw ? dec(raw).replace(/_/g, ' ').trim() : '' };
    }
    if (/(^|\.)baike\.baidu\.com$/.test(host)) {
      m = x.pathname.match(/^\/item\/([^\/?#]+)/);
      return { label: _('百度百科'), name: m ? dec(m[1]).trim() : '' };
    }
    return null;
  }
  var SOURCE_HINTS = { loading: _('⟳ 正在查询词条名…'), done: _('✓ 已自动填写标题（可修改）') };
  function showSourceHint(src, hint) {
    hint.textContent = SOURCE_HINTS[src._hint] || '';
    hint.hidden = !src._hint;
  }
  function autoSourceTitle(src, titleInput, hint) {
    if (suggestMode) return;
    var u = (src.url || '').trim();
    var info = parseEncyclopediaLink(u);
    var canFill = function () { return !(src.title || '').trim() || src.title === src._auto; };
    if (!info || !canFill() || src._lookedUp === u) return;
    src._lookedUp = u;
    var fill = function (t) { src.title = src._auto = t; titleInput.value = t; };
    if (info.name) fill(info.label + ' - ' + info.name);
    src._hint = 'loading';
    showSourceHint(src, hint);
    fetch('api/link-title?url=' + encodeURIComponent(u), { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (j) {
        if ((src.url || '').trim() !== u) return;   // 期间链接已改，结果作废
        if (j && j.title && canFill()) fill(j.title);
        src._hint = src._auto && src.title === src._auto ? 'done' : null;
        showSourceHint(src, hint);
      });
  }
  // 保存用的参考链接：去掉首尾空格和空行，标题为空时不写 title；网址无效时返回错误说明
  function cleanSources() {
    return draftSources.map(function (s) {
      var out = { url: (s.url || '').trim() };
      var t = (s.title || '').trim();
      if (t) out.title = t;
      return out;
    }).filter(function (s) { return s.url || s.title; });
  }
  function sourcesError() {
    var bad = cleanSources().filter(function (s) { return !/^https?:\/\/\S+$/.test(s.url); });
    return bad.length ? _('参考链接必须以 http:// 或 https:// 开头：{url}', { url: bad[0].url || bad[0].title }) : '';
  }

  // 保存按钮的状态：saving（转圈 + “保存中…”）→ saved（“✓ 已保存”）→ 恢复。
  // 保存要重新排版整条时间轴（可能要几百毫秒），先让按钮状态显示出来再开始，避免页面看起来卡住
  function setSaveState(state) {
    form.classList.toggle('saving', state === 'saving');
    form.classList.toggle('saved', state === 'saved');
    form.setAttribute('aria-busy', state === 'saving' ? 'true' : 'false');
    $('saveBtn').disabled = !!state;
    $('saveBtn').querySelector('.btn-label').textContent = suggestMode
      ? (state === 'saving' ? _('提交中…') : state === 'saved' ? _('✓ 已提交') : _('提交建议'))
      : (state === 'saving' ? _('保存中…') : state === 'saved' ? _('✓ 已保存') : _('保存'));
  }
  function afterPaint(fn) {
    requestAnimationFrame(function () { setTimeout(fn, 0); });
  }
  var SAVED_PAUSE = 450;   // “已保存”停留的时间（毫秒）

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.classList.contains('saving') || form.classList.contains('saved')) return;   // 防止重复提交
    if (suggestMode) { submitSuggestion(); return; }
    var title = form.title.value.trim();
    var yAbs = parseInt(form.yearAbs.value, 10);
    var err = '';
    if (!title) err = _('请填写事件名称');
    else if (!yAbs || yAbs < 1) err = _('请填写有效的年份（正整数）');
    else if (form.detail.value.length > MAX_DETAIL) err = _('详细说明不能超过 {n} 字', { n: MAX_DETAIL });
    else if (charCount(form.short.value) < MIN_SUMMARY && charCount(form.detail.value) < MIN_SUMMARY) err = _('请至少填写 {n} 字的说明（简要说明或详细说明），时间轴上会显示这段文字', { n: MIN_SUMMARY });
    var tFrom = form.transitionFrom.value, tTo = form.transitionTo.value;
    if (!err) err = sourcesError();
    if (!err && (tFrom || tTo)) {
      if (!tFrom || !tTo) err = _('时期更迭需要同时选择“从”和“到”');
      else if (tFrom === tTo) err = _('时期更迭的“从”和“到”不能相同');
    }
    if (err) { $('formError').textContent = err; return; }
    $('formError').textContent = '';
    setSaveState('saving');
    // 数据立即写入（保存后马上刷新或离开页面也不会丢失）；重新排版较慢，等按钮状态显示出来再做
    var saved = commitEdit(yAbs, title, tFrom, tTo);
    afterPaint(function () { finishEdit(saved); });
  });

  function commitEdit(yAbs, title, tFrom, tTo) {
    var year = form.era.value === 'bce' ? -yAbs : yAbs;
    var data = {
      title: title,
      year: year,
      date: form.date.value.trim() || formatYear(year),
      short: form.short.value.trim(),
      detail: form.detail.value.trim(),
      images: draftImages.slice(0, MAX_IMAGES).map(cleanImage),
      sources: cleanSources(),
      majorScore: parseInt(form.majorScore.value, 10) || DEFAULT_SCORE
    };
    if (tFrom) data.transition = { from: tFrom, to: tTo };
    if (form.type.value) data.type = form.type.value;
    var id;
    if (editingId) {
      var ev = findEvent(editingId);
      Object.keys(data).forEach(function (k) { ev[k] = data[k]; });
      if (!tFrom) delete ev.transition;
      if (!form.type.value) delete ev.type;
      delete ev.major;    // 旧版本的重大事件标记，已由 majorScore 代替
      delete ev.source;   // 旧版本的单个参考链接，已由 sources 代替
      id = ev.id;
    } else {
      data.id = id = uid();
      events.push(data);
    }
    // 本地文件模式等待写入完成；浏览器模式直接保存到 localStorage。
    // 然后把图片（版权信息、对照语言的标题）同步到其他语言的数据集（上传的图片先保存为文件，路径确定后再同步）
    var trs = draftImages.slice(0, MAX_IMAGES).map(function (im) { return im._tr || null; });
    var written = (fileMode ? saveToFile() : Promise.resolve(save())).then(function (r) {
      var saved = findEvent(id);
      return saveSiblings(id, saved ? saved.images || [] : [], trs).catch(function (e) {
        toast(_('其他语言的数据写入失败：{error}', { error: e.message }));
      }).then(function () { return r; });
    });
    return { id: id, wasEditing: !!editingId, written: written };
  }

  function finishEdit(saved) {
    var id = saved.id, wasEditing = saved.wasEditing;
    renderTimeline();
    renderList();
    saved.written.then(function () {
      setSaveState('saved');
      setTimeout(function () {
        setSaveState(null);
        closeModal('editModal');
        focusEvent(id);
        toast(wasEditing ? _('已保存修改') : _('已添加新事件'));
        if (wasEditing && openStack.indexOf('detailModal') < 0 && !sidebarOpen) openDetail(id);
      }, SAVED_PAUSE);
    }, function (e) {
      // 写入失败：修改仍保留在页面中，编辑页不关闭，可以再次保存
      setSaveState(null);
      editingId = id;
      $('formError').textContent = _('写入数据文件失败：{error}。修改仍保留在页面中，可以再次点击保存。', { error: e.message });
    });
  }

  $('addBtn').addEventListener('click', function () { openEditor(null); });

  // ---------- 反馈 / 建议修改 ----------
  // 所有访问者都可以：从事件详情反馈问题（类型：事实错误、错别字、图片有问题、链接失效、其他）或直接建议修改
  // （复用编辑页的“建议模式”，只发送改动的字段及改前改后）；从侧栏底部发送整站反馈或建议新增事件。
  // 通过 Web3Forms 发送到维护者邮箱（js/config.js 中配置 accessKey；enabled 为 false 时不显示任何反馈入口，
  // 没有 accessKey 时入口照常显示，提交时提示尚未配置）。
  // 图片不开放上传，只能指出第几张图有问题或建议图片网址。
  var FEEDBACK_CFG = (window.TIMELINE_CONFIG && window.TIMELINE_CONFIG.feedback) || {};
  var feedbackOn = FEEDBACK_CFG.enabled !== false && !!FEEDBACK_CFG.endpoint;
  document.body.classList.toggle('feedback-on', feedbackOn);
  var SITE_NAME = '时间上的中国';
  var EVENT_KINDS = ['事实错误', '错别字', '图片有问题', '链接失效', '其他'];
  var SITE_KINDS = ['网站问题', '功能建议', '其他'];
  var fbForm = $('feedbackForm');
  var fbEventId = null;

  function isHttpUrl(v) { return /^https?:\/\/\S+$/.test(v); }
  function looksLikeEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  // 发送到 Web3Forms。fields 的键名会原样显示在邮件中，因此用中文；botcheck 为防垃圾的隐藏字段（人不会填写）
  function sendFeedback(subject, fields, contact, botcheck) {
    if (!FEEDBACK_CFG.accessKey) return Promise.reject(new Error(_('反馈服务尚未配置（缺少 Access Key）')));
    var body = { access_key: FEEDBACK_CFG.accessKey, subject: '[' + SITE_NAME + '] ' + subject, from_name: SITE_NAME + ' 反馈', botcheck: botcheck || '' };
    Object.keys(fields).forEach(function (k) { if (fields[k] !== '' && fields[k] != null) body[k] = fields[k]; });
    if (contact) {
      body['联系方式'] = contact;
      if (looksLikeEmail(contact)) body.email = contact;   // 邮件中可直接回复
    }
    body['数据集'] = dataset;
    body['页面'] = location.href;
    return fetch(FEEDBACK_CFG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok || j.success === false) throw new Error(j.message || ('HTTP ' + res.status));
        return j;
      });
    });
  }
  function imageOptions(sel, ev, noneLabel) {
    sel.innerHTML = '';
    if (noneLabel) sel.appendChild(new Option(noneLabel, ''));
    (ev && ev.images || []).forEach(function (im, i) {
      var cap = (im.caption || '').trim();
      var n = _('第 {n} 张', { n: i + 1 });
      sel.appendChild(new Option(cap ? _('{label}：{caption}', { label: n, caption: cap.length > 24 ? cap.slice(0, 24) + '…' : cap }) : n, String(i + 1)));
    });
  }
  function imageDesc(ev, n) {
    var im = ev.images[n - 1];
    return '第 ' + n + ' 张（' + im.src + (im.caption ? '，' + im.caption : '') + '）';
  }

  // 反馈弹窗：eventId 为空时是整站反馈
  // imageNo：从图片署名的“联系我们”打开时，预先选好“图片有问题”和第几张图（0 表示不指定哪一张）
  function openFeedback(eventId, imageNo) {
    if (!feedbackOn) return;
    var ev = eventId ? findEvent(eventId) : null;
    fbEventId = ev ? ev.id : null;
    fbForm.reset();
    fbForm.classList.remove('saving', 'saved');
    $('feedbackSend').disabled = false;
    $('feedbackSend').querySelector('.btn-label').textContent = _('发送反馈');
    $('feedbackError').textContent = '';
    $('feedbackTitle').textContent = ev ? _('反馈 / 建议修改') : _('网站反馈');
    $('feedbackTarget').textContent = ev ? (ev.date || formatYear(ev.year)) + ' · ' + ev.title : _('对网站的问题或建议；也可以建议新增事件。');
    var box = $('feedbackKinds');
    box.innerHTML = '';
    (ev ? EVENT_KINDS : SITE_KINDS).forEach(function (k) {
      var lab = el('label', 'kind-option');
      var r = document.createElement('input');
      r.type = 'radio'; r.name = 'kind'; r.value = k;
      lab.appendChild(r);
      lab.appendChild(el('span', null, _(k)));   // 显示译文，发送的值仍是中文（反馈邮件用中文）
      box.appendChild(lab);
    });
    var hasImages = !!(ev && ev.images && ev.images.length);
    imageOptions(fbForm.image, ev, hasImages ? '' : _('（这个事件没有图片）'));
    if (hasImages) fbForm.image.insertBefore(new Option(_('请选择'), ''), fbForm.image.firstChild);
    fbForm.image.value = '';
    $('feedbackImages').hidden = true;
    $('feedbackSuggestEdit').hidden = !ev;
    $('feedbackProposeNew').hidden = !!ev;
    if (ev && imageNo != null) {
      var imgKind = box.querySelector('input[value="图片有问题"]');
      if (imgKind) imgKind.checked = true;
      $('feedbackImages').hidden = false;
      if (imageNo > 0 && hasImages) fbForm.image.value = String(imageNo);
    }
    openModal('feedbackModal');
    setTimeout(function () { var first = box.querySelector('input'); if (first) first.focus(); }, 50);
  }
  fbForm.addEventListener('change', function (e) {
    if (e.target.name === 'kind') $('feedbackImages').hidden = e.target.value !== '图片有问题';
  });
  fbForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (fbForm.classList.contains('saving') || fbForm.classList.contains('saved')) return;
    var ev = fbEventId ? findEvent(fbEventId) : null;
    var kindInput = fbForm.querySelector('input[name="kind"]:checked');
    var kind = kindInput ? kindInput.value : '';
    var message = fbForm.message.value.trim();
    var imageN = parseInt(fbForm.image.value, 10) || 0;
    var imageUrl = fbForm.imageUrl.value.trim();
    var err = '';
    if (!kind) err = _('请选择反馈类型');
    else if (!message) err = _('请填写说明');
    else if (kind === '图片有问题' && imageUrl && !isHttpUrl(imageUrl)) err = _('图片网址必须以 http:// 或 https:// 开头');
    if (err) { $('feedbackError').textContent = err; return; }
    $('feedbackError').textContent = '';
    var fields = { '反馈类型': kind, '说明': message };
    if (ev) {
      fields['事件'] = ev.title;
      fields['事件 id'] = ev.id;
      if (kind === '图片有问题') {
        if (imageN && ev.images && ev.images[imageN - 1]) fields['有问题的图片'] = imageDesc(ev, imageN);
        if (imageUrl) fields['建议的图片网址'] = imageUrl;
      }
    }
    var subject = ev ? '事件反馈（' + kind + '）：' + ev.title : '网站反馈（' + kind + '）';
    submitFeedback(fbForm, $('feedbackSend'), _('发送反馈'), $('feedbackError'), 'feedbackModal',
      sendFeedback(subject, fields, fbForm.contact.value.trim(), fbForm.botcheck.value));
  });
  // 发送中 / 已发送的按钮状态；成功后关闭弹窗并提示，失败时保留填写的内容并显示原因
  function submitFeedback(formEl, btn, label, errBox, modalId, request) {
    formEl.classList.add('saving');
    btn.disabled = true;
    btn.querySelector('.btn-label').textContent = _('发送中…');
    request.then(function () {
      formEl.classList.remove('saving');
      formEl.classList.add('saved');
      btn.querySelector('.btn-label').textContent = _('✓ 已发送');
      setTimeout(function () {
        formEl.classList.remove('saved');
        btn.disabled = false;
        btn.querySelector('.btn-label').textContent = label;
        closeModal(modalId);
        toast(_('已发送，谢谢你的反馈！'));
      }, SAVED_PAUSE);
    }, function (e) {
      formEl.classList.remove('saving');
      btn.disabled = false;
      btn.querySelector('.btn-label').textContent = label;
      errBox.textContent = _('发送失败：{error}。填写的内容仍保留，可以稍后再试。', { error: e.message });
    });
  }
  $('detailFeedback').addEventListener('click', function () { if (detailId) openFeedback(detailId); });
  $('siteFeedback').addEventListener('click', function () { openFeedback(null); });
  $('feedbackSuggestEdit').addEventListener('click', function () {
    var id = fbEventId;
    closeModal('feedbackModal');
    openEditor(id, 'suggest');
  });
  $('feedbackProposeNew').addEventListener('click', function () {
    closeModal('feedbackModal');
    openEditor(null, 'propose');
  });

  // 编辑页的建议模式：填写图片相关的选项，说明在建议修改时必填、建议新增时选填
  function fillSuggestFields(ev) {
    imageOptions(form.suggestImage, ev, _('无'));
    $('suggestImageField').hidden = !(ev && ev.images && ev.images.length);
    form.suggestImageUrl.value = '';
    form.suggestNote.value = '';
    form.suggestContact.value = '';
    form.botcheck.value = '';
    $('suggestNoteLabel').innerHTML = suggestMode === 'suggest' ? _('修改说明') + ' <em>*</em>' : _('补充说明（可选）');
  }
  // 建议修改涉及的字段：编辑页中的当前值（与数据中的写法一致，便于比较）
  var SUGGEST_FIELDS = [
    { key: 'title', label: '事件名称' },
    { key: 'year', label: '年份' },
    { key: 'date', label: '时间显示' },
    { key: 'short', label: '简要说明' },
    { key: 'detail', label: '详细说明' },
    { key: 'type', label: '事件类型' },
    { key: 'sources', label: '参考链接' }
  ];
  function suggestValues() {
    var yAbs = parseInt(form.yearAbs.value, 10);
    return {
      title: form.title.value.trim(),
      year: yAbs > 0 ? (form.era.value === 'bce' ? -yAbs : yAbs) : null,
      date: form.date.value.trim(),
      short: form.short.value.trim(),
      detail: form.detail.value.trim(),
      type: form.type.value,
      sources: cleanSources()
    };
  }
  function baseValues(ev) {
    return {
      title: ev.title || '', year: ev.year, date: ev.date || '', short: ev.short || '', detail: ev.detail || '',
      type: ev.type || '', sources: sourcesOf(ev).map(function (s) { return s.title ? { url: s.url, title: s.title } : { url: s.url }; })
    };
  }
  function showValue(key, v) {
    if (key === 'year') return v == null ? '' : formatYear(v);
    if (key === 'type') return v || '未分类';
    if (key === 'sources') return v.map(function (s) { return (s.title ? s.title + ' ' : '') + s.url; }).join('\n') || '（无）';
    return v || '（空）';
  }
  // 只列出改动的字段：[{ field, label, before, after }]
  function suggestChanges(ev, now) {
    var base = baseValues(ev);
    return SUGGEST_FIELDS.filter(function (f) {
      return JSON.stringify(base[f.key]) !== JSON.stringify(now[f.key]);
    }).map(function (f) {
      return { field: f.key, label: f.label, before: showValue(f.key, base[f.key]), after: showValue(f.key, now[f.key]) };
    });
  }
  function submitSuggestion() {
    var now = suggestValues();
    var note = form.suggestNote.value.trim();
    var imageUrl = form.suggestImageUrl.value.trim();
    var ev = suggestBase;
    var imageN = parseInt(form.suggestImage.value, 10) || 0;
    var err = sourcesError();
    if (!err && imageUrl && !isHttpUrl(imageUrl)) err = _('图片网址必须以 http:// 或 https:// 开头');
    var changes = [];
    if (!err && suggestMode === 'suggest') {
      changes = suggestChanges(ev, now);
      if (!changes.length && !imageN && !imageUrl) err = _('还没有修改任何内容');
      else if (now.year == null) err = _('请填写有效的年份（正整数）');
      else if (!note) err = _('请填写修改说明');
    } else if (!err) {
      if (!now.title) err = _('请填写事件名称');
      else if (now.year == null) err = _('请填写有效的年份（正整数）');
    }
    if (err) { $('formError').textContent = err; return; }
    $('formError').textContent = '';
    var fields, subject;
    if (suggestMode === 'suggest') {
      subject = '建议修改：' + ev.title;
      fields = { '反馈类型': '建议修改', '事件': ev.title, '事件 id': ev.id, '说明': note };
      if (changes.length) {
        fields['修改内容'] = changes.map(function (c) { return '【' + c.label + '】\n改前：' + c.before + '\n改后：' + c.after; }).join('\n\n');
        fields['修改内容（JSON）'] = JSON.stringify(changes);
      }
      if (imageN) fields['有问题的图片'] = imageDesc(ev, imageN);
    } else {
      subject = '建议新增事件：' + now.title;
      fields = { '反馈类型': '建议新增事件', '说明': note };
      fields['建议的事件'] = SUGGEST_FIELDS.map(function (f) {
        var v = now[f.key];
        if (f.key === 'year') return '【年份】' + showValue('year', v);
        if (f.key === 'sources' ? !v.length : !v) return '';
        return '【' + f.label + '】' + showValue(f.key, v);
      }).filter(Boolean).join('\n');
      fields['建议的事件（JSON）'] = JSON.stringify(now);
    }
    if (imageUrl) fields['建议的图片网址'] = imageUrl;
    setSaveState('saving');
    sendFeedback(subject, fields, form.suggestContact.value.trim(), form.botcheck.value).then(function () {
      setSaveState('saved');
      setTimeout(function () {
        setSaveState(null);
        closeModal('editModal');
        toast(_('建议已提交，谢谢！'));
      }, SAVED_PAUSE);
    }, function (e) {
      setSaveState(null);
      $('formError').textContent = _('提交失败：{error}。填写的内容仍保留，可以稍后再试。', { error: e.message });
    });
  }

  // ---------- 侧栏 ----------
  var sidebarOpen = false;
  var activeListId = null;
  function openSidebar() {
    var wasOpen = sidebarOpen;
    sidebarOpen = true;
    renderList();
    $('sidebarScrim').hidden = false;
    $('sidebar').classList.add('open');
    $('sidebar').setAttribute('aria-hidden', 'false');
    var a = $('eventList').querySelector('.active');
    if (a) a.scrollIntoView({ block: 'center' });
    if (!wasOpen) onLayerOpened('browse');
  }
  function closeSidebar() {
    var wasOpen = sidebarOpen;
    sidebarOpen = false;
    $('sidebarScrim').hidden = true;
    $('sidebar').classList.remove('open');
    $('sidebar').setAttribute('aria-hidden', 'true');
    if (wasOpen) onLayerClosed('browse');
  }
  $('browseBtn').addEventListener('click', openSidebar);
  $('closeSidebar').addEventListener('click', closeSidebar);
  $('sidebarScrim').addEventListener('click', closeSidebar);
  $('searchInput').addEventListener('input', function () { renderList(); syncUrl(false); });

  // ---------- 通用多选下拉列表 ----------
  // options: [{ value, label, color, count }]；selected: 已选 value 数组；onChange(新数组)。
  // 每个选项带颜色色条；已选项以彩色小标签显示在按钮上。Esc、点击列表外或再次点击按钮收起。
  function multiSelect(name, options, selected, onChange, placeholder) {
    var wrap = el('div', 'ms');
    wrap.dataset.name = name;
    var trigger = el('button', 'ms-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    var menu = el('div', 'ms-menu');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-multiselectable', 'true');
    menu.hidden = true;
    var byValue = {};
    options.forEach(function (o) { byValue[o.value] = o; });

    function renderTrigger() {
      trigger.innerHTML = '';
      var tags = el('span', 'ms-tags');
      if (!selected.length) tags.appendChild(el('span', 'ms-placeholder', placeholder));
      selected.forEach(function (v) {
        var o = byValue[v];
        if (!o) return;
        var tag = el('span', 'ms-tag', o.label);
        tag.style.setProperty('--chip-color', o.color);
        tags.appendChild(tag);
      });
      trigger.appendChild(tags);
      trigger.appendChild(el('span', 'ms-caret', '▾'));
    }
    function setOpen(open) {
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      wrap.classList.toggle('open', open);
    }
    var items = options.map(function (o) {
      var item = el('button', 'ms-option');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.dataset.value = o.value;
      item.style.setProperty('--chip-color', o.color);
      item.appendChild(el('span', 'ms-check'));
      item.appendChild(el('span', 'ms-swatch'));
      item.appendChild(el('span', 'ms-label', o.label));
      if (o.count != null) item.appendChild(el('span', 'ms-count', String(o.count)));
      item.addEventListener('click', function () {
        var i = selected.indexOf(o.value);
        selected = i > -1 ? selected.slice(0, i).concat(selected.slice(i + 1)) : selected.concat([o.value]);
        sync();
        onChange(selected);
      });
      menu.appendChild(item);
      return item;
    });
    function sync() {
      items.forEach(function (item) {
        var on = selected.indexOf(item.dataset.value) > -1;
        item.classList.toggle('on', on);
        item.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderTrigger();
    }
    trigger.addEventListener('click', function () { setOpen(menu.hidden); });
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) {
        e.stopPropagation();   // 只收起列表，不关闭侧栏
        setOpen(false);
        trigger.focus();
      }
    });
    wrap.closeMenu = function () { setOpen(false); };
    sync();
    wrap.appendChild(trigger);
    wrap.appendChild(menu);
    return wrap;
  }
  // 点击下拉列表以外的地方时收起所有已展开的列表。
  // 用 click 而不是 pointerdown：等这次点击完成后再收起，避免列表收起引起的布局移动让点击落到别处
  document.addEventListener('click', function (e) {
    Array.prototype.forEach.call(document.querySelectorAll('.ms.open'), function (w) {
      if (!w.contains(e.target)) w.closeMenu();
    });
  });

  // 通用开关型筛选（勾选框）
  function toggleFilterUI(id, text) {
    return function (box, v, set) {
      var label = el('label', 'filter-check');
      var cb = el('input');
      cb.type = 'checkbox';
      cb.checked = v;
      cb.dataset.filter = id;
      cb.addEventListener('change', function () { set(cb.checked); });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + text));
      box.appendChild(label);
    };
  }

  // ---------- 侧栏筛选 ----------
  // 通用筛选框架：每个筛选维度是 FILTERS 中的一条定义，可选项在运行时由数据计算
  // （时期来自数据集的 eras，年份范围来自事件）。新增维度只需添加一条定义：
  //   available(ctx)          数据中是否有可筛选的内容，没有则不显示该维度
  //   initial()               初始（不筛选）的值
  //   isActive(v)             该值是否正在筛选
  //   test(ev, v, ctx)        事件是否符合
  //   render(box, v, set, ctx) 生成界面；调用 set(新值) 更新筛选
  //   kind                    控件类型：toggle（勾选框）、select（下拉多选）、range（范围输入）
  //   toParams(v, out)         把筛选值写成网址参数（向 out 追加 [名称, 值]；不筛选时不写）
  //   fromParams(params)       从网址参数（URLSearchParams）读回筛选值；无效的值忽略
  // ctx 为 filterContext() 的结果：事件、时期、各时期的事件数、年份范围等。
  // 面板中同类型的控件排在一起，按 FILTER_KIND_ORDER 的顺序（勾选框在最前）；同类型内保持下面的定义顺序。
  var FILTER_KIND_ORDER = ['toggle', 'select', 'range'];
  var FILTERS = [
    {
      id: 'major',
      kind: 'toggle',
      toParams: function (v, out) { if (v) out.push(['major', '1']); },
      fromParams: function (p) { return p.get('major') === '1'; },
      label: _('重大事件'),
      available: function (ctx) { return ctx.majorCount > 0; },
      initial: function () { return false; },
      isActive: function (v) { return v; },
      test: function (ev, v) { return !v || isMajor(ev); },
      render: function (box, v, set, ctx) { toggleFilterUI('major', _('只看重大事件（{n}）', { n: ctx.majorCount }))(box, v, set); }
    },
    {
      id: 'type',
      kind: 'select',
      // 网址中使用类型的 key（如 war），与语言无关；“未分类”写作 none
      toParams: function (v, out) { if (v.length) out.push(['type', v.map(typeParamOf)]); },
      fromParams: function (p) { return listParam(p, 'type').map(typeNameOfParam).filter(function (x) { return x != null; }); },
      label: _('事件类型（可多选）'),
      available: function (ctx) { return ctx.typesWithEvents.some(function (t) { return t.name; }); },   // 至少有一个事件有类型
      initial: function () { return []; },
      isActive: function (v) { return v.length > 0; },
      test: function (ev, v) { return !v.length || v.indexOf(ev.type || '') > -1; },
      render: function (box, v, set, ctx) {
        box.appendChild(multiSelect('type', ctx.typesWithEvents.map(function (t) {
          return { value: t.name, label: t.label || t.name, color: t.color, count: ctx.typeCounts[t.name] };
        }), v, set, _('全部类型')));
      }
    },
    {
      id: 'transition',
      kind: 'toggle',
      toParams: function (v, out) { if (v) out.push(['transition', '1']); },
      fromParams: function (p) { return p.get('transition') === '1'; },
      label: _('时期更迭'),
      available: function (ctx) { return ctx.transitionCount > 0; },
      initial: function () { return false; },
      isActive: function (v) { return v; },
      test: function (ev, v) { return !v || !!ev.transition; },
      render: function (box, v, set, ctx) { toggleFilterUI('transition', _('只看时期更迭的事件（{n}）', { n: ctx.transitionCount }))(box, v, set); }
    },
    {
      id: 'era',
      kind: 'select',
      toParams: function (v, out) { if (v.length) out.push(['era', v]); },
      fromParams: function (p) { return listParam(p, 'era').filter(function (n) { return ERAS.some(function (e) { return e.name === n; }); }); },
      label: _('朝代 / 时期（可多选）'),
      available: function (ctx) { return ctx.erasWithEvents.length > 0; },
      initial: function () { return []; },
      isActive: function (v) { return v.length > 0; },
      test: function (ev, v) { return !v.length || v.indexOf(eraOf(ev.year).name) > -1; },
      render: function (box, v, set, ctx) {
        box.appendChild(multiSelect('era', ctx.erasWithEvents.map(function (era) {
          return { value: era.name, label: era.name, color: era.color, count: ctx.eraCounts[era.name] };
        }), v, set, _('全部朝代 / 时期')));
      }
    },
    {
      id: 'range',
      kind: 'range',
      toParams: function (v, out) {
        if (v.from != null) out.push(['from', String(v.from)]);
        if (v.to != null) out.push(['to', String(v.to)]);
      },
      fromParams: function (p) {
        var num = function (k) { var n = parseInt(p.get(k), 10); return isFinite(n) && n !== 0 ? n : null; };
        return { from: num('from'), to: num('to') };
      },
      label: _('时间范围'),
      available: function (ctx) { return ctx.events.length > 1; },
      initial: function () { return { from: null, to: null }; },
      isActive: function (v) { return v.from != null || v.to != null; },
      test: function (ev, v) {
        return (v.from == null || ev.year >= v.from) && (v.to == null || ev.year <= v.to);
      },
      render: function (box, v, set, ctx) {
        var warn = el('p', 'filter-warn');
        warn.hidden = true;
        // 一个年份输入：纪年（公元前 / 公元）+ 年数，留空表示不限
        var yearInput = function (key, prefix, bound) {
          var row = el('div', 'filter-year');
          row.appendChild(el('span', 'filter-year-label', prefix));
          var era = el('select');
          era.dataset.range = key + '-era';
          era.appendChild(new Option(_('公元前'), 'bce'));
          era.appendChild(new Option(_('公元'), 'ce'));
          var num = el('input');
          num.type = 'number';
          num.min = '1';
          num.step = '1';
          num.dataset.range = key;
          num.placeholder = String(Math.abs(bound));
          var cur = v[key];
          era.value = (cur != null ? cur : bound) < 0 ? 'bce' : 'ce';
          if (cur != null) num.value = String(Math.abs(cur));
          var update = function () {
            var n = parseInt(num.value, 10);
            var next = {};
            next[key] = n > 0 ? (era.value === 'bce' ? -n : n) : null;
            v = Object.assign({}, v, next);
            warn.hidden = !(v.from != null && v.to != null && v.from > v.to);
            warn.textContent = _('起始年份晚于结束年份，没有符合的事件');
            set(v);
          };
          num.addEventListener('input', update);
          era.addEventListener('change', update);
          row.appendChild(era);
          row.appendChild(num);
          if (_('年')) row.appendChild(el('span', 'filter-year-label', _('年')));
          return row;
        };
        box.appendChild(yearInput('from', _('从'), ctx.minYear));
        box.appendChild(yearInput('to', _('到'), ctx.maxYear));
        box.appendChild(el('p', 'filter-hint', _('数据范围：{from} — {to}；留空表示不限', { from: formatYear(ctx.minYear), to: formatYear(ctx.maxYear) })));
        box.appendChild(warn);
      }
    }
  ];
  var filterState = {};
  FILTERS.forEach(function (f) { filterState[f.id] = f.initial(); });

  // 由当前数据计算各筛选维度的可选项
  function filterContext() {
    var eraCounts = {};
    events.forEach(function (ev) {
      var name = eraOf(ev.year).name;
      eraCounts[name] = (eraCounts[name] || 0) + 1;
    });
    var typeCounts = {};
    events.forEach(function (ev) { typeCounts[ev.type || ''] = (typeCounts[ev.type || ''] || 0) + 1; });
    var years = events.map(function (ev) { return ev.year; });
    return {
      events: events,
      eras: ERAS,
      eraCounts: eraCounts,
      erasWithEvents: ERAS.filter(function (era) { return eraCounts[era.name] > 0; }),
      majorCount: events.filter(isMajor).length,
      typeCounts: typeCounts,
      typesWithEvents: typesWithEvents(typeCounts),
      transitionCount: events.filter(function (ev) { return ev.transition; }).length,
      minYear: years.length ? Math.min.apply(null, years) : 0,
      maxYear: years.length ? Math.max.apply(null, years) : 0
    };
  }
  function activeFilters(ctx) {
    return FILTERS.filter(function (f) { return f.available(ctx) && f.isActive(filterState[f.id]); });
  }

  // 数据变化（新增、删除、修改年份或重大事件标记、恢复默认）时才重建筛选面板，
  // 输入筛选条件时只刷新列表，避免输入框失去焦点
  // 按控件类型分组排序（稳定排序：同类型内保持定义顺序）
  function filtersByKind() {
    return FILTERS.map(function (f, i) { return { f: f, i: i }; }).sort(function (a, b) {
      return (FILTER_KIND_ORDER.indexOf(a.f.kind) - FILTER_KIND_ORDER.indexOf(b.f.kind)) || (a.i - b.i);
    }).map(function (x) { return x.f; });
  }
  var filterPanelKey = null;
  function renderFilterPanel(ctx) {
    var key = events.map(function (ev) { return ev.year + (isMajor(ev) ? '*' : '') + (ev.transition ? '>' : '') + '#' + (ev.type || ''); }).join(',');
    if (key === filterPanelKey) return;
    filterPanelKey = key;
    var panel = $('filterPanel');
    panel.innerHTML = '';
    filtersByKind().forEach(function (f) {
      if (!f.available(ctx)) return;
      var section = el('section', 'filter-section');
      section.dataset.filter = f.id;
      section.dataset.kind = f.kind;
      section.appendChild(el('h3', 'filter-title', f.label));
      f.render(section, filterState[f.id], function (value) {
        filterState[f.id] = value;
        syncUrl(false);
        renderList();
      }, ctx);
      panel.appendChild(section);
    });
    var clear = el('button', 'btn btn-ghost btn-small filter-clear', _('清除筛选'));
    clear.type = 'button';
    clear.id = 'filterClear';
    clear.addEventListener('click', function () {
      FILTERS.forEach(function (f) { filterState[f.id] = f.initial(); });
      filterPanelKey = null;   // 重建面板，使输入框恢复初始状态
      renderList();
    });
    panel.appendChild(clear);
  }
  $('filterToggle').addEventListener('click', function () {
    var panel = $('filterPanel');
    panel.hidden = !panel.hidden;
    this.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
  });

  function renderList() {
    var q = $('searchInput').value.trim().toLowerCase();
    var ctx = filterContext();
    renderFilterPanel(ctx);
    var active = activeFilters(ctx);
    var list = sorted().filter(function (ev) {
      if (q && [ev.title, ev.short, ev.detail, ev.date, formatYear(ev.year)].join(' ').toLowerCase().indexOf(q) === -1) return false;
      return active.every(function (f) { return f.test(ev, filterState[f.id], ctx); });
    });
    var narrowed = q || active.length;
    $('eventCount').textContent = narrowed ? _('（{n} / {total}）', { n: list.length, total: events.length }) : _('（{total}）', { total: events.length });
    $('filterBadge').hidden = !active.length;
    $('filterBadge').textContent = active.length ? String(active.length) : '';
    $('filterToggle').classList.toggle('on', active.length > 0);
    if ($('filterClear')) $('filterClear').disabled = !active.length;
    var ol = $('eventList');
    ol.innerHTML = '';
    if (!list.length) {
      ol.appendChild(el('li', 'list-empty', narrowed ? _('没有符合条件的事件') : _('暂无事件，点击右下角“+”添加')));
      return;
    }
    list.forEach(function (ev) {
      var li = el('li', 'list-item' + (ev.id === activeListId ? ' active' : ''));
      var row = el('button', 'list-row');
      row.type = 'button';
      row.appendChild(imageEl(ev.images && ev.images[0], 'list-thumb', ev.title));
      var meta = el('div', 'list-meta');
      var dateLine = el('div', 'list-date', ev.date || formatYear(ev.year));
      if (ev.type) {
        var lt = el('span', 'list-type', ev.type);
        lt.style.setProperty('--chip-color', typeInfo(ev.type).color);
        dateLine.appendChild(lt);
      }
      meta.appendChild(dateLine);
      meta.appendChild(el('div', 'list-title', ev.title));
      if (ev.transition) meta.appendChild(el('div', 'list-transition', transitionText(ev.transition)));
      row.appendChild(meta);
      row.addEventListener('click', function () {
        activeListId = activeListId === ev.id ? null : ev.id;
        renderList();
        if (activeListId) focusEvent(ev.id);
      });
      li.appendChild(row);
      if (ev.id === activeListId) {
        // 按钮在事件右侧：第一行“查看详情”，第二行“编辑”“删除”（调试模式）
        li.classList.add('has-actions');
        var acts = el('div', 'list-actions');
        var v = el('button', 'btn btn-ghost btn-small', _('查看详情'));
        v.type = 'button';
        v.addEventListener('click', function () { openDetail(ev.id); });
        var ed = el('button', 'btn btn-primary btn-small', _('编辑'));
        ed.type = 'button';
        ed.addEventListener('click', function () { openEditor(ev.id); });
        var del = el('button', 'btn btn-danger btn-small', _('删除'));
        del.type = 'button';
        del.addEventListener('click', function () { askDelete(ev.id); });
        var editRow = el('div', 'list-actions-edit debug-only');
        editRow.appendChild(ed); editRow.appendChild(del);
        acts.appendChild(v); acts.appendChild(editRow);
        li.appendChild(acts);
      }
      ol.appendChild(li);
    });
  }

  $('resetBtn').addEventListener('click', function () {
    confirmDialog(_('恢复默认数据将清除你做的所有添加、修改和删除，确定吗？'), function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
      events = clone(defaultEvents);
      activeListId = null;
      renderTimeline();
      renderList();
      toast(_('已恢复默认数据'));
    });
  });

  // ---------- 显示 / 隐藏工具栏（默认显示） ----------
  var barsBtn = $('barsToggle');
  function setBarsHidden(hidden) {
    document.body.classList.toggle('bars-hidden', hidden);
    var label = hidden ? _('显示工具栏') : _('隐藏工具栏');
    barsBtn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    barsBtn.setAttribute('aria-label', label);
    barsBtn.title = _('{label}（H）', { label: label });
    if (hidden && sidebarOpen) closeSidebar();
    scheduleRelayout(true);
  }
  barsBtn.addEventListener('click', function () {
    setBarsHidden(!document.body.classList.contains('bars-hidden'));
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key !== 'h' && e.key !== 'H') || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (openStack.length || !$('lightbox').hidden) return;
    setBarsHidden(!document.body.classList.contains('bars-hidden'));
  });

  // ---------- 下拉刷新（触屏设备） ----------
  // 页面本身不滚动（浏览器自带的下拉刷新因此不可用，CSS 中也关闭了它以免重复触发），这里自己实现：
  // 手指向下拉（竖直方向明显大于水平方向，横向拖动时间轴不受影响）超过阈值后松开即刷新。
  // 侧栏、弹窗、图片查看器打开时，或在可滚动且未滚到顶部的区域内，不触发。
  var PTR_THRESHOLD = 70;   // 提示条下移的距离（px）达到该值后松开即刷新
  var ptr = { state: null, x: 0, y: 0, dist: 0 };
  var ptrEl = $('ptr');
  function ptrBlocked(target) {
    if (openStack.length || sidebarOpen || !$('lightbox').hidden) return true;
    for (var n = target; n && n !== document.body; n = n.parentElement) {
      if (n.scrollTop > 0) return true;
    }
    return false;
  }
  function ptrShow(dist) {
    var ready = dist >= PTR_THRESHOLD;
    ptrEl.style.transform = 'translate(-50%, ' + (dist - 48) + 'px)';
    ptrEl.style.opacity = String(Math.min(1, dist / 40));
    ptrEl.classList.toggle('ready', ready);
    ptrEl.querySelector('.ptr-text').textContent = ready ? _('释放刷新') : _('下拉刷新');
  }
  function ptrReset() {
    ptr.state = null;
    ptrEl.classList.remove('pulling', 'ready');
    ptrEl.style.transform = '';
    ptrEl.style.opacity = '';
  }
  document.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1 || ptr.state === 'refreshing' || ptrBlocked(e.target)) { ptr.state = null; return; }
    ptr.state = 'maybe';
    ptr.x = e.touches[0].clientX;
    ptr.y = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!ptr.state || ptr.state === 'refreshing' || e.touches.length !== 1) return;
    var dx = e.touches[0].clientX - ptr.x, dy = e.touches[0].clientY - ptr.y;
    if (ptr.state === 'maybe') {
      if (Math.abs(dx) > 10 && Math.abs(dx) >= dy) { ptr.state = null; return; }   // 横向拖动时间轴
      if (dy < 12 || dy < Math.abs(dx) * 1.5) return;
      ptr.state = 'pulling';
      ptrEl.classList.add('pulling');
    }
    ptr.dist = Math.min(110, Math.max(0, dy) * 0.55);   // 阻尼：手指移动越远，提示条移动越慢
    ptrShow(ptr.dist);
  }, { passive: true });
  function ptrEnd() {
    if (ptr.state !== 'pulling') { if (ptr.state !== 'refreshing') ptr.state = null; return; }
    if (ptr.dist >= PTR_THRESHOLD) {
      ptr.state = 'refreshing';
      ptrEl.classList.add('refreshing');
      ptrEl.querySelector('.ptr-text').textContent = _('正在刷新…');
      location.reload();
    } else {
      ptrReset();
    }
  }
  document.addEventListener('touchend', ptrEnd);
  document.addEventListener('touchcancel', function () { if (ptr.state !== 'refreshing') ptrReset(); });

  // ---------- 自动播放：时间轴缓缓向右前进 ----------
  // 速度为每 PLAY_SECONDS_PER_SCREEN 秒一屏。播放按钮依次切换：暂停 → 一倍速 → 二倍速 → 暂停，
  // 图标表示点击后的动作（▶ 播放、⏩ 二倍速、⏸ 暂停），二倍速时按钮角上显示“2×”；空格键直接播放 / 暂停。
  // 页面加载后默认以一倍速开始播放；手动浏览（见 stopAnim）时暂停，停止操作 IDLE_RESUME_MS 后以原来的速度自动继续；
  // 用户点暂停或按空格暂停后，本次访问中不再自动继续，直到再次点播放（从一倍速开始）。
  // 打开侧栏、弹窗或图片查看器时原地停住，关闭后继续；到达末端时停止（不自动从头开始），再次播放从头开始。
  // 系统设置了“减少动态效果”时不自动开始。
  var PLAY_SECONDS_PER_SCREEN = 30;
  var IDLE_RESUME_MS = 3000;
  var playing = false, playRaf = null, playLast = 0;
  var userPaused = false;     // 用户手动暂停（本次访问）
  var idleT = null;
  var playSpeed = 1;
  var playBtn = $('playToggle');
  // 自动开始：测试可以通过 window.TIMELINE_AUTOPLAY = false 关闭
  function autoplayAllowed() {
    if (window.TIMELINE_AUTOPLAY === false) return false;
    return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function updatePlayBtn() {
    playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    playBtn.dataset.speed = String(playSpeed);
    var label = !playing ? _('自动播放') : playSpeed === 2 ? _('暂停自动播放（当前二倍速）') : _('切换为二倍速播放');
    playBtn.setAttribute('aria-label', label);
    playBtn.title = label + (playing ? _('（空格暂停）') : _('（空格）'));
  }
  function setPlaying(on, speed) {
    playing = on;
    if (speed) playSpeed = speed;
    updatePlayBtn();
    if (playRaf) cancelAnimationFrame(playRaf);
    playRaf = null;
    if (!on) return;
    clearTimeout(idleT);
    playLast = performance.now();
    playRaf = requestAnimationFrame(playStep);
  }
  function atEnd() { return offset <= minOffset() + 0.5; }
  function playStep(now) {
    var dt = Math.min(100, now - playLast);   // 切到后台再回来时不会突然跳很远
    playLast = now;
    var held = openStack.length || sidebarOpen || !$('lightbox').hidden || drag.active;
    if (!held) {
      if (atEnd()) { setPlaying(false); return; }
      setOffset(offset - viewW() / PLAY_SECONDS_PER_SCREEN * playSpeed * dt / 1000);
    }
    playRaf = requestAnimationFrame(playStep);
  }
  // 用户在浏览（拖动、滚轮、按键、点击等）：重新开始计时，停下 IDLE_RESUME_MS 后自动继续播放
  function noteActivity() {
    clearTimeout(idleT);
    idleT = null;
    if (playing || userPaused || !autoplayAllowed()) return;
    idleT = setTimeout(resumeIfIdle, IDLE_RESUME_MS);
  }
  function resumeIfIdle() {
    idleT = null;
    if (playing || userPaused || atEnd()) return;
    // 正在拖动、动画或打开了侧栏 / 弹窗时稍后再试
    if (anim || drag.active || openStack.length || sidebarOpen || !$('lightbox').hidden) { noteActivity(); return; }
    setPlaying(true);
  }
  function pauseByUser() { userPaused = true; clearTimeout(idleT); setPlaying(false); }
  function startByUser() {
    userPaused = false;
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    if (atEnd()) setOffset(0);   // 已在末端：从头开始
    setPlaying(true, 1);
  }
  // 空格：播放 / 暂停
  function togglePlay() { if (playing) pauseByUser(); else startByUser(); }
  // 播放按钮：暂停 → 一倍速 → 二倍速 → 暂停
  playBtn.addEventListener('click', function () {
    if (!playing) startByUser();
    else if (playSpeed === 1) setPlaying(true, 2);
    else pauseByUser();
  });
  // 空格键：播放 / 暂停（焦点在输入框、按钮等控件上或有弹窗时不处理）
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.closest('input, textarea, select, button, a, [contenteditable="true"]'))) return;
    if (openStack.length || sidebarOpen || !$('lightbox').hidden) return;
    e.preventDefault();
    togglePlay();
  });
  // 时间轴上的任何操作都算“在浏览”，重新计时（播放 / 速度按钮本身除外）
  ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'].forEach(function (type) {
    stage.addEventListener(type, function (e) {
      if (type === 'pointermove' && !drag.active) return;
      if (idleT) noteActivity();
    }, { passive: true });
  });

  // ---------- 背景音乐 ----------
  // 每个数据集可以有自己的背景音乐（数据中的 music 字段，见 data/README.md），没有则不显示音乐按钮。
  // 音乐文件较大（约 1.7MB），在页面开始加载时用低优先级的 fetch 在后台下载（不推迟页面的 load 事件，也不占用渲染所需的请求），
  // 下载完成后作为 blob 交给 <audio>，只下载一次；关闭音乐时不下载，开启后才下载。
  // 下载完成后立即尝试播放；多数浏览器不允许网页在访问者操作之前发声，被拦截时音乐按钮轻轻闪动提示，
  // 并在访问者第一次点击、按键或触摸页面（任何位置）时开始播放；
  // 音量较小（默认 DEFAULT_MUSIC_VOLUME，数据可指定）。关闭后记住选择（保存在当前浏览器中）
  var MUSIC_KEY = 'zh-history-timeline:music';
  var DEFAULT_MUSIC_VOLUME = 0.2;
  var bgm = $('bgm'), musicBtn = $('musicToggle');
  var musicOn = true;
  function setMusicOn(on, save) {
    musicOn = on;
    musicBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!on) musicBtn.classList.remove('waiting');
    setMusicLabel();
    if (save) { try { localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off'); } catch (e) { /* noop */ } }
    if (!bgm.getAttribute('src')) { if (on) loadMusic(); return; }
    if (on) playMusic(); else bgm.pause();
  }
  var musicSrc = null, musicLoading = false;
  function loadMusic() {
    if (!musicSrc || musicLoading) return;
    musicLoading = true;
    function ready(url) {
      bgm.src = url;
      if (musicOn) playMusic();
    }
    var req;
    try { req = fetch(musicSrc, { priority: 'low' }); } catch (e) { req = Promise.reject(e); }
    req.then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    }).then(function (blob) { ready(URL.createObjectURL(blob)); }, function () {
      ready(musicSrc);   // 下载失败（如离线、file://）时交给 <audio> 自己加载
    });
  }
  function playMusic() {
    if (!bgm.paused) return;
    var p = bgm.play();
    if (p && p.then) {
      p.then(function () { musicBtn.classList.remove('waiting'); setMusicLabel(); }, function () {
        // 被浏览器拦截（iPhone / iPad 和多数浏览器在用户第一次操作页面之前都不允许有声音的自动播放）：
        // 等下一次用户操作再试
        if (musicOn && bgm.paused) { musicBtn.classList.add('waiting'); setMusicLabel(); }
      });
    }
  }
  // 等待用户操作时，按钮的说明改为“轻触开始播放”
  function setMusicLabel() {
    var label = !musicOn ? _('开启背景音乐') : musicBtn.classList.contains('waiting') ? _('开始播放背景音乐') : _('关闭背景音乐');
    musicBtn.setAttribute('aria-label', label);
    musicBtn.title = label;
  }
  // ---------- 背景纹理 ----------
  // 数据集的 texture：{ src: 'textures/<文件名>', size: 平铺单元宽度（像素，默认为图片本身大小）, opacity: 0–0.3 }。
  // 每个国家 / 语言的数据集可以配置各自的纹理；没有时不显示。
  var DEFAULT_TEXTURE_OPACITY = 0.06;
  function setupTexture(texture) {
    var layer = $('bgTexture');
    if (!texture || !texture.src) { layer.hidden = true; return; }
    var img = 'url("' + texture.src + '")';
    var size = texture.size > 0 ? texture.size + 'px auto' : 'auto';
    layer.style.webkitMaskImage = img;
    layer.style.maskImage = img;
    layer.style.webkitMaskSize = size;
    layer.style.maskSize = size;
    var o = Number(texture.opacity);
    layer.style.setProperty('--texture-opacity', String(o >= 0 && o <= 0.3 ? o : DEFAULT_TEXTURE_OPACITY));
    layer.hidden = false;
  }

  function setupMusic(music) {
    if (!music || !music.src) return;
    musicSrc = music.src;
    bgm.setAttribute('data-music', music.src);
    var v = Number(music.volume);
    bgm.volume = v >= 0 && v <= 1 ? v : DEFAULT_MUSIC_VOLUME;
    musicBtn.hidden = false;
    var saved = null;
    try { saved = localStorage.getItem(MUSIC_KEY); } catch (e) { /* noop */ }
    setMusicOn(saved !== 'off', false);   // 开启状态下开始后台下载，下载完成后尝试播放
  }
  musicBtn.addEventListener('click', function () {
    // 被拦截、正在等待时点音乐按钮：开始播放（按钮在闪动提示点它），而不是关闭
    if (musicOn && bgm.paused && musicBtn.classList.contains('waiting')) { playMusic(); return; }
    setMusicOn(!musicOn, true);
  });
  // 被拦截后，用户在页面任何位置操作时开始播放（点击音乐按钮本身除外，由上面处理）。
  // 浏览器只把部分事件算作“用户操作”：触屏上是手指抬起（touchend / pointerup / click），而不是按下，
  // 鼠标是按下（mousedown / pointerdown），键盘是 keydown。每个事件都尝试一次，上一次被拒绝的尝试不影响下一次。
  ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'click', 'keydown'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (!musicOn || !bgm.paused || !bgm.getAttribute('src')) return;
      if (e.target && e.target.closest && e.target.closest('#musicToggle')) return;
      playMusic();
    }, { capture: true, passive: true });
  });

  // ---------- 深色模式 ----------
  // 默认浅色（日间）；点击右上角按钮切换并保存选择。<html data-theme> 由 index.html 中的脚本在绘制前设置
  var THEME_KEY = 'zh-history-timeline:theme';
  var themeBtn = $('themeToggle');
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var label = theme === 'dark' ? _('切换到浅色模式') : _('切换到深色模式');
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
    $('moreThemeText').textContent = theme === 'dark' ? _('浅色模式') : _('深色模式');
  }
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  themeBtn.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 只在本次访问中生效 */ }
  });

  // ---------- 关于本站、手机“更多”菜单 ----------
  // 电脑上右上角的 ⓘ 按钮打开“关于本站”；手机上（≤640px）深色模式、分享、关于收进“更多”菜单（样式见 CSS 自适应部分）
  $('aboutBtn').addEventListener('click', openAbout);
  $('aboutFeedback').addEventListener('click', function () { closeModal('aboutModal'); openFeedback(null); });
  function openAbout() { updateAbout(); openModal('aboutModal'); }
  // 关于页中由数据决定的部分：事件数量、背景音乐来源（数据集的 music.title / music.credit，没有时不显示）
  function updateAbout() {
    $('aboutSummary').textContent = _('目前收录 {n} 个事件，', { n: events.length });
    var m = meta && meta.music, credit = m && [m.title, m.credit].filter(Boolean).join(_('，'));
    $('aboutMusic').textContent = credit ? _('背景音乐：{credit}。', { credit: credit }) : '';
    $('aboutMusicHead').hidden = !credit;
  }
  var moreBtn = $('moreBtn'), moreMenu = $('moreMenu');
  function setMoreOpen(open) {
    moreMenu.hidden = !open;
    moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  moreBtn.addEventListener('click', function () { setMoreOpen(moreMenu.hidden); });
  document.addEventListener('pointerdown', function (e) {
    if (!moreMenu.hidden && !e.target.closest('.more-wrap')) setMoreOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || moreMenu.hidden) return;
    e.stopImmediatePropagation();
    setMoreOpen(false);
    moreBtn.focus();
  }, true);
  $('moreAbout').addEventListener('click', function () { setMoreOpen(false); openAbout(); });
  $('moreTheme').addEventListener('click', function () { setMoreOpen(false); themeBtn.click(); });
  $('moreShare').addEventListener('click', function () { setMoreOpen(false); $('shareTimeline').click(); });

  // ---------- 切换语言 ----------
  // 换成同一国家另一种语言的数据集（cn_zh → cn_en），语言列表来自 js/i18n/ 中加载的语言；
  // 保留调试模式、打开的事件和时间位置，筛选条件不保留（各语言的取值不同）
  var langBtn = $('langBtn'), langMenu = $('langMenu');
  function langUrl(lang) {
    var target = dataset.split('_')[0] + '_' + lang;
    var params = new URLSearchParams(location.search), out = new URLSearchParams();
    if (target !== DEFAULT_DATASET) out.set('data', target);
    ['debugMode', 'id', 'at', 'browse'].forEach(function (k) { if (params.has(k)) out.set(k, params.get(k)); });
    return location.pathname + (out.toString() ? '?' + out.toString().replace(/=(?=&|$)/g, '') : '') + location.hash;
  }
  function switchLang(lang) {
    if (lang === LANG) return;
    syncUrl();
    location.href = langUrl(lang);
  }
  function setLangOpen(open) {
    langMenu.hidden = !open;
    langBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  $('langName').textContent = LOCALE.name || LANG;
  Object.keys(I18N).forEach(function (lang) {
    var name = I18N[lang].name || lang;
    var item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', lang === LANG ? 'true' : 'false');
    item.dataset.lang = lang;
    item.innerHTML = '<span></span><span class="lang-check" aria-hidden="true">✓</span>';
    item.firstChild.textContent = name;
    item.addEventListener('click', function () { setLangOpen(false); switchLang(lang); });
    langMenu.appendChild(item);
    var seg = document.createElement('button');
    seg.type = 'button';
    seg.setAttribute('role', 'radio');
    seg.setAttribute('aria-checked', lang === LANG ? 'true' : 'false');
    seg.dataset.lang = lang;
    seg.textContent = I18N[lang].shortName || name;
    seg.addEventListener('click', function () { setMoreOpen(false); switchLang(lang); });
    $('langSeg').appendChild(seg);
  });
  langBtn.addEventListener('click', function () { setLangOpen(langMenu.hidden); });
  document.addEventListener('pointerdown', function (e) {
    if (!langMenu.hidden && !e.target.closest('.lang-wrap')) setLangOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || langMenu.hidden) return;
    e.stopImmediatePropagation();
    setLangOpen(false);
    langBtn.focus();
  }, true);

  // ---------- 首次访问提示 ----------
  // 第一次打开网站时提示怎么用，只提示一次（记在当前浏览器中）：
  // 电脑上是分步指引（聚光灯依次指向时间轴、卡片、“浏览所有历史事件”按钮，可以回到上一步），打开期间自动播放停住；
  // 手机上（≤640px）是底部的气泡，不挡时间轴，点“知道了”、点别处或滑动时间轴时收起。
  // 通过分享链接直接打开详情等情况下不提示（下次访问再提示）。测试可以通过 window.TIMELINE_ONBOARDING = false 关闭
  var ONBOARD_KEY = 'zh-history-timeline:onboarded';
  var narrowScreen = window.matchMedia('(max-width: 640px)');
  function maybeShowOnboarding() {
    if (window.TIMELINE_ONBOARDING === false) return;
    try { if (localStorage.getItem(ONBOARD_KEY)) return; } catch (e) { return; }   // 无法记住时不提示，免得每次都出现
    if (openStack.length || sidebarOpen || !$('lightbox').hidden || document.body.classList.contains('bars-hidden')) return;
    try { localStorage.setItem(ONBOARD_KEY, '1'); } catch (e) { /* noop */ }
    if (narrowScreen.matches) showHint(); else startTour();
  }

  // 分步指引
  var TOUR_STEPS = [
    { text: _('<b>左右拖动</b>时间轴浏览，也可以用方向键或滚轮；右上角 ▶ 可以自动播放。'), target: function () {
      var st = stage.getBoundingClientRect(), ax = $('axis').getBoundingClientRect();
      return { left: st.left + 16, top: ax.top - 30, width: st.width - 32, height: ax.height + 60 };
    } },
    { text: _('<b>点卡片</b>看事件详情、图片和参考资料。'), target: function () {
      var st = stage.getBoundingClientRect();
      var cards = Array.prototype.filter.call(document.querySelectorAll('#events .card'), function (c) {
        var r = c.getBoundingClientRect();
        return r.width && r.left >= st.left + 8 && r.right <= st.right - 8 && r.top >= st.top && r.bottom <= st.bottom;
      });
      var c = cards[0] || document.querySelector('#events .card');
      return c && c.getBoundingClientRect();
    } },
    { text: _('点<b>“浏览所有历史事件”</b>可以搜索全部事件，并按类型、年代筛选。'), target: function () { return $('browseBtn').getBoundingClientRect(); } },
  ];
  var tour = { open: false, step: 0 };
  function startTour() {
    tour.step = 0;
    tour.open = true;
    $('tourDots').innerHTML = TOUR_STEPS.map(function () { return '<i></i>'; }).join('');
    openModal('tour');
    showTourStep();
  }
  function showTourStep() {
    var last = tour.step === TOUR_STEPS.length - 1;
    $('tourStep').textContent = (tour.step + 1) + ' / ' + TOUR_STEPS.length;
    $('tourText').innerHTML = TOUR_STEPS[tour.step].text;
    $('tourNext').textContent = last ? _('开始浏览') : _('下一步');
    $('tourSkip').hidden = last;
    $('tourPrev').hidden = tour.step === 0;
    Array.prototype.forEach.call($('tourDots').children, function (d, i) { d.classList.toggle('on', i === tour.step); });
    placeTour();
    $('tourNext').focus({ preventScroll: true });
  }
  function placeTour() {
    if (!tour.open || $('tour').hidden) return;
    var r = TOUR_STEPS[tour.step].target();
    if (!r) return;
    var pad = 6, spot = $('tourSpot'), tip = $('tourTip');
    spot.style.left = (r.left - pad) + 'px';
    spot.style.top = (r.top - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';
    var vw = window.innerWidth, vh = window.innerHeight, tw = tip.offsetWidth, th = tip.offsetHeight, gap = 14;
    var top = r.top + r.height + pad + gap;
    if (top + th > vh - 8) top = Math.max(8, r.top - pad - gap - th);   // 下方放不下时放在上方
    tip.style.left = Math.min(Math.max(16, r.left), vw - tw - 16) + 'px';
    tip.style.top = top + 'px';
  }
  function closeTour() { tour.open = false; closeModal('tour'); }
  function tourNext() {
    if (tour.step >= TOUR_STEPS.length - 1) { closeTour(); return; }
    tour.step++;
    showTourStep();
  }
  $('tourNext').addEventListener('click', tourNext);
  function tourPrev() {
    if (tour.step === 0) return;
    tour.step--;
    showTourStep();
  }
  $('tourSkip').addEventListener('click', closeTour);
  $('tourPrev').addEventListener('click', tourPrev);
  window.addEventListener('resize', function () { if (tour.open) placeTour(); });
  // 打开期间：→ / Enter 下一步，← 上一步（不移动时间轴）；Esc 由弹窗通用逻辑关闭
  document.addEventListener('keydown', function (e) {
    if (!tour.open || $('tour').hidden) { tour.open = false; return; }
    if (e.key === 'Escape') { tour.open = false; return; }
    if (e.key === 'Tab') return;
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#tour button')) return;   // 按钮自己处理
    if (e.key === 'ArrowRight' || e.key === 'Enter') tourNext();
    else if (e.key === 'ArrowLeft') tourPrev();
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  // 手机：底部气泡，箭头指向“浏览所有历史事件”按钮
  var hint = $('hintBubble');
  function showHint() {
    hint.hidden = false;
    var b = $('browseBtn').getBoundingClientRect();
    hint.style.setProperty('--hint-arrow-right', Math.max(16, window.innerWidth - 16 - (b.left + b.width / 2) - 8) + 'px');
  }
  function closeHint() { hint.hidden = true; }
  $('hintOk').addEventListener('click', closeHint);
  $('hintClose').addEventListener('click', closeHint);
  document.addEventListener('pointerdown', function (e) {
    if (!hint.hidden && !e.target.closest('#hintBubble')) closeHint();
  }, true);

  // ---------- 调试模式（默认关闭） ----------
  // 开启后在顶栏下方显示网站最近更新时间，并显示全部编辑功能（新增、编辑、删除、恢复默认数据）。
  // 关闭时这些元素带 .debug-only 类被 CSS 隐藏，openEditor / askDelete 也直接返回。
  // 设置保存在当前浏览器中，所有数据集共用。
  var DEBUG_KEY = 'zh-history-timeline:debug';
  var debugMode = false;
  var versionRequest = null;

  // 调试模式只在本地启动时提供（js/env.js，见 server.js）；线上不显示开关，浏览器中保存的开启状态也不起作用
  // 网址带 debugMode 参数（如 ?debugMode 或 ?debugMode=1）时线上也提供；该参数在浏览过程中保留，但不会出现在分享链接里
  var debugParam = (function () {
    var p = new URLSearchParams(location.search);
    return p.has('debugMode') && !/^(0|false|off|no)$/i.test(p.get('debugMode'));
  })();
  var debugAvailable = debugParam || !!(window.TIMELINE_ENV && window.TIMELINE_ENV.debugAvailable);
  document.body.classList.toggle('debug-available', debugAvailable);
  function setDebugMode(on, save) {
    if (!debugAvailable) on = false;
    debugMode = on;
    document.body.classList.toggle('debug-mode', on);
    $('debugToggle').checked = on;
    if (save !== false) try {
      if (on) localStorage.setItem(DEBUG_KEY, '1');
      else localStorage.removeItem(DEBUG_KEY);
    } catch (e) { /* 浏览器禁止存储时只在本次访问中生效 */ }
    if (on) loadVersion();
  }

  // 清除缓存并刷新（调试模式右上角）：网页代码、样式、数据等文件可能还是浏览器缓存的旧版本
  // （GitHub Pages 允许缓存 10 分钟）。先逐个重新下载这些文件（cache: 'reload' 会更新浏览器缓存），
  // 再刷新页面，刷新后用的就是最新版本。编辑保存在浏览器中的修改、设置等不受影响。
  function siteFiles() {
    var urls = [location.href.split('#')[0], 'version.json'];
    document.querySelectorAll('link[rel="stylesheet"][href], script[src]').forEach(function (n) { urls.push(n.href || n.src); });
    if (window.performance && performance.getEntriesByType) {
      performance.getEntriesByType('resource').forEach(function (r) {
        // 图片和音乐体积大、内容不会原地变化（图片按内容命名），不重新下载
        if (/^(link|script|css|fetch|xmlhttprequest|other)$/.test(r.initiatorType)) urls.push(r.name);
      });
    }
    var seen = {};
    return urls.filter(function (u) {
      var url;
      try { url = new URL(u, location.href); } catch (e) { return false; }
      if (url.origin !== location.origin || /\/(images|audio|api)\//.test(url.pathname)) return false;
      url.hash = '';
      if (seen[url.href]) return false;
      return (seen[url.href] = true);
    });
  }
  var clearingCache = false;
  $('clearCacheBtn').addEventListener('click', function () {
    if (clearingCache) return;
    clearingCache = true;
    var btn = $('clearCacheBtn');
    btn.classList.add('busy');
    btn.setAttribute('aria-busy', 'true');
    toast(_('正在清除缓存、获取最新版本…'));
    var jobs = siteFiles().map(function (u) {
      return fetch(u, { cache: 'reload' }).catch(function () { /* 某个文件失败不影响其他文件和刷新 */ });
    });
    // 网站没有使用 Service Worker；以防万一也清除 Cache Storage
    if (window.caches && caches.keys) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }).catch(function () {}));
    }
    Promise.all(jobs).then(function () { location.reload(); });
  });

  // version.json：部署时由 GitHub Actions 生成（每次 push 都会更新）；本地服务器根据 git 最近一次提交生成
  function loadVersion() {
    if (versionRequest) return versionRequest;
    versionRequest = fetch('version.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (v) {
        var when = v && formatTimestamp(v.updatedAt);
        var time = $('debugUpdated');
        time.textContent = when || _('未知');
        if (when) time.setAttribute('datetime', v.updatedAt); else time.removeAttribute('datetime');
        $('debugCommit').textContent = when && v.commit
          ? (v.source === 'local' ? _('版本 {commit}（本地）', { commit: v.commit }) : _('版本 {commit}', { commit: v.commit }))
          : '';
      });
    return versionRequest;
  }
  function formatTimestamp(iso) {
    var d = typeof iso === 'string' ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var off = -d.getTimezoneOffset();
    var tz = 'UTC' + (off >= 0 ? '+' : '-') + Math.floor(Math.abs(off) / 60) + (Math.abs(off) % 60 ? ':' + pad(Math.abs(off) % 60) : '');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + _('（{tz}）', { tz: tz });
  }

  $('debugToggle').addEventListener('change', function (e) { setDebugMode(e.target.checked); });
  (function () {
    var on = false;
    try { on = localStorage.getItem(DEBUG_KEY) === '1'; } catch (e) { /* noop */ }
    setDebugMode(on, false);
  })();

  // ---------- 网址与浏览记录 ----------
  // 网址参数记录当前状态，可以直接打开、刷新、分享：
  //   id=e052        打开该事件的详情
  //   browse         打开“浏览所有历史事件”侧栏；同时记录搜索词 q 和各筛选条件（见 FILTERS 的 toParams）
  //   at=755         时间轴中央的年份（拖动停下后更新）
  //   data=cn_zh     数据集（原有参数，只在打开时带有才保留）
  // 打开详情、侧栏时新增一条浏览记录，所以浏览器的“返回”会先关闭它们；改筛选、搜索、拖动只更新当前记录。
  // 深色模式、背景音乐、调试模式、编辑页是个人偏好或内部功能，不放进网址。
  var BASE_TITLE = document.title;
  var urlReady = false, applyingUrl = false, urlTimer = null;
  var keepDataParam = new URLSearchParams(location.search).has('data');
  function centerYear() {
    var y = yearOfX(-offset + viewW() / 2);
    return y == null ? null : Math.round(y);
  }
  // forShare：用于分享链接，不带 debugMode
  function buildQuery(forShare) {
    var out = [];
    if (keepDataParam) out.push(['data', dataset]);
    if (debugParam && !forShare) out.push(['debugMode', '']);
    if (!$('detailModal').hidden && detailId && findEvent(detailId)) out.push(['id', detailId]);
    if (sidebarOpen) {
      out.push(['browse', '']);
      var q = $('searchInput').value.trim();
      if (q) out.push(['q', q]);
      filtersByKind().forEach(function (f) { if (f.toParams) f.toParams(filterState[f.id], out); });
    }
    if (offset < -1) { var y = centerYear(); if (y != null) out.push(['at', String(y)]); }
    // 逗号分隔的列表保留逗号本身，便于阅读；没有值的参数（browse）只写名称
    return out.map(function (kv) {
      var v = Array.isArray(kv[1]) ? kv[1].map(encodeURIComponent).join(',') : encodeURIComponent(kv[1]);
      return kv[1] === '' ? kv[0] : kv[0] + '=' + v;
    }).join('&');
  }
  function updateTitle() {
    var ev = !$('detailModal').hidden && detailId ? findEvent(detailId) : null;
    document.title = ev ? ev.title + ' · ' + BASE_TITLE : BASE_TITLE;
  }
  // push：新增一条浏览记录（layer 为 detail / browse，用于“返回”时关闭）；否则只替换当前记录
  function syncUrl(push, layer) {
    updateTitle();
    if (!urlReady || applyingUrl) return;
    clearTimeout(urlTimer);
    var q = buildQuery();
    var url = location.pathname + (q ? '?' + q : '') + location.hash;
    if (push) history.pushState({ ch: true, layer: layer }, '', url);
    else if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', url);
  }
  function syncUrlSoon() {
    if (!urlReady || applyingUrl) return;
    clearTimeout(urlTimer);
    urlTimer = setTimeout(function () { syncUrl(false); }, 300);
  }
  function onLayerOpened(layer) { syncUrl(true, layer); }
  // 关闭详情 / 侧栏：如果它对应我们新增的浏览记录，就退回上一条（与按“返回”效果相同）；否则只更新网址
  function onLayerClosed(layer) {
    if (!urlReady || applyingUrl) { updateTitle(); return; }
    var st = history.state;
    if (st && st.ch && st.layer === layer) history.back();
    else syncUrl(false);
  }

  // 按网址恢复状态。initial：打开页面时（会恢复时间轴位置）；否则为浏览器的前进 / 返回
  function applyUrl(initial) {
    var p = new URLSearchParams(location.search);
    applyingUrl = true;
    try {
      if (!$('lightbox').hidden) closeLightbox();
      // 侧栏与筛选
      if (p.has('browse')) {
        FILTERS.forEach(function (f) { if (f.fromParams) filterState[f.id] = f.fromParams(p); });
        $('searchInput').value = p.get('q') || '';
        filterPanelKey = null;               // 按新的条件重建筛选面板
        var anyFilter = FILTERS.some(function (f) { return f.isActive(filterState[f.id]); });
        if (anyFilter) { $('filterPanel').hidden = false; $('filterToggle').setAttribute('aria-expanded', 'true'); }
        if (sidebarOpen) renderList(); else openSidebar();
      } else if (sidebarOpen) {
        closeSidebar();
      }
      // 时间轴位置（只在打开页面时恢复，前进 / 返回时保持当前位置）
      var id = p.get('id');
      var ev = id ? findEvent(id) : null;
      if (initial) {
        var at = parseInt(p.get('at'), 10);
        if (ev) {
          var i = layout.list.indexOf(ev);
          if (i > -1) centerOnX(layout.xs[i], false);
        } else if (isFinite(at)) {
          centerOnX(xOfYear(at), false);
        }
      }
      // 详情
      if (ev) {
        if ($('detailModal').hidden || detailId !== id) openDetail(id);
      } else {
        if (!$('detailModal').hidden) closeModal('detailModal');
        if (id) toast(_('找不到该事件：{id}', { id: id }));
      }
    } finally {
      applyingUrl = false;
    }
    updateTitle();
  }
  window.addEventListener('popstate', function () {
    if (!ready) return;
    applyUrl(false);
    syncUrl(false);
  });

  // 分享时间线：当前网址的全部状态（侧栏、搜索、筛选、位置、打开的事件等），只去掉 debugMode
  function timelineShareUrl() {
    var q = buildQuery(true);
    return location.origin + location.pathname + (q ? '?' + q : '');
  }
  // 分享事件：只包含事件（和数据集），不带侧栏、筛选等当前浏览状态
  function shareUrl(id) {
    var q = (keepDataParam ? 'data=' + encodeURIComponent(dataset) + '&' : '') + 'id=' + encodeURIComponent(id);
    return location.origin + location.pathname + '?' + q;
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = el('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* noop */ }
      ta.remove();
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }
  // 微信好友分享只在手机上提供：按 UA 判断手机（含 iPadOS 的桌面版 UA），以及是否在微信内置浏览器中
  var UA = navigator.userAgent || '';
  var IS_MOBILE = /Android|iPhone|iPad|iPod|HarmonyOS|Mobile/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  var IN_WECHAT = /MicroMessenger/i.test(UA);
  document.body.classList.toggle('mobile-device', IS_MOBILE);
  document.body.classList.toggle('in-wechat', IN_WECHAT);

  // 分享菜单
  var shareId = null;
  var qrcodeInstance = null;

  var shareType = null;  // 'event' 或 'timeline'

  function openShareMenu(id, type) {
    shareId = id;
    shareType = type || 'event';
    if (shareType === 'event') {
      var ev = findEvent(id);
      if (!ev) return;
    }
    $('shareTitle').textContent = shareType === 'timeline' ? _('分享时间线') : _('分享事件');
    openModal('shareModal');
    $('shareQrcode').hidden = true;
    $('shareWechatGuide').hidden = true;
    // 清空上次的二维码
    if (qrcodeInstance) {
      $('shareQrcodeContainer').innerHTML = '';
      qrcodeInstance = null;
    }
    delete $('shareQrcodeContainer').dataset.url;
  }

  $('detailShare').addEventListener('click', function () {
    if (!detailId) return;
    openShareMenu(detailId, 'event');
  });

  $('shareTimeline').addEventListener('click', function () {
    openShareMenu(null, 'timeline');
  });

  // 分享菜单的各个按钮
  var shareButtons = document.querySelectorAll('.share-btn');
  shareButtons.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var type = this.dataset.share;
      var url, title;

      if (shareType === 'timeline') {
        url = timelineShareUrl();
        title = BASE_TITLE;
      } else {
        var ev = findEvent(shareId);
        if (!ev) return;
        url = shareUrl(ev.id);
        title = ev.title + ' · ' + BASE_TITLE;
      }

      if (type === 'copy') {
        copyText(url).then(function () { toast(_('链接已复制')); }, function () { toast(_('请复制链接：{url}', { url: url })); });
        closeModal('shareModal');
      } else if (type === 'wechat-friend') {
        shareToWechat(url, title);
      } else if (type === 'wechat') {
        $('shareWechatGuide').hidden = true;
        showWechatQrcode(url);
      } else if (type === 'weibo') {
        window.open('https://service.weibo.com/share/share.php?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title), '_blank');
        closeModal('shareModal');
      } else if (type === 'qq') {
        window.open('https://sns.qzone.qq.com/cgi-bin/qzc/share?url=' + encodeURIComponent(url), '_blank');
        closeModal('shareModal');
      } else if (type === 'facebook') {
        window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url), '_blank');
        closeModal('shareModal');
      } else if (type === 'twitter') {
        window.open('https://twitter.com/intent/tweet?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(title), '_blank');
        closeModal('shareModal');
      } else if (type === 'linkedin') {
        window.open('https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url), '_blank');
        closeModal('shareModal');
      } else if (type === 'telegram') {
        window.open('https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(title), '_blank');
        closeModal('shareModal');
      } else if (type === 'email') {
        window.location.href = 'mailto:?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(title + '\n\n' + url);
      }
    });
  });

  // 分享到微信好友。网页不能直接调起微信的分享（需要公众号的 JS-SDK），因此：
  // - 在微信内置浏览器中：提示点右上角 ··· 发送给朋友 / 分享到朋友圈；
  // - 其他浏览器中：有系统分享面板（navigator.share）时用它，用户在面板里选微信；
  // - 否则：复制链接，提示到微信中发送，并提供“打开微信”。
  function shareToWechat(url, title) {
    if (IN_WECHAT) {
      closeModal('shareModal');
      showWechatTip();
      return;
    }
    if (navigator.share) {
      navigator.share({ title: title, url: url }).then(function () {
        closeModal('shareModal');
      }, function (e) {
        if (!e || e.name !== 'AbortError') showWechatGuide(url);   // 用户取消时什么也不做
      });
      return;
    }
    showWechatGuide(url);
  }
  function showWechatGuide(url) {
    $('shareQrcode').hidden = true;
    var box = $('shareWechatGuide');
    var text = $('shareWechatGuideText');
    function show(copied) {
      var head = copied ? _('链接已复制。') : _('请复制链接：{url}。', { url: url });
      text.textContent = head + _('打开微信，粘贴发送给朋友。');
      box.hidden = false;
      if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });   // 手机上分享面板较长，提示在底部
    }
    copyText(url).then(function () { show(true); }, function () { show(false); });
  }
  function showWechatTip() {
    $('wechatTipText').textContent = _('点击右上角 ··· 选择“发送给朋友”或“分享到朋友圈”');
    $('wechatTip').hidden = false;
  }
  $('wechatTip').addEventListener('click', function () { $('wechatTip').hidden = true; });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('wechatTip').hidden) { e.stopPropagation(); $('wechatTip').hidden = true; }
  }, true);

  // 二维码库异步加载（index.html 中的 #qrcodeLib）：已加载时立即调用，否则等加载完成；加载失败时 cb(false)
  function whenQrcodeReady(cb) {
    if (window.QRCode) { cb(true); return; }
    var s = $('qrcodeLib');
    if (!s || s.dataset.failed) { cb(false); return; }
    s.addEventListener('load', function () { cb(!!window.QRCode); }, { once: true });
    s.addEventListener('error', function () { s.dataset.failed = '1'; cb(false); }, { once: true });
  }

  function showWechatQrcode(url) {
    $('shareQrcode').hidden = false;
    var container = $('shareQrcodeContainer');
    container.innerHTML = '';
    container.dataset.url = url;
    if (!window.QRCode) container.appendChild(el('p', 'qrcode-wait', _('正在生成二维码…')));
    whenQrcodeReady(function (ok) {
      if (container.dataset.url !== url) return;   // 期间已关闭或换了链接
      container.innerHTML = '';
      if (!ok) {
        container.appendChild(el('p', 'qrcode-wait', _('二维码生成失败，请复制链接后在微信中发送：{url}', { url: url })));
        return;
      }
      qrcodeInstance = new QRCode(container, { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.H });
    });
  }

  // ---------- 启动 ----------
  function showLoadError(message) {
    var box = el('div', 'load-error');
    box.appendChild(el('strong', null, _('无法加载历史数据')));
    box.appendChild(el('p', null, message));
    stage.appendChild(box);
  }

  function loadDataset() {
    return fetch('data/' + dataset + '.json', { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error(_('找不到数据文件 {file}（HTTP {status}）', { file: 'data/' + dataset + '.json', status: res.status }));
      return res.json();
    }).then(function (data) {
      if (!data || !Array.isArray(data.events) || !Array.isArray(data.eras)) throw new Error(_('数据文件格式不正确'));
      return data;
    });
  }
  // 网站简介：取自数据集的 description 字段（每个国家 / 语言各自的说法）；没有时保留 index.html 中的通用文字
  function setupDescription(text) {
    if (typeof text !== 'string' || !text.trim()) return;
    ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) el.setAttribute('content', text.trim());
    });
  }
  // 本地服务器会在 /api/status 声明可写；GitHub Pages 等静态托管没有该接口
  function detectWritable() {
    return fetch('api/status', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (s) { return !!(s && s.writable); })
      .catch(function () { return false; });
  }

  Promise.all([loadDataset(), detectWritable()]).then(function (results) {
    var data = results[0];
    fileMode = results[1];
    meta = {};
    Object.keys(data).forEach(function (k) { if (k !== 'events') meta[k] = data[k]; });
    ERAS = data.eras;
    renderEraMenu();
    setupMusic(data.music);
    setupTexture(data.texture);
    setupDescription(data.description);
    TYPES = Array.isArray(data.types) ? data.types.filter(function (t) { return t && t.name; }) : [];
    defaultEvents = data.events;
    events = fileMode ? clone(defaultEvents) : load();

    $('resetBtn').hidden = fileMode;
    $('storageNote').textContent = fileMode
      ? _('本地文件模式：修改会直接写入 {file}', { file: 'data/' + dataset + '.json' })
      : _('修改保存在当前浏览器中');

    ready = true;
    renderTimeline();
    setOffset(0);
    stage.focus({ preventScroll: true });
    applyUrl(true);
    urlReady = true;
    syncUrl(false);   // 规范化网址（例如去掉找不到的 id）
    if (autoplayAllowed()) setPlaying(true);   // 加载后默认自动播放
    updateAbout();
    // 首次访问提示：等字体加载、排版稳定后再显示，聚光灯的位置才准确
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () {
      setTimeout(maybeShowOnboarding, 400);
    });
  }).catch(function (e) {
    showLoadError(location.protocol === 'file:'
      ? _('请在项目目录运行 npm start，然后通过 http://127.0.0.1:4173/ 访问。')
      : e.message);
  });
})();
