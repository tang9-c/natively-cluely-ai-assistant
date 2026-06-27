# Knowledge Base — Natively 产品手册

> **用途**:跨场景演示使用,作为知识库材料,任何场景下都可以检索。
> **关联场景**:全部 5 个场景均可引用(作为产品知识支撑)

---

## 1. Natively 是什么

**Natively** 是一款**实时 AI 会议辅助**桌面应用,运行在 macOS / Windows / Linux。

核心功能:
1. **实时转录**:边开会边转录音频(支持中英双语)
2. **场景化辅助**:基于当前场景(sales / recruiting / tech-interview 等)给出实时话术建议
3. **会后自动化**:自动生成摘要、客户档案更新、行动项邮件

## 2. 8 个内置模式

### 通用模式

| 模式 | 用途 | 典型场景 |
|---|---|---|
| **General(通用)** | 任何会议 | 通用对话 |
| **Team Meet(团队会议)** | 团队周会 / standup | 行动项 + 决策 + 风险 |
| **Lecture(讲座)** | 课堂 / 培训 | 概念解释 + 公式 + Q&A |

### 销售 / 客户成功

| 模式 | 用途 | 典型场景 |
|---|---|---|
| **Sales(销售)** | 销售通话 | 异议处理 + 机会识别 |
| **FDE(前线部署)** | 客户现场实施 | 需求澄清 + 方案设计 + 风险评估 |

### 求职 / 招聘

| 模式 | 用途 | 典型场景 |
|---|---|---|
| **Recruiting(招聘)** | 面试候选人 | STAR 追问 + 评分卡 |
| **Looking-for-work(求职)** | 求职面试 | 自夸 + STAR 故事 |
| **Technical Interview(技术面试)** | 技术面试 | Coding + 系统设计 + 行为 |

## 3. Scenario 概念

### 什么是 Scenario

Scenario 是**比模式更细粒度**的场景分类,每个 Scenario 对应一组:
- 提示模板(scenario documents)
- 文档类型(docSubtype,共 24 种)
- 数据范围(data scopes)

### Scenario 与模式的对应

| 模式 | Scenario | 子场景 |
|---|---|---|
| general | general | — |
| sales | sales | — |
| fde | fde | — |
| recruiting | interview | recruiter |
| looking-for-work | interview | candidate |
| technical-interview | interview | technical |
| team-meet | team-meet | — |
| lecture | lecture | — |

## 4. Intent 分类机制

### 什么是 Intent

Intent 是 Natively 对**当前对话意图**的实时分类。基于:
1. 关键词匹配(中英双语)
2. 上下文语义
3. 当前模式

### 各模式的 Intent 集合

#### Sales 模式

- `seize_signal`:客户表达推进意愿(如"我们 CFO 这周在")
- `handle_objection`:客户表达异议(如"价格太高")
- `discovery_probe`:需要深入了解客户(如"你们怎么衡量效果")

#### Team Meet 模式

- `capture_action`:有人认领任务(如"我来做,周五前")
- `capture_decision`:有人做决策(如"就用 Postgres 17")
- `capture_risk`:识别风险(如"卡在第三方,会赶不上")
- `status_update`:状态更新(如"搜索那块现在如何")

#### Lecture 模式

- `explain_concept`:解释概念(如"这个叫 consistent hashing")
- `render_formula`:推导公式(如"假设环长 1,有 k 个节点")
- `answer_class_question`:回答课堂提问(如"谁知道为什么")

#### 通用 / Interview 模式

- `clarification`:澄清需求(如"能详细讲讲吗")
- `follow_up`:追问(如"再多说一下")
- `deep_dive`:深入探讨(如"数据量到 5000 万之后呢")
- `behavioral`:行为面试(如"讲一个你最难的项目")
- `example_request`:举例(如"举个例子")
- `summary_probe`:总结确认(如"所以你的方案是...?")
- `coding`:编程题(如"写一下代码")
- `request_example`(仅 recruiting):请求例子(如"能给我一个具体例子吗")

## 5. 知识库检索机制

### 知识库类型

#### 1. 模式知识库(`mode_reference_files`)

- 关联到具体的模式
- 触发 RAG 检索时优先用本模式的材料
- 场景:fde 模式时,优先检索 fde/* 下的文件

#### 2. 用户上传材料(`knowledge_materials`)

- 全局共享
- 上传到知识库的所有会议都可以检索
- 场景:产品手册、竞品分析等

#### 3. Profile 资料

- 主档案(`profile_master`)
- 简历(`profile_resume`)
- 岗位描述(`profile_jds`)
- 场景:求职 / 招聘 / FDE 客户对接

### 检索算法

- **向量检索**:基于 embedding 相似度
- **关键词检索**:FTS 全文索引
- **混合检索**:两者合并 + 重排序

## 6. Profile 智能

### Profile 是什么

Profile 是 Natively 维护的**用户身份信息**,包括:
- 基本信息(姓名 / 行业 / 经验)
- 简历
- 当前求职目标
- 个人偏好

### Profile 的作用

1. **跨会话记忆**:不需要每次会议都重新介绍自己
2. **个性化回答**:基于用户的背景和偏好调整回答
3. **客户档案自动更新**:在销售模式下,自动维护客户档案

## 7. 实时辅助的工作流

### 触发链路

```
音频输入
    ↓
STT(语音转文字)
    ↓
Speaker Diarization(说话人分离)
    ↓
Intent Detection(意图检测)
    ↓
RAG Retrieval(知识库检索)
    ↓
Prompt Assembly(提示组装)
    ↓
LLM 调用(流式)
    ↓
UI 显示(实时)
```

### 关键参数

- **triggerCooldown**:3000ms(两次触发的最小间隔)
- **SPECULATIVE_DEBOUNCE_MS**:350ms(防抖)
- **SPECULATIVE_MIN_WORDS**:7(最少词数)
- **SPECULATIVE_MIN_CONFIDENCE**:0.75(最低置信度)
- **SPECULATIVE_SIMILARITY_THRESHOLD**:0.75(相似度阈值)

## 8. 数据范围(Provider Data Scopes)

Natively 允许精细控制**每个 Provider 能看到的数据**:

| Scope | 说明 |
|---|---|
| `transcript` | 转录文本 |
| `screenshots` | 截图 |
| `reference_files` | 模式参考文件 |
| `profile_history` | Profile 历史 |
| `embeddings` | 嵌入向量 |
| `long_term_memory` | 长期记忆 |
| `post_call_summary` | 会后摘要 |

### 默认策略

- 海外 LLM(Claude / GPT):默认关闭 transcript + screenshots
- 国内 LLM(Doubao):默认开启
- 本地 LLM(Ollama):默认全部开启

## 9. 性能指标

| 指标 | 目标 |
|---|---|
| 转录延迟 | < 500ms |
| Intent 检测延迟 | < 100ms |
| RAG 检索延迟 | < 200ms |
| LLM 首 token 延迟 | < 1s |
| LLM 流式输出 | 实时 |

## 10. 适用场景清单

### 强推荐

- 销售 / 客户成功通话
- 求职 / 招聘面试
- 技术面试
- 团队周会
- 客户现场 workshop(FDE)
- 课堂 / 培训

### 一般推荐

- 1:1 同步
- 投资人会议
- 跨团队协作

### 不推荐

- 极敏感数据(医疗 / 法律细节)
- 离线场景(虽然可以本地模式)
- 大型演讲(> 50 人)

## 11. 价格与版本

| 版本 | 价格 | 包含 |
|---|---|---|
| 免费 | $0 | 转录 + 基础摘要 + 2 个模式 |
| Pro | $20/月 | 全部 8 模式 + 知识库 |
| Team | $80/seat/月 | Pro + 团队管理 + SAML |
| Enterprise | 联系销售 | Team + 私有部署 + SLA |

## 12. 客户成功指标

- **效率提升**:通话后 CRM 录入时间 -80%
- **业务提升**:销售首单成单率 +15-30%(Halcyon 案例 +28%)
- **学习提升**:新人 onboarding -50%
- **NPS**:用户对工具的 NPS +42(Halcyon)

---

## 关联材料

- 竞品对比:`./kb_competitor_matrix.csv`
- 异议处理剧本:`./kb_objection_playbook.md`