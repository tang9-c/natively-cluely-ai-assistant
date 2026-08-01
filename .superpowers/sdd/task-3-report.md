# Task 3 Report: 声纹标注不能阻塞 STT

## 状态

已完成。`SpeakerVerificationAnnotator` 默认在 200ms 后降级为 `undefined`，不会阻塞 STT transcript emit。

## 实现

- 增加 `timeoutMs`（默认 200ms）和 `onTimeout` 选项。
- 超时调用 `recordTimeout()` 与 `onTimeout()`，两者均不会中断转写。
- 将 `timeoutCount` 独立写入 `speaker_profile_stats`，`timeout_count` 已按计划合并到数据库 v31 -> v32 migration。
- 验证服务错误同样降级为无 speaker metadata。
- 未引入异步 metadata 补写，未保存 raw audio、transcript、prompt、screenshot 或 base64。

## 验证

- `rtk proxy npm run build:electron` 通过。
- `rtk proxy npm run typecheck:electron` 通过。
- `rtk proxy node --test electron/services/__tests__/SpeakerVerificationCore.test.mjs` 通过（含 200ms hang 回归）。
- `rtk proxy node --test electron/services/__tests__/LocalSenseVoiceSTT.test.mjs` 通过（含 worker result 后的 hang 回归）。
- `rtk proxy node --test electron/audio/__tests__/RestSTT.test.mjs` 通过（含 REST transcript 降级回归）。
- `rtk proxy node --test electron/services/__tests__/SpeakerVerificationStore.test.mjs` 的结构性迁移断言通过；运行时数据库用例因 Node ABI 不匹配无法加载 `better-sqlite3`。
- `rtk proxy npm exec -- electron --runAsNode --test electron/services/__tests__/SpeakerVerificationStore.test.mjs` 在 Electron Node（ABI 146）下通过全部 8 个子测试；测试 runner 输出后未自行退出，已手动终止。

## 已知环境问题

普通 Node 的 `better-sqlite3` 运行时数据库用例受 ABI 不匹配阻断：模块 ABI 146，但当前 Node 需要 ABI 137。Electron Node 可运行全部子测试，但该测试文件仍有活动句柄使 runner 不会自行退出。
