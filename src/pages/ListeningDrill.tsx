import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { useApp } from '../appContext'
import { campusRequest } from '../campus/SocialApi'
import { recordListeningDaily } from '../listeningIntegration'
import type { ListeningType, DrillFeedback, DrillQuestion } from './listeningTypes'

function Figure({ kind }: { kind: NonNullable<DrillQuestion['visual']> }) {
  const description = {
    plan: 'Floor plan, north at top. Enter from the south into a central corridor. Reception and Office are beside the entrance; A and B are in the middle; Reading Room and C are at the far end.',
    map: 'Map with north at top. College Road runs east from the library over a stream to the sports field. Site A is north of the road west of the bridge. B is on the north side just east of the bridge, C on the south side.',
    diagram: 'Side view of a rainwater collector. A marks the sloping roof, B the large storage tank, and C a small mesh ring inside the downpipe just above the tank inlet.',
  }[kind]
  return <svg className="drill-figure" viewBox="0 0 360 180" role="img" aria-label={description} lang="en">
    {kind === 'plan' && <>
      <path className="figure-wall" d="M28 22H332V146H202M158 146H28ZM158 22v124m44-124v124M28 62h130m44 0h130M28 104h130m44 0h130"/>
      <text x="91" y="48">Reading room</text><text x="270" y="48" className="figure-pin">C</text>
      <text x="91" y="89" className="figure-pin">A</text><text x="270" y="89" className="figure-pin">B</text>
      <text x="91" y="131">Reception</text><text x="270" y="131">Office</text>
      <text x="180" y="170">↑ South entrance</text>
    </>}
    {kind === 'map' && <>
      <path d="M158 -5c-28 48 24 61-4 119s2 60 5 72" fill="none" stroke="#99d3e7" strokeWidth="18"/>
      <rect x="269" y="29" width="78" height="52" rx="6" fill="#d5eadb" stroke="#87b398"/>
      <text x="308" y="54">Sports</text><text x="308" y="69">field</text>
      <path className="figure-road" d="M12 101h336"/><text x="81" y="122">College Road</text>
      <text x="45" y="76">Library</text><text x="144" y="122">Bridge</text>
      <text x="101" y="73" className="figure-pin">A</text><text x="209" y="74" className="figure-pin">B</text><text x="205" y="145" className="figure-pin">C</text>
      <text x="30" y="29">↑ N</text>
    </>}
    {kind === 'diagram' && <>
      <path className="figure-wall" d="M48 24l140 39-4 12L45 36ZM176 75h12v49h-12z"/>
      <rect x="145" y="124" width="76" height="40" rx="5" fill="#ccdfeb" stroke="#688fa6" strokeWidth="2"/>
      <path d="M174 108h15m-15 4h15" stroke="#347c76" strokeWidth="4"/>
      <path d="M107 39l10-18h20m87 122h36M189 111l27-24h39" fill="none" stroke="#6d8292" strokeWidth="1.5"/>
      <text x="150" y="26" className="figure-pin">A</text><text x="274" y="147" className="figure-pin">B</text><text x="271" y="92" className="figure-pin">C</text>
    </>}
  </svg>
}

export function ListeningDrill({type}: {type:ListeningType}) {
  const {user} = useAuth()
  const {go, refresh} = useApp()
  const [question, setQuestion] = useState<DrillQuestion | null>(null)
  const [result, setResult] = useState<DrillFeedback | null>(null)
  const [answer, setAnswer] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!user) return
    let active = true
    setQuestion(null); setError('')
    campusRequest<DrillQuestion>(user,'/api/listening/drills/' + type.id)
      .then(q => { if (active) { setQuestion(q); setResult(q.result); setAnswer([]) } })
      .catch(err => { if (active) setError(err.message) })
    return () => {active = false}
  }, [type.id, user?.userId, retry])

  async function submit() {
    if (!user || !question || busy || result) return
    setBusy(true); setError('')
    try {
      const response = await campusRequest<DrillFeedback>(user, '/api/listening/drills/' + type.id,
        {revision:question.result?.revision ?? 0, answer})
      setResult(response); setQuestion({...question,result:response})
      if (recordListeningDaily(user.userId, new Date().toISOString(), 'lsn_drill_'+type.id+'_'+response.revision,
        response.revision===1?'newPractice':'retake')) refresh()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }
  const back = () => go('subject/listening?view=skills')
  const displayAnswers = (values:string[]) => values.map(value=>question?.options
    ? value + '. ' + question.options[value.charCodeAt(0)-65] : value).join(question?.options?'；':' / ')
  return <section className="card listening-drill" aria-label={type.label+'专项'}>
    <header><button type="button" className="btn btn-sm" onClick={back}>← 题型总览</button><span>校园原创专项 · {type.label}</span></header>
    {question && <>
      <h2>{question.title}</h2><p className="drill-caption">英文合成录音 · 可反复播放</p>
      <audio controls preload="metadata" src={'/listening/drills/'+type.id+'.mp3'} aria-label="专项录音"/>
      <form onSubmit={e=>{e.preventDefault();void submit()}}>
        <h3 lang="en">{question.prompt}</h3>
        {question.visual && <Figure kind={question.visual}/>}
        {question.context && <div className="drill-context" lang="en">{question.context.map(line=><p key={line}>{line}</p>)}</div>}
        {!result && <>
          {question.options ? <fieldset disabled={busy} aria-label="选择答案">{question.options.map((label,i)=>{
            const value=String.fromCharCode(65+i)
            return <label key={value} className="drill-option"><input name="drill-choice" type={question.total>1?'checkbox':'radio'}
              checked={answer.includes(value)} disabled={!answer.includes(value)&&answer.length>=question.total&&question.total>1}
              onChange={event=>setAnswer(question.total===1?[value]:event.target.checked?[...answer,value]:answer.filter(v=>v!==value))}/>
              <span lang="en">{value}. {label}</span></label>
          })}</fieldset> :
            <label className="drill-input-label">你的答案<input className="input" autoComplete="off" maxLength={140} value={answer[0]??''}
              disabled={busy} onChange={e=>setAnswer([e.target.value])}/></label>}
          <button className="btn btn-primary" disabled={busy || answer.length !== question.total || answer.some(a=>!a.trim())}>
            {busy?'提交中':'提交并查看解析'}</button>
        </>}
      </form>
      {result && <section className="drill-result" aria-label="专项解析">
        <h3>答对 {result.correct} / {result.total}</h3>
        <dl><div><dt>你的答案</dt><dd>{displayAnswers(result.answer)}</dd></div><div><dt>参考答案</dt><dd>{displayAnswers(result.accepted)}</dd></div></dl>
        <p>{result.reason}</p><details><summary>查看录音原文</summary><p lang="en">{result.script}</p></details>
        <div className="drill-result-actions"><button type="button" className="btn btn-primary" onClick={back}>返回题型训练</button>
          <button type="button" className="btn btn-soft" onClick={()=>{setResult(null);setAnswer([]);setError('')}}>再练一次</button></div>
      </section>}
    </>}
    {!question && !error && null}
    {error && <p role="alert">{error} <button className="btn btn-sm" onClick={()=>setRetry(v=>v+1)}>重新载入</button></p>}
  </section>
}
