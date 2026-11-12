const day = 86400000
const subjects = ['listening','speaking','reading','writing']

function teamId(owner) {
  const hash = owner.slice(-32)
  return [hash.slice(0,8),hash.slice(8,12),'5'+hash.slice(13,16),'a'+hash.slice(17,20),hash.slice(20)].join('-')
}

export function hasStudyWeek(db,owner,week) {
  return db.prepare('SELECT 1 FROM campus_team_completions WHERE user_id=? AND skill=? AND completion_id=? AND team_id=?')
    .bind(owner+'_demo_01','speaking','study-demo:'+week,teamId(owner)).first()
}

export function seedStudyWeek(statement,owner,nickname,week,now,team,targetBand) {
  const teamKey=teamId(owner), enrolled=week-day
  const weekKey=new Date(week+8*3600000).toISOString().slice(0,10)
  const date=new Date(now+8*3600000)
  const examMonth=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)).toISOString().slice(0,7)
  const firstPeer=owner+'_demo_01'
  statement('INSERT OR IGNORE INTO campus_teams(id,name,exam_month,target,slots,created_at,space) VALUES(?,?,?,?,?,?,?)',
    teamKey,'汇星周四备考组',examMonth,targetBand,'["周四晚间","周六下午"]',enrolled,owner)
  // Earlier demos could have joined a public team. Only detach the old demo persona.
  statement("DELETE FROM campus_team_members WHERE user_id=? AND team_id IN (SELECT id FROM campus_teams WHERE space='')",owner)
  for(const [seat,name] of team.names.entries()){
    const member=seat===0?owner:owner+'_demo_0'+seat
    if(seat===0){
      // A permanent example peer marks initial enrollment. A later visit never undoes leaving.
      statement('INSERT OR IGNORE INTO campus_team_members(user_id,team_id,nickname,joined_at) SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM campus_team_members WHERE user_id=?)',
        member,teamKey,nickname,enrolled,firstPeer)
    }else{
      statement('INSERT OR IGNORE INTO campus_team_members(user_id,team_id,nickname,joined_at) VALUES(?,?,?,?)',member,teamKey,name,enrolled)
    }
    for(const [i,subject] of subjects.entries()){
      if(!(team.marks[seat] & (1<<i)))continue
      // Match social_practice_group_progress IDs so the points trigger and the sample count once.
      const completion=subject==='speaking'?'study-demo:'+week:'social:showcase-week-'+week+'-'+i
      statement(`INSERT INTO campus_team_completions(user_id,skill,completion_id,team_id,week,completed_at)
        SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM campus_team_members WHERE user_id=? AND team_id=?)
        ON CONFLICT(user_id,skill,completion_id) DO UPDATE SET team_id=excluded.team_id
        WHERE campus_team_completions.team_id IS NULL`,member,subject,completion,teamKey,weekKey,week,member,teamKey)
    }
  }
}

