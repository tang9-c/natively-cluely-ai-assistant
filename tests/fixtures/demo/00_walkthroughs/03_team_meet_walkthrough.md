# Walkthrough — Team Meet 场景演示

> 演示团队会议模式下,行动项自动捕获 + 决策日志 + 风险登记 + 期间摘要。

---

## 场景设定

**会议类型**:Natively 工程团队周会
**参与人**:Mei Wong(PM,主持)、Alex Chen(技术)、Risky/Tom(后端)、Sarah Lin(前端)、Jordan Lee(QA)、Emma Wu(SRE)
**时长**:60 分钟
**本次重点**:搜索服务优化、支付回调、Postgres 升级决策

---

## 加载步骤

### 步骤 1:创建/激活 Team Meet 模式(1 分钟)

1. Modes → Create Mode
2. 模板选"团队会议(Team Meet)"
3. 命名:"Team Meet Demo"
4. 设为 Active

### 步骤 2:上传 Team Meet 模式参考文件(2 分钟)

把以下 4 份文件上传到 Team Meet 模式:

| 文件 | 用途 | docSubtype |
|---|---|---|
| `04_mode_reference_files/team-meet/attendees.md` | 与会人员 | attendees |
| `04_mode_reference_files/team-meet/agenda.md` | 会议议程 | agenda |
| `04_mode_reference_files/team-meet/decision_log.md` | 决策记录 | decision-log |
| `04_mode_reference_files/team-meet/references.md` | 参考资料 | references |

### 步骤 3:上传知识库资料(2 分钟)

上传 3 份 KB(同 Sales 场景)。

---

## 录制步骤(1.5 分钟)

```
[02:30] Mei: OK 切到周会。先过状态,搜索服务那块现在如何?上次说有性能问题。

[02:38] Alex: 我来做 P99 优化,周五前出 patch,PR 我来提。

[02:44] Mei: 收到。下一个,Risky 的支付回调卡在第三方,这事会赶不上 release,谁接手?

[02:52] Alex: 我跟进这个,等下找 Risky,周三前给个时间线。

[02:58] Mei: 好。决策项,就用 Postgres 17,不用升级到 18 了?上回大家同意那次投票结果算数吗?

[03:08] Alex: 数。但最终决定我得再过一遍 legal 合规,周一前出结论。

[03:18] Mei: 行。Marketing site copy review 分配给 Sarah,周三前完事。

[03:28] Alex: 收到,我同步给她。

[03:35] Mei: 接下来讲一下 launch checklist,Sarah 的部分谁来接?
```

或使用片段:`05_segment_clips/seg3_team_meet.md`

---

## 预期触发清单(5 项)

| 时间 | 触发语句 | Intent | Assist | 预期 UI |
|---|---|---|---|---|
| 2:30 | "现在如何" | `status_update` | `runWhatShouldISay` | 弹出状态摘要 |
| 2:38 | "我来做" + "周五前" | `capture_action` | 自动写入行动卡 | Owner: Alex / Deadline: 周五 / Action: P99 优化 |
| 2:44 | "卡在第三方" + "会赶不上" | `capture_risk` | 自动写入风险卡 | Severity: 高 / Impact: release 延期 |
| 2:58 | "就用 Postgres 17" | `capture_decision` | 自动写入决策日志 | Decision: 维持 PG17 / Pending: legal 合规 |
| 段末 | (整体) | — | `runRecap` | 弹出整段摘要 |

---

## 可触发的功能清单(本场景 7 个)

1. ✅ `runWhatShouldISay` — 状态摘要
2. ✅ `runRecap` — 段末摘要
3. ✅ 自动 `capture_action` — 行动卡生成
4. ✅ 自动 `capture_decision` — 决策日志
5. ✅ 自动 `capture_risk` — 风险卡生成
6. ✅ RAG 检索(`attendees.md` / `agenda.md` / `decision_log.md`)
7. ✅ 模式 prompt 注入(`MODE_TEAM_MEET_PROMPT`)

---

## 行动卡生成示例

### 自动捕获的 3 张行动卡

```
📋 行动卡 1
- Title: 搜索服务 P99 优化
- Owner: Alex Chen
- Deadline: 周五前(2026-07-03)
- Source: master_transcript 段 3 [02:38]
- Type: code_optimization
- Status: pending
```

```
📋 行动卡 2
- Title: 支付回调时间线确认
- Owner: Risky Wang
- Deadline: 周三前(2026-07-01)
- Source: master_transcript 段 3 [02:52]
- Type: external_coordination
- Status: pending
```

```
📋 行动卡 3
- Title: Marketing site copy review
- Owner: Sarah Lin
- Deadline: 周三前(2026-07-01)
- Source: master_transcript 段 3 [03:18]
- Type: content_review
- Status: pending
```

### 自动捕获的 1 张风险卡

```
⚠️ 风险卡 1
- Title: 支付回调可能延期 release
- Severity: 高
- Owner: Risky Wang
- Impact: release 延期 1 周
- Mitigation: 周三前给时间线
- Source: master_transcript 段 3 [02:44]
```

### 自动捕获的 1 条决策

```
✅ 决策 D-2026-06-27
- Title: Postgres 维持 17(不升级 18)
- Background: 上回投票 6:2 通过,本次确认
- Pending: legal 合规确认(周一前)
- Owner: Alex Chen
- Source: master_transcript 段 3 [02:58]
```

---

## 回放检查清单

- [ ] Team Meet 模式已激活
- [ ] 4 份参考文件已上传
- [ ] 3 份 KB 已上传
- [ ] 2:30 `status_update` 触发
- [ ] 2:38 `capture_action` 触发,生成 1+ 张行动卡
- [ ] 2:44 `capture_risk` 触发,生成风险卡
- [ ] 2:58 `capture_decision` 触发,生成决策记录
- [ ] 段末 `runRecap` 触发

---

## 进阶演示

### 场景 A:行动卡下游同步

行动卡生成后,演示:
- 点击行动卡 → 显示 owner / deadline / source 引用
- 一键推送到 Linear / GitHub Issues
- 关联到对应文档(`agenda.md` 中的待办)

### 场景 B:风险登记联动

风险卡生成后:
- 弹出 RAG 检索命中 `references.md` 中的"风险登记册"
- 显示当前 12 个风险中"支付回调"已存在(如果存在)
- 一键同步到 Notion 风险登记册

---

## 关联材料

- Master transcript 段 3:`../../03_master_transcript/master_transcript.md`
- 团队会议参考文件:`../../04_mode_reference_files/team-meet/`
- 知识库:`../../02_knowledge_base/`
- 单场景片段:`../../05_segment_clips/seg3_team_meet.md`
- 总览:`./00_overview.md`