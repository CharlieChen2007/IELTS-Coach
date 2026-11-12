// Local feedback uses explicit text rules. Semantic scoring remains with the configured AI.
export async function useLocalAssessment() {
  try {
    const scope = new URLSearchParams(location.search).get('scope') || '';
    const result = await fetch('/api/writing/ai/status', { headers: { 'X-Speaking-Scope': scope }, cache: 'no-store' });
    return !result.ok || !(await result.json()).configured;
  } catch { return true; }
}

export function localTask2(input, review) {
  const report = review(input.text, input.topicId, input.submissionId, input.mode === 'language');
  report.sentences = report.sentences.map(sentence => {const next=reviewSentence(sentence);return {...sentence,...next,change:next.reason};});
  return { report: { ...report, sample: false, source: 'rule', model: '', upgrades: ['逐句核对基础语法，再补充论点与例子。'] }, attempts: 1 };
}

function sentences(text) {
  const list = [];
  let paragraph = 0;
  for (const match of text.matchAll(/[^\n]+/g)) {
    paragraph++;
    let index = 0;
    for (const part of match[0].matchAll(/[^.!?]+[.!?]+|[^.!?]+$/g)) {
      const raw = part[0], content = raw.trim();
      if (!content) continue;
      const start = match.index + part.index + raw.indexOf(content);
      list.push({ id: 's' + (list.length + 1), paragraph, index: ++index, start, end: start + content.length, text: content });
    }
  }
  return list;
}

function reviewSentence(sentence) {
  let suggestion = sentence.text;
  const changes = [];
  const rules = [
    [/\bI is\b/gi, 'I am', '主语 I 后使用 am'],
    [/\b(we|they) is\b/gi, '$1 are', '检查主语与 be 动词的一致性'],
    [/\bhe have\b/gi, 'he has', '第三人称单数使用 has'],
    [/\bshe have\b/gi, 'she has', '第三人称单数使用 has'],
    [/\bmore better\b/gi, 'better', '比较级 better 前无需再加 more'],
    [/\bpeoples\b/g, 'people', '表示一般人群时使用 people'],
    [/\ba increase\b/gi, 'an increase', '元音开头的 increase 前使用 an'],
  ];
  for (const [pattern, replacement, reason] of rules) {
    if (pattern.test(suggestion)) { pattern.lastIndex = 0; suggestion = suggestion.replace(pattern, replacement); changes.push(reason); }
  }
  if (/^I are\b/.test(suggestion)) suggestion = suggestion.replace(/^I are\b/, 'I am');
  return { ...sentence, status: changes.length ? 'fix' : 'keep', issueType: changes.length ? 'grammar' : 'none', suggestion,
    reason: changes.length ? changes.join('。') : '基础规则未标出明确错误。可结合图表检查数据、时态和比较关系。' };
}

export async function localTask1(question, text, hash) {
  const annotated = sentences(text).map(reviewSentence);
  const wordCount = (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
  const note = '基础规则反馈。尚未配置 AI，图表事实和四维分数等待语义评测。';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const textHash = hash ? await hash(text) : Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return {
    schemaVersion: 'task1-local-v1', sourceKind: 'rule', submissionId: crypto.randomUUID(),
    questionId: question.id, createdAt: new Date().toISOString(), textHash, wordCount, underlength: wordCount < 150,
    source: { origin: 'rule', humanVerified: false, analysis: { chartTypes: [question.type], keyFeatures: [] } },
    assessment: { criteria: {}, unroundedMean: null, displayBand: null },
    feedback: {
      assessmentMode: 'local_rules', assessmentNote: note,
      review: { decision: 'revise', summary: note, remainingIssues: annotated.filter(s => s.status === 'fix').map(s => ({ sentenceId: s.id, issueType: 'grammar', action: s.reason })) },
      scores: Object.fromEntries(['taskAchievement', 'coherenceCohesion', 'lexicalResource', 'grammaticalRangeAccuracy'].map(key => [key, { band: null, reason: note, nextStep: '对照原图检查概述、数据及分组，完成一次有依据的修改。' }])),
      overview: { status: 'uncertain', reason: '请检查是否概括了最主要的趋势或差异。基础规则无法判断图表概述是否充分。', sentenceIds: [] },
      coverage: [], checks: [], sentences: annotated,
      modelAnswer: { text: '', note: '配置 AI 后可按本题图表和你的原稿生成改写。当前可使用逐句基础建议修改原稿。' },
      nextPractice: { skill: 'grammar', instruction: '对照图表核对每个数字与比较关系，并修改上面标记的句子。', successCriteria: ['保留原图中的数字与单位', '修改后回读整段，核对主语和动词'] },
    },
  };
}
