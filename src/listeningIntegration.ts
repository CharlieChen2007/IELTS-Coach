import { QUESTION_TYPE_LABELS, TAGS, tipFor } from '../modules/listening/core/text.js'
import { campusRequest } from './campus/SocialApi'
import type { Attempt, ListeningAnswer, Mistake, Practice, Report } from './contract'
import { todayKey } from './logic'
import { repository } from './repository'

type Row = Record<string, unknown>
type User = { userId: string; nickname: string }
const titles: Record<string,string> = {
  prac_lsn_s1: '二手家具电话咨询', prac_lsn_s2: '夏令营员工职责',
  prac_lsn_s3: '地外生命证据流程', prac_lsn_s4: '学习者坚持性研究',
}
const isRow = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.filter(isRow) : []
const text = (v: unknown, limit = 3600) => typeof v === 'string' ? v.slice(0, limit) : ''
const safeId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,148}$/.test(v)
const seconds = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
const sectionOk = (v: unknown): v is string => typeof v === 'string' && Object.hasOwn(titles,v)
const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : ''
const reportKey = (id: string) => 'rpt_li_' + id
export const listeningSources = Object.entries(titles).map(([exerciseId,title])=>({exerciseId,title:'Section '+exerciseId.slice(-1)+' · '+title}))

export function readListeningDraft(userId: string, practiceId: string) {
  try {
    const key = 'listening-v2:draft:' + encodeURIComponent(userId) + ':' + practiceId
    const draft = JSON.parse(localStorage.getItem(key) || 'null')
    if (!isRow(draft) || !isRow(draft.answers)) return null
    const answers = Object.fromEntries(Object.entries(draft.answers)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0))
    if (!Object.keys(answers).length) return null
    const startedAt = typeof draft.startedAt === 'number' && Number.isFinite(draft.startedAt) ? draft.startedAt : 0
    return { answers, startedAt }
  } catch {
    return null
  }
}

function promptOf(item: Row, practice?: Row) {
  const table = isRow(practice?.tables) ? practice.tables[text(item.table_id)] : undefined
  if (isRow(table) && Array.isArray(table.rows)) {
    for (const cells of table.rows) {
      if (!Array.isArray(cells)) continue
      const col = cells.findIndex(cell=>isRow(cell)&&cell.blank===item.blank)
      if (col<0) continue
      const blank=cells[col]
      const line = text(blank.label)||cells.filter(cell=>typeof cell==='string').join(' · ')
      return [text(table.caption),line].filter(Boolean).join('\n')
    }
  }
  return text(item.prompt)
}
export async function listeningPractice(user: User,id: string): Promise<Practice> {
  if (!sectionOk(id)) throw Error('找不到听力分段。')
  const data = await campusRequest<Row>(user,'/api/listening/practices/'+id)
  return {exerciseId:id,subject:'listening',mode:'section',title:'Section '+id.slice(-1)+' · '+titles[id],
    subtitle:text(data.subtitle),durationMin:Math.ceil(Number(rows(data.segments)[0]?.duration||0)/60),
    questionTypes:[text(data.type_label)], prompt:text(data.intro),questions:rows(data.items).map(item=>({
      id:text(item.id),type:text(data.type_label),text:'Q'+item.number+' · '+promptOf(item,data),
      options:rows(item.options??data.options).map(opt=>text(opt.key)+' · '+text(opt.text))
    }))}
}

export function listeningReviewPath(section: string, item?: string) {
  const q = new URLSearchParams({ section, view: item ? 'retry' : 'wrongbook' })
  if (item) q.set('item', item)
  return 'subject/listening?' + q
}

function parseItem(row: Row, index: number, practice: Row | undefined, section: string): ListeningAnswer | null {
  const { item_id: id, status } = row
  if (!safeId(id) || (status !== 'wrong' && status !== 'missed' && status !== 'correct')) return null
  const publicItem = rows(practice?.items).find(q => q.id === id)
  const evidence = isRow(row.evidence) ? row.evidence : {}
  const start = seconds(evidence.start)
  const end = seconds(evidence.end)
  const tag = text(row.error_tag)
  const reason = status === 'correct' ? '已答对' : status === 'missed' ? '漏答' : TAGS[tag] || '需确认错因'
  const type = text(row.question_type)
  const number = Number.isInteger(row.number) ? Number(row.number) : index + 1
  const options = rows(row.options ?? publicItem?.options ?? practice?.options)
    .map(opt => [text(opt.key, 10), text(opt.text,500)].filter(Boolean).join(' · ')).filter(Boolean)
  return {
    id, status, number, options, prompt: (publicItem && promptOf(publicItem,practice)) || text(row.retry_stem) || ('第 ' + number + ' 题'),
    answer: text(row.user_answer), accepted: Array.isArray(row.correct_answer) ? row.correct_answer.map(v=>String(v).slice(0,300)) : [],
    questionType: section === 'prac_lsn_s1' && type === 'table_completion' ? '笔记填空' : QUESTION_TYPE_LABELS[type] || '听力题',
    reason, explanation: text(row.explanation), suggestion: status === 'missed' ? '先读题圈出定位词，再回听对应片段，补全答案。' : tipFor(tag,{start}),
    quote: text(evidence.quote), start, end,
  }
}

export function recordListeningDaily(userId: string, timestamp: string, id: string, category: 'retake'|'newPractice') {
  const date = todayKey(new Date(timestamp))
  const daily = repository.getDaily(userId,date)
  if (daily[category].includes(id)) return false
  repository.saveDaily(userId,{...daily,[category]:[...daily[category],id]})
  return true
}

/** Keep server-graded answers as an immutable attempt snapshot. Audio stays on the listening server. */
export function saveListeningResult(userId: string, data: unknown, publicPractice?: unknown, historical = false): boolean {
  if (!isRow(data) || !sectionOk(data.practice_id) || !safeId(data.attempt_id) || !isRow(data.report)) return false
  const section = data.practice_id, id = data.attempt_id
  const reportId = reportKey(id), attemptId = 'atm_li_' + id
  const createdAt = iso(data.report.finished_at)
  if (!createdAt || data.skill !== 'listening') return false
  const practice = isRow(data.practice) ? data.practice : isRow(publicPractice) ? publicPractice : undefined
  const answers = rows(data.items).map((r,i)=>parseItem(r,i,practice,section))
  if (!answers.length || answers.some(item=>!item) || answers.length !== data.report.total) return false
  const items = answers as ListeningAnswer[]
  let changed = false
  if (!repository.getReport(userId,reportId) || !repository.getAttempt(userId,attemptId)) {
    const part = section.slice(-1)
    const title = 'Section ' + part + ' · ' + titles[section]
    const originalAnswers = Object.fromEntries(items.map(item=>[item.id,item.answer]))
    const correct = items.filter(item=>item.status==='correct').length
    const older = repository.listReports(userId).filter(r=>r.exerciseId===section && r.createdAt<createdAt)
      .sort((a,b)=>a.createdAt.localeCompare(b.createdAt))
    const previous = data.report.previous_attempt_id
    const retakeOf = safeId(previous) ? 'atm_li_'+previous : previous===null ? undefined : older.at(-1)?.attemptId
    const first = data.report.first_try_correct
    const firstTryCorrect = typeof first==='number' && Number.isInteger(first) && first>=0 && first<=items.length
      ? first : older[0]?.score.correct ?? correct
    const attempt: Attempt = { userId, attemptId, reportId, exerciseId:section, title, subject:'listening', mode:'section', retakeOf,
      status:'ready', createdAt, submittedAt:createdAt, progress:100, answers:originalAnswers }
    const report: Report = { userId, attemptId, reportId, exerciseId:section, subject:'listening', mode:'section', createdAt, status:'ready', retakeOf,
      original:{title, prompt:text(practice?.intro) || title, answers:originalAnswers},
      score:{ band:null, display:correct+' / '+items.length, correct, total:items.length, firstTryCorrect, trendMetric:'listening_correct' },
      dimensions:[], feedback:items.filter(item=>item.status !== 'correct').map(item=>({
        id:item.id, type:'audio', location:{label:'第 '+item.number+' 题',questionId:item.id,startSec:item.start??undefined,endSec:item.end??undefined},
        quote:item.quote,issue:item.reason,why:item.explanation,suggestion:item.suggestion,questionType:item.questionType,severity:'medium',
      })), highlights:[], recommendations:[],
      evidence:{listeningItems:items, submittedByUser:true, audioUrl:'/listening/audio/s'+part+'_official.mp3'},
    }
    repository.saveReport(report)
    repository.saveAttempt(attempt)
    changed = true
  }
  const saved = repository.getAttempt(userId,attemptId)!
  changed = recordListeningDaily(userId,createdAt,attemptId,saved.retakeOf?'retake':'newPractice') || changed
  if (!historical && changed && Array.isArray(data.wrongbook)) changed = saveListeningWrongbook(userId,data.wrongbook,section) || changed
  return changed
}

/** Synchronise authoritative per-section reviews, including customised reasons and section resets. */
export function saveListeningWrongbook(userId: string, value: unknown, section?: string): boolean {
  if (!Array.isArray(value)) return false
  const reports = repository.listReports(userId).filter(r=>r.subject==='listening' && r.evidence.listeningItems)
    .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  const prior = repository.listMistakes(userId).filter(m=>m.listeningItem)
  const active = new Set<string>()
  let changed = false
  for (const row of rows(value)) {
    if (!sectionOk(row.practice_id) || (section && row.practice_id !== section) || !safeId(row.item_id)) continue
    const id = 'mis_li_' + row.item_id
    active.add(id)
    const prev = prior.find(m=>m.mistakeId===id)
    const updated = iso(row.updated_at)
    if (!updated || (prev?.listeningUpdated && prev.listeningUpdated > updated)) continue
    const report = reports.find(r=>r.exerciseId === row.practice_id && r.evidence.listeningItems?.some(i=>i.id===row.item_id && i.status!=='correct'))
    const answer = report?.evidence.listeningItems?.find(i=>i.id===row.item_id)
    if (!report || !answer) continue
    const reason = TAGS[text(row.error_tag)] || answer.reason
    const mistake: Mistake = { mistakeId:id, reportId:report.reportId, attemptId:report.attemptId, userId, subject:'listening',
      listeningSection:report.exerciseId, listeningItem:answer.id, listeningUpdated:updated, createdAt:iso(row.created_at) || report.createdAt,
      reviewStatus:row.status==='mastered'?'reviewed':'pending', questionType:answer.questionType,
      locationLabel:'Section '+row.practice_id.slice(-1)+' · 第 '+answer.number+' 题',
      excerpt:answer.prompt, why:reason+' · '+answer.explanation, suggestion:tipFor(text(row.error_tag),{start:answer.start}),
    }
    if (JSON.stringify(mistake)!==JSON.stringify(prev)) {repository.saveMistake(mistake);changed=true}
    for (const [index,h] of rows(row.review_history).entries()) {
      const at = iso(h.at)
      if (at) changed = recordListeningDaily(userId,at,id+'_'+at+'_'+index,'retake') || changed
    }
  }
  if (sectionOk(section)) {
    for (const stale of prior.filter(m=>m.listeningSection===section && !active.has(m.mistakeId))) {
      repository.saveMistake({...stale, archived:true}); changed = true
    }
  }
  return changed
}

/** Recover submissions that finished while the workspace was closing. */
export async function syncListeningHistory(user: User, isCurrent: ()=>boolean = ()=>true) {
  const {items} = await campusRequest<{items:Row[]}>(user,'/api/listening/attempts')
  let changed = false
  const ordered = [...items].sort((a,b)=>text(a.finished_at).localeCompare(text(b.finished_at)))
  for (const item of ordered) {
    if (!isCurrent()) return changed
    const id = item.attempt_id
    if (!safeId(id) || repository.getReport(user.userId,reportKey(id)) && repository.getAttempt(user.userId,'atm_li_'+id)) continue
    const data = await campusRequest(user,'/api/listening/attempts/'+encodeURIComponent(id))
    if (!isCurrent()) return changed
    changed = saveListeningResult(user.userId,data,undefined,true) || changed
  }
  if (!ordered.length) return changed
  const wb = await campusRequest<{items:Row[]}>(user,'/api/listening/wrongbook')
  if (isCurrent()) for (const section of Object.keys(titles)) {
    changed = saveListeningWrongbook(user.userId,wb.items.filter(r=>r.practice_id===section),section) || changed
  }
  return changed
}
