"use client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Icon } from "@iconify/react"
import type { ResumeData } from "@/types/resume"
import { useResumeWorkspace } from "@/lib/agent/store"
import PersonalInfoEditor from "@/components/personal-info-editor"
import JobIntentionEditor from "@/components/job-intention-editor"
import ModuleEditor from "@/components/module-editor"

/**
 * 左侧手工编辑面板：读取共享 store，所有改动经 updateResume 写回。
 * dense：三分屏（AI 开启）时收紧留白，避免内容被挤压变形。
 */
export default function EditorPanel({ dense = false }: { dense?: boolean }) {
  const { resumeData, updateResume } = useResumeWorkspace()

  const update = (updates: Partial<ResumeData>) => updateResume(updates)

  return (
    <div className={dense ? "p-4 space-y-4" : "p-6 space-y-6"}>
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
