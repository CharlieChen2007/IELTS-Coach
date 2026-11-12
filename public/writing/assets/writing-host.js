import { localTask1 } from './writing-local.js';
import './writing-usability.js';
import { WORKSPACE_KEY, STATE_VERSION, decodeWorkspace, extractSubmissions } from './writing-state.js';
/* ==========================================================================
   IELTS Coach 宿主桥接 · 写作精修室 iframe

   由 public/writing/index.html 的内联 module 在 React 渲染前 import：
     await init()      —— 自动进入「先体验」游客模式 + 从站点数据库恢复工作区
     startSync()       —— 工作区写入同步到云端 + iframe 高度/就绪上报 + 导航桥接
     await import(...) —— 加载 Vite bundle（内含 host-bridge.ts 的 completion 注入）

   「功能不变，统一展示方式」：独立站的竖排侧栏在嵌入态由 CSS 隐藏，导航改由主站
   横向页签承担。这里只把主站的视图请求翻译成对原有 .nav-item 的一次 click，
   React 的 setView / 题库 / 编辑器 / 批改链路全部保持原样，不重写任何业务逻辑。

   数据库只作跨设备备份：localStorage 仍是游客模式的真实存储，云端不可用不影响练习。
   ========================================================================== */
const params = new URLSearchParams(location.search);
export const embedded = window.parent !== window && params.get('embedded') === '1';
export const scope = params.get('scope') || 'guest-local';

const KEY = WORKSPACE_KEY;
const FLAG = 'tcamp-guest:v1';
const TS = 'ielts-writing-local-ts';

/* 主站横向页签 ↔ 独立站原有竖排导航的视图映射。
   只复用交接包自己的 aria-label 与 onClick，不复制 / 重写任何业务逻辑。 */
const VIEW_LABEL = {
  overview: '练习概览',
  practice: '写作精修',
  report: '批改报告',
  compare: '二稿对比',
  history: '练习记录',
};

function post(type, data) {
  if (!embedded) return;
  try {
    window.parent.postMessage(Object.assign({ source: 'ielts-writing', type }, data || {}), location.origin);
  } catch (e) { /* 宿主未就绪时忽略 */ }
}

const rawStorage = {
  get: Storage.prototype.getItem,
  set: Storage.prototype.setItem,
  remove: Storage.prototype.removeItem,
};
const prefix = 'coach-writing:' + encodeURIComponent(scope) + ':';
const privateKey = key => key.startsWith('tcamp-') || key === TS;
function installScopedStorage() {
  if (!embedded) return;
  Storage.prototype.getItem = function(key) { return rawStorage.get.call(this, privateKey(String(key)) ? prefix + key : key); };
  Storage.prototype.setItem = function(key,value) { return rawStorage.set.call(this, privateKey(String(key)) ? prefix + key : key,value); };
  Storage.prototype.removeItem = function(key) { return rawStorage.remove.call(this, privateKey(String(key)) ? prefix + key : key); };
}
function workspaceSnapshot() {
  const keys = {};
  for (let index = 0; index < localStorage.length; index++) {
    const actual = localStorage.key(index);
    if (!actual?.startsWith(prefix)) continue;
    const key = actual.slice(prefix.length);
    if (key.startsWith('tcamp-') && key !== FLAG && key !== 'tcamp-llm-config:v1') keys[key] = rawStorage.get.call(localStorage,actual);
  }
  const catalog = window.coachWritingCatalog || {};
  const topics = Object.fromEntries([...(catalog.task1 || []),...(catalog.task2 || [])].map(t => [t.id,{id:t.id,prompt:t.prompt,image:t.image,type:t.type,label:t.label}]));
  return JSON.stringify({schema:STATE_VERSION,keys,topics});
}
export async function init() {
  if (!embedded) return;
  installScopedStorage();
  document.documentElement.classList.add('host-embedded');
  localStorage.setItem(FLAG,'1');
  try {
    let enrolled = await fetch('/api/campus/me',{headers:{'X-Speaking-Scope':scope},credentials:'same-origin'}).then(r=>r.json());
    if (!enrolled.active) await fetch('/api/campus/session',{method:'POST',headers:{'Content-Type':'application/json','X-Speaking-Scope':scope},credentials:'same-origin',body:JSON.stringify({nickname:params.get('nickname') || '同学'})});
    window.coachWritingAIReady = await fetch('/api/writing/ai/status',{headers:{'X-Speaking-Scope':scope},credentials:'same-origin'}).then(r=>r.json()).then(x=>x.configured===true).catch(()=>false);
    const response = await fetch('/api/writing/workspace',{headers:{'X-Speaking-Scope':scope},credentials:'same-origin',cache:'no-store'});
    if (!response.ok) return;
    const body = await response.json();
    const localTs = Number(localStorage.getItem(TS) || 0);
    if (typeof body.data !== 'string' || localTs > Number(body.updatedAt || 0)) return;
    const snapshot = decodeWorkspace(body.data);
    for (const [key,value] of Object.entries(snapshot.keys)) {
      if (key.startsWith('tcamp-') && typeof value === 'string') localStorage.setItem(key,value);
    }
    localStorage.setItem(TS,String(body.updatedAt || 0));
  } catch { /* A saved local draft remains available during a network outage. */ }
  finally { await seedShowcaseWorkspace(); }
}

export function startSync() {
  if (embedded) {
    try {
      const original = Storage.prototype.setItem;
      let queue = Promise.resolve();
      let timer = 0;
      let pending = null;
      const put = (value) => {
        const url = '/api/writing/workspace?scope=' + encodeURIComponent(scope);
        const body = JSON.stringify({ workspace: value });
        /* 嵌入态一律交给主站代发，主站 window 不销毁，请求不会被取消。 */
        if (embedded) {
          post('workspace', { workspace: value, scope });
          post('submissions');
          return;
        }
        /* 页面真正关闭时由浏览器独立投递，避免最后一次草稿丢失。 */
        if (body.length < 60000 && typeof navigator.sendBeacon === 'function') {
          try {
            if (navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return;
          } catch (e) { /* 回退到普通请求 */ }
        }
        queue = queue.catch(() => {}).then(() => fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Speaking-Scope': scope },
          credentials: 'same-origin',
          body,
        })).catch(() => {}); // 本机已存，下次打开会带上
      };
      const flush = () => {
        clearTimeout(timer);
        if (pending === null) return;
        const value = pending;
        pending = null;
        put(value);
      };
      Storage.prototype.setItem = function (key, value) {
        original.call(this, key, value);
        if (!String(key).startsWith('tcamp-') || key === FLAG || key === 'tcamp-llm-config:v1') return;
        localStorage.setItem(TS, String(Date.now()));
        scheduleStats();
        pending = workspaceSnapshot();
        clearTimeout(timer);
        timer = setTimeout(flush, 400);
      };
      window.addEventListener('pagehide', () => flush());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      });
    } catch (e) { /* 存储被禁用时跳过云端备份 */ }
  }

  // iframe 高度自适应 + 就绪通知。ResizeObserver 在 React 渲染出内容后自然会触发。
  // 量「内容真实底部」而不是 documentElement.scrollHeight：后者至少等于 iframe
  // 视口高度，兜底值偏大时会形成「越报越高」的死锁，页面收不回来。
  let readySent = false;
  let readyObserver;
  const notifyReady = () => {
    const root = document.getElementById('root');
    // React initially mounts a hidden standalone loader. Wait for the actual
    // workspace, then reveal immediately rather than waiting a fixed 400ms.
    if(readySent || !root?.querySelector('.main-content'))return;
    readySent = true;
    readyObserver?.disconnect();
    post('ready');
  };
  const report = () => { post('size', { height: contentHeight() }); notifyReady(); };
  readyObserver = new MutationObserver(notifyReady);
  const root = document.getElementById('root');
  if(root)readyObserver.observe(root,{childList:true,subtree:true});
  try {
    new ResizeObserver(report).observe(document.documentElement);
  } catch (e) { /* 不支持时靠定时上报 */ }
  window.addEventListener('load', report);
  notifyReady();
  setTimeout(report, 1200);

  startNavigationBridge(report);
  installSingleScroll();
  setTimeout(reportStats, 600);
  setTimeout(reportStats, 1900);
}

/**
 * 界面一体化（本轮硬要求）：全页只有主站 document 一条滚动轴。
 *
 * writing-theme.css 已把 fixed 模态框 / 内部 overflow:auto 容器改成自然高度的
 * 页内白卡，iframe 恒等于内容高度、自身不可滚动，滚轮默认链式交给主站。这里补上
 * 三件交互细节，保证「改展示方式」不丢功能：
 *   · 卡片出现 → reveal，让主站平滑滚到卡片位置（点击后仍第一时间看到内容）；
 *   · toast 是 fixed、会落在 iframe 最底部看不见 → 转发给主站统一显示；
 *   · 模块里若有 scrollIntoView（定位到某句 / 某条反馈）→ 转发给主站滚动。
 * 不改动交接包任何一行 React 代码，全部用 DOM 观察与原型代理完成。
 */
function installSingleScroll() {
  if (!embedded) return;
  const OVERLAY = '.dialog-backdrop, .feedback-backdrop';
  let lastReveal = 0;
  const revealIfAny = () => {
    const el = document.querySelector(OVERLAY);
    if (!el || Date.now() - lastReveal < 500) return;
    lastReveal = Date.now();
    post('reveal', { top: Math.max(0, Math.round(el.getBoundingClientRect().top - 100)) });
  };

  let lastToast = '';
  let toastTimer = 0;
  const checkToast = () => {
    const el = document.querySelector('.toast');
    const message = (el?.textContent || '').trim();
    if (!message || message === lastToast) return;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      lastToast = message;
      post('toast', { message });
      setTimeout(() => { lastToast = ''; }, 2400);
    }, 60);
  };

  try {
    const watch = () => { revealIfAny(); checkToast(); renderReportAction(); };
    new MutationObserver(watch).observe(document.body, {
      childList: true, subtree: true, characterData: true,
    });
  } catch (e) { /* 忽略 */ }

  try {
    const native = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (opts) {
      if (!embedded) return native.call(this, opts);
      const rect = this.getBoundingClientRect();
      post('scrollTo', {
        top: Math.max(0, Math.round(rect.top - Math.round(window.innerHeight / 2.6))),
        behavior: 'smooth',
      });
    };
  } catch (e) { /* 忽略 */ }
}

/** 科目横幅的个人进度口径与模块内一致（数据来自本机工作区 / 数据库备份） */
function reportStats() {
  let entries = [];
  try { entries = extractSubmissions(decodeWorkspace(workspaceSnapshot())); } catch {}
  entries.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const last = entries[0];
  const ai = last?.report?.ai;
  const scores = ai?.scores && Object.values(ai.scores).map(s=>s.band);
  const band = scores?.length===4 && scores.every(s=>typeof s==='number') ? Math.round(scores.reduce((a,b)=>a+b,0)/4*2)/2 : null;
  post('stats',{attempts:entries.length,band,pool:459,poolLabel:'写作题目'});
}
let statsTimer = 0;
function scheduleStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(reportStats, 220);
}

function contentHeight() {
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

/**
 * 导航桥接（只在嵌入态生效）：
 *  - 主站横向页签 → { type:'navigate', view } → 找到交接包原有 .nav-item 并 click()，
 *    触发它自己的 setView。切换后补报一次高度，避免内容变高时 iframe 留白。
 *  - 交接包内部跳转（hero「开始今天的写作」、报告里「进入二稿」等会自己 setView）
 *    → 监听 active 态 → 回报主站同步页签高亮，避免两处导航状态打架。
 * 用 MutationObserver 而不是 setState hook，是为了不改动交接包任何一行 React 代码。
 */
function startNavigationBridge(report) {
  if (!embedded) return;

  const requested = { view: null };

  const clickNav = (view) => {
    document.documentElement.classList.toggle('coach-writing-compare',view==='compare' && window.coachWritingRuntime?.isTask1());
    document.querySelector('.coach-task1-compare')?.remove();
    if (window.coachWritingRuntime?.navigate(view)) {if(view==='compare')setTimeout(renderTask1Compare,80);return true;}
    const label = VIEW_LABEL[view];
    if (!label) return false;
    const btn = document.querySelector(`.nav-item[aria-label="${label}"]`);
    if (!btn) return false;
    // Task 1 deliberately keeps the standalone overview nav highlighted while
    // its editor/report/compare is open. The runtime describes the actual pane;
    // aria-current alone would therefore prevent returning to overview forever.
    const current = window.coachWritingRuntime?.view();
    if (current ? current !== view : btn.getAttribute('aria-current') !== 'page') btn.click();
    return true;
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const data = event.data;
    if (data?.source !== 'ielts-coach') return;
    /* 从主站「学伴互助」切回来时 iframe 由隐藏恢复：补报真实高度，避免沿用
       隐藏期间的兜底值把内容裁掉。iframe 不卸载，所以仍走同一条消息通道。 */
    if (data.type === 'wake') { report(); setTimeout(report, 120); setTimeout(report, 420); return; }
    if (data.type === 'openTopic') {
      let tries=0;const timer=setInterval(()=>{if(window.coachWritingRuntime?.selectTopic(data.task)||++tries>40)clearInterval(timer)},80);return;
    }
    if (data.type === 'openReport') {
      let tries=0;const timer=setInterval(()=>{if(window.coachWritingRuntime?.open(data.submission)||++tries>40)clearInterval(timer)},80);
      return;
    }
    if (data.type !== 'navigate') return;
    requested.view = data.view;
    if (!clickNav(data.view)) {
      // React 还没挂载出 nav，等它出现后重试一次。
      let tries = 0;
      const timer = setInterval(() => {
        if (clickNav(requested.view) || ++tries > 20) clearInterval(timer);
      }, 80);
    }
    setTimeout(report, 120);
    setTimeout(report, 420);
    /* 交接包对「批改报告 / 二稿对比」有空态保护：没有提交时只弹提示、不切视图。
       这时 nav 的 active 不会变化，MutationObserver 也不会触发，主站页签就会
       停在一个与内容不符的视图上。点击后强制回报一次「实际停留的视图」，让主站
       页签回落到真实位置（同时保留交接包原有的提示，功能不变）。 */
    setTimeout(() => syncActive(true), 180);
  });

  let lastActive = null;
  function syncActive(force = false) {
    const on = document.querySelector('.nav-item[aria-current="page"]');
    const label = on?.getAttribute('aria-label') || null;
    const view = window.coachWritingRuntime?.view() || Object.keys(VIEW_LABEL).find(key => VIEW_LABEL[key] === label) || null;
    if (view === lastActive && !force) return;
    lastActive = view;
    if (view) post('view', { view, ...(force ? { requested: requested.view, rejected: requested.view !== view } : {}) });
  }

  const watch = () => {
    const nav = document.querySelector('.sidebar nav') || document.querySelector('.sidebar');
    if (!nav) { setTimeout(watch, 120); return; }
    try {
      new MutationObserver(() => syncActive()).observe(nav, {
        subtree: true, attributes: true,
        attributeFilter: ['class', 'aria-current'], childList: true,
      });
    } catch (e) { /* 忽略 */ }
    new MutationObserver(()=>syncActive()).observe(document.getElementById('root'),{childList:true,subtree:true});
    syncActive();
  };
  watch();
}

function renderTask1Compare() {
  if(!document.documentElement.classList.contains('coach-writing-compare'))return;
  const state=window.coachWritingRuntime?.task1();
  if(!state?.baseline)return;
  const panel=document.createElement('section');panel.className='coach-task1-compare';
  const title=document.createElement('h2');title.textContent='Task 1 · 二稿对比';panel.append(title);
  const note=document.createElement('p');note.textContent=state.draft===state.baseline?'先在写作区修改原稿或采用建议，再对照两份作答。':'原稿保留在左侧，当前修改稿显示在右侧。';panel.append(note);
  const columns=document.createElement('div');
  for(const [label,text] of [['提交时的原稿',state.baseline],['当前修改稿',state.draft]]){
    const column=document.createElement('article'),heading=document.createElement('h3'),body=document.createElement('p');
    heading.textContent=label;body.textContent=text;body.lang='en';column.append(heading,body);columns.append(column);
  }
  panel.append(columns);document.getElementById('root').append(panel);
  post('size',{height:contentHeight()});
}

async function seedShowcaseWorkspace() {
  if(!scope.startsWith('showcase_') || localStorage.getItem('tcamp-coach-seeded:v1'))return;
  if(localStorage.getItem(KEY)){localStorage.setItem('tcamp-coach-seeded:v1','1');return;}
  const now=new Date().toISOString();
  const essay='Public transport allows students to reach classes without buying a car. I support affordable transport because travel costs can prevent some students from attending activities. However, a completely free service still needs public funding. A student discount could protect access while keeping enough money for reliable buses.\n\nFor example, a student living far from campus may need several bus journeys each week. Lower fares would leave more of their budget for books and meals. Local authorities should also improve routes and timetables, since a free bus is of little help if it arrives after the first class.\n\nOverall, I favour targeted support for students, combined with dependable transport. This balances accessibility and the cost of maintaining the network.';
  const draft={text:essay,applied:{},mode:'essay',updatedAt:now};
  const entry={id:'showcase-writing-task2',practiceId:'showcase-transport',topicId:'transport',version:1,text:essay,mode:'essay',createdAt:now,status:'done',isExample:true,report:{sample:false,fragment:false,count:essay.split(/\s+/).length,sentences:[],model:'',upgrades:[]}};
  localStorage.setItem(KEY,JSON.stringify({schemaVersion:1,userId:'guest-local',topicId:'transport',drafts:{transport:draft},entries:[entry]}));
  const chart='The chart compares several categories across the period. An overview should identify the largest change and group similar trends. The first detail paragraph can compare the highest and lowest values, while the second can explain the remaining categories. Each figure should retain its original unit. This demonstration draft leaves the actual numbers for the learner to check against the image.';
  const report=await localTask1({id:'t1-001',type:'柱状图'},chart);report.isExample=true;
  localStorage.setItem('tcamp-task1:v2:guest-local',JSON.stringify({version:2,ownerId:'guest-local',items:{'t1-001':{draft:chart,baseline:chart,appliedIds:[],revision:0,localVersion:1,dirty:false,report}}}));
  localStorage.setItem('tcamp-coach-seeded:v1','1');
}

function renderReportAction() {
  const meta=document.querySelector('.report-meta');
  const id=window.coachWritingRuntime?.current();
  if(!meta || !id || document.querySelector('.coach-writing-account-report'))return;
  const button=document.createElement('button');button.type='button';button.className='button secondary coach-writing-account-report';
  button.textContent='本站报告与校园复练';
  button.addEventListener('click',()=>{post('workspace',{workspace:workspaceSnapshot(),scope});post('openHostReport',{id});});
  meta.append(button);
}
