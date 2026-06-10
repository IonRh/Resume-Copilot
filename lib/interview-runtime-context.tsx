"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { InterviewRoundId } from "@/lib/agent/interview-rounds"
import type { InterviewPlayMode } from "@/types/interview-session"

export interface InterviewRuntimeValue {
  playMode: InterviewPlayMode
  sessionId: string
  roundId?: InterviewRoundId
  onInterviewTerminated: () => void
}

const InterviewRuntimeContext = createContext<InterviewRuntimeValue | null>(null)

export function InterviewRuntimeProvider({
  value,
  children,
}: {
  value: InterviewRuntimeValue
  children: ReactNode
}) {
  return <InterviewRuntimeContext.Provider value={value}>{children}</InterviewRuntimeContext.Provider>
}

export function useInterviewRuntime(): InterviewRuntimeValue | null {
  return useContext(InterviewRuntimeContext)
}
