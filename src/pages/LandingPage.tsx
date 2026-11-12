import React, { useRef } from 'react'
import { useAuth } from '../auth'
import { SUBJECT_META, SUBJECT_ORDER, type Subject } from '../contract'
import { SubjectIcon } from '../components'
import { useReveal } from '../useReveal'
import { PRACTICES } from '../seed'

/**
 * 公开落地页：未登录时的初始界面。
 * 顶栏右上角提供标准的「登录 / 注册」入口（与常见网站一致），
 * 页面内容用于说明产品能力，登录后才进入学习空间。
 */

const FEATURES: { title: string; body: string }[] = [
  { title: '四科完整练习', body: '口语全流程模考与自由对话、Task 2 写作、听力听音作答、阅读左文右题，都在同一个站点完成。' },
  { title: '有依据的反馈', body: '每条反馈都带证据：听力的原声时间点、阅读的原文段落、写作的逐句标注，以及改法说明。' },
  { title: '知道下一步练什么', body: '报告末尾直接给出针对性复练建议，点进去就是带着上次问题的新练习。' },
  { title: '看得见的学习进展', body: '每日两格任务、进度条、分数曲线与错题本，让你知道这一周到底进步在哪里。' },
]

const STEPS = [
  { n: '01', title: '选择练习', body: '从听说读写中选一科，进入训练首页' },
  { n: '02', title: '提交作答', body: '草稿自动保存，评分中刷新也不会丢' },
  { n: '03', title: '查看反馈', body: '哪里要改、为什么、具体怎么改' },
  { n: '04', title: '针对性复练', body: '按建议复练，回到历史记录看变化' },
]

const SUBJECT_HINT: Record<Subject, string> = {
  speaking: '全流程模考 · 自由对话',
  writing: 'Task 2 · 逐句批改',
  listening: '听音作答 · 原声定位',
  reading: '左文右题 · 原文证据',
}

export function LandingPage({ onEnter }: { onEnter: (path: string) => void }) {
  const auth = useAuth()
  const isDemo = auth.mode === 'demo'
  const pageRef = useRef<HTMLDivElement>(null)
  // 首屏由 CSS 自动播放；这里只负责下方区块的滚动触发
  useReveal(pageRef, [], { immediateWithin: 0 })

  /** 首屏错落延迟：按 0.06s 步进，与参考站节奏一致 */
  const delay = (index: number) => ({ ['--d' as string]: `${0.1 + index * 0.06}s` })

  return (
    <div className="landing" ref={pageRef}>
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <button className="brand landing-brand" type="button" onClick={() => onEnter('landing')}>
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 40 40" fill="none"><path d="m8 19 24-11-8 26-5.5-11L8 19Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M18.5 23 32 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </span>
            <span className="brand-text"><b>IELTS Coach</b><small>学术类 · AI 陪练</small></span>
          </button>

          <nav className="landing-links" aria-label="页面导航">
            <a href="#features">产品能力</a>
            <a href="#subjects">四科练习</a>
            <a href="#flow">练习流程</a>
          </nav>

          <div className="landing-actions">
            <button className="btn btn-quiet" type="button" onClick={() => onEnter('auth?mode=signin')}>登录</button>
            <button className="btn btn-primary" type="button" onClick={() => onEnter('auth?mode=signup')}>注册</button>
          </div>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <div className="landing-hero-inner">
            <div className="landing-hero-copy">
              <div className="hero-kicker reveal" style={delay(0)}>Academic IELTS · AI 陪练</div>
              <h1 className="reveal" style={delay(1)}>练完一次，就知道<br />下一步该练什么。</h1>
              <p className="reveal" style={delay(2)}>
                面向雅思自学者的学术类 AI 陪练。完成一次听、说、读、写练习之后，
                你会拿到有原文、原声与逐句依据的反馈，以及一条可以直接点进去的复练路径。
              </p>
              <div className="landing-cta reveal" style={delay(3)}>
                <button className="btn btn-primary btn-lg" type="button" onClick={() => onEnter('auth?mode=signup')}>
                  免费开始练习 →
                </button>
                <button className="btn btn-quiet btn-lg" type="button" onClick={() => onEnter('auth?mode=signin')}>
                  已有账号，去登录
                </button>
              </div>
              <div className="landing-trust reveal-fade" style={delay(4)}>
                <span>{isDemo ? '本机演示' : '验证码登录'}</span>
                <span>{isDemo ? '使用昵称与邮箱进入' : '学习记录按账号保存'}</span>
              </div>
            </div>
            <div className="landing-hero-art" aria-hidden="true">
              <picture>
                  <source srcSet="site-hero-v2-836.webp 836w, site-hero-v2.webp 1672w" sizes="(max-width: 1024px) 100vw, 640px" type="image/webp" />
                  <img src="site-hero-v2.png" alt="" decoding="async" width={1672} height={941} />
                </picture>
            </div>
          </div>
        </section>

        <section className="landing-section" id="features">
          <div className="landing-section-head reveal">
            <h2>为什么练完会觉得“有用”</h2>
            <p>不是只给一个分数，而是把问题指到具体位置，并告诉你下一次怎么练。</p>
          </div>
          <div className="landing-features">
            {FEATURES.map((feature, index) => (
              <article className="landing-feature reveal" key={feature.title} style={delay(index)}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section" id="subjects">
          <div className="landing-section-head reveal">
            <h2>四科都在同一个站点</h2>
            <p>每科练习都按真实考试形态设计，作答界面与记录方式统一。</p>
          </div>
          <div className="landing-subjects">
            {SUBJECT_ORDER.map((subject, index) => (
              <div className="landing-subject reveal" key={subject} style={delay(index)}>
                <span className="landing-subject-icon" style={{ background: SUBJECT_META[subject].soft, color: SUBJECT_META[subject].color }}>
                  <SubjectIcon subject={subject} size={20} />
                </span>
                <div className="landing-subject-copy">
                  <b>{SUBJECT_META[subject].label}</b>
                  <span>{SUBJECT_HINT[subject]}</span>
                  <em>{subject === 'listening' ? '4 段原声' : subject === 'speaking' ? '3 种练习方式' : PRACTICES.filter(item => item.subject === subject).length + ' 项训练'}</em>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section" id="flow">
          <div className="landing-section-head reveal">
            <h2>一次练习的完整闭环</h2>
            <p>从选练习到回看历史，中间的每一步都不需要换地方。</p>
          </div>
          <ol className="landing-steps">
            {STEPS.map((step, index) => (
              <li className="reveal" key={step.n} style={delay(index)}>
                <span className="landing-step-n">{step.n}</span>
                <b>{step.title}</b>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-final reveal">
          <div>
            <h2>今天就可以完成第一次练习</h2>
            <p>{isDemo ? '本机演示支持用昵称和邮箱进入，提交后可在本站回看练习。' : '用手机号或邮箱验证码登录，练习记录会保存到云端。'}</p>
          </div>
          <button className="btn btn-primary btn-lg" type="button" onClick={() => onEnter('auth?mode=signup')}>立即开始</button>
        </section>
      </main>

      <footer className="landing-footer">
        <span>IELTS Coach · 学术类雅思 AI 陪练（课程项目 Demo）</span>
        <span className="landing-footer-actions">
          <button type="button" onClick={() => onEnter('auth?mode=signin')}>登录</button>
          <button type="button" onClick={() => onEnter('auth?mode=signup')}>注册</button>
        </span>
      </footer>
    </div>
  )
}
