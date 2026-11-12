import { useState } from 'react'
import { Card, CardHead, Empty } from '../components'
import {useCampusResource, ResourceStatus, type ExamState, type ArchiveField} from '../campus/GrowthApi'
import '../campus/growth.css'

type Props = {camp:ExamState; busy:boolean; change:(body:Record<string,unknown>,message?:string)=>Promise<boolean>}

const I = {
  lamp: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20h6M10 17h4l-.6-3h-2.8z" /><path d="M12 14V9.6a3.2 3.2 0 0 1 3.2-3.2h2.4" /><circle cx="19" cy="6.4" r="1.6" fill="currentColor" stroke="none" /></svg>,
  book: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.2h6.4A2.6 2.6 0 0 1 13 7.8v12a2 2 0 0 0-2-2H4z" /><path d="M20 5.2h-6.4A2.6 2.6 0 0 0 11 7.8v12a2 2 0 0 1 2-2h7z" /></svg>,
  pin: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>,
  pen: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4l10-10a2.4 2.4 0 0 0-3.4-3.4L4.6 16.6z" /></svg>,
}

const EXAM_ROWS: { key: ArchiveField; label: string; icon: React.ReactNode; placeholder: string }[] = [
  { key: 'building', label: '几号楼', icon: I.pin, placeholder: '例如：本部 3 号楼 2 层 205 机房' },
  { key: 'headset', label: '耳机', icon: I.lamp, placeholder: '头戴式 / 公用耳塞 / 可自带' },
  { key: 'examiner', label: '口语考官风格', icon: I.book, placeholder: '语速、是否打断、追问习惯' },
  { key: 'waitingRoom', label: '候考区能不能带资料', icon: I.pen, placeholder: '能否带纸质资料、手机怎么处理' },
  { key: 'printShop', label: '附近哪家打印店靠谱', icon: I.pin, placeholder: '店名、位置、价格、开门时间' },
]

// ---------------------------------------------------------------------------
// 本校考场档案
// ---------------------------------------------------------------------------
function ExamArchiveCard({camp,busy,change}:Props){
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState<Partial<Record<ArchiveField,string>>>({})
  const [before,setBefore]=useState(camp.exam)
  const edits=Object.fromEntries(Object.entries(draft).filter(([key,value])=>value.trim()&&value.trim()!==before[key as ArchiveField]))
  async function save(){
    if(await change({action:'archive',fields:edits,before},'考场资料已更新')){
      setEditing(false)
      setDraft({})
    }
  }
  return (
    <Card>
      <CardHead
        title="本校考场档案"
        hint={camp.exam.updatedAt
          ? `${camp.exam.contributors} 位同校同学补过 · ${camp.exam.updatedAt.slice(5, 10)} 更新`
          : '等待同校考生补充'}
        extra={
          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => { setBefore(camp.exam); setEditing((v) => !v); setDraft({}) }}>
            {editing ? '取消' : '补充 / 纠错'}
          </button>
        }
      />
      <div className="exam-list">
        {EXAM_ROWS.map((row) => (
          <div key={String(row.key)} className="exam-row">
            <span className="exam-ico" aria-hidden="true">{row.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="exam-label">{row.label}</div>
              {editing ? (
                <input
                  className="input"
                  aria-label={row.label} placeholder={row.placeholder} maxLength={300} disabled={busy}
                  value={draft[row.key] ?? before[row.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                />
              ) : (
                <div className={`exam-value ${(camp.exam[row.key] as string) ? '' : 'empty'}`}>
                  {(camp.exam[row.key] as string) || `还没有人补充「${row.label}」，点右上角补充`}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <div className="row mt12">
          <button className="btn btn-primary" type="button" onClick={save} disabled={busy||!Object.keys(edits).length}>保存档案</button>
          <span className="small muted">只填你想补的那几项也可以</span>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 学长学姐经验条
// ---------------------------------------------------------------------------
function StoryListCard({camp,busy,change}:Props){
  const [open,setOpen]=useState(false)
  const [draft,setDraft]=useState({band:'',headline:'',body:'',days:''})
  const valid=Number(draft.band)>=1 && Number(draft.band)<=9 && Number.isInteger(Number(draft.band)*2)
    && Number.isInteger(Number(draft.days)) && Number(draft.days)>=0 && Number(draft.days)<=3650
    && !!draft.headline.trim() && !!draft.body.trim()
  async function submit(){
    if(await change({action:'story',...draft,band:Number(draft.band),days:Number(draft.days)},'你的备考经验已发布')){
      setOpen(false)
      setDraft({band:'',headline:'',body:'',days:''})
    }
  }
  return (
    <Card>
      <CardHead
        title="学长学姐经验条"
        hint="分享得分、备考时间和具体练法。"
        extra={<button className="btn btn-sm btn-primary" type="button" disabled={busy} onClick={() => setOpen((v) => !v)}>{open?'收起表单':'分享备考经验'}</button>}
      />
      {open && (
        <div className="story-form">
          <div className="camp-form">
            <label className="camp-field"><span>最终分数</span><input className="input" type="number" min="1" max="9" step=".5" value={draft.band} onChange={(e) => setDraft({ ...draft, band: e.target.value })} placeholder="例如：7.0" /></label>
            <label className="camp-field"><span>备考天数</span><input className="input" type="number" min="0" max="3650" step="1" value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value })} placeholder="例如：42" inputMode="numeric" /></label>
          </div>
          <label className="camp-field"><span>一句话结论</span><input className="input" maxLength={90} value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} placeholder="例如：只做真题，但每篇都复盘到能背出同义替换" /></label>
          <label className="camp-field"><span>具体怎么做的</span><textarea className="textarea" maxLength={2000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="写清楚你实际做了什么、花了多久、哪一步最有效" /></label>
          <div className="row">
            <button className="btn btn-primary" type="button" onClick={submit} disabled={busy||!valid}>发布经验</button>
            <button className="btn btn-quiet" type="button" disabled={busy} onClick={() => setOpen(false)}>取消</button>
          </div>
        </div>
      )}
      {camp.stories.length === 0
        ? <Empty icon="○" title="还没有经验条" hint="成为第一个挂上去的人。" />
        : (
          <div className="story-list">
            {camp.stories.map((story) => (
              <article key={story.storyId} className="story-card">
                <div className="story-head">
                  <span className="story-band">{story.band}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b className="story-headline">{story.headline}</b>
                    <div className="small muted">{story.nickname}{story.days > 0 ? ` · 备考 ${story.days} 天` : ''}</div>
                  </div>
                  <button
                    className={`story-like ${story.liked ? 'on' : ''}`}
                    type="button"
                    disabled={busy} aria-pressed={!!story.liked} onClick={() => change({action:'like',id:story.storyId,liked:!story.liked})}
                    aria-label={(story.liked?'取消有用':'标记有用')+'，'+story.headline}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M7 21V9.6l4.4-6.2a2 2 0 0 1 3.5 1.7L14 9h4.6A2.4 2.4 0 0 1 21 11.9l-1.5 6.7A2.4 2.4 0 0 1 17.1 21z" /></svg>
                    {story.likes}
                  </button>
                </div>
                <p className="story-body">{story.body}</p>
              </article>
            ))}
          </div>
        )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 考试经验页（#/campus/exam）
// ---------------------------------------------------------------------------
export function CampusExamPage(){
  const {data:camp,busy,change,error,reload}=useCampusResource<ExamState>('exam')
  if(!camp)return <ResourceStatus error={error} reload={reload}/>
  return (
    <div className="camp-page growth-surface">
      <div className="camp-head">
        <div>
          <h1>考试经验</h1>
          <p>{camp.demo?'以下考场资料和初始经验用于演示。':'查看同学补充的考场资料和备考方法，考点安排以准考证为准。'}</p>
        </div>
        <div className="camp-head-stats">
          <div><b>{camp.exam.contributors}</b><span>档案贡献者</span></div>
          <div><b>{camp.stories.length}</b><span>经验条</span></div>
        </div>
      </div>

      <div className="mt16">
        <ExamArchiveCard camp={camp} busy={busy} change={change} />
      </div>
      <div className="mt16">
        <StoryListCard camp={camp} busy={busy} change={change} />
      </div>
    </div>
  )
}
