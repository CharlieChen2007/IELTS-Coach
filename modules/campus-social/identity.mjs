import {schoolOf,prepareSchool} from './showcase.mjs';
export const skills = ['listening','speaking','reading','writing'];
export const school = 'szu';
export function fail(message, status = 400) { throw Object.assign(new Error(message), {status}); }
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
}
export async function participant(request,env) {
  const scope = request.headers.get('X-Speaking-Scope');
  if (!scope || scope.length > 768) fail('请从登录后的校园页面进入。',401);
  const cookieName = 'coach_group_campus_session_' + await digest(scope);
  const cookie = (request.headers.get('Cookie') || '').split(';').map(v=>v.trim())
    .find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if (!cookie || !/^[a-f0-9]{64}$/.test(cookie)) fail('请重新进入校园工作区。',401);
  const id = 'guest_' + await digest(cookie);
  if (!await env.DB.prepare('SELECT 1 FROM campus_profiles WHERE user_id=?').bind(id).first()) fail('请先进入校园工作区。',401);
  return id;
}
export function publicMember(row) {
  return row && {id:row.id,school:row.school,nickname:row.nickname,level:row.level||null,target:row.target||null,
    strong:JSON.parse(row.strong),need:JSON.parse(row.need),slots:JSON.parse(row.slots)};
}
export async function requireMember(request,env) {
  const id = await participant(request,env);
  const school=schoolOf(request,id);
  await prepareSchool(env.DB,school,id);
  const row = await env.DB.prepare('SELECT * FROM social_members WHERE id=? AND school=?').bind(id,school).first();
  return publicMember(row) || fail('请先加入深圳大学校园。',403);
}
export async function awardHelp(env,memberId,subject,eventId,label) {
  if (!skills.includes(subject) || !eventId || !label) fail('无效的互助记录。');
  await env.DB.prepare("INSERT OR IGNORE INTO social_points(member,subject,event,label,points,category,created) SELECT id,?,?,?,5,'help',? FROM social_members WHERE id=?")
    .bind(subject,'help:'+eventId,label,Date.now(),memberId).run();
}
