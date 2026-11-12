import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext'
import { useAuth } from '../auth'
import { campusRequest } from '../campus/SocialApi'
import { formatDateTime } from '../logic'
import { readListeningDraft } from '../listeningIntegration'
import { repository } from '../repository'
import './listeningStudio.css'

type Material = {
  practice_id: string
  part: number
  label: string
  title: string
  type_label: string
  item_count: number
  duration: number
}
type SectionProgress = { practice_id: string; submitted: boolean; attempts: number }

function minutes(seconds: number) {
  const whole = Math.round(seconds)
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0')
}

const paths = {
  play: 'M7 4.5 19 12 7 19.5Z',
  volume: 'M3 9h4l5-4v14l-5-4H3z M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  pause: 'M8 5v14M16 5v14',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  history: 'M3 5v5h5M4 10a8 8 0 1 1 1 7m7-9v5l4 2',
  check: 'm4.5 12.5 5 5 10-11',
  phone: 'M6 3h4l1 4-2 2a12 12 0 0 0 6 6l2-2 4 1v4a2 2 0 0 1-2 2A17 17 0 0 1 4 5a2 2 0 0 1 2-2Z',
  camp: 'm2 19 9-14m2 0 9 14M5 19 8 19m0 0 4-7 4 7m0 0h3M10 3l2 3 2-3',
  planet: 'M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-13 1c-3 2-4 4-3 5 2 2 8 0 13-3s7-7 5-8c-1-1-2-1-4 0',
  book: 'M3 5.5c3-1 6-.5 9 1.5 3-2 6-2.5 9-1.5v13c-3-1-6-.5-9 1.5-3-2-6-2.5-9-1.5zM12 7v13',
}

function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[name]} />
  </svg>
}

const materialIcons = ['phone', 'camp', 'planet', 'book'] as const

function AudioPreview({ part }: { part: number }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const { toast } = useApp()
  const stop = () => {
    const node = audio.current
    if (node) {
      node.pause()
      node.currentTime = 0
    }
    setPlaying(false)
  }
  useEffect(() => {
    const node = audio.current
    return () => node?.pause()
  }, [])
  useEffect(() => {
    if (!playing) return
    const timeout = window.setTimeout(stop, 10_000)
    return () => window.clearTimeout(timeout)
  }, [playing])
  async function toggle() {
    const node = audio.current
    if (!node) return
    if (!node.paused) return stop()
    setUnavailable(false)
    try {
      await node.play()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setUnavailable(true)
      toast('这段原声暂时无法播放，请稍后重试。')
    }
  }
  return <>
    <button className="btn ls-preview" type="button" onClick={toggle} aria-pressed={playing}
      aria-label={playing ? '停止试听' : '试听第 ' + part + ' 段原声前十秒'}>
      <Icon name={playing ? 'pause' : 'volume'} size={16} />
      {playing ? '停止试听' : unavailable ? '重新试听' : '试听 10 秒'}
    </button>
    <audio ref={audio} preload="none" src={'/listening/audio/s' + part + '_official.mp3'}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={stop}
      onTimeUpdate={() => { if (audio.current && audio.current.currentTime >= 10) stop() }} />
  </>
}

export default function ListeningStudio({ userId, onStart }: { userId: string; onStart: (id: string) => void }) {
  const { user } = useAuth()
  const { go } = useApp()
  const [materials, setMaterials] = useState<Material[]>([])
  const [progress, setProgress] = useState<SectionProgress[]>([])
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!user || user.userId !== userId) return
    let active = true
    setError(false)
    setMaterials([])
    setProgress([])
    campusRequest<{ items: Material[] }>(user, '/api/listening/practices').then(({items}) => {
      if (!Array.isArray(items) || !items.length) throw new Error('听力目录为空')
      if (active) setMaterials(items)
    }).catch(() => { if (active) setError(true) })
    campusRequest<{ items: SectionProgress[] }>(user, '/api/listening/progress').then(({items}) => {
      if (active && Array.isArray(items)) setProgress(items)
    }).catch(() => { /* Local reports still provide completed sections. */ })
    return () => { active = false }
  }, [user?.userId, userId, retry])

  const reports = repository.listReports(userId)
    .filter(r => r.subject === 'listening' && r.status === 'ready' && r.evidence.listeningItems?.length)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const sections = materials.map(material => {
    const saved = progress.find(p => p.practice_id === material.practice_id)
    const report = reports.find(r => r.exerciseId === material.practice_id)
    const submitted = saved?.submitted ?? Boolean(report)
    const draft = saved?.submitted ? null : readListeningDraft(userId, material.practice_id)
    return { ...material, submitted, finishedBefore: Boolean(report || saved?.attempts), draft }
  })
  const draftSection = sections.filter(s => s.draft).sort((a, b) => b.draft!.startedAt - a.draft!.startedAt)[0]
  const next = draftSection ?? sections.find(s => !s.submitted)
  const target = next ?? sections.find(s => s.practice_id === reports[0]?.exerciseId) ?? sections[0]
  const finished = sections.filter(s => s.finishedBefore).length
  const ready = sections.length > 0
  const totalSeconds = sections.reduce((sum, section) => sum + section.duration, 0)
  return <div className="ls-studio">
    <div className="ls-top">
      <section className="ls-hero" aria-labelledby="ls-hero-title">
        <div className="ls-hero-content">
          <h2 id="ls-hero-title">原声分段精练</h2>
          <p>从电话对话到学术讲座，分段听、独立作答，再回到原声找出漏听的细节。</p>
          {ready && <div className="ls-hero-meta">
            <span><Icon name="clock" size={15} />原声共 {Math.round(totalSeconds / 60)} 分钟</span>
            <span>{sections.length} 段 · {sections.reduce((n, s) => n + s.item_count, 0)} 题</span>
          </div>}
          <div className="ls-actions">
            {error ? <button className="btn btn-primary" type="button" onClick={() => setRetry(n => n + 1)}>重新载入训练目录</button> :
              <button className="btn btn-primary" type="button" disabled={!target} onClick={() => target && onStart(target.practice_id)}>
                <Icon name={target && !next ? 'history' : 'play'} size={16} />
                {draftSection ? '继续上次练习' : target && !next ? '回看分段解析' : '开始分段练习'}
              </button>}
            {target && <AudioPreview key={target.practice_id} part={target.part} />}
          </div>
        </div>
        <img className="ls-art" src="/listening/headphones.svg" alt="" />
      </section>

      <aside className="ls-summary" aria-label="我的听力进度">
        <div>
          <div className="ls-summary-heading"><h2>原声分段进度</h2>
            {ready && <span><b>{finished}</b> / {sections.length} 段</span>}
          </div>
          {ready && <div className="ls-segments" aria-hidden="true">
            {sections.map(s => <i key={s.practice_id} className={s.finishedBefore ? 'is-done' : s.draft ? 'has-draft' : ''} />)}
          </div>}
        </div>
        <div className="ls-recent">
          <h3><Icon name="history" size={15} />最近练习</h3>
          {reports.length ? <ul>{reports.slice(0, 2).map(r =>
            <li key={r.reportId}><button type="button" onClick={() => go('report/' + r.reportId)}>
              <span><strong>{r.original.title}</strong><small>{formatDateTime(r.createdAt)} · 答对 {r.score.correct}/{r.score.total} 题</small></span>
              <Icon name="arrow" size={16} />
            </button></li>)}</ul> :
            <p>{draftSection ? draftSection.label + ' 已作答 ' + Object.keys(draftSection.draft!.answers).length + ' 题，交卷后可查看报告。' :
              '交完第一段，这里就能回看作答和错题对应的原声。'}</p>}
        </div>
      </aside>
    </div>
    <section className="ls-library" aria-labelledby="ls-library-title">
      <div className="ls-library-heading"><h2 id="ls-library-title">分段训练目录</h2>{ready && <span>可任选一段开始</span>}</div>
      {error ? <p role="alert" className="ls-state">训练目录暂时未能载入，请点击上方按钮重试。</p> :
        !ready ? null :
          <div className="ls-materials">
            {sections.map(s => {
              const label = s.draft ? '继续作答' : s.submitted ? '回看解析' : '开始本段'
              return <button type="button" key={s.practice_id} className="ls-material" onClick={() => onStart(s.practice_id)}
                aria-label={s.label + ' · ' + s.title + '，' + label}>
                <span className="ls-tile-top"><span className={'ls-tile-icon tone-' + s.part}>
                  <Icon name={materialIcons[s.part - 1] || 'book'} size={20} />
                </span><span className="ls-index">{s.label}</span></span>
                <strong>{s.title}</strong><span className="ls-type">{s.type_label}</span>
                <span className="ls-tile-bottom">
                  <span><Icon name="clock" size={13} />{minutes(s.duration)}<i>·</i>{s.item_count} 题</span>
                  <span className="ls-tile-action">{label}<Icon name="arrow" size={13} /></span>
                </span>
              </button>
            })}
          </div>}
    </section>
  </div>
}
