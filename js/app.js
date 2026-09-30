(function () {
  'use strict';

  var STORAGE_KEY = 'zh-history-timeline:v1';
  var MAX_IMAGES = 9;
  var MAX_DETAIL = 350;
  var MAX_PER_SCREEN = 6;   // 任意一屏宽度内最多显示的事件数
  var MIN_SUMMARY = 20;     // 卡片说明文字至少的字数（不计标点）

  // 朝代 / 时期色带（用于时间轴着色与“当前时代”提示）
  var ERAS = [
    { name: '旧石器时代', start: -2000000, end: -10000, color: '#8d8373', range: '约200万年前—约1万年前', desc: '人类使用打制石器，以采集和狩猎为生' },
    { name: '新石器时代', start: -10000, end: -2070, color: '#a39170', range: '约1万年前—前2070年', desc: '出现磨制石器、陶器、农业与定居村落' },
    { name: '夏', start: -2070, end: -1600, color: '#7d6b4f', range: '约前2070年—前1600年', desc: '史书记载的第一个世袭制王朝' },
    { name: '商', start: -1600, end: -1046, color: '#8a5a3b', range: '约前1600年—前1046年', desc: '青铜文明鼎盛，甲骨文成熟' },
    { name: '西周', start: -1046, end: -771, color: '#6f7a45', range: '前1046年—前771年', desc: '推行分封制与宗法制，定都镐京' },
    { name: '春秋', start: -770, end: -476, color: '#58804f', range: '前770年—前476年', desc: '周室衰微，诸侯争霸，孔子、老子出现' },
    { name: '战国', start: -475, end: -221, color: '#3f7160', range: '前475年—前221年', desc: '七雄并立，变法图强，百家争鸣' },
    { name: '秦', start: -221, end: -207, color: '#2b2b2b', range: '前221年—前207年', desc: '第一个大一统王朝，统一文字与度量衡' },
    { name: '西汉', start: -206, end: 8, color: '#a8322a', range: '前202年—8年', desc: '定都长安，开通丝绸之路，独尊儒术' },
    { name: '新', start: 9, end: 23, color: '#7a5a8a', range: '9年—23年', desc: '王莽代汉建立的短暂王朝' },
    { name: '东汉', start: 25, end: 220, color: '#b8503c', range: '25年—220年', desc: '定都洛阳，造纸术改进，佛教传入' },
    { name: '三国', start: 220, end: 280, color: '#5d6b8a', range: '220年—280年', desc: '魏、蜀、吴三国鼎立' },
    { name: '晋', start: 280, end: 420, color: '#4f7f8f', range: '266年—420年', desc: '西晋短暂统一，东晋偏安江南' },
    { name: '南北朝', start: 420, end: 589, color: '#6c8a7a', range: '420年—589年', desc: '南北对峙，民族大融合' },
    { name: '隋', start: 589, end: 618, color: '#9a7a3a', range: '581年—618年', desc: '重归统一，开凿大运河，创立科举' },
    { name: '唐', start: 618, end: 907, color: '#c0892f', range: '618年—907年', desc: '国力强盛、文化繁荣的开放王朝' },
    { name: '五代十国', start: 907, end: 960, color: '#8c7a6b', range: '907年—979年', desc: '中原五代更替，南方十国并立' },
    { name: '北宋', start: 960, end: 1127, color: '#3f7f86', range: '960年—1127年', desc: '重文轻武，经济文化高度发达' },
    { name: '南宋', start: 1127, end: 1279, color: '#5b9098', range: '1127年—1279年', desc: '偏安江南，经济重心南移' },
    { name: '元', start: 1279, end: 1368, color: '#4a5d8c', range: '1271年—1368年', desc: '蒙古族建立的大一统王朝，疆域辽阔' },
    { name: '明', start: 1368, end: 1644, color: '#b0302a', range: '1368年—1644年', desc: '郑和下西洋，修筑长城与紫禁城' },
    { name: '清', start: 1644, end: 1912, color: '#c9a13a', range: '1644年—1912年', desc: '最后一个封建王朝，晚期遭列强侵略' },
    { name: '中华民国', start: 1912, end: 1949, color: '#3b5b92', range: '1912年—1949年', desc: '推翻帝制，历经军阀混战与抗日战争' },
    { name: '中华人民共和国', start: 1949, end: 1990, color: '#c23a2e', range: '1949年至今', desc: '1949年10月1日成立' }
  ];

  var TICK_YEARS = [-1500000, -1000000, -500000, -200000, -100000, -50000, -20000, -10000, -5000, -4000, -3000];
  for (var ty = -2500; ty <= 1900; ty += 100) TICK_YEARS.push(ty);
  for (ty = 1910; ty <= 1980; ty += 10) TICK_YEARS.push(ty);

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
      img.addEventListener('error', function onErr() {
        img.removeEventListener('error', onErr);
        var swap = function () {
          var ph = placeholder(cls, fallbackChar);
          ph.style.cssText = img.style.cssText;
          img.replaceWith(ph);
        };
        if (image.remote && img.src.indexOf(image.remote) === -1) { img.src = image.remote; img.addEventListener('error', swap); }
        else swap();
      });
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
  var events = load();

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (Array.isArray(data)) return data;
      }
    } catch (e) { /* 忽略，使用默认数据 */ }
    return clone(window.DEFAULT_EVENTS || []);
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
      return true;
    } catch (e) {
      toast('浏览器存储空间不足，修改仅在本次访问中有效');
      return false;
    }
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
  var SIZES = [46000, 36000, 27000, 19000];         // 图片面积候选（px²），优先用大的
  var MAJOR_SIZES = [66000, 52000, 40000, 28000];   // 重大事件用更大的图
  var SIDE_TEXT_W = 150, MIN_STACK_W = 172, MAX_IMG_W = 420, MIN_IMG_SIDE = 56;

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
    width = Math.round(width);
    var key = [ev.id, width, kind, ev.major ? 1 : 0, ev.date, ev.title, summaryOf(ev)].join('|');
    if (textCache[key]) return textCache[key];
    if (!measurer) {
      measurer = el('div');
      measurer.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;display:flex;flex-direction:column;border:1px solid transparent;';
      document.body.appendChild(measurer);
    }
    measurer.className = 'measure k-' + kind + (ev.major ? ' major' : '');
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
    if (iw > MAX_IMG_W) { iw = MAX_IMG_W; ih = iw / r; }
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
    var minGap = Math.round(40 * s);
    var cards = [], links = [];             // 已放置的卡片与连线（用于碰撞检测）
    var xs = [], anchors = [], placed = [];
    var base = list.length ? rawPos(list[0].year) : 0;
    var prevX = -Infinity, prevSide = 0, prevSame = 0;

    // 放入新卡片后，任意一屏宽度内的卡片（按中心计）不超过 MAX_PER_SCREEN 个
    var centers = [];
    var screenW = viewW();
    function densityOk(cx) {
      var near = [cx];
      for (var i = centers.length - 1; i >= 0; i--) {
        if (Math.abs(centers[i] - cx) < screenW) near.push(centers[i]);
      }
      if (near.length <= MAX_PER_SCREEN) return true;
      near.sort(function (a, b) { return a - b; });
      for (var j = 0; j + MAX_PER_SCREEN < near.length; j++) {
        if (near[j + MAX_PER_SCREEN] - near[j] < screenW) return false;
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
      (ev.major ? MAJOR_SIZES : SIZES).forEach(function (area, si) {
        KINDS.forEach(function (kind) {
          var sh = shapeFor(ev, r, area * s * s, kind, maxH);
          if (!sh || sh.w > maxW) return;
          // 越大越好；与上一个事件换一种图文关系；竖图适合左右排，横图适合上下排
          sh.cost = si * 16 + (kind === prevKind ? 14 : 0)
            + (kind === 'stack' ? (r < 0.85 ? 18 : 0) : (r > 1.7 ? 18 : 0))
            + (kind === 'right' ? 4 : 0);
          shapes.push(sh);
        });
      });
      if (!shapes.length) shapes.push({ kind: 'stack', iw: 120, ih: 90, w: MIN_STACK_W + 2, h: Math.min(maxH, 90 + textHeight(ev, MIN_STACK_W, 'stack') + 2), cost: 0 });
      var x0 = Math.max(PAD + (rawPos(ev.year) - base) * 1, prevX + minGap, PAD);
      var best = null;

      for (var tries = 0; tries < 2000 && !best; tries++) {
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

  function renderTimeline() {
    ensureRatios();
    computeLayout();
    var W = layout.width;
    track.style.width = W + 'px';
    $('axis').style.width = W + 'px';
    $('axisHit').style.width = W + 'px';

    // 朝代色带
    var eras = $('eras');
    eras.innerHTML = '';
    var minX = 0, maxX = W;
    ERAS.forEach(function (era) {
      var x1 = clamp(xOfYear(era.start), minX, maxX), x2 = clamp(xOfYear(era.end), minX, maxX);
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
    TICK_YEARS.forEach(function (y) {
      var x = xOfYear(y);
      if (x < 20 || x > W - 20 || x - lastX < 96) return;
      if (layout.xs.some(function (ex) { return Math.abs(ex - x) < 22; })) return;   // 避开事件连线
      lastX = x;
      var t = el('div', 'tick');
      t.style.left = x + 'px';
      t.appendChild(el('span', null, tickLabel(y)));
      ticks.appendChild(t);
    });

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
      svg.appendChild(path);

      var dot = el('div', 'dot');
      dot.style.left = layout.xs[i] + 'px';
      box.appendChild(dot);

      var sh = pl.shape;
      var card = el('button', 'card k-' + sh.kind + (ev.major ? ' major' : '') + (pl.side < 0 ? ' up' : ' down'));
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
    track.style.transform = 'translate3d(' + offset + 'px,0,0)';
    updateViewIndicators();
    if (tipShown) hideEraTip();
  }
  var anim = null;
  function stopAnim() { if (anim) cancelAnimationFrame(anim); anim = null; }
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
  stage.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { animateTo(offset - viewW() * 0.6, 400); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { animateTo(offset + viewW() * 0.6, 400); e.preventDefault(); }
    else if (e.key === 'Home') { animateTo(0); e.preventDefault(); }
    else if (e.key === 'End') { animateTo(minOffset()); e.preventDefault(); }
  });
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
    return '约公元' + Math.min(1980, Math.round(y)) + '年';
  }

  function showEraTip(clientX, pinned) {
    if (!layout.anchors.length) return;
    var sr = stage.getBoundingClientRect();
    var vx = clamp(clientX - sr.left, 0, sr.width);
    var tx = vx - offset, y = yearOfX(tx);
    if (y == null) return;
    // 指针靠近某个事件点时，直接使用该事件的年份
    for (var i = 0; i < layout.xs.length; i++) {
      if (Math.abs(layout.xs[i] - tx) <= 7) { y = layout.list[i].year; break; }
    }
    y = clamp(y, ERAS[0].start, 1980);
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
  function renderMinimap() {
    Array.prototype.slice.call(minimap.querySelectorAll('i')).forEach(function (n) { n.remove(); });
    var W = layout.width || 1;
    layout.xs.forEach(function (x) {
      var m = el('i');
      m.style.left = (x / W * 100) + '%';
      minimap.appendChild(m);
    });
  }
  function updateViewIndicators() {
    var W = layout.width || 1;
    var left = -offset / W, width = Math.min(1, viewW() / W);
    minimapView.style.left = (left * 100) + '%';
    minimapView.style.width = (width * 100) + '%';
    var y = yearAtX(-offset + viewW() / 2);
    $('currentEra').textContent = y == null ? '' : eraOf(y).name;
  }
  var mmDown = false;
  function minimapJump(e) {
    var r = minimap.getBoundingClientRect();
    var p = clamp((e.clientX - r.left) / r.width, 0, 1);
    setOffset(viewW() / 2 - p * layout.width);
  }
  minimap.addEventListener('pointerdown', function (e) {
    mmDown = true; stopAnim(); minimapJump(e);
    try { minimap.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
  });
  minimap.addEventListener('pointermove', function (e) { if (mmDown) minimapJump(e); });
  minimap.addEventListener('pointerup', function () { mmDown = false; });
  minimap.addEventListener('pointercancel', function () { mmDown = false; });

  // 重新排版并保持当前屏幕中心的年代不变
  var relayoutT;
  function scheduleRelayout() {
    clearTimeout(relayoutT);
    relayoutT = setTimeout(function () {
      var centerYear = yearAtX(-offset + viewW() / 2);
      renderTimeline();
      if (centerYear != null) setOffset(viewW() / 2 - xOfYear(centerYear));
    }, 150);
  }
  // 舞台尺寸变化（窗口缩放、字体加载后顶栏高度变化等）都会重新排版
  var lastSize = '';
  function onStageResize() {
    var size = stage.clientWidth + 'x' + stage.clientHeight;
    if (size === lastSize) return;
    lastSize = size;
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
    $(id).hidden = true;
    openStack = openStack.filter(function (x) { return x !== id; });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) {
    m.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeModal(m.id);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
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
    detailId = id;
    var imgs = ev.images || [];
    var hero = $('detailHero');
    hero.innerHTML = '';
    var h = imageEl(imgs[0], '', ev.title);
    if (imgs[0]) h.addEventListener('click', function () { openLightbox(imgs, 0); });
    hero.appendChild(h);
    $('detailDate').textContent = ev.date || formatYear(ev.year);
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
    if (ev.source) {
      src.appendChild(document.createTextNode('资料来源：'));
      var a = el('a', null, ev.source.indexOf('wikipedia.org') > -1 ? '维基百科' : ev.source);
      a.href = ev.source; a.target = '_blank'; a.rel = 'noopener';
      src.appendChild(a);
      if (ev.source.indexOf('wikipedia.org') > -1) src.appendChild(document.createTextNode('（文字与图片遵循 CC BY-SA 等相应许可）'));
    }
    openModal('detailModal');
    $('detailModal').querySelector('.modal-card').scrollTop = 0;
  }
  $('detailEdit').addEventListener('click', function () {
    closeModal('detailModal');
    openEditor(detailId);
  });
  $('detailDelete').addEventListener('click', function () { askDelete(detailId); });

  function askDelete(id) {
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
    img.src = im.full || im.src;
    img.alt = im.caption || '';
    $('lightboxCaption').textContent = (im.caption || '') + (lb.imgs.length > 1 ? '  (' + (lb.i + 1) + '/' + lb.imgs.length + ')' : '');
    var many = lb.imgs.length > 1;
    document.querySelector('.lb-prev').hidden = !many;
    document.querySelector('.lb-next').hidden = !many;
  }
  function closeLightbox() { $('lightbox').hidden = true; }
  $('lightboxImg').addEventListener('error', function () {
    var im = lb.imgs[lb.i];
    if (im && im.full && this.src.indexOf(im.src) === -1) this.src = im.src;
  });
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
    var ev = id ? findEvent(id) : null;
    editingId = ev ? ev.id : null;
    $('editTitle').textContent = ev ? '编辑事件' : '添加新事件';
    form.reset();
    form.title.value = ev ? ev.title : '';
    var y = ev ? ev.year : 1980;
    form.era.value = y < 0 ? 'bce' : 'ce';
    form.yearAbs.value = Math.abs(y) || 1;
    form.date.value = ev ? (ev.date || '') : '';
    form.short.value = ev ? (ev.short || '') : '';
    form.detail.value = ev ? (ev.detail || '') : '';
    form.source.value = ev ? (ev.source || '') : '';
    form.major.checked = !!(ev && ev.major);
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
      box.appendChild(slot);
    });
    var full = draftImages.length >= MAX_IMAGES;
    $('imageUrlInput').disabled = full;
    $('imageUrlAdd').disabled = full;
    $('imageFileInput').disabled = full;
  }

  function addImageUrl() {
    var inp = $('imageUrlInput');
    var url = inp.value.trim();
    if (!url) return;
    if (!/^(https?:|data:image\/)/i.test(url)) { $('formError').textContent = '请输入以 http(s) 开头的图片网址'; return; }
    if (draftImages.length >= MAX_IMAGES) { $('formError').textContent = '最多只能添加 9 张图片'; return; }
    draftImages.push({ src: url, caption: '' });
    inp.value = '';
    $('formError').textContent = '';
    renderImageEditor();
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

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var title = form.title.value.trim();
    var yAbs = parseInt(form.yearAbs.value, 10);
    var err = '';
    if (!title) err = '请填写事件名称';
    else if (!yAbs || yAbs < 1) err = '请填写有效的年份（正整数）';
    else if (form.detail.value.length > MAX_DETAIL) err = '详细说明不能超过 350 字';
    else if (charCount(form.short.value) < MIN_SUMMARY && charCount(form.detail.value) < MIN_SUMMARY) err = '请至少填写 20 字的说明（简要说明或详细说明），时间轴上会显示这段文字';
    if (err) { $('formError').textContent = err; return; }
    var year = form.era.value === 'bce' ? -yAbs : yAbs;
    var data = {
      title: title,
      year: year,
      date: form.date.value.trim() || formatYear(year),
      short: form.short.value.trim(),
      detail: form.detail.value.trim(),
      images: draftImages.slice(0, MAX_IMAGES),
      source: form.source.value.trim(),
      major: form.major.checked
    };
    var id;
    if (editingId) {
      var ev = findEvent(editingId);
      Object.keys(data).forEach(function (k) { ev[k] = data[k]; });
      id = ev.id;
    } else {
      data.id = id = uid();
      events.push(data);
    }
    save();
    closeModal('editModal');
    renderTimeline();
    renderList();
    focusEvent(id);
    toast(editingId ? '已保存修改' : '已添加新事件');
    if (editingId && openStack.indexOf('detailModal') < 0 && !sidebarOpen) openDetail(id);
  });

  $('addBtn').addEventListener('click', function () { openEditor(null); });

  // ---------- 侧栏 ----------
  var sidebarOpen = false;
  var activeListId = null;
  function openSidebar() {
    sidebarOpen = true;
    renderList();
    $('sidebarScrim').hidden = false;
    $('sidebar').classList.add('open');
    $('sidebar').setAttribute('aria-hidden', 'false');
    var a = $('eventList').querySelector('.active');
    if (a) a.scrollIntoView({ block: 'center' });
  }
  function closeSidebar() {
    sidebarOpen = false;
    $('sidebarScrim').hidden = true;
    $('sidebar').classList.remove('open');
    $('sidebar').setAttribute('aria-hidden', 'true');
  }
  $('browseBtn').addEventListener('click', openSidebar);
  $('closeSidebar').addEventListener('click', closeSidebar);
  $('sidebarScrim').addEventListener('click', closeSidebar);
  $('searchInput').addEventListener('input', renderList);

  function renderList() {
    var q = $('searchInput').value.trim().toLowerCase();
    var list = sorted().filter(function (ev) {
      if (!q) return true;
      return [ev.title, ev.short, ev.detail, ev.date, formatYear(ev.year)].join(' ').toLowerCase().indexOf(q) > -1;
    });
    $('eventCount').textContent = q ? '（' + list.length + ' / ' + events.length + '）' : '（' + events.length + '）';
    var ol = $('eventList');
    ol.innerHTML = '';
    if (!list.length) {
      ol.appendChild(el('li', 'list-empty', q ? '没有找到匹配的事件' : '暂无事件，点击右下角“+”添加'));
      return;
    }
    list.forEach(function (ev) {
      var li = el('li', 'list-item' + (ev.id === activeListId ? ' active' : ''));
      var row = el('button', 'list-row');
      row.type = 'button';
      row.appendChild(imageEl(ev.images && ev.images[0], 'list-thumb', ev.title));
      var meta = el('div', 'list-meta');
      meta.appendChild(el('div', 'list-date', ev.date || formatYear(ev.year)));
      meta.appendChild(el('div', 'list-title', ev.title));
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
        var ed = el('button', 'btn btn-primary btn-small', '编辑');
        ed.type = 'button';
        ed.addEventListener('click', function () { openEditor(ev.id); });
        var del = el('button', 'btn btn-danger btn-small', '删除');
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
      events = clone(window.DEFAULT_EVENTS || []);
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

  // ---------- 启动 ----------
  renderTimeline();
  lastSize = stage.clientWidth + 'x' + stage.clientHeight;
  setOffset(0);
  stage.focus({ preventScroll: true });
})();
