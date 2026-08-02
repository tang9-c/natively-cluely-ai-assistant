# Task 9 报告：校准阈值落地

## Status

已完成。

## 实现

- `SpeakerEnrollmentService.saveMeProfile` 现在直接保存 `quality.calibratedThreshold`，不再使用配置阈值覆盖校准结果。
- `SpeakerVerificationService.verify` 保持只读取 `profile.threshold` 做判断。
- `SpeakerProfileStore.getMeProfile` 对缺失、非数字、NaN、非有限或超出 `[0, 1]` 的旧 threshold 使用 `0.72` fallback。
- 未增加 UI 阈值调节，也未持久化 raw audio、transcript、prompt、screenshot 或 base64 数据。

## 测试

- `rtk proxy npm run build:electron`：通过。
- `rtk proxy node --test electron/services/__tests__/SpeakerVerificationCore.test.mjs`：11/11 通过。
- `rtk proxy env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/SpeakerVerificationStore.test.mjs`：12/12 通过。
- 普通 Node 运行 Store 测试受 `better-sqlite3` ABI 不匹配影响（Node ABI 146，当前要求 137），已改用 Electron Node 路径验证。

## Commit

`fix(speaker): persist calibrated verification threshold`
