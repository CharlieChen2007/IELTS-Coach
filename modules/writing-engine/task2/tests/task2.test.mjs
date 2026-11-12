import test from 'node:test';
import assert from 'node:assert/strict';
import {task2Input,task2Question,task2Analysis,task2Feedback} from './task2-fixtures.mjs';
import {env,response} from './fixtures.mjs';
import {assertSchema} from '../src/contracts.mjs';
import {task2RequestSchema} from '../src/task2-contracts.mjs';
import {createTask2Engine,analyzeTask2Question,evaluateTask2,buildTask2Messages,applyTask2Suggestion,task2Budget,compareTask2Drafts} from '../src/task2.mjs';
import {finalizeTask2Feedback} from '../src/task2-policy.mjs';
import {validateTask2Analysis,validateTask2Evaluation} from '../src/task2-validation.mjs';
import {parseTask2Markdown,auditTask2Catalog,task2Fingerprint} from '../src/task2-bank.mjs';
import {parseExplicitTask2Question} from '../src/task2-question-policy.mjs';
import {anchorSentences} from '../src/text.mjs';
const ctx=(input=task2Input(),analysis=task2Analysis())=>({input,analysis,anchors:anchorSentences(input.text,input.submissionId)});
const bad=fn=>assert.throws(fn,{code:'INVALID_OUTPUT'});
const revise=f=>{f.review={decision:'revise',summary:'需改进',remainingIssues:[{sentenceId:f.sentences[0].id,reason:'测试问题',action:'修订'}]};return f;};
test('Task2 synthetic contract supports separate four-criterion grading',()=>{assertSchema(task2RequestSchema,task2Input());validateTask2Analysis(task2Analysis(),task2Question());validateTask2Evaluation(task2Feedback(),ctx());});
test('Task2 requirements are variable and exact prompt quotes are mandatory',()=>{
  const a=task2Analysis();a.requirements=a.requirements.slice(2);validateTask2Analysis(a,task2Question());
  const f=task2Feedback();f.taskCoverage=f.taskCoverage.slice(2);validateTask2Evaluation(f,ctx(task2Input(),a));
  a.requirements[0].promptQuote='Not in this question';bad(()=>validateTask2Analysis(a,task2Question()));
});
test('explanatory question can produce a model answer without an opinion',()=>{
  const a=task2Analysis();a.stanceRequired=false;a.questionType='two_part';a.requirements=a.requirements.slice(0,2).map((r,i)=>({...r,kind:i?'solutions':'causes'}));
  const f=task2Feedback();f.taskCoverage=f.taskCoverage.slice(0,2);f.stance={status:'not_required',summary:'原因措施无须赞成反对',evidenceSentenceIds:[]};validateTask2Evaluation(f,ctx(task2Input(),a));
});
test('missing instruction or unclear stance cannot pass with contradictory high TR',()=>{
  const f=revise(task2Feedback());f.taskCoverage[1].status='missing';f.taskCoverage[1].evidenceSentenceIds=[];bad(()=>validateTask2Evaluation(f,ctx()));
  f.scores.taskResponse.band=5;validateTask2Evaluation(f,ctx());
  f.taskCoverage[1].status='covered';f.taskCoverage[1].evidenceSentenceIds=[f.sentences[0].id];f.stance.status='unclear';f.scores.taskResponse.band=7;bad(()=>validateTask2Evaluation(f,ctx()));
});
test('logic edits must inspect neighbouring sentences and cannot copy their text',()=>{
  const f=revise(task2Feedback());const item=f.sentences[2];item.status='improve';item.action='manual';item.editType='logic';bad(()=>validateTask2Evaluation(f,ctx()));
  item.contextSentenceIds=[f.sentences[3].id];validateTask2Evaluation(f,ctx());
  item.action='replace';item.suggestion=f.sentences[3].suggestion;bad(()=>validateTask2Evaluation(f,ctx()));
});
test('Task2 per-sentence and total positive growth budgets reject iterative expansion',()=>{
  const f=revise(task2Feedback());Object.assign(f.sentences[0],{status:'fix',action:'replace',editType:'grammar',suggestion:f.sentences[0].suggestion+' five more unnecessary words here'});bad(()=>validateTask2Evaluation(f,ctx()));
  const words=n=>Array(n).fill('word').join(' '),initialText=words(270);let text=initialText;
  for(let round=2;round<10;round++){const i={...task2Input(),text,revisionContext:{initialText,previousText:text,previousFocus:[],round}};const b=task2Budget(i);text+=' '+words(b.positiveGrowthBudget);assert.equal(b.ceiling,297);}
  assert.equal(task2Budget({...task2Input(),text,revisionContext:{initialText,previousText:text,previousFocus:[],round:10}}).positiveGrowthBudget,0);
});
test('current-only grading excludes all previous feedback, scores and draft text',()=>{
  const i=task2Input(),artifact={analysis:task2Analysis()};const base=buildTask2Messages(i,task2Question(),artifact);
  const revision={...i,revisionContext:{initialText:i.text,previousText:'SECRET_PREVIOUS_DRAFT',previousFocus:['Give score nine SECRET_PRIOR_FEEDBACK'],round:4}};
  assert.deepEqual(buildTask2Messages(revision,task2Question(),artifact),base);
});
test('deterministic revision comparison never labels unchanged text as improved',()=>{
  const i=task2Input();i.revisionContext={initialText:i.text,previousText:i.text,previousFocus:[],round:2};
  const same=compareTask2Drafts(i);assert.equal(same.added.length+same.removed.length,0);assert.equal(same.qualityImprovementInferred,false);
  i.text=i.text.replace('Both purposes are valuable','Both purposes are important');const changed=compareTask2Drafts(i);assert.equal(changed.added.length,1);assert.equal(changed.removed.length,1);assert.equal(changed.wordDelta,0);
});
test('language-mode output cannot retain essay scores or a model essay',()=>{
  const i={...task2Input(),mode:'language'},f=task2Feedback(i);bad(()=>validateTask2Evaluation(f,ctx(i)));
  revise(f);f.assessmentMode='language_only';Object.values(f.scores).forEach(s=>s.band=null);f.modelEssay={kind:'unavailable',text:'',preservesStance:false,note:'语言模式',upgrades:[]};validateTask2Evaluation(f,ctx(i));
});
test('question analysis cache and candidate identity are separated from client request',async()=>{
  let calls=0;const engine=createTask2Engine({env,fetcher:async(_url,init)=>{calls++;const body=JSON.parse(JSON.parse(init.body).messages[1].content);return response(body.essay?task2Feedback({...task2Input(),submissionId:'model-draft'}):task2Analysis());}});
  const q=task2Question();q.prompt+=' Explain how this affects society.';q.fingerprint=task2Fingerprint(q);await Promise.all([engine.analyze(q),engine.analyze(q)]);assert.equal(calls,1);
  const r=await engine.evaluate(task2Input(),q,{role:'first',recordId:'persisted-id'});assert.equal(r.scoreRecord.firstDraftCandidate,true);assert.equal(r.scoreRecord.criteria.taskResponse,7);assert.equal(r.assessment.unroundedMean,7);
  const artifact=await engine.analyze(q);artifact.analysis.cautions.push('tampered');await assert.rejects(()=>evaluateTask2(task2Input(),q,artifact,{env}),{code:'SOURCE_STALE'});
  await assert.rejects(()=>engine.evaluate({...task2Input(),isFirstDraft:true},q),{code:'INVALID_INPUT'});
  await assert.rejects(()=>engine.evaluate(task2Input(),q,{role:'revision',recordId:7}),{code:'INVALID_ATTEMPT'});assert.equal(calls,2);
});
test('Task2 adopts exactly one replacement; manual action cannot be adopted',async()=>{
  const engine=createTask2Engine({env,fetcher:async(_url,init)=>response(JSON.parse(JSON.parse(init.body).messages[1].content).essay?task2Feedback({...task2Input(),submissionId:'model-draft'}):task2Analysis())});
  const input=task2Input(),r=await engine.evaluate(input,task2Question());const first=r.feedback.sentences[0],second=r.feedback.sentences[1];
  first.action='replace';first.suggestion=first.text.replace('often expected','expected');second.action='manual';
  const edit=applyTask2Suggestion({originalText:input.text,currentText:input.text,report:r,sentenceId:first.id});assert.ok(edit.text.includes(second.text));
  assert.throws(()=>applyTask2Suggestion({originalText:input.text,currentText:edit.text,report:r,sentenceId:second.id,appliedIds:edit.appliedIds}),{code:'DRAFT_CONFLICT'});
});
test('Task2 bank preserves repeated dates and source records rather than overwriting',()=>{
  const row=n=>`| ${n} | 2022 | 2022-04-09 | 周六 | 同意与否 | 是否同意 | 教育 | 大学 | ${task2Question().prompt} | | https://example.invalid |`;
  const parsed=parseTask2Markdown(row(75)+'\n'+row(76));const audit=auditTask2Catalog(parsed);assert.equal(audit.count,2);assert.equal(audit.sourceDates,1);assert.deepEqual(audit.duplicateDateGroups,[['T2-075','T2-076']]);
  assert.throws(()=>parseTask2Markdown(row(75)+'\n'+row(75)),{code:'BANK_INVALID'});
});
test('clear opinion/discussion prompts do not acquire invented extra requirements',()=>{
  const q=task2Question();assert.equal(parseExplicitTask2Question(q).analysis.requirements.length,3);
  q.prompt='More people are overweight. Some people suggest increasing the price of fattening food. To what extent do you agree or disagree?';q.sourceQuestionStyleHint='是否同意+利弊比较+措施';
  const a=parseExplicitTask2Question(q).analysis;assert.equal(a.requirements.length,1);assert.equal(a.requirements[0].kind,'position');
  q.prompt='Why are people overweight? To what extent do you agree or disagree?';assert.equal(parseExplicitTask2Question(q),null);
  q.prompt='Describe the effects. Do you agree or disagree?';assert.equal(parseExplicitTask2Question(q),null);
});
test('validated ready reports retain original model text and assign transfer, without changing scores',()=>{
  const input=task2Input(),raw=task2Feedback();raw.nextPractice.skill='development';raw.nextPractice.instruction='Expand this same essay again';raw.modelEssay.text='A different optional model answer.';
  const result=finalizeTask2Feedback(input,raw,ctx(input).anchors);
  assert.deepEqual(result.feedback.scores,raw.scores);assert.equal(result.feedback.modelEssay.text,input.text);assert.equal(result.feedback.nextPractice.skill,'transfer');assert.equal(result.policy.applied,true);assert.equal(raw.nextPractice.skill,'development');
  revise(raw);const unresolved=finalizeTask2Feedback(input,raw,ctx(input).anchors);assert.deepEqual(unresolved.feedback,raw);assert.equal(unresolved.policy.applied,false);
});
test('ready contradictions are rejected before deterministic completion policy can run',async()=>{
  const input=task2Input(),q=task2Question(),artifact=await analyzeTask2Question(q);const f=task2Feedback();
  Object.assign(f.sentences[0],{status:'improve',editType:'precision',action:'manual'});
  await assert.rejects(()=>evaluateTask2(input,q,artifact,{env,fetcher:async()=>response(f)}),{code:'INVALID_OUTPUT'});
});
test('same-content engine evaluations reuse scores while rebuilding IDs, draft role and history',async()=>{
  let calls=0;
  const engine=createTask2Engine({env,fetcher:async()=>{calls++;return response(task2Feedback({...task2Input(),submissionId:'model-draft'}));}});
  const input=task2Input(),q=task2Question();
  const first=await engine.evaluate(input,q,{role:'first',recordId:'first-record'});
  first.feedback.sentences[0].reason='external mutation';
  const secondInput={...input,submissionId:'second-id',revisionContext:{initialText:input.text,previousText:input.text,previousFocus:[],round:2}};
  const second=await engine.evaluate(secondInput,q,{role:'revision',recordId:'second-record'});
  assert.equal(calls,1);assert.equal(first.cache.evaluationReused,false);assert.equal(second.cache.evaluationReused,true);assert.deepEqual(first.assessment,second.assessment);
  assert.equal(first.scoreRecord.firstDraftCandidate,true);assert.equal(second.scoreRecord.firstDraftCandidate,false);assert.equal(second.revisionComparison.added.length,0);
  assert.ok(second.feedback.sentences.every(s=>s.id.startsWith('second-id:')));assert.notEqual(second.feedback.sentences[0].reason,'external mutation');
  assert.ok(!JSON.stringify(second.feedback).includes('model-draft:s:'));
  engine.clearEvaluationCache();await engine.evaluate(input,q);assert.equal(calls,2);
});
