import type { JSONContent, ResumeData } from "@/types/resume"

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
  /** 自荐信工具的待确认草稿，接受后由自荐信工作台写入文档 */
  coverLetterDraft?: CoverLetterDraft
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

/** 单题五维评分（1-5），源自 interview-coach rubric */
export interface InterviewDimensionScores {
  substance?: number
  structure?: number
  relevance?: number
  credibility?: number
  differentiation?: number
}

export interface InterviewReportItem {
  question: string
  score: number
  comment?: string
  dimensions?: InterviewDimensionScores
}

export interface InterviewReportCard {
  type: "interview_report"
  overall: number
  summary?: string
  items: InterviewReportItem[]
  strengths?: string[]
  improvements?: string[]
}

/** 岗位方向推荐：单个推荐方向 */
export interface CareerDirection {
  /** 方向名，如「后端开发」 */
  title: string
  /** 与简历的匹配度 0-100 */
  matchScore: number
  /** 推荐理由：命中了简历中的哪些专业/技能/经历 */
  reason?: string
  /** 该方向的典型岗位 */
  positions?: string[]
  /** 当前简历相对该方向的能力缺口 */
  gaps?: string[]
}

export interface DiscoverCard {
  type: "discover"
  summary?: string
  directions: CareerDirection[]
}

export type AgentCard = ScoreCard | JdCard | InterviewCard | InterviewReportCard | DiscoverCard

export interface CoverLetterDraft {
  title: string
  /** 纯文本副本，便于复制与兼容旧数据 */
  body?: string
  /** 富文本正文（Tiptap JSON） */
  bodyContent?: JSONContent
  scenario?: "formal" | "short" | "referral" | "general"
  highlights?: string[]
  shortVersion?: string
}

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

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | ChatContentPart[] | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

/** Agent 顶部模式 */
export type AgentMode =
  | "edit"
  | "score"
  | "jd"
  | "interview"
  | "interviewAnalysis"
  | "build"
  | "proofread"
  | "design"
  | "quantify"
  | "discover"
  | "coverLetter"
  | "imageImport"

/** 工具执行结果 */
export interface ToolResult {
  ok: boolean
  /** 回传给模型的文本结果 */
  message: string
  /** 变更类工具产出的暂存变更 */
  change?: ChangeSet
  /** 展示类工具产出的卡片 */
  card?: AgentCard
  /** 自荐信专属工具产出的信件草稿 */
  coverLetter?: CoverLetterDraft
  /** 真实模拟：挂面试终止 */
  terminateInterview?: boolean
}
