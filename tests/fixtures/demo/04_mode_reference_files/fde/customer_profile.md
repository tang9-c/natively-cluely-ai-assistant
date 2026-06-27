# Customer Profile — Beta Corp

> **Scenario DocSubtype**: `customer-profile`
> **场景模式**: FDE
> **用途**:Master transcript 段 5 FDE 场景,Natively 应基于本档案识别客户背景并给出深度方案。

---

## 公司基本信息

- **公司全称**:Beta Corporation
- **行业**:B2B SaaS(电商数据中台)
- **规模**:22 个企业客户,300 万 ARR
- **成立时间**:2023 年(已运营 3 年)
- **总部**:Singapore(亚太客户为主)
- **目标市场**:东南亚电商品牌

## 团队结构

| 角色 | 人数 | 备注 |
|---|---|---|
| CEO | 1 | 创始人,前 Shopify 工程师 |
| CTO | 1 | Sam Patel(本次对接人) |
| 后端工程师 | 4 | 2 人在新加坡,2 人远程(印尼) |
| 前端工程师 | 2 | — |
| 数据工程师 | 1 | 主要负责客户数据仓库 |
| Sales | 5 | 拓展东南亚客户 |
| Customer Success | 3 | 处理客户反馈 |
| **总计** | **18 人** | — |

## 决策链

### 主决策人

- **Sam Patel (CTO)**:
  - 关心技术可行性
  - 决定架构选型
  - 关注开发速度

### 影响人

- **CEO**:关心 ROI 和客户交付时间
- **数据工程师 (Rina)**:日常数据同步的执行人,需要培训

### 流程

1. CTO 评估技术方案(本次会议)
2. CEO 评估 ROI 和时间线
3. 数据工程师评估落地难度
4. 集体决定后进入实施

## 当前痛点

### 痛点 1:Notion → SQL 手动同步(本次需求核心)

- **现状**:Sales 团队把客户信息记在 Notion 表格中
- **流程**:每天 Sales 提交 → 数据工程师手动复制到 SQL → BI 团队读 SQL 出报表
- **耗时**:每天 4 小时人工
- **错误率**:每月 2-3 次抄写错误,导致客户档案与销售记录不一致
- **影响**:销售/CS 团队对数据失去信心,开始各自维护"影子表"

### 痛点 2:多工具数据孤岛

- Notion(销售用)
- Airtable(CS 用)
- HubSpot(CRM)
- Postgres(数据仓库)
- 没有自动化同步,完全靠人工

### 痛点 3:合规要求

- 客户表里有 PII(Personal Identifiable Information)
- 必须本地化存储(东南亚各国法规不同)
- SOC2 Type II 合规
- 审计日志保留 7 年

## 采购预算

- **本次项目预算**:USD 30,000 - 50,000(2-4 周交付)
- **未来 12 个月数据基础设施总预算**:USD 200,000

## 关键引用

> "我们需要一个能跑起来的 MVP,不追求完美,先解决每天 4 小时的痛苦。"
> — Sam Patel, CTO

> "只要数据同步过去,我们的销售/CS/数据团队都能从自己的工具读到一致的客户档案。"
> — Sam Patel

> "如果能做到 Notion ↔ SQL 双向,我们愿意多付 50%。"
> — Sam Patel

---

## Natively 应提供的辅助

### 当 Sam 说"我们想两周内出原型"时

Natively 应基于本档案给出方案建议:
- 单向 MVP 2 周可交付(Notion → SQL)
- 双向同步需要 6 周(包含冲突解决)
- 建议先做单向,验证后再扩

### 当 Sam 提到"PII"时

Natively 应基于本档案 + `./security_requirements.md` 给出合规清单:
- 字段级加密
- 数据驻留(新加坡/雅加达)
- 审计日志
- SOC2 报告

---

## 关联材料

- 客户架构:`./customer_architecture.md`
- 客户工作流:`./customer_workflow.md`
- 安全要求:`./security_requirements.md`
- 原型范围:`./prototype_scope.md`
- 交付风险:`./delivery_risk.md`
- 方案简介:`./solution_brief.md`