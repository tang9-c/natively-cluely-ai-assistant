# Natively 全量测试报告 (迭代 2)

**执行时间**: 2026-07-10 09:47 ~ 09:54 (PDT) / 16:47~16:54 (UTC+8 北京时间)
**执行人**: Claude (全量测试套件 via `npm run test:all`)
**运行环境**: Node v24.11.1 / Electron v42.6.0 / darwin arm64

## 总体结论

| 阶段 | 状态 | 通过 | 失败 | 跳过 | 耗时 |
|------|------|------|------|------|------|
| typecheck-electron | ✅ PASS | - | 0 | - | 2.3s |
| build-electron | ✅ PASS | - | 0 | - | 0.9s |
| node-tests | ✅ PASS | 2646 | **0** | 18 | 7.8s |
| dynamic-actions-replay | ✅ PASS | 9 | 0 | 0 | <1s |
| sales-real-stt-replay | ⛔ BLOCKED | - | - | - | - |
| fde-real-stt-replay | ⛔ BLOCKED | - | - | - | - |
| team-meet-real-stt-replay | ⛔ BLOCKED | - | - | - | - |
| recruiting-real-stt-replay | ⛔ BLOCKED | - | - | - | - |
| e2e (Playwright) | ✅ PASS | 10 | 0 | 2 | 1.2min |
| doubao-auc-real | ⏭️ SKIP | - | - | - | - |
| screen-understanding-bench | ✅ PASS | - | 0 | - | 10.8s |

**总体**: 11 阶段中 7 阶段 PASS / 4 阶段 BLOCKED(SKIP)。**0 个失败用例**。

## 对比上一次迭代 (2026-07-10 09:44~09:53)

| 指标 | 上次 | 本次 | 差异 |
|------|------|------|------|
| typecheck 耗时 | 2.2s | 2.3s | +0.1s |
| build 耗时 | 1.3s | 0.9s | -0.4s |
| node-tests 耗时 | 8.0s | 7.8s | -0.2s |
| node-tests 通过 | 2646 | 2646 | 0 |
| node-tests 失败 | 0 | 0 | 0 |
| node-tests 跳过 | 18 | 18 | 0 |
| e2e 耗时 | 67.1s | 74.5s | +7.4s |
| e2e 通过 | 10 | 10 | 0 |
| e2e 跳过 | 2 | 2 | 0 |
| bench 耗时 | 10.1s | 10.8s | +0.7s |

**结论**: 两次连续运行结果**完全一致**(2646 pass / 0 fail / 18 skipped)。无新增失败,无回归。耗时波动在正常范围内。

## 单元测试细节

- **测试总数**: 2664(228 suites)
- **通过**: 2646
- **失败**: 0 ✅
- **跳过**: 18

`SettingsAudioFallbackNotice.test.mjs` 用例继续通过(上次已修复,本轮无回归):
```
✔ settings audio fallback banner distinguishes screen recording permission
   from output device open failure (1.962292ms)
```

## E2E 跳过用例详情 (无变化)

- `tests/e2e/basic-smoke.spec.ts:73` — `settings panel opens and closes`
- `tests/e2e/research-pipeline.spec.ts:40` — `Settings → Research tab shows the Tavily API key input`

被显式 skip;其余 10 个全部通过(74s)。

## 持续问题清单 (与上轮一致)

### ⛔ 问题 #1 — 4 个真实 STT 重放脚本因 API Key 缺失被 BLOCKED

**阶段**: `sales-real-stt-replay`, `fde-real-stt-replay`, `team-meet-real-stt-replay`, `recruiting-real-stt-replay`
**错误**:
```
[test:all] stage=sales-real-stt-replay result=BLOCKED reason=missing QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY
[test:all] stage=fde-real-stt-replay result=BLOCKED reason=missing QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY
[test:all] stage=team-meet-real-stt-replay result=BLOCKED reason=missing QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY
[test:all] stage=recruiting-real-stt-replay result=BLOCKED reason=missing QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY
```

**性质**: 环境限制,非代码缺陷。
**建议**: CI 上配 `NATIVELY_API_KEY` 后补跑。

### ⚠️ 问题 #2 — 屏幕理解优化器 reductionPct 异常(已观察到但阶段仍 PASS)

`1080p document` + best profile: -1152.4%(输出比输入大 11.5 倍)。
**建议**: 在 `optimizeImage()` 加 `if (ratio > 1) return original;` 短路。
**优先级**: P3 (不影响 PASS)。

### ⏭️ 问题 #3 — `doubao-auc-real` 跳过 (设计内)

需 `DOUBAO_AUC_REAL_TESTS=1` 显式开启。

## 修复优先级建议(无变化)

1. **P3**: 复盘 screen-understanding 高压缩档策略
2. **P3**: CI 上配 `NATIVELY_API_KEY` 后补跑 real STT replay