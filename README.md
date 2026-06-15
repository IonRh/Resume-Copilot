# 智简Copilot

面向大学生与青年求职者的 **AI-Native 求职准备平台**。把简历编辑、岗位定制、自荐信、投递跟进、模拟面试与复盘报告串成一条连续工作流——不是「聊天改几句」，而是 **结构化简历 + 可确认 diff + 可导出成品**。

> 基于 [wzdnzd/resume](https://github.com/wzdnzd/resume)（MIT）二次开发，保留原项目的编辑与导出能力，并扩展 AI Agent、投递与面试模块。

---

## 核心能力

### 简历与编辑

- **模块化简历**：个人信息、求职意向、教育/实习/项目/技能等模块，支持拖拽排序、富文本、标签与多种布局
- **实时预览**：左编右看（或三分屏），预览与 PDF 导出共用同一套 HTML/CSS
- **多版本管理**：基础简历 + 岗位定制版，记录母版与衍生关系
- **图片导入**：从简历截图还原可编辑结构（Agent 辅助修正）
- **导出**：PDF（服务端 Chromium 优先，失败自动降级浏览器打印）、PNG / JPG / WEBP / SVG

### AI Agent 工作区

右侧 Agent 读取结构化简历大纲，修改以 **diff 卡片** 呈现，确认后才写入正文。

| 模式 | 说明 |
|------|------|
| 创建助手 | 对话式从零搭建简历 |
| 编辑 / 校对 / 排版 / 量化 STAR | 润色、纠错、美化、补数据与 STAR 结构 |
| 体检诊断 | 本地规则 + AI 五维评分与可执行修复建议 |
| JD 匹配 | 常驻匹配面板：分数、关键词、定位高亮、一键应用 |
| 岗位方向推荐 | Holland 测验 + 方向探索 |
| 自荐信 | 基于简历与 JD 生成信件并导出 |
| 模拟面试 | 研究公司 → 规划题目 → 逐题追问（支持语音回答） |
| 面试分析 | 旁路教练：每轮回答生成分析卡片，可点开详情并追问 |

### 求职流程

- **求职管家 Copilot**：根据简历、投递、面试状态推荐下一步行动
- **投递看板**：公司、岗位、阶段、优先级、跟进时间与 AI 阶段建议
- **模拟面试大厅**：练手模式 / 真实模拟（可触发挂面试）、多轮会话与交接
- **面试报告大厅**：结构化复盘、能力雷达、逐题点评

---

## 技术栈

| 层级 | 选型 |
|------|------|
| 框架 | Next.js 16 · React 19 · TypeScript |
| UI | Shadcn UI · Tailwind CSS · Iconify |
| 富文本 | Tiptap |
| 存储 | SQLite（简历、投递、面试等运行时数据） |
| PDF | puppeteer-core + @sparticuz/chromium |
| AI | OpenAI 兼容 Chat Completions + 工具调用 Agent |

---

## 快速开始

### 环境要求

- Node.js 18+
- pnpm（推荐）

### 安装与运行

```bash
pnpm install
pnpm dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)。

### 生产构建

```bash
pnpm build
pnpm start
```

---

## AI 与模型配置

AI 功能需要配置 **OpenAI 兼容** 的 API。两种方式任选（或混用）：

### 方式一：About 页面（推荐本地开发）

访问 `/about`，在页面中填写并保存：

- **主模型**：聊天 Agent、体检、JD 匹配等
- **语音识别**：模拟面试语音转写（硅基流动 `/audio/transcriptions` 格式）
- **公司调研**：intake 阶段联网调研公司与岗位（建议使用 Grok 等支持联网搜索的模型）

配置写入 `data/ai-config.json`（已在 `.gitignore`，**不会进 Git**）。

### 方式二：环境变量

在项目根目录创建 `.env.local`：

```env
# 主模型（必填，否则 AI 功能不可用）
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o

# 语音识别（可选，默认可回退到主模型 Key）
SPEECH_BASE_URL=https://api.siliconflow.cn/v1
SPEECH_API_KEY=
SPEECH_MODEL=FunAudioLLM/SenseVoiceSmall

# 公司调研（可选，默认可回退到主模型）
RESEARCH_API_KEY=
RESEARCH_BASE_URL=
RESEARCH_MODEL=grok-3
```

也可复制模板：`data/ai-config.example.json`（空对象，仅作占位说明）。

**优先级**：About 页保存值 → 环境变量 → 代码内通用默认值（见 `lib/ai-config-defaults.ts`）。

---

## 其他环境变量

| 变量 | 说明 |
|------|------|
| `SITE_PASSWORD` | 设置后全站需口令访问（Cookie 30 天有效） |
| `PUPPETEER_EXECUTABLE_PATH` / `CHROME_PATH` | 指定本机 Chrome，用于 PDF 渲染 |
| `NEXT_PUBLIC_FORCE_SERVER_PDF` | 强制服务端 PDF |
| `NEXT_PUBLIC_FORCE_PRINT` | 强制浏览器打印 |
| `APP_GITHUB_URL` | About 页展示的仓库地址 |

---

## 项目结构（精简）

```
app/
  page.tsx                 # 欢迎页
  resumes/                 # 我的简历
  edit/[id]/               # 编辑器（三分屏 + Agent）
  career/[mode]/[id]/      # 职业工作区（JD / 面试 / 岗位推荐等）
  applications/              # 投递看板
  cover-letters/           # 自荐信
  interviews/                # 模拟面试大厅与报告
  about/                     # 模型配置与项目信息
  api/                       # 简历、PDF、Agent、投递等 API

components/
  agent/                     # Agent 面板、卡片、Copilot、面试 UI
  workspace/                 # Career 三分屏工作区

lib/
  resume-core/               # 简历数据规范化、大纲、结构操作
  agent/                     # Prompt、工具、流式对话
  server/                    # SQLite、AI 配置、PDF、报告生成

data/                        # 运行时数据（gitignore，勿提交）
  ai-config.json             # About 页保存的模型配置
  resumes.sqlite             # 简历与业务数据
```

---

## 简历数据模型

```typescript
interface ResumeData {
  title: string
  personalInfoSection: PersonalInfoSection
  jobIntentionSection?: JobIntentionSection
  modules: ResumeModule[]
  avatar?: string
  parentResumeId?: string      // 岗位定制版关联母简历
  createdAt: string
  updatedAt: string
}
```

`lib/resume-core` 负责规范化、排序、富文本转换与 AI 可读大纲，Agent 工具直接操作该结构。

---

## PDF 导出

- **服务端**：`POST /api/pdf` 使用 headless Chromium 渲染 `/print`，返回 `application/pdf`
- **降级**：服务不可用时提示用户使用浏览器打印（关闭页眉页脚、勾选背景图形）
- **健康检查**：`GET /api/pdf/health`

部署 Serverless（如 Vercel）时需 **Node.js Runtime**，建议提高函数内存与超时。

---

## 访问口令（可选）

设置 `SITE_PASSWORD` 后，未认证用户会跳转 `/auth`。未设置则不启用认证。

---

## 开源与安全

- **不要提交** `data/ai-config.json`、`.env.local`、`data/resumes.sqlite` 等本地运行时文件
- 仓库内 **不含** 任何个人 API Key 或私有服务地址
- 若 Key 曾误提交 Git 历史，请轮换密钥并清理历史记录

---

## 许可证

MIT，详见 [LICENSE](./LICENSE)。

本项目基于 [wzdnzd/resume](https://github.com/wzdnzd/resume) 修改，保留原项目 MIT 版权与许可声明。
