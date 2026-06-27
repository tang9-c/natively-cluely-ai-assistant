# Segment 3 — Team Meet 单场景快闪片段

> 30 秒版本,用于 Team Meet 模式快速演示。

---

## 对话稿(30 秒)

```
[00:00] Mei: 搜索服务那块现在如何?上次说有性能问题。

[00:05] Alex: 我来做 P99 优化,周五前出 patch,PR 我来提。

[00:10] Mei: Risky 的支付回调卡在第三方,这事会赶不上 release,谁接手?

[00:15] Alex: 我跟进这个,等下找 Risky,周三前给个时间线。

[00:20] Mei: 决策项,就用 Postgres 17,不用升级 18 了?

[00:25] Alex: 数,但最终决定我得再过一遍 legal 合规,周一前出结论。
```

## 预期触发

- 0:00 `status_update` → `runWhatShouldISay`
- 0:05 `capture_action` → 行动卡(P99 优化)
- 0:10 `capture_risk` → 风险卡(支付回调)
- 0:20 `capture_decision` → 决策日志(Postgres 17)

## 适用场景

- 30 秒快闪 demo
- 团队会议功能快速验证
- 行动项 / 风险 / 决策自动捕获演示

## 关联材料

- 完整版:`../03_master_transcript/master_transcript.md` 段 3
- 加载步骤:`../00_walkthroughs/03_team_meet_walkthrough.md`