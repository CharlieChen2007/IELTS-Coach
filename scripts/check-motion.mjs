import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const base=(process.env.BASE_URL || 'http://127.0.0.1:4216').replace(/\/$/,'')
const executablePath=process.env.CHROMIUM_PATH || (process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined)
const browser=await chromium.launch({executablePath})
const errors=[]
let checks=0
function check(condition,label){assert(condition,label);console.log('PASS '+label);checks++}
async function settle(page){await page.waitForTimeout(1100)}
async function visibleMotion(frame){
 return frame.evaluate(()=>[...document.querySelectorAll('.coach-motion-item')].some(el=>
  getComputedStyle(el).translate!=='none' && el.getAnimations().some(a=>a.id==='coach-content-enter'&&a.playState==='running')))
}
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}})
 const page=await context.newPage()
 page.on('pageerror',error=>errors.push(error.message))
 await page.goto(base+'/?demo=1#/auth')
 await page.getByPlaceholder('例如：Alex').fill('动效验收')
 await page.getByPlaceholder('you@example.com').fill('motion-'+Date.now()+'@example.org')
 await page.getByRole('button',{name:'进入学习首页'}).click()
 await page.waitForURL(/#\/home/)
 await page.locator('#boot').waitFor({state:'detached'})
 await settle(page)
 const at=async route=>{await page.evaluate(route=>{location.hash='#/'+route},route)}
 await at('subject/listening')
 await page.waitForTimeout(130)
 const initial=await page.evaluate(()=>[...document.querySelectorAll('.coach-motion-item')].map(el=>({
  translate:getComputedStyle(el).translate,
  starts:el.getAnimations().filter(a=>a.id==='coach-content-enter').map(a=>({delay:a.effect.getTiming().delay,duration:a.effect.getTiming().duration}))
 })))
 check(initial.some(item=>item.starts.length && item.translate!=='none'),'首屏存在实际位移进场')
 const delays=initial.flatMap(item=>item.starts.map(timing=>timing.delay))
 check(new Set(delays).size>=2,'主视觉与摘要错落出现')
 check(initial.flatMap(item=>item.starts).every(timing=>timing.duration>=480&&timing.duration<=650),'内容采用可见的统一进场时长')
 await settle(page)
 check(await page.evaluate(()=>[...document.querySelectorAll('.coach-motion-item')].every(el=>getComputedStyle(el).translate==='none')),'动画结束释放位移合成层')
 const before=await page.evaluate(()=>window.__coachMotion.stats.played)
 await page.getByRole('button',{name:'题型训练',exact:true}).click()
 await page.waitForTimeout(120)
 check(await page.evaluate(before=>window.__coachMotion.stats.played>before,before),'页内切换真实重播内容')
 for(const route of ['subject/speaking','subject/reading','subject/writing','vocabulary','campus/base','history','trends','mistakes','profile']){
  await at(route);await settle(page)
  check(await page.evaluate(()=>[...document.querySelectorAll('.subject-hero,.subject-tools,.topbar,.sidebar,.workspace-secondary,.clinic-section-tabs')].every(el=>getComputedStyle(el).animationName==='none')),route+' 导航外壳保持稳定')
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' 布局无横向溢出')
 }
 await page.getByLabel('昵称',{exact:true}).fill('未保存的昵称')
 await page.getByRole('button',{name:'个人空间',exact:true}).click()
 await page.locator('.space-panel').getByRole('button',{name:/个人资料/}).click()
 check(await page.getByLabel('昵称',{exact:true}).inputValue()==='未保存的昵称','切换动画保留正在编辑的表单')
 for(const route of ['subject/reading','subject/writing']){
  await at(route);await settle(page)
  const child=page.frames().find(frame=>frame.url().includes(route.endsWith('reading')?'/reading/':'/writing/'))
  check(!!child && await child.evaluate(()=>window.__coachMotion?.stats.played>0),route+' 异步 iframe 内容已进场')
  await page.getByRole('button',{name:route.endsWith('reading')?'篇章练习':'写作精修',exact:true}).click()
  await page.waitForTimeout(180)
  check(await visibleMotion(child),route+' 实际操作触发原生内容位移进场')
  await settle(page)
  if(route.endsWith('reading')){
   const lower=child.locator('#para-E')
   check(!(await lower.evaluate(el=>el.classList.contains('coach-motion-item'))),'iframe 离屏段落等待主站滚动')
   const y=await lower.evaluate(el=>el.getBoundingClientRect().top+window.frameElement.getBoundingClientRect().top+parent.scrollY-220)
   await page.evaluate(y=>scrollTo(0,y),y);await page.waitForTimeout(180)
   check(await lower.evaluate(el=>getComputedStyle(el).translate!=='none' && el.getAnimations().some(a=>a.id==='coach-content-enter')),'iframe 下方内容进入真实父视口后才播放')
   await settle(page)
  }
  await page.getByRole('button',{name:route.endsWith('reading')?'题库总览':'练习概览',exact:true}).click()
  await page.waitForTimeout(180)
  check(await visibleMotion(child),route+' 返回已存在的旧视图仍能重播')
 }
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844})
  for(const route of ['home','subject/listening','subject/speaking','subject/reading','subject/writing','vocabulary','campus/base','campus/help','campus/partner','campus/rank','campus/exam','profile/campus']){
   await at(route);await page.waitForTimeout(250)
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+'px '+route+' 无横向溢出')
  }
 }
 await page.emulateMedia({reducedMotion:'reduce'})
 await at('subject/listening');await page.waitForTimeout(160)
 check(await page.evaluate(()=>document.getAnimations().filter(a=>a.id==='coach-content-enter'&&a.playState==='running').length===0),'减少动效偏好立即停止进场')
 check(errors.length===0,'浏览器无运行异常')
 console.log('全部通过 '+checks+' 项动效与布局验收')
}finally{await browser.close()}
