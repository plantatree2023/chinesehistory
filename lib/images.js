// 图片工具：识别图片格式与尺寸、下载网络图片、以内容哈希保存到 images/ 目录。
// 供本地服务器（上传 / 按网址下载图片）和维基导入脚本共用，保证所有入口保存图片的方式一致。
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_EXT = { jpeg: '.jpg', png: '.png', gif: '.gif', webp: '.webp' };
const USER_AGENT = 'ChineseHistoryTimeline/1.0 (https://github.com/plantatree2023/chinesehistory)';

// 写临时文件再改名，避免写入中断留下损坏的文件
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// 从文件头读取图片类型和宽高（JPEG / PNG / GIF / WebP），不是这些格式时返回 null
function imageSize(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && buf.toString('ascii', 0, 4) === 'GIF8') {
    return { type: 'gif', w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { type: 'webp', w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { type: 'webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { type: 'webp', w: 1 + (b & 0x3fff), h: 1 + ((b >>> 14) & 0x3fff) };
    }
    return null;
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    // 逐个跳过 JPEG 段，找到记录尺寸的 SOF 段
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// 校验并保存图片：以内容的 SHA-256 前 16 位命名，同一张图只存一份。
// 返回数据中使用的 { src: 'images/<哈希>.<扩展名>', w, h }
function saveImage(buf, imagesDir) {
  if (!buf.length) throw new Error('图片为空');
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('图片过大（超过 8MB）');
  const size = imageSize(buf);
  if (!size || !size.w || !size.h) throw new Error('不是 JPEG / PNG / GIF / WebP 图片');
  const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) + IMAGE_EXT[size.type];
  const file = path.join(imagesDir, name);
  if (!fs.existsSync(file)) writeAtomic(file, buf);
  return { src: `images/${name}`, w: size.w, h: size.h };
}

// 下载网络图片（只允许 http / https），超时或超过大小上限时报错
async function fetchImage(url, { maxBytes = MAX_IMAGE_BYTES, timeoutMs = 20_000 } = {}) {
  let u;
  try { u = new URL(url); } catch { throw new Error('网址格式不正确'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只支持 http / https 网址');
  let res;
  try {
    res = await fetch(u, { headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? '下载超时' : `无法连接：${e.cause ? e.cause.code || e.cause.message : e.message}`);
  }
  if (!res.ok) throw new Error(`网址返回 HTTP ${res.status}`);
  if (Number(res.headers.get('content-length')) > maxBytes) throw new Error('图片过大（超过 8MB）');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('图片过大（超过 8MB）');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = { MAX_IMAGE_BYTES, IMAGE_EXT, USER_AGENT, writeAtomic, imageSize, saveImage, fetchImage };
