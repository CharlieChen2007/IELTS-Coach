// Test-only entry; the production entry never imports this file.
import React,{StrictMode,useEffect,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {AuthProvider,useAuth} from '../../src/auth'
import {AppContext} from '../../src/appContext'
import {StudyCoach} from '../../src/StudyCoach'
import {campusRequest} from '../../src/campus/SocialApi'
import {saveReadingSession,type ReadingSession} from '../../src/readingIntegration'
import {repository} from '../../src/repository'
import type {Report} from '../../src/contract'
import '../../src/styles.css'

function Fixture(){
  const auth=useAuth(),[report,setReport]=useState<Report|null>(null)
  const [issue,setIssue]=useState('')
  async function load(id:string){
    if(!auth.user)return
    const user=auth.user
    try{
      const {session}=await campusRequest<{session:ReadingSession}>(user,'/api/reading/submit',{
        id,passageId:'p1',answers:{'p1-q1':'STUDENT_'+user.nickname.toUpperCase()},startedAt:Date.now()})
      saveReadingSession(user.userId,session)
      setReport(repository.getReport(user.userId,'rpt_rd_'+session.id)!)
    }catch(error){setIssue((error as Error).message)}
  }
  useEffect(()=>{if(auth.ready&&!auth.user)void auth.demoSignIn('First','first@study-coach.test')},[auth.ready,auth.user?.userId])
  useEffect(()=>{if(auth.user)void load('s_browser_main')},[auth.user?.userId])
  return <AppContext.Provider value={{route:{name:'home',id:'',query:{}},go:path=>{document.documentElement.dataset.lastPath=path},version:0,refresh:()=>{},toast:()=>{}}}>
    <main style={{maxWidth:960,padding:16,margin:'0 auto'}}>
      <h1>报告复盘验收 · {auth.user?.nickname}</h1>
      <div className="row"><button className="btn" onClick={()=>void load('s_browser_main')}>Report main</button>
        <button className="btn" onClick={()=>void load('s_browser_second')}>Report second</button>
        <button className="btn" onClick={()=>void load('s_browser_error')}>Report error</button>
        <button className="btn" onClick={()=>void load('s_browser_pending')}>Report pending</button>
        <button className="btn" onClick={()=>void auth.demoSignIn('Second','second@study-coach.test')}>Second account</button>
      </div>
      <p role="status">{report?'报告 '+report.attemptId:'准备答卷'}</p>{issue&&<p role="alert">{issue}</p>}
      {report&&<StudyCoach report={report}/>}
    </main>
  </AppContext.Provider>
}
createRoot(document.getElementById('root')!).render(<StrictMode><AuthProvider><Fixture/></AuthProvider></StrictMode>)
