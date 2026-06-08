import type { ResumeData } from "@/types/resume"
import { normalizeResumeData } from "./normalize"

export function prepareResumeDataForPreview(data: ResumeData): ResumeData {
  const normalized = normalizeResumeData(data)
  const section = normalized.personalInfoSection
  if (section?.avatarType !== "idPhoto" || section.avatarShape === "square") {
    return normalized
  }
  return {
    ...normalized,
    personalInfoSection: {
      ...section,
      avatarShape: "square",
    },
  }
}
