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
- Product diagnostics metrics must come from persisted traces/events through `DatabaseManager.getRealtimeDiagnosticsAggregate()`; `ContextQualityDiagnosticsCollector` can only be developer supplement.
- Keep unrelated working-tree changes out of implementation commits. At plan time, `docs/engineering/CONTEXT_SYSTEM_ROADMAP.md` and `docs/engineering/TEST_ALL_BASELINE_REPORT_FOLLOWUP_2026-07-05.md` were separate local changes.
- Treat code snippets below as implementation contracts, not blind paste targets. Before coding, align names and SQL with the current schema and existing helper methods.

---

## File Structure

- Modify: `scripts/build-electron.js`
  - Include `shared/**/*.ts` in the Electron build entrypoints so the pure trust view model is emitted to `dist-electron/shared/...`.
- Create `shared/realtimeAnswerTrustViewModel.ts`
  - Owns `LatestAnswerTrustExplanation`, `RealtimeDiagnosticsSummary`, material status explanation, dynamic action explanation, and reason-code-to-copy mapping.
  - Pure functions only; no Electron, no DB, no IPC.
- Create `electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs`
  - Tests privacy-safe single-answer explanations, aggregate summary sample-size behavior, citation status behavior, material failure copy, embedding degradation copy, and dynamic action fallback copy.
- Modify `electron/db/DatabaseManager.ts`
  - Add persisted realtime diagnostics aggregation for trace-derived source status counts and degraded reason distribution.
- Modify `electron/ipcHandlers.ts`
  - Add `quality:get-realtime-diagnostics-summary`, using persisted `DatabaseManager.getRealtimeDiagnosticsAggregate()`.
- Modify `electron/preload.ts`
  - Expose `getRealtimeDiagnosticsSummary()`.
- Modify `src/types/electron.d.ts`
  - Add shared renderer-facing trust types and `getRealtimeDiagnosticsSummary`.
  - Add `error_code?: string | null` / `errorCode?: string | null` to `KnowledgeMaterial`.
- Modify `src/components/settings/KnowledgeMaterialsSettings.tsx`
  - Use material status explanation helper behavior in UI.
  - Replace misleading failed-material reindex affordance with a real "重新上传新文件" action that opens the upload picker and creates a new material row.
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

### Task 0: Worktree Hygiene

**Files:**
- No code files.

**Purpose:**
- Keep this implementation isolated from existing local work. At plan-review time the workspace already had unrelated changes in `docs/engineering/CONTEXT_SYSTEM_ROADMAP.md` and an untracked `docs/engineering/TEST_ALL_BASELINE_REPORT_FOLLOWUP_2026-07-05.md`.

- [ ] **Step 1: Confirm local state before each task commit**

Run:

```bash
rtk git status --short
```

Expected:

- Do not stage unrelated roadmap/report files unless the user explicitly asks.
- Each task commit stages only the files listed in that task.
- If unrelated files are still present, note them in the task handoff instead of cleaning or reverting them.

---

### Task 1: Trust View Model

**Files:**
- Modify: `scripts/build-electron.js`
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
import fs from 'node:fs';
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
    citationStatus: 'candidate',
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
  assert.equal(explanation.citationStatus, 'candidate');
  assert.ok(explanation.primaryMessages.some((message) => message.includes('已使用上传资料')));
  const serialized = JSON.stringify(explanation);
  assert.doesNotMatch(serialized, /SECRET_TRANSCRIPT_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(serialized, /SECRET_PROMPT_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(serialized, /SECRET_SCREENSHOT/);
  assert.doesNotMatch(serialized, /SECRET_CHUNK_TEXT_SHOULD_NOT_LEAK/);
  assert.doesNotMatch(serialized, /SECRET_ACTION_EVIDENCE_SHOULD_NOT_LEAK/);
});

test('latest answer explanation does not treat unresolved citation candidates as verified sources', async () => {
  const { buildLatestAnswerTrustExplanation } = await loadViewModel();
  const explanation = buildLatestAnswerTrustExplanation({
    trace: {
      contextUsed: { currentTranscript: true, uploadedDocumentRag: true },
      sourceStatus: {
        ragReady: true,
        ragAttempted: true,
        embeddingReady: true,
        uploadedMaterialHitCount: 1,
        citationCount: 1,
        transcriptStatus: 'used',
      },
    },
    citationStatus: 'candidate',
    citations: [{ citationId: 'candidate-only', sourceType: 'uploaded_material', title: 'FAQ' }],
  });

  assert.equal(explanation.usedUploadedMaterial, true);
  assert.equal(explanation.citationStatus, 'candidate');
  assert.equal(explanation.hasCitationCandidate, true);
  assert.equal(explanation.primaryMessages.some((message) => /已确认引用可打开/.test(message)), false);
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

  const deferred = explainDynamicAction({
    type: 'pricing_objection',
    semanticGate: {
      decision: 'defer',
      actionType: 'pricing_objection',
      confidence: 0.42,
      reasons: ['provider_scope_denied'],
      regexCandidates: [],
      rejectedCandidates: [],
      usedLocalIntentModel: false,
      usedCloudArbitration: false,
      semanticProvider: 'unavailable',
      arbitrationStatus: 'local_only_by_privacy',
      upgradedByRepeatedEvidence: false,
    },
  });
  assert.equal(deferred.message, '基于会议信号触发。');
  assert.equal(deferred.traceComplete, false);
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
    sourceStatusCounts: { 'rag.hit': 1, 'citations.present': 1 },
    degradedReasons: { embedding_unavailable: 1 },
    traceSampleSize: 2,
    eventSampleSize: 2,
  });

  assert.equal(summary.source, 'persisted');
  assert.equal(summary.sampleSize, 2);
  assert.equal(summary.traceSampleSize, 2);
  assert.equal(summary.eventSampleSize, 2);
  assert.equal(summary.insufficientData, true);
  assert.ok(summary.messages.some((message) => /样本不足/.test(message)));
});
```

- [ ] **Step 2: Make shared sources buildable, then run test to verify it fails on behavior**

Modify `scripts/build-electron.js` so shared TypeScript files are part of the Electron build entrypoints:

```js
const sharedDir = path.resolve(rootDir, 'shared');
if (fs.existsSync(sharedDir)) {
  entryPoints.push(...findTs(sharedDir).map((file) => path.relative(rootDir, file)));
}
```

Add a source-contract assertion to `RealtimeAnswerTrustViewModel.test.mjs`:

```js
test('electron build emits shared trust view model sources', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const buildScript = fs.readFileSync(path.join(root, 'scripts/build-electron.js'), 'utf8');
  assert.match(buildScript, /const sharedDir = path\.resolve\(rootDir, 'shared'\)/);
  assert.match(buildScript, /entryPoints\.push\(\.\.\.findTs\(sharedDir\)/);
});
```

Run:

```bash
rtk npm run build:electron
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs
```

Expected: build emits `dist-electron/shared/realtimeAnswerTrustViewModel.js`; the new behavioral assertions fail until the view model is implemented.

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

export type CitationStatus = 'candidate' | 'ok' | 'stale-citation' | 'missing-citation' | 'unsupported-citation' | 'none';

export interface LatestAnswerTrustInput {
    trace?: AnswerTraceLike | null;
    citations?: AnswerCitationLike[];
    citationStatus?: CitationStatus;
    citationPreviewMessage?: string | null;
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
    citationStatus: CitationStatus;
    hasCitationCandidate: boolean;
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
    traceSampleSize?: number;
    eventSampleSize?: number;
}

export interface RealtimeDiagnosticsSummary {
    source: 'persisted';
    sampleSize: number;
    traceSampleSize: number;
    eventSampleSize: number;
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
    const citationStatus = input.citationStatus ?? (citations.length > 0 ? 'candidate' : 'none');
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
        citationStatus,
        hasCitationCandidate: citations.some((citation) => Boolean(citation.citationId)),
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
    return { message: '基于会议信号触发。', traceComplete: false, severity: 'info' };
}

export function buildRealtimeDiagnosticsSummary(input: RealtimeDiagnosticsInput): RealtimeDiagnosticsSummary {
    const traceSampleSize = input.traceSampleSize ?? input.metrics.shownCount;
    const eventSampleSize = input.eventSampleSize ?? input.metrics.shownCount;
    const sampleSize = Math.max(traceSampleSize, eventSampleSize);
    const insufficientData = sampleSize < LOW_SAMPLE_THRESHOLD;
    return {
        source: 'persisted',
        sampleSize,
        traceSampleSize,
        eventSampleSize,
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
rtk git add scripts/build-electron.js shared/realtimeAnswerTrustViewModel.ts electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs
rtk git commit -m "feat: add realtime answer trust view model"
```

---

### Task 2: Persisted Diagnostics IPC

**Files:**
- Modify: `electron/db/DatabaseManager.ts`
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
  - DB helper `DatabaseManager.getRealtimeDiagnosticsAggregate(input?: { sinceMs?: number; mode?: string })`
    - Returns persisted answer quality metrics.
    - Returns trace-derived `degradedReasons`, `sourceStatusCounts`, `traceSampleSize`, and `eventSampleSize`.
    - Does not read raw transcript, prompt, screenshot, reference body, material chunk text, or dynamic action evidence text.

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
  const db = read('electron/db/DatabaseManager.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(ipc, /quality:get-realtime-diagnostics-summary/);
  assert.match(ipc, /DatabaseManager\.getInstance\(\)\.getRealtimeDiagnosticsAggregate/);
  assert.match(ipc, /buildRealtimeDiagnosticsSummary/);
  assert.doesNotMatch(ipc, /degradedReasons:\s*\{\}/);
  assert.doesNotMatch(ipc, /sourceStatusCounts:\s*\{\}/);
  assert.doesNotMatch(ipc, /sampleSize:\s*metrics\.shownCount/);
  assert.doesNotMatch(ipc, /getContextQualityDiagnosticsCollector\(\)\.snapshot\(\)[\s\S]{0,300}quality:get-realtime-diagnostics-summary/);

  assert.match(db, /getRealtimeDiagnosticsAggregate/);
  assert.match(db, /traceSampleSize/);
  assert.match(db, /eventSampleSize/);
  assert.match(db, /sourceStatusCounts/);
  assert.match(db, /degradedReasons/);

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
  traceSampleSize: number
  eventSampleSize: number
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

Modify `electron/db/DatabaseManager.ts` by adding a persisted aggregate helper:

```ts
export interface RealtimeDiagnosticsAggregate {
  metrics: AnswerQualityMetrics;
  degradedReasons: Record<string, number>;
  sourceStatusCounts: Record<string, number>;
  traceSampleSize: number;
  eventSampleSize: number;
}

getRealtimeDiagnosticsAggregate(input?: { sinceMs?: number; mode?: string }): RealtimeDiagnosticsAggregate {
  const metrics = this.getAnswerQualityMetrics(input);
  const traces = this.getRecentAnswerContextTraceSummaries(input);
  const degradedReasons: Record<string, number> = {};
  const sourceStatusCounts: Record<string, number> = {};

  for (const trace of traces) {
    countKnownReason(degradedReasons, trace.degradedReason);
    countSourceStatus(sourceStatusCounts, trace.sourceStatus);
  }

  return {
    metrics,
    degradedReasons,
    sourceStatusCounts,
    traceSampleSize: traces.length,
    eventSampleSize: metrics.shownCount,
  };
}
```

Implementation details:

- `getRecentAnswerContextTraceSummaries()` should select only persisted trace metadata columns and JSON summaries already used for answer trace UI.
- Do not select or parse raw transcript, prompt, screenshot, reference file body, material chunk text, or dynamic action evidence text.
- `sourceStatusCounts` must use explicit dotted keys so dashboards and tests stay stable:
  - `rag.hit`, `rag.miss`, `rag.failed`, `rag.not_attempted`
  - `embedding.ready`, `embedding.unavailable`, `embedding.failed`
  - `screen.available`, `screen.failed`, `screen.blocked`, `screen.not_used`
  - `business_system.available`, `business_system.no_result`, `business_system.auth_failed`, `business_system.timeout`, `business_system.unavailable`, `business_system.error`, `business_system.not_used`
  - `citations.present`, `citations.missing`
- `degradedReasons` must count only known reason codes. Unknown codes can be grouped under `unknown_degraded_reason`; they must not leak raw error text.

Modify `electron/ipcHandlers.ts` imports:

```ts
import { buildRealtimeDiagnosticsSummary } from '../shared/realtimeAnswerTrustViewModel';
```

Add handler immediately after `get-answer-quality-metrics`:

```ts
  safeHandle('quality:get-realtime-diagnostics-summary', async (_, input?: { sinceMs?: number; mode?: string }) => {
    try {
      const aggregate = DatabaseManager.getInstance().getRealtimeDiagnosticsAggregate(input);
      const summary = buildRealtimeDiagnosticsSummary(aggregate);
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

Note: this handler intentionally uses persisted `DatabaseManager.getRealtimeDiagnosticsAggregate()` as the product source. Do not replace it with `ContextQualityDiagnosticsCollector.snapshot()` or empty placeholder objects.

- [ ] **Step 6: Run contract test**

Run:

```bash
rtk npm run build:electron
rtk ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/RealtimeDiagnosticsIpc.contract.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add electron/db/DatabaseManager.ts electron/ipcHandlers.ts electron/preload.ts src/types/electron.d.ts electron/services/__tests__/RealtimeDiagnosticsIpc.contract.test.mjs
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
  - Failed material rows show honest "重新上传新文件" action.
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
  assert.match(source, /onClick=\{uploadMaterials\}/);
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
  <button
    type="button"
    onClick={uploadMaterials}
    disabled={busy}
    className="text-[11px] text-accent-primary hover:underline disabled:opacity-60"
  >
    重新上传新文件
  </button>
)}
```

This action must open the existing file picker and create a new material record. It must not imply the failed row can become successful without a replacement upload, because the current implementation does not persist a reusable raw file copy for failed materials.

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
  - Citation preview result feeds back into the explanation as `ok`, `stale-citation`, `missing-citation`, or `unsupported-citation`.
  - Existing RAG, embedding, STT, screen, and speaker health items are preserved.

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
  assert.match(source, /latestCitationStatus/);
  assert.match(source, /baseConfidenceHealthItems/);
  assert.match(source, /latestAnswerTrustExplanation\.primaryMessages/);
  assert.match(source, /latestAnswerTrustExplanation\.degradedMessages/);
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
const [latestCitationStatus, setLatestCitationStatus] = useState<'candidate' | 'ok' | 'stale-citation' | 'missing-citation' | 'unsupported-citation' | 'none'>('none');

const latestAnswerTrustExplanation = buildLatestAnswerTrustExplanation({
  trace: latestAnswerTrace,
  citations: latestAnswerCitations,
  citationStatus: latestCitationStatus,
  degradedReason: latestDegradedReason,
});
const contextLabels = latestAnswerTrustExplanation.sourceLabels;
const contextStatusText = contextLabels.length > 0
  ? `上下文：${contextLabels.join(' / ')}`
  : '上下文：仅使用当前输入';
const materialCitationCount = latestAnswerCitations.filter((c) => c.sourceType === 'uploaded_material').length;
const latestSourceStatus = latestAnswerTrace?.sourceStatus;
```

When a new answer arrives or `latestAnswerCitations` changes, reset `latestCitationStatus` to `candidate` if a citation candidate exists, otherwise `none`. In `handleOpenLatestCitation`, set it from the resolver result:

```ts
if (result?.status === 'ok') setLatestCitationStatus('ok');
else if (result?.status === 'stale-citation') setLatestCitationStatus('stale-citation');
else if (result?.status === 'missing-citation') setLatestCitationStatus('missing-citation');
else if (result?.status === 'unsupported-citation') setLatestCitationStatus('unsupported-citation');
```

Do not call a citation valid before resolver status is `ok`.

Replace `confidenceHealthItems` with mapper-backed copy while preserving the existing base items:

```ts
const baseConfidenceHealthItems = [
  latestSourceStatus?.ragReady === true ? '资料检索可用' : null,
  latestSourceStatus?.embeddingReady === true ? '语义检索可用' : latestSourceStatus?.embeddingReady === false ? '关键词检索降级' : null,
  latestSourceStatus?.screenContextStatus === 'available'
    ? '屏幕上下文可用'
    : latestSourceStatus?.screenContextStatus === 'failed'
      ? '屏幕上下文不可用'
      : null,
  sttUserStatus === 'connected' ? '你的 STT 正常' : '你的 STT 异常',
  sttInterviewerStatus === 'connected' ? '对方 STT 正常' : '对方 STT 异常',
].filter(Boolean);

const confidenceHealthItems = [
  ...latestAnswerTrustExplanation.primaryMessages,
  ...baseConfidenceHealthItems,
  ...latestAnswerTrustExplanation.degradedMessages,
].filter(Boolean);
```

Keep the existing `查看引用片段` button. Candidate citations may show the preview affordance, but the explanation can only say a citation is confirmed after the resolver returns `ok`. If the resolver returns stale/missing/unsupported, show the mapper's degraded copy instead of silently keeping the old optimistic state.

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
  - Dynamic action card displays semantic explanation only for actions that actually passed and rendered.
  - Generic fallback when it does not.
  - Reject/defer semantic gate traces remain diagnostics-only and must not introduce user-facing card copy, because rejected/deferred candidates do not enter the action store.

- [ ] **Step 1: Extend payload contract test**

Modify `electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs` by adding an assertion to the existing semantic gate payload test or adding this test:

```js
test('dynamic action renderer payload exposes semantic gate metadata without evidence text expansion', () => {
  const types = read('src/types/electron.d.ts');
  const card = read('src/components/dynamic-actions/DynamicActionCard.tsx');

  assert.match(types, /semanticGate\?: DynamicActionSemanticGate/);
  assert.match(card, /semanticGate/);
  assert.match(card, /explainDynamicAction\(\{\s*type: action\.type,\s*semanticGate: action\.semanticGate/);
  assert.doesNotMatch(card, /semanticGate[\s\S]{0,200}evidenceRefs\?\.\[0\]\?\.text/);
  assert.doesNotMatch(card, /语义证据不足，已暂缓高风险动作|相似的低置信候选已被拦截/);
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
  assert.match(source, /actionTrustExplanation\.message/);
  assert.doesNotMatch(source, /语义证据不足，已暂缓高风险动作|相似的低置信候选已被拦截/);
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
rtk npm run build
rtk npm run test:quality:smoke:no-build
rtk npm run test:quality:diagnostics:no-build
rtk git diff --check
```

Expected:

- Type checks pass.
- Renderer and Electron builds both pass with direct `shared/*` imports.
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
