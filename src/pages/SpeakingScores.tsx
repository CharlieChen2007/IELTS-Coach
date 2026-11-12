import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext'
import type { Report, SpeechEvaluation } from '../contract'
import { repository } from '../repository'
import './speakingScores.css'

type Job = SpeechEvaluation & { reportId: string; retryable?: boolean; created: number }
type Queue = {
  listScores(owner: string): Promise<Job[]>
  watchScores(owner: string, update: () => void): () => void
  runScoreQueue(owner: string): () => void
  retryScore(owner: string, key: string): Promise<void>
}
const script = '/speaking/score-queue.js'
const loadQueue = (): Promise<Queue> => import(/* @vite-ignore */ script)
const ownerOf = (id:string) => 'host:'+encodeURIComponent(id)

function scoreSnapshot(row: Job): SpeechEvaluation {
  return { key:row.key, label:row.label, state:row.state, accuracy:row.accuracy, fluency:row.fluency,
    scored:row.scored, segments:row.segments, words:row.words, message:row.message, durationMs:row.durationMs }
}
function mergeScores(userId: string, rows: Job[]) {
  let changed = false
  const groups = new Map<string,Job[]>()
  for (const row of rows) {
    const group = groups.get(row.reportId) || []
    group.push(row)
    groups.set(row.reportId,group)
  }
  for (const [reportId,jobs] of groups) {
    const report = repository.getReport(userId,reportId)
    if (!report) continue
    const byKey = new Map((report.evidence.speechScores || []).map(item=>[item.key,item]))
    for(const job of jobs.sort((a,b)=>a.created-b.created)) byKey.set(job.key,scoreSnapshot(job))
    const scores = [...byKey.values()]
    if (JSON.stringify(scores)===JSON.stringify(report.evidence.speechScores)) continue
    const metrics = scores.flatMap(row=>row.state==='ready' && typeof row.accuracy==='number' ? [row.accuracy] : [])
    const display = report.score.band!==null ? report.score.display : metrics.length ?
      '发音 '+(metrics.reduce((sum,n)=>sum+n,0)/metrics.length).toFixed(1)+'/100' :
      scores.some(row=>row.state==='working'||row.state==='queued') ? '发音评测中' : scores.some(row=>row.state==='waiting-session')?'待封卷评测':'已完成'
    repository.saveReport({...report,score:{...report.score,display},evidence:{...report.evidence,speechScores:scores}})
    changed = true
  }
  return changed
}

/** Keep in-flight assessments running when a learner leaves the speaking iframe. */
export function SpeakingScoreSync({userId}:{userId:string}) {
  const {version,refresh} = useApp()
  const update = useRef<()=>void>(()=>{})
  useEffect(()=>{
    let live=true, release: (()=>void) | undefined
    const owner=ownerOf(userId)
    void loadQueue().then(queue=>{
      if(!live)return
      let rev=0
      const read=()=>{const now=++rev;void queue.listScores(owner).then(rows=>{
        if(live && rev===now && mergeScores(userId,rows))refresh()
      }).catch(()=>{})}
      update.current=read
      const unwatch=queue.watchScores(owner,read), stop=queue.runScoreQueue(owner)
      release=()=>{unwatch();stop()}
      read()
    }).catch(()=>{})
    return ()=>{live=false;release?.();update.current=()=>{}}
  },[userId,refresh])
  useEffect(()=>update.current(),[version])
  return null
}
export function SpeakingScores({report,userId}:{report:Report;userId:string}) {
  const scores=report.evidence.speechScores || []
  const [notice,setNotice]=useState('')
  const [retryKeys,setRetryKeys]=useState<string[]>([])
  useEffect(()=>{
    let live=true
    void loadQueue().then(q=>q.listScores(ownerOf(userId))).then(jobs=>{
      if(live)setRetryKeys(jobs.filter(j=>j.retryable && j.state==='error' && j.reportId===report.reportId).map(j=>j.key))
    }).catch(()=>{})
    return ()=>{live=false}
  },[userId,report.reportId,report.evidence.speechScores])
  if(!scores.length)return null
  function play(word:string){
    if(!window.speechSynthesis){setNotice('此浏览器暂不能播放英文示范音。');return}
    speechSynthesis.cancel()
    const utterance=new SpeechSynthesisUtterance(word);utterance.lang='en-US'
    utterance.onerror=event=>{if(event.error!=='canceled' && event.error!=='interrupted')setNotice('未能播放示范音，请检查浏览器语音设置。')}
    setNotice('');speechSynthesis.speak(utterance)
  }
  return <section className="card host-speech-results"><h2>发音评测</h2>
    {scores.map(row=><section className="host-speech-row" key={row.key}><h3>{row.label}</h3>
      {row.state==='ready'?<>
        <div className="host-speech-metrics">
          {row.accuracy!=null && <span>发音准确度 <b>{row.accuracy}</b> / 100</span>}
          {row.fluency!=null && <span>流利度 <b>{row.fluency}</b> / 100</span>}
        </div>
        {row.words?.length ? <><p>需留意的发音 <small>词准确度低于 80</small></p><div className="host-speech-words">{row.words.map(w=>
          <button type="button" key={w.word} aria-label={`播放 ${w.word} 的英语示范音`} onClick={()=>play(w.word)}><strong lang="en">{w.word}</strong><small>{w.accuracy}</small><span aria-hidden="true">▶</span></button>)}</div></> :
          <p>{row.scored ? '这段回答没有低于 80 分的单词。' : '本次未返回逐词准确度。'}</p>}
        {(row.segments??0)>1 && <small>长回答分 {row.segments} 段评测，按有效发声时长加权。</small>}
      </>:<p role="status">{row.message || '发音评测中…'} {retryKeys.includes(row.key) && <button type="button" className="btn btn-sm" onClick={()=>{void loadQueue().then(q=>q.retryScore(ownerOf(userId),row.key)).catch(()=>setNotice('重试失败，请检查浏览器存储。'))}}>重试评测</button>}</p>}
    </section>)}{notice && <p role="status">{notice}</p>}
  </section>
}
