import { useRef } from 'react'
import { useAuth } from '../auth'
import { useApp } from '../appContext'
import { repository } from '../repository'
import { dailyState, formatDateTime, reviewSummary } from '../logic'
import { findPractice } from '../seed'
import { SUBJECT_META, SUBJECT_ORDER } from '../contract'
import { Card, CardHead, DailyTasks, Empty, Progress, StatCard, SubjectChip, SubjectIcon } from '../components'
import { SUBJECT_PANELS } from './SubjectPage'

export function HomePage() {
  const auth = useAuth()
  const { go, version, toast } = useApp()
  const subjectPicker = useRef<HTMLDivElement>(null)
  const userId = auth.user!.userId
  void version

  const attempts = repository.listAttempts(userId)
  const readyAttempts = attempts.filter((item) => item.status === 'ready')
  const mistakes = repository.listMistakes(userId)
  const review = reviewSummary(mistakes)
  const daily = dailyState(userId)
  const drafts = attempts.filter((item) => item.status === 'draft' && findPractice(item.exerciseId) &&
    (item.draftText?.trim() || Object.values(item.answers).some(answer => answer.trim())))
  const newDone = daily.newPractice.length > 0
  const retakeDone = daily.retake.length > 0
  const tasksDone = Number(newDone) + Number(retakeDone)
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  const thisWeek = readyAttempts.filter((item) => new Date(item.createdAt) >= weekAgo).length
  const isNewUser = attempts.length === 0
  const openSubjects = () => {
    const picker = subjectPicker.current
    if (!picker) return
    picker.querySelector('button')?.focus({ preventScroll: true })
    picker.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  const openFeedback = () => {
    if (review.total) { go('mistakes'); return }
    const recent = readyAttempts.find(attempt => attempt.reportId)
    if (recent) { go('report/' + recent.reportId); return }
    toast('先完成一次练习，出报告后即可根据反馈复练。')
    openSubjects()
  }

  const subjectText = SUBJECT_ORDER.filter(subject => review.bySubject[subject])
    .map(subject => `${SUBJECT_META[subject].label} ${review.bySubject[subject]}`)
    .join(' · ')

  return (
    <>
      <div className="hero-banner">
        <picture>
          <source srcSet="/site-hero-v2-836.webp 836w, /site-hero-v2.webp 1672w" sizes="(max-width: 760px) 100vw, 1130px" type="image/webp" />
          <img className="hero-art" src="/site-hero-v2.png" alt="" decoding="async" fetchPriority="high" width={1672} height={941} />
        </picture>
        <div className="hero-inner">
          <div className="hero-kicker">A LITTLE BETTER, EVERY DRAFT</div>
          <h1>每一次练习，<br />都离目标分更近一点。</h1>
          <p>
            {isNewUser
              ? `欢迎，${auth.user!.nickname}。从一次练习开始，你会拿到有原文、原声与逐句依据的反馈，以及一条可以直接点进去的复练路径。`
              : `欢迎回来，${auth.user!.nickname}。今天的两格任务已经准备好，完成即刻点亮；未写完的草稿和待复习错题都在下方。`}
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" type="button" onClick={openSubjects}>开始今天的练习 →</button>
            <button className="btn btn-quiet" type="button" onClick={() => go('report/sample-writing')}>查看写作批改示例</button>
          </div>
          <div className="hero-stats">
            <StatCard label="累计练习" value={readyAttempts.length} foot="已出报告的练习次数" />
            <StatCard label="待复习错题" value={review.total} foot="听读共用错题本" accent="#756a2c" />
            <StatCard label="今日完成" value={`${tasksDone} / 2`} foot="同一提交只计一次" accent="#2f6b4f" className="stat-today" />
            <StatCard label="目标分" value={auth.profile?.targetBand ?? 6.5} foot="可在个人资料中调整" accent="#397fb5" className="stat-target" />
          </div>
          <div className="hero-note">· 草稿自动保存 · 每一步修改都看得见</div>
        </div>
        {/* 右侧原先是「目标分/累计练习/本周完成/待复习」——
            与下方四个统计卡重复，这里只保留统计卡里没有的「本周完成」。 */}
        <div className="hero-meta">
          <div>本周完成<b>{thisWeek}</b></div>
        </div>
      </div>

      <div className="grid g2 mt16 home-duo">
        <Card className="duo-card">
          <CardHead title="每日任务" hint="完成一次新练习 · 根据反馈复练一次" extra={<span className="chip primary">{tasksDone} / 2</span>} />
          <DailyTasks
            newDone={newDone}
            retakeDone={retakeDone}
            onNew={openSubjects}
            onRetake={openFeedback}
          />
          <div className="mt16">
            <div className="row small muted mb8"><span>今日完成度</span><span className="spacer" /><span className="strong">{Math.round((newDone ? 0.5 : 0) * 100 + (retakeDone ? 0.5 : 0) * 100)}%</span></div>
            <Progress value={((newDone ? 1 : 0) + (retakeDone ? 1 : 0)) / 2 * 100} tone="green" />
          </div>
        </Card>

        <Card className="duo-card">
          <CardHead title="继续与复习" hint="回来后不用重新找入口" />
          {drafts.length === 0 && review.total === 0 ? (
            <Empty icon="✓" title="当前没有待办" hint="未完成的练习和待复习的错题会出现在这里。" />
          ) : (
            <div className="grid" style={{ gap: 10 }}>
              {drafts.map((draft) => (
                <div key={draft.attemptId} className="list-item">
                  <SubjectChip subject={draft.subject} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="strong">{draft.title}</div>
                    <div className="small muted">{draft.draftText ? draft.draftText.slice(0, 42) + (draft.draftText.length > 42 ? '…' : '') : `已填写 ${Object.values(draft.answers).filter(answer => answer.trim()).length} 题`}</div>
                  </div>
                  <button className="btn btn-sm btn-primary" type="button" onClick={() => go(`practice/${draft.exerciseId}?draft=${draft.attemptId}`)}>继续</button>
                </div>
              ))}
              {review.total > 0 && (
                <div className="list-item">
                  <span className="chip amber">待复习</span>
                  <div style={{ flex: 1 }}>
                    <div className="strong">共 {review.total} 道错题</div>
                    <div className="small muted">{subjectText}</div>
                  </div>
                  <button className="btn btn-sm btn-soft" type="button" onClick={() => go('mistakes')}>去复习</button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* 四科板块入口：听说读写，点进去是各科独立页面（其它组员负责，接口见 SubjectPage.tsx） */}
      <div className="subject-grid mt16" ref={subjectPicker} role="group" aria-label="选择练习科目"
        style={{ scrollMarginTop: 'calc(var(--topbar-h) + 16px)' }}>
        {SUBJECT_ORDER.map((key) => {
          const meta = SUBJECT_META[key]
          const panel = SUBJECT_PANELS[key]
          const done = readyAttempts.filter((item) => item.subject === key).length
          return (
            <button
              key={key}
              type="button"
              className="subject-card"
              onClick={() => go(`subject/${key}`)}
            >
              <span className="subject-card-icon" style={{ background: meta.soft, color: meta.color }} aria-hidden="true">
                <SubjectIcon subject={key} size={22} />
              </span>
              <div className="subject-card-body">
                <div className="subject-card-title">
                  <h4>{panel.name}</h4>
                  <span className="subject-card-en">{key.toUpperCase()}</span>
                </div>
                <p>{panel.blurb}</p>
              </div>
              <div className="subject-card-foot">
                <span>{key === 'speaking' ? '模考 · 对话 · 双人' : key === 'listening' ? '4 段原声 · 22 题' : key === 'reading' ? '18 篇文章 · 217 题' : 'Task 1 图表 · Task 2 议论文'}</span>
                <span className="dot-sep" />
                <span>{done > 0 ? `已完成 ${done} 次` : '尚未开始'}</span>
                <span className="spacer" />
                <span className="subject-card-go" aria-hidden="true">→</span>
              </div>
            </button>
          )
        })}
      </div>
      <h3 className="learning-tools-title">日常积累</h3>
      <div className="learning-tools-grid">
        <button type="button" className="subject-card daily-subject-card" onClick={() => go('subject/speaking?view=daily')} title="打开口语跟读训练">
          <span className="subject-card-icon daily-subject-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z"/><path d="M7 7h1.5M16 7h1.5"/></svg>
          </span>
          <div className="subject-card-body">
            <div className="subject-card-title"><h4>每日语料</h4><span className="subject-card-en">DAILY PRACTICE</span></div>
            <p>用示范语料练习完整表达，录音后回听并对照文本，发现停顿和漏词。</p>
          </div>
          <div className="subject-card-foot"><span>21 段语料 · 7 天计划</span><span className="dot-sep" /><span>5 种跟读模式</span><span className="dot-sep" /><span>录音与回听</span><span className="spacer" /><span className="subject-card-go" aria-hidden="true">开始今日积累 →</span></div>
        </button>
        <button type="button" className="subject-card vocab-subject-card" onClick={() => go('vocabulary')} title="打开听说读写通用的词汇积累">
          <span className="subject-card-icon vocab-subject-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M7 9h10M7 13h7M7 17h4"/><path d="M17.5 15.6l1.2 1.2 2-2.4"/></svg>
          </span>
          <div className="subject-card-body">
            <div className="subject-card-title"><h4>词汇积累</h4><span className="subject-card-en">VOCAB BANK</span></div>
            <p>800 个雅思高频词：卡牌翻面、四档记忆调度、听写与遗忘曲线，学习进度按账号保存在站点里。</p>
          </div>
          <div className="subject-card-foot"><span>800 词 · 10 主题</span><span className="dot-sep" /><span>4 档 SRS 复习</span><span className="dot-sep" /><span>进度自动保存</span><span className="spacer" /><span className="subject-card-go" aria-hidden="true">开始背词 →</span></div>
        </button>
      </div>

      <Card className="mt16">
        <CardHead title="最近练习" hint="点击任意一条可回看当时的题目、作答与报告" extra={<button className="btn btn-sm" type="button" onClick={() => go('history')}>全部记录</button>} />
        {readyAttempts.length === 0 ? (
          <Empty icon="○" title="还没有完成的练习" hint="提交一次作答后，这里会出现带评分状态与报告的记录。" />
        ) : (
          <div className="table-wrap">
            <table className="table">
            <thead><tr><th>科目</th><th>练习</th><th>时间</th><th>结果</th><th>状态</th></tr></thead>
            <tbody>
              {readyAttempts.slice(0, 5).map((attempt) => {
                const report = attempt.reportId ? repository.getReport(userId, attempt.reportId) : null
                return (
                  <tr key={attempt.attemptId} onClick={() => go(`report/${attempt.reportId ?? ''}`)}>
                    <td><SubjectChip subject={attempt.subject} /></td>
                    <td className="strong">{attempt.title}</td>
                    <td className="muted small">{formatDateTime(attempt.createdAt)}</td>
                    <td className="strong">{report?.score.display ?? '—'}</td>
                    <td><span className="chip green">已完成</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )}
      </Card>
    </>
  )
}
