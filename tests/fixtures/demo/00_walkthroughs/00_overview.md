# Walkthrough — 总览

> 5 个场景演示的统一流程。

---

## 操作流程

### Step 0:准备(2 分钟)

1. 启动 Natively,确认 v0.4+
2. Settings → Storage → Clear(清空 DB)
3. Settings → ASR → 切换到中文引擎
4. 把 `tests/fixtures/demo/` 复制到本地工作目录

### Step 1:加载演示数据(5 分钟)

按以下顺序加载每个场景的参考文件:

| 场景 | 模式 | 文件数 | Walkthrough |
|---|---|---|---|
| 1. Sales | `sales` | 5 + 3 KB | `01_sales_walkthrough.md` |
| 2. Tech Interview | `technical-interview` | 3 + 3 KB | `02_tech_interview_walkthrough.md` |
| 3. Team Meet | `team-meet` | 4 + 3 KB | `03_team_meet_walkthrough.md` |
| 4. Lecture | `lecture` | 3 + 3 KB | `04_lecture_walkthrough.md` |
| 5. FDE | `fde` | 7 + 3 KB + 3 Profile | `05_fde_walkthrough.md` |

### Step 2:运行 Master Transcript(6-8 分钟)

播放 `03_master_transcript/master_transcript.md` 全文。

切换 active mode 时机:
- 0:00 → Sales
- 1:15 → Technical Interview
- 2:30 → Team Meet
- 3:45 → Lecture
- 5:00 → FDE

### Step 3:回放检查(2 分钟)

按以下清单逐项打勾。

---

## 完整回放检查清单(21 项)

### Sales 段(0:00-1:15)— 5 项

- [ ] Jordan 说"现在怎么衡量效果" → `discovery_probe` 触发,AI 弹出 ROI 入口
- [ ] Jordan 说"价格太高了" → `handle_objection` 触发,AI 引用 KB 给出异议处理话术
- [ ] Jordan 说"下周想推进到法务审核" → `seize_signal` 触发,AI 生成下一步清单
- [ ] Alex 说"发一版报价" → `confirm` 触发,AI 自动起草邮件草稿(detectConfirmAndEmitDynamicActions)
- [ ] 段末触发 `runRecap`,弹出整段摘要

### Tech Interview 段(1:15-2:30)— 4 项

- [ ] Priya 说"能详细讲讲" → `deep_dive` 触发,AI 给出 Postgres vs Cassandra 详细对比
- [ ] Alex 说"举个例子" → `example_request` 触发,`runClarify` 给出追问建议
- [ ] Priya 说"写一下代码" → `coding` 触发,`runCodeHint` 弹出 LRU 脚手架
- [ ] Priya 说"再多说一下并发" → `deep_dive` 触发,AI 给出并发补丁

### Team Meet 段(2:30-3:45)— 5 项

- [ ] Mei 说"现在如何" → `status_update` 触发,AI 给出状态摘要
- [ ] Alex 说"我来做" + "周五前" → `capture_action` 自动写入行动卡
- [ ] Mei 说"卡在第三方" → `capture_risk` 自动写入风险卡
- [ ] Mei 说"就用 Postgres 17" → `capture_decision` 自动写入决策日志
- [ ] 段末触发 `runRecap`

### Lecture 段(3:45-5:00)— 4 项

- [ ] Prof. Liang 说"这个叫 consistent hashing" → `explain_concept` 触发
- [ ] Prof. Liang 说"公式推导" → `render_formula` 触发,LaTeX 渲染
- [ ] Prof. Liang 说"谁知道" → `answer_class_question` 触发,`runManualAnswer` 准备
- [ ] Alex 说"能解释" → `clarification` 触发,`runClarify` 给出建议

### FDE 段(5:00-6:30)— 5 项

- [ ] Alex 说"深入讲" → `deep_dive` 触发,AI 展开方案
- [ ] Sam 说"能详细讲安全" → KB 检索 `security_requirements.md` 命中
- [ ] Sam 说"风险" + "依赖" → `capture_risk` 自动写入风险卡
- [ ] Sam 说"就这样定" → `capture_decision` 写入决策
- [ ] 段末触发 `runBrainstorm`

### 跨场景功能(2 项)

- [ ] Profile 智能:Alex 在 FDE 段引用简历 + JD 自动出现
- [ ] KB 检索:销售段 + FDE 段命中知识库材料

---

## 触发统计

| 段 | intent 匹配 | assist 调用 |
|---|---|---|
| 1 (Sales) | 4 | 5 |
| 2 (Tech) | 4 | 4 |
| 3 (Team) | 4 | 5 |
| 4 (Lecture) | 4 | 3 |
| 5 (FDE) | 5 | 5 |
| **合计** | **21** | **22** |

---

## 时间预算

- 数据加载:5 分钟
- Master transcript 播放:6.5 分钟
- 检查清单:2 分钟
- **总计**:~15 分钟

---

## 录制建议

### 推荐方式

1. **团队真人朗读**(最佳):6 个角色
2. **TTS + 拼接**:Edge TTS 各段拼接
3. **手动触发**:开发者模式下复制 transcript 到 Transcript 输入框

### 视频录制

- 屏幕录制 Natively 主界面 + 摄像头
- 配合字幕显示对话
- 每个 assist 触发时高亮 UI 位置

---

## 后续

- 单场景快速演示:用 `05_segment_clips/` 下 30 秒片段
- 自定义场景:修改 `03_master_transcript/master_transcript.md` 触发特定 intent
- E2E 测试:基于 `03_master_transcript/master_transcript.json` 写测试