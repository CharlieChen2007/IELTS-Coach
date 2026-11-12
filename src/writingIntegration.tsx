import { useEffect } from 'react'
import { useAuth } from './auth'
import { useApp } from './appContext'
import { repository } from './repository'
import { todayKey } from './logic'
import { campusRequest } from './campus/SocialApi'
import type { Report } from './contract'

interface Sentence {
  id: string; text: string; start: number; end: number; paragraph: number; index: number
  status: 'fix'|'improve'|'keep'; reason?: string; suggestion: string; change?: string; issueType?: string
}
interface Criterion { band: number|null; reason: string }
interface Submission {
  id: string; task: 'task1'|'task2'; topicId: string; text: string; createdAt: string; status: string
  isExample: boolean; parentId?: string; version: number
  topic: {prompt: string; label?: string; type?: string; image?: string}
  report: {
    source?: string; sourceKind?: string; model?: string; count?: number; sentences?: Sentence[]
    feedback?: {assessmentMode: string; sentences: Sentence[]; scores: Record<string,Criterion>; modelAnswer?: {text: string}}
    ai?: {assessmentMode: string; scores: Record<string,Criterion>}
    assessment?: {displayBand: number|null}
  }
}
const criterionNames: Record<string,string> = {taskResponse:'任务回应',taskAchievement:'任务完成',coherenceCohesion:'连贯与衔接',lexicalResource:'词汇表达',grammaticalRangeAccuracy:'语法多样性与准确性'}

export function importWritingSubmission(userId: string, submission: Submission) {
  if (submission.isExample || submission.status !== 'done' || !submission.text?.trim() || !/^[\w.:-]{1,160}$/.test(submission.id)) return false
  const reportId = 'rpt_wr_' + submission.id, attemptId = 'atm_wr_' + submission.id
  if (repository.getReport(userId, reportId)) return false
  const snapshot = submission.report
  if (!snapshot) return false
  const createdAt = new Date(submission.createdAt).toISOString()
  const sentences = snapshot.sentences || snapshot.feedback?.sentences || []
  const semantic = snapshot.source === 'ai' || submission.task === 'task1' && snapshot.sourceKind !== 'rule'
  const criteria = snapshot.ai?.scores || snapshot.feedback?.scores || {}
  const values = Object.values(criteria).map(c => c.band)
  const band = semantic && values.length === 4 && values.every((value): value is number => typeof value === 'number' && value >= 0 && value <= 9)
    ? Math.round(values.reduce((a,b)=>a+b,0)/4*2)/2 : null
  const title = (submission.task === 'task1' ? 'Task 1 · ' : 'Task 2 · ') + (submission.topic?.label || submission.topic?.type || submission.topicId)
  const report: Report = {
    reportId, attemptId, userId, subject:'writing', mode:'task2', exerciseId:'writing_' + submission.topicId,
    status:'ready', createdAt,
    score:{band,display:band===null?'基础反馈':band.toFixed(1),trendMetric:'writing_band',correct:null,total:null,firstTryCorrect:null},
    dimensions:semantic ? Object.entries(criteria).filter(([,c])=>typeof c.band==='number').map(([key,c])=>({key,label:criterionNames[key] || key,score:c.band!,comment:c.reason})) : [],
    feedback:sentences.filter(s=>s.status!=='keep' && submission.text.slice(s.start,s.end)===s.text).map(s=>({
      id:'fb_wr_' + submission.id + '_' + s.id,type:'sentence',location:{label:'第 '+s.paragraph+' 段第 '+s.index+' 句',paragraph:s.paragraph,sentenceIndex:s.index,startUtf16:s.start,endUtf16:s.end},
      quote:s.text,issue:s.change || s.reason || '检查表达',why:s.reason || '对照原文核对表达。',suggestion:s.suggestion,
      revised:s.suggestion!==s.text?s.suggestion:undefined,questionType:s.issueType || '表达与语法',severity:s.status==='fix'?'high':'medium',
    })),
    highlights:[],recommendations:[],
    evidence:{submittedByUser:true,writingSubmission:submission.id,writingTask:submission.task,writingTopic:submission.topicId,
      sourceLabel:semantic?'AI 精修':'基础规则反馈',feedbackSource:semantic?'real':'rule',
      wordCount:submission.text.split(/\s+/).filter(Boolean).length,upgradedEssay:semantic?(snapshot.model || snapshot.feedback?.modelAnswer?.text):undefined},
    original:{title,prompt:submission.topic?.prompt || '',answers:{},submittedText:submission.text},
    retakeOf:submission.parentId?'atm_wr_' + submission.parentId:undefined,
  }
  repository.saveReport(report)
  repository.saveAttempt({attemptId,userId,exerciseId:report.exerciseId,subject:'writing',mode:'task2',title,status:'ready',createdAt,submittedAt:createdAt,answers:{},draftText:submission.text,reportId,progress:100,retakeOf:report.retakeOf})
  const daily = repository.getDaily(userId,todayKey(new Date(createdAt)))
  const category = submission.parentId ? 'retake' : 'newPractice'
  if(!daily[category].includes(attemptId)) repository.saveDaily(userId,{...daily,[category]:[...daily[category],attemptId]})
  return true
}

export async function syncWritingHistory(user: {userId:string;nickname:string}) {
  await campusRequest(user,'/api/social/me')
  const response=await fetch('/api/writing/submissions',{headers:{'X-Speaking-Scope':encodeURIComponent(user.userId)},credentials:'same-origin',cache:'no-store'})
  if(!response.ok)throw Error('写作记录同步失败，请稍后重试。')
  const data=await response.json()
  if(!Array.isArray(data.submissions))return false
  let changed=false
  for(const submission of data.submissions)changed=importWritingSubmission(user.userId,submission)||changed
  return changed
}

export function WritingHistorySync() {
  const {user}=useAuth(),{refresh}=useApp()
  useEffect(()=>{
    if(!user)return
    let active=true, loading=false
    async function load() {
      if(loading||document.hidden)return
      loading=true
      try {
        await campusRequest(user!,'/api/social/me')
        const response=await fetch('/api/writing/submissions',{headers:{'X-Speaking-Scope':encodeURIComponent(user!.userId)},credentials:'same-origin',cache:'no-store'})
        if(!response.ok)return
        const data=await response.json()
        if(!active || !Array.isArray(data.submissions))return
        let changed=false
        for(const submission of data.submissions)changed=importWritingSubmission(user!.userId,submission)||changed
        if(changed)refresh()
      } finally {loading=false}
    }
    const update=()=>{void load().catch(()=>{})}
    update()
    window.addEventListener('ielts:writing-saved',update)
    window.addEventListener('focus',update)
    const timer=window.setInterval(update,20000)
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',update);window.removeEventListener('ielts:writing-saved',update)}
  },[user?.userId,refresh])
  return null
}
