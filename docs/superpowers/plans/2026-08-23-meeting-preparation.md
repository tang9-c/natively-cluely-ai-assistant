# Meeting Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Launcher 中交付完整的 P0“会议准备”：真实语音或文字描述会议、AI 拆解与模式推荐、可选历史关联、最多三个预测问题、逐题内部资料证据检查、草稿恢复，以及只应用模式后启动会议。

**Architecture:** Renderer 只负责 B + B3 三步交互，通过类型安全 IPC 调用 Electron Main。新增一个 `MeetingPreparationService` 编排现有 LLM、Modes、历史会议和资料检索；SQLite 继续由 `DatabaseManager` 管理两张表。会前语音在现有 `AppState` 中增加受限的麦克风听写状态，不新增通用听写服务、系统音频或会议记录。

**Tech Stack:** React 18、TypeScript、TailwindCSS、Framer Motion、Electron IPC、better-sqlite3、Zod、现有 LLMHelper/ProviderRouter、ModesManager、KnowledgeMaterialService、Playwright、Node test runner。

## Global Constraints

- 最终需求来源：`docs/product/P0_MEETING_PREPARATION_PRD.md`；入口视觉依据：`docs/superpowers/specs/2026-08-23-meeting-preparation-entry-prototype-design.md`。
- 入口采用 B + B3：Launcher Hero 左侧 2/3 卡片，同一 Launcher 窗口内进入独立三步页面；现有“启动 CueUp”位置、文案和行为不变。
- P0 只推荐现有 Sales 或 FDE 模式，不新增模式、混合模式、意图或动态动作规则。
- 公司研究只保留调用现有 `onOpenResearch` 的跳转链接；会议准备不得读取、触发、等待或消费研究结果。
- 会议准备结果不得注入会中回答上下文；“使用推荐模式开始会议”只调用现有模式切换并启动会议。
- 只新增 `meeting_preparations`、`meeting_preparation_questions` 两张表；不新增 Repository、来源表、候选结果、资料版本监听或持久化处理中间状态。
- 同一准备记录同一时刻只允许一个 AI 操作；Renderer 在操作期间锁定相关输入，失败或取消保留原内容。
- 所有 LLM 调用必须通过现有 `LLMHelper.generateContentStructured()` 路由并声明 `dataScopes`；历史使用 `profile_history`，内部资料使用 `reference_files`，语音转写/会议描述使用 `transcript`。
- 所有可能包含原始输入、转写、历史内容、资料片段或提示词的日志必须删除或通过 `redactForLog()`；不得记录正文。
- 会前听写只启动麦克风用户通道，不启动系统音频、不创建会议、不写入正式 transcript，并与正式会议互斥。
- 不修改 `.tmp/`；不顺带重构无关 Launcher、音频、模式、研究或 RAG 代码。

---

## File Structure

**Create**

- `shared/meetingPreparation.ts`：Renderer/Main 共用的记录、问题、上下文、IPC 输入输出类型。
- `electron/services/meeting-preparation/MeetingPreparationSchemas.ts`：Zod 输出校验与 JSON 提取。
- `electron/services/meeting-preparation/MeetingPreparationPrompts.ts`：拆解、模式推荐、问题预测和证据覆盖提示词。
- `electron/services/meeting-preparation/MeetingPreparationService.ts`：唯一业务编排服务与单任务互斥。
- `electron/services/__tests__/MeetingPreparationSchemas.test.mjs`：结构化输出边界测试。
- `electron/services/__tests__/MeetingPreparationService.test.mjs`：编排、降级、取消和可信证据测试。
- `electron/db/__tests__/DatabaseManager.meetingPreparation.test.mjs`：迁移、CRUD、事务和级联删除测试。
- `electron/services/__tests__/MeetingPreparationIpc.contract.test.mjs`：IPC/preload/renderer 类型契约测试。
- `electron/services/__tests__/MeetingPreparationDictation.contract.test.mjs`：听写互斥和 transcript 隔离契约测试。
- `src/components/meeting-preparation/MeetingPreparationEntryCard.tsx`：Launcher B 入口。
- `src/components/meeting-preparation/MeetingPreparationPage.tsx`：B3 三步页、自动保存、恢复和结果操作。
- `src/components/__tests__/MeetingPreparationUi.contract.test.mjs`：入口、公司研究纯跳转和会中边界契约。
- `tests/e2e/meeting-preparation.spec.ts`：完整 Launcher 流程。

**Modify**

- `electron/db/DatabaseManager.ts`：两表迁移与会议准备 CRUD。
- `electron/ipcHandlers.ts`：初始化服务、校验并注册会议准备 IPC。
- `electron/preload.ts`：暴露类型安全 API 和听写事件订阅。
- `src/types/electron.d.ts`：Renderer API 类型。
- `electron/main.ts`：`preparation_dictation` 麦克风状态及开始/停止/取消。
- `src/components/Launcher.tsx`：入口、页面切换、研究/资料跳转和开始会议衔接。
- `tests/e2e/fixtures.ts`：受控听写与 LLM fixture 所需的测试辅助。

---

### Task 1: Shared contracts and structured-output validation

**Files:**
- Create: `shared/meetingPreparation.ts`
- Create: `electron/services/meeting-preparation/MeetingPreparationSchemas.ts`
- Create: `electron/services/__tests__/MeetingPreparationSchemas.test.mjs`

**Interfaces:**
- Produces: `MeetingPreparationRecord`, `MeetingPreparationSaveInput`, `MeetingContext`, `ModeRecommendation`, `HistoryCandidate`, `PreparationQuestion`, `EvidenceStatus`, `PreparationOperation`。
- Produces: `extractAndParse(raw, schema)`，供所有 LLM 输出统一校验。

- [ ] **Step 1: Write failing schema tests**

```js
// electron/services/__tests__/MeetingPreparationSchemas.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const schemas = () => require('../../../dist-electron/electron/services/meeting-preparation/MeetingPreparationSchemas.js');

test('extractAndParse accepts fenced JSON and preserves uncertain fields', () => {
  const { extractAndParse, meetingContextSchema } = schemas();
  const result = extractAndParse('```json\n{"topic":{"value":"产品交流","state":"confirmed"},"customer":{"value":"启明机器人","state":"needs_confirmation"},"participants":[],"goal":{"value":"需求发现","state":"confirmed"},"agenda":[],"background":""}\n```', meetingContextSchema);
  assert.equal(result.customer.state, 'needs_confirmation');
});

test('extractAndParse rejects invented modes and more than three questions', () => {
  const { extractAndParse, modeRecommendationSchema, predictedQuestionsSchema } = schemas();
  assert.throws(() => extractAndParse('{"templateType":"general","reason":"x","focus":"y"}', modeRecommendationSchema));
  assert.throws(() => extractAndParse('{"questions":[{"question":"1","keyMomentType":"x","rationale":[],"knowledgeRequirements":[],"requiresInternalEvidence":true},{"question":"2","keyMomentType":"x","rationale":[],"knowledgeRequirements":[],"requiresInternalEvidence":true},{"question":"3","keyMomentType":"x","rationale":[],"knowledgeRequirements":[],"requiresInternalEvidence":true},{"question":"4","keyMomentType":"x","rationale":[],"knowledgeRequirements":[],"requiresInternalEvidence":true}]}', predictedQuestionsSchema));
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/MeetingPreparationSchemas.test.mjs
```

Expected: FAIL because `MeetingPreparationSchemas.js` does not exist.

- [ ] **Step 3: Add the shared contracts**

```ts
// shared/meetingPreparation.ts
export type MeetingPreparationStatus = 'draft' | 'ready';
export type MeetingPreparationInputMethod = 'voice' | 'text';
export type MeetingPreparationTemplateType = 'sales' | 'fde';
export type FieldState = 'confirmed' | 'needs_confirmation';
export type EvidenceStatus = 'sufficient' | 'partial' | 'missing' | 'not_needed';
export type PreparationOperation = 'parse' | 'prepare_context' | 'generate' | 'recheck';

export interface MeetingContextField { value: string; state: FieldState }
export interface MeetingContext {
  topic: MeetingContextField;
  customer: MeetingContextField;
  participants: Array<{ name: string; role: string }>;
  goal: MeetingContextField;
  agenda: string[];
  background: string;
}
export interface ModeRecommendation {
  modeId: string;
  templateType: MeetingPreparationTemplateType;
  label: string;
  reason: string;
  focus: string;
}
export interface HistoryCandidate {
  id: string;
  title: string;
  date: string;
  summary: string;
  matchReason: string;
}
export interface EvidenceCitation {
  sourceType: 'uploaded_material';
  sourceId: string;
  title: string;
  chunkId: number;
}
export interface PreparationEvidence {
  knowledgeRequirements: string[];
  supported: string[];
  missing: string[];
  limitations: string[];
  citations: EvidenceCitation[];
  handlingScript: string;
  followupQuestions: string[];
  checkError?: 'check_failed';
}
export interface PreparationQuestion {
  id: string;
  sortOrder: number;
  question: string;
  keyMomentType: string;
  rationale: string[];
  evidenceStatus: EvidenceStatus | null;
  evidence: PreparationEvidence;
  checkedAt: string | null;
}
export interface MeetingPreparationResult {
  modeRecommendation: ModeRecommendation | null;
  historySummary: string[];
  commitments: Array<{ text: string; sourceMeetingId: string; status: 'needs_confirmation' | 'completed' | 'pending' | 'not_needed' }>;
}
export interface MeetingPreparationRecord {
  id: string;
  status: MeetingPreparationStatus;
  rawInput: string;
  inputMethod: MeetingPreparationInputMethod;
  meetingContext: MeetingContext | null;
  selectedModeId: string | null;
  linkedMeetingId: string | null;
  result: MeetingPreparationResult;
  questions: PreparationQuestion[];
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface MeetingPreparationSaveInput {
  id?: string;
  status?: MeetingPreparationStatus;
  rawInput: string;
  inputMethod: MeetingPreparationInputMethod;
  meetingContext?: MeetingContext | null;
  selectedModeId?: string | null;
  linkedMeetingId?: string | null;
  result?: MeetingPreparationResult;
  questions?: PreparationQuestion[];
}
export interface PrepareContextResult {
  modeRecommendation: ModeRecommendation;
  historyCandidates: HistoryCandidate[];
  historyUnavailable: boolean;
}
export interface MeetingPreparationApi {
  meetingPreparationSave(input: MeetingPreparationSaveInput): Promise<MeetingPreparationRecord>;
  meetingPreparationGet(id: string): Promise<MeetingPreparationRecord | null>;
  meetingPreparationList(): Promise<MeetingPreparationRecord[]>;
  meetingPreparationDelete(id: string): Promise<{ success: true }>;
  meetingPreparationParseInput(input: { id: string; rawInput: string }): Promise<{ success: true; context: MeetingContext } | { success: false; error: string }>;
  meetingPreparationPrepareContext(input: { id: string; context: MeetingContext }): Promise<{ success: true; result: PrepareContextResult } | { success: false; error: string }>;
  meetingPreparationGenerate(id: string): Promise<{ success: true; record: MeetingPreparationRecord } | { success: false; error: string }>;
  meetingPreparationRecheckQuestion(input: { preparationId: string; questionId: string }): Promise<{ success: true; record: MeetingPreparationRecord } | { success: false; error: string }>;
  meetingPreparationApplyMode(id: string): Promise<{ success: true }>;
  meetingPreparationCancelOperation(id: string): Promise<{ success: boolean }>;
  meetingPreparationDictationStart(): Promise<{ success: true }>;
  meetingPreparationDictationStop(): Promise<{ success: true }>;
  meetingPreparationDictationCancel(): Promise<{ success: true }>;
  onMeetingPreparationDictationTranscript(callback: (payload: { text: string; final: boolean; timestamp: number }) => void): () => void;
}
```

- [ ] **Step 4: Add strict Zod schemas and JSON extraction**

```ts
// electron/services/meeting-preparation/MeetingPreparationSchemas.ts
import { z } from 'zod';

const fieldSchema = z.object({ value: z.string().max(500), state: z.enum(['confirmed', 'needs_confirmation']) });
export const meetingContextSchema = z.object({
  topic: fieldSchema,
  customer: fieldSchema,
  participants: z.array(z.object({ name: z.string().max(200), role: z.string().max(200) })).max(30),
  goal: fieldSchema,
  agenda: z.array(z.string().max(500)).max(20),
  background: z.string().max(5000),
});
export const modeRecommendationSchema = z.object({
  templateType: z.enum(['sales', 'fde']),
  reason: z.string().min(1).max(1000),
  focus: z.string().min(1).max(1000),
});
export const predictedQuestionSchema = z.object({
  question: z.string().min(1).max(1000),
  keyMomentType: z.string().min(1).max(200),
  rationale: z.array(z.string().max(500)).max(6),
  knowledgeRequirements: z.array(z.string().max(500)).max(10),
  requiresInternalEvidence: z.boolean(),
});
export type PredictedQuestion = z.infer<typeof predictedQuestionSchema>;
export const predictedQuestionsSchema = z.object({ questions: z.array(predictedQuestionSchema).max(3) });
export const generationBundleSchema = z.object({
  historySummary: z.array(z.string().max(1000)).max(10),
  commitments: z.array(z.object({ text: z.string().max(1000) })).max(10),
  questions: z.array(predictedQuestionSchema).max(3),
});
export const evidenceCoverageSchema = z.object({
  coverage: z.enum(['sufficient', 'partial']),
  supported: z.array(z.string().max(1000)).max(10),
  missing: z.array(z.string().max(1000)).max(10),
  limitations: z.array(z.string().max(1000)).max(10),
  citedChunkIds: z.array(z.number().int()).max(6),
  handlingScript: z.string().max(1500),
  followupQuestions: z.array(z.string().max(500)).max(6),
});

export function extractAndParse<T>(raw: string, schema: z.ZodType<T>): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? raw.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error('meeting_preparation_invalid_json');
  return schema.parse(JSON.parse(candidate));
}
```

- [ ] **Step 5: Build and verify GREEN**

Run the command from Step 2. Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/meetingPreparation.ts electron/services/meeting-preparation/MeetingPreparationSchemas.ts electron/services/__tests__/MeetingPreparationSchemas.test.mjs
git commit -m "feat: add meeting preparation contracts"
```

---

### Task 2: SQLite schema and persistence

**Files:**
- Modify: `electron/db/DatabaseManager.ts:528-1691,3238-3410`
- Create: `electron/db/__tests__/DatabaseManager.meetingPreparation.test.mjs`

**Interfaces:**
- Consumes: shared contracts from Task 1.
- Produces: `saveMeetingPreparation(input)`, `getMeetingPreparation(id)`, `listMeetingPreparations(limit)`, `deleteMeetingPreparation(id)`, `saveMeetingPreparationResult(id, result, questions)`.

- [ ] **Step 1: Write failing migration and CRUD tests**

```js
// electron/db/__tests__/DatabaseManager.meetingPreparation.test.mjs
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../../dist-electron/electron/db/DatabaseManager.js';

function makeManager() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = db;
  manager.ensuredDims = new Map();
  manager.runMigrations();
  return { db, manager };
}

describe('meeting preparation persistence', () => {
  let db, manager;
  beforeEach(() => ({ db, manager } = makeManager()));

  it('creates, updates, lists and restores a draft', () => {
    const created = manager.saveMeetingPreparation({ rawInput: '机器人客户交流', inputMethod: 'text' });
    assert.equal(created.status, 'draft');
    manager.saveMeetingPreparation({ ...created, rawInput: '机器人客户产品交流' });
    assert.equal(manager.getMeetingPreparation(created.id).rawInput, '机器人客户产品交流');
    assert.equal(manager.listMeetingPreparations(10)[0].id, created.id);
  });

  it('replaces questions transactionally and cascades on delete', () => {
    const created = manager.saveMeetingPreparation({ rawInput: '会议', inputMethod: 'text' });
    manager.saveMeetingPreparationResult(created.id, { modeRecommendation: null, historySummary: [], commitments: [] }, [{ id: 'q1', sortOrder: 0, question: '案例？', keyMomentType: 'case', rationale: [], evidenceStatus: 'missing', evidence: { knowledgeRequirements: [], supported: [], missing: ['案例'], limitations: [], citations: [], handlingScript: '会后补充', followupQuestions: [] }, checkedAt: null }]);
    manager.deleteMeetingPreparation(created.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM meeting_preparation_questions').get().count, 0);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/db/__tests__/DatabaseManager.meetingPreparation.test.mjs
```

Expected: FAIL because the tables and methods do not exist.

- [ ] **Step 3: Add the two-table migration**

Insert in `runMigrations()` after the existing `meetings` table exists:

```ts
this.db.exec(`
  CREATE TABLE IF NOT EXISTS meeting_preparations (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'ready')),
    raw_input TEXT NOT NULL DEFAULT '',
    input_method TEXT NOT NULL CHECK(input_method IN ('voice', 'text')),
    meeting_context_json TEXT,
    selected_mode_id TEXT,
    linked_meeting_id TEXT,
    result_json TEXT NOT NULL DEFAULT '{"modeRecommendation":null,"historySummary":[],"commitments":[]}',
    generated_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(linked_meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS meeting_preparation_questions (
    id TEXT PRIMARY KEY,
    preparation_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    question TEXT NOT NULL,
    key_moment_type TEXT NOT NULL,
    rationale_json TEXT NOT NULL DEFAULT '[]',
    evidence_status TEXT CHECK(evidence_status IS NULL OR evidence_status IN ('sufficient', 'partial', 'missing', 'not_needed')),
    evidence_json TEXT NOT NULL,
    checked_at TEXT,
    FOREIGN KEY(preparation_id) REFERENCES meeting_preparations(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_meeting_preparations_updated_at ON meeting_preparations(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_meeting_preparation_questions_parent ON meeting_preparation_questions(preparation_id, sort_order);
`);
```

- [ ] **Step 4: Add row mapping and CRUD methods**

Add imports from `../../shared/meetingPreparation` and implement these exact public signatures:

```ts
public saveMeetingPreparation(input: MeetingPreparationSaveInput): MeetingPreparationRecord;
public getMeetingPreparation(id: string): MeetingPreparationRecord | null;
public listMeetingPreparations(limit: number = 20): MeetingPreparationRecord[];
public deleteMeetingPreparation(id: string): void;
public saveMeetingPreparationResult(id: string, result: MeetingPreparationResult, questions: PreparationQuestion[]): MeetingPreparationRecord;
```

`saveMeetingPreparation()` must generate `prep_${cryptoRandomId()}` when `id` is absent, preserve `created_at`, update `updated_at`, and only replace questions when `input.questions` is present. `saveMeetingPreparationResult()` must run the preparation update and full question replacement inside one `this.db.transaction()` call, set `status='ready'`, and set `generated_at` once.

- [ ] **Step 5: Verify migration idempotence and GREEN**

Extend the test with two consecutive `manager.runMigrations()` calls, then run Step 2. Expected: all tests PASS.

- [ ] **Step 6: Run existing DB regression tests**

```bash
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/db/__tests__/DatabaseManager.connection.test.mjs electron/db/__tests__/DatabaseManager.meeting.test.mjs electron/db/__tests__/DatabaseManager.transactions.test.mjs electron/db/__tests__/DatabaseManager.meetingPreparation.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/db/DatabaseManager.ts electron/db/__tests__/DatabaseManager.meetingPreparation.test.mjs
git commit -m "feat: persist meeting preparations"
```

---

### Task 3: Context parsing, mode recommendation, and history candidates

**Files:**
- Create: `electron/services/meeting-preparation/MeetingPreparationPrompts.ts`
- Create: `electron/services/meeting-preparation/MeetingPreparationService.ts`
- Create: `electron/services/__tests__/MeetingPreparationService.test.mjs`

**Interfaces:**
- Consumes: `DatabaseManager`, `LLMHelper.generateContentStructured`, `ModesManager.getModes()`.
- Produces: `parseInput(preparationId, rawInput, signal?)`, `prepareContext(preparationId, context, signal?)`, `cancelOperation(preparationId)`.

- [ ] **Step 1: Write failing service tests**

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MeetingPreparationService } = require('../../../dist-electron/electron/services/meeting-preparation/MeetingPreparationService.js');
const validContext = { topic: { value: '产品交流', state: 'confirmed' }, customer: { value: '启明机器人', state: 'confirmed' }, participants: [{ name: '', role: '研发总监' }], goal: { value: '需求发现', state: 'confirmed' }, agenda: ['案例'], background: '' };
const baseRecord = { id: 'prep-1', status: 'draft', rawInput: '会议', inputMethod: 'text', meetingContext: validContext, selectedModeId: 'sales-mode', linkedMeetingId: null, result: { modeRecommendation: null, historySummary: [], commitments: [] }, questions: [], generatedAt: null, createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' };

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function jsonLlm(value) { return { generateContentStructured: async () => JSON.stringify(value) }; }
function makeService(overrides = {}) {
  const db = overrides.db ?? { getMeetingPreparation: () => structuredClone(baseRecord), getRecentMeetings: () => [], getMeetingDetails: () => null, saveMeetingPreparationResult: (_id, result, questions) => ({ ...structuredClone(baseRecord), status: 'ready', result, questions }) };
  const modes = overrides.modes ?? { getModes: () => [{ id: 'sales-mode', label: 'Sales', templateType: 'sales' }, { id: 'fde-mode', label: 'FDE', templateType: 'fde' }] };
  const materials = overrides.materials ?? { searchWithDiagnostics: async () => ({ hits: [] }) };
  return new MeetingPreparationService({ db, llm: overrides.llm ?? jsonLlm(validContext), modes, materials });
}

test('parseInput declares transcript scope and returns validated context', async () => {
  const calls = [];
  const service = makeService({ llm: { async generateContentStructured(prompt, options) { calls.push({ prompt, options }); return JSON.stringify(validContext); } } });
  const result = await service.parseInput('prep-1', '和机器人客户做产品技术交流');
  assert.equal(result.customer.value, '启明机器人');
  assert.deepEqual(calls[0].options.dataScopes, ['transcript']);
});

test('prepareContext only recommends Sales or FDE and returns at most five unselected meetings', async () => {
  const service = makeService({ llm: jsonLlm({ templateType: 'sales', reason: '产品价值沟通', focus: '案例和需求' }) });
  const result = await service.prepareContext('prep-1', validContext);
  assert.equal(result.modeRecommendation.templateType, 'sales');
  assert.ok(result.historyCandidates.length <= 5);
  assert.ok(result.historyCandidates.every(candidate => typeof candidate.id === 'string'));
});

test('rejects a second AI operation for the same preparation', async () => {
  const gate = deferred();
  const service = makeService({ llm: { generateContentStructured: () => gate.promise } });
  const first = service.parseInput('prep-1', '会议');
  await assert.rejects(service.parseInput('prep-1', '会议'), /meeting_preparation_busy/);
  gate.resolve(JSON.stringify(validContext));
  await first;
});
```

- [ ] **Step 2: Run the service test and verify RED**

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/MeetingPreparationService.test.mjs
```

Expected: FAIL because the service and prompt files do not exist.

- [ ] **Step 3: Add explicit prompt builders**

```ts
// MeetingPreparationPrompts.ts
export function buildMeetingContextPrompt(rawInput: string): string {
  return ['你只负责拆解会议信息，不补充输入中不存在的事实。', '返回 JSON：topic/customer/participants/goal/agenda/background；不确定字段的 state 必须为 needs_confirmation。', `用户输入：${JSON.stringify(rawInput)}`].join('\n');
}
export function buildModePrompt(context: unknown, modes: Array<{ id: string; label: string; templateType?: string }>): string {
  const allowed = modes.filter(mode => mode.templateType === 'sales' || mode.templateType === 'fde').map(mode => ({ id: mode.id, label: mode.label, templateType: mode.templateType }));
  return ['只能在 sales 与 fde 中推荐一个主模式。', '返回 JSON：templateType、reason、focus。', `可选模式：${JSON.stringify(allowed)}`, `会议信息：${JSON.stringify(context)}`].join('\n');
}
```

- [ ] **Step 4: Implement exclusive operations and parsing**

```ts
private readonly activeOperations = new Map<string, AbortController>();

private async runExclusive<T>(id: string, external: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (this.activeOperations.has(id)) throw new Error('meeting_preparation_busy');
  const controller = new AbortController();
  const abort = () => controller.abort(external?.reason);
  external?.addEventListener('abort', abort, { once: true });
  this.activeOperations.set(id, controller);
  try { return await work(controller.signal); }
  finally { external?.removeEventListener('abort', abort); this.activeOperations.delete(id); }
}

public cancelOperation(id: string): boolean {
  const controller = this.activeOperations.get(id);
  if (!controller) return false;
  controller.abort(new Error('meeting_preparation_cancelled'));
  return true;
}
```

`parseInput()` must reject blank or over-20,000-character input, call `generateContentStructured()` with `taskLabel:'meeting-preparation-parse'`, `providerStrategy:'selected_model_only'`, `dataScopes:['transcript']`, `abortSignal`, and validate with `meetingContextSchema`.

The service constructor is fixed as:

```ts
export class MeetingPreparationService {
  constructor(private readonly deps: {
    db: Pick<DatabaseManager, 'getMeetingPreparation' | 'getRecentMeetings' | 'getMeetingDetails' | 'saveMeetingPreparationResult' | 'saveMeetingPreparation'>;
    llm: Pick<LLMHelper, 'generateContentStructured'>;
    modes: Pick<ModesManager, 'getModes' | 'setActiveMode'>;
    materials: Pick<KnowledgeMaterialService, 'searchWithDiagnostics'>;
  }) {}
}
```

- [ ] **Step 5: Implement mode and history context**

`prepareContext()` must filter `ModesManager.getModes()` to `templateType === 'sales' || 'fde'`, validate the LLM selection, then rank `db.getRecentMeetings(50)` by normalized customer-name occurrence in title/summary followed by date descending. Return at most five `HistoryCandidate` records and never auto-select `linkedMeetingId`. If history lookup throws, return an empty candidate list with `historyUnavailable:true`; mode recommendation remains usable.

- [ ] **Step 6: Build and verify GREEN**

Run Step 2. Expected: service tests PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/services/meeting-preparation electron/services/__tests__/MeetingPreparationService.test.mjs
git commit -m "feat: prepare meeting context and mode"
```

---

### Task 4: Predicted questions, history commitments, and evidence checking

**Files:**
- Modify: `electron/services/meeting-preparation/MeetingPreparationPrompts.ts`
- Modify: `electron/services/meeting-preparation/MeetingPreparationService.ts`
- Modify: `electron/services/__tests__/MeetingPreparationService.test.mjs`

**Interfaces:**
- Consumes: `KnowledgeMaterialService.searchWithDiagnostics()` and Task 2 persistence.
- Produces: `generate(preparationId, signal?)`, `recheckQuestion(preparationId, questionId, signal?)`.

- [ ] **Step 1: Add failing trust-boundary tests**

```js
function queuedJsonLlm(values) { const queue = values.map(value => JSON.stringify(value)); return { generateContentStructured: async () => { if (queue.length === 0) throw new Error('unexpected_llm_call'); return queue.shift(); } }; }
function emptyMaterials() { return { searchWithDiagnostics: async () => ({ hits: [] }) }; }
function throwingMaterials() { return { searchWithDiagnostics: async () => { throw new Error('rag_failed'); } }; }
const predictedQuestionsJson = { historySummary: [], commitments: [], questions: [{ question: '机器人行业案例有哪些？', keyMomentType: 'case_request', rationale: ['议程包含行业案例'], knowledgeRequirements: ['机器人行业案例'], requiresInternalEvidence: true }] };

test('generate returns no more than three questions and only cites retrieved internal chunks', async () => {
  const service = makeService({
    llm: queuedJsonLlm([predictedQuestionsJson, { coverage: 'sufficient', supported: ['装配案例'], missing: [], limitations: [], citedChunkIds: [18], handlingScript: '', followupQuestions: [] }]),
    materials: { async searchWithDiagnostics() { return { hits: [{ sourceType: 'uploaded_material', sourceId: 'mat-1', chunkId: 18, score: .8, title: '机器人案例', text: '装配案例', parentText: '装配案例详情' }] }; } },
  });
  const result = await service.generate('prep-1');
  assert.ok(result.questions.length <= 3);
  assert.deepEqual(result.questions[0].evidence.citations.map(c => c.chunkId), [18]);
});

test('missing evidence never becomes sufficient and technical failure stays outside business states', async () => {
  const missing = await makeService({ materials: emptyMaterials() }).generate('prep-1');
  assert.equal(missing.questions[0].evidenceStatus, 'missing');
  const failed = await makeService({ materials: throwingMaterials() }).generate('prep-1');
  assert.equal(failed.questions[0].evidenceStatus, null);
  assert.equal(failed.questions[0].evidence.checkError, 'check_failed');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run the Task 3 service test command. Expected: FAIL because `generate()` and `recheckQuestion()` do not exist.

- [ ] **Step 3: Add prediction and evidence prompts**

`buildPredictionPrompt()` must include only confirmed meeting context, selected mode key moments, and the single user-selected historical meeting. It must request `historySummary`、`commitments` and 0–3 `questions`, and forbid invented customers, cases, ROI, prices, certifications, deployment promises, or source claims. Every returned commitment is saved with `sourceMeetingId=linkedMeetingId` and initial status `needs_confirmation`.

`buildEvidencePrompt()` must include knowledge requirements plus retrieved chunks encoded as JSON. It must state that cited chunk IDs must come from the supplied list and that the model only classifies `sufficient` or `partial`; `missing` and `not_needed` are deterministic service decisions.

- [ ] **Step 4: Implement deterministic evidence decisions**

```ts
private async checkEvidence(question: PredictedQuestion, signal: AbortSignal): Promise<PreparationQuestion> {
  const checkedAt = new Date().toISOString();
  if (!question.requiresInternalEvidence) return this.toQuestion(question, 'not_needed', { knowledgeRequirements: question.knowledgeRequirements, supported: [], missing: [], limitations: ['该问题主要依赖现场信息'], citations: [], handlingScript: '', followupQuestions: [], }, checkedAt);
  try {
    const response = await this.materials.searchWithDiagnostics(question.question, { limit: 6, candidateLimit: 200, hybridTimeoutMs: 1500 });
    if (response.hits.length === 0) return this.toQuestion(question, 'missing', { knowledgeRequirements: question.knowledgeRequirements, supported: [], missing: question.knowledgeRequirements, limitations: [], citations: [], handlingScript: '这个问题需要结合贵方场景进一步确认，我会在会后补充经过核对的资料。', followupQuestions: ['您最关注该问题的哪个具体场景？'] }, checkedAt);
    const coverage = await this.evaluateCoverage(question, response.hits, signal);
    const allowed = new Map(response.hits.map(hit => [hit.chunkId, hit]));
    const citations = coverage.citedChunkIds.filter(id => allowed.has(id)).map(id => { const hit = allowed.get(id)!; return { sourceType: 'uploaded_material' as const, sourceId: hit.sourceId, title: hit.title, chunkId: hit.chunkId }; });
    const status = coverage.coverage === 'sufficient' && citations.length > 0 ? 'sufficient' : 'partial';
    return this.toQuestion(question, status, { knowledgeRequirements: question.knowledgeRequirements, supported: coverage.supported, missing: coverage.missing, limitations: coverage.limitations, citations, handlingScript: coverage.handlingScript, followupQuestions: coverage.followupQuestions }, checkedAt);
  } catch {
    return this.toQuestion(question, null, { knowledgeRequirements: question.knowledgeRequirements, supported: [], missing: [], limitations: [], citations: [], handlingScript: '', followupQuestions: [], checkError: 'check_failed' }, checkedAt);
  }
}
```

- [ ] **Step 5: Implement generate and recheck transactions**

`generate()` must load the saved preparation, require a confirmed context and selected Sales/FDE mode, optionally load exactly `linkedMeetingId`, call the prediction prompt with `profile_history` only when history is present, run evidence checks with `reference_files`, then call `db.saveMeetingPreparationResult()` once after all checks complete. Aborted or failed generation must not write.

`recheckQuestion()` must reload the latest question text, run only `checkEvidence()`, replace that question in the saved array, and preserve all other questions byte-for-byte.

- [ ] **Step 6: Verify service tests and structured-generation regression**

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/MeetingPreparationSchemas.test.mjs electron/services/__tests__/MeetingPreparationService.test.mjs electron/llm/__tests__/LLMHelper.StructuredGeneration.test.mjs electron/services/__tests__/MaterialRagRetriever.weighted.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add electron/services/meeting-preparation electron/services/__tests__/MeetingPreparationService.test.mjs
git commit -m "feat: generate evidence-backed meeting preparation"
```

---

### Task 5: Type-safe IPC and service wiring

**Files:**
- Modify: `electron/ipcHandlers.ts:245-5918`
- Modify: `electron/preload.ts:1-2346`
- Modify: `src/types/electron.d.ts`
- Create: `electron/services/__tests__/MeetingPreparationIpc.contract.test.mjs`

**Interfaces:**
- Consumes: Task 3/4 service.
- Produces Renderer methods named `meetingPreparationSave/Get/List/Delete/ParseInput/PrepareContext/Generate/RecheckQuestion/ApplyMode/CancelOperation`.

- [ ] **Step 1: Write a failing IPC contract test**

The test must read the three source files and assert every channel is registered with `safeHandle`, invoked in preload with the same kebab-case name, and typed in `ElectronAPI`. It must also assert there is no `meeting-preparation-research-*` channel.

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
const rendererTypes = fs.readFileSync(path.join(root, 'src/types/electron.d.ts'), 'utf8');

test('meeting preparation IPC is wired through Main, preload and renderer types', () => {
  for (const channel of ['meeting-preparation-save','meeting-preparation-get','meeting-preparation-list','meeting-preparation-delete','meeting-preparation-parse-input','meeting-preparation-prepare-context','meeting-preparation-generate','meeting-preparation-recheck-question','meeting-preparation-apply-mode','meeting-preparation-cancel-operation']) {
    assert.match(ipc, new RegExp(`safeHandle\\(\\s*['"]${channel}['"]`));
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\(\\s*['"]${channel}['"]`));
  }
  assert.doesNotMatch(ipc, /meeting-preparation-research-/);
  assert.match(rendererTypes, /meetingPreparationSave/);
  assert.match(rendererTypes, /meetingPreparationGenerate/);
});
```

- [ ] **Step 2: Run contract test and verify RED**

```bash
node --test electron/services/__tests__/MeetingPreparationIpc.contract.test.mjs
```

Expected: FAIL because channels are absent.

- [ ] **Step 3: Instantiate one service inside `initializeIpcHandlers()`**

Construct it once using `DatabaseManager.getInstance()`, `appState.processingHelper.getLLMHelper()`, `ModesManager.getInstance()`, and one `KnowledgeMaterialService(DatabaseManager.getInstance(), appState.getRAGManager()?.getEmbeddingPipeline?.())`.

Add small main-process validators:

```ts
const requirePreparationId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^prep_[A-Za-z0-9_-]{6,128}$/.test(value)) throw new Error('invalid_preparation_id');
  return value;
};
const requirePreparationText = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 20_000) throw new Error('invalid_preparation_text');
  return value;
};
```

- [ ] **Step 4: Register handlers without exposing dependencies**

Each handler delegates to the service or `DatabaseManager`; `apply-mode` verifies the selected mode belongs to Sales/FDE before calling `ModesManager.setActiveMode(modeId)`. `generate`, `parse`, `prepare-context`, and `recheck` return `{ success:false, error:'busy'|'cancelled'|'invalid_output'|'failed' }` without returning prompt or transcript bodies.

- [ ] **Step 5: Add preload methods and shared return types**

Expose a `MeetingPreparationApi`-shaped block in both `electron/preload.ts` and `src/types/electron.d.ts`; import shared types with `import type`. Do not use `any` for preparation records or questions.

- [ ] **Step 6: Verify IPC contracts and Electron typecheck**

```bash
node --test electron/services/__tests__/MeetingPreparationIpc.contract.test.mjs
npm run typecheck:electron
```

Expected: PASS and zero TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add electron/ipcHandlers.ts electron/preload.ts src/types/electron.d.ts electron/services/__tests__/MeetingPreparationIpc.contract.test.mjs
git commit -m "feat: expose meeting preparation IPC"
```

---

### Task 6: Mic-only preparation dictation in AppState

**Files:**
- Modify: `electron/main.ts:415-4729`
- Modify: `electron/ipcHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Create: `electron/services/__tests__/MeetingPreparationDictation.contract.test.mjs`

**Interfaces:**
- Produces: `AppState.startPreparationDictation(sender)`, `stopPreparationDictation()`, `cancelPreparationDictation()`.
- Produces IPC/event: `meeting-preparation-dictation-start/stop/cancel/transcript`.

- [ ] **Step 1: Write failing isolation contract tests**

Assert source contains all three methods, rejects start when `isMeetingActive`, calls only `microphoneCapture.start()` and `googleSTT_User.start()`, never calls `systemAudioCapture.start()` inside the preparation start method, and routes user transcript to the requesting sender before the existing meeting transcript path.

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const source = fs.readFileSync('electron/main.ts', 'utf8');
test('preparation dictation is mic-only and meeting-exclusive', () => {
  const start = source.indexOf('public async startPreparationDictation');
  const stop = source.indexOf('public async stopPreparationDictation', start);
  assert.ok(start > 0 && stop > start);
  const block = source.slice(start, stop);
  assert.match(block, /this\.isMeetingActive/);
  assert.match(block, /this\.microphoneCapture\.start\(\)/);
  assert.match(block, /this\.googleSTT_User\.start\(\)/);
  assert.doesNotMatch(block, /systemAudioCapture\.start/);
  assert.match(source, /meeting-preparation-dictation-transcript/);
});
```

- [ ] **Step 2: Run test and verify RED**

```bash
node --test electron/services/__tests__/MeetingPreparationDictation.contract.test.mjs
```

Expected: FAIL because the state and methods are absent.

- [ ] **Step 3: Add the narrow AppState state and mic initialization**

```ts
private preparationDictation: { sender: Electron.WebContents; active: boolean } | null = null;

public async startPreparationDictation(sender: Electron.WebContents): Promise<void> {
  if (this.isMeetingActive || this.preparationDictation?.active) throw new Error('audio_session_busy');
  if (!this.microphoneCapture) { this.microphoneCapture = new MicrophoneCapture(); this.wireMicCapture(this.microphoneCapture, '(Preparation)'); }
  if (!this.googleSTT_User) this.googleSTT_User = this.createSTTProvider('user');
  if (!this.googleSTT_User) throw new Error('stt_not_configured');
  this.preparationDictation = { sender, active: true };
  this._micSttRateApplied = false;
  this.microphoneCapture.start();
  this.googleSTT_User.start();
}
```

Do not call `setupSystemAudioPipeline()` from this method.

- [ ] **Step 4: Route transcript without contaminating meetings**

At the start of the existing user-channel transcript callback, if preparation dictation is active, send `{ text, final, timestamp }` only to `preparationDictation.sender` on `meeting-preparation-dictation-transcript` and return before `routeTranscriptPayload()` or transcript persistence.

- [ ] **Step 5: Implement stop, cancel, renderer destruction, and meeting mutual exclusion**

`stopPreparationDictation()` finalizes the user STT, allows the existing 250ms final-drain window, then stops/destroys the mic and user STT created outside a meeting. `cancelPreparationDictation()` performs the same cleanup without finalization. Starting a meeting first awaits cancellation. If the requesting WebContents is destroyed, cancel automatically.

- [ ] **Step 6: Register dictation IPC and subscriptions**

Register start with `event.sender`; expose unsubscribe-safe preload subscription. Add an E2E-only injection handler guarded by `process.env.ELECTRON_E2E === '1'` that feeds a transcript through the same preparation-only route without starting hardware.

- [ ] **Step 7: Verify contract and audio regressions**

```bash
npm run build:electron
node --test electron/services/__tests__/MeetingPreparationDictation.contract.test.mjs
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/audio/__tests__/SttSegmentation.test.mjs electron/audio/__tests__/RestSTT.test.mjs electron/services/__tests__/TranscriptIpcBatcher.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add electron/main.ts electron/ipcHandlers.ts electron/preload.ts src/types/electron.d.ts electron/services/__tests__/MeetingPreparationDictation.contract.test.mjs
git commit -m "feat: add meeting preparation dictation"
```

---

### Task 7: Launcher B entry and B3 three-step page

**Files:**
- Create: `src/components/meeting-preparation/MeetingPreparationEntryCard.tsx`
- Create: `src/components/meeting-preparation/MeetingPreparationPage.tsx`
- Modify: `src/components/Launcher.tsx:1-1008`
- Create: `src/components/__tests__/MeetingPreparationUi.contract.test.mjs`

**Interfaces:**
- Consumes: Task 5/6 Renderer API.
- Consumes existing `onOpenResearch`, `onOpenSettings('knowledge')`, `onStartMeeting`.
- Produces user journey from entry to ready result.

- [ ] **Step 1: Write failing UI contract tests**

Assert the entry has `data-testid="meeting-preparation-entry"`, Launcher retains `data-testid="launcher-ad-carousel"` and “启动 CueUp”, the page has three named steps, and company research only calls `onOpenResearch` without invoking any research IPC.

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const launcher = fs.readFileSync('src/components/Launcher.tsx', 'utf8');
const entry = fs.existsSync('src/components/meeting-preparation/MeetingPreparationEntryCard.tsx') ? fs.readFileSync('src/components/meeting-preparation/MeetingPreparationEntryCard.tsx', 'utf8') : '';
const page = fs.existsSync('src/components/meeting-preparation/MeetingPreparationPage.tsx') ? fs.readFileSync('src/components/meeting-preparation/MeetingPreparationPage.tsx', 'utf8') : '';
test('Launcher keeps primary actions and exposes B plus B3', () => {
  assert.match(launcher, /启动 CueUp/);
  assert.match(launcher, /launcher-ad-carousel/);
  assert.match(entry, /meeting-preparation-entry/);
  assert.match(page, /描述会议/);
  assert.match(page, /确认信息与模式/);
  assert.match(page, /查看准备结果/);
  assert.match(page, /onOpenResearch/);
  assert.doesNotMatch(page, /profileResearchCompany|meeting-preparation-research-/);
});
```

- [ ] **Step 2: Run contract tests and verify RED**

```bash
node --test src/components/__tests__/MeetingPreparationUi.contract.test.mjs electron/services/__tests__/LauncherAdCarouselContract.test.mjs electron/services/__tests__/LauncherNavigationStability.test.mjs
```

Expected: meeting-preparation test FAIL; existing Launcher tests PASS.

- [ ] **Step 3: Implement the entry card**

Render in the existing empty `md:col-span-2` Hero slot with the approved copy:

```tsx
<MeetingPreparationEntryCard
  title="准备下一场会议"
  description="告诉 AI 客户、参会人和会议目标，提前准备可能的问题与所需资料"
  helper="支持新会议，也可关联历史会议"
  onStart={openMeetingPreparation}
/>
```

Do not move or wrap the existing “启动 CueUp” button or ad carousel.

- [ ] **Step 4: Implement page state and draft recovery**

`MeetingPreparationPage` loads `meetingPreparationList()`. If no record is selected it creates one through `meetingPreparationSave({ rawInput:'', inputMethod:'text' })`. Debounce autosave by 400ms, display `保存中/已保存/保存失败`, warn before leaving only when the latest save failed, and provide recent-record reopen/delete controls.

- [ ] **Step 5: Implement Step 1 and Step 2**

Step 1 displays equal-weight text and voice controls, editable transcript, recording duration, stop/cancel, and failure fallback to text. Continue invokes parse and renders the six editable fields.

Step 2 invokes `prepareContext`, lets the user confirm/change only Sales or FDE, optionally choose one of at most five history candidates, and contains:

```tsx
<button type="button" onClick={async () => { await flushSave(); onOpenResearch(); }}>
  前往公司研究 <ArrowRight aria-hidden="true" />
</button>
```

Returning from research must not call any preparation API except restoring the saved record.

- [ ] **Step 6: Implement Step 3 and start-meeting boundary**

Render recommendation, history summary, commitments with user-confirmable status, and at most three question cards. Each question supports edit/delete/add, citation expansion, evidence status, missing items, handling script, follow-up questions, “补充资料” via `onOpenSettings('knowledge')`, and recheck.

The final action must execute only:

```ts
await window.electronAPI.meetingPreparationApplyMode(record.id);
await onStartMeeting();
```

It must not pass preparation results, questions, citations, or evidence to meeting-start metadata.

- [ ] **Step 7: Lock inputs during AI operations and handle recovery**

Maintain one `activeOperation` state. Disable relevant fields and navigation while set; expose Cancel. On failure or cancellation, keep the prior record object and show a retryable error. Do not render or persist `parsing`, `generating`, `failed`, `needs_recheck`, or candidate-result states.

- [ ] **Step 8: Build and verify UI contracts**

```bash
npm run build
node --test src/components/__tests__/MeetingPreparationUi.contract.test.mjs electron/services/__tests__/LauncherAdCarouselContract.test.mjs electron/services/__tests__/LauncherNavigationStability.test.mjs
```

Expected: build succeeds and all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/meeting-preparation src/components/Launcher.tsx src/components/__tests__/MeetingPreparationUi.contract.test.mjs
git commit -m "feat: add Launcher meeting preparation flow"
```

---

### Task 8: Electron E2E, privacy regression, and final verification

**Files:**
- Create: `tests/e2e/meeting-preparation.spec.ts`
- Modify: `tests/e2e/fixtures.ts`
- Modify only if needed by a failing regression: files from Tasks 1-7.

**Interfaces:**
- Validates the complete implementation; produces no new product API except E2E-only fixtures guarded by `ELECTRON_E2E=1`.

- [ ] **Step 1: Write the failing E2E happy path**

```ts
import { test, expect } from './fixtures';

test('prepares a new Sales meeting without history or company research data', async ({ page }) => {
  await page.getByTestId('meeting-preparation-entry').click();
  await page.getByRole('textbox', { name: '会议描述' }).fill('和启明机器人研发总监进行产品技术交流，重点讨论行业案例和集成。');
  await page.getByRole('button', { name: '拆解会议信息' }).click();
  await expect(page.getByLabel('客户')).toHaveValue('启明机器人');
  await page.getByRole('button', { name: '确认并推荐模式' }).click();
  await expect(page.getByText('推荐模式：Sales')).toBeVisible();
  await page.getByRole('button', { name: '生成准备结果' }).click();
  await expect(page.getByText('会议作战准备卡')).toBeVisible();
  await expect(page.locator('[data-testid="preparation-question"]')).toHaveCount(3);
});
```

- [ ] **Step 2: Add E2E coverage for recovery and boundaries**

Add scenarios for: controlled dictation transcript; draft survives back/reopen; no-history completion; delete does not delete source meeting; company research link opens existing panel and returns without changing preparation; operation lock/cancel; missing evidence; failed evidence check; recheck after material upload; applying mode starts meeting without preparation payload; ad carousel and “启动 CueUp” remain usable.

The two product-boundary regressions must be explicit rather than inferred from the happy path:

```ts
test('company research remains navigation-only', async ({ page }) => {
  await page.getByTestId('meeting-preparation-entry').click();
  await page.getByRole('link', { name: '研究公司' }).click();
  await expect(page.getByTestId('research-panel')).toBeVisible();
  await page.getByRole('button', { name: '返回会议准备' }).click();
  await expect(page.getByLabel('会议描述')).toHaveValue('');
});

test('draft survives leaving and reopening the preparation page', async ({ page }) => {
  await page.getByTestId('meeting-preparation-entry').click();
  await page.getByLabel('会议描述').fill('明天和新客户讨论机器人行业案例');
  await page.getByRole('button', { name: '返回' }).click();
  await page.getByTestId('meeting-preparation-entry').click();
  await expect(page.getByLabel('会议描述')).toHaveValue('明天和新客户讨论机器人行业案例');
});
```

- [ ] **Step 3: Run E2E and verify RED, then fix only observed failures**

```bash
npm run build
npm run build:electron
ELECTRON_E2E=1 npx playwright test tests/e2e/meeting-preparation.spec.ts tests/e2e/launcher-ad-carousel.spec.ts
```

Expected before fixture/UI completion: meeting preparation tests FAIL. Implement only the missing fixture hooks or selectors demonstrated by failures, then rerun until PASS.

- [ ] **Step 4: Run privacy and contract scans**

```bash
rg -n "console\.(log|warn|error).*?(rawInput|transcript|prompt|referenceContent|evidence|parentText)" electron/services/meeting-preparation electron/ipcHandlers.ts electron/main.ts
rg -n "meeting-preparation-research-|company_research_ref|needs_recheck|candidateResult|meetingPreparation.*localStorage" electron src shared
```

Expected: both commands return no matches. If a diagnostic log is necessary, log only operation name, record ID hash, duration, status, and `redactForLog()` output.

- [ ] **Step 5: Run focused and full verification**

```bash
npm run build
npm run typecheck:electron
npm test
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/db/__tests__/DatabaseManager.meetingPreparation.test.mjs electron/services/__tests__/MeetingPreparationSchemas.test.mjs electron/services/__tests__/MeetingPreparationService.test.mjs
node --test electron/services/__tests__/MeetingPreparationIpc.contract.test.mjs electron/services/__tests__/MeetingPreparationDictation.contract.test.mjs src/components/__tests__/MeetingPreparationUi.contract.test.mjs
ELECTRON_E2E=1 npx playwright test tests/e2e/meeting-preparation.spec.ts tests/e2e/launcher-ad-carousel.spec.ts tests/e2e/meeting-start-overlay-reliability.spec.ts
```

Expected: all commands exit 0 with zero failing tests.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/meeting-preparation.spec.ts tests/e2e/fixtures.ts
git add shared/meetingPreparation.ts electron/db/DatabaseManager.ts electron/services/meeting-preparation electron/ipcHandlers.ts electron/preload.ts electron/main.ts src/types/electron.d.ts src/components/meeting-preparation src/components/Launcher.tsx
git commit -m "test: cover meeting preparation end to end"
```

The final commit may be empty if all fixes were committed in earlier tasks; in that case do not create an empty commit.
