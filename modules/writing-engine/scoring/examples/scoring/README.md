# 算法3样例说明

这里是契约演示，不是真实用户成绩。

- `input.sample.json`：既有 Task 1、Task 2 实调报告原样复制，加上**合成**的用户、稿次、未受帮助声明、提交与保存时间。源报告仍是 unverified 稿次，展示如何由宿主可信记录明确首稿身份。
- `result.sample.json`：上述输入的确定性输出。T1＝7.5，T2 原始均值＝7.125，综合＝7.25，展示＝7.5。
- `matching-source.sample.json`：交给后续找搭子模块的最小评分数据；不含作文正文和点评。
- `partial-input.sample.json`／`partial-result.sample.json`：仅 Task 1 时保留单项，综合分为 null。
- `task2-v1.1.input.sample.json`／`task2-v1.1.result.sample.json`：新增的 Task 2 v1.1 修复版报告接入验证，登记身份同样为合成数据。

模型报告来源分别为原工作区 `validation/live/mixed-accurate.report.json` 与 `validation/task2-live/discussion-complete.report.json`。样例已完整包含它们，独立包不依赖原工作区。主算法和包内测试无需 API Key。
