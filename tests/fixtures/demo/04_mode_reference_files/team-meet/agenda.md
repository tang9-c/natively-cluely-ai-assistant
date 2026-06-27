# Agenda — 周会议程

> **Scenario DocSubtype**: `agenda`
> **场景模式**: Team Meet
> **用途**:Master transcript 段 3 周会,Natively 应基于本议程结构捕获状态更新、行动项、决策、风险。

---

## 周会议程模板

### 总时长:60 分钟

| 时段 | 内容 | 主持人 |
|---|---|---|
| 0:00 - 0:05 | 回顾上周行动项 | Mei |
| 0:05 - 0:20 | 状态更新 | 全员 |
| 0:20 - 0:35 | 风险与阻塞评审 | Mei |
| 0:35 - 0:50 | 决策项 | 全员 |
| 0:50 - 0:55 | 行动项分配 | Mei |
| 0:55 - 1:00 | 其他 + 下次会议时间 | Mei |

## 本周议程(对应 master transcript 段 3)

### 1. 状态更新(0:05 - 0:20)

#### Risky — 支付回调
- 上周状态:进度 60%,银行 SDK 集成卡住
- 本周目标:协调银行 SDK 给出时间线

#### Tom — 搜索服务 P99 优化
- 上周状态:开始 profile
- 本周目标:出 patch,提 PR

#### Sarah — Marketing site copy review
- 上周状态:等文案
- 本周目标:周三前完成

#### Jordan — 测试覆盖率
- 上周状态:核心服务覆盖率 75%
- 本周目标:推到 85%

#### Emma — 生产事故
- 上周状态:无 P0/P1
- 本周目标:跟进上周 P2 修复

### 2. 风险评审(0:20 - 0:35)

| 风险 | Owner | 状态 | 缓解方案 |
|---|---|---|---|
| 银行 SDK 集成阻塞 release | Risky | 高 | 本周给时间线,可能延期 1 周 |
| Postgres 18 升级决策未决 | Alex | 中 | 周一前出合规结论 |
| Marketing site 文案延期 | Sarah | 中 | 周三截止 |
| Frontend 性能问题 | Sarah | 低 | 下周讨论 |

### 3. 决策项(0:35 - 0:50)

#### D1:Postgres 17 vs 18 升级

- **背景**:上回投票倾向 Postgres 17,但需 legal 合规确认
- **选项**:A) 维持 17 / B) 升级 18 / C) 推迟决策
- **决策**:周一前 Alex 出合规结论
- **影响**:数据库性能、新特性可用性

#### D2:launch checklist 中 Sarah 部分分工

- **背景**:Sarah 负责 Marketing 部分,但工作量已满
- **选项**:A) Sarah 加班 / B) 临时招人 / C) 砍掉一部分
- **决策**:本次会议决定

### 4. 行动项分配(0:50 - 0:55)

- Alex:Postgres 合规结论(周一前)
- Risky:支付回调时间线(周三前)
- Tom:搜索服务 PR(周五前)
- Sarah:Marketing site copy(周三前)

---

## Natively 应捕获的内容

### 状态更新(`status_update`)

```
"搜索服务那块现在如何?上次说有性能问题。"
→ Natively 应识别为 status_update,并基于本议程"Tom — 搜索服务 P99 优化"给出上下文
```

### 行动项(`capture_action`)

```
"我来做 P99 优化,周五前出 patch,PR 我来提。"
→ 自动生成行动卡:
  - Title: 搜索服务 P99 优化
  - Owner: Alex Chen
  - Deadline: 周五前
  - Type: code_optimization
```

### 风险(`capture_risk`)

```
"Risky 的支付回调卡在第三方,这事会赶不上 release,谁接手?"
→ 自动生成风险卡:
  - Title: 支付回调可能延期
  - Owner: Risky Wang
  - Severity: 高
  - Impact: release 延期 1 周
```

### 决策(`capture_decision`)

```
"就用 Postgres 17,不用升级到 18 了?"
→ 自动生成决策记录:
  - Decision: 维持 Postgres 17
  - Background: 合规 + 投票结果
  - Pending: Legal 合规确认(周一前)
```

---

## 关联材料

- 与会人员:`./attendees.md`
- 历史决策:`./decision_log.md`
- 参考资料:`./references.md`