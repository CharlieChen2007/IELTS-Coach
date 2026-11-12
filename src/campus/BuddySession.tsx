import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext'
import { useAuth } from '../auth'
import { SubjectIcon } from '../components'
import { repository } from '../repository'
import { campusRequest, skillNames, skills, type Skill } from './SocialApi'
import type { Invitation } from './buddyData'
import './buddySession.css'

type Task = {id:string; skill:Skill; name:string; path:string; prompt:string; example:string; legacy?:boolean}
const tasks:Task[] = [
  {id:'s1',skill:'listening',name:'家具电话咨询 · 笔记填空',path:'subject/listening?view=practice&section=prac_lsn_s1',prompt:'各挑一个容易漏听的细节，交换你听到的关键词。',example:'我会在听到价格后再等半句，确认说话人有没有修正数字。'},
  {id:'s2',skill:'listening',name:'夏令营员工职责 · 匹配',path:'subject/listening?view=practice&section=prac_lsn_s2',prompt:'各选一道匹配题，写下让你确定选项的线索。',example:'我先记下每个人具体做的事情，再去匹配同义表达。'},
  {id:'free',skill:'speaking',name:'自由对话 · 观点展开',path:'subject/speaking?view=practice',prompt:'各做一轮自由对话，交换一句你用来展开观点的表达。',example:'我用 For instance 引出上周在图书馆的经历，回答更具体了。'},
  {id:'quick',skill:'speaking',name:'快速演练 · 三部分',path:'subject/speaking?view=quick',prompt:'各完成一次快速演练，交流一句下次想说得更好的话。',example:'回答以后可以补一句原因，再接一个发生在校园的例子。'},
  {id:'reading-p1',skill:'reading',name:'精读篇章 p1 · 定位证据',path:'subject/reading?view=practice&passage=p1',prompt:'各完成同一篇文章，交卷后交换一道题的定位依据。',example:'我圈出了原文中的范围词，发现选项把适用范围扩大了。'},
  {id:'reading-p2',skill:'reading',name:'精读篇章 p2 · 题型复盘',path:'subject/reading?view=practice&passage=p2',prompt:'各完成第二篇文章，交流一个判断依据。',example:'我把题干与原文逐项对照，区别了证据相反与证据缺失。'},
  {id:'writing-transport',skill:'writing',name:'Task 2 · 学生免费公共交通',path:'subject/writing?view=practice&task=transport',prompt:'各完成这道议论文，交卷后交换一处论证改进。',example:'我在例子之后解释它如何支持学生免费乘车的观点。'},
  {id:'passage',legacy:true,skill:'reading',name:'篇章阅读 · 定位证据',path:'practice/exr_re_pass_01',prompt:'各选一道题，写下支持你答案的原文线索。',example:'我先圈出限定词，再检查选项有没有把范围扩大。'},
  {id:'judgement',legacy:true,skill:'reading',name:'阅读复练 · 判断依据',path:'practice/exr_re_retake_01',prompt:'比较你们定位的原文，说清楚哪些信息有依据。',example:'没有给出比较结果时，我会把找不到证据和证据相反分开。'},
  {id:'essay',legacy:true,skill:'writing',name:'Task 2 · 议论文',path:'practice/exr_wr_task2_01',prompt:'各自写一段论证，交换最能支持观点的一句话。',example:'我在举例后补了一句解释，把例子和中心论点连了起来。'},
  {id:'rewrite',legacy:true,skill:'writing',name:'写作复练 · 段落修改',path:'practice/exr_wr_retake_01',prompt:'对照改写前后，交换一处最值得保留的修改。',example:'把抽象的形容词换成一个具体动作以后，句子的意思更清楚了。'},
]
type Meet = {id:string;task:string;start:number;mine:boolean;state:'pending'|'confirmed'|'cancelled'|'done';myNote:string;peerNote:string;created?:number;practiceDone?:boolean}
type Action = 'propose'|'confirm'|'cancel'|'reflect'|'sampleConfirm'|'sampleNote'
type Body = {id:string; action:Action;task?:string;start?:number;note?:string}
type ReturnTo = {peer:string; name:string; task:string; launched:number}
const localKey=(uid:string,peer:string)=>'szu-buddy-meet-v1:'+uid+':'+peer
const returnKey=(uid:string)=>'szu-buddy-return:'+uid
const desk=(peer:string)=>'campus/match?buddy='+encodeURIComponent(peer)
const inBeijing=(time:number)=>new Date(time+8*3600000).toISOString().slice(0,16)
const when=(time:number)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(time)
const readSample=(uid:string,peer:string):Meet|null=>JSON.parse(localStorage.getItem(localKey(uid,peer))||'null')
function updateSample(uid:string,peer:string,body:Body) {
  let meet=readSample(uid,peer)
  const {action,id}=body
  const task=tasks.find(t=>t.id===(body.task||meet?.task))
  if(action==='propose' && (!meet || meet.state==='done'||meet.state==='cancelled')&&task && body.start){
    meet={id,task:task.id,start:body.start,mine:true,state:'pending',myNote:'',peerNote:''}
  }else if(meet?.id===id && meet && (meet.state==='pending'||meet.state==='confirmed')){
    if(action==='sampleConfirm'&&meet.state==='pending')meet.state='confirmed'
    else if(action==='cancel')meet.state='cancelled'
    else if(action==='reflect'&&meet.state==='confirmed'&&!meet.myNote&&body.note)meet.myNote=body.note
    else if(action==='sampleNote'&&meet.state==='confirmed'&&meet.myNote&&task)meet.peerNote=task.example
    else throw Error('约练已经更新，请查看最新状态。')
    if(meet.myNote&&meet.peerNote)meet.state='done'
  }else throw Error('约练已经更新，请查看最新状态。')
  localStorage.setItem(localKey(uid,peer),JSON.stringify(meet))
  return {meet}
}
export function BuddyReturnLink(){
  const {user}=useAuth(),{go,route}=useApp()
  let back:ReturnTo|null=null
  try{if(user)back=JSON.parse(sessionStorage.getItem(returnKey(user.userId))||'null')}catch{/* Session storage may be unavailable. */}
  const task=tasks.find(t=>t.id===back?.task)
  let onTask=false
  if(task&&back&&user){
    const exercise=task.skill==='listening'?'prac_lsn_'+task.id:task.id==='quick'?'exr_sp_quick':task.id==='free'?'exr_sp_free_01':task.id.startsWith('reading-')?'reading_'+task.id.slice(8):task.id.startsWith('writing-')?'writing_transport':task.path.split('/')[1]
    const view=route.query.view||''
    if(route.name==='subject'&&route.id===task.skill){
      if(task.skill==='listening')onTask=view==='practice'&&route.query.section===exercise
      if(task.id==='free')onTask=view==='practice'||view.startsWith('dialogue/')
      if(task.id==='quick')onTask=view==='quick'||view.startsWith('exam/')
      if(task.id.startsWith('reading-'))onTask=view==='practice'&&route.query.passage===task.id.slice(8)
      if(task.id.startsWith('writing-'))onTask=route.query.task==='transport'&&view==='practice'
    }else if(route.name==='practice')onTask=route.id===exercise
    else if(route.name==='report'){
      const report=repository.getReport(user.userId,route.id)
      const attempt=repository.getAttempt(user.userId,report?.attemptId||route.query.attempt)
      onTask=((attempt?.exerciseId??report?.exerciseId)===exercise||(task.id.startsWith('writing-')&&report?.evidence.writingTopic==='transport'))&&Date.parse(attempt?.submittedAt||report?.createdAt||attempt?.createdAt||'')>=back.launched
    }
  }
  useEffect(()=>{
    if(back&&!onTask&&user){try{sessionStorage.removeItem(returnKey(user.userId))}catch{/* Storage can be disabled. */}}
  },[user?.userId,route,onTask])
  if(!onTask||!back||!user)return null
  return <button className="buddy-return" onClick={()=>go(desk(back!.peer))}>← 返回与{back.name}的约练</button>
}

export function BuddySession({invite,initial}:{invite:Invitation;initial:Skill}){
  const {user}=useAuth(),{go}=useApp()
  const uid=user!.userId,peer=invite.other,sample=peer.startsWith('plaza-peer-')
  const [meet,setMeet]=useState<Meet|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [selected,setSelected]=useState(initial),[taskId,setTaskId]=useState(tasks.find(t=>t.skill===initial&&!t.legacy)!.id)
  const [startMode,setStartMode]=useState('now'),[date,setDate]=useState(()=>inBeijing(Date.now()+3600000)),[draft,setDraft]=useState('')
  const [cancelCheck,setCancelCheck]=useState(false),[another,setAnother]=useState(false),[notice,setNotice]=useState(''),[tick,setTick]=useState(0)
  const lock=useRef(false),revision=useRef(0),heading=useRef<HTMLHeadingElement>(null)
  const id=meet?.id, state=meet?.state
  useEffect(()=>{setDraft('');setCancelCheck(false)},[id,state])
  useEffect(()=>{
    let active=true
    const load=async()=>{
      if(lock.current)return
      const mark=++revision.current
      try{
        const data=sample?{meet:readSample(uid,peer)}:await campusRequest<{meet:Meet|null}>(user!,'/api/social/meet?other='+encodeURIComponent(peer))
        if(active&&mark===revision.current){setMeet(data.meet);setLoaded(true);setError('')}
      }catch(err){if(active&&mark===revision.current)setError((err as Error).message)}
    }
    void load()
    const refresh=()=>{if(!document.hidden)void load()}
    const onStorage=(event:StorageEvent)=>{if(event.key===localKey(uid,peer))refresh()}
    window.addEventListener('focus',refresh);window.addEventListener('storage',onStorage)
    const timer=window.setInterval(refresh,6500)
    return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('storage',onStorage)}
  },[uid,peer,sample,tick])
  async function act(body:Body,message:string){
    if(lock.current)return
    lock.current=true;revision.current++;setBusy(true);setError('')
    try{
      const save=()=>updateSample(uid,peer,body)
      const result=sample?(navigator.locks?await navigator.locks.request(localKey(uid,peer),save):save())
        :await campusRequest<{meet:Meet}>(user!,'/api/social/meet',{...body,other:peer})
      setMeet(result.meet);setAnother(false);setCancelCheck(false);setNotice(message)
      requestAnimationFrame(()=>heading.current?.focus({preventScroll:true}))
    }catch(err){setError((err as Error).message)}
    finally{lock.current=false;setBusy(false)}
  }
  const task=tasks.find(t=>t.id===meet?.task),creating=!meet||((state==='done'||state==='cancelled')&&another)
  function propose(){
    const start=startMode==='now'?Date.now():new Date(date+':00+08:00').getTime()
    if(!Number.isFinite(start)||start<Date.now()-60000||start>Date.now()+90*86400000){setError('请选择未来 90 天内的时间。');return}
    void act({action:'propose',id:crypto.randomUUID(),task:taskId,start},'约练已发出。')
  }
  function launch(){
    if(!task)return
    try{sessionStorage.setItem(returnKey(uid),JSON.stringify({peer,name:invite.name,task:task.id,launched:Date.now()}))}catch{/* The desk remains accessible from the plaza. */}
    go(task.path)
  }
  return <div className="buddy-desk">
    <button className="buddy-back" onClick={()=>go('campus/match')}>← 搭子广场</button>
    <div className="buddy-banner"><div><h2 ref={heading} tabIndex={-1}>与{invite.name}一起练</h2><p>约好一项练习，做完后交换各自的发现。</p></div>{sample&&<small>模拟搭子</small>}</div>
    {error&&<div className="buddy-note" role="alert">{error} <button className="buddy-link" onClick={()=>setTick(v=>v+1)}>刷新约练</button></div>}
    <span className="buddy-sr" role="status">{notice}</span>
    {!loaded&&!error&&<p role="status" aria-busy="true">正在读取约练记录…</p>}
    {loaded&&creating&&<form className="card buddy-plan" onSubmit={e=>{e.preventDefault();propose()}}>
      <h3>发起一次约练</h3>
      <fieldset><legend>练哪一科</legend><div className="buddy-picks">{skills.map(s=><button type="button" key={s} aria-pressed={selected===s} onClick={()=>{setSelected(s);setTaskId(tasks.find(t=>t.skill===s&&!t.legacy)!.id)}}><SubjectIcon subject={s} size={17}/>{skillNames[s]}</button>)}</div></fieldset>
      <label>一起做的练习<select className="select" value={taskId} onChange={e=>setTaskId(e.target.value)}>{tasks.filter(t=>t.skill===selected&&!t.legacy).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <p>{tasks.find(t=>t.id===taskId)?.prompt}</p>
      <fieldset><legend>什么时候练</legend><div className="buddy-picks">{[['now','现在就练'],['later','另约时间']].map(([key,name])=><button key={key} type="button" aria-pressed={startMode===key} onClick={()=>setStartMode(key)}>{name}</button>)}</div></fieldset>
      {startMode==='later'&&<label>约练时间（北京时间）<input className="input" type="datetime-local" value={date} min={inBeijing(Date.now())} max={inBeijing(Date.now()+90*86400000)} onChange={e=>setDate(e.target.value)} required/></label>}
      <div className="buddy-actions"><button className="btn btn-primary" disabled={busy}>{busy?'发送中':'发送约练邀请'}</button>{another&&<button className="btn" type="button" onClick={()=>setAnother(false)}>返回上次约练</button>}</div>
    </form>}
    {loaded&&!creating&&meet&&task&&<section className="card buddy-plan buddy-result" key={meet.id+meet.state}>
      <div className="buddy-meet-head"><span className="buddy-meet-skill"><SubjectIcon subject={task.skill} size={17}/>{skillNames[task.skill]}</span><b>{state==='done'?'已交换心得':state==='cancelled'?'已取消':state==='confirmed'?'已约好':meet.mine?'等待搭子确认':'待你确认'}</b></div>
      <h3>{task.name}</h3><p>{when(meet.start)} · 北京时间</p><p>{task.prompt}</p>
      {state==='pending'&&<div className="buddy-actions">{!meet.mine?<button className="btn btn-primary" disabled={busy} onClick={()=>act({id:meet.id,action:'confirm'},'已确认约练。')}>确认约练</button>:
        sample?<button className="btn btn-primary" disabled={busy} onClick={()=>act({id:meet.id,action:'sampleConfirm'},'模拟搭子已确认约练。')}>模拟搭子确认</button>:<p>{invite.name}确认后，你们就可以进入练习。</p>}</div>}
      {state==='confirmed'&&!meet.myNote&&<button className="btn btn-primary" onClick={launch}>进入约好的练习 →</button>}
      {(state==='confirmed'||state==='done')&&<div className="buddy-exchange">
        <h4>练后交流</h4>
        {meet.practiceDone===false&&<p>先完成上方约定的练习并交卷，再回来分享心得。</p>}
        {meet.myNote?<article><strong>我的心得</strong><p>{meet.myNote}</p></article>:
          <form onSubmit={e=>{e.preventDefault();void act({id:meet.id,action:'reflect',note:draft.trim()},'你的心得已分享。')}}>
            <label>我的练后发现<textarea className="input" rows={2} maxLength={500} value={draft} onChange={e=>setDraft(e.target.value)} placeholder={task.prompt}/></label>
            <button className="btn btn-sm" disabled={!draft.trim()||busy||meet.practiceDone===false}>分享心得</button>
          </form>}
        {meet.peerNote?<article><strong>{invite.name}的心得{sample?' · 示例':''}</strong><p>{meet.peerNote}</p></article>:meet.myNote&&
          (sample?<button className="btn" disabled={busy} onClick={()=>act({id:meet.id,action:'sampleNote'},'已交换练后心得。')}>查看模拟搭子的心得</button>:<p>等{invite.name}分享后，心得会出现在这里。</p>)}
      </div>}
      {(state==='done'||state==='cancelled')&&<button className="btn btn-primary" onClick={()=>{setNotice('');setAnother(true)}}>再约一次</button>}
      {(state==='pending'||state==='confirmed')&&(!cancelCheck?<button className="buddy-back" disabled={busy} onClick={()=>setCancelCheck(true)}>取消本次约练</button>:<div className="buddy-actions"><small>同时取消双方的这次安排？</small><button className="btn btn-sm" disabled={busy} onClick={()=>act({action:'cancel',id:meet.id},'本次约练已取消。')}>确认取消</button><button className="buddy-back" onClick={()=>setCancelCheck(false)}>保留约练</button></div>)}
    </section>}
  </div>
}

