import { prepareSoeSegments } from './acoustics.js';

const databases = new Map();
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inRange = n => Number.isFinite(n) && n >= 0 && n <= 100;
const events = new EventTarget();
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('ielts-speech-updates') : null;
function notify(owner, remote = true) {
  events.dispatchEvent(new CustomEvent('update',{detail:owner}));
  if (remote) channel?.postMessage(owner);
}
if(channel) channel.onmessage = e => notify(e.data,false);
function database(owner) {
  if(!databases.has(owner)) {
    const opened = new Promise((resolve,reject) => {
      const req = indexedDB.open('ielts-speech-evaluations:'+owner,2);
      req.onupgradeneeded = event => {
        if(event.oldVersion<1) {
          req.result.createObjectStore('jobs',{keyPath:'key'});
          req.result.createObjectStore('audio');
        }
        req.transaction.objectStore('jobs').createIndex('available',['state','after']);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    databases.set(owner,opened);
    opened.catch(()=>databases.delete(owner));
  }
  return databases.get(owner);
}
async function transact(owner,stores,mode,run) {
  const db = await database(owner);
  return new Promise((resolve,reject) => {
    const tx = db.transaction(stores,mode);
    let result;
    run(tx,value=>{result=value;});
    tx.oncomplete = ()=>resolve(result);
    tx.onerror = tx.onabort = ()=>reject(tx.error || new Error('无法保存发音评测。'));
  });
}
export function listScores(owner) {
  return transact(owner,['jobs'],'readonly',(tx,done)=>{
    const req=tx.objectStore('jobs').getAll();req.onsuccess=()=>done(req.result);
  });
}
export function getScore(owner,key) {
  return transact(owner,['jobs'],'readonly',(tx,done)=>{
    const req=tx.objectStore('jobs').get(key);req.onsuccess=()=>done(req.result);
  });
}
export async function enqueueScore(owner, spec, blob, legacy = null) {
  if(!blob?.size && !legacy) return;
  await transact(owner,['jobs','audio'],'readwrite',(tx)=>{
    const jobs=tx.objectStore('jobs'), lookup=jobs.get(spec.key);
    lookup.onsuccess=()=>{
      if(lookup.result) return;
      const row={...spec, created:Date.now(), requestId:crypto.randomUUID(), attempts:0,
        state:legacy?'ready':'queued',after:0};
      if(legacy) Object.assign(row,summarize(legacy));
      else tx.objectStore('audio').put(blob,spec.key);
      jobs.add(row);
    };
  });
  notify(owner);
}
function summarize(data) {
  if(!inRange(data?.accuracy) && !inRange(data?.fluency) && !data?.words?.some(w=>inRange(w?.accuracy))) throw Error('评测服务没有返回有效的发音指标。');
  const low=new Map();
  let scored=0;
  for(const w of data.words || []) {
    if(typeof w?.word !== 'string' || !inRange(w.accuracy) || !/^[a-z]+(?:['’-][a-z]+)*$/i.test(w.word)) continue;
    scored++;
    if(w.accuracy>=80) continue;
    const key=w.word.toLowerCase();
    if(!low.has(key) || low.get(key).accuracy > w.accuracy) low.set(key,{word:w.word,accuracy:w.accuracy});
  }
  return {accuracy:inRange(data.accuracy)?data.accuracy:null,fluency:inRange(data.fluency)?data.fluency:null,scored,
    words:[...low.values()].sort((a,b)=>a.accuracy-b.accuracy)};
}
async function claim(owner, exclusive) {
  return transact(owner,['jobs','audio'],'readwrite',(tx,done)=>{
    const jobs=tx.objectStore('jobs');
    function firstDue(state) {
      // Acquiring this owner's Web Lock proves that any former consumer (including
      // a refreshed document) has released it. Reclaim immediately in that case.
      const until=exclusive && state==='working' ? Number.MAX_SAFE_INTEGER : Date.now();
      const req=jobs.index('available').get(IDBKeyRange.bound([state,0],[state,until]));
      req.onsuccess=()=>{
        const job=req.result;
        if(!job) {if(state==='queued') firstDue('working');return;}
        const read=tx.objectStore('audio').get(job.key);
        read.onsuccess=()=>{
          job.state='working';job.after=Date.now()+120000;job.attempts++;
          job.runId=crypto.randomUUID();jobs.put(job);done({job,blob:read.result});
        };
      };
    }
    firstDue('queued');
  });
}
async function finish(owner,job,update,removeAudio) {
  await transact(owner,['jobs','audio'],'readwrite',tx=>{
    const jobs=tx.objectStore('jobs'),req=jobs.get(job.key);
    req.onsuccess=()=>{
      if(req.result?.runId!==job.runId) return;
      const next={...req.result,...update};
      if(next.state==='waiting-session'&&req.result.sealed){next.state='queued';next.after=0;next.message='';}
      jobs.put(next);
      if(removeAudio) tx.objectStore('audio').delete(job.key);
    };
  });
  notify(owner);
}
export async function releaseSessionScores(owner,sessionId){
  const ids=new Set(Array.isArray(sessionId)?sessionId:[sessionId]);
  await transact(owner,['jobs'],'readwrite',tx=>{
    const store=tx.objectStore('jobs'),read=store.getAll();
    read.onsuccess=()=>{for(const row of read.result){const [kind,id]=row.key.split(':');if(kind!=='exam'||!ids.has(id)||row.sealed&&row.state!=='waiting-session')continue;
      row.sealed=true;if(row.state==='waiting-session'){row.state='queued';row.after=0;row.message='';}store.put(row);}}
  });notify(owner);
}
async function evaluate(owner,{job,blob}) {
  let processing=false;
  const parts=Array.isArray(job.parts)?job.parts.slice():[];
  let total=0;
  try {
    const [kind,sessionId]=job.key.split(':');
    if(kind==='exam'&&!job.sealed){
      const headers={};if(owner.startsWith('host:'))headers['X-Speaking-Scope']=owner.slice(5);
      const state=await fetch('/api/sessions/'+encodeURIComponent(sessionId),{headers,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000)});
      if([401,404].includes(state.status)){await state.body?.cancel();await finish(owner,job,{state:'waiting-session',after:0,message:'等待本场封卷同步后自动评测。'},false);return;}
      if(!state.ok){const error=Error('暂时无法确认封卷同步状态。');error.status=state.status;throw error;}
      await state.body?.cancel();
    }
    const {clips,durationMs}=await prepareSoeSegments(blob);
    total=clips.length;
    processing=true;
    for(let i=parts.length;i<clips.length;i++) {
      const {audio,weight}=clips[i];
      const [kind,sessionId,questionId]=job.key.split(':');
      const context=kind==='exam'?{kind,sessionId,questionId,segmentIndex:i,segmentCount:clips.length}:undefined;
      const headers={'Content-Type':'application/json'};
      if(owner.startsWith('host:'))headers['X-Speaking-Scope']=owner.slice(5);
      const response=await fetch('/api/soe/evaluate',{method:'POST',credentials:'same-origin',redirect:'error',
        headers,body:JSON.stringify({audio,requestId:job.requestId,context}),
        signal:AbortSignal.timeout(85000)});
      const data=await response.json();
      if(!response.ok) {
        if(data.code==='SOE_SESSION_PENDING'){await finish(owner,job,{state:'waiting-session',after:0,message:'等待本场封卷同步后自动评测。'},false);return;}
        if(data.code==='SOE_IN_PROGRESS'){await finish(owner,job,{state:'queued',after:Date.now()+3500,message:''},false);return;}
        const error=Error(data.error || '发音评测暂时不可用。');error.status=response.status;throw error;
      }
      parts.push({metrics:summarize(data),weight});
      if(total>1) await finish(owner,job,{parts,after:Date.now()+120000,message:'已评测 '+parts.length+' / '+total+' 段'},false);
    }
    const weighted = key=>{
      const valid=parts.filter(part=>inRange(part.metrics[key]));
      return valid.length ? Math.round(10*valid.reduce((n,part)=>n+part.metrics[key]*part.weight,0)/valid.reduce((n,part)=>n+part.weight,0))/10 : null;
    };
    const uniqueWords=new Map();
    for(const {metrics} of parts) {
      for(const word of metrics.words) {
        const key=word.word.toLowerCase(), prior=uniqueWords.get(key);
        if(!prior || prior.accuracy>word.accuracy) uniqueWords.set(key,word);
      }
    }
    const result={accuracy:weighted('accuracy'),fluency:weighted('fluency'),
      words:[...uniqueWords.values()].sort((a,b)=>a.accuracy-b.accuracy)};
    result.scored=parts.reduce((n,part)=>n+part.metrics.scored,0);
    await finish(owner,job,{state:'ready',message:'',parts:null,durationMs,segments:parts.length,...result},true);
  } catch(error) {
    const retryable=processing && ![400,422].includes(error.status);
    const prefix=parts.length?'已评测 '+parts.length+' / '+total+' 段。':'';
    const message=prefix+(error.message && (error.status || !processing) ? error.message : '连接语音评测服务失败。');
    const again=retryable && !error.status && job.attempts<2;
    await finish(owner,job,{state:again?'queued':'error',retryable,message,after:Date.now()+6000},!retryable);
  }
}
export async function retryScore(owner,key) {
  await transact(owner,['jobs'],'readwrite',tx=>{
    const jobs=tx.objectStore('jobs'),req=jobs.get(key);
    req.onsuccess=()=>{const row=req.result;if(row?.state==='error' && row.retryable) jobs.put({...row,state:'queued',after:0,attempts:0});};
  }); notify(owner);
}
export function watchScores(owner,update) {
  function changed(e){if(e.detail===owner) update();}
  events.addEventListener('update',changed);
  return ()=>events.removeEventListener('update',changed);
}
export function runScoreQueue(owner) {
  let running=false,disposed=false;
  async function drain(exclusive) {
    while(!disposed) {
      const work=await claim(owner,exclusive);
      if(!work) break;
      notify(owner);await evaluate(owner,work);
    }
  }
  async function pump() {
    if(running || disposed || !navigator.onLine) return;
    running=true;
    try{
      if(navigator.locks) await navigator.locks.request('ielts-speaking-assessment:'+owner,
        {ifAvailable:true}, lock=>lock ? drain(true) : undefined);
      else await drain(false);
    }catch{/* The recording remains in the source exercise when local storage is unavailable. */}
    finally{running=false;}
  }
  const stopWatch=watchScores(owner,pump);
  const timer=setInterval(pump,6000);window.addEventListener('online',pump);void pump();
  return ()=>{disposed=true;clearInterval(timer);stopWatch();window.removeEventListener('online',pump);};
}
export function scoreMarkup(row) {
  if(!row) return '';
  if(row.state!=='ready') return '<div class="speech-score-note" role="status">'+
    escapeText(row.message || '发音评测中…')+
    (row.state==='error' && row.retryable?' <button type="button" class="btn btn-secondary" data-score-retry>重试评测</button>':'')+'</div>';
  const metric=(title,value)=>inRange(value)?'<span>'+title+' <b>'+value+'</b><small> / 100</small></span>':'';
  return '<div class="speech-score-card"><div class="speech-metrics">'+metric('发音准确度',row.accuracy)+metric('流利度',row.fluency)+'</div>'+
    (row.words?.length?'<p>需留意的发音 <small>词准确度低于 80</small></p><div class="speech-words">'+row.words.map(w=>
      '<button type="button" data-sample="'+escapeText(w.word)+'" aria-label="播放 '+escapeText(w.word)+' 的英语示范音"><span lang="en">'+escapeText(w.word)+'</span><small>'+w.accuracy+'</small><span aria-hidden="true">▶</span></button>').join('')+'</div>':
      '<p>'+ (row.scored?'这段回答没有低于 80 分的单词。':'本次未返回逐词准确度。')+'</p>')+
    (row.segments>1?'<small>长回答分 '+row.segments+' 段评测，按有效发声时长加权。</small>':'')+'</div>';
}
