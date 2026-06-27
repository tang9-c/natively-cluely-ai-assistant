# Customer Profile — Acme Corp

> **Scenario DocSubtype**: `customer-profile`
> **场景模式**: Sales
> **使用建议**:上传到 Sales 模式后,开场第一句"你们跟 Otter 比强在哪儿"会触发 `discovery_probe`,Natively 会基于本档案的痛点和决策链给出针对性的回答。

---

## 公司基本信息

- **公司全称**:Acme Corporation
- **行业**:B2B SaaS(企业销售工具)
- **规模**:500 名一线销售代表,分布在北美 12 个时区
- **年营收**:USD 1.2B
- **总部**:San Francisco, CA
- **成立时间**:2015 年
- **当前客户阶段**:POC 评估期(已用 Otter 1 年,试用过 Cluely 2 个月)

## 决策链

| 角色 | 姓名 | 关注点 | 影响力 |
|---|---|---|---|
| CFO | Lisa Park | ROI、TCO、合规成本 | 高(预算否决权) |
| Sales VP | **Jordan Rivera** | 团队效率、首单成单率 | 高(本次对接人) |
| Sales Ops Director | Mark Chen | 工具集成、数据迁移 | 中 |
| Procurement | Diana Wu | 合同条款、SLA、安全 | 中(流程必经) |
| 一线销售代表 | 30+ 人代表 | 易用性、可靠性 | 低(反馈层) |

## 已知痛点

1. **缺乏实时话术辅助**:Otter 仅做转录,无法在通话中给一线建议
2. **销售/招聘/客户成功三类通话一刀切**:Otter 没有场景化能力
3. **会后跟进慢**:会议结束后还要手动整理客户档案更新
4. **数据本地化合规弱**:Otter 的 EU 数据中心对中国客户不友好
5. **试用 Cluely 期间出现过几次崩溃**,对国产/海外工具的稳定性存疑

## 竞争评估状态

- **Otter**:已用 1 年,核心痛点未解决
- **Cluely**:试用 2 个月,稳定性问题
- **Gong**:评估过,价格是 Natively 的 3 倍
- **Chorus**:评估过,UI 不友好
- **Fireflies**:价格便宜但功能弱

## 采购窗口

- 本季度 Q3 是最佳窗口(下周一即 2026-06-30 起进入法务审核)
- 若错过 Q3,下一个窗口是 2027-Q1

## 关键引用(可在销售话术中复用)

> "我们最希望的不是转录本身,而是能在通话中给销售代表的'第二大脑'。"
> — Jordan Rivera, Sales VP

> "ROI 算得过来就推,算不过来再便宜也不买。"
> — Lisa Park, CFO

---

## Natively 应回答的样例(基于本档案)

当用户问 "Otter 比 Natively 强在哪儿" 时,Natively 应回答:

> "Acme 的核心痛点不是转录准确率,而是通话中缺乏实时辅助。Natively 的 Sales 模式针对销售场景做了专门优化,例如对您提到的'客户预算异议'会主动提示您引用 ROI 计算;对'采购窗口临近'会主动建议加速推动法务流程。这些是 Otter 没有的能力。"

---

## 关联材料

- 产品能力:`./product_intro.md`
- 推荐方案:`./solution_brief.md`
- 客户案例:`./case_study.md`
- 价格异议处理:`./pricing_objections.md`