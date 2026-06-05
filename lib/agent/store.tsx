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
  AgentTurn,
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
  staged: StagedChange[]
  highlightedIds: string[]
  turns: AgentTurn[]
  jd: string
  mode: AgentMode
  /** 由外部入口（如主页路口）注入的待自动发送指令 */
  kickoff: string | null
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
  | { type: "SET_KICKOFF"; kickoff: string | null }
  | { type: "HYDRATE"; turns: AgentTurn[]; jd: string; mode: AgentMode }

const now = () => Date.now()
const stamp = (data: ResumeData): ResumeData => ({ ...data, updatedAt: new Date().toISOString() })

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
      return { ...state, staged: [...state.staged, { change: action.change, status: "pending" }] }

    case "ACCEPT_CHANGE": {
      const item = state.staged.find((s) => s.change.id === action.id)
      if (!item || item.status !== "pending") return state
      const past = [...state.past, state.resumeData].slice(-HISTORY_LIMIT)
      return {
        ...state,
        resumeData: stamp(item.change.apply(state.resumeData)),
        past,
        future: [],
        lastSource: "agent",
        highlightedIds: item.change.targetIds,
        staged: state.staged.map((s) =>
          s.change.id === action.id ? { ...s, status: "accepted" } : s,
        ),
      }
    }

    case "REJECT_CHANGE":
      return {
        ...state,
        staged: state.staged.map((s) =>
          s.change.id === action.id && s.status === "pending" ? { ...s, status: "rejected" } : s,
        ),
      }

    case "ACCEPT_ALL": {
      const pending = state.staged.filter((s) => s.status === "pending")
      if (pending.length === 0) return state
      const past = [...state.past, state.resumeData].slice(-HISTORY_LIMIT)
      let nextData = state.resumeData
      const highlight: string[] = []
      pending.forEach((s) => {
        nextData = s.change.apply(nextData)
        highlight.push(...s.change.targetIds)
      })
      return {
        ...state,
        resumeData: stamp(nextData),
        past,
        future: [],
        lastSource: "agent",
        highlightedIds: highlight,
        staged: state.staged.map((s) => (s.status === "pending" ? { ...s, status: "accepted" } : s)),
      }
    }

    case "REJECT_ALL":
      return {
        ...state,
        staged: state.staged.map((s) => (s.status === "pending" ? { ...s, status: "rejected" } : s)),
      }

    case "SET_HIGHLIGHT":
      return { ...state, highlightedIds: action.ids }

    case "ADD_TURN":
      return { ...state, turns: [...state.turns, action.turn] }

    case "UPDATE_TURN":
      return {
        ...state,
        turns: state.turns.map((t) => (t.id === action.id ? action.updater(t) : t)),
      }

    case "SET_JD":
      return { ...state, jd: action.jd }

    case "SET_MODE":
      return { ...state, mode: action.mode }

    case "SET_KICKOFF":
      return { ...state, kickoff: action.kickoff }

    case "HYDRATE":
      return { ...state, turns: action.turns, jd: action.jd, mode: action.mode }

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
  turns: AgentTurn[]
  jd: string
  mode: AgentMode
  kickoff: string | null
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
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    resumeData: initialData,
    past: [],
    future: [],
    selection: null,
    agentOpen: false,
    staged: [],
    highlightedIds: [],
    turns: [],
    jd: "",
    mode: "edit" as AgentMode,
    kickoff: null,
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
      if (!raw) return
      const parsed = JSON.parse(raw) as { turns?: AgentTurn[]; jd?: string; mode?: AgentMode }
      const turns = (parsed.turns || []).map((t) => ({
        ...t,
        streaming: false,
        steps: undefined,
        changeIds: undefined,
      }))
      dispatch({ type: "HYDRATE", turns, jd: parsed.jd || "", mode: parsed.mode || "edit" })
    } catch {
      /* ignore corrupt cache */
    }
  }, [storageKey])

  useEffect(() => {
    if (!hydratedRef.current || typeof window === "undefined") return
    const timer = window.setTimeout(() => {
      try {
        const persistable = state.turns
          .filter((t) => t.content || (t.cards && t.cards.length))
          .map((t) => ({
            id: t.id,
            role: t.role,
            content: t.content,
            selectionLabel: t.selectionLabel,
            cards: t.cards,
          }))
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({ turns: persistable, jd: state.jd, mode: state.mode }),
        )
      } catch {
        /* quota / serialization errors are non-fatal */
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [state.turns, state.jd, state.mode, storageKey])

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
    setKickoff: useCallback((kickoff: string | null) => dispatch({ type: "SET_KICKOFF", kickoff }), []),
  }

  const value = useMemo<WorkspaceContextValue>(() => {
    const pendingCount = state.staged.filter((s) => s.status === "pending").length
    return {
      resumeData: state.resumeData,
      selection: state.selection,
      agentOpen: state.agentOpen,
      staged: state.staged,
      pendingCount,
      highlightedIds: state.highlightedIds,
      turns: state.turns,
      jd: state.jd,
      mode: state.mode,
      kickoff: state.kickoff,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      resumeRef,
      ...cb,
      toggleAgent: () => dispatch({ type: "SET_AGENT_OPEN", open: !state.agentOpen }),
      getStaged: (id: string) => state.staged.find((s) => s.change.id === id),
      appendAssistantText: (id: string, text: string) =>
        dispatch({ type: "UPDATE_TURN", id, updater: (t) => ({ ...t, content: t.content + text }) }),
      addStep: (id: string, step: ToolStep) =>
        dispatch({ type: "UPDATE_TURN", id, updater: (t) => ({ ...t, steps: [...(t.steps || []), step] }) }),
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
          updater: (t) => ({ ...t, changeIds: [...(t.changeIds || []), changeId] }),
        }),
      addCard: (id: string, card: AgentCard) =>
        dispatch({ type: "UPDATE_TURN", id, updater: (t) => ({ ...t, cards: [...(t.cards || []), card] }) }),
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
