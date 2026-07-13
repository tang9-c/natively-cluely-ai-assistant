# Natively STT 重放测试报告

**执行时间**: 2026-07-10 09:55~10:00 (PDT) / 16:55~17:00 (UTC+8 北京时间)
**执行人**: Claude (直接运行 `scripts/run-*-real-stt-replay.mjs`)
**运行环境**: Node v24.11.1 / darwin arm64
**关键**: `.env` 中存在 `QCLOUD_LIVE_API_KEY`,通过 `dotenv/config` 自动加载。

## 与 test:all 的差异

`scripts/run-test-all.mjs` 用 `process.env[name]` 直接判定 `blockedOnMissingEnv`,不读 `.env`。所以 `npm run test:all` 把 4 个 STT replay 全标 BLOCKED,**但脚本本身在 `dotenv/config` 加载后是可以跑的**。本次绕过 test:all 直接调用,获得真实结果。

**建议**: 让 `run-test-all.mjs` 也 `import 'dotenv/config'`,否则会持续误报 BLOCKED。

## 总体结果

| 重放 | 通过 | 失败 | 退出码 | 备注 |
|------|------|------|--------|------|
| sales-real-stt-replay | 2 | **1** | **1** | 1 个 false positive 回归 |
| fde-real-stt-replay | 2 | 0 | 0 | ✅ |
| team-meet-real-stt-replay | 1 | 0 | 0 | ✅ |
| recruiting-real-stt-replay | 3 | 0 | 0 | ✅ |
| **合计** | **8** | **1** | - | 8/9 (88.9%) |

## 🔴 失败用例详情

### `sales-replay-internal-price-identity-001`

**日志位置**: `test-reports/_sales-stt.log`, `reports/dynamic-actions-sales-real-stt/replay-report.json`
**测试 fixture**: `tests/fixtures/dynamic-actions/replay/replay-manifest.json`
**音频**: `tests/fixtures/dynamic-actions/replay/audio/sales-internal-price-identity-001.wav`(synthetic)
**来源 fixture**: `tests/fixtures/dynamic-actions/product/sales.json#sales-negative-mixed-011`
**coverage 标签**: `["identity_mismatch", "pricing_false_positive_guard", "technical_requirements"]`
**语言**: `mixed` / speakerCount: 3

**单元测试期望**(`electron/services/qa/__tests__/DynamicActionReplayRunner.test.mjs`):
```js
assert.equal(byId.get('sales-replay-internal-price-identity-001')?.status, 'passed');
assert.equal(byId.get('sales-replay-internal-price-identity-001')?.emitted, false);
```

**实际结果(真实 STT)**:
```json
{
  "id": "sales-replay-internal-price-identity-001",
  "status": "failed",
  "reason": "dynamic_action_expectation_mismatch",
  "emitted": true,                    ← 应为 false (无动作)
  "actionType": "technical_requirements",  ← 应无动作
  "transcriptLength": 255
}
```

**根因分析**:
- 这是一个**负样本**fixture: 销售在讨论客户身份错配时,应避免错误触发 pricing / technical_requirements 类动作。
- 用合成 STT 模拟时,引擎正确识别"无明确动作" → `emitted: false`,test PASS。
- 接入真实 STT(QCLOUD)后,识别出的 transcript 触发了 `technical_requirements`,违反 `pricing_false_positive_guard` 防护。
- transcript 长度差异显著:真实 STT 转写 255 字符 vs 合成可能更短,导致 dynamic-action 关键词命中阈值被突破。

**修复方向**(按 CLAUDE.md 规则 #3):
1. **优先更新测试期望** — 如果真实 STT 输出语义上确实更合理(技术需求是会议真实主题),更新 fixture 期望为 `technical_requirements` 或干脆删除此负样本;
2. **强化 false-positive 防护** — 如果 `technical_requirements` 不该出现,在 `IntentClassifier` 中增强 `pricing_false_positive_guard` 的抑制逻辑;
3. **CI 期望调整** — 在 `DynamicActionReplayRunner.test.mjs` 中区分 synthetic / real STT 路径,允许真实 STT 出现少量预期偏差。

**未改代码原因**: 真实意图不明确 — 该 fixture 究竟是"任何情况下都应无动作"还是"不应触发 pricing,但可触发 technical_requirements"? 需人工确认。

## 已通过的 STT 重放用例详情

### sales (2 passed)
- `sales-replay-pricing-objection-zh-001` — pricing_objection ✅ (zh, transcriptLen=239)
- `sales-replay-case-proof-mixed-001` — case_study_request ✅ (mixed, transcriptLen=140)

### fde (2 passed)
- `fde-replay-risk-blocker-zh-001` — fde_risk_blocker ✅
- `fde-replay-discovery-probe-mixed-001` — fde_discovery_probe ✅

### team-meet (1 passed)
- `team-meet-replay-action-item-zh-001` — action_item ✅

### recruiting (3 passed)
- `recruiting-replay-candidate-concern-zh-001` — candidate_concern ✅
- `recruiting-replay-experience-probe-en-001` — candidate_experience_probe ✅
- `recruiting-replay-identity-mismatch-mixed-001` — passed ✅

## 日志文件

| 重放 | 日志路径 |
|------|----------|
| sales | `test-reports/_sales-stt.log` |
| fde | `test-reports/_fde-stt.log` |
| team-meet | `test-reports/_team-meet-stt.log` |
| recruiting | `test-reports/_recruiting-stt.log` |
| 结构化报告 | `reports/dynamic-actions-{mode}-real-stt/replay-report.json` |

## 修复优先级建议

1. **P1**: 同步 `run-test-all.mjs` 加载 `.env`,避免误报 BLOCKED(`import 'dotenv/config'` 一行修复)。
2. **P1**: 决定 `sales-replay-internal-price-identity-001` 的真实语义意图 — 更新 fixture 期望 OR 强化 false-positive 防护。
3. **P3**: 在 `DynamicActionReplayRunner.test.mjs` 中区分 synthetic / real STT 路径,允许真实 STT 出现少量预期偏差。

## 与上一轮全量测试的差异

| 阶段 | 上轮 (test:all) | 本轮 (直接调用) |
|------|-----------------|------------------|
| sales-real-stt-replay | BLOCKED | 2P / 1F |
| fde-real-stt-replay | BLOCKED | 2P / 0F |
| team-meet-real-stt-replay | BLOCKED | 1P / 0F |
| recruiting-real-stt-replay | BLOCKED | 3P / 0F |

**重要发现**: 之前 test:all 把 4 个 STT replay 标为 BLOCKED 是**误报**。它们本应能跑。本次直接调用后,fde/team-meet/recruiting 全部通过,仅 sales 出现 1 个 false-positive 回归。