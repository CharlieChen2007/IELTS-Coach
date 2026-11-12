/* Browser regression: real SQLite/API transport, no remote provider, isolated build.
   CHROMIUM_PATH=/path/to/chromium node scripts/verify-motion-entry.cjs */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'coach-motion-entry-'));
const executablePath=process.env.CHROMIUM_PATH||path.join(process.env.USERPROFILE||'','AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe');
(async()=>{
 const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')));
 const dist=path.join(dir,'dist');await build({root,logLevel:'error',build:{outDir:dist}});
 const {speakingApi}=await import(pathToFileURL(path.join(root,'scripts/speaking-api.mjs'))),{openLocalBindings}=await import(pathToFileURL(path.join(root,'modules/speaking/scripts/local-bindings.mjs')));
 const db=openLocalBindings(path.join(dir,'database'),{campus:true}),origin='https://motion-entry.test';
 const browser=await chromium.launch({executablePath});let checks=0,gate=null;
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],metrics=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 const check=(value,label)=>{assert(value,label);checks++};
 try{
  await page.addInitScript(()=>{
   window.__motionAudit=[];const now=()=>performance.timeOrigin+performance.now(),record=(type,data={})=>window.__motionAudit.push({type,time:now(),...data});
   const original=Element.prototype.animate;
   Element.prototype.animate=function(...args){const animation=original.apply(this,args);if(args[1]?.duration>=500){let presented=true;try{const stage=frameElement?.closest('.frame-stage');presented=!stage||stage.dataset.ready==='1'}catch{}
    record('entry',{class:this.className,presented,duration:args[1].duration,delay:args[1].delay||0});animation.addEventListener('cancel',()=>record('cancel',{class:this.className}));}return animation};
   new MutationObserver(records=>{for(const r of records)if(r.target.matches('.frame-stage[data-ready="1"]'))record('ready',{title:r.target.querySelector('iframe')?.title})}).observe(document,{subtree:true,attributes:true,attributeFilter:['data-ready']});
   try{new PerformanceObserver(list=>list.getEntries().forEach(e=>record('longtask',{duration:e.duration}))).observe({type:'longtask',buffered:true})}catch{}
  });
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
   if(url.pathname.startsWith('/api/')){
    if(gate&&url.pathname===gate.path){const pending=gate;gate=null;pending.reached();await pending.release;}
    const response=await speakingApi(new Request(url,{method:req.method(),headers:{...await req.allHeaders(),origin},body:req.postDataBuffer()??undefined}),db);
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
   }
   const file=path.join(dist,url.pathname==='/'?'index.html':url.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
  });
  await page.goto(origin+'/?demo=1#/auth');await page.getByPlaceholder('例如：Alex').fill('动效验收');await page.getByPlaceholder('you@example.com').fill('motion-entry@example.org');await page.getByRole('button',{name:'进入学习首页'}).click();await page.waitForURL(/#\/home/);await page.locator('#boot').waitFor({state:'detached'});
  const at=async(subject)=>page.evaluate(s=>{window.__motionAudit=[];const time=performance.timeOrigin+performance.now();location.hash='#/subject/'+s;return time},subject);
  const settle=async target=>target.evaluate(async()=>{await Promise.allSettled(document.getAnimations().filter(a=>a.id==='coach-content-enter').map(a=>a.finished))});
  for(const round of ['cold','warm'])for(const subject of ['listening','speaking','reading','writing']){
   const start=await at(subject);let target=page;
   if(subject==='listening')await page.locator('.ls-material').first().waitFor();
   else{
    await page.locator('.frame-stage[data-ready="1"] iframe').waitFor();target=page.frames().find(f=>f.url().includes('/'+subject+'/index.html'));
    check(!!target,subject+' frame exists');await target.waitForFunction(()=>window.__coachMotion?.stats.played>0);
    if(subject==='reading')await target.locator('.bank-card').first().waitFor();
    if(subject==='writing')await target.locator('.composite-card').first().waitFor();
    check(await page.locator('.frame-stage iframe').evaluate(el=>getComputedStyle(el).transitionDuration.split(',').every(n=>parseFloat(n)===0)),subject+' has no second opacity transition');
   }
   await settle(target);const events=await target.evaluate(()=>window.__motionAudit),entries=events.filter(e=>e.type==='entry'&&e.time>=start);
   check(entries.length>0,subject+' retains actual content entrance');check(entries.every(e=>e.presented),subject+' never starts behind a hidden frame');check(!events.some(e=>e.type==='cancel'),subject+' never cancels/restarts first entrance');
   check(entries.every(e=>e.duration>=500&&e.duration<=650),subject+' shared duration');
   const hero=entries.filter(e=>/(?:^|\s)(?:ls-hero|hero)(?:\s|$)/.test(e.class));check(hero.length===1,subject+' hero enters exactly once');
   const host=await page.evaluate(()=>window.__motionAudit),ready=host.find(e=>e.type==='ready'),first=entries[0];
   if(ready)check(first.time>=ready.time-3&&first.time-ready.time<120,subject+' ready to first keyframe has no timer wait');
   metrics.push({subject,round,clickToEntry:Math.round(first.time-start),readyToEntry:ready?Math.round(first.time-ready.time):null,longTasks:events.filter(e=>e.type==='longtask').map(e=>Math.round(e.duration))});
  }
  // Hold a real state-restoration request, rather than using a made-up delay.
  for(const subject of ['reading','writing']){
   await page.evaluate(()=>location.hash='#/home');await page.locator('.home-page,.hero-banner').first().waitFor();
   let reached,release;const reachedPromise=new Promise(r=>reached=r),releasePromise=new Promise(r=>release=r);
   gate={path:'/api/'+subject+'/'+(subject==='reading'?'state':'workspace'),reached,release:releasePromise};
   await at(subject);await reachedPromise;
   const frame=page.frames().find(f=>f.url().includes('/'+subject+'/index.html'));
   check(await frame.evaluate(()=>!window.__coachMotion?.stats.played),subject+' waits for actual state restoration');
   release();await page.locator('.frame-stage[data-ready="1"] iframe').waitFor();await frame.waitForFunction(()=>window.__coachMotion?.stats.played>0);await settle(frame);
   check(!(await frame.evaluate(()=>window.__motionAudit)).some(e=>e.type==='cancel'),subject+' delayed readiness presents once');
   const marker=subject+'-same-document';await frame.evaluate(marker=>window.__motionDocumentMarker=marker,marker);
   if(subject==='writing'){
    await page.getByRole('button',{name:'写作精修',exact:true}).click();await frame.locator('textarea').first().waitFor();await frame.locator('textarea').first().fill('A retained draft survives motion and peer navigation.');
   }
   await settle(frame);const before=await frame.evaluate(()=>window.__coachMotion.stats.played);
   await page.getByRole('button',{name:'学伴互助',exact:true}).click();await page.getByRole('button',{name:subject==='reading'?'阅读训练':'写作训练',exact:true}).click();
   await frame.waitForFunction(before=>window.__coachMotion.stats.played>before,before);
   check(await frame.evaluate(marker=>window.__motionDocumentMarker===marker,marker),subject+' return preserves iframe identity');
   if(subject==='writing')check(await frame.locator('textarea').first().inputValue()==='A retained draft survives motion and peer navigation.','writing return preserves editor state');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const subject of ['listening','speaking','reading','writing']){
   await at(subject);if(subject==='listening')await page.locator('.ls-material').first().waitFor();else await page.locator('.frame-stage[data-ready="1"] iframe').waitFor();
   for(const frame of page.frames())check(await frame.evaluate(()=>!document.getAnimations().some(a=>a.id==='coach-content-enter'&&a.playState==='running')),subject+' reduced motion has visible stable content');
  }
  check(errors.length===0,'no browser errors');fs.writeFileSync(path.join(dir,'metrics.json'),JSON.stringify(metrics,null,2));
  console.log('PASS '+checks+' motion checks: cold/warm four subjects, actual async state gate, exactly one entrance, preserved iframe/draft, reduced motion.');console.log(JSON.stringify(metrics));console.log('Artifacts '+dir);
 }finally{await browser.close();db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
