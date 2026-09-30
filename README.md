# 时间上的中国

一个可拖拽浏览的中国历史时间轴网页应用，收录从古人类时期（约170万年前）到 1980 年的 100 个重大历史事件。

在线访问：https://plantatree2023.github.io/chinesehistory/

## 功能

- 页面正中为时间轴，可用鼠标 / 手指左右拖拽、滚轮、方向键或底部缩略条浏览
- 事件卡片交错排列在轴线上下方，包含代表性图片与简要说明；轴线按朝代着色
- 点击事件查看详细说明（≤350 字）和最多 9 张图片，可编辑、删除
- 底部“浏览所有历史事件”按钮打开侧栏，按时间顺序列出全部事件，支持搜索、编辑、删除
- 右下角“+”按钮添加新事件（支持图片网址或本地上传）
- 数据保存在 `data/<国家>_<语言>.json`：本地运行时修改直接写入该文件，线上浏览时修改保存在访问者自己的浏览器中（见下文）

## 数据来源

事件文字摘自[中文维基百科](https://zh.wikipedia.org/)（CC BY-SA 4.0），图片来自[维基共享资源](https://commons.wikimedia.org/)，部分已压缩保存在 `images/` 目录，其余直接引用
（在无法访问维基媒体的网络环境下这部分图片会显示为占位图），版权及许可以各文件在维基共享资源上的说明为准。

标题字体为[马善政毛笔楷书](https://fonts.google.com/specimen/Ma+Shan+Zheng)（SIL Open Font License 1.1），
只保留标题和朝代名用到的字（`css/fonts/`，约 16KB），许可证见 `css/fonts/OFL-MaShanZheng.txt`。
新增的时期名若含子集外的字，会自动回退为宋体显示。

## 本地运行与编辑数据

纯静态网站，无需构建。在项目目录运行：

```bash
npm start          # 启动本地服务 http://127.0.0.1:4173/
```

**本地文件模式**：通过 `npm start` 访问时，在网页中新增、编辑、删除事件会直接写入 `data/cn_zh.json`，
上传的图片保存到 `images/`（以内容哈希命名）。确认无误后提交并推送，线上网站就会更新：

```bash
git add data images && git commit -m "更新历史事件" && git push
```

**浏览器模式**：在 GitHub Pages 等静态托管上没有写入接口，访问者的修改只保存在其浏览器的 localStorage 中，
不会影响仓库数据；侧栏底部可“恢复默认数据”。

## 从维基百科导入事件

`tools/wiki-import.js` 按关键词查询维基百科，新增或更新数据集中的条目：

```bash
npm run wiki -- --file data/cn_zh.json 淝水之战 北京奥运会      # 一个或多个关键词
npm run wiki -- --file data/cn_zh.json --list topics.txt         # 条目表，逐条查询
npm run wiki -- --file data/cn_zh.json --dry-run 北京奥运会      # 只显示将做的修改，不写文件
npm run wiki -- --file data/cn_zh.json --year 1997 香港回归      # 指定年份
npm run wiki -- --file data/cn_zh.json --download-images 北京奥运会  # 同时把图片下载到本地
```

- 条目表每行一个关键词，可写成 `关键词|年份`（公元前写负数），`#` 开头为注释。
- 维基语言由文件名决定（`cn_zh.json` → 中文维基，简体）。关键词先按条目名查询，查不到再搜索；
  搜索到的条目须在简介中提到该关键词，否则视为找不到。
- **已存在的条目**（事件名与关键词相同，或对应同一维基条目）：只更新详细说明、图片、来源，
  保留事件名、年份、简要说明、重大事件标记和已下载的本地图片；指定了年份时同时更新年份。
- **新条目**：事件名使用关键词；年份取自 Wikidata，取不到时从简介文字中查找（会提示核对），
  仍无法确定则报错，需要用 `关键词|年份` 或 `--year` 指定。
- 写入前按网站服务器的同一套规则校验数据；遇到维基限流会自动等待重试。
- 默认直接引用维基共享资源的图片地址。加 `--download-images` 会把所处理条目的图片（维基生成的缩略图，通常几十 KB）
  下载到数据文件上一级目录的 `images/`（`data/cn_zh.json` → `images/`），按内容哈希命名、同一张图只存一份，
  记录宽高，原地址保留在 `remote` 字段；单张下载失败时保留维基地址并提示。在无法访问维基的网络中也能显示这些图片。

## 数据格式与多语言

每个数据集是一个 JSON 文件，命名为 `data/<国家>_<语言>.json`：国家用 ISO 3166-1 两位小写代码，语言用 ISO 639 代码，
可附加文字变体（如 `cn_zh-Hant`）。例：`cn_zh.json`（中国 · 中文）、`jp_ja.json`（日本 · 日文）、`cn_en.json`（中国 · 英文）。
通过网址参数切换：`?data=jp_ja`，默认 `cn_zh`。

```json
{
  "id": "cn_zh", "country": "cn", "language": "zh",
  "eras": [{ "name": "唐", "start": 618, "end": 907, "color": "#c0892f", "range": "618年—907年", "desc": "…" }],
  "events": [{ "id": "e001", "year": -1700000, "date": "约170万年前", "title": "元谋人", "short": "…", "detail": "…",
               "images": [{ "src": "images/xxx.jpg", "w": 640, "h": 480, "caption": "" }], "source": "https://…", "major": false }]
}
```

`eras` 是该国的时期划分（时间轴色带、时期提示和底部进度条都使用它），`year` 为公元纪年，公元前为负数。

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
| `tests/functional.spec.js` | 拖动浏览、详情、编辑 / 新增 / 删除、侧栏搜索、恢复默认数据、持久化、数据集加载 |
| `tests/layout-rules.spec.js` | 每屏最多 6 个事件、说明至少 20 字、卡片不重叠不越界（多种屏幕尺寸、新增事件、改变窗口后） |
| `tests/cover-images.spec.js` | 代表图按原比例完整显示、不裁切不过小；本地图片文件齐全 |
| `tests/toolbar.spec.js` | 工具栏默认显示，按钮 / H 键隐藏与恢复 |
| `tests/era-tooltip.spec.js` | 悬浮 / 点击时间轴显示所处时期，含朝代交界 |
| `tests/progress-bar.spec.js` | 底部进度条的时期高亮与标签 |
| `tests/header.spec.js` | 顶栏：标题中的当前时期、时期色条、标题字体、窄屏显示 |
| `tests/wiki-import.spec.js` | 维基导入脚本：新增 / 更新、条目表、dry run、搜索与年份来源、限流重试、下载图片（使用模拟的维基接口，不访问外网） |
| `tests/local-file.spec.js` | 本地文件模式：修改写回 JSON、图片上传、写入接口的安全校验（使用临时数据副本） |

## 目录结构

- `index.html` 页面结构
- `css/style.css` 样式
- `js/app.js` 交互逻辑
- `data/<国家>_<语言>.json` 数据集（事件与时期划分）
- `images/` 本地保存的事件图片
- `server.js` 本地服务器（静态文件 + 本地文件模式的写入接口）
- `tools/wiki-import.js` 从维基百科导入 / 更新事件的命令行脚本
- `tests/` 自动化测试（`helpers.js` 为共用工具）
