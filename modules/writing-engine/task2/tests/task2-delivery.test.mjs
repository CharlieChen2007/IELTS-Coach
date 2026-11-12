import test from 'node:test';
import assert from 'node:assert/strict';
import {task2Input,task2Question,task2Analysis,task2Feedback} from './task2-fixtures.mjs';
import {env,response} from './fixtures.mjs';
import {repairTask2Feedback,createTask2Engine,buildTask2Messages,applyTask2Suggestion} from '../src/task2.mjs';
import {inspectTask2Evaluation,validateTask2Evaluation} from '../src/task2-validation.mjs';
import {task2Budget} from '../src/task2-policy.mjs';
import {anchorSentences,countWords} from '../src/text.mjs';
import {getConfig,requestJson} from '../src/deepseek.mjs';

const context=(input=task2Input())=>({input,analysis:task2Analysis(),anchors:anchorSentences(input.text,input.submissionId)});
const syntheticWords=n=>Array(n).fill('word').join(' ');
const paragraphEssay=n=>syntheticWords(Math.floor(n/2))+'.\n\n'+syntheticWords(n-Math.floor(n/2))+'.';
function short(n=140){return {...task2Input(),text:paragraphEssay(n)};}
function revisable(input=task2Input()){
  const f=task2Feedback(input);f.review={decision:'revise',summary:'需要展开论证',remainingIssues:[{sentenceId:f.sentences[0].id,reason:'论据需要由作者补充',action:'手动补充具体解释'}]};return f;
}
function replace(f,i,extra,type='precision'){
  Object.assign(f.sentences[i],{action:'replace',editType:type,status:'improve',suggestion:f.sentences[i].suggestion+' '+syntheticWords(extra)});
}
const grade=f=>({scores:f.scores,stance:f.stance,taskCoverage:f.taskCoverage,assessmentMode:f.assessmentMode,review:f.review});

test('140-word draft with 194-word model retains grades and withholds incomplete model',()=>{
  const input=short(),candidate=revisable(input);candidate.modelEssay.text=paragraphEssay(194);const before=structuredClone(candidate);
  const fixed=repairTask2Feedback(candidate,context(input));assert.deepEqual(candidate,before);assert.deepEqual(grade(fixed.feedback),grade(candidate));
  assert.equal(fixed.feedback.assessmentMode,'full');assert.equal(fixed.feedback.modelEssay.kind,'unavailable');assert.equal(fixed.feedback.modelEssay.text,'');
  assert.equal(fixed.policy.adjustments[0].rule,'model_min_words');assert.equal(fixed.policy.adjustments[0].observed,194);validateTask2Evaluation(fixed.feedback,context(input));
});
test('225-word original / 249-word model no longer loses the full report',()=>{
  const input=short(225),f=revisable(input);f.modelEssay.text=paragraphEssay(249);
  const fixed=repairTask2Feedback(f,context(input));assert.equal(fixed.policy.modelEssayStatus,'unavailable');assert.equal(fixed.feedback.scores.taskResponse.band,7);
});
test('250-word and upper-limit model are retained; above-limit and single-paragraph are withheld',()=>{
  const input=short(225),ctx=context(input),limit=task2Budget(input).modelWordLimit;
  for(const n of [250,limit]){const f=revisable(input);f.modelEssay.text=paragraphEssay(n);assert.equal(repairTask2Feedback(f,ctx).policy.applied,false);}
  for(const text of [paragraphEssay(limit+1),syntheticWords(270)]){const f=revisable(input);f.modelEssay.text=text;assert.equal(repairTask2Feedback(f,ctx).feedback.modelEssay.kind,'unavailable');}
});
test('single-sentence overflow becomes manual, preserving original words and problem status',()=>{
  for(const [type,extra] of [['grammar',5],['precision',13]]){
    const f=revisable();replace(f,0,extra,type);const fixed=repairTask2Feedback(f,context());
    assert.equal(fixed.feedback.sentences[0].action,'manual');assert.equal(fixed.feedback.sentences[0].suggestion,context().anchors[0].text);
    assert.equal(fixed.feedback.sentences[0].status,'improve');assert.deepEqual(grade(fixed.feedback),grade(f));assert.equal(fixed.policy.adjustments[0].rule,'sentence_growth');
  }
});
test('cumulative positive growth and non-grammar count are enforced deterministically',()=>{
  const f=revisable();for(let i=0;i<3;i++)replace(f,i,12);
  const fixed=repairTask2Feedback(f,context());assert.equal(fixed.feedback.sentences[2].action,'manual');assert.equal(fixed.policy.adjustments[0].remaining,5);
  const many=revisable();for(let i=0;i<4;i++)replace(many,i,1);const next=repairTask2Feedback(many,context());
  assert.equal(next.feedback.sentences[3].action,'manual');assert.equal(next.policy.adjustments[0].rule,'non_grammar_edits');
});
test('repair uses original-text order even when model lists edits out of order',()=>{
  const f=revisable();for(let i=0;i<4;i++)replace(f,i,1);const lastId=f.sentences[3].id;f.sentences.reverse();
  const fixed=repairTask2Feedback(f,context());assert.equal(fixed.feedback.sentences.find(s=>s.id===lastId).action,'manual');assert.equal(fixed.policy.adjustments[0].path,'sentences[3].suggestion');
});
test('repair handles simultaneous model and suggestion failures without relaxing either limit',()=>{
  const f=revisable();replace(f,0,20);f.modelEssay.text=paragraphEssay(249);
  const fixed=repairTask2Feedback(f,context());assert.equal(fixed.policy.adjustments.length,2);assert.equal(fixed.feedback.sentences[0].action,'manual');
  assert.equal(fixed.feedback.modelEssay.kind,'unavailable');assert.deepEqual(grade(fixed.feedback),grade(f));
});
test('repaired feedback is stable on repeated repair',()=>{
  const f=revisable();replace(f,0,20);f.modelEssay.text=paragraphEssay(194);const first=repairTask2Feedback(f,context());
  const second=repairTask2Feedback(first.feedback,context());assert.deepEqual(second.feedback,first.feedback);assert.equal(second.policy.applied,false);
});
test('core grade, evidence, stance and review contradictions remain hard errors',()=>{
  for(const change of [f=>f.scores.taskResponse.band=10,f=>f.scores.taskResponse.evidenceSentenceIds=['absent'],f=>{f.stance.status='unclear';},f=>{f.review.decision='ready';}]){
    const f=revisable();replace(f,0,20);f.modelEssay.text=paragraphEssay(194);change(f);
    assert.throws(()=>repairTask2Feedback(f,context()),{code:'INVALID_OUTPUT'});
  }
});
test('repair does not hide missing sentence anchors, illegal deletions or copied neighbours',()=>{
  for(const change of [f=>f.sentences.pop(),f=>Object.assign(f.sentences[0],{action:'delete',editType:'redundancy',status:'improve',suggestion:'',redundantWithSentenceId:'absent'}),f=>Object.assign(f.sentences[2],{action:'replace',editType:'precision',status:'improve',suggestion:f.sentences[3].suggestion})]){
    const f=revisable();change(f);assert.throws(()=>repairTask2Feedback(f,context()),{code:'INVALID_OUTPUT'});
  }
});
test('strict validation returns structured field-level violations',()=>{
  const f=revisable();replace(f,0,20);f.modelEssay.text=paragraphEssay(249);
  const v=inspectTask2Evaluation(f,context());assert.equal(v[0].path,'sentences[0].suggestion');assert.equal(v[0].limit,12);assert.equal(v.at(-1).observed,249);
  assert.throws(()=>validateTask2Evaluation(f,context()),e=>e.code==='INVALID_OUTPUT'&&e.details[0].rule==='sentence_growth');
});
test('eligible full reports can explicitly withhold an unavailable model without changing scores',()=>{
  const f=revisable();f.modelEssay={kind:'unavailable',text:'',preservesStance:false,note:'无法给出可靠完整范文',upgrades:[]};
  validateTask2Evaluation(f,context());assert.equal(repairTask2Feedback(f,context()).policy.applied,false);
});
test('independent model essay does not consume auto-edit growth allowance',()=>{
  const input=short(140),f=revisable(input);f.modelEssay.text=paragraphEssay(280);
  assert.equal(repairTask2Feedback(f,context(input)).feedback.modelEssay.kind,'upgraded');assert.ok(280-140>task2Budget(input).positiveGrowthBudget);
  const data=JSON.parse(buildTask2Messages(input,task2Question(),{analysis:task2Analysis()})[1].content);
  assert.equal(data.editLimits.cumulativePositiveGrowth,task2Budget(input).positiveGrowthBudget);assert.equal(data.editLimits.modelEssayIndependentOfEditBudget,true);
});
test('ready report may retain a valid original; inconsistent ready is never repaired',()=>{
  const f=task2Feedback();f.modelEssay.text=paragraphEssay(194);const fixed=repairTask2Feedback(f,context());
  assert.equal(fixed.feedback.modelEssay.text,task2Input().text);assert.equal(fixed.policy.adjustments[0].resolution,'retain_original');
  const shortInput=short(140),bad=task2Feedback(shortInput);assert.throws(()=>repairTask2Feedback(bad,context(shortInput)),{code:'INVALID_OUTPUT'});
});
test('engine repairs once per result without additional model calls; cache reanchors audit IDs',async()=>{
  let calls=0;const input=short(140);
  const engine=createTask2Engine({env,fetcher:async()=>{calls++;const f=revisable({...input,submissionId:'model-draft'});replace(f,0,20);f.modelEssay.text=paragraphEssay(194);return response(f);}});
  const first=await engine.evaluate(input,task2Question()),second=await engine.evaluate({...input,submissionId:'different'},task2Question());
  assert.equal(calls,1);assert.equal(first.generation.attempts,1);assert.equal(second.cache.evaluationReused,true);assert.equal(second.deliveryPolicy.adjustments.length,2);
  assert.ok(second.deliveryPolicy.adjustments[0].sentenceId.startsWith('different:'));
  assert.deepEqual(first.assessment,second.assessment);
  assert.throws(()=>applyTask2Suggestion({originalText:input.text,currentText:input.text,report:first,sentenceId:first.feedback.sentences[0].id}),{code:'DRAFT_CONFLICT'});
});
test('invalid JSON with finish_reason stop is retried, not guessed or accepted',async()=>{
  let calls=0,secondBody;
  const fetcher=async(_url,init)=>{calls++;if(calls===1)return response(null,{choices:[{finish_reason:'stop',message:{content:'{"scores":'}}]});secondBody=JSON.parse(init.body);return response({ok:true});};
  const result=await requestJson({config:getConfig(env),messages:[{role:'system',content:'JSON only'}],fetcher,validate:x=>x});
  assert.equal(result.generation.attempts,2);const hint=JSON.parse(secondBody.messages.at(-1).content).validationFailure;
  assert.equal(hint.violations[0].rule,'json_syntax');assert.equal(hint.violations[0].finishReason,'stop');assert.equal(typeof hint.violations[0].characterCount,'number');
});
test('a truncated first attempt is repaired on retry without repeating the omission',async()=>{
  /* 真实线上最常见的失败是「模型只写到 stance 就收尾」，JSON 本身合法但缺顶层字段。
     重试必须能救回这种半截输出，否则用户只能手动点「重新批改」。 */
  const strict=data=>{for(const key of ['assessmentNote','taskCoverage','stance','scores','sentences','review','modelEssay','nextPractice'])
    if(!(key in data))throw Object.assign(new Error('缺 '+key),{name:'AlgorithmError',code:'INVALID_OUTPUT',details:[{path:'$.'+key,rule:'required',missingFields:[key],interruptedAt:'stance'}]});return data;};
  const partial={assessmentMode:'full',assessmentNote:'截断',stance:{status:'clear'}};
  const full={...partial,taskCoverage:[],scores:{},sentences:[],review:{},modelEssay:{},nextPractice:{}};
  const seen=[];
  const r=await requestJson({config:getConfig(env),messages:[{role:'user',content:'u'}],validate:strict,maxTokens:100,
    fetcher:async(_url,options)=>{const sent=JSON.parse(options.body).messages.at(-1).content;seen.push(sent);
      return response(null,{choices:[{finish_reason:'stop',message:{content:JSON.stringify(seen.length===1?partial:full)}}]});}});
  assert.equal(r.generation.attempts,2);
  assert(seen[1].includes('validationFailure')&&seen[1].includes('stance'),'重试提示需点明中断位置');
});
test('format retry remains bounded at three calls and exposes structured diagnostic',async()=>{
  let calls=0;
  await assert.rejects(()=>requestJson({config:getConfig(env),messages:[],fetcher:async()=>{calls++;return response(null,{choices:[{finish_reason:'stop',message:{content:'{"scores":'}}]});},validate:x=>x}),e=>e.code==='INVALID_OUTPUT'&&e.details[0].rule==='json_syntax');
  assert.equal(calls,3);
});
