# Cross-Platform Audio Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accurately detect native audio ring-buffer overflow on macOS and Windows, emit privacy-safe logs with the agreed verbosity boundary, and lock the current SenseVoice audio contract with automated tests.

**Architecture:** A small Rust `AudioDropStats` primitive records failed ring-buffer writes using atomics without logging from real-time callbacks. Native microphone and system-audio captures expose cumulative snapshots through optional NAPI methods; a focused Electron monitor converts snapshots and chunk cadence into always-on overflow warnings and verbose-only summaries. Source-contract tests cover platform-specific backends that cannot all be compiled on one host.

**Tech Stack:** Rust, napi-rs, ringbuf, Electron main process, TypeScript, Node test runner.

## Global Constraints

- Do not change existing ring-buffer capacities.
- Do not change sample rates, DSP frame length, batching, VAD thresholds, hangover, or minimum speech duration.
- Do not add database fields, telemetry upload, dependencies, or UI.
- Never log PCM, Base64, device identifiers, transcripts, prompts, or credentials.
- Emit a normal warning only when newly dropped samples are greater than zero.
- Emit full audio summaries only when detailed logging is enabled.
- Missing native diagnostics methods must remain backward-compatible and must not block meeting start.
- Preserve the existing untracked `.tmp/` directory.

---

### Task 1: Real-time-safe native drop counter

**Files:**
- Create: `native-module/src/audio_drop_stats.rs`
- Modify: `native-module/src/lib.rs`

**Interfaces:**
- Produces: `AudioDropStats::record_write(requested: usize, written: usize)`.
- Produces: `AudioDropStats::snapshot() -> AudioDropSnapshot`.
- Produces: `AudioDropStats::reset()`.

- [ ] **Step 1: Write failing Rust unit tests**

Create the module with tests specifying the API before adding the implementation:

```rust
#[cfg(test)]
mod tests {
    use super::AudioDropStats;

    #[test]
    fn records_only_unwritten_samples() {
        let stats = AudioDropStats::default();
        stats.record_write(960, 700);
        stats.record_write(320, 320);
        let snapshot = stats.snapshot();
        assert_eq!(snapshot.dropped_samples, 260);
        assert_eq!(snapshot.drop_events, 1);
    }

    #[test]
    fn reset_starts_a_new_capture_session() {
        let stats = AudioDropStats::default();
        stats.record_write(320, 0);
        stats.reset();
        assert_eq!(stats.snapshot().dropped_samples, 0);
        assert_eq!(stats.snapshot().drop_events, 0);
    }
}
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
cd native-module && cargo test audio_drop_stats
```

Expected: compilation fails because `AudioDropStats` is not defined.

- [ ] **Step 3: Implement the minimal atomic counter**

Implement:

```rust
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AudioDropSnapshot {
    pub dropped_samples: u64,
    pub drop_events: u64,
}

#[derive(Debug, Default)]
pub struct AudioDropStats {
    dropped_samples: AtomicU64,
    drop_events: AtomicU64,
}

impl AudioDropStats {
    pub fn record_write(&self, requested: usize, written: usize) {
        let dropped = requested.saturating_sub(written) as u64;
        if dropped == 0 { return; }
        let _ = self.dropped_samples.fetch_update(
            Ordering::Relaxed,
            Ordering::Relaxed,
            |value| Some(value.saturating_add(dropped)),
        );
        let _ = self.drop_events.fetch_update(
            Ordering::Relaxed,
            Ordering::Relaxed,
            |value| Some(value.saturating_add(1)),
        );
    }

    pub fn snapshot(&self) -> AudioDropSnapshot {
        AudioDropSnapshot {
            dropped_samples: self.dropped_samples.load(Ordering::Relaxed),
            drop_events: self.drop_events.load(Ordering::Relaxed),
        }
    }

    pub fn reset(&self) {
        self.dropped_samples.store(0, Ordering::Relaxed);
        self.drop_events.store(0, Ordering::Relaxed);
    }
}
```

Register `mod audio_drop_stats;` in `native-module/src/lib.rs`.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `cd native-module && cargo test audio_drop_stats`

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add native-module/src/audio_drop_stats.rs native-module/src/lib.rs
git commit -m "feat: add native audio drop counter"
```

---

### Task 2: Count dropped samples in every native producer

**Files:**
- Modify: `native-module/src/microphone.rs`
- Modify: `native-module/src/speaker/core_audio.rs`
- Modify: `native-module/src/speaker/sck.rs`
- Modify: `native-module/src/speaker/windows.rs`
- Modify: `native-module/src/speaker/macos.rs`
- Modify: `native-module/src/speaker/mod.rs`
- Modify: `native-module/src/lib.rs`
- Create: `electron/services/__tests__/NativeAudioDropAccounting.contract.test.mjs`

**Interfaces:**
- Consumes: `Arc<AudioDropStats>` from Task 1.
- Produces optional NAPI methods on both capture classes:
  `getBufferDiagnostics(): { droppedSamples: number; dropEvents: number }`.
- Existing binaries without the method remain supported by Electron.

- [ ] **Step 1: Write failing cross-platform source-contract tests**

Create a Node test that reads each backend source and requires real return-value accounting:

```js
test('every native audio producer records unwritten ring-buffer samples', () => {
  for (const file of [
    'native-module/src/microphone.rs',
    'native-module/src/speaker/core_audio.rs',
    'native-module/src/speaker/sck.rs',
    'native-module/src/speaker/windows.rs',
  ]) {
    const source = read(file);
    assert.match(source, /record_write\(/, `${file} must account for partial writes`);
  }
});

test('both NAPI capture classes expose cumulative buffer diagnostics', () => {
  const source = read('native-module/src/lib.rs');
  assert.equal((source.match(/pub fn get_buffer_diagnostics/g) || []).length, 2);
  assert.match(source, /dropped_samples:\s*snapshot\.dropped_samples as f64/);
  assert.match(source, /drop_events:\s*snapshot\.drop_events as f64/);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/services/__tests__/NativeAudioDropAccounting.contract.test.mjs
```

Expected: fails because producers ignore write results and NAPI methods are absent.

- [ ] **Step 3: Thread one counter through each capture instance**

For bulk writes use the returned count:

```rust
let requested = samples.len();
let written = producer.push_slice(samples);
drop_stats.record_write(requested, written);
```

For per-sample writes use a helper local to the callback:

```rust
let written = usize::from(producer.try_push(sample).is_ok());
drop_stats.record_write(1, written);
```

Each backend constructor receives or creates `Arc<AudioDropStats>`, stores the same instance in its stream, and clones it into the real-time callback. Do not add logging, allocation, locks, or IPC to callbacks.

- [ ] **Step 4: Expose snapshots through napi-rs**

Add this object in `native-module/src/lib.rs`:

```rust
#[napi(object)]
pub struct AudioBufferDiagnostics {
    pub dropped_samples: f64,
    pub drop_events: f64,
}
```

Add the following method to both `SystemAudioCapture` and `MicrophoneCapture`, backed by the capture instance's shared counter:

```rust
#[napi]
pub fn get_buffer_diagnostics(&self) -> AudioBufferDiagnostics {
    let snapshot = self.drop_stats.snapshot();
    AudioBufferDiagnostics {
        dropped_samples: snapshot.dropped_samples as f64,
        drop_events: snapshot.drop_events as f64,
    }
}
```

Call `reset()` immediately before starting a fresh capture session.

- [ ] **Step 5: Verify native and contract tests**

Run:

```bash
cd native-module && cargo test audio_drop_stats
cd .. && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/services/__tests__/NativeAudioDropAccounting.contract.test.mjs
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add native-module/src electron/services/__tests__/NativeAudioDropAccounting.contract.test.mjs
git commit -m "feat: measure native audio buffer overflow"
```

---

### Task 3: Privacy-safe Electron diagnostics monitor

**Files:**
- Create: `electron/audio/AudioBufferDiagnosticsMonitor.ts`
- Create: `electron/audio/__tests__/AudioBufferDiagnosticsMonitor.test.mjs`
- Modify: `electron/audio/MicrophoneCapture.ts`
- Modify: `electron/audio/SystemAudioCapture.ts`

**Interfaces:**
- Produces: `AudioBufferDiagnosticsMonitor` with `start()`, `recordChunk(byteLength, atMs?)`, and `stop()`.
- Consumes optional native `getBufferDiagnostics()`; absence means diagnostics unavailable, never capture failure.

- [ ] **Step 1: Write failing behavior tests**

Specify the monitor using a fake native snapshot source and injected logger/clock:

```js
test('new dropped samples always emit one redacted warning', () => {
  let snapshot = { droppedSamples: 0, dropEvents: 0 };
  const warnings = [];
  const monitor = new AudioBufferDiagnosticsMonitor({
    channel: 'system',
    getNativeDiagnostics: () => snapshot,
    getContext: () => ({ backend: 'wasapi', nativeSampleRate: 48000, emittedSampleRate: 16000 }),
    isVerbose: () => false,
    logger: { warn: (...args) => warnings.push(args), log: () => {} },
  });
  monitor.poll();
  snapshot = { droppedSamples: 240, dropEvents: 1 };
  monitor.poll();
  monitor.poll();
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0][1], {
    channel: 'system', backend: 'wasapi', droppedSamplesDelta: 240,
    dropEventsDelta: 1, droppedSamplesTotal: 240,
  });
});

test('full cadence summary is verbose-only and stop resets the session', () => {
  let verbose = false;
  const logs = [];
  const monitor = new AudioBufferDiagnosticsMonitor({
    channel: 'mic',
    getNativeDiagnostics: () => ({ droppedSamples: 0, dropEvents: 0 }),
    getContext: () => ({ backend: 'cpal', nativeSampleRate: 48000, emittedSampleRate: 16000 }),
    isVerbose: () => verbose,
    logger: { warn: () => {}, log: (...args) => logs.push(args) },
    intervalMs: 1_000_000,
  });
  monitor.start();
  monitor.recordChunk(1920, 1000);
  monitor.recordChunk(1920, 1060);
  monitor.poll();
  assert.equal(logs.length, 0);

  verbose = true;
  monitor.recordChunk(1920, 1120);
  monitor.poll();
  assert.deepEqual(logs.at(-1)[1], {
    channel: 'mic', backend: 'cpal', nativeSampleRate: 48000,
    emittedSampleRate: 16000, chunkCount: 3, totalBytes: 5760,
    averageIntervalMs: 60, maxIntervalMs: 60,
    droppedSamplesTotal: 0, dropEventsTotal: 0,
  });

  monitor.stop();
  monitor.start();
  monitor.recordChunk(640, 2000);
  monitor.poll();
  assert.equal(logs.at(-1)[1].chunkCount, 1);
  assert.equal(logs.at(-1)[1].totalBytes, 640);
  monitor.stop();
});

test('missing or throwing native diagnostics remain non-fatal', () => {
  const warnings = [];
  let throws = false;
  const monitor = new AudioBufferDiagnosticsMonitor({
    channel: 'system',
    getNativeDiagnostics: () => {
      if (throws) throw new Error('native method unavailable');
      return undefined;
    },
    getContext: () => ({ backend: 'unknown', nativeSampleRate: 0, emittedSampleRate: 0 }),
    isVerbose: () => false,
    logger: { warn: (...args) => warnings.push(args), log: () => {} },
  });
  assert.doesNotThrow(() => monitor.poll());
  throws = true;
  assert.doesNotThrow(() => monitor.poll());
  assert.equal(warnings.length, 0);
});
```

- [ ] **Step 2: Build Electron and verify RED**

Run:

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/audio/__tests__/AudioBufferDiagnosticsMonitor.test.mjs
```

Expected: fails because `AudioBufferDiagnosticsMonitor` does not exist.

- [ ] **Step 3: Implement the minimal monitor**

Use this public shape:

```ts
export type AudioBufferSnapshot = { droppedSamples: number; dropEvents: number };
export type AudioBufferContext = {
  backend: string;
  nativeSampleRate: number;
  emittedSampleRate: number;
};

export class AudioBufferDiagnosticsMonitor {
  constructor(options: {
    channel: 'system' | 'mic';
    getNativeDiagnostics: () => AudioBufferSnapshot | undefined;
    getContext: () => AudioBufferContext;
    isVerbose: () => boolean;
    logger?: Pick<Console, 'warn' | 'log'>;
    intervalMs?: number;
  });
  start(): void;
  recordChunk(byteLength: number, atMs?: number): void;
  poll(): void;
  stop(): void;
}
```

Implementation rules:

- Normalize snapshots to finite, non-negative integers.
- Compare cumulative totals with the previous snapshot and warn only for positive deltas.
- Log only fixed keys shown in the tests.
- Keep cadence counters in the monitor; do not retain chunks or PCM.
- `stop()` clears the timer and all counters.
- The timer must not keep Electron alive (`timer.unref?.()`).

- [ ] **Step 4: Integrate both capture wrappers**

Each wrapper creates one monitor. In its native data callback call only:

```ts
this.bufferDiagnostics.recordChunk(chunk.length);
```

After native capture starts call `start()`. In every stop, failed-start cleanup and destroy path call `stop()`. Resolve context from existing safe getters and `isVerboseLogging()`; never include `deviceId`.

- [ ] **Step 5: Verify monitor tests and Electron types**

Run:

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/audio/__tests__/AudioBufferDiagnosticsMonitor.test.mjs
npm run typecheck:electron
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add electron/audio/AudioBufferDiagnosticsMonitor.ts electron/audio/__tests__/AudioBufferDiagnosticsMonitor.test.mjs electron/audio/MicrophoneCapture.ts electron/audio/SystemAudioCapture.ts
git commit -m "feat: log native audio buffer diagnostics"
```

---

### Task 4: Cross-platform SenseVoice parameter contracts

**Files:**
- Create: `electron/services/__tests__/CrossPlatformSenseVoiceAudioContract.test.mjs`
- Modify only if a test exposes an existing accidental inconsistency: the smallest owning source file.

**Interfaces:**
- No new runtime interface.
- Locks existing audio behavior; does not normalize backend-specific capture parameters.

- [ ] **Step 1: Write source-contract tests**

Create tests asserting exact existing values and routing:

```js
test('shared DSP output contract remains 16kHz mono with 20ms frames and 3-frame batching', () => {
  const config = read('native-module/src/audio_config.rs');
  const native = read('native-module/src/lib.rs');
  assert.match(config, /SAMPLE_RATE:\s*u32\s*=\s*16_000/);
  assert.match(config, /FRAME_MS:\s*u32\s*=\s*20/);
  assert.match(config, /FRAME_SAMPLES:\s*usize\s*=\s*320/);
  assert.match(config, /CHUNK_BATCH_COUNT:\s*usize\s*=\s*3/);
  assert.match(native, /emitted_rate[\s\S]*CANONICAL_STT_RATE/);
});

test('SenseVoice input and VAD contract is platform-independent but channel-specific', () => {
  const stt = read('electron/audio/sensevoice/LocalSenseVoiceSTT.ts');
  const vad = read('electron/audio/whisper/vadProcessor.ts');
  const worker = read('electron/audio/sensevoice/senseVoiceWorker.ts');
  assert.doesNotMatch(stt, /process\.platform/);
  assert.match(worker, /sampleRate:\s*16000/);
  assert.match(vad, /WINDOW_SIZE\s*=\s*480/);
  assert.match(vad, /DEFAULT_RMS_THRESHOLD\s*=\s*0\.008/);
  assert.match(stt, /rmsThreshold:\s*0\.004/);
  assert.match(stt, /hangoverFrames:\s*30/);
  assert.match(stt, /minSpeechFrames:\s*4/);
});

test('backend-specific system audio profiles remain intentional', () => {
  const native = read('native-module/src/lib.rs');
  const suppression = read('native-module/src/silence_suppression.rs');
  assert.match(native, /backend_name\(\)\s*==\s*"coreaudio"/);
  assert.match(suppression, /for_coreaudio_system_audio[\s\S]*speech_threshold_rms:\s*5\.0/);
  assert.match(suppression, /for_system_audio[\s\S]*speech_threshold_rms:\s*30\.0/);
});

test('resampler fallback declares the native rate instead of claiming 16kHz', () => {
  const native = read('native-module/src/lib.rs');
  assert.match(native, /let emitted_rate = if resampler\.is_some\(\)[\s\S]*CANONICAL_STT_RATE[\s\S]*native_rate/);
});
```

- [ ] **Step 2: Run tests and inspect result**

Run:

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/services/__tests__/CrossPlatformSenseVoiceAudioContract.test.mjs
```

Expected: pass against the approved current contract. If a test fails because the regex is inaccurate, correct the test. If it reveals a real contract mismatch, stop and report it before changing runtime parameters because this plan forbids parameter changes.

- [ ] **Step 3: Commit**

```bash
git add electron/services/__tests__/CrossPlatformSenseVoiceAudioContract.test.mjs
git commit -m "test: lock cross-platform SenseVoice audio contract"
```

---

### Task 5: Final verification and graph update

**Files:**
- Modify: none unless verification exposes a defect caused by Tasks 1–4.

**Interfaces:**
- Verifies all preceding interfaces and privacy constraints.

- [ ] **Step 1: Run focused tests**

```bash
cd native-module && cargo test audio_drop_stats
cd ..
npm run build:electron
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test \
  electron/audio/__tests__/AudioBufferDiagnosticsMonitor.test.mjs \
  electron/services/__tests__/NativeAudioDropAccounting.contract.test.mjs \
  electron/services/__tests__/CrossPlatformSenseVoiceAudioContract.test.mjs \
  electron/services/__tests__/CoreAudioSystemAudioSuppression.test.mjs \
  electron/services/__tests__/LocalSenseVoiceSTT.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run privacy and lifecycle checks**

Inspect emitted log-object keys in tests and assert they do not contain `pcm`, `audio`, `chunkData`, `deviceId`, `transcript`, `prompt`, `token`, or `key`. Verify both wrapper stop paths clear the monitor timer.

- [ ] **Step 3: Run project verification**

```bash
npm run typecheck:electron
npm run build
npm test
git diff --check
```

Expected: typecheck/build succeed, complete test suite has zero failures, and diff check emits no output.

- [ ] **Step 4: Update the code graph**

Run the code-review-graph incremental update against the current branch and inspect change impact. Expected: audio capture and diagnostics are the only affected communities; no unrelated UI, database, or provider flows are changed.

- [ ] **Step 5: Commit verification corrections only when present**

```bash
git add electron/audio/__tests__/AudioBufferDiagnosticsMonitor.test.mjs \
  electron/services/__tests__/NativeAudioDropAccounting.contract.test.mjs \
  electron/services/__tests__/CrossPlatformSenseVoiceAudioContract.test.mjs
git commit -m "test: finalize audio diagnostics coverage"
```

Run this step only if verification changed one of these test files. Otherwise do not create an empty commit.
