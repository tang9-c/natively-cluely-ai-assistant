# Solution Brief — Acme Corp 推荐方案

> **Scenario DocSubtype**: `solution-brief`
> **场景模式**: Sales
> **用途**:Master transcript 段 1 中 Jordan 提到"出个方案简介"时,Natively 应自动调出本文件作为参考。

---

## 部署形态

### 推荐方案:**Enterprise Plan + 自定义本地化**

| 项目 | 规格 |
|---|---|
| 席位 | 500 个一线销售 + 50 个 manager/admin = 550 seats |
| 计费 | USD 80/seat/月(年付),即 USD 528,000/年 |
| 数据中心 | 美西(us-west-2,AWS),可选美东/欧盟 |
| SSO | SAML 2.0(支持 Okta / Azure AD / OneLogin) |
| 数据驻留 | 美国本地化存储,符合 Acme 的合规要求 |
| 私有部署 | 可选(USD 50,000/年起) |

## 集成方案

1. **Slack 集成**:实时推送 AI 提示到销售代表的 Slack DM
2. **Zoom 集成**:Zoom Webhook → Natively 自动入会
3. **CRM 集成**:Salesforce / HubSpot 双向同步通话记录
4. **日历集成**:Google Calendar / Outlook 读取会议元数据

## 实施计划

### 第 1 周:Onboarding
- 账号开通 + SSO 配置
- 一线销售分批培训(每天 2 场,共 8 场)
- Slack/Zoom 集成验证

### 第 2-3 周:并行运行
- Natively 与 Otter 并行使用 2 周
- 每天收集一线反馈,快速迭代
- 给 30 名"种子销售"先开通高级权限

### 第 4-5 周:扩大使用
- 全员开通
- Manager Dashboard 上线(销售 VP 看团队 KPI)

### 第 6 周:全量上线 + Otter 退订
- Otter 账户保留 30 天(应急)
- 数据迁移完成,Otter 退订

## 客户档案自动同步(关键差异化)

1. **会议中**:AI 自动识别客户提到的关键信息(预算、决策链、采购窗口)
2. **会议后**:自动生成 Salesforce 字段更新建议
3. **经理审批**:Sales Manager 在 Slack 一键 approve
4. **CRM 同步**:字段自动写入 Salesforce 对应字段

## 风险与缓解

| 风险 | 缓解方案 |
|---|---|
| 一线销售抵触新工具 | 种子销售 30 人先试用,内部背书 |
| Salesforce 集成复杂 | 提供官方 AppExchange 包,2 小时配置完成 |
| 数据安全顾虑 | 提供 SOC2 Type II 报告 + 数据流图 |
| 多语言支持 | 初期英中双语,后续扩展 |

## 报价(简化版,给 CFO 看)

| 项目 | 金额(USD) |
|---|---|
| 550 seats × $80/seat/月 × 12 月 | $528,000 |
| Enterprise SSO + Slack/CRM 集成 | 含 |
| Onboarding + 培训(2 周) | 含 |
| 第一年 Premium Support | 含 |
| **第一年总计** | **$528,000** |
| 第二年起(8% 折扣) | $485,760 |

## ROI 测算(给 CFO)

- **一线销售人均月通话**:40 场
- **其中高价值通话**:8 场/月
- **每场平均金额**:$50,000
- **当前首单成单率**:15%
- **Natively 提升后**:21%(基于 Halcyon 案例 +6 个百分点)
- **人均增量首单/月**:8 × 6% = 0.48 单
- **人均增量营收/月**:$24,000
- **500 人增量营收/月**:$12,000,000
- **ROI**:$12M / $528K ≈ **22.7 倍**

> 即使 ROI 折半 11 倍,远超 500 席位年费的覆盖。

---

## 关联材料

- 客户档案:`./customer_profile.md`
- 产品介绍:`./product_intro.md`
- 价格异议处理:`./pricing_objections.md`