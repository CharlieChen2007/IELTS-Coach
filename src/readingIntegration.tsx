import {useEffect} from 'react'
import {useAuth} from './auth'
import {useApp} from './appContext'
import {campusRequest} from './campus/SocialApi'
import {repository} from './repository'
import {todayKey} from './logic'
import type {Report, Mistake} from './contract'

export type ReadingItem={questionId:string;number:number;type:string;stem:string;status:'correct'|'wrong'|'blank';response:string;answer:{value:string};explanation:{quote?:string;verdict?:string;trap?:string;paragraph?:string};detail?:string}
export type ReadingSession={id:string;passageId:string;passageTitle:string;startedAt:number;finishedAt:number;total:number;correct:number;results:ReadingItem[];paragraphs:string[];retakeOf:string|null;answers:Record<string,string>;isExample?:boolean}
const labels:Record<string,string>={TFNG:'判断题',YNNG:'观点判断',MCQ:'单项选择',SUMMARY_COMPLETION:'摘要填空',SENTENCE_COMPLETION:'句子填空',SHORT_ANSWER:'简答题',MATCHING_HEADINGS:'标题匹配',MATCHING_INFORMATION:'段落信息匹配'}
const reason=(item:ReadingItem)=>item.status==='blank'?'未作答':item.detail||'答案与原文依据不符'

export function saveReadingSession(userId:string,session:ReadingSession){
  if(!session||!/^s_[\w-]{1,100}$/.test(session.id)||!Array.isArray(session.results)||session.results.length!==session.total)return false
  const reportId='rpt_rd_'+session.id,attemptId='atm_rd_'+session.id
  if(repository.getReport(userId,reportId))return false
  const createdAt=new Date(session.finishedAt).toISOString(),exerciseId='reading_'+session.passageId
  const answers=Object.fromEntries(session.results.map(item=>[item.questionId,String(item.response||'')]))
  const retakeOf=session.retakeOf?'atm_rd_'+session.retakeOf:undefined
  const previous=repository.listReports(userId).filter(report=>report.exerciseId===exerciseId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))
  const report:Report={reportId,attemptId,userId,subject:'reading',mode:'passage',exerciseId,status:'ready',createdAt,retakeOf,
    original:{title:session.passageTitle,prompt:'阅读原文，回答篇章中的题目。',answers},
    score:{band:null,display:session.correct+' / '+session.total,correct:session.correct,total:session.total,firstTryCorrect:previous[0]?.score.correct??session.correct,trendMetric:'reading_correct'},
    dimensions:[],feedback:session.results.filter(item=>item.status!=='correct').map(item=>({id:item.questionId,type:'question',
      location:{label:'第 '+item.number+' 题',questionId:item.questionId},quote:item.explanation?.quote||item.stem,issue:reason(item),
      why:item.explanation?.verdict||'对照题干与原文，核对信息范围及同义替换。',suggestion:item.explanation?.trap||'先定位原文依据，再重新作答。',
      questionType:labels[item.type]||item.type,severity:'medium'})),highlights:session.correct?[session.correct+' 道题已答对，复练时保留正确的定位方式。']:[],recommendations:[],
    evidence:{submittedByUser:!session.isExample,showcaseRecord:session.isExample,demoRecord:session.isExample,paragraphs:session.paragraphs,readingSession:session,readingItems:session.results}}
  repository.saveReport(report)
  repository.saveAttempt({attemptId,reportId,userId,exerciseId,subject:'reading',mode:'passage',title:session.passageTitle,
    status:'ready',createdAt,submittedAt:createdAt,progress:100,answers,retakeOf})
  const date=todayKey(new Date(createdAt)),daily=repository.getDaily(userId,date),category=retakeOf?'retake':'newPractice'
  if(!daily[category].includes(attemptId))repository.saveDaily(userId,{...daily,[category]:[...daily[category],attemptId]})
  for(const item of session.results){
    const id='mis_rd_'+item.questionId,prior=repository.listMistakes(userId).find(m=>m.mistakeId===id)
    if(item.status==='correct'){
      if(prior)repository.saveMistake({...prior,reviewStatus:'reviewed'})
      continue
    }
    const mistake:Mistake={mistakeId:id,attemptId,reportId,userId,subject:'reading',createdAt,reviewStatus:'pending',questionType:labels[item.type]||item.type,
      excerpt:item.stem,why:reason(item)+' · '+(item.explanation?.verdict||''),suggestion:item.explanation?.trap||'回到原文找出依据，再判断选项。',locationLabel:'第 '+item.number+' 题'}
    repository.saveMistake(mistake)
  }
  return true
}

export function ReadingHistorySync(){
  const {user}=useAuth(),{version,refresh}=useApp()
  useEffect(()=>{
    if(!user)return
    let active=true,loading=false
    async function load(){
      if(!active||loading||document.hidden)return
      loading=true
      try{
        const data=await campusRequest<{items:ReadingSession[]}>(user!,'/api/reading/attempts')
        if(active){let changed=false;for(const item of [...data.items].reverse())changed=saveReadingSession(user!.userId,item)||changed;if(changed)refresh()}
      }catch{/* Locally saved reports remain available while the server reconnects. */}
      finally{loading=false}
    }
    void load();const timer=window.setInterval(load,12000);window.addEventListener('focus',load)
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',load)}
  },[user?.userId,version])
  return null
}
