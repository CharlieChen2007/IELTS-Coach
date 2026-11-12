import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext'
import { useAuth, type AuthUser } from '../auth'
import { SUBJECT_META, SUBJECT_ORDER, type Subject } from '../contract'
import { api, focusAreas, localTime, sendWithClip, status, type Detail, type Slot, type Summary } from './ClinicData'
import { ReplyExchange } from './ReplyExchange'
import { ClipPicker, PrivateClip } from './ClinicAudio'
import { IssueChecks } from './ClinicEvidence'
import { campusRequest, type SchoolProfile } from './SocialApi'
import { CampusExamples, CampusExampleDetail, sampleSubject, clinicLink, exampleList, exampleVisits, HelpCard, type Section } from './CampusExamples'
import { SubjectPeerSupport } from './ClinicEvidence'
export { ClinicEvidenceActions } from './ClinicEvidence'
import './Clinic.css'

type Tab='help'|'clinic'
function link(tab:Tab,id?:string){return clinicLink(tab,'case',id)}
function range(start:number){return localTime(start)+' – '+localTime(start+900000).split(' ').at(-1)}
function useOperation(){
 const lock=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function run(job:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await job()}catch(err){setError((err as Error).message)}finally{lock.current=false;setBusy(false)}}
 return {busy,error,run}
}
function Alert({msg}:{msg:string}){
 const {go}=useApp()
 return msg?<div className="clinic-error" role="alert">{msg} {(/加入深圳大学校园|校园工作区/.test(msg))&&<button className="btn btn-sm" onClick={()=>go('profile/campus')}>前往校园资料</button>}</div>:null
}
function BoardList({rows,tab}:{rows:Summary[];tab:Tab}){
 const {go,route}=useApp()
 return <>{rows.map(r=><HelpCard key={r.id} subject={r.subject} name={r.ownerName+(r.mine?'（我）':'')} area={localTime(r.created)}
   title={r.title} topic={r.issues.join(' · ')} status={status(r)} onClick={()=>go(clinicLink(tab,'case',r.id,route.query))}/>)}</>
}
function SlotDesk({slots,strong,user,reload,examples}:{slots:Slot[];strong:Subject[];user:AuthUser;reload:()=>Promise<void>;examples:boolean}){
 const {go}=useApp(),{busy,error,run}=useOperation()
 const [show,setShow]=useState(false),[focus,setFocus]=useState(''),[date,setDate]=useState(''),[time,setTime]=useState('18:00')
 const [place,setPlace]=useState('图书馆一楼咨询区')
 const quarterHours=Array.from({length:96},(_,i)=>String(Math.floor(i/4)).padStart(2,'0')+':'+String((i%4)*15).padStart(2,'0'))
 async function publish(){
   const start=new Date(date+'T'+time+':00+08:00').valueOf()
   await api(user,'slots',{subject:'speaking',start,focus:focus.trim(),place});setFocus('');setShow(false);await reload()
 }
 const mine=slots.filter(s=>s.mine&&s.start>Date.now()&&!s.caseId)
 const visits=slots.filter(s=>s.caseId)
 const demoVisits=examples?exampleVisits(user.userId):[]
 return <><section className="card clinic-surface"><div className="clinic-heading"><div><h3>我的预约</h3><p>每次 15 分钟，以北京时间显示。</p></div>
 <button className="btn btn-sm" aria-expanded={show} onClick={()=>setShow(!show)}>{show?'收起排班':'开放学伴时段'}</button></div>
 {show&&(strong.length?<form className="clinic-form" onSubmit={e=>{e.preventDefault();void run(publish)}}>
 <label>口语指导方向<input className="input" value={focus} onChange={e=>setFocus(e.target.value)} required maxLength={70} placeholder={focusAreas.speaking.join(' / ')}/></label>
 <div className="clinic-fields"><label>日期（北京时间）<input className="input" type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
 <label>开始时间<select className="select" value={time} onChange={e=>setTime(e.target.value)}>{quarterHours.map(h=><option key={h}>{h}</option>)}</select></label></div>
 <label>见面地点或线上方式（预约后双方可见）<input className="input" value={place} onChange={e=>setPlace(e.target.value)} required maxLength={180} placeholder="例如：图书馆一楼咨询区"/></label>
 <button className="btn btn-primary" disabled={busy}>发布 15 分钟时段</button></form>:<p>请先在个人空间的校园资料里将口语列为擅长科目。 <button className="btn btn-sm" onClick={()=>go('profile/campus')}>编辑校园资料</button></p>)}
 <Alert msg={error}/>{visits.length||demoVisits.length?<div className="clinic-list">{visits.map(s=><button key={s.id} onClick={()=>go(link('clinic',s.caseId!))}><b>{range(s.start)} · {s.focus}</b><small>{s.mine?'我提供指导':'学伴 '+s.mentorName} · {s.state==='consulted'?'已给出建议':'已预约'}</small></button>)}{demoVisits.map(v=><button key={v.id} onClick={()=>go(clinicLink('clinic','example',v.id))}><b>{v.booking} · {v.focus}</b><small>{v.mentor} · {v.take?'已复练':'待语音复练'} · 演示预约</small></button>)}</div>:<p className="clinic-empty">还没有预约。先从练习或报告中选择要解决的问题。</p>}
 {mine.length>0&&<details><summary>我开放的时段（{mine.length}）</summary>{mine.map(s=><div className="clinic-slot" key={s.id}><span>{range(s.start)} · {s.focus}</span><button className="btn btn-sm" disabled={busy} onClick={()=>run(async()=>{await api(user,'withdraw',{slotId:s.id});await reload()})}>撤下</button></div>)}</details>}</section></>
}
function CaseView({user,id,tab}:{user:AuthUser;id:string;tab:Tab}){
 const {go,route}=useApp(),[row,setRow]=useState<Detail|null>(null),[slots,setSlots]=useState<Slot[]>([]),[loadError,setLoadError]=useState('')
 const [picked,setPicked]=useState<string[]>([]),[slot,setSlot]=useState(''),[revision,setRevision]=useState(''),[audio,setAudio]=useState<Blob|null>(null)
 const {busy,error,run}=useOperation()
 const [recording,setRecording]=useState(false)
 const generation=useRef(0)
 const load=useCallback(async()=>{
   const sequence=++generation.current
   try{
     const detail=await api<Detail>(user,'case?id='+encodeURIComponent(id))
     if(sequence!==generation.current)return
     setRow(detail);setLoadError('')
     if(detail.subject==='speaking'&&detail.mine&&!detail.visit&&!detail.revised&&!detail.resolved){
       const available=await api<{slots:Slot[]}>(user,'slots')
       if(sequence===generation.current)setSlots(available.slots.filter(s=>s.subject===detail.subject&&!s.mine&&!s.caseId&&s.start>Date.now()))
     }else setSlots([])
   }catch(err){if(sequence===generation.current)setLoadError((err as Error).message)}
 },[id,user.userId])
 useEffect(()=>{const update=()=>{if(!document.hidden)void load()};update();const t=window.setInterval(update,16000);return()=>{generation.current++;window.clearInterval(t)}},[load])
 useEffect(()=>{if(row)setPicked(row.issues)},[row?.id])
 async function mutate(op:string,body:object={}){
   let result:{visit?:Detail['visit']}
   try{result=await api(user,op,{id,...body})}
   catch(err){if((err as {status?:number}).status===409)await load();throw err}
   ++generation.current
   if(op==='claim')setRow(prev=>prev&&({...prev,claimed:true,helper:true,helperName:user.nickname}))
   if(op==='book'&&result.visit){const visit=result.visit;setRow(prev=>prev&&({...prev,visit,visitState:visit.state}))}
   if(op==='cancel')setRow(prev=>prev&&({...prev,visit:null,visitState:null,mentor:false}))
   if(op==='resolve')setRow(prev=>prev&&({...prev,resolved:true}))
   await load()
 }
 async function publish(op:'reply'|'advice',text:string){
   try{await api(user,op,{id,text})}
   catch(err){if((err as {status?:number}).status===409)void load();throw err}
   ++generation.current
   setRow(prev=>!prev?prev:op==='reply'?{...prev,reply:text,replied:true}
     :{...prev,visitState:'consulted',visit:prev.visit&&{...prev.visit,advice:text,state:'consulted'}})
   void load()
 }
 const back=<button className="btn btn-quiet" type="button" onClick={()=>go(clinicLink(tab,undefined,undefined,route.query))}>← {tab==='clinic'?'口语诊所':'同校互助单'}</button>
 if(!row)return <section className="card clinic-surface">{back}{loadError?<><Alert msg={loadError}/><button className="btn btn-sm" onClick={()=>load().catch(e=>setLoadError(e.message))}>重试</button></>:null}</section>
 const available=[...slots].sort((a,b)=>rating(b)-rating(a)||a.start-b.start)
 function rating(s:Slot){return picked.filter(i=>s.focus.includes(i)||i.includes(s.focus)).length}
 const participant=row.mine||row.helper||row.mentor
 const canClaim=!row.private&&!row.mine&&!row.claimed&&!row.revised&&!row.resolved
 const canReply=row.helper&&!row.replied&&!row.revised&&!row.resolved
 const canConsult=row.mentor&&row.visit?.state==='booked'&&!row.revised&&!row.resolved
 const next=row.resolved?'已解决，练前和练后的作答已保存。':row.revised?'已复练，练前和练后的作答可在上方对照。':row.visit?.state==='booked'?'等待本次预约的指导建议。':row.mine?'下一步，按建议完成同题复练。':'等待'+row.ownerName+'根据建议复练。'
 return <div className="clinic-page">{back}<section className="card clinic-surface"><div className="clinic-heading"><div><p>{SUBJECT_META[row.subject].label} · {row.ownerName}{row.mine?'（我）':''}</p><h2>{row.title}</h2></div><span className="chip primary">{status(row)}</span></div>
 <div className="clinic-tags">{row.issues.map(s=><span className="chip" key={s}>{s}</span>)}</div>{row.note&&<p>{row.note}</p>}
 <div className="clinic-excerpt"><b>原题</b><p>{row.prompt}</p></div>{participant?<div className="clinic-compare"><div><h3>练前作答</h3>{(row.original||!row.hasAudio)&&<p>{row.original||'尚无原作答'}</p>}
 {row.hasAudio&&(row.mine||row.helper||row.mentor)&&<PrivateClip user={user} id={id}/>}</div>
 {row.after&&<div><h3>练后作答</h3><p>{row.after.text||'语音作答'}</p>{row.after.hasAudio&&<PrivateClip user={user} id={id} after/>}<small>{localTime(row.after.at)}</small></div>}</div>:<p className="small muted">{canClaim?'认领后可查看同学的练前作答。':'作答和反馈仅参与这张互助单的同学可见。'}</p>}
 {canClaim&&<button className="btn btn-primary" disabled={busy} onClick={()=>run(()=>mutate('claim'))}>认领并查看作答</button>}
 {row.claimed&&!row.replied&&<p className="small muted">认领学伴 · {row.helperName}</p>}
 <ReplyExchange text={row.reply} title={row.helper?'我的回复':row.helperName+'的回复'} next={next}
   label={'给'+row.ownerName+'的解答'} placeholder="指出依据，并给出一个可直接尝试的改法" button="发布回复"
   publish={canReply?text=>publish('reply',text):undefined}/></section>
 {row.visit&&<section className="card clinic-surface"><h3>15 分钟口语诊所</h3><p><strong>{range(row.visit.start)}</strong> · 北京时间</p><p>{row.visit.mentorName} · {row.visit.focus}</p><p>本次讨论 · {row.visit.issues.join('、')}</p>
 {row.visit.place&&<p><b>见面方式</b> · {row.visit.place}</p>}
 <ReplyExchange text={row.visit.advice} title={row.mentor?'我的指导建议':row.visit.mentorName+'的指导建议'} next={next}
   label="诊所建议" placeholder="写下对这次作答的具体观察和复练任务" button="发送指导建议"
   publish={canConsult?text=>publish('advice',text):undefined}/>
 {row.visit.state==='booked'&&(row.mine||row.mentor)&&<button className="btn btn-sm" disabled={busy} onClick={()=>run(()=>mutate('cancel'))}>取消这次预约</button>}</section>}
 {row.subject==='speaking'&&row.mine&&!row.visit&&!row.revised&&!row.resolved&&<details className="card clinic-surface" open={tab==='clinic'||undefined}><summary>为这份作答预约口语诊所</summary>
 <fieldset><legend>本次想讨论的问题</legend><IssueChecks items={row.issues} selected={picked} change={setPicked}/></fieldset>
 {available.length?<form className="clinic-form" onSubmit={e=>{e.preventDefault();void run(()=>mutate('book',{slotId:slot,issues:picked}))}}><label>同校{SUBJECT_META[row.subject].label}学伴 · 15 分钟<select className="select" value={slot} onChange={e=>setSlot(e.target.value)} required><option value="">选择学伴与时间</option>{available.map(s=><option key={s.id} value={s.id}>{localTime(s.start)} · {s.mentorName} · {s.focus}{rating(s)?' · 匹配所选问题':''}</option>)}</select></label><button className="btn btn-primary" disabled={busy||!picked.length||!slot}>确认预约</button></form>:<p className="clinic-empty">当前没有同校学伴为本科目开放时段。可稍后回到这里预约。</p>}</details>}
 {row.mine&&row.visit?.state!=='booked'&&(row.reply||row.visit?.advice)&&!row.revised&&!row.resolved&&<section className="card clinic-surface"><h3>按反馈完成同题复练</h3><p>{row.prompt}</p><form className="clinic-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await sendWithClip(user,'revise',{id,text:revision},audio);++generation.current;setRow(prev=>prev&&({...prev,revised:true,after:{text:revision,hasAudio:Boolean(audio),at:Date.now()}}));await load()})}}>
 {row.subject!=='speaking'&&<label>我的新作答<textarea className="textarea" required={!audio} value={revision} maxLength={10000} onChange={e=>setRevision(e.target.value)} placeholder="根据学伴的建议重新作答"/></label>}{row.subject==='speaking'&&<ClipPicker value={audio} onChange={setAudio} onBusyChange={setRecording}/>}<button className="btn btn-primary" disabled={busy||recording||(row.subject==='speaking'&&!audio)}>保存复练并对照</button></form></section>}
 {row.mine&&row.visit?.state!=='booked'&&row.after&&!row.resolved&&<button className="btn btn-primary" disabled={busy} onClick={()=>run(()=>mutate('resolve'))}>标记已解决</button>}<Alert msg={error||loadError}/></div>
}
function Hub({user,tab,member,examples,requireMember=false,preset=null}:{user:AuthUser;tab:Tab;member:boolean;examples:boolean;requireMember?:boolean;preset?:Subject|null}){
 const {go,replace,route}=useApp(),[rows,setRows]=useState<Summary[]>([]),[slots,setSlots]=useState<Slot[]>([]),[strong,setStrong]=useState<Subject[]>([]),[error,setError]=useState(''),[loaded,setLoaded]=useState(false)
 const filter=tab==='help'&&SUBJECT_ORDER.includes(route.query.subject as Subject)?route.query.subject:preset??'all'
 const me=tab==='help'&&route.query.mine==='1'
 const setFilter=(subject:string, mine=me)=>(replace||go)(clinicLink('help',undefined,undefined,{subject,mine:mine?'1':''}))
 const load=useCallback(async()=>{
  const board=await api<{rows:Summary[]}>(user,'board')
  if(tab==='clinic'){const result=await api<{slots:Slot[];strong:Subject[]}>(user,'slots');setSlots(result.slots.filter(s=>s.subject==='speaking'));setStrong(result.strong.filter(s=>s==='speaking'))}
  setRows(board.rows);setLoaded(true);setError('')
 },[user.userId,tab])
 useEffect(()=>{if(!member)return;let active=true;const update=()=>{if(active&&!document.hidden)load().catch(e=>{if(active)setError(e.message)})};update();const timer=window.setInterval(update,20000);return()=>{active=false;clearInterval(timer)}},[load,member])
 const list=rows.filter(r=>(tab==='clinic'?r.mine&&r.subject==='speaking'&&r.private:!r.private)&&(!me||r.mine||r.helper)&&(filter==='all'||r.subject===filter))
 const samples=examples&&tab==='help'?exampleList(user.userId,filter,me):[]
 const total=list.length+samples.length
 return <div className="clinic-page"><section className="card clinic-surface hall-intro"><div>
 <h2>{tab==='clinic'?'口语诊所':'同校雅思互助单'}</h2>
 <p>{tab==='clinic'?'约学伴练 15 分钟，回听原声，带着一条具体建议再说一次。':'带一道具体的题来，和同学一起找依据、改作答。'}</p></div>
 <div className="clinic-actions">{(tab==='help'?SUBJECT_ORDER:['speaking'] as Subject[]).map(s=><button className={tab==='clinic'?'btn btn-primary':'btn btn-sm'} key={s} onClick={()=>go('subject/'+s+'?view=peers&action='+tab)}>{tab==='help'?'发'+SUBJECT_META[s].label+'互助单':'用我的录音预约'}</button>)}</div></section>
 {error&&<section className="card clinic-surface"><Alert msg={error}/><button className="btn btn-sm" onClick={()=>load().catch(e=>setError(e.message))}>刷新</button></section>}
 {member&&!loaded&&!error&&null}
 {/* 未加入校园时，「发互助单 / 认领」这类动作本来就会失败；先把入口收起来，只留一条加入路径，
     比让人点进去撞一次错误提示要清楚。 */}
 {requireMember&&!member&&<section className="card clinic-surface"><h3>加入深圳大学校园后可用</h3>
 <p>互助单与诊所预约只在同校同学之间转，需要先保存校园昵称与校区。</p>
 <button className="btn btn-primary" onClick={()=>go('profile/campus')}>填写校园资料</button></section>}
 {tab==='clinic'&&examples&&<section className="card clinic-surface"><div className="clinic-heading"><h3>选一个方向跟练</h3><small>演示预约 · 可直接体验</small></div><CampusExamples userId={user.userId} tab={tab}/></section>}
 {tab==='clinic'&&member&&loaded&&<SlotDesk user={user} slots={slots} strong={strong} reload={load} examples={examples}/>}
 {tab==='clinic'&&!member&&!requireMember&&<section className="card clinic-surface"><div className="clinic-heading"><div><h3>开放我的指导时段</h3><p>在个人空间填写口语特长后，可以给同校同学提供指导。</p></div><button type="button" className="btn btn-sm" onClick={()=>go('profile/campus')}>填写校园资料</button></div></section>}
 {(tab==='help'||(loaded&&list.length>0))&&<section className="card clinic-surface"><div className="clinic-heading"><div className="hall-count"><h3>{tab==='clinic'?'我的诊所记录':'校园互助大厅'}</h3><span>{total} 单</span></div>
 {tab==='help'&&<div className="clinic-actions hall-filters"><select aria-label="按科目筛选" className="select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部科目</option>{SUBJECT_ORDER.map(s=><option key={s} value={s}>{SUBJECT_META[s].label}</option>)}</select>
 <label><input type="checkbox" checked={me} onChange={e=>setFilter(filter,e.target.checked)}/> 我参与的</label></div>}</div>
 {examples&&tab==='help'&&!me&&<p className="hall-note">大厅包含校园演示案例，可认领并留言。</p>}
 <div className="help-grid"><BoardList rows={list} tab={tab}/>{samples.length>0&&<CampusExamples userId={user.userId} tab={tab} filter={filter} mine={me}/>}</div>
 {total===0&&<p className="clinic-empty">{me?'还没有参与这个科目的互助。去大厅认领一单，回复后可以回来查看。':'当前筛选下没有互助记录。'}</p>}</section>}
 </div>
}
export function ClinicPage({tab, section, showNavigation=true}:{tab:Tab; section?:Section; showNavigation?:boolean}) {
 const {user,showcase}=useAuth(), {route,go}=useApp()
 const [membership,setMembership]=useState<'loading'|'guest'|'member'>('loading')
 const [error,setError]=useState(''), [retry,setRetry]=useState(0)
 useEffect(()=>{
   if(!user)return
   let active=true
   setMembership('loading')
   setError('')
   campusRequest<{profile:SchoolProfile|null}>(user,'/api/social/me')
     .then(({profile})=>{if(active)setMembership(profile?'member':'guest')})
     .catch((err:Error)=>{if(active)setError(err.message)})
   return ()=>{active=false}
 },[user?.userId,retry])
 if(!user)return null
 const demo=showcase
 const example=demo ? sampleSubject(tab,route.query.example) : null
 /* 口语板块里的这一页同时承担两件事：看诊（clinic）与同校互助单（help）。
    传了 section 就说明是口语板块在调用，两个子页签常驻；campus/help 那条全科大厅的路由
    不传 section，仍旧只是大厅，不会冒出这两个口语专用页签。 */
 const inSubject=section!==undefined
 const tabs=inSubject&&showNavigation?<nav className="clinic-section-tabs workspace-secondary" aria-label="口语诊所与互助单">
   <button type="button" className={tab==='clinic'?'on':''} aria-current={tab==='clinic'?'page':undefined}
     onClick={()=>{if(tab!=='clinic')go('subject/speaking?view=clinic')}}>口语诊所</button>
   <button type="button" className={tab==='help'?'on':''} aria-current={tab==='help'?'page':undefined}
     onClick={()=>{if(tab!=='help')go('subject/speaking?view=clinic&section=help')}}>同校互助单</button>
 </nav>:null
 /* 互助视图支持按科目筛选（subject=），四个板块的「学伴互助」都指向这里。 */
 if(example)return <>{tabs}<CampusExampleDetail key={user.userId+tab+example} userId={user.userId} tab={tab} subject={example}/></>
 const preset=inSubject&&SUBJECT_ORDER.includes(route.query.subject as Subject)?(route.query.subject as Subject):null
 const body = demo&&!route.query.case ? <>{error&&<div className="clinic-error" role="status">暂时无法同步个人校园记录。 <button className="btn btn-sm" onClick={()=>setRetry(n=>n+1)}>重新连接</button></div>}
   <Hub key={user.userId+tab+preset} user={user} tab={tab} member={membership==='member'} examples requireMember={inSubject} preset={preset}/></>
   : error ? <section className="card clinic-surface"><Alert msg={error}/><button className="btn btn-sm" onClick={()=>setRetry(n=>n+1)}>重新加载</button></section>
   : membership==='loading' ? null
    : membership==='guest' && inSubject ? <Hub key={user.userId+tab+preset} user={user} tab={tab} member={false} examples={false} requireMember preset={preset}/>
   : membership==='guest' ? <section className="card clinic-surface"><h3>加入深圳大学校园</h3><p>在个人空间保存校园昵称后，即可参与互助和预约。</p><JoinProfileLink/></section>
   : route.query.case ? <CaseView key={user.userId+route.query.case} id={route.query.case} user={user} tab={tab}/>
   : <Hub key={user.userId+tab+preset} user={user} tab={tab} member examples={false} requireMember={inSubject} preset={preset}/>
 /* 口语板块里的「同校互助单」直接用四科共用的互助页（SubjectPeerSupport），
    和读、写、听长得一模一样：同一个标题格式、同一个发单按钮、同一份大厅列表。
    只有「在哪一页里、点关闭回哪」不同，那属于外壳，由这里的二级页签承担。 */
 if(inSubject)return <>{tabs}{section==='help'?<SubjectPeerSupport subject="speaking"/>:body}</>
 return body
}


function JoinProfileLink(){const {go}=useApp();return <button className="btn btn-sm" onClick={()=>go('profile/campus')}>填写校园资料</button>}
