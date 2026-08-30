import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();

function readWorkflow() {
  const path = join(repoRoot, '.github', 'workflows', 'release-publish.yml');
  if (!existsSync(path)) {
    throw new Error(`Expected workflow file to exist at ${path}`);
  }
  return readFileSync(path, 'utf8');
}

test('release-publish workflow exists and is well-formed', () => {
  const wf = readWorkflow();
  const template = readFileSync(join(repoRoot, '.github', 'RELEASE_TEMPLATE.md'), 'utf8');

  assert.match(wf, /^name:\s*Release Publish$/m, 'workflow must declare name "Release Publish"');

  // Trigger: workflow_run listening to the three build workflows.
  assert.match(wf, /on:\s*\n\s*workflow_run:/m, 'workflow must trigger on workflow_run');
  assert.match(wf, /\bworkflows:\s*\n(?:\s+-\s+[^\n]+\n)+/m);
  assert.match(wf, /^\s*-\s+Build Intel Mac\s*$/m);
  assert.match(wf, /^\s*-\s+Build ARM64 Mac\s*$/m);
  assert.match(wf, /^\s*-\s+Build Windows x64\s*$/m);
  assert.match(wf, /types:\s*\n\s*-\s*completed/m);

  // Permissions required to create releases and query workflow runs.
  assert.match(wf, /contents:\s*write/);
  assert.match(wf, /actions:\s*read/);
  assert.match(template, /## 发布摘要/);
  assert.match(template, /## 新增功能/);
  assert.match(template, /## 改进/);
  assert.match(template, /## 修复/);
  assert.match(template, /## 技术变更/);
});

test('release-publish workflow aggregates builds per commit SHA and creates a draft', () => {
  const wf = readWorkflow();

  // Concurrency group must be keyed on the head SHA so concurrent builds converge.
  assert.match(
    wf,
    /concurrency:\s*\n\s*group:\s*release-publish-\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/m,
    'concurrency group must be keyed on the triggering commit SHA'
  );
  assert.match(
    wf,
    /cancel-in-progress:\s*false/,
    'cancel-in-progress must be false so all sibling builds can finish'
  );

  // Tag derivation must use package.json version + short SHA, format v<X>-sha-<7>.
  assert.match(wf, /require\(['"]\.\/package\.json['"]\)/);
  assert.match(wf, /\$\{HEAD_SHA::7\}/);
  assert.match(wf, /TAG="v\$\{VERSION\}-sha-\$\{SHA_SHORT\}"/);

  // Polling step must wait for all sibling builds before downloading.
  assert.match(wf, /Wait for all expected builds to settle/);
  assert.match(
    wf,
    /actions\/workflows\/\$\{wf_id\}\/runs\?head_sha=\$\{HEAD_SHA\}&per_page=1/
  );

  // Must cache workflow IDs to disk so iterations don't re-resolve.
  assert.match(wf, /\/tmp\/wf_ids\.json/);

  // Must download artifacts by workflow display name and prefix.
  assert.match(wf, /gh run download/);
  assert.match(wf, /cueup-intel-mac-/);
  assert.match(wf, /cueup-arm64-mac-/);
  assert.match(wf, /cueup-windows-x64-/);

  // Must skip when a build did not succeed.
  assert.match(wf, /Skip when triggering build did not succeed/);

  // A release may initially contain only the first architecture to finish.
  // Later runs must still upload newly available architectures instead of
  // treating any existing asset as proof that the release is complete.
  assert.doesNotMatch(wf, /existing_assets/);
  assert.doesNotMatch(wf, /steps\.existing\.outputs\.exists/);

  // Must publish a DRAFT release via softprops/action-gh-release.
  assert.match(wf, /softprops\/action-gh-release@v2/);
  assert.match(wf, /draft:\s*true/);
  assert.match(wf, /overwrite_files:\s*true/);
  assert.match(wf, /tag_name:\s*\$\{\{\s*steps\.tag\.outputs\.tag\s*\}\}/);
  assert.match(wf, /HEAD_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}[\s\S]*REPO: \$\{\{ github\.repository \}\}/);
  assert.match(wf, /https:\/\/github\.com\/\$\{REPO\}\/commit\/\$\{HEAD_SHA\}/);

  // Must upload the canonical release artifacts.
  for (const pattern of [
    'artifacts/Build-Intel-Mac/cueup-intel-mac-*/*.zip',
    'artifacts/Build-Intel-Mac/cueup-intel-mac-*/*.dmg',
    'artifacts/Build-Intel-Mac/cueup-intel-mac-*/OPEN-UNSIGNED-CUEUP-MAC.sh',
    'artifacts/Build-ARM64-Mac/cueup-arm64-mac-*/*arm64*.zip',
    'artifacts/Build-ARM64-Mac/cueup-arm64-mac-*/*arm64*.dmg',
    'artifacts/Build-Windows-x64/cueup-windows-x64-*/*.exe',
    'artifacts/Build-Windows-x64/cueup-windows-x64-*/latest.yml',
  ]) {
    assert.ok(wf.includes(pattern), `Expected release upload to include pattern: ${pattern}`);
  }

  // Fail-on-unmatched must be off: a missing architecture should still produce
  // a partial release rather than failing the whole publish.
  assert.match(wf, /fail_on_unmatched_files:\s*false/);
});

test('release-publish upload globs match gh run download artifact directories', () => {
  // Regression guard: `gh run download --dir artifacts/Build-Windows-x64
  // --pattern cueup-windows-x64-*` extracts files under an artifact-name
  // directory, for example:
  // artifacts/Build-Windows-x64/cueup-windows-x64-29580681109/CueUp-Setup-2.7.0.exe
  //
  // The workflow used to upload artifacts/Build-Windows-x64/release/*.exe,
  // which matched nothing and created an empty draft release.
  const wf = readWorkflow();

  assert.ok(
    wf.includes('artifacts/Build-Windows-x64/cueup-windows-x64-*/*.exe'),
    'Windows release upload must match the artifact-name directory created by gh run download',
  );
  assert.ok(
    wf.includes('artifacts/Build-Intel-Mac/cueup-intel-mac-*/*.dmg'),
    'Intel Mac release upload must match the artifact-name directory created by gh run download',
  );
  assert.ok(
    wf.includes('artifacts/Build-ARM64-Mac/cueup-arm64-mac-*/*arm64*.dmg'),
    'ARM64 Mac release upload must match the artifact-name directory created by gh run download',
  );

  const staleReleaseSubdirGlobs = wf.match(/artifacts\/Build-[^\n]+\/release\/[^\n]+/g) || [];
  assert.deepEqual(
    staleReleaseSubdirGlobs,
    [],
    `release upload globs must not target stale release/ subdirectories: ${staleReleaseSubdirGlobs.join(', ')}`,
  );
});

test('release-publish workflow avoids the steps.outputs.* subshell bug', () => {
  // Regression guard: GitHub Actions does not support a `*` wildcard in
  // `${{ steps.X.outputs.* }}` — it renders as the literal string "Array" and
  // any writes to $GITHUB_OUTPUT from a pipeline (while read) subshell are lost.
  // The workflow must therefore iterate on-disk JSON files via process
  // substitution instead of relying on step outputs.
  const wf = readWorkflow();

  assert.ok(
    !wf.includes('${{ steps.workflows.outputs.*'),
    'workflow must not use ${{ steps.X.outputs.* }} (no wildcard support; was rendered as literal "Array")',
  );

  // The polling loop and the discover loop must iterate via process substitution,
  // not a pipeline (which spawns a subshell that loses $GITHUB_OUTPUT writes).
  assert.match(
    wf,
    /while IFS= read -r row[\s\S]*?done < <\(jq -c '\.\[\]' \/tmp\/wf_ids\.json\)/,
    'polling step must use process substitution to iterate /tmp/wf_ids.json',
  );

  // No step should write to $GITHUB_OUTPUT from inside a pipeline (`| while read`).
  // The fix is to write to /tmp/*.json files instead.
  const subshellOutputWrites = wf.match(/[^|]\s*\|\s*while[\s\S]{0,200}>>\s*"\$GITHUB_OUTPUT"/g) || [];
  assert.equal(
    subshellOutputWrites.length,
    0,
    `no step should write to $GITHUB_OUTPUT from a pipeline (subshell); offenders: ${subshellOutputWrites.join(' | ')}`,
  );
});

test('release-publish workflow indexes /tmp/builds.json by .builds[]', () => {
  // /tmp/builds.json is written as {"builds":[{name,run_id,artifact_prefix},...]}.
  // A naive `jq '.[]'` iterates over the top-level object's keys (a single
  // array value) and tries to index that array with .name/.run_id, producing
  // `jq: error: Cannot index array with string "name"`. Every READ of
  // /tmp/builds.json must therefore use `.builds[]` (or `.builds | length`).
  // The WRITE line `jq -n '{builds: []}' > /tmp/builds.json` is exempt — it
  // creates the file and does not read it.
  const wf = readWorkflow();

  // Match reads only: `jq ... /tmp/builds.json` where the file is the final
  // argument (not redirected-to). The redirect-to form starts with `>`.
  const readCalls = wf.match(/jq[^\n>]*\/tmp\/builds\.json/g) || [];
  assert.ok(readCalls.length >= 3, `expected at least 3 reads of /tmp/builds.json, found ${readCalls.length}: ${readCalls.join(' | ')}`);

  for (const call of readCalls) {
    assert.ok(
      /\.builds\b/.test(call),
      `read of /tmp/builds.json must reference .builds (offender: ${call})`,
    );
  }

  // Spot-check the specific failure modes we have already seen in production.
  assert.match(wf, /jq -c '\.builds\[\]' \/tmp\/builds\.json/, 'download step must iterate .builds[]');
  assert.match(wf, /jq -r '\.builds\[\]\.name' \/tmp\/builds\.json/, 'compose step must list .builds[].name');
});

test('release-publish polling treats "no runs at SHA" as "skip", not "wait"', () => {
  // Regression guard: when release-publish is triggered by Windows x64 but
  // the user never ran Intel/ARM64 Mac at this SHA, the API returns
  // status=null for those workflows. The polling loop used to treat null as
  // "still running" and block for the full 15-minute job timeout, producing
  // `Error: The operation was canceled`. It must instead publish whatever
  // is available and skip architectures that were never built.
  const wf = readWorkflow();

  // The polling step must explicitly check for the null/empty case before
  // the `status != "completed"` branch. We check for the three key tokens
  // that prove the guard exists, rather than a brittle single regex that
  // breaks when shell whitespace shifts.
  assert.ok(
    wf.includes('"${status}" = "null"'),
    'polling step must compare status against the literal string "null"',
  );
  assert.ok(
    wf.includes('-z "${status}"'),
    'polling step must also defend against an empty status string',
  );
  assert.match(
    wf,
    /elif \[\s*"\${status}" = "completed" \]/,
    'polling step must branch on status="completed" as a distinct case',
  );

  // The wording around "no runs" / "publishing whatever is available" must be
  // present so users can read the run log and understand why a subset was published.
  assert.match(
    wf,
    /No runs exist for some architectures at this SHA; publishing whatever is available/,
    'polling step must log a human-readable explanation when some architectures are missing',
  );
});

test('release-publish workflow does not modify the per-arch build workflows', () => {
  const wf = readWorkflow();

  // Must not change build-* workflow files — those are protected by their own tests.
  for (const forbidden of [
    'build-intel-mac.yml',
    'build-arm64-mac.yml',
    'build-windows-x64.yml',
  ]) {
    assert.ok(
      !wf.includes(forbidden),
      `release-publish.yml must not reference ${forbidden}; build workflows are owned by MacX64NativeSmoke and WindowsX64BuildWorkflow tests`
    );
  }

  // Must keep electron-builder in --publish never mode across the board.
  for (const forbidden of [
    '--publish always',
    '--publish onTagOrDraft',
  ]) {
    assert.ok(!wf.includes(forbidden), `release-publish.yml must not switch to ${forbidden}`);
  }
});
