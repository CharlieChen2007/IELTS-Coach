/** Writing module host. Account scope, navigation, saved reports and campus
 * practice all use the current main-site session. The iframe stays mounted
 * between its own tabs so a draft survives navigation to peer support. */
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext'
import { useAuth } from '../auth'
import { useEnterReplay } from '../components'
import { syncWritingHistory } from '../writingIntegration'
import { repository } from '../repository'
import { useFrameHeight } from '../frameHeight'
import { SubjectPeerSupport } from '../campus/ClinicEvidence'
import './workspaceNavigation.css'

const WRITING_HEIGHT_FALLBACK = 1400

const writingGroups = [
  { key: 'training', label: '写作训练', views: [['overview', '练习概览'], ['practice', '写作精修']] },
  { key: 'review', label: '批改与复盘', views: [['report', '批改报告'], ['compare', '二稿对比'], ['history', '练习记录']] },
  { key: 'peers', label: '学伴互助', views: [['peers', '学伴互助']] },
] as const

type WritingView = typeof writingGroups[number]['views'][number][0]
const INNER_VIEWS = ['overview', 'practice', 'report', 'compare', 'history'] as const
type InnerView = typeof INNER_VIEWS[number]

function writingView(raw: string | undefined): WritingView {
  if (raw === 'peers') return 'peers'
  if (raw === 'practice' || raw === 'report' || raw === 'compare' || raw === 'history') return raw
  /* 空 / 旧深链 studio / 未知值统一落到练习概览 */
  return 'overview'
}

function writingPath(view: WritingView) {
  return view === 'overview' ? 'subject/writing' : 'subject/writing?view=' + view
}

export function WritingPanel({ userId }: { userId: string }) {
  const { go, replace, route } = useApp()
  const view = writingView(route.query.view)
  const [unavailable, setUnavailable] = useState<WritingView | null>(null)
  const [navigation, setNavigation] = useState(0)
  const group = writingGroups.find(group => group.views.some(([key]) => key === view))!
  const lastGroupView = useRef<Record<string, WritingView>>({ training: 'overview', review: 'report', peers: 'peers' })
  lastGroupView.current[group.key] = view
  /* 页签行静止；只有页签下方这一块按视图进场一次，iframe 不随之重建。 */
  const stage = useEnterReplay<HTMLDivElement>(view)
  /* 「学伴互助」由主站统一组件渲染，但 iframe 只隐藏、不卸载：正在编辑的正文、
     草稿与工作区备份都不会因为切换被打断（阅读同样处理，全站一个口径）。 */
  const lastInner = useRef<InnerView>('overview')
  if (view !== 'peers') lastInner.current = view
  function openView(next: WritingView) {
    setUnavailable(null)
    if (view !== next) go(writingPath(next))
    else setNavigation(value => value + 1)
  }
  const onInnerView = (inner: InnerView, rejected: boolean, requested?: string) => {
    if (requested && requested !== view) return
    if (rejected && (view === 'report' || view === 'compare')) {
      setUnavailable(view)
      return
    }
    setUnavailable(null)
    if (inner !== view) {const next=new URLSearchParams({...route.query,view:inner});replace?.('subject/writing?'+next)}
  }
  const emptyView = unavailable === view
  return (
    <section aria-label="写作练习工作区" className="speaking-workspace writing-workspace">
      <div className="workspace-toolbar">
      <nav className="speaking-tools workspace-primary" aria-label="写作栏目">
        {writingGroups.map(item => (
          <button key={item.key} type="button" className={group.key === item.key ? 'on' : ''}
            aria-pressed={group.key === item.key}
            onClick={() => { if (group.key !== item.key) openView(lastGroupView.current[item.key]) }}>{item.label}</button>
        ))}
      </nav>
      {group.views.length > 1 && <nav className="workspace-secondary" aria-label={group.label}>
        {group.views.map(([key, label]) => (
          <button key={key} type="button" className={view === key ? 'on' : ''}
            aria-current={view === key ? 'page' : undefined}
            onClick={() => openView(key)}>{label}</button>
        ))}
      </nav>}
      </div>
      <div className="stage-body" ref={stage}>
        {/* iframe 常驻，隐藏时不占布局；切回来仍是同一个文档，草稿原样保留。 */}
        <div className="frame-hold" style={{ display: view === 'peers' || emptyView ? 'none' : undefined }}>
          <WritingFrame key={userId} userId={userId} view={lastInner.current}
            hidden={view === 'peers' || emptyView} navigation={navigation} onInnerView={onInnerView} />
        </div>
        {view === 'peers' && <SubjectPeerSupport key="writing" subject="writing" />}
        {emptyView && <section className="card workspace-empty" aria-live="polite">
          <h2>{view === 'report' ? '还没有可查看的批改报告' : '还没有可对比的二稿'}</h2>
          <p>{view === 'report' ? '完成一篇作文后，在这里逐句查看反馈和修改建议。' : '先完成一稿，再根据批改建议写一份二稿，就能对照修改前后的表达。'}</p>
          <button type="button" className="btn btn-primary" onClick={() => openView('practice')}>去写作精修</button>
        </section>}
      </div>
    </section>
  )
}

function WritingFrame({ userId, view, hidden, navigation, onInnerView }: {
  userId: string
  view: Exclude<WritingView, 'peers'>
  hidden: boolean
  navigation: number
  onInnerView: (inner: InnerView, rejected: boolean, requested?: string) => void
}) {
  const { user } = useAuth()
  const { toast, route, go, refresh } = useApp()
  const frame = useRef<HTMLIFrameElement>(null)
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden
  const [height, pushHeight] = useFrameHeight('writing', 320, WRITING_HEIGHT_FALLBACK, 800, true)
  const [ready, setReady] = useState(false)
  const readyRef = useRef(false)
  const lastPresentedView = useRef<string>(view)
  const [src] = useState(() => {
    const params = new URLSearchParams({ embedded: '1', scope: userId, nickname: user?.nickname || '' })
    return '/writing/index.html?' + params
  })
  const inner = useRef(onInnerView)
  inner.current = onInnerView
  const notify = useRef(toast)
  notify.current = toast

  /** iframe 顶部在主站文档里的绝对坐标；所有 iframe 内滚动意图都换算到这一条轴上 */
  const frameTop = () => {
    const el = frame.current
    if (!el) return 0
    return el.getBoundingClientRect().top + window.scrollY
  }
  const visibleFrameTop = (top = 0) => Math.max(0, frameTop() + top -
    (document.querySelector('.topbar')?.getBoundingClientRect().height || 77) - 16)

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return
      const data = event.data
      if (data?.source !== 'ielts-writing') return
      if (data.type === 'size' && Number.isFinite(data.height)) pushHeight(Math.min(32000, Math.ceil(data.height)))
      if (data.type === 'ready') {readyRef.current=true;setReady(true)}
      /* 交接包内部自己切了视图：同步地址栏与页签高亮。与主站页签点出来的视图
         相同时不回头 replace，避免 postMessage 来回打转。 */
      if (readyRef.current && !hiddenRef.current && data.type === 'view' && INNER_VIEWS.includes(data.view)) {
        const changed = lastPresentedView.current !== data.view && !data.rejected
        lastPresentedView.current = data.view
        inner.current(data.view, data.rejected === true, data.requested)
        if (changed) requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!hiddenRef.current) window.scrollTo({top:visibleFrameTop(),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
        }))
      }
      /* 界面一体化：模态框已改成页内白卡，出现时带到它所在位置；
         模块内的定位滚动也统一由主站 document 承担，不再出现第二根滚动条。 */
      if (data.type === 'reveal' && !hiddenRef.current && Number.isFinite(data.top)) {
        window.scrollTo({ top: visibleFrameTop(data.top), behavior: 'smooth' })
      }
      if (data.type === 'scrollTo' && !hiddenRef.current && Number.isFinite(data.top)) {
        window.scrollTo({ top: visibleFrameTop(data.top), behavior: data.behavior === 'smooth' ? 'smooth' : 'instant' })
      }
      if(data.type==='openHostReport' && user && typeof data.id==='string' && /^[\w.:-]{1,160}$/.test(data.id)) {
        void (async()=>{for(let tries=0;tries<5;tries++){await syncWritingHistory(user);if(repository.getReport(user.userId,'rpt_wr_'+data.id)){refresh();go('report/rpt_wr_'+data.id);return}await new Promise(resolve=>setTimeout(resolve,250))}notify.current('报告仍在同步，请稍后从历史记录打开。')})().catch(()=>notify.current('报告同步失败，请检查连接后重试。'))
      }
      if (data.type === 'toast' && typeof data.message === 'string' && data.message.trim()) {
        notify.current(data.message.trim())
      }
      /* 科目横幅与模块内统计同源，四科口径统一。 */
      if (data.type === 'stats') {
        window.dispatchEvent(new CustomEvent('ielts:subject-stats', {
          detail: { subject: 'writing', attempts: data.attempts, band: data.band, pool: data.pool, poolLabel: data.poolLabel },
        }))
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [pushHeight])

  /* 页签互切直接调模块，不重载 iframe —— 草稿、滚动位置、正在编辑的正文都会丢。 */
  useEffect(() => {
    if (!ready || !frame.current) return
    frame.current.contentWindow?.postMessage(
      { source: 'ielts-coach', type: 'navigate', view }, location.origin)
  }, [view, ready, navigation])

  useEffect(() => {
    if(ready && route.query.submission) frame.current?.contentWindow?.postMessage({source:'ielts-coach',type:'openReport',submission:route.query.submission},location.origin)
  },[ready,route.query.submission])

  useEffect(() => {
    if(ready && route.query.task) frame.current?.contentWindow?.postMessage({source:'ielts-coach',type:'openTopic',task:route.query.task},location.origin)
  },[ready,route.query.task])

  /* 从「学伴互助」切回来时 iframe 由隐藏恢复：主动要求补报高度，避免沿用
     隐藏期间的兜底值把内容裁掉。iframe 本身没有重建，所以草稿原样还在。 */
  useEffect(() => {
    if (!ready || hidden) return
    frame.current?.contentWindow?.postMessage(
      { source: 'ielts-coach', type: 'wake' }, location.origin)
  }, [hidden, ready])

  return (
    <div className="frame-stage" data-ready={ready ? '1' : '0'}>
      <iframe ref={frame} src={src}
        className={'speaking-frame writing-frame' + (ready ? ' is-ready' : '')}
        title="写作精修室" referrerPolicy="same-origin" style={{ height }} />
    </div>
  )
}
