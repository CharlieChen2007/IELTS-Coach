import { apiFetch, scopedKey } from './host-bridge.js';
const identityKey = scopedKey('speaking-campus-participant');
const queuePrefix = scopedKey('speaking-campus-event') + ':';
let draining = false;
let retryTimer = 0;

export function rememberParticipant(id) {
  try {
    if (id) localStorage.setItem(identityKey,id);
    else localStorage.removeItem(identityKey);
  } catch { /* Browsers can disable storage. */ }
}
export function currentParticipant() {
  try { return localStorage.getItem(identityKey) || ''; } catch { return ''; }
}
export function trackSpeaking(action, kind, id, answerId) {
  const participant = currentParticipant();
  if (!participant || location.protocol === 'file:') return;
  const record = {action,kind,id,answerId,participant,time:Date.now()};
  const key = queuePrefix + [participant,id,action,answerId || ''].join('/');
  try {
    if (!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify(record));
    void drainSpeakingEvents();
  } catch { /* Local-only practice is always available. */ }
}
export async function drainSpeakingEvents() {
  const who = currentParticipant();
  if (draining || !who || location.protocol === 'file:') return;
  draining = true;
  let retry = false;
  try {
    while (currentParticipant() === who) {
      const priority = {start:0,answer:1,finish:2};
      const items = Object.keys(localStorage).filter(key => key.startsWith(queuePrefix + who + '/'))
        .map(key => ({key,r:JSON.parse(localStorage.getItem(key) || 'null')})).filter(item => item.r)
        .sort((a,b) => a.r.time - b.r.time || priority[a.r.action] - priority[b.r.action]);
      const item = items[0];
      if (!item) break;
      if (Date.now() - item.r.time > 7200000) { localStorage.removeItem(item.key); continue; }
      const response = await apiFetch('/api/campus/solo/'+item.r.action,{method:'POST',
        headers:{'Content-Type':'application/json','X-Campus-Participant':who},
        body:JSON.stringify({kind:item.r.kind,id:item.r.id,answerId:item.r.answerId})});
      if (response.status >= 500 || response.status === 429) { retry = true; break; }
      if (response.status === 401 || response.status === 409) { rememberParticipant(''); break; }
      localStorage.removeItem(item.key);
      if (response.ok && item.r.action === 'finish') window.dispatchEvent(new Event('campus:progress'));
    }
  } catch { retry = true; }
  finally {
    draining = false;
    if (retry && !retryTimer) retryTimer = setTimeout(() => { retryTimer = 0; void drainSpeakingEvents(); },15000);
  }
}
window.addEventListener('online',drainSpeakingEvents);
