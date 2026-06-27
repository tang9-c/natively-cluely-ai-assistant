# Course Outline — 分布式系统 12 讲

> **Scenario DocSubtype**: `outline`
> **场景模式**: Lecture
> **用途**:Master transcript 段 4 讲座场景,Natively 应基于本讲纲识别"这是第几讲 + 主题"。

---

## 课程结构

### 总览

- **学分**:3
- **总周数**:16 周
- **讲课**:12 讲(每周 1 讲,每讲 90 分钟)
- **实验**:3 个(期中 + 期末 + 大作业)
- **考核**:平时 30% + 实验 30% + 期末 40%

## 12 讲大纲

### 第 1 讲:分布式系统概论

- 什么是分布式系统
- CAP 定理
- 为什么需要分布式
- 案例:GFS / Bigtable / MapReduce

### 第 2 讲:一致性模型

- 强一致性 / 弱一致性 / 最终一致性
- 线性一致性(Linearizability)
- 因果一致性(Causal Consistency)
- 顺序一致性(Sequential Consistency)

### 第 3 讲:时间与全局状态

- 物理时钟 vs 逻辑时钟
- Lamport Clock
- Vector Clock
- 全局快照(Chandy-Lamport)

### 第 4 讲:一致性问题定义

- 共识问题(Consensus)
- 原子广播(Atomic Broadcast)
- 广播问题等价
- FLP 不可能性

### 第 5 讲:Paxos 算法

- Basic Paxos
- Multi-Paxos
- 角色:Proposer / Acceptor / Learner
- 案例:Chubby / Megastore

### 第 6 讲:Raft 算法 ⭐

- Leader Election
- Log Replication
- Safety 保证
- 案例:etcd / Consul

### 第 7 讲:分布式事务

- 2PC
- 3PC
- Saga 模式
- Percolator

### 第 8 讲:分布式存储(1)— 分片

- 一致性哈希 ⭐(本节演示对应讲次)
- 虚拟节点(Vnode)
- 数据再平衡
- 案例:Dynamo / Cassandra

### 第 9 讲:分布式存储(2)— 复制

- 主从复制
- 多主复制
- 无主复制
- Quorum 机制

### 第 10 讲:分布式存储(3)— 事务与索引

- 分布式 B+ 树
- LSM 树
- 分布式二级索引
- 案例:TiDB / CockroachDB

### 第 11 讲:消息系统

- 消息队列 vs 日志
- Kafka 架构
- Exactly-Once 语义
- 案例:Kafka / Pulsar

### 第 12 讲:综合案例 + 期末复习

- 工业级分布式系统对比(Spanner / CockroachDB / Cassandra)
- 期末复习
- Q&A

## 实验设计

### 实验 1:实现 Raft(期中)

- 用 Go 实现 Raft 共识算法
- 包含 Leader Election + Log Replication
- 通过单元测试 + 故障注入测试
- 截止:第 8 周

### 实验 2:实现分布式 KV(期末)

- 基于 Raft 实现 KV 存储
- 包含分片 + 快照
- 截止:第 14 周

### 大作业(可选):研究 + 实现

- 自选主题(如实现 Paxos / 写一个 mini-Spanner)
- 提交报告 + 代码
- 截止:第 16 周

## 推荐阅读

- DDIA 第 5、6、7、8、9 章
- Raft 论文(In Search of an Understandable Consensus Algorithm)
- Paxos 论文(Paxos Made Simple)
- Dynamo 论文
- Spanner 论文

---

## Natively 应提供的辅助

### 当教授讲"consistent hashing"时

Natively 应识别:
- 这是第 8 讲:分布式存储(1)— 分片
- 主题:一致性哈希
- 关联讲次:第 6 讲 Raft、第 9 讲复制

### 当学生问"vnode"时

Natively 应基于本大纲给出上下文:
> "vnode 是虚拟节点,用于解决一致性哈希的数据倾斜问题。
> 在第 8 讲的下半段会展开讲 Dynamo/Cassandra 的工业实践。"

### 当学生问"为什么用 160 位"时

Natively 应基于本大纲引导到第 8 讲的下半段:
> "这个问题涉及 vnode 的位数选择,跟哈希冲突概率和 CPU 指令效率相关。
> 让我们先记下来,第 8 讲讲 vnode 实现细节时再展开。"

---

## 关联材料

- 听众画像:`./audience_profile.md`
- 参考资料:`./references.md`