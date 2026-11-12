import {readFile} from 'node:fs/promises';
import {sha256} from './text.mjs';
import {AlgorithmError} from './errors.mjs';

export const task2Fingerprint = question => sha256(JSON.stringify([question.questionId,question.prompt]));
const normalize = text => text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function parseTask2Markdown(markdown) {
  const records=[]; const seen=new Set();
  for(const line of markdown.replace(/^\uFEFF/,'').split(/\r?\n/)) {
    if(!/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells=line.trim().slice(1,-1).split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,'|'));
    if(cells.length!==11) throw new AlgorithmError('BANK_INVALID','Task 2题库表格应为11列。');
    const [no,year,date,weekday,type,questionStyle,topic,subtopic,prompt,repeatNote,source]=cells;
    const questionId=`T2-${String(Number(no)).padStart(3,'0')}`;
    if(!/^T2-\d{3}$/.test(questionId)||Number(no)<1||seen.has(questionId)||!/^20\d{2}-\d{2}-\d{2}$/.test(date)||Number(year)!==Number(date.slice(0,4))||prompt.length<30||prompt.length>10000) throw new AlgorithmError('BANK_INVALID','Task 2题号、日期或题干异常。');
    seen.add(questionId);
    const q={questionId,task:'task2',sourceNumber:Number(no),year:Number(year),date,weekday,sourceTypeHint:type,sourceQuestionStyleHint:questionStyle,topicHint:topic,subtopicHint:subtopic,prompt,repeatNote,source,provenance:'user_supplied_recalled_collection',examAuthenticityVerified:false,metadataVerifiedAgainstPrompt:false};
    records.push({...q,fingerprint:task2Fingerprint(q),normalizedPromptHash:sha256(normalize(prompt))});
  }
  if(!records.length) throw new AlgorithmError('BANK_INVALID','未找到Task 2题目行。');
  return records;
}
export async function loadTask2Catalog(file) {return parseTask2Markdown(await readFile(file,'utf8'));}
export function getTask2Question(catalog,questionId) {
  const q=catalog.find(item=>item.questionId===questionId);
  if(!q) throw new AlgorithmError('UNKNOWN_QUESTION','Task 2题号不存在。');
  return structuredClone(q);
}
export function auditTask2Catalog(catalog) {
  const groups=field=>{const map=new Map();for(const q of catalog)map.set(q[field],[...(map.get(q[field])??[]),q.questionId]);return [...map.values()].filter(g=>g.length>1);};
  return {schemaVersion:'task2-catalog-v1',count:catalog.length,sourceDates:new Set(catalog.map(q=>q.date)).size,duplicateDateGroups:groups('date'),identicalPromptGroups:groups('normalizedPromptHash'),semanticLabelsVerified:false,items:catalog};
}
