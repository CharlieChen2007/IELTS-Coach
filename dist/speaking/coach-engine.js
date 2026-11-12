// Offline practice feedback. These are inspectable transcript signals. No audio
// qualities or official IELTS overall band can be inferred from these inputs.
const wordPattern = /[a-z]+(?:['’][a-z]+)*/gi;
const commonWords = new Set(("a am an and any are as at be been being but by can could did do does don't for from had has have he her here him his how i i'd i'll i'm i've if in into is it it's its like me more most much my no of on one or our out she so some than that the their them then there these they this those to us was we well were what when where which while who why will with would you your").split(' '));
const fillerWords = new Set(['uh','um','erm','hmm','ah']);
const vagueWords = new Set(['good','nice','thing','things','stuff','great','very','really']);
const patterns = {
  reason: /\b(because|since|as a result|due to|one reason|which means|so that|that means)\b/i,
  detail: /\b(for example|for instance|such as|especially|once|last (?:week|month|year|summer)|yesterday|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?|when i was)\b/i,
  contrast: /\b(however|although|even though|whereas|but|on the other hand|in contrast|unlike|rather than)\b/i,
  time: /\b(before|after|then|at first|eventually|these days|used to|nowadays)\b/i,
  relative: /\b(?:a|an|the|people|someone|anyone|those)\s+(?:[a-z]+\s+){0,2}(?:who|which|that)\s+[a-z]+\b/i,
  condition: /\b(if|unless|even if|provided that)\b/i,
  subordinate: /\b(because|although|whereas|while|even though|as soon as)\b/i,
  perfect: /\b(?:have|has|had|i've|we've|they've|you've)\s+(?:already\s+|never\s+|just\s+)?(?:[a-z]+ed|been|seen|done|known|made|found|gone|taken|grown|written|built|become)\b/i
};
const corrections = [
  [/\bI am agree\b/i, 'I agree', 'agree 本身是动词。'],
  [/\bI very like\b/i, 'I really like', '用 really 修饰动词 like。'],
  [/\bpeople is\b/i, 'people are', 'people 在这里通常接复数动词。'],
  [/\bmore better\b/i, 'better', 'better 已经是比较级。'],
  [/\bdepends of\b/i, 'depends on', 'depend 的常用介词是 on。'],
  [/\bdiscuss about\b(?=\s+(?:a|an|the|this|that|our|my|his|her|their|its|it)\b)/i, 'discuss', 'discuss 通常直接接讨论对象。'],
  [/\bmany informations\b/i, 'a lot of information', 'information 通常作不可数名词。'],
  [/\bdid(?: not|n['’]t) went\b/i, "didn't go", 'did 后接动词原形。'],
  [/\bone of my friend\b(?=\s*(?:[.,!?;]|$)|\s+(?:is|was|has|who|went|said)\b)/i, 'one of my friends', 'one of 后接复数名词。'],
  [/\bI have went\b/i, 'I have gone', 'have 后接过去分词。']
];
const frames = {
  preference: 'I tend to prefer ___ because ___. For instance, ___.',
  routine: 'On a typical ___, I ___. That usually helps me ___.',
  study: 'At the moment I ___. One part I particularly enjoy is ___ because ___.',
  change: 'I used to ___, but these days I ___. The biggest difference is ___.',
  place: 'The place I have in mind is ___. I first came across it when ___. What keeps me going back is ___.',
  next: "I'll probably go back ___. I'd like to ___ while I'm there.",
  contrast: 'For ___, the main concern is ___. For ___, on the other hand, ___.',
  decision: 'I would choose ___ because ___. If ___, though, I might decide differently.',
  reason: 'One possible reason is ___. For example, ___. This matters because ___.',
  general: 'In my experience, ___. A specific example is ___.'
};

function frameFor(part, phase, prompt) {
  if (phase === 'followup' || /next visit/i.test(prompt)) return frames.next;
  if (part === 2) return frames.place;
  if (/differ|different ages|compare|whereas/i.test(prompt)) return frames.contrast;
  if (/should|limited funds|would you choose/i.test(prompt)) return frames.decision;
  if (/prefer|enjoy most/i.test(prompt)) return frames.preference;
  if (/changed|change about/i.test(prompt)) return frames.change;
  if (/typical|usually/i.test(prompt)) return frames.routine;
  if (/work or are you a student/i.test(prompt)) return frames.study;
  if (part === 3 || /why/i.test(prompt)) return frames.reason;
  return frames.general;
}

function tokenize(text) {
  return (text.toLowerCase().replaceAll('’', "'").match(wordPattern) || []).filter(word => !fillerWords.has(word));
}

function excerpt(text) {
  const value = text.trim().split(/\s+/).slice(0, 12).join(' ');
  return value.length < text.trim().length ? value + '…' : value;
}

// A repeated prompt or answer can otherwise make a long but empty sample
// look strong. Compare distinct four-word sequences, including partial copies.
function chunks(words) {
  return new Set(words.slice(3).map((_, i) => words.slice(i, i + 4).join(' ')));
}
function copiedFraction(grams, other) {
  if (!grams.size) return 0;
  let matches = 0;
  for (const gram of grams) if (other.has(gram)) matches++;
  return matches / grams.size;
}
function inspect(turn, index, previous) {
  const transcript = typeof turn?.transcript === 'string' ? turn.transcript.trim() : '';
  const prompt = String(turn?.prompt || '');
  const words = tokenize(transcript);
  const grams = chunks(words);
  const reused = words.length >= 8 && previous.some(other => copiedFraction(grams, other) >= .82);
  const echo = words.length >= 4 && copiedFraction(grams, chunks(tokenize(prompt))) >= .82;
  const common = words.filter(word => commonWords.has(word));
  const distinctCommon = new Set(common).size;
  const otherLetters = (transcript.replace(/[A-Za-z]/g, '').match(/\p{L}/gu) || []).length;
  let issue = '';
  if (!words.length || otherLetters > words.join('').length * .4) issue = '没有可分析的完整英文转写';
  else if (echo) issue = '转写与题目高度重合';
  else if (reused) issue = '与前面一题的回答高度重复';
  else if (words.length < 6) issue = '英文样本少于 6 词';
  else if (new Set(words).size < 4 || (grams.size / (words.length - 3)) < .38) issue = '同一小段文字反复出现';
  else if (/(?:_{2,}|\[(?:reason|example|topic|idea|place|answer)\])/i.test(transcript)) issue = '转写含有待填写的模板空位';
  else if (distinctCommon < 2 || (words.length >= 16 && common.length < words.length * .2)) issue = '暂时无法从词串确认完整的英语表达';
  if (!issue) previous.push(grams);
  const signals = Object.fromEntries(Object.entries(patterns).map(([key, regex]) => [key, transcript.match(regex)?.[0] || '']));
  const correction = corrections.map(([pattern, replacement, hint]) => {
    const original = transcript.match(pattern)?.[0];
    return original ? { original, replacement, hint } : null;
  }).find(Boolean);
  const wordCounts = new Map();
  for (const word of words) if (vagueWords.has(word)) wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  const repeated = [...wordCounts.entries()].sort((a,b) => b[1] - a[1]).find(([,n]) => n >= 3);
  const part = Number(turn?.part) || null;
  return {turnIndex: Number(turn?.turnIndex) || index + 1, part, phase: turn?.phase,
    prompt, transcript, words, issue, signals, correction, repeated, manual: turn?.transcriptSource === 'manual'};
}
function feedback(row) {
  const {signals, issue, words, transcript, correction, repeated, part} = row;
  let strength = '', advice = '', example = frameFor(part, row.phase, row.prompt);
  if (issue) {
    strength = issue + '。';
    advice = !transcript ? '回听录音，记下你实际说出的第一句话；下次可在交卷前核对转写。'
      : words.length < 6 ? '在这句回答后再说一个原因或具体情景，形成两句相连的回答。'
      : '回听后核对转写，用自己的话直接回答这道题，加上一条专属于这个问题的信息。';
  } else {
    if (signals.detail) strength = '“' + signals.detail + '”引出了具体情景。';
    else if (signals.contrast) strength = '“' + signals.contrast + '”体现了对观点或情形的对比。';
    else if (signals.reason) strength = '“' + signals.reason + '”提示听者接下来会听到理由。';
    else if (signals.time) strength = '“' + signals.time + '”给出了时间线索。';
    else strength = '可以从自己的这句话继续展开：“' + excerpt(transcript) + '”。';
    if (correction) {
      advice = '回听“' + correction.original + '”。如果原声与转写一致，可改为“' + correction.replacement + '”。' + correction.hint;
    } else if (repeated) {
      advice = '你用了 ' + repeated[1] + ' 次“' + repeated[0] + '”。挑其中一次，补一个能听懂、能想象的细节。';
    } else if (row.phase === 'talk' && !signals.time) {
      advice = '把独白里的一个场景按先后顺序展开，先讲第一次去，再讲现在为什么还去。';
    } else if (part === 3 && !signals.contrast) {
      advice = '保留原观点，再说说它对哪一类人可能不成立，并交代原因。';
    } else if (!signals.detail) {
      advice = '把“' + excerpt(transcript) + '”中的一个观点落到某次具体经历，说清当时发生了什么。';
    } else if (!signals.reason) {
      advice = '保留已提到的细节，再用一句话解释它为什么支持你的回答。';
    } else {
      advice = '重新回答时保留这处例子，结尾用一句话说明它和题目之间的关系。';
    }
  }
  return {turnIndex: row.turnIndex, part, prompt: row.prompt, transcript, wordCount: words.length, strength, advice, example};
}

// Fixed-size windows make lexical variety less dependent on total speaking time.
function lexicalVariety(rows) {
  const words = rows.flatMap(row => row.words);
  let sum = 0, windows = 0;
  for (let i = 0; i + 32 <= words.length; i += 16) {
    sum += new Set(words.slice(i, i + 32)).size / 32;
    windows++;
  }
  return windows ? sum / windows : 0;
}
function halfBand(number) {
  return Math.round(Math.max(4, Math.min(7, number)) * 2) / 2;
}
function quoteSignal(rows, keys) {
  for (const row of rows) {
    const hit = keys.map(key => row.signals[key]).find(Boolean);
    if (hit) return '例如第 ' + row.turnIndex + ' 题的“' + hit + '”。';
  }
  return '';
}

export function assessSession(payload = {}) {
  const session = payload?.session || payload || {};
  const turns = Array.isArray(payload?.turns) ? payload.turns : (Array.isArray(session.turns) ? session.turns : []);
  const previous = [];
  const rows = turns.map((turn, i) => inspect(turn, i, previous));
  const usable = rows.filter(row => !row.issue);
  const wordCount = usable.reduce((sum, row) => sum + row.words.length, 0);
  const parts = new Set(usable.filter(row => row.words.length >= 12).map(row => row.part));
  const enough = session.mode === 'full' && session.status === 'submitted' && session.assessmentEligible === true &&
    wordCount >= 150 && usable.length >= 3 && [1,2,3].every(part => parts.has(part)) &&
    usable.length >= Math.ceil(rows.length * .65) &&
    usable.some(row => row.part === 2 && row.phase !== 'followup' && row.words.length >= 35);
  const links = ['reason','detail','contrast','time'];
  const clauses = ['relative','condition','subordinate','perfect'];
  const linked = usable.filter(row => links.some(key => row.signals[key])).length;
  const structureCount = clauses.filter(key => usable.some(row => row.signals[key])).length;
  const corrected = usable.filter(row => row.correction);
  const repeated = usable.find(row => row.repeated);
  const words = usable.flatMap(row => row.words);
  const content = words.filter(word => !commonWords.has(word));
  const variety = lexicalVariety(usable);
  const sampleWords = [...new Set(content.filter(word => word.length >= 5))].slice(0, 3);
  const base = usable.length || 1;
  const lexicalBand = halfBand(4 + Math.max(0, variety - .48) * 6 + Math.min(.5, new Set(content).size / 160) - (repeated ? .35 : 0));
  const grammarBand = halfBand(5 + Math.min(2, structureCount * .5) - 1.5 * corrected.length / base);
  const coherenceBand = halfBand(4.5 + linked / base * 1.4 + links.filter(k => usable.some(row => row.signals[k])).length * .23);
  const band = enough ? halfBand((coherenceBand + lexicalBand + grammarBand) / 3) : null;
  const manualTurns = rows.filter(row => row.manual && row.transcript).length;
  const limitations = ['本地规则分析英文转写。语速、停顿、重音和音素准确度需结合原声判断。'];
  if (enough) limitations.push('本地规则在 4–7 的练习刻度内提供估值，尚未经雅思考官样本校准。');
  if (manualTurns) limitations.push('有 ' + manualTurns + ' 段转写经过手工录入或校正，反馈针对当前文本。');
  if (rows.length > usable.length) limitations.push('有 ' + (rows.length - usable.length) + ' 段转写过短、重复或无法分析，未计入文本样本。');
  if (session.mode === 'quick') limitations.push('快速演练提供逐题指导；完整模考覆盖三个部分后可获得文本练习估值。');
  if (session.mode === 'full' && !session.assessmentEligible) limitations.push('本场的模考时长、作答连续性或录音完整性未满足封卷要求。');
  if (!enough && session.mode !== 'quick') limitations.push('估值需要完整封卷，三部分各有至少一段 12 词的回答，独白至少 35 词，有效转写共至少 150 词，且覆盖至少 65% 的已保存回答。');
  const dimensions = [
    {key:'coherence',title:'流利度与连贯性',band:enough ? coherenceBand : null,
      evidence: usable.length ? usable.length + ' 段有效转写中，' + linked + ' 段出现原因、例子、对比或时间线索。' + quoteSignal(usable,links) : '暂无可分析的英文回答。',
      advice:'这里只估计文本连贯性。回听时检查两句话之间的衔接，留意停顿是否打断意思。'},
    {key:'lexical',title:'词汇资源',band:enough ? lexicalBand : null,
      evidence:sampleWords.length ? '转写中的用词包括 ' + sampleWords.join('、') + '。' + (repeated ? '第 ' + repeated.turnIndex + ' 题反复使用“' + repeated.repeated[0] + '”。' : '') : '可供比较的内容词较少。',
      advice:repeated ? '把重复的泛义词换成一个能说明感受或用途的表达，再把整句说出来。' : '挑出一个观点，用更具体的动作或细节表达同样的意思。'},
    {key:'grammar',title:'语法多样性与准确性',band:enough ? grammarBand : null,
      evidence: usable.length ? '从关系从句、条件、从属连接及完成时中识别出 ' + structureCount + ' 类结构线索。' + quoteSignal(usable,clauses) + (corrected.length ? '有 ' + corrected.length + ' 题出现可回听核对的搭配。' : '') : '暂无可核对的句型。',
      advice:corrected.length ? feedback(corrected[0]).advice : '用两种句式说同一个观点，再检查从句是否完整。'},
    {key:'pronunciation',title:'发音',band:null,evidence:'已提交的语音回答会自动评测。逐题复盘可查看发音准确度、流利度与需留意的单词。',
      advice:'听薄弱词的示范音，再回听自己在原句中的发音。'}
  ];
  const exercises = [];
  if (corrected.length) exercises.push({title:'复说容易出错的一句',instruction:'找到第 ' + corrected[0].turnIndex + ' 题。' + feedback(corrected[0]).advice + ' 合上文字，连贯地说出整句。'});
  const focus = usable.find(row => row.part === 3 && !row.signals.contrast) || usable.find(row => !row.signals.detail) || usable[0];
  if (focus) exercises.push({title:'展开第 ' + focus.turnIndex + ' 题',instruction:'从“' + excerpt(focus.transcript) + '”开始，用 30 秒补充' +
    (focus.part === 3 ? '一个例外或相反观点，再解释你的立场。' : '一个真实的时间、地点和动作，再回扣原题。')});
  exercises.push({title: usable.length ? '回听一句，再录一次' : '先留下可分析的语料',
    instruction:usable.length ? '选出最想被听清的一句，重读两个关键词，重新录音，比较两遍的清晰度。' : '用英语回答一个日常问题并解释原因。先回听原声，再在交卷前补充或核对转写。'});
  const metrics = {turnCount:rows.length,analyzedTurns:usable.length,wordCount,manualTurns};
  return {version:'speaking-b.local.v1',generatedAt:session.submittedAt || session.endedAt || null,band,
    bandLabel: enough ? '文本练习参考分' : '本场仅提供练习反馈',
    summary: enough ? '依据三部分共 ' + wordCount + ' 词的转写估算文本表现。该数字仅作练习参考，未计入发音和实际语流，不能作为雅思口语总分。'
      : '本场有 ' + rows.length + ' 段回答，其中 ' + usable.length + ' 段可用于文本分析。' + (usable.length ? '可以先从逐题反馈中选择一题复练。' : '可先回听原声，再根据下方练习补充英语表达。'),
    dimensions,turns:rows.map(feedback),exercises,metrics,limitations};
}
