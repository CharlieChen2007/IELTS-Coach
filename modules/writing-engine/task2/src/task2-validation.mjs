import {assertSchema} from './contracts.mjs';
import {task2AnalysisSchema,task2EvaluationSchema,TASK2_CRITERIA} from './task2-contracts.mjs';
import {AlgorithmError,requireThat} from './errors.mjs';
import {countWords} from './text.mjs';
import {task2Budget} from './task2-policy.mjs';
const unique=values=>new Set(values).size===values.length;

export function validateTask2Analysis(data,question) {
  assertSchema(task2AnalysisSchema,data);
  requireThat(unique(data.requirements.map(r=>r.id)),'审题要求ID重复。');
  for(const r of data.requirements)requireThat(question.prompt.includes(r.promptQuote),'审题要求必须引用题干中的精确子串。');
  if(data.stanceRequired) requireThat(data.requirements.some(r=>['position','judgement','comparison'].includes(r.kind)),'需要立场的题目缺少对应设问检查项。');
  if(!data.stanceRequired)requireThat(!data.requirements.some(r=>r.kind==='position'||r.kind==='judgement'),'解释型题目不能额外加入必需个人立场。');
  if(data.promptQuality!=='clear')requireThat(data.cautions.length>0,'题干不确定时必须说明原因。');
  return data;
}

// Core errors still throw. Only bounded ancillary delivery failures are collected.
export function inspectTask2Evaluation(data,{input,analysis,anchors}) {
  assertSchema(task2EvaluationSchema,data);
  const map=new Map(anchors.map(s=>[s.id,s])),required=new Set(analysis.requirements.map(r=>r.id));
  const refs=(ids,label)=>requireThat(unique(ids)&&ids.every(id=>map.has(id)),label+' 引用无效或重复。');
  const full=data.assessmentMode==='full',words=countWords(input.text),budget=task2Budget(input);
  if(input.mode==='language')requireThat(data.assessmentMode==='language_only','语言模式不得输出整篇评分。');
  if(input.mode==='essay'&&words<40)requireThat(data.assessmentMode==='insufficient_response','短片段不应输出整篇成绩。');
  if(input.mode==='essay'&&words>=40&&analysis.promptQuality!=='clear')requireThat(data.assessmentMode==='insufficient_question','题干不清时必须限制评分。');
  if(full)requireThat(input.mode==='essay'&&words>=40&&analysis.promptQuality==='clear','完整评分的材料不足。');
  requireThat(data.taskCoverage.length===required.size&&unique(data.taskCoverage.map(r=>r.requirementId)),'设问检查必须覆盖全部实际要求且不能重复。');
  for(const r of data.taskCoverage){requireThat(required.has(r.requirementId),'引用了不存在的题目要求。');refs(r.evidenceSentenceIds,'设问');if(['covered','partial'].includes(r.status))requireThat(r.evidenceSentenceIds.length>0,'已回应要求需要原句证据。');if(r.status==='missing')requireThat(r.evidenceSentenceIds.length===0,'未回应要求不能伪造证据。');}
  refs(data.stance.evidenceSentenceIds,'立场');
  if(data.stance.status==='clear'||data.stance.status==='contradictory')requireThat(data.stance.evidenceSentenceIds.length>0,'立场判断必须有原文证据。');
  if(analysis.stanceRequired)requireThat(data.stance.status!=='not_required','该题要求立场，不可跳过检查。');
  for(const k of TASK2_CRITERIA){const s=data.scores[k];refs(s.evidenceSentenceIds,k);if(full)requireThat(s.band!==null,'完整评分缺少四维分数。');if(['language_only','insufficient_response'].includes(data.assessmentMode)||data.assessmentMode==='insufficient_question'&&k==='taskResponse')requireThat(s.band===null,'当前范围不得输出该维分数。');if(s.band!==null)requireThat(s.evidenceSentenceIds.length>0,'分数须有当前稿证据。');}
  if(data.scores.taskResponse.band>=6)requireThat(!data.taskCoverage.some(r=>r.status==='missing'),'主要设问缺失与TR≥6相冲突，请重新判断。');
  if(data.scores.taskResponse.band>=7&&analysis.stanceRequired)requireThat(data.stance.status==='clear','必要立场不清与TR≥7相冲突。');
  requireThat(data.sentences.length===anchors.length&&unique(data.sentences.map(s=>s.id)),'逐句结果需要完整且无重复。');
  const edits=new Map(data.sentences.map(s=>[s.id,s]));let growth=0,nonGrammar=0;
  const violations=[];
  const violation=(path,rule,observed,limit,sentenceId=null,remaining=null)=>violations.push({path,rule,sentenceId,observed,limit,remaining,resolution:rule.startsWith('model_')?'unavailable':'manual',instruction:rule.startsWith('model_')?'仅完整范文达到字数与段落要求才可展示；否则返回 unavailable，不能改分或凑词。':'保留原句并改为 manual；不得提高预算、改评分或把问题写成 keep。'});
  for(const [index,item] of data.sentences.entries()){
    const original=map.get(item.id);requireThat(original,'批注引用不存在的句子。');refs(item.contextSentenceIds,'上下文');
    if(item.status==='keep')requireThat(item.action==='keep'&&item.editType==='none'&&item.suggestion===original.text,'保留句必须完全原样保留。');
    else requireThat(item.editType!=='none'&&item.action!=='keep','修改需说明实质问题及动作。');
    if(item.action==='manual')requireThat(item.status!=='keep'&&item.suggestion===original.text,'手动任务不能偷偷包含自动改写。');
    if(item.action==='replace')requireThat(item.suggestion.trim()&&item.suggestion!==original.text,'替换应包含有效变化。');
    if(item.action==='delete'){
      const retained=map.get(item.redundantWithSentenceId);const retainedEdit=edits.get(item.redundantWithSentenceId);
      requireThat(item.suggestion===''&&item.editType==='redundancy'&&retained&&retained.id!==item.id&&retained.paragraph===original.paragraph&&retainedEdit?.action!=='delete','删除必须有同段另一条实际保留的句子，不得跨段或互删。');
    }else requireThat(item.redundantWithSentenceId===null&&item.suggestion!=='','非删除动作不得设置删除依据或空建议。');
    if(item.editType==='logic'){
      requireThat(item.contextSentenceIds.length>0&&item.contextSentenceIds.every(id=>map.get(id).paragraph===original.paragraph),'逻辑问题需引用本段上下文。');
      if(anchors.filter(s=>s.paragraph===original.paragraph).length>1)requireThat(item.contextSentenceIds.some(id=>id!==item.id),'逻辑问题不能只看该句；请引用同段相邻句检查论证。');
    }
    const delta=countWords(item.suggestion)-countWords(original.text);
    if(item.action==='replace'||item.action==='delete'){
      if(item.editType!=='grammar')nonGrammar++;
      const limit=item.editType==='grammar'?budget.grammarGrowthLimit:budget.otherGrowthLimit;
      if(delta>limit)violation(`sentences[${index}].suggestion`,'sentence_growth',delta,limit,item.id);
      if(item.editType==='redundancy')requireThat(delta<0,'冗余修改须实际减少词数。');
      for(const neighbor of anchors.filter(s=>s.paragraph===original.paragraph&&s.id!==original.id&&countWords(s.text)>=8))requireThat(!item.suggestion.includes(neighbor.text),'自动建议不得复制同段其他整句，避免逐句采用后重复。');
      growth+=Math.max(0,delta);
    }
  }
  if(growth>budget.positiveGrowthBudget)violation('sentences','total_growth',growth,budget.positiveGrowthBudget,null,0);
  if(nonGrammar>budget.maxNonGrammarEdits)violation('sentences','non_grammar_edits',nonGrammar,budget.maxNonGrammarEdits,null,0);
  for(const issue of data.review.remainingIssues)requireThat(map.has(issue.sentenceId),'优先问题必须引用当前句子。');
  if(data.review.decision==='ready')requireThat(full&&words>=250&&data.taskCoverage.every(r=>r.status==='covered')&&(!analysis.stanceRequired||data.stance.status==='clear')&&data.sentences.every(s=>s.status==='keep')&&data.review.remainingIssues.length===0,'收尾与正文要求、立场、词数或未解决批注不一致。');
  else requireThat(data.review.remainingIssues.length>0,'继续修订必须有具体的优先问题。');
  const canModel=full&&(!analysis.stanceRequired||data.stance.status==='clear');
  if(canModel&&data.modelEssay.kind==='upgraded'){
    requireThat(data.modelEssay.preservesStance,'完整范文应保留原文立场。');
    const n=countWords(data.modelEssay.text),paragraphs=data.modelEssay.text.split(/\r?\n\s*\r?\n/).filter(s=>s.trim()).length;
    if(n<budget.modelMinWords)violation('modelEssay.text','model_min_words',n,budget.modelMinWords);
    if(n>budget.modelWordLimit)violation('modelEssay.text','model_max_words',n,budget.modelWordLimit);
    if(paragraphs<2)violation('modelEssay.text','model_paragraphs',paragraphs,2);
  }else requireThat(data.modelEssay.kind==='unavailable'&&data.modelEssay.text===''&&!data.modelEssay.preservesStance&&(data.modelEssay.upgrades??[]).length===0,'范文不可用时必须返回空内容和原因；不得代替作者确定不清楚的立场。');
  refs(data.nextPractice.evidenceSentenceIds,'复练');
  return violations;
}

export function validateTask2Evaluation(data,context){
  const violations=inspectTask2Evaluation(data,context);
  if(violations.length)throw new AlgorithmError('INVALID_OUTPUT','辅助反馈未满足交付约束，请按字段修正。',{retryable:true,details:violations});
  return data;
}
