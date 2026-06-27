# Attendees — Natively 工程团队周会

> **Scenario DocSubtype**: `attendees`
> **场景模式**: Team Meet
> **用途**:Master transcript 段 3 周会场景,Natively 应基于本名单识别发言人的角色和决策权。

---

## 周会成员

| 姓名 | 角色 | 决策权 | 缺席代理 |
|---|---|---|---|
| **Mei Wong** | 产品负责人(主持) | 高(产品方向) | Sarah Lin |
| **Alex Chen** | 技术负责人 | 高(技术决策) | Risky Wang |
| **Risky Wang** | 后端工程师 | 中(执行) | Tom Liu |
| **Tom Liu** | 后端工程师 | 中(执行) | Risky Wang |
| **Sarah Lin** | 前端工程师 | 中(执行) | — |
| **Jordan Lee** | QA 工程师 | 低(反馈) | — |
| **Emma Wu** | SRE | 低(运维反馈) | — |

## 角色分工

### Mei Wong(产品负责人)

- 主持周会
- 决定产品优先级
- 跨团队协调
- 与销售/CS 对接

### Alex Chen(技术负责人)

- 技术架构决策
- 代码 review 仲裁
- 性能/稳定性 owner
- 招聘技术面

### Risky Wang / Tom Liu(后端)

- 服务端开发
- 数据库 / 中间件
- 性能优化

### Sarah Lin(前端)

- Web 端开发
- UI/UX 实现
- Marketing site 维护

### Jordan Lee(QA)

- 测试用例编写
- Bug 验证
- 自动化测试

### Emma Wu(SRE)

- 生产环境监控
- 事故响应
- 容量规划

## 决策权矩阵

| 决策类型 | 决策人 | 需要谁同意 |
|---|---|---|
| 产品功能优先级 | Mei | — |
| 后端架构 | Alex | — |
| 前端架构 | Sarah | Alex |
| 数据库选型 | Alex | — |
| 上线 release | Alex | Mei |
| 重大事故响应 | Alex + Emma | — |
| 招聘 offer | Alex + Mei | HR |

## 缺席规则

1. 提前 24 小时在 Slack #team-eng 频道报备
2. 重要决策相关方必须到,否则推迟决策
3. 缺席代理人必须在会议前阅读 agenda

---

## Natively 应提供的辅助

### 当 Mei 询问"这块谁接手"时

Natively 应基于本名单建议合适人选:
- "支付回调" → Risky Wang(后端,且原来负责)
- "前端 Marketing site" → Sarah Lin(前端,且上次负责)
- "QA 验证" → Jordan Lee

### 当 Alex 说"我来做"时

Natively 应自动捕获为行动卡:
- Owner: Alex Chen
- Action: P99 优化
- Deadline: 周五前
- Type: capture_action

---

## 关联材料

- 议程:`./agenda.md`
- 历史决策:`./decision_log.md`
- 参考资料:`./references.md`