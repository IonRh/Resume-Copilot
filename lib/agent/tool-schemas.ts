/**
 * Agent 工具的 OpenAI function-calling schema 定义。
 * 纯数据，无副作用，可同时被服务端路由与客户端执行器引用。
 *
 * 分为三类：
 *  - 只读：get_resume
 *  - 变更（产出待确认的 ChangeSet）：update_* / add_* / remove_* / set_* / replace_resume
 *  - 展示（渲染分析卡片）：present_*
 */

export interface ToolSchema {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

const columnFormatsSchema = {
  type: "array",
  description:
    "各列富文本格式，可选。用于让新增内容匹配简历样式，例如项目标题列加粗。数组下标对应 texts 的列下标；若 get_resume 显示相邻同类内容为 default-body，通常省略 fontSize/fontFamily。",
  items: {
    type: "object",
    properties: {
      bold: { type: "boolean", description: "是否加粗" },
      fontSize: { type: "string", description: "字号，如 12pt、14pt" },
      fontFamily: { type: "string", description: "字体，如 Microsoft YaHei" },
      textAlign: { type: "string", enum: ["left", "center", "right", "justify"] },
    },
  },
} as const

const rowSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["rich", "tags"] },
    columns: { type: "integer", enum: [1, 2, 3, 4] },
    texts: {
      type: "array",
      items: { type: "string" },
      description: "rich 行各列文本，数量应等于 columns；支持以 - 开头表示项目符号，\\n 换行",
    },
    formats: columnFormatsSchema,
    tags: { type: "array", items: { type: "string" } },
  },
} as const

const draftSchema = {
  type: "object",
  description: "完整简历草稿，用于整篇生成/重写",
  properties: {
    title: { type: "string", description: "简历标题或姓名" },
    centerTitle: { type: "boolean", description: "标题是否居中" },
    themeColor: { type: "string", description: "主题色十六进制，如 #4f46e5" },
    jobIntention: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
              type: { type: "string", enum: ["workYears", "position", "city", "salary", "custom"] },
            },
            required: ["label", "value"],
          },
        },
      },
    },
    personalInfo: {
      type: "array",
      description: "个人信息项，如电话、邮箱、GitHub 等",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          content: { type: "string" },
          type: { type: "string", enum: ["text", "link"] },
          linkTitle: { type: "string", description: "type 为 link 时的显示文字" },
        },
        required: ["label", "content"],
      },
    },
    modules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          rows: {
            type: "array",
            items: rowSchema,
          },
        },
        required: ["title"],
      },
    },
  },
  required: ["title", "modules"],
} as const

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "get_resume",
      description:
        "读取当前简历的完整结构与样式大纲（含各模块/行/元素的 id、文本、列数、字号、字体、加粗、对齐、块类型与默认渲染样式提示）。在做任何修改前，若不确定 id、内容或样式，应先调用本工具。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "update_element_text",
      description: "改写指定文本元素的内容（按 element id 定位）。用于润色、纠错、改写单个单元格/段落。会保留原有对齐方式。",
      parameters: {
        type: "object",
        properties: {
          elementId: { type: "string", description: "目标元素 id（形如 element#xxx 中的 xxx）" },
          text: { type: "string", description: "新的纯文本内容；可用 \\n 换行，行首 - 表示项目符号" },
          bold: { type: "boolean", description: "可选：覆盖是否加粗；省略则继承原元素" },
          fontSize: { type: "string", description: "可选：覆盖字号，如 12pt；省略则继承原元素" },
          fontFamily: { type: "string", description: "可选：覆盖字体；省略则继承原元素" },
          textAlign: { type: "string", enum: ["left", "center", "right", "justify"], description: "可选：覆盖对齐" },
          summary: { type: "string", description: "本次修改的简短说明（中文）" },
        },
        required: ["elementId", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_title",
      description: "更新简历标题文本与是否居中。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          centerTitle: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_module",
      description: "更新模块的标题。",
      parameters: {
        type: "object",
        properties: {
          moduleId: { type: "string" },
          title: { type: "string" },
        },
        required: ["moduleId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_module",
      description: "新增一个模块，可选携带初始行。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          afterModuleId: { type: "string", description: "插入到该模块之后；省略则追加到末尾" },
          rows: {
            type: "array",
            items: rowSchema,
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_module",
      description: "删除一个模块。",
      parameters: {
        type: "object",
        properties: { moduleId: { type: "string" } },
        required: ["moduleId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reorder_modules",
      description: "按给定顺序重排模块（提供模块 id 的目标顺序，未列出的模块保持相对顺序追加到末尾）。",
      parameters: {
        type: "object",
        properties: {
          orderedModuleIds: { type: "array", items: { type: "string" } },
        },
        required: ["orderedModuleIds"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_row",
      description: "向模块新增一行（富文本行或标签行）。",
      parameters: {
        type: "object",
        properties: {
          moduleId: { type: "string" },
          type: { type: "string", enum: ["rich", "tags"] },
          columns: { type: "integer", enum: [1, 2, 3, 4], description: "富文本行的列数" },
          texts: { type: "array", items: { type: "string" }, description: "各列文本" },
          formats: columnFormatsSchema,
          tags: { type: "array", items: { type: "string" }, description: "标签行内容" },
          afterRowId: { type: "string", description: "插入到该行之后；省略则追加" },
        },
        required: ["moduleId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_rows",
      description:
        "向同一模块一次性新增多行。新增完整项目/教育/工作经历时优先使用本工具，把标题行、详情行、标签行作为一个原子 diff 一起插入，避免后续行插到上一个项目下面。",
      parameters: {
        type: "object",
        properties: {
          moduleId: { type: "string" },
          afterRowId: { type: "string", description: "整体插入到该行之后；省略则追加到模块末尾" },
          rows: {
            type: "array",
            minItems: 1,
            items: rowSchema,
            description: "按显示顺序排列的多行内容；每行可单独设置 columns/texts/formats/tags",
          },
        },
        required: ["moduleId", "rows"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_row",
      description: "删除模块中的某一行。",
      parameters: {
        type: "object",
        properties: {
          moduleId: { type: "string" },
          rowId: { type: "string" },
        },
        required: ["moduleId", "rowId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_row_tags",
      description: "设置某个标签行的标签集合。",
      parameters: {
        type: "object",
        properties: {
          rowId: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["rowId", "tags"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_personal_info",
      description: "整体替换个人信息项列表（以及可选的布局与展示设置）。",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                content: { type: "string" },
                type: { type: "string", enum: ["text", "link"] },
                linkTitle: { type: "string" },
              },
              required: ["label", "content"],
            },
          },
          showLabels: { type: "boolean" },
          layoutMode: { type: "string", enum: ["inline", "grid"] },
          itemsPerRow: { type: "integer", enum: [1, 2, 3, 4, 5, 6] },
        },
        required: ["items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_job_intention",
      description: "设置求职意向（是否启用及其条目）。",
      parameters: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "string" },
                type: { type: "string", enum: ["workYears", "position", "city", "salary", "custom"] },
              },
              required: ["label", "value"],
            },
          },
        },
        required: ["items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_layout",
      description: "调整全局布局/样式：个人信息布局模式、每行列数、是否显示标签、头像形状、标题居中。",
      parameters: {
        type: "object",
        properties: {
          layoutMode: { type: "string", enum: ["inline", "grid"] },
          itemsPerRow: { type: "integer", enum: [1, 2, 3, 4, 5, 6] },
          showLabels: { type: "boolean" },
          avatarShape: { type: "string", enum: ["circle", "square"] },
          centerTitle: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_theme_color",
      description: "设置简历主题强调色（影响模块标题与分隔线颜色）。",
      parameters: {
        type: "object",
        properties: {
          color: { type: "string", description: "十六进制颜色，如 #4f46e5" },
        },
        required: ["color"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_resume",
      description: "用一份完整草稿整体替换当前简历（用于按一句话或 JD 从零生成）。这是一次性大改，请谨慎使用。",
      parameters: {
        type: "object",
        properties: { draft: draftSchema },
        required: ["draft"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "present_score_report",
      description: "展示简历评分诊断卡片。请基于简历内容给出客观评估。",
      parameters: {
        type: "object",
        properties: {
          overall: { type: "integer", description: "总分 0-100" },
          dimensions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "维度名，如 内容完整性/量化成果/匹配度/排版" },
                score: { type: "integer", description: "0-100" },
                comment: { type: "string" },
              },
              required: ["name", "score"],
            },
          },
          strengths: { type: "array", items: { type: "string" } },
          suggestions: { type: "array", items: { type: "string" } },
        },
        required: ["overall", "dimensions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "present_jd_match",
      description: "展示简历与目标岗位 JD 的匹配分析卡片。每条建议可附带 prompt，用户点击后会让你执行该项修改。",
      parameters: {
        type: "object",
        properties: {
          matchScore: { type: "integer", description: "匹配度 0-100" },
          matchedKeywords: { type: "array", items: { type: "string" } },
          missingKeywords: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
          suggestions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                section: { type: "string", description: "涉及的模块/部分" },
                advice: { type: "string" },
                prompt: { type: "string", description: "用户一键应用时发给你的具体指令" },
                targetIds: {
                  type: "array",
                  items: { type: "string" },
                  description: "该建议涉及的简历元素 id（element/row/module），用户点击「定位」会滚动并高亮这些元素",
                },
              },
              required: ["section", "advice"],
            },
          },
        },
        required: ["matchScore", "matchedKeywords", "missingKeywords", "suggestions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_company_interview",
      description:
        "模拟面试前的公司与岗位深度研究工具。根据公司、岗位/JD 和简历大纲联网收集公司业务、招聘方向、岗位能力要求、可能面试重点与可追问方向。仅用于研究，不修改简历。",
      parameters: {
        type: "object",
        properties: {
          company: { type: "string", description: "目标公司，如 腾讯、字节跳动" },
          role: { type: "string", description: "目标岗位/方向，如 后端开发实习、AI 应用开发实习" },
          jd: { type: "string", description: "用户提供的岗位描述或面试设定，可选但建议传入" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_interview_questions",
      description:
        "内部规划工具：基于简历与目标岗位先设计并维护本场面试的核心问题清单。调用后不会把问题卡片展示给用户；仅用于让模型在后续逐题推进时参考。",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 3,
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                kind: { type: "string", description: "类别，如 行为面/技术面/项目深挖" },
                rationale: { type: "string", description: "内部理由：为什么这题适合该简历与目标岗位。不要展示给用户。" },
              },
              required: ["question"],
            },
          },
        },
        required: ["questions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "present_interview_question",
      description:
        "展示当前这一道模拟面试问题卡片。每次只展示 1 道题；不要附带作答提示、评分标准、参考答案或点评。",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
          kind: { type: "string", description: "类别，如 行为面/技术面/项目深挖" },
          currentIndex: { type: "integer", description: "当前是第几题，从 1 开始" },
          total: { type: "integer", description: "本场计划题目总数" },
          intro: { type: "string", description: "可选的一句简短过渡语，不要包含其他题目" },
        },
        required: ["question", "currentIndex", "total"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "present_interview_questions",
      description: "兼容旧会话的面试题卡片工具。新模拟面试请使用 plan_interview_questions + present_interview_question。",
      parameters: {
        type: "object",
        properties: {
          intro: { type: "string" },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                kind: { type: "string", description: "类别，如 行为面/技术面/项目深挖" },
              },
              required: ["question"],
            },
          },
        },
        required: ["questions"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "present_interview_report",
      description:
        "在模拟面试结束时，基于用户作答展示一份表现报告卡片（综合分、逐题评分与点评、优势与待提升）。仅在已经历若干轮问答后调用。",
      parameters: {
        type: "object",
        properties: {
          overall: { type: "integer", description: "综合得分 0-100" },
          summary: { type: "string", description: "一句话总评" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                score: { type: "integer", description: "该题得分 0-100" },
                comment: { type: "string", description: "针对该题作答的点评" },
              },
              required: ["question", "score"],
            },
          },
          strengths: { type: "array", items: { type: "string" } },
          improvements: { type: "array", items: { type: "string" } },
        },
        required: ["overall", "items"],
      },
    },
  },
]

/** 仅这些工具不会产生需要审阅的变更 */
export const READONLY_TOOLS = new Set([
  "get_resume",
  "research_company_interview",
  "present_score_report",
  "present_jd_match",
  "plan_interview_questions",
  "present_interview_question",
  "present_interview_questions",
  "present_interview_report",
])

function pickTools(names: string[]): ToolSchema[] {
  const allowed = new Set(names)
  return TOOL_SCHEMAS.filter((tool) => allowed.has(tool.function.name))
}

export const EDIT_TOOL_SCHEMAS = pickTools([
  "get_resume",
  "update_element_text",
  "update_title",
  "update_module",
  "add_module",
  "remove_module",
  "reorder_modules",
  "add_row",
  "add_rows",
  "remove_row",
  "set_row_tags",
  "set_personal_info",
  "set_job_intention",
  "set_layout",
  "set_theme_color",
  "replace_resume",
])

export const SCORE_TOOL_SCHEMAS = pickTools([
  "get_resume",
  "present_score_report",
])

export const JD_TOOL_SCHEMAS = pickTools([
  "get_resume",
  "present_jd_match",
  "update_element_text",
  "update_module",
  "add_row",
  "add_rows",
  "remove_row",
  "set_row_tags",
  "reorder_modules",
])

export const INTERVIEWER_TOOL_SCHEMAS = pickTools([
  "get_resume",
  "plan_interview_questions",
  "present_interview_question",
])

export const INTERVIEW_ANALYSIS_TOOL_SCHEMAS = pickTools([
  "get_resume",
  "present_interview_report",
])

export const INTERVIEW_INTAKE_TOOL_SCHEMAS = pickTools([
  "research_company_interview",
])
