import type { Practice, Report } from './contract'

/**
 * 第一天样例数据：六个模块各一份，供各科负责人对照字段、供前端独立自测。
 * 题目与原文为 Demo 内容；判题规则与正式题库由各科负责人在第五天前按契约接入。
 */

// ---------------------------------------------------------------------------
// 练习清单
// ---------------------------------------------------------------------------
export const PRACTICES: Practice[] = [
  {
    exerciseId: 'exr_sp_mock_01',
    subject: 'speaking',
    mode: 'mock',
    title: '口语全流程模考',
    subtitle: 'Part 1 / 2 / 3 · 约 12 分钟 · 全程录音',
    durationMin: 12,
    questionTypes: ['Part 1 日常问答', 'Part 2 个人陈述', 'Part 3 抽象讨论'],
    prompt: '按考官提示依次完成三部分，系统会全程录音并在结束后给出估分与逐句反馈。',
    questions: [],
    material: {
      part1: [
        'Let us talk about your studies. What are you studying at the moment?',
        'Do you prefer studying in the morning or in the evening? Why?',
        'How do you usually keep in touch with your friends?',
      ],
      part2: {
        topic: 'Describe a skill you learned that took a long time',
        cueCard: [
          'what the skill was',
          'when you started learning it',
          'how you learned it',
          'and explain why it took a long time',
        ],
        prepSec: 60,
        talkSec: 120,
      },
      part3: [
        'Why do some people give up learning a new skill halfway?',
        'Should schools teach practical skills alongside academic subjects?',
        'How has technology changed the way adults learn new things?',
      ],
    },
  },
  {
    exerciseId: 'exr_sp_free_01',
    subject: 'speaking',
    mode: 'free',
    title: '自由对话练习',
    subtitle: '自选话题 · 不限时 · 考后估分',
    durationMin: 8,
    questionTypes: ['连贯表达', '词汇多样性', '互动回应'],
    prompt: '和 AI 考官自由聊一个你感兴趣的话题，结束后获得估分、报告与复练建议。',
    questions: [],
  },
  {
    exerciseId: 'exr_wr_task2_01',
    subject: 'writing',
    mode: 'task2',
    title: 'Task 2 大作文',
    subtitle: '议论文 · 建议 40 分钟 · 不少于 250 词',
    durationMin: 40,
    questionTypes: ['论点展开', '衔接与分段', '词汇准确性', '语法多样性'],
    prompt:
      'Some people believe that university education should be free for everyone, while others argue that students should pay their own tuition fees. Discuss both views and give your own opinion.',
    questions: [],
  },
  {
    exerciseId: 'exr_li_sec_01',
    subject: 'listening',
    mode: 'section',
    title: '听力 Section 3 精练',
    subtitle: '学术讨论 · 6 题 · 可回听原声定位',
    durationMin: 9,
    questionTypes: ['表格填空', '单选题', '配对题'],
    prompt: '听一段导师与学生的课题讨论，完成 6 道题。提交后可回听错题对应的原声片段。',
    questions: [
      { id: 'q_li_1', type: '表格填空', text: 'The project focuses on the link between sleep and ______.', answer: 'memory consolidation' },
      { id: 'q_li_2', type: '表格填空', text: 'Participants will be recruited from the ______ department.', answer: 'psychology' },
      { id: 'q_li_3', type: '表格填空', text: 'Each session lasts approximately ______ minutes.', answer: 'forty-five' },
      {
        id: 'q_li_4', type: '单选题', text: 'Why does Dr Halden suggest shortening the questionnaire?',
        options: ['A. It contains too many personal questions', 'B. Participants reported fatigue in the pilot', 'C. The ethics committee requested it'],
        answer: 'B',
      },
      {
        id: 'q_li_5', type: '单选题', text: 'What is the main problem with the library data?',
        options: ['A. It is out of date', 'B. It lacks a comparison group', 'C. It was collected in a different season'],
        answer: 'B',
      },
      { id: 'q_li_6', type: '配对题', text: 'Match the task to the person responsible: data analysis', options: ['A. Mia', 'B. Oliver', 'C. Dr Halden'], answer: 'A' },
    ],
    material: {
      transcript:
        "[00:00] Dr Halden: Right, let us settle the design before you start recruiting.\n[00:08] Mia: We have narrowed the topic to the link between sleep and memory consolidation — the pilot readings were much stronger on that than on attention.\n[00:22] Dr Halden: Good. And recruitment?\n[00:26] Oliver: We will draw participants from the psychology department, mainly second-year students.\n[00:35] Dr Halden: Fine. How long is each session?\n[00:39] Mia: About forty-five minutes, including the recall test.\n[00:46] Dr Halden: One concern — in the pilot, several participants said the questionnaire felt repetitive by the end. I would shorten it.\n[01:02] Oliver: That also gives us more time for the debrief.\n[01:08] Mia: We had hoped to use the library dataset as a baseline, but it lacks a comparison group, so it will not support the claim we are making.\n[01:22] Dr Halden: Agreed. Finally, who is doing what? Mia, you will handle the data analysis; Oliver takes the literature review.",
      audioSegments: [
        { startSec: 8, endSec: 22, text: 'We have narrowed the topic to the link between sleep and memory consolidation…' },
        { startSec: 26, endSec: 35, text: 'We will draw participants from the psychology department…' },
        { startSec: 39, endSec: 46, text: 'About forty-five minutes, including the recall test.' },
        { startSec: 46, endSec: 62, text: 'In the pilot, several participants said the questionnaire felt repetitive by the end. I would shorten it.' },
        { startSec: 68, endSec: 82, text: 'The library dataset lacks a comparison group, so it will not support the claim.' },
        { startSec: 82, endSec: 96, text: 'Mia, you will handle the data analysis; Oliver takes the literature review.' },
      ],
    },
  },
  {
    exerciseId: 'exr_re_pass_01',
    subject: 'reading',
    mode: 'passage',
    title: '阅读篇章精练',
    subtitle: '学术文章 · 10 题 · 左文右题 · 原文证据定位',
    durationMin: 20,
    questionTypes: ['段落标题配对', '判断题 T/F/NG', '单选题', '词汇推断'],
    prompt: '阅读左侧文章，完成右侧 10 道题。反馈会标出每道题对应的原文句子。',
    questions: [
      { id: 'q_re_1', type: '段落标题配对', text: 'Paragraph A — choose the best heading', options: ['i. A decline in urban planning', 'ii. An unexpected research finding', 'iii. Methods of measuring attention'], answer: 'ii' },
      { id: 'q_re_2', type: '判断题 T/F/NG', text: 'Kaplan’s early studies were conducted in hospital wards.', options: ['TRUE', 'FALSE', 'NOT GIVEN'], answer: 'NOT GIVEN' },
      { id: 'q_re_3', type: '判断题 T/F/NG', text: 'Directed attention can be depleted by prolonged concentration.', options: ['TRUE', 'FALSE', 'NOT GIVEN'], answer: 'TRUE' },
      { id: 'q_re_4', type: '判断题 T/F/NG', text: 'Green space is the only environment that restores attention.', options: ['TRUE', 'FALSE', 'NOT GIVEN'], answer: 'FALSE' },
      { id: 'q_re_5', type: '单选题', text: 'According to Paragraph C, the 20-minute walk mainly improved…', options: ['A. physical stamina', 'B. performance on concentration tasks', 'C. long-term memory recall'], answer: 'B' },
      { id: 'q_re_6', type: '段落标题配对', text: 'Paragraph C — choose the best heading', options: ['i. Measuring the effect', 'ii. Funding constraints', 'iii. A historical overview'], answer: 'i' },
      { id: 'q_re_7', type: '词汇推断', text: '“ubiquitous” in Paragraph D is closest in meaning to…', options: ['A. rare', 'B. widespread', 'C. controversial'], answer: 'B' },
      { id: 'q_re_8', type: '判断题 T/F/NG', text: 'The authors recommend replacing all built surfaces with vegetation.', options: ['TRUE', 'FALSE', 'NOT GIVEN'], answer: 'FALSE' },
      { id: 'q_re_9', type: '单选题', text: 'The main purpose of the passage is to…', options: ['A. criticise city councils', 'B. review evidence and note implications for design', 'C. introduce a new clinical treatment'], answer: 'B' },
      { id: 'q_re_10', type: '段落标题配对', text: 'Paragraph D — choose the best heading', options: ['i. Implications for city design', 'ii. A rejected hypothesis', 'iii. Comparing age groups'], answer: 'i' },
    ],
    material: {
      paragraphs: [
        'A. When Kaplan and colleagues first asked participants to describe a walk that left them feeling restored, the responses were unexpectedly consistent: almost nobody mentioned exercise, and most described trees, water or a quiet path. The finding was surprising because the prevailing model of the 1980s treated rest as the absence of stimulation, not as a particular kind of stimulation.',
        'B. Attention Restoration Theory offered an explanation. Directed attention — the effort required to hold focus while ignoring distraction — is a finite resource that can be depleted by prolonged concentration. Environments with what the authors called "soft fascination" allow that resource to replenish without demanding effort. Green space is a reliable source of such fascination, but the theory does not claim it is the only one; any setting with gentle, non-demanding motion may serve a similar function.',
        'C. To measure the effect, Berman and colleagues asked participants to complete a backward digit-span task, then take either a 20-minute walk through a wooded arboretum or along a busy street, and repeat the task. Performance on the concentration task rose by roughly 20 per cent after the green walk and showed no comparable gain after the street walk. The design deliberately used the same participants in both conditions a week apart, so individual differences in baseline attention could not explain the result.',
        'D. If the effect is robust, the implications for city design are practical rather than cosmetic. Vegetation is now ubiquitous in rendering software but unevenly distributed in actual neighbourhoods, and the authors argue that small, walkable patches of green may deliver more cognitive benefit per unit of cost than a single large park at the edge of a city. They stop short of recommending that built surfaces be replaced wholesale; their proposal is to make restorative routes a routine part of street-level planning.',
      ],
    },
  },
  {
    exerciseId: 'exr_re_retake_01',
    subject: 'reading',
    mode: 'retake',
    title: '复练 · 判断题 T/F/NG',
    subtitle: '针对上次薄弱题型 · 4 题',
    durationMin: 8,
    questionTypes: ['判断题 T/F/NG'],
    prompt: '重点区分 FALSE（原文明确相反）与 NOT GIVEN（原文未提及）。每题都要能指出原文依据。',
    questions: [
      { id: 'q_rt_1', type: '判断题 T/F/NG', text: 'The study measured participants twice.', options: ['TRUE', 'FALSE', 'NOT GIVEN'], answer: 'TRUE' },
      { id: 'q_rt_2', type: '判断题 T/F/NG', text: 'All participants were university students.', options: ['TRUE', 'FALSE', 'NOT GIVEN'], answer: 'NOT GIVEN' },
      { id: 'q_rt_3', type: '判断题 T/F/NG', text: 'The street walk produced no measurable improvement.', options: ['TRUE', 'FALSE', 'NOT GIVEN'], answer: 'FALSE' },
      { id: 'q_rt_4', type: '判断题 T/F/NG', text: 'The researchers have published a follow-up study.', options: ['TRUE', 'FALSE', 'NOT GIVEN'], answer: 'NOT GIVEN' },
    ],
    material: { paragraphs: [
      'A. Participants completed the same concentration task twice: once after a green walk and once after a street walk, with the two conditions separated by a week.',
      'B. Performance rose by about 20 per cent after the green walk. The street walk produced a small but measurable gain of 3 per cent, which the authors describe as within the margin of error.',
    ] },
  },
  {
    exerciseId: 'exr_li_retake_01',
    subject: 'listening',
    mode: 'retake',
    title: '复练 · 表格填空定位',
    subtitle: '针对上次薄弱题型 · 3 题 · 附原声片段',
    durationMin: 6,
    questionTypes: ['表格填空'],
    prompt: '注意听信号词与同义替换，答案通常紧跟在提示语之后。',
    questions: [
      { id: 'q_lr_1', type: '表格填空', text: 'The topic was narrowed to sleep and ______.', answer: 'memory consolidation' },
      { id: 'q_lr_2', type: '表格填空', text: 'Participants come from the ______ department.', answer: 'psychology' },
      { id: 'q_lr_3', type: '表格填空', text: 'Each session: ______ minutes.', answer: 'forty-five' },
    ],
    material: {
      audioSegments: [
        { startSec: 8, endSec: 22, text: 'We have narrowed the topic to the link between sleep and memory consolidation…' },
        { startSec: 26, endSec: 35, text: 'We will draw participants from the psychology department…' },
        { startSec: 39, endSec: 46, text: 'About forty-five minutes, including the recall test.' },
      ],
    },
  },
  {
    exerciseId: 'exr_wr_retake_01',
    subject: 'writing',
    mode: 'retake',
    title: '复练 · 二稿改写',
    subtitle: '针对逐句标注 · 对照升级范文重写',
    durationMin: 25,
    questionTypes: ['论点展开', '语法准确性', '立场表达'],
    prompt:
      '根据上一份报告的逐句标注重写作文，重点修正主谓一致、论点空泛与结论立场模糊。完成后系统会自动做二稿对比。',
    questions: [],
  },
]

export function findPractice(exerciseId: string): Practice | undefined {
  return PRACTICES.find((item) => item.exerciseId === exerciseId)
}

// ---------------------------------------------------------------------------
// 样例报告
// ---------------------------------------------------------------------------
const placeholder = 'usr_sample'

function draftReport(partial: Partial<Report> & Pick<Report, 'subject' | 'mode' | 'exerciseId' | 'score' | 'feedback' | 'recommendations'>): Report {
  return {
    reportId: 'rpt_sample',
    attemptId: 'atm_sample',
    userId: placeholder,
    status: 'ready',
    createdAt: new Date().toISOString(),
    dimensions: [],
    highlights: [],
    evidence: {},
    original: { title: '', prompt: '', answers: {} },
    ...partial,
  }
}

const writingOriginal = [
  'Nowadays, free university education is a hot topic which has been discussed by many people.',
  'Firstly, if the government pay for all students, it will spend too much money.',
  'This is because there are many students in the university.',
  'On the other hand, students should pay fees because education is a private investment.',
  'In conclusion, I think free education is good but also bad.',
].join(' ')

const upgradedEssay = [
  'Whether higher education should be publicly funded is usually framed as a choice between fairness and fiscal realism.',
  'Those who support free tuition argue that a degree generates public as well as private returns: graduates pay more tax, fill shortages in teaching and healthcare, and are less likely to depend on welfare.',
  'Charging fees at the point of entry therefore risks excluding precisely the students whose later contribution would be greatest, particularly those from low-income households who are also the most sensitive to debt.',
  'The opposing case is not simply about cost. When universities rely on general taxation, funding competes with hospitals and infrastructure, and places are rationed by political negotiation rather than by demand.',
  'A graduate contribution, combined with means-tested grants, can preserve access while giving institutions a stable income that is linked to the number of students they actually teach.',
  'In my view, the strongest position is a hybrid one: tuition should be free at the point of study for students below a defined income threshold, with a capped, income-contingent contribution for those who can afford it.',
  'This protects equality of opportunity without asking the taxpayer to underwrite the full cost of every degree, and it avoids the two weaknesses of the extreme positions — exclusion on one side and an unconstrained budget commitment on the other.',
].join(' ')

export const SAMPLE_REPORTS: Record<string, Report> = {
  'exr_wr_task2_01': draftReport({
    subject: 'writing', mode: 'task2', exerciseId: 'exr_wr_task2_01',
    score: { band: 5.5, display: '5.5', trendMetric: 'writing_band', correct: null, total: null, firstTryCorrect: null },
    dimensions: [
      { key: 'TR', label: 'Task Response', score: 5, comment: '回应了双方观点，但结论立场模糊，未给出明确立场。' },
      { key: 'CC', label: 'Coherence & Cohesion', score: 6, comment: '分段清楚，但段内推进依赖 firstly / on the other hand 等模板衔接。' },
      { key: 'LR', label: 'Lexical Resource', score: 5, comment: '高频套语偏多，缺少具体名词与准确搭配。' },
      { key: 'GRA', label: 'Grammar Range & Accuracy', score: 5, comment: '主谓一致与从句结构有可修正的错误。' },
    ],
    feedback: [
      {
        id: 'fb_w_1', type: 'sentence', location: { label: '第 1 句 · 开头段', sentenceIndex: 1 },
        quote: 'Nowadays, free university education is a hot topic which has been discussed by many people.',
        issue: '套语开头，未给出任何信息',
        why: '雅思 Task 2 的开头只需改写题目并点明立场；"a hot topic discussed by many people" 属于考官评语中常见的 memorised opening，不贡献内容分。',
        suggestion: '直接改写题目并给出立场，把篇幅留给论证。',
        revised: 'Whether higher education should be publicly funded is usually framed as a choice between fairness and fiscal realism.',
        questionType: '论点展开', severity: 'medium',
      },
      {
        id: 'fb_w_2', type: 'sentence', location: { label: '第 2 句 · 主体段 1', sentenceIndex: 2 },
        quote: 'Firstly, if the government pay for all students, it will spend too much money.',
        issue: '主谓一致错误 + 论点过于笼统',
        why: 'the government 为第三人称单数，条件从句谓语应为 pays；"too much money" 没有说明成本来源或机会成本，TR 上属于 underdeveloped idea。',
        suggestion: '修正一致关系，并把「花钱」具体化为与医疗、基建争夺财政，或说明付费与需求挂钩。',
        revised: 'When universities rely on general taxation, funding competes with hospitals and infrastructure, and places are rationed by political negotiation rather than by demand.',
        questionType: '语法准确性', severity: 'high',
      },
      {
        id: 'fb_w_3', type: 'sentence', location: { label: '第 3 句 · 主体段 1', sentenceIndex: 3 },
        quote: 'This is because there are many students in the university.',
        issue: '解释句与论点不构成因果关系',
        why: '「学生多」不能解释「政府负担重」，缺少中间环节（人均成本 × 人数）；这类空泛解释是 TR 停留在 5 分的典型原因。',
        suggestion: '用具体机制或数据替代，或删除该句，把篇幅用于真正的原因。',
        revised: 'A graduate contribution, combined with means-tested grants, can preserve access while giving institutions a stable income that is linked to the number of students they actually teach.',
        questionType: '论点展开', severity: 'high',
      },
      {
        id: 'fb_w_4', type: 'sentence', location: { label: '第 4 句 · 主体段 2', sentenceIndex: 4 },
        quote: 'On the other hand, students should pay fees because education is a private investment.',
        issue: '提出论点但未展开',
        why: '该句只有 claim 没有 support；Band 6+ 要求每个主体段包含 claim → explanation → example/result 的完整链条。',
        suggestion: '补充「谁受益、为何应付费、如何不伤害公平」三层论证。',
        revised: 'Those who support free tuition argue that a degree generates public as well as private returns: graduates pay more tax, fill shortages in teaching and healthcare, and are less likely to depend on welfare.',
        questionType: '论点展开', severity: 'high',
      },
      {
        id: 'fb_w_5', type: 'sentence', location: { label: '第 5 句 · 结论段', sentenceIndex: 5 },
        quote: 'In conclusion, I think free education is good but also bad.',
        issue: '立场模糊，未回应 give your own opinion',
        why: '题目明确要求给出自己的观点；折中但未给出可执行立场会被判定为 "position not clear throughout"，直接限制 TR 分数。',
        suggestion: '给出有条件的明确立场，并说明它如何同时避开两种极端方案的缺陷。',
        revised: 'In my view, the strongest position is a hybrid one: tuition should be free at the point of study for students below a defined income threshold, with a capped, income-contingent contribution for those who can afford it.',
        questionType: '立场表达', severity: 'high',
      },
    ],
    highlights: ['文章结构完整，能分别讨论双方观点', '衔接词使用位置准确，段落划分清晰'],
    recommendations: [
      { targetType: 'exercise', targetId: 'exr_wr_retake_01', label: '二稿改写：逐句修正 + 对比', reason: '5 处逐句标注中有 3 处属于「论点空泛」和「立场模糊」，重写同一道题最能验证是否真正改进。', cta: '开始二稿' },
      { targetType: 'questionType', targetId: '论点展开', label: '专练：claim → explanation → result 链条', reason: 'TR 5 分主要由解释句缺失导致，需单独训练段落内部推进。', cta: '加入复练' },
    ],
    evidence: {
      sentences: [
        { index: 1, text: 'Nowadays, free university education is a hot topic which has been discussed by many people.' },
        { index: 2, text: 'Firstly, if the government pay for all students, it will spend too much money.' },
        { index: 3, text: 'This is because there are many students in the university.' },
        { index: 4, text: 'On the other hand, students should pay fees because education is a private investment.' },
        { index: 5, text: 'In conclusion, I think free education is good but also bad.' },
      ],
      upgradedEssay,
    },
    original: { title: 'Task 2 大作文', prompt: PRACTICES[2].prompt, answers: {}, submittedText: writingOriginal },
  }),

  'exr_re_pass_01': draftReport({
    subject: 'reading', mode: 'passage', exerciseId: 'exr_re_pass_01',
    score: { band: null, display: '7 / 10', trendMetric: 'reading_correct', correct: 7, total: 10, firstTryCorrect: 6 },
    dimensions: [
      { key: 'accuracy', label: '正确率', score: 7, comment: '10 题中答对 7 题，首次作答答对 6 题。' },
      { key: 'evidence', label: '证据定位', score: 6, comment: '3 道错题中有 2 道可通过原文句子直接判定。' },
    ],
    feedback: [
      {
        id: 'fb_r_1', type: 'paragraph', location: { label: 'Paragraph B · 第 2 句', paragraph: 2, questionId: 'q_re_4' },
        quote: 'Green space is a reliable source of such fascination, but the theory does not claim it is the only one; any setting with gentle, non-demanding motion may serve a similar function.',
        issue: '判断题误选 TRUE，正确答案 FALSE',
        why: '原文用 "does not claim it is the only one" 明确否定「唯一性」，题干中的 only 与原文直接冲突，属于典型 FALSE；若原文完全未提及其他环境才是 NOT GIVEN。',
        suggestion: '遇到 only / all / never 等绝对词，先在原文找是否有显式否定或限定语。',
        questionType: '判断题 T/F/NG', severity: 'high',
      },
      {
        id: 'fb_r_2', type: 'paragraph', location: { label: 'Paragraph A · 第 1 句', paragraph: 1, questionId: 'q_re_2' },
        quote: 'When Kaplan and colleagues first asked participants to describe a walk that left them feeling restored, the responses were unexpectedly consistent…',
        issue: '判断题误选 FALSE，正确答案 NOT GIVEN',
        why: '原文只说明研究对象被要求描述一次散步，未说明研究地点；「医院病房」既未被肯定也未被否定，因此是 NOT GIVEN 而非 FALSE。',
        suggestion: '区分 FALSE（原文有相反表述）与 NOT GIVEN（原文无相关信息），不要凭常识推断。',
        questionType: '判断题 T/F/NG', severity: 'high',
      },
      {
        id: 'fb_r_3', type: 'paragraph', location: { label: 'Paragraph C · 第 2 句', paragraph: 3, questionId: 'q_re_5' },
        quote: 'Performance on the concentration task rose by roughly 20 per cent after the green walk and showed no comparable gain after the street walk.',
        issue: '单选题定位正确但被干扰项带走',
        why: '题干问 improved what，原文主语是 Performance on the concentration task；A 项 physical stamina 与 C 项 long-term memory 均未在该段出现。',
        suggestion: '先圈出题干疑问词，再回原文找同义改写，排除出现但不属于答案句子的选项。',
        questionType: '单选题', severity: 'medium',
      },
    ],
    highlights: ['段落标题配对 3 题全对，说明主旨概括稳定', '词汇推断题能结合上下文判断'],
    recommendations: [
      { targetType: 'exercise', targetId: 'exr_re_retake_01', label: '复练：判断题 T/F/NG 专项 4 题', reason: '本次 3 道错题中 2 道为判断题，且分别对应 FALSE 与 NOT GIVEN 两类不同误判。', cta: '去复练' },
      { targetType: 'questionType', targetId: '判断题 T/F/NG', label: '薄弱题型：判断题', reason: '错题集中在绝对词与信息缺失的区分上，需要用短篇高频训练。', cta: '加入复练' },
    ],
    evidence: { paragraphs: PRACTICES[4].material?.paragraphs ?? [] },
    original: { title: '阅读篇章精练', prompt: PRACTICES[4].prompt, answers: {} },
  }),

  'exr_li_sec_01': draftReport({
    subject: 'listening', mode: 'section', exerciseId: 'exr_li_sec_01',
    score: { band: null, display: '4 / 6', trendMetric: 'listening_correct', correct: 4, total: 6, firstTryCorrect: 3 },
    dimensions: [
      { key: 'accuracy', label: '正确率', score: 4, comment: '6 题中答对 4 题，首次作答答对 3 题。' },
      { key: 'signals', label: '信号词捕捉', score: 5, comment: '转折与修正处丢分较多。' },
    ],
    feedback: [
      {
        id: 'fb_l_1', type: 'audio', location: { label: '00:46 – 01:02 · Dr Halden', startSec: 46, endSec: 62, questionId: 'q_li_4' },
        quote: '…in the pilot, several participants said the questionnaire felt repetitive by the end. I would shorten it.',
        issue: '单选题误选 A，正确答案 B',
        why: '原声给出的是参与者在 pilot 中的疲劳反馈，"personal questions" 与 "ethics committee" 都未出现；A、C 是利用题干常见搭配设置的干扰项。',
        suggestion: '听到 I would / one concern 等修正信号时立刻标记，答案常紧跟其后。',
        questionType: '单选题', severity: 'high',
      },
      {
        id: 'fb_l_2', type: 'audio', location: { label: '00:26 – 00:35 · Oliver', startSec: 26, endSec: 35, questionId: 'q_li_2' },
        quote: 'We will draw participants from the psychology department, mainly second-year students.',
        issue: '表格填空拼写为 psychology department 之外的内容',
        why: '题干 recruited from the ______ department 与原声 from the psychology department 为原位对应，属于可直接定位的信息题。',
        suggestion: '填空前先判断词性与单复数，答案通常紧跟题干同义改写之后。',
        questionType: '表格填空', severity: 'medium',
      },
      {
        id: 'fb_l_3', type: 'audio', location: { label: '01:08 – 01:22 · Mia', startSec: 68, endSec: 82, questionId: 'q_li_5' },
        quote: '…but it lacks a comparison group, so it will not support the claim we are making.',
        issue: '单选题误选 A，正确答案 B',
        why: '原声明确指出 lacks a comparison group；out of date 与 different season 均未提及。',
        suggestion: '对 data / baseline 类题干，重点听 lacks / problem with / concern 之后的名词短语。',
        questionType: '单选题', severity: 'high',
      },
    ],
    highlights: ['数字与时间信息捕捉准确', '配对题能跟上人物分配'],
    recommendations: [
      { targetType: 'exercise', targetId: 'exr_li_retake_01', label: '复练：表格填空定位 3 题', reason: '填空题首答正确率偏低，且都有明确原声片段可回听。', cta: '去复练' },
      { targetType: 'questionType', targetId: '单选题', label: '薄弱题型：干扰项排除', reason: '两道错题都误选了原声中未出现的选项，需要训练「听到即排除」。', cta: '加入复练' },
    ],
    evidence: { audioUrl: '', transcript: PRACTICES[3].material?.transcript ?? '', segments: PRACTICES[3].material?.audioSegments ?? [] },
    original: { title: '听力 Section 3 精练', prompt: PRACTICES[3].prompt, answers: {} },
  }),

  'exr_sp_mock_01': draftReport({
    subject: 'speaking', mode: 'mock', exerciseId: 'exr_sp_mock_01',
    score: { band: 6, display: '6.0', trendMetric: 'speaking_mock_band', correct: null, total: null, firstTryCorrect: null },
    dimensions: [
      { key: 'FC', label: 'Fluency & Coherence', score: 6, comment: '能持续表达，Part 2 中段有约 4 秒停顿。' },
      { key: 'LR', label: 'Lexical Resource', score: 6, comment: '有尝试 paraphrase，但高频词重复较多。' },
      { key: 'GRA', label: 'Grammar Range', score: 6, comment: '简单句与复合句混合，复杂句准确率一般。' },
      { key: 'P', label: 'Pronunciation', score: 6, comment: '整体清晰，个别词重音影响理解。' },
    ],
    feedback: [
      {
        id: 'fb_s_1', type: 'utterance', location: { label: 'Part 2 · 01:12', startSec: 72, endSec: 88 },
        quote: 'I learn piano… I learn it for many years… it is very difficult, so… so I stop sometimes.',
        issue: '时态错误 + 长时间犹豫',
        why: '描述持续到现在的经历应使用现在完成进行时（I have been learning…）；连续 so / 重复 I learn 属于 FC 6 分常见的 hesitation 特征。',
        suggestion: '用 "I have been learning the piano for six years, and the hardest part was…" 一次成句，把停顿换成连接词。',
        revised: 'I have been learning the piano for six years, and the hardest part was keeping a regular practice schedule during exam periods.',
        questionType: '语法准确性', severity: 'high',
      },
      {
        id: 'fb_s_2', type: 'utterance', location: { label: 'Part 3 · 05:40', startSec: 340, endSec: 360 },
        quote: 'Because technology is good, people can learn everything, it is very convenient.',
        issue: '观点空泛，缺少具体化',
        why: 'Part 3 要求抽象讨论与举例；good / convenient 属于 generalised vocabulary，无法支撑 Band 7 的 LR 与 TR 表现。',
        suggestion: '给出一个具体机制或例子，例如 micro-lessons、adaptive apps 与通勤时间的结合。',
        revised: 'Short adaptive lessons let adults practise during a commute, which removes the main barrier — finding an uninterrupted hour.',
        questionType: '论点展开', severity: 'high',
      },
    ],
    highlights: ['三部分全部完成，Part 2 说满 1 分 40 秒', '能主动请求考官重复问题，互动自然'],
    recommendations: [
      { targetType: 'exercise', targetId: 'exr_sp_free_01', label: '自由对话：专练抽象话题展开', reason: 'Part 3 的观点空泛问题适合在不限时的自由对话中反复延展。', cta: '去练习' },
      { targetType: 'questionType', targetId: '论点展开', label: '薄弱能力：观点具体化', reason: '两处高分反馈都指向缺少具体机制与例子。', cta: '加入复练' },
    ],
    evidence: {
      turns: [
        { role: 'examiner', text: 'Describe a skill you learned that took a long time.', atSec: 60 },
        { role: 'candidate', text: 'I learn piano… I learn it for many years… it is very difficult, so… so I stop sometimes.', atSec: 72 },
        { role: 'examiner', text: 'How has technology changed the way adults learn new things?', atSec: 336 },
        { role: 'candidate', text: 'Because technology is good, people can learn everything, it is very convenient.', atSec: 340 },
      ],
    },
    original: { title: '口语全流程模考', prompt: PRACTICES[0].prompt, answers: {} },
  }),

  'exr_sp_free_01': draftReport({
    subject: 'speaking', mode: 'free', exerciseId: 'exr_sp_free_01',
    score: { band: 5.5, display: '5.5', trendMetric: 'speaking_free_band', correct: null, total: null, firstTryCorrect: null },
    dimensions: [
      { key: 'FC', label: 'Fluency & Coherence', score: 6, comment: '轮次衔接较自然。' },
      { key: 'LR', label: 'Lexical Resource', score: 5, comment: '话题词汇重复明显。' },
      { key: 'GRA', label: 'Grammar Range', score: 5, comment: '以简单句为主。' },
      { key: 'P', label: 'Pronunciation', score: 6, comment: '清晰可懂。' },
    ],
    feedback: [
      {
        id: 'fb_f_1', type: 'utterance', location: { label: '第 3 轮 · 02:05', startSec: 125, endSec: 140 },
        quote: 'I like reading because it is good and I can learn many things.',
        issue: '理由停留在评价性形容词',
        why: '自由对话的估分同样参考 LR 与 TR；good / many things 无法展示话题词汇，也不构成可延展的理由。',
        suggestion: '补上一个具体书名、场景或结果，把评价句扩展为「原因 + 结果」。',
        revised: 'I mostly read popular science — it gives me a concrete example to use whenever I need to explain an abstract idea at work.',
        questionType: '论点展开', severity: 'high',
      },
    ],
    highlights: ['主动延续话题，未出现长时间沉默'],
    recommendations: [
      { targetType: 'exercise', targetId: 'exr_sp_mock_01', label: '回到全流程模考检验', reason: '自由对话已能保持流畅，下一步用计时模考检验压力下的表现。', cta: '去模考' },
      { targetType: 'questionType', targetId: '论点展开', label: '薄弱能力：观点具体化', reason: '与上次模考反馈一致，属于重复出现的系统性问题。', cta: '加入复练' },
    ],
    evidence: { turns: [{ role: 'examiner', text: 'What do you usually do in the evening?', atSec: 0 }, { role: 'candidate', text: 'I like reading because it is good and I can learn many things.', atSec: 125 }] },
    original: { title: '自由对话练习', prompt: PRACTICES[1].prompt, answers: {} },
  }),

  'exr_re_retake_01': draftReport({
    subject: 'reading', mode: 'retake', exerciseId: 'exr_re_retake_01',
    score: { band: null, display: '3 / 4', trendMetric: 'reading_correct', correct: 3, total: 4, firstTryCorrect: 3 },
    dimensions: [{ key: 'accuracy', label: '正确率', score: 3, comment: '判断题专项较上次明显提升。' }],
    feedback: [{
      id: 'fb_rr_1', type: 'paragraph', location: { label: 'Paragraph B · 第 2 句', paragraph: 2, questionId: 'q_rt_3' },
      quote: 'The street walk produced a small but measurable gain of 3 per cent, which the authors describe as within the margin of error.',
      issue: '把「可测量但很小」误判为「没有提升」',
      why: '原文明确说 produced a small but measurable gain，题干 no measurable improvement 与原文相反，应选 FALSE。',
      suggestion: '注意 small / within the margin of error 等限定语，它们不等于 none。',
      questionType: '判断题 T/F/NG', severity: 'medium',
    }],
    highlights: ['NOT GIVEN 两题全部答对，说明已能区分「未提及」'],
    recommendations: [{ targetType: 'exercise', targetId: 'exr_re_pass_01', label: '回到完整篇章检验', reason: '专项已改善，建议用混合题型确认迁移效果。', cta: '去练习' }],
    evidence: { paragraphs: PRACTICES[5].material?.paragraphs ?? [] },
    original: { title: '复练 · 判断题 T/F/NG', prompt: PRACTICES[5].prompt, answers: {} },
  }),

  'exr_li_retake_01': draftReport({
    subject: 'listening', mode: 'retake', exerciseId: 'exr_li_retake_01',
    score: { band: null, display: '3 / 3', trendMetric: 'listening_correct', correct: 3, total: 3, firstTryCorrect: 3 },
    dimensions: [{ key: 'accuracy', label: '正确率', score: 3, comment: '表格填空定位全部答对。' }],
    feedback: [],
    highlights: ['三题均首次作答正确，信号词捕捉稳定'],
    recommendations: [{ targetType: 'exercise', targetId: 'exr_li_sec_01', label: '回到 Section 3 完整练习', reason: '填空已稳定，下一步检验单选题干扰项排除。', cta: '去练习' }],
    evidence: { segments: PRACTICES[6].material?.audioSegments ?? [] },
    original: { title: '复练 · 表格填空定位', prompt: PRACTICES[6].prompt, answers: {} },
  }),

  'exr_wr_retake_01': draftReport({
    subject: 'writing', mode: 'retake', exerciseId: 'exr_wr_retake_01',
    score: { band: 6.5, display: '6.5', trendMetric: 'writing_band', correct: null, total: null, firstTryCorrect: null },
    dimensions: [
      { key: 'TR', label: 'Task Response', score: 7, comment: '结论给出有条件明确立场，双方论点均有机制支撑。' },
      { key: 'CC', label: 'Coherence & Cohesion', score: 6, comment: '段落推进自然，个别衔接仍偏机械。' },
      { key: 'LR', label: 'Lexical Resource', score: 6, comment: '出现 means-tested、income-contingent 等准确搭配。' },
      { key: 'GRA', label: 'Grammar Range & Accuracy', score: 6, comment: '主谓一致错误已消除，复杂句准确性提升。' },
    ],
    feedback: [{
      id: 'fb_wr_1', type: 'sentence', location: { label: '二稿 · 结论段', sentenceIndex: 7 },
      quote: 'This protects equality of opportunity without asking the taxpayer to underwrite the full cost of every degree…',
      issue: '二稿已修正立场模糊问题',
      why: '对照一稿第 5 句 "good but also bad"，二稿给出了可执行立场并说明其如何避开两种极端方案，TR 由 5 提升到 7。',
      suggestion: '保持「立场 + 条件 + 反证」结构，下一步可减少段内模板衔接词。',
      questionType: '立场表达', severity: 'low',
    }],
    highlights: ['一稿的 5 处标注中 4 处已在二稿修正', '主谓一致错误归零'],
    recommendations: [{ targetType: 'questionType', targetId: '衔接与分段', label: '下一步：减少机械衔接', reason: 'CC 仍是四项中相对最低分，可专练段内逻辑推进。', cta: '加入复练' }],
    evidence: { upgradedEssay, draftV2: upgradedEssay },
    original: { title: '复练 · 二稿改写', prompt: PRACTICES[7].prompt, answers: {}, submittedText: upgradedEssay },
  }),
}

/** 六模块样例数据清单，供 docs/SAMPLE_DATA.md 与集成对接核对 */
export const SEED_SAMPLES = [
  { module: '听力负责人', exerciseId: 'exr_li_sec_01', report: 'exr_li_sec_01', keyFields: ['audioSegments', 'feedback[].location.startSec', 'score.correct', 'score.firstTryCorrect'] },
  { module: '口语负责人 A（模考+录音）', exerciseId: 'exr_sp_mock_01', report: 'exr_sp_mock_01', keyFields: ['evidence.turns', 'score.band', 'dimensions'] },
  { module: '口语负责人 B（自由对话+估分）', exerciseId: 'exr_sp_free_01', report: 'exr_sp_free_01', keyFields: ['evidence.turns', 'recommendations'] },
  { module: '阅读负责人（含错题本）', exerciseId: 'exr_re_pass_01', report: 'exr_re_pass_01', keyFields: ['evidence.paragraphs', 'feedback[].location.paragraph', 'feedback[].questionType'] },
  { module: '写作负责人（逐句标注+二稿）', exerciseId: 'exr_wr_task2_01', report: 'exr_wr_task2_01', keyFields: ['evidence.sentences', 'feedback[].revised', 'evidence.upgradedEssay', 'evidence.draftV2'] },
  { module: '前端负责人（复练闭环）', exerciseId: 'exr_re_retake_01', report: 'exr_re_retake_01', keyFields: ['retakeOf', 'recommendations', 'DailyTaskState'] },
]
