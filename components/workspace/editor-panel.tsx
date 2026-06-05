"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Icon } from "@iconify/react"
import type { ResumeData } from "@/types/resume"
import { useResumeWorkspace } from "@/lib/agent/store"
import { runCheckup } from "@/lib/agent/checkup"
import PersonalInfoEditor from "@/components/personal-info-editor"
import JobIntentionEditor from "@/components/job-intention-editor"
import ModuleEditor from "@/components/module-editor"

/** 编辑器顶部的主动体检提示条 */
function CheckupBanner() {
  const ws = useResumeWorkspace()
  const [dismissed, setDismissed] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const issues = useMemo(() => runCheckup(ws.resumeData), [ws.resumeData])

  if (dismissed || issues.length === 0) return null

  const warnCount = issues.filter((i) => i.level === "warn").length

  const fix = (prompt: string) => {
    ws.setMode("edit")
    ws.setAgentOpen(true)
    ws.setKickoff(prompt)
  }

  return (
    <Card className="border-amber-300/60 bg-amber-50/60 p-3 dark:bg-amber-950/20">
      <div className="flex items-center justify-between gap-2">
        <button
          className="flex min-w-0 items-center gap-2 text-left"
          onClick={() => setCollapsed((v) => !v)}
        >
          <Icon icon="mdi:stethoscope" className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="text-sm font-medium">
            简历体检：发现 {issues.length} 项可优化
            {warnCount ? <span className="text-amber-600">（{warnCount} 项建议优先处理）</span> : null}
          </span>
          <Icon
            icon={collapsed ? "mdi:chevron-down" : "mdi:chevron-up"}
            className="h-4 w-4 shrink-0 text-muted-foreground"
          />
        </button>
        <button
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => setDismissed(true)}
          title="忽略本次体检"
        >
          <Icon icon="mdi:close" className="h-4 w-4" />
        </button>
      </div>

      {!collapsed ? (
        <ul className="mt-2 space-y-1.5">
          {issues.map((it) => (
            <li key={it.id} className="flex items-start justify-between gap-2 text-xs">
              <span className="min-w-0">
                <span className="font-medium">{it.title}</span>
                <span className="text-muted-foreground"> · {it.detail}</span>
              </span>
              <button
                className="shrink-0 whitespace-nowrap text-primary hover:underline"
                onClick={() => fix(it.prompt)}
              >
                让 AI 修
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

/**
 * 左侧手工编辑面板：读取共享 store，所有改动经 updateResume 写回。
 * dense：三分屏（AI 开启）时收紧留白，避免内容被挤压变形。
 */
export default function EditorPanel({ dense = false }: { dense?: boolean }) {
  const { resumeData, updateResume } = useResumeWorkspace()

  const update = (updates: Partial<ResumeData>) => updateResume(updates)

  return (
    <div className={dense ? "p-4 space-y-4" : "p-6 space-y-6"}>
      <CheckupBanner />

      {/* 简历标题编辑 */}
      <Card className="p-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon icon="mdi:format-title" className="w-5 h-5 text-primary" />
              <h2 className="font-medium">简历标题</h2>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => update({ centerTitle: !resumeData.centerTitle })}
              className="gap-2 bg-transparent"
            >
              <Icon
                icon={resumeData.centerTitle ? "mdi:format-align-center" : "mdi:format-align-left"}
                className="w-4 h-4"
              />
              {resumeData.centerTitle ? "居中显示" : "左对齐"}
            </Button>
          </div>
          <Input
            value={resumeData.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="请输入简历标题或姓名"
            className="text-lg font-medium"
          />
        </div>
      </Card>

      {/* 求职意向编辑 */}
      <JobIntentionEditor
        jobIntentionSection={resumeData.jobIntentionSection}
        onUpdate={(jobIntentionSection) => update({ jobIntentionSection })}
      />

      {/* 个人信息编辑 */}
      <PersonalInfoEditor
        personalInfoSection={resumeData.personalInfoSection}
        avatar={resumeData.avatar}
        onUpdate={(personalInfoSection, avatar) => {
          const updates: Partial<ResumeData> = { personalInfoSection }
          if (avatar !== undefined) updates.avatar = avatar
          update(updates)
        }}
      />

      {/* 简历模块编辑 */}
      <ModuleEditor modules={resumeData.modules} onUpdate={(modules) => update({ modules })} />
    </div>
  )
}
