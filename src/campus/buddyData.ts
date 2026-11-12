import { skills, skillNames, type SchoolProfile, type Skill } from './SocialApi'
import type { Report } from '../contract'

export type BuddyPost = { subject: Skill; subjects?: Skill[]; message: string; slot: string; target: number; gift: Skill | ''; summary: string }
export type BuddyCard = { profile: SchoolProfile; post: BuddyPost; department?: string; portrait?: number[] | null; portraitOnly?: boolean }
export type Invitation = { other: string; name: string; status: 'pending' | 'accepted' | 'declined'; incoming: boolean; meetState?: 'pending'|'confirmed'|null; meetIncoming?:boolean }
export type PlazaState = { profile: SchoolProfile | null; mine: BuddyPost | null; cards: BuddyCard[]; invites: Invitation[]; portrait?: number[] | null; suggestions?: { profile: SchoolProfile; portrait: number[] }[] }

export const portraitQuestions = [
  ['你目前的备考目标是什么？', ['冲刺目标分', '稳定在目标分', '先熟悉考试流程', '补单项短板']],
  ['你最想提升的是哪一科？', ['听力', '口语', '阅读', '写作']],
  ['你更喜欢什么样的陪练方式？', ['互相提问抽查', '一起模考对答案', '轮流批改作文', '口语对话练习']],
  ['你通常什么时候有空？', ['工作日上午', '工作日下午', '晚上', '周末为主']],
  ['你希望多久练一次？', ['每天', '每周 3–4 次', '每周 1–2 次', '考前突击']],
  ['你现在的水平大概是？', ['低于 5.5', '5.5–6.0', '6.5', '7.0 及以上']],
] as const

export function portraitTags(answers: number[]) {
  return portraitQuestions.map(([, options],index)=>options[answers[index]])
}

export function portraitCard({profile,portrait}: {profile: SchoolProfile; portrait: number[]}): BuddyCard {
  const tags=portraitTags(portrait)
  return {profile, portrait, portraitOnly:true, post:{
    subject:skills[portrait[1]], gift:profile.strong[0] || '', target:profile.target || 0, slot:tags[3], summary:'',
    message:'想练'+tags[1]+' · '+tags[2]+' · '+tags[4],
  }}
}

const entries: [string, string, Skill, Skill, number, number, string, string][] = [
  ['林栀', '人文学院 · 大三', 'speaking', 'reading', 6, 7, '周三晚间', '想约人在汇星楼轮流做 Part 2 考官，每次给对方提一个具体追问。'],
  ['周闻远', '建筑与城市规划学院 · 大四', 'listening', 'speaking', 6.5, 7, '周六上午', '一起练地图题。听完先各画路线，再对照哪个转弯听错了。'],
  ['江芮', '外国语学院 · 大二', 'reading', 'writing', 6.5, 7.5, '周二晚间', '找人练段落匹配，每篇交换一次定位句。我可以帮你改作文开头。'],
  ['许念', '传播学院 · 大三', 'writing', 'listening', 6, 6.5, '周四晚间', '每周交换一篇 Task 2，只看论点和例子能不能连起来。'],
  ['宋时宜', '管理学院 · 大三', 'listening', 'reading', 5.5, 6.5, '周三晚间', '总会漏掉电话里改口后的时间，想一起听写 Section 1 再核对。'],
  ['陈亦航', '电子与信息工程学院 · 大二', 'speaking', 'listening', 5.5, 6.5, '周日下午', '周末来一组 Part 1 快问快答，练习把一句话说得更具体。'],
  ['唐语乔', '经济学院 · 大四', 'writing', 'speaking', 6.5, 7, '周五下午', '想找人互评图表作文的 overview，我也能陪练交换面试口语。'],
  ['吴桐', '心理学院 · 大三', 'reading', 'listening', 6, 6.5, '周二下午', '判断题常卡在 False 和 Not Given，一起说说各自的证据在哪。'],
  ['魏行之', '机电与控制工程学院 · 研一', 'speaking', 'writing', 7, 7.5, '周六晚间', '一起练 Part 3 对比题，每次用一个校园里的例子展开观点。'],
  ['沈知夏', '艺术学部 · 大二', 'listening', 'speaking', 6, 7, '周一晚间', '找个搭子复听讲座片段，标出漏掉的转折和最终结论。'],
  ['陆清扬', '法学院 · 大三', 'reading', 'writing', 7, 7.5, '周日上午', '约周末限时阅读，交卷后各讲一道最容易误选的题。'],
  ['叶可心', '计算机与软件学院 · 大四', 'writing', 'reading', 5.5, 6.5, '周三下午', '想把长句拆清楚，每次交换三句话，读一遍看看哪里容易误解。'],
]
export const buddySamples: BuddyCard[] = entries.map(([nickname, department, subject, gift, level, target, slot, message], index) => ({
  profile: { id: 'plaza-peer-' + (index + 1), school: 'szu', nickname, level, target, strong: [gift], need: [subject], slots: [slot] },
  post: { subject, gift, target, slot, message, summary: '' }, department,
  portrait:[index%4,skills.indexOf(subject),subject==='speaking'?3:subject==='writing'?2:1,
    /周[六日]/.test(slot)?3:slot.endsWith('晚间')?2:slot.endsWith('下午')?1:0,
    index%3,level>=7?3:level===6.5?2:1],
}))

export function reportExcerpt(report: Report) {
  const what = skillNames[report.subject] + ' · ' + report.original.title.slice(0, 36)
  const score = report.score.display?.trim()
  const focus = report.feedback.find(x=>x.severity==='high')?.questionType || report.feedback[0]?.questionType
  return [what, score, focus && '想练' + focus].filter(Boolean).join(' · ').slice(0, 150)
}

export function matchFacts(peer: BuddyCard, self: SchoolProfile | null, own: BuddyPost | null, target: number | undefined, reports: Report[]) {
  const {profile, post} = peer
  const latest = reports.find(report=>report.subject===post.subject && report.score.band != null)
  const assessed=post.subject==='writing'&&self?.writingAssessment?.status==='complete'&&profile.writingAssessment?.status==='complete'
  const level = assessed ? self?.writingAssessment?.band : post.subject==='writing'?self?.level:latest?.score.band ?? self?.level
  const peerLevel=assessed?profile.writingAssessment?.band:profile.level
  const similar = level != null && peerLevel != null && Math.abs(level - peerLevel) <= 0.5
  const needs = new Set([...(self?.need || []), ...(own ? [own.subject] : [])])
  const strengths = new Set([...(self?.strong || []), ...(own?.gift ? [own.gift] : [])])
  const helpsMe = post.gift && needs.has(post.gift)
  const helpThem = strengths.has(post.subject)
  const sharedSlot = self?.slots.includes(post.slot) || own?.slot === post.slot
  const goal = (own?.target || self?.target || target) === post.target
  const tags: {label: string; reason: string}[] = []
  if (helpsMe || helpThem) tags.push({label:'强弱互补', reason: helpsMe ? '可陪你练' + skillNames[post.gift as Skill] : '你可以帮 TA 练' + skillNames[post.subject]})
  if (similar) tags.push({label:assessed?'首稿水平相近':'水平相近', reason:assessed?'双方全部合格首稿的综合参考分相差不超过0.5，未经考官校准。':'双方自评或对应科目练习参考分相差不超过0.5；不代表正式考试成绩。'})
  if (sharedSlot) tags.push({label:'空档重合',reason:'都可以在' + post.slot + '练习'})
  if (goal) tags.push({label:'目标一致',reason:'都以 ' + post.target + ' 分为目标'})
  return tags
}

export function sortedReports(reports:Report[]) {
  return reports.filter(r=>r.status==='ready' && skills.includes(r.subject)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
}

