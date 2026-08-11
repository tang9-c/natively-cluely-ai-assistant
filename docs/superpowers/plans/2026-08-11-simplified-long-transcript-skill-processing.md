# Simplified Long Transcript Skill Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent QCLOUD transcript-skill requests from timing out on long meeting transcripts while preserving the existing one-call behavior for ordinary meetings.

**Architecture:** Keep the existing synchronous export workflow and IPC contract. Estimate Chinese-heavy input accurately, route transcripts at or below 48,000 estimated tokens through one LLM call, and route larger transcripts through bounded-concurrency map calls followed by one reduce call. Apply the existing 120-second timeout independently to every LLM request.

**Tech Stack:** Electron main process, TypeScript, Node test runner executed through Electron, existing `LLMHelper` and QCLOUD provider options.

## Global Constraints

- Work directly on the current branch; do not create a worktree.
- Do not add a database table, background job, cache, progress IPC, or renderer change.
- Preserve provider routing and data-scope checks already performed by `TranscriptSkillExportService`.
- Never log transcript text, prompts, intermediate summaries, credentials, or provider response bodies.
- Keep all production changes limited to transcript-skill orchestration and explicit QCLOUD option precedence.
- Follow test-driven development: demonstrate each new behavior failing before changing production code.

## Task 1: Lock the limits, token estimator, and line-aware chunking behavior

**Files:**

- Modify: `electron/llm/QCloudLlmConstants.ts`
- Create: `electron/services/__tests__/TranscriptSkillExport.behavior.test.mjs`
- Modify: `electron/services/TranscriptSkillExportService.ts`
- Modify: `electron/services/__tests__/QCloudLlmConstants.test.mjs`

- [ ] Add failing tests for the agreed constants:

  ```ts
  QCLOUD_TRANSCRIPT_SKILL_DIRECT_INPUT_TOKENS = 48_000
  QCLOUD_TRANSCRIPT_SKILL_CHUNK_INPUT_TOKENS = 24_000
  QCLOUD_TRANSCRIPT_SKILL_MAP_OUTPUT_TOKENS = 800
  QCLOUD_TRANSCRIPT_SKILL_OUTPUT_TOKENS = 6_144
  QCLOUD_TRANSCRIPT_SKILL_MAP_CONCURRENCY = 2
  QCLOUD_TRANSCRIPT_SKILL_TIMEOUT_MS = 120_000
  ```

- [ ] Add failing behavior tests that import two production helpers:

  ```ts
  estimateTranscriptSkillTokens(text: string): number
  splitTranscriptForSkill(text: string, maxTokens?: number): string[]
  ```

  Cover these invariants:

  - CJK characters count as one token each; all other Unicode code points contribute one quarter token, rounded up once per string.
  - Empty input estimates to zero and produces no chunks.
  - Chunks reassemble exactly with `chunks.join('') === original`.
  - Normal transcript lines are kept whole when they fit.
  - A single oversized line is hard-split.
  - Every produced chunk is at or below the supplied token limit.

- [ ] Run the new tests and confirm RED because the constants/helpers do not yet exist or have old values:

  ```bash
  npm run build:electron
  ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test \
    electron/services/__tests__/TranscriptSkillExport.behavior.test.mjs \
    electron/services/__tests__/QCloudLlmConstants.test.mjs
  ```

- [ ] Implement the constants and pure helpers. The splitter must greedily append complete lines, including their original newline delimiters, and use an incremental character-weight counter when hard-splitting oversized lines so it remains linear rather than repeatedly rescanning the accumulated string.

- [ ] Re-run the focused tests and confirm GREEN.

## Task 2: Add direct and bounded map/reduce execution paths

**Files:**

- Modify: `electron/services/TranscriptSkillExportService.ts`
- Modify: `electron/services/__tests__/TranscriptSkillExport.behavior.test.mjs`
- Modify: `electron/services/__tests__/TranscriptSkillExport.contract.test.mjs`

- [ ] Add failing tests around an exported orchestration boundary such as:

  ```ts
  generateTranscriptSkillContent({
    transcriptMarkdown,
    activeSkill,
    llmHelper,
  }): Promise<string>
  ```

  The boundary is production code, not a test-only hook. Use a fake `llmHelper.chatWithGemini` and assert:

  - At 48,000 estimated tokens or fewer, exactly one call receives the complete transcript.
  - The direct call uses `maxOutputTokens: 6_144` and `totalTimeoutMs: 120_000`.
  - The direct call does not override `qcloudThinking` or `qcloudReasoningEffort`, preserving active-skill defaults.
  - Above 48,000 tokens, each map call receives exactly one chunk and uses `maxOutputTokens: 800`, disabled thinking, and no explicit reasoning effort.
  - At most two map calls are active simultaneously and output order remains chunk order.
  - The reduce call receives only ordered map outputs, never the original transcript; it uses `maxOutputTokens: 6_144`, enabled thinking, and `qcloudReasoningEffort: 'minimal'`.
  - Each map/reduce/direct call receives a distinct abort signal.
  - If any map call fails, the reduce call is not attempted and the error propagates to the existing export error handling.

- [ ] Update the source-contract test expectations from the old single-call/16,000-token design to the new direct/map/reduce contract.

- [ ] Run the focused tests and confirm RED before implementation:

  ```bash
  npm run build:electron
  ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test \
    electron/services/__tests__/TranscriptSkillExport.behavior.test.mjs \
    electron/services/__tests__/TranscriptSkillExport.contract.test.mjs
  ```

- [ ] Implement one per-request timeout wrapper that creates a fresh `AbortController`, passes its signal and `totalTimeoutMs` to the LLM helper, races that single request against 120 seconds, clears the timer, and aborts only that request on timeout.

- [ ] Implement a small ordered concurrency helper with exactly two workers. Do not use unbounded `Promise.all(chunks.map(...))`.

- [ ] Implement the routing rule:

  ```ts
  estimate <= 48_000 -> direct call
  estimate > 48_000  -> split near 24_000 -> map(concurrency 2) -> reduce
  ```

  Map instructions should ask for compact, skill-relevant findings from the current numbered segment. Reduce instructions should ask for the final skill output from the intermediate findings. Keep the existing active skill attached to every call.

- [ ] Replace the current workflow-wide timeout around the one LLM call with the new orchestration function. Keep validation, data-scope enforcement, fallback-response rejection, Markdown export, and filename behavior unchanged.

- [ ] Re-run the focused tests and confirm GREEN.

## Task 3: Make explicit QCLOUD thinking options override active-skill defaults

**Files:**

- Modify: `electron/LLMHelper.ts`
- Modify: `electron/services/__tests__/QCloudLlmConstants.test.mjs`
- Modify: `electron/services/__tests__/QCloudTimeoutRootCause.test.mjs`

- [ ] Add failing source/behavior assertions for both non-streaming and streaming QCLOUD paths proving option precedence:

  ```ts
  const qcloudThinking = opts.qcloudThinking
    ?? (activeSkill ? { type: 'enabled' } : undefined)
  const qcloudReasoningEffort = opts.qcloudReasoningEffort
    ?? (activeSkill ? 'medium' : undefined)
  ```

  This preserves current defaults while allowing map calls to disable thinking and reduce calls to request minimal reasoning.

- [ ] Run the QCLOUD tests and confirm RED against the current active-skill-first ternaries:

  ```bash
  npm run build:electron
  ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test \
    electron/services/__tests__/QCloudLlmConstants.test.mjs \
    electron/services/__tests__/QCloudTimeoutRootCause.test.mjs
  ```

- [ ] Change only the two duplicated option-resolution sites in `LLMHelper.ts`; do not alter model selection, provider routing, retry policy, or general timeout defaults.

- [ ] Re-run the QCLOUD tests and confirm GREEN.

## Task 4: Full regression verification and graph refresh

**Files:**

- Verify all modified files above.
- Update the project code graph using the repository's available graph refresh command/tool.

- [ ] Run all focused transcript-skill/QCLOUD tests together:

  ```bash
  npm run build:electron
  ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test \
    electron/services/__tests__/TranscriptSkillExport.behavior.test.mjs \
    electron/services/__tests__/TranscriptSkillExport.contract.test.mjs \
    electron/services/__tests__/QCloudLlmConstants.test.mjs \
    electron/services/__tests__/QCloudTimeoutRootCause.test.mjs
  ```

- [ ] Run Electron type checking:

  ```bash
  npm run typecheck:electron
  ```

- [ ] Run the complete repository test suite and report any failure with evidence rather than treating it as unrelated:

  ```bash
  npm test
  ```

- [ ] Inspect `git diff --check`, the final diff, and `git status --short`. Confirm `.tmp/` remains untouched and unstaged.

- [ ] Refresh the code graph, then query the transcript-skill call chain to ensure the graph reflects the new direct/map/reduce path.

- [ ] Do not commit production changes unless the user separately requests a commit.
