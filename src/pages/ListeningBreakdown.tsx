import { useState, useEffect } from 'react'
import { useApp } from '../appContext'
import { useAuth } from '../auth'
import { campusRequest } from '../campus/SocialApi'
import { repository } from '../repository'
import { listeningReviewPath } from '../listeningIntegration'
import { listeningTypes, type ListeningType, type TypeScore } from './listeningTypes'
import { ListeningDrill } from './ListeningDrill'
import './listeningTypes.css'

const indexPath = 'subject/listening?view=skills'
type Row = TypeScore & {missed?:number; report?:string; review?:string}

export function ListeningBreakdown({userId}:{userId:string}) {
  const {route} = useApp()
  const drill = listeningTypes.flatMap(group=>group.types).find(type=>!type.section && type.id===route.query.drill)
  return drill ? <ListeningDrill key={userId+drill.id} type={drill}/> : <TypeDirectory userId={userId}/>
}

function TypeDirectory({userId}:{userId:string}) {
  const {go} = useApp()
  const {user} = useAuth()
  const [scores, setScores] = useState<(TypeScore & {drill:string})[]>([])
  const [status, setStatus] = useState<'loading'|'ready'|'error'>('loading')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!user) return
    let active = true
    setStatus('loading')
    campusRequest<{items:(TypeScore & {drill:string})[]}>(user,'/api/listening/drills')
      .then(({items})=>{if (active) {setScores(items);setStatus('ready')}})
      .catch(()=>{if (active) setStatus('error')})
    return ()=>{active=false}
  },[userId,retry])

  const rows = new Map<string, Row>(scores.map(s=>[s.drill,s]))
  const reports = repository.listReports(userId)
    .filter(r=>r.subject==='listening' && r.evidence.listeningItems?.length && !r.evidence.demoRecord)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  const pending = new Set(repository.listMistakes(userId)
    .filter(m=>m.listeningItem && m.reviewStatus==='pending' && !m.archived).map(m=>m.listeningItem))
  const types = listeningTypes.flatMap(group=>group.types)
  for (const type of types.filter(t=>t.section)) {
    const report = reports.find(r=>r.exerciseId==='prac_lsn_s'+type.section)
    const items = report?.evidence.listeningItems?.filter(i=>i.questionType===type.reportLabel)
    if (!report || !items?.length) continue
    const mistake = items.find(i=>i.status!=='correct' && pending.has(i.id))
    rows.set(type.id, {total:items.length, correct:items.filter(i=>i.status==='correct').length,
      missed:items.filter(i=>i.status==='missed').length, report:'report/'+report.reportId,
      review:mistake && listeningReviewPath(report.exerciseId,mistake.id)})
  }

  function renderType(type:ListeningType) {
    const row=rows.get(type.id)
    const path=type.section?'subject/listening?view=practice&section=prac_lsn_s'+type.section:indexPath+'&drill='+type.id
    const action=row?.review?'复练一道错题':row?'查看解析':type.section?'练这一段':'练一道题'
    return <div className="type-line" key={type.id}>
      <div className="type-line-text"><strong>{type.label}</strong>
        <small>{row?'答对 '+row.correct+'/'+row.total+(row.missed?' · 漏答 '+row.missed+' 题':''):type.section?'Section '+type.section+' · 分段练习':'校园原创 · 单题专项'}</small></div>
      <span className={row?'type-percent':'type-fresh'}>{row?Math.round(row.correct/row.total*100)+'%':
        !type.section && status!=='ready' ? '—':'未练'}</span>
      <button type="button" className="type-open" aria-label={type.label+'，'+action}
        onClick={()=>go(row?.review||row?.report||path)}>{action}<span aria-hidden="true"> →</span></button>
    </div>
  }

  return <section className="type-directory" aria-label="听力题型表现">
    <header className="type-intro"><div><h2>题型训练</h2><p>选择题型开始训练，每项显示最近一次作答的正确率。</p></div>
      {status==='ready' && <div className="type-counter"><b>{rows.size} / {types.length}</b><span>已练题型</span></div>}
    </header>
    {status==='error' && <p role="alert" className="type-alert">专项记录暂未载入。 <button type="button" className="btn btn-sm" onClick={()=>setRetry(n=>n+1)}>重试</button></p>}
    <div className="type-groups">
      {listeningTypes.map(({name,types})=><section key={name} className="type-category" aria-label={name}>
        <h3>{name}</h3><div>{types.map(renderType)}</div>
      </section>)}
    </div>
  </section>
}
