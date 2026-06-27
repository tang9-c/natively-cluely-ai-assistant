# Prototype Scope — Beta Corp MVP

> **Scenario DocSubtype**: `prototype-scope`
> **场景模式**: FDE
> **用途**:Master transcript 段 5 中 Natively 应基于本范围定义 MVP 边界,避免 scope creep。

---

## MVP 定义

### 目标(MVP 范围)

**只做 Notion → Postgres 单向同步**,2 周内交付。

### 不在 MVP 范围(明确排除)

- ❌ Postgres → Notion 反向同步
- ❌ HubSpot 集成
- ❌ Airtable 集成
- ❌ 实时 webhook(< 5 分钟延迟用轮询即可)
- ❌ 多语言支持(只支持英文)
- ❌ 自定义字段映射(只支持预定义字段)

### 未来扩展(已规划,本期不做)

- 双向同步(P3,6 周)
- 实时 webhook(P3,4 周)
- 多数据源(P3,8 周)
- 自定义字段映射(P3,6 周)

## 功能范围

### 必须包含

1. **Notion API 监听**:每 5 分钟轮询 Notion 客户表
2. **增量同步**:只同步变更的行(基于 last_edited_time)
3. **字段映射**:预定义 12 个字段的映射
4. **Postgres UPSERT**:写入 staging schema
5. **错误处理**:失败重试 + Slack 告警
6. **审计日志**:每次同步写 CloudTrail
7. **基础监控**:成功率 / 延迟 dashboard

### 字段映射(预定义)

| Notion 字段 | Postgres 字段 | 类型 |
|---|---|---|
| Client Name | client_name | TEXT |
| Contact Person | contact_person | TEXT |
| Email | email_encrypted | BYTEA(加密) |
| Phone | phone_encrypted | BYTEA(加密) |
| Company Address | company_address | TEXT |
| Contract Value | contract_value_encrypted | NUMERIC(加密) |
| Sign Date | sign_date | DATE |
| Status | status | TEXT |
| Sales Owner | sales_owner | TEXT |
| Industry | industry | TEXT |
| Notes | notes | TEXT |
| Last Edited Time | last_edited_time | TIMESTAMP |

### 技术栈

```
Notion API
    ↓
Airbyte Source Connector (Notion)
    ↓
dbt Model (transform + encrypt)
    ↓
Postgres staging schema
    ↓
CloudTrail (audit log)
    ↓
Slack (alert on error)
```

## 验收标准

### 功能验收

- [ ] 能从 Notion 客户表拉取所有现有行(约 5,000 行)
- [ ] Notion 新增/修改/删除一行,5 分钟内同步到 Postgres
- [ ] 字段映射正确,无遗漏
- [ ] PII 字段加密后存储
- [ ] 失败重试 3 次后告警 Slack
- [ ] 审计日志写入 CloudTrail

### 性能验收

- [ ] 5,000 行初始化同步 < 30 分钟
- [ ] 单行同步延迟 < 5 分钟(P95)
- [ ] 每日增量(50 行)同步 < 1 分钟
- [ ] 错误率 < 0.5%

### 安全验收

- [ ] PII 字段加密(AES-256-GCM)
- [ ] 数据驻留新加坡
- [ ] CloudTrail 审计日志
- [ ] SOC2 报告随方案交付
- [ ] DPA 已签署

## 交付物清单

### 代码

- Airbyte Notion Source Connector(Docker image)
- dbt 模型(SQL 文件)
- 部署脚本(Terraform)
- README + 运维手册

### 文档

- 架构图
- 字段映射表
- 故障排查手册
- SOP(数据工程师培训用)

### 服务

- 2 周内完成
- 1 周并行运行(原手动流程)
- 1 周 Rina 培训
- 1 周交付后支持

## 时间线

```
Week 1: 开发 + 测试
├─ Day 1-2: Notion API 集成
├─ Day 3-4: dbt 模型 + 加密
├─ Day 5: 错误处理 + 告警
└─ Day 6-7: 集成测试 + 性能调优

Week 2: 部署 + 培训 + 交付
├─ Day 8: 生产部署
├─ Day 9-10: 影子运行(只读,人工比对)
├─ Day 11: 切换到自动(主路径)
├─ Day 12-13: Rina 培训
└─ Day 14: 项目交付 + 文档
```

## 成功指标

| 指标 | 当前 | MVP 完成后 |
|---|---|---|
| 数据延迟 | 24 小时 | < 5 分钟 |
| 每天人工耗时 | 4 小时 | < 30 分钟 |
| 错误率 | 2-3 次/月 | < 1 次/月 |
| Sales 满意度 | 60% | > 85% |
| 月度节省 | — | USD 4,250 |

## 假设与依赖

### 假设

- Notion API 限制(3 req/s)足够支持我们的轮询频率
- Postgres RDS 实例允许 staging schema
- Rina 有 1 周时间投入培训
- 销售团队继续使用 Notion,不切换工具

### 依赖

- AWS 账户访问权限(VPC / KMS / S3)
- Notion 集成 Token
- Postgres 写入权限(staging schema)
- Slack 告警 webhook

### 风险

- Notion API 限流 → 用增量 + 缓存缓解
- KMS 密钥访问问题 → 提前申请权限
- 网络隔离(无外网) → 提前确认白名单

## Out of Scope(明确不做)

### 本期不做,客户明确同意

- ❌ 反向同步(P3)
- ❌ 实时 webhook(P3)
- ❌ 自定义字段映射(P3)
- ❌ 多语言支持
- ❌ HubSpot 集成

### 客户可能误期望的

- "以为是双向同步" → 在 kickoff 时明确沟通
- "以为是实时" → 在 kickoff 时说明是 5 分钟轮询
- "以为是所有字段" → 在 kickoff 时确认字段列表

---

## Natively 应提供的辅助

### 当 Sam 说"两周内原型"时

Natively 应基于本范围确认:
> "2 周 MVP 是 Notion → Postgres 单向同步,5 分钟轮询,12 个预定义字段,PII 加密。
> 不包含:
> - 反向同步(6 周)
> - 实时 webhook(4 周)
> - 自定义字段映射
> 是否符合预期?"

### 当 Sam 问"双向要多久"时

Natively 应基于本范围回答:
> "双向同步约 6 周(MVP 完成后启动),主要工作是冲突解决:
> - Last-write-wins(简单,2 周)
> - CRDT(复杂,4 周)
> 建议先用 2 周跑单向 MVP,验证后再决定双向策略。"

---

## 关联材料

- 客户档案:`./customer_profile.md`
- 客户工作流:`./customer_workflow.md`
- 交付风险:`./delivery_risk.md`
- 方案简介:`./solution_brief.md`