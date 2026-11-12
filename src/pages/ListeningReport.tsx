import { useEffect, useRef, useState } from 'react'
import type { ListeningAnswer, Report } from '../contract'
import { useApp } from '../appContext'
import { Card, CardHead, SubjectChip } from '../components'
import { formatDateTime } from '../logic'
import { listeningReviewPath } from '../listeningIntegration'
import { ClinicEvidenceActions } from '../campus/ClinicPages'
import { SocialPractice } from '../campus/SocialPractice'
import { StudyCoach } from '../StudyCoach'
import './listeningReport.css'

const states = {correct:'正确',wrong:'答错',missed:'漏答'}
function time(seconds:number) {
  return Math.floor(seconds/60) + ':' + String(Math.floor(seconds%60)).padStart(2,'0')
}

export function ListeningReport({report}:{report:Report}) {
  const {go}=useApp()
  const items=report.evidence.listeningItems || []
  const [onlyMissed,setOnlyMissed]=useState(false)
  const player=useRef<HTMLAudioElement>(null)
  const endAt=useRef<number|null>(null)
  const [playing,setPlaying]=useState('')
  const [error,setError]=useState('')
  const [selected,setSelected]=useState('')
  const filtered=onlyMissed?items.filter(item=>item.status!=='correct'):items
  const current=filtered.find(i=>i.id===selected) ?? filtered[0]
  const missed=items.filter(i=>i.status==='missed').length
  const wrong=items.filter(i=>i.status==='wrong').length
  useEffect(()=>{player.current?.pause();endAt.current=null;setError('');setPlaying('')},[current?.id])
  async function replay(item:ListeningAnswer) {
    const audio=player.current
    if (!audio || item.start===null) return
    if(playing===item.id && !audio.paused){audio.pause();return}
    setError('')
    try {
      audio.currentTime=Math.max(0,item.start-0.5)
      endAt.current=item.end===null?null:item.end+0.5
      await audio.play()
      setPlaying(item.id)
    }catch{setError('音频未能播放，可以使用播放器重试。')}
  }
  return <div className="listening-report">
    <div className="row"><SubjectChip subject="listening"/><span className="chip gray">{formatDateTime(report.createdAt)}</span>
      <span className="spacer"/><button className="btn btn-sm" onClick={()=>go('history')}>返回历史记录</button></div>
    <Card><CardHead title={report.original.title} hint="分段练习报告"/>
      <div className="listen-report-score"><div><b>{report.score.correct} / {items.length}</b><small>正确题数</small></div>
        <p>答错 {wrong} 题 · 漏答 {missed} 题</p>
        <button className="btn btn-soft" onClick={()=>go(wrong+missed?listeningReviewPath(report.exerciseId):'subject/listening')}>{wrong+missed?'打开本段错题本':'继续听力练习'}</button>
      </div>
    </Card>
    <Card><CardHead title="逐题解析" extra={<button className="btn btn-sm" disabled={!wrong&&!missed} aria-pressed={onlyMissed}
        onClick={()=>setOnlyMissed(v=>!v)}>{onlyMissed?'显示全部题目':'只看错题'}</button>}/>
      <div className="listen-report-questions" aria-label="选择题号">{filtered.map(item=><button key={item.id}
        className="btn btn-sm" aria-pressed={item.id===current?.id} onClick={()=>setSelected(item.id)}
        aria-label={'第 '+item.number+' 题，'+states[item.status]}>{item.number}</button>)}</div>
      {current && <article className="listen-report-answer">
        <div className="row"><span className={'chip '+(current.status==='correct'?'green':'amber')}>{states[current.status]}</span>
          <b>第 {current.number} 题 · {current.questionType}</b></div>
        <p lang="en">{current.prompt}</p>{current.options.length>0&&<p className="muted small">{current.options.join('　')}</p>}
        <dl><div><dt>我的作答</dt><dd>{current.answer||'未作答'}</dd></div>
          <div><dt>可接受答案</dt><dd>{current.accepted.join(' / ')}</dd></div></dl>
        {current.status!=='correct'&&<p><b>{current.reason}</b>　{current.suggestion}</p>}
        {current.explanation && <p>{current.explanation}</p>}
        {current.quote && <blockquote lang="en">{current.quote}</blockquote>}
        {current.start!==null&&<button className="btn btn-sm btn-soft" onClick={()=>void replay(current)}>
          {playing===current.id?'暂停片段':'回听原声'} · {time(current.start)}{current.end===null?'':' – '+time(current.end)}</button>}
      </article>}
      <audio ref={player} src={report.evidence.audioUrl} preload="metadata" controls aria-label="听力原声播放器"
        onPause={()=>{setPlaying('');endAt.current=null}} onEnded={()=>setPlaying('')}
        onTimeUpdate={()=>{if(endAt.current!==null && player.current && player.current.currentTime>=endAt.current)player.current.pause()}}/>
      {error&&<p role="alert">{error}</p>}
    </Card>
    <StudyCoach key={report.reportId} report={report}/>
    <ClinicEvidenceActions report={report} initialEntry={current?.id}/>
    <SocialPractice report={report}/>
  </div>
}
