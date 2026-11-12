let opened;
export function closePicker(focus = false) {
  if (!opened) return;
  const {popup,trigger} = opened;
  opened = null;
  popup.remove();
  trigger.setAttribute('aria-expanded','false');
  trigger.removeAttribute('aria-controls');
  if (focus) trigger.focus({preventScroll:true});
}
export function prepareChoices(root) {
  for (const field of root.querySelectorAll('select:not([data-enhanced])')) {
    field.dataset.enhanced='true';
    const shell = document.createElement('span');
    shell.className='pick';
    field.before(shell);
    shell.append(field);
    field.tabIndex=-1;
    field.setAttribute('aria-hidden','true');
    Object.assign(field.style,{position:'absolute',width:'1px',height:'1px',minWidth:'0',minHeight:'0',opacity:'0',pointerEvents:'none',padding:'0'});
    const trigger = document.createElement('button');
    trigger.type='button';trigger.className='pick-trigger';
    trigger.setAttribute('aria-haspopup','listbox');
    trigger.setAttribute('aria-expanded','false');
    shell.append(trigger);
    const label=field.getAttribute('aria-label')||'选择答案';
    function refresh(){
      trigger.textContent=field.selectedOptions[0]?.textContent||'请选择';
      trigger.setAttribute('aria-label',label+'，'+trigger.textContent);
      trigger.disabled=field.disabled;
    }
    field.addEventListener('change',refresh);refresh();
    function open(){
      if(opened?.trigger===trigger){closePicker(true);return;}
      closePicker();
      const popup=document.createElement('div');
      popup.className='pick-list';popup.id='listening-choice-menu';popup.setAttribute('role','listbox');
      popup.setAttribute('aria-label',label);
      for(const option of field.options){
        const button=document.createElement('button');
        button.type='button';button.textContent=option.textContent;
        button.setAttribute('role','option');button.setAttribute('aria-selected',String(option.selected));
        button.tabIndex=-1;
        button.onclick=()=>{field.value=option.value;field.dispatchEvent(new Event('change',{bubbles:true}));closePicker(true);};
        popup.append(button);
      }
      document.body.append(popup);
      trigger.setAttribute('aria-expanded','true');trigger.setAttribute('aria-controls',popup.id);
      opened={popup,trigger};
      const rect=trigger.getBoundingClientRect();
      const width=Math.min(Math.max(188,rect.width),innerWidth-12);
      const viewportTop=parseFloat(document.documentElement.style.getPropertyValue('--overlay-top'))||0;
      const viewportHeight=parseFloat(document.documentElement.style.getPropertyValue('--overlay-height'))||innerHeight;
      const top=viewportTop-scrollY, bottom=top+viewportHeight;
      const below=bottom-rect.bottom-8, above=rect.top-top-8;
      const maxHeight=Math.min(258,Math.max(80,below,above));
      Object.assign(popup.style,{width:width+'px',maxHeight:maxHeight+'px',left:Math.max(4,Math.min(rect.left,innerWidth-width-4))+scrollX+'px'});
      popup.style.top=scrollY + (below>=Math.min(popup.offsetHeight,160)||below>=above?rect.bottom+3:rect.top-popup.offsetHeight-3)+'px';
      const items=[...popup.children];items[field.selectedIndex<0?0:field.selectedIndex]?.focus({preventScroll:true});
      popup.onkeydown=e=>{
        const index=items.indexOf(document.activeElement);
        if(e.key==='Tab'){closePicker(true);return;}
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closePicker(true);return;}
        const next={ArrowDown:Math.min(items.length-1,index+1),ArrowUp:Math.max(0,index-1),Home:0,End:items.length-1}[e.key];
        if(next!==undefined){e.preventDefault();items[next].focus({preventScroll:true});
          const btn=items[next];if(btn.offsetTop<popup.scrollTop)popup.scrollTop=btn.offsetTop;else if(btn.offsetTop+btn.offsetHeight>popup.scrollTop+popup.clientHeight)popup.scrollTop=btn.offsetTop+btn.offsetHeight-popup.clientHeight;}
      };
    }
    trigger.onclick=open;
    trigger.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open();}};
  }
}
document.addEventListener('pointerdown',event=>{if(opened&&!opened.popup.contains(event.target)&&!opened.trigger.contains(event.target))closePicker();});
let viewportWidth=window.innerWidth;
window.addEventListener('resize',()=>{
  const nextWidth=window.innerWidth;
  if(viewportWidth!==nextWidth)closePicker();
  viewportWidth=nextWidth;
});

