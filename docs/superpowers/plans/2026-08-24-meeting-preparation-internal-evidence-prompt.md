# Meeting Preparation Internal Evidence Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过强化预测提示词，避免模型把需要公司案例、产品能力或技术资料的问题判为“无需内部资料”。

**Architecture:** 保持 `MeetingPreparationService.generate()`、`generationBundleSchema`、`checkEvidence()` 和页面状态映射不变。只在 `buildPredictionPrompt()` 中补充 `requiresInternalEvidence` 的业务语义、混合问题规则和正反例，并用现有服务测试锁定提示词契约。

**Tech Stack:** TypeScript、Electron main process、Node.js test runner。

## Global Constraints

- 只修改预测提示词和对应契约测试。
- 不增加后端纠错或关键词覆盖规则。
- 不修改 Schema、数据库、IPC、资料检索、证据状态或页面文案。
- 不记录模型原文、提示词、会议内容或资料内容。
- 提示词方案降低误判概率，但不承诺确定性结果。

---

### Task 1: 明确内部资料判定语义

**Files:**
- Modify: `electron/services/meeting-preparation/MeetingPreparationPrompts.ts`
- Test: `electron/services/__tests__/MeetingPreparationService.test.mjs`

**Interfaces:**
- Consumes: `buildPredictionPrompt(context, mode, history): string`。
- Produces: 函数签名和结构化输出类型保持不变；提示词明确 `requiresInternalEvidence` 的业务判定规则。

- [ ] **Step 1: 写入失败的提示词语义契约测试**

在 `generate returns no more than three questions and cites only retrieved chunks` 测试的 `predictionPrompt` 断言后追加：

```js
assert.match(predictionPrompt, /公司掌握或提供的事实/);
assert.match(predictionPrompt, /同时涉及公司事实与客户现场信息时，requiresInternalEvidence 必须为 true/);
assert.match(predictionPrompt, /本次会议需要交流的具体机器人行业案例有哪些？.*requiresInternalEvidence=true/);
assert.match(predictionPrompt, /我们的产品如何接入客户现有控制系统？.*requiresInternalEvidence=true/);
assert.match(predictionPrompt, /客户当前使用什么控制系统？.*requiresInternalEvidence=false/);
```

- [ ] **Step 2: 运行定向测试并确认红灯**

Run:

```bash
npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/MeetingPreparationService.test.mjs
```

Expected: FAIL，首个新增断言找不到“公司掌握或提供的事实”，证明测试能够复现缺失的语义契约。

- [ ] **Step 3: 最小化补充预测提示词规则**

在 `buildPredictionPrompt()` 的字段类型说明之后、空数组规则之前加入：

```ts
'requiresInternalEvidence 判定规则：回答需要引用公司掌握或提供的事实时必须为 true；包括具体客户或行业案例、案例成效与指标、产品功能与技术能力、接口与集成兼容性、解决方案、价格、认证与合规、安全能力、部署与交付承诺。',
'只有问题完全依赖会议现场向客户了解的信息时才允许为 false，例如客户目标、客户现有系统、时间计划和决策流程。',
'同一问题同时涉及公司事实与客户现场信息时，requiresInternalEvidence 必须为 true。输出前逐题自检：只要回答中可能需要作出公司事实声明，就不得返回 false。',
'判定示例：“本次会议需要交流的具体机器人行业案例有哪些？” requiresInternalEvidence=true；“我们的产品如何接入客户现有控制系统？” requiresInternalEvidence=true；“客户当前使用什么控制系统？” requiresInternalEvidence=false。',
```

- [ ] **Step 4: 运行定向测试并确认绿灯**

Run:

```bash
npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/MeetingPreparationService.test.mjs
```

Expected: `MeetingPreparationService.test.mjs` 全部 PASS。

- [ ] **Step 5: 运行类型检查和完整测试集**

Run:

```bash
npm run typecheck:electron
npm test
git diff --check
```

Expected: 三个命令退出码均为 0，完整测试为 0 failures。

- [ ] **Step 6: 使用真实模型复验截图场景**

在本地 Electron 的会议准备入口输入：

```text
明天下午和机器人行业的新客户做产品技术交流，需要讨论具体机器人行业案例和产品集成。
```

依次完成信息拆解、模式确认和生成准备结果。

Expected: 与机器人行业案例有关的问题进入内部资料检查，不再显示“无需内部资料”。如果模型仍返回 `false`，记录为 B 方案的确定性限制，不继续增加提示词，转而评估后端一致性校验。

- [ ] **Step 7: 提交修复**

```bash
git add electron/services/meeting-preparation/MeetingPreparationPrompts.ts \
  electron/services/__tests__/MeetingPreparationService.test.mjs
git commit -m "fix: clarify meeting evidence requirements"
```
