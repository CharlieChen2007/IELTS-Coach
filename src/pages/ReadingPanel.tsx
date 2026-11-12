/** 阅读工作区保留原生题库与精读工具，通过同源桥接完成导航、
 * 内容高度、不可变交卷、统一历史和校园复练。 */
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext'
import { useAuth } from '../auth'
import { useEnterReplay } from '../components'
import { useFrameHeight } from '../frameHeight'
import { SubjectPeerSupport } from '../campus/ClinicEvidence'
import {campusRequest} from '../campus/SocialApi'
import {saveReadingSession, type ReadingSession} from '../readingIntegration'
import {repository} from '../repository'
import './workspaceNavigation.css'

const READING_HEIGHT_FALLBACK = 760

const readingGroups = [
  { key: 'training', label: '阅读训练', views: [['overview', '题库总览'], ['practice', '篇章练习']] },
  { key: 'tools', label: '学习工具', views: [['mistakes', '错题本'], ['vocab', '阅读生词'], ['readlib', '精读库'], ['weak', '薄弱题型'], ['profile', '学习档案']] },
  { key: 'peers', label: '学伴互助', views: [['peers', '学伴互助']] },
] as const

type ReadingView = typeof readingGroups[number]['views'][number][0]
const INNER_VIEWS = ['overview', 'practice', 'mistakes', 'vocab', 'readlib', 'weak', 'profile'] as const
type InnerView = typeof INNER_VIEWS[number]

function readingView(raw: string | undefined): ReadingView {
  if ((INNER_VIEWS as readonly string[]).includes(raw || '') || raw === 'peers') return raw as ReadingView
  /* 空 / 旧深链 studio / 未知值统一落到题库总览 */
  return 'overview'
}

function readingPath(view: ReadingView) {
  return view === 'overview' ? 'subject/reading' : 'subject/reading?view=' + view
}

export function ReadingPanel({ userId }: { userId: string }) {
  const { go, replace, route } = useApp()
  const view = readingView(route.query.view)
  const group = readingGroups.find(group => group.views.some(([key]) => key === view))!
  const lastGroupView = useRef<Record<string, ReadingView>>({ training: 'overview', tools: 'mistakes', peers: 'peers' })
  lastGroupView.current[group.key] = view
  const [navigation,setNavigation]=useState(0)
  /* 页签行静止；只有页签下方这一块按视图进场一次，iframe 不随之重建。 */
  const stage = useEnterReplay<HTMLDivElement>(view)
  /* 「学伴互助」由主站统一组件渲染，但 iframe 只隐藏、不卸载：草稿、阅读位置、
     以及正在完成的进度备份都不会因为切换被打断（写作同样处理，全站一个口径）。 */
  const lastInner = useRef<InnerView>('overview')
  if (view !== 'peers') lastInner.current = view
  const onInnerView = (inner: InnerView, reset: boolean) => {
    if (inner !== view) replace?.(readingPath(inner))
    else if (reset && inner !== 'practice') window.scrollTo({ top: 0, behavior: 'instant' })
  }
  return (
    <section aria-label="阅读练习工作区" className="speaking-workspace reading-workspace">
      <div className="workspace-toolbar">
      <nav className="speaking-tools workspace-primary" aria-label="阅读栏目">
        {readingGroups.map(item => (
          <button key={item.key} type="button" className={group.key === item.key ? 'on' : ''}
            aria-pressed={group.key === item.key}
            onClick={() => { if (group.key !== item.key) go(readingPath(lastGroupView.current[item.key])) }}>{item.label}</button>
        ))}
      </nav>
      {group.views.length > 1 && <nav className="workspace-secondary" aria-label={group.label}>
        {group.views.map(([key, label]) => (
          <button key={key} type="button" className={view === key ? 'on' : ''}
            aria-current={view === key ? 'page' : undefined}
            onClick={() => { if (view !== key) go(readingPath(key)); else setNavigation(value => value + 1) }}>{label}</button>
        ))}
      </nav>}
      </div>
      <div className="stage-body" ref={stage}>
        {/* iframe 常驻，隐藏时不占布局；切回来仍是同一个文档，不需要重新加载题库。 */}
        <div className="frame-hold" style={{ display: view === 'peers' ? 'none' : undefined }}>
          <ReadingFrame key={userId} userId={userId} view={lastInner.current} passage={route.query.passage} navigation={navigation}
            hidden={view === 'peers'} onInnerView={onInnerView} />
        </div>
        {view === 'peers' && <SubjectPeerSupport key="reading" subject="reading" />}
      </div>
    </section>
  )
}

function ReadingFrame({ userId, view, hidden, onInnerView, passage,navigation }: {
  userId: string
  view: Exclude<ReadingView, 'peers'>
  hidden: boolean
  onInnerView: (inner: InnerView, reset: boolean) => void
  passage?: string
  navigation:number
}) {
  const { user } = useAuth()
  const { toast,refresh,go } = useApp()
  const frame = useRef<HTMLIFrameElement>(null)
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden
  const [height, pushHeight] = useFrameHeight('reading', 320, READING_HEIGHT_FALLBACK, 800, true)
  const [ready, setReady] = useState(false)
  const [src] = useState(() => {
    const params = new URLSearchParams({ embedded: '1', scope: userId, nickname: user?.nickname || '' })
    // The module's default route is #/. Starting there avoids replacing its
    // freshly rendered overview when the first ready acknowledgement arrives.
    return '/reading/index.html?' + params + '#/'
  })
  const inner = useRef(onInnerView)
  inner.current = onInnerView
  const notify = useRef(toast)
  notify.current = toast

  /** iframe 顶部在主站文档里的绝对坐标 —— 所有 iframe 内滚动意图都要换算到它 */
  const frameTop = () => {
    const el = frame.current
    if (!el) return 0
    return el.getBoundingClientRect().top + window.scrollY
  }

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return
      const data = event.data
      if (data?.source !== 'ielts-reading') return
      if(data.type==='submit'&&user){
        const target=event.source as Window
        void campusRequest<{session:ReadingSession}>(user,'/api/reading/submit',data.session).then(result=>{
          if(saveReadingSession(userId,result.session))refresh()
          target.postMessage({source:'ielts-coach',type:'reading-submit-result',id:data.session.id,session:result.session},location.origin)
        }).catch(error=>{
          target.postMessage({source:'ielts-coach',type:'reading-submit-result',id:data.session?.id,error:(error as Error).message},location.origin)
        })
      }
      if(data.type==='open-report' && /^s_[\w-]{1,100}$/.test(data.sessionId||'')) {
        const id='rpt_rd_'+data.sessionId
        if(repository.getReport(userId,id))go('report/'+id)
        else notify.current('报告尚未同步完成，请稍后重试。')
      }
      if (data.type === 'size' && Number.isFinite(data.height)) pushHeight(Math.min(32000, Math.ceil(data.height)))
      if (data.type === 'practice-layout' && data.active && Number.isFinite(data.height)) {
        pushHeight(Math.min(32000, Math.max(320, Math.ceil(data.height))))
        const box=frame.current?.getBoundingClientRect()
        const headerHeight=document.querySelector<HTMLElement>('.topbar')?.offsetHeight||77
        const alignAfterResize=box&&box.top>headerHeight+14&&box.top<window.innerHeight*.6
        if ((data.enter || alignAfterResize) && !hiddenRef.current) {
          requestAnimationFrame(() => {
            const el=frame.current
            if(!el)return
            let top=0
            for(let node:HTMLElement|null=el;node;node=node.offsetParent as HTMLElement|null)top+=node.offsetTop
            const header=document.querySelector<HTMLElement>('.topbar')?.offsetHeight||77
            window.scrollTo({top:Math.max(0,top-header-12),behavior:'instant'})
          })
        }
      }
      if (data.type === 'ready') setReady(true)
      /* 交接包内部自己切了视图：同步地址栏与页签高亮。与主站页签点出来的视图
         相同时不回头 replace，避免 postMessage 来回打转。 */
      if (!hiddenRef.current && data.type === 'view' && (INNER_VIEWS as readonly string[]).includes(data.view)) {
        inner.current(data.view, Boolean(data.reset))
      }
      if (data.type === 'scrollTo' && !hiddenRef.current && Number.isFinite(data.top)) {
        window.scrollTo({ top: Math.max(0, frameTop() + data.top), behavior: data.behavior === 'smooth' ? 'smooth' : 'instant' })
      }
      /* 站内确认框已改成页内白卡：出现时带到它所在位置，滚轮仍只控制主站。 */
      if (data.type === 'reveal' && !hiddenRef.current && Number.isFinite(data.top)) {
        window.scrollTo({ top: Math.max(0, frameTop() + data.top), behavior: 'smooth' })
      }
      if (data.type === 'toast' && typeof data.message === 'string' && data.message.trim()) {
        notify.current(data.message.trim())
      }
      /* 科目横幅与模块内统计同源：避免「可练题目 2」和「共 217 题」并置的矛盾。 */
      if (data.type === 'stats') {
        window.dispatchEvent(new CustomEvent('ielts:subject-stats', {
          detail: { subject: 'reading', attempts: data.attempts, band: null, display:data.display, pool: data.pool, poolLabel: data.poolLabel },
        }))
      }
    }
    window.addEventListener('message', receive)

    /* 把主站的滚动量同步给 iframe，让它内部「记住读到的地方」等逻辑继续工作。
       节流到 120ms，避免每次滚动都 postMessage。 */
    let timer = 0
    function onScroll() {
      if (timer) return
      timer = window.setTimeout(() => {
        timer = 0
        frame.current?.contentWindow?.postMessage(
          { source: 'ielts-coach', type: 'hostScroll', top: Math.max(0, window.scrollY - frameTop()) },
          location.origin)
      }, 120)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('message', receive)
      window.removeEventListener('scroll', onScroll)
      if (timer) window.clearTimeout(timer)
    }
  }, [pushHeight])

  /* 页签互切直接改 iframe 的 hash，不重载 iframe —— 草稿、标注、阅读位置都会丢。 */
  useEffect(() => {
    if (!ready || !frame.current) return
    frame.current.contentWindow?.postMessage(
      { source: 'ielts-coach', type: 'navigate', view,passage }, location.origin)
  }, [view, ready,passage,navigation])

  /* 从「学伴互助」切回来时 iframe 由隐藏恢复：主动要求补报高度，避免沿用
     隐藏期间的兜底值把内容裁掉。iframe 本身没有重建，所以草稿与位置原样还在。 */
  useEffect(() => {
    if (!ready || hidden) return
    frame.current?.contentWindow?.postMessage(
      { source: 'ielts-coach', type: 'wake' }, location.origin)
  }, [hidden, ready])

  return (
    <div className="frame-stage" data-ready={ready ? '1' : '0'}>
      <iframe ref={frame} src={src}
        className={'speaking-frame reading-frame' + (ready ? ' is-ready' : '')}
        title="阅读精读" referrerPolicy="same-origin" style={{ height }} />
    </div>
  )
}
