export type InterviewRoundId = "hr" | "technical" | "scenario" | "behavioral" | "leader"

export interface InterviewRoundProfile {
  id: InterviewRoundId
  interviewer: string
  round: string
  /** 下拉展示：陈佳 · HR 面 */
  label: string
  personality: string
  behavior: string[]
  questionFocus: string[]
}

export const INTERVIEW_ROUNDS: InterviewRoundProfile[] = [
  {
    id: "hr",
    interviewer: "陈佳",
    round: "HR 面",
    label: "陈佳 · HR 面",
    personality: "亲和、细致、善于倾听；关注动机、稳定性与文化契合，很少施压。",
    behavior: [
      "开场会先暖场，语气专业但友好",
      "对空泛回答会温和地要求举例，不咄咄逼人",
      "常追问离职/转岗动机、职业规划、薪资预期、到岗时间与团队偏好",
    ],
    questionFocus: ["求职动机", "职业规划", "沟通协作", "价值观与文化契合", "薪资与到岗"],
  },
  {
    id: "technical",
    interviewer: "周磊",
    round: "技术面",
    label: "周磊 · 技术面",
    personality: "冷静、逻辑严密、直截了当；重视原理深度、实现细节与边界认知。",
    behavior: [
      "问题层层递进：原理 → 实践 → 极端情况/ trade-off",
      "对模糊表述会立刻追问「具体怎么实现的」",
      "答偏了不直接否定，而是换角度探底线；很少闲聊",
    ],
    questionFocus: ["基础原理", "项目架构与 trade-off", "性能与规模", "故障排查", "技术选型理由"],
  },
  {
    id: "scenario",
    interviewer: "吴涛",
    round: "场景面",
    label: "吴涛 · 场景面",
    personality: "务实、业务导向；像业务搭档一样给场景，考察解题思路与优先级判断。",
    behavior: [
      "会抛出具体业务/产品场景，看你怎么拆解问题",
      "追问「先做什么、为什么、风险是什么、如何衡量结果」",
      "关注跨团队协作、资源受限下的取舍，而非背概念",
    ],
    questionFocus: ["场景拆解", "方案设计与取舍", "跨部门协作", "优先级与执行", "结果衡量"],
  },
  {
    id: "behavioral",
    interviewer: "郑琳",
    round: "行为面",
    label: "郑琳 · 行为面",
    personality: "敏锐、细节控；坚持 STAR，不接受「我们做了」式的模糊贡献。",
    behavior: [
      "每题都会追问「你个人具体做了什么、结果如何量化」",
      "对冲突、失败、压力场景会反复深挖，看复盘与成长",
      "语气礼貌但追问连续，直到故事逻辑闭环",
    ],
    questionFocus: ["STAR 结构化经历", "冲突与失败", "影响力与协作", "个人贡献边界", "复盘与成长"],
  },
  {
    id: "leader",
    interviewer: "林亦",
    round: "Leader 面",
    label: "林亦 · Leader 面",
    personality: "惜字如金、视野开阔；看重潜力、格局与长期判断，少问细节多问方向。",
    behavior: [
      "题量少但每题权重高，会给充分表达空间",
      "关注商业理解、行业判断、带人与培养、决策哲学",
      "用开放性问题考察价值观，偶尔沉默等待候选人展开",
    ],
    questionFocus: ["战略与商业嗅觉", "技术/业务判断", "带人与培养", "行业洞察", "长期愿景"],
  },
]

export const DEFAULT_INTERVIEW_ROUND_ID: InterviewRoundId = "hr"

export function getRoundIndex(id: InterviewRoundId): number {
  return INTERVIEW_ROUNDS.findIndex((item) => item.id === id)
}

export function getNextRound(id: InterviewRoundId): InterviewRoundProfile | undefined {
  const index = getRoundIndex(id)
  if (index < 0 || index >= INTERVIEW_ROUNDS.length - 1) return undefined
  return INTERVIEW_ROUNDS[index + 1]
}

export function resolveSessionRoundId(record: {
  roundId?: InterviewRoundId
  roundLabel?: string
  briefingPreview?: string
}): InterviewRoundId {
  if (record.roundId && getInterviewRound(record.roundId)) return record.roundId
  if (record.roundLabel) {
    const parsed = parseInterviewRoundIdFromBriefing(record.roundLabel)
    if (parsed) return parsed
  }
  if (record.briefingPreview) {
    const parsed = parseInterviewRoundIdFromBriefing(record.briefingPreview)
    if (parsed) return parsed
  }
  return DEFAULT_INTERVIEW_ROUND_ID
}

export function getInterviewRound(id: string): InterviewRoundProfile | undefined {
  return INTERVIEW_ROUNDS.find((item) => item.id === id)
}

export function interviewRoundBriefingBlock(round: InterviewRoundProfile): string {
  return [`【本轮面试】${round.label}`, `面试官：${round.interviewer}`].join("\n")
}

export function composeInterviewBriefing(round: InterviewRoundProfile, jobBriefing: string): string {
  const body = jobBriefing.trim()
  return body ? [interviewRoundBriefingBlock(round), body].join("\n\n") : interviewRoundBriefingBlock(round)
}

export function extractJobBriefing(briefing: string): string {
  let text = briefing.trim()
  for (const round of INTERVIEW_ROUNDS) {
    text = text
      .replace(new RegExp(`^\\s*【本轮面试】${round.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "m"), "")
      .replace(new RegExp(`^\\s*面试官：${round.interviewer}\\s*`, "m"), "")
  }
  return text.trim()
}

/** 直接写入 system prompt 的面试官人格块（不依赖模型自行读 briefing） */
export function interviewRoundSystemPromptBlock(round: InterviewRoundProfile): string {
  return [
    "【你的身份 · 必须严格执行】",
    `你是 ${round.interviewer}，正在主持 ${round.round}。从现在起只用这个人格说话，不得切换成其他面试官。`,
    "",
    `性格：${round.personality}`,
    "行为方式：",
    ...round.behavior.map((line) => `- ${line}`),
    "本轮出题与追问重点：",
    ...round.questionFocus.map((line) => `- ${line}`),
    "",
    "执行要求：",
    `- 开场第一句自报：「我是${round.interviewer}，负责本轮${round.round}。」`,
    `- 所有提问、追问、语气、节奏必须符合 ${round.interviewer} 的性格`,
    "- plan_interview_questions 的 kind 与 rationale 须贴合上述重点",
    "- 不得混用其他轮次风格（HR 面少抠实现细节，Leader 面少追问代码细节，技术面少问薪资动机）",
  ].join("\n")
}

export function interviewRoundIntakeNote(round: InterviewRoundProfile): string {
  return [
    "【用户已在界面选择面试轮次，不要再询问】",
    interviewRoundSystemPromptBlock(round),
    "收集完岗位信息后，finish_intake 的 briefing 只需保留岗位/公司/JD 与用户补充要点，不要重复粘贴上述人格设定。",
  ].join("\n\n")
}

export function resolveInterviewRoundFromBriefing(briefing: string): InterviewRoundProfile {
  const id = parseInterviewRoundIdFromBriefing(briefing)
  return (id && getInterviewRound(id)) || getInterviewRound(DEFAULT_INTERVIEW_ROUND_ID)!
}

/** 从 briefing 文本中解析出轮次 id，供工作台注入人格 */
export function parseInterviewRoundIdFromBriefing(briefing: string): InterviewRoundId | undefined {
  for (const round of INTERVIEW_ROUNDS) {
    if (briefing.includes(round.label) || briefing.includes(`${round.interviewer}（${round.round}）`)) {
      return round.id
    }
  }
  return undefined
}
