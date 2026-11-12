# 第一天协作契约 · IELTS Coach

> 版本 v1.1 · 2026-11-07 · 前端负责人维护
> 本文件与 `src/contract.ts` 定义**站内统一信封与编号**；代码化类型以 `contract.ts` 为准，本文用于人工对齐。
> **各模块自己的运行时数据格式以该模块交付的权威类型为准**，经适配层映射进统一信封；
> 不得把旧 D1 提案样例当作模块运行时格式（见第 7 节写作模块对齐）。
> 六人并行开发前请先确认此契约，任何字段变更须同步两处。

---

## 1. 唯一编号

所有实体使用 `<前缀>_<base36 时间戳><2 位序号><4 位随机>`，URL 安全、可按时间排序、全局唯一。

| 前缀 | 实体 | 生成方 | 示例 |
|---|---|---|---|
| `usr_` | 用户 | 前端（云账号映射为 `usr_<cloudUid>`；演示账号本地生成） | `usr_m1x9k2a01b7f` |
| `exr_` | 练习 / 题目集 | 各科负责人，首版样例由前端预置 | `exr_re_pass_01` |
| `atm_` | 一次作答提交（attempt） | 前端，创建时生成 | `atm_m1x9k3c02e4a` |
| `rpt_` | 报告 | 判题模块产出，前端落库 | `rpt_m1x9k9d03a1c` |
| `fb_` | 单条反馈 | 判题模块 | `fb_m1x9k9e04b2d` |
| `mis_` | 错题本条目 | 前端由 `feedback[]` 派生 | `mis_m1x9k9f05c3e` |
| `tsk_` | 每日任务记录 | 前端 | `tsk_20261107` |

**关键约定**：`atm_` 是去重与关联的主键。报告、错题、每日任务、复练链全部通过 `attemptId` 关联；`retakeOf` 填写被复练的原 `attemptId`。

---

## 2. 接口字段

### 2.1 通用信封

```jsonc
{ "code": 0, "message": "ok", "traceId": "…", "ts": "2026-11-07T15:20:00+08:00", "data": { } }
```

所有携带用户数据的请求必须带会话；服务端以身份过滤，**前端不得用 `userId` 做安全边界**。首版 Demo 的业务数据落在浏览器本地仓储，按 `userId` 分桶隔离，接口形状保持一致，第五天可整体替换实现（`contract.ts` 的 `Repository`）。

### 2.2 端点清单

| 方法 | 路径 | 说明 | 主要字段 |
|---|---|---|---|
| POST | `/api/auth/register` `/login` `/logout` | 注册 / 登录 / 退出 | `email`, `verificationId`, `token` |
| GET | `/api/me` | 当前用户 | `userId`, `nickname`, `targetBand`, `createdAt` |
| PATCH | `/api/me/goal` | 设置昵称与目标分 | `nickname`, `targetBand` |
| GET | `/api/exercises` | 练习清单 | `subject`, `mode` 可筛选 |
| POST | `/api/attempts` | 创建一次练习 | `exerciseId`, `subject`, `mode`, `retakeOf?`, `focus?` |
| PATCH | `/api/attempts/:id/draft` | 自动保存草稿 | `draftText?`, `answers{}` |
| POST | `/api/attempts/:id/submit` | 提交作答 | `answers{}`, `draftText?` → `{ attemptId, status: 'scoring' }` |
| GET | `/api/attempts/:id` | 轮询评分进度 | `status`, `progress`, `reportId?` |
| GET | `/api/reports/:reportId` | 报告详情 | 见第 3 节 |
| GET | `/api/history` | 历史列表 | `subject`, `mode`, `dateFrom`, `dateTo` |
| GET | `/api/trends` | 曲线数据 | `metric` |
| GET | `/api/mistakes` | 错题本 | `subject`, `questionType`, `reviewStatus` |
| PATCH | `/api/mistakes/:id` | 标记已复习 | `reviewStatus` |
| POST | `/api/attempts/:id/retake` | 由推荐生成复练 | `targetId`, `focus` |
| GET | `/api/daily-tasks` | 每日两格 | `date` |

### 2.3 核心对象字段

```ts
type Subject = 'speaking' | 'writing' | 'listening' | 'reading'
type Mode    = 'mock' | 'free' | 'task2' | 'passage' | 'section' | 'retake'
type AttemptStatus = 'draft' | 'scoring' | 'ready'

interface Attempt {
  attemptId; userId; exerciseId; subject; mode; title; status
  createdAt; submittedAt?; answers: Record<string,string>; draftText?
  reportId?; progress: number        // 评分中 0-100，刷新后据此恢复
  retakeOf?: string; focus?: string
}

interface FeedbackItem {              // 一条「有依据的反馈」
  id; type: 'sentence'|'question'|'utterance'|'audio'|'paragraph'
  location: { label; sentenceIndex?; paragraph?; startSec?; endSec?; questionId? }
  quote: string        // 原文 / 原声转写 / 考生原句，必须可核对
  issue: string        // 哪里需要改进
  why: string          // 为什么（依据：原文句子、评分标准、语法规则）
  suggestion: string   // 怎么改
  revised?: string     // 改写 / 升级表达
  questionType: string // 用于薄弱题型推荐与错题本筛选
  severity: 'high'|'medium'|'low'
}

interface Recommendation {
  targetType: 'questionType'|'exercise'|'skill'
  targetId; label; reason; cta       // reason 不得为空，必须解释「为什么下一步练这个」
}
```

---

## 3. 统一报告格式

四科共用一个信封，科目差异全部放进 `evidence`；`original` 保存当时的题目与作答快照，保证历史记录可完整回放。

```jsonc
{
  "reportId": "rpt_…", "attemptId": "atm_…", "userId": "usr_…",
  "subject": "writing", "mode": "task2", "exerciseId": "exr_wr_task2_01",
  "status": "ready", "createdAt": "2026-11-07T15:20:00+08:00",

  "score": {
    "band": 5.5,              // 口语 / 写作：预估 band；听读为 null
    "display": "5.5",         // 界面展示串
    "trendMetric": "writing_band",  // speaking_mock_band | writing_band | reading_correct | listening_correct
    "correct": null, "total": null, "firstTryCorrect": null  // 听读必填
  },

  "dimensions": [ { "key": "TR", "label": "Task Response", "score": 5, "comment": "…" } ],
  "feedback": [ /* FeedbackItem[]，见 2.3 */ ],
  "highlights": ["…"],
  "recommendations": [ /* Recommendation[]，见 2.3 */ ],

  "evidence": {
    // 听力：audioUrl, transcript, segments[{startSec,endSec,text}]
    // 阅读：passage, paragraphs[]
    // 写作：sentences[{index,text}], upgradedEssay, draftV2
    // 口语：audioUrl, turns[{role,text,atSec}]
  },

  "original": { "title", "prompt", "answers": {}, "submittedText": "…" },
  "retakeOf": "atm_…"
}
```

### 3.1 曲线口径（前端据此画图）

| trendMetric | 含义 | y 值 | 展示 |
|---|---|---|---|
| `speaking_mock_band` | 完整口语模考 | `band` | 趋势折线 |
| `writing_band` | 写作单篇估分（含二稿） | `band` | 趋势折线 |
| `reading_correct` | 阅读正确数 | `correct` | 折线 + 正确数 / 首答题数表 |
| `listening_correct` | 听力正确数 | `correct` | 折线 + 正确数 / 首答题数表 |

> 自由对话与针对性复练**不进主曲线**，避免把不同难度的分数混在一起比较。

### 3.2 各模块必须提供的字段

| 模块 | 必须填充 | 不允许省略 |
|---|---|---|
| 听力 | `evidence.segments`、每条 `feedback.location.startSec/endSec`、`score.correct/total/firstTryCorrect` | 原声定位时间戳 |
| 口语 A（模考+录音） | `evidence.turns`、`evidence.audioUrl`、`score.band`、`dimensions` | Part 1/2/3 分段 |
| 口语 B（自由对话+估分） | `evidence.turns`、`recommendations`、`report` 与 `retake` 入口 | 推荐理由 |
| 阅读 | `evidence.paragraphs`、`feedback.location.paragraph`、`feedback.quote` | 原文证据句 |
| 写作 | `evidence.sentences`、`feedback.revised`、`evidence.upgradedEssay`、`evidence.draftV2` | 逐句索引 |
| 前端 | `Repository`、`DailyTaskState`、历史 / 曲线 / 错题本 / 整站集成 | 账号隔离与刷新恢复 |

---

## 4. 每日任务与去重

```ts
interface DailyTaskState {
  date: string          // YYYY-MM-DD，本地时区
  newPractice: string[] // attemptId 集合
  retake: string[]      // attemptId 集合
}
```

- 两格任务固定为「完成一次新练习」「根据反馈复练一次」。
- 判定：`attempt.retakeOf` 存在 **或** `mode === 'retake'` → 计入 `retake`，否则计入 `newPractice`。
- **同一提交只计一次**：写入前检查 `attemptId` 是否已在集合中；重复回调、重复点击、页面刷新都不得重复计数。
- 完成即时点亮，进度条按 `0 / 50 / 100%` 渲染。

---

## 5. 前端边界

前端**只做页面交互与数据落地**，不实现以下逻辑：题目生成、判题规则、评分算法、录音转写、作文打分。当前用 `sampleScoringAdapter`（返回契约样例报告）占位，第五天替换为各科模块接口。

评分采用异步状态机：`draft → scoring(progress 0-100) → ready`。`scoring` 状态与进度持久化，刷新页面后由前端定时器继续推进，不丢任务。

---

## 6. 集成与验收

| 时间 | 动作 |
|---|---|
| 第一天 | 确认本契约；每模块交一份样例数据（见 `SAMPLE_DATA.md`）；各自独立开发自测 |
| 第五天 | 各模块接入同一测试网站，替换 `sampleScoringAdapter`，核对报告字段与曲线口径 |
| 第七天 | 用**新账号**统一验收：`选择练习 → 提交作答 → 查看有依据的反馈 → 针对性复练 → 回看历史记录` |

验收硬性检查项：评分中刷新可恢复、每日任务不重复计数、两个账号数据互不可见、曲线上的点能打开对应报告、错题本三条件筛选可用、复练链 `retakeOf` 可追溯。

---

## 7. 写作模块交接包对齐（v1.1）

交接包：`tcamp-writing-frontend-handoff-v2`（`source/` 为源码根）。权威文档为
`docs/handoff/FRONTEND.md`、`DESIGN.md`、`design-tokens.json`、`manifest.json`。

### 7.1 运行时数据不是 D1 提案

**旧 D1 提案样例 `docs/fixtures/writing-report.sample.json` 不能作为 Workspace 导入**；
可恢复的运行时样例是 `docs/handoff/runtime-workspace.sample.json`，存储键 `tcamp-writing-demo:v1`。
权威类型：`lib/demo.ts`（`Workspace` / `Draft` / `Submission`）与 `lib/writing.ts`（`Sentence` / `Report`）。
站内适配层：`src/writingContract.ts`（类型、映射、约束、转信封函数已代码化并可自测）。
本机 UUID 的 `userId` **不是登录身份**，不能用于鉴权或账号隔离。

| D1 提案字段 | 运行时字段 | 处理 |
|---|---|---|
| `questionId` | `topicId` | 适配命名 |
| `submissionId` | `Submission.id` | 适配命名 |
| `parentSubmissionId` | `parentId` | 适配命名 |
| `submittedAt` | `createdAt` | 运行时无独立 `completedAt` |
| `feedbackMode: essay / language_only` | `mode: essay / language` | 枚举不同 |
| `queued / processing / completed / timed_out / failed` | `pending / done / failed` | `timed_out` 并入 `failed`，`error` 为说明文本 |
| `sentenceId / startUtf16 / endUtf16` | `id / start / end` | 同为 UTF-16 语义 |
| `needs_revision / could_improve / keep` | `fix / improve / keep` | 显式映射 |
| `draftId / draftRevision / jobId / reportId` | 无 | **不得虚构补值并称为服务端 ID** |
| `feedbackSource / scores / taskCoverage` | `sample + mode + getDiagnosis()` | 不是 D1 报告结构 |

三类批注语义：`fix → needs_revision / 需要修改 / severity high`、
`improve → could_improve / 可以加强 / medium`、`keep → keep / 可保留 / low`。
`sample` 表示原稿完全匹配预置样例且非语言模式；`isExample` 表示示例练习及其修订来源，两者不可互相替代；
`fragment` 由显式语言模式决定，不足 250 词由 `report.count < 250` 单独判断。

### 7.2 四项不可破坏的约束

1. **首稿不可变**：每个 `version` 保存独立快照，二稿另存，不覆盖 `parent.text`。
2. **重复句锚点**：`start/end` 为 UTF-16 0 基偏移（start 含、end 不含），
   `paragraph/index` 从 1 开始，必须满足 `submission.text.slice(start, end) === sentence.text`；
   同文句子的 ID 含提交与起始位置，禁止全局字符串替换。
3. **手改冲突保护**：应用建议前重建整份基准文本并校验锚点，冲突即拒绝并提示手动处理。
4. **重试复用提交**：`pending` 恢复为 `failed` 后复用同一份原稿重试，不新建空提交。

`src/writingContract.ts` 提供 `validateAnchor()` 与 `assertNoManualConflict()` 供集成时直接复用。

### 7.3 示例 / 规则反馈 / 真实评估

`adaptWritingSubmission()` 把运行时提交映射为本文件第 3 节的统一 `Report` 信封：
每条 `FeedbackItem` 仍含 `quote → issue → why → suggestion → revised?`，
`location.startUtf16/endUtf16` 保留锚点，`evidence` 保存完整 `sentences`、`upgradedEssay`、`draftV2` 与版本关系。

`evidence.feedbackSource` 取值 `sample | rule | real`，`evidence.sourceLabel` 给出可读来源标识。
**只有 `feedbackSource === 'real'` 且 `score.band !== null` 的报告允许进入全站分数曲线**（`isCurveEligible()`）。
示例四维 6.0 是预置演示值，不得写入真实成绩；规则反馈 `score.display = '不估分'`。
接入真实 AI 后，报告必须保存为不可变快照，不能再用本地 `evaluate()` 重算覆盖。

### 7.4 全站视觉基准

`DESIGN.md` 明确整站色彩、布局与组件风格以写作 Demo 为起点延续升级。
`src/styles.css` 已落地 `design-tokens.json` 的 baseline：浅蓝 `#f5f8fb`、正文 `#233b50`、
品牌蓝 `#4388c4`、淡柠檬黄 `#f4f2cd`、半透明白卡片、224px 侧栏 / 77px 顶栏 /
1540px 内容区 / 18px 卡片圆角、蓝色渐变主按钮、三类反馈状态色，
以及 1600 / 1190 / 970 / 760 / 500px 响应式断点。首页玻璃主视觉与纸飞机标识取自交接包 `public/`。

按 `FRONTEND.md` 的接入建议，侧栏、顶栏、学习概览、全站历史与账号入口仍由前端负责人统一；
`writing-studio.tsx` 是含自带侧栏与全局 CSS 的无 props 组件，整体拆入统一 Layout 属于第五天合站工作，本次未擅自改动其源码。

### 7.5 主体色调严格收敛（2026-11-07）

权威色板是交接包的运行时样式表 `source/app/globals.css`，而非仅 `design-tokens.json` 的代表值。
全站十六进制色值（CSS、TSX 内联色、SVG 网格与坐标轴、四条分数曲线、反馈状态、浏览器 `theme-color`）
已全部映射到该色板，不再引入紫 / 靛 / 杂绿等外来色。主体色：品牌蓝 `#4388c4`、页面底 `#f5f8fb`、
柠檬黄强调 `#f4f2cd`；`#4a6075` 是长文对比度的唯一扩展色。

四条曲线使用同色系深浅梯度以便区分：口语模考 `#254b65`、写作估分 `#397fb5`、
阅读正确数 `#73accd`、听力正确数 `#a6d7f0`。涨跌与反馈沿用交接包状态色
（`#2f6b4f` 已修改 / `#a34f38` 需要修改 / `#756a2c` 可以加强），不另造颜色。

`scripts/verifyEntry.ts` 第 13 组断言会在自测中拦截任何旧色系回退；其余模块接入时请直接复用 `styles.css` 变量。
