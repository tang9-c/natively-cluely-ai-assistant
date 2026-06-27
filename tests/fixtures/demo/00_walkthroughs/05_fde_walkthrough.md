# Walkthrough — FDE 场景演示

> 演示 FDE(前线部署工程师)模式下,客户架构深度分析 + 安全合规清单 + 交付风险评估 + 头脑风暴 + Profile 智能。

---

## 场景设定

**客户**:Beta Corp(SaaS,300 万 ARR,22 客户)
**对接人**:Sam Patel(CTO)
**当前痛点**:Notion → SQL 手动同步 4 小时/天
**目标**:2 周 MVP 单向同步,6 周扩展双向
**Profile 关联**:Alex Chen 简历 + 主档案 + 求职 JD(展示 Profile 智能)

---

## 加载步骤

### 步骤 1:创建/激活 FDE 模式(1 分钟)

1. Modes → Create Mode
2. 模板选"FDE(前线部署工程师)"
3. 命名:"FDE Demo"
4. 设为 Active

### 步骤 2:上传 FDE 模式参考文件(3 分钟)

把以下 7 份文件上传到 FDE 模式:

| 文件 | 用途 | docSubtype |
|---|---|---|
| `04_mode_reference_files/fde/customer_profile.md` | 客户档案 | customer-profile |
| `04_mode_reference_files/fde/customer_architecture.md` | 客户架构 | customer-architecture |
| `04_mode_reference_files/fde/customer_workflow.md` | 客户工作流 | customer-workflow |
| `04_mode_reference_files/fde/security_requirements.md` | 安全要求 | security-requirements |
| `04_mode_reference_files/fde/prototype_scope.md` | 原型范围 | prototype-scope |
| `04_mode_reference_files/fde/delivery_risk.md` | 交付风险 | delivery-risk |
| `04_mode_reference_files/fde/solution_brief.md` | 方案简介 | solution-brief |

### 步骤 3:上传知识库资料(2 分钟)

上传 3 份 KB(同 Sales 场景)。

### 步骤 4:关联 Profile 数据(2 分钟)

把以下 3 份文件关联到 FDE 模式(Profile 智能):

| 文件 | 用途 |
|---|---|
| `01_profiles/master_profile.md` | 用户主档案(Alex Chen 身份) |
| `01_profiles/resume.md` | 简历(技术能力 + 项目经验) |
| `01_profiles/job_description.md` | 求职目标 JD(展示跨场景引用) |

操作:
- Profile → Documents → Upload
- 逐个上传并打 `docSubtype` 标签

---

## 录制步骤(2 分钟)

```
[05:00] Sam: 终于联上了。Alex,我们想两周内原型出 Notion 到 SQL 的双向同步,当前流程手动 4 小时/天。

[05:10] Alex: 我深入讲一下方案:dbt + Airbyte 增量,不改造 Notion,只读 + 写回。

[05:25] Sam: 安全这边能详细讲吗?我们的客户表里有 PII,审计日志怎么存?

[05:35] Alex: 字段级加密 + Postgres RLS,审计走 CloudTrail,数据驻留留 us-east-1,合规清单之后呢我会发你 SOC2 报告。

[05:50] Sam: OK。那风险主要在哪?有依赖第三方 API 吗?

[06:00] Alex: 依赖 Notion 官方 API,风险是速率限制,短板是他们凌晨维护窗口。

[06:10] Sam: 那就这样定:周一 kickoff,周三中间检查点,周五演示。

[06:20] Alex: 收到,我来写项目计划,今天内发出来。

[06:25] Sam: 完美。顺便问一下,如果要做到双向同步,大概要多长时间?

[06:30] Alex: 双向的话大概 6 周,先用 2 周跑单向 MVP,验证后再扩。
```

或使用片段:`05_segment_clips/seg5_fde.md`

---

## 预期触发清单(5 项)

| 时间 | 触发语句 | Intent | Assist | 预期 UI |
|---|---|---|---|---|
| 5:10 | "深入讲" | `deep_dive` | `runWhatShouldISay` | 展开 dbt + Airbyte 方案 |
| 5:25 | "能详细讲安全" | `deep_dive` + KB | `runWhatShouldISay` | KB 检索 `security_requirements.md` 命中 |
| 5:50 | "风险" + "依赖" | `capture_risk` | `runWhatShouldISay` | 写入风险卡 + 引用 `delivery_risk.md` |
| 6:10 | "就这样定" | `capture_decision` | `runWhatShouldISay` | 写入决策(周一 kickoff / 周三 check / 周五 demo) |
| 段末 | (整体) | — | `runBrainstorm` | 弹出"双向同步扩展"建议列表 |

### Profile 智能演示(贯穿全段)

| 触发点 | 触发内容 | Profile 智能响应 |
|---|---|---|
| 5:10 | Alex 说"我深入讲" | Profile 显示 Alex 是 Natively 创始人/CTO,8 年后端 |
| 5:25 | Sam 问"安全" | Profile 显示 Alex 的 Datacraft 经验(订单系统重写有 PII 处理) |
| 5:50 | Sam 问"风险" | Profile 显示 Alex 团队管理 30 人经验,擅长交付评估 |
| 6:10 | Sam 说"就这样定" | Profile 自动生成"周一 kickoff 议程"模板 |

---

## 可触发的功能清单(本场景 8 个 — 最多)

1. ✅ `runWhatShouldISay` — 客户架构分析 + 安全合规
2. ✅ `runClarify` — 估时澄清(双向要多久)
3. ✅ `runBrainstorm` — 双向扩展建议
4. ✅ `capture_risk` — 风险卡自动写入
5. ✅ `capture_decision` — 决策自动写入
6. ✅ RAG 检索(7 份 FDE 文档 + 3 份 KB + 3 份 Profile)
7. ✅ Profile 智能(简历 / 主档案 / JD 自动引用)
8. ✅ 模式 prompt 注入(`MODE_FDE_PROMPT`)

---

## Profile 智能深度演示

### 当 Alex 说话时,Profile 上下文自动注入:

```xml
<profile_master>
  <name>Alex Chen</name>
  <role>Natively 创始人 / CTO</role>
  <experience>8 年后端 + 30 人团队管理</experience>
  <current_focus>会议自动化 + 企业销售</current_focus>
</profile_master>

<scenario_documents scenario="fde">
  <document subtype="customer-profile">
    Beta Corp - 22 客户,300 万 ARR
  </document>
  <document subtype="customer-architecture">
    AWS + Postgres + Notion + Stripe
  </document>
  ...
</scenario_documents>
```

AI 回答时会自动引用这些上下文。

---

## 回放检查清单

- [ ] FDE 模式已激活
- [ ] 7 份 FDE 参考文件已上传
- [ ] 3 份 KB 已上传
- [ ] 3 份 Profile 已关联
- [ ] 5:10 `deep_dive` 触发,方案展开
- [ ] 5:25 KB 检索 `security_requirements.md` 命中
- [ ] 5:50 `capture_risk` 触发,风险卡生成
- [ ] 6:10 `capture_decision` 触发,决策写入
- [ ] 段末 `runBrainstorm` 触发
- [ ] Profile 智能贯穿(简历 / 主档案 / JD 自动出现)

---

## 进阶演示

### 场景 A:对照 Sales 模式

切到 Sales 模式重放同一段对话:
- 同样说"深入讲方案",Sales 模式下提示"先讲 ROI"而不是技术细节
- FDE 模式下提示"先讲技术可行性"

### 场景 B:Profile 智能关闭对比

解除 Profile 关联,重放同一段对话:
- AI 回答不再引用 Alex 的 Datacraft 经验
- 通用回答,无个性化

---

## 关联材料

- Master transcript 段 5:`../../03_master_transcript/master_transcript.md`
- FDE 参考文件:`../../04_mode_reference_files/fde/`
- Profile 数据:`../../01_profiles/`
- 知识库:`../../02_knowledge_base/`
- 单场景片段:`../../05_segment_clips/seg5_fde.md`
- 总览:`./00_overview.md`