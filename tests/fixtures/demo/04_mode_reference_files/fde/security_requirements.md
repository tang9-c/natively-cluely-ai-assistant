# Security Requirements — Beta Corp

> **Scenario DocSubtype**: `security-requirements`
> **场景模式**: FDE
> **用途**:Master transcript 段 5 中客户说"PII 数据"时,Natively 应基于本文件列出完整合规清单。

---

## 合规框架

### 主要合规

- **SOC2 Type II**(已认证,2025 年完成)
- **GDPR**(涉及欧盟客户,需要)
- **PDPA Singapore**(新加坡个人数据保护法)
- **PDPA Indonesia**(印尼,部分客户)

### 行业合规

- 暂不需要 HIPAA(非医疗)
- 暂不需要 PCI DSS(支付走 Stripe,数据不经过我们)

## 数据分类

### PII(Personal Identifiable Information)

需要加密存储 + 严格访问控制:

| 字段 | 加密要求 | 访问控制 |
|---|---|---|
| 客户姓名 | 字段级 | Sales/CS/Eng |
| 邮箱 | 字段级 | Sales/CS/Eng |
| 电话 | 字段级 | Sales/CS/Eng |
| 客户公司地址 | 不需要 | 全员 |
| 合同金额 | 字段级 | Sales/Finance |
| 客户身份证号 | 字段级 + 审计 | 仅 Compliance |

### 非 PII

- 客户公司名(公开信息)
- 行业(公开信息)
- 销售阶段(内部)

## 数据驻留(Data Residency)

### 要求

- **新加坡客户**:数据必须存储在新加坡(ap-southeast-1)
- **印尼客户**:数据可以存储在新加坡或印尼(ap-southeast-3 / ap-southeast-1)
- **其他东南亚客户**:新加坡即可

### 当前部署

- AWS RDS 单实例在 ap-southeast-1(新加坡)
- 备份也在新加坡
- ✅ 满足新加坡客户要求
- ⚠️ 印尼客户需要确认(目前用新加坡)

## 加密要求

### At Rest

- RDS:AWS KMS 加密,密钥每 90 天轮换
- S3(如使用):AES-256
- 字段级加密(AES-256-GCM):PII 字段
- 密钥管理:AWS KMS

### In Transit

- 所有外部 API:HTTPS + TLS 1.3
- 内部服务:mTLS 或 VPC 内网
- 证书:Let's Encrypt(自动续期)

## 访问控制

### RBAC 角色

| 角色 | 权限 |
|---|---|
| Sales | 读/写自己负责的客户 |
| CS | 读所有客户 |
| Data Engineer | 读所有 + 写 staging schema |
| Compliance | 读所有 + 审计日志 |
| Engineer | 读 metadata(不读 PII) |

### 实现方式

- Postgres RLS(Row Level Security)
- 应用层权限校验
- 审计日志记录所有访问

## 审计日志

### 要求

- **保留期**:7 年(法规要求)
- **内容**:谁 + 何时 + 改了什么
- **不可篡改**:WORM 存储

### 当前实现

- CloudTrail(90 天热存储)
- S3 Glacier(7 年冷存储)
- 每条记录包含:user_id, action, target, before/after, timestamp

### 本项目要求

- 我们方案产生的所有数据变更需写入 CloudTrail
- 错误日志保留 1 年
- 数据访问日志保留 7 年

## 数据生命周期

```
[录入] → [处理] → [存储] → [删除]

Notion     我们的方案      Postgres        请求时
                       (7 年保留)        (30 天内)
                                          ↓
                                     备份删除(60 天)
```

### 保留期

- 活跃数据:7 年
- 备份:60 天后删除
- 审计日志:7 年

### 删除

- 客户请求删除时:30 天内删除所有相关数据(包括备份)
- 删除记录写入审计日志(只记录"已删除",不记录内容)

## 第三方供应商要求

### 评估清单

- ✅ SOC2 Type II 报告
- ✅ 数据处理协议(DPA)签署
- ✅ 数据驻留声明
- ✅ 事件响应计划
- ✅ 渗透测试报告(年度)
- ✅ BAA(如有 HIPAA)

### 当前供应商

- AWS:SOC2 + ISO 27001
- Notion:SOC2 Type II
- HubSpot:SOC2 Type II
- Stripe:PCI DSS Level 1

## 事故响应

### P0/P1 事故

- 30 分钟内通知 Compliance Officer
- 4 小时内初步评估
- 24 小时内客户通知(如影响客户数据)
- 72 小时内详细报告

### 审计要求

- 季度内部审计
- 年度外部审计
- 每次重大变更后审计

---

## Natively 应提供的辅助

### 当 Sam 说"客户表里有 PII"时

Natively 应基于本文件提示:
> "我们的方案会做:
> 1. 字段级加密(AES-256-GCM)
> 2. Postgres RLS 控制访问
> 3. 所有变更写入 CloudTrail
> 4. 数据驻留新加坡
> 5. SOC2 报告随方案交付
>
> 我们的方案产生的数据同步链路已通过 SOC2 Type II 审计。"

### 当 Sam 问"审计日志怎么存"时

Natively 应基于本文件回答:
> "审计日志:
> - CloudTrail 热存储 90 天
> - S3 Glacier 冷存储 7 年
> - 不可篡改(WORM)
> - 包含 user_id / action / target / before / after / timestamp
>
> 我们方案的每次数据变更都会触发 CloudTrail 事件。"

---

## 关联材料

- 客户档案:`./customer_profile.md`
- 客户架构:`./customer_architecture.md`
- 交付风险:`./delivery_risk.md`