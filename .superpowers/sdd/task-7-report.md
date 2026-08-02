# Task 7 Report: 会议级可靠性统计

## 状态

已完成。

## 实现

- 在既有 v31 -> v32 migration 中合并可靠性字段；没有新增 v33/v34 migration。
- 保留 `version >= 32` 的幂等补列逻辑，兼容此前已标记为 v33 的中间 schema，且不改变其版本号。
- `SpeakerProfileStore` 提供 `recordVerificationStat(input)` 和 `getStats()`；状态接口返回最新统计摘要。
- 记录 positive、low_confidence、near_threshold_non_me、low_quality、error、timeout 的独立计数与最后 outcome。
- 有 latency 的事件使用累计平均，并由 `latency_sample_count` 保证不含 latency 的 timeout 不会稀释平均值。
- `recordVerification()` 保留为单次映射包装，避免新旧入口对同一事件重复计数。
- 验证服务对 positive、low_confidence、low_quality、error 写入 latency；timeout 同样进入新统计接口。
- annotator 超时时会中止该次 verify 的后续统计；迟到完成不会在已记录 timeout 后再写入 positive、low_confidence 或 error。
- 错误仅保存白名单稳定错误码（当前包括 `speaker_verification_failed` 和 `speaker_verification_error`）；未知值统一映射为 `speaker_verification_failed`，不保存异常原文或 raw audio、transcript、prompt、screenshot、base64。

## 验证

- `rtk proxy npm run build:electron` 通过。
- `rtk proxy node --test electron/services/__tests__/SpeakerVerificationCore.test.mjs` 通过，9/9；覆盖真实 isMe=false 的 low_confidence 与 timeout 后迟到完成不重复计数。
- `rtk proxy node --test electron/services/__tests__/SpeakerVerificationStore.test.mjs` 受 `better-sqlite3` ABI 146/137 不匹配阻断。
- 使用 `rtk proxy env ELECTRON_RUN_AS_NODE=1 /Users/tang-codeing/code/natively-cluely-ai-assistant/node_modules/.bin/electron --test electron/services/__tests__/SpeakerVerificationStore.test.mjs` 运行 Store 测试通过，11/11。
- `rtk proxy git diff --check` 通过。

## 关注点

- 当前 runtime stats 绑定 ME profile 的持久化 stats 行；未保存任何会议原始内容或音频内容。
