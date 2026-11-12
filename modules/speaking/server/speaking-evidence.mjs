const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(value);
const percent=value=>Number.isFinite(value)&&value>=0&&value<=100;

// Measurements come from exactly the PCM submitted to Tencent, not client scores.
function pcmMetrics(pcm){
  const samples=pcm.length/2,view=new DataView(pcm.buffer,pcm.byteOffset,pcm.byteLength),levels=[];
  for(let start=0;start<samples;start+=320){
    const end=Math.min(start+320,samples);let sum=0,squares=0;
    for(let i=start;i<end;i++){const x=view.getInt16(i*2,true)/32768;sum+=x;squares+=x*x;}
    levels.push(Math.sqrt(Math.max(0,squares/(end-start)-(sum/(end-start))**2)));
  }
  const sorted=[...levels].sort((a,b)=>a-b),low=sorted[Math.floor(sorted.length*.15)]||0,high=sorted[Math.floor(sorted.length*.98)]||0;
  const threshold=Math.max(.004,high*.075,Math.min(low*2.3,high*.45));
  const windows=[];
  for(let i=0;i<levels.length;){if(levels[i]<threshold){i++;continue;}const first=i;while(i<levels.length&&levels[i]>=threshold)i++;if(i-first<3)continue;
    const start=first*20,end=Math.min(samples/16,i*20),previous=windows.at(-1);
    if(previous&&start-previous.end<=181)previous.end=end;else windows.push({start,end});}
  let pauses=0,longest=0;for(let i=1;i<windows.length;i++){const gap=windows[i].start-windows[i-1].end;if(gap>=600){pauses++;longest=Math.max(longest,gap);}}
  return {durationMs:Math.round(samples/16),activeMs:Math.round(windows.reduce((sum,w)=>sum+w.end-w.start,0)),pauseCount:pauses,longestPauseMs:Math.round(longest)};
}

export async function saveSoeEvidence(env,owner,input,receipt,pcm,result){
  const context=input?.context;
  if(!owner||!receipt?.startsWith(owner+'/')||input.word!==undefined&&input.word!==null||context?.kind!=='exam'||!identifier(context.sessionId)||!identifier(context.questionId))return;
  const index=context.segmentIndex,count=context.segmentCount;
  if(!Number.isInteger(index)||!Number.isInteger(count)||count<1||count>16||index<0||index>=count)return;
  const session=await env.DB.prepare('SELECT metadata_json FROM speaking_sessions WHERE owner_id=? AND session_id=? AND ready=1').bind(owner,context.sessionId).first();
  if(!session||!JSON.parse(session.metadata_json).turns.some(turn=>turn.questionId===context.questionId))return;
  // A successful, server-produced receipt is required even on a retry. No
  // client metrics are accepted. A report later joins this to its own sealed turn.
  const row=await env.DB.prepare('SELECT result_json FROM speaking_soe_receipts WHERE request_key=?').bind(receipt).first();
  if(!row?.result_json)return;
  const metrics=pcmMetrics(pcm),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pcm)),b=>b.toString(16).padStart(2,'0')).join('');
  const replay=await env.DB.prepare('SELECT 1 FROM speaking_soe_evidence WHERE owner_id=? AND pcm_hash=? AND NOT(session_id=? AND question_id=? AND segment_index=?)').bind(owner,hash,context.sessionId,context.questionId,index).first();
  if(replay)return;
  await env.DB.prepare('INSERT INTO speaking_soe_evidence(owner_id,session_id,question_id,segment_index,segment_count,request_key,pcm_hash,evaluated_at,duration_ms,active_ms,pause_count,longest_pause_ms,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,session_id,question_id,segment_index) DO NOTHING')
    .bind(owner,context.sessionId,context.questionId,index,count,receipt,hash,Date.now(),metrics.durationMs,metrics.activeMs,metrics.pauseCount,metrics.longestPauseMs,row.result_json).run();
}

export async function sessionSoeEvidence(db,owner,session){
  const {results}=await db.prepare('SELECT e.* FROM speaking_soe_evidence e JOIN speaking_soe_receipts r ON r.request_key=e.request_key AND r.result_json=e.result_json WHERE e.owner_id=? AND e.session_id=? ORDER BY e.question_id,e.segment_index').bind(owner,session.id).all();
  const turns=[];
  for(const turn of session.turns){
    const rows=results.filter(row=>row.question_id===turn.questionId),count=rows[0]?.segment_count;
    if(!count||rows.length!==count||rows.some((row,i)=>row.segment_count!==count||row.segment_index!==i))continue;
    const durationMs=rows.reduce((sum,row)=>sum+row.duration_ms,0);
    // Resampling can vary slightly, but a 2-second excerpt cannot prove a
    // two-minute answer. Incomplete or mismatched evidence stays unavailable.
    if(Math.abs(durationMs-turn.durationMs)>Math.max(1800,turn.durationMs*.08))continue;
    let accuracy=0,fluency=0,aw=0,fw=0;const words=[];
    for(const row of rows){let result;try{result=JSON.parse(row.result_json);}catch{continue;}const weight=Math.max(1,row.active_ms);
      if(percent(result.accuracy)){accuracy+=result.accuracy*weight;aw+=weight;}if(percent(result.fluency)){fluency+=result.fluency*weight;fw+=weight;}
      for(const word of result.words||[])if(typeof word?.word==='string'&&percent(word.accuracy)&&word.accuracy<80)words.push({word:word.word.slice(0,64),accuracy:word.accuracy});}
    turns.push({questionId:turn.questionId,part:turn.part,accuracy:aw?Math.round(accuracy/aw*10)/10:null,fluency:fw?Math.round(fluency/fw*10)/10:null,
      durationMs,activeMs:rows.reduce((sum,row)=>sum+row.active_ms,0),pauseCount:rows.reduce((sum,row)=>sum+row.pause_count,0),longestPauseMs:Math.max(...rows.map(row=>row.longest_pause_ms)),
      words:words.sort((a,b)=>a.accuracy-b.accuracy).slice(0,12),receiptKeys:rows.map(row=>row.request_key)});
  }
  const fingerprint=JSON.stringify(turns.map(turn=>[turn.questionId,turn.receiptKeys]));
  const version=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint))),b=>b.toString(16).padStart(2,'0')).join('');
  return {turns,version};
}
