# Customer Architecture — Beta Corp

> **Scenario DocSubtype**: `customer-architecture`
> **场景模式**: FDE
> **用途**:Master transcript 段 5 中客户描述架构时,Natively 应基于本文件给出兼容性分析。

---

## 当前架构概览

```
┌──────────────────────────────────────────────────────────┐
│                    Beta Corp 架构                          │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Sales 团队                                                │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐         │
│  │ Notion   │ ──→ │ 手动复制  │ ──→ │ Postgres │         │
│  │ (CRM)    │     │ (4h/天)   │     │ (Data    │         │
│  │          │     │           │     │  Warehouse)         │
│  └──────────┘     └──────────┘     └──────────┘         │
│       ↑                                  │                │
│       │                                  ↓                │
│  ┌──────────┐                      ┌──────────┐          │
│  │ HubSpot  │ ←────────────────── │ BI 工具   │          │
│  │ (CRM)    │                      │ (Metabase)│          │
│  └──────────┘                      └──────────┘          │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

## 技术栈详细

### 前端

- **Notion**:客户档案、销售记录(主要数据源)
- **HubSpot**:Marketing 自动化、邮件
- **Metabase**:BI 报表(从 Postgres 读)

### 后端

- **AWS 云**:us-east-1 / ap-southeast-1(新加坡)
- **Postgres 14**:核心数据仓库(单实例,RDS)
- **Notion API**:通过 Zapier 集成,无自动化
- **Stripe**:支付(独立系统,不涉及本项目)

### 数据流

1. **Notion → Postgres**:每天 4 小时人工(本项目要解决)
2. **Postgres → Metabase**:直接读,实时
3. **HubSpot → Postgres**:无,Marketing 数据不进入数据仓库

### 集成

- **Okta SSO**:全公司统一身份认证
- **Slack**:日常沟通 + 告警
- **GitHub**:代码托管(本项目需提供 GitHub Action / 脚本)

## 网络与安全

### 认证

- Okta SSO,所有内部工具通过 SAML 2.0 接入
- MFA 强制(员工 + 外部 contractor)

### 网络

- AWS VPC 隔离
- 内部系统走 VPN
- 外部 API(Notion)走 HTTPS + Token

### 数据存储

- Postgres:AWS RDS,加密 at rest
- Notion:第三方 SaaS
- HubSpot:第三方 SaaS

## 数据量与 QPS

| 系统 | 数据量 | QPS |
|---|---|---|
| Notion 客户表 | ~5,000 行 | < 1(每天更新 50-100 行) |
| Postgres 客户表 | ~5,000 行 | 5-10(BI 读) |
| Notion API | — | 3 req/s 限制 |

## 约束

### 硬约束

- ❌ 不能改 Notion schema(销售团队不接受)
- ❌ 不能停机(Postgres 7×24 业务依赖)
- ✅ 可以新建 Postgres 表(加一个 staging schema)
- ✅ 可以加 dbt 模型

### 软约束

- 偏好 AWS 工具链(团队熟悉)
- 偏好 Python 或 SQL(数据工程师技能)
- 偏好 managed services(减少运维)

## 集成点

### 我们方案需要集成的点

1. **Notion API**:OAuth 2.0 + 读权限
2. **Postgres(目标库)**:写入权限(staging schema)
3. **Okta**:可选(本项目不需要)

---

## Natively 应提供的辅助

### 当 Sam 描述"我们用 K8s + 微服务"时(实际是单实例 RDS)

Natively 应基于本架构图澄清:
> "我看到 Beta 当前实际是单实例 RDS Postgres + Notion + Metabase,不是 K8s 微服务架构。这意味着我们的方案可以更简单:
> - 不需要 Kubernetes 部署
> - 不需要微服务编排
> - 一个 dbt 模型 + Airbyte connector 就够了
> 2 周 MVP 完全可行。"

### 当 Sam 提到"200 多个 API"时

Natively 应基于本架构澄清:
> "我看到当前集成只有 Notion API + Postgres + Metabase,没有 200+ 个 API。这是个好消息,实施复杂度低很多。"

---

## 关联材料

- 客户档案:`./customer_profile.md`
- 客户工作流:`./customer_workflow.md`
- 安全要求:`./security_requirements.md`