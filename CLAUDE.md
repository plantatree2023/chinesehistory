# 项目约定

## 每次改动后必须运行测试

任何改动（代码、样式、数据）完成后、提交之前，都要运行完整的端到端测试，确认没有回归：

```bash
npm install                      # 首次
npm test
```

- 全部通过才能提交和推送；推送到 `main` 会自动部署到 GitHub Pages。
- 测试失败时先判断是应用的问题还是测试本身的问题，修复后重新运行完整测试。
- 新增或修改功能时，同步在 `tests/` 中补充或更新对应的测试。
- 不要通过跳过、删除或放宽测试来让测试通过。
- 测试不得改动仓库中的真实数据：默认测试服务器是只读的，写入相关测试使用临时目录。

## 结构

- `index.html`、`css/style.css`、`js/app.js`：纯静态前端，无构建步骤
- `data/<国家>_<语言>.json`：数据集（如 `cn_zh.json`），包含时期划分 `eras` 与事件 `events`；字段说明见 `data/README.md`，改动字段时同步更新
- `server.js`：本地服务器；`npm start` 为可写模式（网页中的修改写回数据文件），`--readonly` 供测试使用；没有 `version.json` 文件时根据 git 最近一次提交生成
- 调试模式：编辑功能（新增、编辑、删除、恢复默认数据）只在调试模式下显示，新增的编辑入口要加 `debug-only` 类；调试模式显示的网站更新时间来自部署时生成的 `version.json`（`.github/workflows/deploy.yml`）。需要编辑的测试用 `test.use({ debugMode: true })`
- 自动播放：网页加载后默认自动播放；测试中默认关闭（`tests/helpers.js` 设置 `window.TIMELINE_AUTOPLAY = false`），测试自动播放本身时用 `test.use({ autoplay: true })`
- 配色：颜色都用 `css/style.css` 中 `:root` 的变量，深色模式在 `:root[data-theme="dark"]` 中重新定义；新增颜色要同时定义两套，`tests/theme.spec.js` 检查对比度
- 侧栏筛选（`js/app.js` 中的 `FILTERS`）：**同类型的控件放在一起**（勾选框在最前，然后是下拉列表、范围输入）。新增筛选时写明 `kind`（`toggle` / `select` / `range`），面板按 `FILTER_KIND_ORDER` 自动分组；`tests/filters.spec.js` 会检查。每个筛选还要写 `toParams` / `fromParams`，把条件写进网址并能从网址恢复（见 `tests/url.spec.js`）
- `lib/images.js`：图片工具（格式与尺寸识别、下载、按内容哈希保存到 `images/`），服务器和导入脚本共用
- `tools/wiki-import.js`：从维基百科导入 / 更新事件（`npm run wiki -- --file data/cn_zh.json 关键词`），支持 `--list`、`--dry-run`、`--refresh-images`、`--type`、`--score`；图片总是下载到本地；自动推断事件类型（`type`）和估算重要程度（`majorScore`）
- `audio/`：背景音乐（数据集的 `music` 字段引用，只从本地加载；部署时复制）。音乐按数据集配置，便于其他国家 / 语言使用各自的音乐
- `textures/`：背景纹理（数据集的 `texture` 字段引用，只从本地加载；部署时复制）。纹理按数据集配置，图片只用作遮罩形状，颜色来自 `--texture-ink`
- `images/`：事件图片。**所有图片都从本地加载**：数据中的图片路径只能是 `images/<文件名>`，不引用外部地址；编辑页输入的图片网址会先下载到本地
- `tests/`：Playwright 端到端测试，说明见 README
