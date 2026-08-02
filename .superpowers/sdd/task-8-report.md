# Task 8 Report: Suppress Short Verification Segments

## Status

Completed.

## Changes

- `measureAudioQuality` accepts an explicit duration purpose. Enrollment uses `minDurationMs`; verification uses `minVerificationDurationMs`.
- `SpeakerEnrollmentService` applies the enrollment duration rule to both submitted samples and its 2-second embedding windows.
- `SpeakerVerificationAnnotator` checks audio quality before invoking `service.verify` and returns no metadata for rejected audio.
- Preflight low-quality skips are recorded once through `SpeakerVerificationService.recordLowQuality`; the service retains its own quality check for direct callers.
- Added core coverage for differing duration thresholds: a 2-second sample is rejected for enrollment at 2.5 seconds but accepted for verification at 1 second.

## Verification

- Passed: `rtk proxy npm run build:electron`
- Passed: `rtk proxy node --test electron/services/__tests__/SpeakerVerificationCore.test.mjs`
- Blocked (environment): `rtk proxy node --test electron/services/__tests__/SpeakerVerificationStore.test.mjs` cannot load `better-sqlite3` because the installed native module uses Node ABI 146 while the active Node runtime requires ABI 137.

## Privacy

No raw audio, transcript, prompt, screenshot, or base64 data is stored or logged.
