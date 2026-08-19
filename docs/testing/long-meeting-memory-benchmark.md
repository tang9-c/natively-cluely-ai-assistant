# 长会议内存基准

本基准通过真实 Electron 主进程、Renderer 和正式 transcript 路由测量长会议资源变化。合成源用于稳定回归；SenseVoice 源在独立子进程中实时回放本地 WAV，测量真实模型、worker、队列和内存占用。

报告不得包含转录、提示词、证据、密钥、音频内容或本地私有文件名。SenseVoice 报告只记录音频内容的 SHA-256 前 12 位。

## 准备

```bash
npm run build
npm run build:electron
npm run test:bench:long-meeting
```

SenseVoice 模式还要求：

- 系统可执行 `ffmpeg`；
- 已编译的本地 STT 依赖可用；
- 提供 16 kHz 可转换的 WAV、SenseVoice ONNX 模型和 `tokens.txt`。

## 合成长会议

```bash
node scripts/benchmark-long-meeting-memory.mjs --source synthetic --duration-minutes 30 --json .tmp/long-meeting-memory/synthetic-30.json --markdown .tmp/long-meeting-memory/synthetic-30.md
node scripts/benchmark-long-meeting-memory.mjs --source synthetic --duration-minutes 60 --json .tmp/long-meeting-memory/synthetic-60.json --markdown .tmp/long-meeting-memory/synthetic-60.md
node scripts/benchmark-long-meeting-memory.mjs --source synthetic --duration-minutes 180 --json .tmp/long-meeting-memory/synthetic-180.json --markdown .tmp/long-meeting-memory/synthetic-180.md
```

合成源会把 STT provider 临时设为 `none`，避免默认 SenseVoice 预热污染 Electron Main 的基线。它仍使用与实时 STT 相同的主进程转录处理、RAG 和 Renderer IPC 路由。

## SenseVoice 实时音频回放

```bash
node scripts/benchmark-long-meeting-memory.mjs \
  --source sensevoice-audio \
  --audio "$LONG_MEETING_AUDIO" \
  --model "$SENSEVOICE_MODEL_PATH" \
  --tokens "$SENSEVOICE_TOKENS_PATH" \
  --duration-minutes 30 \
  --json .tmp/long-meeting-memory/sensevoice-30.json \
  --markdown .tmp/long-meeting-memory/sensevoice-30.md

node scripts/benchmark-long-meeting-memory.mjs \
  --source sensevoice-audio \
  --audio "$LONG_MEETING_AUDIO" \
  --model "$SENSEVOICE_MODEL_PATH" \
  --tokens "$SENSEVOICE_TOKENS_PATH" \
  --duration-minutes 60 \
  --json .tmp/long-meeting-memory/sensevoice-60.json \
  --markdown .tmp/long-meeting-memory/sensevoice-60.md
```

180 分钟真实音频回放由 CLI 支持，但属于可选的手工耐久测试。

## 检查点与门禁

- `T0`：停止会议之前；确认会议期间的峰值和队列状态。
- `T1`：停止后 5 秒；观察快速清理。
- `T2`：停止后至少 30 秒；执行最终恢复门禁。

最终门禁要求：

- STT queued/pending、RAG pending/processing 和 transcript IPC pending 在 T2 为 0；
- 会议阶段的最终转录数量单调增长；
- 已打开会议详情时，虚拟列表实际 DOM 行数保持有界；
- T2 Main RSS 不超过 `max(T0 × 1.20, T0 + 200 MiB)`。

无法测量的项目必须为 `null`，并在 `availability` 中说明原因，不得用假 `0` 代替。例如文件回放绕过采集 VAD，因此 `vadBacklog` 为 `null`。

## 平台基线

macOS Apple Silicon、macOS Intel 和 Windows x64 必须分别保存历史基线。不要比较不同平台的绝对 RSS；应比较同平台前后版本的 RSS 斜率、峰值、队列上限和 T2 释放结果。

Windows CI 使用相同的 Node 命令，并把 `.tmp/long-meeting-memory/` 中的 JSON、Markdown 作为构建产物保留。SenseVoice 真实音频测试保持手工或夜间运行，不进入普通 PR 门禁。

## 快速烟测

短时长只允许显式测试模式。即使会议仅 6 秒，仍会等待完整的 T2 恢复窗口，因此约需 36 秒。

```bash
node scripts/benchmark-long-meeting-memory.mjs \
  --source synthetic \
  --duration-minutes 0.1 \
  --test-mode \
  --sample-interval-ms 1000 \
  --json .tmp/long-meeting-smoke.json \
  --markdown .tmp/long-meeting-smoke.md
```

基准无论门禁成功或失败都会先写出报告；任一门禁失败时命令以非零状态退出，便于保留诊断数据。
