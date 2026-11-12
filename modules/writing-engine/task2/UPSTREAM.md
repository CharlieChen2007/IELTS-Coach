# Task 2 算法修复包 v1.1

日期：2026-11-09。源码 writing-ai 0.3.1；报告 `task2-ai-v2.1`；prompt `654884cc1701851f`。先读本文件，再读 `docs/TASK2短稿修复与迁移.md`。旧 v1.0 ZIP 和历史报告没有覆盖。

## 先验证

需要 Node.js 24，无第三方依赖，不必 npm install：

```powershell
node verify-package.mjs
npm test
npm run verify
```

预期33项 Task 2测试通过；5份 Schema、260题目录、9份历史报告和3份新版短稿报告通过验证。默认验证零网络请求，无需配置 Key。

## 修复内容

短稿的有效评分不再因“范文不足250词”或“建议增词超预算”而整份作废。范文仍需满足250词及段落要求，否则明确 unavailable；超限建议转 manual，不自动扩写。评分、设问覆盖、立场、证据不改动，非法 JSON／无效结构仍有限重试后报错。

新增 `repairTask2Feedback` 纯函数和 `deliveryPolicy` 审计；transport 保留字段级结构化校验详情。引擎已内置修复，直接调用无需二次处理。手工移植宿主需要更新整条链路，不能先用旧严格 validator 拦住响应再调用 repair。

## 接入入口

- `src/task2.mjs`：createTask2Engine、evaluateTask2、repairTask2Feedback 等。
- `src/task2-repair.mjs`：明确白名单的辅助反馈修复；不改分、不改立场、不猜补证据。
- `src/task2-validation.mjs`：核心校验、严格校验及字段级诊断。
- `schemas/task2-delivery.schema.json`：新增审计字段契约。
- `resources/task2-catalog.json`：260题完整题干；不需要原 Markdown 才能运行。
- `examples/task2/`：新版本默认请求／报告；`validation/task2-short-live/`：140／225／256词实调。
- `docs/TASK2短稿修复与迁移.md`：TypeScript移植、UI字段处理、缓存失效与打分兼容步骤。

真实调用仍从服务端读取 DeepSeek Key；将 `.env.example` 复制为 `.env` 后填写自己的配置，默认 deepseek-flash。包内不附带开发者 Key。显式付费验证为 `node --env-file=.env scripts/task2-short-live.mjs --run`；这会重测3篇开发稿，正常接入无需执行。

## 必须同步的兼容处理

升级时清空旧进程缓存，对新请求重建审题 artifact。旧报告继续保留原版本，不能改标签冒充新报告。

算法3打分包 v1.0 只接受旧 Task 2版本。若接入综合打分，同时使用此次提供的打分包 v1.1；它接受新旧报告的精确版本组合，评分公式和首稿条件不变。

前端以 modelEssay.kind 控制范文显示；unavailable 展示 note，manual 禁止采用。不要把“评分成功、范文不可用”显示成“整篇批改失败”。无需由前端自己扩大预算或拼词。

本包未改网站、原个人／团队作品包、云部署或数据库。结果仍是未与考官校准的练习估分。完整边界和实测记录见包内文档。
