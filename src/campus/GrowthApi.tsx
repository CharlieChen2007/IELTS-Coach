import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { useApp } from '../appContext'
import { repository } from '../repository'
import { findPractice } from '../seed'
import { campusRequest } from './SocialApi'

type MemberState = {joined:boolean}
export interface GrowthState extends MemberState {
  today:string
  pet:{name:string; fed:number; feed:number; questionsDone:number}
  campExp:number
  lamp:{streak:number; lastLit:string; best:number}
  larder:Record<string,number>
  badges:string[]
}
export type ArchiveField = 'building'|'headset'|'examiner'|'waitingRoom'|'printShop'
export interface ExamState extends MemberState {
  demo:boolean
  exam:Record<ArchiveField,string> & {updatedAt:string;contributors:number}
  stories:{storyId:string;nickname:string;band:number;days:number;headline:string;body:string;likes:number;liked:number}[]
}
const signal='coach-growth-refresh'

export function useCampusResource<T extends MemberState>(route:'exam'|'growth') {
  const {user}=useAuth()
  const {toast}=useApp()
  const owner=user?.userId || ''
  const [view,setView]=useState<{owner:string;data:T}|null>(null)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [refreshId,setRefreshId]=useState(0)
  const epoch=useRef(0)
  const working=useRef(false)
  const pendingKey=useRef({owner:'',op:'',id:''})
  const reload=()=>setRefreshId(x=>x+1)
  const path='/api/social/'+route
  useEffect(()=>{
    if(!user)return
    let active=true
    const read=async()=>{
      if(working.current||!active||document.hidden)return
      const ticket=++epoch.current
      try{
        const data=await campusRequest<T>(user,path)
        if(active&&ticket===epoch.current){setView({owner,data});setError('')}
      }catch(e){if(active&&ticket===epoch.current)setError((e as Error).message)}
    }
    void read()
    const timer=window.setInterval(read,20000)
    window.addEventListener('focus',read)
    window.addEventListener(signal,read)
    document.addEventListener('visibilitychange',read)
    return ()=>{active=false; epoch.current++;window.clearInterval(timer);window.removeEventListener('focus',read);window.removeEventListener(signal,read);document.removeEventListener('visibilitychange',read)}
  },[owner,path,refreshId])
  const data=view?.owner===owner?view.data:null
  async function change(body:Record<string,unknown>,message?:string){
    if(!user||working.current||!data)return false
    working.current=true
    setBusy(true)
    const ticket=++epoch.current
    const op=JSON.stringify(body)
    if(pendingKey.current.owner!==owner || pendingKey.current.op!==op)pendingKey.current={owner,op,id:crypto.randomUUID()}
    try{
      if(!data.joined)await campusRequest(user,'/api/social/profile',{nickname:user.nickname})
      const next=await campusRequest<T>(user,path,{id:pendingKey.current.id,...body})
      if(ticket!==epoch.current)return false
      pendingKey.current={owner:'',op:'',id:''}
      setView({owner,data:next});setError('')
      if(message)toast(message)
      return true
    }catch(e){
      if(ticket===epoch.current){
        setError((e as Error).message);toast((e as Error).message)
        if((e as {status?:number}).status===409)reload()
      }
      return false
    }
    finally{working.current=false;setBusy(false)}
  }
  return {data,busy,error,change,reload}
}

export function ResourceStatus({error,reload}:{error:string;reload:()=>void}){
  return error ? <section className="card" aria-live="polite"><p>{error}</p><button type="button" className="btn btn-sm" onClick={reload}>重新连接</button></section> : <section className="card" aria-live="polite" aria-busy="true"><p>正在读取校园记录…</p></section>
}

// Listening sessions are reconciled directly from their grader. Recorded speaking
// sessions share an event key with the native recorder, including local-first reports.
export function GrowthSync(){
  const {user}=useAuth()
  const {version}=useApp()
  const ack=useRef(new Set<string>())
  const [retry,setRetry]=useState(0)
  useEffect(()=>{
    const listener=()=>setRetry(n=>n+1)
    window.addEventListener('online',listener)
    window.addEventListener('focus',listener)
    window.addEventListener('growth:joined',listener)
    return ()=>{for(const event of ['online','focus','growth:joined'])window.removeEventListener(event,listener)}
  },[])
  useEffect(()=>{
    if(!user)return
    const owner=user.userId
    const attempts=repository.listAttempts(owner)
    const reports=new Map(repository.listReports(owner).map(report=>[report.reportId,report]))
    const pending=attempts.flatMap(a=>{
      const r=reports.get(a.reportId||'')
      if(a.attemptId.startsWith('atm_rd_')||a.attemptId.startsWith('atm_wr_')||a.status!=='ready'||!r||r.status!=='ready'||r.evidence.showcaseRecord||r.evidence.demoRecord||ack.current.has(owner+'/'+a.attemptId))return []
      let count=0
      let questionIds:string[]=[]
      if(a.subject==='writing')count=a.draftText?.trim()?1:0
      if(a.subject==='reading'||(a.subject==='listening'&&!a.attemptId.startsWith('atm_li_'))){
        const valid=new Set(findPractice(a.exerciseId)?.questions.map(q=>q.id))
        questionIds=Object.keys(a.answers).filter(id=>valid.has(id)&&a.answers[id]?.trim())
        count=questionIds.length
      }
      if(a.subject==='speaking'&&/^atm_sp_(exam|dialogue|pair)_[\w-]+$/.test(a.attemptId)){
        count=a.mode==='pair'?1:Math.min(100,Number(r.evidence.turnCount)||0)
      }
      const at=Date.parse(a.submittedAt||r.createdAt)
      return count&&Number.isFinite(at)?[{id:a.attemptId,subject:a.subject,exercise:a.exerciseId,questionIds,count,at}]:[]
    })
    if(!pending.length)return
    let active=true
    const sync=async()=>{
      try{
        for(let i=0;active&&i<pending.length;i+=50){
          const batch=pending.slice(i,i+50)
          await campusRequest(user,'/api/social/growth',{action:'practice',attempts:batch})
          batch.forEach(a=>ack.current.add(owner+'/'+a.id))
        }
        if(active)window.dispatchEvent(new Event(signal))
      }catch{/* The reports remain in the account repository for the next retry. */}
    }
    void sync()
    return ()=>{active=false}
  },[user?.userId,version,retry])
  return null
}

