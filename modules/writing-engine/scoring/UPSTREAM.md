# 算法3 · 首稿综合打分交接包 v1.1

交付日期：2026-11-09。面向接手 Agent，主入口 src/scoring.mjs。

## 直接运行

需要 Node.js 24，无第三方依赖，无需 npm install，无需 API Key。

```powershell
node verify-package.mjs
npm test
npm run verify
node scripts/scoring-cli.mjs score examples/scoring/input.sample.json local-result.json
```

离线验证预期：29 项测试通过，4 份 Schema 和 7 份样例校验通过。示例综合原始分 7.25，展示 7.5。CLI 输出文件必须尚不存在，避免覆盖旧结果。

## 功能与接入

1. 前两个算法分别产出 Task 1／Task 2 完整评分报告；本包不重新调用 AI 批改正文。
2. 宿主从持久化记录取得用户、测评组、题目、原文、第一提交编号、稿次、来源、帮助状态与时间。
3. 宿主将首次成功的报告和 hashScoringReport(report) 原子锁定；不得由浏览器挑选较高的重评分。
4. 调用 scoreWritingSet({userId, assessmentSetId, asOf, records})。
5. result.tasks 用于单项反馈，result.writing 用于本组综合写作估分，result.matchingSource 提供给后续找搭子模块。

四维等权；Task 1∶Task 2＝1∶2；保留原始均值，最后才做产品展示取整。缺一个任务时综合为 null。二稿、示例、辅助作答和无法确定帮助状态的记录不进入首稿基线。

先读 docs/SCORING算法与契约.md，严格区分官方权重、产品规则和宿主信任责任。90 天有效期、7 天配对窗口、半分展示和版本兼容策略是本产品约定，可在后续策略版本中调整并回归测试。

## 文件入口

- src/scoring.mjs：主函数与稳定报告哈希；不依赖网络、文件读取或环境变量。
- src/scoring-policy.mjs：当前兼容版本及产品策略。
- src/scoring-contracts.mjs 与 schemas/：输入／输出／匹配源数据契约。完整 report 的关联和评分证据由运行时进一步校验。
- examples/scoring/：全量输入、结果、缺项输入与结果、匹配源数据样例。
- tests/scoring.test.mjs：29 项算法测试。
- validation/SCORING-RESULTS.md：验证范围和已知局限。
- package-manifest.json／verify-package.mjs：文件校验清单与校验器。

示例中的模型报告保留既有实调分数；身份、首稿与未受帮助声明是合成演示记录，不能当真实用户成绩。所有测试默认离线。

## 与之前包的关系

兼容 Task 1 包 v1.0 的 task1-ai-v1 报告及 Task 2 包 v1.0 的 task2-ai-v2 报告与 v1.1 的 task2-ai-v2.1 报告。两包分别负责读图／审题和 AI 评估，本包只负责组合评分。共用 contracts.mjs、task2-contracts.mjs、validation.mjs 保留上游定义，均已随包提供，不需要原工程或原题库。没有更换 DeepSeek 模型；本层不消耗模型额度。

仅返回写作练习估计，未与考官评分校准，不是 IELTS 四科总分。配对算法、推题算法、前端、站点、云部署、数据库实现不在本包内。原网站与已交付包未更新。
