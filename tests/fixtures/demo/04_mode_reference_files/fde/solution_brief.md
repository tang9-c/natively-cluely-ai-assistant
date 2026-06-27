# Solution Brief — Beta Corp MVP 推荐方案

> **Scenario DocSubtype**: `solution-brief`
> **场景模式**: FDE
> **用途**:Master transcript 段 5 中 Natively 应基于本方案给出技术细节。

---

## 推荐方案:dbt + Airbyte 增量同步

### 架构

```
┌────────────────────────────────────────────────────────┐
│              Notion → Postgres 同步架构                  │
├────────────────────────────────────────────────────────┤
│                                                         │
│  Notion API                                            │
│      ↓ (OAuth 2.0)                                    │
│  Airbyte Source Connector (Notion)                    │
│      ↓ (Raw JSONL)                                    │
│  S3 Staging (encrypted)                                │
│      ↓ (dbt run)                                      │
│  dbt Models (transform + encrypt)                     │
│      ↓ (UPSERT)                                       │
│  Postgres RDS (ap-southeast-1)                       │
│      ↓ (staging schema)                               │
│  Production schema (后续 merge)                       │
│                                                         │
│  监控:                                                 │
│  - CloudWatch → CloudTrail (审计)                     │
│  - Prometheus + Grafana (性能)                        │
│  - Slack webhook (告警)                               │
│                                                         │
└────────────────────────────────────────────────────────┘
```

## 技术栈选型

### 为什么选 Airbyte

| 维度 | Airbyte | Fivetran | Stitch |
|---|---|---|---|
| 开源 | ✅ | ❌ | ❌ |
| Notion connector | ✅ 官方 | ✅ | ❌ |
| 自定义成本 | 低 | 高 | 高 |
| 部署方式 | 自托管/SaaS | 仅 SaaS | 仅 SaaS |
| 价格 | 免费(自托管) | $$$ | $$ |

**结论**:Airbyte 开源 + Notion connector 完善 + 客户团队熟悉 Python/SQL,选 Airbyte 自托管。

### 为什么选 dbt

- 客户团队已有 dbt 基础(Rina 初级使用者)
- 易于维护(SQL + Jinja)
- 易于测试(dbt tests)
- 集成 Postgres 原生

### 为什么不动 Notion schema

- 销售团队是主要使用者,改 schema 影响他们
- Notion API 只读权限足够
- 简化变更管理

## 数据流详解

### Step 1:Notion API 监听(每 5 分钟)

```python
# Airbyte Notion Source
{
  "config": {
    "credentials": {
      "auth_type": "OAuth2.0",
      "client_id": "...",
      "client_secret": "...",
      "access_token": "..."
    },
    "page_size": 100,
    "start_date": "2026-06-01T00:00:00Z"
  }
}
```

### Step 2:Raw 数据存储(S3 staging)

- 格式:JSONL(每行一个客户记录)
- 加密:AES-256
- 保留:7 天
- 位置:`s3://beta-sync-staging/raw/`

### Step 3:dbt 模型转换 + 加密

```sql
-- models/staging/stg_notion_clients.sql
{{ config(materialized='incremental', unique_key='client_id') }}

with source as (
    select * from {{ source('notion_raw', 'clients') }}
    {% if is_incremental() %}
    where last_edited_time > (select max(last_edited_time) from {{ this }})
    {% endif %}
),

renamed as (
    select
        id as client_id,
        client_name,
        contact_person,
        pgp_sym_encrypt(email, current_setting('app.kms_key')) as email_encrypted,
        pgp_sym_encrypt(phone, current_setting('app.kms_key')) as phone_encrypted,
        company_address,
        pgp_sym_encrypt(contract_value::text, current_setting('app.kms_key'))::numeric as contract_value_encrypted,
        sign_date,
        status,
        sales_owner,
        industry,
        notes,
        last_edited_time
    from source
)

select * from renamed
```

### Step 4:Postgres UPSERT

```sql
-- 自动由 dbt 处理 incremental model
-- 第一次全量,后续增量
```

### Step 5:审计日志(CloudTrail)

```python
# 每次同步写一条 CloudTrail 事件
{
  "event_name": "NotionSync.Write",
  "user_identity": "airbyte-sync-job",
  "event_time": "2026-06-30T10:30:00Z",
  "request_parameters": {
    "records_synced": 50,
    "records_failed": 0
  }
}
```

## 性能估算

### 初始化(5000 行)

| 步骤 | 耗时 |
|---|---|
| Notion API 拉取(50 次 × 100 行) | 15 分钟 |
| S3 staging 写入 | 2 分钟 |
| dbt 全量转换 + 加密 | 8 分钟 |
| Postgres 写入 | 5 分钟 |
| **总计** | **30 分钟** |

### 增量(每天 50 行)

| 步骤 | 耗时 |
|---|---|
| Notion API 增量查询 | < 1 分钟 |
| dbt 增量转换 | < 1 分钟 |
| Postgres UPSERT | < 1 分钟 |
| **总计** | **< 3 分钟** |

## 部署架构

### 自托管 Airbyte

- AWS ECS Fargate(2 tasks,auto-scaling)
- 最小规格:0.5 vCPU / 1GB RAM
- 成本:USD 50/月

### dbt

- dbt Cloud 或自托管
- 推荐自托管(AWS ECS,低成本)

### Postgres

- 使用客户现有 RDS,新建 `staging` schema
- 不修改现有 schema

## 成本估算

| 项目 | 月度成本 |
|---|---|
| Airbyte 自托管 | USD 50 |
| dbt 自托管 | USD 30 |
| S3 staging(7 天) | USD 10 |
| KMS + CloudTrail | USD 20 |
| 工程师时间(我方,2 周) | USD 8,000 |
| **总计** | **USD 8,110** |

## 后续扩展路径

### Phase 2:双向同步(6 周,另议)

- 增加 Postgres → Notion 反向同步
- 冲突解决策略(last-write-wins)
- 增量双向 + CRDT

### Phase 3:实时 webhook(4 周,另议)

- Notion Webhook 触发(替代 5 分钟轮询)
- 延迟降至 < 30 秒

### Phase 4:多数据源(8 周,另议)

- HubSpot 集成
- Airtable 集成
- 统一数据模型

### Phase 5:自定义字段映射(6 周,另议)

- 客户可配置字段映射
- YAML 配置
- 动态 schema 适配

---

## Natively 应提供的辅助

### 当 Sam 描述方案时

Natively 应基于本方案确认:
> "我们的方案是 Airbyte + dbt:
> - Airbyte 监听 Notion API(5 分钟轮询)
> - S3 做 staging(JSONL + 加密)
> - dbt 做转换 + 字段级加密(PGP)
> - Postgres UPSERT 到 staging schema
> - CloudTrail 审计
>
> 不动 Notion schema,符合你们销售团队的诉求。"

### 当 Sam 问"实时性"时

Natively 应基于本方案回答:
> "MVP 是 5 分钟轮询。
> Phase 3 可以做到 < 30 秒延迟(用 Notion Webhook),但需要 4 周。
>
> 5 分钟对你们当前的 24 小时延迟已经是巨大提升。"

---

## 关联材料

- 客户档案:`./customer_profile.md`
- 客户架构:`./customer_architecture.md`
- 安全要求:`./security_requirements.md`
- 原型范围:`./prototype_scope.md`
- 交付风险:`./delivery_risk.md`