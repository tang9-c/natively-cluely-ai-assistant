# Customer Workflow — Beta Corp

> **Scenario DocSubtype**: `customer-workflow`
> **场景模式**: FDE
> **用途**:Master transcript 段 5 中 Natively 应基于本工作流识别"当前流程"和瓶颈。

---

## 当前工作流:Notion → SQL

### 流程图

```
[Sales 录入]       [Sales 提交]      [Data Eng 复制]      [Data Eng 验证]
    Notion             Slack              Excel            Postgres
    (CRM)              (#data-sync)       (临时)           (生产)
       │                  │                  │                 │
       │  1. 录入新客户   │                  │                 │
       ├─────────────────→│                  │                 │
       │                  │  2. 提交同步请求 │                 │
       │                  ├─────────────────→│                 │
       │                  │                  │  3. 复制数据    │
       │                  │                  ├────────────────→│
       │                  │                  │                 │
       │                  │                  │  4. 人工验证    │
       │                  │                  │   (检查字段)    │
       │                  │                  │                 │
       │                  │                  │  5. 报告完成    │
       │                  │←─────────────────┤                 │
       │                  │                  │                 │
```

### 步骤详解

#### Step 1:销售录入新客户(Notion)

- 销售在 Notion 客户表中新建一行
- 字段:客户名、联系人、合同金额、签订日期、状态
- 平均:每天 5-10 个新客户

#### Step 2:销售提交同步请求(Slack)

- 销售在 #data-sync 频道 @Data Engineer
- 附上 Notion 链接
- 一天约 10-15 个请求

#### Step 3:Data Engineer 手动复制(Excel)

- 数据工程师 Rina 收到 Slack 通知
- 打开 Notion → 复制 → 打开 Excel → 粘贴
- 一天处理 30-50 行
- 单次耗时:5-15 分钟
- **总计每天 4 小时**

#### Step 4:Data Engineer 人工验证(Postgres)

- 晚上 Rina 把 Excel 数据导入 Postgres
- 跑 SQL 校验(检查字段类型、空值、唯一性)
- 发现错误时回头找 Sales 确认

#### Step 5:报告完成

- 在 Slack 回复"Sync done"
- Sales / CS 团队才能在 BI 工具中查到

## 关键人物

### 销售(5 人)

- James Lee(SDR 主管)
- Anna Tan(SDR)
- Budi(SDR,印尼远程)
- Lisa Ng(AE)
- Reza(AE)

### 数据工程师

- **Rina Salim**:唯一的数据工程师
  - 3 年经验
  - 主要工具:Python、Postgres、dbt(初级)
  - 痛点:每天 4 小时同步工作,无法做更有价值的事

### Customer Success

- 3 人
- 依赖 BI 工具查询客户档案
- 当数据延迟 1 天,客户问问题时无法及时回答

## 痛点量化

### 时间成本

| 角色 | 每天耗时 | 每月耗时 | 折算成本 |
|---|---|---|---|
| Sales(提交请求) | 30 分钟 | 10 小时 | USD 250 |
| Data Eng(同步) | 4 小时 | 80 小时 | USD 4,000 |
| CS(查数据等待) | 1 小时 | 20 小时 | USD 500 |
| **总计** | — | **110 小时** | **USD 4,750/月** |

### 错误成本

- 每月 2-3 次抄写错误
- 每次需要 30-60 分钟排查
- 影响:客户档案与销售记录不一致,可能导致:
  - 销售重复联系客户
  - CS 给出错误信息
  - 财务对账困难

## 期望工作流(目标态)

```
[Sales 录入]       [自动同步]            [立即可用]
    Notion       我们的方案             Postgres/BI
    (CRM)             │                      │
       │              │                      │
       │  1. 录入     │                      │
       ├─────────────→│  2. dbt + Airbyte   │
       │              │     增量同步         │
       │              ├─────────────────────→│
       │              │                      │
       │              │  3. 实时可查         │
       │              │     (延迟 < 5 min)  │
       │              │                      │
```

### 自动化步骤

1. **监听 Notion 变更**:Webhook 触发
2. **dbt 增量同步**:每 5 分钟一次
3. **Postgres 写入**:UPSERT 逻辑
4. **错误告警**:Slack 通知 Rina
5. **审计日志**:CloudTrail

## 期望效果

| 指标 | 当前 | 目标 |
|---|---|---|
| 数据延迟 | 24 小时 | < 5 分钟 |
| 每天人工耗时 | 4 小时 | < 30 分钟 |
| 错误率 | 2-3 次/月 | < 1 次/月 |
| Sales 满意度 | 60% | > 90% |

---

## Natively 应提供的辅助

### 当 Sam 说"当前手动 4 小时/天"时

Natively 应基于本工作流确认:
- 4 小时来自 Rina 的"步骤 3 + 步骤 4"
- 我们的方案可以将此压缩到 30 分钟(主要是异常处理)

### 当 Sam 描述工作流时

Natively 应基于本工作流图提示:
> "我看到你们当前流程涉及 5 个步骤,涉及 Sales / Data Engineer / 多个工具。
> 我们的方案可以做的是把 Step 2-5 自动化,Step 1 保持不变(销售继续在 Notion 录入)。
> 预计节省 3.5 小时/天。"

---

## 关联材料

- 客户档案:`./customer_profile.md`
- 客户架构:`./customer_architecture.md`
- 原型范围:`./prototype_scope.md`