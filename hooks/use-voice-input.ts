"use client"

import { useCallback, useEffect, useRef, useState } from "react"

function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
}

export function useVoiceInput() {
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [supported, setSupported] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeTypeRef = useRef<string>("audio/webm")

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof MediaRecorder !== "undefined",
    )
  }, [])

  const cleanupStream = useCallback(() => {
    mediaRecorderRef.current = null
    chunksRef.current = []
    const stream = mediaStreamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }, [])

  useEffect(() => () => cleanupStream(), [cleanupStream])

  const startRecording = useCallback(async () => {
    if (!supported || recording || transcribing) return false
    setError(null)
    chunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      const mimeType = pickRecorderMimeType()
      mimeTypeRef.current = mimeType || "audio/webm"
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.start()
      setRecording(true)
      return true
    } catch (cause) {
      cleanupStream()
      const message =
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "未获得麦克风权限，请在浏览器设置中允许访问"
          : cause instanceof Error
            ? cause.message
            : "无法启动录音"
      setError(message)
      return false
    }
  }, [cleanupStream, recording, supported, transcribing])

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === "inactive") {
      setRecording(false)
      cleanupStream()
      return null
    }

    setRecording(false)
    setTranscribing(true)
    setError(null)

    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        const next = new Blob(chunksRef.current, { type: mimeTypeRef.current })
        cleanupStream()
        resolve(next)
      }
      recorder.onerror = () => {
        cleanupStream()
        reject(new Error("录音失败"))
      }
      recorder.stop()
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "录音失败"
      setError(message)
      return null
    })

    if (!blob || blob.size === 0) {
      setTranscribing(false)
      setError("录音为空，请重试")
      return null
    }

    try {
      const formData = new FormData()
      const extension = mimeTypeRef.current.includes("mp4") ? "m4a" : "webm"
      formData.append("file", blob, `recording.${extension}`)

      const response = await fetch("/api/audio/transcriptions", {
        method: "POST",
        body: formData,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : "语音识别失败")
      }

      const text = typeof payload.text === "string" ? payload.text.trim() : ""
      if (!text) throw new Error("未识别到有效语音内容")
      return text
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "语音识别失败"
      setError(message)
      return null
    } finally {
      setTranscribing(false)
    }
  }, [cleanupStream])

  const toggleRecording = useCallback(async (): Promise<string | null> => {
    if (transcribing) return null
    if (recording) return stopRecording()
    const started = await startRecording()
    return started ? null : null
  }, [recording, startRecording, stopRecording, transcribing])

  return {
    supported,
    recording,
    transcribing,
    error,
    startRecording,
    stopRecording,
    toggleRecording,
    clearError: () => setError(null),
  }
}
