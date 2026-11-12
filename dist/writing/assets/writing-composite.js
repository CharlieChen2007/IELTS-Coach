const keys=['coherenceCohesion','lexicalResource','grammaticalRangeAccuracy'];
function values(scores,taskKey){
  const criteria={taskFulfilment:scores?.[taskKey]?.band};
  for(const key of keys)criteria[key]=scores?.[key]?.band;
  return Object.values(criteria).every(value=>typeof value==='number' && value>=0 && value<=9)?criteria:null;
}
export function writingComposite(input){
  const submitted=(input.entries || []).filter(entry=>entry.status==='done' && !entry.isExample);
  const charts=Object.values(input.task1Reports || {}).filter(report=>!report.isExample);
  const first=submitted.filter(entry=>!entry.parentId && entry.report?.source==='ai' && entry.report.ai?.assessmentMode==='full')
    .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).map(entry=>values(entry.report.ai.scores,'taskResponse')).find(Boolean);
  const chart=charts.filter(report=>report.sourceKind!=='rule' && report.feedback?.assessmentMode==='full' && report.scoreRecord?.draftRole!=='revision')
    .sort((a,b)=>Date.parse(b.createdAt || b.source?.generation?.generatedAt || 0)-Date.parse(a.createdAt || a.source?.generation?.generatedAt || 0))
    .map(report=>values(report.feedback.scores,'taskAchievement')).find(Boolean);
  if(first && chart){
    const criteria=Object.fromEntries(Object.keys(first).map(key=>[key,(chart[key]+2*first[key])/3]));
    const mean=Object.values(criteria).reduce((sum,value)=>sum+value,0)/4;
    return {status:'ready',gaps:[],excluded:[],result:{writing:{criteria,unroundedMean:mean,displayBand:Math.round(mean*2)/2}}};
  }
  return {status:'incomplete',gaps:[],excluded:[],title:'已完成 Task 1 '+charts.length+' 篇 · Task 2 '+submitted.length+' 篇',
    message:first||chart?'已获得一项真实 AI 评估。两项都具备完整四维评分后，才显示加权练习估分。':'先查看已完成的逐句反馈并修改一段。两项真实 AI 报告齐全后，可按 Task 1 : Task 2 = 1 : 2 汇总练习估分。'};
}
