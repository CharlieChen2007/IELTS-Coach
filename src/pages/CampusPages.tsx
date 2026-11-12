/**
 * 校园认证 / 校园营地 页面
 *
 * 路由：
 *   #/campus            → 未认证时是「校园认证表单」
 *   #/campus/rank       → 排行榜（同校）
 *   #/campus/partner    → 寻找搭子（画像 → 匹配 → 发申请）
 *   #/campus/camp       → 营地空间（搭子帖）
 *   #/campus/partners   → 我的搭子（待处理申请 + 已配对）
 *
 * 数据读写全部走 campStore.ts，后续可整体替换为云接口。
 */
import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { useApp } from '../appContext'
import { Card, CardHead, Empty } from '../components'
import {
  DIFFICULTY,
  pendingRequests,
  rankOf,
  readCamp,
  seedMembers,
  totalPoints,
  updateCamp,
  writeCamp,
  type CampPost,
  type CampUser,
  type CampusProfile,
} from '../campStore'
import { makeId } from '../contract'

// ---------------------------------------------------------------------------
// 图标
// ---------------------------------------------------------------------------
const Icon = {
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8.4" r="3.2" /><path d="M3.4 19.4c0-3 2.5-5 5.6-5s5.6 2 5.6 5" /><path d="M16 5.6a3 3 0 0 1 0 5.6M17.4 14.6c2 .5 3.4 2.2 3.4 4.4" /></svg>,
  radar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="4.4" /><circle cx="12" cy="12" r="1" fill="currentColor" /><path d="M12 12 17.6 6.6" /></svg>,
  user: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.4 3.1-5.6 7-5.6s7 2.2 7 5.6" /></svg>,
  send: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m4 12 16-7-6.6 16-2.8-6.6z" /><path d="m10.6 14.4 3.4-3.4" /></svg>,
  spark: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3.4 1.8 4.9 4.9 1.8-4.9 1.8L12 16.8l-1.8-4.9L5.3 10l4.9-1.8z" /></svg>,
}

function Badge({ children, tone = '' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`camp-badge ${tone}`}>{children}</span>
}

// ---------------------------------------------------------------------------
// 校园认证
// ---------------------------------------------------------------------------
export function CampusVerifyPage() {
  const auth = useAuth()
  const { go, toast, refresh } = useApp()
  const userId = auth.user!.userId
  const camp = readCamp(userId)
  const [form, setForm] = useState({
    school: camp.profile?.school ?? '',
    campus: camp.profile?.campus ?? '',
    grade: camp.profile?.grade ?? '',
    major: camp.profile?.major ?? '',
    className: camp.profile?.className ?? '',
    studentNo: camp.profile?.studentNo ?? '',
  })
  const [error, setError] = useState('')

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }))
    setError('')
  }

  const submit = () => {
    const missing = Object.entries(form).find(([, value]) => !value.trim())
    if (missing) { setError('请把六项信息都填写完整'); return }
    if (!/^\d{6,20}$/.test(form.studentNo.trim())) { setError('学号应为 6-20 位数字，请检查后重填'); return }
    const profile: CampusProfile = {
      userId,
      school: form.school.trim(),
      campus: form.campus.trim(),
      grade: form.grade.trim(),
      major: form.major.trim(),
      className: form.className.trim(),
      studentNo: form.studentNo.trim(),
      verifiedAt: new Date().toISOString(),
    }
    const existing = readCamp(userId)
    writeCamp(userId, {
      ...existing,
      profile,
      members: existing.members.some((m) => m.userId === userId)
        ? existing.members
        : [{
          userId,
          nickname: auth.user!.nickname,
          school: profile.school,
          grade: profile.grade,
          major: profile.major,
          className: profile.className,
          targetBand: auth.profile?.targetBand ?? 6.5,
          points: existing.points.reduce((s, p) => s + p.points, 0),
          tags: [],
          hasPortrait: false,
          updatedAt: new Date().toISOString(),
        }, ...existing.members, ...seedMembers(profile.school).filter((m) => !existing.members.some((e) => e.userId === m.userId))],
    })
    refresh()
    toast('认证成功，欢迎加入校园营地')
    go('home')
  }

  return (
    <div className="camp-verify">
      <Card>
        <CardHead
          title="校园认证"
          hint="认证后即可进入同校排行榜、寻找搭子。信息仅用于同校匹配，不会公开展示。"
          extra={<Badge tone="primary">仅同校可见</Badge>}
        />
        <div className="camp-form">
          <label className="camp-field"><span>学校<em>*</em></span><input className="input" value={form.school} onChange={set('school')} placeholder="例如：广东外语外贸大学" /></label>
          <label className="camp-field"><span>新明<em>*</em></span><input className="input" value={form.campus} onChange={set('campus')} placeholder="例如：大学城校区" /></label>
          <label className="camp-field"><span>年级<em>*</em></span><input className="input" value={form.grade} onChange={set('grade')} placeholder="例如：大三" /></label>
          <label className="camp-field"><span>专业<em>*</em></span><input className="input" value={form.major} onChange={set('major')} placeholder="例如：英语语言文学" /></label>
          <label className="camp-field"><span>班级<em>*</em></span><input className="input" value={form.className} onChange={set('className')} placeholder="例如：英语 2301" /></label>
          <label className="camp-field"><span>学号<em>*</em></span><input className="input" value={form.studentNo} onChange={set('studentNo')} placeholder="6-20 位数字" inputMode="numeric" /></label>
        </div>
        {error && <div className="form-msg error mt16" style={{ marginBottom: 0 }}>{error}</div>}
        <div className="row mt16">
          <button className="btn btn-primary" type="button" onClick={submit}>完成认证</button>
          <button className="btn btn-quiet" type="button" onClick={() => go('home')}>稍后再认证</button>
          <span className="spacer" />
          <span className="small muted">认证完成后自动返回首页</span>
        </div>
      </Card>
      <p className="camp-privacy">· 学号仅用于校验同校身份，不对外展示 · 可随时重新提交认证信息</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 排行榜（同校）
// ---------------------------------------------------------------------------
export function CampusRankPage() {
  const auth = useAuth()
  const { go } = useApp()
  const userId = auth.user!.userId
  const camp = readCamp(userId)
  const rows = useMemo(() => rankOf(camp, userId, auth.user!.nickname), [camp, userId, auth.user!.nickname])
  const myRow = rows.find((r) => r.isMe)
  const mine = camp.points.slice(0, 8)

  return (
    <div className="camp-page">
      <div className="camp-head">
        <div>
          <h1>{camp.profile?.school || '校园营地'} · 排行榜</h1>
          <p>同校范围内的学习积分排名。完成练习、复练与复习都会获得积分，难度越高得分越多。</p>
        </div>
        <div className="camp-head-stats">
          <div><b>{totalPoints(camp)}</b><span>我的积分</span></div>
          <div><b>{myRow?.rank ?? '—'}</b><span>校内排名</span></div>
          <div><b>{rows.length}</b><span>营地成员</span></div>
        </div>
      </div>

      <div className="grid g2 mt16" style={{ alignItems: 'start' }}>
        <Card>
          <CardHead title="校内榜" hint="仅统计同一学校" extra={<Badge>{camp.profile?.school || '未认证'}</Badge>} />
          <div className="rank-list">
            {rows.slice(0, 12).map((row) => (
              <div key={row.userId} className={`rank-row ${row.isMe ? 'me' : ''}`}>
                <span className={`rank-no r${row.rank <= 3 ? row.rank : 0}`}>{row.rank}</span>
                <span className="avatar sm">{row.nickname.slice(0, 1).toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{row.nickname}{row.isMe && <em className="me-tag">我</em>}</b>
                </div>
                <span className="rank-pts">{row.points}<small>分</small></span>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid" style={{ gap: 16 }}>
          <Card>
            <CardHead title="积分规则" hint="同一提交只计一次" />
            <div className="grid" style={{ gap: 10 }}>
              {(Object.entries(DIFFICULTY) as [string, { label: string; points: number }][]).map(([key, item]) => (
                <div key={key} className="points-rule">
                  <span className={`pill d${key}`}>{item.label}难度</span>
                  <span className="spacer" />
                  <b>+{item.points}</b>
                </div>
              ))}
            </div>
            <p className="small muted mt12 mb0">练习 → 按难度计分 · 复练 → 追加基础分 · 复习错题 → 每道 +5</p>
          </Card>
          <Card>
            <CardHead title="我的积分流水" hint="最近 8 条" extra={<span className="chip primary">{mine.length} 条</span>} />
            {mine.length === 0
              ? <Empty icon="◎" title="还没有积分记录" hint="完成一次练习后，积分会出现在这里。" />
              : (
                <div className="grid" style={{ gap: 8 }}>
                  {mine.map((entry) => (
                    <div key={entry.id} className="pt-row">
                      <span className="pt-kind">{entry.label}</span>
                      <span className="spacer" />
                      <b>+{entry.points}</b>
                      <small>{entry.createdAt.slice(5, 16).replace('T', ' ')}</small>
                    </div>
                  ))}
                </div>
              )}
          </Card>
        </div>
      </div>
      <button className="btn btn-quiet mt16" type="button" onClick={() => go('home')}>← 返回首页</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 画像问卷
// ---------------------------------------------------------------------------
const PORTRAIT_QUESTIONS: { id: string; q: string; options: string[] }[] = [
  { id: 'goal', q: '你目前的备考目标是什么？', options: ['冲刺目标分', '稳定在目标分', '先熟悉考试流程', '补单项短板'] },
  { id: 'weak', q: '你最想提升的是哪一科？', options: ['听力', '口语', '阅读', '写作'] },
  { id: 'style', q: '你更喜欢什么样的陪练方式？', options: ['互相提问抽查', '一起模考对答案', '轮流批改作文', '口语对话练习'] },
  { id: 'time', q: '你通常什么时候有空？', options: ['工作日上午', '工作日下午', '晚上', '周末为主'] },
  { id: 'intensity', q: '你希望多久练一次？', options: ['每天', '每周 3-4 次', '每周 1-2 次', '考前突击'] },
  { id: 'level', q: '你现在的水平大概是？', options: ['5.5 以下', '5.5 - 6.0', '6.0 - 6.5', '7.0 以上'] },
]

function buildPortrait(answers: Record<string, string>): string[] {
  return PORTRAIT_QUESTIONS.map((q) => answers[q.id]).filter(Boolean)
}

/** 画像相似度：共同标签越多越接近，返回 0-100 */
export function matchScore(a: string[], b: string[]): number {
  if (a.length === 0) return 0
  const shared = a.filter((tag) => b.includes(tag)).length
  return Math.min(99, Math.round((shared / a.length) * 100))
}

// ---------------------------------------------------------------------------
// 寻找搭子：中心页 / 问卷 / 匹配结果
// ---------------------------------------------------------------------------
export function CampusPartnerPage() {
  const auth = useAuth()
  const { go, toast, refresh } = useApp()
  const userId = auth.user!.userId
  const [camp, setCamp] = useState(() => readCamp(userId))
  const [step, setStep] = useState<'hub' | 'quiz' | 'match'>('hub')
  const [answers, setAnswers] = useState<Record<string, string>>(() => readCamp(userId).portrait ?? {})
  const [qIndex, setQIndex] = useState(0)
  const [sent, setSent] = useState<string[]>([])

  const myTags = useMemo(() => buildPortrait(camp.portrait ?? {}), [camp.portrait])
  const incoming = pendingRequests(camp, userId)

  const savePortrait = () => {
    const tags = buildPortrait(answers)
    const next = updateCamp(userId, (store) => ({
      ...store,
      portrait: { ...answers },
      members: store.members.map((m) => (m.userId === userId ? { ...m, tags, hasPortrait: true } : m)),
    }))
    setCamp(next)
    refresh()
    toast('个人画像已生成，可以开始匹配搭子')
    setStep('hub')
  }

  const sendRequest = (target: CampUser, score: number) => {
    if (camp.requests.some((r) => r.toUserId === target.userId && r.fromUserId === userId && r.status === 'pending')) {
      toast('已经向 TA 发送过申请，请等待对方回应')
      return
    }
    const next = updateCamp(userId, (store) => ({
      ...store,
      requests: [{
        requestId: makeId('req'),
        fromUserId: userId,
        fromNickname: auth.user!.nickname,
        toUserId: target.userId,
        score,
        reason: target.tags.filter((t) => myTags.includes(t)).slice(0, 2).join('、') || '备考节奏接近',
        message: '',
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      }, ...store.requests],
    }))
    setCamp(next)
    setSent((prev) => [...prev, target.userId])
    toast(`申请已发送给 ${target.nickname}，等待对方接受`)
  }

  // ---- 问卷 ----
  if (step === 'quiz') {
    const item = PORTRAIT_QUESTIONS[qIndex]
    const last = qIndex === PORTRAIT_QUESTIONS.length - 1
    return (
      <div className="camp-page">
        <Card className="camp-quiz">
          <div className="quiz-progress">
            <span>{qIndex + 1} / {PORTRAIT_QUESTIONS.length}</span>
            <div className="bar"><i style={{ width: `${((qIndex + 1) / PORTRAIT_QUESTIONS.length) * 100}%` }} /></div>
          </div>
          <h2>{item.q}</h2>
          <div className="quiz-options">
            {item.options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`quiz-opt ${answers[item.id] === opt ? 'on' : ''}`}
                onClick={() => setAnswers((prev) => ({ ...prev, [item.id]: opt }))}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="row mt16">
            {qIndex > 0 && <button className="btn btn-quiet" type="button" onClick={() => setQIndex((v) => v - 1)}>上一题</button>}
            <span className="spacer" />
            <button
              className="btn btn-primary"
              type="button"
              disabled={!answers[item.id]}
              onClick={() => { if (last) savePortrait(); else setQIndex((v) => v + 1) }}
            >
              {last ? '生成我的画像' : '下一题'}
            </button>
          </div>
        </Card>
      </div>
    )
  }

  // ---- 匹配结果 ----
  if (step === 'match') {
    const candidates = camp.members
      .filter((m) => m.userId !== userId && m.hasPortrait)
      .map((m) => ({ user: m, score: matchScore(myTags, m.tags) }))
      .sort((a, b) => b.score - a.score)

    return (
      <div className="camp-page">
        <div className="camp-head">
          <div>
            <h1>为你找到的搭子</h1>
            <p>按你的画像计算匹配度。匹配不是自动成功 —— 需要你发申请，对方接受后才成为搭子。</p>
          </div>
        </div>
        <Card className="mt16">
          <CardHead
            title="匹配结果"
            hint={`共 ${candidates.length} 位同校同学`}
            extra={<Badge tone="primary">我的标签：{myTags.slice(0, 2).join(' / ') || '未生成'}</Badge>}
          />
          {candidates.length === 0
            ? <Empty icon="○" title="还没有可匹配的同学" hint="营地里还没有生成画像的同学，先去营地空间发个帖。" />
            : (
              <div className="grid" style={{ gap: 12 }}>
                {candidates.map(({ user, score }) => {
                  const isSent = sent.includes(user.userId) || camp.requests.some((r) => r.toUserId === user.userId && r.fromUserId === userId && r.status === 'pending')
                  return (
                    <div key={user.userId} className="match-row">
                      <span className="avatar">{user.nickname.slice(0, 1).toUpperCase()}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="match-name">
                          {user.nickname}
                          <span className={`match-score ${score >= 50 ? 'good' : ''}`}>{score}% 匹配</span>
                        </div>
                        <div className="small muted">{user.grade} · {user.major} · 目标 {user.targetBand}</div>
                        <div className="match-tags">
                          {user.tags.slice(0, 4).map((t) => <span key={t} className="tag">{t}</span>)}
                        </div>
                      </div>
                      <button className={`btn btn-sm ${isSent ? '' : 'btn-primary'}`} type="button" disabled={isSent} onClick={() => sendRequest(user, score)}>
                        {isSent ? '已发送' : '发送申请'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
        </Card>
        <div className="row mt16">
          <button className="btn btn-quiet" type="button" onClick={() => setStep('hub')}>← 返回</button>
        </div>
      </div>
    )
  }

  // ---- 中心页 ----
  return (
    <div className="camp-page">
      <div className="camp-head">
        <div>
          <h1>寻找搭子</h1>
          <p>先做一份需求问卷生成个人画像，再按画像为你匹配同校搭子。</p>
        </div>
        <div className="camp-head-stats">
          <div><b>{camp.members.length}</b><span>营地成员</span></div>
          <div><b>{camp.partners.length}</b><span>我的搭子</span></div>
          <div><b className={incoming.length ? 'has-dot' : ''}>{incoming.length}</b><span>待处理申请</span></div>
        </div>
      </div>

      <div className="partner-hub mt16">
        <button className="hub-btn" type="button" onClick={() => { setQIndex(0); setStep('quiz') }}>
          <span className="hub-icon">{Icon.user}</span>
          <b>生成我的个人画像</b>
          <small>{camp.portrait ? '已生成，可重新作答更新' : '6 道题，约 1 分钟'}</small>
        </button>
        <button
          className="hub-btn primary"
          type="button"
          onClick={() => {
            if (!camp.portrait) { toast('请先生成个人画像'); setQIndex(0); setStep('quiz'); return }
            setStep('match')
          }}
        >
          <span className="hub-icon">{Icon.radar}</span>
          <b>在营地里寻找搭子</b>
          <small>按画像匹配同校同学</small>
        </button>
        <button className="hub-btn" type="button" onClick={() => go('campus/camp')}>
          <span className="hub-icon">{Icon.users}</span>
          <b>营地空间</b>
          <small>看看大家发布的搭子帖</small>
        </button>
        <button className="hub-btn" type="button" onClick={() => go('campus/partners')}>
          <span className="hub-icon">{Icon.send}</span>
          <b>我的搭子</b>
          <small>{incoming.length > 0 ? `${incoming.length} 条待处理申请` : '查看申请与已配对'}</small>
          {incoming.length > 0 && <span className="hub-dot" />}
        </button>
      </div>
      <button className="btn btn-quiet mt16" type="button" onClick={() => go('home')}>← 返回首页</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 营地空间：搭子帖
// ---------------------------------------------------------------------------
export function CampusSpacePage() {
  const auth = useAuth()
  const { go, toast } = useApp()
  const userId = auth.user!.userId
  const [camp, setCamp] = useState(() => readCamp(userId))
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ subjects: '', bandGoal: '', schedule: '', intro: '' })

  const publish = () => {
    if (!draft.subjects.trim() || !draft.intro.trim()) { toast('请填写想练的科目和自我介绍'); return }
    const post: CampPost = {
      postId: makeId('post'),
      userId,
      nickname: auth.user!.nickname,
      school: camp.profile?.school ?? '',
      subjects: draft.subjects.split(/[、,，/\s]+/).filter(Boolean),
      bandGoal: draft.bandGoal || '不限',
      schedule: draft.schedule || '时间灵活',
      intro: draft.intro.trim(),
      tags: camp.portrait ? buildPortrait(camp.portrait) : [],
      createdAt: new Date().toISOString(),
    }
    const next = updateCamp(userId, (store) => ({ ...store, posts: [post, ...store.posts] }))
    setCamp(next)
    setOpen(false)
    setDraft({ subjects: '', bandGoal: '', schedule: '', intro: '' })
    toast('帖子已发布到营地空间')
  }

  return (
    <div className="camp-page">
      <div className="camp-head">
        <div>
          <h1>营地空间</h1>
          <p>{camp.profile?.school || '你的学校'} 同学发布的搭子帖。也可以自己发帖，让合适的人来找你。</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setOpen(true)}>
          <span className="btn-icon">{Icon.spark}</span>发布搭子帖
        </button>
      </div>

      {open && (
        <Card className="mt16">
          <CardHead title="发布搭子帖" hint="写清楚想练什么、什么时候练，匹配率更高" />
          <div className="camp-form">
            <label className="camp-field"><span>想练的科目</span><input className="input" value={draft.subjects} onChange={(e) => setDraft({ ...draft, subjects: e.target.value })} placeholder="例如：口语、写作" /></label>
            <label className="camp-field"><span>目标分</span><input className="input" value={draft.bandGoal} onChange={(e) => setDraft({ ...draft, bandGoal: e.target.value })} placeholder="例如：7.0" /></label>
            <label className="camp-field"><span>可练时段</span><input className="input" value={draft.schedule} onChange={(e) => setDraft({ ...draft, schedule: e.target.value })} placeholder="例如：工作日晚 8 点后" /></label>
          </div>
          <label className="camp-field mt12"><span>自我介绍</span><textarea className="textarea" value={draft.intro} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} placeholder="说说你的情况，以及希望搭子怎么配合你" /></label>
          <div className="row mt12">
            <button className="btn btn-primary" type="button" onClick={publish}>发布</button>
            <button className="btn btn-quiet" type="button" onClick={() => setOpen(false)}>取消</button>
          </div>
        </Card>
      )}

      <div className="post-grid mt16">
        {camp.posts.length === 0 && (
          <Card>
            <Empty
              icon="○"
              title="还没有人发帖"
              hint="你可以成为第一个发布需求的人。"
              action={<button className="btn btn-primary" type="button" onClick={() => setOpen(true)}>发布搭子帖</button>}
            />
          </Card>
        )}
        {camp.posts.map((post) => (
          <Card key={post.postId} className="post-card">
            <div className="post-top">
              <span className="avatar">{post.nickname.slice(0, 1).toUpperCase()}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{post.nickname}</b>
                <div className="small muted">{post.school} · {post.createdAt.slice(5, 10)}</div>
              </div>
              <Badge tone="primary">目标 {post.bandGoal}</Badge>
            </div>
            <p className="post-intro">{post.intro}</p>
            <div className="match-tags">
              {post.subjects.map((s) => <span key={s} className="tag">{s}</span>)}
              <span className="tag">{post.schedule}</span>
            </div>
          </Card>
        ))}
      </div>
      <button className="btn btn-quiet mt16" type="button" onClick={() => go('campus/partner')}>← 返回寻找搭子</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 我的搭子：申请处理
// ---------------------------------------------------------------------------
export function CampusPartnersPage() {
  const auth = useAuth()
  const { go, toast, refresh } = useApp()
  const userId = auth.user!.userId
  const [camp, setCamp] = useState(() => readCamp(userId))
  const incoming = pendingRequests(camp, userId)
  const sentList = camp.requests.filter((r) => r.fromUserId === userId)
  const partners = camp.members.filter((m) => camp.partners.includes(m.userId))

  const decide = (requestId: string, accept: boolean) => {
    const next = updateCamp(userId, (store) => {
      const req = store.requests.find((r) => r.requestId === requestId)
      return {
        ...store,
        requests: store.requests.map((r) => (r.requestId === requestId ? { ...r, status: accept ? 'accepted' as const : 'rejected' as const } : r)),
        partners: accept && req ? Array.from(new Set([...store.partners, req.fromUserId])) : store.partners,
      }
    })
    setCamp(next)
    refresh()
    toast(accept ? '已接受申请，TA 现在是你的搭子' : '已拒绝该申请')
  }

  return (
    <div className="camp-page">
      <div className="camp-head">
        <div>
          <h1>我的搭子</h1>
          <p>在这里处理别人发来的申请，也可以看到自己发出的申请状态。</p>
          <div className="row mt12">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => go('subject/speaking?view=campus')}>和搭子双人模考</button>
            <button type="button" className="btn btn-sm" onClick={() => go('subject/speaking?view=campus-team')}>查看备考小组</button>
          </div>
        </div>
        <div className="camp-head-stats">
          <div><b className={incoming.length ? 'has-dot' : ''}>{incoming.length}</b><span>待处理</span></div>
          <div><b>{partners.length}</b><span>已成搭子</span></div>
        </div>
      </div>

      <Card className="mt16">
        <CardHead
          title="收到的申请"
          hint="接受后对方会出现在「我的搭子」里"
          extra={incoming.length > 0 ? <span className="badge-dot">{incoming.length}</span> : undefined}
        />
        {incoming.length === 0
          ? <Empty icon="✓" title="暂时没有新申请" hint="收到申请时，本页标签右上角会出现红点。" />
          : (
            <div className="grid" style={{ gap: 10 }}>
              {incoming.map((req) => (
                <div key={req.requestId} className="match-row">
                  <span className="avatar">{req.fromNickname.slice(0, 1).toUpperCase()}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="match-name">{req.fromNickname}<span className="match-score good">{req.score}% 匹配</span></div>
                    <div className="small muted">{req.reason}</div>
                  </div>
                  <button className="btn btn-sm btn-primary" type="button" onClick={() => decide(req.requestId, true)}>接受</button>
                  <button className="btn btn-sm" type="button" onClick={() => decide(req.requestId, false)}>拒绝</button>
                </div>
              ))}
            </div>
          )}
      </Card>

      <div className="grid g2 mt16" style={{ alignItems: 'start' }}>
        <Card>
          <CardHead title="我的搭子" hint="已接受的搭子" />
          {partners.length === 0
            ? <Empty icon="○" title="还没有搭子" hint="去营地空间发帖，或按画像匹配一位。" />
            : partners.map((p) => (
              <div key={p.userId} className="match-row">
                <span className="avatar">{p.nickname.slice(0, 1).toUpperCase()}</span>
                <div style={{ flex: 1 }}><b>{p.nickname}</b><div className="small muted">{p.grade} · {p.major}</div></div>
                <Badge>目标 {p.targetBand}</Badge>
              </div>
            ))}
        </Card>
        <Card>
          <CardHead title="我发出的申请" hint="等待对方处理" />
          {sentList.length === 0
            ? <Empty icon="○" title="还没有发出申请" hint="在「寻找搭子」里按画像匹配并发申请。" />
            : sentList.map((req) => (
              <div key={req.requestId} className="match-row">
                <span className="avatar">{req.fromNickname.slice(0, 1).toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>发给 {camp.members.find((m) => m.userId === req.toUserId)?.nickname ?? '同学'}</b>
                  <div className="small muted">{req.reason}</div>
                </div>
                <span className={`chip ${req.status === 'accepted' ? 'green' : req.status === 'rejected' ? 'gray' : 'amber'}`}>
                  {req.status === 'accepted' ? '已接受' : req.status === 'rejected' ? '已拒绝' : '等待回应'}
                </span>
              </div>
            ))}
        </Card>
      </div>
      <button className="btn btn-quiet mt16" type="button" onClick={() => go('campus/partner')}>← 返回寻找搭子</button>
    </div>
  )
}
