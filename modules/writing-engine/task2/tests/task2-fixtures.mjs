import {task2Cases} from '../examples/task2-live-cases.mjs';
import {task2Fingerprint} from '../src/task2-bank.mjs';
import {anchorSentences} from '../src/text.mjs';
import {TASK2_CRITERIA} from '../src/task2-contracts.mjs';
export const task2Input=()=>({questionId:'T2-026',submissionId:'fixture-task2',text:task2Cases[0].text,mode:'essay'});
export function task2Question(){const q={task:'task2',questionId:'T2-026',prompt:'Some people believe that university education should focus on the skills of employment for the future. Others think they should focus on academic study only. Discuss both views and give your own opinion.'};return {...q,fingerprint:task2Fingerprint(q)};}
export const task2Analysis=()=>({promptQuality:'clear',questionType:'discussion',stanceRequired:true,requirements:[{id:'r1',kind:'view_a',description:'讨论就业技能',promptQuote:'Some people believe that university education should focus on the skills of employment for the future.'},{id:'r2',kind:'view_b',description:'讨论纯学术教育',promptQuote:'Others think they should focus on academic study only.'},{id:'r3',kind:'position',description:'给出自己的意见',promptQuote:'Discuss both views and give your own opinion.'}],cautions:[]});
export function task2Feedback(input=task2Input()){
  const anchors=anchorSentences(input.text,input.submissionId),s=anchors[1].id;
  return {assessmentMode:'full',assessmentNote:'合成测试反馈，非真实成绩',taskCoverage:['r1','r2','r3'].map(requirementId=>({requirementId,status:'covered',reason:'覆盖测试要求',evidenceSentenceIds:[s]})),stance:{status:'clear',summary:'支持结合二者',evidenceSentenceIds:[s]},scores:Object.fromEntries(TASK2_CRITERIA.map(k=>[k,{band:7,reason:'测试估分',evidenceSentenceIds:[s],nextStep:'换题迁移'}])),sentences:anchors.map(s=>({id:s.id,status:'keep',editType:'none',action:'keep',reason:'表达可保留',suggestion:s.text,contextSentenceIds:[],redundantWithSentenceId:null})),review:{decision:'ready',summary:'已完成',remainingIssues:[]},modelEssay:{kind:'upgraded',text:input.text,preservesStance:true,note:'合成测试结果',upgrades:[]},nextPractice:{skill:'transfer',instruction:'换题练习',successCriteria:['答全实际设问'],evidenceSentenceIds:[s]}};
}
