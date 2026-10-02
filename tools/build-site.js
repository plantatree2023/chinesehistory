#!/usr/bin/env node
// 生成部署用的网站目录（默认 _site/），供 Cloudflare Pages 构建使用：
// 只复制网页需要的文件（与 .github/workflows/deploy.yml 相同），并写入 version.json
// 用法：node tools/build-site.js [输出目录]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SITE_FILES = ['index.html', '404.html', 'css', 'js', 'data', 'images', 'audio', 'textures'];

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function build(outDir) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of SITE_FILES) {
    fs.cpSync(path.join(ROOT, name), path.join(outDir, name), { recursive: true });
  }
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
  fs.copyFileSync(path.join(ROOT, '_headers'), path.join(outDir, '_headers'));

  // Cloudflare Pages 提供 CF_PAGES_COMMIT_SHA，GitHub Actions 提供 GITHUB_SHA
  const sha = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || git('rev-parse', 'HEAD');
  const version = {
    updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    commit: sha.slice(0, 7),
    commitAt: git('log', '-1', '--format=%cI'),
    source: 'deploy',
  };
  fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(version) + '\n');
  return version;
}

if (require.main === module) {
  const outDir = path.resolve(process.argv[2] || path.join(ROOT, '_site'));
  const version = build(outDir);
  console.log(`已生成 ${outDir}`, JSON.stringify(version));
}

module.exports = { build, SITE_FILES };
