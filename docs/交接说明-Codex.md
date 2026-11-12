# IELTS Coach · WorkBuddy 交回说明

> 交接对象：Codex
> 基线：`IELTS-Coach-校园营地整合交付版.zip`
> 交付：`IELTS-Coach-WorkBuddy交回版.zip`
> 日期：2026-11-10

---

## 1. 怎么跑起来

```bash
# 1) 安装依赖（Node >= 22.13，项目使用 node:sqlite，无需额外数据库服务）
npm ci

# 2) 构建（dist 已随包提供，只有改了 src/ 或 public/ 才需要重新构建）
npm run build

# 3) 启动（默认 4192；PORT 可改）
PORT=4192 node scripts/start.mjs
```

打开 `http://127.0.0.1:4192/?demo=1#/auth`，用任意昵称进入。顶栏「演示模式」可载入演示账号的学习记录。

首次启动会自动创建 `.data/studio.sqlite` 并执行全部迁移，不需要手工建库。Windows 下也可直接双击 `启动整合版.cmd`。

**本次实测**：在全新目录解压 → `npm ci`（69 个包，约 1 秒，命中缓存）→ 启动 → 首次自动建库，全程无手工步骤。

---

## 2. 相对基线改了什么

基线里只有听力、口语、校园营地。本轮补齐了写作与阅读两个科目，并把四科的展示方式、滚动行为、数据持久化统一成同一套。

| # | 改动 | 说明 |
| --- | --- | --- |
| 1 | **阅读模块接入** | 交接包 `ielts-reading-lab` 整体并入 `public/reading/`，业务代码零改动；18 篇精读 / 8 类题型 / 217 题全部保留 |
| 2 | **写作模块接入** | `tcamp-writing-team v4.0` 并入 `public/writing/`；199 张 Task 1 题图、260 道 Task 2 题库、编辑器、批改链路保持原样 |
| 3 | **四科展示方式统一** | 统一为「钴蓝科目横幅 + 一排横向功能页签 + 主内容区一层进场动画」；两个独立站的顶栏/侧栏/品牌/加载页在嵌入态全部隐藏，首帧静默 |
| 4 | **全站单一滚动轴** | iframe 撑到内容真实高度、自身不滚动；模块内部的 `100vh`、`overflow:auto`、fixed 弹窗改成自然高度页内卡片。整页只有主站一条滚动轴 |
| 5 | **进度持久化** | 新增 `reading_state`、`writing_workspace`、`writing_ai_usage` 三张表；阅读的 `yl.v1.*`、写作的游客工作区按站内账号隔离备份 |
| 6 | **持久化改由主站代发** | iframe 在切换科目时会被卸载，页面内 `fetch` / `sendBeacon` 都会被浏览器取消（`net::ERR_ABORTED`）。改为 iframe 只上报，主站发请求（`src/iframePersist.ts`） |
| 7 | **每日语料 / 词汇** | 收进口语模块，唯一入口；配色统一成语料的青蓝色调；切页签不重建 iframe，录音与滚动位置不丢 |
| 8 | **动画收敛** | 全项目统一为「页签不动、只有页签下方主内容区进场一次」；去掉所有「正在读取/正在载入」文案与首屏骨架 |
| 9 | **若干缺陷修复** | 顶栏滚动透出改实色；空态被最小高度撑出空白；横幅统计与模块内题量口径不一致；切「学伴互助」时 iframe 被卸载 |
| 10 | **验收脚本** | 新增 `check-reading.mjs`（77 项）、`check-writing.mjs`（36 项）、`check-style-unify.mjs`（29 项）、`check-motion.mjs` |

### 从网站哪里能看到

| 位置 | 看什么 |
| --- | --- |
| 左侧导航 → 阅读精读 | 横幅统计（已完成 / 18 精读篇目 / 最近成绩）、8 个页签、左右分屏做题、页内交卷确认框 |
| 左侧导航 → 写作批改 | 6 个页签；「写作精修」里点题库，「题库」以页内白卡展开，整页一条滚动轴 |
| 左侧导航 → 口语陪练 | 每日语料、词汇两个入口；页签切换不重新加载 |
| 左侧导航 → 听力精炼 | 四个页签、真实音频可播放 |
| 左侧导航 → 校园营地 | 营地 / 排行榜 / 寻找搭子 / 考试经验 |
| 任意科目页滚动 | 只有主站一条滚动条，滚轮不会在不同区域控制不同容器 |

---

## 3. 关键文件

**主站接入层**

| 文件 | 作用 |
| --- | --- |
| `src/pages/ReadingPanel.tsx` | 阅读科目页：8 页签、iframe 常驻、消息桥、滚动代理、统计上报 |
| `src/pages/WritingPanel.tsx` | 写作科目页：6 页签、导航翻译成模块原有 `.nav-item.click()` |
| `src/pages/SubjectPage.tsx` | 科目页装配、横幅统计订阅 `ielts:subject-stats` |
| `src/frameHeight.ts` | iframe 高度同步（含 `immediateFirst`，避免兜底值死锁） |
| `src/iframePersist.ts` | **新增**：接收 iframe 状态消息，由主站代发 PUT |
| `src/styles.css` | 四科共用横幅 / 页签 / 白卡 / 动画口径；顶栏实色 |

**模块本体与桥接**

| 文件 | 作用 |
| --- | --- |
| `public/reading/index.html` | 薄入口：先恢复数据库状态，再加载业务 bundle，首帧不铺骨架 |
| `public/reading/assets/reading-host.js` | 状态收集/恢复、高度上报、滚动代理、弹窗定位、toast 转发 |
| `public/reading/assets/reading-theme.css` | 嵌入态主题：隐藏独立站外壳、把内部滚动容器改成自然高度 |
| `public/reading/js/**` | 阅读包业务代码（hash 路由、题库、做题、错题、单词本、精读库） |
| `public/writing/index.html` | 写作薄入口（首帧写入 `host-embedded`） |
| `public/writing/assets/writing-host.js` | 工作区同步、高度/就绪、导航桥接、单滚动安装 |
| `public/writing/assets/writing-theme.css` | 写作嵌入态主题（题库/对话/选题器改页内卡片） |

**服务端**

| 文件 | 作用 |
| --- | --- |
| `scripts/start.mjs` | 生产入口：静态资源 + Range 音频 + API 分发 |
| `scripts/speaking-api.mjs` | API 总入口，旁路到 reading / writing |
| `scripts/reading-api.mjs` | `/api/reading/state` `GET/PUT/POST`、`/api/reading/status` |
| `scripts/writing-api.mjs` | `/api/writing/workspace`、`/api/writing/ai/status`、`/api/ai/chat` |
| `scripts/speaking-runtime.mjs` | 本地 SQLite 绑定与迁移执行 |
| `modules/*/schema.sql`、`modules/speaking/drizzle/*.sql` | 既有模块迁移（未改动基线结构） |

**验收脚本**：`scripts/check-reading.mjs`、`check-writing.mjs`、`check-style-unify.mjs`、`check-motion.mjs`、`verify.mjs`。

---

## 4. 依赖、环境变量、数据库迁移

### 新增依赖

只有一项，且仅用于验收，不影响运行：

```bash
npm i -D playwright-core@1.49.1
```

已写入 `package.json` / `package-lock.json`，`npm ci` 会自动安装。运行验收脚本时用系统 Chromium：

```bash
CHROMIUM_PATH=/usr/bin/chromium BASE_URL=http://127.0.0.1:4192 node scripts/check-reading.mjs
```

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PORT` / `HOST` | 否 | 默认 `4192` / `0.0.0.0`（容器内需要 0.0.0.0） |
| `PUBLIC_ORIGIN` | 否 | 站点对外域名，写在 `deploy.env`，只用于启动日志 |
| `IELTS_DATA_DIR` | 否 | SQLite 目录，默认 `<项目>/.data` |
| `DEEPSEEK_API_KEY` | 否 | 未配置时写作 AI 精修走本地估分；`/api/writing/ai/status` 返回 `configured:false` |
| `DEEPSEEK_MODEL` / `AI_BASE_URL` / `AI_API_KEY` | 否 | 换模型或走 OpenAI 兼容网关 |
| `WRITING_AI_DAILY_LIMIT` | 否 | 每账号每日 AI 调用上限，默认 40 |
| `TENCENT_APP_ID` / `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` | 否 | 口语评测；未配置时口语仍可练习，评分降级 |
| `SOE_SITE_DAILY_LIMIT` / `SOE_VISITOR_DAILY_LIMIT` | 否 | 口语评测每日额度 |

`deploy.env` 里只有 `PUBLIC_ORIGIN` 和注释，不含任何密钥，可安全随包交付。

### 数据库迁移

**不需要手工执行。** 启动时 `openLocalBindings()` 按文件名排序执行 `modules/speaking/drizzle/*.sql` 与各模块 `schema.sql`，已执行过的记录在 `preview_migrations` 表里，幂等。

阅读 / 写作的两张表由各自 API 在首个请求时 `CREATE TABLE IF NOT EXISTS` 创建：

```sql
reading_state(owner_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)
writing_workspace(owner_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)
writing_ai_usage(owner_id TEXT, day TEXT, used INTEGER, PRIMARY KEY(owner_id, day))
```

从基线库升级：直接用新包启动即可，旧表不动，新表自动补建。

---

## 5. 已验证的流程

在**新解压目录**里按说明启动，用真实浏览器走查（1440×900，Chromium headless）：

| 验证项 | 结果 |
| --- | --- |
| `npm ci` → `npm run build` → `node scripts/start.mjs` | 通过；首次启动自动建库 |
| 阅读 8 个页签逐个打开 | 23/23 全通过；内容非空、iframe 未重建、内部滚动容器 0 个 |
| 阅读篇章练习 | 左右分屏 2 栏、题号 1–13、选答、交卷确认框以页内卡片呈现、交卷后停留原页 |
| 阅读进度落库 | 交卷后 `PUT /api/reading/state` 200；切到写作后读回数据一致 |
| 写作题库 | 页内白卡 `position:static`、内部滚动容器 0 个、整页仅一条滚动轴 |
| 听力 / 口语 / 校园 | 页签齐全、音频 `audio` 元素存在、每日语料与词汇入口在位、营地可打开 |
| `check-reading.mjs` | 77/77 |
| `check-writing.mjs` | 36/36 |
| `check-style-unify.mjs` | 29/29 |
| JS 错误 / 4xx / 失败请求 | 0 / 0 / 0 |

---

## 6. 仍有的问题

1. **AI 精修未配置密钥**，线上 `configured:false`，只有本地估分和逐句规则反馈。配 `DEEPSEEK_API_KEY` 即可启用，不需要改代码。
2. **腾讯口语评测未配置**，口语练习与录音可用，官方评分降级。
3. **部分历史验收脚本口径过时**，保留在 `scripts/` 但不再代表当前设计，跑出红项属预期：
   - `check-no-crop.mjs`：期望首页背景图 `contain`，当前设计是 `cover` 铺满 + 羽化
   - `check-points.mjs`：期望「目标分卡下沉到第二行」，当前是 2×2 网格
   - `check-space.mjs`：期望侧栏不含「今日进度」，后续需求已恢复该卡
   - `check-boot-visibility.mjs` / `check-smooth.mjs` / `check-adaptive.mjs`：沙箱内的性能阈值，机器负载会直接影响结果
4. **阅读模块的 localStorage 仍是主存储**，云端只做跨设备备份；清空浏览器数据后需从服务端恢复（已实现，但要保证登录账号一致）。
5. **移动端只做了窄视口截图检查**，没有真机验证；口语录音在 iOS Safari 上的 `MediaRecorder` 兼容性未测。
6. **演示数据与真实账号共用一套表**，靠 `owner_id` 前缀（`host:<scope>`）隔离，没有独立演示库。

---

## 7. Codex 接手后第一件该做的事

**先把基线跑绿，再动功能。**

```bash
npm ci && npm run build && PORT=4192 node scripts/start.mjs
# 另开终端
CHROMIUM_PATH=/usr/bin/chromium BASE_URL=http://127.0.0.1:4192 node scripts/check-reading.mjs
CHROMIUM_PATH=/usr/bin/chromium BASE_URL=http://127.0.0.1:4192 node scripts/check-writing.mjs
CHROMIUM_PATH=/usr/bin/chromium BASE_URL=http://127.0.0.1:4192 node scripts/check-style-unify.mjs
```

三个脚本应当分别是 77/77、36/36、29/29。任何红项先看 `scripts/` 里的断言口径，确认是产品回归还是脚本过时（第 6 节第 3 条），再决定改代码还是改脚本。

跑通之后的第二件事：清理第 6 节第 3 条那批过时脚本（归档到 `scripts/archive/` 或按当前设计重写），否则后续每次改动都会被误报干扰。第三件事才是配置 `DEEPSEEK_API_KEY` 与腾讯评测凭据。
