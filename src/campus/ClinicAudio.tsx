import { useEffect, useRef, useState } from 'react'
import type { AuthUser } from '../auth'

export function PlayClip({blob}:{blob:Blob|null}) {
 const [url,setUrl]=useState('')
 useEffect(()=>{if(!blob){setUrl('');return}const src=URL.createObjectURL(blob);setUrl(src);return()=>URL.revokeObjectURL(src)},[blob])
 return url?<audio className="clinic-player" controls src={url} aria-label="回听作答录音"/>:null
}
export function PrivateClip({user,id,after=false}:{user:AuthUser;id:string;after?:boolean}){
 const [blob,setBlob]=useState<Blob|null>(null),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false)
 const controller=useRef<AbortController|null>(null)
 useEffect(()=>()=>controller.current?.abort(),[])
 async function load(){
  setMsg('');setBusy(true);controller.current=new AbortController()
  try{const response=await fetch('/api/clinic/audio?id='+encodeURIComponent(id)+(after?'&take=after':''),{headers:{'X-Speaking-Scope':encodeURIComponent(user.userId)},signal:controller.current.signal})
    if(!response.ok)throw Error('当前账号无法读取这段录音。');setBlob(await response.blob())}
  catch(e){if(!controller.current.signal.aborted)setMsg((e as Error).message)}finally{setBusy(false)}
 }
 return <div>{blob?<PlayClip blob={blob}/>:<button className="btn btn-sm" disabled={busy} type="button" onClick={load}>{busy?'读取中…':'播放作答录音'}</button>}{msg&&<p role="alert">{msg}</p>}</div>
}
export function ClipPicker({value,onChange,onBusyChange}:{value:Blob|null;onChange:(blob:Blob|null)=>void;onBusyChange?:(active:boolean)=>void}){
 const [recording,setRecording]=useState(false),[pending,setPending]=useState(false),[msg,setMsg]=useState('')
 const recorder=useRef<MediaRecorder|null>(null),live=useRef(true),timer=useRef<number>()
 useEffect(()=>{onBusyChange?.(pending||recording);return()=>onBusyChange?.(false)},[pending,recording,onBusyChange])
 useEffect(()=>{live.current=true;return()=>{live.current=false;window.clearTimeout(timer.current);const r=recorder.current;if(r?.state==='recording')r.stop();r?.stream.getTracks().forEach(t=>t.stop())}},[])
 function choose(blob:Blob|null){
  if(blob && (!blob.type.startsWith('audio/')||blob.size>4*1024*1024)){setMsg('请选择 4 MB 以内的音频文件。');return}
  setMsg('');onChange(blob)
 }
 async function record(){
  if(recorder.current?.state==='recording'){recorder.current.stop();return}
  setMsg('');setPending(true);let stream:MediaStream|undefined
  try{
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('此浏览器无法录音，可以附上音频文件。')
   stream=await navigator.mediaDevices.getUserMedia({audio:true})
   if(!live.current){stream.getTracks().forEach(t=>t.stop());return}
   const r=new MediaRecorder(stream);recorder.current=r;const chunks:Blob[]=[]
   r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
   r.onstop=()=>{window.clearTimeout(timer.current);r.stream.getTracks().forEach(t=>t.stop());if(live.current){setRecording(false);if(chunks.length)choose(new Blob(chunks,{type:r.mimeType.split(';')[0]}))}}
   r.start();setRecording(true);timer.current=window.setTimeout(()=>{if(r.state==='recording')r.stop()},60000)
  }catch(e){stream?.getTracks().forEach(t=>t.stop());setMsg((e as Error).name==='NotAllowedError'?'麦克风权限未开启，可以附上音频文件。':(e as Error).message)}finally{if(live.current)setPending(false)}
 }
 return <div className="clinic-audio"><div className="clinic-actions"><button className="btn btn-sm" disabled={pending} type="button" onClick={record}>{recording?'结束录音':pending?'打开中':'录一段作答'}</button>
 <label className="clinic-file">选择音频<input type="file" disabled={recording} accept="audio/*" onChange={e=>{choose(e.target.files?.[0]||null);e.target.value=''}}/></label>
 {value&&<button className="btn btn-sm" type="button" onClick={()=>onChange(null)}>移除录音</button>}</div>
 <PlayClip blob={value}/>{msg&&<p role="alert">{msg}</p>}</div>
}
