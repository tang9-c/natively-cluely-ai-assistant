# Meeting Preparation Evidence Output Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让会议准备证据模型稳定返回满足严格 Schema 的结果，并在失败时输出不含用户内容的结构化诊断。

**Architecture:** 保持 `MeetingPreparationService.generate()`、资料检索、`evidenceCoverageSchema`、数据库和页面状态映射不变。先强化 `buildEvidencePrompt()` 的 JSON 输出契约，再为 `checkEvidence()` 增加白名单化错误元数据；两个行为分别通过 TDD 锁定。

**Tech Stack:** TypeScript、Zod、Electron main process、Node.js test runner。

## Global Constraints

- 不修改或放宽 `evidenceCoverageSchema`。
- 不增加字符串到数组、数字字符串到数字的归一化。
- 不改变资料检索、证据状态、数据库结构或页面文案。
- 日志不得包含模型原文、提示词、问题文本、知识要求、检索片段、资料标题或供应商响应体。
- 检查失败继续返回 `evidenceStatus = null` 和 `checkError = check_failed`。

---

### Task 1: 强化证据提示词 JSON 契约

**Files:**
- Modify: `electron/services/meeting-preparation/MeetingPreparationPrompts.ts:87-105`
- Test: `electron/services/__tests__/MeetingPreparationService.test.mjs:185-244`

**Interfaces:**
- Consumes: `buildEvidencePrompt(question: PredictedQuestion, hits: KnowledgeMaterialSearchResult[]): string`。
- Produces: 函数签名不变；提示词明确 `evidenceCoverageSchema` 的全部字段类型与完整合法示例。

- [ ] **Step 1: 写入失败的证据提示词契约断言**

在 `generate returns no more than three questions and cites only retrieved chunks` 测试中，保留现有 `calls[1].options.dataScopes` 断言并追加：

```js
const evidencePrompt = calls[1].prompt;
assert.match(evidencePrompt, /必须只返回一个 JSON 对象/);
assert.match(evidencePrompt, /supported、missing、limitations、followupQuestions 都是 string\[\]/);
assert.match(evidencePrompt, /citedChunkIds 是非负整数数组/);
assert.match(evidencePrompt, /handlingScript 是 string/);
assert.match(evidencePrompt, /没有内容时使用空数组或空字符串，不得省略字段/);
assert.ok(evidencePrompt.includes('"coverage":"partial"'));
assert.ok(evidencePrompt.includes('"citedChunkIds":[123]'));
```

- [ ] **Step 2: 运行定向测试并确认红灯**

Run:

```bash
npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/MeetingPreparationService.test.mjs
```

Expected: FAIL，首个新增断言找不到“必须只返回一个 JSON 对象”。

- [ ] **Step 3: 最小化强化 `buildEvidencePrompt()`**

在函数中加入合法示例并替换返回文本：

```ts
const example = {
    coverage: 'partial',
    supported: ['资料已经支持的结论'],
    missing: ['仍缺少的信息'],
    limitations: ['现有资料的适用边界'],
    citedChunkIds: [123],
    handlingScript: '可以先说明已有证据覆盖的部分。',
    followupQuestions: ['您更关注哪个具体场景？'],
};
return [
    '你只判断所给内部资料对问题的覆盖程度，不得使用外部知识。',
    '必须只返回一个 JSON 对象，不要解释，不要使用 Markdown 代码块。',
    '严格使用以下字段和类型：coverage 是 sufficient 或 partial；supported、missing、limitations、followupQuestions 都是 string[]；citedChunkIds 是非负整数数组；handlingScript 是 string。',
    'citedChunkIds 只能引用下方提供的 chunkId。没有内容时使用空数组或空字符串，不得省略字段。',
    `合法格式示例（只展示结构和类型，不得照抄内容）：${JSON.stringify(example)}`,
    `问题与知识要求：${JSON.stringify({ question: question.question, knowledgeRequirements: question.knowledgeRequirements })}`,
    `检索资料：${JSON.stringify(chunks)}`,
].join('\n');
```

- [ ] **Step 4: 运行定向测试并确认绿灯**

Run:

```bash
npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/MeetingPreparationService.test.mjs
```

Expected: `MeetingPreparationService.test.mjs` 全部 PASS。

- [ ] **Step 5: 提交提示词修复**

```bash
git add electron/services/meeting-preparation/MeetingPreparationPrompts.ts \
  electron/services/__tests__/MeetingPreparationService.test.mjs
git commit -m "fix: harden meeting evidence prompt"
```

---

### Task 2: 增加隐私安全的证据失败诊断

**Files:**
- Modify: `electron/services/meeting-preparation/MeetingPreparationService.ts:1-344`
- Test: `electron/services/__tests__/MeetingPreparationService.test.mjs:246-275`

**Interfaces:**
- Consumes: Zod 的 `ZodError`、现有 `checkEvidence()` 失败分支。
- Produces: 业务返回值不变；失败日志固定为 `[MeetingPreparation] Evidence check failed` 加白名单化元数据。

- [ ] **Step 1: 写入失败的安全诊断测试**

在 `material retrieval failure stays outside business evidence states` 测试之前添加：

```js
test('evidence validation logs only safe issue metadata', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const service = makeService({
      llm: queuedJsonLlm([
        predictedQuestionsJson,
        {
          coverage: 'partial',
          supported: 'private model response',
          missing: [],
          limitations: [],
          citedChunkIds: [18],
          handlingScript: '',
          followupQuestions: [],
        },
      ]),
      materials: {
        searchWithDiagnostics: async () => ({
          hits: [{
            sourceType: 'uploaded_material',
            sourceId: 'private-source-id',
            chunkId: 18,
            score: 0.8,
            title: 'private material title',
            text: 'private material text',
            parentText: 'private parent text',
          }],
        }),
      },
    });

    const result = await service.generate('prep-1');

    assert.equal(result.questions[0].evidenceStatus, null);
    assert.equal(result.questions[0].evidence.checkError, 'check_failed');
    assert.deepEqual(warnings, [[
      '[MeetingPreparation] Evidence check failed',
      { errorType: 'ZodError', issues: [{ path: 'supported', code: 'invalid_type' }] },
    ]]);
    const serializedWarnings = JSON.stringify(warnings);
    assert.ok(!serializedWarnings.includes('private model response'));
    assert.ok(!serializedWarnings.includes('private material'));
    assert.ok(!serializedWarnings.includes('机器人行业案例'));
  } finally {
    console.warn = originalWarn;
  }
});
```

- [ ] **Step 2: 运行定向测试并确认红灯**

Run:

```bash
npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/MeetingPreparationService.test.mjs
```

Expected: FAIL，`warnings` 为空，因为当前 `catch` 不输出诊断。

- [ ] **Step 3: 实现白名单化错误诊断**

在 `MeetingPreparationService.ts` 顶部加入：

```ts
import { ZodError } from 'zod';
```

将证据检查的失败分支改为：

```ts
        } catch (error) {
            throwIfAborted(signal);
            const diagnostics = error instanceof ZodError
                ? {
                    errorType: 'ZodError',
                    issues: error.issues.map((issue) => ({
                        path: issue.path.join('.'),
                        code: issue.code,
                    })),
                }
                : {
                    errorType: error instanceof SyntaxError
                        ? 'SyntaxError'
                        : error instanceof Error
                            ? 'Error'
                            : 'UnknownError',
                };
            console.warn('[MeetingPreparation] Evidence check failed', diagnostics);
            return this.toQuestion(
```

保留后续 `toQuestion()` 内容不变。

- [ ] **Step 4: 运行定向测试并确认绿灯**

Run:

```bash
npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/MeetingPreparationService.test.mjs
```

Expected: `MeetingPreparationService.test.mjs` 全部 PASS，安全诊断测试精确匹配字段路径与错误码。

- [ ] **Step 5: 运行完整验证**

Run:

```bash
npm run typecheck:electron
npm test
git diff --check
```

Expected: 类型检查退出码为 0，完整测试为 0 failures，差异检查退出码为 0。

- [ ] **Step 6: 使用真实模型复验**

重新启动 Electron 主进程，在现有会议准备结果中依次对以下问题点击“重新检查”：

```text
是否有机器人行业案例？
产品如何实现集成？
```

Expected: 两题不再显示“检查失败”，而显示 `sufficient`、`partial` 或 `missing` 对应的中文状态；运行日志不包含模型原文、问题、知识要求或资料内容。

- [ ] **Step 7: 提交安全诊断**

```bash
git add electron/services/meeting-preparation/MeetingPreparationService.ts \
  electron/services/__tests__/MeetingPreparationService.test.mjs
git commit -m "fix: diagnose meeting evidence validation safely"
```
