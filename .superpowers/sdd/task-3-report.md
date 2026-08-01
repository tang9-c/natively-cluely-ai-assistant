# Task 3 Report: 声纹标注不能阻塞 STT

## 状态

已完成。`SpeakerVerificationAnnotator` 默认在 200ms 后降级为 `undefined`，不会阻塞 STT transcript emit。

## 实现

- 增加 `timeoutMs`（默认 200ms）和 `onTimeout` 选项。
- 超时调用 `recordTimeout()` 与 `onTimeout()`，两者均不会中断转写。
- 将 `timeoutCount` 独立写入 `speaker_profile_stats`，通过数据库 v34 migration 添加 `timeout_count`。
- 验证服务错误同样降级为无 speaker metadata。
- 未引入异步 metadata 补写，未保存 raw audio、transcript、prompt、screenshot 或 base64。

## 验证

- `rtk proxy npm run build:electron` 通过。
- `rtk proxy npm run typecheck:electron` 通过。
- `rtk proxy node --test electron/services/__tests__/SpeakerVerificationCore.test.mjs` 通过（含 200ms hang 回归）。
- `rtk proxy node --test electron/services/__tests__/LocalSenseVoiceSTT.test.mjs` 通过（含 worker result 后的 hang 回归）。
- `rtk proxy node --test electron/audio/__tests__/RestSTT.test.mjs` 通过（含 REST transcript 降级回归）。

## 已知环境问题

`electron/services/__tests__/SpeakerVerificationStore.test.mjs` 的运行时数据库用例受本机 `better-sqlite3` ABI 不匹配阻断：模块 ABI 146，但当前 Node 需要 ABI 137。该文件的非数据库结构性迁移断言可执行；完整运行需重建原生依赖。
