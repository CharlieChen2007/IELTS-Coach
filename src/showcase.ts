// Demo work uses a separate owner and its own campus cookie, including on a cloud login.
import { campusRequest } from './campus/SocialApi'
import type { Attempt, Report, UserProfile } from './contract'
import { bucketOf, saveBucket } from './localStore'
import { todayKey } from './logic'
import { findPractice, SAMPLE_REPORTS } from './seed'
import { syncListeningHistory } from './listeningIntegration'

export const isShowcaseUser = (id: string) => id.startsWith('showcase_')
export const showcaseId = (owner: string) => 'showcase_' + owner

/** These five synthesized clips match the built-in answer transcripts verbatim. */
export function showcaseClip(report: Report, entry: string) {
  if (!isShowcaseUser(report.userId) || !report.evidence.showcaseRecord || !['0','1'].includes(entry)) return null
  const key = report.reportId.replace(/^rpt_show_/, '')
  if (!['mock1','mock2','chat1'].includes(key) || (key==='chat1' && entry!=='0')) return null
  return '/showcase-speaking/'+key+'-'+entry+'.wav'
}

const examples = [
  { id:'mock1', exercise:'exr_sp_mock_01', days:13, title:'完整模考 · 学一项技能' },
  { id:'read1', exercise:'exr_re_pass_01', days:10, title:'阅读精练 · 城市绿地与注意力' },
  { id:'write1', exercise:'exr_wr_task2_01', days:7, title:'Task 2 · 大学学费应由谁承担' },
  { id:'read2', exercise:'exr_re_retake_01', days:5, title:'判断题复练 · 区分否定和未提及', parent:'read1' },
  { id:'chat1', exercise:'exr_sp_free_01', days:3, title:'自由对话 · 晚间阅读' },
  { id:'write2', exercise:'exr_wr_retake_01', days:2, title:'二稿改写 · 给出有条件的立场', parent:'write1' },
  { id:'mock2', exercise:'exr_sp_mock_01', days:0, title:'完整模考 · 校园里的安静角落' },
]

function campusSpeakingReport(report: Report) {
  const question = 'Describe a place on campus where you like to spend time.'
  const reply = 'I often read in a window seat on the third floor of the library. Last Friday I finished a chapter there before my next class.'
  const followUp = 'Could universities make it easier for students to find places like this?'
  const finalReply = 'I think so. More places would make campus life better.'
  report.original.prompt = question
  report.score = {...report.score, band:6.5, display:'6.5'}
  report.dimensions = [
    {key:'FC',label:'流利度与连贯性',score:7,comment:'能按地点、时间、事件的顺序展开。'},
    {key:'LR',label:'词汇',score:6,comment:'描述自习空间具体，延伸讨论里的用词还比较笼统。'},
    {key:'GRA',label:'语法范围与准确性',score:7,comment:'一般过去时和时间状语准确。'},
    {key:'P',label:'发音',score:6,comment:'示例答卷中的句子重音有待加强。'},
  ]
  report.evidence.turns = [{role:'examiner',text:question},{role:'candidate',text:reply},
    {role:'examiner',text:followUp},{role:'candidate',text:finalReply}]
  report.feedback = [{id:'discussion',type:'utterance',location:{label:'Part 3 · 校园公共空间'},quote:finalReply,
    issue:'理由停在 better，没有说明谁会受益。',why:'指出适用场景和具体人群，观点会更容易理解。',
    suggestion:'举一个通勤学生在课间短暂自习的例子。',revised:'Quiet corners near lecture halls would give commuting students somewhere to prepare between classes.',
    severity:'medium',questionType:'论点展开'}]
  report.highlights = ['用楼层、座位和上周五的经历支撑了地点描述。']
}

function prepareLearningData(profile: UserProfile) {
  const userId = profile.userId
  const bucket = bucketOf(userId)
  if (bucket.profile) return
  bucket.profile = profile
  const now = Date.now()
  for (const sample of examples) {
    const practice = findPractice(sample.exercise)!
    const report = structuredClone(SAMPLE_REPORTS[sample.exercise])
    const date = new Date(now - sample.days * 86400000)
    const createdAt = date.toISOString()
    const attemptId = 'atm_show_' + sample.id
    const reportId = 'rpt_show_' + sample.id
    report.userId = userId
    report.attemptId = attemptId
    report.reportId = reportId
    report.createdAt = createdAt
    report.original.title = sample.title
    report.evidence.showcaseRecord = true
    report.evidence.submittedByUser = true
    if (sample.id === 'mock2') campusSpeakingReport(report)
    if (report.subject === 'reading') {
      const guesses: Record<string,string> = {q_re_4:'TRUE',q_re_2:'FALSE',q_re_5:'A',q_rt_3:'TRUE'}
      report.original.answers = Object.fromEntries(practice.questions.map(q=>[q.id,guesses[q.id] ?? q.answer ?? '']))
      const correct = practice.questions.filter(q=>report.original.answers[q.id]===q.answer).length
      report.score = {...report.score, correct, total:practice.questions.length, firstTryCorrect:correct, display:correct+' / '+practice.questions.length}
    }
    if (report.subject === 'speaking') {
      const turns = report.evidence.turns || []
      report.original.answers = Object.fromEntries(turns.filter(t=>t.role==='candidate').map((t,i)=>['回答 '+(i+1),t.text]))
    }
    if (sample.parent) report.retakeOf = 'atm_show_'+sample.parent
    const attempt: Attempt = {attemptId,reportId,userId,exerciseId:sample.exercise,subject:report.subject,mode:report.mode,
      title:sample.title,status:'ready',createdAt,submittedAt:createdAt,progress:100,answers:report.original.answers,
      draftText:report.original.submittedText,retakeOf:report.retakeOf}
    bucket.attempts.push(attempt)
    bucket.reports.push(report)
    const day = todayKey(date)
    const daily = bucket.daily[day] ??= {date:day,newPractice:[],retake:[]}
    daily[sample.parent ? 'retake' : 'newPractice'].push(attemptId)
    if (report.subject === 'reading') {
      for (const item of report.feedback) bucket.mistakes.push({mistakeId:'mis_show_'+sample.id+'_'+item.id,
        reportId,attemptId,userId,subject:report.subject,questionType:item.questionType,reviewStatus:'pending',
        createdAt,excerpt:item.quote,why:item.why,suggestion:item.suggestion,locationLabel:item.location.label})
    }
  }
  saveBucket(userId,bucket)
}

export async function prepareShowcase(ownerProfile: UserProfile) {
  const profile = {...ownerProfile,userId:showcaseId(ownerProfile.userId)}
  prepareLearningData(profile)
  await Promise.all([
    campusRequest(profile, '/api/listening/showcase', {}),
    campusRequest(profile, '/api/social/me?targetBand='+encodeURIComponent(profile.targetBand)),
  ])
  await syncListeningHistory(profile)
}
