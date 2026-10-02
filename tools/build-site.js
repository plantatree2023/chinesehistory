#!/usr/bin/env node
// 生成部署用的网站目录（默认 _site/），GitHub Pages（.github/workflows/deploy.yml）和 Cloudflare Pages 共用：
// 复制网页需要的文件，为 data/ 下每个数据集的每个事件生成静态页（不依赖脚本，供搜索引擎收录和分享），
// 并写入 sitemap.xml、robots.txt 和 version.json。
// 事件页每次部署时按当时的数据重新生成，新增 / 修改事件或新增数据集都不需要改代码，生成的页面也不提交到仓库：
//   默认数据集 cn_zh：e/<事件id>.html
//   其他数据集：     e/<数据集>/<事件id>.html（链接带 ?data=<数据集>）
// 用法：node tools/build-site.js [输出目录]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SITE_FILES = ['index.html', '404.html', 'css', 'js', 'data', 'images', 'audio', 'textures'];
const DEFAULT_DATASET = 'cn_zh';
// 与 js/app.js 的 DATASET_ID 相同：<国家>_<语言>[-变体]
const DATASET_ID = /^[a-z]{2}_[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
const SITE_NAME = '时间上的中国';
// 绝对地址（canonical、sitemap、og:image）取自 package.json 的 homepage，以 / 结尾
const HOMEPAGE = require('../package.json').homepage.replace(/\/?$/, '/');

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

// 数据集对应的地址：事件页所在目录、回到网站根目录的相对路径、首页网址参数
function datasetPaths(ds) {
  const isDefault = ds === DEFAULT_DATASET;
  return {
    dir: isDefault ? 'e/' : `e/${ds}/`,
    up: isDefault ? '../' : '../../',
    query: isDefault ? '' : `data=${encodeURIComponent(ds)}`,
  };
}
const eventPath = (ds, ev) => `${datasetPaths(ds).dir}${encodeURIComponent(ev.id)}.html`;

// 与 js/app.js 相同的规则
function eraOf(eras, y) {
  if (!eras.length) return null;
  for (let i = eras.length - 1; i >= 0; i--) if (y >= eras[i].start) return eras[i];
  return eras[0];
}
const isWikipedia = (s) => /^https?:\/\/[^/]*wikipedia\.org\//.test(s.url);
const sourceLabel = (s) => s.title || (isWikipedia(s) ? '维基百科' : s.url);

function eventPage(ds, ev, eras, prev, next) {
  const { up, query } = datasetPaths(ds);
  const home = up + (query ? `?${query}` : '');
  const url = HOMEPAGE + eventPath(ds, ev);
  const title = `${ev.title} · ${SITE_NAME}`;
  const desc = ev.short || '';
  const era = eraOf(eras, ev.year);
  const images = (Array.isArray(ev.images) ? ev.images : []).filter((im) => im && im.src);
  const sources = (Array.isArray(ev.sources) ? ev.sources : []).filter((s) => s && s.url);
  const paras = String(ev.detail || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const ogImage = images.length
    ? `
  <meta property="og:image" content="${esc(HOMEPAGE + images[0].src)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${esc(HOMEPAGE + images[0].src)}">`
    : `
  <meta name="twitter:card" content="summary">`;
  const figure = (im) => `
      <figure class="ev-figure">
        <img src="${up}${esc(im.src)}"${im.w && im.h ? ` width="${im.w}" height="${im.h}"` : ''} alt="${esc(im.caption || ev.title)}" loading="lazy" decoding="async">${im.caption ? `
        <figcaption>${esc(im.caption)}</figcaption>` : ''}
      </figure>`;
  const navLink = (e, rel, label) => e
    ? `<a class="ev-${rel}" rel="${rel}" href="${encodeURIComponent(e.id)}.html"><span>${label}</span>${esc(e.title)}</a>`
    : '<span></span>';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:locale" content="zh_CN">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">${ogImage}
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect x='4' y='4' width='56' height='56' rx='8' fill='%23b0302a'/%3E%3Ctext x='32' y='44' font-size='34' text-anchor='middle' fill='%23fff' font-family='serif'%3E史%3C/text%3E%3C/svg%3E">
  <link rel="stylesheet" href="${up}css/style.css">
  <link rel="stylesheet" href="${up}css/event.css">
  <script>
    // 与首页相同：沿用访问者选过的配色
    (function () {
      var t = null;
      try { t = localStorage.getItem('zh-history-timeline:theme'); } catch (e) {}
      document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
    })();
  </script>
</head>
<body class="event-page">
  <header class="ev-top"><a class="ev-home" href="${esc(home)}">${SITE_NAME}</a></header>
  <main class="ev-main">
    <article class="ev-article" data-id="${esc(ev.id)}" data-dataset="${esc(ds)}">${era ? `
      <p class="ev-era" style="--era-color: ${esc(era.color)}"><span class="ev-era-dot"></span>${esc(era.name)}<span class="ev-era-range">${esc(era.range)}</span></p>` : ''}
      <h1 class="ev-title">${esc(ev.title)}</h1>
      <p class="ev-date">${esc(ev.date)}${ev.transition ? ` · ${esc(ev.transition.from)} → ${esc(ev.transition.to)}` : ''}</p>
      <p class="ev-short">${esc(desc)}</p>
      <a class="ev-open" href="${up}?${esc(query ? `${query}&` : '')}id=${encodeURIComponent(ev.id)}">在时间轴中查看</a>${images.slice(0, 1).map(figure).join('')}
      <div class="ev-detail">${paras.map((p) => `
        <p>${esc(p)}</p>`).join('')}
      </div>${images.length > 1 ? `
      <div class="ev-gallery">${images.slice(1).map(figure).join('')}
      </div>` : ''}${sources.length ? `
      <section class="ev-sources">
        <h2>参考链接</h2>
        <ul>${sources.map((s) => `
          <li><a href="${esc(s.url)}" rel="noopener">${esc(sourceLabel(s))}</a></li>`).join('')}
        </ul>${sources.some(isWikipedia) ? `
        <p class="ev-note">来自维基百科的文字与图片遵循 CC BY-SA 等相应许可</p>` : ''}
      </section>` : ''}
    </article>
    <nav class="ev-nav" aria-label="上一个 / 下一个事件">
      ${navLink(prev, 'prev', '上一个事件')}
      ${navLink(next, 'next', '下一个事件')}
    </nav>
  </main>
  <footer class="ev-foot"><a href="${esc(home)}">返回首页 · ${SITE_NAME}</a></footer>
</body>
</html>
`;
}

// data/ 下的数据集名（文件名符合 <国家>_<语言>.json），默认数据集在最前
function listDatasets(dataDir) {
  return fs.readdirSync(dataDir)
    .filter((f) => f.endsWith('.json') && DATASET_ID.test(f.slice(0, -5)))
    .map((f) => f.slice(0, -5))
    .sort((a, b) => (b === DEFAULT_DATASET) - (a === DEFAULT_DATASET) || a.localeCompare(b));
}

// 数据集中可以生成页面的事件，按年份排列（与时间轴相同）；缺少 id / 标题的事件、重复的 id 跳过
function datasetEvents(data) {
  const seen = new Set();
  return (Array.isArray(data.events) ? data.events : [])
    .map((ev, i) => ({ ev, i }))
    .filter(({ ev }) => ev && typeof ev.id === 'string' && /^[A-Za-z0-9_-]+$/.test(ev.id) && ev.title && !seen.has(ev.id) && seen.add(ev.id))
    .sort((a, b) => (Number(a.ev.year) || 0) - (Number(b.ev.year) || 0) || a.i - b.i)
    .map((x) => x.ev);
}

// 为 dataDir 下所有数据集生成事件页、sitemap.xml 和 robots.txt；返回 { 数据集: 事件列表 }
function buildEventPages(outDir, dataDir = path.join(ROOT, 'data')) {
  const result = {};
  const urls = [HOMEPAGE];
  for (const ds of listDatasets(dataDir)) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dataDir, `${ds}.json`), 'utf8'));
    } catch (e) {
      console.warn(`跳过 ${ds}.json：${e.message}`);
      continue;
    }
    const events = datasetEvents(data);
    const eras = Array.isArray(data.eras) ? data.eras.filter((e) => e && typeof e.start === 'number') : [];
    fs.mkdirSync(path.join(outDir, datasetPaths(ds).dir), { recursive: true });
    events.forEach((ev, i) => {
      fs.writeFileSync(path.join(outDir, eventPath(ds, ev)), eventPage(ds, ev, eras, events[i - 1], events[i + 1]));
      urls.push(HOMEPAGE + eventPath(ds, ev));
    });
    result[ds] = events;
  }
  fs.writeFileSync(path.join(outDir, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${esc(u)}</loc></url>\n`).join('') + '</urlset>\n');
  fs.writeFileSync(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${HOMEPAGE}sitemap.xml\n`);
  return result;
}

function build(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of SITE_FILES) {
    fs.cpSync(path.join(ROOT, name), path.join(outDir, name), { recursive: true });
  }
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
  fs.copyFileSync(path.join(ROOT, '_headers'), path.join(outDir, '_headers'));
  const pages = buildEventPages(outDir);

  // Cloudflare Pages 提供 CF_PAGES_COMMIT_SHA，GitHub Actions 提供 GITHUB_SHA
  const sha = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || git('rev-parse', 'HEAD');
  const version = {
    updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    commit: sha.slice(0, 7),
    commitAt: git('log', '-1', '--format=%cI'),
    source: 'deploy',
  };
  fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(version) + '\n');
  return { version, pages };
}

if (require.main === module) {
  const outDir = path.resolve(process.argv[2] || path.join(ROOT, '_site'));
  const { version, pages } = build(outDir);
  const counts = Object.entries(pages).map(([ds, evs]) => `${ds} ${evs.length} 页`).join('，');
  console.log(`已生成 ${outDir}（事件页：${counts}）`, JSON.stringify(version));
}

module.exports = { build, buildEventPages, listDatasets, datasetPaths, eventPath, SITE_FILES, HOMEPAGE, DEFAULT_DATASET, DATASET_ID };
