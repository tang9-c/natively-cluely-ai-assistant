# QCLOUD API Emotion Forwarding Design

## Summary

补完整 QCLOUD API 语音转写的情绪识别透传链路。当前 QCLOUD AUC 请求已经开启 `enable_emotion_detection`，解析器也能从 utterance additions 中读出 `emotion`，但 `RestSTT.emitUploadResult()` 没有把该字段写入最终 transcript segment，导致 UI、动态动作和 WhatToAnswer 都拿不到 QCLOUD 情绪。

本次只补 QCLOUD API 情绪透传，不实现 LocalSenseVoiceSTT 多人说话人分离。

## Goals

- QCLOUD API 返回非中性情绪时，最终 transcript segment 包含 `emotion` 和 `emotionSource: 'qcloud'`。
- QCLOUD API 返回 `neutral` 或没有情绪时，不写入 `emotion` 字段，保持现有 UI 不显示中性情绪。
- LocalSenseVoiceSTT 的现有情绪链路保持不变，继续使用 `emotionSource: 'sensevoice'`。
- 不改变 QCLOUD API 说话人分离、speaker verification、数据库保存和 UI 主逻辑。

## Non-Goals

- 不做 LocalSenseVoiceSTT 多人说话人分离。
- 不新增本地 speaker clustering。
- 不改情绪 UI 展示规则。
- 不引入新的情绪分类器。
- 不让未知或未校验的情绪字符串进入 transcript。

## Current State

QCLOUD API 通过 `RestSTT('qcloud-stt')` 调用 AUC multipart 接口。请求字段包含：

```text
enable_emotion_detection: 'true'
show_utterances: 'true'
enable_speaker_info: ...
```

`doubaoAucClient.extractDoubaoAucTranscription()` 已经会解析：

```text
utterance.emotion
utterance.emotionDegree
utterance.emotionScore
```

但 `RestSTT.emitUploadResult()` emit transcript 时只写入文本、说话人分离字段和 speaker verification 字段，没有透传 `utterance.emotion`。

## Proposed Design

### Type Contract

扩展 transcript 情绪来源类型：

```ts
emotionSource?: 'sensevoice' | 'qcloud'
```

需要同步的契约位置：

- `electron/audio/BaseSTT.ts`
- `electron/preload.ts`
- `src/types/electron.d.ts`

### Runtime Flow

在 `RestSTT.emitUploadResult()` 的 AUC utterance 分支里增加最小映射：

```ts
...(utterance.emotion && utterance.emotion !== 'neutral'
  ? { emotion: utterance.emotion, emotionSource: 'qcloud' as const }
  : {})
```

该逻辑只处理 `DoubaoAucTranscriptionResult` 的 utterance 分支，因此不会影响普通 REST STT provider。

### Data Flow

```text
QCLOUD AUC response
  -> extractDoubaoAucTranscription()
  -> utterance.emotion
  -> RestSTT.emitUploadResult()
  -> transcript segment { emotion, emotionSource: 'qcloud' }
  -> main.ts transcriptPayload
  -> IntelligenceEngine / UI / DynamicAction / WhatToAnswer
```

### Error Handling

- 没有 emotion：不写入情绪字段。
- emotion 是 `neutral`：不写入情绪字段。
- 未知 emotion：现有 parser 不会返回，因此不透传。
- 透传失败不应影响 transcript 文本、说话人分离或 speaker verification。

## Tests

新增或更新测试覆盖：

- QCLOUD/Doubao AUC utterance 带 `emotion: 'angry'` 时，`RestSTT` emit 的 transcript 包含：
  - `emotion: 'angry'`
  - `emotionSource: 'qcloud'`
- AUC utterance 带 `emotion: 'neutral'` 时，不 emit `emotion`。
- 类型/静态测试确认 `emotionSource` 支持 `'qcloud'`，并保留 `'sensevoice'`。
- 现有 LocalSenseVoice emotion 测试继续通过。

## Rollout

这是向后兼容变更。旧 transcript 没有 `emotionSource: 'qcloud'` 不受影响。上线后 QCLOUD API 用户如果 provider 返回非中性情绪，现有情绪 UI 和动态动作情绪加权会自动开始使用这些信号。

## Risks

- QCLOUD provider 的 emotion 字段质量可能不稳定。设计上只透传 provider 已返回且 parser 已认可的枚举，不做二次判断。
- 如果上层 UI 文案只暗示 SenseVoice 情绪来源，后续可单独调整文案；本次不改 UI。

