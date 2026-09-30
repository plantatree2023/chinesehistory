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
- `data/<国家>_<语言>.json`：数据集（如 `cn_zh.json`），包含时期划分 `eras` 与事件 `events`
- `server.js`：本地服务器；`npm start` 为可写模式（网页中的修改写回数据文件），`--readonly` 供测试使用
- `tools/wiki-import.js`：从维基百科导入 / 更新事件（`npm run wiki -- --file data/cn_zh.json 关键词`），支持 `--list`、`--dry-run`
- `images/`：本地保存的事件图片
- `tests/`：Playwright 端到端测试，说明见 README
