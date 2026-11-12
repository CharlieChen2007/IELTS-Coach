# Task 2 样例

这里的 `request.sample.json`、`analysis.sample.json` 和 `report.sample.json` 来自自编大学教育测试作文及真实 DeepSeek Flash 调用，不是用户成绩，也没有考官标注。

当前入口样例使用新报告 `task2-ai-v2.1`／prompt `654884cc1701851f`，对应 `validation/task2-short-live/control-256`。140／225词短稿实测也在同一目录。下述旧9份报告作为 v1.0 历史证据保留，不应修改它们的版本标签。

完整样例见 `validation/task2-live/`：讨论完整稿、删去一方具体论证的稿件、注入语法和重复句的稿件、原因措施稿、标签与题干不一致的意见题，以及采用建议后的二稿。以各自 `*.summary.json` 的 `ok` 和报告版本为准；旧失败记录或 `failures/` 内容不能当可用成绩。

`report.sample.json` 是最终算法返回，包括确定性的均值、稿件差异和收尾策略。它不等同于提供方原始JSON：已通过ready校验时，`completionPolicy` 会保留合适长度的原文作为参考版本，并将下一步改为换主题迁移，不改分数。

## 接手旧页面时的字段映射

| 旧写作Demo字段 | Task 2新字段 / 注意事项 |
| --- | --- |
| `topicId` | `questionId`，使用新题库T2编号，不按旧六主题编号猜测对应关系 |
| `ai.taskCoverage.requirements[].requirementIndex` | `feedback.taskCoverage[].requirementId`，结合source.analysis.requirements，长度不再固定3 |
| `ai.scores` | `feedback.scores`，独立保存assessment的未舍入均值 |
| `ai.stance.clarity` | `feedback.stance.status`，新增not_required、contradictory |
| `sentences[].suggestion` | `feedback.sentences`；按action决定keep/replace/delete/manual，不能仅看非空文本 |
| `ai.review.resolved` | 没有等价“已改善”结论；用revisionComparison展示实际增删，质量由当前报告评价 |
| `model` | `feedback.modelEssay.text`；保留稿次和学生成绩隔离 |
| 辅助内容降级原因 | `deliveryPolicy.adjustments`；modelEssay unavailable 时显示 note，manual 不提供采用按钮 |
| `ai.revisionPolicy` | `revisionBudget`、`revisionComparison`和completionPolicy |

原句位置使用UTF-16偏移、不可变原稿与提交ID。只采用一个句子时使用 `applyTask2Suggestion`；manual不可采用，手动改过草稿时应处理DRAFT_CONFLICT。此映射是交接说明，没有在旧网站内接入新契约。
