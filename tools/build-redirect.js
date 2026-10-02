#!/usr/bin/env node
// 生成旧地址（GitHub Pages：plantatree2023.github.io/chinesehistory/）用的跳转网站：
// 网站已迁到 package.json 的 homepage（Cloudflare）。正式网站的每个网页（首页、事件页）在旧地址都有一个同名的跳转页，
// 带着原来的网址参数和 # 跳到新地址的同一页（已分享的 ?id= 链接仍然有效）；其他不存在的地址由 404.html 按路径跳转。
// 跳转页带 canonical 和 meta refresh，搜索引擎会把收录转到新地址。
// 用法：node tools/build-redirect.js [输出目录]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { build, HOMEPAGE } = require('./build-site');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// target 为空时（404.html）由脚本按当前路径计算：去掉 GitHub Pages 项目网站的 /<仓库名>/ 前缀
function redirectPage(target) {
  const js = target
    ? `var to = ${JSON.stringify(target)};`
    : `var p = location.pathname.split('/').slice(/\\.github\\.io$/.test(location.hostname) ? 2 : 1).join('/');
      var to = ${JSON.stringify(HOMEPAGE)} + p;`;
  const head = target
    ? `
  <link rel="canonical" href="${esc(target)}">
  <meta http-equiv="refresh" content="0; url=${esc(target)}">`
    : `
  <meta name="robots" content="noindex">`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>时间上的中国</title>${head}
  <script>
    (function () {
      ${js}
      location.replace(to + location.search + location.hash);
    })();
  </script>
</head>
<body>
  <p style="font-family:serif;text-align:center;margin-top:40vh">网站已迁到 <a id="newSite" href="${esc(target || HOMEPAGE)}">${esc(HOMEPAGE)}</a></p>
</body>
</html>
`;
}

function htmlFiles(dir, rel = '') {
  return fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((d) => {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) return htmlFiles(dir, r);
    return d.name.endsWith('.html') ? [r] : [];
  });
}

function buildRedirect(outDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chinesehistory-site-'));
  try {
    build(tmp);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const pages = htmlFiles(tmp).filter((rel) => rel !== '404.html');
    for (const rel of pages) {
      const target = HOMEPAGE + (rel === 'index.html' ? '' : rel);
      fs.mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(outDir, rel), redirectPage(target));
    }
    fs.writeFileSync(path.join(outDir, '404.html'), redirectPage(null));
    fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
    return pages;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', '_site'));
  const pages = buildRedirect(outDir);
  console.log(`已生成跳转网站 ${outDir}：${pages.length} 个跳转页 + 404.html → ${HOMEPAGE}`);
}

module.exports = { buildRedirect, redirectPage };
