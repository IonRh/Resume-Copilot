import type { ResumeData } from "@/types/resume"

/** 被选中/被引用元素的类型 */
export type SelectionKind =
  | "module"
  | "row"
  | "element"
  | "title"
  | "personal"
  | "jobIntention"

/** 工作区当前选中的元素（用于限定 Agent 上下文） */
export interface WorkspaceSelection {
  kind: SelectionKind
  /** element/row/module 的 id；title/personal/jobIntention 使用 kind 作为占位 id */
  id: string
  moduleId?: string
  rowId?: string
  /** 人类可读标签，如「工作经历 · 第2行 · 第1列」 */
  label: string
  /** 当前文本快照（元素类型时可用） */
  text?: string
}

/** 变更类别 */
export type ChangeKind = "text" | "structure" | "style" | "generate"

/**
 * 单条变更（ChangeSet）：由工具以 dry-run 方式产出，审阅通过后才落地。
 * apply 是纯函数，在内存中持有；不会被序列化。
 */
export interface ChangeSet {
  id: string
  kind: ChangeKind
  /** 操作名（通常是工具名） */
  op: string
  /** 人类可读摘要 */
  summary: string
  /** 应用后需要在预览高亮的元素 id 集合 */
  targetIds: string[]
  /** 文本类变更的前后内容 */
  before?: string
  after?: string
  /** 结构/样式类变更的补充说明 */
  note?: string
  apply?: (data: ResumeData) => ResumeData
}

export type StagedStatus = "pending" | "accepted" | "rejected"

export interface StagedChange {
  change: ChangeSet
  status: StagedStatus
  /** 从本地缓存恢复的历史 diff 只能用于展示，不能再直接执行 apply */
  hydrated?: boolean
}

/** Agent 一次工具调用在 UI 中的展示步骤 */
export interface ToolStep {
  id: string
  tool: string
  label: string
  status: "running" | "done" | "error"
  detail?: string
}

/* ---------- 展示型卡片 ---------- */

export interface ScoreDimension {
  name: string
  score: number
  comment?: string
}

export interface ScoreCard {
  type: "score"
  overall: number
  dimensions: ScoreDimension[]
  strengths?: string[]
  suggestions?: string[]
}

export type JdSuggestionStatus = "pending" | "applied" | "dismissed"

export interface JdSuggestion {
  /** 稳定 id，用于在常驻面板中跟踪「待处理 / 已应用」状态 */
  id?: string
  section: string
  advice: string
  /** 一键应用时发送给 Agent 的指令 */
  prompt?: string
  /** 该建议涉及的简历元素 id（module/row/element），用于点击定位高亮 */
  targetIds?: string[]
  /** 该建议在当前会话中的处理状态 */
  status?: JdSuggestionStatus
}

export interface JdCard {
  type: "jd"
  matchScore: number
  matchedKeywords: string[]
  missingKeywords: string[]
  summary?: string
  suggestions: JdSuggestion[]
}

/** 工作区级别的 JD 匹配状态：贯穿整个会话的常驻匹配面板数据源 */
export interface JdMatchState {
  /** 最新一版匹配卡片 */
  current: JdCard
  /** 历次匹配度评分（用于展示分数变化 delta） */
  history: { score: number; at: number }[]
  /** 本会话内累计已应用的建议数 */
  appliedCount: number
}

export interface InterviewQuestion {
  question: string
  kind?: string
  hint?: string
}

export interface InterviewCard {
  type: "interview"
  intro?: string
  currentIndex?: number
  total?: number
  questions: InterviewQuestion[]
}

export interface InterviewReportItem {
  question: string
  score: number
  comment?: string
}

export interface InterviewReportCard {
  type: "interview_report"
  overall: number
  summary?: string
  items: InterviewReportItem[]
  strengths?: string[]
  improvements?: string[]
}

export type AgentCard = ScoreCard | JdCard | InterviewCard | InterviewReportCard

/* ---------- 对话回合（UI 层） ---------- */

export type TurnRole = "user" | "assistant"

export type AssistantTurnPart =
  | { id: string; type: "text"; content: string }
  | { id: string; type: "step"; stepId: string }
  | { id: string; type: "change"; changeId: string }
  | { id: string; type: "card"; cardIndex: number }

export interface AgentTurn {
  id: string
  role: TurnRole
  content: string
  parts?: AssistantTurnPart[]
  streaming?: boolean
  selectionLabel?: string
  steps?: ToolStep[]
  changeIds?: string[]
  cards?: AgentCard[]
  error?: boolean
}

export interface AgentSession {
  id: string
  title: string
  mode: AgentMode
  turns: AgentTurn[]
  staged: StagedChange[]
  createdAt: string
  updatedAt: string
}

/* ---------- OpenAI 兼容消息格式（API 层） ---------- */

export interface ToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

/** Agent 顶部模式 */
export type AgentMode = "edit" | "score" | "jd" | "interview" | "interviewAnalysis" | "build"

/** 工具执行结果 */
export interface ToolResult {
  ok: boolean
  /** 回传给模型的文本结果 */
  message: string
  /** 变更类工具产出的暂存变更 */
  change?: ChangeSet
  /** 展示类工具产出的卡片 */
  card?: AgentCard
}
