const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),{chromium}=require('playwright-core');
const executablePath=process.env.CHROMIUM_PATH||path.join(process.env.USERPROFILE||'', 'AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'reading-workspace-'));
const origin='https://reading-workspace.test';
const host=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#f5f8fb;color:#233b50;font:16px system-ui}.topbar{height:77px;position:sticky;top:0;background:white;z-index:20;display:grid;align-items:center;padding:0 20px;box-sizing:border-box}.host-content{max-width:1140px;padding:20px 16px;margin:auto}.toolbar{height:60px}iframe{width:100%;border:0;display:block}.tabbar{display:none}@media(max-width:760px){.tabbar{display:block;position:fixed;bottom:0;height:64px;background:white;width:100%;z-index:30}}</style></head><body><header class="topbar">阅读精读 · 工作区验收</header><div class="host-content"><div class="toolbar">阅读训练 / 篇章练习</div><iframe title="阅读精读" src="/reading/index.html?embedded=1&scope=workspace-reader&nickname=Reader#/practice/p1" style="height:800px"></iframe></div><div class="tabbar">学习导航</div><script>
const frame=document.querySelector('iframe');
addEventListener('message',async event=>{if(event.source!==frame.contentWindow||event.origin!==location.origin||event.data?.source!=='ielts-reading')return;const d=event.data;
if(d.type==='size')frame.style.height=Math.max(320,d.height)+'px';
if(d.type==='practice-layout'&&d.active){frame.style.height=d.height+'px';if(d.enter)requestAnimationFrame(()=>scrollTo({top:frame.offsetTop-89,behavior:'instant'}));}
if(d.type==='submit'){const response=await fetch('/api/reading/submit',{method:'POST',headers:{'Content-Type':'application/json','X-Speaking-Scope':'workspace-reader'},body:JSON.stringify(d.session)});const body=await response.json();frame.contentWindow.postMessage({source:'ielts-coach',type:'reading-submit-result',id:d.session.id,...body},location.origin);}
if(d.type==='scrollTo'||d.type==='reveal')scrollTo({top:frame.offsetTop+d.top,behavior:'instant'});
});</script></body></html>`;
(async()=>{
 const {speakingApi}=await import(pathToFileURL(path.join(root,'scripts/speaking-api.mjs'))),{openLocalBindings}=await import(pathToFileURL(path.join(root,'modules/speaking/scripts/local-bindings.mjs')));
 const db=openLocalBindings(path.join(directory,'db'),{campus:true});
 const browser=await chromium.launch({executablePath,ignoreDefaultArgs:['--hide-scrollbars']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 try{
  await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();if(url.pathname.startsWith('/api/')){const response=await speakingApi(new Request(url,{method:request.method(),headers:{...await request.allHeaders(),origin},...(request.method()==='GET'?{}:{body:request.postDataBuffer()})}),{...db,DEEPSEEK_API_KEY:''});return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:host});const file=path.join(root,'public',url.pathname);if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({path:file});return route.fulfill({status:404,body:''});});
  await page.goto(origin);const frame=page.frameLocator('iframe');await frame.locator('html[data-reading-workspace="split"]').waitFor();await page.waitForTimeout(900);
  const pane=frame.locator('.passage-pane'),questions=frame.locator('.question-pane');
  assert(await frame.getByRole('link',{name:'返回题库',exact:true}).isVisible(),'visible route out of the focused workspace');
  const metrics=async()=>({outer:await page.evaluate(()=>scrollY),left:await pane.evaluate(e=>e.scrollTop),right:await questions.evaluate(e=>e.scrollTop)});
  for(const side of [pane,questions])assert(await side.evaluate(e=>getComputedStyle(e).overflowY==='auto'&&e.scrollHeight>e.clientHeight&&e.clientHeight>350),'bounded scrollable pane');
  const before=await metrics();await pane.hover();await page.mouse.wheel(0,650);await page.waitForTimeout(650);let after=await metrics();assert(after.left>before.left+100);assert.equal(after.right,before.right);assert.equal(after.outer,before.outer);
  await questions.hover();await page.mouse.wheel(0,500);await page.waitForTimeout(650);const second=await metrics();assert(second.right>after.right+100);assert.equal(second.left,after.left);assert.equal(second.outer,after.outer);
  await frame.getByRole('button',{name:'第 9 题',exact:true}).click();await page.waitForTimeout(650);const jumped=await metrics();assert(jumped.right>second.right);assert.equal(jumped.left,second.left);assert.equal(jumped.outer,second.outer);
  await frame.locator('.practice-bar').getByRole('button',{name:'交卷',exact:true}).click();await frame.getByRole('dialog',{name:'还有题没作答'}).waitFor();assert(await frame.getByRole('button',{name:'继续做题',exact:true}).isVisible());await frame.getByRole('button',{name:'继续做题',exact:true}).click();assert.equal(await page.evaluate(()=>scrollY),before.outer);
  const content=JSON.parse(fs.readFileSync(path.join(root,'public/reading/content/passages/p1.json'),'utf8'));
  await frame.locator('body').evaluate((_,passage)=>{for(const section of passage.sections)for(const q of section.questions){const row=document.getElementById('q-'+q.id),value=String(q.answer.value);const button=[...row.querySelectorAll('button[data-v]')].find(b=>b.dataset.v===value);if(button)button.click();else{const input=row.querySelector('input,select');input.value=value;input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));}}document.querySelector('#q-p1-q1 button[data-v="TRUE"]').click();},content);
  await frame.locator('.practice-bar').getByRole('button',{name:'交卷',exact:true}).click();await frame.locator('.practice-bar.submitted').waitFor();assert((await frame.locator('.pb-result').innerText()).includes('12/13'));
  const evidence=frame.locator('#q-p1-q13 .rv-evidence');await evidence.scrollIntoViewIfNeeded();await page.waitForTimeout(300);const saved=await metrics();const evidenceBox=await evidence.boundingBox();await page.mouse.click(evidenceBox.x+evidenceBox.width/2,evidenceBox.y+evidenceBox.height/2);await page.waitForTimeout(650);const located=await metrics();assert.equal(located.right,saved.right);assert.equal(located.outer,saved.outer);assert(located.left>100);assert.equal(await pane.locator('mark.quote').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(215, 236, 250)');
  await page.screenshot({path:path.join(directory,'desktop.png')});
  console.log('PASS desktop independent left/right scroll, pinned controls, question jump and evidence locate without moving the other pane or host, visible quote, immutable submission');
  for(const width of [1024,990,390,320]){
   await page.setViewportSize({width,height:844});await page.waitForTimeout(450);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert(await frame.locator('html').evaluate(e=>e.scrollWidth<=innerWidth&&e.scrollHeight<=innerHeight+1),'no page-level iframe overflow');
   if(width<=990){await frame.getByRole('button',{name:'做题',exact:true}).click();assert(await questions.isVisible());assert(!await pane.isVisible());await frame.getByRole('button',{name:'阅读原文',exact:true}).click();assert(await pane.isVisible());assert(!await questions.isVisible());}
   assert(await frame.locator('.practice-bar').isVisible());
  }
  await page.screenshot({path:path.join(directory,'mobile-320.png')});
  await frame.locator('body').evaluate(async()=>{const {openWordCard}=await import('/reading/js/ui/wordcard.js');openWordCard({rect:{left:innerWidth-35,right:innerWidth-15,width:20,top:innerHeight-35,bottom:innerHeight-15},word:'boneshaker',entry:{word:'boneshaker',pos:'n.',zh:'震骨车'},collected:false,onToggle:()=>true});});
  await page.waitForTimeout(300);assert(await frame.locator('.wcard.show').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}),'word card within the real pane viewport');await pane.evaluate(e=>e.scrollTop+=45);await page.waitForTimeout(100);assert.equal(await frame.locator('.wcard').count(),0,'scroll closes the anchored word card');
  assert.equal(await frame.getByRole('link',{name:'返回题库',exact:true}).count(),1,'no duplicate return route after grading');await frame.getByRole('link',{name:'返回题库',exact:true}).click();await frame.locator('html[data-reading-workspace="document"]').waitFor();await frame.locator('.reading-hero').waitFor();assert.equal(await frame.locator('.mode-practice').count(),0);assert.equal(await frame.getByRole('link',{name:'开始练习',exact:true}).count(),3);
  assert.deepEqual(errors,[]);console.log('PASS 1024/990/390/320 widths, mobile pane switching, modal visibility, natural-height home restored and no JavaScript errors');console.log('Screens: '+directory);
 }finally{await browser.close();db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
