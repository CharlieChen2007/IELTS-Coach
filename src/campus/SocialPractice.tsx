import {useEffect,useRef,useState} from 'react'
import {useApp} from '../appContext'
import {useAuth} from '../auth'
import type {Report} from '../contract'
import type {ReadingItem} from '../readingIntegration'
import {findPractice} from '../seed'
import {repository} from '../repository'
import {campusRequest, skillNames, type SchoolProfile} from './SocialApi'
import './Social.css'

const names={listening:'听力纠错',reading:'阅读定位',writing:'作文修改',speaking:'口语复练'}
interface Completion {selection:string;before:string;after:string;reason:string}
const normal=(s:string)=>(s||'').toLowerCase().replace(/[^\p{L}\d]+/gu,' ').trim().replace(/^45$/,'forty five')
function practiceQuestions(report:Report){
  if(report.subject==='reading'&&Array.isArray(report.evidence.readingItems))return (report.evidence.readingItems as ReadingItem[]).map(item=>({id:item.questionId,text:'第 '+item.number+' 题 · '+item.stem}))
  return report.evidence.listeningItems?.filter(item=>item.status!=='correct').map(item=>({
    id:item.id,text:'第 '+item.number+' 题 · '+item.prompt
  })) ?? findPractice(report.exerciseId)?.questions.filter(q=>q.answer&&(
    report.subject==='reading'||normal(report.original.answers[q.id])!==normal(q.answer))) ?? []
}
export function hasCampusPractice(report:Report){
  if(report.evidence.demoRecord||report.status!=='ready')return false
  if(report.subject==='speaking')return true
  if(report.subject==='writing')return !!report.original.submittedText?.trim()
  return practiceQuestions(report).length>0
}
export function SocialPractice({report}:{report:Report}){
  return <PracticeForm key={report.userId+':'+report.reportId} report={report}/>
}
function PracticeForm({report}:{report:Report}){
  const {user}=useAuth(),{go,route}=useApp(), [member,setMember]=useState<boolean|null>(null)
  const details=useRef<HTMLDetailsElement>(null),receipt=useRef<HTMLDivElement>(null),focusReceipt=useRef(false),lock=useRef(false)
  const {subject,reportId,exerciseId}=report
  const questions=practiceQuestions(report)
  const passages=report.evidence.paragraphs||findPractice(exerciseId)?.material?.paragraphs||[]
  const originals=(report.original.submittedText||'').split(/\n+/).map(t=>t.trim()).filter(Boolean)
  const [qId,setQId]=useState(questions[0]?.id||''),[index,setIndex]=useState(0)
  const [after,setAfter]=useState(''),[reason,setReason]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false)
  const [done,setDone]=useState<Completion[]|null>(null),[loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0)
  const original=subject==='writing'?(originals[index]||''):(report.original.answers[qId]||'')
  const originalReport=report.retakeOf&&user?repository.getAttempt(user.userId,report.retakeOf)?.reportId:undefined
  const session=report.attemptId.startsWith('atm_sp_exam_')?report.attemptId.slice('atm_sp_exam_'.length):''
  const canClaim=!!originalReport&&!!session
  const sourceId=(canClaim?originalReport:reportId)!
  const selection=subject==='speaking'||subject==='writing'?subject:qId
  const completed=done?.find(row=>row.selection===selection)
  const eligible=subject==='speaking'||(subject==='writing'?!!originals.length:questions.length>0)
  useEffect(()=>{let live=true;if(!user||report.userId!==user.userId||report.evidence.demoRecord||report.status!=='ready'||!eligible)return
    setLoadError('');setDone(null)
    async function load(){
      const {profile}=await campusRequest<{profile:SchoolProfile|null}>(user!,'/api/social/me')
      if(!live)return
      setMember(!!profile)
      if(!profile)return
      const params=new URLSearchParams({subject,sourceId,exerciseId})
      const state=await campusRequest<{completed:Completion[]}>(user!,'/api/social/practice-state?'+params)
      if(live)setDone(state.completed)
    }
    void load().catch(e=>{if(live)setLoadError((e as Error).message)})
    return()=>{live=false}
  },[user?.userId,subject,sourceId,exerciseId,eligible,report.status,retry])
  const ready=member!==null||!!loadError
  useEffect(()=>{
    if(ready&&route.query.view==='campus-task'&&details.current){
      details.current.open=true
      details.current.querySelector('summary')?.focus({preventScroll:true})
      details.current.scrollIntoView({block:'start'})
    }
  },[ready,route.query.view])
  useEffect(()=>{
    if(completed&&focusReceipt.current){focusReceipt.current=false;receipt.current?.focus({preventScroll:true})}
  },[completed])
  async function submit(){
    if(!user||lock.current||!done||completed)return
    lock.current=true;setBusy(true);setNote('')
    try{
      if(subject==='speaking'&&!canClaim){
        await campusRequest(user,'/api/social/practice',{subject,sourceId:reportId,action:'start'})
        go('subject/speaking?view=quick&retakeOf='+encodeURIComponent(report.attemptId))
        return
      }
      const {evidence}=await campusRequest<{evidence:Omit<Completion,'selection'>}>(user,'/api/social/practice',{subject,sourceId,exerciseId,questionId:qId,
        sessionId:session,before:original.slice(0,10000),after,reason})
      focusReceipt.current=true
      setDone(previous=>[...(previous||[]).filter(row=>row.selection!==selection),{...evidence,selection}])
    }catch(e){setNote((e as Error).message)}finally{lock.current=false;setBusy(false)}
  }
  if(!user||user.userId!==report.userId||report.evidence.demoRecord||report.status!=='ready')return null
  if(!eligible||!ready)return null
  function resetFields(){setAfter('');setReason('');setNote('')}
  return <details className="card social-practice" ref={details}><summary><b>{names[subject]}</b><span className="chip primary">校园周挑战 · 5 分</span></summary>
    {loadError?<p role="alert">{loadError} <button className="btn btn-sm" onClick={()=>setRetry(n=>n+1)}>重新加载</button></p>:
      !member?<p>加入深圳大学校园后，这份报告的复练可以计入校园积分。 <button className="btn btn-sm" onClick={()=>go('profile/campus')}>校园资料</button></p>:
      !done?null:
      <form className="social-form" onSubmit={e=>{e.preventDefault();void submit()}}>
        {(subject==='reading'||subject==='listening')&&<label>{subject==='listening'?'选择错题':'选择题目'}<select className="select" disabled={busy} value={qId} onChange={e=>{setQId(e.target.value);resetFields()}}>{questions.map(q=><option key={q.id} value={q.id}>{q.text}{done.some(row=>row.selection===q.id)?' · 已完成':''}</option>)}</select></label>}
        {completed?<div className="task-receipt" data-new={focusReceipt.current||undefined} ref={receipt} tabIndex={-1}>
          <strong role="status">✓ 已计入校园积分账本</strong>
          {completed.before&&<p>原作答　{completed.before}</p>}
          {completed.after&&<p>我的复练　{completed.after}</p>}
          {completed.reason&&<p>复练说明　{completed.reason}</p>}
          <div><button className="btn btn-sm" type="button" onClick={()=>go('campus/challenge')}>查看小队进度</button> <button className="btn btn-sm" type="button" onClick={()=>go('subject/'+subject)}>返回{skillNames[subject]}练习</button></div>
        </div>:<>
        {subject==='speaking'?<p>{canClaim?'这份模考通过原报告发起。交卷后可记入本周口语复练。':'根据这份报告再完成一场快速录音模考。交卷后从新报告的「口语复练」领取本次积分。'}</p>:<>
          {subject==='writing'&&<label>选择自己的原文段落<select className="select" disabled={busy} value={index} onChange={e=>{setIndex(Number(e.target.value));resetFields()}}>{originals.map((_,i)=><option key={i} value={i}>第 {i+1} 段</option>)}</select></label>}
          <p className="social-original"><b>{subject==='writing'?'原段落':'原作答'}</b>　{original||'未作答'}</p>
          {subject==='reading'&&<details><summary>查看文章</summary>{passages.map((p,i)=><p key={i} lang="en">{p}</p>)}</details>}
          <label>{subject==='listening'?'订正答案':subject==='reading'?'摘录支持判断的原文':'修改后的英文段落'}
            <textarea className="textarea" lang="en" maxLength={4000} value={after} onChange={e=>setAfter(e.target.value)} required/></label>
          <label>{subject==='listening'?'原先为什么听错？':subject==='reading'?'这句原文如何支持判断？':'这次调整了什么？'}
            <input className="input" minLength={4} maxLength={400} required value={reason} onChange={e=>setReason(e.target.value)}/></label></>}
        <div><button className="btn btn-primary" disabled={busy}>{busy?'处理中':subject==='speaking'&&!canClaim?'开始录音复练':'提交并记入积分'}</button></div>
        {note&&<p role="alert">{note}</p>}</>}
      </form>}</details>
}
