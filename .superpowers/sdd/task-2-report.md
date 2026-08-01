# Task 2: Speaker Verification Runtime Health and Failure Visibility

## Status

Completed in `codex-speaker-verification-reliability`.

## Implementation

- `SpeakerVerificationAnnotator` now always delegates local-mode audio to `SpeakerVerificationService`. The service remains the single quality gate, so `low_quality` skips update the privacy-safe status counters while avoiding embedding extraction.
- `SherpaSpeakerEmbeddingExtractor` records only a process-local, sanitized initialization-failure flag. The read-only health helper still performs no extraction; with an existing model file and a failed extractor construction it reports `model_error` instead of `ready`.
- Existing status aggregation exposes low-quality skips, low-confidence rejections, and errors through the persisted verification statistics. No raw audio, transcript, prompt, screenshot, base64 payload, or exception details are stored or surfaced.

## Focused Tests

- Added an end-to-end in-process annotator -> service -> store test proving low-quality audio increments `lowQualitySkips` without invoking extraction.
- Added an extractor construction failure test with a present model path and unavailable extractor module. It proves health changes from file-ready to `model_error` and does not submit audio for extraction.

## Verification

- `rtk proxy npm run build:electron` - passed.
- `rtk proxy node --test electron/services/__tests__/SpeakerVerificationIpcSettings.test.mjs` - passed, 4 tests.
- `rtk proxy node --test src/components/__tests__/SpeakerVerificationSettings.test.mjs` - passed, 9 tests.
- `rtk proxy env ELECTRON_RUN_AS_NODE=1 /Users/tang-codeing/code/natively-cluely-ai-assistant/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --test electron/services/__tests__/SpeakerVerificationStore.test.mjs` - passed, 9 tests; Electron Node is required because `better-sqlite3` is built for Electron ABI.

## Concerns

- The initialization-failure indicator is process-local by design. Restarting the app clears it; the next constructor attempt determines the new runtime state.
