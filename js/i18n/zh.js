// 界面语言：中文（原文）。界面文字以中文为原文写在 index.html 和 js/app.js 中，这里不需要逐条列出；
// 其他语言见同目录下的文件（如 en.js），按中文原文给出译文。语言由数据集名称决定（cn_zh → zh）。
(window.TIMELINE_I18N = window.TIMELINE_I18N || {}).zh = {
  name: '中文',                 // 语言下拉菜单中显示的名称
  shortName: '中',              // 手机“更多”菜单中的简称
  htmlLang: 'zh-CN',            // <html lang>
  siteName: '时间上的中国',
  // 文字长度：卡片说明至少的字数（不计标点）、自动截取时的长度，编辑页各项的上限（事件名称、时间显示、简要说明、
  // 详细说明、图片标题、参考链接标题）
  limits: { minSummary: 20, summaryCut: 60, maxTitle: 40, maxDate: 20, maxShort: 60, maxDetail: 600, maxCaption: 60, maxSourceTitle: 60 },
  // 年份显示：详情和列表中的年份
  formatYear: function (y) {
    if (y <= -10000) {
      var wan = -y / 10000;
      return '约' + (wan % 1 === 0 ? wan : wan.toFixed(1)) + '万年前';
    }
    if (y < 0) return '公元前' + (-y) + '年';
    return '公元' + y + '年';
  },
  // 时间轴刻度
  tickLabel: function (y) {
    if (y <= -10000) return (-y / 10000) + '万年前';
    if (y < 0) return '前' + (-y);
    return String(y);
  },
  // 悬浮时间轴时显示的大致年份
  approxYear: function (y, currentYear) {
    if (y <= -10000) {
      var wan = -y / 10000;
      return '约' + (wan >= 10 ? Math.round(wan) : Math.round(wan * 10) / 10) + '万年前';
    }
    if (y < -3000) return '约公元前' + Math.round(-y / 100) * 100 + '年';
    if (y < 0.5) return '约公元前' + Math.max(1, Math.round(-y)) + '年';
    return '约公元' + Math.min(currentYear, Math.round(y)) + '年';
  },
  strings: {}
};
