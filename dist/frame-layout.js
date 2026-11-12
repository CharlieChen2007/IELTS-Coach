/* Intrinsic iframe sizing: layout boxes never shrink while content animates. */
(() => {
  if(window.CoachFrameLayout)return;
  const embedded=parent!==window;
  const html=document.documentElement;
  if(embedded)html.classList.add('host-embedded');
  html.dataset.frameLayout=location.pathname.includes('/vocab/')?'vocab':location.pathname.endsWith('/shadow.html')?'shadow':'embedded';
  function topOf(el){let top=0;for(let node=el;node;node=node.offsetParent)top+=node.offsetTop||0;return top;}
  function height(root=document.body){
    if(!root)return 0;
    const margin=parseFloat(getComputedStyle(root).marginBottom)||0;
    // 24 px also accommodates the 22 px entrance translation at the last card.
    // scrollHeight is deliberately avoided: it is at least the iframe viewport.
    let bottom=topOf(root)+root.offsetHeight+margin;
    if(root===document.body)for(const node of html.children){
      if(node===root || ['HEAD','SCRIPT','STYLE','LINK'].includes(node.tagName))continue;
      const style=getComputedStyle(node);
      if(style.position!=='fixed' && style.display!=='none')bottom=Math.max(bottom,topOf(node)+(node.offsetHeight||0));
    }
    return Math.ceil(bottom)+24;
  }
  function observe(report,root=document.body){
    let frame=0,last=0;
    const update=()=>{
      frame=0;
      if(!root?.isConnected || embedded && !window.frameElement?.getClientRects().length)return;
      const next=height(root);
      if(next>0 && next!==last){last=next;report(next);}
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    const resize=new ResizeObserver(schedule);
    for(const element of new Set([root,document.body]))if(element)resize.observe(element);
    const changes=new MutationObserver(schedule);
    changes.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden']});
    window.addEventListener('resize',schedule,{passive:true});
    window.addEventListener('load',schedule,{once:true});
    const message=event=>{if(event.source===parent && event.origin===location.origin && event.data?.source==='ielts-coach' && ['wake','navigate','go','motion-enter','openTopic','openReport'].includes(event.data.type)){last=0;schedule();}};
    if(embedded)window.addEventListener('message',message);
    document.fonts?.ready.then(schedule);
    const disconnect=()=>{resize.disconnect();changes.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('message',message);};
    window.addEventListener('pagehide',disconnect,{once:true});
    schedule();return disconnect;
  }
  function position(){
    if(!embedded)return;
    try{
      const frame=window.frameElement;if(!frame)return;
      const box=frame.getBoundingClientRect();
      const head=parent.document.querySelector('.topbar')?.getBoundingClientRect().bottom||0;
      const tab=parent.document.querySelector('.tabbar');
      const end=tab?.getClientRects().length?tab.getBoundingClientRect().top:parent.innerHeight;
      const top=Math.min(frame.offsetHeight,Math.max(0,head-box.top));
      const bottom=Math.max(top,Math.min(frame.offsetHeight,end-box.top));
      html.style.setProperty('--frame-visible-top',top+'px');
      html.style.setProperty('--frame-visible-height',(bottom-top)+'px');
    }catch{/* An independent cross-origin preview keeps normal dialogs. */}
  }
  if(embedded){try{parent.addEventListener('scroll',position,{passive:true});parent.addEventListener('resize',position,{passive:true});window.addEventListener('resize',position,{passive:true});window.addEventListener('pagehide',()=>{parent.removeEventListener('scroll',position);parent.removeEventListener('resize',position);},{once:true});}catch{}position();}
  window.CoachFrameLayout={height,observe};
  document.dispatchEvent(new Event('coach:frame-layout-ready'));
})();
