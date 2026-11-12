// The speaking module also runs as a standalone site. An embedded workspace
// accepts navigation only from the same-origin parent that opened the frame.
const params = new URLSearchParams(globalThis.location?.search);
export const embedded = typeof window !== 'undefined' && window.parent !== window &&
  params.get('embedded') === '1' && (() => {
    try { return window.parent.location.origin === location.origin; } catch { return false; }
  })();
export const scope = embedded ? encodeURIComponent(params.get('scope') || 'guest') : '';
export const nickname = embedded ? (params.get('nickname') || '').slice(0, 24) : '';
export const scopedKey = key => scope ? key + ':host:' + scope : key;

export function apiFetch(path, options = {}) {
  if (!scope) return fetch(path, options);
  const url = new URL(path, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) throw Error('无效的口语服务地址。');
  const headers = new Headers(options.headers);
  headers.set('X-Speaking-Scope', scope);
  return fetch(url, {...options, headers});
}
function post(type, data) {
  if (embedded) parent.postMessage({source:'ielts-speaking', type, ...data}, location.origin);
}
const busyParts = new Set();
let navigationRevision = 0;
export function announceHostReady(initialRoute) {
  post('ready', {initialRoute, route:location.hash.slice(1)});
}
export function setBusy(part, busy) {
  const wasBusy = busyParts.size > 0;
  if (busy) busyParts.add(part); else busyParts.delete(part);
  if (wasBusy !== (busyParts.size > 0)) post('busy', {busy:busyParts.size > 0});
}
export function reportRoute(route) {
  if (!embedded) return;
  if (location.hash !== '#' + route) window.history.replaceState(null, '', '#' + route);
  post('route', {route, revision:navigationRevision});
}
export function reportResult(result, responses = []) {
  if (!embedded || !result.turns || !Number.isFinite(result.endedAt)) return;
  post('result', {result:{...result, responses:responses.slice(0, 80).map(row => ({
    question:String(row.question ?? row.prompt ?? '').slice(0, 1200),
    answer:String(row.answer ?? row.transcript ?? '').slice(0, 3000)
  }))}});
}
export function publishExam(row, band) {
  const turnCount = Array.isArray(row?.turns) ? row.turns.length : row?.turnCount;
  if (row?.status !== 'submitted' || !Number.isInteger(turnCount) || turnCount < 1 || turnCount > 80) return;
  const result = {kind:'exam', id:row.id, title:row.mode === 'quick' ? '快速口语演练' : '完整口语模考',
    mode:row.mode, startedAt:row.createdAt, endedAt:row.submittedAt, turns:turnCount, route:'exam/' + row.id};
  if (row.mode === 'full' && Number.isFinite(band) && band >= 0 && band <= 9) result.band = band;
  reportResult(result, row.turns || []);
}
export function publishDialogue(row) {
  if (row?.endedAt && row.turns?.length) reportResult({kind:'dialogue', id:row.id, title:row.topic,
    startedAt:row.createdAt, endedAt:row.endedAt, turns:row.turns.length, route:'dialogue/' + row.id}, row.turns);
}
export function connectHost(onNavigate) {
  if (!embedded) return;
  document.documentElement.classList.add('host-embedded');
  let latestRequest = 0;
  let navigation = Promise.resolve();
  window.addEventListener('message', event => {
    const data = event.data;
    const requestRevision = data?.revision ?? latestRequest + 1;
    if (event.origin === location.origin && event.source === parent && data?.source === 'ielts-coach' &&
      data.type === 'navigate' && typeof data.route === 'string' &&
      Number.isSafeInteger(requestRevision) && requestRevision > latestRequest) {
      latestRequest = requestRevision;
      navigation = navigation.then(async () => {
        if (requestRevision !== latestRequest) return;
        navigationRevision = requestRevision;
        await onNavigate(data.route);
      }).catch(error => console.error('口语页面切换失败', error.message));
    }
  });
  const sizing=()=>window.CoachFrameLayout.observe(height=>post('size',{height}));
  if(window.CoachFrameLayout)sizing();else document.addEventListener('coach:frame-layout-ready',sizing,{once:true});
  const frame = window.frameElement;
  function positionOverlays() {
    if (!frame) return;
    const box = frame.getBoundingClientRect();
    const start = Math.max(0, -box.top);
    const end = Math.min(box.height, parent.innerHeight - box.top);
    const visible = Math.max(120, end - start);
    document.documentElement.style.setProperty('--visible-mid', (start + visible / 2) + 'px');
    document.documentElement.style.setProperty('--visible-end', (start + visible) + 'px');
    document.documentElement.style.setProperty('--visible-height', visible + 'px');
  }
  parent.addEventListener('scroll', positionOverlays, true);
  parent.addEventListener('resize', positionOverlays);
  window.addEventListener('resize', positionOverlays);
  window.addEventListener('pagehide', () => {
    parent.removeEventListener('scroll', positionOverlays, true);
    parent.removeEventListener('resize', positionOverlays);
  }, {once:true});
  positionOverlays();
}
