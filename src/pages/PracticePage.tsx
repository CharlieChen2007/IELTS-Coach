import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { useApp } from '../appContext'
import {
  MODE_LABEL,
  type Attempt,
  type Practice,
  type Question,
} from '../contract'
import { repository } from '../repository'
import { createAttempt, submitAttempt } from '../logic'
import { ClinicEvidenceActions } from '../campus/ClinicPages'
import { findPractice } from '../seed'
import { speak, stopSpeaking } from '../speech'
import { Card, CardHead, Empty, Progress, SubjectChip } from '../components'

// ---------------------------------------------------------------------------
// 会话状态：草稿自动保存、提交后进入评分中
// ---------------------------------------------------------------------------
function usePracticeSession(practice: Practice, initial: Attempt) {
  const { route, go, replace, toast, refresh } = useApp()
  const { userId, attemptId, retakeOf, focus } = initial
  const [answers, setAnswers] = useState(initial.answers)
  const [draftText, setDraftText] = useState(initial.draftText ?? '')
  const [savedAt, setSavedAt] = useState('')
  const attemptRef = useRef(initial)
  const submittedRef = useRef(false)
  const dirty = useRef(false)
  const latest = useRef({answers, draftText})
  useLayoutEffect(() => { latest.current = { answers, draftText } }, [answers, draftText])
  useEffect(() => {
    const flushOnExit = () => {
      if (!dirty.current || submittedRef.current) return
      const stored = repository.getAttempt(userId, attemptId)
      if (!stored || stored.status === 'draft') repository.saveAttempt({ ...attemptRef.current, ...latest.current })
    }
    window.addEventListener('pagehide', flushOnExit)
    return () => { window.removeEventListener('pagehide', flushOnExit); flushOnExit() }
  }, [userId, attemptId])

  const bindDraftToRoute = () => {
    if (route.query.draft === attemptId) return
    const query = new URLSearchParams({ ...route.query, draft: attemptId })
    replace?.(`practice/${practice.exerciseId}?${query}`)
  }
  const persistDraft = () => {
    if (submittedRef.current || !dirty.current) return true
    const stored = repository.getAttempt(userId, attemptId)
    if (stored && stored.status !== 'draft') {
      submittedRef.current = true
      go(`report/pending?attempt=${attemptId}`)
      return false
    }
    const next = { ...attemptRef.current, answers, draftText }
    repository.saveAttempt(next)
    const saved = repository.getAttempt(userId, attemptId)
    if (saved?.draftText !== draftText || JSON.stringify(saved?.answers) !== JSON.stringify(answers)) {
      toast('草稿未能保存，请检查浏览器存储空间后重试。')
      return false
    }
    attemptRef.current = next
    dirty.current = false
    bindDraftToRoute()
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    return true
  }

  useEffect(() => {
    if (!dirty.current) return
    const timer = window.setTimeout(persistDraft, 700)
    return () => window.clearTimeout(timer)
  }, [answers, draftText])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'ielts_coach_v1') return
      const updated = repository.getAttempt(userId, attemptId)
      if (updated && updated.status !== 'draft') refresh()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [userId, attemptId, refresh])

  const setAnswer = useCallback((questionId: string, value: string) => {
    dirty.current = true
    setAnswers((previous) => ({ ...previous, [questionId]: value }))
  }, [])

  const updateText = (value: string) => {
    dirty.current = true
    setDraftText(value)
  }
  const saveAndLeave = () => {
    if (!persistDraft()) return
    stopSpeaking()
    refresh()
    go('home')
  }
  const submit = () => {
    if (submittedRef.current) return
    const stored = repository.getAttempt(userId, attemptId)
    if (stored && stored.status !== 'draft') {
      go(`report/pending?attempt=${attemptId}`)
      return
    }
    submittedRef.current = true
    const submitted = submitAttempt({ ...attemptRef.current, title: practice.title, answers, draftText })
    if (repository.getAttempt(userId, attemptId)?.status !== 'scoring') {
      submittedRef.current = false
      toast('作答未能保存，请检查浏览器存储空间后重试。')
      return
    }
    bindDraftToRoute()
    stopSpeaking()
    refresh()
    toast('已提交，反馈生成中…')
    go(`report/pending?attempt=${submitted.attemptId}`)
  }

  return { answers, setAnswer, draftText, setDraftText: updateText, submit, persistDraft, saveAndLeave, savedAt, retakeOf, focus }
}

type Session = ReturnType<typeof usePracticeSession>

function PracticeHeader({ practice, session }: { practice: Practice; session: Session }) {
  return (
    <div className="practice-head">
      <div>
        <div className="row mb8">
          <SubjectChip subject={practice.subject} />
          <span className="chip">{MODE_LABEL[practice.mode]}</span>
          {session.focus && <span className="chip amber">针对：{session.focus}</span>}
          {session.retakeOf && <span className="chip primary">针对性复练</span>}
        </div>
        <h1>{practice.title}</h1>
        <p>{practice.prompt}</p>
      </div>
      <div style={{ textAlign: 'right', flex: 'none' }}>
        <div className="small muted">约 {practice.durationMin} 分钟 · {practice.questionTypes.join(' / ')}</div>
        <button className="btn btn-sm mt8" type="button" onClick={session.saveAndLeave}>保存并返回首页</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 写作：题目 + 编辑框 + 字数 + 逐句标注 / 二稿对比
// ---------------------------------------------------------------------------
function WritingView({ practice, session }: { practice: Practice; session: Session }) {
  const auth = useAuth()
  const wordCount = session.draftText.trim() ? session.draftText.trim().split(/\s+/).length : 0
  const [showModel, setShowModel] = useState(false)

  let firstDraft = ''
  let upgraded = ''
  if (session.retakeOf) {
    const prior = repository.getAttempt(auth.user!.userId, session.retakeOf)
    const priorReport = prior?.reportId ? repository.getReport(auth.user!.userId, prior.reportId) : null
    firstDraft = priorReport?.original.submittedText ?? ''
    upgraded = (priorReport?.evidence.upgradedEssay as string | undefined) ?? ''
  }

  return (
    <>
      <Card>
        <CardHead title="题目" hint="Academic Writing Task 2 · 建议 40 分钟 · 不少于 250 词" />
        <div className="evidence-box" style={{ fontSize: 14, lineHeight: 1.8 }}>{practice.prompt}</div>
      </Card>

      {firstDraft && (
        <Card className="mt16">
          <CardHead title="对照一稿与升级版范文" hint="二稿请针对一稿的逐句标注重写" extra={<button className="btn btn-sm" type="button" onClick={() => setShowModel((value) => !value)}>{showModel ? '收起范文' : '查看升级版范文'}</button>} />
          <div className="essay-compare">
            <div className="essay-panel"><h4>你的一稿</h4><div className="text">{firstDraft}</div></div>
            <div className="essay-panel upgraded">
              <h4>{showModel ? '升级版范文（参考表达）' : '逐句标注提示'}</h4>
              <div className="text">{showModel ? upgraded : '一稿的主要问题：套语开头、主谓一致、解释句空泛、结论立场模糊。重写时逐句对照修正，提交后系统会生成二稿对比。'}</div>
            </div>
          </div>
        </Card>
      )}

      <Card className="mt16">
        <CardHead
          title="作答"
          hint={session.savedAt ? `草稿已自动保存 · ${session.savedAt}` : '输入内容后会自动保存草稿，退出再回来可继续写作'}
          extra={<button className="btn btn-sm" type="button" disabled={!session.draftText && !session.savedAt} onClick={session.persistDraft}>保存草稿</button>}
        />
        <textarea
          className="essay-box"
          value={session.draftText}
          onChange={(event) => session.setDraftText(event.target.value)}
          placeholder="在这里写你的作文…"
        />
        <div className="word-count">
          <span>字数统计实时更新；{session.retakeOf ? '二稿' : '首稿'}会自动保留在历史记录中</span>
          <span className={wordCount >= 250 ? 'ok' : ''}>{wordCount} / 250 词{wordCount >= 250 ? ' ✓' : ''}</span>
        </div>
        <div className="row mt16">
          <button className="btn btn-primary" type="button" disabled={wordCount < 20} onClick={() => session.submit()}>
            提交并获取逐句标注
          </button>
          <button className="btn" type="button" onClick={session.saveAndLeave}>稍后再写</button>
          {wordCount < 20 && <span className="small muted">至少写 20 词才能提交</span>}
        </div>
      </Card>
    </>
  )
}

// ---------------------------------------------------------------------------
// 听力：播放器 + 原声转写 + 题目
// ---------------------------------------------------------------------------
function ListeningView({ practice, session }: { practice: Practice; session: Session }) {
  const [playing, setPlaying] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const total = 96
  const transcript = practice.material?.transcript ?? ''

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setElapsed((value) => {
      if (value + 1 >= total) { setPlaying(false); return total }
      return value + 1
    }), 1000)
    return () => window.clearInterval(timer)
  }, [playing])

  const toggle = () => {
    if (playing) { setPlaying(false); stopSpeaking() }
    else { setPlaying(true); if (elapsed >= total) setElapsed(0); speak(transcript) }
  }

  return (
    <>
      <Card>
        <CardHead title="原声播放器" hint="点击播放可朗读完整 Section 3 原声；报告中的错题支持单段回听" />
        <div className="player">
          <div className="row">
            <button className="btn btn-primary" type="button" onClick={toggle}>{playing ? '⏸ 暂停' : '▶ 播放原声'}</button>
            <span className="chip">Section 3 · 学术讨论</span>
            <span className="spacer" />
            <span className="small strong" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {`${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`} / 01:36
            </span>
          </div>
          <div className="wave">
            {Array.from({ length: 44 }, (_, i) => (
              <i key={i} className={playing && i / 44 <= elapsed / total ? 'on' : ''} style={{ height: `${8 + ((i * 37) % 30)}px` }} />
            ))}
          </div>
          <Progress value={(elapsed / total) * 100} thin />
          <div className="small muted mt8">未授权麦克风或语音合成不可用时，播放器仍显示进度与转写，不影响作答与回听定位。</div>
        </div>
      </Card>

      <div className="grid g2 mt16">
        <Card>
          <CardHead title="原声转写" hint="带时间戳，便于核对答案出处" />
          <div className="transcript">
            {transcript.split('\n').map((line, index) => (
              <div key={index} className="line">
                <span className="time">{line.slice(1, 6)}</span>
                {line.slice(7)}
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="题目" hint={`共 ${practice.questions.length} 题`} extra={<span className="chip primary">已答 {Object.keys(session.answers).length} / {practice.questions.length}</span>} />
          <QuestionList questions={practice.questions} answers={session.answers} setAnswer={session.setAnswer} />
          <button className="btn btn-primary btn-block mt12" type="button" onClick={() => session.submit()}>提交并查看原声定位</button>
        </Card>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// 阅读：左文右题
// ---------------------------------------------------------------------------
function ReadingView({ practice, session }: { practice: Practice; session: Session }) {
  const paragraphs = practice.material?.paragraphs ?? []
  const [activeParagraph, setActiveParagraph] = useState(-1)
  return (
    <div className="split">
      <Card>
        <CardHead title="阅读原文" hint="点击段落可高亮，反馈会定位到具体原句" />
        <div className="passage">
          {paragraphs.map((text, index) => (
            <p
              key={index}
              className={activeParagraph === index ? 'highlight' : ''}
              onClick={() => setActiveParagraph(index)}
              style={{ cursor: 'pointer' }}
            >{text}</p>
          ))}
        </div>
      </Card>
      <Card>
        <CardHead title="题目" hint={`共 ${practice.questions.length} 题 · 左文右题`} extra={<span className="chip primary">已答 {Object.keys(session.answers).length} / {practice.questions.length}</span>} />
        <QuestionList questions={practice.questions} answers={session.answers} setAnswer={session.setAnswer} />
        <button className="btn btn-primary btn-block mt12" type="button" onClick={() => session.submit()}>提交并查看原文证据</button>
      </Card>
    </div>
  )
}

function QuestionList({ questions, answers, setAnswer }: {
  questions: Question[]
  answers: Record<string, string>
  setAnswer: (id: string, value: string) => void
}) {
  return (
    <div>
      {questions.map((question, index) => (
        <div key={question.id} className="question">
          <div className="qhead"><span className="qnum">{index + 1}</span><span>{question.text}</span></div>
          {question.options ? (
            <div className="options">
              {question.options.map((option) => {
                const value = option.split('.')[0].trim()
                const on = answers[question.id] === value || answers[question.id] === option
                return (
                  <label key={option} className={`option ${on ? 'on' : ''}`}>
                    <input type="radio" name={question.id} checked={on} onChange={() => setAnswer(question.id, value)} />
                    <span>{option}</span>
                  </label>
                )
              })}
            </div>
          ) : (
            <input
              className="input"
              value={answers[question.id] ?? ''}
              onChange={(event) => setAnswer(question.id, event.target.value)}
              placeholder="填写答案（一个或多个单词）"
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
export function PracticePage() {
  const { route, go } = useApp()
  const practice = findPractice(route.id)
  const auth = useAuth()
  const userId = auth.user!.userId
  const { draft: draftId, retakeOf, focus } = route.query
  const fresh = useMemo(() => practice && createAttempt({ userId, practice, retakeOf, focus }), [userId, practice, retakeOf, focus])

  if (!practice) {
    return (
      <Card>
        <Empty icon="?" title="没有找到这个练习" hint="请从学习首页重新选择练习。" action={<button className="btn btn-primary" type="button" onClick={() => go('home')}>回到首页</button>} />
      </Card>
    )
  }

  const draft = draftId ? repository.getAttempt(userId, draftId) : null
  if (draftId && (!draft || draft.exerciseId !== practice.exerciseId)) {
    return <Card><Empty icon="?" title="找不到这份草稿" hint="请从历史记录选择要继续的练习。" action={<button className="btn btn-primary" onClick={() => go('history')}>查看历史记录</button>} /></Card>
  }
  if (draft && draft.status !== 'draft') {
    return <Card><Empty icon="✓" title="这份作答已提交" hint={draft.status === 'ready' ? '原始作答已保存在报告里。' : '报告生成中，你可以随时回来看进度。'}
      action={<button className="btn btn-primary" onClick={() => go(`report/pending?attempt=${draft.attemptId}`)}>{draft.status === 'ready' ? '查看练习报告' : '查看评分进度'}</button>} /></Card>
  }
  if (practice.subject === 'speaking') {
    const answers = draft?.subject === 'speaking' ? [draft.draftText, ...Object.values(draft.answers)].filter(Boolean) : []
    return <Card>
      <CardHead title={practice.title} hint="旧版口语草稿" />
      {answers.length > 0 && <div className="evidence-box">{answers.join('\n')}</div>}
      <button className="btn btn-primary mt12" type="button" onClick={() => go('subject/speaking?view=' + (practice.mode === 'mock' ? 'full' : 'practice'))}>进入口语陪练</button>
    </Card>
  }
  const initial = draft ?? fresh!
  return <PracticeInner key={initial.attemptId} practice={practice} initial={initial} />
}

function PracticeInner({ practice, initial }: { practice: Practice; initial: Attempt }) {
  const session = usePracticeSession(practice, initial)
  return (
    <>
      <PracticeHeader practice={practice} session={session} />
      {practice.subject === 'writing' && <WritingView practice={practice} session={session} />}
      {practice.subject === 'listening' && <ListeningView practice={practice} session={session} />}
      {practice.subject === 'reading' && <ReadingView practice={practice} session={session} />}
      <ClinicEvidenceActions practice={practice} answers={session.answers} writingText={session.draftText} />
    </>
  )
}
