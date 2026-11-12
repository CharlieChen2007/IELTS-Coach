/**
 * 营地猫：四个阶段使用指定的四张形象图。
 *
 * 历史（2026-11-08）：曾有一个 Three.js 程序化建模的 3D 版本，
 * 体积 489KB（独立 chunk）、观感也不如这四张图，已整体移除
 * （组件、数据、样式、依赖全部删干净），现在只有这一套形象。
 *
 * 性能：<picture> + srcset（512 / 900 两档），webp 优先、jpg 兜底；
 *      每张 24~31KB，且只在进入营地页时才请求。
 */
import { catMoodAt, type CatMood } from '../campus/growthModel'

export const CAT_IMAGE_STAGE = ['kitten', 'young', 'adult', 'legend'] as const
export type CatImageStage = (typeof CAT_IMAGE_STAGE)[number]

/**
 * 四张形象图自带的不透明奶油底色（像素实测 RGB(253,239,210)）。
 * 猫图要和页面白卡「无边界」地融在一起，必须用这个色值做外圈，
 * 任何接近白的淡蓝渐变叠上去都会露出一块黄色方框。
 */
export const CAT_IMAGE_BG = '#fdefd2'

/** 图片路径（public/cat/*） */
const imgSrc = (stage: CatImageStage, suffix = '') => `/cat/${stage}${suffix}.webp`
const imgFallback = (stage: CatImageStage) => `/cat/${stage}-fallback.jpg`

/**
 * 按时间给图片加一点"活气"：只改 transform，由合成线程完成。
 *   刚睡醒 → 轻微下沉、几乎不动
 *   精神   → 上下小幅浮动
 *   打盹   → 极缓的呼吸
 *   夜猫   → 轻微左右晃
 */
const MOOD_MOTION: Record<CatMood, { anim: string; label: string }> = {
  sleepy: { anim: 'cat-breathe 4.6s ease-in-out infinite', label: '刚睡醒' },
  lively: { anim: 'cat-bob 2.4s ease-in-out infinite', label: '精神得很' },
  dozy: { anim: 'cat-breathe 6.4s ease-in-out infinite', label: '有点打盹' },
  night: { anim: 'cat-sway 3.4s ease-in-out infinite', label: '夜的猫' },
}

export function CatImage({ stage, animate = true, className = '' }: { stage: CatImageStage; animate?: boolean; className?: string }) {
  const mood = catMoodAt().mood
  const motion = MOOD_MOTION[mood]
  return (
    <picture>
      <source
        srcSet={`${imgSrc(stage)} 512w, ${imgSrc(stage, '@2x')} 900w`}
        sizes="(max-width: 760px) 260px, 420px"
        type="image/webp"
      />
      <img
        className={`cat-img ${animate ? 'is-alive' : ''} ${className}`.trim()}
        src={imgFallback(stage)}
        alt={`营地猫 · ${stage}`}
        width={512}
        height={512}
        decoding="async"
        fetchPriority="high"
        style={animate ? { animation: motion.anim } : undefined}
      />
    </picture>
  )
}
