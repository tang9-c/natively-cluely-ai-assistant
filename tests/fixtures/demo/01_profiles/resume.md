# Resume — Alex Chen

> **用途**:Tech Interview 段(段 2)演示使用,Natively 应基于本简历回答系统设计/项目深挖类追问。
> **关联场景**:Technical Interview(段 2 主)、FDE(段 5 提及项目背景)

---

## 基本信息

- **姓名**:Alex Chen(陈亚伦)
- **邮箱**:alex@natively.com
- **电话**:+1-415-555-0123
- **所在地**:San Francisco, CA
- **LinkedIn**:linkedin.com/in/alexchen-eng
- **GitHub**:github.com/alexchen-eng

## 教育背景

### 复旦大学(2013-2016)

- **学位**:计算机科学硕士
- **GPA**:3.8/4.0
- **研究方向**:分布式系统、图算法
- **论文**:
  - "Efficient Graph Partitioning for Distributed Processing"(2016)
  - "Adaptive Replication in Distributed Key-Value Stores"(2015)
- **荣誉**:国家奖学金、ACM 竞赛区域赛金牌

### 复旦大学(2009-2013)

- **学位**:计算机科学学士
- **GPA**:3.7/4.0
- **荣誉**:校优秀毕业生

## 工作经历

### Natively(2024 - 至今)| 创始人 / CTO

**公司**:Natively Inc.
**团队**:8 人
**融资**:USD 2M(Seed,2025-08)

**职责**:
- 产品方向:会议实时辅助 + 企业销售自动化
- 技术架构:Rust native module + Electron + SQLite + 多 LLM 路由
- 团队管理:从 0 到 8 人
- 客户对接:Acme Corp 等 5 家企业客户

**关键成果**:
- 8 个月从 0 到 1 上线 macOS / Windows / Linux 三平台
- 一线销售首单成单率 +28%(基于 Halcyon 客户案例)
- 2026 Gartner 评为 Visionary

---

### Datacraft(2021 - 2024)| 高级工程师 → Tech Lead

**公司**:Datacraft Inc.(B2B SaaS 电商数据中台)
**团队**:30 人工程团队(8 后端 / 6 前端 / 4 数据 / 4 QA / 4 SRE / 4 其他)
**管理范围**:6 后端工程师 + 2 数据工程师

**项目 1:订单系统重写(2022-03 至 2023-06)**

- 角色:Tech Lead
- 团队:从 2 人扩展到 6 人
- 技术栈:Python(FastAPI)+ PostgreSQL + Kafka + Redis

**背景**:
- 旧订单系统基于 PHP,扩展性差
- 日订单从 50 万增长到 200 万
- 旧系统 P99 延迟 > 2 秒

**关键决策**:
- 选择 PostgreSQL(单机分区表)而非 Cassandra
- Kafka 作为事件总线(订单状态变更)
- Redis 做热点缓存(商品库存)

**成果**:
- 峰值 QPS 1 万,P99 < 200ms
- 5.9(原 7.5)个月上线
- 差错率从 0.1% 降到 0.01%
- 团队从 2 人扩展到 6 人

---

**项目 2:支付对账引擎(2022-09 至 2023-03)**

- 角色:Tech Lead
- 团队:4 人(2 后端 + 2 数据)

**背景**:
- 客户支付渠道 5 个(Stripe / PayPal / 支付宝 / 微信 / 银行直连)
- 每天对账 500 万笔交易
- 原系统差错率 0.1%

**方案**:
- Lambda 架构 + dbt + Airflow
- 增量对账(每 15 分钟一次)
- 异常告警 + 自动补偿

**成果**:
- 差错率从 0.1% 降到 0.001%
- 对账时间从 4 小时降到 30 分钟
- 月度节省 80 小时人工

---

### 某支付公司(2018 - 2021)| Tech Lead

**公司**:Payswift(化名)
**团队**:15 人

**项目:跨境支付系统**

- 角色:Tech Lead
- 团队:8 人

**职责**:
- 主导跨境支付系统重构
- 集成 12 个国家的本地支付方式
- 与 6 家银行直连

**成果**:
- 系统日处理 USD 50M
- 差错率 < 0.001%
- 覆盖 12 个国家

---

### 某电商公司(2016 - 2018)| 后端工程师

**公司**:Shopstar(化名)
**团队**:50 人

**项目**:
- 订单系统维护
- 库存系统优化
- 促销引擎开发

---

## 技术栈

### 后端

- **语言**:Python(主力)、Go、Node.js、Ruby
- **框架**:FastAPI、Django、Express、Gin

### 数据

- **数据库**:PostgreSQL(主力)、MySQL、MongoDB、Redis、ClickHouse
- **数据栈**:dbt、Airflow、Spark、Kafka

### ML / AI

- **LLM**:OpenAI、Claude、Gemini、Doubao、本地 Ollama
- **应用**:RAG、Agent、Prompt Engineering

### 基础设施

- **容器**:Docker、Kubernetes
- **云**:AWS(主力)、GCP、阿里云
- **CI/CD**:GitHub Actions、CircleCI
- **监控**:Grafana、Prometheus、Sentry

### 前端(基础)

- React、TypeScript、TailwindCSS

### Native

- Rust(基础,napi-rs 学习)
- Electron

## 开源贡献

- **dbt-utils 贡献者**:贡献 3 个 PR(2022-2023)
- **FastAPI 文档翻译**:中文版维护者
- **Natively open source SDK**:2025 年开源

## 演讲 / 写作

- KubeCon China 2023:"Scaling PostgreSQL to 10K QPS"
- QCon 2024:"Building LLM-Powered Sales Assistant"
- 个人博客:blog.alexchen.dev(月访问 50K)

## 证书

- AWS Solutions Architect Professional(2022)
- CKAD(Certified Kubernetes Application Developer,2023)
- PostgreSQL 13 性能调优(2021)

## 奖项

- ACM 区域赛金牌(2012)
- 国家奖学金(2014, 2015)
- 复旦优秀毕业生(2013)

## 语言

- 中文(母语)
- 英文(流利,TSE 95)
- 粤语(基础)

---

## Natively 应基于本简历的回答样例

### 当面试官问"Datacraft 的订单系统"时

Natively 应基于本简历回答:
> "Alex 在 Datacraft 主导了订单系统重写(2022-03 至 2023-06),团队从 2 人扩展到 6 人。
> 关键决策:
> - PostgreSQL 单机分区表 vs Cassandra(为什么选 PG?)
> - Kafka 事件总线 vs 直接 RPC(为什么 Kafka?)
> - Redis 缓存 vs 本地缓存(为什么 Redis?)
>
> 成果:峰值 1 万 QPS,P99 < 200ms,差错率从 0.1% 降到 0.01%。"

### 当面试官问"最大成就"时

Natively 应基于本简历回答:
> "两个候选:
> 1. Datacraft 订单系统重写 —— 5 个月上线,差错率降到 0.01%,团队从 2 到 6 人
> 2. Payswift 跨境支付系统 —— 覆盖 12 国,差错率 < 0.001%
>
> 我个人认为是订单系统,因为它涉及团队扩张 + 技术决策 + 业务影响的多重挑战。"

---

## 关联材料

- Master profile:`./master_profile.md`
- 求职目标:`./job_description.md`