# Walkthrough — Sales 场景演示

> 演示销售模式下,实时话术辅助 + 异议处理 + 机会识别 + 知识库检索 + 自动邮件草稿。

---

## 场景设定

**客户**:Acme Corp,500 名一线销售代表的 B2B SaaS 公司
**对接人**:Jordan Rivera(Sales VP)
**当前**:Otter 用 1 年,缺乏实时话术辅助;试用过 Cluely 但稳定性差
**目标**:推动 Q3 法务审核,签下 Enterprise Plan

---

## 加载步骤

### 步骤 1:创建/激活 Sales 模式(2 分钟)

1. Modes → Create Mode
2. 模板选"销售(Sales)"
3. 命名:"Sales Demo"
4. 设为 Active

### 步骤 2:上传 Sales 模式参考文件(3 分钟)

把以下 5 份文件上传到 Sales 模式:

| 文件 | 用途 | docSubtype |
|---|---|---|
| `04_mode_reference_files/sales/customer_profile.md` | 客户档案 | customer-profile |
| `04_mode_reference_files/sales/product_intro.md` | 产品介绍 | product-intro |
| `04_mode_reference_files/sales/solution_brief.md` | 方案简介 | solution-brief |
| `04_mode_reference_files/sales/case_study.md` | 客户案例 | case-study |
| `04_mode_reference_files/sales/pricing_objections.md` | 异议处理 | pricing-objections |

操作:
- Modes → 选 Sales Demo → Reference Files → Upload
- 逐个上传上面 5 份文件
- 等待上传完成(系统自动 chunk + embed)

### 步骤 3:上传知识库资料(2 分钟)

把以下 3 份文件上传到全局知识库(Knowledge 标签):

| 文件 | 用途 |
|---|---|
| `02_knowledge_base/kb_natively_product_overview.md` | 产品手册 |
| `02_knowledge_base/kb_competitor_matrix.csv` | 竞品对比 |
| `02_knowledge_base/kb_objection_playbook.md` | 异议处理剧本 |

操作:
- Settings → Knowledge → Upload Material
- 逐个上传

### 步骤 4:不需要关联 Profile

本场景不关联 Profile(留给 FDE 场景演示 Profile 智能)。

---

## 录制步骤(1 分钟)

把以下内容复制到 Transcript 输入框(开发者模式),或用 TTS 播放:

```
[00:00] Jordan: Alex,谢谢你今天抽时间。我们这边销售团队 500 人,去年刚换了 Otter,但说实话,现在怎么衡量效果我们心里没底。你们跟 Otter 比强在哪儿?

[00:08] Alex: 主要差在三点:第一,你们最担心的销售、招聘、客户成功三类通话,Natively 都有专门的模式,不是一刀切。第二,实时话术辅助是 Otter 没有的,边听边给建议。第三,长会后能直接出客户档案更新和下一步邮件。

[00:22] Jordan: 听起来不错。但价格太高了吧?500 个席位按你说的方案年付,预算这一关就过不了。

[00:30] Alex: 我理解。我们算过 ROI,一线销售每月 8 场高价值通话,每场多成单 1 单意味着 60 单/年,光这一项就把 500 席位的年费盖了。要不要我把这套算法按你们 500 人调一遍发过去?

[00:45] Jordan: 算 ROI 那个可以发我。我们 CFO 这周在,下周想推进到法务审核那一步。你看你们能配合出个方案简介吗?

[00:52] Alex: 没问题。我今天会议结束就发一版报价给你,CFO 看的简化版,周一上午 10 点我们对一下?

[00:58] Jordan: 走起,我让 Procurement 也加进来。

[01:05] Alex: 那我先发邮件草稿,这边会中我顺便把客户档案的更新点列出来,会议后自动存档。

[01:12] Jordan: 完美,期待收到。
```

或使用片段:`05_segment_clips/seg1_sales.md`

---

## 预期触发清单(5 项)

| 时间 | 触发语句 | Intent | Assist | 预期 UI |
|---|---|---|---|---|
| 0:00 | "现在怎么衡量效果" | `discovery_probe` | `runWhatShouldISay` | 弹出 ROI 入口 |
| 0:22 | "价格太高了" | `handle_objection` | `runWhatShouldISay` | 调出 `pricing_objections.md` + `kb_competitor_matrix.csv` 命中 |
| 0:45 | "下周想推进到法务审核" | `seize_signal` | `runWhatShouldISay` | 生成"推动法务流程"行动卡 |
| 0:52 | "发一版报价" | `confirm` | `detectConfirmAndEmitDynamicActions` | 弹出"邮件草稿"卡片 |
| 0:00-1:12 | (整体) | — | `runRecap` | 弹出整段摘要(段末触发) |

---

## 可触发的功能清单(本场景 7 个)

1. ✅ `runWhatShouldISay` — 实时话术辅助
2. ✅ `runRecap` — 期间摘要
3. ✅ `detectConfirmAndEmitDynamicActions` — 邮件草稿
4. ✅ RAG 检索(`pricing_objections.md` / `kb_competitor_matrix.csv`)
5. ✅ 模式 prompt 注入(`MODE_SALES_PROMPT`)
6. ✅ Intent detection(seize_signal / handle_objection / discovery_probe)
7. ✅ KB 跨场景引用

---

## 回放检查清单

- [ ] Sales 模式已激活
- [ ] 5 份参考文件已上传
- [ ] 3 份 KB 已上传
- [ ] 0:00 `discovery_probe` 触发成功
- [ ] 0:22 `handle_objection` 触发,KB 命中
- [ ] 0:45 `seize_signal` 触发
- [ ] 0:52 `confirm` 触发邮件草稿
- [ ] 段末 `runRecap` 触发

---

## 进阶演示

### 场景 A:对照实验

切到 General 模式重放同一段对话,对比:
- General 模式的回答(没有销售针对性)
- Sales 模式的回答(有 ROI / 异议处理 / 机会识别)

### 场景 B:知识库深度命中

修改 Jordan 的话:"我们 CFO 关心数据安全,你们 SOC2 报告呢?"
- 应触发 KB 检索 `kb_natively_product_overview.md` 第 12 节(客户成功指标)
- AI 应主动给出 SOC2 Type II 报告说明

---

## 关联材料

- Master transcript 段 1:`../../03_master_transcript/master_transcript.md`
- 销售参考文件:`../../04_mode_reference_files/sales/`
- 销售知识库:`../../02_knowledge_base/`
- 单场景片段:`../../05_segment_clips/seg1_sales.md`
- 总览:`./00_overview.md`