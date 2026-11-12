// Browser controls use real SQLite/API routes; no paid provider requests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'ielts-control-audit-'));
const candidate=path.join(process.env.USERPROFILE||'','AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe');
(async()=>{
 const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js'))),dist=path.join(temp,'dist');await build({root,logLevel:'error',build:{outDir:dist}});
 const {speakingApi}=await import(pathToFileURL(path.join(root,'scripts/speaking-api.mjs'))),{openLocalBindings}=await import(pathToFileURL(path.join(root,'modules/speaking/scripts/local-bindings.mjs')));
 const env={...openLocalBindings(path.join(temp,'data'),{campus:true}),DEEPSEEK_API_KEY:'',TENCENT_APP_ID:'',TENCENT_SECRET_ID:'',TENCENT_SECRET_KEY:''};
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||(fs.existsSync(candidate)?candidate:undefined),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}),page=await browser.newPage({viewport:{width:1440,height:900},permissions:['microphone']});
 const origin='https://controls-audit.test',errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
 await page.addInitScript(()=>{
  const synthesis={getVoices:()=>[],cancel(){},speak(utterance){setTimeout(()=>utterance.onstart?.(),0);}};
  Object.defineProperty(window,'speechSynthesis',{value:synthesis,configurable:true});
 });
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();
  if(url.pathname.startsWith('/api/')){requests.push({path:url.pathname,method:request.method()});const headers=new Headers(await request.allHeaders());headers.set('Origin',origin);const response=await speakingApi(new Request(url,{method:request.method(),headers,body:request.postDataBuffer()??undefined}),env);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}
  const file=path.join(dist,url.pathname==='/'?'index.html':url.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
 });
 const go=route=>page.evaluate(route=>{location.hash='#/'+route},route);
 const listening=()=>page.frames().find(f=>f.url().includes('/listening/index.html'));
 const speaking=()=>page.frames().find(f=>f.url().includes('/speaking/index.html'));
 try{
  await page.goto(origin+'/?demo=1#/auth');await page.getByPlaceholder('例如：Alex').fill('控制流程复验');await page.getByPlaceholder('you@example.com').fill('controls-audit@example.org');await page.getByRole('button',{name:'进入学习首页'}).click();await page.waitForURL(/#\/home/);
  await go('subject/listening?view=practice&section=prac_lsn_s1');await page.locator('iframe.listening-frame.is-ready').waitFor();let frame=listening();
  const inputs=frame.locator('#questionHost input:not([type="radio"]):not([type="checkbox"])');await inputs.first().waitFor();assert.equal(await inputs.count(),7);
  for(let i=0;i<7;i++)await inputs.nth(i).fill('audit');await frame.locator('#submitBtn2').click();await frame.locator('#resultView').waitFor({state:'visible'});
  assert.equal(await frame.locator('.evidence-context-note').count(),7);
  await frame.locator('#redoBtn').click();await frame.locator('#rBack').click();assert.equal(await inputs.first().inputValue(),'audit');
  await frame.locator('#redoBtn').click();await frame.locator('#rGo').click();await frame.locator('#resultView').waitFor({state:'hidden'});
  assert.deepEqual(await inputs.evaluateAll(nodes=>nodes.map(node=>node.value)),Array(7).fill(''));
  await page.reload();await page.locator('iframe.listening-frame.is-ready').waitFor();frame=listening();await frame.locator('#questionHost input').first().waitFor();assert.deepEqual(await frame.locator('#questionHost input').evaluateAll(nodes=>nodes.map(node=>node.value)),Array(7).fill(''));
  console.log('PASS listening redo requires confirmation, clears only the selected section, survives refresh; evidence lead-in is disclosed');
  for(const section of ['prac_lsn_s2','prac_lsn_s3','prac_lsn_s4']){
   await frame.locator('[data-sec="'+section+'"]').click();await frame.locator('#submitBtn2').click();await frame.locator('#mGo').click();await frame.locator('#resultView').waitFor({state:'visible'});assert.equal(await frame.locator('#scoreTotal').innerText(),'/5');
  }
  assert.equal(requests.filter(row=>row.path==='/api/listening/attempts'&&row.method==='POST').length,4);
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.waitForTimeout(650);const metrics=await frame.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,nodes:[...document.querySelectorAll('body *')].filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1}).slice(0,12).map(node=>({class:node.className,text:node.textContent.slice(0,50),width:node.getBoundingClientRect().width,right:node.getBoundingClientRect().right}))}));assert(metrics.scroll<=metrics.width,JSON.stringify(metrics));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.setViewportSize({width:1440,height:900});
  console.log('PASS all four sections independently submit; results fit 390px and 320px');
  await go('subject/speaking');await page.locator('iframe.speaking-frame.is-ready').waitFor();frame=speaking();await frame.getByRole('button',{name:'检测麦克风',exact:true}).click();await frame.getByRole('button',{name:'开始试录',exact:true}).click();
  await frame.locator('#probe-clock').waitFor();await page.waitForTimeout(1400);assert.notEqual(await frame.locator('#probe-clock').innerText(),'00:00');
  const heights=await frame.locator('#dialog .meter i').evaluateAll(nodes=>nodes.map(n=>parseFloat(n.style.height)).filter(Number.isFinite));assert(heights.length===24&&heights.some(height=>height>7));
  await frame.getByRole('button',{name:'结束检测录音',exact:true}).click();await frame.getByRole('button',{name:'已听清，确认设备',exact:true}).click();
  await frame.getByRole('button',{name:'开始模考',exact:true}).click();
  const supported=await frame.evaluate(()=>typeof(window.SpeechRecognition||window.webkitSpeechRecognition)==='function');assert.equal(await frame.locator('#asr-opt').isChecked(),supported);assert.equal(await frame.locator('#asr-opt').isEnabled(),supported);
  if(supported){await frame.locator('#asr-opt').uncheck();await frame.locator('#dialog [data-action="close"]').click();await frame.getByRole('button',{name:'开始模考',exact:true}).click();assert(!await frame.locator('#asr-opt').isChecked());await frame.locator('#asr-opt').check();}
  await frame.getByRole('button',{name:'进入完整模考',exact:true}).click();
  const skip=frame.getByRole('button',{name:'跳过朗读',exact:true});await skip.waitFor();assert(await skip.isEnabled());await skip.click();await frame.getByRole('button',{name:'朗读题目',exact:true}).waitFor();assert(await frame.getByRole('button',{name:'开始回答',exact:true}).isEnabled());
  console.log('PASS microphone probe has real elapsed clock/input levels; narration skip stays operable and releases answer control');
  assert.deepEqual(errors,[]);assert.equal(requests.filter(row=>/^\/api\/(?:coach|soe)\//.test(row.path)&&row.method==='POST').length,0);console.log('PASS zero page errors, no paid model calls. '+temp);
 }catch(error){console.log('CONTROL_DIAGNOSTIC',requests.slice(-20),errors,await page.locator('.content').innerText().catch(()=>''));throw error;}finally{await browser.close();env.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
