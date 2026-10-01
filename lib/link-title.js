// 参考链接的标题：维基百科 / 百度百科链接查询词条名，返回“维基百科 - <词条名>”“百度百科 - <词条名>”。
// 本地服务器的 /api/link-title 使用（网页不能直接读取百度百科，维基百科在部分网络下无法访问，所以由本机查询）。
//   - parseLink(url)：只根据链接本身得到网站和词条名（网页中也有同样的逻辑，粘贴后立即填写）；
//   - lookupLinkTitle(url)：联网查询——维基百科用 API（跟随重定向，取简体标题），百度百科读取网页标题。
// 查询失败（无法访问、被拦截、找不到词条）时返回 null。
const { USER_AGENT } = require('./images');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function decode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// { site: 'wikipedia' | 'baidu', label, lang, name }；不是这两个网站时返回 null，name 可能为 null（链接中没有词条名）
function parseLink(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  const wiki = host.match(/^(?:([a-z-]+)\.)?(?:m\.)?wikipedia\.org$/) || host.match(/^([a-z-]+)\.m\.wikipedia\.org$/);
  if (wiki) {
    const m = u.pathname.match(/^\/(?:wiki|zh|zh-[a-z]+)\/(.+)$/);
    const raw = m ? m[1] : u.searchParams.get('title');
    const name = raw ? decode(raw).replace(/_/g, ' ').trim() : null;
    return { site: 'wikipedia', label: '维基百科', lang: wiki[1] && wiki[1] !== 'www' && wiki[1] !== 'm' ? wiki[1] : 'zh', name: name || null };
  }
  if (/(^|\.)baike\.baidu\.com$/.test(host)) {
    const m = u.pathname.match(/^\/item\/([^/?#]+)/);
    const name = m ? decode(m[1]).trim() : null;
    return { site: 'baidu', label: '百度百科', name: name || null };
  }
  return null;
}

function format(label, name) {
  return name ? `${label} - ${name}` : null;
}

// 维基百科 API 的返回：取简体中文标题（varianttitles['zh-cn']），没有时用 title；词条不存在时为 null
function titleFromWikipediaApi(json) {
  const pages = json && json.query && json.query.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page || 'missing' in page || 'invalid' in page) return null;
  return (page.varianttitles && (page.varianttitles['zh-cn'] || page.varianttitles['zh-hans'])) || page.title || null;
}

// 百度百科网页：<title>词条名_百度百科</title>；安全验证等页面返回 null
function titleFromBaiduHtml(html) {
  const m = String(html || '').match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!m) return null;
  const t = m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  if (!/_百度百科\s*$/.test(t)) return null;
  const name = t.replace(/_百度百科\s*$/, '').trim();
  return name || null;
}

async function lookupLinkTitle(url, { fetchImpl = fetch, wikipediaBase, timeoutMs = 8000 } = {}) {
  const info = parseLink(url);
  if (!info) return null;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    if (info.site === 'wikipedia') {
      if (!info.name) return null;
      const base = wikipediaBase || `https://${info.lang}.wikipedia.org`;
      const api = `${base}/w/api.php?action=query&format=json&redirects=1&converttitles=1&prop=info&inprop=varianttitles&titles=${encodeURIComponent(info.name)}`;
      const res = await fetchImpl(api, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal });
      if (!res.ok) return null;
      return format(info.label, titleFromWikipediaApi(await res.json()));
    }
    const res = await fetchImpl(String(url).trim(), { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9' }, redirect: 'follow', signal });
    if (!res.ok) return null;
    return format(info.label, titleFromBaiduHtml(await res.text()));
  } catch {
    return null;
  }
}

module.exports = { parseLink, lookupLinkTitle, titleFromWikipediaApi, titleFromBaiduHtml };
