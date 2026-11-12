import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth, type AuthUser } from '../auth'
import { useApp } from '../appContext'
import { repository } from '../repository'
import { PRACTICES,findPractice } from '../seed'
import type { Practice, Subject } from '../contract'
import { listeningPractice, listeningSources, readListeningDraft } from '../listeningIntegration'
import { formatDateTime } from '../logic'
import { SUBJECT_META } from '../contract'
import { ClipPicker } from './ClinicAudio'
import { evidence,sendWithClip,sourceClip,localTime,status,api,type EvidenceProps,type Summary } from './ClinicData'
import { campusRequest, type SchoolProfile } from './SocialApi'
import { setSpeakingBusy } from '../speakingIntegration'
import {clinicLink, ClinicExamples, HelpCard} from './CampusExamples'
import './Clinic.css'

export function IssueChecks({items,selected,change}:{items:string[];selected:string[];change:(next:string[])=>void}){
 return <div className="clinic-tags">{items.map(label=><label key={label}><input type="checkbox" checked={selected.includes(label)} onChange={e=>change(e.target.checked?[...selected,label]:selected.filter(i=>i!==label))}/>{label}</label>)}</div>
}
type Intent = 'help'|'clinic'
type Workspace = {intent:Intent; sourcePicker:ReactNode; close:()=>void}
const actionTitle=(subject:Subject,intent:Intent)=>intent==='help'?'发'+SUBJECT_META[subject].label+'互助单':'预约'+SUBJECT_META[subject].label+'诊所'
export function ClinicEvidenceActions(props:EvidenceProps & {workspace?:Workspace; initialEntry?:string}) {
 const {go,replace}=useApp(),{user}=useAuth(), isReport=Boolean(props.report)
 const e=useMemo(()=>evidence(props),[props.report,props.practice,props.answers,props.writingText])
 const [opened,setType]=useState<Intent|null>(null),[idx,setIdx]=useState(0),[selected,setSelected]=useState<string[]>([]),[extra,setExtra]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[blob,setBlob]=useState<Blob|null>(null)
 const {workspace}=props
 const type=workspace?.intent ?? opened
 const key=useRef(''),loadKey=useRef(0),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;loadKey.current++}},[])
 const [recording,setRecording]=useState(false),[loadingClip,setLoadingClip]=useState(false)
 const [joinNeeded,setJoinNeeded]=useState(false)
 const protectWorkspace=Boolean(workspace)&&(recording||busy)
 useEffect(()=>{
  if(!protectWorkspace)return
  if(e?.subject==='speaking')setSpeakingBusy(true)
  const warn=(event:BeforeUnloadEvent)=>event.preventDefault()
  window.addEventListener('beforeunload',warn)
  return ()=>{window.removeEventListener('beforeunload',warn);if(e?.subject==='speaking')setSpeakingBusy(false)}
 },[protectWorkspace,e?.subject])
 useEffect(()=>{
  if(!type||!user)return
  let live=true
  campusRequest<{profile:SchoolProfile|null}>(user,'/api/social/me')
    .then(({profile})=>{if(live)setJoinNeeded(!profile)})
    .catch(()=>{/* If unavailable, the submission displays the service error and keeps the form. */})
  return ()=>{live=false}
 },[user?.userId,type])
 const initialIndex=props.initialEntry?Math.max(0,e?.entries.findIndex(row=>row.key===props.initialEntry)??0):0
 useEffect(()=>{setType(null);setIdx(initialIndex);setBlob(null);loadKey.current++},[e?.sourceId,initialIndex])
 const entry=e?.entries[idx]||e?.entries[0]
 if(!e||!entry||!user)return null
 function open(value:Intent){
  if(value===type){setType(null);return}
  setType(value);setError('');if(!type){setSelected([]);setExtra('');setBlob(null);setNote('');key.current=crypto.randomUUID()}
 }
 async function addExisting(){
  const generation=++loadKey.current;setError('');setLoadingClip(true)
  try{const clip=await sourceClip(user!,e!,entry!);if(generation!==loadKey.current)return;if(!clip)throw Error('这台设备找不到本轮原声，可以录入或选择自己的音频。');setBlob(clip)}
  catch(err){if(generation===loadKey.current)setError((err as Error).message)}
  finally{setLoadingClip(false)}
 }
 async function submit(){
  if(!type||busy||recording||loadingClip)return
  if(type==='clinic'&&(e?.subject!=='speaking'||!blob)){setError('请先录一段作答，或附上报告中的原声。');return}
  const issues=[...new Set([...selected,...(extra.trim()?[extra.trim()]:[])])]
  if(!issues.length||issues.length>8){setError('请选择或填写 1 至 8 个问题。');return}
  setBusy(true);setError('')
  try{
   if(joinNeeded) {
    await campusRequest(user!,'/api/social/profile',{nickname:user!.nickname})
    setJoinNeeded(false)
   }
   const id=key.current ||= crypto.randomUUID()
   await sendWithClip(user!,'create',{id,private:type==='clinic',subject:e!.subject,sourceId:(e!.sourceId+':'+entry!.key).slice(0,150),title:e!.title,prompt:entry!.prompt.slice(0,5000),original:entry!.answer.slice(0,10000),issues,note},blob)
   if(!mounted.current)return
   if(workspace&&e!.subject==='speaking')setSpeakingBusy(false)
   const navigate=workspace&&replace?replace:go
   navigate(clinicLink(type,'case',id))
   if(workspace)window.scrollTo({top:0,behavior:'instant'})
  }catch(err){const message=(err as Error).message;if(message.includes('请先加入深圳大学校园'))setJoinNeeded(true);else setError(message)}finally{setBusy(false)}
 }
 return <section className={'card clinic-surface clinic-source'+(workspace?' peer-form-card':'')}>
 {!workspace&&<div className="clinic-heading"><div><h3>带着{isReport?'这份报告':'这道题'}找学伴</h3><p>{e.subject==='speaking'?'发互助单等留言，或带着原声约学伴一起练。':'把疑问和这份作答一起交给学伴，请同学留言解答。'}</p></div>
 <div className="clinic-actions"><button type="button" disabled={busy||recording} aria-expanded={type==='help'} className="btn btn-sm" onClick={()=>open('help')}>发同校互助单</button>{e.subject==='speaking'&&<button type="button" disabled={busy||recording} aria-expanded={type==='clinic'} className="btn btn-sm" onClick={()=>open('clinic')}>预约口语诊所</button>}</div></div>}
 {type&&<div className="clinic-form"><h3>{workspace ? actionTitle(e.subject,type) : (type==='help'?'新建同校互助单':'准备诊所预约')}</h3>
 {workspace&&<fieldset className="peer-source-picker" disabled={recording||busy||loadingClip}>{workspace.sourcePicker}</fieldset>}
 {e.entries.length>1&&<label>{isReport?'选择作答':'选择题目'}<select className="select" value={idx} disabled={recording||busy} onChange={evt=>{loadKey.current++;setIdx(Number(evt.target.value));setSelected([]);setBlob(null);setError('')}}>{e.entries.map((o,i)=><option key={o.key} value={i}>{o.label}</option>)}</select></label>}
 <div className="clinic-excerpt"><b>原题</b><p>{entry.prompt}</p>{(entry.answer||e.subject!=='speaking')&&<><b>我的原作答</b><p>{entry.answer||'尚无文字作答'}</p></>}</div>
 <fieldset><legend>想解决的问题</legend><IssueChecks items={[...new Set([...(entry.issues||[]),...e.issues])]} selected={selected} change={setSelected}/></fieldset>
 <label>其他问题（选填）<input className="input" maxLength={180} value={extra} onChange={v=>setExtra(v.target.value)} placeholder={e.subject==='speaking'?'例如：这句话的重音应该落在哪里？':'写下想和学伴讨论的问题'}/></label>
 <label>补充说明（选填）<textarea className="textarea" maxLength={1000} value={note} onChange={v=>setNote(v.target.value)}/></label>
 {e.subject==='speaking'&&<div><strong>{type==='clinic'?'练前录音':'本人的录音（选填）'}</strong>{e.report&&<button type="button" disabled={recording||loadingClip} onClick={addExisting} className="btn btn-sm">{loadingClip?'读取中':'附上这一轮原声'}</button>}<ClipPicker value={blob} onChange={setBlob} onBusyChange={setRecording}/></div>}
 <p className="small muted">{type==='help'?'加入深大校园的成员可看到题目和问题。原作答和录音仅对你、认领者和已预约学伴开放。':'此记录仅对你和预约成功的学伴开放。创建后选择学伴和 15 分钟时段。'}</p>
 {joinNeeded&&<p className="small">首次提交将用昵称「{user.nickname}」加入深圳大学营地。</p>}
 <div className="clinic-actions"><button className="btn btn-primary" disabled={busy||recording||loadingClip||(type==='clinic'&&!blob)} type="button" onClick={submit}>{busy?'提交中…':joinNeeded?(type==='help'?'加入校园并发布互助单':'加入校园并选择时段'):type==='help'?'发布互助单':'保存并选择时段'}</button><button type="button" className="btn btn-quiet" disabled={busy||recording} onClick={()=>workspace?workspace.close():setType(null)}>{workspace?(type==='clinic'?'返回口语诊所':'返回学伴互助'):'收起'}</button></div>
 {error&&<div className="clinic-error" role="alert">{error}</div>}</div>}
 </section>
}
function peerPath(subject:Subject,intent?:Intent,section?:string,source?:string,item?:string) {
 const query=new URLSearchParams({view:'peers'})
 if(intent)query.set('action',intent)
 if(section)query.set('section',section)
 if(source)query.set('source',source)
 if(item)query.set('item',item)
 return 'subject/'+subject+'?'+query
}

/* 四科的「学伴互助」是同一件事、同一套界面：一个页签、一块大厅、一个发起入口。
   差别只在科目（看哪科的互助单、带哪科的作答去发单），所以由 subject 参数区分，
   不再为某一科单独做一套版式——否则四个板块各长一个样，功能一样却说不出为什么不一样。 */
export function SubjectPeerSupport({subject}:{subject:Subject}){
 const {route,go,replace}=useApp()
 const {user,showcase}=useAuth()
 const enteredFromHub=useRef(false)
 const {action,source,item}=route.query
 const section=subject==='listening'&&listeningSources.some(s=>s.exerciseId===route.query.section)?route.query.section:undefined
 /* 口语从「口语诊所」进来时带 section=help，说明它归属于诊所那一页，关闭要回诊所；
     其它科目没有这层归属，关闭就回本页的互助首页。 */
 const inClinic=subject==='speaking'&&route.name==='subject'&&route.id==='speaking'&&route.query.section==='help'
 if(!user)return null
 if(action==='help'||(subject==='speaking'&&action==='clinic')){
   const close=()=>{if(enteredFromHub.current)window.history.back();
     else if(action==='clinic')(replace||go)(clinicLink('clinic'))
     else if(inClinic)(replace||go)('subject/speaking?view=clinic&section=help')
     else (replace||go)(peerHomePath(subject))}
   return <PeerWorkspace key={user.userId+':'+subject+':'+action} user={user} subject={subject} intent={action} section={section} close={close}/>
 }
 /* 页签点进来就直接展开大厅：想看的本来就是单子，不必再点一次「去互助大厅」。
    四科共用这一段版式，只有科目名与文案里的科目不同。 */
 return <section className="card clinic-surface" aria-label={SUBJECT_META[subject].label+'学伴互助'}>
  <div className="clinic-heading"><div><h3>{SUBJECT_META[subject].label}互助单</h3>
    <p>带着卡住的那道题来，和同学一起找依据、改作答。</p></div>
    <div className="clinic-actions">
    <button className="btn btn-primary" onClick={()=>{enteredFromHub.current=true;go(peerPath(subject,'help',section,source,item))}}>{actionTitle(subject,'help')}</button></div></div>
    <HelpBoard key={user.userId+':'+subject} userId={user.userId} subject={subject} user={user} demo={showcase}/>
 </section>
}

/* 某科的互助单列表：真实单子优先，演示账号另带同科样例。 */
function HelpBoard({userId,subject,user,demo}:{userId:string;subject:Subject;user:AuthUser;demo:boolean}){
 const {go}=useApp()
 const [state,setState]=useState<'loading'|'guest'|'ready'|'failed'>('loading')
 const [rows,setRows]=useState<Summary[]>([])
 useEffect(()=>{
   let live=true
   campusRequest<{profile:SchoolProfile|null}>(user,'/api/social/me')
     .then(({profile})=>{
       if(!live)return
       if(!profile){setState('guest');return}
       return api<{rows:Summary[]}>(user,'board').then(({rows})=>{
         if(!live)return
         setRows(rows.filter(r=>!r.private&&r.subject===subject));setState('ready')
       })
     })
     .catch(()=>{if(live)setState('failed')})
   return ()=>{live=false}
 },[userId,subject,user])
 const real=rows.length>0
 const label=SUBJECT_META[subject].label
 const note=
   state==='loading' ? null
   : state==='guest' ? <p className="hall-note">加入深圳大学校园后，这里会显示本校同学的{label}互助单。{demo&&'下面的演示案例可以先点开看看。'}
     <button className="btn btn-sm" onClick={()=>{location.hash='#/profile/campus'}}>填写校园资料</button></p>
   : state==='failed' ? <p className="hall-note">暂时连不上校园互助大厅。{demo&&'下面是演示案例。'}</p>
   : real ? null
   : <p className="hall-note">{demo?'下面是可体验认领和回复的同科演示案例。':'当前还没有本学科的互助单，可以带着自己的问题发起求助。'}</p>
 return <>
   {real&&<div className="help-grid">{rows.map(r=><HelpCard key={r.id} subject={r.subject} name={r.ownerName} area={localTime(r.created)}
     title={r.title} topic={r.issues.join(' · ')} status={status(r)} onClick={()=>go(clinicLink('help','case',r.id,{subject}))}/>)}</div>}
   {/* 一句状态说明就够：加入前的门槛、连不上、以及「没人发单」三种情况各自讲清，
       演示案例只在演示账号下提一句，不再重复第二遍。 */}
   {note}
   {demo&&<div className="help-grid"><ClinicExamples userId={userId} filter={subject}/></div>}
 </>
}

/* 某科互助页的地址：口语走诊所（合并入口），其余走各自板块的 ?view=peers */
export function peerHomePath(subject:Subject){
 return subject==='speaking'?'subject/speaking?view=clinic&section=help':'subject/'+subject+'?view=peers'
}

function PeerWorkspace({user,subject,intent,section,close}:{user:AuthUser;subject:Subject;intent:Intent;section?:string;close:()=>void}){
 const {route,go,replace}=useApp()
 const label=SUBJECT_META[subject].label
 const reports=repository.listReports(user.userId).filter(r=>r.subject===subject&&r.status==='ready'&&!r.evidence.demoRecord&&
   (subject!=='listening'||Boolean(r.evidence.listeningItems?.length))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
 const exercises=subject==='listening'?listeningSources:PRACTICES.filter(p=>p.subject===subject&&(subject!=='speaking'||p.material?.part1?.length))
 const currentReport=section&&!readListeningDraft(user.userId,section)?reports.find(r=>r.exerciseId===section):undefined
 const suggested=currentReport?.reportId||section||reports[0]?.reportId||exercises[0]?.exerciseId
 const [firstSource]=useState(suggested)
 const available=(value:string|undefined)=>Boolean(value&&(reports.some(r=>r.reportId===value)||exercises.some(p=>p.exerciseId===value)))
 const requested=route.query.source
 const selected=available(requested)?requested:available(firstSource)?firstSource:suggested
 const report=reports.find(r=>r.reportId===selected)
 const [loaded,setLoaded]=useState<Practice|null>(null)
 const [error,setError]=useState('')
 const [retry,setRetry]=useState(0)
 const loadSection=subject==='listening'&&!report?selected:undefined
 useEffect(()=>{
   if(!loadSection)return
   let active=true
   setLoaded(null);setError('')
   listeningPractice(user,loadSection).then(p=>{if(active)setLoaded(p)}).catch(err=>{if(active)setError((err as Error).message)})
   return ()=>{active=false}
 },[loadSection,user.userId,retry])
 const practice=subject==='listening'?(loaded?.exerciseId===selected?loaded:undefined):findPractice(selected||'')
 const draft=report?undefined:subject==='listening'&&selected?readListeningDraft(user.userId,selected):
   repository.listAttempts(user.userId).find(a=>a.subject===subject&&a.exerciseId===selected&&a.status==='draft')
 const sourcePicker=<label>练习来源<select className="select" value={selected} onChange={e=>(replace||go)(peerPath(subject,intent,section,e.target.value))}>
  {reports.length>0&&<optgroup label={'我的'+label+'报告'}>{reports.map(r=><option key={r.reportId} value={r.reportId}>{r.original.title} · {formatDateTime(r.createdAt)}</option>)}</optgroup>}
  <optgroup label={label+'练习题'}>{exercises.map(p=><option key={p.exerciseId} value={p.exerciseId}>{p.title} · 练习题</option>)}</optgroup>
 </select></label>
 if(!practice&&!report)return <section className="card clinic-surface peer-form-card"><div className="clinic-form">
   <h3>{actionTitle(subject,intent)}</h3>{sourcePicker}
   {error?<p role="alert">{error} <button className="btn btn-sm" type="button" onClick={()=>setRetry(n=>n+1)}>重新读取</button></p>:null}
   <button className="btn btn-quiet" type="button" onClick={close}>返回学伴互助</button>
 </div></section>
 return <ClinicEvidenceActions key={selected} report={report} practice={practice??undefined} answers={draft?.answers}
   writingText={draft&&'draftText' in draft?draft.draftText:undefined} initialEntry={route.query.item}
   workspace={{intent,sourcePicker,close}}/>
}

export function SpeakingPeerSupport(){return <SubjectPeerSupport subject="speaking"/>}

