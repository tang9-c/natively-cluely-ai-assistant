# Decision Log — 历史决策记录

> **Scenario DocSubtype**: `decision-log`
> **场景模式**: Team Meet
> **用途**:Master transcript 段 3 中 Natively 应基于本决策日志回答"上次决定算数吗"这类追问。

---

## 已决策项

### D-2026-04-12:数据库选型

- **决策**:从 MySQL 8 迁移到 PostgreSQL 17
- **背景**:MySQL 在 JSON 查询和全文检索上性能不足
- **依据**:团队投票 6:2,Alex 投反对(MySQL 经验)
- **后续**:周一前 legal 合规确认

### D-2026-04-25:前端框架升级

- **决策**:保留 React 18,不升级到 19
- **背景**:React 19 还在 RC,且生态库未跟进
- **依据**:Sarah 提议,Alex 同意
- **后续**:6 个月后再评估

### D-2026-05-08:部署架构

- **决策**:从 AWS ECS 迁移到 Kubernetes (EKS)
- **背景**:ECS 容器调度不够灵活
- **依据**:Emma 提议,Alex 同意
- **后续**:Q3 完成迁移

### D-2026-05-22:监控告警

- **决策**:从 Datadog 切换到 Grafana Stack
- **背景**:Datadog 成本过高,年度合同 USD 80K
- **依据**:Emma + Alex 共同提议
- **后续**:6 月完成

### D-2026-06-05:产品方向

- **决策**:Q3 重点投入"会议自动化"模块
- **背景**:客户调研显示该模块需求最强
- **依据**:Mei + 销售反馈
- **后续**:本周内出 PRD

### D-2026-06-12:招聘冻结

- **决策**:非核心岗位冻结到 Q3 末
- **背景**:现金跑道需要延长
- **依据**:CEO 决定
- **后续**:HR 通知到位

### D-2026-06-19:支付集成方案

- **决策**:采用 Stripe + 国内银行直连双轨
- **背景**:海外客户用 Stripe,国内银行直连
- **依据**:Alex 提议,Risky 实施
- **后续**:Risky 本周给时间线

### D-2026-06-22:事故复盘

- **决策**:建立 incident review checklist
- **背景**:上周 P2 事故处理流程不够规范
- **依据**:Emma 提议
- **后续**:本周内出 checklist

## 待决项(对应本周议程)

### D-Pending-1:Postgres 升级版本

- **背景**:D-2026-04-12 决策迁移到 Postgres,但版本未定
- **选项**:17(已投票) / 18(新特性)
- **状态**:等待 legal 合规确认
- **决策人**:Alex
- **截止**:周一

### D-Pending-2:launch checklist 范围

- **背景**:Q3 launch 范围未定
- **选项**:完整 launch / 分阶段 launch / 推迟到 Q4
- **状态**:本次会议讨论
- **决策人**:Mei + Alex
- **截止**:本周

### D-Pending-3:风险登记表更新

- **背景**:上次更新是 2026-05
- **状态**:Emma 提议本周更新
- **截止**:本周五

### D-Pending-4:团队季度 OKR

- **背景**:Q2 OKR 完成度待评估
- **状态**:Mei 提议下周一专题会
- **截止**:下周

### D-Pending-5:代码 review SLA

- **背景**:review 排队时间有时 > 2 天
- **状态**:Alex 提议设为 24h SLA
- **截止**:本周

---

## Natively 应提供的辅助

### 当 Mei 说"就用 Postgres 17"时

Natively 应基于本日志确认:
> "本决策对应 D-2026-04-12,数据库选型已决定迁移到 Postgres,但版本待定。本周需 legal 合规确认 17 是否满足合规要求。"

### 当 Alex 说"最终决定"时

Natively 应捕获为决策更新:
> "决策 D-Pending-1:Postgres 升级版本 —— 维持 Postgres 17,等待 legal 合规确认。"

---

## 关联材料

- 与会人员:`./attendees.md`
- 议程:`./agenda.md`
- 参考资料:`./references.md`