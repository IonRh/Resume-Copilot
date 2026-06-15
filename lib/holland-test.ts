/** Holland（霍兰德）RIASEC 职业兴趣维度 */
export type HollandType = "R" | "I" | "A" | "S" | "E" | "C"

export interface HollandQuestion {
  id: number
  type: HollandType
  text: string
}

export interface HollandScores {
  R: number
  I: number
  A: number
  S: number
  E: number
  C: number
}

export interface HollandResult {
  scores: HollandScores
  /** 按得分从高到低排列的类型代码，如 "IAS" */
  code: string
  /** 各维度中文名与得分，便于展示 */
  ranked: Array<{ type: HollandType; label: string; score: number; max: number }>
  /** 逐题作答：题目 id → 是(true) / 否(false) */
  answers: Record<number, boolean>
  completedAt: string
}

export const HOLLAND_TYPE_LABELS: Record<HollandType, string> = {
  R: "实际型",
  I: "研究型",
  A: "艺术型",
  S: "社会型",
  E: "企业型",
  C: "常规型",
}

export const HOLLAND_TYPE_HINTS: Record<HollandType, string> = {
  R: "偏好动手操作、工具与实物，如工程、制造、运维",
  I: "偏好分析研究、探索规律，如科研、数据分析、开发",
  A: "偏好创造表达、审美设计，如设计、内容、艺术",
  S: "偏好助人沟通、教育服务，如教师、咨询、人力",
  E: "偏好领导说服、商业开拓，如管理、销售、创业",
  C: "偏好秩序细节、流程事务，如行政、财务、运营",
}

/** 36 题精简版霍兰德兴趣测验（每维度 6 题，答「是」计 1 分） */
export const HOLLAND_QUESTIONS: HollandQuestion[] = [
  { id: 1, type: "R", text: "我喜欢修理机械、电器或动手拆装东西" },
  { id: 2, type: "R", text: "我享受户外体力活动或需要动手操作的任务" },
  { id: 3, type: "R", text: "我擅长使用工具、设备或仪器完成具体工作" },
  { id: 4, type: "R", text: "我对机械、工程或硬件的工作原理感兴趣" },
  { id: 5, type: "R", text: "我愿意从事需要体力或现场操作的工作" },
  { id: 6, type: "R", text: "动手制作、组装或改造物品让我有成就感" },

  { id: 7, type: "I", text: "我喜欢做实验、调研或深入钻研某个问题" },
  { id: 8, type: "I", text: "我享受解决复杂的逻辑、数学或技术难题" },
  { id: 9, type: "I", text: "我经常阅读科学、学术或专业深度内容" },
  { id: 10, type: "I", text: "探索未知领域、追根究底让我很有动力" },
  { id: 11, type: "I", text: "我善于独立分析数据并得出自己的结论" },
  { id: 12, type: "I", text: "比起社交活动，我更愿意花时间思考与研究" },

  { id: 13, type: "A", text: "我喜欢绘画、音乐、写作等创造性表达" },
  { id: 14, type: "A", text: "我重视个人风格，不愿被僵硬的规则束缚" },
  { id: 15, type: "A", text: "我对文学、影视、设计或艺术有浓厚兴趣" },
  { id: 16, type: "A", text: "设计美观、有创意的事物让我很有热情" },
  { id: 17, type: "A", text: "在自由、开放的环境中我更容易发挥" },
  { id: 18, type: "A", text: "我愿意尝试非传统路径来实现自我表达" },

  { id: 19, type: "S", text: "我喜欢倾听他人并帮助他们解决问题" },
  { id: 20, type: "S", text: "我善于沟通，容易与不同背景的人建立信任" },
  { id: 21, type: "S", text: "我愿意从事教育、培训或辅导类工作" },
  { id: 22, type: "S", text: "团队合作、与人协作让我感到充实" },
  { id: 23, type: "S", text: "我对公益、志愿服务或关怀他人有兴趣" },
  { id: 24, type: "S", text: "解释复杂概念、让他人理解是我的强项" },

  { id: 25, type: "E", text: "我喜欢组织团队、推动项目并承担责任" },
  { id: 26, type: "E", text: "我善于说服他人、争取资源或机会" },
  { id: 27, type: "E", text: "我对商业、管理或市场开拓有兴趣" },
  { id: 28, type: "E", text: "竞争环境能激发我的斗志与成就感" },
  { id: 29, type: "E", text: "我愿意在不确定情况下果断决策" },
  { id: 30, type: "E", text: "成为负责人、影响结果的方向让我兴奋" },

  { id: 31, type: "C", text: "我喜欢有条理地按计划完成事务性工作" },
  { id: 32, type: "C", text: "我擅长处理数据、文档与细节核对" },
  { id: 33, type: "C", text: "稳定、可预期的工作环境让我更安心" },
  { id: 34, type: "C", text: "遵循流程与规范对我来说并不枯燥" },
  { id: 35, type: "C", text: "我对财务、行政或文书类工作并不排斥" },
  { id: 36, type: "C", text: "把信息整理得清晰准确是我的优势" },
]

const PER_TYPE_MAX = HOLLAND_QUESTIONS.filter((q) => q.type === "R").length

export function scoreHollandAnswers(answers: Record<number, boolean>): HollandResult {
  const scores: HollandScores = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 }
  for (const q of HOLLAND_QUESTIONS) {
    if (answers[q.id]) scores[q.type] += 1
  }
  const ranked = (Object.keys(scores) as HollandType[])
    .map((type) => ({
      type,
      label: HOLLAND_TYPE_LABELS[type],
      score: scores[type],
      max: PER_TYPE_MAX,
    }))
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type))

  return {
    scores,
    code: ranked
      .slice(0, 3)
      .map((r) => r.type)
      .join(""),
    ranked,
    answers: { ...answers },
    completedAt: new Date().toISOString(),
  }
}

export function formatHollandAnswerDetails(answers: Record<number, boolean>): string {
  const lines = HOLLAND_QUESTIONS.map((q) => {
    const ans = answers[q.id]
    const choice = ans === undefined ? "未答" : ans ? "是" : "否"
    return `${q.id}. [${HOLLAND_TYPE_LABELS[q.type]}] ${q.text} → ${choice}`
  })
  return ["【Holland 逐题作答明细】", ...lines].join("\n")
}

export function formatHollandBriefing(result: HollandResult): string {
  const top = result.ranked.slice(0, 3)
  const scoreLine = result.ranked.map((r) => `${r.label}(${r.type}) ${r.score}/${r.max}`).join("；")
  const interpret = top
    .map((r) => `${r.label}：${HOLLAND_TYPE_HINTS[r.type]}`)
    .join("\n")

  return [
    "【Holland 职业兴趣测试结果】",
    `主要兴趣代码：${result.code}（前三维度：${top.map((r) => r.label).join(" > ")}）`,
    `各维度得分：${scoreLine}`,
    "维度解读：",
    interpret,
    "",
    formatHollandAnswerDetails(result.answers),
  ].join("\n")
}

const DISCOVER_CLARIFY_INSTRUCTION = [
  "请先调用 get_resume 了解我的背景，识别仍不确定或存在矛盾的点（例如：兴趣与经历不符、维度得分接近难取舍、简历缺少城市/行业/实习意向等信息）。",
  "用 2-4 个简短、具体的问题向我确认，一次只问一轮，不要同时抛太多；不要在这一轮调用 present_career_directions。",
  "待我回答且信息足够后，再调用 present_career_directions 给出 3-5 个推荐方向（含匹配度、推荐理由、典型岗位与能力缺口），并按匹配度从高到低排序。",
].join("\n")

export function buildDiscoverKickoffPrompt(hollandBriefing?: string | null): string {
  if (hollandBriefing?.trim()) {
    return [
      "我已完成 Holland 职业兴趣测验。请先读取下方测验数据与我的简历，不要立刻输出岗位方向推荐。",
      "",
      hollandBriefing.trim(),
      "",
      DISCOVER_CLARIFY_INSTRUCTION,
      "",
      "综合 Holland 逐题作答、维度得分与简历事实做判断；兴趣信号与能力证据冲突时，优先通过追问澄清，再在推荐中给出务实建议。",
    ].join("\n")
  }

  return [
    "请基于我的简历帮我探索适合的岗位方向，但不要立刻输出推荐。",
    DISCOVER_CLARIFY_INSTRUCTION,
  ].join("\n\n")
}
