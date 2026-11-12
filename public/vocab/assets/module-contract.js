/* =============================================================
 * 模块 B（口语负责人 B）对接约定 + 样例数据     version 1.0
 * 供第 5 天整站集成 / 第 7 天新账号验收使用
 * 本文件只定义数据契约，不参与运行时逻辑；可在控制台用 SL.contract 查看
 * ============================================================= */
window.SL = window.SL || {};

SL.contract = {
  version: '1.0',
  module: 'speaking-B',
  moduleName: '自由对话 AI 陪练 + 考后估分报告 + 针对性复练',

  /* ---------- 一、唯一编号约定（全员统一） ---------- */
  idRules: {
    userId:    'U_<base36时间戳>_<4位随机>   例：U_MW63QYI8_SOV9（前端负责人发放，全局唯一）',
    sessionId: 'S_FREE_<...> / S_MOCK_<...>  （自由对话 / 完整模考各一条，练习唯一编号）',
    reportId:  'R_<...>                     （一份考后报告唯一编号，复练必须回指它）',
    questionId:'P1-Q1 / P2-Q1 / P3-Q2      （三部分题号，团队统一，用于证据定位）',
    issueId:   'ISS_<...>                   （报告内一条优先问题的唯一编号）',
    practiceId:'P_REDO_<...>               （一次针对性重说，关联 reportId + issueId + qid）',
    audioId:   'A_REC_<...> / A_DEMO_<...> / A_UPL_<...>（原始音频唯一编号，音频本体不落 localStorage）',
    note: '所有 id 由 SL.engine.uid(prefix) 生成；report.sessionId 与 session.id 一致，practice.reportId 与 report.id 一致。'
  },

  /* ---------- 二、接口字段（前端负责人按此接入） ---------- */
  fields: {
    user: '{ id, name }',
    freeSession: '{ id, userId, topicId, topicName, rounds, turns[], review{keep,improve,drill,stats}, createdAt }',
    freeTurn: '{ role:"ai"|"user", en?, zh?, echo?, usedDetail?, text?, audioId?, demoWpm?, durationSec?, wpm?, redoOf?, isRedo? }',
    mockAnswer: '{ qid, part, q, zh, text, durationSec, audioId, demoWpm, audio:{metrics}, analysis? }',
    audioMetrics: '{ usable, reason?, durationSec, speechRatio, speechSec, longestPause, peak, clipping, wpm, frames }',
    report: '{ id, type:"mock", userId, sessionId, createdAt, pending, overall, dims[4], issues[], answers[], audioStatus, disclaimer }',
    dim: '{ key:"FC"|"LR"|"GRA"|"P", name, en, band|null, score|null, source, reasons[3], metrics? }',
    issue: '{ id, qid, part, question, dim, title, quote, why, action, focus, audioId, audioStart, audioEnd, beforeText, status }',
    practice: '{ id, reportId, sessionId, qid, issueId, focus, question, beforeText, afterText, afterAudioId, compare, createdAt }',
    compare: '{ checks[{label,ok,detail}], passed, total, verdict, before{wc,wpm,fillers,complex,text}, after{...} }',
    task: '{ "YYYY-MM-DD": { free:boolean, mock:boolean, retry:number } }',
    curvePoint: '{ date, band, reportId }',
    storage: 'localStorage: speakloop.users.v1 / speakloop.lastUser.v1 / speakloop.db.<userId>'
  },

  /* ---------- 三、报告格式硬约束 ---------- */
  reportRules: [
    '四维固定顺序：FC 流利与连贯 / LR 词汇 / GRA 语法多样与准确 / P 发音；band 为 0.5 步进或 null',
    '发音维度只使用「原始音频」的声学指标（语速、有效发声占比、最长停顿、峰值音量、削波）',
    '任一题音频缺失或质量不足（<6 秒 / 峰值过低 / 几乎全静音）→ P.band=null、overall=null、pending=true，并在 reasons 里写明缺失项与补录方法',
    '每条 issue 必须同时具备：qid（题号）、quote（原话）、audioStart/audioEnd（可回听片段）、action（一个具体动作）、focus（复练目标）',
    '完整模考写入 curve；自由对话只写 free[]（话题、轮数、改进建议）；针对性重说写 retries[] 并回指 reportId'
  ],

  /* ---------- 四、本模块样例数据（每个模块一份） ---------- */
  sample: {
    user: { id: 'U_MW63QYI8_SOV9', name: '验收账号 A' },

    freeSession: {
      id: 'S_FREE_MW63Q111_ABCD', userId: 'U_MW63QYI8_SOV9',
      topicId: 'travel', topicName: '旅途中的意外', rounds: 3,
      createdAt: '2026-11-07T07:20:00.000Z',
      turns: [
        { role: 'ai', en: "Let's talk about travel. Tell me about a trip where something didn't go to plan — what actually happened?", zh: '聊聊旅行。讲讲一次没按计划进行的经历——当时到底发生了什么？' },
        { role: 'user', text: 'Last summer I went to Kyoto with my sister and we missed the last train back to the hostel.', audioId: 'A_REC_MW63Q112_EFGH', durationSec: 12.4, wpm: 118 },
        { role: 'ai', en: 'You mentioned "we missed the last train back to the hostel" — how did you actually get there in the end?', zh: '你提到「错过了回旅舍的末班车」——最后到底是怎么到那儿的？', echo: 'we missed the last train back to the hostel', usedDetail: true }
      ],
      review: {
        keep: '「we missed the last train back to the hostel」——信息完整、有时序，值得保留',
        improve: '优先改进点（语法多样性）：3 轮回答里几乎没有复杂结构，下次试着用 "If I had …, I would have …" 把反思说出来',
        drill: '60 秒复述同一件事：1 个过去完成时 + 1 个虚拟语气 + 1 个感官细节',
        stats: { wc: 96, rounds: 3, complex: 0, errors: 0 }
      }
    },

    mockAnswer: {
      qid: 'P2-Q1', part: 'P2',
      q: 'Describe a time when you had to solve a problem without much help.',
      zh: '描述一次你不得不独自解决问题的经历',
      text: "I didn't went to ask for help, so I rebuilt the whole deck on my phone. It turned out that the new version was much clearer.",
      durationSec: 74.2, audioId: 'A_DEMO_MW63Q113_IJKL', demoWpm: 118,
      audio: { metrics: { usable: true, durationSec: 74.2, speechRatio: 0.71, speechSec: 52.7, longestPause: 1.1, peak: 0.34, clipping: 0, wpm: 118, frames: 3710 } }
    },

    report: {
      id: 'R_MW63Q114_MNOP', type: 'mock', userId: 'U_MW63QYI8_SOV9',
      sessionId: 'S_MOCK_MW63Q115_QRST', createdAt: '2026-11-07T07:31:00.000Z',
      pending: false, overall: 6.5,
      dims: [
        { key: 'FC', name: '流利与连贯', en: 'Fluency & Coherence', band: 7.5, score: 74, source: '文本规则', reasons: ['共 410 词 / 6 题，平均每题 68 词，最长单题 149 词', '衔接表达 4 处：to be honest / in the end / however / looking back', '填充词 0 次，句长差 19 词'] },
        { key: 'LR', name: '词汇', en: 'Lexical Resource', band: 6.0, score: 60, source: '文本规则', reasons: ['不重复词比例约 78%，高级词 1 个（convenient）', '地道搭配 5 处：to be honest / in the end / turned out', '可升级的笼统表达 2 处：I think、a lot of'] },
        { key: 'GRA', name: '语法多样与准确', en: 'Grammatical Range & Accuracy', band: 5.5, score: 55, source: '文本规则', reasons: ['识别到 2 类复杂结构：完成时态、让步结构', '疑似语法问题 3 处（约每 100 词 0.7 处），例：didn\'t went', '平均句长 13.2 词'] },
        { key: 'P', name: '发音', en: 'Pronunciation', band: 7.0, score: 70, source: '原始音频', reasons: ['录音 132.0 秒，语速约 118 词/分', '有效发声占比 71%，最长停顿 1.1 秒', '峰值音量 0.340，削波帧 0.0%'] }
      ],
      issues: [
        {
          id: 'ISS_MW63Q116_UVWX', qid: 'P2-Q1', part: 'P2',
          question: 'Describe a time when you had to solve a problem without much help.',
          dim: 'GRA', title: '语法准确性：did 之后必须用动词原形',
          quote: "didn't went", why: '原话「didn\'t went」不符合 didn\'t + 动词原形的规则，考官会记为准确性扣分项。',
          action: '把「didn\'t went」改成「didn\'t go」，然后带着原题再答一次，并额外补一个过去完成时或条件句。',
          focus: '语法准确性 · did 之后必须用动词原形',
          audioId: 'A_DEMO_MW63Q113_IJKL', audioStart: 15.7, audioEnd: 24.7,
          beforeText: "I didn't went to ask for help, so I rebuilt the whole deck on my phone.",
          status: 'open'
        }
      ],
      answers: [], audioStatus: { usable: true },
      disclaimer: '本 Demo 使用本地可解释规则进行估分，仅用于展示反馈链路，非官方 IELTS 评分。'
    },

    practice: {
      id: 'P_REDO_MW63Q117_YZAB', reportId: 'R_MW63Q114_MNOP', sessionId: 'S_MOCK_MW63Q115_QRST',
      qid: 'P2-Q1', issueId: 'ISS_MW63Q116_UVWX',
      focus: '语法准确性 · did 之后必须用动词原形',
      question: 'Describe a time when you had to solve a problem without much help.',
      beforeText: "I didn't went to ask for help, so I rebuilt the whole deck on my phone.",
      afterText: "I didn't go to ask for help, which in hindsight was a mistake, so I rebuilt the whole deck on my phone.",
      afterAudioId: 'A_REC_MW63Q118_CDEF',
      compare: {
        checks: [
          { label: '目标语法点已改正', ok: true, detail: "已不再出现「didn't went」" },
          { label: '新增复杂结构', ok: true, detail: '1 → 3 类' }
        ],
        passed: 2, total: 2, verdict: '本次复练已达标，可以把这道题标记为已掌握。',
        before: { wc: 15, wpm: 112, fillers: 0, complex: 1, text: "I didn't went to ask for help, so I rebuilt the whole deck on my phone." },
        after: { wc: 22, wpm: 120, fillers: 0, complex: 3, text: "I didn't go to ask for help, which in hindsight was a mistake, so I rebuilt the whole deck on my phone." }
      },
      createdAt: '2026-11-07T07:36:00.000Z'
    },

    audioMissingExample: {
      dim: { key: 'P', name: '发音', en: 'Pronunciation', band: null, score: null, source: '原始音频缺失或质量不足',
        reasons: [
          '未检测到任何原始音频（可能是浏览器未授予麦克风权限，或本次以文字方式作答）',
          '补录方法：点击本题「重录 / 上传录音」，允许麦克风后重说一遍，或直接上传 .webm / .wav / .mp3 文件',
          '综合估分暂缓：按 IELTS 四维规则，发音维度缺项时不计算总分'
        ] },
      report: { pending: true, overall: null }
    },

    task: { '2026-11-07': { free: true, mock: true, retry: 1 } },
    curvePoint: { date: '2026-11-07T07:31:00.000Z', band: 6.5, reportId: 'R_MW63Q114_MNOP' }
  },

  /* ---------- 五、第 7 天验收动作与本模块对应实现 ---------- */
  acceptance: [
    '现场给一个新话题 → 自由对话页「自定义主题」→ AI 用英语发问，并根据回答里的具体细节生成追问（≥3 轮，至少 1 次引用用户原话）',
    '打开一份完整模考报告 → 学习记录 / 一键载入示例报告 → 四维估分 + 优先问题（题号 / 原话 / 片段 / 动作）',
    '点击改进建议能听到对应原声 → 「🔊 听对应原声 00:00–00:09」按 issue.audioStart/audioEnd 定位播放',
    '并立即重答 → 「↻ 立即重答」带原题重说，生成首答 vs 二稿对比并关联 reportId',
    '历史回看 → 模考进分数曲线、自由对话存话题/轮数/改进建议、复练关联原报告'
  ]
};
