type PetStage = 'kitten' | 'young' | 'adult' | 'legend'
export const BADGES = [
  {
    id: 'night_owl',
    name: '凌晨一点还在练',
    desc: '凌晨 0 点到 4 点之间完成一次练习',
    hint: '夜深了还在开口练 —— 这个点还在的人，才是真的想考过。',
  },
  {
    id: 'reject_three',
    name: '连续三次拒绝搭子',
    desc: '连续拒绝 3 个搭子申请（中间接受一次就要重新算）',
    hint: '不是高冷，是知道自己该和谁一起练。',
  },
  {
    id: 'lamp_seven',
    name: '灯连续亮七晚',
    desc: '营地那盏灯连续点亮 7 天',
    hint: '七天，每天都没断。灯亮着，说明你也亮着。',
  },
  {
    id: 'first_story',
    name: '第一个留下经验的人',
    desc: '在经验条里提交过自己的备考方法',
    hint: '你写下的那一句，可能是别人最需要的那一句。',
  },
  {
    id: 'cat_friend',
    name: '猫认了你',
    desc: '给营地猫投喂累计 20 次',
    hint: '它不认人，只认天天来的人。',
  },
  {
    id: 'archive_hero',
    name: '档案共建者',
    desc: '补全过本校考场档案',
    hint: '这些信息，学校官网不会写。',
  },
]

/** 猫的形态按全营地投喂量推进 */
export const PET_STAGES: { stage: PetStage; label: string; need: number; line: string }[] = [
  { stage: 'kitten', label: '刚来的小猫', need: 0, line: '它还躲在你脚边，只敢看着你练。' },
  { stage: 'young', label: '开始跟着叫', need: 15, line: '你念一句，它叫一声，好像在跟你对练。' },
  { stage: 'adult', label: '会趴在桌上', need: 50, line: '它现在会趴在你作文本旁边，一动不动陪你写完。' },
  { stage: 'legend', label: '营地的老猫', need: 120, line: '新来的人都说，这只猫听得懂雅思口语。' },
]

export function petStageOf(fed: number) {
  let current = PET_STAGES[0]
  for (const item of PET_STAGES) if (fed >= item.need) current = item
  return current
}

/** 营地整体等级：这里是"这个地方"在升级，不是个人 */
export const CAMP_LEVELS: { level: number; need: number; title: string }[] = [
  { level: 1, need: 0, title: '刚点灯的营地' },
  { level: 2, need: 600, title: '有人开始互相约练' },
  { level: 3, need: 1800, title: '走廊里有人背单词' },
  { level: 4, need: 4000, title: '半夜还有灯亮着' },
  { level: 5, need: 8000, title: '成了别人口中"那个营地"' },
  { level: 6, need: 15000, title: '新来的人先来问一句"怎么练"' },
]

export function campLevelOf(exp: number) {
  let current = CAMP_LEVELS[0]
  let next: (typeof CAMP_LEVELS)[number] | null = null
  for (let i = 0; i < CAMP_LEVELS.length; i++) {
    if (exp >= CAMP_LEVELS[i].need) {
      current = CAMP_LEVELS[i]
      next = CAMP_LEVELS[i + 1] ?? null
    }
  }
  const span = next ? next.need - current.need : 1
  const progress = next ? Math.min(100, Math.round(((exp - current.need) / span) * 100)) : 100
  return { level: current.level, title: current.title, progress, next: next?.need ?? null }
}

export type CatMood = 'sleepy' | 'lively' | 'dozy' | 'night'
export function catMoodAt(date = new Date()): { mood: CatMood; label: string; line: string } {
  const h = date.getHours()
  if (h >= 5 && h < 10) return { mood: 'sleepy', label: '刚睡醒', line: '它刚伸完懒腰，还没完全醒。' }
  if (h >= 10 && h < 17) return { mood: 'lively', label: '精神得很', line: '尾巴一直在摆，像是在催你开始。' }
  if (h >= 17 && h < 22) return { mood: 'dozy', label: '有点打盹', line: '它趴在旁边，眼睛半睁着看你。' }
  return { mood: 'night', label: '夜的猫', line: '这个点它最清醒 —— 和你一样。' }
}

// ---------------------------------------------------------------------------
// 猫粮：完成题目攒饲料 → 兑换猫粮 → 喂猫
// ---------------------------------------------------------------------------

/**
 * 饲料换算：每答完 2 道题得 1 份饲料。
 * 用「题目数」而不是「练习次数」，是因为练 1 道题和练 20 道题不该等价。
 * 取 2 而不是 5：一套听力/阅读练习通常 4~8 题，门槛太高会让人永远换不到第一份，
 * 反馈延迟就失去了"上头"的作用。实测一次练习可得 2~4 份，刚好够换 1 份猫粮。
 */
export const QUESTIONS_PER_FEED = 2

/** 三种猫粮：越好的猫粮需要越多饲料，但投喂给猫的成长值也越高 */
export interface CatFood {
  id: string
  name: string
  emoji: string
  /** 兑换所需饲料 */
  cost: number
  /** 兑换后获得的投喂量（影响猫的形态进度） */
  value: number
  desc: string
}

export const CAT_FOODS: CatFood[] = [
  { id: 'biscuit', name: '普通猫粮', emoji: '🥣', cost: 2, value: 1, desc: '日常口粮，稳稳地把猫喂大' },
  { id: 'can', name: '罐头', emoji: '🥫', cost: 6, value: 3, desc: '一罐顶三份，猫会叫得更响' },
  { id: 'sashimi', name: '三文鱼', emoji: '🐟', cost: 12, value: 6, desc: '只有认真练过的人才舍得换' },
]

