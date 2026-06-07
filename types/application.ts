/**
 * 投递管理：求职投递记录的数据模型
 */

/** 投递进度阶段 */
export type ApplicationStatus =
  | "wishlist" // 想投 / 待投递
  | "applied" // 已投递
  | "assessment" // 笔试 / 测评
  | "interview" // 面试中
  | "offer" // 已获 Offer
  | "rejected" // 未通过 / 被拒
  | "closed" // 已关闭 / 主动放弃

/** 投递优先级 */
export type ApplicationPriority = "high" | "normal" | "low"

/**
 * 投递时间线上的一条事件（状态变更、面试、备注等）
 */
export interface ApplicationEvent {
  /** 唯一标识 */
  id: string
  /** 发生时间（ISO 字符串） */
  date: string
  /** 事件类型 */
  type: "status" | "interview" | "note"
  /** 当 type === "status" 时记录推进到的阶段 */
  status?: ApplicationStatus
  /** 事件标题 */
  title: string
  /** 备注内容 */
  note?: string
}

/**
 * 一条投递记录
 */
export interface JobApplication {
  /** 唯一标识 */
  id: string
  /** 公司名称 */
  company: string
  /** 投递岗位 */
  position: string
  /** 工作地点 */
  location?: string
  /** 薪资信息 */
  salary?: string
  /** 投递渠道，如 BOSS直聘 / 官网 / 内推 */
  channel?: string
  /** 联系人 / HR */
  contact?: string
  /** JD 链接 */
  jdUrl?: string
  /** JD 原文 / 关键要求 */
  jdText?: string
  /** 关联的简历 ID */
  resumeId?: string
  /** 关联简历标题快照，用于展示兜底 */
  resumeTitle?: string
  /** 当前进度阶段 */
  status: ApplicationStatus
  /** 优先级 */
  priority?: ApplicationPriority
  /** 投递时间（ISO 字符串） */
  appliedAt?: string
  /** 下一步动作描述 */
  nextAction?: string
  /** 下一步提醒时间（ISO 字符串） */
  nextActionAt?: string
  /** 进度时间线 */
  events: ApplicationEvent[]
  /** 备注 */
  notes?: string
  /** 创建时间 */
  createdAt: string
  /** 最近更新时间 */
  updatedAt: string
}

/** 阶段展示元信息 */
export interface ApplicationStatusMeta {
  value: ApplicationStatus
  label: string
  /** 看板列与徽标使用的色彩类（tailwind） */
  accent: string
  dot: string
  icon: string
}

/** 投递阶段的有序定义，决定看板列顺序与“推进”逻辑 */
export const APPLICATION_STATUS_FLOW: ApplicationStatusMeta[] = [
  { value: "wishlist", label: "想投", accent: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400", icon: "mdi:bookmark-outline" },
  { value: "applied", label: "已投递", accent: "bg-blue-100 text-blue-700 border-blue-200", dot: "bg-blue-500", icon: "mdi:send-outline" },
  { value: "assessment", label: "笔试/测评", accent: "bg-violet-100 text-violet-700 border-violet-200", dot: "bg-violet-500", icon: "mdi:clipboard-text-outline" },
  { value: "interview", label: "面试中", accent: "bg-amber-100 text-amber-700 border-amber-200", dot: "bg-amber-500", icon: "mdi:account-voice" },
  { value: "offer", label: "Offer", accent: "bg-emerald-100 text-emerald-700 border-emerald-200", dot: "bg-emerald-500", icon: "mdi:trophy-outline" },
  { value: "rejected", label: "未通过", accent: "bg-rose-100 text-rose-700 border-rose-200", dot: "bg-rose-500", icon: "mdi:close-circle-outline" },
  { value: "closed", label: "已关闭", accent: "bg-zinc-100 text-zinc-600 border-zinc-200", dot: "bg-zinc-400", icon: "mdi:archive-outline" },
]

/** 进入“进行中”统计的阶段（用于仪表盘） */
export const ACTIVE_APPLICATION_STATUSES: ApplicationStatus[] = [
  "applied",
  "assessment",
  "interview",
]

export function getStatusMeta(status: ApplicationStatus): ApplicationStatusMeta {
  return APPLICATION_STATUS_FLOW.find((item) => item.value === status) ?? APPLICATION_STATUS_FLOW[0]
}

/** 在阶段流转中返回下一个可推进的阶段（offer/拒绝/关闭为终态，返回 null） */
export function getNextStatus(status: ApplicationStatus): ApplicationStatus | null {
  const order: ApplicationStatus[] = ["wishlist", "applied", "assessment", "interview", "offer"]
  const idx = order.indexOf(status)
  if (idx < 0 || idx >= order.length - 1) return null
  return order[idx + 1]
}
