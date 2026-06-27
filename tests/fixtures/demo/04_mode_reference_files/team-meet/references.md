# References — 参考资料链接

> **Scenario DocSubtype**: `references`
> **场景模式**: Team Meet
> **用途**:Master transcript 段 3 周会中,Natively 可基于本参考资料回答"上次那个风险登记在哪看"等查询。

---

## 内部资料链接

### 风险登记册
- URL:`https://internal.natively.com/risk-register`
- Owner:Emma Wu(SRE)
- 更新频率:每周
- 当前风险数:12(3 高/6 中/3 低)

### Launch Checklist
- URL:`https://internal.natively.com/launch-checklist-q3`
- Owner:Mei Wong(PM)
- 状态:Q3 launch 准备中
- 完成度:65%

### 性能 Dashboard
- URL:`https://grafana.natively.com/d/performance`
- Owner:Tom Liu
- 更新频率:实时
- 关键指标:P50/P95/P99 延迟、错误率、QPS

### 事故复盘文档
- URL:`https://internal.natively.com/incident-reviews`
- Owner:Emma Wu
- 最近事故:2026-06-19(P2)
- 平均恢复时间(MTTR):47 分钟

### 季度 OKR 文档
- URL:`https://internal.natively.com/okr-2026-q2`
- Owner:Mei Wong
- 状态:Q2 评估中
- 完成度:78%

### 技术决策文档(ADR)
- URL:`https://internal.natively.com/adr`
- Owner:Alex Chen
- 共 23 篇 ADR
- 最近:ADR-023(支付集成方案)

### 代码 Review 看板
- URL:`https://github.com/natively/eng/projects/1`
- Owner:Alex Chen
- 排队 PR:8 个
- 平均 review 时间:18 小时

## 外部资料

### 行业报告
- [Gartner 2026 AI Meeting Tools 魔力象限](#) — Natively 评为 Visionary
- [Forrester Wave:Conversation Intelligence Q2 2026](#)
- [CB Insights:AI Sales Tools 2026 趋势](#)

### 技术博客
- [Natively 工程博客:从 Otter 迁移到自研的 6 个月](https://blog.natively.com/migration-otter)
- [LLM 路由架构:从 7 个 provider 中选最优](https://blog.natively.com/llm-routing)

### 客户案例
- Halcyon Industries:ROI 260 倍案例
- 3 个匿名客户 SaaS 迁移案例

## 工具与系统

| 系统 | 用途 | URL |
|---|---|---|
| Slack | 日常沟通 | natively.slack.com |
| Linear | 项目管理 | linear.app/natively |
| Figma | 设计 | figma.com/natively |
| Notion | 文档 | natively.notion.site |
| GitHub | 代码 | github.com/natively |
| Grafana | 监控 | grafana.natively.com |
| Sentry | 错误追踪 | sentry.io/natively |
| PagerDuty | 告警 | natively.pagerduty.com |

---

## Natively 应提供的辅助

### 当有人问"上次决定"时

Natively 应基于本参考资料 + `./decision_log.md` 给出:
- "上次决定 D-2026-04-12,数据库选型投票 6:2 通过 Postgres。版本待定。"

### 当有人问"风险登记"时

Natively 应提示:
- "风险登记册:https://internal.natively.com/risk-register (Owner: Emma)"
- "当前 12 个风险,3 个高优先级。"

---

## 关联材料

- 与会人员:`./attendees.md`
- 议程:`./agenda.md`
- 历史决策:`./decision_log.md`