import type { Practice, Report, Subject } from '../contract'
import type { AuthUser } from '../auth'
import { campusRequest } from './SocialApi'
import { findPractice } from '../seed'
import { showcaseClip } from '../showcase'
import type {ReadingItem} from '../readingIntegration'

export type EvidenceProps = { report?: Report; practice?: Practice; answers?: Record<string,string>; writingText?: string }
export interface Entry { key:string; label:string; prompt:string; answer:string; issues?:string[] }
export interface Evidence { sourceId:string; subject:Subject; title:string; entries:Entry[]; issues:string[]; report?:Report }
export const focusAreas:Record<Subject,string[]> = {
 speaking:['发音与重音','回答展开','语法和用词'],writing:['论点展开','句子结构','词汇选择'],
 listening:['音变与连读','同义替换','定位信息'],reading:['证据定位','判断依据','同义替换']
}
export function evidence({report,practice,answers,writingText}:EvidenceProps):Evidence|null {
 const item=practice || (report && findPractice(report.exerciseId))
 if(!item&&!report)return null
 const subject=report?.subject||item!.subject, title=report?.original.title||item!.title
 const prompt=report?.original.prompt||item?.prompt||title
 const actual=answers||report?.original.answers||{}
 let entries:Entry[]=[]
 if(subject==='speaking'&&report){
   const pair=report.evidence.pairReviews
   if(pair?.length) entries=pair.filter(r=>r.role==='candidate').map(r=>({key:String(r.round),label:'我作答的第 '+r.round+' 轮',prompt:r.question,answer:''}))
   else for(const t of report.evidence.turns||[]){
     if(t.role==='examiner')entries.push({key:String(entries.length),label:'第 '+(entries.length+1)+' 轮',prompt:t.text,answer:''})
     else if(entries.length && !entries.at(-1)!.answer)entries.at(-1)!.answer=t.text
   }
 }else if(subject==='speaking' && item?.material){
   const {part1=[],part2,part3=[]}=item.material
   const questions=[
     ...part1.map((question,i)=>({label:'Part 1 · 第 '+(i+1)+' 题',question})),
     ...(part2?[{label:'Part 2 · 题卡',question:[part2.topic,...part2.cueCard].join('\n')}]:[]),
     ...part3.map((question,i)=>({label:'Part 3 · 第 '+(i+1)+' 题',question})),
   ]
   entries=questions.map(({label,question},i)=>({key:String(i),label,prompt:question,answer:''}))
 }else if(subject==='listening' && report?.evidence.listeningItems){
   entries=report.evidence.listeningItems.map(item=>({
     key:item.id,label:'第 '+item.number+' 题 · '+item.questionType,
     prompt:[item.prompt,...item.options,item.quote?'原声依据：'+item.quote:''].filter(Boolean).join('\n'),
     answer:item.answer,issues:item.status==='correct'?[]:[item.reason],
   }))
 }else if(subject==='reading'&&Array.isArray(report?.evidence.readingItems)){
   entries=(report!.evidence.readingItems as ReadingItem[]).map(item=>({key:item.questionId,label:'第 '+item.number+' 题',
     prompt:item.stem+'\n\n阅读材料\n'+(report!.evidence.paragraphs||[]).join('\n\n'),answer:item.response||'',
     issues:item.status==='correct'?[]:[item.status==='blank'?'未作答':item.explanation?.trap||'证据定位']}))
 }else if(subject==='listening'||subject==='reading'){
   const material = subject==='reading' ? (item?.material?.paragraphs?.join('\n')||item?.material?.passage||'') : item?.material?.transcript||''
   entries=(item?.questions||[]).map((q,i)=>({key:q.id,label:'第 '+(i+1)+' 题',prompt:q.text+(q.options?.length?'\n'+q.options.join(' / '):'')+(material?'\n\n'+(subject==='reading'?'阅读材料':'听力转写')+'\n'+material:''),answer:actual[q.id]||''}))
 }
 if(!entries.length)entries=[{key:'all',label:'本次作答',prompt,answer:writingText??report?.original.submittedText??Object.values(actual).join('\n')}]
 if(report?.subject==='speaking'){
   entries.forEach((entry,index)=>{
     const round=report.mode==='pair'?Number(entry.key):index+1
     const scores=(report.evidence.speechScores||[]).filter(score=>score.state==='ready'&&Number(score.label.match(/第\s*(\d+)/)?.[1])===round)
     const words=scores.flatMap(score=>score.words||[]).filter(w=>Number.isFinite(w.accuracy)&&w.accuracy<80).sort((a,b)=>a.accuracy-b.accuracy)
     entry.issues=[...new Set(words.map(w=>'发音 · '+w.word))].slice(0,5)
   })
 }
 const problems=[...(report?.feedback||[]).map(f=>f.issue),...(report?.evidence.pairReviews||[]).filter(v=>v.role==='candidate').map(v=>v.feedback.improve),...focusAreas[subject]]
 return {sourceId:report?.reportId||item!.exerciseId,subject,title,entries,issues:[...new Set(problems.filter(Boolean).map(x=>x.slice(0,180)))].slice(0,8),report}
}
function openExisting(name:string):Promise<IDBDatabase|null>{
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open(name)
  r.onupgradeneeded=()=>r.transaction?.abort()
  r.onerror=()=>r.error?.name==='AbortError'?resolve(null):reject(r.error)
  r.onsuccess=()=>resolve(r.result)
 })
}
async function get(db:IDBDatabase,store:string,key:IDBValidKey):Promise<any>{
 if(!db.objectStoreNames.contains(store))return null
 return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
}
export async function sourceClip(user:AuthUser,e:Evidence,entry:Entry):Promise<Blob|null>{
 const report=e.report;if(!report||e.subject!=='speaking')return null
 const sample = report.userId===user.userId && showcaseClip(report,entry.key)
 if(sample){
   const response=await fetch(sample)
   if (!response.ok) throw Error('示例作答录音暂时无法载入，请重试。')
   return response.blob()
 }
 const owner='host:'+encodeURIComponent(user.userId)
 if(report.mode==='pair'){
  const code=report.reportId.replace(/^rpt_sp_pair_/,'')
  const res=await fetch('/api/campus/pair/audio?code='+encodeURIComponent(code)+'&round='+entry.key,{headers:{'X-Speaking-Scope':encodeURIComponent(user.userId)}})
  return res.ok?res.blob():null
 }
 const [type,sid]=String(report.evidence.speakingView||'').split('/')
 if(!sid||!['exam','dialogue'].includes(type))return null
 const db=await openExisting(type==='exam'?'ielts-speaking-a-account-v1:'+owner:'speaking-practice-v1-'+encodeURIComponent(owner))
 if(!db)return null
 try{
   if(type==='dialogue')return await get(db,'audio',sid+':'+entry.key+':latest')
   const row=await get(db,'sessions',sid),turn=row?.turns[Number(entry.key)||0]
   return turn?(await get(db,'audio',[sid,turn.questionId]))?.blob||null:null
 }finally{db.close()}
}
export type Summary = { id:string;subject:Subject;title:string;sourceId:string;issues:string[];note:string;private:boolean;mine:boolean;helper:boolean;mentor:boolean;visitState?:string|null;ownerName:string;helperName:string|null;claimed:boolean;replied:boolean;revised:boolean;resolved:boolean;created:number;updated:number }
export type Detail=Summary&{prompt:string;original:string|null;hasAudio:boolean;reply:string|null;after:{text:string;hasAudio:boolean;at:number}|null;visit:{id:string;mentorName:string;start:number;state:string;issues:string[];advice:string|null;focus:string;place:string|null}|null}
export type Slot={id:string;subject:Subject;focus:string;mentorName:string;start:number;mine:boolean;caseId:string|null;state:string|null}
export function api<T>(user:AuthUser,path:string,body?:unknown):Promise<T>{
 return campusRequest(user,'/api/clinic/'+path,body) as Promise<T>
}
export async function sendWithClip(user:AuthUser,path:string,data:unknown,blob:Blob|null) {
 if(!blob)return api<{id?:string}>(user,path,data)
 if(blob.size>4*1024*1024)throw new Error('该录音超过 4 MB，请选择一段较短的录音。')
 await api(user,'slots')
 const form=new FormData();form.set('data',JSON.stringify(data));form.set('audio',blob,'answer')
 const response=await fetch('/api/clinic/'+path,{method:'POST',headers:{'X-Speaking-Scope':encodeURIComponent(user.userId)},body:form})
 const result=await response.json();if(!response.ok)throw Error(result.error||'提交失败');return result as {id?:string}
}
export const localTime=(timestamp:number)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(timestamp)
export function status(row:Summary){return row.resolved?'已解决':row.revised?'已复练':row.visitState==='booked'?'已预约':row.replied||row.visitState==='consulted'?'待复练':row.claimed?'已认领':row.private?'诊所记录':'待认领'}

