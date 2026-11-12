import React, { useEffect, useState } from 'react'
import { SUBJECT_META, type ScorePoint, type Subject } from './contract'
import { formatDateTime } from './logic'

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>
}

/**
 * 内嵌模块的加载骨架：纯形状，不带任何文字。
 *
 * 内嵌页（口语、听力）是 iframe，宿主在收到模块报上来的高度之前只能占一块估值高度。
 * 完全空着会先露出 iframe 的白底，等模块渲染完再「跳」出来；
 * 用同色系的浅色块把这块区域铺住，内容就绪后交叉淡出，观感是连续的。
 * 刻意不放加载提示文案：它会闪一下就被真实内容顶掉。
 */
/* 慢加载占位：只在这一帧超过 SLOW_MS 还没就绪时才挂上去。
   本地/热点缓存下模块 50ms 内就报 ready，占位根本不出现——
   用户看到的就是「点进去 → 内容就在」；只有真的慢（首次访问、弱网）才用一块
   与真实高度同高的浅色轮廓兜住这段时间。 */
export const SLOW_MS = 620
export function useSlowFlag(readyOrFailed: boolean) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (readyOrFailed) { setSlow(false); return }
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS)
    return () => window.clearTimeout(timer)
  }, [readyOrFailed])
  return slow
}

/** Replay the visible content blocks while preserving the current form and iframe. */
export function useEnterReplay<T extends HTMLElement>(trigger: unknown) {
  const ref = React.useRef<T | null>(null)
  React.useEffect(() => {
    if (ref.current) document.dispatchEvent(new CustomEvent('coach:motion-enter', { detail: ref.current }))
  }, [trigger])
  return ref
}

export function FrameSkeleton({ inline = false, head = true }: { inline?: boolean; head?: boolean }) {  /* head=false 用于已经有自己标题行的页面（例如内嵌的口语模块）：
     骨架只补内容块，不额外画一行页头，否则加载完会凭空少掉一行，页面往上一跳。 */
  return (
    <div className={inline ? 'page-skeleton' : 'frame-skeleton'} aria-hidden="true" data-head={head ? '1' : '0'}>
      {head && <div className="sk-head">
        <span className="sk-avatar" />
        <span className="sk-head-lines"><i /><i /></span>
      </div>}
      <div className="sk-hero">
        <span className="sk-hero-icon" />
        <span className="sk-hero-copy"><i /><i /><i /></span>
        <span className="sk-hero-btn" />
      </div>
      <div className="sk-cards"><span /><span /></div>
      <div className="sk-list"><i /><i /><i /></div>
    </div>
  )
}

export function CardHead({ title, hint, extra }: { title: string; hint?: string; extra?: React.ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <h3>{title}</h3>
        {hint && <div className="hint">{hint}</div>}
      </div>
      {extra}
    </div>
  )
}

export function Progress({ value, tone = '', thin = false }: { value: number; tone?: string; thin?: boolean }) {
  return (
    <div className={`progress ${thin ? 'thin' : ''}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`progress-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

/**
 * 四科图标：实心填充画法（fill=currentColor）。
 * 相比细描边，实心图标在浅色底、小尺寸、低分屏与缩放场景下都不会"消失"，
 * 也不会因为 half-pixel 描边被抗锯齿吃掉而显得残缺。
 * 图形范围控制在 3~21（24 视框），四周留 ≥3 的安全边距。
 */
const SUBJECT_ICON_PATHS: Record<Subject, React.ReactNode> = {
  // 麦克风：实测 bbox 11.2×19.2，中心 (12,12.2)，四边距对称
  speaking: (
    <>
      <rect x="9" y="2.6" width="6" height="11.2" rx="3" />
      <path d="M6.4 11.2h1.6a4 4 0 0 0 8 0h1.6a5.6 5.6 0 0 1-4.8 5.54V20h2.6a.9.9 0 0 1 0 1.8H8.6a.9.9 0 0 1 0-1.8h2.6v-3.26A5.6 5.6 0 0 1 6.4 11.2z" />
    </>
  ),
  // 铅笔：原始路径 bbox 中心 (12.95,11.05)，整体平移 (-0.95, +0.95) 后严格居中
  writing: (
    <>
      <path d="M15.25 4.35a2.4 2.4 0 0 1 3.4 0l1 1a2.4 2.4 0 0 1 0 3.4l-9.8 9.8-1.5.4-2.9.8-.7-.7.8-2.9.4-1.5z" />
      <path d="M3.65 20.35l2.4-.7-1.7-1.7z" />
    </>
  ),
  // 耳机：实测 bbox 18.8×17.6，中心 (12,12)，四边距对称
  listening: (
    <>
      <path d="M12 3.2a8.3 8.3 0 0 1 8.3 8.3v1.1h-2.6v-1.1a5.7 5.7 0 0 0-11.4 0v1.1H3.7v-1.1A8.3 8.3 0 0 1 12 3.2z" />
      <rect x="2.6" y="12.6" width="5" height="8.2" rx="2.4" />
      <rect x="16.4" y="12.6" width="5" height="8.2" rx="2.4" />
    </>
  ),
  // 书：原始路径上下不等（T3.4 / B4.8），整体下移 0.7 后对称
  reading: (
    <>
      <path d="M11.1 6.4v13.5c-2-1.3-4.7-1.7-7.6-1.4a1 1 0 0 1-1.1-1V5.1a1 1 0 0 1 1.1-1c3 .2 5.6 1 7.6 2.3z" />
      <path d="M12.9 6.4c2-1.3 4.6-2.1 7.6-2.3a1 1 0 0 1 1.1 1v12.4a1 1 0 0 1-1.1 1c-2.9-.3-5.6.1-7.6 1.4z" />
    </>
  ),
}

export function SubjectIcon({ subject, size = 23 }: { subject: Subject; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {SUBJECT_ICON_PATHS[subject]}
    </svg>
  )
}

export function SubjectChip({ subject }: { subject: Subject }) {
  const meta = SUBJECT_META[subject]
  return (
    <span className="chip" style={{ background: meta.soft, color: meta.color }}>
      <span className="dot" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

export function Empty({ icon = '○', title, hint, action }: { icon?: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <b>{title}</b>
      {hint && <div className="small">{hint}</div>}
      {action && <div className="mt12">{action}</div>}
    </div>
  )
}

export function StatCard({ label, value, foot, accent, className = '' }: { label: string; value: string | number; foot?: string; accent?: string; className?: string }) {
  return (
    <div className={`stat ${className}`.trim()}>
      <div className="label">{label}</div>
      <div className="value" style={accent ? { color: accent } : undefined}>{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  )
}

export function Modal({ title, sub, children, onClose }: {
  title: string; sub?: string; children: React.ReactNode; onClose: () => void
}) {
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>{title}</h3>
        {sub && <div className="sub">{sub}</div>}
        {children}
      </div>
    </div>
  )
}

export function Toast({ message }: { message: string }) {
  if (!message) return null
  return <div className="toast">{message}</div>
}

/** 每日两格任务：完成即时点亮，同一提交由 attemptId 去重 */
export function DailyTasks({ newDone, retakeDone, onNew, onRetake }: {
  newDone: boolean
  retakeDone: boolean
  onNew?: () => void
  onRetake?: () => void
}) {
  const cells = [
    { done: newDone, title: '完成一次新练习', desc: '听说读写任选一科，提交一次作答', onClick: onNew },
    { done: retakeDone, title: '根据反馈复练一次', desc: '从报告或错题本出发，针对性再练', onClick: onRetake },
  ]
  return (
    <div className="daily-grid">
      {cells.map((cell) => (
        <button
          key={cell.title}
          type="button"
          className={`daily-cell ${cell.done ? 'done' : ''}`}
          onClick={cell.onClick}
          style={{ textAlign: 'left', cursor: cell.onClick ? 'pointer' : 'default' }}
        >
          <span className="daily-check">✓</span>
          <span>
            <b>{cell.title}</b>
            <span>{cell.done ? '已完成，今天点亮啦' : cell.desc}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** 分数曲线：可点击的点直接打开对应报告 */
export function ScoreChart({ points, color, unit, onPoint }: {
  points: ScorePoint[]
  color: string
  unit: string
  onPoint: (reportId: string) => void
}) {
  if (points.length === 0) {
    return <Empty icon="📈" title="这一项还没有数据" hint="完成对应科目的练习后，曲线会自动出现。" />
  }
  const W = 620, H = 210, L = 44, R = 18, T = 18, B = 32
  const values = points.map((p) => p.value)
  const rawMin = Math.min(...values), rawMax = Math.max(...values)
  const span = Math.max(1, rawMax - rawMin)
  const min = unit === '%' ? 0 : Math.max(0, rawMin - span * 0.35)
  const max = unit === '%' ? 100 : rawMax + span * 0.35
  const x = (i: number) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1))
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / Math.max(0.5, max - min))
  const single = points.length === 1
  const line = single
    ? `M ${L} ${y(points[0].value)} L ${W - R} ${y(points[0].value)}`
    : points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ')
  const area = single
    ? `M ${L} ${H - B} L ${L} ${y(points[0].value)} L ${W - R} ${y(points[0].value)} L ${W - R} ${H - B} Z`
    : `${line} L ${x(points.length - 1)} ${H - B} L ${x(0)} ${H - B} Z`
  const ticks = [max, (max + min) / 2, min]

  return (
    <div className="chart-wrap">
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="分数曲线">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.20" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {ticks.map((tick, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(tick)} y2={y(tick)} stroke="#e8eef2" strokeDasharray="4 4" />
            <text x={L - 9} y={y(tick) + 4} textAnchor="end" fontSize="10.5" fill="#8393a1">{tick.toFixed(1)}</text>
          </g>
        ))}
        <path d={area} fill="url(#chartFill)" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point, i) => (
          <g key={point.reportId} role="button" tabIndex={0} aria-label={point.label + '，打开报告'} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPoint(point.reportId) } }} onClick={() => onPoint(point.reportId)} style={{ cursor: 'pointer' }}>
            <circle cx={x(i)} cy={y(point.value)} r="11" fill="transparent" />
            <circle cx={x(i)} cy={y(point.value)} r="5.5" fill="#fff" stroke={color} strokeWidth="2.5" />
            <title>{`${formatDateTime(point.date)} · ${point.label}（点击查看报告）`}</title>
            <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="10.5" fill="#8393a1">
              {formatDateTime(point.date).split(' ')[0]}
            </text>
          </g>
        ))}
      </svg>
      <div className="chart-legend">
        <span>单位：{unit}</span>
        <span>点击曲线上的点可打开对应报告</span>
        <span>共 {points.length} 次记录</span>
      </div>
    </div>
  )
}

/**
 * 积分获得动画：从触发点向上飘出「+25 积分」，并有一圈扩散光环。
 * 只动 transform / opacity，由合成线程完成，不产生长任务。
 * 用于：完成练习、复练、复习错题等所有学习活动之后。
 */
export function PointsBurst({ points, token, label }: { points: number; token: number; label?: string }) {
  if (!token) return null
  return (
    <div className="points-burst" key={token} aria-live="polite">
      <span className="pb-ring" aria-hidden="true" />
      <span className="pb-text">
        <b>+{points}</b>
        <small>{label ?? '积分'}</small>
      </span>
    </div>
  )
}
