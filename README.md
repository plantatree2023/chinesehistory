# 中华历史长卷

一个可拖拽浏览的中国历史时间轴网页应用，收录从古人类时期（约170万年前）到 1980 年的 100 个重大历史事件。

在线访问：https://plantatree2023.github.io/chinesehistory/

## 功能

- 页面正中为时间轴，可用鼠标 / 手指左右拖拽、滚轮、方向键或底部缩略条浏览
- 事件卡片交错排列在轴线上下方，包含代表性图片与简要说明；轴线按朝代着色
- 点击事件查看详细说明（≤350 字）和最多 9 张图片，可编辑、删除
- 底部“浏览所有历史事件”按钮打开侧栏，按时间顺序列出全部事件，支持搜索、编辑、删除
- 右下角“+”按钮添加新事件（支持图片网址或本地上传）
- 修改保存在浏览器本地（localStorage），可在侧栏底部“恢复默认数据”

## 数据来源

事件文字摘自[中文维基百科](https://zh.wikipedia.org/)（CC BY-SA 4.0），图片来自[维基共享资源](https://commons.wikimedia.org/)，部分已压缩保存在 `images/` 目录，其余直接引用
（在无法访问维基媒体的网络环境下这部分图片会显示为占位图），版权及许可以各文件在维基共享资源上的说明为准。

## 本地运行

纯静态网站，无需构建：

```bash
npm start          # 启动本地服务 http://127.0.0.1:4173/
```

## 测试

使用 [Playwright](https://playwright.dev/) 在 Chromium 中做端到端测试，全程离线（外部图片请求会被屏蔽）。每次改动后运行：

```bash
npm install                      # 首次运行需要
npx playwright install chromium  # 首次运行需要（已安装浏览器可跳过）
npm test                         # 自动启动本地服务并运行全部测试
npm run test:report              # 查看上次的 HTML 报告（失败时含截图与操作记录）
```

| 文件 | 覆盖内容 |
|---|---|
| `tests/functional.spec.js` | 拖动浏览、详情、编辑 / 新增 / 删除、侧栏搜索、恢复默认数据、持久化 |
| `tests/layout-rules.spec.js` | 每屏最多 6 个事件、说明至少 20 字、卡片不重叠不越界（多种屏幕尺寸、新增事件、改变窗口后） |
| `tests/cover-images.spec.js` | 代表图按原比例完整显示、不裁切不过小；本地图片文件齐全 |
| `tests/toolbar.spec.js` | 工具栏默认显示，按钮 / H 键隐藏与恢复 |
| `tests/era-tooltip.spec.js` | 悬浮 / 点击时间轴显示所处时期，含朝代交界 |
| `tests/progress-bar.spec.js` | 底部进度条的时期高亮与标签 |

## 目录结构

- `index.html` 页面结构
- `css/style.css` 样式
- `js/app.js` 交互逻辑
- `data/events.js` 默认事件数据
- `images/` 本地保存的事件图片
- `tests/` 自动化测试（`helpers.js` 为共用工具，`static-server.js` 为本地静态服务）
