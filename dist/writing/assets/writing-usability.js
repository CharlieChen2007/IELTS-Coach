/** Small, idempotent presentation repairs around the delivered React workspace. */
function enhance(){
  const root=document.getElementById('root');if(!root)return;
  if(root.querySelector('.compare-grid .empty-draft')){
    const title=root.querySelector('.comparison-toolbar > div > span:last-child');
    if(title&&title.textContent.includes('个段落有变化'))title.textContent='尚未创建二稿 · 创建后可对照变化';
  }
  for(const panel of root.querySelectorAll('.feedback-panel')){
    const sections=[...panel.querySelectorAll('.feedback-section')];
    for(let i=1;i<sections.length;i++){
      const before=sections[i-1].querySelector('p')?.textContent.trim(),current=sections[i].querySelector('p')?.textContent.trim();
      if(before&&before===current&&!sections[i].querySelector('.rewrite'))sections[i].hidden=true;
    }
  }
  const current=window.coachWritingRuntime?.currentEntry?.();
  if(current?.report?.source==='ai'&&current.report.model?.trim()===current.text?.trim()){
    const label=root.querySelector('.model-paper .overline'),title=root.querySelector('.model-paper .paper-heading h3');
    if(label&&label.textContent!=='原稿参考版本')label.textContent='原稿参考版本';
    if(title&&title.textContent==='同一个观点，更准确的表达')title.textContent='本篇已满足本次收尾条件，保留原文作为参考。';
  }
  const task1=window.coachWritingRuntime?.task1?.(),report=root.querySelector('.t1-report');
  if(report){
    const instructions=task1?.report?.deliveryPolicy?.manualInstructions||[];
    let panel=report.querySelector('.coach-task1-manual');
    if(!instructions.length){panel?.remove();return;}
    // React can reuse the report container for another submission. Refresh the
    // supporting card when its source changes, rather than leaving old advice.
    const signature=JSON.stringify([task1.report.submissionId,instructions]);
    if(panel?.dataset.source===signature)return;
    if(!panel){panel=document.createElement('section');panel.className='panel coach-task1-manual';report.append(panel);}
    panel.dataset.source=signature;
    const heading=document.createElement('h3');heading.textContent='需要手动核对的内容';
    const items=instructions.map(item=>{const p=document.createElement('p');p.textContent=item.instruction;return p;});
    panel.replaceChildren(heading,...items);
  }
}
const root=document.getElementById('root');
if(root){new MutationObserver(enhance).observe(root,{childList:true,subtree:true});queueMicrotask(enhance);}
