# Task 1 Report: Enrollment Quality Calibration

## Status

DONE_WITH_CONCERNS

## Delivered

- Added enrollment quality types: `SpeakerEnrollmentQualitySummary` and `SpeakerVerificationQualityBand`.
- Added conservative calibration constants and quality calculation over each valid 2s/1s-hop embedding window.
- Rejects unstable enrollment before persistence with `speaker_enrollment_unstable_profile` when minimum self-similarity is below 0.78 or the calibrated threshold, or when similarity standard deviation exceeds 0.12.
- Persists only the embedding plus scalar enrollment quality fields. No raw audio is stored.
- Ensures the saved verification threshold is never below 0.72 and uses the stricter calibrated value when applicable.
- Added v31 -> v32 migration with compatibility guards for the enrollment quality and aggregate quality-stat columns.
- Reads profiles that have no quality data (including legacy schema fallback) without error.
- Added tests for stable enrollment, split-embedding rejection without a profile write, quality persistence, and v32 migration presence.

## Verification

- PASS: `rtk proxy npm run build:electron`
- PASS: `rtk proxy node --test electron/services/__tests__/SpeakerVerificationCore.test.mjs` (5/5)
- BLOCKED BY ENVIRONMENT: `rtk proxy node --test electron/services/__tests__/SpeakerVerificationStore.test.mjs` (3/4 assertions run; `better-sqlite3` was built for NODE_MODULE_VERSION 146 while system Node v24 requires 137).
- PASS: `rtk proxy env ELECTRON_RUN_AS_NODE=1 /Users/tang-codeing/code/natively-cluely-ai-assistant/node_modules/.bin/electron --test electron/services/__tests__/SpeakerVerificationStore.test.mjs` (4/4). This uses the repository's Electron Node runtime, which matches the native `better-sqlite3` ABI.

## Scope Review

- Modified only the six Task 1 source/test files plus this required report.
- Did not change historical meetings, cloud voiceprints, cross-device identity, or authentication behavior.
- No raw audio is persisted.

## Concern

The required system-Node store test command cannot load the prebuilt native dependency because of a local ABI mismatch. The same test passes under the project's Electron runtime.

## Review Fix: Enrollment Quality Schema Alignment

### Fixed

- Replaced the `enrollment_quality_json` persistence approach with six nullable `speaker_profiles` columns: `quality_score`, `quality_band`, `min_self_similarity`, `mean_self_similarity`, `similarity_stddev`, and `calibrated_threshold`.
- `SpeakerProfileStore` now selects, inserts, and updates those columns directly, and reconstructs `quality` only when all six persisted values are valid.
- Kept legacy compatibility: profiles from schemas without the six quality columns load successfully with `quality` unset.
- Reworked migration v31 -> v32 to use `PRAGMA table_info` before each `ALTER TABLE`; there is no broad error swallowing, and `user_version = 32` occurs only after all changes complete.
- Updated store tests to assert all six independent columns rather than JSON persistence.

### Verification

- PASS: `rtk proxy npm run build:electron`
- PASS: `rtk proxy node --test electron/services/__tests__/SpeakerVerificationCore.test.mjs` (5/5)
- EXPECTED ENVIRONMENT FAILURE: `rtk proxy node --test electron/services/__tests__/SpeakerVerificationStore.test.mjs` (static assertions pass; native store tests cannot load `better-sqlite3` because it was built with NODE_MODULE_VERSION 146 while system Node requires 137).
- PASS: `rtk proxy env ELECTRON_RUN_AS_NODE=1 /Users/tang-codeing/code/natively-cluely-ai-assistant/node_modules/.bin/electron --test electron/services/__tests__/SpeakerVerificationStore.test.mjs` (5/5)
