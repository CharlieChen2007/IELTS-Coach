import { toHash, useApp } from '../appContext'
import { useEnterReplay } from '../components'
import { CampusBasePage } from '../pages/CampusBasePage'
import { CampusExamPage } from '../pages/ExamExperience'
import { BuddyPlaza } from './BuddyPlaza'
import { CampusGoal } from './CampusGoal'
import { ClinicPage } from './ClinicPages'
import { Social } from './Social'
import './campusHub.css'
import '../pages/workspaceNavigation.css'

const activities = [
  ['base', '校园活动'],
  ['help', '互助单'],
  ['challenge', '小队挑战'],
  ['goals', '校级目标'],
  ['points', '我的积分'],
] as const

export function CampusHub() {
  const { route } = useApp()
  const id = route.id === 'camp' ? 'help' : route.id || 'base'
  const buddy = ['match', 'partner', 'recruit', 'partners'].includes(id)
  const content = buddy ? <BuddyPlaza /> :
    id === 'exam' ? <CampusExamPage /> :
    id === 'help' ? <ClinicPage tab="help" /> :
    id === 'goals' ? <CampusGoal /> :
    id === 'challenge' || id === 'rank' || id === 'points' ? <Social key={id} tab={id} /> :
    <CampusBasePage />
  /* 顶部「校园活动」导航行静止，只有它下面的内容随栏目切换进场一次。 */
  const stage = useEnterReplay<HTMLDivElement>(id)

  return (
    <div className="szu-workspace">
      <nav className="camp-activities speaking-tools workspace-primary" aria-label="校园活动">
        {activities.map(([key, label]) => (
          <a key={key} className={id === key ? 'on' : ''} href={toHash('campus/' + key)} aria-current={id === key ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      <div className="stage-body" ref={stage}>{content}</div>
    </div>
  )
}
