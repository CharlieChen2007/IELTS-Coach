# 样例数据清单 · 第一天

> 与 `docs/CONTRACT.md` 配套。所有样例数据代码化在 `src/seed.ts`，前端可独立自测；
> 各科负责人请按此形状产出自己的样例数据，第五天直接替换。

---

## 1. 六模块各一份

| 模块 | exerciseId | 报告样例 | 关键字段 | 样例内容 |
|---|---|---|---|---|
| 听力负责人 | `exr_li_sec_01` | `SAMPLE_REPORTS['exr_li_sec_01']` | `audioSegments`、`feedback[].location.startSec`、`score.correct/firstTryCorrect` | Section 3 学术讨论（sleep & memory consolidation），6 题，含 00:08–01:36 六段时间戳转写 |
| 口语负责人 A | `exr_sp_mock_01` | `SAMPLE_REPORTS['exr_sp_mock_01']` | `evidence.turns`、`score.band`、`dimensions` | Part 1 三问 / Part 2 cue card / Part 3 三问，估分 6.0 |
| 口语负责人 B | `exr_sp_free_01` | `SAMPLE_REPORTS['exr_sp_free_01']` | `evidence.turns`、`recommendations` | 自由对话 2 轮，估分 5.5，推荐回到计时模考 |
| 阅读负责人 | `exr_re_pass_01` | `SAMPLE_REPORTS['exr_re_pass_01']` | `evidence.paragraphs`、`feedback[].location.paragraph`、`questionType` | Attention Restoration Theory 四段文章，10 题，7/10，首答 6/10 |
| 写作负责人 | `exr_wr_task2_01` | `SAMPLE_REPORTS['exr_wr_task2_01']` | `evidence.sentences`、`feedback[].revised`、`upgradedEssay`、`draftV2` | Task 2 一稿 5 句逐句标注，5.5 分；升级版范文；二稿 6.5 分对比 |
| 前端负责人 | `exr_re_retake_01` | `SAMPLE_REPORTS['exr_re_retake_01']` | `retakeOf`、`recommendations`、`DailyTaskState` | 判断题专项复练，3/4，首答 3/4，验证复练链与去重 |

另有 `exr_li_retake_01`（听力填空复练）、`exr_wr_retake_01`（写作二稿复练），供针对性复练闭环使用。

---

## 2. 样例反馈的形状

每条反馈必须同时给出**证据、错因、改法**，三者缺一不可。示例（阅读）：

```json
{
  "id": "fb_r_1",
  "type": "paragraph",
  "location": { "label": "Paragraph B · 第 2 句", "paragraph": 2, "questionId": "q_re_4" },
  "quote": "Green space is a reliable source of such fascination, but the theory does not claim it is the only one…",
  "issue": "判断题误选 TRUE，正确答案 FALSE",
  "why": "原文用 does not claim it is the only one 明确否定唯一性，题干 only 与原文直接冲突，属于 FALSE；若原文完全未提及其他环境才是 NOT GIVEN。",
  "suggestion": "遇到 only / all / never 等绝对词，先在原文找是否有显式否定或限定语。",
  "questionType": "判断题 T/F/NG",
  "severity": "high"
}
```

写作反馈额外带 `revised`（改写 / 升级表达）；听力反馈额外带 `location.startSec/endSec`（原声定位，报告页可点击回听）。

---

## 3. 推荐的理由字段

```json
{
  "targetType": "exercise",
  "targetId": "exr_re_retake_01",
  "label": "复练：判断题 T/F/NG 专项 4 题",
  "reason": "本次 3 道错题中 2 道为判断题，且分别对应 FALSE 与 NOT GIVEN 两类不同误判。",
  "cta": "去复练"
}
```

`reason` 必须说明「为什么是这个」，不能只写「建议多练」。前端把 `targetId` 拼成 `practice/<targetId>?retakeOf=<attemptId>&focus=<targetId>`，形成可追溯的复练链。

---

## 4. 在演示版验收

1. 用新账号进入学习首页，点击 **「查看写作批改示例」**。页面地址为 `#/report/sample-writing`，可直接查看示例原稿、逐句改写和升级版范文。
2. 点击「返回学习首页」再打开「全部记录」。新账号的历史仍为空。
3. 打开「开始今天的练习」，输入自己的作文并保存草稿。返回首页后点击「继续」，可读回刚才的文字。
4. 在阅读训练首页选择「开始篇章练习」，完成并提交一次作答，再检查历史列表、正确数曲线、错题和每日进度。以上统计取自该账号实际提交的练习。

校园互助大厅提供四科求助案例，口语诊所提供可预约、可回听的语音案例。顶栏「演示模式」以当前昵称载入四科学习记录与校园活动，退出后恢复自己的记录。
