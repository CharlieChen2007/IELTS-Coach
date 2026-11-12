/**
 * 科目标签页（听 / 说 / 读 / 写）
 *
 * 首页底部四宫格 → 这里。本页只做「入口壳 + 已定稿接口」，具体内容由各科负责人接入：
 *
 *  1. 题目列表   subjectPanels[subject].listExercises(ctx)  → 返回该科练习列表（异步可替换为接口）
 *  2. 模块渲染   subjectPanels[subject].render(ctx)        → 若实现，则整页内容交给该科自渲染
 *  3. 设置项     subjectPanels[subject].settings          → 顶部筛选项（题库来源、题型 …）
 *
 * 契约与编号沿用 src/contract.ts（exr_ / atm_ / rpt_），跳转仍走 AppContext.go，
 * 因此各科只需提供「题目 + 判分」，路由与布局不用改。
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { useApp } from '../appContext'
import { repository } from '../repository'
import { formatDateTime } from '../logic'
import { PRACTICES } from '../seed'
import { MODE_LABEL, SUBJECT_META, type Attempt, type Practice, type Subject } from '../contract'
import { Card, CardHead, Empty, SubjectIcon, useEnterReplay } from '../components'
import { SpeakingPanel } from './SpeakingPanel'
import { ListeningPanel } from './ListeningPanel'
import { WritingPanel } from './WritingPanel'
import { ReadingPanel } from './ReadingPanel'
import { SubjectPeerSupport } from '../campus/ClinicEvidence'
import { SocialTeamPeek } from '../campus/Social'
import { WeeklyTeamPeek } from './WeeklyTeamPeek'

export interface SubjectPanelMeta {
  /** 板块名（导航与标题使用） */
  name: string
  /** 一句话定位 */
  tagline: string
  /** 首页四宫格上的一句说明 */
  blurb: string
  /** 该模块下已具备的能力，用于告诉组员「接口已留好，接哪里」 */
  owns: string[]
}

export const SUBJECT_PANELS: Record<Subject, SubjectPanelMeta> = {
  listening: {
    name: '听力精练',
    tagline: '听四段真人录音，独立交卷，回到原声里找出错因',
    blurb: '四段原声精练、错因分析与定位回听',
    owns: ['音频播放器（Section 1–4）', '填空 / 选择 / 配对判题', '答案定位与同义替换标注'],
  },
  speaking: {
    name: '口语陪练',
    tagline: '跟随考官完成 Part 1–3，或和校园搭子轮流出题、回听与复练',
    blurb: '全流程模考、自由对话与双人模拟考',
    owns: ['分段录音与逐题回听', '对话追问与表达反馈', '校园搭子双人模拟考'],
  },
  reading: {
    name: '阅读精读',
    tagline: '一篇长文，按题型定位到句',
    blurb: '分屏刷题、原文定位与错词复盘',
    owns: ['分屏做题与自动判分', '原文出处高亮与逐句依据', '错题本 / 单词本 / 精读标注'],
  },
  writing: {
    name: '写作批改',
    tagline: '交一篇，拿回逐句可改的版本',
    blurb: '图表与议论文、逐句批改和二稿对比',
    owns: ['富文本编辑器与草稿自动保存', '四维评分与逐句改写', '提分建议与复练路径'],
  },
}

export type SubjectPanelContext = {
  userId: string
  subject: Subject
  /** 该科全部练习（已按题目来源过滤） */
  exercises: Practice[]
  go: (path: string) => void
}

/** 各科负责人按此实现即可接管本页内容，不实现则显示下方通用列表 */
export interface SubjectPanel {
  meta: SubjectPanelMeta
  /** 顶部筛选项 */
  settings?: { key: string; label: string; options: string }[]
  /** 异步获取题目：返回空数组表示暂未接入 */
  listExercises?: (ctx: SubjectPanelContext) => Promise<Practice[]> | Practice[]
  /** 自定义渲染整页主体 */
  render?: (ctx: SubjectPanelContext) => React.ReactNode
}

export const subjectPanels: Partial<Record<Subject, SubjectPanel>> = {
  listening: { meta: SUBJECT_PANELS.listening, render: ({ userId }) => <ListeningPanel key={userId} userId={userId} /> },
  speaking: { meta: SUBJECT_PANELS.speaking, render: ({ userId }) => <SpeakingPanel key={userId} userId={userId} /> },
  reading: { meta: SUBJECT_PANELS.reading, render: ({ userId }) => <ReadingPanel key={userId} userId={userId} /> },
  /* v4.0 写作精修室：整页交给自带工作区 / 题库 / 批改的独立模块，
     科目标签页只保留顶部横幅与四科统一的「学伴互助」页签。 */
  writing: { meta: SUBJECT_PANELS.writing, render: ({ userId }) => <WritingPanel key={userId} userId={userId} /> },
}

function ExerciseRow({ practice, onOpen }: { practice: Practice; onOpen: () => void }) {
  const meta = SUBJECT_META[practice.subject]
  return (
    <button type="button" className="list-item subj-row" onClick={onOpen}>
      <span className="tile-icon sm" style={{ background: meta.soft, color: meta.color }} aria-hidden="true">
        <SubjectIcon subject={practice.subject} size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="strong">{practice.title}</div>
        <div className="small muted">{practice.subtitle}</div>
      </div>
      <span className="chip">{MODE_LABEL[practice.mode]}</span>
      <span className="chip gray">{practice.durationMin} 分钟</span>
      <span className="subj-go" aria-hidden="true">→</span>
    </button>
  )
}

export function SubjectPage({ subject }: { subject: Subject }) {
  const auth = useAuth()
  const { go, version, route } = useApp()
  void version
  const userId = auth.user!.userId
  const meta = SUBJECT_META[subject]
  const panel = subjectPanels[subject] ?? { meta: SUBJECT_PANELS[subject] }
  const localExercises = PRACTICES.filter((item) => item.subject === subject)
  const [exercises, setExercises] = useState<Practice[]>(localExercises)
  /* 阅读 / 写作由各自的 iframe 上报模块内的真实进度，横幅与模块内容同源。
     之前横幅读的是主站内置样例题（阅读 2 道），和模块首页「共 217 题」并置
     会自相矛盾。事件是单向的，模块没上报时自动回落到主站既有口径。 */
  type ModuleStats = { attempts: number; band: number | null; pool: number; poolLabel: string; display?: string }
  const [moduleStats, setModuleStats] = useState<Record<string, ModuleStats>>({})
  useEffect(() => {
    const onStats = (event: Event) => {
      const d = (event as CustomEvent).detail
      if (!d?.subject) return
      const next: ModuleStats = {
        attempts: Number(d.attempts) || 0,
        band: typeof d.band === 'number' ? d.band : null,
        pool: Number(d.pool) || 0,
        poolLabel: String(d.poolLabel || '可练题目'), display: typeof d.display === 'string' ? d.display : undefined,
      }
      setModuleStats((prev) => {
        const old = prev[d.subject]
        if (old && old.attempts === next.attempts && old.band === next.band &&
            old.pool === next.pool && old.poolLabel === next.poolLabel && old.display === next.display) return prev
        return { ...prev, [d.subject]: next }
      })
    }
    window.addEventListener('ielts:subject-stats', onStats)
    return () => window.removeEventListener('ielts:subject-stats', onStats)
  }, [])

  // 有异步题目来源时以接口结果为准；未实现 / 返回空则回落到内置样例题
  useEffect(() => {
    let alive = true
    const result = panel.listExercises?.({ userId, subject, exercises: localExercises, go })
    if (!result) { setExercises(localExercises); return }
    void Promise.resolve(result).then((list) => {
      if (alive && list.length > 0) setExercises(list)
    }).catch(() => { /* 接口未就绪时保持内置样例 */ })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, userId])

  const attempts = repository.listAttempts(userId).filter((item) => item.subject === subject)
  const ready = attempts.filter((item) => item.status === 'ready')
  const latest = ready[0]
  /* 学伴互助在四科都是同一个页签；口语那一页由 SpeakingPanel 自渲染（并进了诊所），这里不再重复判断 */
  const peers = subject !== 'speaking' && route.query.view === 'peers'
  const primary = exercises.find(practice => practice.subject === subject && practice.mode !== 'retake')
  const otherExercises = exercises.filter(practice => practice.subject === subject && practice !== primary)
  const latestReport = latest?.reportId ? repository.getReport(userId, latest.reportId) : null
  const spokenReport = subject === 'speaking' ? repository.listReports(userId)
    .filter(report => report.subject === 'speaking' && !report.evidence.demoRecord && !report.evidence.showcaseRecord)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
    .find(report => report.evidence.speechScores?.some(row=>row.state==='ready' && typeof row.accuracy==='number' && row.accuracy>=0 && row.accuracy<=100)) : undefined
  const spokenMetrics = (spokenReport?.evidence.speechScores || []).filter(row=>row.state==='ready' && typeof row.accuracy==='number' && row.accuracy>=0 && row.accuracy<=100)
  const spokenWeight = (duration:number|undefined)=>typeof duration==='number' && Number.isFinite(duration) && duration>0 ? duration : 1
  const spokenTotalWeight = spokenMetrics.reduce((sum,row)=>sum+spokenWeight(row.durationMs),0)
  const recentScore = subject === 'speaking'
    ? spokenTotalWeight ? (spokenMetrics.reduce((sum,row)=>sum+(row.accuracy as number)*spokenWeight(row.durationMs),0)/spokenTotalWeight).toFixed(1)+' / 100' : '待评测'
    : latestReport?.score.display

  /* 四科横幅统一成「已完成 / 资源规模 / 最近成绩」三项，只是各科目取数不同。 */
  const moduleStat = (subject === 'reading' || subject === 'writing') ? moduleStats[subject] : undefined
  const heroFirst = subject === 'listening'
    ? ready.filter(a => a.exerciseId.startsWith('prac_lsn_s')).length
    : (moduleStat ? moduleStat.attempts : ready.length)
  const heroSecond = subject === 'speaking' ? 3 : subject === 'listening' ? 4
    : (moduleStat ? moduleStat.pool : exercises.length)
  const heroSecondLabel = subject === 'speaking' ? '练习方式' : subject === 'listening' ? '原声练习'
    : (moduleStat ? moduleStat.poolLabel : '可练题目')
  const heroThird = moduleStat ? (moduleStat.display ?? moduleStat.band ?? '—') : (recentScore ?? '—')

  /* 读写两科：页签行（.subject-tools）静止，只有它下面的正文随页内切换进场一次。
     口语 / 听力由各自 Panel 内部把「页签下方」单独包成 .stage-body，这里不重复插手；
     那种情况下 ref 不挂到任何元素，hook 自动空转，不会报错。 */
  const body = useEnterReplay<HTMLDivElement>(route.query.view || 'studio')

  return (
    <div className="subject-page">
      {/* 口语页由 SpeakingPanel 自渲染，它内部已经有「模考室 … 学伴互助」这一排页签；
          这里再画一次就变成两排、也会把「训练首页」这个不存在的入口顶上去。 */}
      <div className="subject-hero" style={{ background: meta.soft }}>
        <span className="subject-hero-icon" style={{ color: meta.color }} aria-hidden="true">
          <SubjectIcon subject={subject} size={26} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h1>{panel.meta.name}</h1>
          <p>{panel.meta.tagline}</p>
        </div>
        <span className="spacer" />
        <div className="subject-hero-stats">
          <div><b>{heroFirst}</b><span>{subject === 'listening' ? '分段交卷' : '已完成'}</span></div>
          <div><b>{heroSecond}</b><span>{heroSecondLabel}</span></div>
          <div><b>{heroThird}</b><span>{subject === 'speaking' ? '最近发音' : subject === 'listening' ? '最近分段成绩' : subject === 'reading' ? '最近成绩' : '最近估分'}</span></div>
        </div>
      </div>

      {panel.settings && panel.settings.length > 0 && (
        <div className="subject-filters">
          {panel.settings.map((item) => <span key={item.key} className="chip">{item.label}：{item.options}</span>)}
        </div>
      )}

      {panel.render
        ? panel.render({ userId, subject, exercises, go })
        : (subject === 'reading' || subject === 'writing') && (
          <section className="material-studio" aria-label={meta.label + '练习工作区'}>
            {/* 四科统一：「训练首页 / 学伴互助」两个页签，互助页本身也由同一个组件渲染 */}
            <nav className="subject-tools" aria-label={meta.label + '功能'}>
              {[['studio', '训练首页'], ['peers', '学伴互助']].map(([key, label]) => {
                const on = key === 'peers' ? peers : !peers
                return <button key={key} type="button" className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}
                  onClick={() => go(key === 'peers' ? 'subject/' + subject + '?view=peers' : 'subject/' + subject)}>{label}</button>
              })}
            </nav>
            <div className="stage-body" ref={body}>
            {peers ? <SubjectPeerSupport key={subject} subject={subject}/> : <>
              <div className="material-studio-lead">
                {primary && <article className={'material-feature ' + subject}>
                  <h2>{primary.title}</h2>
                  <p>{subject === 'reading' ? '读完一篇学术文章，完成题组，再回到原文核对每道题的依据。' : '完成一篇议论文，查看逐句批注，再把修改建议用到第二稿。'}</p>
                  <small>{primary.durationMin} 分钟 · {subject === 'reading' ? (primary.questions?.length ?? 0) + ' 道题' : '至少 250 词'}</small>
                  <button type="button" className="btn btn-primary" onClick={() => go('practice/' + primary.exerciseId)}>
                    {subject === 'reading' ? '开始篇章练习' : '开始写作'}</button>
                </article>}
                <Card>
                <CardHead title="最近练习" />
                <MyProgress ready={ready} latest={latest} userId={userId} go={go} />
                </Card>
              </div>
              {otherExercises.length > 0 && <Card>
                <CardHead title="专项训练"/>
                {otherExercises.map(practice => <ExerciseRow key={practice.exerciseId} practice={practice}
                  onOpen={() => go('practice/' + practice.exerciseId)}/>)}
              </Card>}
            </>}
            </div>
          </section>
        )}
      {/* 顶部「小队进度」只属于读写听：口语页的练习记录在口语模块里，
          而且 view=daily 之类别的视图不该把它带上来。 */}
      {subject !== 'speaking' && (!route.query.view || route.query.view === 'studio') && <>
        <SocialTeamPeek subject={subject} />
        <WeeklyTeamPeek userId={userId} subject={subject} />
      </>}
    </div>
  )
}

function MyProgress({ ready, latest, userId, go }: { ready: Attempt[]; latest: Attempt | undefined; userId: string; go: (path: string) => void }) {
  if (ready.length === 0) return <Empty icon="○" title="还没有本科目的记录" hint="完成一次练习后，成绩与报告会出现在这里。" />
  return (
    <>
      <div className="subj-timeline">
        {ready.slice(0, 4).map((item) => {
          const report = repository.getReport(userId, item.reportId ?? '')
          return (
            <div key={item.attemptId} className="subj-timeline-row">
              <span className="dot" style={{ background: SUBJECT_META[item.subject].color }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="strong ellipsis">{item.title}</div>
                <div className="small muted">{formatDateTime(item.createdAt)}</div>
              </div>
              <b>{report?.score.display ?? '—'}</b>
            </div>
          )
        })}
      </div>
      {latest?.reportId && (
        <button className="btn btn-soft mt12" type="button" onClick={() => go(`report/${latest.reportId}`)}>查看最近报告</button>
      )}
    </>
  )
}
