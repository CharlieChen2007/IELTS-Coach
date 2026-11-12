import {assertSchema} from './contracts.mjs';
import {task2DeliverySchema} from './task2-contracts.mjs';
import {inspectTask2Evaluation,validateTask2Evaluation} from './task2-validation.mjs';
import {task2Budget} from './task2-policy.mjs';
import {countWords} from './text.mjs';
import {TASK2_CRITERIA} from './task2-contracts.mjs';

export const TASK2_DELIVERY_VERSION='task2-delivery-v1';

/* 模型偶尔在 evidenceSentenceIds 里写成不存在的句子 ID 或重复同一句。
   这类引用错误不改变任何评分判断，可按以下规则收敛：
   - 过滤无效与重复 ID；
   - status=missing / not_required 的必须保持空数组；
   - 需要证据的位置若被清空，用该段首句兜底，避免整份反馈作废。 */
function sanitizeEvidence(feedback,anchors){
  const valid=new Set(anchors.map(a=>a.id)),first=anchors[0]?.id;
  const clean=(ids,{allowEmpty=false}={})=>{
    const list=Array.isArray(ids)?[...new Set(ids.filter(id=>valid.has(id)))]:[];
    if(list.length||allowEmpty||!first)return list;
    return [first];
  };
  for(const r of feedback.taskCoverage||[])r.evidenceSentenceIds=clean(r.evidenceSentenceIds,{allowEmpty:r.status==='missing'});
  if(feedback.stance)feedback.stance.evidenceSentenceIds=clean(feedback.stance.evidenceSentenceIds,{allowEmpty:feedback.stance.status==='not_required'});
  for(const score of Object.values(feedback.scores||{}))score.evidenceSentenceIds=clean(score.evidenceSentenceIds,{allowEmpty:true});
  if(feedback.nextPractice)feedback.nextPractice.evidenceSentenceIds=clean(feedback.nextPractice.evidenceSentenceIds);
  return feedback;
}

/* 模型偶尔给评分项加 `xxx_note` 之类的说明字段。这类多余键不改变任何分数，
   在校验前剥离即可；评分项缺失或非法仍会被后续校验拦住。 */
function dropUnknownScoreFields(candidate){
  if(!candidate?.scores||typeof candidate.scores!=='object'||Array.isArray(candidate.scores))return {value:candidate,dropped:[]};
  const allowed=new Set(TASK2_CRITERIA),dropped=Object.keys(candidate.scores).filter(k=>!allowed.has(k));
  if(!dropped.length)return {value:candidate,dropped:[]};
  const value=structuredClone(candidate);
  for(const key of dropped)delete value.scores[key];
  return {value,dropped};
}


/** Conservative delivery repair only. Never edits scores, evidence, stance or coverage. */
/* 范文超长时按「从末段往前、整句删除」的方式回到上限：
   不改写、不新增、不改立场、不动评分，删掉的是模型自己写的收尾句。
   必须保留至少 3 段且总词数仍达下限，否则返回 null 交给降级处理。 */
function trimModelEssay(text,budget){
  if(countWords(text)<=budget.modelWordLimit)return null;
  const paragraphs=text.split(/\r?\n\s*\r?\n/).map(p=>p.trim()).filter(Boolean);
  if(paragraphs.length<3)return null;
  const spilt=p=>p.split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(Boolean);
  const blocks=paragraphs.map(spilt);
  const total=()=>countWords(blocks.map(b=>b.join(' ')).join('\n\n'));
  // 从最后一段开始，逐句删到尾；删空则整段移除，但必须仍剩 3 段。
  for(let i=blocks.length-1;i>=2&&total()>budget.modelWordLimit;i--){
    while(blocks[i].length>1&&total()>budget.modelWordLimit)blocks[i].pop();
    if(total()>budget.modelWordLimit)blocks.splice(i,1);
  }
  const candidate=blocks.map(b=>b.join(' ')).join('\n\n'),n=countWords(candidate);
  return n>=budget.modelMinWords&&n<=budget.modelWordLimit?candidate:null;
}
export function repairTask2Feedback(candidate,context){
  const cleaned=dropUnknownScoreFields(candidate);
  const sanitized=sanitizeEvidence(cleaned.value,context.anchors);
  const violations=inspectTask2Evaluation(sanitized,context);
  const feedback=structuredClone(sanitized),budget=task2Budget(context.input),adjustments=[];
  for(const key of cleaned.dropped)adjustments.push({path:'scores',rule:'unknown_score_field',sentenceId:null,observed:key,limit:null,remaining:null,resolution:'dropped',instruction:'评分项只允许四个官方维度，多余说明字段已忽略。'});
  const byId=new Map(feedback.sentences.map(s=>[s.id,s]));
  feedback.sentences=context.anchors.map(anchor=>byId.get(anchor.id));
  const indices=new Map(feedback.sentences.map((s,i)=>[s.id,i]));
  let growth=0,nonGrammar=0;
  // Original-text order is stable even if the model listed its sentences out of order.
  for(const anchor of context.anchors){
    const index=indices.get(anchor.id),item=feedback.sentences[index];
    if(!['replace','delete'].includes(item.action))continue;
    const positive=Math.max(0,countWords(item.suggestion)-countWords(anchor.text));
    const nonGrammarCost=item.editType==='grammar'?0:1,limit=item.editType==='grammar'?budget.grammarGrowthLimit:budget.otherGrowthLimit;
    let rule,observed,allowed,remaining=null;
    if(positive>limit){rule='sentence_growth';observed=positive;allowed=limit;}
    else if(growth+positive>budget.positiveGrowthBudget){rule='total_growth';observed=growth+positive;allowed=budget.positiveGrowthBudget;remaining=allowed-growth;}
    else if(nonGrammar+nonGrammarCost>budget.maxNonGrammarEdits){rule='non_grammar_edits';observed=nonGrammar+nonGrammarCost;allowed=budget.maxNonGrammarEdits;remaining=allowed-nonGrammar;}
    if(rule){
      adjustments.push({path:`sentences[${context.anchors.indexOf(anchor)}].suggestion`,rule,sentenceId:anchor.id,observed,limit:allowed,remaining,resolution:'manual',instruction:'该项超出自动修改预算，请由作者手动修订；原句与评分保留。'});
      item.action='manual';item.suggestion=anchor.text;item.redundantWithSentenceId=null;
      item.reason=('需手动修订：原自动建议超出本轮编辑预算。'+item.reason).slice(0,1000);
    }else{growth+=positive;nonGrammar+=nonGrammarCost;}
  }
  /* 范文超长不该整篇丢弃：只在末尾段内按句删除，直到落回上限。
     不新增任何内容、不改立场、不动评分，删掉的都是自己写的收尾句。 */
  if(feedback.modelEssay.kind==='upgraded'){
    const trimmed=trimModelEssay(feedback.modelEssay.text,budget);
    if(trimmed!==null){
      adjustments.push({path:'modelEssay.text',rule:'model_max_words',sentenceId:null,observed:countWords(feedback.modelEssay.text),limit:budget.modelWordLimit,remaining:null,resolution:'trim_tail',instruction:'参考作文超出词数上限，仅删去末尾段的收尾句以回到上限内。'});
      feedback.modelEssay.text=trimmed;
    }
  }
  const modelViolations=violations.filter(v=>v.rule.startsWith('model_'));
  if(modelViolations.length){
    const words=countWords(context.input.text);
    const retain=feedback.review.decision==='ready'&&words>=budget.modelMinWords&&words<=budget.modelWordLimit&&context.input.text.split(/\r?\n\s*\r?\n/).filter(s=>s.trim()).length>=2;
    if(retain)feedback.modelEssay={kind:'upgraded',text:context.input.text,preservesStance:true,note:'本稿已满足收尾条件，参考版本直接保留当前原文。',upgrades:[]};
    else feedback.modelEssay={kind:'unavailable',text:'',preservesStance:false,note:'本次生成的参考作文未满足完整范文的字数或段落要求，暂不展示；原稿评分与有效批注已保留。',upgrades:[]};
    adjustments.push(...modelViolations.map(v=>({...v,resolution:retain?'retain_original':'unavailable'})));
  }
  // Core inconsistencies and anything outside the explicit repair allowlist fail closed.
  validateTask2Evaluation(feedback,context);
  const policy=assertSchema(task2DeliverySchema,{version:TASK2_DELIVERY_VERSION,applied:adjustments.length>0,modelEssayStatus:feedback.modelEssay.kind==='upgraded'?'available':'unavailable',adjustments});
  return {feedback,policy};
}
