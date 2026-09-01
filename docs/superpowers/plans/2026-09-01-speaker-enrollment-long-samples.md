# 声音注册长样本实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将三段声音注册提示词扩展到约 10 秒，并实现“8 秒有效语音后可停止、10 秒自动结束”的一致前后端门禁。

**Architecture:** 继续使用现有 `SpeakerRecordingQualityPolicy`、20ms 语音帧统计和 `SpeakerVerificationSettings` 录音路径。`minDurationMs` 调整为 8000ms，并在现有质量函数中额外校验 `durationMs × voiceRatio`；前端只增加长提示词、一个 10 秒上限常量和幂等停止处理。

**Tech Stack:** TypeScript、React 18、Electron、Web Audio API、Node test runner、esbuild 测试加载器。

## Global Constraints

- 不增加 IPC 字段、设置项、数据库字段、后台服务或实时声纹推理。
- 不修改声纹相似度阈值、2 秒窗口、1 秒步长和验证阶段 1500ms 门槛。
- 复用现有 `SpeakerRecordingQualityPolicy.minDurationMs` 表示注册所需的总时长及有效语音目标。
- 保留工作区现有声音帧统计与录音级嵌入聚合改动，不覆盖或回退它们。
- 严格按 RED → GREEN 执行，每个任务只提交本任务文件。

---

### Task 1: 后端注册有效语音门禁

**Files:**
- Modify: `electron/services/speaker/speakerAudioUtils.ts:8-14,91-114`
- Modify: `electron/services/speaker/SpeakerEnrollmentService.ts:71-87`
- Modify: `electron/services/__tests__/SpeakerVerificationCore.test.mjs:4-10,44-75,76-232`

**Interfaces:**
- Consumes: `measureVoiceActivity(samples, 16000, voiceSampleThreshold)` 返回的 `voiceRatio`。
- Produces: `measureAudioQuality()` 对整段 enrollment 要求总时长和有效语音时长均不少于 `policy.minDurationMs`；verification 和 enrollment 内部 2 秒窗口仍使用 `minVerificationDurationMs`。

- [ ] **Step 1: 写失败的后端边界测试**

在 `SpeakerVerificationCore.test.mjs` 增加部分有声样本助手：

```js
function partiallyVoicedSamples(totalSeconds, voicedSeconds, sampleRate = 16000) {
  const samples = new Float32Array(totalSeconds * sampleRate);
  const voiced = loudSamples(voicedSeconds, sampleRate);
  samples.set(voiced);
  return samples;
}
```

新增测试：

```js
test('enrollment requires eight seconds of effective speech while verification keeps its short threshold', async () => {
  const { measureAudioQuality } = await import('../../../dist-electron/electron/services/speaker/speakerAudioUtils.js');

  assert.equal(
    measureAudioQuality(loudSamples(7.5), undefined, { durationKind: 'enrollment' }).reason,
    'too_short',
  );
  assert.equal(
    measureAudioQuality(partiallyVoicedSamples(10, 7), undefined, { durationKind: 'enrollment' }).reason,
    'not_enough_voice',
  );
  assert.equal(measureAudioQuality(loudSamples(8), undefined, { durationKind: 'enrollment' }).ok, true);
  assert.equal(measureAudioQuality(loudSamples(2), undefined, { durationKind: 'verification' }).ok, true);
});
```

- [ ] **Step 2: 构建并确认测试按预期失败**

Run:

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/SpeakerVerificationCore.test.mjs
```

Expected: 新测试在 7.5 秒 enrollment 或 10 秒/7 秒有效语音断言处失败；不是导入或构建错误。

- [ ] **Step 3: 实现最小后端校验**

将默认注册门槛改为：

```ts
export const SPEAKER_RECORDING_QUALITY_POLICY: SpeakerRecordingQualityPolicy = {
  minDurationMs: 8000,
  minRms: 0.005,
  minVoiceRatio: 0.12,
  voiceSampleThreshold: 0.01,
  minVerificationDurationMs: 1500,
};
```

在 `measureAudioQuality()` 中仅对 enrollment 增加有效时长检查：

```ts
const durationKind = options.durationKind ?? 'enrollment';
const minDurationMs = durationKind === 'verification'
  ? policy.minVerificationDurationMs
  : policy.minDurationMs;
if (durationMs < minDurationMs) return { ok: false, durationMs, rms, voiceRatio, reason: 'too_short' };
if (rms < policy.minRms) return { ok: false, durationMs, rms, voiceRatio, reason: 'too_quiet' };
if (voiceRatio < policy.minVoiceRatio) return { ok: false, durationMs, rms, voiceRatio, reason: 'not_enough_voice' };
if (durationKind === 'enrollment' && durationMs * voiceRatio < policy.minDurationMs) {
  return { ok: false, durationMs, rms, voiceRatio, reason: 'not_enough_voice' };
}
return { ok: true, durationMs, rms, voiceRatio };
```

在 `SpeakerEnrollmentService` 中，整段样本保持 `durationKind: 'enrollment'`，2 秒窗口改用短时门槛：

```ts
const quality = measureAudioQuality(samples16k, undefined, { durationKind: 'enrollment' });

for (const window of slidingWindows(samples16k, 2000, 1000)) {
  const windowQuality = measureAudioQuality(window, undefined, { durationKind: 'verification' });
  if (!windowQuality.ok) continue;
  windowEmbeddings.push(await this.options.extractor.extract(window));
}
```

- [ ] **Step 4: 更新现有 enrollment 测试样本为长样本**

在测试顶部加入：

```js
const ENROLLMENT_SECONDS = 10;
const WINDOWS_PER_ENROLLMENT_SAMPLE = 9;
```

所有调用真实 `SpeakerEnrollmentService.enroll()` 的合格样本改为 `loudSamples(ENROLLMENT_SECONDS)`。保留专门测试 verification 时长的自定义 policy 测试。

让测试 extractor 与 9 个窗口/段对齐：

```js
class SplitEmbeddingExtractor extends FakeExtractor {
  calls = 0;
  async extract() {
    this.calls += 1;
    const recordingIndex = Math.floor((this.calls - 1) / WINDOWS_PER_ENROLLMENT_SAMPLE);
    return new Float32Array(recordingIndex === 1 ? [0, 1, 0, 0] : [1, 0, 0, 0]);
  }
}

class BorderlineEmbeddingExtractor extends FakeExtractor {
  calls = 0;
  async extract() {
    this.calls += 1;
    const recordingIndex = Math.floor((this.calls - 1) / WINDOWS_PER_ENROLLMENT_SAMPLE);
    return new Float32Array(recordingIndex < 2 ? [1, 0, 0, 0] : [0.5, 0.8660254, 0, 0]);
  }
}
```

`WithinRecordingVariationExtractor` 保持窗口交替输出，用于证明段内窗口变化经过录音级聚合后不会误拒绝。

- [ ] **Step 5: 验证 Task 1 转绿**

Run:

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/SpeakerVerificationCore.test.mjs
```

Expected: `SpeakerVerificationCore.test.mjs` 全部通过，包括短 enrollment 拒绝、8 秒有效语音通过、2 秒 verification 通过和不同录音者拒绝。

- [ ] **Step 6: 提交 Task 1**

```bash
rtk git add electron/services/speaker/speakerAudioUtils.ts electron/services/speaker/SpeakerEnrollmentService.ts electron/services/__tests__/SpeakerVerificationCore.test.mjs
rtk git commit -m "fix(speaker): require long enrollment speech"
```

---

### Task 2: 长提示词与 10 秒录音交互

**Files:**
- Modify: `src/components/settings/SpeakerVerificationSettings.tsx:71-83,117-147,190-241,375-434,680-700`
- Modify: `src/components/__tests__/SpeakerVerificationSettings.test.mjs:129-176`

**Interfaces:**
- Consumes: IPC 返回的 `SpeakerRecordingQualityPolicy.minDurationMs = 8000` 和现有 `RecordingMetrics.voiceRatio`。
- Produces: 三段约 10 秒提示词、8 秒有效语音停止门槛、10 秒自动结束、不会重复执行的停止路径。

- [ ] **Step 1: 写失败的 UI 契约测试**

在 `SpeakerVerificationSettings.test.mjs` 增加：

```js
test('speaker enrollment uses long prompts with eight voiced seconds and a ten second cap', () => {
  const source = read('src/components/settings/SpeakerVerificationSettings.tsx');

  assert.match(source, /const MAX_RECORDING_DURATION_MS = 10_000/);
  assert.match(source, /今天的会议我们会依次讨论产品目标、技术方案、交付时间和团队分工/);
  assert.match(source, /客户最近重点关注系统稳定性、数据安全、部署方式和使用体验/);
  assert.match(source, /包括遇到的问题、你的判断以及下一步准备怎么做/);
  assert.match(source, /durationMs \* voiceRatio/);
  assert.match(source, /durationMs >= MAX_RECORDING_DURATION_MS/);
  assert.match(source, /disabled=\{busy \|\| recordingMetrics\.state !== 'ready'\}/);
  assert.match(source, /mediaRef\.current = null/);
});
```

增强现有实时质量测试，要求 UI 显示 `10.0 秒` 总时长目标和 `8.0 秒` 有效语音目标。

- [ ] **Step 2: 运行 UI 测试并确认 RED**

Run:

```bash
rtk node --test src/components/__tests__/SpeakerVerificationSettings.test.mjs
```

Expected: 新测试因缺少长提示词、`MAX_RECORDING_DURATION_MS` 或自动结束条件而失败。

- [ ] **Step 3: 更新提示词与最小默认策略**

在组件顶部使用已确认内容：

```ts
const MAX_RECORDING_DURATION_MS = 10_000;

const PROMPTS = [
  '今天的会议我们会依次讨论产品目标、技术方案、交付时间和团队分工，并确认接下来最重要的行动计划。',
  '客户最近重点关注系统稳定性、数据安全、部署方式和使用体验，我们需要逐项回应并记录后续安排。',
  '请用平时说话的方式，介绍你最近正在处理的一件事情，包括遇到的问题、你的判断以及下一步准备怎么做。',
] as const;

const INTERNAL_DEFAULT_RECORDING_QUALITY_POLICY: SpeakerRecordingQualityPolicy = {
  minDurationMs: 8000,
  minRms: 0.005,
  minVoiceRatio: 0.12,
  voiceSampleThreshold: 0.01,
  minVerificationDurationMs: 1500,
};
```

- [ ] **Step 4: 用现有指标实现 8 秒有效语音门槛**

在 `qualityFromMetrics()` 中复用现有字段：

```ts
const voicedDurationMs = durationMs * voiceRatio;
if (durationMs < policy.minDurationMs) {
  return { durationMs, rms, voiceRatio, state: 'too_short' };
}
if (rms < policy.minRms) {
  return { durationMs, rms, voiceRatio, state: 'too_quiet' };
}
if (voiceRatio < policy.minVoiceRatio || voicedDurationMs < policy.minDurationMs) {
  return { durationMs, rms, voiceRatio, state: 'not_enough_voice' };
}
return { durationMs, rms, voiceRatio, state: 'ready' };
```

`recordingQualityMessage()` 在 `not_enough_voice` 时显示剩余有效语音：

```ts
const voicedDurationMs = metrics.durationMs * metrics.voiceRatio;
return `继续说话，还需要 ${formatDuration(Math.max(0, policy.minDurationMs - voicedDurationMs))} 有效语音`;
```

- [ ] **Step 5: 添加单次触发的 10 秒自动结束**

给 `startActiveRecording()` 增加 `onMaxDuration` 回调，并用局部布尔值确保只通知一次：

```ts
async function startActiveRecording(
  policy: SpeakerRecordingQualityPolicy,
  onMetrics?: (metrics: RecordingMetrics) => void,
  onMaxDuration?: () => void,
): Promise<ActiveRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  let totalSamples = 0;
  let maxDurationReached = false;
  const voiceActivity = createVoiceActivityAccumulator();
  source.connect(processor);
  processor.connect(audioContext.destination);
  processor.onaudioprocess = event => {
    const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
    chunks.push(chunk);
    totalSamples += chunk.length;
    const durationMs = Math.round((totalSamples / audioContext.sampleRate) * 1000);
    const { rms, voiceRatio } = appendVoiceActivitySamples(
      voiceActivity,
      chunk,
      audioContext.sampleRate,
      policy.voiceSampleThreshold,
    );
    onMetrics?.(qualityFromMetrics(durationMs, rms, voiceRatio, policy));
    if (!maxDurationReached && durationMs >= MAX_RECORDING_DURATION_MS) {
      maxDurationReached = true;
      onMaxDuration?.();
    }
  };
  return {
    tracks: stream.getTracks(),
    audioContext,
    source,
    processor,
    chunks,
    sampleRate: audioContext.sampleRate,
    deviceFingerprint: stream.getAudioTracks()[0]?.label,
  };
}
```

`beginRecording()` 传入现有结束路径：

```ts
mediaRef.current = await startActiveRecording(
  qualityPolicy,
  setRecordingMetrics,
  () => void finishRecording(),
);
```

- [ ] **Step 6: 让停止路径幂等并限制手动停止**

在任何 `await` 前取出并清空录音引用：

```ts
const finishRecording = async () => {
  const active = mediaRef.current;
  if (!active) return;
  mediaRef.current = null;
  setBusy(true);
  try {
    const sample = await stopActiveRecording(active);
    setRecordingIndex(null);
    const quality = evaluateRecordingQuality(sample.samples, sample.sampleRate, qualityPolicy);
    setRecordingMetrics(quality);
    if (quality.state !== 'ready') {
      setError(`本段录音未达标，请重录。${recordingQualityMessage(quality, qualityPolicy)}`);
      return;
    }
    const next = [...samples, sample];
    setSamples(next);
    if (next.length === PROMPTS.length) {
      const payload: SpeakerEnrollmentSample[] = next.map(item => ({
        pcm16: float32ToPcm16Buffer(item.samples),
        sampleRate: item.sampleRate,
        deviceFingerprint: item.deviceFingerprint,
      }));
      const result = await window.electronAPI?.speakerVerificationEnroll?.(payload);
      if (!result?.success) {
        setError(sanitizedSpeakerVerificationError(result?.error, '声音注册失败'));
      } else if (result.status) {
        setStatus(result.status);
        setSamples([]);
      }
    }
  } catch (err: any) {
    setError(sanitizedSpeakerVerificationError(err, '麦克风录音失败'));
  } finally {
    setBusy(false);
    setRecordingIndex(null);
  }
};
```

`cancelRecording()` 使用相同的先清空再关闭顺序。录音停止按钮改为：

```tsx
disabled={busy || recordingMetrics.state !== 'ready'}
```

- [ ] **Step 7: 更新录音指标显示**

保留三列布局，将时长和有效语音改为目标进度：

```tsx
<div>
  <span className="block text-text-secondary">时长</span>
  {formatDuration(recordingMetrics.durationMs)} / {formatDuration(MAX_RECORDING_DURATION_MS)}
</div>
<div>
  <span className="block text-text-secondary">有效语音</span>
  {formatDuration(recordingMetrics.durationMs * recordingMetrics.voiceRatio)} / {formatDuration(qualityPolicy.minDurationMs)}
</div>
```

将 `formatDuration()` 输出改成 `${(ms / 1000).toFixed(1)} 秒`，保持中文界面一致。

- [ ] **Step 8: 运行 UI 测试并确认 GREEN**

Run:

```bash
rtk node --test src/components/__tests__/SpeakerVerificationSettings.test.mjs
```

Expected: 组件渲染、资源释放、质量反馈、长提示词、停止门槛和自动结束契约测试全部通过。

- [ ] **Step 9: 提交 Task 2**

```bash
rtk git add src/components/settings/SpeakerVerificationSettings.tsx src/components/__tests__/SpeakerVerificationSettings.test.mjs
rtk git commit -m "feat(speaker): record longer enrollment samples"
```

---

### Task 3: 集成验证

**Files:**
- Verify only: all files modified by Tasks 1-2 and the existing `shared/speakerVoiceActivity.ts`

**Interfaces:**
- Consumes: Task 1 的后端门禁和 Task 2 的录音交互。
- Produces: 构建、类型检查及声纹/UI 回归验证证据。

- [ ] **Step 1: 检查 diff 范围和格式**

```bash
rtk git diff --check
rtk git status --short
```

Expected: 没有空白错误；改动限于声音统计、注册服务、设置组件及对应测试。不要暂存 `.tmp/` 或 `design-qa.md`。

- [ ] **Step 2: 运行 Renderer 和 Electron 类型检查**

```bash
rtk npx tsc --noEmit
rtk npm run typecheck:electron
```

Expected: 两个命令退出码均为 0。

- [ ] **Step 3: 运行生产构建**

```bash
rtk npm run build
```

Expected: TypeScript 与 Vite production build 成功。

- [ ] **Step 4: 运行声纹服务回归测试**

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test \
  electron/services/__tests__/SpeakerVerificationCore.test.mjs \
  electron/services/__tests__/SpeakerVerificationStore.test.mjs \
  electron/services/__tests__/SpeakerVerificationModelManager.test.mjs \
  electron/services/__tests__/SpeakerVerificationIpcSettings.test.mjs \
  electron/services/__tests__/SpeakerVerificationMetadata.test.mjs
```

Expected: 所有声纹核心、存储、模型、IPC 和元数据测试通过，0 failures。

- [ ] **Step 5: 运行声音设置 UI 测试**

```bash
rtk node --test src/components/__tests__/SpeakerVerificationSettings.test.mjs
```

Expected: 全部 UI 测试通过，0 failures。

- [ ] **Step 6: 最终提交（仅在仍有未提交的任务文件时）**

```bash
rtk git status --short
```

若 Tasks 1-2 已按计划提交，不创建空提交；若只剩无关的 `.tmp/`、`design-qa.md` 或用户改动，保持不动。
