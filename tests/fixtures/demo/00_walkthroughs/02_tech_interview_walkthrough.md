# Walkthrough — Technical Interview 场景演示

> 演示技术面试模式下,系统设计追问 + Coding 脚手架 + 行为面试 STAR 提示 + Profile 简历引用。

---

## 场景设定

**面试官**:Priya Shah(Datacraft 工程经理)
**候选人**:Alex Chen(被辅助的用户)
**目标**:Senior LLM Application Engineer 岗位
**面试时长**:45 分钟,前 20 分钟系统设计,后 25 分钟 coding

---

## 加载步骤

### 步骤 1:创建/激活 Technical Interview 模式(1 分钟)

1. Modes → Create Mode
2. 模板选"技术面试(Technical Interview)"
3. 命名:"Tech Interview Demo"
4. 设为 Active

### 步骤 2:上传 Tech Interview 模式参考文件(2 分钟)

把以下 3 份文件上传到 Tech Interview 模式:

| 文件 | 用途 | docSubtype |
|---|---|---|
| `04_mode_reference_files/technical-interview/technical_spec.md` | 系统设计题 | technical-spec |
| `04_mode_reference_files/technical-interview/rubric.md` | 评分卡 | rubric |
| `04_mode_reference_files/technical-interview/practice_problem.md` | Coding 题 | practice-problem |

操作:
- Modes → 选 Tech Interview Demo → Reference Files → Upload
- 逐个上传

### 步骤 3:上传知识库资料(2 分钟)

上传 3 份 KB(同 Sales 场景):
- `02_knowledge_base/kb_natively_product_overview.md`
- `02_knowledge_base/kb_competitor_matrix.csv`
- `02_knowledge_base/kb_objection_playbook.md`

### 步骤 4:不需要关联 Profile

本场景不关联 Profile(留给 FDE 场景演示)。

---

## 录制步骤(1.5 分钟)

把以下内容复制到 Transcript 输入框,或用 TTS 播放:

```
[01:15] Priya: 我们今天聊 45 分钟,前 20 分钟系统设计,后面 coding。我看了你简历,Datacraft 的订单系统是你从头搭的吗?

[01:25] Alex: 是的,峰值 1 万 QPS,我带着两个人做的。

[01:30] Priya: 能详细讲讲你当时为什么选 PostgreSQL 而不是 Cassandra?数据量到什么量级之后呢?

[01:40] Alex: 当时日订单 200 万,五年增长预测到日 5000 万。Postgres 单机分区表能扛到 8000 万/天,超过才考虑 Cassandra。举个例子,订单表按 user_id 哈希分 64 个分区,...

[02:00] Priya: OK,明白了。那我们切到 coding 环节。写一下代码实现一个 LRU 缓存,get 和 put 都是 O(1)。

[02:10] Alex: 用双向链表加哈希表,get 把节点移到头,put 满了就删尾巴。class DLinkedNode: def __init__(self, key=0, value=0): self.key = key; self.value = value; self.prev = None; self.next = None。然后维护 head 和 tail 哨兵节点,容量到了就 pop_tail,把对应 key 从 dict 里删掉。

[02:25] Priya: 嗯,如果再多说一下并发场景呢?多线程读怎么保证一致?
```

或使用片段:`05_segment_clips/seg2_tech_interview.md`

---

## 预期触发清单(4 项)

| 时间 | 触发语句 | Intent | Assist | 预期 UI |
|---|---|---|---|---|
| 1:30 | "能详细讲讲" | `deep_dive` | `runWhatShouldISay` | 弹出 Postgres vs Cassandra 详细对比 |
| 1:40 | "举个例子" | `example_request` | `runClarify` | 提示"可展开订单分区细节" |
| 2:00 | "写一下代码" | `coding` | `runCodeHint` | 弹出 LRU 脚手架 + 边界 case |
| 2:25 | "再多说一下并发" | `deep_dive` | `runWhatShouldISay` | 弹出并发补丁(读写锁 / 分段锁) |

---

## 可触发的功能清单(本场景 6 个)

1. ✅ `runWhatShouldISay` — 技术细节展开
2. ✅ `runClarify` — 追问建议
3. ✅ `runCodeHint` — Coding 脚手架
4. ✅ RAG 检索(`technical_spec.md` / `practice_problem.md`)
5. ✅ 模式 prompt 注入(`MODE_TECHNICAL_INTERVIEW_PROMPT`)
6. ✅ Intent detection(coding / deep_dive / example_request)

---

## 回放检查清单

- [ ] Technical Interview 模式已激活
- [ ] 3 份参考文件已上传
- [ ] 3 份 KB 已上传
- [ ] 1:30 `deep_dive` 触发,AI 给出技术对比
- [ ] 1:40 `example_request` 触发,AI 给出追问建议
- [ ] 2:00 `coding` 触发,`runCodeHint` 弹出脚手架
- [ ] 2:25 `deep_dive` 触发,AI 给出并发方案

---

## 进阶演示

### 场景 A:对照 looking-for-work 模式

切到 Looking-for-work 模式重放同一段对话:
- 系统 prompt 切换到"求职候选人"视角
- AI 给出的建议从"面试官追问"变成"候选人怎么答更好"
- 同一份 transcript 在不同 scenario 下输出方向相反

### 场景 B:Coding 题深度

修改 Priya 的话:"再多说一下并发场景,具体怎么实现?"
- 应触发 KB 检索 `practice_problem.md` 的"扩展 1:并发安全"
- AI 应给出 Python 读写锁 / 分段锁 / 无锁 3 种方案对比

---

## 关联材料

- Master transcript 段 2:`../../03_master_transcript/master_transcript.md`
- 技术面试参考文件:`../../04_mode_reference_files/technical-interview/`
- 知识库:`../../02_knowledge_base/`
- 单场景片段:`../../05_segment_clips/seg2_tech_interview.md`
- 总览:`./00_overview.md`