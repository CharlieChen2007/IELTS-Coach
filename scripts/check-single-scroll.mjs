import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const base=(process.env.BASE_URL||'http://127.0.0.1:4216').replace(/\/$/,'');
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined);
const browser=await chromium.launch({executablePath,ignoreDefaultArgs:['--hide-scrollbars'],args:['--disable-features=OverlayScrollbar,OverlayScrollbars,FluentOverlayScrollbar']});
const routes=[...['s1','s2','s3','s4'].map(section=>'subject/listening?view=practice&section=prac_lsn_'+section),'subject/speaking','subject/speaking?view=practice','subject/speaking?view=campus','subject/speaking?view=campus-team','subject/speaking?view=history','subject/speaking?view=daily','subject/speaking?view=daily-library','subject/speaking?view=daily-history','vocabulary','subject/reading','subject/reading?view=practice','subject/reading?view=mistakes','subject/reading?view=vocab','subject/reading?view=readlib','subject/reading?view=weak','subject/reading?view=profile','subject/writing','subject/writing?view=practice','subject/writing?view=report','subject/writing?view=compare','subject/writing?view=history'];
let checks=0;
try{
 const context=await browser.newContext({viewport:{width:2048,height:1098}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/?demo=1#/auth');
 await page.getByPlaceholder('例如：Alex').fill('单轴滚动验收');
 await page.getByPlaceholder('you@example.com').fill('scroll-'+Date.now()+'@example.org');
 await page.getByRole('button',{name:'进入学习首页'}).click();
 await page.waitForURL(/#\/home/);await page.locator('#boot').waitFor({state:'detached'});
 await page.getByRole('button',{name:'进入演示模式',exact:true}).click();
 const scrollbar=await page.evaluate(()=>{const el=document.createElement('div');el.style.cssText='width:100px;height:100px;overflow:scroll;position:absolute';document.body.append(el);const width=el.offsetWidth-el.clientWidth;el.remove();return width;});
 assert(scrollbar>0,'测试必须启用真实占宽滚动条');console.log('经典滚动条宽度 '+scrollbar+'px');
 async function fit(label){
  for(const frame of page.frames().slice(1)){
   const state=await frame.evaluate(()=>({visible:!!window.frameElement?.getClientRects().length,ready:window.frameElement?.classList.contains('is-ready'),height:document.documentElement.clientHeight,scroll:document.documentElement.scrollHeight,width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,path:location.pathname}));
   if(!state.visible||!state.ready)continue;
   assert(state.scroll<=state.height+1,label+' 第二纵轴 '+JSON.stringify(state));
   assert(state.scrollWidth<=state.width+1,label+' 文档横向溢出 '+JSON.stringify(state));checks++;
  }
 }
 async function at(route){await page.evaluate(route=>{location.hash='#/'+route},route);}
 for(const width of [2048,390,320]){
  await page.setViewportSize({width,height:width===2048?1098:844});
  for(const route of routes){
   await at(route);await page.waitForTimeout(180);await fit(width+' '+route+' 动画中');
   await page.waitForTimeout(1000);await fit(width+' '+route+' 停止后');
  }
 }
 await at('vocabulary');await page.waitForTimeout(700);
 const vf=page.frames().find(frame=>frame.url().includes('/vocab/'));
 for(const tab of ['cards','dictation','curve','list']){
  await vf.locator('[data-nav="'+tab+'"]').click();await page.waitForTimeout(750);await fit('词汇 '+tab);
  if(tab==='curve')assert(Math.abs(await vf.locator('.vc-stack').evaluate(el=>[...el.children].reduce((n,child)=>n+parseFloat(child.style.width||0),0))-100)<.1,'800词掌握度分段合计100%');
 }
 assert.equal(await vf.locator('.vc-word').count(),24,'词表每页24词');
 await vf.getByRole('button',{name:'下一页',exact:true}).click();assert((await vf.locator('#vocabPaging').innerText()).includes('25–48'));
 await vf.locator('#vocabSearch').fill('sustainable');assert((await vf.locator('#vocabPaging').innerText()).includes('第 1 /'));
 await vf.locator('.vc-word').first().click();await page.waitForTimeout(700);await fit('词汇详情弹窗');
 await at('subject/writing?view=practice');await page.waitForTimeout(800);
 const wf=page.frames().find(frame=>frame.url().includes('/writing/'));
 await wf.getByRole('button',{name:'更换题目',exact:true}).click();await page.waitForTimeout(900);await fit('展开写作题库');
 assert.equal(await wf.locator('.question-bank-dialog').evaluate(el=>getComputedStyle(el).position),'static','题库进入文档自然撑高');
 for(const width of [1366,390,2048]){await page.setViewportSize({width,height:844});await page.waitForTimeout(850);await fit('展开题库 resize '+width);}
 assert.deepEqual(errors,[],'浏览器运行异常');console.log('PASS '+checks+' 次经典滚动条文档边界验收');
}finally{await browser.close();}
