# Release Asset Upload Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicate GitHub Release asset basenames and serialize uploads so rerunning the draft release workflow cannot fail on stale asset IDs.

**Architecture:** Keep the existing single `softprops/action-gh-release` step. Make its input list unique by publishing shared macOS helper files only from the Intel artifact and excluding internal size reports, then enable the action's built-in sequential upload mode.

**Tech Stack:** GitHub Actions YAML, Node.js built-in test runner, regular-expression workflow contract tests.

## Global Constraints

- Do not modify platform build outputs.
- Do not add staging, copy, rename, retry, or deduplication scripts.
- Keep `draft: true`, `overwrite_files: true`, existing artifact names, and existing installer/update globs.
- Do not publish any `size-report.txt` file as a GitHub Release asset.
- Publish `OPEN-UNSIGNED-CUEUP-MAC.sh` and `INSTALL-UNSIGNED-MACOS.txt` exactly once, from the Intel macOS artifact.
- Set `preserve_order: true` on the Release Action.
- Leave unrelated `.tmp/` and `design-qa.md` files untouched.

---

### Task 1: Make the Release upload batch unique and sequential

**Files:**
- Modify: `scripts/__tests__/ReleasePublishWorkflow.test.mjs`
- Modify: `.github/workflows/release-publish.yml`

**Interfaces:**
- Consumes: the existing `readWorkflow(): string` test helper and `softprops/action-gh-release@v2` workflow step.
- Produces: a workflow contract in which shared helper assets occur once, size reports are absent, and uploads are sequential.

- [ ] **Step 1: Write the failing workflow contract test**

Append this test to `scripts/__tests__/ReleasePublishWorkflow.test.mjs`:

```js
test('release-publish uploads a unique asset batch sequentially', () => {
  const wf = readWorkflow();

  assert.match(wf, /preserve_order:\s*true/);
  assert.doesNotMatch(wf, /size-report\.txt/);
  assert.equal(
    (wf.match(/OPEN-UNSIGNED-CUEUP-MAC\.sh/g) || []).length,
    1,
    'shared macOS launcher must be uploaded exactly once',
  );
  assert.equal(
    (wf.match(/INSTALL-UNSIGNED-MACOS\.txt/g) || []).length,
    1,
    'shared macOS instructions must be uploaded exactly once',
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
rtk node --test scripts/__tests__/ReleasePublishWorkflow.test.mjs
```

Expected: FAIL in `release-publish uploads a unique asset batch sequentially` because `preserve_order: true` is absent, `size-report.txt` occurs three times, and both shared macOS files occur twice.

- [ ] **Step 3: Apply the minimal workflow fix**

In `.github/workflows/release-publish.yml`, add sequential upload beside the existing overwrite option:

```yaml
          overwrite_files: true
          preserve_order: true
```

Keep these Intel shared-file entries:

```yaml
            artifacts/Build-Intel-Mac/cueup-intel-mac-*/OPEN-UNSIGNED-CUEUP-MAC.sh
            artifacts/Build-Intel-Mac/cueup-intel-mac-*/INSTALL-UNSIGNED-MACOS.txt
```

Delete all three `size-report.txt` entries and delete the ARM64 duplicates:

```yaml
            artifacts/Build-ARM64-Mac/cueup-arm64-mac-*/OPEN-UNSIGNED-CUEUP-MAC.sh
            artifacts/Build-ARM64-Mac/cueup-arm64-mac-*/INSTALL-UNSIGNED-MACOS.txt
```

Do not change the `.zip`, `.dmg`, `.blockmap`, `.exe`, or `latest.yml` entries.

- [ ] **Step 4: Run focused and adjacent release tests and verify GREEN**

Run:

```bash
rtk node --test scripts/__tests__/ReleasePublishWorkflow.test.mjs scripts/__tests__/PackagedReleaseAcceptance.test.mjs
```

Expected: all tests PASS with zero failures.

- [ ] **Step 5: Verify the diff and commit**

Run:

```bash
rtk git diff --check
rtk git diff -- .github/workflows/release-publish.yml scripts/__tests__/ReleasePublishWorkflow.test.mjs
rtk git add .github/workflows/release-publish.yml scripts/__tests__/ReleasePublishWorkflow.test.mjs
rtk git commit -m "fix(release): avoid duplicate asset upload races"
```

Expected: the commit contains only the workflow and its contract test; unrelated untracked files remain untouched.
