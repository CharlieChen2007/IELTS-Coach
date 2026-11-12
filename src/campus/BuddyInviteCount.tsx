import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { campusRequest } from './SocialApi'
import { buddySamples, type BuddyPost, type Invitation, type PlazaState } from './buddyData'

export type LocalBoard = { invites: Invitation[]; mine: BuddyPost | null }
export const localKey = (uid:string)=>'szu-buddy-board-v1:'+uid
export function readLocal(uid:string,showcase:boolean):LocalBoard {
  const initial:Invitation[]=showcase?[2,4,8].map(index=>{
    const peer=buddySamples[index].profile
    return {other:peer.id,name:peer.nickname,incoming:true,status:'pending'}
  }):[]
  try {
    const raw=localStorage.getItem(localKey(uid))
    if(raw) {
      const saved=JSON.parse(raw) as LocalBoard
      if(Array.isArray(saved.invites))return {...saved,invites:[...saved.invites,...initial.filter(seed=>!saved.invites.some(inv=>inv.other===seed.other))]}
    }
  } catch { /* The board remains readable if browser storage is unavailable. */ }
  return {mine:null,invites:initial}
}

export function countInvitations(invites:Invitation[]) {
  return invites.filter(i=>(i.incoming&&i.status==='pending')||i.meetIncoming).length
}

export function BuddyInviteCount() {
  const {user,showcase}=useAuth()
  const [count,setCount]=useState(0)
  useEffect(()=>{
    let active=true,latest=0
    setCount(0)
    if(!user)return
    const account=user
    const sync=async()=>{
      const request=++latest
      const local=showcase?readLocal(account.userId,true).invites:[]
      try {
        const board=await campusRequest<PlazaState>(account,'/api/social/plaza')
        if(active&&request===latest)setCount(countInvitations([...board.invites,...local]))
      } catch {if(active&&request===latest)setCount(countInvitations(local))}
    }
    void sync()
    const refresh=()=>{if(!document.hidden)void sync()}
    const onStorage=(event:StorageEvent)=>{if(event.key===localKey(account.userId))refresh()}
    const timer=window.setInterval(refresh,15000)
    window.addEventListener('focus',refresh)
    window.addEventListener('campus-buddy-changed',refresh)
    window.addEventListener('storage',onStorage)
    return ()=>{active=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('campus-buddy-changed',refresh);window.removeEventListener('storage',onStorage)}
  },[user?.userId,showcase])
  return count>0 ? <span className="camp-tile-dot" aria-label={count+' 条邀请待处理'}>{count}</span> : null
}
