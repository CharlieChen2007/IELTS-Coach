import { useState } from 'react'
import { useApp } from '../appContext'
import { useAuth } from '../auth'
import { Card, CardHead } from '../components'
import { SUBJECT_META, type Report, type Subject } from '../contract'
import { repository } from '../repository'
import { formatDateTime } from '../logic'

const policy = 'https://jwb.szu.edu.cn/info/1356/2001.htm'
const training: Record<Subject,{action:string; path:string; next:string}> = {
  listening:{ action:'去听力精练', path:'subject/listening', next:'听同一段材料，写下定位词后再作答。' },
  speaking:{ action:'去口语对话', path:'subject/speaking?view=practice', next:'用一段完整回答解释观点，回听并对照发音反馈。' },
  reading:{ action:'去阅读定位', path:'subject/reading', next:'先找到支持答案的原文，再判断题干是否成立。' },
  writing:{ action:'去写作修改', path:'subject/writing', next:'用一个例子支撑论点，修改后对照前后两稿。' },
}

function hasSubmission(report: Report) {
  if (report.evidence.demoRecord) return false
  return !!report.evidence.speakingView || !!report.original.submittedText?.trim() && report.evidence.submittedByUser === true ||
    Object.values(report.original.answers).some(value => value.trim())
}

export function CampusGoal() {
  const { user } = useAuth()
  const { go } = useApp()
  const uid = user!.userId
  const profile = repository.getProfile(uid)
  const [entered,setEntered] = useState(profile?.officialIeltsBand?.toString() ?? '')
  const [saved,setSaved] = useState<number | undefined>(profile?.officialIeltsBand)
  const [note,setNote] = useState('')
  const all = repository.listReports(uid).filter(hasSubmission).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  function recordScore() {
    const value = Number(entered)
    if (entered && (!Number.isFinite(value) || value < 1 || value > 9 || !Number.isInteger(value*2))) {
      setNote('请输入 1 至 9 之间的整数或半分。');return
    }
    if (!profile) {setNote('个人资料仍在加载，请稍后重试。');return}
    repository.saveProfile({...repository.getProfile(uid)!, officialIeltsBand:entered ? value : undefined})
    setSaved(entered ? value : undefined);setNote(entered ? '已保存自填成绩。' : '已清除自填成绩。')
  }
  return <>
    <Card><CardHead title="大学英语课程成绩转换" hint="深圳大学 · 全日制在校普高本科生" />
      <p>使用有效期内的雅思学术类成绩申请转换，起点为总分 <strong>6.5</strong>。达到 6.5、7.0、7.5 及以上对应的课程等级分别为 B+、A、A+。</p>
      <p>适用范围为培养方案中符合条件、尚未取得学分的大学英语课程。每学期教学第 2 周和教学最后一周受理，在校期间限一次。申请资格由教务部审核。</p>
      <a href={policy} target="_blank" rel="noreferrer">查看深圳大学教务部《普高本科生托福雅思成绩转换认定办法》第 2–5、8 条 ↗</a>
      <form className="szu-inline mt16" onSubmit={e=>{e.preventDefault();recordScore()}}>
        <label htmlFor="szu-official">我的有效雅思学术类总分（选填）</label>
        <input id="szu-official" style={{width:'7em'}} className="input" type="number" min="1" max="9" step="0.5" value={entered} onChange={e=>setEntered(e.target.value)} />
        <button className="btn btn-sm">保存</button></form>
      <p className="small muted" aria-live="polite">{note} {saved === undefined ? '尚未登记正式成绩。' : saved < 6.5 ? '按自填成绩，距 6.5 还差 ' + (6.5-saved).toFixed(1) + ' 分。' : '自填成绩已达到总分门槛。请按办法核对课程条件与申请时间。'}</p>
    </Card>
    <Card><CardHead title="我的四科练习证据" hint="根据实际提交安排下一次练习。正式成绩以考试成绩单为准。" />
      <div className="szu-evidence">{(Object.keys(training) as Subject[]).map(subject=>{
        const rows=all.filter(r=>r.subject===subject), latest=rows[0], plan=training[subject]
        const mistake=latest?.feedback.find(f=>f.severity !== 'low')
        const next=latest?.evidence.submittedByUser && subject!=='writing' && mistake ? mistake.suggestion : plan.next
        return <article key={subject}><h3>{SUBJECT_META[subject].label}</h3><p className="small muted">
          {latest ? '已提交 '+rows.length+' 次 · 最近一次 '+formatDateTime(latest.createdAt) : '尚无作答，先完成一次练习。'}</p>
          {latest && <button className="btn btn-sm" onClick={()=>go('report/'+latest.reportId)}>{latest.original.title} ↗</button>}
          <p>{next}</p><button className="btn btn-soft" onClick={()=>go(plan.path)}>{plan.action} →</button>
        </article>
      })}</div>
    </Card>
  </>
}
