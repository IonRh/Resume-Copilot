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
import type {
  AgentCard,
  AgentMode,
  AgentSession,
  AgentTurn,
  AssistantTurnPart,
  ChangeSet,
  StagedChange,
  ToolStep,
  WorkspaceSelection,
} from "./types"

const HISTORY_LIMIT = 50
const MANUAL_COALESCE_MS = 1000

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
  | { type: "SET_MODE"; mode: AgentMode }
  | { type: "NEW_SESSION"; mode?: AgentMode }
  | { type: "SWITCH_SESSION"; id: string }
  | { type: "SET_KICKOFF"; kickoff: string | null }
  | { type: "SET_HYDRATED" }
  | { type: "HYDRATE"; sessions: AgentSession[]; activeSessionId: string; jd: string }

const now = () => Date.now()
const stamp = (data: ResumeData): ResumeData => ({ ...data, updatedAt: new Date().toISOString() })
const partId = (prefix: string) => `${prefix}-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

type PersistedChange = Omit<ChangeSet, "apply">
type PersistedStagedChange = {
  change: PersistedChange
  status: StagedChange["status"]
}
type PersistedAgentState = {
  sessions?: AgentSession[]
  activeSessionId?: string
  turns?: AgentTurn[]
  staged?: PersistedStagedChange[]
  jd?: string
  mode?: AgentMode
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
      if (!item || item.status !== "pending" || !item.change.apply) return state
      const past = [...state.past, state.resumeData].slice(-HISTORY_LIMIT)
      return {
        ...mapActiveSession(state, (session) => ({
          ...session,
          staged: session.staged.map((s) =>
            s.change.id === action.id ? { ...s, status: "accepted" } : s,
          ),
        })),
        resumeData: stamp(item.change.apply(state.resumeData)),
        past,
        future: [],
        lastSource: "agent",
        highlightedIds: item.change.targetIds,
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
      const pending = (active?.staged || []).filter((s) => s.status === "pending" && s.change.apply)
      if (pending.length === 0) return state
      const acceptedIds = new Set(pending.map((s) => s.change.id))
      const past = [...state.past, state.resumeData].slice(-HISTORY_LIMIT)
      let nextData = state.resumeData
      const highlight: string[] = []
      pending.forEach((s) => {
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
        resumeData: stamp(nextData),
        past,
        future: [],
        lastSource: "agent",
        highlightedIds: highlight,
      }
    }

    case "REJECT_ALL":
      return mapActiveSession(state, (session) => ({
        ...session,
        staged: session.staged.map((s) => (s.status === "pending" ? { ...s, status: "rejected" } : s)),
      }))

    case "SET_HIGHLIGHT":
      return { ...state, highlightedIds: action.ids }

    case "ADD_TURN":
      return mapActiveSession(state, (session) => ({ ...session, turns: [...session.turns, action.turn] }))

    case "UPDATE_TURN":
      return mapActiveSession(state, (session) => ({
        ...session,
        turns: session.turns.map((t) => (t.id === action.id ? action.updater(t) : t)),
      }))

    case "SET_JD":
      return { ...state, jd: action.jd }

    case "SET_MODE":
      return mapActiveSession(state, (session) => ({ ...session, mode: action.mode }))

    case "NEW_SESSION": {
      const session = createSession(action.mode || "edit")
      return { ...state, sessions: [session, ...state.sessions], activeSessionId: session.id }
    }

    case "SWITCH_SESSION":
      return state.sessions.some((s) => s.id === action.id) ? { ...state, activeSessionId: action.id } : state

    case "SET_KICKOFF":
      return { ...state, kickoff: action.kickoff }

    case "SET_HYDRATED":
      return { ...state, hydrated: true }

    case "HYDRATE":
      return { ...state, sessions: action.sessions, activeSessionId: action.activeSessionId, jd: action.jd, hydrated: true }

    default:
      return state
  }
}

export interface WorkspaceContextValue {
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
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) {
        dispatch({ type: "SET_HYDRATED" })
        return
      }
      const parsed = JSON.parse(raw) as PersistedAgentState
      const hydrated = hydrateAgentState(parsed)
      dispatch({
        type: "HYDRATE",
        sessions: hydrated.sessions,
        activeSessionId: hydrated.activeSessionId,
        jd: parsed.jd || "",
      })
    } catch {
      /* ignore corrupt cache */
      dispatch({ type: "SET_HYDRATED" })
    }
  }, [storageKey])

  useEffect(() => {
    if (!state.hydrated || typeof window === "undefined") return
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
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ sessions, activeSessionId: state.activeSessionId, jd: state.jd }),
        )
      } catch {
        /* quota / serialization errors are non-fatal */
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [state.sessions, state.activeSessionId, state.jd, state.hydrated, storageKey])

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
    addTurn: useCallback((turn: AgentTurn) => dispatch({ type: "ADD_TURN", turn }), []),
    updateTurn: useCallback(
      (id: string, updater: (turn: AgentTurn) => AgentTurn) => dispatch({ type: "UPDATE_TURN", id, updater }),
      [],
    ),
    setJd: useCallback((jd: string) => dispatch({ type: "SET_JD", jd }), []),
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
    const pendingCount = staged.filter((s) => s.status === "pending" && s.change.apply).length
    return {
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
  }, [state, cb])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useResumeWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error("useResumeWorkspace 必须在 ResumeWorkspaceProvider 内使用")
  return ctx
}
