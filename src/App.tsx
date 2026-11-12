import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AuthProvider, useAuth } from './auth'
import { getSyncState, retrySync, subscribeSync } from './cloudSync'
import { AppContext, parseHash, toHash, useApp, type Route } from './appContext'
import { repository } from './repository'
import { reviewSummary, tickScoring } from './logic'
import { PointsBurst, SubjectIcon, Toast } from './components'
import { LandingPage } from './pages/LandingPage'
import { VocabularyPage, VocabularyIcon } from './pages/VocabularyPage'
import { HomePage } from './pages/HomePage'
import { PracticePage } from './pages/PracticePage'
import { HistoryPage, MistakesPage, ProfilePage, ReportPage, TrendsPage } from './pages/ReportViews'
import { SUBJECT_PANELS, SubjectPage } from './pages/SubjectPage'
import { GrowthSync } from './campus/GrowthApi'
import { BuddyInviteCount } from './campus/BuddyInviteCount'
import { campusAwardEvent, type CampusAward } from './campus/SocialApi'
import { BuddyReturnLink } from './campus/BuddySession'
import { SpeakingScoreSync } from './pages/SpeakingScores'
import { SUBJECT_META, SUBJECT_ORDER as subjects, type Subject } from './contract'
import { mayLeaveSpeaking } from './speakingIntegration'
import { ReadingHistorySync } from './readingIntegration'
import { WritingHistorySync } from './writingIntegration'
import { setPersistenceScope } from './iframePersist'
import './campus/campusHub.css'

const CampusHub = React.lazy(() => import('./campus/CampusHub').then(module => ({ default: module.CampusHub })))

/** 底部/侧边通用导航（非科目） */
const PAGE_TITLE: Record<Route['name'], { title: string; crumb: string }> = {
  landing: { title: 'IELTS Coach', crumb: '学术类雅思 AI 陪练' },
  auth: { title: '登录 / 注册', crumb: '手机号或邮箱验证码' },
  vocabulary: { title: '词汇积累', crumb: '听说读写通用 · 高频词、听写与间隔复习' },
  home: { title: '学习首页', crumb: '今天练什么，从这里开始' },
  subject: { title: '科目练习', crumb: '听、说、读、写四个板块' },
  campus: { title: '校园营地', crumb: '深圳大学 · 学伴互助与四科训练' },
  practice: { title: '练习', crumb: '按科目完成一次作答' },
  report: { title: '练习报告', crumb: '哪里要改、为什么、下一步练什么' },
  history: { title: '历史记录', crumb: '回看当时的题目、作答与报告' },
  trends: { title: '分数曲线', crumb: '看见每一次练习的变化' },
  mistakes: { title: '错题本', crumb: '听读共用 · 按科目与题型筛选' },
  profile: { title: '个人资料', crumb: '账号、备考目标与校园资料' },
}

/** 个人空间：原先散在左下角的四个入口，收进一个弹层 */
const SPACE_ITEMS: { key: Route['name']; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    key: 'profile', label: '个人资料', desc: '账号、目标分与校园资料', icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.4" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" /></svg>
    ),
  },
  {
    key: 'history', label: '历史记录', desc: '回看每次作答与报告', icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 7.2v5l3.3 2" /><circle cx="12" cy="12" r="8.4" /></svg>
    ),
  },
  {
    key: 'trends', label: '分数曲线', desc: '看见每一次变化', icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3.6 17.5l5-5.6 3.9 3 4.1-6.1 3.8 4.2" /><path d="M3.6 20.4h16.8" /></svg>
    ),
  },
  {
    key: 'mistakes', label: '错题本', desc: '听读共用 · 按题型复习', icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5.4 5.2h13.2v11.4l-6.6 3.2-6.6-3.2z" /><path d="M9 9.4h6M9 12.6h4" /></svg>
    ),
  },
]

type CampusItem = { key: string; label: string; desc: string; path: string; icon: React.ReactNode }

const CAMPUS_ITEMS: CampusItem[] = [
  {
    key: 'base', label: '营地', path: 'campus/base', icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20v-7l8-6 8 6v7" /><path d="M9 20v-5h6v5" /><path d="M12 3v2" /></svg>
    ), desc: '营地猫 · 那盏灯',
  },
  {
    key: 'rank', label: '排行榜', path: 'campus/rank', icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 4h8v4.6a4 4 0 0 1-8 0z" /><path d="M8 5.4H5.4v1.4A3.2 3.2 0 0 0 8.6 10M16 5.4h2.6v1.4a3.2 3.2 0 0 1-3.2 3.2" /><path d="M12 12.6V17M9 20h6" /></svg>
    ), desc: '同校积分排名',
  },
  {
    key: 'partner', label: '寻找搭子', path: 'campus/partner', icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8.4" r="3.2" /><path d="M3.4 19.4c0-3 2.5-5 5.6-5s5.6 2 5.6 5" /><path d="M16 5.6a3 3 0 0 1 0 5.6M17.4 14.6c2 .5 3.4 2.2 3.4 4.4" /></svg>
    ), desc: '按画像匹配',
  },
  {
    key: 'exam', label: '考试经验', path: 'campus/exam', icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.2h6.4A2.6 2.6 0 0 1 13 7.8v12a2 2 0 0 0-2-2H4z" /><path d="M20 5.2h-6.4A2.6 2.6 0 0 0 11 7.8v12a2 2 0 0 1 2-2h7z" /></svg>
    ), desc: '考场档案 · 经验条',
  },
]

function SyncIndicator() {
  const sync = useSyncExternalStore(subscribeSync, getSyncState, getSyncState)
  if (!sync.active) return null
  const label = sync.status === 'error' ? '云端同步失败，记录已留在本机'
    : sync.status === 'syncing' ? `同步中 · ${sync.pending} 项`
      : sync.status === 'loading' ? '连接云端'
        : sync.status === 'saved' ? '已同步到云端' : '本机数据'
  return (
    <div className={`sync-tag ${sync.status === 'error' ? 'is-error' : ''}`}>
      <span>{label}</span>
      {sync.status === 'error' && <button type="button" onClick={() => retrySync()}>重试同步</button>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 登录 / 注册（独立页面）
// ---------------------------------------------------------------------------
function AuthPage() {
  const auth = useAuth()
  const { route, go } = useApp()
  const intent = route.query.mode === 'signup' ? 'signup' : 'signin'
  const [recipient, setRecipient] = useState('')
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const isCloud = auth.mode === 'cloud'
  const isPhone = auth.channel === 'phone'
  // 登录卡使用纯 CSS 立即进场（enter-now），不依赖 ref 与观察器

  const switchChannel = (next: 'phone' | 'email') => {
    if (next === auth.channel) return
    setRecipient('')
    setCode('')
    auth.setChannel(next)
  }

  return (
    <div className="auth-page">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <button className="brand landing-brand" type="button" onClick={() => go('landing')}>
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 40 40" fill="none"><path d="m8 19 24-11-8 26-5.5-11L8 19Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M18.5 23 32 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </span>
            <span className="brand-text"><b>IELTS Coach</b><small>学术类 · AI 陪练</small></span>
          </button>
          <div className="landing-actions">
            {intent === 'signup'
              ? <button className="btn btn-quiet" type="button" onClick={() => go('auth?mode=signin')}>已有账号？登录</button>
              : <button className="btn btn-quiet" type="button" onClick={() => go('auth?mode=signup')}>还没有账号？注册</button>}
          </div>
        </div>
      </header>

      <main className="auth-main">
        <div className="auth-card reveal enter-now">
          <h2>{isCloud ? (intent === 'signup' ? '注册新账号' : '登录你的账号') : '进入学习空间'}</h2>
          <div className="sub">
            {isCloud
              ? (intent === 'signup' ? '用手机号或邮箱验证码注册，无需设置密码' : '手机号或邮箱验证码登录，无需记忆密码')
              : '用昵称进入本机学习空间。登录后可一键体验已有记录的演示模式。'}
          </div>

          <div className="mode-switch">
            <button type="button" className={isCloud ? 'on' : ''} onClick={() => auth.setMode('cloud')}>手机号 / 邮箱</button>
            <button type="button" className={!isCloud ? 'on' : ''} onClick={() => auth.setMode('demo')}>本机体验</button>
          </div>

          {isCloud && (
            <div className="auth-tabs" role="tablist" aria-label="选择登录方式">
              <button type="button" role="tab" aria-selected={isPhone} className={isPhone ? 'on' : ''} onClick={() => switchChannel('phone')}>手机号</button>
              <button type="button" role="tab" aria-selected={!isPhone} className={!isPhone ? 'on' : ''} onClick={() => switchChannel('email')}>邮箱</button>
            </div>
          )}

          {auth.error && <div className="form-msg error">{auth.error}</div>}
          {auth.notice && !auth.error && <div className="form-msg notice">{auth.notice}</div>}

          {!isCloud ? (
            <form onSubmit={(e) => { e.preventDefault(); void auth.demoSignIn(nickname, email) }}>
              <div className="field">
                <label>昵称</label>
                <input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="例如：Alex" />
              </div>
              <div className="field">
                <label>邮箱（用于区分账号）</label>
                <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <button className="btn btn-primary btn-block" type="submit" disabled={auth.busy}>进入学习首页</button>
              <p className="small muted mt12 mb0">
                在当前浏览器使用同一邮箱可继续本机记录；换设备请使用验证码账号。
              </p>
            </form>
          ) : (
            <form onSubmit={(e) => {
              e.preventDefault()
              if (auth.codeSent) void auth.verifyCode(recipient, code)
              else void auth.sendCode(recipient)
            }}>
              <div className="field">
                <label>{isPhone ? '手机号' : '邮箱地址'}</label>
                <input
                  className="input"
                  value={recipient}
                  onChange={(e) => { setRecipient(e.target.value); auth.setFieldError(''); auth.setError('') }}
                  placeholder={isPhone ? '请输入 11 位手机号' : 'you@example.com'}
                  inputMode={isPhone ? 'numeric' : 'email'}
                  autoComplete={isPhone ? 'tel' : 'email'}
                  disabled={auth.codeSent||auth.busy}
                />
                {auth.fieldError && <div className="field-error">{auth.fieldError}</div>}
              </div>
              {auth.codeSent && (
                <div className="field">
                  <label>{isPhone ? '短信中的验证码' : '邮件中的验证码'}</label>
                  <div className="code-row">
                    <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="数字验证码" inputMode="numeric" autoComplete="one-time-code" disabled={auth.busy} autoFocus />
                    <button className="btn btn-soft" type="button" disabled={auth.busy||auth.resendAfter>0} onClick={() => { auth.setError(''); auth.setNotice(''); void auth.sendCode(recipient) }}>{auth.resendAfter>0?`${auth.resendAfter}s 后重发`:'重发'}</button>
                  </div>
                  <button className="btn btn-quiet btn-sm mt8" type="button" onClick={()=>{auth.resetCode();setCode('')}}>更换{isPhone?'手机号':'邮箱'}</button>
                </div>
              )}
              <button className="btn btn-primary btn-block" type="submit" disabled={auth.busy}>
                {auth.busy ? '处理中…' : auth.codeSent ? (intent === 'signup' ? '验证并完成注册' : '验证并登录') : isPhone ? '发送短信验证码' : '发送邮件验证码'}
              </button>
              <p className="small muted mt12 mb0">
                首次使用将自动创建账号；{isPhone ? '验证码以短信发送' : '验证码以邮件发送'}，本站不保存密码。
              </p>
            </form>
          )}

          <div className="auth-demo-entry">
            <button className="btn btn-soft btn-block" type="button" disabled={auth.busy}
              onClick={() => { void auth.oneClickDemoSignIn() }}>
              {auth.busy ? '正在准备演示…' : '演示模式一键登录'}
            </button>
            <p className="small muted mb0">无需验证码 · Test · test@qq.com · 含四科与校园演示记录</p>
          </div>
          <button className="auth-back" type="button" onClick={() => go('landing')}>← 返回首页</button>
        </div>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 主框架
// ---------------------------------------------------------------------------
function Shell() {
  const auth = useAuth()
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  const [version, setVersion] = useState(0)
  const [toastMessage, setToastMessage] = useState('')
  const [award, setAward] = useState<{points:number; label:string; token:number} | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const acceptedHash = React.useRef(window.location.hash)

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash !== acceptedHash.current && !mayLeaveSpeaking()) {
        window.history.replaceState(null, '', acceptedHash.current)
        return
      }
      acceptedHash.current = window.location.hash
      setRoute(parseHash(window.location.hash))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = useCallback((path: string) => {
    const hash = toHash(path)
    if (window.location.hash === hash) {
      return
      // 当前页面已打开。
    } else window.location.hash = hash
  }, [])

  useEffect(() => {
    window.scrollTo({top:0,behavior:'instant'})
  }, [route])

  const replace = useCallback((path: string) => {
    const hash = toHash(path)
    acceptedHash.current = hash
    window.history.replaceState(null, '', hash)
    setRoute(parseHash(hash))
  }, [])

  const refresh = useCallback(() => setVersion((value) => value + 1), [])
  const toast = useCallback((message: string) => setToastMessage(message), [])

  useEffect(() => {
    if (!toastMessage) return
    const timer = window.setTimeout(() => setToastMessage(''), 2800)
    return () => window.clearTimeout(timer)
  }, [toastMessage])

  // 异步评分：刷新后从持久化进度继续推进，评分中的任务不会丢
  useEffect(() => {
    const userId = auth.user?.userId
    if (!userId) return
    const timer = window.setInterval(() => {
      const scoring = repository.listAttempts(userId).filter((item) => item.status === 'scoring')
      if (scoring.length === 0) return
      scoring.forEach((item) => tickScoring(item))
      setVersion((value) => value + 1)
    }, 850)
    return () => window.clearInterval(timer)
  }, [auth.user?.userId])

  async function toggleShowcase() {
    try {
      await auth.toggleShowcase()
      if (['practice', 'report'].includes(route.name) || route.query.case || route.query.example || route.query.buddy ||
          route.query.source || route.query.attempt || route.query.view?.includes('/')) go('home')
    } catch (error) {
      toast(error instanceof Error ? error.message : '暂时无法切换演示，请重试。')
    }
  }

  const userId = auth.user!.userId
  React.useLayoutEffect(() => setPersistenceScope(userId), [userId])
  useEffect(() => {
    let timer = 0
    function onAward(event: Event) {
      const detail = (event as CustomEvent<CampusAward>).detail
      if (detail?.userId !== userId) return
      window.clearTimeout(timer)
      setAward({ points: detail.points, label: detail.label, token: performance.now() })
      timer = window.setTimeout(() => setAward(null), 1900)
    }
    window.addEventListener(campusAwardEvent, onAward)
    return () => { window.clearTimeout(timer); window.removeEventListener(campusAwardEvent, onAward) }
  }, [userId])
  const attempts = repository.listAttempts(userId)
  const mistakes = repository.listMistakes(userId)
  const review = reviewSummary(mistakes)
  const pendingCount = attempts.filter((item) => item.status === 'scoring').length
  const title = PAGE_TITLE[route.name]

  // 底部主标签改为听说读写四个板块，其余入口收进「个人空间」（对应 src/pages/SubjectPage.tsx）
  const currentSubject: Subject = subjects.includes(route.id as Subject) ? (route.id as Subject) : 'listening'
  const titleText = route.name === 'subject'
    ? { title: SUBJECT_PANELS[currentSubject].name, crumb: SUBJECT_META[currentSubject].label + ' · ' + SUBJECT_PANELS[currentSubject].tagline }
    : title

  const [spaceOpen, setSpaceOpen] = useState(false)
  const toggleSpace = () => {
    setMenuOpen(false)
    setSpaceOpen(open => !open)
  }

  const activeCampus = ['partner', 'match', 'recruit', 'partners'].includes(route.id)
    ? 'partner' : route.id || 'base'

  const contextValue = useMemo(() => ({ route, go, replace, version, refresh, toast }), [route, go, replace, version, refresh, toast])

  // 个人空间弹层：点外部或按 Esc 关闭
  useEffect(() => {
    if (!spaceOpen) return
    const onDown = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.space-panel, .space-sheet-card, [data-space-toggle]')) return
      setSpaceOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSpaceOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [spaceOpen])
  useEffect(() => { setSpaceOpen(false) }, [route])

  useEffect(() => { setMenuOpen(false) }, [route])
  useEffect(() => {
    if (!menuOpen && !(spaceOpen && window.matchMedia('(max-width: 760px)').matches)) return
    const dialog = document.querySelector(menuOpen ? '.sidebar' : '.space-sheet')
    const previousFocus = document.activeElement
    const buttons = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
      .filter(button => button.offsetWidth > 0)
    buttons[0]?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        setSpaceOpen(false)
      }
      if (event.key !== 'Tab' || !buttons.length) return
      const boundary = event.shiftKey ? 0 : buttons.length - 1
      if (document.activeElement !== buttons[boundary]) return
      event.preventDefault()
      buttons[event.shiftKey ? buttons.length - 1 : 0].focus()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [menuOpen, spaceOpen])

  const personalMenu = (
    <>
      <div className="space-panel-head">
        <span className="avatar">{auth.user!.nickname.slice(0, 1).toUpperCase()}</span>
        <div>
          <b>{auth.user!.nickname}</b>
          <small>{auth.user!.email || '本机账号'} · 目标分 {auth.profile?.targetBand ?? 6.5}</small>
        </div>
      </div>
      <div className="space-list">
        {SPACE_ITEMS.map(item => (
          <button key={item.key} type="button" className={`space-item ${route.name === item.key ? 'on' : ''}`}
            onClick={() => { setSpaceOpen(false); go(item.key) }}>
            <i aria-hidden="true">{item.icon}</i>
            <span><b>{item.label}</b><small>{item.desc}</small></span>
            {item.key === 'mistakes' && review.total > 0 && <span className="count">{review.total}</span>}
          </button>
        ))}
      </div>
      <div className="space-foot">
        <button type="button" className="space-signout" onClick={() => { if (mayLeaveSpeaking()) void auth.signOut() }}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h9" /></svg>
          退出登录
        </button>
      </div>
    </>
  )

  let page: React.ReactNode
  switch (route.name) {
    case 'practice': page = <PracticePage />; break
    case 'report': page = <ReportPage />; break
    case 'history': page = <HistoryPage />; break
    case 'trends': page = <TrendsPage />; break
    case 'mistakes': page = <MistakesPage />; break
    case 'profile': page = <ProfilePage />; break
    case 'subject': page = <SubjectPage key={currentSubject} subject={currentSubject} />; break
    case 'vocabulary': page = <VocabularyPage />; break
    case 'campus': page = (
      <React.Suspense fallback={null}>
        <CampusHub key={userId} />
      </React.Suspense>
    ); break
    default: page = <HomePage />
  }

  return (
    <AppContext.Provider value={contextValue}>
      <GrowthSync key={'growth-' + userId} />
      <SpeakingScoreSync key={userId} userId={userId} />
      <ReadingHistorySync key={'reading-' + userId} />
      <WritingHistorySync key={'writing-' + userId} />
      <div className={`app-shell ${menuOpen ? 'menu-open' : ''}`}>
        <div className="nav-scrim" role="presentation" onClick={() => setMenuOpen(false)} />
        <aside id="site-sidebar" className="sidebar">
          <div className="sidebar-top">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="m8 19 24-11-8 26-5.5-11L8 19Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M18.5 23 32 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></span>
              <span><b>IELTS Coach</b><small>学术类 · AI 陪练</small></span>
            </div>
            <button className="nav-close" type="button" aria-label="关闭菜单" onClick={() => setMenuOpen(false)}>×</button>
          </div>

          <div className="nav-group">
            <div className="nav-label">四科板块</div>
            {/* 学习首页：放在四科之前（听力精练上方），作为回到首页的固定入口 */}
            <button type="button" aria-label="学习首页" title="学习首页" aria-current={route.name === 'home' ? 'page' : undefined}
              className={`nav-item nav-home ${route.name === 'home' ? 'active' : ''}`} onClick={() => go('home')}>
              <i>⌂</i><span>学习首页</span>
            </button>
            {subjects.map((key) => {
              const active = route.name === 'subject' && route.id === key
              return (
                <button key={key} type="button" className={`nav-item ${active ? 'active' : ''}`}
                  aria-label={SUBJECT_PANELS[key].name} title={SUBJECT_PANELS[key].name} aria-current={active ? 'page' : undefined}
                  onClick={() => go(`subject/${key}`)}>
                  <i className="nav-subject-icon" style={{ background: SUBJECT_META[key].soft, color: SUBJECT_META[key].color }}>
                    <SubjectIcon subject={key} size={15} />
                  </i>
                  <span>{SUBJECT_PANELS[key].name}</span>
                  {!!review.bySubject[key] && <span className="count" title="待复习错题">{review.bySubject[key]}</span>}
                </button>
              )
            })}
          </div>

          <nav className="nav-group learning-tool-nav" aria-label="学习工具">
            <div className="nav-label">学习工具</div>
            <button type="button" className={'nav-item' + (route.name === 'vocabulary' ? ' active' : '')}
              aria-label="词汇积累" title="词汇积累" aria-current={route.name === 'vocabulary' ? 'page' : undefined} onClick={() => go('vocabulary')}>
              <i aria-hidden="true"><VocabularyIcon/></i><span>词汇积累</span>
            </button>
          </nav>

          <nav className="camp-tiles" aria-label="校园导航">
            <div className="nav-label camp-tiles-label">深圳大学 · 校园</div>
            <div className="camp-tile-grid">
              {CAMPUS_ITEMS.map(item => {
                const active = route.name === 'campus' && activeCampus === item.key
                return (
                  <button key={item.key} type="button" className={`camp-tile ${active ? 'on' : ''}`}
                    aria-label={item.label} aria-current={active ? 'page' : undefined} title={item.label + ' · ' + item.desc}
                    onClick={() => go(item.path)}>
                    <span className="camp-tile-ico" aria-hidden="true">{item.icon}</span>
                    <span className="camp-tile-name">{item.label}</span>
                    {item.key === 'partner' && <BuddyInviteCount />}
                  </button>
                )
              })}
            </div>
          </nav>

          <div className="side-foot">
            <div className="mode-tag">
              {auth.showcase ? '● 演示 · 独立练习空间' : auth.mode === 'demo' ? '● 本机账号' : '● 云账号 · 已登录'}
              {pendingCount > 0 && ` · ${pendingCount} 项评分中`}
            </div>
            <SyncIndicator />
            <div className="space-wrap">
              <button
                className={`space-trigger ${spaceOpen ? 'on' : ''}`}
                type="button"
                aria-label="个人空间" title="个人空间"
                aria-expanded={spaceOpen}
                data-space-toggle onClick={toggleSpace}
              >
                <span className="avatar sm">{auth.user!.nickname.slice(0, 1).toUpperCase()}</span>
                <span className="space-trigger-text">
                  <b>个人空间</b>
                  <small>{auth.user!.nickname} · 目标 {auth.profile?.targetBand ?? 6.5}</small>
                </span>
                <svg className="space-caret" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6" /></svg>
              </button>
              {spaceOpen && (
                <div className="space-panel" role="group" aria-label="个人空间">
                  {personalMenu}
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <button className="nav-toggle" type="button" aria-label="打开菜单" aria-controls="site-sidebar" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="topbar-title">
              <h2>{titleText.title}</h2>
              <div className="crumb">{titleText.crumb}</div>
            </div>
            <div className="top-actions">
              {pendingCount > 0 && <span className="chip amber">{pendingCount} 项评分中</span>}
              <button type="button" className="showcase-toggle" aria-pressed={auth.showcase}
                disabled={auth.busy} aria-label={auth.showcase ? '退出演示模式' : '进入演示模式'} title={auth.showcase ? '退出并返回我的学习数据' : '用当前昵称体验已有练习记录的账号'}
                onClick={() => { if (mayLeaveSpeaking()) void toggleShowcase() }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M10 8l5 3-5 3zM9 21l3-4 3 4"/></svg>
                <span>{auth.showcase ? '退出演示' : '演示模式'}</span>
              </button>
            </div>
          </header>

          <div className="content">
            {auth.notice && route.name === 'home' && !auth.error && (
              <div className="banner info">{auth.notice}</div>
            )}
            <BuddyReturnLink />
            <div className="page-view" key={route.name === 'subject' ? 'subject-' + currentSubject : route.name}>
              {route.name === 'subject' || route.name === 'campus' || route.name === 'vocabulary'
                ? page
                : <div className="stage-body" key={route.name + '/' + route.id}>{page}</div>}
            </div>
          </div>
        </main>
      </div>
      {/* 手机端底部标签栏：听说读写四个板块 + 个人空间 */}
      <nav className="tabbar" aria-label="科目导航">
        {subjects.map((key) => (
          <button
            key={key}
            type="button"
            className={`tabbar-item ${route.name === 'subject' && route.id === key ? 'on' : ''}`}
            aria-current={route.name === 'subject' && route.id === key ? 'page' : undefined}
            onClick={() => go(`subject/${key}`)}
          >
            <SubjectIcon subject={key} size={19} />
            <span>{SUBJECT_META[key].label}</span>
          </button>
        ))}
        <button type="button" className={`tabbar-item ${spaceOpen ? 'on' : ''}`} data-space-toggle onClick={toggleSpace}>
          <span className="tabbar-avatar" aria-hidden="true">{auth.user!.nickname.slice(0, 1).toUpperCase()}</span>
          <span>{spaceOpen ? '收起' : '空间'}</span>
        </button>
      </nav>
      {/* 移动端个人空间：从底部弹出，覆盖在标签栏之上 */}
      {spaceOpen && (
        <div className="space-sheet" role="dialog" aria-modal="true" aria-label="个人空间">
          <div className="space-sheet-card">
            <div className="space-sheet-grip" aria-hidden="true" />
            <button className="space-sheet-close" aria-label="关闭个人空间" type="button" onClick={() => setSpaceOpen(false)}>×</button>
            {personalMenu}
          </div>
        </div>
      )}
      {award && <PointsBurst {...award} />}
      <Toast message={toastMessage} />
    </AppContext.Provider>
  )
}

export default function App() {
  const auth = useAuth()
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 已登录时访问公开页：自动进入学习首页，避免出现「登录后仍停在落地页」
  useEffect(() => {
    if (!auth.ready || !auth.user) return
    if (route.name === 'landing' || route.name === 'auth') {
      window.location.hash = toHash('home')
    }
  }, [auth.ready, auth.user, route.name])

  // 加载态兜底：正常情况下 auth.ready 很快为 true。
  // 但若初始化意外被打断（例如模式切换后 ready 被置回 false 而恢复流程没再执行），
  // 页面会永久停在首屏加载层。这里加 6 秒超时，
  // 超时后不再阻塞渲染，至少让用户能继续操作，而不是面对一个死页面。
  const [bootTimedOut, setBootTimedOut] = useState(false)
  useEffect(() => {
    if (auth.ready) return
    const t = window.setTimeout(() => setBootTimedOut(true), 6000)
    return () => window.clearTimeout(t)
  }, [auth.ready])

  if (!auth.ready && !bootTimedOut) {
    return <main className="app-start" role="status"><b>IELTS Coach</b><span>正在恢复学习空间…</span></main>
  }

  if (auth.user) return <Shell key={auth.user.userId} />

  // 未登录：落地页 / 登录页各自独立，其余业务路由一律引导到登录
  const goPublic = (path: string) => { window.location.hash = toHash(path) }
  if (route.name === 'landing') return <LandingPage onEnter={goPublic} />
  if (route.name === 'auth') {
    return (
      <AppContext.Provider value={{ route, go: goPublic, version: 0, refresh: () => {}, toast: () => {} }}>
        <AuthPage />
      </AppContext.Provider>
    )
  }
  return <LandingPage onEnter={goPublic} />
}

class ApplicationBoundary extends React.Component<{children: React.ReactNode}, {failed: boolean}> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <main className="app-start" role="alert"><h1>页面暂时无法打开</h1><p>已保存的练习可在重新加载后继续查看。</p><button className="btn btn-primary" onClick={() => location.reload()}>重新加载</button><a href="#/home" onClick={() => this.setState({failed: false})}>返回学习首页</a></main>
    return this.props.children
  }
}
export function Root() {
  return (
    <ApplicationBoundary><AuthProvider>
      <App />
    </AuthProvider></ApplicationBoundary>
  )
}

export { DailyTasks } from './components'
