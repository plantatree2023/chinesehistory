(function () {
  'use strict';

  // 数据集：data/<国家>_<语言>.json（国家为 ISO 3166 代码，语言为 ISO 639 代码），
  // 可通过网址参数 ?data=jp_ja 切换，默认 cn_zh（中国 · 中文）
  var DATASET_ID = /^[a-z]{2}_[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
  var dataset = (function () {
    var id = new URLSearchParams(location.search).get('data');
    return id && DATASET_ID.test(id) ? id : 'cn_zh';
  })();
  var STORAGE_KEY = 'zh-history-timeline:v1:' + dataset;
  var LEGACY_STORAGE_KEY = 'zh-history-timeline:v1';   // 旧版本（仅中国数据）使用的键
  var MAX_IMAGES = 9;
  var MAX_DETAIL = 350;
  // 任意一屏宽度内最多显示的事件数：大屏幕（时间轴区域宽度不小于 LARGE_SCREEN_W）上放宽到 8 个，
  // 其余（笔记本、平板、手机）为 6 个。窗口大小变化时会重新排版
  var MAX_PER_SCREEN = 6, MAX_PER_SCREEN_LARGE = 8, LARGE_SCREEN_W = 1600;
  function maxPerScreen(width) { return width >= LARGE_SCREEN_W ? MAX_PER_SCREEN_LARGE : MAX_PER_SCREEN; }
  var MAX_CAPTION = 60;     // 图片标题最多字数
  var MIN_SUMMARY = 20;     // 卡片说明文字至少的字数（不计标点）

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

  function formatYear(y) {
    if (y <= -10000) {
      var wan = -y / 10000;
      return '约' + (wan % 1 === 0 ? wan : wan.toFixed(1)) + '万年前';
    }
    if (y < 0) return '公元前' + (-y) + '年';
    return '公元' + y + '年';
  }
  function tickLabel(y) {
    if (y <= -10000) return (-y / 10000) + '万年前';
    if (y < 0) return '前' + (-y);
    return String(y);
  }
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
    var detail = (ev.detail || '').replace(/\s+/g, '');
    if (!detail) return short;
    var text = short && detail.indexOf(short) === -1 ? short + detail : detail;
    return text.length > 60 ? text.slice(0, 58) + '…' : text;
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
    return isWikipedia(s) ? '维基百科' : s.url;
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
    if (counts['']) out.push({ name: '', label: '未分类', color: UNTYPED_COLOR });
    return out;
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // 图片元素，加载失败时回退到占位图
  function imageEl(image, cls, fallbackChar) {
    if (image && image.src) {
      var img = el('img', cls);
      img.src = image.src;
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
      if (!raw && dataset === 'cn_zh') {
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
      saveToFile().catch(function (e) { toast('写入数据文件失败：' + e.message); });
      return true;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(diffFromDefaults()));
      return true;
    } catch (e) {
      toast('浏览器存储空间不足，修改仅在本次访问中有效');
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
  function textHeight(ev, width, kind) {
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
    textCache[key] = Math.ceil(body.getBoundingClientRect().height);
    measurer.innerHTML = '';
    return textCache[key];
  }

  // 按图片比例、面积和最大高度计算卡片尺寸，放不下返回 null
  function shapeFor(ev, r, area, kind, maxH) {
    var iw = Math.sqrt(area * r), ih = Math.sqrt(area / r), th, cw;
    var tier = TIERS[tierOf(ev)];
    var maxIh = maxH * tier.heightFrac;
    if (iw > tier.maxImgW) { iw = tier.maxImgW; ih = iw / r; }
    if (ih > maxIh) { ih = maxIh; iw = ih * r; }
    if (kind === 'stack') {
      for (var k = 0; k < 2; k++) {
        cw = Math.max(iw, MIN_STACK_W);
        th = textHeight(ev, cw, 'stack');
        if (ih + th + 2 <= maxH) break;
        ih = maxH - th - 2; iw = ih * r;
      }
      if (Math.min(iw, ih) < MIN_IMG_SIDE || ih + th + 2 > maxH) return null;
      return { kind: kind, iw: iw, ih: ih, w: Math.round(Math.max(iw, MIN_STACK_W) + 2), h: Math.round(ih + th + 2) };
    }
    th = textHeight(ev, SIDE_TEXT_W, 'side');
    if (ih + 2 > maxH) { ih = maxH - 2; iw = ih * r; }
    if (Math.min(iw, ih) < MIN_IMG_SIDE || th + 2 > maxH) return null;
    return { kind: kind, iw: iw, ih: ih, w: Math.round(iw + SIDE_TEXT_W + 2), h: Math.round(Math.max(ih, th) + 2) };
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
          var sh = shapeFor(ev, r, area * k2, kind, maxH);
          if (!sh || sh.w > maxW) return;
          // 按实际显示的图片面积计分，越大越好（重大事件更坚持用大图）；
          // 与上一个事件换一种图文关系；竖图适合左右排，横图适合上下排
          sh.cost = (1 - sh.iw * sh.ih / (tiers[0] * k2)) * tier.weight + (kind === prevKind ? 14 : 0)
            + (kind === 'stack' ? (r < 0.85 ? 18 : 0) : (r > 1.7 ? 18 : 0))
            + (kind === 'right' ? 4 : 0);
          shapes.push(sh);
        });
      });
      if (!shapes.length) shapes.push({ kind: 'stack', iw: 120, ih: 90, w: MIN_STACK_W + 2, h: Math.min(maxH, 90 + textHeight(ev, MIN_STACK_W, 'stack') + 2), cost: 0 });
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

  function renderTimeline() {
    ensureRatios();
    computeLayout();
    track.dataset.renders = (+track.dataset.renders || 0) + 1;   // 排版次数，供自动化测试判断排版是否稳定
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
      today.appendChild(el('span', null, '今天'));
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
      var pic = imageEl(ev.images && ev.images[0], 'card-img', ev.title);
      pic.style.width = Math.round(sh.iw) + 'px';
      pic.style.height = Math.round(sh.ih) + 'px';
      media.appendChild(pic);
      card.appendChild(media);
      card.appendChild(cardBody(ev));
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
  }

  // ---------- 平移 / 拖拽 ----------
  function viewW() { return stage.clientWidth; }
  function minOffset() { return Math.min(0, viewW() - layout.width); }
  function setOffset(v) {
    offset = clamp(v, minOffset(), 0);
    syncUrlSoon();
    track.style.transform = 'translate3d(' + offset + 'px,0,0)';
    updateViewIndicators();
    if (tipShown) hideEraTip();
  }
  var anim = null;
  // 手动浏览（拖动、滚轮、方向键、进度条、翻页按钮、跳到某个事件等）都会先调用 stopAnim，同时暂停自动播放
  function stopAnim() {
    if (anim) cancelAnimationFrame(anim);
    anim = null;
    if (typeof setPlaying === 'function' && playing) setPlaying(false);
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

  function approxYear(y) {
    if (y <= -10000) {
      var wan = -y / 10000;
      return '约' + (wan >= 10 ? Math.round(wan) : Math.round(wan * 10) / 10) + '万年前';
    }
    if (y < -3000) return '约公元前' + Math.round(-y / 100) * 100 + '年';
    if (y < 0.5) return '约公元前' + Math.max(1, Math.round(-y)) + '年';
    return '约公元' + Math.min(CURRENT_YEAR, Math.round(y)) + '年';
  }

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
    tipBox.appendChild(el('div', 'era-tip-year', '此处：' + (Math.round(y) === y && y > -10000 ? formatYear(y) : approxYear(y))));
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
    var hero = $('detailHero');
    hero.innerHTML = '';
    var h = imageEl(imgs[0], '', ev.title);
    if (imgs[0]) h.addEventListener('click', function () { openLightbox(imgs, 0); });
    hero.appendChild(h);
    $('detailDate').textContent = ev.date || formatYear(ev.year);
    var tagBox = $('detailTags');
    tagBox.innerHTML = '';
    if (ev.type) {
      var tag = el('span', 'type-tag', ev.type);
      tag.style.setProperty('--chip-color', typeInfo(ev.type).color);
      tagBox.appendChild(tag);
    }
    $('detailTransition').hidden = !ev.transition;
    $('detailTransition').textContent = ev.transition ? '时期更迭：' + transitionText(ev.transition) : '';
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
      src.appendChild(el('span', 'source-label', '参考链接：'));
      var ul = el('ul', 'source-list');
      links.forEach(function (s) {
        var li = el('li');
        var a = el('a', null, sourceLabel(s));
        a.href = s.url; a.target = '_blank'; a.rel = 'noopener';
        li.appendChild(a);
        ul.appendChild(li);
      });
      src.appendChild(ul);
      if (links.some(isWikipedia)) src.appendChild(el('p', 'source-note', '来自维基百科的文字与图片遵循 CC BY-SA 等相应许可'));
    }
    openModal('detailModal');
    $('detailModal').querySelector('.modal-card').scrollTop = 0;
    if (wasOpen) syncUrl(false); else onLayerOpened('detail');
  }
  $('detailEdit').addEventListener('click', function () {
    closeModal('detailModal');
    openEditor(detailId);
  });
  $('detailDelete').addEventListener('click', function () { askDelete(detailId); });

  function askDelete(id) {
    if (!debugMode) return;
    var ev = findEvent(id);
    if (!ev) return;
    confirmDialog('确定要删除“' + ev.title + '”吗？此操作无法撤销。', function () {
      events = events.filter(function (e) { return e.id !== id; });
      save();
      closeModal('detailModal');
      var keep = offset;
      renderTimeline();
      setOffset(keep);
      renderList();
      toast('已删除“' + ev.title + '”');
    });
  }

  // ---------- 图片查看 ----------
  var lb = { imgs: [], i: 0 };
  function openLightbox(imgs, i) {
    lb.imgs = imgs; lb.i = i;
    showLightbox();
    $('lightbox').hidden = false;
  }
  function showLightbox() {
    var im = lb.imgs[lb.i];
    var img = $('lightboxImg');
    img.src = im.src;
    img.alt = im.caption || '';
    $('lightboxCaption').textContent = (im.caption || '') + (lb.imgs.length > 1 ? '  (' + (lb.i + 1) + '/' + lb.imgs.length + ')' : '');
    var many = lb.imgs.length > 1;
    document.querySelector('.lb-prev').hidden = !many;
    document.querySelector('.lb-next').hidden = !many;
  }
  function closeLightbox() { $('lightbox').hidden = true; }
  $('lightbox').addEventListener('click', function (e) {
    if (e.target.closest('.lb-prev')) { lb.i = (lb.i - 1 + lb.imgs.length) % lb.imgs.length; showLightbox(); }
    else if (e.target.closest('.lb-next')) { lb.i = (lb.i + 1) % lb.imgs.length; showLightbox(); }
    else if (e.target.tagName !== 'IMG') closeLightbox();
  });
  document.addEventListener('keydown', function (e) {
    if ($('lightbox').hidden) return;
    if (e.key === 'ArrowLeft') { lb.i = (lb.i - 1 + lb.imgs.length) % lb.imgs.length; showLightbox(); }
    if (e.key === 'ArrowRight') { lb.i = (lb.i + 1) % lb.imgs.length; showLightbox(); }
  });

  // ---------- 编辑 / 新建 ----------
  var form = $('editForm');
  var editingId = null;
  var draftImages = [];

  function openEditor(id) {
    if (!debugMode) return;
    var ev = id ? findEvent(id) : null;
    editingId = ev ? ev.id : null;
    setSaveState(null);
    $('editTitle').textContent = ev ? '编辑事件' : '添加新事件';
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
    typeSel.appendChild(new Option('未分类', ''));
    TYPES.forEach(function (t) { typeSel.appendChild(new Option(t.name, t.name)); });
    // 数据中出现、但不在类型列表里的类型也保留为选项，避免编辑时丢失
    if (ev && ev.type && !TYPES.some(function (t) { return t.name === ev.type; })) typeSel.appendChild(new Option(ev.type, ev.type));
    typeSel.value = ev && ev.type ? ev.type : '';
    ['transitionFrom', 'transitionTo'].forEach(function (name, i) {
      var sel = form[name];
      sel.innerHTML = '';
      sel.appendChild(new Option('无', ''));
      ERAS.forEach(function (era) { sel.appendChild(new Option(era.name, era.name)); });
      sel.value = ev && ev.transition ? (i ? ev.transition.to : ev.transition.from) : '';
    });
    draftImages = ev ? clone(ev.images || []) : [];
    $('imageUrlInput').value = '';
    $('formError').textContent = '';
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

  function renderImageEditor() {
    var box = $('imageEditor');
    box.innerHTML = '';
    draftImages.forEach(function (im, i) {
      var slot = el('div', 'img-slot');
      slot.appendChild(imageEl(im, '', '图'));
      if (i === 0) slot.appendChild(el('span', 'badge', '代表图'));
      var acts = el('div', 'slot-actions');
      if (i > 0) {
        var up = el('button', null, '★');
        up.type = 'button'; up.title = '设为代表图';
        up.addEventListener('click', function () {
          draftImages.unshift(draftImages.splice(i, 1)[0]);
          renderImageEditor();
        });
        acts.appendChild(up);
      }
      var rm = el('button', null, '✕');
      rm.type = 'button'; rm.title = '移除';
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
      cap.placeholder = '图片标题';
      cap.value = im.caption || '';
      cap.setAttribute('aria-label', '第 ' + (i + 1) + ' 张图片的标题');
      cap.addEventListener('input', function () { im.caption = cap.value; });
      slot.appendChild(cap);
      box.appendChild(slot);
    });
    var full = draftImages.length >= MAX_IMAGES;
    $('imageUrlInput').disabled = full || urlBusy;
    $('imageUrlAdd').disabled = full || urlBusy;
    $('imageFileInput').disabled = full;
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
      throw new Error('该网站不允许直接下载图片，请先保存到电脑再上传');
    }).then(function (res) {
      if (!res.ok) throw new Error('网址返回 HTTP ' + res.status);
      return res.blob();
    }).then(function (blob) {
      if (!/^image\//.test(blob.type)) throw new Error('该网址不是图片');
      return new Promise(function (resolve, reject) {
        resizeFile(blob, 900, function (data, w, h) {
          if (data) resolve({ src: data, w: w, h: h });
          else reject(new Error('无法识别该图片'));
        });
      });
    });
  }
  function addImageUrl() {
    var inp = $('imageUrlInput'), btn = $('imageUrlAdd');
    var url = inp.value.trim();
    if (!url || urlBusy) return;
    if (!/^https?:\/\//i.test(url)) { $('formError').textContent = '请输入以 http:// 或 https:// 开头的图片网址'; return; }
    if (draftImages.length >= MAX_IMAGES) { $('formError').textContent = '最多只能添加 9 张图片'; return; }
    urlBusy = true;
    btn.textContent = '下载中…';
    $('formError').textContent = '';
    renderImageEditor();
    fetchImageUrl(url).then(function (img) {
      if (draftImages.length >= MAX_IMAGES) return;
      draftImages.push({ src: img.src, w: img.w, h: img.h, caption: '' });
      inp.value = '';
    }).catch(function (e) {
      $('formError').textContent = '图片下载失败：' + e.message;
    }).then(function () {
      urlBusy = false;
      btn.textContent = '添加网址';
      renderImageEditor();
    });
  }
  $('imageUrlAdd').addEventListener('click', addImageUrl);
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
    if (files.length > room) $('formError').textContent = '最多只能添加 9 张图片，多余的已忽略';
    files.slice(0, room).forEach(function (f) {
      if (!/^image\//.test(f.type)) return;
      resizeFile(f, 900, function (data, w, h) {
        if (!data || draftImages.length >= MAX_IMAGES) return;
        draftImages.push({ src: data, w: w, h: h, caption: f.name.replace(/\.[^.]+$/, '') });
        renderImageEditor();
      });
    });
  });

  // ---------- 编辑页：参考链接（可增删改） ----------
  var draftSources = [];
  function renderSourceEditor() {
    var box = $('sourceEditor');
    box.innerHTML = '';
    draftSources.forEach(function (src, i) {
      var li = el('li', 'source-row');
      var url = el('input', 'source-url');
      url.type = 'url';
      url.placeholder = 'https://…';
      url.value = src.url || '';
      url.setAttribute('aria-label', '第 ' + (i + 1) + ' 条参考链接的网址');
      url.addEventListener('input', function () { src.url = url.value; });
      var title = el('input', 'source-title');
      title.type = 'text';
      title.maxLength = 60;
      title.placeholder = '标题（可选）';
      title.value = src.title || '';
      title.setAttribute('aria-label', '第 ' + (i + 1) + ' 条参考链接的标题');
      title.addEventListener('input', function () { src.title = title.value; });
      var rm = el('button', 'icon-btn source-remove', '×');
      rm.type = 'button';
      rm.title = '删除这条链接';
      rm.setAttribute('aria-label', '删除第 ' + (i + 1) + ' 条参考链接');
      rm.addEventListener('click', function () {
        draftSources.splice(i, 1);
        renderSourceEditor();
      });
      li.appendChild(url);
      li.appendChild(title);
      li.appendChild(rm);
      box.appendChild(li);
    });
    $('sourceAdd').disabled = draftSources.length >= MAX_SOURCES;
  }
  $('sourceAdd').addEventListener('click', function () {
    if (draftSources.length >= MAX_SOURCES) return;
    draftSources.push({ url: '', title: '' });
    renderSourceEditor();
    var inputs = $('sourceEditor').querySelectorAll('.source-url');
    inputs[inputs.length - 1].focus();
  });
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
    return bad.length ? '参考链接必须以 http:// 或 https:// 开头：' + (bad[0].url || bad[0].title) : '';
  }

  // 保存按钮的状态：saving（转圈 + “保存中…”）→ saved（“✓ 已保存”）→ 恢复。
  // 保存要重新排版整条时间轴（可能要几百毫秒），先让按钮状态显示出来再开始，避免页面看起来卡住
  function setSaveState(state) {
    form.classList.toggle('saving', state === 'saving');
    form.classList.toggle('saved', state === 'saved');
    form.setAttribute('aria-busy', state === 'saving' ? 'true' : 'false');
    $('saveBtn').disabled = !!state;
    $('saveBtn').querySelector('.btn-label').textContent = state === 'saving' ? '保存中…' : state === 'saved' ? '✓ 已保存' : '保存';
  }
  function afterPaint(fn) {
    requestAnimationFrame(function () { setTimeout(fn, 0); });
  }
  var SAVED_PAUSE = 450;   // “已保存”停留的时间（毫秒）

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.classList.contains('saving') || form.classList.contains('saved')) return;   // 防止重复提交
    var title = form.title.value.trim();
    var yAbs = parseInt(form.yearAbs.value, 10);
    var err = '';
    if (!title) err = '请填写事件名称';
    else if (!yAbs || yAbs < 1) err = '请填写有效的年份（正整数）';
    else if (form.detail.value.length > MAX_DETAIL) err = '详细说明不能超过 350 字';
    else if (charCount(form.short.value) < MIN_SUMMARY && charCount(form.detail.value) < MIN_SUMMARY) err = '请至少填写 20 字的说明（简要说明或详细说明），时间轴上会显示这段文字';
    var tFrom = form.transitionFrom.value, tTo = form.transitionTo.value;
    if (!err) err = sourcesError();
    if (!err && (tFrom || tTo)) {
      if (!tFrom || !tTo) err = '时期更迭需要同时选择“从”和“到”';
      else if (tFrom === tTo) err = '时期更迭的“从”和“到”不能相同';
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
      images: draftImages.slice(0, MAX_IMAGES).map(function (im) {
        return Object.assign({}, im, { caption: (im.caption || '').trim() });
      }),
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
    // 本地文件模式等待写入完成；浏览器模式直接保存到 localStorage
    return { id: id, wasEditing: !!editingId, written: fileMode ? saveToFile() : Promise.resolve(save()) };
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
        toast(wasEditing ? '已保存修改' : '已添加新事件');
        if (wasEditing && openStack.indexOf('detailModal') < 0 && !sidebarOpen) openDetail(id);
      }, SAVED_PAUSE);
    }, function (e) {
      // 写入失败：修改仍保留在页面中，编辑页不关闭，可以再次保存
      setSaveState(null);
      editingId = id;
      $('formError').textContent = '写入数据文件失败：' + e.message + '。修改仍保留在页面中，可以再次点击保存。';
    });
  }

  $('addBtn').addEventListener('click', function () { openEditor(null); });

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
      label: '重大事件',
      available: function (ctx) { return ctx.majorCount > 0; },
      initial: function () { return false; },
      isActive: function (v) { return v; },
      test: function (ev, v) { return !v || isMajor(ev); },
      render: function (box, v, set, ctx) { toggleFilterUI('major', '只看重大事件（' + ctx.majorCount + '）')(box, v, set); }
    },
    {
      id: 'type',
      kind: 'select',
      // 网址中使用类型的 key（如 war），与语言无关；“未分类”写作 none
      toParams: function (v, out) { if (v.length) out.push(['type', v.map(typeParamOf)]); },
      fromParams: function (p) { return listParam(p, 'type').map(typeNameOfParam).filter(function (x) { return x != null; }); },
      label: '事件类型（可多选）',
      available: function (ctx) { return ctx.typesWithEvents.some(function (t) { return t.name; }); },   // 至少有一个事件有类型
      initial: function () { return []; },
      isActive: function (v) { return v.length > 0; },
      test: function (ev, v) { return !v.length || v.indexOf(ev.type || '') > -1; },
      render: function (box, v, set, ctx) {
        box.appendChild(multiSelect('type', ctx.typesWithEvents.map(function (t) {
          return { value: t.name, label: t.label || t.name, color: t.color, count: ctx.typeCounts[t.name] };
        }), v, set, '全部类型'));
      }
    },
    {
      id: 'transition',
      kind: 'toggle',
      toParams: function (v, out) { if (v) out.push(['transition', '1']); },
      fromParams: function (p) { return p.get('transition') === '1'; },
      label: '时期更迭',
      available: function (ctx) { return ctx.transitionCount > 0; },
      initial: function () { return false; },
      isActive: function (v) { return v; },
      test: function (ev, v) { return !v || !!ev.transition; },
      render: function (box, v, set, ctx) { toggleFilterUI('transition', '只看时期更迭的事件（' + ctx.transitionCount + '）')(box, v, set); }
    },
    {
      id: 'era',
      kind: 'select',
      toParams: function (v, out) { if (v.length) out.push(['era', v]); },
      fromParams: function (p) { return listParam(p, 'era').filter(function (n) { return ERAS.some(function (e) { return e.name === n; }); }); },
      label: '朝代 / 时期（可多选）',
      available: function (ctx) { return ctx.erasWithEvents.length > 0; },
      initial: function () { return []; },
      isActive: function (v) { return v.length > 0; },
      test: function (ev, v) { return !v.length || v.indexOf(eraOf(ev.year).name) > -1; },
      render: function (box, v, set, ctx) {
        box.appendChild(multiSelect('era', ctx.erasWithEvents.map(function (era) {
          return { value: era.name, label: era.name, color: era.color, count: ctx.eraCounts[era.name] };
        }), v, set, '全部朝代 / 时期'));
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
      label: '时间范围',
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
          era.innerHTML = '<option value="bce">公元前</option><option value="ce">公元</option>';
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
            warn.textContent = '起始年份晚于结束年份，没有符合的事件';
            set(v);
          };
          num.addEventListener('input', update);
          era.addEventListener('change', update);
          row.appendChild(era);
          row.appendChild(num);
          row.appendChild(el('span', 'filter-year-label', '年'));
          return row;
        };
        box.appendChild(yearInput('from', '从', ctx.minYear));
        box.appendChild(yearInput('to', '到', ctx.maxYear));
        box.appendChild(el('p', 'filter-hint', '数据范围：' + formatYear(ctx.minYear) + ' — ' + formatYear(ctx.maxYear) + '；留空表示不限'));
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
    var clear = el('button', 'btn btn-ghost btn-small filter-clear', '清除筛选');
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
    $('eventCount').textContent = narrowed ? '（' + list.length + ' / ' + events.length + '）' : '（' + events.length + '）';
    $('filterBadge').hidden = !active.length;
    $('filterBadge').textContent = active.length ? String(active.length) : '';
    $('filterToggle').classList.toggle('on', active.length > 0);
    if ($('filterClear')) $('filterClear').disabled = !active.length;
    var ol = $('eventList');
    ol.innerHTML = '';
    if (!list.length) {
      ol.appendChild(el('li', 'list-empty', narrowed ? '没有符合条件的事件' : '暂无事件，点击右下角“+”添加'));
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
        var acts = el('div', 'list-actions');
        var v = el('button', 'btn btn-ghost btn-small', '查看详情');
        v.type = 'button';
        v.addEventListener('click', function () { openDetail(ev.id); });
        var ed = el('button', 'btn btn-primary btn-small debug-only', '编辑');
        ed.type = 'button';
        ed.addEventListener('click', function () { openEditor(ev.id); });
        var del = el('button', 'btn btn-danger btn-small debug-only', '删除');
        del.type = 'button';
        del.addEventListener('click', function () { askDelete(ev.id); });
        acts.appendChild(v); acts.appendChild(ed); acts.appendChild(del);
        li.appendChild(acts);
      }
      ol.appendChild(li);
    });
  }

  $('resetBtn').addEventListener('click', function () {
    confirmDialog('恢复默认数据将清除你做的所有添加、修改和删除，确定吗？', function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
      events = clone(defaultEvents);
      activeListId = null;
      renderTimeline();
      renderList();
      toast('已恢复默认数据');
    });
  });

  // ---------- 显示 / 隐藏工具栏（默认显示） ----------
  var barsBtn = $('barsToggle');
  function setBarsHidden(hidden) {
    document.body.classList.toggle('bars-hidden', hidden);
    var label = hidden ? '显示工具栏' : '隐藏工具栏';
    barsBtn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    barsBtn.setAttribute('aria-label', label);
    barsBtn.title = label + '（H）';
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
    ptrEl.querySelector('.ptr-text').textContent = ready ? '释放刷新' : '下拉刷新';
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
      ptrEl.querySelector('.ptr-text').textContent = '正在刷新…';
      location.reload();
    } else {
      ptrReset();
    }
  }
  document.addEventListener('touchend', ptrEnd);
  document.addEventListener('touchcancel', function () { if (ptr.state !== 'refreshing') ptrReset(); });

  // ---------- 自动播放：时间轴缓缓向右前进 ----------
  // 速度为每 PLAY_SECONDS_PER_SCREEN 秒一屏；手动浏览（见 stopAnim）时暂停；
  // 打开侧栏、弹窗或图片查看器时原地停住，关闭后继续；到达末端时停止，再次播放从头开始
  var PLAY_SECONDS_PER_SCREEN = 30;
  var playing = false, playRaf = null, playLast = 0;
  var playBtn = $('playToggle');
  function setPlaying(on) {
    playing = on;
    playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var label = on ? '暂停自动播放' : '自动播放';
    playBtn.setAttribute('aria-label', label);
    playBtn.title = label + '（空格）';
    if (playRaf) cancelAnimationFrame(playRaf);
    playRaf = null;
    if (!on) return;
    playLast = performance.now();
    playRaf = requestAnimationFrame(playStep);
  }
  function playStep(now) {
    var dt = Math.min(100, now - playLast);   // 切到后台再回来时不会突然跳很远
    playLast = now;
    var held = openStack.length || sidebarOpen || !$('lightbox').hidden || drag.active;
    if (!held) {
      if (offset <= minOffset() + 0.5) { setPlaying(false); return; }
      setOffset(offset - viewW() / PLAY_SECONDS_PER_SCREEN * dt / 1000);
    }
    playRaf = requestAnimationFrame(playStep);
  }
  function togglePlay() {
    if (playing) { setPlaying(false); return; }
    if (anim) { cancelAnimationFrame(anim); anim = null; }
    if (offset <= minOffset() + 0.5) setOffset(0);   // 已在末端：从头开始
    setPlaying(true);
  }
  playBtn.addEventListener('click', togglePlay);
  // 空格键：播放 / 暂停（焦点在输入框、按钮等控件上或有弹窗时不处理）
  document.addEventListener('keydown', function (e) {
    if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.closest('input, textarea, select, button, a, [contenteditable="true"]'))) return;
    if (openStack.length || sidebarOpen || !$('lightbox').hidden) return;
    e.preventDefault();
    togglePlay();
  });

  // ---------- 背景音乐 ----------
  // 每个数据集可以有自己的背景音乐（数据中的 music 字段，见 data/README.md），没有则不显示音乐按钮。
  // 页面加载后立即尝试播放；多数浏览器不允许网页在访问者操作之前发声，被拦截时音乐按钮轻轻闪动提示，
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
    if (!bgm.getAttribute('src')) return;
    if (on) playMusic(); else bgm.pause();
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
    var label = !musicOn ? '开启背景音乐' : musicBtn.classList.contains('waiting') ? '开始播放背景音乐' : '关闭背景音乐';
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
    bgm.src = music.src;
    var v = Number(music.volume);
    bgm.volume = v >= 0 && v <= 1 ? v : DEFAULT_MUSIC_VOLUME;
    musicBtn.hidden = false;
    var saved = null;
    try { saved = localStorage.getItem(MUSIC_KEY); } catch (e) { /* noop */ }
    setMusicOn(saved !== 'off', false);   // 开启状态下立即尝试播放
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
    var label = theme === 'dark' ? '切换到浅色模式' : '切换到深色模式';
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
  }
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  themeBtn.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 只在本次访问中生效 */ }
  });

  // ---------- 调试模式（默认关闭） ----------
  // 开启后在顶栏下方显示网站最近更新时间，并显示全部编辑功能（新增、编辑、删除、恢复默认数据）。
  // 关闭时这些元素带 .debug-only 类被 CSS 隐藏，openEditor / askDelete 也直接返回。
  // 设置保存在当前浏览器中，所有数据集共用。
  var DEBUG_KEY = 'zh-history-timeline:debug';
  var debugMode = false;
  var versionRequest = null;

  function setDebugMode(on) {
    debugMode = on;
    document.body.classList.toggle('debug-mode', on);
    $('debugToggle').checked = on;
    try {
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
    toast('正在清除缓存、获取最新版本…');
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
        time.textContent = when || '未知';
        if (when) time.setAttribute('datetime', v.updatedAt); else time.removeAttribute('datetime');
        $('debugCommit').textContent = when && v.commit
          ? '版本 ' + v.commit + (v.source === 'local' ? '（本地）' : '')
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
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + '（' + tz + '）';
  }

  $('debugToggle').addEventListener('change', function (e) { setDebugMode(e.target.checked); });
  (function () {
    var on = false;
    try { on = localStorage.getItem(DEBUG_KEY) === '1'; } catch (e) { /* noop */ }
    setDebugMode(on);
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
  function buildQuery() {
    var out = [];
    if (keepDataParam) out.push(['data', dataset]);
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
        if (id) toast('找不到该事件：' + id);
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

  // 分享链接：只包含事件（和数据集），不带侧栏、筛选等当前浏览状态
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
    openModal('shareModal');
    $('shareQrcode').hidden = true;
    // 清空上次的二维码
    if (qrcodeInstance) {
      $('shareQrcodeContainer').innerHTML = '';
      qrcodeInstance = null;
    }
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
        url = location.origin + location.pathname;
        title = BASE_TITLE;
      } else {
        var ev = findEvent(shareId);
        if (!ev) return;
        url = shareUrl(ev.id);
        title = ev.title + ' · ' + BASE_TITLE;
      }

      if (type === 'copy') {
        copyText(url).then(function () { toast('链接已复制'); }, function () { toast('请复制链接：' + url); });
        closeModal('shareModal');
      } else if (type === 'wechat') {
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

  function showWechatQrcode(url) {
    $('shareQrcode').hidden = false;
    var container = $('shareQrcodeContainer');
    container.innerHTML = '';
    qrcodeInstance = new QRCode(container, {
      text: url,
      width: 200,
      height: 200,
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  // ---------- 启动 ----------
  function showLoadError(message) {
    var box = el('div', 'load-error');
    box.appendChild(el('strong', null, '无法加载历史数据'));
    box.appendChild(el('p', null, message));
    stage.appendChild(box);
  }

  function loadDataset() {
    return fetch('data/' + dataset + '.json', { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw new Error('找不到数据文件 data/' + dataset + '.json（HTTP ' + res.status + '）');
      return res.json();
    }).then(function (data) {
      if (!data || !Array.isArray(data.events) || !Array.isArray(data.eras)) throw new Error('数据文件格式不正确');
      return data;
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
    setupMusic(data.music);
    setupTexture(data.texture);
    TYPES = Array.isArray(data.types) ? data.types.filter(function (t) { return t && t.name; }) : [];
    defaultEvents = data.events;
    events = fileMode ? clone(defaultEvents) : load();

    $('resetBtn').hidden = fileMode;
    $('storageNote').textContent = fileMode
      ? '本地文件模式：修改会直接写入 data/' + dataset + '.json'
      : '修改保存在当前浏览器中';

    ready = true;
    renderTimeline();
    setOffset(0);
    stage.focus({ preventScroll: true });
    applyUrl(true);
    urlReady = true;
    syncUrl(false);   // 规范化网址（例如去掉找不到的 id）
  }).catch(function (e) {
    showLoadError(location.protocol === 'file:'
      ? '请在项目目录运行 npm start，然后通过 http://127.0.0.1:4173/ 访问。'
      : e.message);
  });
})();
