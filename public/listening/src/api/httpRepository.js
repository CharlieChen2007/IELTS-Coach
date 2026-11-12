/** Same-origin server adapter. A scope selects the host account's HttpOnly session cookie. */
export function createHttpRepository({scope}) {
  async function call(path, body) {
    const response = await fetch('/api/listening'+path,{
      method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',
      headers:{'X-Speaking-Scope':encodeURIComponent(scope),Accept:'application/json',
        ...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    if(!response.ok){
      const error = await response.json().catch(()=>({}));
      throw Error(error.error||'听力服务暂时无法响应，请重试。');
    }
    return response.json();
  }
  const id=encodeURIComponent;
  return {
    async listPractices(){return (await call('/practices')).items;},
    getPractice(section){return call('/practices/'+id(section));},
    getResult(section){return call('/practices/'+id(section)+'/result');},
    getAttempt(attempt){return call('/attempts/'+id(attempt));},
    async getProgress(){return (await call('/progress')).items;},
    submitAttempt({practiceId,answers,durationSec,replayBySegment}){
      return call('/attempts',{practice_id:practiceId,skill:'listening',
        answers:Object.entries(answers).map(([item_id,answer])=>({item_id,answer})),
        duration_sec:durationSec,replay_by_segment:replayBySegment});
    },
    async getWrongbook(section){return (await call('/wrongbook?practice_id='+id(section))).items;},
    updateErrorTag(entry,tag,section){
      return call('/wrongbook/'+id(entry)+'/tag?practice_id='+id(section),{practice_id:section,error_tag:tag});
    },
    getReviewItem(entry,mode,section){
      return call('/wrongbook/'+id(entry)+'/review-item?practice_id='+id(section)+'&mode='+id(mode));
    },
    submitReview({entryId,itemId,mode,answer,practiceId,requestId}){
      return call('/wrongbook/'+id(entryId)+'/review',{practice_id:practiceId,item_id:itemId,mode,answer,request_id:requestId});
    },
    reset(section){return call('/sections/'+id(section)+'/reset',{practice_id:section});}
  };
}
