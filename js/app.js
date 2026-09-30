(function () {
  'use strict';

  var STORAGE_KEY = 'zh-history-timeline:v1';
  var MAX_IMAGES = 9;
  var MAX_DETAIL = 350;

  // 朝代 / 时期色带（用于时间轴着色与“当前时代”提示）
  var ERAS = [
    { name: '旧石器时代', start: -2000000, end: -10000, color: '#8d8373' },
    { name: '新石器时代', start: -10000, end: -2070, color: '#a39170' },
    { name: '夏', start: -2070, end: -1600, color: '#7d6b4f' },
    { name: '商', start: -1600, end: -1046, color: '#8a5a3b' },
    { name: '西周', start: -1046, end: -771, color: '#6f7a45' },
    { name: '春秋', start: -770, end: -476, color: '#58804f' },
    { name: '战国', start: -475, end: -221, color: '#3f7160' },
    { name: '秦', start: -221, end: -207, color: '#2b2b2b' },
    { name: '西汉', start: -206, end: 8, color: '#a8322a' },
    { name: '新', start: 9, end: 23, color: '#7a5a8a' },
    { name: '东汉', start: 25, end: 220, color: '#b8503c' },
    { name: '三国', start: 220, end: 280, color: '#5d6b8a' },
    { name: '晋', start: 280, end: 420, color: '#4f7f8f' },
    { name: '南北朝', start: 420, end: 589, color: '#6c8a7a' },
    { name: '隋', start: 589, end: 618, color: '#9a7a3a' },
    { name: '唐', start: 618, end: 907, color: '#c0892f' },
    { name: '五代十国', start: 907, end: 960, color: '#8c7a6b' },
    { name: '北宋', start: 960, end: 1127, color: '#3f7f86' },
    { name: '南宋', start: 1127, end: 1279, color: '#5b9098' },
    { name: '元', start: 1279, end: 1368, color: '#4a5d8c' },
    { name: '明', start: 1368, end: 1644, color: '#b0302a' },
    { name: '清', start: 1644, end: 1912, color: '#c9a13a' },
    { name: '中华民国', start: 1912, end: 1949, color: '#3b5b92' },
    { name: '中华人民共和国', start: 1949, end: 1990, color: '#c23a2e' }
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
        if (image.remote && img.src.indexOf(image.remote) === -1) { img.src = image.remote; img.addEventListener('error', function () { img.replaceWith(placeholder(cls, fallbackChar)); }); }
        else img.replaceWith(placeholder(cls, fallbackChar));
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
  function rawPos(y) {
    if (y >= -3000) return (y + 3000) * 0.9;
    return -Math.log10(-y / 3000) * 380;
  }

  // 卡片样式：尺寸不同，图文关系不同
  var VARIANTS = {
    tall:    { w: 196, h: 248 },   // 上图下文，图占约三分之二
    wide:    { w: 330, h: 150 },   // 左图右文，图占约六成
    mirror:  { w: 330, h: 150 },   // 右图左文
    mini:    { w: 176, h: 150 },   // 小图，标题压在图上
    overlay: { w: 256, h: 186 },   // 整图 + 文字压在图片下缘
    feature: { w: 304, h: 290 }    // 重大事件：大图
  };
  var PATTERN = ['tall', 'mini', 'wide', 'overlay', 'mini', 'mirror', 'tall', 'overlay', 'wide', 'mini', 'mirror', 'tall', 'mini', 'overlay'];

  function variantFor(ev, i) {
    return ev.major ? 'feature' : PATTERN[i % PATTERN.length];
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
    var s = clamp(H / 680, 0.7, 1.12);
    var band = Math.round(30 * s);          // 轴线附近留给刻度和朝代名的空间
    var half = axisY - 12;                  // 卡片离舞台边缘至少 12px
    var maxW = Math.max(150, viewW() - 48);
    var minGap = Math.round(40 * s);
    var cards = [], links = [];             // 已放置的卡片与连线（用于碰撞检测）
    var xs = [], anchors = [], placed = [];
    var base = list.length ? rawPos(list[0].year) : 0;
    var prevX = -Infinity, prevSide = 0, prevSame = 0;

    function free(rect, isCard) {
      var i, g = isCard ? CARD_GAP : LINK_GAP;
      for (i = cards.length - 1; i >= 0 && i >= cards.length - 30; i--) if (hit(rect, cards[i], g)) return false;
      for (i = links.length - 1; i >= 0 && i >= links.length - 90; i--) if (hit(rect, links[i], isCard ? LINK_GAP : 3)) return false;
      return true;
    }

    list.forEach(function (ev, i) {
      var vname = variantFor(ev, i), v = VARIANTS[vname];
      var w = Math.min(maxW, Math.round(v.w * s)), h = Math.round(v.h * s);
      if (h > half - band) h = Math.round(half - band);
      var x0 = Math.max(PAD + (rawPos(ev.year) - base) * 1, prevX + minGap, PAD);
      var best = null;

      for (var tries = 0; tries < 400 && !best; tries++) {
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
              opts.push({ left: x0 + e, kind: 'side', cost: 30 + e * 0.3 });        // 竖直后折入卡片左侧
              opts.push({ left: x0 - w - e, kind: 'side', cost: 40 + e * 0.3 });    // 折入卡片右侧
            });
            opts.forEach(function (o) {
              var L = Math.round(o.left);
              if (L < 10) return;
              var rect = { l: L, r: L + w, t: top, b: top + h };
              var segs, pts, ay = axisY + side * 8;
              if (o.kind === 'straight') {
                pts = [[x0, ay], [x0, edgeY]];
              } else if (o.kind === 'side') {
                if (d < band + 12) return;
                var yy = side < 0 ? Math.max(cy, top + 14) : Math.min(cy, top + h - 14);
                var ex = L > x0 ? L : L + w;
                pts = [[x0, ay], [x0, yy], [ex, yy]];
              }
              if (!free(rect, true)) return;
              segs = [];
              for (var k = 1; k < pts.length; k++) {
                var sr = segRect(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
                // 最后一段贴着卡片本身，不与自身比较
                if (!free(sr, false)) return;
                segs.push(sr);
              }
              var cost = (d - band) * 0.55 + o.cost
                + Math.max(0, L + w - x0) * 0.05
                + (side === prevSide ? 14 + prevSame * 26 : 0)
                + jitter(i, d + o.left) * 16;
              if (!best || cost < best.cost) best = { cost: cost, rect: rect, segs: segs, pts: pts, side: side };
            });
          }
        });
        if (!best) x0 += 14;
      }
      if (!best) {                       // 理论上不会发生：兜底放在轴上方
        var tp = axisY - band - h;
        best = { rect: { l: x0 - w / 2, r: x0 + w / 2, t: tp, b: tp + h }, segs: [], pts: [[x0, axisY], [x0, tp + h]], side: -1 };
      }
      cards.push(best.rect);
      Array.prototype.push.apply(links, best.segs);
      prevSame = best.side === prevSide ? prevSame + 1 : 0;
      prevSide = best.side;
      prevX = x0;
      xs.push(x0);
      anchors.push({ r: rawPos(ev.year), x: x0 });
      placed.push({ variant: vname, rect: best.rect, pts: best.pts, side: best.side });
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
  // 横坐标 -> 年份（用于显示当前时代）
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
    computeLayout();
    var W = layout.width;
    track.style.width = W + 'px';
    $('axis').style.width = W + 'px';

    // 朝代色带
    var eras = $('eras');
    eras.innerHTML = '';
    var minX = 0, maxX = W;
    ERAS.forEach(function (era) {
      var x1 = clamp(xOfYear(era.start), minX, maxX), x2 = clamp(xOfYear(era.end), minX, maxX);
      if (x2 - x1 < 2) return;
      var d = el('div', 'era');
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

      var card = el('button', 'card v-' + pl.variant + (pl.side < 0 ? ' up' : ' down'));
      card.type = 'button';
      card.dataset.id = ev.id;
      card.style.left = r.l + 'px';
      card.style.top = r.t + 'px';
      card.style.width = (r.r - r.l) + 'px';
      card.style.height = (r.b - r.t) + 'px';
      card.setAttribute('aria-label', (ev.date || formatYear(ev.year)) + ' ' + ev.title);
      card.appendChild(imageEl(ev.images && ev.images[0], 'card-img', ev.title));
      var body = el('div', 'card-body');
      body.appendChild(el('div', 'card-date', ev.date || formatYear(ev.year)));
      body.appendChild(el('div', 'card-title', ev.title));
      if (ev.short) body.appendChild(el('p', 'card-short', ev.short));
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
  }

  // ---------- 平移 / 拖拽 ----------
  function viewW() { return stage.clientWidth; }
  function minOffset() { return Math.min(0, viewW() - layout.width); }
  function setOffset(v) {
    offset = clamp(v, minOffset(), 0);
    track.style.transform = 'translate3d(' + offset + 'px,0,0)';
    updateViewIndicators();
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

  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      var centerYear = yearAtX(-offset + viewW() / 2);
      renderTimeline();
      if (centerYear != null) setOffset(viewW() / 2 - xOfYear(centerYear));
    }, 120);
  });

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
        cb(c.toDataURL('image/jpeg', 0.8));
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
      resizeFile(f, 900, function (data) {
        if (!data || draftImages.length >= MAX_IMAGES) return;
        draftImages.push({ src: data, caption: f.name.replace(/\.[^.]+$/, '') });
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

  // ---------- 启动 ----------
  renderTimeline();
  setOffset(0);
  stage.focus({ preventScroll: true });
})();
