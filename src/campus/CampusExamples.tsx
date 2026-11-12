import { useEffect, useState, type ReactNode } from 'react'
import { isShowcaseUser } from '../showcase'
import { useApp } from '../appContext'
import { SubjectIcon } from '../components'
import { SUBJECT_META, type Subject } from '../contract'
import { ReplyExchange } from './ReplyExchange'
import { ClipPicker, PlayClip } from './ClinicAudio'
import { stories, clinicLessons, type HelpStory } from './HelpStories'

export type Section = 'help' | 'clinic'
type Experience = { claimed?: boolean; reply?: string; booking?: string; take?: 'recorded'|'example'; revision?: string }
export function clinicLink(tab:Section, key?:'case'|'example', id?:string, filters?:{subject?:string;mine?:string}) {
  const params=new URLSearchParams()
  if(tab==='clinic')params.set('view','clinic')
  if(key&&id)params.set(key,id)
  if(tab==='help'&&filters?.subject&&Object.hasOwn(SUBJECT_META,filters.subject))params.set('subject',filters.subject)
  if(tab==='help'&&filters?.mine==='1')params.set('mine','1')
  const base=tab==='help'?'campus/help':'subject/speaking'
  return params.size?base+'?'+params:base
}
function storageKey(userId:string,tab:Section,id:string) {
  return 'ielts-campus-example:v1:'+encodeURIComponent(userId)+':'+tab+':'+id
}
function read(key:string,initial:Experience={}):Experience {
  try {const saved=sessionStorage.getItem(key);return saved===null?initial:JSON.parse(saved)||{}} catch {return initial}
}
function initialVisit(userId:string,tab:Section,id:string):Experience {
  return isShowcaseUser(userId)&&tab==='clinic'&&id==='weekend'?{booking:'周五 12:30–12:45'}:{}
}
export function exampleVisits(userId:string) {
  return clinicLessons.map(lesson=>({...lesson,...read(storageKey(userId,'clinic',lesson.id),initialVisit(userId,'clinic',lesson.id))})).filter(lesson=>lesson.booking)
}
function useExperience(key:string,initial:Experience) {
  const [state,setState]=useState<Experience>(()=>read(key,initial))
  function save(value:Experience){sessionStorage.setItem(key,JSON.stringify(value));setState(value)}
  return [state,save] as const
}
async function recordingStore(key:string, verb:'get'|'put'|'delete', value?:Blob):Promise<Blob|null> {
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    const req=indexedDB.open('ielts-clinic-practice-audio',1)
    req.onupgradeneeded=()=>req.result.createObjectStore('takes')
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)
  })
  try {return await new Promise<Blob|null>((resolve,reject)=>{
    const tx=db.transaction('takes',verb==='get'?'readonly':'readwrite'),s=tx.objectStore('takes')
    const request=verb==='put'?s.put(value!,key):verb==='delete'?s.delete(key):s.get(key)
    tx.oncomplete=()=>resolve(request.result instanceof Blob?request.result:null)
    tx.onabort=()=>reject(tx.error||Error('无法保存录音'))
  })} finally {db.close()}
}
export function sampleSubject(tab:Section,id?:string) {
  if(!id)return null
  return (tab==='help'?stories:clinicLessons).some(e=>e.id===id)?id:null
}
export function exampleList(userId:string,filter:string,mine:boolean) {
  return stories.filter(e=>(filter==='all'||filter===e.subject)&&(!mine||read(storageKey(userId,'help',e.id)).claimed))
}
function storyStatus(s:HelpStory,saved:Experience) {
  if(saved.reply || s.stage==='answered')return '待复练'
  if(s.stage==='resolved')return '已解决'
  if(saved.claimed || s.stage==='claimed')return '已认领'
  return '待认领'
}
export function HelpCard({subject,name,area,title,topic,status,onClick}:{
  subject:Subject;name:string;area?:string;title:string;topic:string;status:string;onClick:()=>void
}) {
  const tone=status==='待认领'?'open':status==='已解决'||status==='已复练'?'done':'active'
  return <button type="button" className={'help-ticket help-'+subject} onClick={onClick}>
    <span className="ticket-meta"><span className="ticket-subject"><SubjectIcon subject={subject} size={16}/>{SUBJECT_META[subject].label}</span>
      <span className={'ticket-state '+tone}><i aria-hidden="true"/>{status}</span></span>
    <strong>{title}</strong><span className="ticket-topic">{topic}</span>
    <span className="ticket-person"><span className="ticket-avatar" aria-hidden="true">{Array.from(name)[0]}</span><b>{name}</b><small>{area}</small><i aria-hidden="true">→</i></span>
  </button>
}
export function ClinicExamples({userId,filter='all',mine=false}:{userId:string;filter?:string;mine?:boolean}) {
  const {go}=useApp()
  return <>{exampleList(userId,filter,mine).map(e=><HelpCard key={e.id} subject={e.subject} name={e.name} area={e.area}
    title={e.title} topic={e.topic} status={storyStatus(e,read(storageKey(userId,'help',e.id)))}
    onClick={()=>go(clinicLink('help','example',e.id,{subject:e.subject}))}/>)}</>
}

export function CampusExamples({userId,tab,filter='all',mine=false}:{userId:string;tab:Section;filter?:string;mine?:boolean}) {
  const {go,route}=useApp()
  if(tab==='help')return <>{exampleList(userId,filter,mine).map(e=><HelpCard key={e.id} subject={e.subject} name={e.name} area={e.area}
    title={e.title} topic={e.topic} status={storyStatus(e,read(storageKey(userId,tab,e.id)))} onClick={()=>go(clinicLink(tab,'example',e.id,{subject:filter,mine:route.query.mine}))}/>)}</>
  return <div className="clinic-lessons">{clinicLessons.map(lesson=>{
    const saved=read(storageKey(userId,tab,lesson.id),initialVisit(userId,tab,lesson.id))
    return <button type="button" className="clinic-lesson" key={lesson.id} onClick={()=>go(clinicLink(tab,'example',lesson.id))}>
      <span className="lesson-mentor"><span className="ticket-avatar">{lesson.mentor[0]}</span><b>{lesson.mentor}</b><small>{lesson.role}</small></span>
      <strong>{lesson.focus}</strong><span className="lesson-action">{saved.take?'回听两次作答':saved.booking?'继续语音复练':'查看可约时段'} <i aria-hidden="true">→</i></span>
    </button>
  })}</div>
}
export function CampusExampleDetail({userId,tab,subject:id}:{userId:string;tab:Section;subject:string}) {
  const {go,route}=useApp(),key=storageKey(userId,tab,id)
  const [saved,save]=useExperience(key,initialVisit(userId,tab,id)),[issue,setIssue]=useState('')
  const e=stories.find(e=>e.id===id)!
  if(tab==='clinic')return <Lesson key={key} id={id} storage={key} saved={saved} save={save} back={()=>go(clinicLink('clinic'))}/>
  const stage=storyStatus(e,saved)
  return <div className="clinic-page"><button className="btn btn-quiet" onClick={()=>go(clinicLink('help',undefined,undefined,route.query))}>← 校园互助大厅</button>
    <article className={'card clinic-surface clinic-example-detail help-'+e.subject}>
      <div className="clinic-example-byline"><span className="ticket-subject"><SubjectIcon subject={e.subject} size={15}/>{SUBJECT_META[e.subject].label}</span>
        <b>{e.name}</b><span>{e.area}</span><span className="chip">{stage}</span></div>
      <h2>{e.title}</h2><p>{e.question}</p>
      <div className="clinic-excerpt"><b>练习题目</b><p>{e.prompt}</p></div>
      <div className="clinic-excerpt"><b>{e.name}的作答</b><p>{e.answer}</p></div>
      {stage==='待认领'&&<button className="btn btn-primary" onClick={()=>{try{save({claimed:true})}catch{setIssue('未能保存认领记录，请检查浏览器存储后重试。')}}}>认领互助单</button>}
      {issue&&stage==='待认领'&&<p role="alert">{issue}</p>}
      {saved.claimed&&<ReplyExchange text={saved.reply||null} title="我的回复" next={'已提交，等待'+e.name+'根据建议复练。'}
        label={'给'+e.name+'的解答'} placeholder="指出一句关键依据，或给一个具体改法" button="发布回复"
        publish={async value=>{try{save({claimed:true,reply:value})}catch{throw Error('回复未能保存到浏览器，请重试。')}}}/>}
      {e.stage==='claimed'&&<p>{e.helper}已认领，等待回复。</p>}
      {(e.stage==='answered'||e.stage==='resolved')&&<ReplyExchange text={e.advice} title={e.helper+'的回复'}
        next={e.stage==='resolved'?e.name+'已完成复练，并将问题标记为解决。':'等待'+e.name+'根据建议复练。'}/>}
    </article></div>
}
function Take({title,children}:{title:string;children:ReactNode}) {
  return <div className="voice-take"><h3>{title}</h3>{children}</div>
}
function Lesson({id,storage,saved,save,back}:{id:string;storage:string;saved:Experience;save:(s:Experience)=>void;back:()=>void}) {
  const lesson=clinicLessons.find(l=>l.id===id)!,e=stories.find(e=>e.id===lesson.story)!
  const [slot,setSlot]=useState(''),[take,setTake]=useState<Blob|null>(null),[recorded,setRecorded]=useState<Blob|null>(null)
  const [busy,setBusy]=useState(false),[recording,setRecording]=useState(false),[msg,setMsg]=useState(''),[retry,setRetry]=useState(0)
  useEffect(()=>{let active=true;if(saved.take==='recorded'){
    recordingStore(storage,'get').then(b=>{if(active){setRecorded(b);if(!b)setMsg('这段录音在本机已清理，可以再录一次。')}}).catch(()=>{if(active)setMsg('无法读取本机录音，可以重新录制。')})
  }return ()=>{active=false}},[saved.take,storage,retry])
  async function persist(kind:'recorded'|'example'){
    if(busy||recording||(!take&&kind==='recorded'))return
    setBusy(true);setMsg('')
    try{if(kind==='recorded'){await recordingStore(storage,'put',take!);setRecorded(take)}save({...saved,take:kind})}
    catch{setMsg('无法保存到本机。请保留页面后重试。')}finally{setBusy(false)}
  }
  const src='/clinic/'+lesson.audio
  return <div className="clinic-page"><button type="button" className="btn btn-quiet" onClick={back}>← 口语诊所</button>
    <article className="card clinic-surface clinic-example-detail"><div className="clinic-example-byline"><span className="chip primary">口语诊所</span><span>{lesson.mentor} · {lesson.role} · 15 分钟</span></div>
    <h2>{lesson.focus}</h2><p lang="en">{e.prompt}</p>
    <div className="voice-compare"><Take title="练前录音"><audio aria-label="练前示例录音" controls preload="metadata" src={src+'-before.wav'}/>
      <details><summary>查看转写</summary><p lang="en">{e.answer}</p></details></Take>
      {saved.take&&<Take title="练后录音">{saved.take==='example'?<><audio aria-label="练后示范录音" controls preload="metadata" src={src+'-after.wav'}/><small>示范作答</small></>:recorded?<PlayClip blob={recorded}/>:<button className="btn btn-sm" onClick={()=>setRetry(n=>n+1)}>读取我的录音</button>}</Take>}</div>
    {!saved.booking?<form className="clinic-form" onSubmit={ev=>{ev.preventDefault();if(slot)save({booking:slot})}}>
      <fieldset><legend>选择演示时段</legend><div className="clinic-tags">{['周三 19:00–19:15','周五 12:30–12:45'].map(s=><label key={s}><input type="radio" name="sample-hour" checked={slot===s} onChange={()=>setSlot(s)} required/>{s}</label>)}</div></fieldset>
      <button className="btn btn-primary" disabled={!slot}>确认预约</button>
    </form>:<><div className="lesson-advice"><small>已预约 · {saved.booking}</small><h3>{lesson.mentor}的复练建议</h3><p>{e.advice}</p></div>
      {!saved.take?<div className="voice-workbench"><h3>用自己的声音再答一次</h3><ClipPicker value={take} onChange={setTake} onBusyChange={setRecording}/>
        <div className="clinic-actions"><button className="btn btn-primary" disabled={!take||busy||recording} onClick={()=>persist('recorded')}>保存录音并对照</button>
        <button className="btn btn-quiet" disabled={busy||recording} onClick={()=>persist('example')}>使用示范录音体验</button></div></div>:
      <button className="btn btn-sm" disabled={busy} onClick={()=>{save({booking:saved.booking});setTake(null);setMsg('')}}>重新录制</button>}
    </>}
    {msg&&<p role="alert">{msg}</p>}
    <footer className="clinic-example-end"><small>演示预约 · 示例音频由合成语音朗读</small>
      {saved.booking&&<button className="btn btn-quiet btn-sm" disabled={recording||busy} onClick={async()=>{try{await recordingStore(storage,'delete');save({});setSlot('');setTake(null);setRecorded(null);setMsg('')}catch{setMsg('重置失败，请重试。')}}}>重新体验</button>}</footer>
    </article></div>
}

