// 运行环境（所有数据集共用）。仓库中的这个文件就是部署到 GitHub Pages 的版本：不提供调试模式。
// 本地服务器（npm start）会改为返回 debugAvailable: true，侧栏底部才显示“调试模式”开关；
// 用 npm start -- --no-debug（或 npm run start:public）启动时返回本文件，与线上看到的一样。
window.TIMELINE_ENV = { debugAvailable: false };
