import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { useApp } from '../appContext'
import { SubjectIcon } from '../components'
import { repository } from '../repository'
import type { Report } from '../contract'
import { campusRequest, skillNames, skills, slots, type Skill, type SchoolProfile } from './SocialApi'
import { buddySamples, matchFacts, portraitCard, portraitTags, reportExcerpt, sortedReports, type BuddyCard, type BuddyPost, type Invitation, type PlazaState } from './buddyData'
import { BuddyHubIcon, BuddyPortrait } from './BuddyPortrait'
import './buddyPlaza.css'
import { BuddyRelations } from './BuddyRelations'
import { BuddySession } from './BuddySession'

import { countInvitations, localKey, readLocal, type LocalBoard } from './BuddyInviteCount'

const empty: PlazaState = { profile:null, mine:null, cards:[], invites:[] }
const bands = Array.from({length:17},(_,i)=>1+i/2)
function Composer({mine, profile, target, reports, nickname, onSave, onClose, busy}: {
  mine:BuddyPost|null;profile:SchoolProfile|null;target:number;reports:Report[];nickname:string
  onSave:(post:BuddyPost)=>Promise<void>;onClose:()=>void;busy:boolean
}) {
  const [subject,setSubject] = useState<Skill>(mine?.subject || profile?.need[0] || reports[0]?.subject || 'speaking')
  const [extras,setExtras] = useState<Skill[]>(mine?.subjects?.filter(s=>s!==mine.subject)||[])
  const [goal,setGoal] = useState(mine?.target ?? profile?.target ?? target)
  const [gift,setGift] = useState<Skill|''>(mine?.gift || profile?.strong[0] || '')
  const [slot,setSlot] = useState(mine?.slot || profile?.slots[0] || '周三晚间')
  const [message,setMessage] = useState(mine?.message || '')
  const [summary,setSummary] = useState(mine?.summary || '')
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(()=>{field.current?.focus()},[])
  const choices = [...new Set(reports.filter(r=>r.subject===subject).map(reportExcerpt))]
  if(summary && !choices.includes(summary)) choices.unshift(summary)
  async function submit(e:FormEvent) {
    e.preventDefault()
    if (message.trim().length >= 4 && !busy) await onSave({subject,subjects:[subject,...extras.filter(s=>s!==subject)],message:message.trim(),slot,target:goal,gift,summary})
  }
  return <form className="card buddy-composer" onSubmit={submit}>
    <div className="buddy-heading"><h3>{mine?'编辑搭子需求':'发布搭子需求'}</h3><button type="button" className="btn btn-sm" disabled={busy} onClick={onClose}>取消</button></div>
    <div className="buddy-fields">
      <label>想练的科目<select aria-label="想练的科目" className="select" value={subject} onChange={e=>{setSubject(e.target.value as Skill);setSummary('')}}>{skills.map(s=><option key={s} value={s}>{skillNames[s]}</option>)}</select></label>
      <label>我能陪练<select aria-label="我能陪练" className="select" value={gift} onChange={e=>setGift(e.target.value as Skill|'')}><option value="">暂未选择</option>{skills.map(s=><option key={s} value={s}>{skillNames[s]}</option>)}</select></label>
      <label>目标分<select aria-label="目标分" className="select" value={goal} onChange={e=>setGoal(Number(e.target.value))}><option value={0}>不限分数</option>{bands.map(n=><option key={n}>{n}</option>)}</select></label>
      <label>可约时段<select aria-label="可约时段" className="select" value={slot} onChange={e=>setSlot(e.target.value)}><option>时间灵活</option>{slots.map(s=><option key={s}>{s}</option>)}</select></label>
    </div>
    <div className="buddy-extras"><small>还想一起练</small>{skills.filter(s=>s!==subject).map(s=><button className="btn btn-sm" key={s} type="button" aria-pressed={extras.includes(s)} onClick={()=>setExtras(old=>old.includes(s)?old.filter(x=>x!==s):[...old,s])}>{skillNames[s]}</button>)}</div>
    <label>想怎么一起练<textarea ref={field} className="input" rows={2} required minLength={4} maxLength={160} value={message} onChange={e=>setMessage(e.target.value)} placeholder="比如，每周四在图书馆练两道 Part 3，轮流追问和给建议。"/></label>
    {choices.length>0 ? <label>附上我的{skillNames[subject]}测评摘要<select className="select" value={summary} onChange={e=>setSummary(e.target.value)}><option value="">仅发布练习需求</option>{choices.map(v=><option key={v}>{v}</option>)}</select></label> :
      <small className="buddy-hint">完成一次{skillNames[subject]}测评后，可在这里选一条报告摘要附到需求上。</small>}
    <div className="buddy-publish"><small>以「{profile?.nickname || nickname}」发布到深圳大学搭子广场</small><button className="btn btn-primary" disabled={busy || message.trim().length<4}>{busy?'保存中':mine?'保存修改':'发布需求'}</button></div>
  </form>
}

function PeerCard({peer,tags,shared,invite,busy,onInvite}:{peer:BuddyCard;tags:ReturnType<typeof matchFacts>;shared:number|null;invite?:Invitation;busy:boolean;onInvite:()=>void}) {
  const {profile,post,department} = peer
  return <article className="buddy-card" data-skill={post.subject}>
    <header><span aria-hidden="true" className="buddy-avatar">{profile.nickname.slice(0,1)}</span>
      <div className="buddy-person"><h3>{profile.nickname}</h3><small>{department || '深圳大学'}{profile.level?' · 自评 '+profile.level:''}</small></div>
      <b className="buddy-skill"><SubjectIcon subject={post.subject} size={15}/>{skillNames[post.subject]}</b>
    </header>
    <p className="buddy-message">{post.message}</p>
    {post.subject==='writing'&&profile.writingAssessment&&<p className="buddy-source">{profile.writingAssessment.status==='complete'?`首稿综合参考 ${profile.writingAssessment.band} · `:'首稿样本待补齐 · '}Task 1 {profile.writingAssessment.task1} 篇 / Task 2 {profile.writingAssessment.task2} 篇</p>}
    {post.summary && <p className="buddy-source">测评摘要 · {post.summary}</p>}
    <div className="buddy-facts">{post.target>0?<span>目标 <b>{post.target}</b></span>:!peer.portraitOnly&&<span>目标不限</span>}<span>{post.slot}</span>{post.gift&&<span>可陪练{skillNames[post.gift]}</span>}
      {post.subjects?.filter(s=>s!==post.subject).map(s=><span key={s}>也练{skillNames[s]}</span>)}</div>
    {shared!==null&&<span className="buddy-affinity">六项偏好中有 {shared} 项相同</span>}
    <footer><div className="buddy-reasons">{invite?.status==='accepted'&&<span className="buddy-linked">我的搭子</span>}{tags.slice(0,invite?.status==='accepted'?1:2).map(tag=><span key={tag.label} title={tag.reason}>{tag.label}</span>)}</div>
      <button type="button" className="buddy-invite" aria-label={invite?.status==='accepted'?'与'+profile.nickname+'一起练':invite?undefined:'邀请' + profile.nickname + '一起练'} disabled={busy || invite?.status==='declined'} onClick={onInvite}>{!invite?'邀请一起练':invite.status==='accepted'?(invite.meetIncoming?'确认约练 →':'一起练 →'):invite.status==='declined'?'已婉拒':invite.incoming?'处理邀请':'查看邀请'}</button>
    </footer>
  </article>
}

export function BuddyPlaza() {
  const { user } = useAuth()
  return user ? <UserPlaza key={user.userId} /> : null
}

function UserPlaza() {
  const {user,profile:userProfile,showcase} = useAuth()
  const {version,go,route,refresh} = useApp()
  const uid=user!.userId
  const samples=showcase
  const [board,setBoard]=useState<PlazaState>(empty), [local,setLocal]=useState(()=>readLocal(uid,showcase))
  const [filter,setFilter]=useState<Skill|''>(''), [editing,setEditing]=useState(false)
  const recruit=route.id==='recruit', partners=route.id==='partners', discover=!recruit&&!partners
  const quiz=discover && route.query.view==='portrait'
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[readError,setReadError]=useState(''),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0)
  const lock=useRef(false)
  const header=useRef<HTMLButtonElement>(null)
  const listing=useRef<HTMLHeadingElement>(null)
  const closeEditor=()=>{setEditing(false);requestAnimationFrame(()=>header.current?.focus())}
  useEffect(()=>{setEditing(false);setFilter('')},[route.id,route.query.view])
  useEffect(()=>{
    if(!loading&&discover&&route.query.view==='recommended'){
      listing.current?.focus({preventScroll:true})
      listing.current?.scrollIntoView({block:'start'})
    }
  },[route.query.view,discover,loading])
  useEffect(()=>{
    let active=true, latest=0
    const load=async()=>{
      const number=++latest
      try{const data=await campusRequest<PlazaState>(user!,'/api/social/plaza');if(active&&number===latest){setBoard(data);setReadError('')}}
      catch(e){if(active&&number===latest)setReadError((e as Error).message)}
      finally{if(active&&number===latest)setLoading(false)}
    }
    void load()
    const refresh=()=>{if(!document.hidden)void load()}
    window.addEventListener('focus',refresh)
    const timer=window.setInterval(refresh,6500)
    return ()=>{active=false;window.removeEventListener('focus',refresh);clearInterval(timer)}
  },[uid,revision,showcase])
  const reports=useMemo(()=>sortedReports(repository.listReports(uid)),[uid,version])
  const mine=showcase?local.mine:board.mine
  const invites=[...board.invites,...(samples?local.invites:[])]
  const friends=invites.filter(i=>i.status==='accepted')
  const pending=countInvitations(invites)
  const all=[...board.cards,...(samples?buddySamples:[]),...(board.suggestions||[]).map(portraitCard)]
  const cards=all.filter(c=>(!recruit||!c.portraitOnly)&&(!filter||(c.post.subjects||[c.post.subject]).includes(filter))).map(peer=>({
    peer,tags:matchFacts(peer,board.profile,mine,userProfile?.targetBand,reports),
    shared:board.portrait&&peer.portrait?board.portrait.filter((value,i)=>value===peer.portrait![i]).length:null,
  }))
  if(discover) cards.sort((a,b)=>(b.shared??-1)-(a.shared??-1)||b.tags.length-a.tags.length)
  useEffect(()=>{
    const changed=(event:StorageEvent)=>{if(event.key===localKey(uid))setLocal(readLocal(uid,showcase))}
    window.addEventListener('storage',changed)
    return ()=>window.removeEventListener('storage',changed)
  },[uid,showcase])
  async function updateLocal(change:(latest:LocalBoard)=>LocalBoard|Promise<LocalBoard>) {
    const save=async()=>{
      const next=await change(readLocal(uid,showcase))
      localStorage.setItem(localKey(uid),JSON.stringify(next));setLocal(next)
    }
    if(navigator.locks)await navigator.locks.request(localKey(uid),save)
    else await save()
  }
  async function act(work:()=>Promise<void>,success:string) {
    if(lock.current)return
    lock.current=true;setBusy(true);setNotice('')
    try{await work();setNotice(success);setRevision(v=>v+1);refresh();window.dispatchEvent(new Event('campus-buddy-changed'))}catch(e){setNotice((e as Error).message)}
    finally{setBusy(false);lock.current=false}
  }
  function respond(inv:Invitation,accepted:boolean) {
    void act(async()=>{
      if (inv.other.startsWith('plaza-peer-')) {
        await updateLocal(async latest=>{
          const current=latest.invites.find(i=>i.other===inv.other)
          const status=accepted?'accepted':'declined'
          if(!current||current.status!=='pending'&&current.status!==status)throw Error('邀请状态已变化，请查看最新邀请。')
          if(current.incoming) await campusRequest(user!,'/api/social/growth',{action:'sample-invite',peer:inv.other,decision:status,eventId:inv.other})
          return {...latest,invites:latest.invites.map(i=>i.other===inv.other?{...i,status}:i)}
        })
      } else {
        await campusRequest(user!,'/api/social/invite',{action:accepted?'accept':'decline',other:inv.other})
        const updated=await campusRequest<PlazaState>(user!,'/api/social/plaza')
        setBoard(updated)
      }
    },accepted?'你们已经成为搭子。':'已婉拒这条邀请。')
  }
  function send(peer:BuddyCard) {
    void act(async()=>{
      if (peer.profile.id.startsWith('plaza-peer-')) {
        await updateLocal(latest=>latest.invites.some(i=>i.other===peer.profile.id)?latest:{...latest,invites:[{other:peer.profile.id,name:peer.profile.nickname,status:'pending',incoming:false},...latest.invites]})
      } else {
        if(!board.profile) await campusRequest(user!,'/api/social/profile',{nickname:user!.nickname})
        await campusRequest(user!,'/api/social/invite',{action:'send',other:peer.profile.id})
        const updated=await campusRequest<PlazaState>(user!,'/api/social/plaza')
        setBoard(updated)
      }
    },'已向'+peer.profile.nickname+'发出邀请。')
  }
  function openDesk(peer:string){go('campus/match?buddy='+encodeURIComponent(peer))}
  function openCard(peer:BuddyCard){
    const existing=invites.find(i=>i.other===peer.profile.id)
    if(!existing){send(peer);return}
    if(existing.status==='accepted'){openDesk(existing.other);return}
    setEditing(false);go('campus/partners')
  }
  if(route.query.buddy){
    const friend=invites.find(i=>i.other===route.query.buddy&&i.status==='accepted')
    if(friend)return <BuddySession key={friend.other} invite={friend} initial={all.find(c=>c.profile.id===friend.other)?.post.subject||'speaking'}/>
    return <section className="card buddy-plan">{loading ? null : <p role="status">{readError||'请先在搭子广场接受邀请，再一起约练。'}</p>}<button className="btn" onClick={()=>go('campus/match')}>返回搭子广场</button></section>
  }
  const title = partners?'我的搭子':recruit?'营地招募空间':'搭子广场'
  const introduction = partners?'处理邀请，约好练习后在这里汇合。':recruit?'看看深圳大学同学发布的找搭子需求，也可以贴出自己的招募。':'看看同校同学想练什么，按共同时间、强弱项和练习偏好找人。'
  const startQuiz=()=>{setEditing(false);go('campus/partner?view=portrait')}
  const focusListing=()=>{
    setFilter('')
    requestAnimationFrame(()=>{listing.current?.focus({preventScroll:true});listing.current?.scrollIntoView({block:'start'})})
  }
  const openRecruit=()=>{setEditing(false);go('campus/recruit')}
  const openInvitations=()=>{setEditing(false);go('campus/partners')}
  return <div className="buddy-plaza camp-page">
    {readError&&<div className="buddy-note" role="alert">{readError} <button className="btn btn-sm" onClick={()=>setRevision(v=>v+1)}>重新读取广场</button></div>}
    {notice&&<p role="status" className="buddy-note">{notice}</p>}
    {quiz && loading ? null : quiz ? <BuddyPortrait saved={board.portrait} busy={busy} onClose={()=>go('campus/partner')} onSave={answers=>void act(async()=>{
      await campusRequest(user!,'/api/social/plaza',{action:'portrait',answers,nickname:user!.nickname})
      setBoard(old=>({...old,portrait:answers}))
      go('campus/partner?view=recommended')
    },'画像已保存，推荐已按你的偏好更新。')}/> : <>
    {!discover&&<nav className="buddy-subnav" aria-label="搭子导航"><button className="buddy-back" onClick={()=>go('campus/partner')}>← 搭子广场</button>
      {recruit?<button className="buddy-back" onClick={openInvitations}>我的搭子与邀请{pending?' · '+pending:''} →</button>:<button className="buddy-back" onClick={openRecruit}>营地招募空间 →</button>}</nav>}
    <div className="camp-head buddy-page-head">
      <div><h1>{title}</h1><p>{introduction}</p></div>
      {partners ? <div className="camp-head-stats"><div><b className={pending?'has-dot':''}>{pending}</b><span>待处理</span></div><div><b>{friends.length}</b><span>已成搭子</span></div></div> :
        <button type="button" ref={header} className="btn btn-primary" aria-expanded={editing} disabled={busy} onClick={()=>setEditing(!editing)}>{mine?'编辑我的需求':'发布找搭子需求'}</button>}
    </div>
    {discover&&<nav className="partner-hub buddy-hub-tools" aria-label="寻找搭子">
      <button className="hub-btn" type="button" onClick={startQuiz} disabled={loading}><BuddyHubIcon name="user"/><b>{board.portrait?'更新个人画像':'生成个人画像'}</b><small>六道题，约一分钟</small></button>
      <button className="hub-btn primary" type="button" onClick={focusListing}><BuddyHubIcon name="radar"/><b>发现同学</b><small>{board.portrait?'按画像与共同空档推荐':'查看同校练习卡片'}</small></button>
      <button className="hub-btn" type="button" onClick={openRecruit}><BuddyHubIcon name="users"/><b>营地招募空间</b><small>按科目找练习需求</small></button>
      <button className="hub-btn" type="button" aria-label={'我的邀请'+(pending?' · '+pending+' 条待处理':'')} onClick={openInvitations}><BuddyHubIcon name="send"/><b>我的搭子与邀请</b><small>{pending?pending+' 条待处理':'约练与练后交流'}</small>{pending>0&&<i className="hub-dot" aria-hidden="true"/>}</button>
    </nav>}
    {discover&&board.portrait&&<div className="buddy-portrait-strip"><b>我的画像</b><div>{portraitTags(board.portrait).map(tag=><span key={tag}>{tag}</span>)}</div></div>}
    {editing && !partners && <Composer mine={mine} profile={board.profile} nickname={user!.nickname} target={userProfile?.targetBand || 6.5} reports={reports} busy={busy}
      onClose={closeEditor} onSave={p=>act(async()=>{
        if(showcase)await updateLocal(latest=>({...latest,mine:p}))
        else {
          await campusRequest(user!,'/api/social/plaza',{action:'publish',nickname:user!.nickname,...p})
          setBoard(old=>({...old,mine:p}))
        }
        closeEditor()
      },mine?'需求已更新。':'你的找搭子需求已发布。')}/>}
    {mine && (!editing||partners) && <article className="buddy-own"><div><small>我的需求 · 已发布</small><h3>{(mine.subjects||[mine.subject]).map(s=>skillNames[s]).join('、')} · {mine.slot}{mine.target>0?' · 目标 '+mine.target:''}</h3><p>{mine.message}</p>{mine.summary&&<small>测评摘要 · {mine.summary}</small>}</div>
      <button className="btn btn-sm" disabled={busy} onClick={()=>{void act(async()=>{
        if(showcase)await updateLocal(latest=>({...latest,mine:null}))
        else {await campusRequest(user!,'/api/social/plaza',{action:'withdraw'});setBoard(old=>({...old,mine:null}))}
      },'需求已从广场撤下。')}}>撤下需求</button></article>}
    {partners ? <BuddyRelations invites={invites} busy={busy} respond={respond} openDesk={openDesk} discover={()=>go('campus/partner')}/> :
      <section aria-label="同学校园需求"><div className="buddy-tools"><h3 ref={listing} tabIndex={-1}>{discover?'为你推荐的同学':'同学的招募帖'} <small>{cards.length}</small></h3>
        <div className="buddy-filters" aria-label="练习科目">{(['',...skills] as const).map(s=><button key={s} aria-pressed={filter===s} onClick={()=>setFilter(s)}>{s?skillNames[s]:'全部'}</button>)}</div>
      </div>
      {cards.length ? <div className="buddy-grid">{cards.map(({peer,tags,shared})=><PeerCard key={peer.profile.id} peer={peer} tags={tags} shared={shared} busy={busy} onInvite={()=>openCard(peer)} invite={invites.find(i=>i.other===peer.profile.id)}/>)}</div>
        : loading ? null : <p className="card">这个科目目前没有公开需求，你可以发布第一条。</p>}
      {samples && <p className="buddy-hint">广场含校园演示资料，可体验邀请和回应。</p>}
    </section>}
    </>}
  </div>
}


