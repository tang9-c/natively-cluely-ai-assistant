# Meeting Preparation Prediction Prompt Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 强化会议准备预测提示词，使真实模型返回满足 `generationBundleSchema` 的问题、理由、知识要求和承诺结构。

**Architecture:** 保持 `MeetingPreparationService.generate -> buildPredictionPrompt -> generateContentStructured -> generationBundleSchema -> checkEvidence -> saveMeetingPreparationResult` 数据流不变。只补全预测提示词 JSON 契约与合法示例，并用服务契约测试锁定；结构错误仍由现有 Schema 拒绝。

**Tech Stack:** TypeScript、Node.js test runner、Zod、Electron main process。

## Global Constraints

- 不增加输出归一化或宽松类型转换。
- 不修改 Schema、数据库、IPC、资料检索、证据评估、供应商路由或页面流程。
- 结构校验失败时继续拒绝结果并保留用户现有内容。
- 日志不得包含模型原文、提示词、会议描述、历史会议内容或资料内容。

---

### Task 1: 强化预测 JSON 契约并完成真实全流程验收

**Files:**
- Modify: `electron/services/meeting-preparation/MeetingPreparationPrompts.ts`
- Modify: `electron/services/meeting-preparation/MeetingPreparationService.ts`
- Test: `electron/services/__tests__/MeetingPreparationService.test.mjs`

**Interfaces:**
- Consumes: `buildPredictionPrompt(context, mode, history): string`、`generationBundleSchema` 和 `MeetingPreparationService.generate()`。
- Produces: 保持全部函数签名不变；提示词明确 `historySummary: string[]`、`commitments: { text: string }[]` 和完整问题对象字段类型。

- [ ] **Step 1: 写入失败的预测提示词契约测试**

修改现有 `generate returns no more than three questions and cites only retrieved chunks` 测试，使 LLM 调用同时记录 `prompt` 和 `options`，并追加：

```js
const predictionPrompt = calls[0].prompt;
assert.match(predictionPrompt, /只返回一个 JSON 对象/);
assert.ok(predictionPrompt.includes('"historySummary":["上次会议讨论了集成范围"]'));
assert.ok(predictionPrompt.includes('"commitments":[{"text":"会后补充机器人案例"}]'));
assert.ok(predictionPrompt.includes('"rationale":["议程包含机器人行业案例"]'));
assert.ok(predictionPrompt.includes('"knowledgeRequirements":["机器人行业案例"]'));
assert.ok(predictionPrompt.includes('"requiresInternalEvidence":true'));
assert.match(predictionPrompt, /没有历史会议时，historySummary 和 commitments 必须为空数组/);
assert.deepEqual(calls[1].options.dataScopes, ['reference_files']);
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `npm run build:electron && node --test electron/services/__tests__/MeetingPreparationService.test.mjs`

Expected: FAIL，失败原因是当前预测提示词不包含完整 JSON 结构示例。

- [ ] **Step 3: 最小化强化预测提示词**

将 `buildPredictionPrompt` 的返回内容改为：

```ts
const example = {
    historySummary: ['上次会议讨论了集成范围'],
    commitments: [{ text: '会后补充机器人案例' }],
    questions: [{
        question: '是否有机器人行业案例？',
        keyMomentType: '案例与价值证明',
        rationale: ['议程包含机器人行业案例'],
        knowledgeRequirements: ['机器人行业案例'],
        requiresInternalEvidence: true,
    }],
};
return [
    '你只生成会前准备信息，不得编造客户、案例、ROI、价格、认证、部署承诺或资料来源。',
    '必须只返回一个 JSON 对象，不要解释，不要使用 Markdown 代码块。',
    '严格使用以下字段和类型：historySummary 是 string[]；commitments 是 { text: string }[]；questions 是 0–3 个问题对象的数组。',
    '每个问题对象必须包含 question: string、keyMomentType: string、rationale: string[]、knowledgeRequirements: string[]、requiresInternalEvidence: boolean。',
    '没有历史会议时，historySummary 和 commitments 必须为空数组。没有问题时 questions 必须为空数组，不得省略字段。',
    `合法格式示例（只展示结构和类型，不得照抄内容）：${JSON.stringify(example)}`,
    `已确认会议信息：${JSON.stringify(confirmedContext(context))}`,
    `模式与关键时刻：${JSON.stringify({ ...mode, keyMoments })}`,
    `用户选择的历史会议：${JSON.stringify(history)}`,
].join('\n');
```

保留 `MeetingPreparationService.generate` 中只输出 Zod 错误类型、字段路径和错误码的安全诊断；不得输出 `raw` 或上下文内容。

- [ ] **Step 4: 运行定向测试并确认绿灯**

Run: `npm run build:electron && node --test electron/services/__tests__/MeetingPreparationService.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 5: 运行类型检查和完整测试集**

Run: `npm run typecheck:electron && npm test && git diff --check`

Expected: 类型检查退出码为 0，完整测试 0 failures，差异检查退出码为 0。

- [ ] **Step 6: 使用真实供应商完成端到端复验**

在本地 Electron 中使用：

```text
明天下午和启明机器人研发总监做产品技术交流，重点讨论机器人行业案例和产品集成。
```

依次执行“拆解会议信息”→“确认并推荐模式”→“生成准备结果”。

Expected: 页面进入“查看准备结果”；主进程完成 `meeting-preparation-predict`，随后进入资料检索或按问题类型跳过检索，并成功保存准备结果；不再报告 `questions[].rationale` 或 `questions[].knowledgeRequirements` 类型错误。

- [ ] **Step 7: 提交修复**

```bash
git add electron/services/meeting-preparation/MeetingPreparationPrompts.ts \
  electron/services/meeting-preparation/MeetingPreparationService.ts \
  electron/services/__tests__/MeetingPreparationService.test.mjs
git commit -m "fix: harden meeting prediction prompt"
```
