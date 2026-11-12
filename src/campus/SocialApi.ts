type User = {userId:string; nickname:string}
export const campusAwardEvent = 'coach-campus-points-earned'
export type CampusAward = { userId: string; points: number; label: string }
const initialising = new Map<string,Promise<void>>()
export const skillNames = {listening:'听力',speaking:'口语',reading:'阅读',writing:'写作'}
export type Skill = keyof typeof skillNames
export const skills = Object.keys(skillNames) as Skill[]
export const slots = ['一','二','三','四','五','六','日'].flatMap(d=>['上午','下午','晚间'].map(t=>'周'+d+t))
export type SchoolProfile = {id:string;school:string;nickname:string;level:number|null;target:number|null;strong:Skill[];need:Skill[];slots:string[];writingAssessment?:{band:number|null;status:string;task1:number;task2:number;source:string}}
async function request<T>(scope:string,path:string,body?:unknown):Promise<T> {
  const response = await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
    headers:{'X-Speaking-Scope':scope,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)})
  const data = await response.json().catch(()=>({error:'校园服务未启动。请使用整合版启动入口。'}))
  if(!response.ok) throw Object.assign(new Error(data.error || '校园请求失败。'),{status:response.status})
  if (body !== undefined && Number.isInteger(data.awardedPoints) && data.awardedPoints > 0) {
    window.dispatchEvent(new CustomEvent<CampusAward>(campusAwardEvent, {
      detail: { userId: decodeURIComponent(scope), points: data.awardedPoints, label: data.awardLabel || '校园积分' },
    }))
  }
  return data
}
async function ensure(user:User,scope:string) {
  let result=await request<{active:boolean;participant?:string}>(scope,'/api/campus/me')
  if(!result.active) result=await request(scope,'/api/campus/session',{nickname:(user.nickname||'同学').slice(0,24)})
  if(result.participant) try{localStorage.setItem('speaking-campus-participant:host:'+scope,result.participant)}catch{/* Storage can be disabled. */}
}
export async function campusRequest<T=any>(user:User,path:string,body?:unknown):Promise<T>{
  if(!/^\/api\/(?:social|clinic|campus|listening|reading|writing)\//.test(path)) throw Error('无效的校园请求。')
  const scope=encodeURIComponent(user.userId)
  let ready=initialising.get(scope)
  if(!ready){
    const enrol=async()=>{
      if(navigator.locks) await navigator.locks.request('coach-campus-enrol:'+scope,()=>ensure(user,scope))
      else await ensure(user,scope)
    }
    ready=enrol().catch(error=>{initialising.delete(scope);throw error});initialising.set(scope,ready)
  }
  await ready
  try{return await request<T>(scope,path,body)}
  catch(error){if((error as {status?:number}).status===401) initialising.delete(scope);throw error}
}
