# Meeting Preparation Parse Prompt Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 强化会议准备信息拆解提示词，使模型明确返回满足现有 Zod Schema 的 JSON 字段类型。

**Architecture:** 保持现有 `MeetingPreparationService -> buildMeetingContextPrompt -> generateContentStructured -> meetingContextSchema` 数据流不变。只在提示词构造器中补全严格 JSON 契约和合法示例，并通过服务契约测试锁定提示词；不增加输出归一化、数据库或 IPC 变更。

**Tech Stack:** TypeScript、Node.js test runner、Zod、Electron main process。

## Global Constraints

- 不增加模型输出归一化或宽松类型转换。
- 不修改数据库、IPC、页面流程和供应商路由。
- 模型输出不满足结构时继续拒绝结果并保留用户输入。
- 日志不得包含用户输入、模型原文或会议内容。

---

### Task 1: 强化信息拆解提示词并锁定契约

**Files:**
- Modify: `electron/services/meeting-preparation/MeetingPreparationPrompts.ts`
- Modify: `electron/services/meeting-preparation/MeetingPreparationService.ts`
- Test: `electron/services/__tests__/MeetingPreparationService.test.mjs`

**Interfaces:**
- Consumes: `buildMeetingContextPrompt(rawInput: string): string` 和现有 `meetingContextSchema`。
- Produces: 保持相同函数签名；提示词明确 `topic/customer/goal` 对象、`participants` 对象数组、`agenda` 字符串数组和 `background` 字符串。

- [ ] **Step 1: 写入失败的提示词契约测试**

在现有 `parseInput declares transcript scope and returns validated context` 测试中追加：

```js
const prompt = calls[0].prompt;
assert.match(prompt, /只返回一个 JSON 对象/);
assert.ok(prompt.includes('"topic":{"value":"产品技术交流","state":"confirmed"}'));
assert.ok(prompt.includes('"participants":[{"name":"张三","role":"研发总监"}]'));
assert.ok(prompt.includes('"agenda":["机器人行业案例","产品集成"]'));
assert.ok(prompt.includes('"background":"首次交流"'));
assert.match(prompt, /confirmed 或 needs_confirmation/);
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `npm run build:electron && node --test electron/services/__tests__/MeetingPreparationService.test.mjs`

Expected: FAIL，失败原因是当前提示词不包含完整 JSON 结构示例。

- [ ] **Step 3: 最小化强化提示词**

将 `buildMeetingContextPrompt` 改为：

```ts
export function buildMeetingContextPrompt(rawInput: string): string {
    const example = {
        topic: { value: '产品技术交流', state: 'confirmed' },
        customer: { value: '启明机器人', state: 'confirmed' },
        participants: [{ name: '张三', role: '研发总监' }],
        goal: { value: '确认产品集成方案', state: 'confirmed' },
        agenda: ['机器人行业案例', '产品集成'],
        background: '首次交流',
    };
    return [
        '你只负责拆解会议信息，不补充输入中不存在的事实。',
        '必须只返回一个 JSON 对象，不要解释，不要使用 Markdown 代码块。',
        '严格使用以下字段和类型：topic、customer、goal 都是 { value: string, state: string }；participants 是 { name: string, role: string }[]；agenda 是 string[]；background 是 string。',
        'state 只能是 confirmed 或 needs_confirmation；输入未明确的信息使用空字符串、空数组和 needs_confirmation，不得猜测。',
        `合法格式示例（只展示结构和类型，不得照抄内容）：${JSON.stringify(example)}`,
        `用户输入：${JSON.stringify(rawInput)}`,
    ].join('\n');
}
```

保留 `MeetingPreparationService.parseInput` 中仅输出 Zod 错误类型、字段路径和错误码的安全诊断；不输出 `rawInput` 或模型原文。

- [ ] **Step 4: 运行定向测试并确认绿灯**

Run: `npm run build:electron && node --test electron/services/__tests__/MeetingPreparationService.test.mjs`

Expected: 全部 PASS。

- [ ] **Step 5: 运行类型检查和差异检查**

Run: `npm run typecheck:electron && git diff --check`

Expected: 两条命令退出码均为 0。

- [ ] **Step 6: 在本地 Electron 中复验**

启动或热重载应用后输入：

```text
明天下午和启明机器人研发总监做产品技术交流，重点讨论机器人行业案例和产品集成。
```

Expected: 点击“拆解会议信息”后进入“确认信息与模式”，主进程不再报告 `participants`、`agenda`、`background` 类型错误。若供应商仍违反契约，则保持现有拒绝和原文保留行为。

- [ ] **Step 7: 提交修复**

```bash
git add electron/services/meeting-preparation/MeetingPreparationPrompts.ts \
  electron/services/meeting-preparation/MeetingPreparationService.ts \
  electron/services/__tests__/MeetingPreparationService.test.mjs
git commit -m "fix: harden meeting preparation parse prompt"
```
