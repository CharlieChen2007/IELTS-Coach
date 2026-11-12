import { analysisSchema, evaluationSchema, assertSchema, CRITERIA } from './contracts.mjs';
import { requireThat } from './errors.mjs';
import { countWords, revisionBudget } from './text.mjs';

const unique = values => new Set(values).size === values.length;
const validRefs = (ids, valid) => unique(ids) && ids.every(id => valid.has(id));
export function validateAnalysis(data) {
  assertSchema(analysisSchema, data);
  for (const list of [data.panels, data.facts, data.keyFeatures]) requireThat(unique(list.map(x => x.id)), '读图结果出现重复 ID。');
  requireThat(unique(data.chartTypes), '图表类型不能重复。');
  const panels = new Set(data.panels.map(p => p.id)), facts = new Set(data.facts.map(f => f.id));
  for (const fact of data.facts) requireThat(panels.has(fact.panelId), '事实引用了不存在的面板。');
  for (const feature of data.keyFeatures) requireThat(validRefs(feature.factIds, facts), '核心特征引用了不存在的事实。');
  if (data.readability === 'clear') requireThat(data.panels.length > 0 && data.facts.length > 0 && data.keyFeatures.length > 0, '清晰图像必须提供面板、事实和核心特征。');
  if (data.readability !== 'clear') requireThat(data.uncertainties.length > 0, '图像不清楚时需要说明无法判断的部分。');
  return data;
}

export function sourceReady(source) {
  const facts = new Map(source.facts.map(f => [f.id, f]));
  return source.readability === 'clear' && source.questionQuality.alignment === 'aligned' && source.questionQuality.instructions === 'standard' && source.keyFeatures.length > 0 && source.keyFeatures.every(f => f.factIds.length > 0 && f.factIds.every(id => ['high', 'medium'].includes(facts.get(id)?.confidence)));
}

export function validateEvaluation(data, { input, source, anchors, allowUnavailableModelAnswer = false }) {
  assertSchema(evaluationSchema, data);
  const sentenceMap = new Map(anchors.map(s => [s.id, s])), sentenceIds = new Set(sentenceMap.keys());
  const factMap = new Map(source.facts.map(f => [f.id, f])), factIds = new Set(factMap.keys());
  const featureIds = new Set(source.keyFeatures.map(k => k.id));
  const references = (ids, valid, label) => requireThat(validRefs(ids, valid), label + ' 引用无效或重复。');
  const sureFacts = ids => ids.every(id => ['high', 'medium'].includes(factMap.get(id)?.confidence));
  const full = data.assessmentMode === 'full';
  if (full) requireThat(sourceReady(source) && data.sourceReview.imageAgreement === 'confirmed' && input.mode === 'essay' && countWords(input.text) >= 40, '当前来源或作答不足以支持完整评分。');
  if (input.mode === 'language') requireThat(data.assessmentMode === 'language_only', '语言模式不能输出整篇成绩。');
  if (input.mode === 'essay' && countWords(input.text) < 40) requireThat(data.assessmentMode === 'insufficient_response', '短片段不能输出整篇成绩。');
  if (input.mode === 'essay' && countWords(input.text) >= 40 && (!sourceReady(source) || data.sourceReview.imageAgreement !== 'confirmed')) requireThat(data.assessmentMode === 'insufficient_source', '来源不确定时必须降级。');
  for (const key of CRITERIA) {
    const item = data.scores[key]; references(item.evidenceSentenceIds, sentenceIds, key);
    if (full) requireThat(item.band !== null, '完整评分必须含四维分数。');
    if (['language_only', 'insufficient_response'].includes(data.assessmentMode) || data.assessmentMode === 'insufficient_source' && key === 'taskAchievement') requireThat(item.band === null, '当前模式不得给出该维分数。');
    if (item.band !== null) requireThat(item.evidenceSentenceIds.length > 0, '评分必须引用学习者原文。');
  }
  references(data.overview.sentenceIds, sentenceIds, '概述');
  if (['clear', 'partial'].includes(data.overview.status)) requireThat(data.overview.sentenceIds.length > 0, '存在概述时需给出原文证据。');
  if (data.overview.status === 'missing') requireThat(data.overview.sentenceIds.length === 0, '缺失概述不能伪造证据。');
  if (data.scores.taskAchievement.band >= 7) requireThat(data.overview.status === 'clear', 'TA≥7 与不清楚的概述相冲突，请重新判断。');
  if (data.scores.taskAchievement.band >= 6) requireThat(['clear', 'partial'].includes(data.overview.status), 'TA≥6 与缺失概述相冲突，请重新判断。');
  requireThat(unique(data.coverage.map(c => c.featureId)) && data.coverage.length === featureIds.size, '必须检查全部核心特征且不能重复。');
  for (const item of data.coverage) {
    requireThat(featureIds.has(item.featureId), '覆盖情况的特征不存在。'); references(item.sentenceIds, sentenceIds, '覆盖情况');
    if (['covered', 'partial'].includes(item.status)) requireThat(item.sentenceIds.length > 0, '声称已回应时需提供证据。');
    if (item.status === 'missing') requireThat(item.sentenceIds.length === 0, '缺失特征不能伪造证据。');
  }
  for (const check of data.checks) {
    requireThat(sentenceMap.get(check.sentenceId)?.text.includes(check.quote), '核查引用不在对应原句中。'); references(check.factIds, factIds, '事实核查');
    if (['supported', 'contradicted'].includes(check.verdict)) requireThat(check.factIds.length > 0 && sureFacts(check.factIds) && check.confidence !== 'low', '不确定事实不能支持确定核查结论。');
    if (check.verdict === 'supported') requireThat(check.impact === 'none', '已支持事实不能标为错误。');
  }
  requireThat(data.sentences.length === anchors.length && unique(data.sentences.map(s => s.id)), '逐句反馈必须完整、无重复。');
  const feedback = new Map(data.sentences.map(s => [s.id, s])); let growth = 0;
  for (const item of data.sentences) {
    const original = sentenceMap.get(item.id); requireThat(original, '反馈中的句子不存在。'); references(item.factIds, factIds, '句子');
    if (item.status === 'keep') requireThat(item.suggestion === original.text && item.issueType === 'none' && item.redundantWithSentenceId === null, '保留句必须原样保留。');
    else requireThat(item.suggestion !== original.text && item.issueType !== 'none', '修改必须有具体变化与原因。');
    if (['data_accuracy', 'comparison', 'sequence', 'location'].includes(item.issueType) && item.status !== 'keep') requireThat(item.factIds.length > 0 && sureFacts(item.factIds), '图表相关改写缺少可靠证据。');
    if (item.suggestion === '') {
      const target = sentenceMap.get(item.redundantWithSentenceId);
      requireThat(item.issueType === 'redundancy' && target && target.id !== item.id && target.paragraph === original.paragraph && feedback.get(target.id)?.suggestion !== '', `删除句 ${item.id} 必须用 redundancy，并引用同段另一条未删除的句子；否则保留或在原位改写。`);
    } else requireThat(item.redundantWithSentenceId === null, '非删除建议不能设置删除依据。');
    const numbers = value => (value.match(/\d+(?:[,.]\d+)*/g) ?? []).join('|');
    if (item.status !== 'keep' && numbers(item.suggestion) !== numbers(original.text) && item.suggestion !== '' && ['data_accuracy', 'comparison'].includes(item.issueType)) requireThat(item.factIds.some(id => factMap.get(id)?.approximate === false && factMap.get(id)?.confidence === 'high'), '自动改数值必须有明确标注且高信度的事实，不可用目测约数替换学生数据。');
    if (data.checks.some(c => c.sentenceId === item.id && c.verdict === 'unverifiable') && item.issueType === 'data_accuracy') requireThat(item.status === 'keep' || numbers(item.suggestion) === numbers(original.text), '该句数字尚无法核实，不得自动改成模型估读值。');
    growth += Math.max(0, countWords(item.suggestion) - countWords(original.text));
  }
  requireThat(growth <= revisionBudget(input).positiveGrowthBudget, '逐句建议的累计正增词超过首稿预算。');
  if (!input.revisionContext) requireThat(data.review.resolved.length === 0, '首稿不能声称解决了上轮问题。');
  for (const issue of data.review.remainingIssues) requireThat(sentenceIds.has(issue.sentenceId), '优先问题必须引用本稿句子。');
  if (data.review.decision === 'ready') {
    requireThat(full && countWords(input.text) >= 150 && data.overview.status === 'clear' && data.review.remainingIssues.length === 0 && data.sentences.every(s => s.status === 'keep') && !data.coverage.some(c => c.status === 'missing' || c.status === 'uncertain') && !data.checks.some(c => c.verdict !== 'supported'), '收尾结论与正文或来源问题矛盾。');
  } else requireThat(data.review.remainingIssues.length > 0, '继续修订须给出具体下一步。');
  references(data.modelAnswer.factIds, factIds, '参考答案');
  if (full && !(allowUnavailableModelAnswer && data.modelAnswer.text === '' && data.modelAnswer.factIds.length === 0)) {
    const words = countWords(data.modelAnswer.text);
    requireThat(words >= 150 && words <= 220 && data.modelAnswer.factIds.length > 0 && sureFacts(data.modelAnswer.factIds), '参考答案需在150–220词内并有可靠图表依据。');
  } else requireThat(data.modelAnswer.text === '' && data.modelAnswer.factIds.length === 0, '非完整评估不生成完整参考答案。');
  references(data.nextPractice.evidenceSentenceIds, sentenceIds, '复练');
  return data;
}
