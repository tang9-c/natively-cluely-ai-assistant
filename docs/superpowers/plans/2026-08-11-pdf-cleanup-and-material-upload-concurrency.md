# PDF Cleanup and Material Upload Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve successfully extracted PDF text when parser cleanup fails, and allow new material uploads while previous materials continue background indexing.

**Architecture:** Keep the existing PDF parser, worker path, indexing queue, IPC, and database model. Change PDF cleanup to best-effort after successful extraction with privacy-safe diagnostics, and narrow renderer `busy` state to foreground operations instead of background polling.

**Tech Stack:** Electron, TypeScript, React, Node test runner through Electron, existing source-contract tests.

## Global Constraints

- Work directly on the current branch; do not create a worktree.
- Do not change `pdf-parse`, PDF worker packaging, the 15-second parse timeout, IPC, database schema, or indexing queue concurrency.
- Never log PDF file names, file paths, extracted text, raw error messages, raw error objects, or stacks.
- Keep the upload button disabled during a foreground selection/upload/delete/reindex request, but not during background status polling.
- Do not modify or stage `.tmp/`.

---

### Task 1: Preserve PDF text across cleanup failures

**Files:**

- Modify: `electron/services/__tests__/DocumentTextExtractor.test.mjs`
- Modify: `electron/services/profile/DocumentTextExtractor.ts`

**Interfaces:**

- Consumes: `extractPdfTextWithParser(buffer: Buffer, PDFParse: any): Promise<string>`.
- Produces: the same API, with cleanup failures treated as non-fatal after successful `getText()`.

- [ ] **Step 1: Write failing lifecycle tests**

  Add a parser stub whose `getText()` returns `正文已成功提取` and whose `destroy()` throws `Worker was destroyed during cleanup`. Assert that extraction resolves with the text, creates one parser, and calls destroy once. Add a second stub whose `getText()` throws `Invalid PDF structure` and whose `destroy()` also throws; assert that the original parse error is preserved.

- [ ] **Step 2: Run the focused test and verify RED**

  ```bash
  npm run build:electron
  ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/DocumentTextExtractor.test.mjs
  ```

  Expected: the successful-text test fails with `pdf_worker_failed` because cleanup overrides the result.

- [ ] **Step 3: Implement best-effort cleanup**

  Refactor `parsePdfOnce` so `getText()` determines the returned value or thrown parse error. Always attempt `destroy()` in `finally`, but never throw its error. Add a helper that logs only:

  ```ts
  console.warn('[DocumentTextExtractor] PDF parser cleanup failed', {
    code: 'pdf_cleanup_failed',
    stage: 'cleanup',
    platform: process.platform,
    arch: process.arch,
  });
  ```

  Do not pass the error object or message to the logger.

- [ ] **Step 4: Re-run the PDF tests and verify GREEN**

  Run the command from Step 2. Expected: all `DocumentTextExtractor` tests pass, including the existing transient worker retry test.

### Task 2: Decouple upload submission from index polling

**Files:**

- Modify: `src/components/__tests__/KnowledgeMaterialsTrustUx.contract.test.mjs`
- Modify: `src/components/settings/KnowledgeMaterialsSettings.tsx`

**Interfaces:**

- Consumes: existing `uploadMaterials()` and `startUploadPolling(materialIds)` callbacks.
- Produces: unchanged renderer and IPC interfaces; only foreground operations control `busy`.

- [ ] **Step 1: Write a failing source-contract test**

  Slice the source between `const startUploadPolling` and `const uploadMaterials`, and between `const uploadMaterials` and `const deleteMaterial`. Assert:

  ```js
  assert.doesNotMatch(pollingBlock, /setBusy\(/);
  assert.match(uploadBlock, /finally\s*\{\s*setBusy\(false\);\s*\}/);
  assert.doesNotMatch(uploadBlock, /if\s*\(!pollingRef\.current\)/);
  ```

  Keep the existing assertion that the button uses `disabled={busy}`.

- [ ] **Step 2: Run the focused test and verify RED**

  ```bash
  node --test src/components/__tests__/KnowledgeMaterialsTrustUx.contract.test.mjs
  ```

  Expected: polling still contains `setBusy(false)` and upload finally is conditional.

- [ ] **Step 3: Implement foreground-only busy state**

  Remove `setBusy(false)` from the polling completion branch. Replace the conditional upload `finally` block with:

  ```ts
  } finally {
    setBusy(false);
  }
  ```

  Keep polling interval, maximum attempts, material refresh, button `disabled={busy}`, and all IPC calls unchanged.

- [ ] **Step 4: Re-run the UI contract test and verify GREEN**

  Run the command from Step 2. Expected: all knowledge-material trust UX tests pass.

### Task 3: Regression verification and graph refresh

**Files:**

- Verify all modified files above.
- Update the repository code graph.

**Interfaces:**

- Consumes: Task 1 and Task 2 production changes.
- Produces: verified code and refreshed structural graph.

- [ ] **Step 1: Run focused regressions together**

  ```bash
  npm run build:electron
  ELECTRON_RUN_AS_NODE=1 npx electron --test \
    electron/services/__tests__/DocumentTextExtractor.test.mjs \
    electron/services/__tests__/DocumentTextExtractor.deep.test.mjs \
    electron/services/__tests__/KnowledgeMaterialService.errors.test.mjs
  node --test src/components/__tests__/KnowledgeMaterialsTrustUx.contract.test.mjs
  ```

- [ ] **Step 2: Run type checks**

  ```bash
  npm run typecheck:electron
  npx tsc --noEmit
  ```

- [ ] **Step 3: Run the complete repository test suite**

  ```bash
  npm test
  ```

- [ ] **Step 4: Inspect and refresh**

  Run `git diff --check`, inspect the final diff and status, confirm `.tmp/` is untouched, then fully rebuild the code graph so the new test relationships are indexed.

- [ ] **Step 5: Leave production changes uncommitted unless the user asks for a commit**
