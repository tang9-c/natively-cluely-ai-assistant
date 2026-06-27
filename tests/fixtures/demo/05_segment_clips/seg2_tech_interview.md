# Segment 2 — Tech Interview 单场景快闪片段

> 30 秒版本,用于 Technical Interview 模式快速演示。

---

## 对话稿(30 秒)

```
[00:00] Priya: 你简历上 Datacraft 的订单系统是你从头搭的吗?

[00:05] Alex: 是的,峰值 1 万 QPS,两个人做了一年。

[00:10] Priya: 能详细讲讲你为什么选 PostgreSQL?数据量到 5000 万/天后呢?

[00:15] Alex: Postgres 单机分区表能扛到 8000 万/天,超过才考虑 Cassandra。举个例子,订单表按 user_id 哈希分 64 个分区。

[00:20] Priya: 写一下代码实现一个 LRU 缓存,get 和 put 都是 O(1)。

[00:25] Alex: 用双向链表加哈希表,get 把节点移到头,put 满了就删尾巴。
```

## 预期触发

- 0:10 `deep_dive` → `runWhatShouldISay`(技术对比)
- 0:15 `example_request` → `runClarify`(追问建议)
- 0:20 `coding` → `runCodeHint`(LRU 脚手架)

## 适用场景

- 30 秒快闪 demo
- Coding 能力快速验证
- 系统设计能力验证

## 关联材料

- 完整版:`../03_master_transcript/master_transcript.md` 段 2
- 加载步骤:`../00_walkthroughs/02_tech_interview_walkthrough.md`