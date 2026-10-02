#!/usr/bin/env node
// 生成社交分享卡片用的图片（index.html 的 og:image / twitter:image 和 apple-touch-icon）：
//   images/share/cover.png             1200×630 封面图
//   images/share/apple-touch-icon.png  180×180 主屏幕图标
// 用 Playwright 的 Chromium 截图，标题字体、背景纹理和时期配色都取自网站本身。
// 用法：node tools/share-images.js [数据文件，默认 data/cn_zh.json]
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'images', 'share');
// 字体和纹理以 data URL 内嵌（about:blank 页面不能加载本地文件）
const MIME = { '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const fileUrl = (p) => `data:${MIME[path.extname(p)]};base64,${fs.readFileSync(path.join(ROOT, p)).toString('base64')}`;

// 封面上标出的朝代（字取自各时期名称，标题字体中都有这些字）
const MARKS = ['夏', '商', '周', '秦', '汉', '晋', '隋', '唐', '宋', '元', '明', '清'];

const TITLE_FONT = fileUrl('css/fonts/ma-shan-zheng-title.woff2');

// 印章里的“史”：网站的标题字体只包含用到的字，没有“史”，这里内嵌马善政毛笔楷书中该字的轮廓
// （SIL Open Font License 1.1，见 css/fonts/OFL-MaShanZheng.txt；字体单位 1000，基线 y=0，字形中心约在 (500, 354)）
const SHI_PATH = 'M413 801Q415 807 420 808Q425 808 442 805Q457 801 474 784L491 766L492 720L493 675L506 671Q520 668 573 663Q606 659 619 656Q632 653 645 645Q666 632 670 632Q673 632 683 620Q691 613 692 608Q693 603 689 585Q685 562 674 555Q666 550 652 532Q637 515 637 509Q637 506 616 482Q596 457 598 450Q599 442 592 424Q584 407 572 402Q561 397 535 401Q512 404 486 402Q467 401 464 398Q460 396 456 385Q452 371 452 364Q452 361 441 325Q430 289 424 272Q421 264 409 240Q401 223 400 218Q400 214 405 207Q414 199 444 178Q475 158 503 143Q542 123 607 99Q672 75 703 69Q726 64 765 56Q804 48 814 48Q824 48 836 41Q849 34 870 31Q893 28 906 16Q920 5 920 -8Q920 -36 886 -38Q871 -38 854 -44Q838 -50 838 -54Q838 -58 812 -74Q786 -89 780 -94Q770 -107 733 -90Q709 -80 691 -78Q667 -73 612 -47Q556 -21 510 8Q432 58 382 104Q352 134 348 134Q344 134 332 122Q321 110 321 105Q321 102 312 96Q302 90 276 64Q249 38 234 30Q220 23 200 7Q183 -6 154 -22Q124 -37 103 -42Q86 -48 81 -43Q76 -38 86 -30Q97 -22 109 -18Q117 -15 154 17Q191 49 198 57Q200 60 222 85Q240 105 270 144Q300 184 300 188Q300 193 266 236Q247 261 247 265Q247 269 216 301Q185 333 185 340Q185 346 201 352Q218 357 234 348Q249 340 290 301Q334 257 338 258Q342 260 350 286Q359 313 362 325Q366 337 370 354Q373 371 376 382Q377 390 376 392Q375 393 369 393Q358 393 343 387Q334 384 332 380Q329 376 329 367Q329 354 326 352Q322 350 305 351Q294 353 289 356Q284 360 274 374Q260 397 254 414Q248 432 235 489Q227 527 223 537Q220 545 215 570Q210 595 210 602Q210 607 218 607Q227 607 238 618Q249 630 260 637Q283 651 369 668Q402 675 404 677Q406 679 408 736Q410 794 413 801ZM397 488Q402 513 404 558Q406 604 404 616Q402 627 400 627Q374 624 336 612Q298 600 291 596Q283 589 282 578Q280 568 285 558Q291 547 293 523Q296 498 306 470Q315 441 320 442Q326 443 360 453L393 463ZM544 619 505 626Q494 628 491 626Q488 624 487 613Q484 597 481 584Q478 572 477 560Q476 547 472 514Q469 482 469 478Q469 475 480 475Q501 475 535 535Q551 563 551 565Q551 567 556 574Q561 579 566 596Q572 612 570 614Q568 615 544 619Z';

// 铺满容器的“史”字 SVG；scale 为字形占方框的比例
function shiSvg(scale, color) {
  return `<svg viewBox="0 0 1000 1000" width="100%" height="100%"><path fill="${color}" d="${SHI_PATH}"
    transform="translate(500 500) scale(${scale} -${scale}) translate(-500 -354)"/></svg>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function baseCss(texture) {
  return `
    @font-face { font-family: 'Title'; src: url(${TITLE_FONT}) format('woff2'); }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; }
    body {
      position: relative; overflow: hidden; background: #f3ecdf; color: #2a2521;
      font-family: "Noto Serif SC", "WenQuanYi Zen Hei", serif;
      background-image: radial-gradient(ellipse at 30% 35%, rgba(255,255,255,.6), transparent 60%),
                        radial-gradient(ellipse at 85% 90%, rgba(176,141,87,.16), transparent 55%);
    }
    .texture {
      position: absolute; inset: 0; background: #6b4a2b; opacity: ${texture ? texture.opacity * 1.3 : 0};
      -webkit-mask: url(${texture ? fileUrl(texture.src) : ''}) repeat 0 0 / ${texture ? texture.size : 240}px;
    }`;
}

function coverHtml(data) {
  const eras = data.eras;
  const segs = eras.map((e) => `<i style="background:${e.color}"></i>`).join('');
  const marks = MARKS.map((m) => `<span>${m}</span>`).join('');
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    ${baseCss(data.texture)}
    .frame { position: absolute; inset: 28px; border: 2px solid rgba(168,50,42,.55); border-radius: 6px; }
    .frame::after { content: ''; position: absolute; inset: 7px; border: 1px solid rgba(168,50,42,.3); border-radius: 3px; }
    .main { position: absolute; left: 96px; right: 96px; top: 0; bottom: 190px; display: flex; align-items: center; gap: 44px; }
    .seal {
      flex: none; width: 150px; height: 150px; border-radius: 14px; background: #a8322a; color: #fff;
      box-shadow: 0 10px 26px rgba(134,36,30,.28);
    }
    h1 { font-family: 'Title'; font-weight: normal; font-size: 116px; line-height: 1.1; letter-spacing: 6px; white-space: nowrap; }
    p { margin-top: 18px; font-size: 38px; color: #4a423b; letter-spacing: 3px; }
    .axis { position: absolute; left: 96px; right: 96px; bottom: 96px; }
    .marks { display: flex; justify-content: space-between; padding: 0 6px 14px; font-family: 'Title'; font-size: 40px; color: #4a423b; }
    .band { display: flex; height: 22px; border-radius: 11px; overflow: hidden; box-shadow: 0 2px 6px rgba(60,40,20,.18); }
    .band i { flex: 1; }
  </style></head><body>
    <div class="texture"></div>
    <div class="frame"></div>
    <div class="main">
      <div class="seal">${shiSvg(0.78, '#fff')}</div>
      <div><h1>${esc(data.title || '时间上的中国')}</h1><p>从远古到 1980 年 · 拖拽浏览中国历史</p></div>
    </div>
    <div class="axis"><div class="marks">${marks}</div><div class="band">${segs}</div></div>
  </body></html>`;
}

function iconHtml() {
  // iOS 会自动加圆角，图标本身铺满不留透明边
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; }
    body { width: 180px; height: 180px; background: #a8322a; }
  </style></head><body>${shiSvg(0.74, '#fff')}</body></html>`;
}

async function render(browser, html, width, height, out) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out });
  await page.close();
}

async function main() {
  const dataFile = path.resolve(ROOT, process.argv[2] || 'data/cn_zh.json');
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    await render(browser, coverHtml(data), 1200, 630, path.join(OUT_DIR, 'cover.png'));
    await render(browser, iconHtml(), 180, 180, path.join(OUT_DIR, 'apple-touch-icon.png'));
  } finally {
    await browser.close();
  }
  console.log(`已生成 ${path.relative(ROOT, OUT_DIR)}/cover.png、apple-touch-icon.png`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
