# `test:all` 复跑基线后续记录（更新于 2026-07-06）

> **目的**：记录上一轮 `npm run test:all` 复跑发现的问题，并标注当前 HEAD 的处理状态，避免把已修复的历史失败继续带入上线风险清单。
>
> **当前代码基线**：`e53d8add fix: clarify sck backend toggle state`
>
> **当前环境事实**：`package.json` 中 Electron 为 `^42.6.0`，`test:all` 已迁移为 `node scripts/run-test-all.mjs`。

## TL;DR

上一轮复跑报告中记录的 3 个新增问题，在当前代码里已经不应再作为“当前失败”处理：

| 问题 | 上一轮结论 | 当前状态 |
|---|---|---|
| Bug #5：`MacX64NativeSmoke.test.mjs` 断言 better-sqlite3 版本过期 | Node test fail | ✅ 已修复，测试断言已同步到 `12.11.1` |
| Bug #6：`SttLanguageNormalization.test.mjs` 文案断言过期 | Node test fail | ✅ 已修复，测试已接受“当前语音提供商不会按中文执行” |
| Bug #7：`test:all` 使用 `&&` 链导致 Stage 4-6 跳过 | 基础设施问题 | ✅ 已修复，`test:all` 现在走 `scripts/run-test-all.mjs` 聚合执行 |

这份文档不再声称当前 Node tests 有 2 个失败，也不再声称 `test:all` 仍然是 `&&` 短路链路。

## 当前核验点

### Bug #5：better-sqlite3 版本断言

当前事实：

- `package.json`：`"better-sqlite3": "12.11.1"`
- `electron/services/__tests__/MacX64NativeSmoke.test.mjs`：断言 `pkg.dependencies['better-sqlite3'] === '12.11.1'`

结论：上一轮报告中的 `12.6.2` 断言过期问题已修复。

### Bug #6：语音语言兼容提示文案

当前事实：

- `src/components/SettingsOverlay.tsx` 用户可见标题：`当前语音提供商不会按中文执行`
- `electron/services/__tests__/SttLanguageNormalization.test.mjs` 正则已覆盖该标题

结论：上一轮报告中的文案断言过期问题已修复。

### Bug #7：`test:all` stage 短路

当前事实：

- `package.json` 的 `test:all` 为 `node scripts/run-test-all.mjs`
- 该脚本负责 stage 聚合，不再是旧的 `&&` 串联命令

结论：上一轮报告中的短路结论已过期。后续如果要判断 E2E / Doubao AUC / bench 状态，应基于当前 `scripts/run-test-all.mjs` 的输出重新复跑。

## 上线前建议

1. 不要使用旧报告中的 “1648 tests / 1628 pass / 2 fail” 作为当前上线状态。
2. 如果需要新的 `test:all` 基线，应在当前 HEAD 重新执行：

```bash
rtk npm run test:all
```

3. 如果只验证上下文质量相关改动，当前固定门禁是：

```bash
rtk npm run build:electron
rtk npm run test:quality:smoke:no-build
rtk npm run test:quality:diagnostics:no-build
```

## 历史备注

上一轮报告仍有价值的部分是：它说明曾经存在 test-vs-code staleness 和 stage 短路问题。但这些现在是历史背景，不是当前 release blocker。

如果未来再次更新此文件，必须同时核对：

- `package.json` 中 Electron 版本；
- `package.json` 的 `test:all` 脚本；
- `MacX64NativeSmoke.test.mjs` 的 native 版本断言；
- `SttLanguageNormalization.test.mjs` 与 `SettingsOverlay.tsx` 的实际文案；
- 最新 `npm run test:all` 输出。
