/* 阅读宿主桥。先恢复当前账号的本机备份与服务端交卷快照，再挂载原生页面。
   普通页面由主站滚动；练习工作区的原文/题目各自滚动。 */
const params = new URLSearchParams(location.search);
export const embedded = window.parent !== window && params.get('embedded') === '1';
export const scope = params.get('scope') || 'guest-local';

const NS = 'yl.v1.';
const LOCAL_NS = embedded ? 'yl.scope.' + encodeURIComponent(scope) + '.' : NS;
const TS = 'ielts-reading-local-ts:' + encodeURIComponent(scope);
const DIRTY = TS + ':dirty';
let revision=Number(localStorage.getItem(DIRTY)||0);
const localKey=key=>LOCAL_NS+key.slice(NS.length);
const serverKey=key=>NS+key.slice(LOCAL_NS.length);
const VIEW_HASH = {
  overview: '#/',
  mistakes: '#/mistakes',
  vocab: '#/vocab',
  weak: '#/weak-types',
  readlib: '#/readlib',
  profile: '#/profile',
};
let restoring = false;

function post(type, data) {
  if (!embedded) return;
  try {
    window.parent.postMessage(Object.assign({ source: 'ielts-reading', type }, data || {}), location.origin);
  } catch (e) { /* 宿主未就绪时忽略 */ }
}

/* --------------------------------------------------------------------------
   1. 数据库状态：把 yl.v1.* 全量打包成一个 JSON 字符串备份到服务端
   -------------------------------------------------------------------------- */
function collectState() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LOCAL_NS)) out[serverKey(key)] = localStorage.getItem(key);
    }
  } catch (e) { /* 隐私模式 */ }
  return JSON.stringify(out);
}

function hasLocalState() {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      if ((localStorage.key(i) || '').startsWith(LOCAL_NS)) return true;
    }
  } catch (e) { /* 忽略 */ }
  return false;
}

function applyState(raw) {
  let map;
  try { map = JSON.parse(raw); } catch (e) { return false; }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  restoring = true;
  try {
    const stale=[];
    for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(LOCAL_NS))stale.push(key)}
    stale.forEach(key=>localStorage.removeItem(key));
    for (const [key, value] of Object.entries(map)) {
      if (/^yl\.v1\.[A-Za-z0-9._-]{1,120}$/.test(key) && typeof value === 'string') localStorage.setItem(localKey(key), value);
    }
  } finally { restoring = false; }
  return true;
}

function showSyncIssue(message){
  let box=document.getElementById('reading-sync-status');
  if(!box){box=document.createElement('aside');box.id='reading-sync-status';box.className='reading-sync-status';box.setAttribute('role','status');document.body.prepend(box)}
  box.replaceChildren(document.createTextNode(message+' '));
  const retry=document.createElement('button');retry.type='button';retry.textContent='重新同步';retry.addEventListener('click',()=>location.reload());box.append(retry);
}

export async function init() {
  if (!embedded) return;
  document.documentElement.classList.add('host-embedded');
  try {
    const ensure=async()=>{
      const headers={'X-Speaking-Scope':encodeURIComponent(scope)};
      const me=await fetch('/api/campus/me',{headers,cache:'no-store',signal:AbortSignal.timeout(5000)});
      if(me.ok&&(await me.json()).active)return;
      await fetch('/api/campus/session',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({nickname:(params.get('nickname')||'同学').slice(0,24)}),signal:AbortSignal.timeout(5000)});
    };
    if(navigator.locks)await navigator.locks.request('coach-campus-enrol:'+encodeURIComponent(scope),ensure);else await ensure();
    const res = await fetch('/api/reading/state?scope=' + encodeURIComponent(scope), {
      cache: 'no-store', credentials: 'same-origin',
      headers: { 'X-Speaking-Scope': encodeURIComponent(scope) },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw Error('读取校园备份失败');
    const body = await res.json().catch(() => null);
    if (!body) return;
    const localTs = Number(localStorage.getItem(TS) || 0);
    const dirty=Boolean(localStorage.getItem(DIRTY));
    /* 必须早于业务 bundle 挂载：否则会先闪一帧本机旧数据。 */
    if (!dirty && typeof body.data==='string' && (!hasLocalState() || Number(body.updatedAt || 0) > localTs)) applyState(body.data);
    const history=await fetch('/api/reading/attempts',{headers:{'X-Speaking-Scope':encodeURIComponent(scope)},cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(history.ok){
      const {items=[]}=await history.json();
      const previous=JSON.parse(localStorage.getItem(localKey(NS+'sessions'))||'[]');
      const all=[...new Map([...previous,...items].map(item=>[item.id,item])).values()].sort((a,b)=>b.finishedAt-a.finishedAt).slice(0,60);
      localStorage.setItem(localKey(NS+'sessions'),JSON.stringify(all));
      const {syncMistakes}=await import('../js/features/store.js');
      for(const session of [...items].reverse().filter(item=>!previous.some(old=>old.id===item.id)))syncMistakes(session,{id:session.passageId,title:session.passageTitle});
    }
  } catch (e) { showSyncIssue('暂时连不上学习空间，可以继续练习，本机记录已保留。'); }
}

function installStateSync() {
  try {
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;
    let timer = 0;
    let queue = Promise.resolve();
    /* 统一用 sendBeacon 投递：主站切换科目会把 iframe 直接从 DOM 移除，页面内的
       fetch 会被浏览器取消（net::ERR_ABORTED），beacon 由浏览器独立发送，不会中断。
       beacon 不能带自定义请求头，所以 scope 走 query；超过 64KB 上限时回退普通请求。 */
    const flush = () => {
      const state = collectState();
      if (state.length < 2) return;
      /* 嵌入态一律交给主站代发：主站 window 不销毁，请求不会被取消；iframe 内的
         fetch / beacon 在主站切换科目（iframe 被移除）时一定会被浏览器丢掉。 */
      if (embedded) {
        post('state', { state, scope, revision });
        return;
      }
      const body = JSON.stringify({ state });
      const url = '/api/reading/state?scope=' + encodeURIComponent(scope);
      if (body.length < 60000) {
        try {
          if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return;
        } catch (e) { /* 回退到普通请求 */ }
      }
      queue = queue.catch(() => {}).then(() => fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Speaking-Scope': scope },
        credentials: 'same-origin',
        keepalive: body.length < 60000,
        body,
      })).catch(() => {}); // 本机已存，下次打开会带上
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(flush, 450);
      if(embedded)flush();
      scheduleStats();
    };
    /* 卸载前把防抖里尚未发出的变更立即落库；beacon 保证在 iframe 被移除后仍能送达。 */
    window.addEventListener('pagehide', () => { clearTimeout(timer); flush(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { clearTimeout(timer); flush(); }
    });
    Storage.prototype.setItem = function (key, value) {
      originalSet.call(this, key, value);
      if (restoring || typeof key !== 'string' || !key.startsWith(LOCAL_NS)) return;
      revision=Math.max(Date.now(),revision+1);
      originalSet.call(localStorage,TS,String(revision));
      originalSet.call(localStorage,DIRTY,String(revision));
      schedule();
    };
    Storage.prototype.removeItem = function (key) {
      originalRemove.call(this, key);
      if (restoring || typeof key !== 'string' || !key.startsWith(LOCAL_NS)) return;
      revision=Math.max(Date.now(),revision+1);
      originalSet.call(localStorage,TS,String(revision));
      originalSet.call(localStorage,DIRTY,String(revision));
      schedule();
    };
    if(localStorage.getItem(DIRTY))flush();
  } catch (e) { /* 存储被禁用时跳过云端备份 */ }
}

/* --------------------------------------------------------------------------
   2. 高度 / 就绪：iframe 恒等于内容真实高度，自身不产生滚动条
   -------------------------------------------------------------------------- */
let report = () => {};
function installHeightSync(reportFn) {
  report = reportFn;
  try { new ResizeObserver(report).observe(document.documentElement); } catch (e) { /* 忽略 */ }
  try { new ResizeObserver(report).observe(document.body); } catch (e) { /* 忽略 */ }
  window.addEventListener('load', () => { report(); notifyReady(); });
  setTimeout(() => { report(); notifyReady(); }, 350);
  setTimeout(report, 1200);
  /* 换页（View Transition / replaceChildren）时补报，避免留白或裁切 */
  const app = document.getElementById('app');
  if (app) {
    let t = 0;
    try {
      new MutationObserver(() => {
        // The rendered app is the readiness signal. Height can be coalesced,
        // but delaying ready until a quiet 60ms window hid an already usable view.
        notifyReady();
        clearTimeout(t);
        t = setTimeout(() => { report(); notifyReady(); }, 60);
      }).observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    } catch (e) { /* 忽略 */ }
  }
}
let readySent = false;
function notifyReady() {
  if (readySent) return;
  if (!document.getElementById('app')?.children.length) return;
  readySent = true;
  post('ready');
}

/* --------------------------------------------------------------------------
   3. 单一滚动轴代理
      iframe 内 window 永远不真的滚动，proxyY 模拟「宿主相对 iframe 顶部的
      滚动量」，让 read.js 的「记住读到的地方」继续用 window.scrollY 工作。
      · window.scrollTo({top})  ← jumpToPara 用 rect.top + window.scrollY 算，
        需要减去 proxyY 才是文档坐标；忽略 top<=0（由主站切页统一回顶）。
      · window.scrollTo(x, y)   ← 恢复阅读位置，y 本身就是文档坐标。
      · Element.scrollIntoView ← 原文定位 / 题号跳转，直接取文档坐标。
   -------------------------------------------------------------------------- */
let proxyY = 0;
let splitWorkspace = false;
let splitHeight = 0;
let layoutFrame = 0;
function updatePracticeLayout() {
  layoutFrame = 0;
  const active = Boolean(document.querySelector('#app .mode-practice'));
  const entering = active && !splitWorkspace;
  const previous = splitWorkspace;
  splitWorkspace = active;
  document.documentElement.dataset.readingWorkspace = active ? 'split' : 'document';
  if (active) {
    let viewport = window.parent.innerHeight || 800, header = 77, bottom = 0;
    try {
      header = window.parent.document.querySelector('.topbar')?.offsetHeight || 77;
      const tabs = window.parent.document.querySelector('.tabbar');
      if (tabs?.getClientRects().length) bottom = tabs.offsetHeight;
    } catch { /* The same-origin host provides the normal viewport. */ }
    const notice = document.getElementById('reading-sync-status');
    const noticeHeight = notice ? notice.offsetHeight + (parseFloat(getComputedStyle(notice).marginBottom)||0) : 0;
    const next = Math.max(280, Math.round(viewport - header - bottom - 24 - noticeHeight));
    if (next !== splitHeight || entering) {
      splitHeight = next;
      document.documentElement.style.setProperty('--reading-workspace-height', next + 'px');
      post('practice-layout', { active: true, height: next + noticeHeight, enter: entering });
    }
  } else if (previous) {
    document.documentElement.style.removeProperty('--reading-workspace-height');
    splitHeight = 0;
    post('practice-layout', { active: false, enter: false });
  }
}
function schedulePracticeLayout() {
  if (!layoutFrame) layoutFrame = requestAnimationFrame(() => { updatePracticeLayout(); report(); });
}
function installScrollProxy() {
  try {
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => proxyY });
    Object.defineProperty(window, 'pageYOffset', { configurable: true, get: () => proxyY });
  } catch (e) { /* 不能遮蔽时退化为 0，定位仍可用 */ }

  window.scrollTo = function (first, second) {
    const isObject = first && typeof first === 'object';
    const top = isObject ? Number(first.top ?? 0) : (typeof second === 'number' ? second : Number(first || 0));
    if (!(top > 4)) return;                       // 切页归零交给主站路由处理
    const docTop = isObject ? Math.max(0, top - proxyY) : top;
    post('scrollTo', { top: Math.round(docTop), behavior: isObject ? (first.behavior || 'auto') : 'auto' });
  };

  try {
    const native = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (opts) {
      if (!embedded) return native.call(this, opts);
      const pane = splitWorkspace && this.closest('.pane');
      if (pane) {
        const box = this.getBoundingClientRect(), viewport = pane.getBoundingClientRect();
        const center = Math.max(12, (pane.clientHeight - box.height) / 2);
        const top = Math.max(0, pane.scrollTop + box.top - viewport.top - center);
        pane.scrollTo({top, behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
        return;
      }
      const rect = this.getBoundingClientRect();
      const center = Math.round((window.parent.innerHeight || 800) / 2.6);
      post('scrollTo', { top: Math.max(0, Math.round(rect.top - center)), behavior: 'smooth' });
    };
  } catch (e) { /* 忽略 */ }
}

function setProxyY(value) {
  const next = Math.max(0, Math.round(Number(value) || 0));
  if (Math.abs(next - proxyY) < 2) return;
  proxyY = next;
  try { window.dispatchEvent(new Event('scroll')); } catch (e) { /* 忽略 */ }
}

/* --------------------------------------------------------------------------
   4. 导航桥接：主站横向页签 ↔ 交接包原生 hash 路由
   -------------------------------------------------------------------------- */
function hashToView(hash) {
  const h = hash || '#/';
  if (/^#\/(?:practice|read)\//.test(h)) return 'practice';
  if (h.startsWith('#/mistakes')) return 'mistakes';
  if (h.startsWith('#/vocab')) return 'vocab';
  if (h.startsWith('#/weak-types')) return 'weak';
  if (h.startsWith('#/readlib')) return 'readlib';
  if (h.startsWith('#/profile')) return 'profile';
  return 'overview';
}

let practiceTarget = null;
let readingPool = 18;
let statsTimer = 0;

/** 科目横幅的个人进度口径与模块内一致（数据仍来自本机 / 数据库备份） */
function reportStats() {
  let attempts = 0;
  let band = null;
  let display = null;
  try {
    const sessions = JSON.parse(localStorage.getItem(localKey(NS + 'sessions')) || '[]');
    if (Array.isArray(sessions)) {
      attempts = sessions.length;
      const latest=sessions[0];
      if(Number.isInteger(latest?.correct)&&Number.isInteger(latest?.total)&&latest.total>0)display=latest.correct+' / '+latest.total;
    }
  } catch (e) { /* 忽略 */ }
  post('stats', { attempts, band, display, pool: readingPool, poolLabel: '精读篇目' });
}
function scheduleStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(reportStats, 220);
}

async function hashForView(view, passage) {
  if(view==='practice' && /^[A-Za-z0-9_-]{1,50}$/.test(passage||'')){practiceTarget='#/practice/'+passage;return practiceTarget;}
  if (view !== 'practice') return VIEW_HASH[view] || '#/';
  if (practiceTarget) return practiceTarget;
  /* 「篇章练习」落点：优先最近练过的一篇，否则题库第一篇。 */
  let id = '';
  try {
    const sessions = JSON.parse(localStorage.getItem(localKey(NS + 'sessions')) || '[]');
    if (Array.isArray(sessions) && sessions[0]?.passageId) id = String(sessions[0].passageId);
  } catch (e) { /* 忽略 */ }
  if (!id) {
    try {
      const ids = await (await fetch('content/passages/index.json', { cache: 'no-cache' })).json();
      if (Array.isArray(ids) && ids.length) {
        id = String(ids[0]);
        readingPool = ids.length;
      }
    } catch (e) { /* 忽略 */ }
  }
  practiceTarget = '#/practice/' + (id || 'p1');
  return practiceTarget;
}

function installNavigation() {
  window.addEventListener('hashchange', () => {
    const active=/^#\/(?:read|practice)\/([^/?]+)/.exec(location.hash);
    if(active)practiceTarget='#/practice/'+active[1];
    post('view', { view: hashToView(location.hash), reset: true });
    scheduleStats();
    setTimeout(report, 90);
    setTimeout(report, 320);
    setTimeout(report, 900);
  });
}

/* --------------------------------------------------------------------------
   5. 弹窗与提示：fixed 遮罩已改成页内卡片，通知主站滚过去；
      toast 由主站统一显示，避免落在 iframe 最底部看不见。
   -------------------------------------------------------------------------- */
function installOverlaysAndToast() {
  const OVERLAY = '.dlg-overlay, .rd-overlay';
  let lastReveal = 0;
  const revealIfAny = () => {
    const el = document.querySelector(OVERLAY);
    if (!el || Date.now() - lastReveal < 500) return;
    if (splitWorkspace) return; // Practice confirmations remain inside the visible workspace.
    lastReveal = Date.now();
    post('reveal', { top: Math.max(0, Math.round(el.getBoundingClientRect().top - 100)) });
  };
  try {
    new MutationObserver(revealIfAny).observe(document.body, { childList: true, subtree: true });
  } catch (e) { /* 忽略 */ }

  const box = document.getElementById('toast');
  if (!box) return;
  let last = '';
  let timer = 0;
  try {
    new MutationObserver(() => {
      const message = (box.textContent || '').trim();
      if (!message || !box.classList.contains('show') || message === last) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = message;
        post('toast', { message });
        setTimeout(() => { last = ''; }, 2400);
      }, 60);
    }).observe(box, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  } catch (e) { /* 忽略 */ }
}

/* --------------------------------------------------------------------------
   6. 宿主消息
   -------------------------------------------------------------------------- */
function contentHeight() {
  if (splitWorkspace) {
    const workspace = document.querySelector('#app .mode-practice');
    if (workspace) return Math.ceil(workspace.offsetTop + workspace.offsetHeight);
  }
  if(window.CoachFrameLayout)return window.CoachFrameLayout.height();
  const body = document.body;
  let bottom = body ? body.offsetTop + body.offsetHeight : 0;
  for (const el of document.documentElement.children) {
    if (el === body || el.tagName === 'HEAD' || el.tagName === 'SCRIPT' ||
        el.tagName === 'STYLE' || el.tagName === 'LINK') continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none') continue;
    bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
  }
  return Math.max(320, Math.ceil(bottom + 24));
}

function installHostMessages() {
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.source !== 'ielts-coach') return;
    /* 确认到达时 revision 可能已经又前进了一格（交卷时会连续写多次），
       只要服务端确认的版本不低于当前版本，就说明这台设备的进度已经落库。 */
    if(data.type==='persisted' && data.module==='reading' && Number(data.revision)>=revision){
      localStorage.removeItem(DIRTY);
      document.getElementById('reading-sync-status')?.remove();
    }
    if(data.type==='persist-error' && data.module==='reading')showSyncIssue('备份尚未完成，本机记录已保留。');
    if (data.type === 'navigate') {
      void hashForView(data.view,data.passage).then((target) => {
        if (location.hash !== target) location.hash = target;
        setTimeout(report, 120);
        setTimeout(report, 420);
      });
    }
    if (data.type === 'hostScroll') setProxyY(data.top);
    /* 从主站「学伴互助」切回来时 iframe 由隐藏恢复：补报真实高度，避免沿用
       隐藏期间的兜底值把内容裁掉。iframe 不卸载，所以仍走同一条消息通道。 */
    if (data.type === 'wake') { report(); setTimeout(report, 120); setTimeout(report, 420); }
  });
}

export function startSync() {
  if (!embedded) return;
  /* 不能直接用 documentElement.scrollHeight：它至少等于 iframe 视口高度。
     若 iframe 先按兜底值撑到 1600，scrollHeight 也报 1600，主站就永远收不回来
     （高度死锁）。改量「内容真实底部」，与 iframe 当前高度无关。 */
  const reportFn = () => post('size', { height: contentHeight() });
  installStateSync();
  installScrollProxy();
  installHeightSync(reportFn);
  installNavigation();
  installHostMessages();
  installOverlaysAndToast();
  const app = document.getElementById('app');
  if (app) new MutationObserver(schedulePracticeLayout).observe(app, {childList:true});
  new MutationObserver(schedulePracticeLayout).observe(document.body, {childList:true});
  window.parent.addEventListener('resize', schedulePracticeLayout, {passive:true});
  window.addEventListener('resize', schedulePracticeLayout, {passive:true});
  window.addEventListener('pagehide', () => {
    window.parent.removeEventListener('resize', schedulePracticeLayout);
    window.removeEventListener('resize', schedulePracticeLayout);
    cancelAnimationFrame(layoutFrame);
  }, {once:true});
  schedulePracticeLayout();
  reportFn();
  /* 题库规模从交接包自己的索引读取，横幅不硬编码；两次补报覆盖首屏与恢复数据。 */
  fetch('content/passages/index.json', { cache: 'no-cache' })
    .then((res) => res.json())
    .then((ids) => { if (Array.isArray(ids) && ids.length) readingPool = ids.length; reportStats(); })
    .catch(() => {});
  setTimeout(reportStats, 600);
  setTimeout(reportStats, 1900);
}

export function submitToHost(session){
  if(!embedded)return Promise.resolve(session);
  return new Promise((resolve,reject)=>{
    const id=session.id;
    const timer=window.setTimeout(()=>{window.removeEventListener('message',receive);reject(Error('交卷确认超时，请重试。同一份作答只会保存一次。'))},20000);
    function receive(event){
      const data=event.data;
      if(event.source!==window.parent||event.origin!==location.origin||data?.source!=='ielts-coach'||data.type!=='reading-submit-result'||data.id!==id)return;
      clearTimeout(timer);window.removeEventListener('message',receive);
      if(data.error)reject(Error(data.error));else resolve(data.session);
    }
    window.addEventListener('message',receive);
    post('submit',{session:{id:session.id,passageId:session.passageId,startedAt:session.startedAt,answers:session.answers}});
  });
}

export function openHostReport(sessionId) {
  if (embedded && /^s_[\w-]{1,100}$/.test(sessionId)) post('open-report', {sessionId});
}
