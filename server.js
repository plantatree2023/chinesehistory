// 本地开发服务器：提供静态文件，并提供写入接口，使本地编辑直接保存到 data/<数据集>.json。
//
// 用法：
//   node server.js                 可写模式（npm start），修改会写入仓库中的数据文件和 images/
//   node server.js --readonly      只读模式，不提供写入接口（与 GitHub Pages 行为一致，供自动化测试使用）
//   node server.js --port 8080     指定端口，默认 4173
//
// 接口（仅可写模式）：
//   GET  /api/status          → { writable: true }
//   PUT  /api/data/<id>       保存整个数据集，<id> 形如 cn_zh（<国家>_<语言>）
//   POST /api/images          保存上传的图片（{ dataUrl }），返回 { path: "images/xxxx.jpg" }
//
// 安全：只监听 127.0.0.1；写入请求必须来自本服务自身的页面（校验 Host / Origin / Content-Type），
// 防止其他网站借用户的浏览器向本机写文件。
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATASET_ID = /^[a-z]{2}_[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;   // 例：cn_zh、jp_ja、cn_zh-Hant
const LOCAL_IMAGE = /^images\/[A-Za-z0-9._-]+$/;             // 数据中图片路径的唯一合法形式
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
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

// 写临时文件再改名，避免写入中断留下损坏的数据文件
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// 校验数据集结构，拒绝明显错误的数据，防止界面异常时写坏数据文件
function validateDataset(id, data) {
  const fail = (msg) => { throw new HttpError(422, msg); };
  if (!data || typeof data !== 'object') fail('数据集必须是对象');
  if (data.id !== id) fail('数据集 id 与地址不一致');
  if (!Array.isArray(data.eras)) fail('eras 必须是数组');
  if (!Array.isArray(data.events)) fail('events 必须是数组');
  const ids = new Set();
  data.events.forEach((ev, i) => {
    const where = `events[${i}]`;
    if (!ev || typeof ev !== 'object') fail(`${where} 必须是对象`);
    if (typeof ev.id !== 'string' || !ev.id) fail(`${where}.id 无效`);
    if (ids.has(ev.id)) fail(`${where}.id 重复：${ev.id}`);
    ids.add(ev.id);
    if (typeof ev.title !== 'string' || !ev.title.trim()) fail(`${where}.title 无效`);
    if (!Number.isFinite(ev.year)) fail(`${where}.year 必须是数字`);
    if (!Array.isArray(ev.images) || ev.images.length > 9) fail(`${where}.images 必须是最多 9 项的数组`);
    ev.images.forEach((im) => {
      if (!im || typeof im.src !== 'string') fail(`${where}.images 中的图片缺少 src`);
      if (im.src.startsWith('data:')) fail(`${where} 含未上传的内嵌图片`);
      // 图片一律保存在本地 images/ 目录，网站不从外部地址加载图片
      if (!LOCAL_IMAGE.test(im.src)) fail(`${where} 的图片必须是 images/ 下的本地文件：${im.src}`);
    });
  });
}

function createServer({ root = __dirname, writeDir = root, readonly = false } = {}) {
  root = path.resolve(root);
  writeDir = path.resolve(writeDir);

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

    if (pathname === '/api/images' && req.method === 'POST') {
      const { dataUrl } = await readJson(req, Math.ceil(MAX_IMAGE_BYTES * 1.4));
      const m = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!m || !IMAGE_TYPES[m[1]]) throw new HttpError(400, '只支持 JPEG / PNG / WebP / GIF 图片');
      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw new HttpError(413, '图片过大');
      // 以内容哈希命名：同一张图片重复上传不会产生多个文件
      const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) + IMAGE_TYPES[m[1]];
      const file = path.join(writeDir, 'images', name);
      if (!fs.existsSync(file)) writeAtomic(file, buf);
      sendJson(res, 200, { path: `images/${name}` });
      return;
    }
    throw new HttpError(404, 'Not Found');
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method Not Allowed');
    if (pathname.endsWith('/')) pathname += 'index.html';
    // 可写目录优先（测试时可写目录是临时副本），其次是项目目录
    const candidates = [resolveIn(writeDir, pathname), resolveIn(root, pathname)].filter(Boolean);
    if (!candidates.length) throw new HttpError(403, 'Forbidden');
    const file = candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
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
  const portArg = args.indexOf('--port');
  const port = portArg >= 0 ? Number(args[portArg + 1]) : Number(process.env.PORT) || 4173;
  createServer({ readonly }).listen(port, '127.0.0.1', () => {
    console.log(`时间上的中国：http://127.0.0.1:${port}/  （${readonly ? '只读模式' : '可写模式：修改会写入 data/ 与 images/'}）`);
  });
}
