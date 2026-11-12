import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { useApp } from '../appContext'
import {
  MODE_LABEL,
  SUBJECT_META,
  SUBJECT_ORDER,
  type Mistake,
  type Report,
  type Subject,
} from '../contract'
import { repository, clearUserData } from '../repository'
import {
  TREND_GROUPS,
  filterAttempts,
  filterMistakes,
  formatDateTime,
  scorePoints,
  type AttemptFilter,
  type MistakeFilter,
} from '../logic'
import { ClinicEvidenceActions } from '../campus/ClinicPages'
import { Social } from '../campus/Social'
import { SocialPractice } from '../campus/SocialPractice'
import { SpeakingScores } from './SpeakingScores'
import { speak } from '../speech'
import { Card, CardHead, Empty, Modal, Progress, ScoreChart, SubjectChip, StatCard, useEnterReplay } from '../components'
import { isSpeakingView, speakingPath } from '../speakingIntegration'
import { listeningReviewPath } from '../listeningIntegration'
import { ListeningReport } from './ListeningReport'
import { SAMPLE_REPORTS } from '../seed'
import { showcaseClip } from '../showcase'
import { StudyCoach } from '../StudyCoach'

function retakeTarget(subject: Subject, questionType: string): string {
  if (subject === 'reading') return 'exr_re_retake_01'
  if (subject === 'listening') return 'exr_li_retake_01'
  if (subject === 'writing') return 'exr_wr_retake_01'
  if (questionType.includes('论点')) return 'exr_sp_free_01'
  return 'exr_sp_mock_01'
}

function moduleReviewPath(report: Report): string | null {
  const session = report.evidence.readingSession as { passageId?: string } | undefined
  const passage = session?.passageId
  if (typeof passage === 'string') return 'subject/reading?view=practice&passage=' + encodeURIComponent(passage)
  const submission = report.evidence.writingSubmission
  if (typeof submission === 'string') return 'subject/writing?view=report&submission=' + encodeURIComponent(submission)
  return null
}

// ---------------------------------------------------------------------------
// 报告详情
// ---------------------------------------------------------------------------
export function ReportPage() {
  const { route, go, version, refresh, toast } = useApp()
  const auth = useAuth()
  const userId = auth.user!.userId
  void version
  const attemptId = route.query.attempt
  const attempt = attemptId ? repository.getAttempt(userId, attemptId) : null
  const reportId = route.id !== 'pending' ? route.id : (attempt?.reportId ?? '')
  const sample = reportId === 'sample-writing'
  const report = sample ? SAMPLE_REPORTS.exr_wr_task2_01 : reportId ? repository.getReport(userId, reportId) : null
  const [showOriginal, setShowOriginal] = useState(false)
  const [showEvidence, setShowEvidence] = useState(false)

  if (!report) {
    if (attempt && attempt.status === 'scoring') {
      return (
        <Card>
          <div style={{ maxWidth: 520, margin: '0 auto', padding: '26px 0', textAlign: 'center' }}>
            <div className="chip amber mb16">评分中</div>
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>生成反馈中</h2>
            <p className="muted small">刷新页面也不会丢失进度，报告完成后会自动出现在这里。</p>
            <div className="mt24"><Progress value={attempt.progress} /></div>
            <div className="small muted mt8">{attempt.progress}% · {attempt.title}</div>
            <div className="row mt24" style={{ justifyContent: 'center' }}>
              <button className="btn" type="button" onClick={() => go('history')}>去历史记录查看</button>
            </div>
          </div>
        </Card>
      )
    }
    return (
      <Card>
        <Empty icon="?" title="报告不存在或尚未生成" hint="请从历史记录中重新打开。" action={<button className="btn btn-primary" type="button" onClick={() => go('history')}>查看历史记录</button>} />
      </Card>
    )
  }

  const meta = SUBJECT_META[report.subject]
  const modulePath = moduleReviewPath(report)
  const isCountBased = report.score.correct !== null
  const view = report.evidence.speakingView
  if (report.subject === 'listening' && report.evidence.listeningItems) {
    return <ListeningReport key={report.reportId} report={report}/>
  }
  if (report.subject === 'speaking' && isSpeakingView(view)) {
    const pair = report.mode === 'pair'
    return <div className="grid">
      <div className="row"><SubjectChip subject="speaking" /><span className="chip">{MODE_LABEL[report.mode]}</span>
        <span className="chip gray">{formatDateTime(report.createdAt)}</span><span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={() => go('history')}>← 返回历史</button></div>
      <Card>
        <CardHead title={report.original.title} hint={(pair && report.evidence.pairReviews?.length
          ? report.evidence.pairReviews.length + ' 轮角色互换'
          : String(report.evidence.turnCount) + ' 轮作答') + ' · 已完成'} />
        {report.score.band !== null && <p className="strong">本次口语综合估分 {report.score.band.toFixed(1)}</p>}
        <button type="button" className="btn btn-primary" onClick={() => go(speakingPath(view))}>
          {pair ? '去双人模考室再练一场' : report.mode === 'free' ? '查看对话与反馈' : '查看逐题反馈与录音'}
        </button>
      </Card>
      <SpeakingScores report={report} userId={userId} />
      <ClinicEvidenceActions report={report} />
      <SocialPractice report={report} />
      {pair && report.evidence.pairReviews?.map(review => <Card key={review.round}>
        <CardHead title={'第 ' + review.round + ' 轮 · ' + (review.role === 'candidate' ? '我作答' : '我担任考官')} />
        <h3 lang="en">{review.question}</h3>
        {review.extraQuestions.length > 0 && <ul lang="en">{review.extraQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
        <dl className="speaking-peer-feedback">
          <dt>做得好的地方</dt><dd>{review.feedback.strength}</dd>
          <dt>需要改进的地方</dt><dd>{review.feedback.improve}</dd>
          <dt>下次怎么练</dt><dd>{review.feedback.retry}</dd>
        </dl>
      </Card>)}
      {!!report.evidence.turns?.length && !(pair && report.evidence.pairReviews?.length) && <Card>
        <CardHead title="本次问答" />
        {report.evidence.turns.map((turn, index) => <div className="speaking-transcript" key={index}>
          <b>{turn.role === 'examiner' ? '题目' : '作答'}</b><p lang="en">{turn.text}</p>
        </div>)}
      </Card>}
    </div>
  }

  return (
    <>
      <div className="row mb16">
        <SubjectChip subject={report.subject} />
        <span className="chip">{MODE_LABEL[report.mode]}</span>
        {report.retakeOf && <span className="chip primary">针对性复练</span>}
        <span className="chip gray">{sample || report.evidence.demoRecord ? '虚构作答示例' : formatDateTime(report.createdAt)}</span>
        <span className="spacer" />
        {modulePath && <button className="btn btn-sm" type="button" onClick={() => go(modulePath)}>{report.subject === 'reading' ? '回到本篇复练' : '打开逐句批改与二稿'}</button>}
        <button className="btn btn-sm" type="button" onClick={() => go(sample ? 'home' : 'history')}>{sample ? '返回学习首页' : '← 返回历史'}</button>
      </div>

      <Card>
        <div className="score-hero">
          <div className="score-ring">
            <div><b>{report.score.display}</b><span>{isCountBased ? '正确题数' : report.score.band === null ? '反馈报告' : '预估 band'}</span></div>
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 19, letterSpacing: '-.4px' }}>{report.original.title}</h2>
            <p className="small muted mb8" style={{ margin: '5px 0 10px' }}>
              {sample ? '示例作文讨论大学学费。展开原稿，可以逐句对照修改建议。' : report.subject === 'speaking' && report.evidence.showcaseRecord
                ? '展开当时的题目与作答，可以听示例录音，再对照下面的反馈。' : isCountBased
                ? `本次答对 ${report.score.correct} / ${report.score.total} 题。` + (report.score.firstTryCorrect == null ? '' : `首次作答答对 ${report.score.firstTryCorrect} 题。`)
                : `目标分 ${auth.profile?.targetBand ?? 6.5} · 本次为单篇估分，趋势可在分数曲线查看。`}
            </p>
            <div className="row">
              <span className="chip green">{report.feedback.length} 条有依据的反馈</span>
              <span className="chip primary">{report.recommendations.length} 条复练建议</span>
              <button className="btn btn-sm" type="button" onClick={() => setShowOriginal((v) => !v)}>{showOriginal ? '收起' : '查看'}当时的题目与作答</button>
            </div>
          </div>
        </div>

        {showOriginal && (
          <div className="mt16">
            <div className="fb-block"><div className="tag">当时的题目</div><div className="evidence-box">{report.original.prompt}</div></div>
            {report.original.submittedText && (
              <div className="fb-block"><div className="tag">{sample ? '示例原稿' : '你的作答'}</div><div className="evidence-box">{report.original.submittedText}</div></div>
            )}
            {report.subject === 'speaking' && report.evidence.showcaseRecord === true ?
              report.evidence.turns?.filter(t=>t.role==='candidate').map((turn,i)=>{
                const audio=showcaseClip(report,String(i))
                return <div className="fb-block" key={i}><div className="tag">第 {i+1} 段 · 演示配音</div><p lang="en">{turn.text}</p>
                  {audio && <audio controls preload="none" aria-label={'第 '+(i+1)+' 段示例录音'} src={audio}/>}</div>
              }) : Object.keys(report.original.answers).length > 0 && (
              <div className="fb-block"><div className="tag">逐题作答</div><div className="evidence-box">{Object.entries(report.original.answers).filter(([key]) => !key.startsWith('__')).map(([key, value]) => `${key}: ${value}`).join('\n')}</div></div>
            )}
          </div>
        )}

        {report.dimensions.length > 0 && (
          <div className="mt24">
            <div className="strong mb8 small">分项表现</div>
            {report.dimensions.map((dimension) => (
              <div key={dimension.key} className="dimension">
                <span className="key">{dimension.key}</span>
                <div className="bar">
                  <div className="row small"><span>{dimension.label}</span><span className="spacer" /><span className="muted">{dimension.comment}</span></div>
                  <div className="mt8"><Progress value={(dimension.score / 9) * 100} thin /></div>
                </div>
                <span className="val">{dimension.score}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      {!sample && <>{report.subject==='reading'&&<StudyCoach key={report.reportId} report={report}/>}<ClinicEvidenceActions report={report} /><SocialPractice report={report} /></>}

      <Card className="mt16">
        <CardHead
          title="哪里需要改进，为什么" hint="每条反馈都附证据、错因与改法"
          extra={report.evidence.paragraphs || report.evidence.segments || report.evidence.transcript
            ? <button className="btn btn-sm" type="button" onClick={() => setShowEvidence((v) => !v)}>{showEvidence ? '收起' : '查看'}原文 / 原声证据</button>
            : undefined}
        />
        {showEvidence && (
          <div className="evidence-box mb16">
            {report.evidence.paragraphs
              ? (report.evidence.paragraphs as string[]).join('\n\n')
              : report.evidence.transcript
                ? String(report.evidence.transcript)
                : (report.evidence.sentences as { index: number; text: string }[] | undefined)?.map((s) => `${s.index}. ${s.text}`).join('\n') ?? ''}
          </div>
        )}
        {report.feedback.length === 0 ? (
          <Empty icon="✓" title="本次没有需要修正的问题" hint="继续保持，并在下一步建议中选择更高难度的练习。" />
        ) : report.feedback.map((item, index) => (
          <div key={item.id} className={`feedback-item ${item.severity}`}>
            <div className="fb-head">
              <span className="fb-label">标注 {index + 1} · {item.location.label} · {item.questionType}</span>
              <div className="row">
                {item.location.startSec !== undefined && (
                  <button className="btn btn-sm btn-soft" type="button" onClick={() => {
                    const ok = speak(item.quote)
                    toast(ok ? '朗读中' : '当前浏览器不支持朗读，可查看下方原句')
                  }}>▶ 朗读这句表达</button>
                )}
                <span className={`chip ${item.severity === 'high' ? 'rose' : item.severity === 'medium' ? 'amber' : 'green'}`}>
                  {item.severity === 'high' ? '优先修正' : item.severity === 'medium' ? '建议修正' : '已改善'}
                </span>
              </div>
            </div>
            <div className="fb-block"><div className="tag">原文 / 原句证据</div><div className="fb-quote">“{item.quote}”</div></div>
            <div className="fb-block"><div className="tag">问题</div><div className="fb-why">{item.issue}</div></div>
            <div className="fb-block"><div className="tag">为什么（依据）</div><div className="fb-why">{item.why}</div></div>
            <div className="fb-block"><div className="tag">怎么改</div><div className="fb-fix">{item.suggestion}</div></div>
            {item.revised && <div className="fb-block"><div className="tag">改写 / 升级表达</div><div className="fb-revised">{item.revised}</div></div>}
          </div>
        ))}
      </Card>

      {(report.evidence.upgradedEssay || report.evidence.draftV2) && (
        <Card className="mt16">
          <CardHead title="升级版范文与二稿对比" hint="由写作模块提供逐句标注、改写建议与升级范文" />
          <div className="essay-compare">
            <div className="essay-panel">
              <h4>升级版范文</h4>
              <div className="text">{String(report.evidence.upgradedEssay ?? '')}</div>
            </div>
            <div className="essay-panel upgraded">
              <h4>{report.evidence.draftV2 ? '你的二稿' : '一稿对照要点'}</h4>
              <div className="text">{report.evidence.draftV2 ? String(report.evidence.draftV2) : report.original.submittedText ?? '提交二稿后，这里会自动做一稿 / 二稿对比。'}</div>
            </div>
          </div>
        </Card>
      )}

      {sample ? <div className="row mt16"><button className="btn btn-primary" type="button" onClick={() => go('subject/writing')}>去写作训练</button></div> : <>
      <div className="grid g2 mt16">
        <Card>
          <CardHead title="做得好的地方" hint="保持住这些已经稳定的表现" />
          {report.highlights.length === 0
            ? <div className="small muted">本次暂无标注</div>
            : report.highlights.map((text) => (
              <div key={text} className="list-item" style={{ padding: '10px 12px' }}>
                <span className="chip green">✓</span><span className="small">{text}</span>
              </div>
            ))}
        </Card>
        <Card>
          <CardHead title="下一步练什么" hint="每条建议都写明推荐理由" />
          {report.recommendations.map((rec, index) => (
            <div key={`${rec.targetId}-${index}`} className="rec-card">
              <span className="rec-num">{index + 1}</span>
              <div style={{ flex: 1 }}>
                <b>{rec.label}</b>
                <p>{rec.reason}</p>
                <button
                  className="btn btn-sm btn-primary"
                  type="button"
                  onClick={() => {
                    if (modulePath) { go(modulePath); return }
                    const target = rec.targetType === 'exercise'
                      ? rec.targetId
                      : retakeTarget(report.subject, rec.targetId)
                    go(`practice/${target}?retakeOf=${report.attemptId}&focus=${encodeURIComponent(rec.targetId)}`)
                    toast('已进入针对性复练')
                  }}
                >{rec.cta} →</button>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div className="row mt16">
        <button className="btn" type="button" onClick={() => go('mistakes')}>去错题本复习</button>
        <button className="btn" type="button" onClick={() => go('trends')}>查看分数曲线</button>
        <span className="spacer" />
        <span className="small muted">{meta.label} · 报告编号 {report.reportId}</span>
      </div>
      </>}
    </>
  )
}

// ---------------------------------------------------------------------------
// 历史记录
// ---------------------------------------------------------------------------
export function HistoryPage() {
  const { go, version } = useApp()
  const auth = useAuth()
  const userId = auth.user!.userId
  void version
  const [filter, setFilter] = useState<AttemptFilter>({ subject: 'all', mode: 'all', dateFrom: '', dateTo: '' })
  const attempts = repository.listAttempts(userId)
  const rows = filterAttempts(attempts, filter)
  const scoring = attempts.filter((item) => item.status === 'scoring')

  return (
    <Card>
      <CardHead
        title="历史记录"
        hint={`共 ${attempts.length} 条 · 按科目、日期、练习模式筛选`}
        extra={scoring.length > 0 ? <span className="chip amber">{scoring.length} 项评分中</span> : undefined}
      />
      <div className="filter-bar">
        <select className="select" aria-label="科目筛选" value={filter.subject} onChange={(e) => setFilter({ ...filter, subject: e.target.value as AttemptFilter['subject'] })}>
          <option value="all">全部科目</option>
          {SUBJECT_ORDER.map((key) => <option key={key} value={key}>{SUBJECT_META[key].label}</option>)}
        </select>
        <select className="select" aria-label="练习模式筛选" value={filter.mode} onChange={(e) => setFilter({ ...filter, mode: e.target.value as AttemptFilter['mode'] })}>
          <option value="all">全部模式</option>
          {Object.entries(MODE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <label className="small muted">从</label>
        <input className="input" type="date" aria-label="起始日期" value={filter.dateFrom} onChange={(e) => setFilter({ ...filter, dateFrom: e.target.value })} />
        <label className="small muted">到</label>
        <input className="input" type="date" aria-label="结束日期" value={filter.dateTo} onChange={(e) => setFilter({ ...filter, dateTo: e.target.value })} />
        <button className="btn btn-sm" type="button" onClick={() => setFilter({ subject: 'all', mode: 'all', dateFrom: '', dateTo: '' })}>重置</button>
      </div>

      {rows.length === 0 ? (
        <Empty icon="≡" title="没有符合条件的记录" hint="调整筛选条件，或先完成一次练习。" action={<button className="btn btn-primary" type="button" onClick={() => go('home')}>去练习</button>} />
      ) : (
        <div className="table-wrap">
          <table className="table">
          <thead><tr><th>科目</th><th>练习</th><th>模式</th><th>日期</th><th>结果</th><th>状态</th><th /></tr></thead>
          <tbody>
            {rows.map((attempt) => {
              const report = attempt.reportId ? repository.getReport(userId, attempt.reportId) : null
              return (
                <tr key={attempt.attemptId} onClick={() => {
                  if (attempt.status === 'draft') go(`practice/${attempt.exerciseId}?draft=${attempt.attemptId}`)
                  else if (attempt.reportId) go(`report/${attempt.reportId}`)
                  else go(`report/pending?attempt=${attempt.attemptId}`)
                }}>
                  <td><SubjectChip subject={attempt.subject} /></td>
                  <td className="strong">{attempt.title}{attempt.retakeOf && <div className="small muted">针对性复练</div>}</td>
                  <td className="small muted">{MODE_LABEL[attempt.mode]}</td>
                  <td className="small muted">{formatDateTime(attempt.createdAt)}</td>
                  <td className="strong">{report?.score.display ?? '—'}</td>
                  <td style={{ minWidth: 130 }}>
                    {attempt.status === 'ready' && <span className="chip green">已完成</span>}
                    {attempt.status === 'draft' && <span className="chip gray">草稿</span>}
                    {attempt.status === 'scoring' && (
                      <div><span className="chip amber">评分中 {attempt.progress}%</span><div className="mt8"><Progress value={attempt.progress} thin /></div></div>
                    )}
                  </td>
                  <td><button className="btn btn-sm" type="button" onClick={(event) => {
                    event.stopPropagation()
                    if (attempt.status === 'draft') go(`practice/${attempt.exerciseId}?draft=${attempt.attemptId}`)
                    else if (attempt.reportId) go(`report/${attempt.reportId}`)
                    else go(`report/pending?attempt=${attempt.attemptId}`)
                  }}>{attempt.status === 'draft' ? '继续' : '查看'}</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 分数曲线
// ---------------------------------------------------------------------------
export function TrendsPage() {
  const { go, version } = useApp()
  const auth = useAuth()
  const userId = auth.user!.userId
  void version
  const [active, setActive] = useState(TREND_GROUPS[0].key)
  const reports = repository.listReports(userId)
  const selectedGroup = TREND_GROUPS.find((item) => item.key === active) ?? TREND_GROUPS[0]
  const counts = !active.endsWith('_band')
  const group = counts ? { ...selectedGroup, label: selectedGroup.label.replace('正确数', '正确率'), unit: '%' } : selectedGroup
  const points = scorePoints(reports, active).map(point => counts ? { ...point, value: point.total ? 100 * (point.correct ?? 0) / point.total : 0 } : point)
  const latest = points[points.length - 1]
  const first = points[0]
  /* 切「口语 / 写作 / 听力 / 阅读」不换路由：页签行静止，整个正文作为一个
     .stage-pane 原地重播一次。之前给曲线与统计块各挂一个 replay-scope，
     同一个 ref 复用在两处，切换时是两个块各自错落地动，现在收敛成一层。 */
  const body = useEnterReplay<HTMLDivElement>(active)

  return (
    <div className="stage-pane" ref={body}>
      <Card>
        <CardHead title="分数曲线" hint="完整口语模考、写作单篇估分分别画趋势；听读展示正确数与首答正确数" />
        <div className="chart-tabs">
          {TREND_GROUPS.map((item) => (
            <button key={item.key} type="button" className={`chart-tab ${active === item.key ? 'on' : ''}`} onClick={() => setActive(item.key)}>{item.label.replace('正确数', '正确率')}</button>
          ))}
        </div>
        <div>
        <ScoreChart points={points} color={group.color} unit={group.unit} onPoint={(reportId) => go(`report/${reportId}`)} />
        </div>
      </Card>

      <div className="grid g3 mt16">
        <StatCard label="最近一次" value={latest?.label ?? '—'} foot={latest ? formatDateTime(latest.date) : '暂无记录'} accent={group.color} />
        <StatCard label="变化" value={latest && first ? `${(latest.value - first.value >= 0 ? '+' : '')}${(latest.value - first.value).toFixed(1)}` : '—'} foot={counts ? "与最早一次相比（百分点）" : "与最早一次相比"} accent={latest && first && latest.value >= first.value ? '#2f6b4f' : '#a34f38'} />
        <StatCard label="记录次数" value={points.length} foot={`${group.label} · 单位 ${group.unit}`} />
      </div>

      {!active.endsWith('_band') && (
        <Card className="mt16">
          <CardHead title="正确数与首答正确数" hint="曲线按正确率比较不同题量；表格保留每次正确数和首次作答正确数。" />
          {points.length === 0 ? <Empty icon="↗" title="暂无本科成绩" /> : (
            <div className="table-wrap">
              <table className="table">
              <thead><tr><th>日期</th><th>科目</th><th>正确数</th><th>首次作答正确数</th><th>总题数</th><th /></tr></thead>
              <tbody>
                {points.slice().reverse().map((point) => (
                  <tr key={point.reportId} onClick={() => go(`report/${point.reportId}`)}>
                    <td className="small muted">{formatDateTime(point.date)}</td>
                    <td><SubjectChip subject={active === 'reading_correct' ? 'reading' : 'listening'} /></td>
                    <td className="strong">{point.correct}</td>
                    <td className="strong">{point.firstTryCorrect ?? '—'}</td>
                    <td>{point.total}</td>
                    <td><button className="btn btn-sm" type="button">打开报告</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
          )}
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 错题本
// ---------------------------------------------------------------------------
export function MistakesPage() {
  const { go, version, refresh, toast } = useApp()
  const auth = useAuth()
  const userId = auth.user!.userId
  void version
  const [filter, setFilter] = useState<MistakeFilter>({ subject: 'all', questionType: '', reviewStatus: 'all' })
  const mistakes = repository.listMistakes(userId)
  const rows = filterMistakes(mistakes, filter)
  const questionTypes = Array.from(new Set(mistakes.map((item) => item.questionType)))
  const pending = rows.filter((item) => item.reviewStatus === 'pending').length
  function review(mistake: Mistake) {
    if (mistake.listeningSection && mistake.listeningItem) {
      go(listeningReviewPath(mistake.listeningSection,mistake.listeningItem))
    } else {
      const report = repository.getReport(userId, mistake.reportId)
      const path = report && moduleReviewPath(report)
      if (path) { go(path); return }
      go(`practice/${retakeTarget(mistake.subject, mistake.questionType)}?retakeOf=${mistake.attemptId}&focus=${encodeURIComponent(mistake.questionType)}`)
    }
  }

  const markReviewed = (mistake: Mistake) => {
    repository.saveMistake({ ...mistake, reviewStatus: 'reviewed' })
    // 复习错题 → 校园营地 +5 分（每题只加一次）
    refresh()
    toast('已标记为已复习')
  }

  return (
    <>
      <Card>
        <CardHead title="错题本" hint="听读共用 · 支持按科目、题型、待复习状态筛选" extra={<span className="chip amber">{pending} 道待复习</span>} />
        <div className="filter-bar">
          <select className="select" aria-label="科目筛选" value={filter.subject} onChange={(e) => setFilter({ ...filter, subject: e.target.value as MistakeFilter['subject'] })}>
            <option value="all">全部科目</option>
            {SUBJECT_ORDER.map((key) => <option key={key} value={key}>{SUBJECT_META[key].label}</option>)}
          </select>
          <select className="select" aria-label="题型筛选" value={filter.questionType} onChange={(e) => setFilter({ ...filter, questionType: e.target.value })}>
            <option value="">全部题型</option>
            {questionTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select className="select" aria-label="复习状态筛选" value={filter.reviewStatus} onChange={(e) => setFilter({ ...filter, reviewStatus: e.target.value as MistakeFilter['reviewStatus'] })}>
            <option value="all">全部状态</option>
            <option value="pending">待复习</option>
            <option value="reviewed">已复习</option>
          </select>
          <button className="btn btn-sm" type="button" onClick={() => setFilter({ subject: 'all', questionType: '', reviewStatus: 'all' })}>重置</button>
          <span className="spacer" />
          <button className="btn btn-sm btn-primary" type="button" disabled={pending === 0} onClick={() => {
            const first = rows.find((item) => item.reviewStatus === 'pending')
            if (first) review(first)
          }}>去复练 →</button>
        </div>

        {rows.length === 0 ? (
          <Empty icon="◎" title="没有符合条件的错题" hint="完成一次练习后，错题会自动带着证据与错因进入这里。" action={<button className="btn btn-primary" type="button" onClick={() => go('home')}>去练习</button>} />
        ) : rows.map((mistake) => (
          <div key={mistake.mistakeId} className="feedback-item" style={{ borderLeftColor: SUBJECT_META[mistake.subject].color }}>
            <div className="fb-head">
              <div className="row">
                <SubjectChip subject={mistake.subject} />
                <span className="chip">{mistake.questionType}</span>
                <span className="chip gray">{mistake.locationLabel}</span>
              </div>
              <span className={`chip ${mistake.reviewStatus === 'pending' ? 'amber' : 'green'}`}>{mistake.reviewStatus === 'pending' ? '待复习' : '已复习'}</span>
            </div>
            <div className="fb-block"><div className="tag">错题原文</div><div className="fb-quote">{mistake.excerpt}</div></div>
            <div className="fb-block"><div className="tag">为什么错</div><div className="fb-why">{mistake.why}</div></div>
            <div className="fb-block"><div className="tag">复练要点</div><div className="fb-fix">{mistake.suggestion}</div></div>
            <div className="row">
              <button className="btn btn-sm btn-soft" type="button" onClick={() => review(mistake)}>针对性复练</button>
              <button className="btn btn-sm" type="button" onClick={() => go(`report/${mistake.reportId}`)}>查看原报告</button>
              {mistake.reviewStatus === 'pending' && !mistake.listeningItem && <button className="btn btn-sm" type="button" onClick={() => markReviewed(mistake)}>标记已复习</button>}
              <span className="spacer" />
              <span className="small muted">{formatDateTime(mistake.createdAt)}</span>
            </div>
          </div>
        ))}
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// 个人目标
// ---------------------------------------------------------------------------
export function ProfilePage() {
  const auth = useAuth()
  const { route, go, refresh, toast } = useApp()
  const [nickname, setNickname] = useState(auth.user?.nickname ?? '')
  const [targetBand, setTargetBand] = useState(String(auth.profile?.targetBand ?? 6.5))
  const [confirmReset, setConfirmReset] = useState(false)
  const userId = auth.user!.userId
  const total = repository.listAttempts(userId).length
  const campus = route.id === 'campus'
  const tabs = <nav className="subject-tools" aria-label="个人资料栏目">
    <button type="button" className={!campus ? 'on' : ''} aria-current={!campus ? 'page' : undefined} onClick={() => go('profile')}>账号与目标</button>
    <button type="button" className={campus ? 'on' : ''} aria-current={campus ? 'page' : undefined} onClick={() => go('profile/campus')}>校园资料</button>
  </nav>
  /* 两个栏目共用同一个路由名：页签行静止，正文这一层原地重播一次进场。
     两个分支都挂同一个 .stage-pane 容器（不再靠 key 重建，输入框焦点不丢）。 */
  const body = useEnterReplay<HTMLDivElement>(campus ? 'campus' : 'account')
  if (campus) return <>{tabs}<div className="stage-pane" ref={body}><Social tab="verify" /></div></>

  return (
    <>
      {tabs}
      <div className="grid g2 stage-pane" ref={body}>
        <Card>
          <CardHead title="个人目标" hint="昵称与目标分会显示在学习首页和侧栏" />
          <div className="field">
            <label>昵称</label>
            <input className="input" aria-label="昵称" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </div>
          <div className="field">
            <label>目标分</label>
            <select className="select" aria-label="目标分" value={targetBand} onChange={(e) => setTargetBand(e.target.value)}>
              {['5.5', '6.0', '6.5', '7.0', '7.5', '8.0', '8.5'].map((band) => <option key={band} value={band}>{band}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => {
            auth.updateProfile({ nickname: nickname.trim() || '雅思考生', targetBand: Number(targetBand) })
            refresh()
            toast('个人目标已保存')
          }}>保存修改</button>
        </Card>

        <Card>
          <CardHead title="账号与数据" hint="账号之间数据隔离" />
          <div className="list-item">
            <span className="avatar">{auth.user!.nickname.slice(0, 1).toUpperCase()}</span>
            <div style={{ flex: 1 }}>
              <div className="strong">{auth.user!.nickname}</div>
              <div className="small muted">{auth.user!.email || '演示账号'} · {auth.showcase ? '演示模式' : auth.mode === 'demo' ? '本机账号' : '云账号'}</div>
            </div>
          </div>
          <div className="mt12 small muted">练习记录 {total} 条 · 数据按账号独立存储，其他账号无法读取。</div>
          <div className="row mt16">
            <button className="btn" type="button" onClick={() => { void auth.signOut() }}>退出登录</button>
            <button className="btn btn-danger" type="button" onClick={() => setConfirmReset(true)}>清除本站本机记录</button>
          </div>
        </Card>
      </div>



      {confirmReset && (
        <Modal title="清除本站本机记录" sub="清理当前账号在本浏览器保存的本站记录" onClose={() => setConfirmReset(false)}>
          <div className="banner demo" style={{ marginTop: 0 }}>将清理本站保存的资料、草稿、成绩摘要和错题，共 {total} 条练习。各科服务已保存的提交记录会在重新打开后同步恢复。</div>
          <div className="row">
            <button className="btn btn-danger" type="button" onClick={() => {
              clearUserData(userId)
              setConfirmReset(false)
              refresh()
              toast('本站本机记录已清理，可重新打开科目同步已保存的提交')
            }}>确认清空</button>
            <button className="btn" type="button" onClick={() => setConfirmReset(false)}>取消</button>
          </div>
        </Modal>
      )}
    </>
  )
}
