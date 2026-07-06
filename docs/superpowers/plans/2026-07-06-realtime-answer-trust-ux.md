# Realtime Answer Trust UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the five approved trust UX improvements for realtime answers, local material RAG, failed material guidance, embedding degradation copy, and dynamic action explanations.

**Architecture:** Add a thin UI-facing trust explanation layer that separates single-answer explanation from aggregate diagnostics. Single-answer UI uses the current answer trace/citations already in the renderer; aggregate diagnostics use persisted SQLite answer metrics, never the process-local collector as the primary source.

**Tech Stack:** Electron main process TypeScript/CommonJS, React 18 renderer, existing IPC `safeHandle`, SQLite through `DatabaseManager`, node:test Electron test suites, source-level renderer contract tests.

## Global Constraints

- Do not build a full analytics dashboard.
- Do not add new model inference, new providers, or new RAG algorithms.
- Do not implement real PPTX parsing in this scope.
- Do not persist raw transcript, prompt, screenshot path, screenshot body, material chunk text, dynamic-action evidence text, or provider credentials in new diagnostics.
- Do not change dynamic action triggering policy in this scope.
- Do not make failed materials appear retryable unless the product action is truly supported.
- Product diagnostics metrics must come from persisted traces/events through `DatabaseManager.getAnswerQualityMetrics()`; `ContextQualityDiagnosticsCollector` can only be developer supplement.
- Keep unrelated working-tree changes out of implementation commits. At plan time, `docs/engineering/CONTEXT_SYSTEM_ROADMAP.md` and `docs/engineering/TEST_ALL_BASELINE_REPORT_FOLLOWUP_2026-07-05.md` were separate local changes.

---

## File Structure

- Create `shared/realtimeAnswerTrustViewModel.ts`
  - Owns `LatestAnswerTrustExplanation`, `RealtimeDiagnosticsSummary`, material status explanation, dynamic action explanation, and reason-code-to-copy mapping.
  - Pure functions only; no Electron, no DB, no IPC.
- Create `electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs`
  - Tests privacy-safe single-answer explanations, aggregate summary sample-size behavior, material failure copy, embedding degradation copy, and dynamic action fallback copy.
- Modify `electron/ipcHandlers.ts`
  - Add `quality:get-realtime-diagnostics-summary`, using persisted `DatabaseManager.getAnswerQualityMetrics()`.
- Modify `electron/preload.ts`
  - Expose `getRealtimeDiagnosticsSummary()`.
- Modify `src/types/electron.d.ts`
  - Add shared renderer-facing trust types and `getRealtimeDiagnosticsSummary`.
  - Add `error_code?: string | null` / `errorCode?: string | null` to `KnowledgeMaterial`.
- Modify `src/components/settings/KnowledgeMaterialsSettings.tsx`
  - Use material status explanation helper behavior in UI.
  - Replace misleading failed-material reindex affordance with clear "重新上传新文件" guidance.
  - Keep completed-material reindex action.
- Modify `src/components/NativelyInterface.tsx`
  - Replace scattered source/degraded text with `buildLatestAnswerTrustExplanation` output.
  - Keep existing citation preview behavior.
- Modify `src/components/dynamic-actions/DynamicActionCard.tsx`
  - Add compact semantic/generic explanation line.
  - Do not expand evidence rendering.
- Modify `package.json`
  - Add new focused tests to `test:quality:smoke:no-build` or `test:quality:diagnostics:no-build`.

---

### Task 1: Trust View Model

**Files:**
- Create: `shared/realtimeAnswerTrustViewModel.ts`
- Test: `electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs`

**Interfaces:**
- Produces:
  - `type TrustSeverity = 'ok' | 'info' | 'warning' | 'error'`
  - `interface LatestAnswerTrustExplanation`
  - `interface RealtimeDiagnosticsSummary`
  - `function buildLatestAnswerTrustExplanation(input: LatestAnswerTrustInput): LatestAnswerTrustExplanation`
  - `function buildRealtimeDiagnosticsSummary(input: RealtimeDiagnosticsInput): RealtimeDiagnosticsSummary`
  - `function explainMaterialStatus(material: MaterialStatusInput): MaterialStatusExplanation`
  - `function explainDynamicAction(action: DynamicActionTrustInput): DynamicActionExplanation`
  - `function mapTrustReasonToCopy(reason?: string | null): string | null`

- Consumes:
  - Plain JSON-safe objects shaped like existing `AnswerContextTrace`, `AnswerCitation`, `AnswerQualityMetrics`, `KnowledgeMaterial`, and `DynamicActionPayload`.

- Later tasks rely on:
  - `buildLatestAnswerTrustExplanation` in `NativelyInterface`.
  - `buildRealtimeDiagnosticsSummary` in IPC.
  - `explainMaterialStatus` in `KnowledgeMaterialsSettings`.
  - `explainDynamicAction` in `DynamicActionCard`.

- [ ] **Step 1: Write failing tests**

Create `electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs`:

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

const modulePath = path.resolve(
  import.meta.dirname,
  '../../../dist-electron/shared/realtimeAnswerTrustViewModel.js',
);

async function loadViewModel() {
  return import(modulePath);
}

test('latest answer explanation uses single-answer trace and strips sensitive fixture content', async () => {
  const { buildLatestAnswerTrustExplanation } = await loadViewModel();
  const explanation = buildLatestAnswerTrustExplanation({
    trace: {
      contextUsed: { currentTranscript: true, uploadedDocumentRag: true, screenContext: false },
      sourceStatus: {
        ragReady: true,
        ragAttempted: true,
        embeddingReady: true,
        uploadedMaterialHitCount: 1,
        citationCount: 1,
        screenContextStatus: 'not_used',
        transcriptStatus: 'used',
      },
      citations: [],
      degradedReason: null,
    },
    citations: [
      {
        citationId: 'citation-safe',
        sourceType: 'uploaded_material',
        sourceId: 'material-1',
        title: 'Product FAQ',
      },
    ],
    degradedReason: null,
    forbiddenFixture: {
      transcript: 'SECRET_TRANSCRIPT_SHOULD_NOT_LEAK',
      prompt: 'SECRET_PROMPT_SHOULD_NOT_LEAK',
      screenshotPath: '/tmp/SECRET_SCREENSHOT.png',
      materialText: 'SECRET_CHUNK_TEXT_SHOULD_NOT_LEAK',
      evidenceText: 'SECRET_ACTION_EVIDENCE_SHOULD_NOT_LEAK',
    },
  });

  assert.equal(explanation.usedUploadedMaterial, true);
  assert.equal(explanation.materialHitCount, 1);
  assert.ok(explanation.primaryMessages.some((message) => message.includes('已使用上传资料')));
  const serialized = JSON.stringify(explanation);
  assert.doesNotMatch(serialized, /SECRET_TRANSCRIPT_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(serialized, /SECRET_PROMPT_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(serialized, /SECRET_SCREENSHOT/);
  assert.doesNotMatch(serialized, /SECRET_CHUNK_TEXT_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(serialized, /SECRET_ACTION_EVIDENCE_SHOULD_NOT_LEAK/);
});

test('latest answer explanation distinguishes material miss from retrieval failure', async () => {
  const { buildLatestAnswerTrustExplanation } = await loadViewModel();
  const explanation = buildLatestAnswerTrustExplanation({
    trace: {
      contextUsed: { currentTranscript: true, uploadedDocumentRag: false },
      sourceStatus: {
        ragReady: true,
        ragAttempted: true,
        embeddingReady: true,
        uploadedMaterialHitCount: 0,
        citationCount: 0,
        screenContextStatus: 'not_used',
        transcriptStatus: 'used',
      },
      citations: [],
      degradedReason: 'no_relevant_uploaded_material',
    },
    citations: [],
    degradedReason: 'no_relevant_uploaded_material',
  });

  assert.equal(explanation.usedUploadedMaterial, false);
  assert.equal(explanation.materialHitCount, 0);
  assert.ok(explanation.primaryMessages.some((message) => /没有匹配到相关上传资料/.test(message)));
  assert.equal(explanation.reasonCodes.includes('no_relevant_uploaded_material'), true);
});

test('embedding degradation copy separates config, indexing, and query fallback states', async () => {
  const { mapTrustReasonToCopy } = await loadViewModel();

  assert.equal(
    mapTrustReasonToCopy('embedding_not_configured'),
    '未配置语义检索。CueUp 会对上传资料使用关键词匹配。',
  );
  assert.equal(
    mapTrustReasonToCopy('embedding_failed'),
    '资料文本可用，但语义索引失败。CueUp 仍可尝试关键词匹配。',
  );
  assert.equal(
    mapTrustReasonToCopy('hybrid_threw'),
    '这次语义检索失败，CueUp 已使用关键词匹配。',
  );
});

test('failed material guidance is honest about replacement upload', async () => {
  const { explainMaterialStatus } = await loadViewModel();
  const unsupported = explainMaterialStatus({
    id: 'm1',
    title: 'deck.pptx',
    status: 'failed',
    errorCode: 'unsupported_file_type',
    errorMessage: 'unsupported',
  });

  assert.equal(unsupported.canReindex, false);
  assert.equal(unsupported.primaryActionLabel, '重新上传新文件');
  assert.match(unsupported.message, /暂不支持此格式/);
  assert.doesNotMatch(unsupported.message, /重试此资料/);

  const complete = explainMaterialStatus({
    id: 'm2',
    title: 'faq.pdf',
    status: 'complete',
  });
  assert.equal(complete.canReindex, true);
  assert.equal(complete.primaryActionLabel, '重新索引');
});

test('dynamic action explanation uses semantic gate metadata when present and conservative copy otherwise', async () => {
  const { explainDynamicAction } = await loadViewModel();
  const gated = explainDynamicAction({
    type: 'case_study_request',
    semanticGate: {
      decision: 'pass',
      actionType: 'case_study_request',
      confidence: 0.91,
      reasons: ['cloud_confirmed_case_request'],
      regexCandidates: [],
      rejectedCandidates: [],
      usedLocalIntentModel: false,
      usedCloudArbitration: true,
      semanticProvider: 'cloud_llm',
      arbitrationStatus: 'cloud_used',
      upgradedByRepeatedEvidence: false,
    },
  });
  assert.equal(gated.traceComplete, true);
  assert.match(gated.message, /已通过语义门控/);

  const fallback = explainDynamicAction({ type: 'case_study_request' });
  assert.equal(fallback.traceComplete, false);
  assert.equal(fallback.message, '基于会议信号触发。');
});

test('aggregate diagnostics mark low sample sizes and use persisted metrics source', async () => {
  const { buildRealtimeDiagnosticsSummary } = await loadViewModel();
  const summary = buildRealtimeDiagnosticsSummary({
    metrics: {
      shownCount: 2,
      copiedCount: 0,
      acceptedCount: 1,
      ignoredCount: 0,
      regeneratedCount: 1,
      averageLatencyMs: 900,
      p95LatencyMs: 1200,
      citationHitRate: 0.5,
      userAcceptanceRate: 0.5,
      regenerationRate: 0.5,
      ragHitRate: 0.5,
      noContextAnswerRate: 0,
    },
    sourceStatusCounts: {},
    degradedReasons: { embedding_unavailable: 1 },
    sampleSize: 2,
  });

  assert.equal(summary.source, 'persisted');
  assert.equal(summary.sampleSize, 2);
  assert.equal(summary.insufficientData, true);
  assert.ok(summary.messages.some((message) => /样本不足/.test(message)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk npm run build:electron
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs
```

Expected: build passes, test fails with module-not-found for `RealtimeAnswerTrustViewModel.js`.

- [ ] **Step 3: Implement the pure view model**

Create `shared/realtimeAnswerTrustViewModel.ts`:

```ts
export type TrustSeverity = 'ok' | 'info' | 'warning' | 'error';

export interface AnswerSourceStatusLike {
    ragReady?: boolean;
    ragAttempted?: boolean;
    embeddingReady?: boolean;
    uploadedMaterialHitCount?: number;
    citationCount?: number;
    screenContextStatus?: 'available' | 'failed' | 'blocked' | 'not_used' | string;
    transcriptStatus?: 'used' | 'not_used' | string;
}

export interface AnswerTraceLike {
    contextUsed?: Record<string, unknown>;
    sourceStatus?: AnswerSourceStatusLike;
    citations?: AnswerCitationLike[];
    degradedReason?: string | null;
    degraded_reason?: string | null;
}

export interface AnswerCitationLike {
    citationId?: string;
    sourceType?: string;
    title?: string | null;
}

export interface LatestAnswerTrustInput {
    trace?: AnswerTraceLike | null;
    citations?: AnswerCitationLike[];
    degradedReason?: string | null;
    forbiddenFixture?: Record<string, string>;
}

export interface LatestAnswerTrustExplanation {
    usedUploadedMaterial: boolean;
    materialHitCount: number;
    citationCount: number;
    primaryMessages: string[];
    sourceLabels: string[];
    degradedMessages: string[];
    reasonCodes: string[];
    hasValidCitation: boolean;
}

export interface MaterialStatusInput {
    id: string;
    title?: string | null;
    file_name?: string | null;
    fileName?: string | null;
    status: 'queued' | 'indexing' | 'complete' | 'failed' | 'deleted' | string;
    errorCode?: string | null;
    error_code?: string | null;
    errorMessage?: string | null;
    error_message?: string | null;
}

export interface MaterialStatusExplanation {
    label: string;
    message: string;
    severity: TrustSeverity;
    canReindex: boolean;
    primaryActionLabel?: string;
}

export interface DynamicActionTrustInput {
    type: string;
    semanticGate?: {
        decision: 'pass' | 'reject' | 'defer' | 'fast_path';
        actionType: string;
        semanticIntent?: string;
        confidence: number;
        reasons: string[];
        regexCandidates: string[];
        rejectedCandidates: string[];
        usedLocalIntentModel: boolean;
        usedCloudArbitration: boolean;
        semanticProvider: 'local_intent' | 'cloud_llm' | 'rule_fast_path' | 'unavailable';
        arbitrationStatus: 'cloud_used' | 'local_only_by_privacy' | 'local_fallback_cloud_unavailable' | 'cloud_unavailable' | 'local_only_not_needed';
        degradedReason?: string;
        upgradedByRepeatedEvidence: boolean;
    };
}

export interface DynamicActionExplanation {
    message: string;
    traceComplete: boolean;
    severity: TrustSeverity;
}

export interface AnswerQualityMetricsLike {
    shownCount: number;
    copiedCount: number;
    acceptedCount: number;
    ignoredCount: number;
    regeneratedCount: number;
    averageLatencyMs: number | null;
    p95LatencyMs: number | null;
    citationHitRate: number;
    userAcceptanceRate: number;
    regenerationRate: number;
    ragHitRate: number;
    noContextAnswerRate: number;
}

export interface RealtimeDiagnosticsInput {
    metrics: AnswerQualityMetricsLike;
    sourceStatusCounts?: Record<string, number>;
    degradedReasons?: Record<string, number>;
    sampleSize?: number;
}

export interface RealtimeDiagnosticsSummary {
    source: 'persisted';
    sampleSize: number;
    insufficientData: boolean;
    metrics: AnswerQualityMetricsLike;
    degradedReasons: Record<string, number>;
    sourceStatusCounts: Record<string, number>;
    messages: string[];
}

const LOW_SAMPLE_THRESHOLD = 5;

const TRUST_REASON_COPY: Record<string, string> = {
    no_relevant_uploaded_material: '没有匹配到相关上传资料。',
    uploaded_material_rag_failed: '资料检索失败，这条回答没有使用上传资料。',
    embedding_not_configured: '未配置语义检索。CueUp 会对上传资料使用关键词匹配。',
    embedding_unavailable: '未配置语义检索，CueUp 已使用关键词匹配。',
    embedding_failed: '资料文本可用，但语义索引失败。CueUp 仍可尝试关键词匹配。',
    hybrid_threw: '这次语义检索失败，CueUp 已使用关键词匹配。',
    screen_context_scope_blocked: '屏幕上下文因权限被阻止。',
    screen_context_failed: '屏幕上下文不可用。',
    provider_scope_denied: '当前隐私设置阻止了相关上下文发送给服务商。',
    trace_persistence_failed: '本次回答诊断未保存。',
};

const MATERIAL_FAILURE_COPY: Record<string, string> = {
    unsupported_file_type: '暂不支持此格式。请导出为 PDF 或 Markdown 后重新上传。',
    binary_text_file: '这个 TXT 文件像是二进制内容。请上传可读的 TXT、PDF、DOCX 或 Markdown 文件。',
    parse_failed: 'CueUp 无法读取这个文件。请重新导出或上传更干净的副本。',
    empty_document: '没有找到可读取文本。请上传包含可选中文本的文档。',
    embedding_failed: '资料文本已索引，但语义检索失败。CueUp 会尝试降级为关键词匹配。',
};

export function mapTrustReasonToCopy(reason?: string | null): string | null {
    if (!reason) return null;
    return TRUST_REASON_COPY[reason] ?? null;
}

function unique(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

export function buildLatestAnswerTrustExplanation(input: LatestAnswerTrustInput): LatestAnswerTrustExplanation {
    const trace = input.trace ?? {};
    const sourceStatus = trace.sourceStatus ?? {};
    const citations = input.citations ?? trace.citations ?? [];
    const materialCitationCount = citations.filter((citation) => citation.sourceType === 'uploaded_material').length;
    const materialHitCount = Math.max(Number(sourceStatus.uploadedMaterialHitCount ?? 0), materialCitationCount);
    const reasonCodes = unique([
        input.degradedReason ?? '',
        trace.degradedReason ?? '',
        trace.degraded_reason ?? '',
    ]);
    const primaryMessages: string[] = [];
    const sourceLabels: string[] = [];
    const degradedMessages: string[] = [];

    if (trace.contextUsed?.currentTranscript) sourceLabels.push('当前会议');
    if (trace.contextUsed?.shortTermHistory) sourceLabels.push('短期历史');
    if (trace.contextUsed?.businessSystemContext) sourceLabels.push('业务系统');
    if (trace.contextUsed?.screenContext) sourceLabels.push('屏幕');

    if (materialHitCount > 0) {
        sourceLabels.push('上传资料');
        const title = citations.find((citation) => citation.sourceType === 'uploaded_material')?.title;
        primaryMessages.push(title ? `已使用上传资料：${title}。` : `已使用上传资料：${materialHitCount} 条。`);
    } else if (sourceStatus.ragAttempted || reasonCodes.includes('no_relevant_uploaded_material')) {
        primaryMessages.push('没有匹配到相关上传资料。');
    }

    for (const reason of reasonCodes) {
        const copy = mapTrustReasonToCopy(reason);
        if (copy) degradedMessages.push(copy);
    }
    if (sourceStatus.embeddingReady === false && !reasonCodes.includes('embedding_unavailable')) {
        degradedMessages.push(TRUST_REASON_COPY.embedding_unavailable);
        reasonCodes.push('embedding_unavailable');
    }

    return {
        usedUploadedMaterial: materialHitCount > 0,
        materialHitCount,
        citationCount: citations.length,
        primaryMessages: unique(primaryMessages),
        sourceLabels: unique(sourceLabels),
        degradedMessages: unique(degradedMessages),
        reasonCodes: unique(reasonCodes),
        hasValidCitation: citations.some((citation) => Boolean(citation.citationId)),
    };
}

export function explainMaterialStatus(material: MaterialStatusInput): MaterialStatusExplanation {
    const status = material.status;
    if (status === 'complete') {
        return {
            label: '已完成',
            message: '资料已可用于回答。重新索引会基于已提取文本重建索引。',
            severity: 'ok',
            canReindex: true,
            primaryActionLabel: '重新索引',
        };
    }
    if (status === 'queued') {
        return { label: '排队中', message: '资料正在等待索引。', severity: 'info', canReindex: false };
    }
    if (status === 'indexing') {
        return { label: '索引中', message: '资料正在索引。', severity: 'info', canReindex: false };
    }
    if (status === 'deleted') {
        return { label: '已删除', message: '资料已删除，不会再用于回答。', severity: 'info', canReindex: false };
    }
    const code = material.errorCode ?? material.error_code ?? '';
    return {
        label: '索引失败',
        message: MATERIAL_FAILURE_COPY[code] ?? (material.errorMessage ?? material.error_message ?? '资料索引失败。请重新上传新文件。'),
        severity: code === 'embedding_failed' ? 'warning' : 'error',
        canReindex: false,
        primaryActionLabel: '重新上传新文件',
    };
}

export function explainDynamicAction(action: DynamicActionTrustInput): DynamicActionExplanation {
    const gate = action.semanticGate;
    if (!gate) {
        return { message: '基于会议信号触发。', traceComplete: false, severity: 'info' };
    }
    if (gate.decision === 'pass' || gate.decision === 'fast_path') {
        return { message: '已通过语义门控。', traceComplete: true, severity: 'ok' };
    }
    if (gate.decision === 'defer') {
        return { message: '语义证据不足，已暂缓高风险动作。', traceComplete: true, severity: 'warning' };
    }
    return { message: '相似的低置信候选已被拦截。', traceComplete: true, severity: 'info' };
}

export function buildRealtimeDiagnosticsSummary(input: RealtimeDiagnosticsInput): RealtimeDiagnosticsSummary {
    const sampleSize = input.sampleSize ?? input.metrics.shownCount;
    const insufficientData = sampleSize < LOW_SAMPLE_THRESHOLD;
    return {
        source: 'persisted',
        sampleSize,
        insufficientData,
        metrics: { ...input.metrics },
        degradedReasons: { ...(input.degradedReasons ?? {}) },
        sourceStatusCounts: { ...(input.sourceStatusCounts ?? {}) },
        messages: insufficientData ? ['样本不足，暂不展示趋势判断。'] : [],
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
rtk npm run build:electron
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs
```

Expected: all tests in `RealtimeAnswerTrustViewModel.test.mjs` pass.

- [ ] **Step 5: Commit**

```bash
rtk git add shared/realtimeAnswerTrustViewModel.ts electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs
rtk git commit -m "feat: add realtime answer trust view model"
```

---

### Task 2: Persisted Diagnostics IPC

**Files:**
- Modify: `electron/ipcHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Test: `electron/services/__tests__/RealtimeDiagnosticsIpc.contract.test.mjs`

**Interfaces:**
- Consumes from Task 1:
  - `buildRealtimeDiagnosticsSummary(input: RealtimeDiagnosticsInput): RealtimeDiagnosticsSummary`
  - `RealtimeDiagnosticsSummary`
- Produces:
  - IPC channel `quality:get-realtime-diagnostics-summary`
  - Renderer API `window.electronAPI.getRealtimeDiagnosticsSummary(input?: { sinceMs?: number; mode?: string })`

- [ ] **Step 1: Write failing contract test**

Create `electron/services/__tests__/RealtimeDiagnosticsIpc.contract.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('realtime diagnostics summary IPC uses persisted metrics and exposes preload/type APIs', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(ipc, /quality:get-realtime-diagnostics-summary/);
  assert.match(ipc, /DatabaseManager\.getInstance\(\)\.getAnswerQualityMetrics/);
  assert.match(ipc, /buildRealtimeDiagnosticsSummary/);
  assert.doesNotMatch(ipc, /getContextQualityDiagnosticsCollector\(\)\.snapshot\(\)[\s\S]{0,300}quality:get-realtime-diagnostics-summary/);

  assert.match(preload, /getRealtimeDiagnosticsSummary/);
  assert.match(preload, /quality:get-realtime-diagnostics-summary/);

  assert.match(types, /interface RealtimeDiagnosticsSummary/);
  assert.match(types, /getRealtimeDiagnosticsSummary/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/RealtimeDiagnosticsIpc.contract.test.mjs
```

Expected: FAIL because the IPC/preload/type API does not exist yet.

- [ ] **Step 3: Add shared renderer-facing types**

Modify `src/types/electron.d.ts` near `AnswerQualityMetrics`:

```ts
export interface RealtimeDiagnosticsSummary {
  source: 'persisted'
  sampleSize: number
  insufficientData: boolean
  metrics: AnswerQualityMetrics
  degradedReasons: Record<string, number>
  sourceStatusCounts: Record<string, number>
  messages: string[]
}
```

Modify the `ElectronAPI` interface near `getAnswerQualityMetrics`:

```ts
getRealtimeDiagnosticsSummary: (input?: { sinceMs?: number; mode?: string }) => Promise<{ success: boolean; summary?: RealtimeDiagnosticsSummary; error?: string }>
```

- [ ] **Step 4: Expose preload API**

Modify `electron/preload.ts` in the API shape near `getAnswerQualityMetrics`:

```ts
getRealtimeDiagnosticsSummary: (input?: {
  sinceMs?: number;
  mode?: string;
}) => Promise<{ success: boolean; summary?: any; error?: string }>;
```

Modify the exposed API object near `getAnswerQualityMetrics`:

```ts
getRealtimeDiagnosticsSummary: (input?: { sinceMs?: number; mode?: string }) =>
  ipcRenderer.invoke('quality:get-realtime-diagnostics-summary', input),
```

- [ ] **Step 5: Register IPC handler**

Modify `electron/ipcHandlers.ts` imports:

```ts
import { buildRealtimeDiagnosticsSummary } from '../shared/realtimeAnswerTrustViewModel';
```

Add handler immediately after `get-answer-quality-metrics`:

```ts
  safeHandle('quality:get-realtime-diagnostics-summary', async (_, input?: { sinceMs?: number; mode?: string }) => {
    try {
      const metrics = DatabaseManager.getInstance().getAnswerQualityMetrics(input);
      const summary = buildRealtimeDiagnosticsSummary({
        metrics,
        degradedReasons: {},
        sourceStatusCounts: {},
        sampleSize: metrics.shownCount,
      });
      return {
        success: true,
        summary,
      };
    } catch (error: any) {
      console.error('[IPC quality:get-realtime-diagnostics-summary] Error:', error);
      return { success: false, error: error?.message || 'realtime_diagnostics_unavailable' };
    }
  });
```

Note: this handler intentionally uses persisted `DatabaseManager.getAnswerQualityMetrics()` as the product source. Do not replace it with `ContextQualityDiagnosticsCollector.snapshot()`.

- [ ] **Step 6: Run contract test**

Run:

```bash
rtk npm run build:electron
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/RealtimeDiagnosticsIpc.contract.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add electron/ipcHandlers.ts electron/preload.ts src/types/electron.d.ts electron/services/__tests__/RealtimeDiagnosticsIpc.contract.test.mjs
rtk git commit -m "feat: expose realtime diagnostics summary"
```

---

### Task 3: Material Failure And Embedding Copy UX

**Files:**
- Modify: `src/types/electron.d.ts`
- Modify: `src/components/settings/KnowledgeMaterialsSettings.tsx`
- Test: `src/components/__tests__/KnowledgeMaterialsTrustUx.contract.test.mjs`

**Interfaces:**
- Consumes from Task 1:
  - `explainMaterialStatus(material)`
  - `mapTrustReasonToCopy(reason)`
- Produces:
  - Failed material rows show honest "重新上传新文件" guidance.
  - Completed material rows keep reindex affordance.
  - Embedding banners use distinct copy.

- [ ] **Step 1: Write failing source-level contract test**

Create `src/components/__tests__/KnowledgeMaterialsTrustUx.contract.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('knowledge material settings uses trust view model and honest failed-material copy', () => {
  const source = read('src/components/settings/KnowledgeMaterialsSettings.tsx');
  const types = read('src/types/electron.d.ts');

  assert.match(source, /explainMaterialStatus/);
  assert.match(source, /重新上传新文件/);
  assert.match(source, /canReindex/);
  assert.match(source, /primaryActionLabel/);
  assert.match(source, /未配置语义检索/);
  assert.match(source, /语义索引失败/);
  assert.doesNotMatch(source, /title=\{canReindex \? '重新索引' : '仅已完成资料可重新索引'\}/);

  assert.match(types, /error_code\?: string \| null/);
  assert.match(types, /errorCode\?: string \| null/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test src/components/__tests__/KnowledgeMaterialsTrustUx.contract.test.mjs
```

Expected: FAIL because the settings component does not import/use `explainMaterialStatus`.

- [ ] **Step 3: Update material type**

Modify `src/types/electron.d.ts` `KnowledgeMaterial`:

```ts
export interface KnowledgeMaterial {
  id: string
  file_name?: string
  fileName?: string
  title?: string
  mime_or_ext?: string
  status: 'queued' | 'indexing' | 'complete' | 'failed' | 'deleted'
  error_code?: string | null
  errorCode?: string | null
  error_message?: string | null
  errorMessage?: string | null
  created_at?: string
  updated_at?: string
}
```

- [ ] **Step 4: Wire settings component to material explanations**

Modify `src/components/settings/KnowledgeMaterialsSettings.tsx` imports:

```ts
import { explainMaterialStatus } from '../../../shared/realtimeAnswerTrustViewModel';
```

Inside `materials.map`, replace local `canReindex` logic with:

```tsx
const title = material.title || material.file_name || material.fileName || material.id;
const materialStatus = material.status || 'queued';
const explanation = explainMaterialStatus({
  id: material.id,
  title,
  file_name: material.file_name,
  fileName: material.fileName,
  status: materialStatus,
  errorCode: material.errorCode,
  error_code: material.error_code,
  errorMessage: material.errorMessage,
  error_message: material.error_message,
});
const canReindex = explanation.canReindex;
```

Replace the status/error line with:

```tsx
<div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-tertiary">
  <span>{explanation.label}</span>
  <span className={explanation.severity === 'error' ? 'text-red-400' : explanation.severity === 'warning' ? 'text-amber-300' : 'text-text-tertiary'}>
    {explanation.message}
  </span>
</div>
```

Replace the reindex button title and disabled-copy behavior with:

```tsx
<button
  onClick={() => reindexMaterial(material.id)}
  disabled={busy || !canReindex}
  className="p-1.5 rounded-lg border border-border-subtle bg-bg-component hover:bg-bg-elevated text-text-secondary hover:text-text-primary disabled:opacity-60"
  title={canReindex ? '重新索引：基于已提取文本重建索引' : explanation.primaryActionLabel || explanation.message}
>
  <RefreshCw size={13} />
</button>
{!canReindex && explanation.primaryActionLabel === '重新上传新文件' && (
  <span className="text-[11px] text-text-tertiary">重新上传新文件</span>
)}
```

Replace embedding banners with exact distinct copy:

```tsx
{embeddingReady === false && (
  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-100">
    未配置语义检索。CueUp 会对上传资料使用关键词匹配。
  </div>
)}

{embeddingReady === true && materialEmbeddingFailed && (
  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-100">
    部分资料文本可用，但语义索引失败。CueUp 仍可尝试关键词匹配。
  </div>
)}
```

- [ ] **Step 5: Run tests**

Run:

```bash
rtk npx tsc -p tsconfig.json --noEmit
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test src/components/__tests__/KnowledgeMaterialsTrustUx.contract.test.mjs
```

Expected: TypeScript and source-level contract pass.

- [ ] **Step 6: Commit**

```bash
rtk git add src/types/electron.d.ts src/components/settings/KnowledgeMaterialsSettings.tsx src/components/__tests__/KnowledgeMaterialsTrustUx.contract.test.mjs
rtk git commit -m "feat: clarify material trust status"
```

---

### Task 4: Latest Answer Trust Explanation UI

**Files:**
- Modify: `src/components/NativelyInterface.tsx`
- Test: `src/components/__tests__/NativelyInterfaceTrustUx.contract.test.mjs`

**Interfaces:**
- Consumes from Task 1:
  - `buildLatestAnswerTrustExplanation(input)`
- Produces:
  - Latest answer trust area uses the pure mapper.
  - User can see uploaded material used / not matched / embedding fallback messages.

- [ ] **Step 1: Write failing source-level contract test**

Create `src/components/__tests__/NativelyInterfaceTrustUx.contract.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('NativelyInterface renders latest answer trust explanation from view model', () => {
  const source = read('src/components/NativelyInterface.tsx');

  assert.match(source, /buildLatestAnswerTrustExplanation/);
  assert.match(source, /latestAnswerTrustExplanation/);
  assert.match(source, /primaryMessages/);
  assert.match(source, /degradedMessages/);
  assert.match(source, /已使用上传资料|没有匹配到相关上传资料/);
  assert.doesNotMatch(source, /latestSourceStatus\?\.uploadedMaterialHitCount && latestSourceStatus\.uploadedMaterialHitCount > 0[\s\S]{0,80}\? `资料命中/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test src/components/__tests__/NativelyInterfaceTrustUx.contract.test.mjs
```

Expected: FAIL because `NativelyInterface` does not use `buildLatestAnswerTrustExplanation`.

- [ ] **Step 3: Import the mapper**

Modify `src/components/NativelyInterface.tsx` imports:

```ts
import { buildLatestAnswerTrustExplanation } from '../../shared/realtimeAnswerTrustViewModel';
```

- [ ] **Step 4: Build the explanation near current derived trust variables**

In `src/components/NativelyInterface.tsx`, near `latestContextUsed`:

```ts
const latestAnswerTrustExplanation = buildLatestAnswerTrustExplanation({
  trace: latestAnswerTrace,
  citations: latestAnswerCitations,
  degradedReason: latestDegradedReason,
});
const contextLabels = latestAnswerTrustExplanation.sourceLabels;
const contextStatusText = contextLabels.length > 0
  ? `上下文：${contextLabels.join(' / ')}`
  : '上下文：仅使用当前输入';
const materialCitationCount = latestAnswerCitations.filter((c) => c.sourceType === 'uploaded_material').length;
const latestSourceStatus = latestAnswerTrace?.sourceStatus;
```

Replace `confidenceHealthItems` with mapper-backed copy:

```ts
const confidenceHealthItems = [
  ...(latestAnswerTrustExplanation.primaryMessages.length > 0
    ? latestAnswerTrustExplanation.primaryMessages
    : []),
  ...(latestAnswerTrustExplanation.degradedMessages.length > 0
    ? latestAnswerTrustExplanation.degradedMessages
    : []),
  latestSourceStatus?.screenContextStatus === 'available'
    ? '屏幕上下文可用'
    : latestSourceStatus?.screenContextStatus === 'failed'
      ? '屏幕上下文不可用'
      : null,
  sttUserStatus === 'connected' ? '你的 STT 正常' : '你的 STT 异常',
  sttInterviewerStatus === 'connected' ? '对方 STT 正常' : '对方 STT 异常',
].filter(Boolean);
```

Keep the existing `查看引用片段` button. Do not display citation as valid unless `materialCitationCount > 0`.

- [ ] **Step 5: Run tests**

Run:

```bash
rtk npx tsc -p tsconfig.json --noEmit
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test src/components/__tests__/NativelyInterfaceTrustUx.contract.test.mjs
```

Expected: TypeScript and contract pass.

- [ ] **Step 6: Commit**

```bash
rtk git add src/components/NativelyInterface.tsx src/components/__tests__/NativelyInterfaceTrustUx.contract.test.mjs
rtk git commit -m "feat: explain latest answer trust"
```

---

### Task 5: Dynamic Action Explanation UI

**Files:**
- Modify: `src/components/dynamic-actions/DynamicActionCard.tsx`
- Test: `electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs`
- Test: `src/components/__tests__/DynamicActionTrustUx.contract.test.mjs`

**Interfaces:**
- Consumes from Task 1:
  - `explainDynamicAction(action)`
- Consumes existing type:
  - `DynamicActionPayload.semanticGate?: DynamicActionSemanticGate`
- Produces:
  - Dynamic action card displays semantic explanation when safe metadata exists.
  - Generic fallback when it does not.

- [ ] **Step 1: Extend payload contract test**

Modify `electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs` by adding an assertion to the existing semantic gate payload test or adding this test:

```js
test('dynamic action renderer payload exposes semantic gate metadata without evidence text expansion', () => {
  const types = read('src/types/electron.d.ts');
  const card = read('src/components/dynamic-actions/DynamicActionCard.tsx');

  assert.match(types, /semanticGate\?: DynamicActionSemanticGate/);
  assert.match(card, /semanticGate/);
  assert.doesNotMatch(card, /semanticGate[\s\S]{0,200}evidenceRefs\?\.\[0\]\?\.text/);
});
```

- [ ] **Step 2: Add source-level component contract**

Create `src/components/__tests__/DynamicActionTrustUx.contract.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('DynamicActionCard renders trust explanation through view model', () => {
  const source = read('src/components/dynamic-actions/DynamicActionCard.tsx');

  assert.match(source, /explainDynamicAction/);
  assert.match(source, /actionTrustExplanation/);
  assert.match(source, /已通过语义门控|基于会议信号触发/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs src/components/__tests__/DynamicActionTrustUx.contract.test.mjs
```

Expected: new contract fails until component uses `explainDynamicAction`.

- [ ] **Step 4: Wire dynamic action explanation**

Modify `src/components/dynamic-actions/DynamicActionCard.tsx` import:

```ts
import { explainDynamicAction } from '../../../shared/realtimeAnswerTrustViewModel'
```

Inside component after `buttonLabel`:

```ts
const actionTrustExplanation = explainDynamicAction({
  type: action.type,
  semanticGate: action.semanticGate,
})
```

Render below `displayLabel` and before evidence snippet:

```tsx
<span className="text-[10px] text-white/62 truncate">
  {actionTrustExplanation.message}
</span>
```

Do not add new evidence fields and do not expand existing evidence snippet behavior.

- [ ] **Step 5: Run tests**

Run:

```bash
rtk npx tsc -p tsconfig.json --noEmit
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs src/components/__tests__/DynamicActionTrustUx.contract.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/components/dynamic-actions/DynamicActionCard.tsx electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs src/components/__tests__/DynamicActionTrustUx.contract.test.mjs
rtk git commit -m "feat: explain dynamic action trust"
```

---

### Task 6: Quality Coverage And Final Verification

**Files:**
- Modify: `package.json`
- Test: existing and new quality suites

**Interfaces:**
- Consumes tests from Tasks 1-5.
- Produces:
  - New trust UX tests are included in quality commands.

- [ ] **Step 1: Add tests to quality scripts**

Modify `package.json` `test:quality:smoke:no-build` by adding these files to the Electron test command:

```json
"electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs electron/services/__tests__/RealtimeDiagnosticsIpc.contract.test.mjs src/components/__tests__/KnowledgeMaterialsTrustUx.contract.test.mjs src/components/__tests__/NativelyInterfaceTrustUx.contract.test.mjs src/components/__tests__/DynamicActionTrustUx.contract.test.mjs"
```

Keep the command as one script string, matching the existing style.

- [ ] **Step 2: Verify quality changed gate still detects this area**

Run:

```bash
rtk npm run test:quality:changed
```

Expected: output includes `Context quality gate required.` because relevant docs/source/tests changed.

- [ ] **Step 3: Run focused no-build tests after one build**

Run:

```bash
rtk npm run build:electron
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs electron/services/__tests__/RealtimeDiagnosticsIpc.contract.test.mjs src/components/__tests__/KnowledgeMaterialsTrustUx.contract.test.mjs src/components/__tests__/NativelyInterfaceTrustUx.contract.test.mjs src/components/__tests__/DynamicActionTrustUx.contract.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 4: Run required quality commands**

Run:

```bash
rtk npm run typecheck:electron
rtk npx tsc -p tsconfig.json --noEmit
rtk npm run test:quality:smoke:no-build
rtk npm run test:quality:diagnostics:no-build
rtk git diff --check
```

Expected:

- Type checks pass.
- Quality smoke and diagnostics pass.
- Diff check has no whitespace errors.

- [ ] **Step 5: Commit package/test coverage**

```bash
rtk git add package.json
rtk git commit -m "test: include answer trust ux in quality smoke"
```

---

## Self-Review Notes

- Spec coverage:
  - Lightweight diagnostics entry: Task 2 and Task 6.
  - Material-backed answer experience: Task 1 and Task 4.
  - Failed material next steps: Task 1 and Task 3.
  - Embedding degradation copy: Task 1, Task 3, and Task 4.
  - Dynamic action explanations: Task 1 and Task 5.
  - Privacy-safe diagnostics: Task 1 tests and Task 2 contract.
  - Persisted metrics source only: Task 2.
  - Low sample size handling: Task 1.
- Placeholder scan: no unfinished markers and no unbounded "add tests" steps.
- Type consistency:
  - `LatestAnswerTrustExplanation` is produced in Task 1 and consumed in Task 4.
  - `RealtimeDiagnosticsSummary` is produced in Task 1 and exposed in Task 2.
  - `explainMaterialStatus` is produced in Task 1 and consumed in Task 3.
  - `explainDynamicAction` is produced in Task 1 and consumed in Task 5.
