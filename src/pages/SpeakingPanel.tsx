import { useEffect, useRef, useState } from 'react'
import { parseHash, useApp } from '../appContext'
import { useAuth } from '../auth'
import { repository } from '../repository'
import { isShowcaseUser } from '../showcase'
import { isSpeakingView, saveSpeakingResult, setSpeakingBusy, speakingPath } from '../speakingIntegration'
import { useEnterReplay } from '../components'
import { useFrameHeight } from '../frameHeight'
import { ClinicPage } from '../campus/ClinicPages'
import { campusRequest } from '../campus/SocialApi'
import './workspaceNavigation.css'

const dailyTabs = [['daily', '今日跟读'], ['daily-library', '语料库'], ['daily-history', '跟读记录']] as const
const HEIGHT_FALLBACK: Record<string, number> = {
  studio: 766, practice: 620, campus: 560, 'campus-team': 700, history: 560,
  daily: 1750, 'daily-library': 2400, 'daily-history': 600,
}
const speakingGroups = [
  { id: 'training', label: '口语训练', view: 'studio' },
  { id: 'partners', label: '同伴练习', view: 'campus' },
  { id: 'shadowing', label: '跟读训练', view: 'daily' },
  { id: 'support', label: '学伴互助', view: 'clinic' },
  { id: 'records', label: '口语记录', view: 'history' },
] as const

export function SpeakingPanel({ userId }: { userId: string }) {
  const { go, route } = useApp()
  const raw = isSpeakingView(route.query.view) ? route.query.view : undefined
  const view = route.query.view === 'peers' || route.query.view === 'clinic' ? route.query.view : raw || 'studio'
  const daily = view === 'daily' || view === 'daily-library' || view === 'daily-history'
  const support = view === 'clinic' || view === 'peers'
  const partners = view === 'campus' || view === 'campus-team'
  const record = view === 'history' || view.includes('/')
  const group = support ? 'support' : daily ? 'shadowing' : partners ? 'partners' : record ? 'records' : 'training'
  const remembered = useRef<Record<string,string>>({})
  const section = view === 'peers' || route.query.section === 'help' ? 'help' : 'clinic'
  remembered.current[group] = support ? section === 'help' ? 'peers' : 'clinic' : view
  const secondary = partners ? [['campus','双人模拟考'],['campus-team','备考小组']] :
    group === 'training' ? [['studio','模考室'],['practice','自由对话']] :
    daily ? dailyTabs : support ? [['clinic','口语诊所'],['peers','同校互助单']] : []
  const secondaryView = support ? section === 'help' ? 'peers' : 'clinic' :
    ['full','quick'].includes(view) ? 'studio' : view
  const secondaryLabel = partners ? '同伴练习方式' : daily ? '每日语料' : support ? '口语诊所与互助单' : '口语训练方式'
  const stage = useEnterReplay<HTMLDivElement>(group + ':' + (daily ? 'daily' : support ? section : view))
  return <section aria-label="口语练习工作区" className="speaking-workspace">
    <div className="workspace-toolbar">
    <nav className="speaking-tools workspace-primary" aria-label="口语功能分类">
      {speakingGroups.map(item => <button key={item.id} type="button" className={group === item.id ? 'on' : ''}
        aria-pressed={group === item.id}
        onClick={() => { if (group !== item.id) go(speakingPath(remembered.current[item.id] || item.view)) }}>{item.label}</button>)}
    </nav>
    {secondary.length > 0 && <nav className="workspace-secondary" aria-label={secondaryLabel}>
      {secondary.map(([key,label]) => <button type="button" key={key} className={secondaryView === key ? 'on' : ''}
        aria-current={secondaryView === key ? 'page' : undefined}
        onClick={() => { if(secondaryView !== key) go(support && key === 'peers' ? 'subject/speaking?view=clinic&section=help' : speakingPath(key)) }}>{label}</button>)}
    </nav>}
    </div>
    <div className="stage-body" ref={stage}>
      {support ? <ClinicPage tab={section} section={section} showNavigation={false}/> :
       daily ? <DailyLearningFrame key={userId} userId={userId} view={view as DailyView}/> :
       <SpeakingFrame key={userId+':'+(route.query.team || '')} userId={userId} view={view}/>}
    </div>
  </section>
}

type DailyView = 'daily' | 'daily-library' | 'daily-history'
const dailyModuleView: Record<DailyView, string> = { daily: 'practice', 'daily-library': 'library', 'daily-history': 'history' }

function DailyLearningFrame({ userId, view }: { userId: string; view: DailyView }) {
  const { replace } = useApp()
  const { user } = useAuth()
  const frame = useRef<HTMLIFrameElement>(null)
  const live = useRef(view)
  live.current = view
  const [height, pushHeight] = useFrameHeight(view, 420, HEIGHT_FALLBACK[view] ?? 700)
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
  /* 二级页签切换时只重播 iframe 舞台这一层，二级页签行保持静止。 */
  const pane = useEnterReplay<HTMLDivElement>(view)
  const [src] = useState(() => {
    const params = new URLSearchParams({ embedded: '1', scope: userId, nickname: user?.nickname || '', dailyView: dailyModuleView[view] })
    return '/speaking/shadow.html?' + params
  })
  useEffect(() => {
    let busy = false
    const onUnload = (event: BeforeUnloadEvent) => { if (busy) event.preventDefault() }
    const timer = window.setTimeout(() => setTimedOut(true), 10000)
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.source !== 'ielts-speaking') return
      const data = event.data
      if (data.type === 'busy') { busy = data.busy === true; setSpeakingBusy(busy) }
      if (data.type === 'size' && Number.isFinite(data.height)) {
        pushHeight(Math.min(32000, Math.ceil(data.height)))
      }
      if (data.type === 'ready') { window.clearTimeout(timer); setReady(true) }
      /* 模块内部的「查看全部 / 下一步再练」等跳转会报回来，宿主页签与地址栏跟着走，
         这样点「语料库」在模块里被打开时，上面那道页签不会停在「今日跟读」。 */
      if (data.type === 'view' && ['practice', 'library', 'history'].includes(data.view)) {
        const next: DailyView = data.view === 'library' ? 'daily-library' : data.view === 'history' ? 'daily-history' : 'daily'
        if (next !== live.current) replace?.(speakingPath(next))
      }
    }
    window.addEventListener('message', receive)
    window.addEventListener('beforeunload', onUnload)
    return () => { window.removeEventListener('message', receive); window.removeEventListener('beforeunload', onUnload); window.clearTimeout(timer); setSpeakingBusy(false) }
  }, [pushHeight, replace])
  /* 页面里已经在做的切换（页签互点）直接调模块，不重载 iframe：
     重载会让语料库的滚动位置、正在播的示范音频一起丢掉。 */
  useEffect(() => {
    if (!ready || !frame.current) return
    const target = dailyModuleView[view]
    frame.current.contentWindow?.postMessage({ source: 'ielts-coach', type: 'go', view: target }, location.origin)
  }, [view, ready])
  return <>
    {!ready && timedOut && <p className="speaking-load-error" role="alert">学习模块尚未响应，请 <button type="button" className="btn btn-sm" onClick={() => location.reload()}>重新加载</button></p>}
    <div className="stage-pane" ref={pane}>
      <div className="frame-stage" data-ready={ready ? '1' : timedOut ? 'error' : '0'}>
        {identityError && <p role="alert">{identityError} <button type="button" className="btn btn-sm" onClick={() => location.reload()}>重新连接</button></p>}
        {enrolled && <iframe ref={frame} src={src}
          className={'speaking-frame daily-learning-frame' + (ready ? ' is-ready' : '')}
          title="每日语料跟读" allow="microphone 'self'; clipboard-write 'self'"
          referrerPolicy="same-origin" style={{ height }} />}
      </div>
    </div>
  </>
}

/* 口语原生工作区保留文档身份，站内分类切换通过消息同步。 */
function SpeakingFrame({ userId, view }: { userId: string; view: string }) {
  const { route, replace, refresh, toast } = useApp()
  const { user } = useAuth()
  const frame = useRef<HTMLIFrameElement>(null)
  const mountedAt = useRef(Date.now())
  const current = useRef(view)
  const connected = useRef(false)
  const revision = useRef(0)
  const hooks = useRef({ refresh, toast, replace, retakeOf: route.query.retakeOf })
  hooks.current = { refresh, toast, replace, retakeOf: route.query.retakeOf }
  const [src] = useState(() => {
    const params = new URLSearchParams({ embedded: '1', scope: userId, nickname: user?.nickname || '' })
    if (view === 'campus-team' && /^[\w-]{1,64}$/.test(route.query.team || '')) params.set('team', route.query.team)
    return '/speaking/index.html?' + params + '#' + view
  })
  /* 首帧最小高度只挡住「一条细缝」的情况；给太大反而会把骨架撑高 */
  const [height, pushHeight] = useFrameHeight(view, 240, HEIGHT_FALLBACK[view] ?? 742)
  const [ready, setReady] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  /* 模块内部切页签时组件不重建，但 view 变了；用 ref 保证高度始终记到当前页签名下 */
  const pushRef = useRef(pushHeight)
  pushRef.current = pushHeight

  useEffect(() => {
    let busy = false
    const timer = window.setTimeout(() => setTimedOut(true), 10000)
    const onUnload = (event: BeforeUnloadEvent) => { if (busy) event.preventDefault() }
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.source !== 'ielts-speaking') return
      const data = event.data
      if (data.type === 'ready' && isShowcaseUser(userId)) {
        const reports = repository.listReports(userId)
          .filter(r=>r.subject==='speaking' && r.mode==='mock' && r.evidence.showcaseRecord)
          .map(r=>({reportId:r.reportId,title:r.original.title,created:Date.parse(r.createdAt),score:r.score.display}))
        frame.current?.contentWindow?.postMessage({source:'ielts-coach',type:'showcase-history',reports},location.origin)
      }
      if (data.type === 'showcase-report' && isShowcaseUser(userId) && typeof data.reportId === 'string' &&
          repository.getReport(userId,data.reportId)?.evidence.showcaseRecord) {
        location.hash = '#/report/'+encodeURIComponent(data.reportId)
      }
      if (data.type === 'size' && Number.isFinite(data.height)) {
        pushRef.current(Math.min(32000, Math.ceil(data.height)))
      }
      if (data.type === 'busy') { busy = data.busy === true; setSpeakingBusy(busy) }
      if (data.type === 'ready') {
        window.clearTimeout(timer)
        connected.current = true
        setReady(true)
        if (data.initialRoute !== current.current || revision.current > 0) {
          frame.current?.contentWindow?.postMessage({source:'ielts-coach',type:'navigate',route:current.current,revision:++revision.current},location.origin)
          return
        }
      }
      const liveRoute = parseHash(location.hash)
      if (connected.current && (data.type === 'ready' || data.type === 'route' && data.revision === revision.current) &&
          liveRoute.name === 'subject' && liveRoute.id === 'speaking' && (liveRoute.query.view || 'studio') === current.current &&
          isSpeakingView(data.route) && data.route !== current.current) {
        current.current = data.route
        const extra = hooks.current.retakeOf ? '&retakeOf=' + encodeURIComponent(hooks.current.retakeOf) : ''
        hooks.current.replace?.(speakingPath(data.route) + (data.route === 'studio' ? '' : extra))
      }
      if (data.type === 'result') {
        try {
          const retakeOf = data.result?.startedAt >= mountedAt.current ? hooks.current.retakeOf : undefined
          if (saveSpeakingResult(userId, data.result, retakeOf)) hooks.current.refresh()
        } catch { hooks.current.toast('口语记录已保存在练习模块。总站历史写入失败，可从口语记录重新打开。') }
      }
    }
    window.addEventListener('message', receive)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('message', receive)
      window.removeEventListener('beforeunload', onUnload)
      window.clearTimeout(timer)
      setSpeakingBusy(false)
    }
  }, [userId])

  /* 模考室 / 自由对话之间切换时，iframe 只收到 navigate 消息、不重建；
     外层 .stage-body 会补一次进场，这里不再各自重播，避免两层动画叠加。 */
  useEffect(() => {
    if (current.current === view) return
    current.current = view
    revision.current++
    if (connected.current) frame.current?.contentWindow?.postMessage({ source: 'ielts-coach', type: 'navigate', route: view, revision:revision.current }, location.origin)
  }, [view])

  return (
    <>
      {!ready && timedOut && <p className="speaking-load-error" role="alert">口语模块尚未响应。请确认本站的口语服务已启动，然后 <button type="button" className="btn btn-sm" onClick={() => location.reload()}>重新加载</button></p>}
      <div className="frame-stage" data-ready={ready ? '1' : timedOut ? 'error' : '0'}>
        {/* 恢复账号后由共享动效层一次呈现，避免先淡入 iframe 再重播内容。 */}
        <iframe ref={frame} src={src} className={'speaking-frame' + (ready ? ' is-ready' : '')} title="口语陪练" allow="microphone 'self'; clipboard-write 'self'"
          referrerPolicy="same-origin" style={{ height }} />
      </div>
    </>
  )
}
