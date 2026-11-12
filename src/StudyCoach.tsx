import {useEffect,useMemo,useRef,useState} from 'react'
import {useAuth} from './auth'
import {useApp} from './appContext'
import {campusRequest} from './campus/SocialApi'
import {Card,CardHead} from './components'
import type {Report} from './contract'
import './studyCoach.css'

type Reference={subject:'listening'|'reading';attemptId:string}
type Result={provider:'DeepSeek';model:string;generatedAt:number;cached?:boolean;
  basis:{correct:number;total:number;title:string};analysis:{summary:string;
    insights:{evidenceId:string;number:number;quote:string;possibleCause:string;explanation:string;nextStep:string}[];
    practicePlan:{evidenceId:string;number:number;instruction:string;successCheck:string;path:string}[]}}
type Status={available:boolean;configured:boolean;provider?:string;result:Result|null;quota:{limit:number;used:number;remaining:number}}

function reference(report:Report):Reference|null {
  if(report.evidence.demoRecord || report.evidence.showcaseRecord || report.evidence.submittedByUser!==true)return null
  const subject=report.subject
  if(subject==='listening' && report.evidence.listeningItems && report.attemptId.startsWith('atm_li_'))
    return {subject,attemptId:report.attemptId.slice(7)}
  if(subject==='reading' && report.evidence.readingSession && report.attemptId.startsWith('atm_rd_'))
    return {subject,attemptId:report.attemptId.slice(7)}
  return null
}

/** One report-local analysis surface; standards, marks and next-route ownership stay server-side. */
export function StudyCoach({report}:{report:Report}) {
  const {user}=useAuth(),{go}=useApp()
  const ref=useMemo(()=>reference(report),[report.reportId])
  const identity=(user?.userId||'')+':'+(ref?.subject||'')+':'+(ref?.attemptId||'')
  const liveIdentity=useRef(identity);liveIdentity.current=identity
  const [snapshot,setSnapshot]=useState<{key:string;status:Status}|null>(null),[unavailable,setUnavailable]=useState(false)
  const [busyKey,setBusyKey]=useState(''),[failure,setFailure]=useState<{key:string;message:string}|null>(null),[retry,setRetry]=useState(0)
  const status=snapshot?.key===identity?snapshot.status:null,busy=busyKey===identity,error=failure?.key===identity?failure.message:''
  const current=useRef<AbortController|null>(null),mounted=useRef(true)
  const generation=useRef(0)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;current.current?.abort()}},[])
  async function request(method:'GET'|'POST',signal:AbortSignal):Promise<Status> {
    if(!user||!ref)throw Error('请从自己的听力或阅读报告进入。')
    await campusRequest(user,'/api/campus/me')
    const query=new URLSearchParams(ref)
    const response=await fetch('/api/ai/study-coach'+(method==='GET'?'?'+query:''),{
      method,credentials:'same-origin',cache:'no-store',signal,
      headers:{'X-Speaking-Scope':encodeURIComponent(user.userId),...(method==='POST'?{'Content-Type':'application/json'}:{})},
      ...(method==='POST'?{body:JSON.stringify(ref)}:{})})
    const data=await response.json().catch(()=>({error:'深度复盘暂时不可用，现有题库解析仍可查看。'}))
    if(!response.ok)throw Object.assign(new Error(data.error||'深度复盘暂时不可用，现有题库解析仍可查看。'),{status:response.status})
    return data
  }
  useEffect(()=>{
    const controller=new AbortController();let active=true
    ++generation.current
    setSnapshot(null);setUnavailable(false);setFailure(null);setBusyKey('')
    if(!user||!ref)return()=>controller.abort()
    void request('GET',controller.signal).then(data=>{if(active)setSnapshot({key:identity,status:data})})
      .catch(cause=>{
        if(!active||controller.signal.aborted)return
        if(cause.status===404||cause.status===422)setUnavailable(true)
        else setFailure({key:identity,message:cause.message})
      })
    return()=>{active=false;++generation.current;controller.abort();current.current?.abort()}
  },[identity,retry])
  async function generate() {
    if(busy||!status?.configured)return
    const requestGeneration=generation.current
    const stillCurrent=()=>mounted.current&&liveIdentity.current===identity&&generation.current===requestGeneration
    const controller=new AbortController();current.current=controller
    const timeout=window.setTimeout(()=>controller.abort(),40000)
    setBusyKey(identity);setFailure(null)
    try{const data=await request('POST',controller.signal);if(stillCurrent())setSnapshot({key:identity,status:data})}
    catch(cause){if(stillCurrent())setFailure({key:identity,message:controller.signal.aborted?'深度复盘等待超时，请稍后重试；现有题库解析仍可查看。':(cause as Error).message})}
    finally{clearTimeout(timeout);if(stillCurrent())setBusyKey('')}
  }
  if(!ref||unavailable||(!status&&!error))return null
  const result=status?.result
  return <Card className="study-coach mt16">
    <CardHead title="AI 深度复盘" hint="围绕这份已交卷答卷，解释可能的错因并安排下一步练法。"
      extra={<span className="chip primary">DeepSeek</span>}/>
    {result ? <>
      <p className="study-coach-summary">{result.analysis.summary}</p>
      <div className="study-coach-insights">{result.analysis.insights.map(item=><article key={item.evidenceId}>
        <h3>第 {item.number} 题 · {item.possibleCause}</h3>
        <blockquote lang="en">{item.quote}</blockquote>
        <p>{item.explanation}</p><p><b>再练一步</b>　{item.nextStep}</p>
      </article>)}</div>
      <div className="study-coach-plan"><h3>接下来怎么练</h3>{result.analysis.practicePlan.map((step,index)=><article key={step.evidenceId+':'+index}>
        <span className="study-coach-step" aria-hidden="true">{index+1}</span><div><p>{step.instruction}</p>
          <small>完成标准：{step.successCheck}</small>
          <button className="btn btn-sm" type="button" onClick={()=>go(step.path)}>回到对应练习 →</button></div>
      </article>)}</div>
      <p className="study-coach-source">来源：本次保存答卷与第 {result.analysis.insights.map(item=>item.number).join('、')} 题题库证据 · DeepSeek（{result.model}）。题库判分保持 {result.basis.correct} / {result.basis.total}，AI 建议不参与计分。</p>
    </> : status?.configured ? <div className="study-coach-start">
      <p>对照原文或原声证据，梳理容易混淆的信息，再给出可执行的复练步骤。</p>
      <button className="btn btn-primary" type="button" disabled={busy||status.quota.remaining===0} onClick={()=>void generate()} aria-busy={busy}>
        {busy?'正在对照答卷分析…':status.quota.remaining===0?'今日次数已用完':'生成深度复盘'}</button>
      <small>{busy?'分析期间可以继续查看本页解析。':'今日剩余 '+status.quota.remaining+' 次，已生成的复盘可反复查看。'}</small>
    </div> : status && <p className="study-coach-unavailable">深度复盘尚未启用，现有题库解析仍可正常查看。</p>}
    {error&&<div className="study-coach-error" role="alert"><p>{error}</p>
      {!status&&<button className="btn btn-sm" type="button" onClick={()=>setRetry(value=>value+1)}>重新连接</button>}</div>}
  </Card>
}
