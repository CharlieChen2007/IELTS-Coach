(() => {
  if (window.__coachMotion) return;
  const html = document.documentElement;
  const embedded = parent !== window;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  if (embedded) {
    try {
      if (parent.location.origin === location.origin) {
        html.classList.add('host-embedded');
        html.dataset.motion = parent.document.documentElement.dataset.motion || 'high';
      }
    } catch { /* Standalone modules use their own preference. */ }
  }
  const reduced = () => media.matches || html.dataset.motion === 'off';
  const seen = new WeakSet();
  const running = new Map();
  const pending = new Map();
  const deferred = new Set();
  let frame = 0;
  let viewportFrame = 0;
  const stats = { played: 0, batches: 0 };
  const cardSelector = [
    '.ls-hero','.ls-summary','.ls-material','.card','.subject-card','.material-feature',
    '.help-ticket','.buddy-card','.clinic-lesson','.story-card','.camp-head','.bank-card',
    '.panel','.pane','.question-card','.part-card','.session-card','.pr-card','.pr-turn',
    '.tp-panel','.speaking-pair','.hero','.overview-hero','.task-card','.topic-card',
    '.paper-card','.stat-pill','.empty','.q-block','.word-card','.vocab-card','.enter-now',
    '.rd-card','.q-card','.vb-card','.wt-card','.mx-card','.dialog','.prompt-card',
    '.question-bank-dialog','.topic-picker-dialog','.essay-editor','.feedback-panel',
    '.coach-task1-compare','.mode-card','.passage-card','.passage-head','.para','.q-section','.q',
    '[data-motion-card]','.reveal','.reveal-pop','.reveal-fade'
  ].join(',');
  const excluded = 'nav,header.topbar,.sidebar,.subject-hero,.subject-tools,.speaking-tabs,.camp-activities,.workspace-secondary,.clinic-section-tabs,.daily-subtabs,button:not(.ls-material):not(.subject-card)';

  function candidates(root) {
    const hero = root.querySelector('.hero-banner');
    const intro = hero ? [...hero.querySelectorAll('.hero-kicker,.hero-inner h1,.hero-inner>p,.hero-actions,.hero-stats,.hero-note,.hero-art,.hero-meta')] : [];
    const found = [...root.querySelectorAll(cardSelector)].filter(el => !el.matches(excluded) && !el.closest('.sidebar,.topbar,[hidden],[aria-hidden="true"]') && !hero?.contains(el));
    if (intro.length || found.length) return [...intro,...found];
    let base = root;
    for (let depth=0;depth<3 && base.children.length===1;depth++) base=base.children[0];
    return [...base.children].filter(el => !el.matches(excluded+',iframe,script,style,link') && !el.hidden).slice(0,12);
  }

  function viewportBounds() {
    let start=0,end=innerHeight;
    if(embedded){
      try {
        const frame=window.frameElement;
        if(frame){
          if(!frame.getClientRects().length)return {start:1,end:0};
          const box=frame.getBoundingClientRect();
          const topbar=parent.document.querySelector('.topbar');
          const top=topbar?topbar.getBoundingClientRect().bottom:0;
          const tabs=parent.document.querySelector('.tabbar');
          const bottom=tabs && tabs.getClientRects().length?tabs.getBoundingClientRect().top:parent.innerHeight;
          start=Math.max(0,top-box.top);end=Math.min(innerHeight,bottom-box.top);
        }
      }catch{ /* Independent documents use their own viewport. */ }
    }
    return {start,end};
  }
  function inViewport(rect,bounds) {
    return bounds.end>bounds.start && rect.top<bounds.end+24 && rect.bottom>bounds.start;
  }
  function flushViewport() {
    viewportFrame=0;
    if(reduced())return;
    const bounds=viewportBounds();
    const entering=[];
    for(const el of deferred){
      if(!el.isConnected){deferred.delete(el);intersection.unobserve(el);continue;}
      const rect=el.getBoundingClientRect();
      if(rect.width>=40 && rect.height>=20 && inViewport(rect,bounds)){
        deferred.delete(el);intersection.unobserve(el);entering.push(el);
      }
    }
    play(entering);
  }
  function scheduleViewport(){
    if(deferred.size && !viewportFrame)viewportFrame=requestAnimationFrame(flushViewport);
  }
  function play(items) {
    if (reduced()) return;
    items.forEach((el,index) => {
      if (!el.isConnected || running.has(el)) return;
      el.classList.add('coach-motion-item','is-in');
      el.classList.remove('reveal','reveal-fade','reveal-pop','enter-now');
      const art = el.matches('img,.hero-art,[data-motion-art]');
      const animation = el.animate([
        { opacity: 0, translate: art ? '16px 12px' : '0 22px', scale: art ? '.96' : '.985' },
        { opacity: 1, translate: '0 0', scale: '1' }
      ], { duration: art ? 620 : 540, delay: Math.min(index*65,260), easing: 'cubic-bezier(.22,.8,.24,1)', fill:'backwards' });
      animation.id = 'coach-content-enter';
      running.set(el,animation);
      stats.played++;
      const finish = () => { if (running.get(el) === animation) running.delete(el); };
      animation.addEventListener('finish',finish,{once:true});
      animation.addEventListener('cancel',finish,{once:true});
    });
  }

  const intersection = new IntersectionObserver(entries => {
    const entering=[];
    const bounds=viewportBounds();
    for (const entry of entries) if (entry.isIntersecting) {
      // A full-height iframe has a much taller own viewport than the host screen.
      // Its cards should enter only when visible through that parent screen.
      if(!inViewport(entry.boundingClientRect,bounds))continue;
      intersection.unobserve(entry.target);
      deferred.delete(entry.target);
      entering.push(entry.target);
    }
    play(entering);
  },{threshold:.06,rootMargin:'0px 0px -3% 0px'});

  function notifyFrames(root) {
    for (const iframe of root.querySelectorAll('iframe')) {
      if (!iframe.getClientRects().length) continue;
      const stage=iframe.closest('.frame-stage');
      if(stage && stage.dataset.ready!=='1')continue;
      try {
        // Same-origin frames prepare their first keyframe in this rendering turn.
        // A message plus another RAF used to expose a still frame, then restart it.
        const motion=iframe.contentWindow.__coachMotion;
        if(motion){motion.present();continue;}
        iframe.contentWindow.postMessage({source:'ielts-coach',type:'motion-enter'},location.origin);
      } catch { /* A frame may still be loading. */ }
    }
  }
  function hostPresented() {
    if(!embedded)return true;
    try {
      const iframe=window.frameElement;
      if(!iframe?.getClientRects().length)return false;
      const stage=iframe.closest('.frame-stage');
      return !stage || stage.dataset.ready==='1';
    }catch{return true;}
  }
  function enter(root,force=false) {
    if (!(root instanceof Element) || !root.isConnected) return;
    for (const [queued,replay] of pending) {
      if (queued.contains(root)) {pending.set(queued,replay||force);return;}
      if (root.contains(queued)) pending.delete(queued);
    }
    pending.set(root,force);
    if (!frame) frame=requestAnimationFrame(flush);
  }
  function flush() {
    frame=0;
    if (!embedded && document.getElementById('boot') && html.dataset.motionReady!=='1') return;
    // Keep pending entries intact while identity / stored drafts are restored.
    // The host's actual-ready notification releases them once, before paint.
    if(!hostPresented())return;
    const groups=[...pending];pending.clear();
    for(const [root,force] of groups){
      if(!root.isConnected)continue;
      const targets=candidates(root);
      // Measure in one read phase; animation and class writes follow together.
      const measured=targets.map(el=>({el,rect:el.getBoundingClientRect()}));
      // A long native document must never suppress all of its smaller cards.
      // Select nesting only after discarding large or currently hidden wrappers.
      const eligible=measured.filter(({el,rect})=>(force || !seen.has(el)) && rect.width>=40 && rect.height>=20 && rect.height<=1200);
      const rects=eligible.filter(({el})=>!eligible.some(other=>other.el!==el && other.el.contains(el)));
      const visible=[];
      const viewport=viewportBounds();
      for(const {el,rect} of rects){
        if(seen.has(el)&&!force)continue;
        seen.add(el);
        if(reduced()){el.classList.add('is-in');el.classList.remove('reveal','reveal-fade','reveal-pop','enter-now');continue;}
        // DOM observers and the host can report the same entry in adjacent tasks.
        // Never rewind an entrance already in flight; returning after it finishes
        // still replays normally without recreating an editor or audio session.
        if(running.has(el))continue;
        if(inViewport(rect,viewport)){deferred.delete(el);intersection.unobserve(el);visible.push(el);}
        else {deferred.add(el);intersection.observe(el);}
      }
      play(visible.slice(0,18));
      if(force)notifyFrames(root);
      stats.batches++;
    }
  }
  function scopeFor(el) {
    if(embedded)return document.body;
    return el.closest('.stage-body,.stage-pane,.landing,.auth-wrap') || el.querySelector('.stage-body,.landing,.auth-wrap');
  }
  function start(){
    const observer=new MutationObserver(records=>{
      for(const record of records){
        if(record.type==='attributes'){
          if(record.target.matches('.frame-stage[data-ready="1"]'))notifyFrames(record.target);
          continue;
        }
        for(const node of record.removedNodes)if(node instanceof Element){
          intersection.unobserve(node);
          deferred.delete(node);
          for(const child of deferred)if(node.contains(child)){deferred.delete(child);intersection.unobserve(child);}
        }
        if(![...record.addedNodes].some(node=>node instanceof Element))continue;
        const scope=scopeFor(record.target instanceof Element?record.target:document.body);
        if(scope)enter(scope);
        for(const node of record.addedNodes)if(node instanceof Element){const next=scopeFor(node);if(next)enter(next);}
      }
    });
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-ready']});
    if(embedded)enter(document.body);else for(const root of document.querySelectorAll('.stage-body,.landing,.auth-wrap'))enter(root);
  }
  document.addEventListener('coach:motion-enter',event=>enter(event.detail,true));
  document.addEventListener('coach:motion-ready',()=>{html.dataset.motionReady='1';if(frame)cancelAnimationFrame(frame);flush();});
  window.addEventListener('message',event=>{
    if(!embedded || event.source!==parent || event.origin!==location.origin)return;
    if(event.data?.source==='ielts-coach'&&event.data.type==='motion-enter')present();
    if(event.data?.source==='ielts-coach'&&event.data.type==='hostScroll')scheduleViewport();
  });
  window.addEventListener('resize',scheduleViewport,{passive:true});
  window.addEventListener('scroll',scheduleViewport,{passive:true});
  if(embedded){try{parent.addEventListener('scroll',scheduleViewport,{passive:true});}catch{/* Cross-origin standalone frames use IntersectionObserver. */}}
  window.addEventListener('pagehide',()=>{
    if(frame)cancelAnimationFrame(frame);
    if(viewportFrame)cancelAnimationFrame(viewportFrame);
    intersection.disconnect();deferred.clear();
    if(embedded){try{parent.removeEventListener('scroll',scheduleViewport);}catch{/* The parent may have navigated. */}}
  },{once:true});
  media.addEventListener('change',()=>{
    if(reduced())for(const animation of running.values())animation.cancel();
  });
  function present(){
    if(!document.body)return;
    enter(document.body,true);
    if(frame)cancelAnimationFrame(frame);
    flush();
  }
  window.__coachMotion={enter,present,stats};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
