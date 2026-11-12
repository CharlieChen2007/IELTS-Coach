(() => {
  if (window.__coachNavigationMotion) return;
  const selector = 'nav.workspace-primary,nav.workspace-secondary,nav.subject-tools,nav.camp-activities,nav.section-nav,nav#nav';
  const activeSelector = '[aria-current="page"],[aria-pressed="true"],.on,.active';
  const watched = new Map(), pending = new Set();
  let frame = 0;
  function items(nav) { return [...nav.children].filter(el => el.matches('button,a') && !el.hidden); }
  function queue(nav,snap=false) {
    if (!nav?.isConnected) return;
    if(snap && watched.has(nav))watched.get(nav).snap=true;
    pending.add(nav);
    if (!frame) frame = requestAnimationFrame(flush);
  }
  function flush() {
    frame = 0;
    const updates = [];
    // Read untransformed layout once, then write all highlight positions together.
    for (const nav of pending) {
      if (!nav.isConnected) continue;
      const state = watched.get(nav);
      if (!state || !nav.getClientRects().length) continue;
      const active = items(nav).find(el => el.matches(activeSelector));
      updates.push({nav,state,active,box:active?.offsetWidth
        ? {x:active.offsetLeft,y:active.offsetTop,width:active.offsetWidth,height:active.offsetHeight} : null});
    }
    pending.clear();
    for (const {nav,state,active,box} of updates) {
      if (!box) { nav.dataset.navActive='0'; continue; }
      const key=[box.x,box.y,box.width,box.height].join(':');
      if(state.snap){nav.dataset.navPlaced='0';state.placed=false;state.snap=false;}
      if (key!==state.key || active!==state.active) {
        nav.style.setProperty('--nav-x',box.x+'px'); nav.style.setProperty('--nav-y',box.y+'px');
        nav.style.setProperty('--nav-w',box.width+'px'); nav.style.setProperty('--nav-h',box.height+'px');
        state.key=key; state.active=active;
      }
      nav.dataset.navActive='1';
      if (!state.placed) {
        state.placed=true;
        requestAnimationFrame(()=>{if(nav.isConnected)nav.dataset.navPlaced='1';});
      }
    }
  }
  function attach(nav) {
    if(watched.has(nav) || items(nav).length<2)return;
    const state={key:'',active:null,placed:false,snap:false,observer:new ResizeObserver(()=>queue(nav,true))};
    nav.classList.add('coach-segmented');
    state.observer.observe(nav);
    for(const control of items(nav))state.observer.observe(control);
    watched.set(nav,state); queue(nav);
  }
  function scan(root) {
    if(!(root instanceof Element))return;
    if(root.matches(selector))attach(root);
    for(const nav of root.querySelectorAll(selector))attach(nav);
  }
  function start() {
    scan(document.body);
    new MutationObserver(records=>{
      for(const record of records){
        if(record.type==='attributes'){
          const nav=record.target.closest(selector);if(nav){attach(nav);queue(nav);}continue;
        }
        const nav=record.target instanceof Element && record.target.closest(selector);
        if(nav){attach(nav);const state=watched.get(nav);if(state)for(const control of items(nav))state.observer.observe(control);queue(nav);}
        for(const node of record.addedNodes)scan(node);
      }
      for(const [nav,state] of watched)if(!nav.isConnected){state.observer.disconnect();watched.delete(nav);pending.delete(nav);}
    }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-current','aria-pressed','hidden']});
    document.fonts?.ready.then(()=>{for(const nav of watched.keys())queue(nav,true);});
    window.addEventListener('resize',()=>{for(const nav of watched.keys())queue(nav,true);},{passive:true});
  }
  window.__coachNavigationMotion={refresh:()=>{for(const nav of watched.keys())queue(nav);}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
