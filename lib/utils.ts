// Copyright (c) 2025 wzdnzd
// SPDX-License-Identifier: MIT
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
export {
  createDefaultResumeData,
  createNewJobIntentionItem,
  createNewModule,
  createNewPersonalInfoItem,
  generatePdfFilename,
  validateResumeData,
} from "@/lib/resume-core"

// Tailwind className merge helper
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
