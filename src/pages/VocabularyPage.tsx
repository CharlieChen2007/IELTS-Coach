import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { campusRequest } from '../campus/SocialApi'
import { useEnterReplay } from '../components'
import { useFrameHeight } from '../frameHeight'
import './vocabulary.css'

export function VocabularyPage() {
  const { user } = useAuth()
  const stage = useEnterReplay<HTMLDivElement>(user?.userId)
  if (!user) return null
  return <section className="vocabulary-page">
    <header className="subject-hero vocabulary-hero">
      <span className="subject-hero-icon" aria-hidden="true"><VocabularyIcon/></span>
      <div><h1>词汇积累</h1><p>听说读写通用的高频词库，按记忆情况安排复习。</p></div>
    </header>
    <div className="stage-body" ref={stage}><VocabFrame key={user.userId} userId={user.userId}/></div>
  </section>
}
export function VocabularyIcon() {
  return <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm16 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h3V4Z"/><path d="M7 8h2m-2 4h2m7-4h1m-1 4h1"/></svg>
}

function VocabFrame({ userId }: { userId: string }) {
  const { user } = useAuth()
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, pushHeight] = useFrameHeight('vocab', 420, 980)
  const [ready, setReady] = useState(false)
  const [enrolled, setEnrolled] = useState(false)
  const [identityError, setIdentityError] = useState('')
  useEffect(() => {
    if (!user) return
    let active = true
    campusRequest(user,'/api/campus/me').then(() => { if(active)setEnrolled(true) })
      .catch(error => { if(active)setIdentityError(error.message) })
    return () => { active = false }
  },[userId])
  const [timedOut, setTimedOut] = useState(false)
  const [src] = useState(() => {
    const params = new URLSearchParams({ embedded: '1', scope: userId, nickname: user?.nickname || '' })
    return '/vocab/vocab.html?' + params
  })
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 10000)
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return
      const data = event.data
      if (data?.source !== 'ielts-vocab') return
      if (data.type === 'size' && Number.isFinite(data.height)) pushHeight(Math.min(32000, Math.ceil(data.height)))
      if (data.type === 'ready') { window.clearTimeout(timer); setReady(true) }
    }
    window.addEventListener('message', receive)
    return () => { window.removeEventListener('message', receive); window.clearTimeout(timer) }
  }, [pushHeight])
  return (
    <>
    {!ready && timedOut && <p className="speaking-load-error" role="alert">词汇模块尚未响应，请 <button type="button" className="btn btn-sm" onClick={() => location.reload()}>重新加载</button></p>}
    <div className="frame-stage" data-ready={ready ? '1' : timedOut ? 'error' : '0'}>
      {identityError && <p role="alert">{identityError} <button type="button" className="btn btn-sm" onClick={() => location.reload()}>重新连接</button></p>}
        {enrolled && <iframe ref={frame} src={src}
        className={'speaking-frame vocab-frame' + (ready ? ' is-ready' : '')}
        title="雅思高频词库" allow="microphone 'self'" referrerPolicy="same-origin" style={{ height }} />}
    </div>
    </>
  )
}

