export type InterviewRoundId = "hr" | "technical" | "project" | "scenario" | "behavioral" | "leader"

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
    questionFocus: ["基础原理", "编码与算法", "性能与规模", "故障排查", "技术选型理由"],
  },
  {
    id: "project",
    interviewer: "沈岩",
    round: "项目深挖",
    label: "沈岩 · 项目深挖",
    personality: "较真、刨根问底；只认简历里写过的项目，追问架构细节与个人贡献边界。",
    behavior: [
      "开场会指定简历中的 1-2 个核心项目，要求候选人先讲清背景与个人角色",
      "对每个技术决策都会追问「为什么这样选、还考虑过什么、代价是什么」",
      "不接受「我们团队做了」；反复确认个人负责模块、难点与可量化结果",
      "会模拟极端情况：规模 10x、关键同事离职、需求突变时方案如何调整",
    ],
    questionFocus: ["简历项目真实性", "架构与 trade-off", "个人贡献边界", "技术难点与复盘", "结果量化"],
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

/** 本轮 plan / present 时 kind 字段允许的取值（禁止填其他轮次名称） */
export function interviewRoundQuestionKinds(round: InterviewRoundProfile): string[] {
  const base = round.round
  switch (round.id) {
    case "hr":
      return [base, "求职动机", "职业规划", "文化契合", "薪资与到岗"]
    case "technical":
      return [base, "基础原理", "算法与实现", "系统设计", "故障排查"]
    case "project":
      return [base, "项目背景", "架构设计", "个人贡献", "技术难点", "结果复盘"]
    case "scenario":
      return [base, "场景拆解", "方案设计", "协作推进", "优先级判断"]
    case "behavioral":
      return [base, "STAR 经历", "冲突处理", "失败复盘", "影响力", "协作沟通"]
    case "leader":
      return [base, "战略判断", "行业洞察", "带人培养", "长期愿景", "价值观"]
    default:
      return [base]
  }
}

const ROUND_QUESTION_PLANS: Record<InterviewRoundId, string[]> = {
  hr: [
    "本场 5 题全部属于 HR 面，不问技术原理、不问 STAR 冲突故事、不做项目架构深挖。",
    "第 1 题（medium）：求职动机 + 与目标岗位的匹配（可锚定简历中的 1 处经历，kind=求职动机）。",
    "第 2 题（medium）：职业规划或稳定性（离职/转岗原因须温和追问，kind=职业规划）。",
    "第 3 题（medium）：沟通协作或文化契合（kind=文化契合）。",
    "第 4 题（hard）：岗位/团队偏好、工作方式或价值观（kind=文化契合）。",
    "第 5 题（curveball）：薪资预期、到岗时间或异地/编制等现实因素（kind=薪资与到岗）。",
  ],
  technical: [
    "本场 5 题全部属于技术面，不问求职动机、不问薪资、不用 STAR 行为故事代替技术考察。",
    "第 1-2 题（medium）：岗位相关基础原理或编码/学科核心知识（kind=基础原理）。",
    "第 3 题（hard）：结合简历经历的技术实践或方案细节（kind=算法与实现 或 系统设计）。",
    "第 4 题（hard）：trade-off、性能/规模或边界情况（kind=系统设计）。",
    "第 5 题（curveball）：故障排查、极端场景或「若重来会改什么」（kind=故障排查）。",
  ],
  project: [
    "本场 5 题全部属于项目深挖，每题必须锚定简历中写明的具体项目/经历，禁止空泛「介绍一个项目」。",
    "第 1 题（medium）：指定简历中核心项目，讲清背景、目标与个人角色（kind=项目背景）。",
    "第 2 题（hard）：该项目的关键技术/教学方案选型与 trade-off（kind=架构设计）。",
    "第 3 题（hard）：个人负责模块与量化结果，不接受「我们做了」（kind=个人贡献）。",
    "第 4 题（hard）：最难的技术/执行难点与如何攻克（kind=技术难点）。",
    "第 5 题（curveball）：规模 10x、资源突变或复盘——若重来会改什么（kind=结果复盘）。",
  ],
  scenario: [
    "本场 5 题全部属于场景面，每题给出与目标岗位相关的具体业务/教学/工作场景。",
    "第 1-2 题（medium）：常见场景下的问题拆解与第一步行动（kind=场景拆解）。",
    "第 3 题（hard）：资源受限或多方利益冲突下的方案取舍（kind=方案设计）。",
    "第 4 题（hard）：跨部门/家校/团队协作如何推进（kind=协作推进）。",
    "第 5 题（curveball）：时间紧、指标硬时的优先级与结果衡量（kind=优先级判断）。",
  ],
  behavioral: [
    "本场 5 题全部属于行为面，用 STAR 考察过往经历；不问求职动机、不问薪资、不问技术原理。",
    "第 1 题（medium）：影响力或协作——你个人具体做了什么（kind=STAR 经历）。",
    "第 2 题（medium）：冲突或分歧如何处理（kind=冲突处理）。",
    "第 3 题（hard）：失败/挫折与复盘成长（kind=失败复盘）。",
    "第 4 题（hard）：推动他人或改变结果的案例（kind=影响力）。",
    "第 5 题（curveball）：高压/多任务下的取舍与沟通（kind=协作沟通）。",
  ],
  leader: [
    "本场 5 题全部属于 Leader 面，少问细节多问判断与格局；不问技术实现细节、不问薪资。",
    "第 1 题（medium）：对岗位所在行业/业务趋势的判断（kind=行业洞察）。",
    "第 2 题（hard）：重大取舍或战略方向的思考案例（kind=战略判断）。",
    "第 3 题（hard）：带人、培养他人或构建团队的经验（kind=带人培养）。",
    "第 4 题（hard）：3-5 年愿景与岗位契合（kind=长期愿景）。",
    "第 5 题（curveball）：价值观、决策哲学或逆境中的选择（kind=价值观）。",
  ],
}

const FORBIDDEN_KINDS_BY_ROUND: Record<InterviewRoundId, string[]> = {
  hr: ["行为面", "技术面", "项目深挖", "场景面", "Leader 面"],
  technical: ["HR 面", "行为面", "项目深挖", "场景面", "Leader 面", "求职动机"],
  project: ["HR 面", "行为面", "技术面", "场景面", "Leader 面", "求职动机"],
  scenario: ["HR 面", "行为面", "技术面", "项目深挖", "Leader 面", "求职动机"],
  behavioral: ["HR 面", "技术面", "项目深挖", "场景面", "Leader 面", "求职动机", "薪资与到岗"],
  leader: ["HR 面", "行为面", "技术面", "项目深挖", "场景面", "求职动机"],
}

/** 本轮 5 题规划的专用约束（注入 system prompt，覆盖通用混题型指引） */
export function interviewRoundQuestionPlanningBlock(round: InterviewRoundProfile): string {
  const kinds = interviewRoundQuestionKinds(round)
  const forbidden = FORBIDDEN_KINDS_BY_ROUND[round.id] || []
  return [
    "【本场 5 题规划 · 必须严格执行】",
    `当前轮次：${round.round}（${round.interviewer}）。plan_interview_questions 与 present_interview_question 的 kind 只能从以下取值中选择：${kinds.join("、")}。`,
    `禁止将 kind 填为其他轮次名称：${forbidden.join("、")}。`,
    "每题须填写 question、kind、rationale、difficulty（easy/medium/hard/curveball）、targetDimension、followUpHints（2-3 条内部追问，不展示给用户）。",
    "题目内容、口吻与考察点必须贴合上方「本轮出题与追问重点」，不得混入其他轮次题库。",
    ...ROUND_QUESTION_PLANS[round.id],
    "present_interview_question 展示题目时，kind 必须与该题在 plan 中登记的 kind 一致。",
  ].join("\n")
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
    "- plan_interview_questions 的 kind 只能从本轮允许列表中选择，且须贴合上述重点",
    "- 不得混用其他轮次题库或风格",
  ].join("\n")
}

export function interviewRoundIntakeNote(round: InterviewRoundProfile): string {
  return [
    "【用户已在界面选择面试轮次，不要再询问】",
    `已选轮次：${round.round}`,
    "正式面试官身份已由系统记录，仅进入面试台后启用；intake 阶段不要自称面试官。",
    "intake 阶段你的身份仍是模拟面试设定与公司岗位研究助手，只负责收集公司/岗位/JD、做研究并整理 briefing。",
    "可参考本轮关注方向来组织研究摘要，但不要进入正式面试、不要按面试官人格说话、不要自报面试官身份。",
    `本轮关注方向：${round.questionFocus.join("、")}`,
    "收集完岗位信息后，finish_intake 的 briefing 只需保留轮次、岗位/公司/JD 与用户补充要点，不要粘贴人格设定。",
  ].join("\n\n")
}

export function resolveInterviewRoundFromBriefing(briefing: string): InterviewRoundProfile {
  return resolveInterviewRound(briefing)
}

/** 优先使用会话记录的 roundId，其次从 briefing 结构化标记解析 */
export function resolveInterviewRound(
  briefing: string,
  roundId?: InterviewRoundId,
): InterviewRoundProfile {
  if (roundId) {
    const fromId = getInterviewRound(roundId)
    if (fromId) return fromId
  }
  const id = parseInterviewRoundIdFromBriefing(briefing)
  return (id && getInterviewRound(id)) || getInterviewRound(DEFAULT_INTERVIEW_ROUND_ID)!
}

/** 从 briefing 文本中解析出轮次 id，供工作台注入人格 */
export function parseInterviewRoundIdFromBriefing(briefing: string): InterviewRoundId | undefined {
  const markerMatch = briefing.match(/【本轮面试】\s*([^\n]+)/)
  if (markerMatch) {
    const line = markerMatch[1].trim()
    for (const round of INTERVIEW_ROUNDS) {
      if (line === round.label || line.includes(round.label)) return round.id
    }
  }

  const interviewerMatch = briefing.match(/^面试官：\s*([^\n]+)/m)
  if (interviewerMatch) {
    const name = interviewerMatch[1].trim()
    const round = INTERVIEW_ROUNDS.find((item) => item.interviewer === name)
    if (round) return round.id
  }

  for (const round of INTERVIEW_ROUNDS) {
    if (briefing.includes(`${round.interviewer}（${round.round}）`)) {
      return round.id
    }
  }
  return undefined
}
