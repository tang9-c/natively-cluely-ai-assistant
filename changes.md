# CueUp 发布记录

本文档用于面向中文用户发布 CueUp 的主要变化。工程实现细节仍保留文件路径，方便开发者追踪代码。

## 2026-07-08

### 预制技能随安装包分发

- [electron/services/SkillsManager.ts, resources/skills/*, package.json]: 新增 4 个随安装包分发的预制技能：
  - `customer-recap`：客户谈判复盘，提炼核心需求、顾虑、异议回应和下次跟进重点。
  - `meeting-accountability`：周例会 / 月度经营会责任对齐，整理逐人完成事项、卡点、本周计划、支援请求和拍板决定。
  - `interview-evaluation`：招聘面试评估，整理候选人回答、经验技能、亮点疑问、复试追问点和匹配度评分。
  - `humanize-text`：文本去 AI 味，让 AI 生成文本更自然、更具体。
- [electron/services/SkillsManager.ts]: 移除旧的 `humanize-text` 硬编码内容，统一从 `resources/skills` 读取预制技能，避免同一个技能维护两份。
- [package.json]: 安装包会把 `resources/skills` 复制到应用资源目录，首次启动时播种到用户技能目录。
- [electron/services/__tests__/SkillsIpcWiring.test.mjs]: 增加测试，确保 4 个预制技能都存在、都能被识别为内置技能，并且不会退回硬编码路径。

### 技能设置中文化

- [src/components/settings/SkillsSettings.tsx]: 将技能设置界面改为中文，包括技能文件夹、自动触发、转录监听、激活状态、内置/本地标识和错误提示。
- [electron/services/__tests__/SkillsIpcWiring.test.mjs]: 更新 UI 文案断言，防止后续回退到英文或静默缺失 IPC 桥接。

### 转录页技能导出体验优化

- [src/components/MeetingDetails.tsx]: 会议详情的“转录”页可以把完整转录交给技能处理，并生成 Markdown 文件。
- [src/components/MeetingDetails.tsx]: 生成成功后，“打开文件”和“打开文件夹”改成带图标、边框、圆角和 hover 状态的按钮，不再是裸文本链接。
- [electron/services/__tests__/TranscriptSkillExport.contract.test.mjs]: 增加契约测试，保证导出成功后的操作按钮保持统一样式。

### 帮助指南更新

- [src/components/settings/HelpSettings.tsx]: 新增“技能”帮助章节，说明 4 个预制技能、从转录生成 Markdown 的操作路径，以及技能自动触发和转录监听的区别。
- [src/components/__tests__/HelpSettingsContent.test.mjs]: 增加帮助指南内容测试，确保技能说明、转录导出和打开文件/文件夹说明不会缺失。
- [README.md]: README 改为中文发布版，并补充预制技能、会议智能、业务系统知识源、数据范围和本地模型说明。

### 品牌文案统一

- [tests/fixtures/demo/02_knowledge_base/kb_natively_product_overview.md, electron/services/__tests__/KnowledgeMaterialService.test.mjs, electron/services/__tests__/UploadedMaterialContextContributionService.test.mjs]: 将示例知识库和相关测试中的用户可见品牌查询从 Natively 改为 CueUp，避免生成回答时带出旧品牌名。

## 2026-07-07 至 2026-07-08

### FDE 模式收敛到制造业 PLM / QMS / 企业 AI Agent 部署

- FDE 不再是泛泛的“客户现场工程师”助手，而是面向制造业研发、质量和企业 AI Agent 部署的前线交付副驾驶。
- 默认上下文聚焦物料、BOM、图纸、ECR / ECO / ECN、NCR、CAPA、8D、审计、检验、追溯、权限、审批、人机协同和上线治理。
- FDE 卡片和接受后的回答更强调：
  - 业务流程发现。
  - 系统对象澄清。
  - 集成与权限边界。
  - AI Agent 可行性和人工确认点。
  - 风险、合规、验证和回滚。
  - owner、date、artifact、测试数据和验收标准。
- 约束：不替客户承诺流程，不自动写入 PLM / QMS，不把未知业务规则说成事实。

### Sales 模式产品化

- 销售模式聚焦 5 个关键瞬间：
  - 价格异议。
  - 报价请求。
  - 案例 / 证明请求。
  - 技术 / 集成需求。
  - 购买 / 推进信号。
- 销售卡片强调可说出口的回应，不再只列价值点。
- 报价请求生成 email draft，但不编价格、客户名或合同条款。
- 案例请求优先使用 RAG、PPTX 和上传资料，不编客户案例。
- 推进信号必须锁定 next step、owner、date 和 artifact。

### 动态动作与云端仲裁诊断

- 动态动作 diagnostics 区分：
  - `cloud_used`：云端仲裁参与决策。
  - `local_only_by_privacy`：隐私设置禁止云端。
  - `local_fallback_cloud_unavailable`：云端不可用后使用本地兜底。
  - `local_only_not_needed`：本地规则足够。
- scope 禁止云端时显示为隐私策略生效，不当作错误。
- provider 不可用、超时、JSON 非法时记录内部 trace，并使用本地兜底。
- 普通会议界面不弹技术错误，诊断入口展示聚合状态。

### Windchill 知识源

- 前端把 PLM 知识源收敛为 Windchill 知识源，因为当前配置已经专门面向 Windchill MCP。
- 业务系统查询保持只读边界，不开放 create、update、approve 等写操作。
- Windchill 查询链路保留结构化抽取层和 LLM 摘要层，不再依赖基于规则的 fallback 格式化。
- 连接测试和保存交互参照 Tavily：明确 loading、成功/失败结果卡、保存成功反馈、凭据不回显。

### 本地模型、语音与情绪

- Local SenseVoice 和 QCLOUD API 的情绪 / 说话人信息继续归一化到统一 transcript payload。
- QCLOUD 情绪结果已透传到 renderer，并修复 UI 入口中只接受 `sensevoice` 的旧判断。
- 语音设置、屏幕理解、云提供商数据范围等界面文案继续中文化。

## 近期质量修复

### LocalEmbeddingProvider 本地模型路径

- [electron/rag/providers/LocalEmbeddingProvider.ts]: 修复 `npm start` 开发模式下本地 384d embedding 模型路径解析错误。之前打包后 `__dirname` 指向 `dist-electron/electron`，向上回溯层级错误，导致查找 `/Users/resources/models/...`。现在开发模式使用 `app.getAppPath()`，生产模式仍使用 `process.resourcesPath`。

### PPTX renderer diagnostics

- [electron/services/knowledge/pptx/*]: 保留 PPTX 渲染诊断信息，方便排查幻灯片解析和知识源索引问题。

### QCLOUD token budget

- [electron/LLMHelper.ts]: 为 QCLOUD 路由设置明确的 token budget，避免部分路径使用默认值导致回答长度或结构不稳定。

### Sales intent 测试对齐

- [electron/llm/__tests__/IntentClassifier.test.mjs, electron/services/__tests__/ModesManager.test.mjs]: 将旧的 sales intent schema 测试对齐到产品化后的命名，例如 `sales_pricing_objection`、`sales_quote_request`、`sales_buying_signal`。

## 更早的稳定性与基础设施变化

### 语音稳定性

- 修复多处 Deepgram、Google STT、ElevenLabs failover 和 silence watchdog 问题。
- 增加 STT health system 测试，覆盖静默失败、key rotation、provider fallback 和连接关闭边界。
- 修复 GoogleSTT / Deepgram 在部分语言、key rotation、连接中断和 replay buffer 场景下的错误。

### Trial 和许可证

- 增加 10 分钟免费试用。
- 修复试用 token、usage counter、Profile access、BYOK 清理和 trial expiry wipe 相关问题。
- 区分 Pro 桌面授权和 API plan webhook，避免价格相同导致错误发放 API key。

### 模式和 Profile Intelligence

- 增加 Modes Manager。
- Profile Intelligence 支持自定义上下文。
- 非 Pro 用户限制非 General 模式，避免绕过模式能力门槛。
- license deactivation 后清理 active mode，避免旧模式上下文继续注入。

### 隐身和窗口控制

- Windows undetectable overlay 改进为非激活显示路径。
- Stealth keyboard tap 增加 IPC 注册幂等、IME 刷新、可用性探测和输入焦点保护。
- 鼠标穿透、透明度、窗口激活策略继续收敛。

### 安全与隐私

- Gemini API key 从 URL query 改为 header，降低日志泄漏风险。
- language 参数加强校验，避免换行注入。
- Supabase、webhook、billing、admin API 等错误处理减少敏感信息泄漏。
- Provider data scope 继续作为云端调用的隐私边界。

## 验证命令

常用验证命令：

```bash
npm run build
npm run build:electron
npm run typecheck:electron
npm test
npm run test:quality:smoke
```

本轮文档与技能相关验证：

```bash
node --test src/components/__tests__/HelpSettingsContent.test.mjs
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/SkillsIpcWiring.test.mjs
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/TranscriptSkillExport.contract.test.mjs
for d in resources/skills/*; do python3 /Users/tang-codeing/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$d"; done
```
