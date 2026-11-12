import {anchorSentences,countWords} from './text.mjs';

export function task2Budget(input) {
  const initialWords=countWords(input.revisionContext?.initialText??input.text),currentWords=countWords(input.text);
  const language=input.mode==='language',allowance=Math.min(language?8:30,Math.ceil(initialWords*.1));
  const ceiling=Math.max(language?0:280,initialWords+allowance);
  return {initialWords,currentWords,ceiling,positiveGrowthBudget:Math.min(language?8:30,Math.max(0,ceiling-currentWords)),grammarGrowthLimit:4,otherGrowthLimit:12,maxNonGrammarEdits:3,modelMinWords:250,modelWordLimit:Math.max(320,Math.min(350,initialWords+30))};
}

export const TASK2_COMPLETION_POLICY_VERSION='ready-stop-v1';
/** Apply only after full validation. This does not change scores or hide outstanding edits. */
export function finalizeTask2Feedback(input,feedback,anchors) {
  const result=structuredClone(feedback);
  const policy={version:TASK2_COMPLETION_POLICY_VERSION,applied:false,retainedOriginalAsModel:false,transferTaskAssigned:false};
  if(result.review.decision!=='ready')return {feedback:result,policy};
  policy.applied=true;
  if(countWords(input.text)<=task2Budget(input).modelWordLimit&&input.text.split(/\r?\n\s*\r?\n/).filter(s=>s.trim()).length>=2){
    result.modelEssay={kind:'upgraded',text:input.text,preservesStance:true,note:'本稿已满足本次收尾条件，参考版本保留当前原文，不再为升级而扩写。',upgrades:[]};
    policy.retainedOriginalAsModel=true;
  }else if(result.modelEssay.kind==='upgraded'){
    result.modelEssay.note='本稿已满足收尾条件。以下仅为字数较短的参考版本，不要求替换当前原稿或再次润色。';
    result.modelEssay.upgrades=[];
  }else{
    result.modelEssay.note='本稿已满足收尾条件；本次较短参考版本暂不可用，无需为此继续扩写或重批当前原稿。';
  }
  result.nextPractice={skill:'transfer',instruction:'选一道相同设问类型、不同主题的新题，用40分钟完成首稿。先列出实际设问，再迁移本篇已掌握的组织与论证方法；无需继续扩写当前稿。',successCriteria:['回应新题的全部实际设问','用与新题相关的理由展开观点，不套用本篇论据','完成后检查语言准确性，不以篇幅增长代替改进'],evidenceSentenceIds:result.stance.evidenceSentenceIds.length?[result.stance.evidenceSentenceIds[0]]:[anchors[0].id]};
  policy.transferTaskAssigned=true;
  return {feedback:result,policy};
}

/** Exact sentence LCS. Text changes do not imply semantic or scoring improvement. */
export function compareTask2Drafts(input) {
  const after=anchorSentences(input.text,input.submissionId);
  if(!input.revisionContext) return {available:false,previousWords:null,currentWords:countWords(input.text),wordDelta:null,unchangedSentences:null,removed:[],added:[],qualityImprovementInferred:false};
  const before=anchorSentences(input.revisionContext.previousText,'previous');
  const grid=Array.from({length:before.length+1},()=>new Uint16Array(after.length+1));
  for(let i=before.length-1;i>=0;i--)for(let j=after.length-1;j>=0;j--)grid[i][j]=before[i].text===after[j].text?1+grid[i+1][j+1]:Math.max(grid[i+1][j],grid[i][j+1]);
  let i=0,j=0;const oldKept=new Set(),newKept=new Set();
  while(i<before.length&&j<after.length){if(before[i].text===after[j].text){oldKept.add(i++);newKept.add(j++);}else if(grid[i+1][j]>=grid[i][j+1])i++;else j++;}
  const previousWords=countWords(input.revisionContext.previousText),currentWords=countWords(input.text);
  return {available:true,previousWords,currentWords,wordDelta:currentWords-previousWords,unchangedSentences:oldKept.size,removed:before.filter((_,k)=>!oldKept.has(k)),added:after.filter((_,k)=>!newKept.has(k)),qualityImprovementInferred:false};
}
