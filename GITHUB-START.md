# IELTS Coach · GitHub 项目入口

当前版本包含一键演示登录，以及听、说、读、写、词汇和校园协作的完整前后端。

- 当前发布标识以 `release-manifest.json` 为准，功能基于一键演示登录版。
- 环境：Node.js 24 或以上。
- 原样运行：`node scripts/release-integrity.mjs verify`，然后 `node scripts/start.mjs`。
- 打开 `http://127.0.0.1:4192/#/auth?mode=signup`，点击 **演示模式一键登录**，使用 **Test / test@qq.com**，自动进入独立演示空间。
- 已附带 `dist` 成品；原样运行不需要安装前端依赖。
- 开发修改：`npm ci` → `npm run build` → `node scripts/release-integrity.mjs freeze`；发布前自行完成对应验收。
- 部署指南：[一键演示登录交接](docs/一键演示登录-部署交接.md)。

## 数据与服务

SQLite 数据库首次启动自动创建，可用 `IELTS_DATA_DIR` 指向持久化目录。DeepSeek、腾讯 SOE 等密钥仅在服务器环境配置，参考 `deploy.env.example`；仓库不包含密钥、真实账号数据库、用户录音或本机依赖。

`Test / test@qq.com` 是无需验证码的演示资料，不代表经过邮箱验证的真实账号。验证码登录需要部署平台的认证服务。听力素材等第三方材料的使用边界见 [原始交付与素材说明](docs/原始交付与验收说明-2026-11-11.md)，不应将教学演示等同于素材的再授权。

仓库内的发布清单用于检查原样成品完整性；GitHub 专用说明和 Git 配置不改变应用功能。
