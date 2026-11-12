import { embedded, scope } from './host-bridge.js';
import { cloud } from './cloud.js';
import { speakPrompt } from './audio.js';
import { enqueueScore, getScore, listScores, retryScore, runScoreQueue, scoreMarkup, watchScores } from './score-queue.js';

export const scoreNotice = '每轮录音自动保存。模考封卷同步后、对话回答发送后，会自动提交腾讯云评测；结果显示在成绩中。';
const currentOwner = () => scope ? 'host:'+scope : 'standalone:'+(cloud.userId || 'guest');
let owner, stop;
function connect() {
  const next = currentOwner();
  if(owner!==next) {
    stop?.();owner=next;
    // The host keeps the upload alive after the user opens history or another subject.
    stop=embedded ? null : runScoreQueue(owner);
  }
  return owner;
}
export function startScores(){ connect(); }
const keyFor = (kind,id,clip) => [kind,id,clip].join(':');
export function scheduleScore(kind,id,clip,label,blob,durationMs) {
  return enqueueScore(connect(), {key:keyFor(kind,id,clip),reportId:'rpt_sp_'+kind+'_'+id,label,durationMs},blob);
}
export function scoreSlot(kind,id,clip,legacyKey='') {
  return '<speaking-assessment data-key="'+encodeURIComponent(keyFor(kind,id,clip))+'" data-legacy="'+encodeURIComponent(legacyKey)+'"></speaking-assessment>';
}
class SpeakingAssessment extends HTMLElement {
  connectedCallback() {
    this.owner=connect();this.key=decodeURIComponent(this.dataset.key);
    this.stop=watchScores(this.owner,()=>void this.paint());
    this.addEventListener('click',this.clickScore);void this.paint();
  }
  disconnectedCallback(){this.stop?.();this.removeEventListener('click',this.clickScore);}
  async paint(){
    try {
      const row=await getScore(this.owner,this.key);
      if(!this.isConnected) return;
      this.row=row;
      // Older manual assessments can be shown without resending archived audio.
      if(!this.row && this.dataset.legacy) {
        const legacyKey=decodeURIComponent(this.dataset.legacy), raw=JSON.parse(localStorage.getItem(legacyKey));
        if(raw) {
          const [kind,id]=this.key.split(':');
          await enqueueScore(this.owner,{key:this.key,reportId:'rpt_sp_'+kind+'_'+id,label:'以往录音'},null,raw);
          return;
        }
      }
      const html=scoreMarkup(this.row);
      if(this.cachedHTML!==html){this.innerHTML=html;this.cachedHTML=html;}
    } catch { this.textContent='无法读取本机评测记录。'; }
  }
  clickScore=async event=>{
    const sample=event.target.closest('[data-sample]');
    if(sample){
      const ok=await speakPrompt(sample.dataset.sample);
      if (!ok && this.isConnected && !this.querySelector('[role="alert"]')) {
        const note=document.createElement('small');note.setAttribute('role','alert');note.textContent='此浏览器暂不能播放英文示范音。';this.append(note);
      }
    }else if(event.target.closest('[data-score-retry]')) await retryScore(this.owner,this.key);
  };
}
if(!customElements.get('speaking-assessment'))customElements.define('speaking-assessment',SpeakingAssessment);

export function scoreSummary(kind,id) {
  return '<speaking-score-summary data-report="'+encodeURIComponent('rpt_sp_'+kind+'_'+id)+'"></speaking-score-summary>';
}
class SpeakingScoreSummary extends HTMLElement {
  connectedCallback() {
    const owner=connect(),id=decodeURIComponent(this.dataset.report);
    let version=0;
    const render=async()=>{
      const generation=++version;
      const rows=(await listScores(owner)).filter(row=>row.reportId===id);
      if(!this.isConnected || version!==generation)return;
      const ready=rows.filter(row=>row.state==='ready');
      const failed=rows.filter(row=>row.state==='error');
      const waiting=rows.filter(row=>row.state==='waiting-session');
      const pending=rows.length-ready.length-failed.length-waiting.length;
      const average=key=>{
        const metrics=ready.map(row=>row[key]).filter(Number.isFinite);
        if(!metrics.length)return '—';
        return (metrics.reduce((sum,n)=>sum+n,0)/metrics.length).toFixed(1);
      };
      if(!rows.length){this.replaceChildren();return;}
      const progress=ready.length+' / '+rows.length+' 段已完成';
      const status=ready.length ? '<span>平均发音准确度 <b>'+average('accuracy')+'</b> / 100</span><span>平均流利度 <b>'+average('fluency')+'</b> / 100</span>' :
        pending ? '正在自动评测录音…' : waiting.length ? '录音已保存，封卷同步后自动评测。' : '本场未取得有效评分，请查看下方逐段原因；原录音仍可回听。';
      const details=[pending?pending+' 段评测中':'',waiting.length?waiting.length+' 段待封卷同步':'',failed.length?failed.length+' 段需查看原因':''].filter(Boolean).join(' · ');
      this.innerHTML='<section class="speech-summary"><div><h2>本场发音成绩</h2><small>'+progress+'</small></div><p class="speech-metrics">'+status+'</p>'+(details?'<p class="note">'+details+'</p>':'')+'</section>';
    };
    const update=()=>{void render().catch(()=>{});};
    this.stop=watchScores(owner,update);update();
  }
  disconnectedCallback(){this.stop?.();}
}
if(!customElements.get('speaking-score-summary')) customElements.define('speaking-score-summary',SpeakingScoreSummary);
