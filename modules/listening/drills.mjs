import drills from './data/drills.json' with {type:'json'};
import {fail} from '../campus-social/identity.mjs';

const normalize = text => text.trim().toLowerCase().replace(/[.!?]+$/,'').replace(/\s+/g,' ');

export async function typeDrill(db, owner, id, method, body) {
  if (!id && method === 'GET') {
    const {results} = await db.prepare('SELECT drill, correct, total FROM listening_type_results WHERE owner=?').bind(owner).all();
    return {items:results};
  }
  const drill = drills.find(d => d.id === id);
  if (!drill) fail('找不到这项题型练习。',404);
  const total = drill.options ? drill.correct.length : 1;
  const read = () => db.prepare('SELECT revision, answer, correct, total FROM listening_type_results WHERE owner=? AND drill=?').bind(owner,id).first();
  function feedback(row) {
    return row && {revision:row.revision, answer:JSON.parse(row.answer), correct:row.correct, total:row.total,
      accepted:drill.correct, script:drill.script, reason:drill.reason};
  }
  if (method === 'GET') {
    const {title,prompt,context,options,visual} = drill;
    return {id,title,prompt,context,options,visual,total,result:feedback(await read())};
  }
  if (method !== 'POST') fail('不支持该操作。',405);
  if (!Number.isSafeInteger(body.revision) || body.revision < 0 || !Array.isArray(body.answer) || body.answer.length !== total ||
    body.answer.some(a => typeof a !== 'string' || !a.trim() || a.length > 140)) fail('请按题目要求完成作答。');
  const answer = body.answer.map(a => a.trim());
  if (drill.options) {
    if (new Set(answer).size !== total || answer.some(a => !/^[A-Z]$/.test(a) || a.charCodeAt(0)-65 >= drill.options.length)) fail('请选择有效选项。');
    answer.sort();
  }
  const correct = drill.options ? answer.filter(a => drill.correct.includes(a)).length :
    Number(drill.correct.some(a => normalize(a) === normalize(answer[0])));
  const json = JSON.stringify(answer);
  if (body.revision === 0) {
    await db.prepare('INSERT OR IGNORE INTO listening_type_results(owner,drill,revision,answer,correct,total) VALUES(?,?,1,?,?,?)')
      .bind(owner,id,json,correct,total).run();
  } else {
    await db.prepare('UPDATE listening_type_results SET revision=revision+1, answer=?, correct=?, total=? WHERE owner=? AND drill=? AND revision=?')
      .bind(json,correct,total,owner,id,body.revision).run();
  }
  const row = await read();
  if (row?.revision !== body.revision+1 || row.answer !== json) fail('这道题已在其他页面更新，请刷新后查看。',409);
  return feedback(row);
}
