import {readFile} from 'node:fs/promises';
import {AlgorithmError} from './errors.mjs';
import {assertSchema} from './contracts.mjs';
import {sha256,anchorSentences,countWords} from './text.mjs';
import {getConfig,requestJson} from './deepseek.mjs';
import {task2Fingerprint} from './task2-bank.mjs';
import {task2RequestSchema,task2AnalysisSchema,task2EvaluationSchema,task2ScoreRecordSchema,TASK2_VERSION,TASK2_RUBRIC,TASK2_CRITERIA} from './task2-contracts.mjs';
import {validateTask2Analysis,validateTask2Evaluation} from './task2-validation.mjs';
import {task2Budget,compareTask2Drafts,finalizeTask2Feedback} from './task2-policy.mjs';
import {parseExplicitTask2Question,TASK2_QUESTION_POLICY_VERSION} from './task2-question-policy.mjs';
import {repairTask2Feedback,TASK2_DELIVERY_VERSION} from './task2-repair.mjs';
export {task2Budget,compareTask2Drafts};
export {repairTask2Feedback,TASK2_DELIVERY_VERSION};
const analyzePrompt=await readFile(new URL('../prompts/task2-analyze.md',import.meta.url),'utf8');
const evaluatePrompt=await readFile(new URL('../prompts/task2-evaluate.md',import.meta.url),'utf8');
export const TASK2_PROMPT_VERSION=sha256(analyzePrompt+evaluatePrompt+TASK2_QUESTION_POLICY_VERSION+TASK2_DELIVERY_VERSION).slice(0,16);

function checkQuestion(q){if(!q||q.task!=='task2'||!/^T2-\d{3}$/.test(q.questionId)||typeof q.prompt!=='string'||q.prompt.length<30||q.prompt.length>10000||q.fingerprint!==task2Fingerprint(q))throw new AlgorithmError('INVALID_QUESTION','需要可信题库的Task 2原始题干和指纹。');}
function checkInput(input,q,attempt={role:'unverified',recordId:null}){
  assertSchema(task2RequestSchema,input,'INVALID_INPUT');checkQuestion(q);
  if(!attempt||!['first','revision','unverified'].includes(attempt.role)||attempt.role!=='unverified'&&(typeof attempt.recordId!=='string'||!attempt.recordId.trim())||attempt.recordId!=null&&(typeof attempt.recordId!=='string'||!attempt.recordId.trim()||attempt.recordId.length>200)||input.revisionContext&&attempt.role==='first')throw new AlgorithmError('INVALID_ATTEMPT','稿次元数据应来自可信提交记录，复批不能声明为首稿。');
  if(input.questionId!==q.questionId||[input.text,input.revisionContext?.initialText,input.revisionContext?.previousText].filter(Boolean).some(text=>countWords(text)>1500||anchorSentences(text,'check').length>100))throw new AlgorithmError('INVALID_INPUT','题号不一致，或正文/历史超过1500词、100句的处理上限。');
  const anchors=anchorSentences(input.text,input.submissionId);if(!anchors.length)throw new AlgorithmError('INVALID_INPUT','需要可定位的英文作答。');return anchors;
}
export function buildTask2AnalysisMessages(q){return [{role:'system',content:analyzePrompt},{role:'user',content:JSON.stringify({questionId:q.questionId,prompt:q.prompt,sourceTypeHint:q.sourceTypeHint??null,sourceQuestionStyleHint:q.sourceQuestionStyleHint??null,schema:task2AnalysisSchema})}];}
export function buildTask2Messages(input,q,artifact){
  const budget=task2Budget(input);
  const editLimits={cumulativePositiveGrowth:budget.positiveGrowthBudget,grammarGrowthPerSentence:budget.grammarGrowthLimit,otherGrowthPerSentence:budget.otherGrowthLimit,maxNonGrammarAutoEdits:budget.maxNonGrammarEdits,overflowAction:'manual; suggestion must equal the original sentence',modelEssayIndependentOfEditBudget:true,modelEssayWordRange:[budget.modelMinWords,budget.modelWordLimit],modelEssayUnavailableAllowed:true};
  const payload={question:q.prompt,taskAnalysis:artifact.analysis,mode:input.mode,essay:input.text,sentences:anchorSentences(input.text,input.submissionId),wordCount:countWords(input.text),budget,editLimits,schema:task2EvaluationSchema};
  return [{role:'system',content:evaluatePrompt},{role:'user',content:JSON.stringify(payload)}];
}
export async function analyzeTask2Question(q,options={}){
  checkQuestion(q);
  const rule=parseExplicitTask2Question(q);
  if(rule){validateTask2Analysis(rule.analysis,q);return {schemaVersion:TASK2_VERSION,kind:'task2-question-analysis',analysisMethod:'rule',questionId:q.questionId,sourceFingerprint:q.fingerprint,promptVersion:TASK2_PROMPT_VERSION,analysisId:sha256(JSON.stringify([q.fingerprint,rule.policyVersion,TASK2_PROMPT_VERSION,rule.analysis])),policyVersion:rule.policyVersion,analysis:rule.analysis,generation:{requestedModel:null,responseModel:null,attempts:0,generatedAt:new Date().toISOString(),usage:{promptTokens:0,completionTokens:0}}};}
  const config=getConfig(options.env??process.env);
  const r=await requestJson({config,messages:buildTask2AnalysisMessages(q),maxTokens:5000,validate:data=>validateTask2Analysis(data,q),fetcher:options.fetcher??fetch,signal:options.signal});
  return {schemaVersion:TASK2_VERSION,kind:'task2-question-analysis',analysisMethod:'model',questionId:q.questionId,sourceFingerprint:q.fingerprint,promptVersion:TASK2_PROMPT_VERSION,analysisId:sha256(JSON.stringify([q.fingerprint,config.model,TASK2_PROMPT_VERSION,r.data])),analysis:r.data,generation:r.generation};
}
function checkArtifact(artifact,q,model){
  const byRule=artifact?.analysisMethod==='rule';
  if(artifact?.schemaVersion!==TASK2_VERSION||artifact?.questionId!==q.questionId||artifact?.sourceFingerprint!==q.fingerprint||artifact?.promptVersion!==TASK2_PROMPT_VERSION||!byRule&&artifact?.generation?.requestedModel!==model)throw new AlgorithmError('SOURCE_STALE','审题结果与题目、模型或提示词版本不匹配。');
  validateTask2Analysis(artifact.analysis,q);
  if(byRule){const expected=parseExplicitTask2Question(q);if(!expected||artifact.policyVersion!==expected.policyVersion||JSON.stringify(artifact.analysis)!==JSON.stringify(expected.analysis))throw new AlgorithmError('SOURCE_STALE','确定性审题结果与原始设问不一致。');}
  if(artifact.analysisId!==sha256(JSON.stringify([q.fingerprint,byRule?TASK2_QUESTION_POLICY_VERSION:model,TASK2_PROMPT_VERSION,artifact.analysis])))throw new AlgorithmError('SOURCE_STALE','审题内容发生变化，需要重新分析。');
}
export function buildTask2Report(input,q,artifact,data,generation,trustedAttempt={role:'unverified',recordId:null}){
  const anchors=checkInput(input,q,trustedAttempt);
  const repaired=repairTask2Feedback(data,{input,analysis:artifact.analysis,anchors});
  const finalized=finalizeTask2Feedback(input,repaired.feedback,anchors);data=finalized.feedback;
  validateTask2Evaluation(data,{input,analysis:artifact.analysis,anchors});
  const criteria=Object.fromEntries(TASK2_CRITERIA.map(k=>[k,data.scores[k].band]));
  const unroundedMean=data.assessmentMode==='full'?Object.values(criteria).reduce((a,b)=>a+b,0)/4:null;
  const displayBand=unroundedMean===null?null:Math.round(unroundedMean*2)/2;
  const map=new Map(data.sentences.map(s=>[s.id,s]));const textHash=sha256(input.text);
  const scoreRecord=assertSchema(task2ScoreRecordSchema,{schemaVersion:'writing-score-source-v1',task:'task2',questionId:q.questionId,submissionId:input.submissionId,textHash,sourceFingerprint:q.fingerprint,criteria,unroundedMean,displayBand,draftRole:trustedAttempt.role,trustedRecordId:trustedAttempt.recordId??null,firstDraftCandidate:trustedAttempt.role==='first'&&unroundedMean!==null,sourceOfDraftRole:'caller_must_resolve_from_persisted_submission',sourceOrigin:artifact.analysisMethod??'model',referenceReviewKind:null,sourceHumanVerified:false,calibrationStatus:'not_calibrated_against_examiner_scores',promptVersion:TASK2_PROMPT_VERSION,rubricVersion:TASK2_RUBRIC,assessedAt:generation.generatedAt});
  return {schemaVersion:TASK2_VERSION,task:'task2',questionId:q.questionId,submissionId:input.submissionId,textHash,wordCount:countWords(input.text),underlength:countWords(input.text)<250,
    source:artifact,feedback:{...data,sentences:anchors.map(s=>({...s,...map.get(s.id)}))},assessment:{criteria,unroundedMean,displayBand,scope:'single_task_practice_estimate',criterionWeights:[.25,.25,.25,.25],officialResult:false,statisticallyCalibrated:false,displayRounding:'nearest_half_band_product_display',rubricVersion:TASK2_RUBRIC},scoreRecord,
    featureSignals:{questionType:artifact.analysis.questionType,topicHint:q.topicHint??null,coverage:data.taskCoverage.map(r=>({requirementId:r.requirementId,status:r.status})),stance:data.stance.status,editCounts:Object.fromEntries(['grammar','precision','logic','redundancy'].map(type=>[type,data.sentences.filter(s=>s.editType===type).length]))},revisionBudget:task2Budget(input),revisionComparison:compareTask2Drafts(input),completionPolicy:finalized.policy,deliveryPolicy:{...repaired.policy,modelEssayStatus:data.modelEssay.kind==='upgraded'?'available':'unavailable'},generation};
}
async function evaluateTask2Candidate(input,q,artifact,options={}){
  const anchors=checkInput(input,q,options.trustedAttempt);const config=getConfig(options.env??process.env);checkArtifact(artifact,q,config.model);
  return requestJson({config,messages:buildTask2Messages(input,q,artifact),maxTokens:16000,validate:data=>{repairTask2Feedback(data,{input,analysis:artifact.analysis,anchors});return data;},fetcher:options.fetcher??fetch,signal:options.signal});
}
export async function evaluateTask2(input,q,artifact,options={}){
  const r=await evaluateTask2Candidate(input,q,artifact,options);
  return buildTask2Report(input,q,artifact,r.data,r.generation,options.trustedAttempt);
}
function reanchorFeedback(feedback,fromAnchors,toAnchors){
  const ids=new Map(fromAnchors.map((s,i)=>[s.id,toAnchors[i].id]));
  const list=values=>values.map(id=>{if(!ids.has(id))throw new AlgorithmError('CACHE_INVALID','缓存中的证据锚点不匹配。');return ids.get(id);});
  const data=structuredClone(feedback);
  data.taskCoverage.forEach(r=>r.evidenceSentenceIds=list(r.evidenceSentenceIds));
  data.stance.evidenceSentenceIds=list(data.stance.evidenceSentenceIds);
  Object.values(data.scores).forEach(s=>s.evidenceSentenceIds=list(s.evidenceSentenceIds));
  data.sentences=data.sentences.map(({start,end,paragraph,index,text,...s})=>({...s,id:list([s.id])[0],contextSentenceIds:list(s.contextSentenceIds),redundantWithSentenceId:s.redundantWithSentenceId===null?null:list([s.redundantWithSentenceId])[0]}));
  data.review.remainingIssues.forEach(s=>s.sentenceId=list([s.sentenceId])[0]);
  data.nextPractice.evidenceSentenceIds=list(data.nextPractice.evidenceSentenceIds);
  return data;
}
export function createTask2Engine(options={}){
  const cache=new Map(),evaluations=new Map();
  const analyze=async(q,{refresh=false}={})=>{checkQuestion(q);const config=getConfig(options.env??process.env),key=[q.fingerprint,config.model,TASK2_PROMPT_VERSION].join(':');if(refresh)cache.delete(key);if(!cache.has(key)){if(cache.size>=256)cache.delete(cache.keys().next().value);const p=analyzeTask2Question(q,options);cache.set(key,p);p.catch(()=>{if(cache.get(key)===p)cache.delete(key);});}return structuredClone(await cache.get(key));};
  return {
    analyze,
    async evaluate(input,q,trustedAttempt){
      const anchors=checkInput(input,q,trustedAttempt),artifact=await analyze(q),config=getConfig(options.env??process.env);
      const fingerprint=sha256(JSON.stringify([q.fingerprint,artifact.analysisId,config.model,TASK2_PROMPT_VERSION,input.text,input.mode,task2Budget(input)]));
      const reused=evaluations.has(fingerprint),canonical={...input,submissionId:'model-draft'};
      if(!reused){
        if(evaluations.size>=128)evaluations.delete(evaluations.keys().next().value);
        // Store no prior draft, caller identity or caller scoreRecord in the shared memo.
        const promise=evaluateTask2Candidate(canonical,q,artifact,{...options,trustedAttempt:undefined}).then(r=>({feedback:r.data,generation:r.generation}));
        evaluations.set(fingerprint,promise);promise.catch(()=>{if(evaluations.get(fingerprint)===promise)evaluations.delete(fingerprint);});
      }
      const memo=await evaluations.get(fingerprint);
      const feedback=reanchorFeedback(memo.feedback,anchorSentences(input.text,'model-draft'),anchors);
      const report=buildTask2Report(input,q,artifact,feedback,memo.generation,trustedAttempt);
      return {...report,cache:{evaluationReused:reused,fingerprint,scope:'process_same_question_text_mode_budget_model'}};
    },
    clearSourceCache(){cache.clear();evaluations.clear();},
    clearEvaluationCache(){evaluations.clear();},
  };
}
export function applyTask2Suggestion({originalText,currentText,report,sentenceId,appliedIds=[]}){
  if(sha256(originalText)!==report.textHash||new Set(appliedIds).size!==appliedIds.length)throw new AlgorithmError('DRAFT_CONFLICT','原稿或已采用记录不一致。');
  const byId=new Map(report.feedback.sentences.map(s=>[s.id,s]));
  for(const s of byId.values())if(!Number.isSafeInteger(s.start)||!Number.isSafeInteger(s.end)||s.start<0||s.end<=s.start||originalText.slice(s.start,s.end)!==s.text)throw new AlgorithmError('DRAFT_CONFLICT','批注锚点与原稿不一致。');
  const chosen=byId.get(sentenceId),eligible=s=>s&&['replace','delete'].includes(s.action);
  if(!eligible(chosen)||appliedIds.includes(sentenceId)||!appliedIds.every(id=>eligible(byId.get(id))))throw new AlgorithmError('DRAFT_CONFLICT','本条不支持自动采用、已采用或记录无效。');
  const render=ids=>ids.map(id=>byId.get(id)).sort((a,b)=>b.start-a.start).reduce((text,s)=>text.slice(0,s.start)+s.suggestion+text.slice(s.end),originalText);
  if(render(appliedIds)!==currentText)throw new AlgorithmError('DRAFT_CONFLICT','草稿存在手动修改，不能自动覆盖。');
  return {text:render([...appliedIds,sentenceId]),appliedIds:[...appliedIds,sentenceId]};
}
