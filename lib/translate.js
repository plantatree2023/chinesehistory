// 文字翻译：编辑页自动翻译图片标题用（本地服务器的 /api/translate；网页不直接访问翻译网站）。
// 使用 Google 翻译的公开接口（translate.googleapis.com，不需要密钥）；也用于简体 / 繁体中文之间的转换（zh-TW → zh-CN）。
// 查询失败（无法访问、被拦截、返回格式不对）时返回 null。
const { USER_AGENT } = require('./images');

const LANG_CODE = /^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/;
const MAX_TEXT = 1000;

// 接口返回 [[[译文片段, 原文片段, …], …], …]：把译文片段拼起来
function parseGoogle(json) {
  if (!Array.isArray(json) || !Array.isArray(json[0])) return null;
  const text = json[0].map((part) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '')).join('').trim();
  return text || null;
}

async function translateText(text, from, to, { fetchImpl = fetch, timeoutMs = 8000, base = 'https://translate.googleapis.com' } = {}) {
  text = String(text || '').trim();
  if (!text || text.length > MAX_TEXT || !LANG_CODE.test(from || '') || !LANG_CODE.test(to || '') || to === 'auto') return null;
  const q = new URLSearchParams({ client: 'gtx', sl: from, tl: to, dt: 't', q: text });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${base}/translate_a/single?${q}`, { headers: { 'User-Agent': USER_AGENT }, signal: ctrl.signal });
    if (!res.ok) return null;
    return parseGoogle(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { translateText, parseGoogle, LANG_CODE };
