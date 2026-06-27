# References — 分布式系统课程参考书目

> **Scenario DocSubtype**: `references`
> **场景模式**: Lecture
> **用途**:Master transcript 段 4 讲座场景,Natively 应基于本参考书目回答"看什么书"类问题。

---

## 必读教材

### Designing Data-Intensive Applications (DDIA)

- 作者:Martin Kleppmann
- 出版社:O'Reilly,2017
- 推荐章节:
  - 第 5 章:Replication(复制)
  - 第 6 章:Partitioning(分片)
  - 第 7 章:Transactions(事务)
  - 第 8 章:Distributed Systems(分布式系统)
  - 第 9 章:Consistency and Consensus(一致性与共识)
- 在线版:dataintensive.net
- 中文版:华中科技大学出版社

## 必读论文

### Paxos 家族

- **The Part-Time Parliament**(Paxos 原始论文,Lamport 1998)
  - 通俗但难懂,以希腊寓言为背景
- **Paxos Made Simple**(Lamport 2001)
  - 简化的 Paxos 表述,推荐先读这篇
- **Cheap Paxos**(Lamport 2004)
  - 优化版本

### Raft

- **In Search of an Understandable Consensus Algorithm**(Ongaro & Ousterhout 2014)
  - 推荐作为共识算法入门
- 学生实现版本:raft.github.io

### 一致性哈希

- **Consistent Hashing and Random Trees**(Karger et al. 1997)
  - 原始论文,理论性较强
- **Dynamo: Amazon's Highly Available Key-value Store**(DeCandia et al. 2007)
  - 工业实践

### 分布式存储

- **Bigtable: A Distributed Storage System for Structured Data**(Chang et al. 2008)
- **The Google File System**(Ghemawat et al. 2003)
- **Spanner: Google's Globally-Distributed Database**(Corbett et al. 2012)
  - TrueTime + 外 consistency 的代表作
- **Cassandra: A Decentralized Structured Storage System**(Lakshman & Malik 2010)

### 消息系统

- **Kafka: a Distributed Messaging System for Log Processing**(Kreps et al. 2011)

## 推荐阅读(非必读)

### 工业博客

- AWS Builder's Library:https://aws.amazon.com/builders-library/
- Google Cloud 架构博客
- Cloudflare 博客(网络层)
- Uber 工程博客

### 进阶教材

- **Introduction to Reliable and Secure Distributed Systems**(Christian Cachin et al.)
  - 偏理论,形式化方法
- **Distributed Systems: Concepts and Design**(George Coulouris et al.)
  - 经典教材,概念全面
- **Introduction to Distributed Algorithms**(Gerard Tel)
  - 偏数学

### 中文资料

- 《数据密集型应用系统设计》中文版
- 《分布式技术原理与算法解析》(极客时间)
- 《深入理解分布式系统》(唐伟志)

## 实验参考

### Raft 实现

- MIT 6.824 Lab 2/3/4:经典 Raft 实现教学
- etcd Raft 实现:https://github.com/etcd-io/raft
- Hashicorp Raft 实现:https://github.com/hashicorp/raft

### Paxos 实现

- Phxpaxos(Tencent 开源)
- LibPaxos(教学用)

### 分布式 KV

- MIT 6.824 Lab 4(Sharded KV)
- TiKV:https://github.com/tikv/tikv
- CockroachDB:https://github.com/cockroachdb/cockroach

## 视频资源

- MIT 6.824 课程视频(YouTube)
- CMU 15-440 分布式系统
- Raft 作者 Ongaro 的博士答辩
- Paxos Made Live(Google 工程实践)

---

## Natively 应提供的辅助

### 当学生问"看什么书入门"时

Natively 应基于本参考书目回答:
> "入门推荐两本:
> 1. DDIA 第 5-9 章(中文版质量很好,翻译自然)
> 2. Raft 论文(Ongaro 2014,40 页,易于理解)
>
> 如果只读一篇,推荐 Raft 论文 —— 它把共识问题讲清楚了。"

### 当学生问"Paxos 和 Raft 区别"时

Natively 应基于本参考书目回答:
> "Paxos 早于 Raft(1998 vs 2014),理论更通用但难懂。
> Raft 是 Paxos 的简化版,目标是'可理解性',牺牲了一些灵活性换易教学。
> 工业界两者都用:Raft 用于 etcd/Consul,Paxos 用于 Chubby/Megastore。"

---

## 关联材料

- 听众画像:`./audience_profile.md`
- 讲纲:`./outline.md`