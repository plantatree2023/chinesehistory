# 项目约定

## 每次改动后必须运行测试

任何改动（代码、样式、数据）完成后、提交之前，都要运行完整的端到端测试，确认没有回归：

```bash
npm install                      # 首次
npm test
```

- 全部通过才能提交和推送；推送到 `main` 会自动部署到 GitHub Pages。
- **例外**：只改了数据文件（`data/*.json`）和 / 或只新增了图片（`images/`）时，不需要运行测试，可以直接提交推送。改动涉及任何其他文件（代码、样式、测试、配置等）时仍要运行完整测试。
- 测试失败时先判断是应用的问题还是测试本身的问题，修复后重新运行完整测试。
- 新增或修改功能时，同步在 `tests/` 中补充或更新对应的测试。
- 不要通过跳过、删除或放宽测试来让测试通过。
- 测试不得改动仓库中的真实数据：默认测试服务器是只读的，写入相关测试使用临时目录。

## 结构

- `index.html`、`css/style.css`、`js/app.js`：纯静态前端，无构建步骤
- `data/<国家>_<语言>.json`：数据集（如 `cn_zh.json`），包含时期划分 `eras` 与事件 `events`；字段说明见 `data/README.md`，改动字段时同步更新
- `server.js`：本地服务器；`npm start` 为可写模式（网页中的修改写回数据文件），`--readonly` 供测试使用；没有 `version.json` 文件时根据 git 最近一次提交生成
- 调试模式只在本地启动时提供：仓库中的 `js/env.js`（部署版本）为 `debugAvailable: false`，`server.js` 默认改为返回 `true`，`--no-debug`（`npm run start:public`）时原样返回；网址带 `debugMode` 参数时也提供（`buildQuery` 保留该参数，`shareUrl` 不带）；测试服务器提供调试模式
- 调试模式：编辑功能（新增、编辑、删除、恢复默认数据）只在调试模式下显示，新增的编辑入口要加 `debug-only` 类；调试模式显示的网站更新时间来自部署时生成的 `version.json`（`.github/workflows/deploy.yml`）。需要编辑的测试用 `test.use({ debugMode: true })`
- 自动播放：网页加载后默认自动播放；测试中默认关闭（`tests/helpers.js` 设置 `window.TIMELINE_AUTOPLAY = false`），测试自动播放本身时用 `test.use({ autoplay: true })`
- 配色：颜色都用 `css/style.css` 中 `:root` 的变量，深色模式在 `:root[data-theme="dark"]` 中重新定义；新增颜色要同时定义两套，`tests/theme.spec.js` 检查对比度
- 侧栏筛选（`js/app.js` 中的 `FILTERS`）：**同类型的控件放在一起**（勾选框在最前，然后是下拉列表、范围输入）。新增筛选时写明 `kind`（`toggle` / `select` / `range`），面板按 `FILTER_KIND_ORDER` 自动分组；`tests/filters.spec.js` 会检查。每个筛选还要写 `toParams` / `fromParams`，把条件写进网址并能从网址恢复（见 `tests/url.spec.js`）
- 反馈 / 建议修改：所有访问者可用，通过 Web3Forms 发送（`js/config.js` 中的 `accessKey`；`enabled: false` 时反馈入口带 `feedback-only` 类被隐藏，没有 `accessKey` 时提交提示尚未配置）；建议模式复用编辑页（`openEditor(id, 'suggest' | 'propose')`），不修改数据。测试替换 `js/config.js` 并拦截发送请求（`tests/feedback.spec.js`），不得真的发出
- 脚本都从本地加载（第三方库放在 `js/vendor/`），不阻塞页面的用 `async`；`tests/share-qrcode.spec.js` 检查页面不引用外部脚本
- `lib/link-title.js`：维基百科 / 百度百科链接的词条名查询，本地服务器 `/api/link-title`（只读模式也提供）供编辑页自动填写参考链接标题；`tests/helpers.js` 默认拦截该请求，测试不访问外网
- `lib/images.js`：图片工具（格式与尺寸识别、下载、按内容哈希保存到 `images/`），服务器和导入脚本共用
- `tools/build-site.js`：生成部署用的 `_site/`（与 `deploy.yml` 复制相同的文件并写 `version.json`），Cloudflare Pages 的构建命令为 `node tools/build-site.js`、输出目录 `_site`；部署的文件列表改动时两边同步（`tests/debug.spec.js` 检查）
- `tools/wiki-import.js`：从维基百科导入 / 更新事件（`npm run wiki -- --file data/cn_zh.json 关键词`），支持 `--list`、`--dry-run`、`--refresh-images`、`--type`、`--score`；图片总是下载到本地；自动推断事件类型（`type`）和估算重要程度（`majorScore`）
- `audio/`：背景音乐（数据集的 `music` 字段引用，只从本地加载；部署时复制）。音乐按数据集配置，便于其他国家 / 语言使用各自的音乐
- `textures/`：背景纹理（数据集的 `texture` 字段引用，只从本地加载；部署时复制）。纹理按数据集配置，图片只用作遮罩形状，颜色来自 `--texture-ink`
- 社交分享卡片：`index.html` 中的 `og:` / `twitter:` 元数据用绝对地址（与 `package.json` 的 `homepage` 一致，换域名时一起改）；封面图和 apple-touch-icon 在 `images/share/`，由 `node tools/share-images.js` 生成；`tests/share-card.spec.js` 检查
- `images/`：事件图片。**所有图片都从本地加载**：数据中的图片路径只能是 `images/<文件名>`，不引用外部地址；编辑页输入的图片网址会先下载到本地
- `tests/`：Playwright 端到端测试，说明见 README
