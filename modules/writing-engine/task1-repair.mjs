import {assertSchema,evaluationSchema} from './task1/src/contracts.mjs';
import {validateEvaluation,sourceReady} from './task1/src/validation.mjs';
import {countWords,revisionBudget} from './task1/src/text.mjs';

// Host delivery policy, not a new scoring rubric. Never invent a score, quote or fact.
export function repairTask1Feedback(candidate,{input,source,anchors}) {
  assertSchema(evaluationSchema,candidate);
  const data=structuredClone(candidate),changes=[],manual=[];
  const byId=new Map(anchors.map(s=>[s.id,s])),facts=new Map(source.facts.map(f=>[f.id,f]));
  const add=(field,rule)=>changes.push({field,rule});
  for(const check of data.checks)if(check.verdict==='supported'&&check.impact!=='none'){
    check.impact='none';add('checks','supported_has_no_error_impact');
  }
  const insufficient=input.mode==='language'?'language_only':countWords(input.text)<40?'insufficient_response':
    !sourceReady(source)||data.sourceReview.imageAgreement!=='confirmed'?'insufficient_source':null;
  if(insufficient&&data.assessmentMode!==insufficient){data.assessmentMode=insufficient;add('assessmentMode','conservative_source_or_response_limit');}
  if(insufficient){
    for(const [key,score] of Object.entries(data.scores))if(insufficient!=='insufficient_source'||key==='taskAchievement')score.band=null;
    data.modelAnswer={text:'',factIds:[],note:'当前来源或作答不足以生成完整参考答案；已有原文反馈仍可查看。'};
  }
  let growth=0;const budget=revisionBudget(input).positiveGrowthBudget;
  for(const sentence of data.sentences){
    const original=byId.get(sentence.id);if(!original||sentence.status==='keep')continue;
    const numbers=value=>(value.match(/\d+(?:[,.]\d+)*/g)||[]).join('|');
    const changeNumber=sentence.suggestion!==''&&numbers(sentence.suggestion)!==numbers(original.text);
    const reliable=sentence.factIds.some(id=>facts.get(id)?.confidence==='high'&&facts.get(id)?.approximate===false);
    const uncertain=data.checks.some(check=>check.sentenceId===sentence.id&&check.verdict==='unverifiable');
    const delta=Math.max(0,countWords(sentence.suggestion)-countWords(original.text));
    if(changeNumber&&['data_accuracy','comparison'].includes(sentence.issueType)&&(!reliable||uncertain)||growth+delta>budget){
      manual.push({sentenceId:sentence.id,issueType:sentence.issueType,instruction:sentence.reason||'请对照题图手动核实本句，系统未自动改动数字。'});
      sentence.status='keep';sentence.issueType='none';sentence.suggestion=original.text;sentence.redundantWithSentenceId=null;
      add('sentences.'+sentence.id,'unsafe_or_over_budget_edit_retained_original');
    }else growth+=delta;
  }
  if(!input.revisionContext&&data.review.resolved.length){data.review.resolved=[];add('review.resolved','first_draft_has_no_previous_resolution');}
  const ready=data.assessmentMode==='full'&&countWords(input.text)>=150&&data.overview.status==='clear'&&
    !data.review.remainingIssues.length&&data.sentences.every(s=>s.status==='keep')&&
    !data.coverage.some(c=>['missing','uncertain'].includes(c.status))&&!data.checks.some(c=>c.verdict!=='supported')&&!manual.length;
  if(data.review.decision==='ready'&&!ready){data.review.decision='revise';add('review.decision','uncertain_evidence_requires_review');}
  if(data.review.decision!=='ready'&&!data.review.remainingIssues.length){
    const check=data.checks.find(c=>c.verdict!=='supported'),edit=data.sentences.find(s=>s.status!=='keep');
    data.review.remainingIssues=[{sentenceId:check?.sentenceId||edit?.id||anchors[0].id,issueType:check?'data_accuracy':edit?.issueType||'key_features',action:manual[0]?.instruction||'对照题图核查本句依据，确认主要信息和概述，再完成复练。'}];
  }
  if(data.assessmentMode==='full'){
    const words=countWords(data.modelAnswer.text),valid=data.modelAnswer.factIds.length&&data.modelAnswer.factIds.every(id=>['high','medium'].includes(facts.get(id)?.confidence));
    if(words<150||words>220||!valid){data.modelAnswer={text:'',factIds:[],note:'参考答案未满足字数或图表证据要求，本次不展示范文；有效评分与逐句批注已保留。'};add('modelAnswer','invalid_auxiliary_answer_unavailable');}
  }
  validateEvaluation(data,{input,source,anchors,allowUnavailableModelAnswer:true});
  return {feedback:data,policy:{version:'task1-host-delivery-v1',changes,manualInstructions:manual,modelAnswerStatus:data.modelAnswer.text?'available':'unavailable',scoresInvented:false}};
}
