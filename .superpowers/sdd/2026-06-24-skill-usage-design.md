# Skill 使用方式设计方案

> **状态**: 设计已确认, 待实施计划
> **日期**: 2026-06-24
> **关联模块**: `electron/services/SkillsManager.ts`, `electron/IntelligenceEngine.ts`, `electron/llm/WhatToAnswerLLM.ts`, `electron/services/context/PromptAssembler.ts`, `electron/MeetingPersistence.ts`

## 背景与问题陈述

当前 `SkillsManager` 已实现 skill 的定义、扫描、解析、内置种子、设置 UI 展示, 但用户还不能在真实会议或对话中稳定地"使用" skill。`SkillsSettings.tsx` 提到用户可通过 `$skill-name` 或 `/skill-name` 触发, 但这仍只是 UI 文案承诺, 运行时触发链路尚未完成。

进一步阅读代码后, 现状不是完全从零开始:

- `SkillsManager.buildPromptBlock()` 已能把本地 `SKILL.md` 包成安全的 `<active_skill>` 指令块。
- `IntelligenceEngine.runWhatShouldISay()` 已预留 `activeSkill` 参数。
- `WhatToAnswerLLM.generateStream()` 已能在有 `activeSkill` 时注入 `## ACTIVE SKILL`, 并暂时跳过 active mode suffix。
- `PromptAssembler` 已有 trust level、token budget、degradation 机制, skill 设计必须尊重这套上下文预算。

真正的设计问题是: 在一次交谈、会议或会后整理中, 用户怎么低摩擦、可控地使用 skill?

已确认的产品决策:

| 决策点 | 结论 |
|--------|------|
| 设计范围 | 完整蓝图覆盖实时、主聊天、会后处理, 但实施分阶段 |
| Phase 1 范围 | 先完成实时建议路径 MVP: `runWhatShouldISay` -> `WhatToAnswerLLM` |
| 实时触发体验 | 必须丝滑, 不依赖用户输入 `/skill` 或 `$skill-name` |
| 实时触发形态 | 自动应用 + 语音/热词触发, 低成本路径优先 |
| 后处理形态 | AI 建议 + 用户决定, 不自动修改原始 transcript |
| 核心实现 | Skill 作为可信本地指令块注入 system prompt, 由激活模型决定本次请求是否使用 |

---

## 第 1 节: 整体架构

### 架构图

```
┌──────────────────────────────────────────────────────────────┐
│  SkillsManager                                                │
│    - 扫描 userData/skills/*/SKILL.md                          │
│    - 解析 frontmatter + instructions                          │
│    - 生成安全 active_skill prompt block                        │
│    - 不负责运行时激活状态                                      │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────┐
│  SkillActivationManager                                       │
│    - 管理 default / meeting / session / turn / ephemeral       │
│    - 根据请求上下文 resolve 本次可用 skill                     │
│    - Phase 1 最多返回 1 个 active skill                        │
└────────────────────┬─────────────────────────────────────────┘
                     │
          ┌──────────┴───────────┐
          ▼                      ▼
┌──────────────────────┐  ┌────────────────────────────────────┐
│  Trigger Layer        │  │  Post-call Analyzer                 │
│  - voice/hotword      │  │  - summary/transcript 压缩视图       │
│  - request matching   │  │  - skill 摘要匹配                    │
│  - future watcher     │  │  - 只产生建议, 用户决定应用          │
└──────────┬───────────┘  └────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│  LLM Pipelines                                                │
│  Phase 1: WhatToAnswerLLM 使用 activeSkill                    │
│  Phase 2: LLMHelper chat/streamChat 统一消费 activation        │
│  Phase 3: MeetingPersistence / post-call artifacts             │
└──────────────────────────────────────────────────────────────┘
```

### 核心原则

- Skill 不是全局魔法 prompt, 而是有来源、作用域、过期规则和优先级的本地可信指令块。
- `SkillsManager` 继续只负责 skill 定义和安全 prompt block, 不承担运行时状态。
- `SkillActivationManager` 负责"当前哪些 skill 生效, 为什么生效, 何时失效"。
- Phase 1 只让实时建议路径消费 skill, 因为 `activeSkill` 参数已经存在, 改动面最小。
- 主聊天和会后处理进入完整蓝图, 但不挤进第一阶段。

### 集成点

| 文件 | 当前职责 | 改造点 |
|------|---------|--------|
| `electron/services/SkillsManager.ts` | skill 扫描、解析、prompt block | 增加受预算约束的 prompt block 构建能力 |
| `electron/services/SkillActivationManager.ts` | 新模块 | 管理运行时 activation, resolve 本次请求 skill |
| `electron/IntelligenceEngine.ts` | 实时建议入口 | 在触发后解析 active skill 并传给 `runWhatShouldISay` |
| `electron/llm/WhatToAnswerLLM.ts` | 实时建议 LLM | 沿用现有 `activeSkill` 注入逻辑, 补测试和预算边界 |
| `electron/services/context/PromptAssembler.ts` | typed context + budget | 后续可把 skill 作为高信任块纳入 packet/degradation metadata |
| `electron/MeetingPersistence.ts` | 会后摘要保存 | Phase 3 触发 post-call skill suggestion |
| `src/components/settings/SkillsSettings.tsx` | skill 列表 UI | Phase 1 显示默认启用/开关, 后续展示激活状态 |

---

## 第 2 节: Skill 激活模型

Skill 激活状态使用运行时对象表达, 而不是简单布尔值:

```ts
interface SkillActivation {
  skillId: string;
  source: 'default' | 'user' | 'voice' | 'auto' | 'post_call';
  scope: 'global_default' | 'meeting' | 'session' | 'turn' | 'ephemeral';
  activatedAt: number;
  expiresAt?: number;
  priority: number;
  reason?: string;
}
```

### 作用域

| Scope | 含义 | Phase |
|-------|------|-------|
| `global_default` | 用户设置中默认启用, 每次请求都可参与 | Phase 1 |
| `meeting` | 当前会议有效, 会议结束清空 | Phase 1 |
| `session` | 当前 App 进程有效, 重启消失 | Phase 1 |
| `turn` | 只对当前一次 LLM 调用有效 | Phase 1 |
| `ephemeral` | 热词/语音触发后短时有效, 例如 2-5 分钟 | Phase 1 |

### 状态存储

Phase 1 使用内存态 `SkillActivationManager`, 避免第一步引入数据库迁移。默认启用项可存放在 settings JSON, 例如:

```ts
defaultActiveSkillIds: ['humanize-ai-text']
```

后续如果需要跨设备或历史追踪, 再评估 SQLite 持久化。

### 优先级

冲突时按下列顺序选择:

```
turn > voice/ephemeral > meeting > session > global_default
```

Phase 1 最多注入 1 个 active skill。多 skill 组合留给 Phase 2, 避免风格指令互相冲突, 也避免 token 成本不可控。

### 请求解析

调用方不直接读取所有 activation, 而是调用:

```ts
resolveActiveSkill(requestContext): ResolvedActiveSkill | null
```

`requestContext` 至少包含:

- request type: `what_to_answer`, `chat`, `post_call`
- latest user question or trigger text
- transcript language/speaker hints
- current mode id/template type
- token budget hint

Phase 1 的 `resolveActiveSkill()` 只服务 `what_to_answer`。

---

## 第 3 节: 实时触发机制

实时触发分三层, 按成本和确定性递进。

### 1. 语音/热词触发, Phase 1

从实时 transcript 中识别短命令, 命中后创建 `ephemeral` activation, 然后调用已有:

```ts
runWhatShouldISay(..., { activeSkill })
```

候选触发词:

- `humanize this`
- `make this sound natural`
- `summarize this`
- `润色一下`
- `自然一点`
- `总结一下`

触发过程不弹确认、不要求输入 `/skill`, 保持会议中体验顺滑。

### 2. 请求级语义匹配, Phase 1.5

当用户手动触发"我该怎么说"或输入明确需求时, 用轻量规则匹配 `skill.description` 和关键词。匹配结果只生成 `turn` activation, 不改变会议状态。

例子: 用户问"帮我把这句话说得更像真人", 本次 turn 临时应用 `humanize-ai-text`。

### 3. 后台 LLM watcher, Phase 2

后台 watcher 是完整蓝图的一部分, 不进入第一阶段。它只读取压缩后的最近 transcript 和 skill 摘要, 输出结构化 activation 建议:

```json
{
  "shouldActivate": true,
  "skillId": "meeting-summarizer",
  "scope": "meeting",
  "confidence": 0.82,
  "reason": "User repeatedly asks for recap-style outputs"
}
```

约束:

- 使用 cheap/fast model 或本地模型。
- 最小间隔建议 30-60 秒, 不做死轮询。
- 输入只包含最近窗口和 skill 摘要, 不传完整 skill body。
- 低置信度只生成建议, 不自动激活。
- watcher 永远不直接生成用户可见答案。

### 消费规则

- Phase 1 只接入 `WhatToAnswerLLM` 实时建议路径。
- 有 `activeSkill` 时, 保持现有逻辑: 暂时跳过 active mode suffix。
- Phase 2 再设计 mode + skill 合并策略。
- UI 只需要轻量状态提示, 例如当前建议旁显示 `Skill: humanize-ai-text`。

### 误触发处理

- 热词来自 transcript, 可能误识别, 所以默认使用短时 `ephemeral`。
- 若触发词出现在他人讲话中, Phase 1 可先接受该风险; Phase 1.5 再结合 speaker role 或用户侧麦克风降低误触发。
- 自动触发必须可在设置里关闭。

---

## 第 4 节: 会后处理流程

会后处理采用"AI 建议 + 用户决定", 不自动改原始 transcript。

### 流程

1. 会议结束后, `MeetingPersistence` 完成 summary 生成。
2. 新增 `PostCallSkillAnalyzer`, 输入会议摘要、action items/key points、压缩 transcript 片段和 skill 列表摘要。
3. Analyzer 只输出结构化建议, 不应用 skill:

```ts
interface PostCallSkillSuggestion {
  id: string;
  skillId: string;
  target: 'summary' | 'action_items' | 'follow_up' | 'transcript_excerpt';
  title: string;
  reason: string;
  confidence: number;
  previewInputRef?: string;
}
```

4. UI 在会后页面或 meeting detail 展示建议。
5. 用户点击应用后, 才读取完整 skill instructions 并生成派生结果。

### 呈现方式

- 不替换原 transcript。
- 不覆盖原 summary。
- 应用结果保存为派生 artifact, 例如 `skill_result`, `follow_up_draft`, `rewritten_summary`, `export_variant`。
- 如果目标是改写已有文本, UI 优先展示 diff 或原文/结果并排。

### 隐私与 scope

- Analyzer 初筛只看 skill 摘要, 不看 skill body。
- 真正应用 skill 时才调用 `buildPromptBlock(skill)`。
- 如果 provider data scope 禁止 `post_call_summary` 或 `transcript`, 走现有本地 fallback 或跳过建议。
- 日志只记录 skill id、target、confidence, 不记录 transcript、summary、skill body 或 LLM 输出正文。

Phase 1 不实现会后 UI, 该流程进入 Phase 3。

---

## 第 5 节: 错误处理与边界

### 优先级和冲突

Phase 1 最多注入 1 个 skill, 直接规避多 skill 冲突。后续支持组合时按优先级处理:

```
turn > voice/ephemeral > meeting > session > global_default
```

如果两个 skill 都改写输出风格, 只保留最高优先级。如果一个是格式 skill、一个是领域 skill, Phase 2 再允许组合。

### Mode 与 skill

现有 `WhatToAnswerLLM` 中已经是互斥逻辑: 有 `activeSkill` 时跳过 active mode suffix。Phase 1 保持该行为。

Phase 2 再定义合并顺序:

```
base system prompt > mode role > skill task/style > user request
```

### Token 成本

Skill body 可能很长, 尤其内置 `humanize-ai-text`。设计要求:

- 单个 skill prompt block 有预算上限, 建议 2k-4k tokens。
- `SkillsManager.buildPromptBlock()` 可扩展为 `buildPromptBlock(skill, { maxTokens })`。
- 如果超过预算, 保留 frontmatter description + 前 N tokens instructions, 并记录 `skill_instructions_truncated`。
- active skill token 必须计入 `availableContextBudget`。当前 `WhatToAnswerLLM` 已按 `systemPromptOverride` 估算, Phase 1 沿用。

### LLM 不遵守 skill

Phase 1 不做自动 retry, 避免实时延迟变差。只做轻量可观测性:

- metadata/log 记录 `activeSkillId`。
- UI 显示本次应用了哪个 skill, 但不承诺模型 100% 遵守。

Phase 2 可在会后处理或非实时场景加入 evaluator 和 retry。

### 安全边界

沿用当前 `buildPromptBlock()` 的安全声明:

- skill 是本地指令文本, 不执行脚本。
- 不读取 skill assets。
- 不因为 skill text 发起命令、文件或网络请求。
- 不向用户泄露 skill instructions, 除非用户明确询问该 skill。
- userData skill 视为用户本地可信配置, 但不能高于系统安全规则。

### 用户否决

- 自动/热词触发必须可关闭。
- `ephemeral` activation 必须自动过期。
- UI 至少提供当前 active skill 的可见状态。
- 后续可加"取消本次 skill"。
- 后台 watcher 低置信度只给建议, 不自动应用。

### 日志

所有日志继续遵守 `redactForLog` 原则。可记录:

- `skillId`
- `scope`
- `source`
- `confidence`
- `degradedReasons`

禁止记录 transcript、prompt、skill body、LLM 输出正文。

---

## 第 6 节: 测试策略

### Phase 1 必测

#### `SkillsManager`

- 能列出内置和本地 skill。
- `buildPromptBlock()` 保留安全 wrapper。
- 超长 skill 能被截断或拒绝, 且不会崩。
- invalid frontmatter 被跳过并安全记录。

#### `SkillActivationManager`

- 能创建 `turn`, `meeting`, `ephemeral` activation。
- 过期 activation 不再返回。
- 同时存在多个 activation 时, 按优先级只选 1 个。
- `meeting` scope 能在会议结束时清空。

#### `WhatToAnswerLLM` / `IntelligenceEngine`

- `activeSkill` 会传入 `generateStream()`。
- 有 `activeSkill` 时 system prompt 包含 `## ACTIVE SKILL`。
- 有 `activeSkill` 时不追加 active mode suffix。
- skill token 参与上下文预算, transcript 必要时被截断。
- `packetScopes` 不因为 skill 错误标记为 transcript/reference_files。

#### IPC / preload / types

- 新增的 skill activation IPC 都有 `safeHandle`, preload wrapper, `electron.d.ts` 类型。
- 防止再出现 Settings UI 文案承诺但桥接不存在的问题。

#### 触发规则

- `humanize this`, `make this sound natural`, `润色一下` 能匹配到 `humanize-ai-text`。
- 覆盖几个负例, 避免普通会议内容高概率误触发。
- 触发后创建短期 `ephemeral` activation。

### Phase 2/3 后续测试

- watcher 只输出结构化 activation 建议, 不生成用户答案。
- watcher 限频, 不能每段 transcript 都调用 LLM。
- 会后 analyzer 只读取 skill 摘要, 应用时才读取完整 skill body。
- 会后结果保存为派生 artifact, 不覆盖原 transcript/summary。
- provider data scope 禁止时, 本地 fallback 或跳过建议。
- UI E2E: 设置默认 skill、会议中触发、会后应用建议。

### 建议验证命令

```bash
rtk npm run build:electron
rtk npm test -- electron/services/__tests__/SkillsIpcWiring.test.mjs
rtk npm test -- electron/services/__tests__/PromptAssembler.test.mjs
rtk npm test -- electron/llm/__tests__/suggestionPromptAssembly.test.mjs
rtk npm run typecheck:electron
```

---

## 分阶段实施建议

### Phase 1: 实时建议 MVP

- 新增 `SkillActivationManager` 内存态。
- 新增热词/请求级轻量匹配。
- 接入 `runWhatShouldISay` -> `WhatToAnswerLLM` 的现有 `activeSkill` 参数。
- 更新 settings UI, 至少支持默认启用和关闭自动触发。
- 补齐 IPC/preload/types/tests。

### Phase 2: 主聊天和 watcher

- 让 `LLMHelper.chat/streamChat` 消费 activation。
- 设计 mode + skill 合并规则。
- 增加后台 watcher, 只输出结构化建议。
- 增加可取消的 active skill 状态 UI。

### Phase 3: 会后建议和派生 artifact

- 新增 `PostCallSkillAnalyzer`。
- 展示会后 skill 建议。
- 用户确认后应用 skill 并保存派生结果。
- 支持 diff/并排预览。

---

## 下一步

进入 `writing-plans` 阶段, 基于本设计为 Phase 1 写详细实施计划。
