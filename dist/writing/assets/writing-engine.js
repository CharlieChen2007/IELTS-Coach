const scope=new URLSearchParams(location.search).get('scope')||'guest-local';
export async function evaluateWriting(input,signal){
  const response=await fetch('/api/writing/evaluate',{method:'POST',credentials:'same-origin',cache:'no-store',signal,
    headers:{'Content-Type':'application/json','X-Speaking-Scope':scope},body:JSON.stringify(input)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok){const e=body.error||{};throw Object.assign(new Error((e.message||'批改暂未完成，原稿已保留。')+(e.traceId?'（编号 '+e.traceId+'）':'')),{code:e.code||'AI_UNAVAILABLE',requestId:e.traceId,retryable:true});}
  return body.report;
}
