import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../auth'
import { toHash, useApp } from '../appContext'
import { Card, CardHead } from '../components'
import { repository } from '../repository'
import { hasCampusPractice } from './SocialPractice'
import { campusRequest, skills, slots, skillNames, type Skill, type SchoolProfile } from './SocialApi'
import './Social.css'

type SocialTab='verify'|'points'|'rank'|'challenge'
type Rank={rows:{name:string;points:number;rank:number;self:boolean}[];self:{rank:number;points:number}|null}
type Team={id:string;name:string;kind:string;points:number;members:{name:string;self:boolean;skills:Skill[]}[]}
type Challenge={mine:Team|null;leaderboard:Rank;week:number}
type Points={total:number;entries:{id:number;subject:Skill;label:string;category:string;points:number;created:number;report?:string;reason?:string}[];next:number|null}
const date=(time:number)=>new Date(time).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'})
function Shell({title,desc,children}:{title:string;desc?:string;children:ReactNode}){
  return <section className="card social-card"><header><h2>{title}</h2>{desc&&<p>{desc}</p>}</header>{children}</section>
}
function SelectTags({all,value,onChange,label}:{all:string[];value:string[];onChange:(v:string[])=>void;label?:(s:string)=>string}){
  return <div className="social-tags">{all.map(s=><button type="button" key={s} aria-pressed={value.includes(s)} onClick={()=>onChange(value.includes(s)?value.filter(x=>x!==s):[...value,s])}>{label?label(s):s}</button>)}</div>
}
const labelSkill=(s:string)=>skillNames[s as Skill]
export function CampusProfileForm({member,onSaved}:{member:SchoolProfile|null;onSaved:()=>void}){
  const {user,profile}=useAuth()
  const [nickname,setNickname]=useState(member?.nickname||user!.nickname)
  const [level,setLevel]=useState(member?.level?.toString()||''),[target,setTarget]=useState(member?.target?.toString()||profile?.targetBand?.toString()||'')
  const [strong,setStrong]=useState<string[]>(member?.strong||[]),[need,setNeed]=useState<string[]>(member?.need||[]),[free,setFree]=useState<string[]>(member?.slots||[])
  const [day,setDay]=useState('周一')
  const [busy,setBusy]=useState(false),[note,setNote]=useState('')
  async function submit(e:FormEvent){e.preventDefault();if(busy)return;setBusy(true);setNote('')
    try{
      const preferences={level:level?Number(level):null,target:target?Number(target):null,strong,need,slots:free}
      await campusRequest(user!,'/api/social/profile',{nickname:nickname.trim(),...preferences});onSaved()
    }
    catch(e){setNote((e as Error).message)}finally{setBusy(false)}}
  return <Shell title="我的校园资料" desc="深圳大学 · 同学在搭子广场、互助单和小队里会看到这个昵称。">
    <form className="social-form" onSubmit={submit}>
      <label className="social-nickname">校园昵称<input className="input" value={nickname} onChange={e=>setNickname(e.target.value)} maxLength={24} required autoComplete="nickname"/></label>
      <section className="social-preferences" aria-labelledby="social-preference-title">
      <h3 id="social-preference-title">搭子偏好 <small>选填</small></h3>
      <div className="social-cols">
        <label>自评水平<input className="input" type="number" min="1" max="9" step="0.5" value={level} placeholder="例如 5.5" onChange={e=>setLevel(e.target.value)}/></label>
        <label>目标分<input className="input" type="number" min="1" max="9" step="0.5" value={target} placeholder="例如 7" onChange={e=>setTarget(e.target.value)}/></label>
      </div>
      <fieldset><legend>我擅长的科目</legend><SelectTags all={skills} label={labelSkill} value={strong} onChange={setStrong}/></fieldset>
      <fieldset><legend>我想求助的科目</legend><SelectTags all={skills} label={labelSkill} value={need} onChange={setNeed}/></fieldset>
      <fieldset><legend>我有空的时段</legend><div className="availability-days">{['一','二','三','四','五','六','日'].map(d=><button type="button" key={d} aria-pressed={day==='周'+d} onClick={()=>setDay('周'+d)}>周{d}{free.some(s=>s.startsWith('周'+d))&&<i aria-label="有空闲时段"/>}</button>)}</div>
        <SelectTags all={slots.filter(s=>s.startsWith(day))} label={s=>s.slice(2)} value={free} onChange={setFree}/>
        {free.length>0&&<small className="availability-summary">已选 {slots.filter(s=>free.includes(s)).join('、')}</small>}</fieldset>
      </section>
      <div><button className="btn btn-primary" disabled={busy||!nickname.trim()}>{busy?'保存中':member?'保存资料':'加入校园'}</button></div>
      {note&&<p role="alert">{note}</p>}
    </form></Shell>
}
function Rankings({rank,unit='分'}:{rank:Rank;unit?:string}){
  if(!rank.rows.length)return <p className="social-empty">本周还没有符合条件的上榜记录。</p>
  return <ol className="social-ranks">{rank.rows.map((r,i)=><li key={i} className={r.self?'social-self':''}><span>#{r.rank}</span><b>{r.name}{r.self?'（我）':''}</b><strong>{r.points} {unit}</strong></li>)}</ol>
}
function WeeklyRank({ board, points, subject, select, loading, demoBoard }: {
  board: Rank; points: Points | null; subject: Skill | ''; select: (skill: Skill | '') => void; loading: boolean; demoBoard: boolean
}) {
  const own = board.self
  return <section className="camp-page weekly-rank">
    <header className="camp-head">
      <div><h1>深圳大学 · 本校周榜</h1><p>每周一开始新一轮，按本周学习和互助积分排名。</p></div>
      <div className="camp-head-stats">
        <div><b>{points?.total ?? 0}</b><span>我的累计积分</span></div>
        <div><b>{own?.points ?? 0}</b><span>{subject ? labelSkill(subject) : '本周'}积分</span></div>
        <div><b>{own?.rank ?? '—'}</b><span>当前榜单名次</span></div>
      </div>
    </header>
    <div className="weekly-rank-body">
      <Card><CardHead title="校内积分榜" hint={demoBoard ? '含校园演示记录' : '同分并列'} />
        <div className="social-tags" aria-label="周榜科目">{(['', ...skills] as const).map(s =>
          <button key={s} aria-pressed={subject === s} onClick={() => select(s)}>{s ? labelSkill(s) : '总榜'}</button>)}</div>
        <div aria-busy={loading} className="weekly-rank-entries">
          {board.rows.length ? <ol className="rank-list">{board.rows.map((row, i) =>
            <li key={i} className={'rank-row' + (row.self ? ' me' : '')}>
              <span className={'rank-no r' + row.rank}>{row.rank}</span>
              <span className="avatar sm" aria-hidden="true">{Array.from(row.name)[0]}</span>
              <b>{row.name}{row.self && <em className="me-tag">我</em>}</b>
              <span className="rank-pts">{row.points}<small>分</small></span>
            </li>)}</ol> : <p className="social-empty">本周暂无积分。完成一次报告里的专项复练，就能参与排名。</p>}
        </div>
      </Card>
      <aside>
        <Card><CardHead title="怎样获得积分" />
          <div className="points-rule">完成报告中的有效专项复练<b>+5</b></div>
          <div className="points-rule">帮同学解决互助单或完成诊所复练<b>+5</b></div>
          <p className="small muted">同一项只记一次。专项复练每人每科每天最多计五次。</p>
        </Card>
        <Card><CardHead title="最近入账" extra={<a href={toHash('campus/points')}>全部明细 →</a>}/>
          {(points?.entries.length ?? 0) > 0 ? points!.entries.slice(0,5).map(p =>
            <div className="pt-row" key={p.id}><span>{p.label}</span><b>+{p.points}</b><small>{date(p.created)}</small></div>)
            : <p className="small muted">首次获得积分后，这里会显示来源。</p>}
        </Card>
      </aside>
    </div>
  </section>
}
function Roster({team,subject}:{team:Team;subject?:Skill}){
  return <div className="social-roster">{team.members.map((m,i)=><div key={i}><b>{m.name}{m.self?'（我）':''}</b><span>{skills.map(s=><i key={s} data-current={subject===s} data-done={m.skills.includes(s)}>{skillNames[s]} {m.skills.includes(s)?'✓':'—'}</i>)}</span></div>)}</div>
}
function SquadTasks({team}:{team:Team}){
  const {user}=useAuth(),{go}=useApp()
  const mine=team.members.find(m=>m.self)
  if(!user||!mine)return null
  const pending=skills.filter(skill=>!mine.skills.includes(skill))
  if(!pending.length)return <p className="squad-tasks-complete">✓ 你的四科周任务已全部完成</p>
  const reports=repository.listReports(user.userId).filter(hasCampusPractice).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  const labels={listening:'听力纠错',speaking:'口语复练',reading:'阅读定位',writing:'作文修改'}
  return <section className="squad-tasks"><b>我的待完成任务</b><p>在练习报告里完成一项专项复练，即可点亮对应科目。</p>
    <div>{pending.map(skill=>{
      const report=reports.find(r=>r.subject===skill)
      return <button key={skill} type="button" className="btn btn-sm" onClick={()=>go(report?'report/'+report.reportId+'?view=campus-task':'subject/'+skill)}>{report?labels[skill]:'开始'+skillNames[skill]+'练习'} →</button>
    })}</div>
  </section>
}
export function SocialTeamPeek({subject}:{subject:Skill}){
  const {user}=useAuth();const [team,setTeam]=useState<Team|null>(null)
  useEffect(()=>{let active=true;setTeam(null);if(!user)return
    const load=()=>{if(document.hidden)return;campusRequest<Challenge>(user,'/api/social/challenge').then(x=>{if(active)setTeam(x.mine)}).catch(()=>{if(active)setTeam(null)})}
    load();const h=window.setInterval(load,25000);window.addEventListener('focus',load);return()=>{active=false;clearInterval(h);window.removeEventListener('focus',load)}
  },[user?.userId])
  return team?<details className="card social-peek"><summary><b>四人周挑战</b> · {team.name} · {team.members.filter(m=>m.skills.includes(subject)).length}/{team.members.length} 人完成{skillNames[subject]}</summary><Roster team={team} subject={subject}/></details>:null
}
export function Social({tab}:{tab:SocialTab}){
  const {user,showcase}=useAuth(); const {go}=useApp()
  const [member,setMember]=useState<SchoolProfile|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[note,setNote]=useState('')
  const [subject,setSubject]=useState<Skill|''>(''),[revision,setRevision]=useState(0)
  const [rank,setRank]=useState<Rank|null>(null),[points,setPoints]=useState<Points|null>(null),[challenge,setChallenge]=useState<Challenge|null>(null)
  const [teamName,setTeamName]=useState(''),[kind,setKind]=useState('宿舍队'),[inviteCode,setInviteCode]=useState('')
  const pending=useRef(false),[err,setErr]=useState('')
  const api=(path:string,body?:unknown)=>campusRequest(user!,'/api/social/'+path,body)
  useEffect(()=>{let live=true;setLoading(true);setErr('');if(!user)return
    let updating=false
    async function load(background=false){if(updating)return;updating=true;try{
      const {profile}=await api('me');if(!live)return;setMember(profile)
      if(profile && tab!=='verify'){
        const path=tab==='rank'?'rank?subject='+subject:tab
        if(tab==='rank'){
          const [board,ledger]=await Promise.all([api(path),api('points')]);if(!live)return
          setRank(board);setPoints(ledger)
        } else {
          const data=await api(path);if(!live)return
          if(tab==='points')setPoints(data);else setChallenge(data)
        }
      }
    }catch(e){if(live&&!background)setErr((e as Error).message)}finally{updating=false;if(live&&!background)setLoading(false)}}void load()
    const refreshVisible=()=>{if(!document.hidden&&!pending.current)void load(true)}
    const shared=tab==='challenge'||tab==='rank'
    const timer=shared?window.setInterval(refreshVisible,15000):undefined
    if(shared)window.addEventListener('focus',refreshVisible)
    return()=>{live=false;window.clearInterval(timer);window.removeEventListener('focus',refreshVisible)}
  },[user?.userId,tab,subject,revision])
  useEffect(()=>{setNote('')},[tab])
  const reload=()=>setRevision(x=>x+1)
  async function act(path:string,body:unknown,label:string){
    if(pending.current)return;pending.current=true;setBusy(true);setNote('')
    try{await api(path,body);setNote(label);reload()}catch(e){setNote((e as Error).message)}finally{pending.current=false;setBusy(false)}
  }
  if(loading && !(tab==='rank' && rank))return <section className="card" role="status" aria-busy="true">正在读取校园记录…</section>
  if(err)return <Shell title="校园数据"><p role="alert">{err}</p><button className="btn" onClick={reload}>重新加载</button></Shell>
  if(tab==='verify')return <><CampusProfileForm key={member?.id||'new'} member={member} onSaved={()=>{setNote(member?'校园资料已保存。':'已加入深圳大学校园。');reload()}}/>{note&&<p role="status">{note}</p>}</>
  const setup=<div className="social-join"><p>填好校园昵称后，就能以自己的名字参加活动。</p><button className="btn btn-sm" onClick={()=>go('profile/campus')}>填写校园资料</button></div>
  const message=note&&<p className="social-message" role="status">{note}</p>
  if(tab==='rank'){
    return <WeeklyRank board={rank??{rows:[],self:null}} points={points} subject={subject} select={setSubject} loading={loading} demoBoard={showcase}/>
  }
  if(!member && tab==='points')return <Shell title="我的校园积分" desc="完成专项复练或帮助同学解决问题，可获得积分。">{setup}</Shell>
  if(tab==='points'&&points)return <Shell title="四科学习与互助积分" desc="完成报告里的专项复练可记 5 分，互助被解决或诊所完成复练，帮助者可获 5 分。"><div className="social-balance">{points.total}<small>累计积分</small></div>
    {points.entries.length?<ul className="social-ledger">{points.entries.map(p=><li key={p.id}><span>{date(p.created)}</span><b>{p.label}<small>{skillNames[p.subject]} · {p.category==='help'?'互助贡献':'有效练习'}{p.reason?' · '+p.reason:''}</small></b>{p.report&&<button className="btn btn-sm" onClick={()=>go('report/'+p.report)}>原报告</button>}<strong>+{p.points}</strong></li>)}</ul>:<p className="social-empty">完成一次报告专项或帮同学解决问题后，这里会显示积分来源。</p>}
    {points.next&&<button className="btn" disabled={busy} onClick={async()=>{setBusy(true);try{const next:Points=await api('points?before='+points.next);setPoints({...next,entries:[...points.entries,...next.entries]})}catch(e){setNote((e as Error).message)}finally{setBusy(false)}}}>更早记录</button>}{message}</Shell>
  if(tab==='challenge'&&(challenge||!member))return <div className="social-stack squad-layout"><Shell title="四人小队周挑战" desc="每人每科每周完成一项有效练习，贡献 1 格。四人到齐后按全队完成格数排名，满分 16 格。">{message}
{challenge?.mine?<><div className="squad-summary"><div><small>我的小队 · {challenge.mine.kind}</small><h3>{challenge.mine.name}</h3><span>{challenge.mine.members.length} / 4 位成员</span></div><div className="squad-total"><b>{challenge.mine.points}<small> / 16</small></b><span>本周完成格数</span></div></div><progress className="squad-progress" max={16} value={challenge.mine.points} aria-label="全队本周完成格数"/>{challenge.mine.members.length<4&&!showcase&&<p className="squad-code">队伍邀请码 <code>{challenge.mine.id}</code></p>}<Roster team={challenge.mine}/><SquadTasks team={challenge.mine}/><button className="btn btn-sm" disabled={busy} onClick={()=>{if(window.confirm('退出后，你的贡献将从本队榜单移出。确定退出吗？'))void act('challenge',{action:'leave',code:challenge!.mine!.id},'已退出队伍。')}}>退出本队</button></>:!member?setup:<div className="social-cols"><form className="social-form" onSubmit={e=>{e.preventDefault();void act('challenge',{action:'create',name:teamName,kind},showcase?'已建队，可以开始本周任务。':'已建队，把邀请码分享给队友。')}}><label>新队伍名称<input className="input" required maxLength={24} value={teamName} onChange={e=>setTeamName(e.target.value)}/></label><label>组织形式<select className="select" value={kind} onChange={e=>setKind(e.target.value)}>{['宿舍队','班级队','学院代表队'].map(k=><option key={k}>{k}</option>)}</select></label><button className="btn btn-primary" disabled={busy}>创建队伍</button></form><form className="social-form" onSubmit={e=>{e.preventDefault();void act('challenge',{action:'join',code:inviteCode},'已加入队伍。')}}><label>队友的邀请码<input className="input" required maxLength={12} value={inviteCode} onChange={e=>setInviteCode(e.target.value)} /></label><button className="btn" disabled={busy}>加入队伍</button></form></div>}</Shell><Shell title="深圳大学小队周榜" desc={showcase?'四人满队参与排名 · 含校园演示记录':'四人满队参与排名，按全队完成格数排序。'}><Rankings rank={challenge?.leaderboard??{rows:[],self:null}} unit="格"/></Shell></div>
  return null
}
