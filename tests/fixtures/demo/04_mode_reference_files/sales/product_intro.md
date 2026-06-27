# Product Introduction — Natively 销售模块

> **Scenario DocSubtype**: `product-intro`
> **场景模式**: Sales

---

## Natively 是什么

Natively 是一款**实时 AI 会议辅助**桌面应用,在用户开会时:
1. 实时转录音频(支持中英双语)
2. 基于场景(销售/招聘/客户成功等)给出实时话术建议
3. 会后自动生成客户档案更新、行动项、下一步邮件

## 核心差异化(对比 Otter / Cluely / Gong)

### 1. 场景化(Per-Mode)能力

Natively 不是一刀切的转录工具,而是按场景定制:

| 场景 | 触发意图 | 实时辅助 |
|---|---|---|
| Sales | `seize_signal`, `handle_objection`, `discovery_probe` | 异议处理话术、ROI 计算提示、采购流程建议 |
| Recruiting | `request_example`, `behavioral` | STAR 结构追问、评分卡自动填充 |
| Tech Interview | `coding`, `deep_dive` | 系统设计脚手架、并发补丁建议 |
| Team Meeting | `capture_action`, `capture_decision`, `capture_risk` | 行动卡自动生成、决策日志、风险登记 |
| Lecture | `explain_concept`, `render_formula` | 概念解释、LaTeX 渲染 |
| FDE | `deep_dive`, `clarification` | 客户架构分析、安全合规清单、交付风险评估 |

### 2. 实时话术辅助(独有)

- Otter / Fireflies:仅会后出摘要
- Natively:**边开会边给建议**,例如客户说"价格太高"时立即弹出 ROI 计算提示

### 3. 跨会话 Profile 智能

- 上传简历/产品手册后,Natively 在所有相关会议中持续引用
- 自动维护客户档案更新,无需手动 CRM 录入

## 销售场景专属功能

1. **实时异议处理**:基于上传的 `pricing_objections.md` 等材料,在客户提出异议时自动提示应对话术
2. **下一步动作清单**:捕获 `seize_signal`(例如"我们 CFO 这周在")后,自动生成推进法务/采购的 checklist
3. **会后客户档案更新**:识别客户提到的关键信息(预算、采购窗口、决策链)自动更新到 CRM

## 演示路径(对应 master transcript 段 1)

| 时间 | 客户发言 | Natively 响应 |
|---|---|---|
| 0:00 | "现在怎么衡量效果" | 弹出 ROI 计算入口 |
| 0:22 | "价格太高了" | 调出 ROI 对比 + 阶梯报价表 |
| 0:45 | "下周想推进到法务审核" | 自动生成"推动法务流程"行动卡 |
| 0:52 | "我今天发报价" | 自动起草报价邮件草稿 |

## 客户成功指标(可向客户承诺)

- 一线销售首单成单率提升 15-30%(基于 Halcyon 案例)
- 通话后 CRM 录入时间减少 80%
- 一线销售 onboarding 时间从 3 个月缩短到 6 周

## 技术架构亮点(用于技术型买家)

- **Native 模块**:Rust napi-rs 实现音频捕获,CPU 占用 < 5%
- **本地优先**:所有音频在本地处理,只把转录文本发到云端
- **多 LLM 路由**:Gemini / Claude / GPT / Doubao / Ollama 自动选最优

---

## 关联材料

- 客户档案:`./customer_profile.md`
- 推荐方案:`./solution_brief.md`
- 客户案例:`./case_study.md`