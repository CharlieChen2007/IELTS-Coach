import { useEffect, useRef, useState } from 'react'
import { useApp, type Route } from '../appContext'
import { useAuth } from '../auth'
import { campusRequest } from '../campus/SocialApi'
import { SubjectPeerSupport } from '../campus/ClinicEvidence'
import { useEnterReplay } from '../components'
import { useFrameHeight } from '../frameHeight'
import { saveListeningResult, saveListeningWrongbook, syncListeningHistory } from '../listeningIntegration'
import { ListeningBreakdown } from './ListeningBreakdown'
import ListeningStudio from './ListeningStudio'

const validSection = (value: unknown): value is string => typeof value === 'string' && /^prac_lsn_s[1-4]$/.test(value)
const practicePath = (section: string) => 'subject/listening?view=practice&section=' + section
/* 听力页签顺序与读、写一致：训练首页 → 听力自己的练法 → 学伴互助放最后。
   口语那边互助并进了「口语诊所」，四科点下去都是同一套互助界面，只是科目不同。 */
const tabs = [['studio', '训练首页'], ['practice', '分段训练'], ['skills', '题型训练'], ['peers', '学伴互助']] as const

function listeningView(query: Route['query']) {
  if (query.view === 'skills' || query.view === 'peers') return query.view
  if (validSection(query.section) || ['practice','retry','wrongbook','redo'].includes(query.view) || query.attempt || query.item) return 'practice'
  return 'studio'
}

export function ListeningPanel({userId}: {userId: string}) {
  const {user} = useAuth()
  const {route, go, refresh, toast} = useApp()
  const view = listeningView(route.query)
  const [lastSection, setLastSection] = useState('prac_lsn_s1')
  const section = validSection(route.query.section) ? route.query.section : lastSection
  const [connection, setConnection] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const callbacks = useRef({refresh, toast})
  callbacks.current = {refresh, toast}
  /* 一次点击只有一层动画：页签行静止，页签下方整块内容（训练目录 / 分段 iframe 舞台 /
     题型卡片 / 互助单）随 view 或 section 变化柔和进场一次。iframe 原地重播、不重建，
     正在播的原声和滚动位置都不会丢。 */
  const stage = useEnterReplay<HTMLDivElement>(view + ':' + section)

  useEffect(() => {
    if (view === 'practice') setLastSection(section)
  }, [view, section])

  useEffect(() => {
    let current = true
    if (!user) return
    setConnection('loading')
    campusRequest(user, '/api/social/me').then(() => {
      if (!current) return
      setConnection('ready')
      void syncListeningHistory(user, () => current)
        .then(changed => { if (current && changed) callbacks.current.refresh() })
        .catch(() => { if (current) callbacks.current.toast('历史记录暂未同步，可稍后重新打开听力。') })
    }).catch(err => {
      if (current) { setError(err.message); setConnection('error') }
    })
    return () => { current = false }
  }, [userId, retry])

  function openTab(key: typeof tabs[number][0]) {
    if (key === 'peers') {
      const context = view === 'practice' || validSection(route.query.section) ? '&section=' + section : ''
      go('subject/listening?view=peers' + context)
    } else if (key === 'practice') {
      if (view !== 'practice') go(practicePath(section))
    } else {
      go(key === 'studio' ? 'subject/listening' : 'subject/listening?view=skills')
    }
  }

  return <section className="listening-workspace" aria-label="听力练习工作区">
    <nav className="subject-tools" aria-label="听力功能">
      {tabs.map(([key, label]) => <button key={key} type="button" className={view === key ? 'on' : ''}
        aria-current={view === key ? 'page' : undefined}
        onClick={() => openTab(key)}>{label}</button>)}
    </nav>
    <div className="stage-body" ref={stage}>
      {view === 'studio' && <ListeningStudio userId={userId} onStart={id => go(practicePath(id))}/>}
      {view === 'skills' && <ListeningBreakdown userId={userId}/>}
      {view === 'peers' && <SubjectPeerSupport subject="listening"/>}
      {/* 连接期间保持静默：不铺骨架、不显示加载占位文案，就绪后内容直接呈现。 */}
      {view === 'practice' && (connection === 'ready' ? <ListeningFrame userId={userId} section={section}/>
        : connection === 'loading' ? null
        : <section role="alert" className="card">{error} <button className="btn btn-sm" type="button" onClick={() => setRetry(r => r + 1)}>重试</button></section>)}
    </div>
  </section>
}

function ListeningFrame({userId, section}: {userId: string; section: string}) {
  const {route, go, replace, refresh, toast} = useApp()
  const frame = useRef<HTMLIFrameElement>(null)
  /* 高度用与口语同一套逻辑：首帧按估值占位，模块报上来的第一个值立即采纳，
     之后过滤中间态。原来固定 760、只接受上报值，弱网首屏会先撑高再塌回实际高度。 */
  const [height, pushHeight] = useFrameHeight('listening:' + section, 320, 1040)
  const target = new URLSearchParams({scope: userId, section})
  for (const key of ['view','item','attempt']) {
    if (route.query[key] && route.query[key] !== 'practice') target.set(key, route.query[key])
  }
  const requested = target.toString()
  const [source, setSource] = useState(requested)
  const childRoute = useRef('')
  const actions = useRef({go, replace, refresh, toast, section})
  actions.current = {go, replace, refresh, toast, section}

  useEffect(() => {
    if (requested !== childRoute.current) setSource(requested)
    childRoute.current = ''
  }, [requested])

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.source !== 'ielts-listening') return
      const data = event.data
      const {go, replace, refresh, toast, section: active} = actions.current
      if (data.type === 'size' && Number.isFinite(data.height)) pushHeight(Math.min(40000, Math.ceil(data.height)))
      if (data.type === 'section' && validSection(data.section) && data.section !== active) {
        childRoute.current = new URLSearchParams({scope: userId, section: data.section}).toString()
        replace?.(practicePath(data.section))
      }
      if (data.type === 'open-report' && /^att_[\w-]+$/.test(data.attemptId)) go('report/rpt_li_' + data.attemptId)
      try {
        if (data.type === 'result' && saveListeningResult(userId, data.result, data.practice)) refresh()
        if (data.type === 'wrongbook' && validSection(data.section) && Array.isArray(data.entries) && saveListeningWrongbook(userId, data.entries, data.section)) refresh()
      } catch { toast('成绩已保存在听力服务，重新进入可同步。') }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [userId, pushHeight])

  /* 首帧就占住真实高度、iframe 直接淡入；加载期间保持静默，不铺骨架、不显示文案。 */
  const [ready, setReady] = useState(false)
  return (
    <div className="frame-stage" data-ready={ready ? '1' : '0'}>
      <iframe className={'listening-frame' + (ready ? ' is-ready' : '')} ref={frame}
        src={'/listening/index.html?' + source} title="听力练习台" style={{ height }}
        onLoad={() => setReady(true)} />
    </div>
  )
}
