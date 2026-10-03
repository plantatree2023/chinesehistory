// 本地开发服务器：提供静态文件，并提供写入接口，使本地编辑直接保存到 data/<数据集>.json。
//
// 用法：
//   node server.js                 可写模式（npm start），修改会写入仓库中的数据文件和 images/
//   node server.js --readonly      只读模式，不提供写入接口（与 GitHub Pages 行为一致，供自动化测试使用）
//   node server.js --port 8080     指定端口，默认 4173
//   node server.js --test-data tests/data   测试用：/data/<id>.json 先在该目录中查找（测试数据 cn_zh-test 放在 tests/data/）
//   node server.js --no-debug      不提供调试模式（网页不显示“调试模式”开关，与线上一致）；默认提供
//
// 接口（仅可写模式）：
//   GET  /api/status          → { writable: true }
//   GET  /api/link-title?url= → { title }：查询维基百科 / 百度百科链接的词条名（编辑页的参考链接用；两种模式都提供）
//   GET  /api/translate?text=&from=&to= → { text }：翻译文字（编辑页自动翻译图片标题；两种模式都提供），查不到时 text 为 null
//   PUT  /api/data/<id>       保存整个数据集，<id> 形如 cn_zh（<国家>_<语言>）
//   POST /api/images          保存上传的图片（{ dataUrl }），返回 { path: "images/xxxx.jpg", w, h }
//   POST /api/images/fetch    按网址下载图片并保存（{ url }，仅 http / https），返回 { path, w, h }
// 另外，项目中没有 version.json 时（只在部署时生成），GET /version.json 根据 git 最近一次提交生成版本信息，
// 供网页调试模式显示“网站最近更新”时间（两种模式都提供）。
// 调试模式：仓库中的 js/env.js（部署到线上的版本）不提供调试模式；本地服务器默认改为返回
// debugAvailable: true，网页才显示“调试模式”开关（--no-debug 时原样返回该文件）。
//
// 安全：只监听 127.0.0.1；写入请求必须来自本服务自身的页面（校验 Host / Origin / Content-Type），
// 防止其他网站借用户的浏览器向本机写文件。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { writeAtomic, saveImage, fetchImage, MAX_IMAGE_BYTES } = require('./lib/images');
const { lookupLinkTitle } = require('./lib/link-title');
const { translateText } = require('./lib/translate');

const DATASET_ID = /^[a-z]{2}_[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;   // 例：cn_zh、jp_ja、cn_zh-Hant
const LOCAL_IMAGE = /^images\/[A-Za-z0-9._-]+$/;                       // 数据中图片路径的唯一合法形式
const LOCAL_AUDIO = /^audio\/[A-Za-z0-9._-]+\.(mp3|ogg|m4a)$/;         // 背景音乐只能是 audio/ 下的本地文件
const LOCAL_TEXTURE = /^textures\/[A-Za-z0-9._-]+\.(svg|png|webp)$/;   // 背景纹理只能是 textures/ 下的本地文件
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_SOURCES = 10;                                        // 每个事件最多的参考链接数
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, '请求内容过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, '需要 application/json');
  try {
    return JSON.parse(await readBody(req, limit));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'JSON 格式错误');
  }
}

// 校验数据集结构，拒绝明显错误的数据，防止界面异常时写坏数据文件
const MAX_DESCRIPTION = 200;   // 数据集简介（description）的最大字数

function validateDataset(id, data) {
  const fail = (msg) => { throw new HttpError(422, msg); };
  if (!data || typeof data !== 'object') fail('数据集必须是对象');
  if (data.id !== id) fail('数据集 id 与地址不一致');
  if (!Array.isArray(data.eras)) fail('eras 必须是数组');
  if (!Array.isArray(data.events)) fail('events 必须是数组');
  const ids = new Set();
  const eraNames = new Set(data.eras.map((e) => e && e.name));
  // 网站简介（可选）：用于网页的 description / og:description / twitter:description，按数据集写（如“……的中国历史时间轴”）
  if (data.description != null && !(typeof data.description === 'string' && data.description.trim() && data.description.length <= MAX_DESCRIPTION)) {
    fail(`description 必须是不超过 ${MAX_DESCRIPTION} 字的文字`);
  }
  // 背景音乐（可选）：{ src: 'audio/<文件名>', volume: 0–1, title, credit }
  if (data.music != null) {
    const m = data.music;
    if (typeof m !== 'object' || typeof m.src !== 'string' || !LOCAL_AUDIO.test(m.src)) fail('music.src 必须是 audio/ 下的本地音频文件（mp3 / ogg / m4a）');
    if (m.volume != null && !(typeof m.volume === 'number' && m.volume >= 0 && m.volume <= 1)) fail('music.volume 必须是 0–1 之间的数');
  }
  // 背景纹理（可选）：{ src: 'textures/<文件名>', size: 平铺单元的宽度（像素）, opacity: 0–1 }
  if (data.texture != null) {
    const t = data.texture;
    if (typeof t !== 'object' || typeof t.src !== 'string' || !LOCAL_TEXTURE.test(t.src)) fail('texture.src 必须是 textures/ 下的本地图片（svg / png / webp）');
    if (t.size != null && !(typeof t.size === 'number' && t.size >= 8 && t.size <= 2000)) fail('texture.size 必须是 8–2000 之间的数（像素）');
    if (t.opacity != null && !(typeof t.opacity === 'number' && t.opacity >= 0 && t.opacity <= 0.3)) fail('texture.opacity 必须是 0–0.3 之间的数（纹理要清淡）');
  }
  // 事件类型（可选）：[{ key, name, color }]，名称不能重复；有此列表时事件的 type 必须是其中的名称
  let typeNames = null;
  if (data.types != null) {
    if (!Array.isArray(data.types)) fail('types 必须是数组');
    typeNames = new Set();
    data.types.forEach((t, i) => {
      if (!t || typeof t.name !== 'string' || !t.name.trim()) fail(`types[${i}].name 无效`);
      if (typeNames.has(t.name)) fail(`types[${i}].name 重复：${t.name}`);
      if (t.color != null && !/^#[0-9a-fA-F]{6}$/.test(t.color)) fail(`types[${i}].color 必须是 #rrggbb 形式的颜色`);
      typeNames.add(t.name);
    });
  }
  data.events.forEach((ev, i) => {
    const where = `events[${i}]`;
    if (!ev || typeof ev !== 'object') fail(`${where} 必须是对象`);
    if (typeof ev.id !== 'string' || !ev.id) fail(`${where}.id 无效`);
    if (ids.has(ev.id)) fail(`${where}.id 重复：${ev.id}`);
    ids.add(ev.id);
    if (typeof ev.title !== 'string' || !ev.title.trim()) fail(`${where}.title 无效`);
    if (!Number.isFinite(ev.year)) fail(`${where}.year 必须是数字`);
    // 时期更迭（可选）：from / to 必须是本数据集 eras 中的时期名，且不能相同
    if (ev.transition != null) {
      const t = ev.transition;
      if (typeof t !== 'object' || !eraNames.has(t.from) || !eraNames.has(t.to)) fail(`${where}.transition 的 from / to 必须是 eras 中的时期名`);
      if (t.from === t.to) fail(`${where}.transition 的 from 与 to 不能相同`);
    }
    // 重要程度（可选，缺省视为 5）：1–10 的整数
    if (ev.majorScore != null && !(Number.isInteger(ev.majorScore) && ev.majorScore >= 1 && ev.majorScore <= 10)) fail(`${where}.majorScore 必须是 1–10 的整数`);
    if (ev.type != null) {
      if (typeof ev.type !== 'string' || !ev.type.trim()) fail(`${where}.type 无效`);
      if (typeNames && !typeNames.has(ev.type)) fail(`${where}.type 必须是 types 中的类型名：${ev.type}`);
    }
    // 参考链接（可选）：最多 10 条，每条有 http(s) 网址，标题可选
    if (ev.sources != null) {
      if (!Array.isArray(ev.sources) || ev.sources.length > MAX_SOURCES) fail(`${where}.sources 必须是最多 ${MAX_SOURCES} 项的数组`);
      ev.sources.forEach((src) => {
        if (!src || typeof src.url !== 'string' || !/^https?:\/\/\S+$/.test(src.url)) fail(`${where}.sources 中的网址必须以 http:// 或 https:// 开头`);
        if (src.title != null && typeof src.title !== 'string') fail(`${where}.sources 中的标题必须是文字`);
      });
    }
    if (ev.source != null) fail(`${where}.source 已由 sources（参考链接列表）代替`);
    if (!Array.isArray(ev.images) || ev.images.length > 9) fail(`${where}.images 必须是最多 9 项的数组`);
    ev.images.forEach((im) => {
      if (!im || typeof im.src !== 'string') fail(`${where}.images 中的图片缺少 src`);
      if (im.src.startsWith('data:')) fail(`${where} 含未上传的内嵌图片`);
      // 图片一律保存在本地 images/ 目录，网站不从外部地址加载图片
      if (!LOCAL_IMAGE.test(im.src)) fail(`${where} 的图片必须是 images/ 下的本地文件：${im.src}`);
      // 图片版权（可选）：作者、许可证为文字，来源网址以 http:// 或 https:// 开头
      if (im.author != null && (typeof im.author !== 'string' || im.author.length > 200)) fail(`${where} 的图片作者必须是不超过 200 字的文字`);
      if (im.license != null && (typeof im.license !== 'string' || !im.license.trim() || im.license.length > 60)) fail(`${where} 的图片许可证必须是不超过 60 字的文字`);
      if (im.sourceUrl != null && (typeof im.sourceUrl !== 'string' || !/^https?:\/\/\S+$/.test(im.sourceUrl))) fail(`${where} 的图片来源网址必须以 http:// 或 https:// 开头`);
    });
  });
}

// 保存图片内容（校验格式、记录宽高），返回 { path, w, h }
function saveUploaded(getBuffer, imagesDir) {
  try {
    const { src, w, h } = saveImage(getBuffer(), imagesDir);
    return { path: src, w, h };
  } catch (e) {
    throw new HttpError(/过大/.test(e.message) ? 413 : 400, e.message);
  }
}

function createServer({ root = __dirname, writeDir = root, testDataDir = null, readonly = false, debug = true, linkTitleOptions = {}, translateOptions = {} } = {}) {
  root = path.resolve(root);
  writeDir = path.resolve(writeDir);
  if (testDataDir) testDataDir = path.resolve(testDataDir);

  // 把请求路径解析为某个目录下的文件，拒绝 ../ 越界
  function resolveIn(dir, pathname) {
    const file = path.join(dir, pathname);
    return file === dir || file.startsWith(dir + path.sep) ? file : null;
  }

  // 只接受本服务自身页面发出的写入请求
  function checkSameOrigin(req, port) {
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host)) throw new HttpError(403, '拒绝来自其他主机的请求');
    const origin = req.headers.origin;
    if (origin && !hosts.some((h) => origin === `http://${h}`)) throw new HttpError(403, '拒绝跨站请求');
  }

  async function handleApi(req, res, pathname, port) {
    // 参考链接标题：只读查询，只接受本服务自身页面的请求
    if (pathname === '/api/link-title' && req.method === 'GET') {
      checkSameOrigin(req, port);
      const url = new URL(req.url, 'http://localhost').searchParams.get('url') || '';
      sendJson(res, 200, { title: await lookupLinkTitle(url, linkTitleOptions) });
      return;
    }
    // 翻译（编辑页自动翻译图片标题）：同样只读、只接受本服务自身页面的请求
    if (pathname === '/api/translate' && req.method === 'GET') {
      checkSameOrigin(req, port);
      const q = new URL(req.url, 'http://localhost').searchParams;
      sendJson(res, 200, { text: await translateText(q.get('text'), q.get('from') || 'auto', q.get('to'), translateOptions) });
      return;
    }
    if (readonly) throw new HttpError(404, 'Not Found');
    if (pathname === '/api/status' && req.method === 'GET') {
      sendJson(res, 200, { writable: true });
      return;
    }
    checkSameOrigin(req, port);

    const dataMatch = pathname.match(/^\/api\/data\/(.+)$/);
    if (dataMatch && req.method === 'PUT') {
      const id = dataMatch[1];
      if (!DATASET_ID.test(id)) throw new HttpError(400, '数据集名称无效');
      const data = await readJson(req, MAX_JSON_BYTES);
      validateDataset(id, data);
      writeAtomic(path.join(writeDir, 'data', `${id}.json`), JSON.stringify(data, null, 2) + '\n');
      sendJson(res, 200, { ok: true, file: `data/${id}.json`, events: data.events.length });
      return;
    }

    const imagesDir = path.join(writeDir, 'images');
    if (pathname === '/api/images' && req.method === 'POST') {
      const { dataUrl } = await readJson(req, Math.ceil(MAX_IMAGE_BYTES * 1.4));
      const m = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/);
      if (!m) throw new HttpError(400, '只支持 JPEG / PNG / WebP / GIF 图片');
      sendJson(res, 200, saveUploaded(() => Buffer.from(m[1], 'base64'), imagesDir));
      return;
    }

    // 编辑页输入的图片网址：由服务器下载并保存到 images/（浏览器受跨域限制，无法直接保存别的网站的图片）
    if (pathname === '/api/images/fetch' && req.method === 'POST') {
      const { url } = await readJson(req, 16 * 1024);
      if (typeof url !== 'string' || !url.trim()) throw new HttpError(400, '请提供图片网址');
      let buf;
      try {
        buf = await fetchImage(url.trim());
      } catch (e) {
        throw new HttpError(400, `无法下载图片：${e.message}`);
      }
      sendJson(res, 200, saveUploaded(() => buf, imagesDir));
      return;
    }
    throw new HttpError(404, 'Not Found');
  }

  // 本地的版本信息：最近一次提交的时间和短哈希；不是 git 仓库或没有 git 时返回 null
  function localVersion() {
    try {
      const [at, commit] = execFileSync('git', ['log', '-1', '--format=%cI%n%h'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n');
      return at && commit ? { updatedAt: at, commit, commitAt: at, source: 'local' } : null;
    } catch {
      return null;
    }
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method Not Allowed');
    if (pathname.endsWith('/')) pathname += 'index.html';
    // 可写目录优先（测试时可写目录是临时副本），其次是项目目录；测试数据目录中的数据集最优先
    const candidates = [resolveIn(writeDir, pathname), resolveIn(root, pathname)];
    if (testDataDir && pathname.startsWith('/data/')) candidates.unshift(resolveIn(testDataDir, pathname.slice('/data'.length)));
    if (!candidates.some(Boolean)) throw new HttpError(403, 'Forbidden');
    if (debug && pathname === '/js/env.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : '// 本地服务器生成：提供调试模式\nwindow.TIMELINE_ENV = { debugAvailable: true, local: true };\n');
      return;
    }
    const file = candidates.find((f) => f && fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file && pathname === '/version.json') {
      const version = localVersion();
      if (!version) throw new HttpError(404, 'Not Found');
      sendJson(res, 200, version);
      return;
    }
    if (!file) throw new HttpError(404, 'Not Found');
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      } catch {
        throw new HttpError(400, 'Bad Request');
      }
      if (pathname.startsWith('/api/')) await handleApi(req, res, pathname, server.address().port);
      else serveStatic(req, res, pathname);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? '服务器内部错误' : e.message });
      else res.destroy();
    }
  });
  return server;
}

module.exports = { createServer, validateDataset, writeAtomic, HttpError, DATASET_ID };

if (require.main === module) {
  const args = process.argv.slice(2);
  const readonly = args.includes('--readonly');
  const debug = !args.includes('--no-debug');
  const portArg = args.indexOf('--port');
  const port = portArg >= 0 ? Number(args[portArg + 1]) : Number(process.env.PORT) || 4173;
  const testDataArg = args.indexOf('--test-data');
  const testDataDir = testDataArg >= 0 ? args[testDataArg + 1] : null;
  createServer({ readonly, debug, testDataDir }).listen(port, '127.0.0.1', () => {
    console.log(`时间上的中国：http://127.0.0.1:${port}/  （${readonly ? '只读模式' : '可写模式：修改会写入 data/ 与 images/'}；${debug ? '提供调试模式' : '不提供调试模式'}）`);
  });
}
