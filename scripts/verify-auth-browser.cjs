const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(require('os').tmpdir(),'auth-browser-'));
const {chromium}=require(path.join(root,'node_modules/playwright-core'));
(async()=>{
 const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')));
 const dist=path.join(out,'dist');await build({root,logLevel:'error',build:{outDir:dist}});
 const {speakingApi}=await import(pathToFileURL(path.join(root,'scripts/speaking-api.mjs'))),{openLocalBindings}=await import(pathToFileURL(path.join(root,'modules/speaking/scripts/local-bindings.mjs'))),{publicCloudScript}=await import(pathToFileURL(path.join(root,'scripts/public-config.mjs')));
 const env=openLocalBindings(path.join(out,'db'),{campus:true});
 const origin='https://auth-1111.test',browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.env.USERPROFILE+'/AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe'});
 let page,context,mode='existing',configured=true;const calls=[],errors=[];
 async function fresh(){if(context)await context.close();context=await browser.newContext();page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin,'no old-app or external requests');
   if(url.pathname==='/cloud-config.js')return route.fulfill({contentType:'application/javascript',body:publicCloudScript(configured?{WORKBUDDY_PUBLISHABLE_KEY:'wbpk_test_public_only'}:{})});
   if(url.pathname.endsWith('/v1/verification')){
    calls.push({path:url.pathname,body:req.postDataJSON()});
    if(mode==='delay')await new Promise(r=>setTimeout(r,500));
    if(mode==='failure')return route.fulfill({status:501,json:{message:'not configured',error:'not_enabled'}});
    if(mode==='invalid')return route.fulfill({json:{}});
    return route.fulfill({json:{verification_id:'unit-challenge',is_user:mode!=='signup'}});
   }
   if(url.pathname.endsWith('/v1/verification/verify')){calls.push({path:url.pathname,body:req.postDataJSON()});return route.fulfill({json:{verification_token:'unit-verification-token'}});}
   if(/\/v1\/(signin|signup)$/.test(url.pathname)){calls.push({path:url.pathname,body:req.postDataJSON()});return route.fulfill({json:{access_token:'unit-access-token',refresh_token:'unit-refresh',expires_in:3600,...(mode==='unidentified'?{}:{sub:'auth-account',name:'验证账号'})}});}
   if(url.pathname.startsWith('/.cloud/'))return route.fulfill({json:[]});
   if(url.pathname.startsWith('/api/')){const response=await speakingApi(new Request(url,{method:req.method(),headers:await req.allHeaders(),body:req.postDataBuffer()??undefined}),env);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}
   const file=path.join(dist,url.pathname==='/'?'index.html':url.pathname);return fs.existsSync(file)?route.fulfill({path:file}):route.fulfill({status:404,body:''});
  });await page.goto(origin+'/?cloud=1#/auth');await page.getByPlaceholder('请输入 11 位手机号').waitFor();
 }
 try{
  configured=false;await fresh();await page.getByPlaceholder('请输入 11 位手机号').fill('13800000000');await page.getByRole('button',{name:'发送短信验证码',exact:true}).click();await page.getByText('当前站点的验证码服务配置尚未就绪',{exact:false}).first().waitFor();assert.equal(calls.length,0);
  console.log('PASS missing public config cannot claim OTP sent or contact deleted application');
  configured=true;mode='existing';await fresh();await page.getByPlaceholder('请输入 11 位手机号').fill('13800000000');await page.getByRole('button',{name:'发送短信验证码',exact:true}).click();await page.getByPlaceholder('数字验证码').waitFor();assert.equal(calls.at(-1).body.phone_number.replace(/\s/g,''),'+8613800000000');assert.equal(calls.at(-1).body.usage,undefined);
  assert(await page.getByRole('button',{name:/s 后重发/}).isDisabled());await page.getByRole('button',{name:'更换手机号',exact:true}).click();await page.getByPlaceholder('请输入 11 位手机号').fill('13900000000');await page.getByRole('button',{name:'发送短信验证码',exact:true}).click();await page.getByPlaceholder('数字验证码').fill('123456');await page.getByRole('button',{name:'验证并登录',exact:true}).click();await page.waitForURL(/#\/home/);assert(calls.some(c=>c.path.endsWith('/v1/signin')));assert(!calls.some(c=>c.path.endsWith('/v1/signup')));
  console.log('PASS actual SDK phone body, cooldown, change-recipient and existing-account verification');
  mode='signup';calls.length=0;await fresh();await page.getByRole('tab',{name:'邮箱',exact:true}).click();await page.getByPlaceholder('you@example.com').fill('unit@example.test');await page.getByRole('button',{name:'发送邮件验证码',exact:true}).click();await page.getByPlaceholder('数字验证码').fill('123456');await page.getByRole('button',{name:'验证并登录',exact:true}).click();await page.waitForURL(/#\/home/);assert(calls.some(c=>c.path.endsWith('/v1/signup')));assert.equal(calls[0].body.email,'unit@example.test');assert.equal(calls[0].body.usage,'email');
  console.log('PASS actual SDK email/new-user registration follows verified upstream challenge');
  for(const failure of ['failure','invalid','unidentified']){mode=failure;await fresh();await page.getByPlaceholder('请输入 11 位手机号').fill('13800000000');await page.getByRole('button',{name:'发送短信验证码',exact:true}).click();if(failure==='unidentified'){await page.getByPlaceholder('数字验证码').fill('123456');await page.getByRole('button',{name:'验证并登录',exact:true}).click();}await page.locator('.form-msg.error').waitFor();assert(page.url().includes('#/auth'));}
  console.log('PASS disabled channel, malformed challenge and missing account identity cannot fake login');
  mode='delay';await fresh();await page.getByPlaceholder('请输入 11 位手机号').fill('13800000000');await page.getByRole('button',{name:'发送短信验证码',exact:true}).click();await page.getByRole('tab',{name:'邮箱',exact:true}).click();await page.waitForTimeout(700);assert.equal(await page.getByPlaceholder('数字验证码').count(),0);assert.equal(await page.locator('.form-msg.notice').count(),0);
  assert.deepEqual(errors,[]);await page.setViewportSize({width:320,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'auth-320.png')});
  console.log('PASS channel switching ignores stale send response; 320px layout; zero page errors. '+out);
 }finally{await browser.close();env.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
