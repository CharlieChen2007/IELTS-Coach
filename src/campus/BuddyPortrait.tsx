import { useEffect, useRef, useState } from 'react'
import { portraitQuestions } from './buddyData'

export function BuddyPortrait({saved,busy,onSave,onClose}:{
  saved?:number[]|null;busy:boolean;onSave:(answers:number[])=>void;onClose:()=>void
}) {
  const [answers,setAnswers]=useState(()=>saved?.slice() || Array(portraitQuestions.length).fill(-1) as number[])
  const [step,setStep]=useState(0)
  const heading=useRef<HTMLHeadingElement>(null)
  const [title,options]=portraitQuestions[step]
  useEffect(()=>{heading.current?.focus({preventScroll:true})},[step])
  return <section className="card camp-quiz buddy-quiz" aria-label="搭子画像问卷">
    <div className="buddy-heading"><small>我的搭子画像</small><button type="button" className="buddy-link" disabled={busy} onClick={onClose}>返回广场</button></div>
    <div className="quiz-progress"><span>第 {step+1} 题 / 共 {portraitQuestions.length} 题</span><div className="bar" aria-hidden="true"><i style={{width:((step+1)/portraitQuestions.length)*100+'%'}}/></div></div>
    <h2 ref={heading} tabIndex={-1}>{title}</h2>
    <div className="quiz-options">{options.map((option,i)=><button type="button" key={option} className={'quiz-opt'+(answers[step]===i?' on':'')} disabled={busy}
      aria-pressed={answers[step]===i} onClick={()=>setAnswers(prev=>prev.map((a,n)=>n===step?i:a))}>{option}</button>)}</div>
    <div className="buddy-quiz-actions"><button className="btn" type="button" disabled={busy||step===0} onClick={()=>setStep(s=>s-1)}>上一题</button>
      <button className="btn btn-primary" type="button" disabled={busy||answers[step]<0} onClick={()=>step===portraitQuestions.length-1?onSave(answers):setStep(s=>s+1)}>{busy?'保存中':step===portraitQuestions.length-1?'保存画像并查看推荐':'下一题'}</button></div>
    <small className="buddy-hint">保存后，同校同学可按这些偏好找到你。你可以随时重新作答。</small>
  </section>
}

export function BuddyHubIcon({name}:{name:'user'|'radar'|'users'|'send'}) {
  const drawings={
    user:<><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.4 3.1-5.6 7-5.6s7 2.2 7 5.6"/></>,
    radar:<><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4.4"/><path d="m12 12 6-6"/></>,
    users:<><circle cx="9" cy="8.4" r="3.2"/><path d="M3.4 19.4c0-3 2.5-5 5.6-5s5.6 2 5.6 5M16 5.6a3 3 0 0 1 0 5.6m1.4 3.4c2 .5 3.4 2.2 3.4 4.4"/></>,
    send:<><path d="m4 12 16-7-6.6 16-2.8-6.6zM10.6 14.4l3.4-3.4"/></>,
  }
  return <span className="hub-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{drawings[name]}</svg></span>
}
