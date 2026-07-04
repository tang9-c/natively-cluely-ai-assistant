# Master Demo Transcript — Natively 多场景演示稿

> **总时长**:约 6 分钟(5 段,每段 60-90 秒)
> **语言**:中文为主,夹杂英文术语(模拟真实会议风格)
> **说话人 ID 说明**:S1 是被辅助的用户(Alex Chen),S2-S6 是不同场景的对话方。
> **触发关键词**:用 **加粗** 标注,用于演示 intent matching。
> **Speaker 映射规则**(导入 Natively 时):`S1` → `user`,其余(`S2`~`S6`)→ `interviewer`。

## 说话人卡

| ID | 姓名 | 角色 | 场景 |
|---|---|---|---|
| S1 | Alex Chen(我) | Natively 创始人 / 工程师,中文母语 | 所有段 |
| S2 | Jordan Rivera | Acme Corp 销售 VP(目标客户) | Sales |
| S3 | Priya Shah | Datacraft 工程经理(面试官) | Tech Interview |
| S4 | Mei Wong | 产品负责人(内部周会主持) | Team Meet |
| S5 | Prof. Daniel Liang | 分布式系统课程教授 | Lecture |
| S6 | Sam Patel | Beta Corp CTO(FDE 客户) | FDE |

---

## 段 1:销售场景(Sales)— 0:00 - 1:15

> **情绪演示**:本段覆盖 `ANGRY` / `HAPPY` 两种情绪。SenseVoice 输出在每行前自动携带 `<|zh|><|EMOTION|><|Speech|>` 元数据。

```
[00:00] <|zh|><|NEUTRAL|><|Speech|>S2 Jordan: Alex,谢谢你今天抽时间。我们这边销售团队 500 人,去年刚换了 Otter,但说实话,现在怎么衡量效果我们心里没底。你们跟 Otter 比强在哪儿?

[00:08] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 主要差在三点:第一,你们最担心的销售、招聘、客户成功三类通话,Natively 都有专门的模式,不是一刀切。第二,实时话术辅助是 Otter 没有的,边听边给建议。第三,长会后能直接出客户档案更新和下一步邮件。

[00:22] <|zh|><|ANGRY|><|Speech|>S2 Jordan: 听起来不错。但价格太高了吧?500 个席位按你说的方案年付,预算这一关就过不了。

[00:30] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 我理解。我们算过 ROI,一线销售每月 8 场高价值通话,每场多成单 1 单意味着 60 单/年,光这一项就把 500 席位的年费盖了。要不要我把这套算法按你们 500 人调一遍发过去?

[00:45] <|zh|><|NEUTRAL|><|Speech|>S2 Jordan: 算 ROI 那个可以发我。我们 CFO 这周在,下周想推进到法务审核那一步。你看你们能配合出个方案简介吗?

[00:52] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 没问题。我今天会议结束就发一版报价给你,CFO 看的简化版,周一上午 10 点我们对一下?

[00:58] <|zh|><|HAPPY|><|Speech|>S2 Jordan: 走起,我让 Procurement 也加进来。

[01:05] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 那我先发邮件草稿,这边会中我顺便把客户档案的更新点列出来,会议后自动存档。

[01:12] <|zh|><|HAPPY|><|Speech|>S2 Jordan: 完美,期待收到。
```

**预期触发清单**

| 时间 | 说话人 | 触发语句 | Emotion | Intent | Assist 功能 |
|---|---|---|---|---|---|
| 0:00 | S2 | "现在怎么衡量效果" | NEUTRAL | `discovery_probe` | `runWhatShouldISay` |
| 0:22 | S2 | "价格太高了" | **ANGRY** | `handle_objection` | `runWhatShouldISay` + KB 检索 + 情绪徽章(愤怒) |
| 0:45 | S2 | "下周想推进到法务审核" | NEUTRAL | `seize_signal` | `runWhatShouldISay`(下一步清单) |
| 0:52 | S1 | "发一版报价" | NEUTRAL | (confirm) | `detectConfirmAndEmitDynamicActions`(邮件草稿) |
| 0:58 | S2 | "走起" | **HAPPY** | — | 情绪徽章(开心)+ LLM `<emotion_context>` 提示 |
| 1:12 | S2 | "完美,期待收到" | **HAPPY** | — | 情绪徽章(开心,4 秒闪现) |
| 0:00-1:12 | 整体 | — | — | — | `runRecap`(中段摘要) |

---

## 段 2:技术面试(Technical Interview)— 1:15 - 2:30

```
[01:15] <|zh|><|NEUTRAL|><|Speech|>S3 Priya: 我们今天聊 45 分钟,前 20 分钟系统设计,后面 coding。我看了你简历,Datacraft 的订单系统是你从头搭的吗?

[01:25] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 是的,峰值 1 万 QPS,我带着两个人做的。

[01:30] <|zh|><|NEUTRAL|><|Speech|>S3 Priya: 能详细讲讲你当时为什么选 PostgreSQL 而不是 Cassandra?数据量到什么量级之后呢?

[01:40] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 当时日订单 200 万,五年增长预测到日 5000 万。Postgres 单机分区表能扛到 8000 万/天,超过才考虑 Cassandra。举个例子,订单表按 user_id 哈希分 64 个分区,...

[02:00] <|zh|><|NEUTRAL|><|Speech|>S3 Priya: OK,明白了。那我们切到 coding 环节。写一下代码实现一个 LRU 缓存,get 和 put 都是 O(1)。

[02:10] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 用双向链表加哈希表,get 把节点移到头,put 满了就删尾巴。我先写个 Python 版本:

class DLinkedNode:
    def __init__(self, key=0, value=0):
        self.key = key
        self.value = value
        self.prev = None
        self.next = None

[02:18] <|zh|><|NEUTRAL|><|Speech|>S1 Alex(继续): 然后维护 head 和 tail 哨兵节点,容量到了就 pop_tail,把对应 key 从 dict 里删掉。get 是 O(1),put 平均也是 O(1)。

[02:25] <|zh|><|NEUTRAL|><|Speech|>S3 Priya: 嗯,如果再多说一下并发场景呢?多线程读怎么保证一致?
```

**预期触发清单**

| 时间 | 说话人 | 触发语句 | Emotion | Intent | Assist 功能 |
|---|---|---|---|---|---|
| 1:30 | S3 | "能详细讲讲" | NEUTRAL | `deep_dive` | `runWhatShouldISay`(技术细节) |
| 1:40 | S1 | "举个例子" | NEUTRAL | `example_request` | `runClarify`(问要不要展开) |
| 2:00 | S3 | "写一下代码" | NEUTRAL | `coding` | `runCodeHint`(脚手架/边界) |
| 2:25 | S3 | "再多说一下并发" | NEUTRAL | `deep_dive` | `runWhatShouldISay`(并发补丁) |

---

## 段 3:团队会议(Team Meet)— 2:30 - 3:45

```
[02:30] <|zh|><|NEUTRAL|><|Speech|>S4 Mei: OK 切到周会。先过状态,搜索服务那块现在如何?上次说有性能问题。

[02:38] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 我来做 P99 优化,周五前出 patch,PR 我来提。

[02:44] <|zh|><|ANGRY|><|Speech|>S4 Mei: 收到。下一个,Risky 的支付回调卡在第三方,这事会赶不上 release,谁接手?

[02:52] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 我跟进这个,等下找 Risky,周三前给个时间线。

[02:58] <|zh|><|NEUTRAL|><|Speech|>S4 Mei: 好。决策项,就用 Postgres 17,不用升级到 18 了?上回大家同意那次投票结果算数吗?

[03:08] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 数。但最终决定我得再过一遍 legal 合规,周一前出结论。

[03:18] <|zh|><|NEUTRAL|><|Speech|>S4 Mei: 行。Marketing site copy review 分配给 Sarah,周三前完事。

[03:28] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 收到,我同步给她。

[03:35] <|zh|><|NEUTRAL|><|Speech|>S4 Mei: 接下来讲一下 launch checklist,Sarah 的部分谁来接?
```

**预期触发清单**

| 时间 | 说话人 | 触发语句 | Emotion | Intent | Assist 功能 |
|---|---|---|---|---|---|
| 2:30 | S4 | "现在如何" | NEUTRAL | `status_update` | `runWhatShouldISay`(状态摘要) |
| 2:38 | S1 | "我来做" + "周五前" | NEUTRAL | `capture_action` | 写入行动卡(自动) |
| 2:44 | S4 | "卡在第三方" | **ANGRY** | `capture_risk` | 写入风险卡 + 情绪徽章(愤怒) |
| 2:58 | S4 | "就用 Postgres 17" | NEUTRAL | `capture_decision` | 写入决策日志 |
| 2:30-3:35 | 整体 | — | — | — | `runRecap`(末段摘要) |

---

## 段 4:讲座(Lecture)— 3:45 - 5:00

```
[03:45] <|zh|><|NEUTRAL|><|Speech|>S5 Prof. Liang: 今天我们讲一致性哈希。这个叫 consistent hashing,原理是把节点和 key 都映射到同一个环上。定义为 virtual node 的概念,意思是用 vnode 解决数据倾斜问题。

[04:10] <|zh|><|NEUTRAL|><|Speech|>S5 Prof. Liang(继续): 接下来,公式推导一下。假设环长 1,有 k 个节点、n 个 key,期望每个节点承载 key 的数量是 n/k,方差大约 1/k,标准差 1/sqrt(k)。

[04:25] <|zh|><|NEUTRAL|><|Speech|>S5 Prof. Liang: 当一个节点加入或离开时,只有 1/k 比例的 key 会被重新映射,这就是相比 mod 哈希的最大优势。

[04:35] <|zh|><|NEUTRAL|><|Speech|>S5 Prof. Liang: 谁知道为什么用 160 位的 vnode 而不是 32 位?有同学能答吗?

[04:50] <|zh|><|SURPRISED|><|Speech|>S1 Alex(学生身份): 老师,能解释一下为什么不用 mod 哈希吗?具体说一下环式映射的好处?

[04:58] <|zh|><|HAPPY|><|Speech|>S5 Prof. Liang: 好问题。环式的好处是节点增减时只影响相邻节点,mod 哈希不行,任何一个节点变化都要全部重新映射。

[05:00] <|zh|><|NEUTRAL|><|Speech|>S5 Prof. Liang(继续): 下一讲我们讲 LSM 树,提前看一下第 2 讲的 outline。
```

**预期触发清单**

| 时间 | 说话人 | 触发语句 | Emotion | Intent | Assist 功能 |
|---|---|---|---|---|---|
| 3:45 | S5 | "这个叫 consistent hashing" | NEUTRAL | `explain_concept` | `runWhatShouldISay`(术语解释) |
| 4:10 | S5 | "公式推导" | NEUTRAL | `render_formula` | `runWhatShouldISay`(LaTeX 渲染) |
| 4:35 | S5 | "谁知道" | NEUTRAL | `answer_class_question` | `runManualAnswer`(学生视角) |
| 4:50 | S1 | "能解释" + "具体说" | **SURPRISED** | `clarification` + `deep_dive` | `runClarify` + 情绪徽章(惊讶) |
| 4:58 | S5 | "好问题" | **HAPPY** | — | 情绪徽章(开心)+ LLM 语气调整 |

---

## 段 5:FDE 客户现场(FDE)— 5:00 - 6:30

```
[05:00] <|zh|><|HAPPY|><|Speech|>S6 Sam: 终于联上了。Alex,我们想两周内原型出 Notion 到 SQL 的双向同步,当前流程手动 4 小时/天。

[05:10] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 我深入讲一下方案:dbt + Airbyte 增量,不改造 Notion,只读 + 写回。

[05:25] <|zh|><|FEARFUL|><|Speech|>S6 Sam: 安全这边能详细讲吗?我们的客户表里有 PII,审计日志怎么存?

[05:35] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 字段级加密 + Postgres RLS,审计走 CloudTrail,数据驻留留 us-east-1,合规清单之后呢我会发你 SOC2 报告。

[05:50] <|zh|><|FEARFUL|><|Speech|>S6 Sam: OK。那风险主要在哪?有依赖第三方 API 吗?

[06:00] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 依赖 Notion 官方 API,风险是速率限制,短板是他们凌晨维护窗口。

[06:10] <|zh|><|NEUTRAL|><|Speech|>S6 Sam: 那就这样定:周一 kickoff,周三中间检查点,周五演示。

[06:20] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 收到,我来写项目计划,今天内发出来。

[06:25] <|zh|><|HAPPY|><|Speech|>S6 Sam: 完美。顺便问一下,如果要做到双向同步,大概要多长时间?

[06:30] <|zh|><|NEUTRAL|><|Speech|>S1 Alex: 双向的话大概 6 周,先用 2 周跑单向 MVP,验证后再扩。
```

**预期触发清单**

| 时间 | 说话人 | 触发语句 | Emotion | Intent | Assist 功能 |
|---|---|---|---|---|---|
| 5:00 | S6 | "终于联上了" | **HAPPY** | — | 情绪徽章(开心,4 秒闪现) |
| 5:10 | S1 | "深入讲" | NEUTRAL | `deep_dive` | `runWhatShouldISay`(方案细化) |
| 5:25 | S6 | "能详细讲安全" | **FEARFUL** | `deep_dive` | KB 检索 `security_requirements.md` + 情绪徽章(害怕) + LLM 风险语气 |
| 5:50 | S6 | "风险" + "依赖" | **FEARFUL** | `capture_risk` | 写入风险卡 |
| 6:10 | S6 | "就这样定" | NEUTRAL | `capture_decision` | 写入决策 |
| 6:25 | S6 | "完美" | **HAPPY** | — | 情绪徽章(开心) |
| 5:00-6:30 | 整体 | — | — | — | `runBrainstorm`(后续步骤建议) |
| 6:25 | S6 | "如果要做到双向" | `clarification` | `runClarify`(估时澄清) |

---

## 演示总结

| 段 | 场景 | 持续时间 | 触发 intent 次数 | 触发 assist 功能数 |
|---|---|---|---|---|
| 1 | Sales | 1:15 | 4 | 5(`runWhatShouldISay` + KB + `runRecap` + dynamic actions) |
| 2 | Tech Interview | 1:15 | 4 | 4(`runWhatShouldISay` + `runClarify` + `runCodeHint`) |
| 3 | Team Meet | 1:15 | 4 | 5(`runWhatShouldISay` + 3 capture + `runRecap`) |
| 4 | Lecture | 1:15 | 4 | 3(`runWhatShouldISay` + `runManualAnswer` + `runClarify`) |
| 5 | FDE | 1:30 | 5 | 5(`runWhatShouldISay` + KB + `runBrainstorm` + `runClarify` + capture) |
| **合计** | — | **6:30** | **21** | **9 个核心功能 + 2 个 manual trigger** |

> **未覆盖功能**:`runSkillWatcher` 需用户在设置中手动启用 skill;`detectConfirmAndEmitDynamicActions` 仅在销售段末触发一次;`runAssistMode` 是 generic 后备(在每段都会被调用)。

## 录音建议

1. **真人朗读**:分配 6 个角色给团队成员,真人朗读录音最自然
2. **TTS 推荐**:
   - 中文:Edge TTS(云希/晓晓)、火山引擎 TTS、ElevenLabs 中文
   - 英文:ElevenLabs、OpenAI TTS
3. **手动触发测试**:把整段 transcript 复制到 Natively 的 Transcript 输入框(开发者模式下),逐段切换 active mode 验证触发

## 情绪识别覆盖(本演示稿内嵌)

每段对话文本在 SenseVoice 输出格式中携带 `<|zh|><|EMOTION|><|Speech|>` 元数据。本演示稿特意为关键语句标注情绪,以演示完整情绪识别链路。

| 段 | 情绪 | 触发语句 | 演示效果 |
|---|---|---|---|
| 1 Sales | ANGRY | "价格太高了吧" | LLM `<emotion_context>` 提示调整语气 + UI 4 秒"愤怒"徽章 |
| 1 Sales | HAPPY | "走起,我让 Procurement 也加进来" | UI 开心徽章 + LLM 语气偏积极 |
| 1 Sales | HAPPY | "完美,期待收到" | UI 开心徽章 |
| 3 Team | ANGRY | "卡在第三方,会赶不上 release" | UI 愤怒徽章 + LLM 风险语气 |
| 4 Lecture | SURPRISED | "能解释一下为什么不用 mod 哈希吗" | UI 惊讶徽章 |
| 4 Lecture | HAPPY | "好问题" | UI 开心徽章 |
| 5 FDE | HAPPY | "终于联上了" | UI 开心徽章 |
| 5 FDE | FEARFUL | "我们的客户表里有 PII" | UI 害怕徽章 + LLM 风险语气 |
| 5 FDE | FEARFUL | "风险主要在哪" | UI 害怕徽章 |
| 5 FDE | HAPPY | "完美" | UI 开心徽章 |

**触发链**:`SenseVoice STT → textCleaner 解析 → BaseSTT.transcript 事件 → IPC 透传 → UI 4 秒徽章 + LLM `<emotion_context>` 块`

**支持的 6 种情绪**:`happy` 开心 / `sad` 悲伤 / `angry` 愤怒 / `fearful` 害怕 / `disgusted` 厌恶 / `surprised` 惊讶(NEUTRAL 不显示)

## 后续步骤

- 详细加载步骤见 `00_walkthroughs/01_sales_walkthrough.md` 等 5 份文档
- 每个场景的 30 秒单场景片段见 `05_segment_clips/segN_xxx.md`
- 模式参考文件见 `04_mode_reference_files/<scenario>/`
- 知识库跨场景资料见 `02_knowledge_base/`
- Profile 数据见 `01_profiles/`