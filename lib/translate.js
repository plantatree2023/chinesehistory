// 文字翻译：编辑页自动翻译图片标题用（本地服务器的 /api/translate；网页不直接访问翻译网站）。
//   - 简体 / 繁体中文之间的转换在本机完成（opencc-js），不需要联网；
//   - 其他语言先用 Google 翻译的公开接口（translate.googleapis.com，在中国大陆通常连不上），
//     不行时用 MyMemory（api.mymemory.translated.net，免费额度每天约 5000 字）。都不需要密钥。
// 翻译不了（无法访问、额度用完、返回格式不对）时返回 null。
const OpenCC = require('opencc-js');
const { USER_AGENT } = require('./images');

const LANG_CODE = /^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/;
const MAX_TEXT = 1000;

// 中文的写法：繁体（zh-TW、zh-HK、zh-Hant）为 'tw'，简体（zh-CN、zh-SG、zh-Hans、zh）为 'cn'，不是中文时为 null
function chineseScript(code) {
  if (!/^zh(-|$)/i.test(code || '')) return null;
  return /^zh-(tw|hk|mo|hant)$/i.test(code) ? 'tw' : 'cn';
}
const converters = {};
function convertChinese(text, from, to) {
  const key = `${from}>${to}`;
  if (!converters[key]) converters[key] = OpenCC.Converter({ from, to });
  return converters[key](text);
}

// Google 接口返回 [[[译文片段, 原文片段, …], …], …]：把译文片段拼起来
function parseGoogle(json) {
  if (!Array.isArray(json) || !Array.isArray(json[0])) return null;
  const text = json[0].map((part) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '')).join('').trim();
  return text || null;
}
// MyMemory 接口返回 { responseStatus, responseData: { translatedText } }；额度用完时 translatedText 是英文的警告
function parseMyMemory(json) {
  const text = json && Number(json.responseStatus) === 200 && json.responseData && json.responseData.translatedText;
  if (typeof text !== 'string' || !text.trim() || /^MYMEMORY WARNING/i.test(text)) return null;
  return text.trim();
}

async function getJson(url, fetchImpl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function translateText(text, from, to, { fetchImpl = fetch, timeoutMs = 5000, googleBase = 'https://translate.googleapis.com', myMemoryBase = 'https://api.mymemory.translated.net' } = {}) {
  text = String(text || '').trim();
  if (!text || text.length > MAX_TEXT || !LANG_CODE.test(from || '') || !LANG_CODE.test(to || '') || to === 'auto') return null;
  // 中文之间：只转换简繁
  const fs = chineseScript(from), ts = chineseScript(to);
  if (fs && ts) return fs === ts ? text : convertChinese(text, fs, ts);
  const g = parseGoogle(await getJson(`${googleBase}/translate_a/single?${new URLSearchParams({ client: 'gtx', sl: from, tl: to, dt: 't', q: text })}`, fetchImpl, timeoutMs));
  if (g) return g;
  // MyMemory 需要明确的原文语言：auto 时按文字猜（有汉字为中文，否则英文）
  const src = from === 'auto' ? (/[一-鿿]/.test(text) ? 'zh-CN' : 'en') : from;
  if (src === to) return text;
  return parseMyMemory(await getJson(`${myMemoryBase}/get?${new URLSearchParams({ q: text, langpair: `${src}|${to}` })}`, fetchImpl, timeoutMs));
}

module.exports = { translateText, parseGoogle, parseMyMemory, chineseScript, LANG_CODE };
