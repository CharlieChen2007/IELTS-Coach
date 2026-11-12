import { useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Root } from './App'
import './styles.css'
import './motion.css'
import './sidebarLayout.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')
function BootHandoff() {
  useLayoutEffect(() => {
    const html=document.documentElement
    const boot=document.getElementById('boot')
    const firstPaint=performance.getEntriesByName('first-paint')[0]?.startTime ?? 0
    const reduced=html.dataset.motion==='off'
    const remaining=reduced?0:Math.max(0,1120-(performance.now()-firstPaint))
    let remove=0
    let complete=false
    const handoff=()=>{
      if(complete)return
      complete=true
      html.setAttribute('data-ready','')
      html.dataset.motionReady='1'
      html.removeAttribute('data-booting')
      boot?.classList.add('boot-out')
      document.dispatchEvent(new Event('coach:motion-ready'))
      remove=window.setTimeout(()=>boot?.remove(),280)
    }
    const timer=window.setTimeout(handoff,remaining)
    const preference=matchMedia('(prefers-reduced-motion: reduce)')
    const onPreference=()=>{if(preference.matches){clearTimeout(timer);handoff()}}
    preference.addEventListener('change',onPreference)
    return()=>{clearTimeout(timer);clearTimeout(remove);preference.removeEventListener('change',onPreference)}
  },[])
  return <Root />
}
createRoot(container).render(<BootHandoff />)
