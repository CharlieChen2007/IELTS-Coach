import type { Invitation } from './buddyData'

export function BuddyRelations({invites,busy,respond,openDesk,discover}:{
  invites:Invitation[];busy:boolean;respond:(inv:Invitation,accept:boolean)=>void;openDesk:(peer:string)=>void;discover:()=>void
}) {
  const blocks=[
    {title:'收到的邀请',items:invites.filter(i=>i.incoming && i.status==='pending')},
    {title:'可以一起练的搭子',items:invites.filter(i=>i.status==='accepted')},
    {title:'我发出的邀请',items:invites.filter(i=>!i.incoming && i.status==='pending')},
    {title:'已结束的邀请',items:invites.filter(i=>i.status==='declined')},
  ]
  if(!invites.length)return <section className="card buddy-inbox"><h3>从一次邀请开始</h3><p>在同学的卡片上点「邀请一起练」。双方接受后，就可以约时间、进同一场练习、交换心得。</p><button className="btn" onClick={discover}>去找搭子</button></section>
  return <>{blocks.filter(group=>group.items.length>0).map(group=><section className="card buddy-inbox" key={group.title}>
    <h3>{group.title} <small>{group.items.length}</small></h3>
    {group.items.map(inv=><div className={'buddy-inbox-row'+(inv.status==='accepted'?' buddy-card':'')} key={inv.other}>
      <b className="buddy-inbox-avatar" aria-hidden="true">{inv.name.slice(0,1)}</b><b>{inv.name}</b>
      <span>{inv.status==='accepted'?'已成为搭子':inv.status==='declined'?'已婉拒':inv.incoming?'想和你一起练':'等待对方回应'}</span>
      {inv.status==='accepted'&&<><small className="buddy-linked">我的搭子</small><button className="btn btn-sm" aria-label={'与'+inv.name+'一起练'+(inv.meetIncoming?' · 确认约练':'')} onClick={()=>openDesk(inv.other)}>{inv.meetIncoming?'确认约练':inv.meetState?'查看约练':'一起练'} →</button></>}
      {inv.incoming&&inv.status==='pending'&&<><button className="btn btn-primary btn-sm" disabled={busy} onClick={()=>respond(inv,true)}>接受邀请</button><button className="buddy-link" disabled={busy} onClick={()=>respond(inv,false)}>婉拒</button></>}
      {!inv.incoming&&inv.status==='pending'&&inv.other.startsWith('plaza-peer-')&&<button className="btn btn-sm" disabled={busy} onClick={()=>respond(inv,true)}>模拟对方接受</button>}
    </div>)}
  </section>)}</>
}
