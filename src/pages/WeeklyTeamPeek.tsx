import { useEffect, useState } from 'react'
import { SUBJECT_META, SUBJECT_ORDER as skills, type Subject } from '../contract'
import './weeklyTeam.css'

type Member = { nickname: string; self: boolean; counts: Record<Subject, number> }
type Dashboard = {
  team: { name: string; members: Member[] } | null
  goals: Record<Subject, number>
  week: { start: string; end: string }
}

export function WeeklyTeamPeek({ userId, subject }: { userId: string; subject: Subject }) {
  const [expanded, setExpanded] = useState(false)
  const [snapshot, setSnapshot] = useState<{ owner: string; dashboard: Dashboard } | null>(null)
  const [stale, setStale] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let loading = false
    const options: RequestInit = {
      headers: { 'X-Speaking-Scope': encodeURIComponent(userId) },
      cache: 'no-store',
      signal: controller.signal,
    }
    async function update() {
      if (loading || document.hidden || controller.signal.aborted) return
      loading = true
      try {
        const profile = await fetch('/api/campus/me', options)
        if (!profile.ok) throw new Error('profile')
        if (!(await profile.json()).active) {
          if (!controller.signal.aborted) setSnapshot(null)
          return
        }
        const response = await fetch('/api/campus/teams/me', options)
        if (!response.ok) throw new Error('team')
        const dashboard: Dashboard = await response.json()
        if (!controller.signal.aborted) {
          setSnapshot({ owner: userId, dashboard })
          setStale(false)
        }
      } catch {
        if (!controller.signal.aborted) setStale(true)
      } finally { loading = false }
    }
    void update()
    const timer = expanded ? window.setInterval(update, 15000) : undefined
    document.addEventListener('visibilitychange', update)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [userId, expanded])

  const dashboard = snapshot?.owner === userId ? snapshot.dashboard : null
  if (!dashboard?.team) return null
  const { team, goals, week } = dashboard
  const done = team.members.filter(member => member.counts[subject] >= goals[subject]).length
  return (
    <details className="card subject-team-peek" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>
        <strong>小组本周进度</strong><span>{team.name}</span>
        <span className="chip primary">{SUBJECT_META[subject].label}达标 {done}/{team.members.length} 人</span>
      </summary>
      <p className="small muted">{week.start} 至 {week.end}{stale ? ' · 连接中断，显示上次更新' : ''}</p>
      <table>
        <caption className="subject-team-caption">队员本周完成练习的次数</caption>
        <thead><tr><th scope="col">队员</th>{skills.map(skill => <th scope="col" key={skill}>{SUBJECT_META[skill].label}</th>)}</tr></thead>
        <tbody>{team.members.map((member, index) => <tr key={index}>
          <th scope="row">{member.nickname}{member.self && '（我）'}</th>
          {skills.map(skill => <td key={skill} className={skill === subject ? 'team-current' : ''}>{member.counts[skill]} 次</td>)}
        </tr>)}</tbody>
      </table>
    </details>
  )
}
