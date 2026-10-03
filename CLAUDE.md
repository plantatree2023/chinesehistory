# 项目约定

## 每次改动后必须运行测试

任何改动（代码、样式、数据）完成后、提交之前，都要运行完整的端到端测试，确认没有回归：

```bash
npm install                      # 首次
npm test
```

- 全部通过才能提交和推送；推送到 `main` 会自动部署：网站在 Cloudflare（https://history.zhongshutime.com/ ），GitHub Pages 的旧地址只保留跳转。
- **例外**：只改了数据文件（`data/*.json`）和 / 或只新增了图片（`images/`）时，不需要运行测试，可以直接提交推送。事件静态页和 sitemap 在部署时由 `tools/build-site.js` 按数据自动重新生成，不需要另外处理。改动涉及任何其他文件（代码、样式、测试、配置等）时仍要运行完整测试。
- 测试失败时先判断是应用的问题还是测试本身的问题，修复后重新运行完整测试。
- 新增或修改功能时，同步在 `tests/` 中补充或更新对应的测试。
- 不要通过跳过、删除或放宽测试来让测试通过。
- 测试不得改动仓库中的真实数据：默认测试服务器是只读的，写入相关测试使用临时目录。

## 结构

- `index.html`、`css/style.css`、`js/app.js`：纯静态前端，无构建步骤
- `data/<国家>_<语言>.json`：数据集（如 `cn_zh.json`），包含时期划分 `eras` 与事件 `events`；字段说明见 `data/README.md`，改动字段时同步更新。默认数据集是 `cn_zh`（`js/app.js` 的 `DEFAULT_DATASET` 与 `tools/build-site.js` 的 `DEFAULT_DATASET` 一致），旧版数据为 `cn_zh-v0`
- `server.js`：本地服务器；`npm start` 为可写模式（网页中的修改写回数据文件），`--readonly` 供测试使用（测试还带 `--test-data tests/data`，见下面的测试数据）；没有 `version.json` 文件时根据 git 最近一次提交生成
- 调试模式只在本地启动时提供：仓库中的 `js/env.js`（部署版本）为 `debugAvailable: false`，`server.js` 默认改为返回 `true`，`--no-debug`（`npm run start:public`）时原样返回；网址带 `debugMode` 参数时也提供（`buildQuery` 保留该参数，`shareUrl` 和 `timelineShareUrl` 不带）；测试服务器提供调试模式
- 调试模式：编辑功能（新增、编辑、删除、恢复默认数据）只在调试模式下显示，新增的编辑入口要加 `debug-only` 类；调试模式显示的网站更新时间来自部署时生成的 `version.json`（`tools/build-site.js`）。需要编辑的测试用 `test.use({ debugMode: true })`
- 自动播放：网页加载后默认自动播放；测试中默认关闭（`tests/helpers.js` 设置 `window.TIMELINE_AUTOPLAY = false`），测试自动播放本身时用 `test.use({ autoplay: true })`
- 首次访问提示（电脑分步指引、手机底部气泡）：测试中默认关闭（`window.TIMELINE_ONBOARDING = false`），测试提示本身时用 `test.use({ onboarding: true })`
- 界面语言（i18n）：语言由数据集名称的语言部分决定（`cn_zh` → 中文，`cn_en` → 英文）。界面文字以中文为原文写在 `index.html` 和 `js/app.js` 中；脚本中新增的界面文字都要写成 `_('中文原文', { 名称: 值 })`，并在 `js/i18n/en.js`（及其他语言文件）的 `strings` 中加译文；`index.html` 中的文字、`title` / `aria-label` / `placeholder` 按原文自动翻译，含标签的段落加 `data-i18n`（按整段 innerHTML 查找译文）。年份格式、文字长度上限也在语言文件中；英文字体在 `css/style.css` 的 `:root:lang(en)`。右上角有语言下拉菜单，所有访问者可用（手机在“更多”菜单中）。`tests/i18n.spec.js` 检查每条原文都有译文、英文界面没有残留中文。`cn_en` 是 `cn_zh` 的翻译，事件 id 相同；改动 `cn_zh` 不会自动同步到 `cn_en`
- 右上角按钮：电脑上依次是播放、音乐、深色模式、分享、关于、语言、放大缩小；手机（≤640px）上深色模式、分享、关于、语言收进“更多”菜单（`#moreBtn`）。新按钮放在放大缩小按钮左边
- 配色：颜色都用 `css/style.css` 中 `:root` 的变量，深色模式在 `:root[data-theme="dark"]` 中重新定义；新增颜色要同时定义两套，`tests/theme.spec.js` 检查对比度
- 侧栏筛选（`js/app.js` 中的 `FILTERS`）：**同类型的控件放在一起**（勾选框在最前，然后是下拉列表、范围输入）。新增筛选时写明 `kind`（`toggle` / `select` / `range`），面板按 `FILTER_KIND_ORDER` 自动分组；`tests/filters.spec.js` 会检查。每个筛选还要写 `toParams` / `fromParams`，把条件写进网址并能从网址恢复（见 `tests/url.spec.js`）
- 反馈 / 建议修改：所有访问者可用，通过 Web3Forms 发送（`js/config.js` 中的 `accessKey`；`enabled: false` 时反馈入口带 `feedback-only` 类被隐藏，没有 `accessKey` 时提交提示尚未配置）；建议模式复用编辑页（`openEditor(id, 'suggest' | 'propose')`），不修改数据。测试替换 `js/config.js` 并拦截发送请求（`tests/feedback.spec.js`），不得真的发出
- 脚本都从本地加载（第三方库放在 `js/vendor/`），不阻塞页面的用 `async`；`tests/share-qrcode.spec.js` 检查页面不引用外部脚本
- `lib/link-title.js`：维基百科 / 百度百科链接的词条名查询，本地服务器 `/api/link-title`（只读模式也提供）供编辑页自动填写参考链接标题；`tests/helpers.js` 默认拦截该请求，测试不访问外网
- `lib/translate.js`：文字翻译（Google 翻译的公开接口，也用于繁体转简体），本地服务器 `/api/translate`（只读模式也提供；线上网站没有，翻译不了时编辑页保持空白）供编辑页自动翻译新图片的标题：以数据集的 `primaryLanguage`（国家的首选语言，中国是 `zh`）为准，其他语言从它翻译；`tests/helpers.js` 默认拦截该请求
- `lib/images.js`：图片工具（格式与尺寸识别、下载、按内容哈希保存到 `images/`），服务器和导入脚本共用
- `404.html`：不存在的网址显示的页面（Cloudflare 由 `wrangler.jsonc` 的 `not_found_handling` 使用）。样式内联，网址由脚本按网站根目录生成；文字全部在脚本的 `STRINGS` 中（按浏览器语言选择，默认中文），不写具体年份和时期，新增语言时加一项；`tests/not-found.spec.js` 检查
- `tools/build-site.js`：生成部署用的 `_site/`（复制 `SITE_FILES`，为 `data/` 下每个数据集（文件名符合 `DATASET_ID`）的每个事件生成静态页：默认数据集 `e/<事件id>.html`，其他数据集 `e/<数据集>/<事件id>.html`（链接带 `?data=`）；每次部署时按当时的数据重新生成，新增事件或数据集不需要改代码，生成的页面不提交（样式 `css/event.css`，不依赖脚本，地址都用相对路径，绝对地址取自 `package.json` 的 `homepage`），写 `sitemap.xml`、`robots.txt`、`version.json`，复制 `_headers`；`tests/event-pages.spec.js` 检查），Cloudflare 的构建命令为 `node tools/build-site.js`，部署命令 `npx wrangler deploy` 按 `wrangler.jsonc` 只上传 `_site`（单个文件不超过 25 MiB）；缓存规则在根目录的 `_headers`（构建时复制进 `_site/`）：`images/` 下一层按内容哈希命名的图片缓存一年，其他文件沿用 Cloudflare 默认的每次验证，所以 `images/` 下一层不能放非哈希命名的文件（`tests/debug.spec.js` 检查）
- `tools/build-redirect.js`：GitHub Pages 旧地址（`plantatree2023.github.io/chinesehistory/`）的跳转网站，由 `deploy.yml` 调用：正式网站的每个网页（首页、事件页）都有同名跳转页，带着网址参数和 # 跳到 `homepage` 的同一页（canonical + meta refresh），其他地址由跳转网站的 404.html 按路径跳转；`tests/redirect.spec.js` 检查
- `tools/wiki-import.js`：从维基百科导入 / 更新事件（`npm run wiki -- --file data/cn_zh.json 关键词`），支持 `--list`、`--dry-run`、`--refresh-images`、`--type`、`--score`；图片总是下载到本地；自动推断事件类型（`type`）和估算重要程度（`majorScore`）
- `audio/`：背景音乐（数据集的 `music` 字段引用，只从本地加载；部署时复制）。音乐按数据集配置，便于其他国家 / 语言使用各自的音乐
- `textures/`：背景纹理（数据集的 `texture` 字段引用，只从本地加载；部署时复制）。纹理按数据集配置，图片只用作遮罩形状，颜色来自 `--texture-ink`
- 分享面板：只在手机上显示的按钮加 `mobile-only` 类（`js/app.js` 按 UA 判断手机，给 `body` 加 `mobile-device`；在微信内置浏览器中加 `in-wechat`）；微信好友见 `shareToWechat`，`tests/share-wechat.spec.js` 用手机 / 微信的 UA 测试
- 网站简介：来自数据集的 `description` 字段（按国家 / 语言各写一份，不写具体数字）；`index.html` 中只放不提国家的通用文字，部署时 `tools/build-site.js` 换成默认数据集的简介，网页加载数据后 `js/app.js` 换成当前数据集的简介（`tests/share-card.spec.js`、`tests/event-pages.spec.js`、`tests/data.spec.js` 检查）
- 社交分享卡片：`index.html` 中的 `og:` / `twitter:` 元数据用绝对地址（与 `package.json` 的 `homepage` 一致，换域名时一起改）；封面图和 apple-touch-icon 在 `images/share/`，由 `node tools/share-images.js` 生成；`tests/share-card.spec.js` 检查
- 图片版权：图片可带 `author`、`license`（`unknown` 表示不详）、`sourceUrl`（见 `data/README.md`）。网站在图片查看器（`#lightboxCredit`）、详情页“图片来源”（`#detailCredits`）和事件静态页显示署名；编辑页有“这张图的标题”一行（`#newCaption`，当前语言和其他语言各一个输入框）、“这张图的版权”一行（`#newCredit`，维基共享资源网址由浏览器查询其 API 自动填写）和默认折叠的“图片信息”表（`#imageInfo`，含对照语言的标题）；缩略图上的标签缺少来源网址或许可证时标红。保存时把图片同步到同一国家其他语言的数据集（`saveSiblings`）。测试拦截维基共享资源的请求（`tests/image-credits.spec.js`）
- `images/`：事件图片。**所有图片都从本地加载**：数据中的图片路径只能是 `images/<文件名>`，不引用外部地址；编辑页输入的图片网址会先下载到本地
- `tests/`：Playwright 端到端测试，说明见 README
- 测试数据：界面测试使用固定的 `tests/data/cn_zh-test.json`（`tests/helpers.js` 的 `DATASET`、`DATA_URL`、`loadDataset`、`readTestData`），不要在测试中写死 `data/` 下的文件；页面通过 `window.TIMELINE_DATASET` 把它当作默认数据集（需要真实默认数据时在测试中删掉这个变量）。检查数据完整性的测试遍历 `data/` 下的所有数据集（`REAL_DATASETS`、`readRealDataset`）。改动真实数据不需要改测试数据
