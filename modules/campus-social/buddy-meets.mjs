import {fail} from './identity.mjs'

const tasks = new Set(['s1','s2','free','quick','passage','judgement','essay','rewrite','reading-p1','reading-p2','writing-transport'])
async function completedPractice(db,member,row) {
  const reading=row.task.startsWith('reading-'),writing=row.task==='writing-transport';
  if(!reading&&!writing)return null;
  const table=reading?'reading_attempts':'writing_submissions';
  if(!await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").bind(table).first())return false;
  const condition=reading
    ? "passage=? AND COALESCE(json_extract(payload,'$.isExample'),0)=0"
    : "json_extract(payload,'$.topicId')=? AND json_extract(payload,'$.status')='done' AND COALESCE(json_extract(payload,'$.isExample'),0)=0";
  return !!await db.prepare('SELECT 1 FROM '+table+' WHERE owner_id=? AND created_at>=? AND '+condition+' LIMIT 1')
    .bind(member,row.created,reading?row.task.slice(8):'transport').first();
}
export async function buddyMeet(db, me, other, input) {
  if(typeof other!=='string'||!other||other.length>100||other===me.id) fail('请选择一位已接受邀请的搭子。')
  const [a,b]=[me.id,other].sort()
  const accepted=await db.prepare(`SELECT 1 FROM social_invites i JOIN social_members m ON m.id=? 
    WHERE i.a=? AND i.b=? AND i.status='accepted' AND m.school=?`).bind(other,a,b,me.school).first()
  if(!accepted) fail('双方成为搭子后即可约练。',403)
  const latest=()=>db.prepare('SELECT * FROM social_buddy_meets WHERE a=? AND b=? ORDER BY created DESC,rowid DESC LIMIT 1').bind(a,b).first()
  if(input){
    const {id,action}=input
    if(typeof id!=='string'||!/^[a-f\d-]{36}$/.test(id)) fail('约练标识无效。')
    if(action==='propose'){
      const existing=await db.prepare('SELECT task,start,proposer FROM social_buddy_meets WHERE id=? AND a=? AND b=?').bind(id,a,b).first()
      if(existing){
        if(existing.proposer!==me.id||existing.task!==input.task||existing.start!==input.start) fail('约练内容已变化。',409)
      }else{
        const now=Date.now()
        if(!tasks.has(input.task)||!Number.isSafeInteger(input.start)||input.start<now-120000||input.start>now+90*86400000) fail('请选择练习和未来 90 天内的时间。')
        const added=await db.prepare(`INSERT OR IGNORE INTO social_buddy_meets(id,a,b,proposer,task,start,created,state)
          VALUES(?,?,?,?,?,?,?,'pending')`).bind(id,a,b,me.id,input.task,input.start,now).run()
        if(!added.meta.changes) fail('你们已有一场进行中的约练，请查看最新状态。',409)
      }
    }else{
      const side=me.id===a?'note_a':'note_b',peer=me.id===a?'note_b':'note_a'
      let update
      if(action==='confirm')update=db.prepare("UPDATE social_buddy_meets SET state='confirmed' WHERE id=? AND a=? AND b=? AND state='pending' AND proposer<>?").bind(id,a,b,me.id)
      else if(action==='cancel')update=db.prepare("UPDATE social_buddy_meets SET state='cancelled' WHERE id=? AND a=? AND b=? AND state IN ('confirmed','pending')").bind(id,a,b)
      else if(action==='reflect'){
        const note=typeof input.note==='string'?input.note.trim():''
        if(!note||note.length>500)fail('请写下 1 至 500 字的练后心得。')
        const meeting=await latest();
        if(meeting?.id===id&&await completedPractice(db,me.id,meeting)===false)fail('请先完成约定的篇章或作文并交卷，再分享心得。',409);
        update=db.prepare(`UPDATE social_buddy_meets SET ${side}=?,state=CASE WHEN ${peer}<>'' THEN 'done' ELSE 'confirmed' END
          WHERE id=? AND a=? AND b=? AND state='confirmed' AND ${side}=''`).bind(note,id,a,b)
      }else fail('未知约练操作。')
      const changed=await update.run()
      if(!changed.meta.changes){
        const current=await latest()
        const same=current?.id===id&&((action==='confirm'&&current.proposer!==me.id&&current.state==='confirmed')||
          (action==='cancel'&&current.state==='cancelled')||(action==='reflect'&&current[side]===input.note?.trim()))
        if(!same)fail('约练状态已更新，请核对后继续。',409)
      }
    }
  }
  const row=await latest()
  return {meet:row ? {id:row.id,task:row.task,start:row.start,state:row.state,mine:row.proposer===me.id,
    myNote:row[me.id===a?'note_a':'note_b'],peerNote:row[me.id===a?'note_b':'note_a'],created:row.created,practiceDone:await completedPractice(db,me.id,row)} : null}
}
