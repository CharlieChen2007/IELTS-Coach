import { useApp } from '../appContext'
import { Card, CardHead, Progress } from '../components'
import { CatImage } from '../components/CatImage'
import { BADGES,CAT_FOODS,QUESTIONS_PER_FEED,PET_STAGES,catMoodAt,campLevelOf,petStageOf } from '../campus/growthModel'
import { useCampusResource, ResourceStatus, type GrowthState } from '../campus/GrowthApi'
import '../campus/growth.css'

const I = {
  lamp: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20h6M10 17h4l-.6-3h-2.8z" /><path d="M12 14V9.6a3.2 3.2 0 0 1 3.2-3.2h2.4" /><circle cx="19" cy="6.4" r="1.6" fill="currentColor" stroke="none" /></svg>,
  badge: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="9.4" r="5.4" /><path d="m8.6 14.2-1.4 6 4.8-2.4 4.8 2.4-1.4-6" /></svg>,
  arrow: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6.5 18.5 12 13 17.5" /></svg>,
}

export function CampusBasePage(){
  const {go}=useApp()
  const {data:camp,change,error,reload,busy}=useCampusResource<GrowthState>('growth')
  if(!camp)return <ResourceStatus error={error} reload={reload}/>
  const campExp=camp.campExp
  const level=campLevelOf(campExp)
  const pet = petStageOf(camp.pet.fed)
  const moodInfo = catMoodAt()
  // 低端设备/减少动效：形象图只保留静态，不跑呼吸动画
  const allowAnim = typeof document !== 'undefined'
    && !document.documentElement.matches('[data-motion="low"], [data-motion="off"]')
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const PET_INDEX = PET_STAGES.findIndex((x) => x.stage === pet.stage)
  const nextNeed = PET_STAGES[PET_INDEX + 1]?.need ?? null
  const litToday = camp.lamp.lastLit === camp.today

  const doLight=()=>change({action:'lamp'},'今天的营地灯已点亮')
  const owned = new Set(camp.badges)

  return (
    <div className="camp-page growth-surface">
      <div className="camp-head">
        <div>
          <h1>深圳大学校园营地</h1>
          <p>完成四科练习攒饲料，和同校学伴一起养大营地猫。</p>
        </div>
        <div className="camp-head-stats">
          <div><b>{level.level}</b><span>营地等级</span></div>
          <div><b>{camp.pet.fed}</b><span>猫咪成长</span></div>
          <div><b>{owned.size} / {BADGES.length}</b><span>徽章</span></div>
        </div>
      </div>

      {/* ====================================================================
          营地养成大卡：灯 + 营地等级 + 营地猫 + 猫粮兑换（合并成一张）
          --------------------------------------------------------------------
          排版思路：
            左列 264px —— 猫图（奶油底色块）+ 投喂进度 + 饲料余额，纵向一列；
            右列 1fr   —— 顶部两小块（今天那盏灯 / 营地等级）等高并排，
                          下面是猫的状态文案、成长进度与猫粮兑换列表。
          两列的视觉重心都是「左图右信息」，比原来四张独立卡省一半纵向空间。
          ==================================================================== */}
      <Card className="mt16 grow-card">
        <CardHead
          title="营地养成"
          hint="每天点灯记录自己的出勤，全校共享猫咪的成长进度。"
          extra={
            <div className="row" style={{ gap: 8 }}>
              <span className="camp-badge primary">Lv.{level.level} {level.title}</span>
              <span className="camp-badge">{pet.label}</span>
            </div>
          }
        />

        <div className="grow-body">
          {/* ---------- 左列：猫 ---------- */}
          <div className="grow-pet">
            <div className="grow-pet-stage">
              <CatImage stage={pet.stage} animate={allowAnim} />
              <span className="grow-pet-mood">{moodInfo.label}</span>
            </div>

            <div className="grow-pet-line">
              <b>{camp.pet.name}</b>
              <span className="cat-name-sub">{pet.label}</span>
            </div>

            <div className="grow-pet-progress">
              <div className="row small muted mb8">
                <span>成长 {camp.pet.fed} 点</span>
                <span className="spacer" />
                <span>{nextNeed ? `距下一形态 ${nextNeed - camp.pet.fed}` : '已是最高形态'}</span>
              </div>
              <Progress value={Math.min(100, nextNeed ? ((camp.pet.fed - pet.need) / (nextNeed - pet.need)) * 100 : 100)} tone="green" />
            </div>

            <div className="cat-feedline">
              <span>可用饲料 <b>{camp.pet.feed}</b> 份</span>
              <span className="cat-feedline-sep" />
              <span>已答 {camp.pet.questionsDone} 题</span>
            </div>
            <div className="small muted grow-pet-tip">
              再答 {QUESTIONS_PER_FEED - (camp.pet.questionsDone % QUESTIONS_PER_FEED)} 道题可再得 1 份饲料
            </div>
          </div>

          {/* ---------- 右列：灯 / 营地等级 / 猫的状态 / 猫粮 ---------- */}
          <div className="grow-main">
            <div className="grow-duo">
              {/* 门口那盏灯 */}
              <div className={`lamp-card ${litToday ? 'lit' : ''}`}>
                <div className="lamp-head">
                  <span className="lamp-visual" aria-hidden="true">
                    <span className="lamp-glow" />
                    <span className="lamp-body">{I.lamp}</span>
                  </span>
                  <div className="lamp-title">
                    <b>营地门口那盏灯</b>
                    <p>{litToday ? `今天已经亮着了${camp.lamp.streak > 1 ? ` · 已连续 ${camp.lamp.streak} 天` : ''}` : '今天还没点亮。练过之后回来点一下。'}</p>
                  </div>
                </div>
                <div className="lamp-foot">
                  <div className="lamp-streak">
                    {Array.from({ length: 7 }).map((_, i) => (
                      <span key={i} className={`lamp-dot ${i < Math.min(7, camp.lamp.streak) ? 'on' : ''}`} />
                    ))}
                    <em>连续 {camp.lamp.streak} 天</em>
                  </div>
                  <button className={`btn btn-sm ${litToday ? '' : 'btn-primary'}`} type="button" disabled={litToday||busy} onClick={doLight}>
                    {litToday ? '今天已点亮' : '点亮今天的灯'}
                  </button>
                </div>
                <div className="small muted">历史最长连续 {camp.lamp.best} 天</div>
              </div>

              {/* 营地整体等级 */}
              <div className="camp-level-card">
                <div className="clv-head">
                  <b>营地 Lv.{level.level}</b>
                  <span className="camp-badge primary">{level.title}</span>
                </div>
                <p className="small muted">全校学伴的学习与互助积分，共同计入营地经验。</p>
                <Progress value={level.progress} tone="green" />
                <div className="row small muted mt8">
                  <span>{campExp} 营地经验</span>
                  <span className="spacer" />
                  <span>{level.next ? `还差 ${level.next - campExp} 升级` : '已达最高等级'}</span>
                </div>
              </div>
            </div>

            <div className="cat-mood">
              <b>{moodInfo.label}</b>
              <p>{moodInfo.line}</p>
            </div>

            {/* 猫粮兑换：右侧列三格并排，每格「图标 + 名称/成长 + 换/喂」 */}
            <div className="feed-rail">
              <div className="feed-rail-head">
                <b>猫粮兑换</b>
                <span className="feed-balance-mini">{camp.pet.feed} 饲料</span>
              </div>

              <div className="feed-rail-list">
                {CAT_FOODS.map((food) => {
                  const have = camp.larder?.[food.id] ?? 0
                  const canExchange = camp.pet.feed >= food.cost
                  return (
                    <div key={food.id} className={`feed-rail-item ${canExchange || have > 0 ? 'ok' : ''}`}>
                      <div className="feed-rail-top">
                        <span className="feed-rail-emoji" aria-hidden="true">{food.emoji}</span>
                        <div className="feed-rail-main">
                          <div className="feed-rail-title">
                            <b>{food.name}</b>
                            <span className="feed-cost">{food.cost}</span>
                          </div>
                          <div className="feed-rail-meta">
                            +{food.value} 成长{have > 0 && <em> · 存 {have}</em>}
                          </div>
                        </div>
                      </div>
                      <div className="feed-rail-actions">
                        <button
                          className="feed-mini-btn"
                          type="button"
                          disabled={!canExchange||busy}
                          title={canExchange ? '兑换' : `还差 ${food.cost - camp.pet.feed} 份饲料`}
                          onClick={() => change({action:'exchange',food:food.id},'已兑换一份'+food.name)}
                        >
                          兑换
                        </button>
                        <button
                          className={`feed-mini-btn primary ${have > 0 ? 'on' : ''}`}
                          type="button"
                          disabled={have <= 0||busy}
                          title={have > 0 ? '喂它' : '先兑换'}
                          onClick={() => change({action:'feed',food:food.id},'投喂成功，猫咪成长 +'+food.value)}
                        >
                          喂
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* ---------- 彩蛋徽章 ---------- */}
      <Card className="mt16">
        <CardHead
          title="彩蛋徽章"
          hint="有些徽章不写在规则里，做到了才知道"
          extra={<span className="chip primary">{owned.size} / {BADGES.length}</span>}
        />
        <div className="badge-grid">
          {BADGES.map((b) => (
            <div key={b.id} className={`badge-item ${owned.has(b.id) ? 'on' : ''}`}>
              <span className="badge-icon">{I.badge}</span>
              <div style={{ minWidth: 0 }}>
                <b>{owned.has(b.id) ? b.name : '？？？'}</b>
                <small>{owned.has(b.id) ? b.hint : b.desc}</small>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="camp-foot">
        <button className="btn btn-quiet" type="button" onClick={() => go('campus/partner')}>
          去寻找搭子 {I.arrow}
        </button>
      </div>
    </div>
  )
}
