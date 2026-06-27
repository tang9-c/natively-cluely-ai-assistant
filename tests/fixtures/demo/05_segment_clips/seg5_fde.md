# Segment 5 — FDE 单场景快闪片段

> 30 秒版本,用于 FDE 模式快速演示。

---

## 对话稿(30 秒)

```
[00:00] Sam: 我们想两周内原型出 Notion 到 SQL 的双向同步,当前流程手动 4 小时/天。

[00:05] Alex: 我深入讲一下方案:dbt + Airbyte 增量,不改造 Notion,只读 + 写回。

[00:10] Sam: 安全这边能详细讲吗?我们的客户表里有 PII,审计日志怎么存?

[00:15] Alex: 字段级加密 + Postgres RLS,审计走 CloudTrail,数据驻留留 us-east-1。

[00:20] Sam: 那就这样定:周一 kickoff,周三中间检查点,周五演示。

[00:25] Alex: 收到,我来写项目计划,今天内发出来。
```

## 预期触发

- 0:00 `deep_dive` → `runWhatShouldISay`(方案展开)
- 0:05 `deep_dive` → KB 检索 `security_requirements.md`
- 0:10 KB 命中 + `runWhatShouldISay`
- 0:20 `capture_decision` → 决策写入
- 段末 `runBrainstorm`

## 适用场景

- 30 秒快闪 demo
- FDE 模式快速验证
- Profile 智能 + KB 检索 + 决策捕获组合演示

## 关联材料

- 完整版:`../03_master_transcript/master_transcript.md` 段 5
- 加载步骤:`../00_walkthroughs/05_fde_walkthrough.md`