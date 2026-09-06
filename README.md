# Feigenbaum CueUp

免费、开源、本地优先的实时会议 AI 副驾驶。

CueUp 是一个桌面应用，运行在 macOS 和 Windows 上。它可以在会议、面试、销售通话、团队周会、讲座和客户现场沟通中实时转写音频、理解屏幕、生成回答建议、记录会议内容，并在会后把转录变成可用的 Markdown、行动项、客户复盘、面试评估或周会纪要。

> 关键时刻，给你一句能说出口、能推进事情的回答。

<div align="center">
  <img src="assets/icon.png" width="150" alt="CueUp AI Assistant Logo">

  <br/>

  [![License](https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square)](LICENSE)
  [![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-blueviolet?style=flat-square)](https://github.com/tang9-c/natively-cluely-ai-assistant/releases)
  [![Downloads](https://img.shields.io/github/downloads/tang9-c/natively-cluely-ai-assistant/total?style=flat-square&color=success)](https://github.com/tang9-c/natively-cluely-ai-assistant/releases)
  [![Stars](https://img.shields.io/github/stars/tang9-c/natively-cluely-ai-assistant?style=flat-square&color=gold)](https://github.com/tang9-c/natively-cluely-ai-assistant)

  <p>
    <a href="https://cueup.feigenbaum.ai">
      <img src="https://img.shields.io/badge/访问官网-22C55E?style=for-the-badge&logo=vercel&logoColor=white" />
    </a>
    <a href="https://github.com/tang9-c/natively-cluely-ai-assistant/releases/latest">
      <img src="https://img.shields.io/badge/下载-macOS-007AFF?style=for-the-badge&logo=apple&logoColor=white" />
    </a>
    <a href="https://github.com/tang9-c/natively-cluely-ai-assistant/releases/latest">
      <img src="https://img.shields.io/badge/下载-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" />
    </a>
  </p>
</div>

## 快速开始

第一次使用请先阅读[快速入门指南](docs/QUICKSTART.md)：其中包含 macOS 与 Windows 权限、本地 SenseVoice 与云端语音服务、会议模式、会后搜索和导出的实际操作步骤。

完整功能文档、操作指南、设置参考与架构说明见[文档目录](docs/README.md)。

## CueUp 是什么

CueUp 不是一个简单的语音转写工具。它是一个本地优先的会议智能系统：

- 实时捕获麦克风和系统音频。
- 使用本地或云端 STT 转写会议内容。
- 在悬浮窗里给出实时回答、澄清问题、下一步建议和动作卡片。
- 根据当前模式调整行为，例如销售、FDE、招聘、团队会议、技术面试、讲座。
- 保存会议历史、摘要、转录、AI 用量和结构化记录。
- 支持本地资料、PPTX、Markdown、PDF、业务系统知识源和语义搜索。
- 支持本地模型路径，尽量把敏感数据留在本机。

## 会议全周期对比

> CueUp 覆盖会前准备、会中辅助与会后沉淀：带着资料进入会议，在关键时刻获得有依据的回应建议，让会议结论继续服务下一次沟通。

| 会议阶段 | **CueUp** | 飞书妙记 / 钉钉 AI 听记 | 讯飞听见 / 通义听悟 | 安克 / 讯飞 / PLAUD 硬件 |
| --- | --- | --- | --- | --- |
| **会前准备** | 选择会议模式，准备背景、个人档案与资料，配置本次会议知识源 | 围绕日程、参会人和协作文档组织会议 | 主要准备录音、实时记录或音视频处理任务 | 准备设备，满足线下、移动场景的采音需求 |
| **会中记录** | 本地或云端转写，采集电脑系统音频与麦克风声音 | 在会议或录音场景中转写、显示字幕 | 实时转写、翻译，记录讨论内容 | **便携采音**；转写方式取决于型号与配套服务 |
| **会中辅助** | **识别对话节点，结合模式与资料提供回答草稿、追问、风险提示和动态卡片** | 实时提炼会议进展、要点与待办；飞书 AI 视图支持图表呈现 | 以转写、翻译及内容整理辅助理解，具体能力因产品而异 | 依赖配套软件；如安克连接飞书可查看实时转写与总结 |
| **会后沉淀** | 详细摘要、决策与行动项，通过技能整理跟进材料，导出可编辑文档 | **纪要衔接文档、任务与团队协作**，支持会议内容问答 | **转写稿与长音视频整理**：摘要、章节、回看和导出 | 录音同步至设备或 App，生成转写稿与总结 |
| **长期知识复用** | **检索本地会议与资料，通过 MCP 接入企业知识源，辅助后续会议** | 在平台内沉淀组织知识，通过搜索、问答与协作复用 | 查阅历史录音与文件，继续检索或分析 | 管理个人录音档案；部分支持 AI 问答或接入办公生态 |

*按产品及配套服务比较，同组产品并非能力完全一致；具体功能受版本、套餐和设备型号影响。加粗表示侧重点，不代表独占能力。公开资料核对日期：2026-09-06。*

```text
会前准备                 会中辅助                   会后沉淀
模式 · 背景 · 知识源  →  回答草稿 · 追问 · 动态卡片  →  摘要 · 行动项 · 知识复用
```

产品能力参考：[飞书智能会议纪要](https://www.feishu.cn/product/ai-meeting-summary)、[飞书妙记问答](https://www.feishu.cn/content/article/7594772423082396858)、[钉钉 AI 听记](https://page.dingtalk.com/wow/dingtalk/default/dingtalk/6fgfgRdrjAFXuPAf5ymIF)、[讯飞产品介绍](https://www.iflytek.com/cn/)、[通义听悟](https://www.tingwu.cn/)、[安克 AI 录音豆（飞书版）](https://www.feishu.cn/content/article/7597268954498763996)、[讯飞 AI 录音笔](https://www.iflyjz.com/Gong/140.html)、[PLAUD](https://www.plaud.cn/)。

## 适合谁

- 面试候选人，想在系统设计、算法、行为面试里获得实时思路。
- 销售，想在客户说“太贵”“要案例”“发报价”时拿到可说出口的回应。
- FDE / 解决方案工程师，想把制造业 PLM、QMS、企业 AI Agent 部署讨论收束成交付计划。
- 团队负责人，想把周会、经营会里的 owner、date、artifact 和阻塞点记录清楚。
- 招聘面试官，想把候选人的回答、亮点、疑问和复试追问点整理成客观评估单。
- 需要本地隐私边界的用户，想在不把所有数据交给单一云服务的前提下使用 AI。

## 核心能力

### 实时会议辅助

- 滚动转写当前会议。
- 快捷生成“该说什么”“澄清问题”“头脑风暴”“回答”“跟进问题”。
- 支持当前输入、最近上下文、屏幕截图、上传资料和模式上下文。
- 动态动作卡片会在关键瞬间提醒用户，例如价格异议、推进信号、行动项、风险、决策。

### 模式系统

CueUp 内置多种会议模式：

| 模式 | 用途 |
| --- | --- |
| General | 通用会议和普通问答 |
| Sales | 价格异议、报价请求、案例请求、技术需求、购买信号 |
| FDE | 制造业 PLM / QMS / 企业 AI Agent 部署现场推进 |
| Recruiting | 招聘面试、候选人评估、复试问题 |
| Team Meet | 周会、经营会、行动项、阻塞、决策 |
| Technical Interview | 算法、系统设计、代码解释、边界情况 |
| Lecture | 课堂、培训、概念解释、公式和参考资料 |
| Looking for work | 求职面试和个人经历表达 |

每个模式都有独立的提示词、自定义上下文、意图词、参考文件和会议记录结构。

### 预制技能

CueUp 随安装包分发 7 个预制 `SKILL.md` 技能：

| 技能 | 作用 |
| --- | --- |
| customer-recap | 从客户谈判转写中提炼核心需求、顾虑、异议回应和下次跟进重点 |
| meeting-accountability | 从周例会 / 月度经营会中整理逐人完成事项、卡点、计划、支援请求和拍板决定 |
| interview-evaluation | 从面试转写中整理候选人回答、经验技能、亮点疑问、复试追问点和匹配度 |
| humanize-text | 把 AI 生成文本改得更自然、更具体、更像真人写作 |
| meeting-cleanup | 保守清理和整理会议转录，并生成完整会议记录、摘要与明确待办 |
| sales-qc-review | 基于转写质检 ToB 销售的需求挖掘、异议处理、价值呈现和推进质量 |
| fde-qc-review | 基于转写质检实施顾问的需求澄清、系统边界、交付风险和下一步推进 |

在会议详情页切到“转录”，点击“用技能处理”，选择技能后即可生成 Markdown 文件。生成后可以直接打开文件或打开文件夹。

### 会议智能与历史记录

- 查看完整会议转录。
- 自动生成会议摘要和结构化概览。
- 统计 AI token 用量。
- 在单场会议范围内进行语义搜索。
- 导出以详细会议摘要为主、可继续编辑的 DOCX；需要时可附带完整转录。
- 使用技能把完整转录变成面试评估、客户复盘、周会纪要等具体产物。

### 本地资料和 RAG

- 上传 PDF、DOCX、TXT、Markdown、PPTX。
- 对上传资料建立本地索引。
- 在回答中引用上传资料和模式参考文件。
- 支持本地 384d embedding 降级路径。
- 数据范围策略可控制云端提供商是否能访问转录、截图、参考资料、画像历史、云端 embedding 和会后摘要。

### 屏幕理解

- 支持截图和区域截图。
- 支持 vision-first、vision-only 和 local-only private vision 路径。
- 可在技术面试模式中使用高分辨率截图配置，让代码文本更清晰。
- 数据范围关闭截图时，云端视觉提供商不会收到截图。

### 业务系统知识源

CueUp 支持只读业务系统知识源。当前重点是 Windchill 知识源：

- 配置 MCP 服务地址和 API Key。
- 测试连接时显示清晰的成功或失败状态。
- 查询 PLM / Windchill 对象时走只读查询。
- 不做 create、update、approve 等写操作。
- 写入、审批和业务承诺必须由人确认。

### 语音与本地模型

- 默认推荐本地 SenseVoice；也支持 QCLOUD API、Doubao AUC 等云端语音服务。
- 支持本地模型管理。
- 云端语音服务支持说话人分离；本地 SenseVoice 不提供通用多人说话人分离。
- 麦克风转写和系统音频采集分开诊断。

## 隐私与安全

CueUp 的默认设计是本地优先：

- 会议历史保存在本地 SQLite。
- 凭据通过 Electron safeStorage 加密。
- API key 不保存在 renderer state 或 localStorage。
- 日志必须脱敏，不记录原始转录、prompt、截图、证据文本或凭据。
- 云提供商数据范围可以逐项关闭。
- 关闭某类数据范围后，CueUp 会尽量使用本地模型或降级路径。

## 安装

### 普通用户

前往 [Releases](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/latest) 下载对应平台安装包。

系统要求：

- macOS 12 及以上，支持 Apple Silicon 和 Intel。
- Windows 10 / 11。
- 推荐 8GB 以上内存。
- 使用本地模型时建议 16GB 以上内存。

### 开发者

```bash
git clone https://github.com/tang9-c/natively-cluely-ai-assistant.git
cd natively-cluely-ai-assistant
npm install
npm run ensure:native
npm start
```

常用命令：

```bash
npm run build
npm run build:electron
npm run typecheck:electron
npm test
npm run test:quality:smoke
npm run app:build
```

## 配置

你可以在设置里配置：

- 默认聊天模型为 Doubao Seed 2.0 Lite；也可配置 QCLOUD API 或自定义端点。
- 语音提供商，例如 Local SenseVoice、QCLOUD API、Doubao AUC。
- 屏幕理解模式。
- 云提供商数据范围。
- 上传资料和知识源。
- 技能自动触发和转录监听。
- 本地模型路径。

可选 `.env`：

```bash
DOUBAO_API_KEY=...
NATIVE_API_KEY=...
```

生产环境主要使用应用内安全存储的凭据。

## 架构概览

```text
Electron Main
  main.ts, ipcHandlers.ts, WindowHelper.ts
  LLMHelper, IntelligenceEngine, ProcessingHelper
  DatabaseManager, SettingsManager, CredentialsManager
  ModesManager, SkillsManager, LocalModelManager
  DynamicActionEngine, RAGManager, PostCallWorkflow

Renderer
  React 18 + Vite + TypeScript
  Launcher, Overlay, Settings, MeetingDetails
  ModesSettings, SkillsSettings, AI provider settings

Native Module
  Rust + napi-rs
  audio capture, VAD, keyboard tap, stealth window helpers

Storage
  SQLite + sqlite-vec
  local transcript, summaries, vectors, settings
```

## 技术栈

- React 18
- Vite
- TypeScript
- TailwindCSS
- Electron
- Rust / napi-rs
- SQLite / better-sqlite3
- sqlite-vec
- Framer Motion
- lucide-react

## 负责任使用

CueUp 适用于学习、工作辅助、会议复盘、可访问性和个人效率提升。

用户需要遵守：

- 所在公司或学校政策。
- 会议录音和屏幕共享规则。
- 当地法律法规。
- 面试、考试和客户沟通中的诚信要求。

这个项目不鼓励欺骗、违规录音或绕过第三方平台规则。

## 已知限制

- Linux 支持仍有限。
- 初始配置需要自带 API key 或安装本地模型。
- 本地模型质量和速度取决于机器性能。
- 一些业务系统能力目前只支持只读查询。
- 云端数据范围关闭后，部分功能会降级。

## 贡献

欢迎提交 PR。建议先阅读：

- [AGENTS.md](AGENTS.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [PRIVACY.md](PRIVACY.md)

高质量 PR 应该包含：

- 清晰的问题描述。
- 小而聚焦的改动范围。
- 对应测试。
- 用户可见变化的文档更新。

## 许可证与来源说明

本项目基于 Natively 此前以 GNU Affero General Public License v3.0（AGPL-3.0）发布的版本修改而来。原项目曾托管于
`https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant`。上游后续版本可能使用不同授权条款，本 fork 不从上游新授权版本同步代码或资源，除非完成单独的许可证审查。

本仓库继续遵循 [AGPL-3.0](LICENSE) 发布，并在许可证文件中保留来源说明、原始归属说明和完整许可证文本。fork 基准、许可证哈希和上游同步冻结记录见 [FORK_PROVENANCE.md](FORK_PROVENANCE.md)。

`Natively` 名称仅用于说明上游来源和许可证背景，不作为本 fork 的产品品牌、商业名称或背书声明。CueUp 是独立 fork，不隶属、不受 Natively 或 Natively AI Private Limited 授权、赞助或背书。

如果你分发本项目的修改版本，或通过网络向用户提供基于本项目的服务，请按照 AGPL-3.0 保留版权、许可证和修改说明，并向用户提供对应源码。
