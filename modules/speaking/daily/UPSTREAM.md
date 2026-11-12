# SpeakLoop 口语模块 · 交接文档（本工程只接入每日语料）

> **项目**：学术类雅思 AI 陪练网站（一周交付 Demo，六人并行）
> **本交付**：口语负责人 B 负责的功能板块 + 每日语料跟读扩展
> **文档版本**：v1.3 ｜ **最近更新**：2026-11-09 ｜ **状态**：可集成 / 已自测通过
> **读者**：前端负责人（整站集成）、其余四位模块负责人（契约对齐）、第 7 天验收人

---

## 0. 一页速览

| 项目 | 内容 |
|---|---|
| 交付形态 | **纯前端静态站（3 个 HTML 页面）**，零构建、零依赖、零后端 |
| 入口 | `index.html`（主站：自由对话 / 完整模考 / 学习记录）· `shadow.html`（每日语料跟读）。上游包里的 `vocab.html`（雅思高频词库）本期按方案调整未接入，相关文件已从本工程移除，需要时从原始交付包取回 |
| 数据落点 | `localStorage`，按 `userId` 隔离；音频本体只在内存，**不出本机、不落盘** |
| 对接契约 | `assets/module-contract.js` → `window.SL.contract`；`assets/shadow-data.js` → `window.SL.contract.shadowModule`；机器可读版 `contracts.json` |
| 估分性质 | **本地可解释规则引擎**，非官方 IELTS 评分、无 LLM / 无云端 ASR；页面常驻声明 |
| 当前限制 | **部署上云与数据库导入未完成**（云环境开通被取消）；目前无后端、无跨设备同步 |
| 自测结果 | 6 套测试合计 **292 PASS / 0 FAIL**，0 运行时异常；21 条语料与 72 个词条逐条校验 0 异常 |

**接手人最需要先看的三节**：§5 数据契约 → §6 第 5 天集成指南 → §9 已知限制与待办。

---

## 1. 项目背景与职责边界

### 1.1 大项目约定（复述，便于对齐）

- 目标：面向雅思自学者，一周内交付可实际使用的学术类雅思 AI 陪练网站 Demo；用户完成一次练习后，能知道**哪里需要改进、为什么、下一步练什么**。
- 形态：首版桌面网页，界面明快，用**进度条**和**每日任务**呈现学习进展。
- 分工：六人并行 —— 前端负责人（统一界面 / 账号 / 学习记录 / 分数曲线 / 整站集成）、听力负责人、口语负责人 A、口语负责人 B（本人）、阅读负责人、写作负责人。
- 节奏：**第 1 天**统一用户与练习唯一编号、接口字段、报告格式，每模块交一份样例数据 → 独立开发自测 → **第 5 天**接入同一测试网站 → **第 7 天**用新账号统一验收完整闭环。

### 1.2 本次交付负责什么

| # | 功能板块 | 落地页面 |
|---|---|---|
| 1 | 自由对话入口（预设话题 + 自定义主题，AI 英语发问并朗读） | `index.html` · 自由对话 |
| 2 | 连续追问（从上一轮回答抽取细节并**原话引用**生成下一问） | 同上 |
| 3 | 提示 / 重说 / 回顾（思路脚手架、首答与重说并列回听、保留项 + 改进点 + 后续练习题） | 同上 |
| 4 | 完整模考 Part 1/2/3 全流程 + 四维估分（FC / LR / GRA / P） | `index.html` · 完整模考 |
| 5 | 证据化反馈与针对性复练（题号、原话、片段定位、动作、首答 vs 二稿对比） | `index.html` · 学习记录 |
| 6 | 记录分流（模考→曲线 / 自由对话→话题轮数 / 复练→回指 reportId） | `index.html` · 学习记录 |
| 7 | **扩展**：每日语料跟读 + 录音评分 + 跟读建议 | `shadow.html` |
| 8 | **扩展**：雅思高频词库（卡牌记忆 / 记忆曲线 / 听写） | `vocab.html` |

### 1.3 明确不属于本次交付（由其他负责人承接）

- 全站账号注册/登录、路由框架、统一导航与视觉规范 → **前端负责人**
- 全站学习记录汇总、跨模块分数曲线、每日任务总进度 → **前端负责人**
- 听力 / 阅读 / 写作模块与听读共用错题本 → **对应负责人**
- 服务端、数据库、对象存储、上云发布 → **未启动，见 §9**
- 官方 IELTS 评分模型、真实 AI 大模型问答与云端语音识别 → **不在 Demo 范围内**

> 本模块为了能独立跑通，自带了一套**最小账号切换**（`speakloop.users.v1`）和**本模块内的**进度条 / 每日任务 / 分数曲线。这些是**占位实现**，第 5 天应由前端负责人的统一实现替换，不要把它当成全站标准。

---

## 2. 快速开始

### 2.1 运行

```bash
# 方式 A：直接双击 index.html / shadow.html / vocab.html
#   可跑通除麦克风外的全部功能；示例音频、示例报告、评分、回听、历史均正常。

# 方式 B（推荐，麦克风可用）：本地静态服务
cd <项目根目录>
python -m http.server 8000
# 打开 http://localhost:8000/index.html
#        http://localhost:8000/shadow.html
#        http://localhost:8000/vocab.html
```

- 麦克风与语音识别要求 **https 或 localhost** + 浏览器授权；不满足时页面会提示，并可用文字作答 / 示例音频继续验收。
- 示范朗读使用浏览器 Web Speech API，音色与可用性取决于本机系统语音包；无语音包时不影响评分与报告。
- 浏览器建议 Chromium 内核桌面版（Chrome / Edge）。未做移动端适配。

### 2.2 跑测试

```bash
node tests/engine.test.js        # 模块 B 引擎（Node，无需浏览器）
node tests/shadow.test.js        # 跟读引擎 + 真实 PCM 合成信号（Node）
node tests/e2e.test.js           # 主站端到端（无头 Chrome）
node tests/shadow.e2e.test.js    # 跟读页端到端（无头 Chrome）
node tests/vocab.test.js         # 词库引擎 + SRS 调度（Node）
node tests/vocab.e2e.test.js     # 词库页面端到端（无头 Chrome）
node tools/export-contract.js    # 重新生成 contracts.json
python tools/package.py        # 重新打包交付 zip
```

> 两个 e2e 脚本各自启动本地静态服务与无头 Chrome，端口已错开（主站 `8765 / CDP 9222`，跟读 `8766 / CDP 9223`），但**仍建议串行执行**以避免无头 Chrome 资源争用。Chrome 路径与端口硬编码在脚本头部，换机器需改 `CHROME` / `PORT` / `CDP` 三个常量。

### 2.3 无麦克风的最快验收路径

1. `index.html` → 首页 **「一键载入示例报告」** → 学习记录 → 打开报告：四维估分、4 条带题号/原话/片段/动作的优先问题；点「🔊 听对应原声」定位播放；点「↻ 立即重答」生成首答 vs 二稿对比并关联原报告。
2. `shadow.html` → Hero **「▶ 示例音频 · 需要改进」**：自动生成 WAV，走与现场录音**完全相同**的解码→分析→评分→落库链路，直接得到四维评分与建议；点建议里的「🔊 听这段」可从该音频回放被点名片段。

---

## 3. 交付文件清单

```
<项目根>/
├── index.html                    主站页面（口语负责人 B 模块）
├── shadow.html                   每日语料跟读页面（扩展模块）
├── vocab.html                    雅思高频词库（卡牌 / 记忆曲线 / 听写）
├── HANDOVER.md                   本交接文档（工程向，源文件）
├── HANDOVER.html                 可预览 / 可打印的阅读版交接文档
├── contracts.json                机器可读对接契约（自动生成，勿手改）
├── assets/
│   ├── module-contract.js        【契约】模块 B 唯一编号 / 字段 / 报告硬约束 / 样例 / 验收动作
│   ├── data.js                   模块 B 题库、话题、追问模板、词表、语法规则、示例数据
│   ├── engine.js                 模块 B 追问、四维估分、报告、复练评估引擎
│   ├── audio.js                  录音 / TTS / PCM 声学分析（两个页面共用）
│   ├── app.js                    主站全部交互与持久化
│   ├── shadow-data.js            【契约+数据】21 条语料 / 7 天计划 / 5 种训练模式 / shadowModule 契约
│   ├── shadow-engine.js          跟读评分引擎（纯计算，Node 可直接测）
│   ├── shadow-app.js             跟读页全部交互与持久化
│   ├── styles.css                主站样式（CSS 变量与通用类，跟读页复用）
│   ├── shadow.css                跟读页专属样式
│   ├── vocab-data.js             【契约+数据】72 个雅思高频词 / 9 个主题
│   ├── vocab-engine.js           SRS 调度 / 队列 / 到期预测 / 听写判分（纯计算）
│   ├── vocab-app.js              词库页全部交互与持久化
│   └── vocab.css                 词库页专属样式（3D 卡牌）
├── tests/
│   ├── engine.test.js            模块 B 引擎自测
│   ├── e2e.test.js               主站端到端自测
│   ├── shadow.test.js            跟读引擎自测（含合成 PCM，50 项）
│   ├── shadow.e2e.test.js        跟读页端到端自测（46 项）
│   ├── vocab.test.js             词库引擎自测（105 项）
│   └── vocab.e2e.test.js         词库页端到端自测（64 项）
└── tools/
    ├── export-contract.js        从运行时代码导出 contracts.json
    └── package.py                按白名单打包交付 zip（含回读校验）
```

### 3.1 脚本加载顺序（**集成时不可打乱**）

| 页面 | 顺序 |
|---|---|
| `index.html` | `module-contract.js` → `data.js` → `engine.js` → `audio.js` → `app.js` |
| `shadow.html` | `module-contract.js` → `audio.js` → `shadow-data.js` → `shadow-engine.js` → `shadow-app.js` |
| `vocab.html` | `module-contract.js` → `audio.js` → `vocab-data.js` → `vocab-engine.js` → `vocab-app.js` |

两套页面共享 `window.SL` 命名空间、`audio.js` 和 `styles.css`；`module-contract.js` 必须最先加载，因为 `shadow-data.js` 会向 `SL.contract` 挂载 `shadowModule`。

### 3.2 控制台速查

```js
SL.contract                    // 模块 B 契约 + 样例数据
SL.contract.shadowModule       // 跟读模块契约 + 样例数据
SL.contract.vocabModule        // 词库模块契约（编号 / 字段 / 规则 / 验收）
SL.shadowData.CORPUS.length    // 21
SL.shadowData.byDay(1)         // 第 1 天的 3 条语料
SL.shadowEngine.parseCorpus(SL.shadowData.find('C_D1_S1'))
SL.contract.sample.report      // 第 1 天约定的样例报告
```

---

## 4. 功能地图与验收路径

### 4.1 主站 `index.html`

| 板块 | 用户动作 | 产出 / 对应字段 |
|---|---|---|
| 自由对话 | 选话题或填自定义主题 → AI 英语发问并朗读 → 录音或文字作答 ≥3 轮 | `freeSession.turns[]`，追问含 `echo` / `usedDetail` |
| 连续追问 | 回答里带具体细节（如「在京都错过末班车」） | 下一问引用原话细节，实测 3 轮连续命中 |
| 提示 / 重说 / 回顾 | 「给我一点思路」「再说一次」「结束对话」 | 结构化脚手架 + 可用表达；首答/重说并列回听；`review{keep,improve,drill,stats}` |
| 完整模考 | Part 1 → Part 2（含 1 分钟准备）→ Part 3 逐题录音 | `mockAnswer{qid,part,text,audioId,audio.metrics}` |
| 四维估分 | 交卷 | `report.dims[4]`：FC / LR / GRA / P，每维 3 条数字依据；发音只认原始音频 |
| 证据化反馈 | 打开报告 | `report.issues[]`：`qid` + `quote` + `audioStart/audioEnd` + `action` + `focus` |
| 针对性复练 | 「↻ 立即重答」带原题重说 | `practice{reportId,issueId,qid,compare}`，自动判定目标问题是否改正 |
| 记录分流 | 学习记录 / 总览 | 模考→曲线 `curvePoint`；自由对话→`free[]`；复练→`retries[]` 并回指 `reportId` |

**音频缺失分支（必须保留）**：任一题无原始音频或质量不足（<6 秒 / 峰值过低 / 几乎全静音）→ `P.band=null`、`overall=null`、`pending=true`，`reasons` 写明缺失项与补录方法，**不假造分数**。

### 4.2 每日跟读 `shadow.html`

| 能力 | 说明 |
|---|---|
| 每日语料 | 7 天计划 × 3 条 = **21 条**学术类 IELTS Speaking **Band 7–8** 示范作答；P1 短答 41–56 词 / P2 长答 171–219 词（接近 2 分钟）/ P3 抽象论述 130–153 词；示范语速 142–158 词/分 |
| 标记体系 | `*重音*`、`\|意群停顿\|`、`~连读~`，配中文释义、3 条发音提示、4 个可迁移词伙 |
| 每日跟读 | 整段示范（0.75×–1.1× 变速，长文本按意群串联朗读）、逐句播放、5 种训练模式（常规 / 慢速拆解 / 影子跟读 / 意群停顿 / 重音对比） |
| 每日任务 | 进度条 + 今日 3 条 + 连续打卡 + 近 7 次分数曲线；新账号从 **Day 1** 起算，可手动切任意 Day |
| 评分 | 现场录音（可同步语音识别）→ `decodeAudioData` → PCM 分析 → 四维 `RHY / PAU / INT / TXT` + 参考档位 + 节奏波形对比图（参考线 vs 我的录音） |
| 跟读建议 | 每条含数字依据、对应原话、`audioStart/audioEnd` 片段定位、一个具体动作、复练目标 `focus`、对应训练模式 `drillId`；另有「保留项」与「下一步练什么」 |
| 记录回看 | 报告 / 指标 / 建议持久化；刷新后仍在 |

> **注意**：跟读页的**文件上传入口已按需求整体移除**（见 §10 v1.1）。评分入口现为「现场录音」与 Hero 的「示例音频」。主站模考模块的「补录上传」是另一套独立功能，**仍保留**。

### 4.3 雅思高频词库 `vocab.html`

| 能力 | 说明 |
|---|---|
| 卡牌记忆 | 9 个学术主题 × 8 词 = **72 个雅思高频词**，含音标、词性、中英释义、例句与译文、搭配、同义替换、词根提示 |
| 释义遮挡 | 正面只显示单词 / 音标 / 词性；点击卡牌或按空格 3D 翻面后，才展示释义、例句与搭配 |
| 四档评分 | 忘了 / 有点难 / 记住了 / 太简单，按 SM-2 简化版推进间隔，每个按钮直接标注下次复习时间 |
| 发音 | Web Speech API 朗读单词与例句；无语音包时静默降级，不影响评分与记录 |
| 每日进度 | 今日目标 15 词，进度条 + 今日队列打勾 + 连续打卡；达标当次记录 streak |
| 记忆曲线 | 今日待复习 / 学习中 / 已掌握 / 听写正确率；未来 7 天到期柱状图；单卡复习历史折线（间隔增长）+ 记忆保持率估算 |
| 听写 | 只播发音不显示拼写，输入后即时判分（完全正确 / 差一点 / 错误）；错词进入次日复习；一组 10 题带正确率与错词清单 |
| 词表 | 72 词网格 + 关键词搜索 + 主题 / 掌握状态筛选 + 详情弹窗（可从详情直接插入当前队列） |
| 快捷键 | 空格翻面、1–4 评分、D 发音、听写页空格重播 |

> **调度规则**：`again` 才重置（次日重来、lapses+1）；`hard` 不重置、间隔 ×1.2；`good` 按 ease 增长；`easy` 首次 3 天 / 第二次 7 天；间隔上限 180 天，ease 夹在 1.3–3.0。听写答错按 `again` 处理，答对不替代主动回忆评分。

### 4.4 第 7 天新账号验收清单

- [ ] 新建账号 → 首页进度条 0/3、今日任务为空、历史为空
- [ ] 自由对话：自定义主题 → AI 英语发问 → 连聊 ≥3 轮，至少 1 次引用用户原话 → 结束给保留项 / 改进点 / 后续练习题
- [ ] 完整模考：三部分走完 → 四维估分 + 逐条数字依据
- [ ] 打开报告：每条问题都有题号、原话、片段时间戳和具体动作；点「听对应原声」能定位播放
- [ ] 点「立即重答」→ 生成首答 vs 二稿对比，且新记录回指原 `reportId`
- [ ] 每日跟读：当日 3 条语料可见 → 听示范（变速）→ 录音或示例音频 → 四维评分 + ≥2 条带数字依据建议 → 建议片段回听 → 按推荐模式复练
- [ ] 词库：卡牌默认遮住释义 → 点击翻面 → 四档评分 → 今日进度 +1；听写一组 10 题有正确率与错词；记忆曲线显示到期分布与单卡历史
- [ ] 学习记录：模考进分数曲线、自由对话存话题/轮数/改进建议、复练关联原报告；换账号后数据互不可见

---

## 5. 数据契约（集成必读）

完整、可执行的契约在 `assets/module-contract.js` 与 `assets/shadow-data.js` 尾部，机器可读版 `contracts.json`。以下为集成时最容易踩坑的摘要。

### 5.1 唯一编号（全员统一）

| 对象 | 规则 |
|---|---|
| 用户 | `U_<base36时间戳>_<4位随机>` — 由**前端负责人发放**，全局唯一 |
| 练习会话 | `S_FREE_*`（自由对话）/ `S_MOCK_*`（完整模考）/ `S_SHADOW_*`（跟读提交） |
| 报告 | `R_*`（模考）/ `R_SHADOW_*`（跟读），与 sessionId 一一对应 |
| 题目 | `P1-Q1` / `P2-Q1` / `P3-Q2` — 团队统一题号，用于证据定位 |
| 语料 | `C_D<day>_S<1-3>` |
| 问题 / 建议 | `ISS_*`（模考）/ `ISS_SH_*`（跟读） |
| 复练 | `P_REDO_*`，必须同时回指 `reportId` + `issueId` + `qid` |
| 音频 | `A_REC_*`（现场录音）/ `A_DEMO_*`（主站示例）/ `A_UPL_*`（主站补录上传）/ `A_SAMPLE_*`（跟读示例音频）；**本体不落 localStorage** |
| 每日任务 | `T_SHADOW_<YYYY-MM-DD>`，按 `userId + 日期` 唯一 |

> 所有 id 由 `SL.engine.uid(prefix)` / `SL.shadowEngine.uid(prefix)` 生成。硬约束：`report.sessionId === session.id`、`practice.reportId === report.id`。

### 5.2 核心字段

```text
user          { id, name }
freeSession   { id, userId, topicId, topicName, rounds, turns[], review{keep,improve,drill,stats}, createdAt }
freeTurn      { role:"ai"|"user", en?, zh?, echo?, usedDetail?, text?, audioId?, durationSec?, wpm?, redoOf?, isRedo? }
mockAnswer    { qid, part, q, zh, text, durationSec, audioId, demoWpm, audio:{metrics}, analysis? }
report (B)    { id, type:"mock", userId, sessionId, createdAt, pending, overall,
                dims[4], issues[], answers[], audioStatus, disclaimer }
dim  (B)      { key:"FC"|"LR"|"GRA"|"P", name, en, band|null, score|null, source, reasons[3] }
issue(B)      { id, qid, part, question, dim, title, quote, why, action, focus,
                audioId, audioStart, audioEnd, beforeText, status }
practice      { id, reportId, sessionId, qid, issueId, focus, question,
                beforeText, afterText, afterAudioId, compare, createdAt }
compare       { checks[{label,ok,detail}], passed, total, verdict, before{wc,wpm,fillers,complex,text}, after{...} }

corpus        { id, day, part, level, theme, title, en, zh, wpm, focus[], tips[{k,v}], vocab[] }
metrics (跟读){ usable, reason?, durationSec, speechSec, speechRatio, longestPause, longestPauseAt,
                pauseCount, pauses[{start,end,dur}], syllableCount, syllableRate, rateCV,
                f0:{samples,median,rangeSemi,finalDropSemi,reliable}, dynamicDb, peak, clipping,
                envelope[], segments[] }
report (跟读) { id, sessionId, userId, corpusId, createdAt, overall, band,
                dims[4], issues[], keep, nextStep, transcript?, disclaimer }
dim  (跟读)   { key:"RHY"|"PAU"|"INT"|"TXT", name, en, score|null, weight, source, reasons[3] }
issue(跟读)   { id, dim, level, title, evidence, quote, action, focus, audioStart, audioEnd, drillId }
session(跟读) { id, userId, corpusId, day, createdAt, overall, band, dims, issues,
                metrics, audioId, transcript?, drillId, nextStep }
task          { "YYYY-MM-DD": { free:boolean, mock:boolean, retry:number } }   // 主站
                { "YYYY-MM-DD": { done:[corpusId], target:3 } }                  // 跟读
curvePoint    { date, band, reportId }
```

### 5.3 报告格式硬约束（不可协商）

**模块 B（模考）**

1. 四维固定顺序 FC / LR / GRA / P；`band` 为 0.5 步进或 `null`。
2. 发音维度**只使用原始音频**声学指标（语速、有效发声占比、最长停顿、峰值音量、削波）。
3. 任一题音频缺失/质量不足 → `P.band=null`、`overall=null`、`pending=true`，并在 `reasons` 写明缺失项与补录方法。
4. 每条 `issue` 必须同时具备 `qid`、`quote`、`audioStart/audioEnd`、`action`、`focus`。
5. 完整模考写 `curve`；自由对话只写 `free[]`；针对性重说写 `retries[]` 并回指 `reportId`。

**跟读模块**

1. 四维固定顺序 RHY / PAU / INT / TXT；每项都给**数字依据**，不用模糊形容词。
2. RHY / PAU / INT 只使用原始音频声学指标；TXT **仅在有识别转写或用户自填文本时**计算。
3. TXT 缺失 → 该维度记 `null`，总分按其余三项权重折算，并在页面明示缺项，**不得假造文本分**。
4. `f0.reliable=false` 时 INT 只报能量动态与录音质量，**不得虚报音高结论**。
5. 每条 `issue` 必须同时具备数字依据、`quote`、`audioStart/audioEnd`、`action`、`drillId`。
6. 评分是本地可解释的韵律/节奏评估，**不判断音素准确度**，不等同官方 IELTS 发音评分；页面常驻声明。
7. 音频本体只存内存（blob URL），刷新后回听按钮置灰并说明；metrics / report / 建议全部持久化。

### 5.4 存储与账号

```text
speakloop.users.v1         用户列表（占位实现，第 5 天由统一账号替换）
speakloop.lastUser.v1      当前用户 id（占位实现）
speakloop.db.<userId>      模块 B 数据：reports / free / retries / tasks / curve
speakloop.shadow.<userId>  跟读数据：sessions / tasks / streak / curve / startDate
speakloop.vocab.<userId>   词库数据：cards / daily / streak / settings
```

三个页面共享前两个 key，因此**在同一浏览器里切换账号后，三个模块会同步切换**——这是第 7 天「新账号独立验收」能成立的前提。

### 5.5 词库契约（摘要）

| 项 | 规则 |
|---|---|
| 词条 | `W_<3位序号>`（`W_001`–`W_072`），卡片以 `wordId` 为键，不另建 id |
| 卡片 | `{ wordId, reps, ease, interval, due, lapses, last, history[{date,q,interval,ease}] }` |
| 每日 | `{ "YYYY-MM-DD": { learned:[wordId], reviewed:[wordId], dictation:{total,correct} } }` |
| 统计 | `{ total, fresh, learning, reviewed, mastered, due, learnedToday, accuracy }` |
| 契约位置 | `assets/vocab-data.js` → `SL.contract.vocabModule`；`contracts.json` 的 `modules.vocab` |

> 听写判分先归一化（忽略大小写、空格、连字符）再算 Levenshtein：距离 0 为正确，短词 ≤1 / 长词 ≤2 提示「差一点」但不计正确。

---

## 6. 第 5 天集成指南（给前端负责人）

### Step 1 · 账号体系统一

- 用统一登录态替换 `speakloop.users.v1` / `speakloop.lastUser.v1`；只需保证页面启动时能拿到 `user.id` 与 `user.name`。
- 两个页面各自用 `keyOf(userId)` 取自己的库（`assets/app.js:23`、`assets/shadow-app.js:14`），替换成后端返回即可，数据结构不变。
- 账号弹窗（`accountBtn` / `accountModal`）是占位 UI，可直接移除并换成统一用户菜单。

### Step 2 · 路由与页面挂载

- 最省事：保留三个 HTML，用统一导航做页面跳转（当前 `index.html` 顶栏已有「每日跟读 ↗」「高频词库 ↗」，两个子页都有「← 返回主站」）。
- 合并成 SPA 时务必保持 §3.1 的脚本顺序；`window.SL` 是唯一全局命名空间，所有模块挂在其下，不会污染其它模块。
- 三个页面都用了 `#view` / `#toast` / `#modal` / `#accountBtn` 等通用 id，**同一 DOM 树里不要同时挂载多个页面**，否则 id 冲突。

### Step 3 · 数据层替换（localStorage → API）

需要替换的收口点集中在两个文件：

| 文件 | 关注函数 / 位置 |
|---|---|
| `assets/app.js` | `keyOf()`、`loadDb()` / `saveDb()`、报告写入、曲线与今日任务更新 |
| `assets/shadow-app.js` | `keyOf()`、`loadDb()` / `saveDb()`、`saveSession()`、打卡与曲线更新 |
| `assets/vocab-app.js` | `keyOf()`、`loadDb()` / `saveDb()`、`grade()` 写卡片与打卡、听写结果写入 |

建议后端按 `contracts.json` 的 `fields` 建表；`report` / `practice` / `session` 三类对象可直接整体存 JSON 字段，避免首版过度范式化。

### Step 4 · 汇总全站学习记录与分数曲线

- 模块 B 的曲线点是 `{ date, band, reportId }`；跟读模块是 `{ date, overall, band, sessionId, corpusId }` 形态。汇总时**统一以 `date` 为横轴、按 `userId` 过滤**，并保留 `reportId` 作为下钻主键。
- 每日任务：模块 B 用 `{free, mock, retry}`，跟读用 `{done:[corpusId], target:3}`。全站进度条建议按「各模块完成项 / 当日总目标」聚合，不要直接改本模块内部计数。

### Step 5 · 样式合并

`assets/styles.css` 已提供 CSS 变量与通用类（`.btn` / `.card` / `.topbar` / `.nav-btn` 等），`shadow.css` 只补跟读专属类。整站换肤时优先覆盖 `styles.css` 顶部的变量；`.nav-btn.link` 是本模块新增的导航链接样式，保留即可。

### Step 6 · 联调自检

```bash
node tools/export-contract.js    # 确认契约 JSON 与代码一致
node tests/engine.test.js && node tests/shadow.test.js && node tests/vocab.test.js
node tests/e2e.test.js && node tests/shadow.e2e.test.js && node tests/vocab.e2e.test.js
```

集成后重点回归三处：**账号切换后数据隔离**、**报告回指关系**、**音频缺失时不假造分数**。

---

## 7. 评分引擎原理与诚实边界（**必读，勿对外包装成「AI 官方评分」**）

### 7.1 模块 B 估分

- FC / LR / GRA 基于**文本规则**：词数、不重复词比例、高级词与搭配、连接词、句长方差、复杂结构识别、语法规则命中、可升级表达。
- P（发音）基于**原始录音**声学指标：时长、有效发声占比、最长停顿、峰值音量、削波帧、语速。
- 文本与音频分离计算，音频不可用时只把 P 置空并暂缓总分，其余三维仍给出可解释结论。

### 7.2 跟读评分

```
原始音频 (Blob / WAV)
  → AudioContext.decodeAudioData → Float32 PCM
  → 20ms 帧 RMS → 阈值 VAD + 形态学（去毛刺/补空洞）
  → 音节核检测（能量峰 + 最小间距）→ 语速 / 节奏变异 CV
  → 停顿落点与参考意群窗口对齐
  → 降采样自相关 F0（含八度跳变校正）→ 音高跨度 / 句末降调
  → 有声帧能量动态范围（dB）→ 重音凸显程度
  → 四维加权（TXT 仅在有转写时参与）→ issues / keep / nextStep
```

`TXT` 用 LCS 对比示范文本与识别转写（或用户自填文本），给覆盖率与漏词/多词清单。

### 7.3 明确的「不做」

- 不判断单个音素是否标准、不做音素级强制对齐、不识别口音。
- 不调用任何云端 ASR / LLM；「AI 发问与追问」是本地模板引擎 + 细节抽取规则，不是大模型。
- 不等同官方 IELTS 评分；所有分数只用于**跑通「有依据的反馈 → 针对性复练 → 回看」链路**。
- 所有计算在本机浏览器完成，音频与文本**不上传服务器**（隐私声明在页面常驻）。
- 基频样本不足、音频过短或几乎全静音时，给出「评分暂缓 / 该维未评估」，不补猜测值。

---

## 8. 测试与验证结果

| 脚本 | 类型 | 覆盖 | 结果 |
|---|---|---|---|
| `tests/engine.test.js` | Node 引擎 | 细节抽取、连续 3 轮追问、四维估分、报告生成、复练对比 | PASS |
| `tests/e2e.test.js` | 无头 Chrome | 首页渲染、话题卡、追问、提示/重说/回顾、示例报告、原声定位、二稿关联、账号 | PASS，0 运行时异常 |
| `tests/shadow.test.js` | Node 引擎 | 标记解析、参考包络、**合成 PCM 声学分析**、四维评分、证据建议、边界与缺失分支 | **50 PASS / 0 FAIL** |
| `tests/shadow.e2e.test.js` | 无头 Chrome | 语料渲染、变速与训练模式、示例音频完整评分链路、建议回听、文本维度、上传区移除校验、语料库、历史持久化、账号隔离 | **46 PASS / 0 FAIL**，0 运行时异常 |
| `tests/vocab.test.js` | Node 引擎 | 72 词数据完整性（音标格式 / 例句含词 / id 唯一）、SRS 四档调度与边界、队列与到期预测、掌握度、记忆保持率、打卡、听写判分与抽题 | **105 PASS / 0 FAIL** |
| `tests/vocab.e2e.test.js` | 无头 Chrome | 卡牌翻面、四档评分与进度、打卡、听写全流程（对 / 错 / 总结）、记忆曲线、词表搜索筛选、详情弹窗、刷新持久化、账号隔离 | **64 PASS / 0 FAIL**，0 运行时异常 |

- 六套合计 **292 PASS / 0 FAIL**；21 条语料与 72 个词条逐条校验 **0 异常**，最长示范 86.4 秒（未触及 90 秒上限）。
- 已做截图视觉检查：首页、考后报告、语料库、跟读练习页、录音区，无文字截断 / 重叠 / 横向溢出。
- 过程中修复的真实缺陷：报告对象循环引用导致 localStorage 持久化中断、基频自相关八度跳变、数字静音段把音量动态虚算成 106 dB、`<em>` 斜体削弱重音高亮、长语料被浏览器 TTS 截断。

---

## 9. 已知限制 / 风险 / 待办

| # | 限制 | 影响 | 建议处理 | 优先级 |
|---|---|---|---|---|
| 1 | **上云部署与数据库导入未完成**（云环境开通弹窗被取消，400 canceled） | 目前只能本机 / 内网静态服务访问，无共享地址 | 重新走云环境激活 → 建库 → 发布；数据结构直接按 `contracts.json` 建表 | **高** |
| 2 | 无后端，全部数据存 localStorage | 换设备/清缓存即丢失，无法多人共享 | 第 5 天接统一后端（§6 Step 3） | **高** |
| 3 | 音频本体只存内存 blob URL | 刷新后历史报告里的原声无法回听（按钮置灰并说明）；报告/指标/建议仍在 | 接对象存储后按 `audioId` 持久化；或明确告知用户「本次会话内回听」 | 中 |
| 4 | 跟读页已移除文件上传 | 用户不能提交自有音频文件，评分入口只剩现场录音与示例音频 | 若产品需要上传，恢复 `.drop` 区块与 `handleFile` 链路（v1.0 有完整实现） | 中 |
| 5 | 麦克风 / 语音识别依赖 https 或 localhost + 授权 | `http://` 非本机域名、预览 iframe 受限时不可用 | 部署时配 https；不可用时引导文字作答或示例音频 | 中 |
| 6 | TTS 音色依赖系统语音包 | 无语音包时示范朗读不可用 | 后端合成示范音频或用预录音频替换 `A.speak` | 中 |
| 7 | 长语料按意群串联朗读（依赖 `onend` + 超时兜底） | 个别浏览器 TTS 事件不稳定时可能跳段 | 上预录音频最稳妥 | 低 |
| 8 | 语料标记有解析约束 | 编辑语料时若把 `~连读~` 写成含撇号/连字符、或让 `*重音*` 与 `~` 重叠，会导致高亮/匹配失败 | 见下方「语料维护约束」 | 中 |
| 9 | e2e 硬编码 Chrome 路径与端口 | 换机器/并行跑会失败 | 改脚本头部 `CHROME` / `PORT` / `CDP`；串行执行 | 低 |
| 10 | 分数与「AI 追问」均为本地规则，非官方评分 / 非大模型 | 对外演示必须如实表述 | 保持页面常驻声明，勿在宣传文案里写「官方 AI 评分」 | **高** |
| 11 | 21 条语料为示范文本，非真题 | 不能宣称来自官方题库 | 如需真题库，替换 `shadow-data.js` 的 `CORPUS` 即可 | 低 |
| 12 | 词库为 **72 词精选**，不是完整雅思词表 | 覆盖 9 个高频学术主题，不等于全量词汇 | 按同一结构扩充 `vocab-data.js` 的 `WORDS`；`tests/vocab.test.js` 会自动校验字段、id 与例句 | 中 |
| 13 | 词库发音与听写播报依赖系统 TTS 语音包 | 无语音包时听写无法听题 | 部署时可补预录音频，或在 UI 明确提示用外部发音 | 中 |

### 语料维护约束（改 `shadow-data.js` 时必看）

1. 标记语法固定：`*重音*`、`|意群停顿|`、`~连读~`。
2. `~连读~` 内**只用纯字母组合**（页面 `segHtml` 正则不含撇号/连字符），否则无法高亮。
3. `*重音*` 短语**不要与 `~` 标记重叠**，否则 `stressIdx` 匹配失败。
4. 单条语料 `expectedSec` 需 < 90 秒（当前最长 86.4 秒）。
5. `C_D1_S1` 词数须保持 **30–45**（`tests/shadow.test.js` 有断言，当前 41 词）。
6. 改完务必跑 `node tests/shadow.test.js`；契约里的 `sample.quote` 与时长需同步。

---

## 10. 变更记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.0 | 2026-11-07 | 交付口语负责人 B 模块：自由对话 / 连续追问 / 提示重说回顾 / 完整模考四维估分 / 证据化反馈与复练 / 记录分流；附 `module-contract.js` 与两套自测 |
| v1.1 | 2026-11-08 | 新增每日语料跟读页（21 条语料、录音评分、证据化建议、波形对比、历史曲线）；随后按需求**整体移除跟读页文件上传区**（含拖拽事件、历史「重新上传」入口与全部相关文案），`A_UPL_*` → `A_SAMPLE_*`；主站模考补录上传不受影响 |
| v1.2 | 2026-11-08 | 21 条语料整体升级为**学术类 IELTS Band 7–8** 示范作答（P2 接近 2 分钟、抽象议题、复杂句法）；7 天主题与语速同步升级；整段示范改按意群串联朗读；修发音提示里 `*` 星号原样显示；语料逐条校验 + 四套测试全量回归 |
| v1.2.1 | 2026-11-09 | 生成本交接文档、可打印 HTML 版、`contracts.json` 与导出/打包工具，校准契约中的语料实测词数区间，并打包交付 |
| v1.3 | 2026-11-09 | 新增雅思高频词库 `vocab.html`：72 词卡牌（释义遮挡 / 3D 翻面 / 四档评分）、SM-2 简化版间隔调度、记忆曲线（到期分布 / 掌握分布 / 单卡历史）、听写（Levenshtein 判分 / 错词回炉）、词表搜索筛选；主站导航新增「高频词库 ↗」；新增 2 套测试，六套合计 292 PASS |

---

## 11. 交接确认清单

- [ ] 前端负责人已读 §5（契约）、§6（集成）、§9（限制），确认编号与字段无冲突
- [ ] 其余模块负责人确认 `userId` / `sessionId` / `reportId` 生成规则一致
- [ ] 听力 / 阅读 / 写作模块按同一 `report.issues[]` 结构输出，便于全站报告汇总
- [ ] 确认「估分为本地规则引擎」的对外表述口径
- [ ] 排期：上云部署 + 数据库导入（当前唯一未完成的明确诉求）
- [ ] 第 7 天用新账号按 §4.4 逐项验收

---

*交接文档结束 · 有问题优先对照 `contracts.json` 与两个契约 JS 文件，它们是唯一事实来源。*
