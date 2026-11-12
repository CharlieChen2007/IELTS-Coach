import {fail, skills, publicMember} from './identity.mjs'
import {readWritingProfile} from '../writing-engine/api.mjs'

const slotPattern = /^周[一二三四五六日](上午|下午|晚间)$/
const text = (value, max) => typeof value === 'string' && value.length <= max ? value.trim() : ''
const postOf = row => ({
  subject: row.subject, message: row.message, slot: row.free_slot, target: row.target_band,
  gift: row.gift, summary: row.report_summary,
  subjects: row.subjects ? JSON.parse(row.subjects) : [row.subject],
})

export async function readPlaza(db, id, school) {
  const [posts, me, invitations] = await Promise.all([
    db.prepare(`SELECT m.*,p.subject,p.message,p.free_slot,p.target target_band,p.gift,p.report_summary,q.answers,x.subjects
      FROM social_members m LEFT JOIN social_buddy_posts p ON p.member=m.id
      LEFT JOIN social_buddy_post_preferences x ON x.member=p.member
      LEFT JOIN social_buddy_portraits q ON q.member=m.id WHERE m.school=? AND m.id<>? AND (p.member IS NOT NULL OR q.member IS NOT NULL)
      ORDER BY COALESCE(p.updated,q.updated) DESC,m.id`).bind(school,id).all(),
    db.prepare(`SELECT m.*,p.subject,p.message,p.free_slot,p.target target_band,p.gift,p.report_summary,q.answers,x.subjects FROM social_members m
      LEFT JOIN social_buddy_posts p ON m.id=p.member LEFT JOIN social_buddy_post_preferences x ON x.member=p.member
      LEFT JOIN social_buddy_portraits q ON m.id=q.member WHERE m.id=? AND m.school=?`).bind(id,school).first(),
    db.prepare(`SELECT i.*,m.id other,m.nickname name,meet.id meetId,meet.state meetState,meet.proposer FROM social_invites i LEFT JOIN social_buddy_meets meet ON meet.a=i.a AND meet.b=i.b AND meet.state IN ('pending','confirmed')
      JOIN social_members m ON m.id=CASE WHEN i.a=? THEN i.b ELSE i.a END
      WHERE (i.a=? OR i.b=?) AND m.school=? ORDER BY i.created DESC`).bind(id,id,id,school).all(),
  ])
  const writing=new Map()
  await Promise.all([me,...posts.results.filter(row=>row.subject==='writing'||row.subjects&&JSON.parse(row.subjects).includes('writing'))].filter(Boolean).map(async row=>{
    const {hostAggregate:a}=await readWritingProfile({DB:db},row.id)
    writing.set(row.id,{band:a.writingBand,status:a.status,task1:a.sampleCounts.task1,task2:a.sampleCounts.task2,source:a.algorithmVersion})
  }))
  const profileOf=row=>row?{...publicMember(row),...(writing.has(row.id)?{writingAssessment:writing.get(row.id)}:{})}:null
  return {
    profile: profileOf(me), mine: me?.subject ? postOf(me) : null,
    portrait: me?.answers ? JSON.parse(me.answers) : null,
    cards: posts.results.filter(row=>row.subject).map(row => ({profile: profileOf(row), post: postOf(row), portrait: row.answers ? JSON.parse(row.answers) : null})),
    suggestions: posts.results.filter(row=>!row.subject && row.answers).map(row=>({profile:profileOf(row),portrait:JSON.parse(row.answers)})),
    invites: invitations.results.map(row => ({other: row.other, name: row.name, incoming: row.sender !== id, status: row.status, meetState:row.meetState, meetIncoming:row.meetState==='pending' && row.proposer!==id})),
  }
}

export async function changePlaza(db, id, input, school) {
  if (input.action === 'portrait') {
    const answers = input.answers, nickname = text(input.nickname,24)
    if (!nickname || !Array.isArray(answers) || answers.length !== 6 ||
        !answers.every(value=>Number.isInteger(value) && value>=0 && value<4)) fail('请完成六道画像题。')
    const now=Date.now()
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO social_members(id,school,nickname,level,target,strong,need,slots,verified_at)
        VALUES(?,?,?,0,0,'[]','[]','[]',?)`).bind(id,school,nickname,now),
      db.prepare(`INSERT INTO social_buddy_portraits(member,answers,updated) VALUES(?,?,?) ON CONFLICT(member)
        DO UPDATE SET answers=excluded.answers,updated=excluded.updated`).bind(id,JSON.stringify(answers),now),
    ])
    return {ok:true}
  }
  if (input.action === 'withdraw') {
    await db.prepare('DELETE FROM social_buddy_posts WHERE member=?').bind(id).run()
    return {ok:true}
  }
  const message = text(input.message,160), slot = text(input.slot,10), gift = text(input.gift,12)
  const target = input.target, summary = text(input.summary,150), nickname = text(input.nickname,24)
  const subjects = input.subjects ?? [input.subject]
  if (input.action !== 'publish' || !skills.includes(input.subject) || message.length < 4 || !(slotPattern.test(slot)||slot==='时间灵活') ||
      !Array.isArray(subjects) || subjects.length>4 || !subjects.includes(input.subject) || !subjects.every(value=>skills.includes(value)) ||
      !Number.isInteger(target*2) || typeof target !== 'number' || (target!==0 && target<1) || target>9 ||
      (gift && !skills.includes(gift)) || !nickname || (input.summary && !summary)) fail('请填写练习需求、科目、目标分和一个可约时段。')
  const now = Date.now()
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO social_members(id,school,nickname,level,target,strong,need,slots,verified_at)
      VALUES(?,?,?,0,?,'[]','[]','[]',?)`).bind(id,school,nickname,target,now),
    db.prepare(`INSERT INTO social_buddy_posts(member,subject,message,free_slot,target,gift,report_summary,updated)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(member) DO UPDATE SET subject=excluded.subject,message=excluded.message,
      free_slot=excluded.free_slot,target=excluded.target,gift=excluded.gift,report_summary=excluded.report_summary,updated=excluded.updated`)
      .bind(id,input.subject,message,slot,target,gift,summary,now),
    db.prepare(`INSERT INTO social_buddy_post_preferences(member,subjects) VALUES(?,?)
      ON CONFLICT(member) DO UPDATE SET subjects=excluded.subjects`).bind(id,JSON.stringify([...new Set(subjects)])),
  ])
  return {ok:true}
}
