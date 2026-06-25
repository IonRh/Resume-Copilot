"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react"
import type { ResumeData } from "@/types/resume"
import { normalizeResumeTargetIds } from "@/lib/resume-core"
import type {
  AgentCard,
  AgentMode,
  AgentSession,
  AgentTurn,
  AssistantTurnPart,
  ChangeSet,
  JdCard,
  JdMatchState,
  JdSuggestionStatus,
  StagedChange,
  ToolStep,
  WorkspaceSelection,
} from "./types"

const JD_SCORE_HISTORY_LIMIT = 20
const PERSISTED_TURN_LIMIT = 40

/** 为 JD 建议生成稳定 id（基于 section + advice，便于跨版本跟踪状态） */
function suggestionKey(section: string, advice: string): string {
  const raw = `${section}::${advice}`
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0
  }
  return `sug-${(hash >>> 0).toString(36)}`
}

/**
 * 合并新一版匹配卡片与上一版的建议状态：
 * - 为缺失 id 的建议补 id
 * - 沿用上一版相同建议（同 id）的 applied/dismissed 状态，避免重新评分后进度被清零
 */
function mergeJdMatch(prev: JdMatchState | null, card: JdCard): JdMatchState {
  const prevStatusById = new Map<string, JdSuggestionStatus>()
  prev?.current.suggestions.forEach((s) => {
    if (s.id && s.status) prevStatusById.set(s.id, s.status)
  })

  const suggestions = card.suggestions.map((s) => {
    const id = s.id || suggestionKey(s.section, s.advice)
    // 用户已做出的决定（applied/dismissed）具有粘性，重新评分时不被新卡片的默认 pending 覆盖
    const prevStatus = prevStatusById.get(id)
    const status: JdSuggestionStatus =
      prevStatus === "applied" || prevStatus === "dismissed" ? prevStatus : s.status || "pending"
    return { ...s, id, status }
  })

  const at = now()
  const history = [...(prev?.history || []), { score: card.matchScore, at }].slice(-JD_SCORE_HISTORY_LIMIT)
  const appliedCount = suggestions.filter((s) => s.status === "applied").length

  return {
    current: { ...card, suggestions },
    history,
    appliedCount: Math.max(prev?.appliedCount || 0, appliedCount),
  }
}

const HISTORY_LIMIT = 50
const MANUAL_COALESCE_MS = 1000
/** 定位高亮持续时间（毫秒） */
export const RESUME_HIGHLIGHT_MS = 2000

interface WorkspaceState {
  resumeData: ResumeData
  past: ResumeData[]
  future: ResumeData[]
  selection: WorkspaceSelection | null
  agentOpen: boolean
  highlightedIds: string[]
  sessions: AgentSession[]
  activeSessionId: string
  jd: string
  /** 工作区级 JD 匹配状态（常驻匹配面板数据源），随会话切换 */
  jdMatch: JdMatchState | null
  /** 由外部入口（如主页路口）注入的待自动发送指令 */
  kickoff: string | null
  hydrated: boolean
  lastSource: "manual" | "agent" | "init" | null
  lastEditAt: number
}

type Action =
  | { type: "SET_INITIAL"; data: ResumeData }
  | { type: "UPDATE_RESUME"; updates: Partial<ResumeData> }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_SELECTION"; selection: WorkspaceSelection | null }
  | { type: "SET_AGENT_OPEN"; open: boolean }
  | { type: "STAGE_CHANGE"; change: ChangeSet }
  | { type: "ACCEPT_CHANGE"; id: string }
  | { type: "REJECT_CHANGE"; id: string }
  | { type: "ACCEPT_ALL" }
  | { type: "REJECT_ALL" }
  | { type: "SET_HIGHLIGHT"; ids: string[] }
  | { type: "ADD_TURN"; turn: AgentTurn }
  | { type: "UPDATE_TURN"; id: string; updater: (turn: AgentTurn) => AgentTurn }
  | { type: "SET_JD"; jd: string }
  | { type: "SET_JD_MATCH"; card: JdCard }
  | { type: "SET_SUGGESTION_STATUS"; suggestionId: string; status: JdSuggestionStatus }
  | { type: "SET_MODE"; mode: AgentMode }
  | { type: "NEW_SESSION"; mode?: AgentMode }
  | { type: "SWITCH_SESSION"; id: string }
  | { type: "SET_KICKOFF"; kickoff: string | null }
  | { type: "SET_HYDRATED" }
  | {
      type: "HYDRATE"
      sessions: AgentSession[]
      activeSessionId: string
      jd: string
      jdMatch: JdMatchState | null
    }

const now = () => Date.now()
const stamp = (data: ResumeData): ResumeData => ({ ...data, updatedAt: new Date().toISOString() })
const partId = (prefix: string) => `${prefix}-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

type PersistedChange = Omit<ChangeSet, "apply">
type PersistedStagedChange = {
  change: PersistedChange
  status: StagedChange["status"]
}
export type PersistedAgentState = {
  sessions?: AgentSession[]
  activeSessionId?: string
  turns?: AgentTurn[]
  staged?: PersistedStagedChange[]
  jd?: string
  jdMatch?: JdMatchState | null
  mode?: AgentMode
}

function shouldUseInterviewAgentApi(storageKey: string): boolean {
  return storageKey.startsWith("resume.career.interview.")
}

async function loadPersistedAgentState(storageKey: string): Promise<PersistedAgentState | null> {
  if (!shouldUseInterviewAgentApi(storageKey)) {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? (JSON.parse(raw) as PersistedAgentState) : null
  }
  const res = await fetch(`/api/interviews/agent-state?key=${encodeURIComponent(storageKey)}`, { cache: "no-store" })
  if (!res.ok) throw new Error("读取面试对话失败")
  const data = (await res.json()) as { state?: PersistedAgentState | null }
  return data.state || null
}

async function savePersistedAgentState(storageKey: string, state: PersistedAgentState): Promise<void> {
  if (!shouldUseInterviewAgentApi(storageKey)) {
    window.localStorage.setItem(storageKey, JSON.stringify(state))
    return
  }
  const res = await fetch("/api/interviews/agent-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: storageKey, state }),
  })
  if (!res.ok) throw new Error("保存面试对话失败")
}

function appendTextPart(parts: AssistantTurnPart[] | undefined, text: string): AssistantTurnPart[] {
  const existing = parts || []
  const last = existing[existing.length - 1]
  if (last?.type === "text") {
    return [
      ...existing.slice(0, -1),
      { ...last, content: last.content + text },
    ]
  }
  return [...existing, { id: partId("part"), type: "text", content: text }]
}

function appendTextContent(turn: AgentTurn, text: string): string {
  if (!turn.content) return text
  const last = turn.parts?.[turn.parts.length - 1]
  return last?.type === "text" ? turn.content + text : `${turn.content}\n\n${text}`
}

function persistChange(change: ChangeSet): PersistedChange {
  const { apply: _apply, ...persistable } = change
  return persistable
}

function hydrateStaged(items: PersistedStagedChange[] | undefined): StagedChange[] {
  if (!Array.isArray(items)) return []
  return items.map((item) => ({
    change: item.change,
    status: item.status,
    hydrated: true,
  }))
}

function isApplicableChange(change: ChangeSet): boolean {
  return Boolean(change.apply || change.coverLetterDraft)
}

function createSession(mode: AgentMode = "edit", title = "新会话"): AgentSession {
  const ts = new Date().toISOString()
  return {
    id: partId("session"),
    title,
    mode,
    turns: [],
    staged: [],
    createdAt: ts,
    updatedAt: ts,
  }
}

function sessionTitle(turns: AgentTurn[], fallback: string): string {
  const firstUser = turns.find((t) => t.role === "user" && t.content.trim())
  if (!firstUser) return fallback
  const title = firstUser.content.trim().replace(/\s+/g, " ")
  return title.length > 18 ? `${title.slice(0, 18)}...` : title
}

function normalizeSession(session: AgentSession): AgentSession {
  const turns = (session.turns || []).map((t) => ({
    ...t,
    streaming: false,
    steps: t.steps?.map((s) => ({ ...s, status: s.status === "running" ? "done" : s.status })),
    changeIds: t.changeIds,
    parts: t.parts,
  }))
  const staged = (session.staged || []).map((s) => ({
    ...s,
    hydrated: true,
  }))
  return {
    ...session,
    title: session.title || sessionTitle(turns, "历史会话"),
    mode: session.mode || "edit",
    turns,
    staged,
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString(),
  }
}

function hasStreamingTurns(sessions: AgentSession[]): boolean {
  return sessions.some((session) => session.turns.some((turn) => turn.streaming))
}

function hydrateAgentState(parsed: PersistedAgentState): { sessions: AgentSession[]; activeSessionId: string } {
  if (Array.isArray(parsed.sessions) && parsed.sessions.length) {
    const sessions = parsed.sessions.map(normalizeSession)
    const activeSessionId = sessions.some((s) => s.id === parsed.activeSessionId)
      ? parsed.activeSessionId!
      : sessions[0].id
    return { sessions, activeSessionId }
  }

  const legacy = createSession(parsed.mode || "edit", "历史会话")
  legacy.turns = (parsed.turns || []).map((t) => ({
    ...t,
    streaming: false,
    steps: t.steps?.map((s) => ({ ...s, status: s.status === "running" ? "done" : s.status })),
    changeIds: t.changeIds,
    parts: t.parts,
  }))
  legacy.staged = hydrateStaged(parsed.staged)
  legacy.title = sessionTitle(legacy.turns, "历史会话")
  return { sessions: [legacy], activeSessionId: legacy.id }
}

function mapActiveSession(state: WorkspaceState, updater: (session: AgentSession) => AgentSession): WorkspaceState {
  const ts = new Date().toISOString()
  return {
    ...state,
    sessions: state.sessions.map((session) => {
      if (session.id !== state.activeSessionId) return session
      const next = updater(session)
      return {
        ...next,
        title: sessionTitle(next.turns, next.title),
        updatedAt: ts,
      }
    }),
  }
}

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case "SET_INITIAL":
      return { ...state, resumeData: action.data, past: [], future: [], lastSource: "init" }

    case "UPDATE_RESUME": {
      const ts = now()
      const coalesce = state.lastSource === "manual" && ts - state.lastEditAt < MANUAL_COALESCE_MS
      const past = coalesce ? state.past : [...state.past, state.resumeData].slice(-HISTORY_LIMIT)
      return {
        ...state,
        resumeData: stamp({ ...state.resumeData, ...action.updates }),
        past,
        future: [],
        lastSource: "manual",
        lastEditAt: ts,
      }
    }

    case "UNDO": {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      return {
        ...state,
        resumeData: previous,
        past: state.past.slice(0, -1),
        future: [state.resumeData, ...state.future].slice(0, HISTORY_LIMIT),
        lastSource: null,
      }
    }

    case "REDO": {
      if (state.future.length === 0) return state
      const next = state.future[0]
      return {
        ...state,
        resumeData: next,
        past: [...state.past, state.resumeData].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        lastSource: null,
      }
    }

    case "SET_SELECTION":
      return { ...state, selection: action.selection }

    case "SET_AGENT_OPEN":
      return { ...state, agentOpen: action.open }

    case "STAGE_CHANGE":
      return mapActiveSession(state, (session) => ({
        ...session,
        staged: [...session.staged, { change: action.change, status: "pending" }],
      }))

    case "ACCEPT_CHANGE": {
      const active = state.sessions.find((s) => s.id === state.activeSessionId)
      const item = active?.staged.find((s) => s.change.id === action.id)
      if (!item || item.hydrated || item.status !== "pending" || !isApplicableChange(item.change)) return state
      const isResumeChange = Boolean(item.change.apply && !item.change.coverLetterDraft)
      const past = isResumeChange ? [...state.past, state.resumeData].slice(-HISTORY_LIMIT) : state.past
      return {
        ...mapActiveSession(state, (session) => ({
          ...session,
          staged: session.staged.map((s) =>
            s.change.id === action.id ? { ...s, status: "accepted" } : s,
          ),
        })),
        resumeData: isResumeChange ? stamp(item.change.apply!(state.resumeData)) : state.resumeData,
        past,
        future: isResumeChange ? [] : state.future,
        lastSource: isResumeChange ? "agent" : state.lastSource,
        highlightedIds: normalizeResumeTargetIds(item.change.targetIds),
      }
    }

    case "REJECT_CHANGE":
      return mapActiveSession(state, (session) => ({
        ...session,
        staged: session.staged.map((s) =>
          s.change.id === action.id && s.status === "pending" ? { ...s, status: "rejected" } : s,
        ),
      }))

    case "ACCEPT_ALL": {
      const active = state.sessions.find((s) => s.id === state.activeSessionId)
      const pending = (active?.staged || []).filter((s) => s.status === "pending" && !s.hydrated && isApplicableChange(s.change))
      if (pending.length === 0) return state
      const acceptedIds = new Set(pending.map((s) => s.change.id))
      const resumePending = pending.filter((s) => s.change.apply && !s.change.coverLetterDraft)
      const past = resumePending.length ? [...state.past, state.resumeData].slice(-HISTORY_LIMIT) : state.past
      let nextData = state.resumeData
      const highlight: string[] = []
      resumePending.forEach((s) => {
        nextData = s.change.apply!(nextData)
        highlight.push(...s.change.targetIds)
      })
      return {
        ...mapActiveSession(state, (session) => ({
          ...session,
          staged: session.staged.map((s) =>
            acceptedIds.has(s.change.id) ? { ...s, status: "accepted" } : s,
          ),
        })),
        resumeData: resumePending.length ? stamp(nextData) : state.resumeData,
        past,
        future: resumePending.length ? [] : state.future,
        lastSource: resumePending.length ? "agent" : state.lastSource,
        highlightedIds: normalizeResumeTargetIds(highlight),
      }
    }

    case "REJECT_ALL":
      return mapActiveSession(state, (session) => ({
        ...session,
        staged: session.staged.map((s) => (s.status === "pending" ? { ...s, status: "rejected" } : s)),
      }))

    case "SET_HIGHLIGHT":
      return { ...state, highlightedIds: normalizeResumeTargetIds(action.ids) }

    case "ADD_TURN":
      return mapActiveSession(state, (session) => ({ ...session, turns: [...session.turns, action.turn] }))

    case "UPDATE_TURN":
      return mapActiveSession(state, (session) => ({
        ...session,
        turns: session.turns.map((t) => (t.id === action.id ? action.updater(t) : t)),
      }))

    case "SET_JD":
      return { ...state, jd: action.jd }

    case "SET_JD_MATCH":
      return { ...state, jdMatch: mergeJdMatch(state.jdMatch, action.card) }

    case "SET_SUGGESTION_STATUS": {
      if (!state.jdMatch) return state
      let changed = false
      const suggestions = state.jdMatch.current.suggestions.map((s) => {
        if (s.id !== action.suggestionId || s.status === action.status) return s
        changed = true
        return { ...s, status: action.status }
      })
      if (!changed) return state
      const appliedCount = suggestions.filter((s) => s.status === "applied").length
      return {
        ...state,
        jdMatch: {
          ...state.jdMatch,
          current: { ...state.jdMatch.current, suggestions },
          appliedCount: Math.max(state.jdMatch.appliedCount, appliedCount),
        },
      }
    }

    case "SET_MODE":
      return mapActiveSession(state, (session) => ({ ...session, mode: action.mode }))

    case "NEW_SESSION": {
      const session = createSession(action.mode || "edit")
      return { ...state, sessions: [session, ...state.sessions], activeSessionId: session.id, jdMatch: null }
    }

    case "SWITCH_SESSION":
      return state.sessions.some((s) => s.id === action.id) ? { ...state, activeSessionId: action.id } : state

    case "SET_KICKOFF":
      return { ...state, kickoff: action.kickoff }

    case "SET_HYDRATED":
      return { ...state, hydrated: true }

    case "HYDRATE":
      return {
        ...state,
        sessions: action.sessions,
        activeSessionId: action.activeSessionId,
        jd: action.jd,
        jdMatch: action.jdMatch,
        hydrated: true,
      }

    default:
      return state
  }
}

export interface WorkspaceContextValue {
  storageKey: string
  resumeData: ResumeData
  selection: WorkspaceSelection | null
  agentOpen: boolean
  staged: StagedChange[]
  pendingCount: number
  highlightedIds: string[]
  sessions: AgentSession[]
  activeSessionId: string
  turns: AgentTurn[]
  jd: string
  jdMatch: JdMatchState | null
  mode: AgentMode
  kickoff: string | null
  hydrated: boolean
  canUndo: boolean
  canRedo: boolean
  /** 始终指向最新 resumeData 的引用（供异步 agent 循环读取） */
  resumeRef: React.MutableRefObject<ResumeData>

  updateResume: (updates: Partial<ResumeData>) => void
  setInitial: (data: ResumeData) => void
  undo: () => void
  redo: () => void

  setSelection: (selection: WorkspaceSelection | null) => void
  clearSelection: () => void

  setAgentOpen: (open: boolean) => void
  toggleAgent: () => void

  stageChange: (change: ChangeSet) => void
  acceptChange: (id: string) => void
  rejectChange: (id: string) => void
  acceptAll: () => void
  rejectAll: () => void
  getStaged: (id: string) => StagedChange | undefined

  setHighlight: (ids: string[]) => void
  /** 短暂高亮目标区域，约 2s 后自动清除（用于「定位」） */
  flashHighlight: (ids: string[]) => void

  addTurn: (turn: AgentTurn) => void
  updateTurn: (id: string, updater: (turn: AgentTurn) => AgentTurn) => void
  appendAssistantText: (id: string, text: string) => void
  addStep: (id: string, step: ToolStep) => void
  patchStep: (id: string, stepId: string, patch: Partial<ToolStep>) => void
  addChangeId: (id: string, changeId: string) => void
  addCard: (id: string, card: AgentCard) => void
  newSession: (mode?: AgentMode) => void
  switchSession: (id: string) => void

  setJd: (jd: string) => void
  setJdMatch: (card: JdCard) => void
  setSuggestionStatus: (suggestionId: string, status: JdSuggestionStatus) => void
  setMode: (mode: AgentMode) => void
  setKickoff: (kickoff: string | null) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function ResumeWorkspaceProvider({
  initialData,
  storageKey,
  children,
}: {
  initialData: ResumeData
  storageKey: string
  children: ReactNode
}) {
  const initialSession = useMemo(() => createSession("edit"), [])
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    resumeData: initialData,
    past: [],
    future: [],
    selection: null,
    agentOpen: false,
    sessions: [initialSession],
    activeSessionId: initialSession.id,
    highlightedIds: [],
    jd: "",
    jdMatch: null,
    kickoff: null,
    hydrated: false,
    lastSource: "init" as const,
    lastEditAt: 0,
  }))

  const resumeRef = useRef(state.resumeData)
  resumeRef.current = state.resumeData

  // 持久化：仅恢复对话/JD/模式（剥离不可序列化与瞬时字段）
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    if (typeof window === "undefined") return
    void loadPersistedAgentState(storageKey)
      .then((parsed) => {
        if (!parsed) {
          dispatch({ type: "SET_HYDRATED" })
          return
        }
        const hydrated = hydrateAgentState(parsed)
        dispatch({
          type: "HYDRATE",
          sessions: hydrated.sessions,
          activeSessionId: hydrated.activeSessionId,
          jd: parsed.jd || "",
          jdMatch: parsed.jdMatch || null,
        })
      })
      .catch(() => {
        /* ignore corrupt cache */
        dispatch({ type: "SET_HYDRATED" })
      })
  }, [storageKey])

  useEffect(() => {
    if (!state.hydrated || typeof window === "undefined") return
    if (hasStreamingTurns(state.sessions)) return
    const timer = window.setTimeout(() => {
      try {
        const sessions = state.sessions.map((session) => ({
          ...session,
          turns: session.turns
            .filter(
              (t) =>
                t.content ||
                (t.parts && t.parts.length) ||
                (t.steps && t.steps.length) ||
                (t.changeIds && t.changeIds.length) ||
                (t.cards && t.cards.length),
            )
            .filter((t) => !t.streaming)
            .slice(-PERSISTED_TURN_LIMIT)
            .map((t) => ({
              id: t.id,
              role: t.role,
              content: t.content,
              parts: t.parts,
              selectionLabel: t.selectionLabel,
              steps: t.steps,
              changeIds: t.changeIds,
              cards: t.cards,
            })),
          staged: session.staged.map((s) => ({
            change: persistChange(s.change),
            status: s.status,
          })),
        }))
        void savePersistedAgentState(storageKey, {
          sessions,
          activeSessionId: state.activeSessionId,
          jd: state.jd,
          jdMatch: state.jdMatch,
        })
      } catch {
        /* quota / serialization errors are non-fatal */
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [state.sessions, state.activeSessionId, state.jd, state.jdMatch, state.hydrated, storageKey])

  useEffect(
    () => () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    },
    [],
  )

  const cb = {
    updateResume: useCallback((updates: Partial<ResumeData>) => dispatch({ type: "UPDATE_RESUME", updates }), []),
    setInitial: useCallback((data: ResumeData) => dispatch({ type: "SET_INITIAL", data }), []),
    undo: useCallback(() => dispatch({ type: "UNDO" }), []),
    redo: useCallback(() => dispatch({ type: "REDO" }), []),
    setSelection: useCallback((selection: WorkspaceSelection | null) => dispatch({ type: "SET_SELECTION", selection }), []),
    clearSelection: useCallback(() => dispatch({ type: "SET_SELECTION", selection: null }), []),
    setAgentOpen: useCallback((open: boolean) => dispatch({ type: "SET_AGENT_OPEN", open }), []),
    stageChange: useCallback((change: ChangeSet) => dispatch({ type: "STAGE_CHANGE", change }), []),
    acceptChange: useCallback((id: string) => dispatch({ type: "ACCEPT_CHANGE", id }), []),
    rejectChange: useCallback((id: string) => dispatch({ type: "REJECT_CHANGE", id }), []),
    acceptAll: useCallback(() => dispatch({ type: "ACCEPT_ALL" }), []),
    rejectAll: useCallback(() => dispatch({ type: "REJECT_ALL" }), []),
    setHighlight: useCallback((ids: string[]) => dispatch({ type: "SET_HIGHLIGHT", ids }), []),
    flashHighlight: useCallback((ids: string[]) => {
      const normalized = normalizeResumeTargetIds(ids)
      if (!normalized.length) return
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
      dispatch({ type: "SET_HIGHLIGHT", ids: [] })
      window.setTimeout(() => {
        dispatch({ type: "SET_HIGHLIGHT", ids: normalized })
        highlightTimerRef.current = window.setTimeout(() => {
          dispatch({ type: "SET_HIGHLIGHT", ids: [] })
          highlightTimerRef.current = null
        }, RESUME_HIGHLIGHT_MS)
      }, 0)
    }, []),
    addTurn: useCallback((turn: AgentTurn) => dispatch({ type: "ADD_TURN", turn }), []),
    updateTurn: useCallback(
      (id: string, updater: (turn: AgentTurn) => AgentTurn) => dispatch({ type: "UPDATE_TURN", id, updater }),
      [],
    ),
    setJd: useCallback((jd: string) => dispatch({ type: "SET_JD", jd }), []),
    setJdMatch: useCallback((card: JdCard) => dispatch({ type: "SET_JD_MATCH", card }), []),
    setSuggestionStatus: useCallback(
      (suggestionId: string, status: JdSuggestionStatus) =>
        dispatch({ type: "SET_SUGGESTION_STATUS", suggestionId, status }),
      [],
    ),
    setMode: useCallback((mode: AgentMode) => dispatch({ type: "SET_MODE", mode }), []),
    newSession: useCallback((mode?: AgentMode) => dispatch({ type: "NEW_SESSION", mode }), []),
    switchSession: useCallback((id: string) => dispatch({ type: "SWITCH_SESSION", id }), []),
    setKickoff: useCallback((kickoff: string | null) => dispatch({ type: "SET_KICKOFF", kickoff }), []),
  }

  const value = useMemo<WorkspaceContextValue>(() => {
    const activeSession = state.sessions.find((s) => s.id === state.activeSessionId) || state.sessions[0]
    const staged = activeSession?.staged || []
    const turns = activeSession?.turns || []
    const mode = activeSession?.mode || "edit"
    const pendingCount = staged.filter((s) => s.status === "pending" && !s.hydrated && isApplicableChange(s.change)).length
    return {
      storageKey,
      resumeData: state.resumeData,
      selection: state.selection,
      agentOpen: state.agentOpen,
      sessions: state.sessions,
      activeSessionId: state.activeSessionId,
      staged,
      pendingCount,
      highlightedIds: state.highlightedIds,
      turns,
      jd: state.jd,
      jdMatch: state.jdMatch,
      mode,
      kickoff: state.kickoff,
      hydrated: state.hydrated,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      resumeRef,
      ...cb,
      toggleAgent: () => dispatch({ type: "SET_AGENT_OPEN", open: !state.agentOpen }),
      getStaged: (id: string) => staged.find((s) => s.change.id === id),
      appendAssistantText: (id: string, text: string) =>
        dispatch({
          type: "UPDATE_TURN",
          id,
          updater: (t) => ({
            ...t,
            content: appendTextContent(t, text),
            parts: appendTextPart(t.parts, text),
          }),
        }),
      addStep: (id: string, step: ToolStep) =>
        dispatch({
          type: "UPDATE_TURN",
          id,
          updater: (t) => ({
            ...t,
            steps: [...(t.steps || []), step],
            parts: [...(t.parts || []), { id: partId("part"), type: "step", stepId: step.id }],
          }),
        }),
      patchStep: (id: string, stepId: string, patch: Partial<ToolStep>) =>
        dispatch({
          type: "UPDATE_TURN",
          id,
          updater: (t) => ({
            ...t,
            steps: (t.steps || []).map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
          }),
        }),
      addChangeId: (id: string, changeId: string) =>
        dispatch({
          type: "UPDATE_TURN",
          id,
          updater: (t) => ({
            ...t,
            changeIds: [...(t.changeIds || []), changeId],
            parts: [...(t.parts || []), { id: partId("part"), type: "change", changeId }],
          }),
        }),
      addCard: (id: string, card: AgentCard) =>
        dispatch({
          type: "UPDATE_TURN",
          id,
          updater: (t) => {
            const cards = [...(t.cards || []), card]
            return {
              ...t,
              cards,
              parts: [...(t.parts || []), { id: partId("part"), type: "card", cardIndex: cards.length - 1 }],
            }
          },
        }),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, cb, storageKey])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useResumeWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useResumeWorkspace 必须在 ResumeWorkspaceProvider 内使用")
  return ctx
}
