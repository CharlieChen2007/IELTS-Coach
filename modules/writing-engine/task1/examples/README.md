# 样例说明

`request.sample.json` 是围绕用户图库 T1-001 自编的172词测试作文；不是用户练习记录，也不是官方范文。

`source.sample.json` 使用配套参考事实表，`origin=reference`、`review.kind=agent_visual_review`、`humanVerified=false`。

`report.sample.json` 为真实 DeepSeek Flash 批改该测试作文后产生的报告，包含确定性包装字段；不是离线规则生成或考官标注。

更多首稿与二稿输入、真实输出见 `validation/live/`。`live-cases.mjs` 保存四篇自编输入与测试意图，便于替换模型或提示词后重测。离线测试中的 `tests/fixtures.mjs` 则是明确的合成契约数据，不能拿它做评分准确率证据。
