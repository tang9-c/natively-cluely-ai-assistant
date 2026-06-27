# Natively 演示数据总览

> 完整覆盖 5 个核心场景 + 全部 9 个会议辅助功能的演示数据。
> 适用于 Natively v0.4+ 版本。

---

## 目录

- [目的](#目的)
- [快速开始](#快速开始)
- [文件清单](#文件清单)
- [加载矩阵](#加载矩阵)
- [5 场景演示流程图](#5-场景演示流程图)
- [覆盖的会议辅助功能](#覆盖的会议辅助功能)
- [Speaker 映射规则](#speaker-映射规则)
- [常见问题](#常见问题)

---

## 目的

用这套文件可以在 10-15 分钟内**完整演示** Natively 全部 9 个会议辅助功能:

1. `runWhatShouldISay` — 实时"该说什么"建议
2. `runRecap` — 期间摘要
3. `runClarify` — 追问建议
4. `runManualAnswer` — 手动提问回答
5. `runCodeHint` — 编码提示
6. `runBrainstorm` — 头脑风暴
7. `detectConfirmAndEmitDynamicActions` — 动态动作(确认信号检测)
8. Profile 智能(跨场景档案)
9. 知识库 RAG 检索(跨场景知识)

---

## 快速开始

### Step 0:准备(2 分钟)

1. 安装 Natively v0.4+,启动应用
2. 清空本地数据库(Settings → Storage → Clear)
3. 确认设置:中文 ASR 引擎打开(因为演示稿是中文)
4. 把 `tests/fixtures/demo/` 整个目录复制到本地工作目录

### Step 1:加载演示数据(5 分钟)

按场景顺序加载(详见 `00_walkthroughs/`):

| 场景 | 模式 | 加载步骤文档 |
|---|---|---|
| 1. Sales | `sales` | `00_walkthroughs/01_sales_walkthrough.md` |
| 2. Tech Interview | `technical-interview` | `00_walkthroughs/02_tech_interview_walkthrough.md` |
| 3. Team Meet | `team-meet` | `00_walkthroughs/03_team_meet_walkthrough.md` |
| 4. Lecture | `lecture` | `00_walkthroughs/04_lecture_walkthrough.md` |
| 5. FDE | `fde` | `00_walkthroughs/05_fde_walkthrough.md` |

### Step 2:运行 Master Transcript(6-8 分钟)

打开 `03_master_transcript/master_transcript.md`,把整段对话用以下任一方式播放:

- **真人朗读**:分配 6 个角色给团队成员
- **TTS**:Edge TTS / 火山引擎 / ElevenLabs(中文选云希/晓晓/茂茂)
- **手动触发**:把对话复制到 Transcript 输入框(开发者模式)

### Step 3:回放检查(2 分钟)

按 `00_walkthroughs/00_overview.md` 检查清单逐项打勾 21 个预期触发点。

---

## 文件清单

### 主交付物

```
tests/fixtures/demo/
├── README.md                                  # 本文档
├── 03_master_transcript/
│   ├── master_transcript.md                  # 主对话稿(~360 行,5-7 分钟)
│   └── master_transcript.json                # 结构化版本(含 expected_intent)
└── 05_segment_clips/
    ├── seg1_sales.md                          # 30 秒单场景片段
    ├── seg2_tech_interview.md
    ├── seg3_team_meet.md
    ├── seg4_lecture.md
    └── seg5_fde.md
```

### 模式参考文件(22 份)

```
04_mode_reference_files/
├── sales/
│   ├── customer_profile.md
│   ├── product_intro.md
│   ├── solution_brief.md
│   ├── case_study.md
│   └── pricing_objections.md
├── technical-interview/
│   ├── technical_spec.md
│   ├── rubric.md
│   └── practice_problem.md
├── team-meet/
│   ├── attendees.md
│   ├── agenda.md
│   ├── decision_log.md
│   └── references.md
├── lecture/
│   ├── audience_profile.md
│   ├── outline.md
│   └── references.md
└── fde/
    ├── customer_profile.md
    ├── customer_architecture.md
    ├── customer_workflow.md
    ├── security_requirements.md
    ├── prototype_scope.md
    ├── delivery_risk.md
    └── solution_brief.md
```

### Profile 数据(3 份)

```
01_profiles/
├── master_profile.md                          # Alex Chen 主档案
├── resume.md                                  # 简历
└── job_description.md                         # 求职目标 JD
```

### 知识库资料(3 份)

```
02_knowledge_base/
├── kb_natively_product_overview.md            # Natively 产品手册
├── kb_competitor_matrix.csv                   # 竞品对比
└── kb_objection_playbook.md                   # 异议处理剧本
```

### Walkthrough 文档(6 份)

```
00_walkthroughs/
├── 00_overview.md                             # 总览 + 检查清单
├── 01_sales_walkthrough.md                    # 销售场景演示步骤
├── 02_tech_interview_walkthrough.md           # 技术面试演示步骤
├── 03_team_meet_walkthrough.md                # 团队会议演示步骤
├── 04_lecture_walkthrough.md                  # 讲座演示步骤
└── 05_fde_walkthrough.md                      # FDE 演示步骤
```

**总计 45 个文件**。

---

## 加载矩阵

| 文件 | Sales | Tech Int | Team Meet | Lecture | FDE |
|---|---|---|---|---|---|
| `04_mode_reference_files/sales/*` (5 份) | ✅ | | | | |
| `04_mode_reference_files/technical-interview/*` (3 份) | | ✅ | | | |
| `04_mode_reference_files/team-meet/*` (4 份) | | | ✅ | | |
| `04_mode_reference_files/lecture/*` (3 份) | | | | ✅ | |
| `04_mode_reference_files/fde/*` (7 份) | | | | | ✅ |
| `02_knowledge_base/*` (3 份) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `01_profiles/master_profile.md` | | | | | ✅ |
| `01_profiles/resume.md` | | | | | ✅ |
| `01_profiles/job_description.md` | | | | | ✅ |

> **注**:Profile 数据关联到 fde 模式演示,展示 Profile 智能。其他模式不关联 Profile。

---

## 5 场景演示流程图

```
开始
  ↓
激活 Sales 模式
  ↓
上传 5 份 sales 参考文件 + 3 份 KB
  ↓
播放 master_transcript 段 1(0:00-1:15)
  ↓
[触发] discovery_probe + handle_objection + seize_signal + confirm + runRecap
  ↓
切换到 Technical Interview 模式
  ↓
上传 3 份 tech-interview 参考文件
  ↓
播放段 2(1:15-2:30)
  ↓
[触发] deep_dive + example_request + coding + runCodeHint
  ↓
切换到 Team Meet 模式
  ↓
上传 4 份 team-meet 参考文件
  ↓
播放段 3(2:30-3:45)
  ↓
[触发] status_update + capture_action + capture_risk + capture_decision + runRecap
  ↓
切换到 Lecture 模式
  ↓
上传 3 份 lecture 参考文件
  ↓
播放段 4(3:45-5:00)
  ↓
[触发] explain_concept + render_formula + answer_class_question + runClarify
  ↓
切换到 FDE 模式
  ↓
上传 7 份 fde 参考文件 + 关联 3 份 Profile
  ↓
播放段 5(5:00-6:30)
  ↓
[触发] deep_dive + KB 检索 + capture_risk + capture_decision + runBrainstorm
  ↓
结束(共 21 次 intent 匹配,9 个核心功能)
```

---

## 覆盖的会议辅助功能

### 1. `runWhatShouldISay`(实时"该说什么")

- **触发场景**:每段都有多次触发
- **对应 trigger**:所有段
- **演示证据**:master transcript 全文

### 2. `runRecap`(期间摘要)

- **触发场景**:sales 段末、team-meet 段末
- **对应 trigger**:无明确关键词,周期性触发
- **演示证据**:段 1 末 + 段 3 末

### 3. `runClarify`(追问建议)

- **触发场景**:lecture 段 + tech-interview 段 + fde 段
- **对应 trigger**:clarification intent
- **演示证据**:段 2(1:40)+ 段 4(4:50)+ 段 5(6:25)

### 4. `runManualAnswer`(手动提问)

- **触发场景**:lecture 段
- **对应 trigger**:answer_class_question
- **演示证据**:段 4(4:35)

### 5. `runCodeHint`(编码提示)

- **触发场景**:tech-interview 段
- **对应 trigger**:coding
- **演示证据**:段 2(2:00)

### 6. `runBrainstorm`(头脑风暴)

- **触发场景**:fde 段末
- **对应 trigger**:deep_dive 后建议
- **演示证据**:段 5(6:30)

### 7. `detectConfirmAndEmitDynamicActions`(动态动作)

- **触发场景**:sales 段中"发报价"确认信号
- **对应 trigger**:confirm 关键词
- **演示证据**:段 1(0:52)

### 8. Profile 智能

- **触发场景**:fde 段(关联简历/主档案/JD)
- **对应 trigger**:跨场景引用
- **演示证据**:段 5 全段

### 9. 知识库 RAG 检索

- **触发场景**:sales 段(fde 段)
- **对应 trigger**:handle_objection + deep_dive
- **演示证据**:段 1(0:22)+ 段 5(5:25)

### 未覆盖功能

- ❌ `runSkillWatcher`:需要在设置中手动启用 skill
- ❌ `runAssistMode`:是 generic 后备,每段都会触发但不明显
- ❌ `generate-assist`、`generate-recap` 等手动 IPC:不在 master transcript 演示范围,可单独触发

---

## Speaker 映射规则

### master transcript 中

- `S1` = Alex Chen(用户本人)
- `S2-S6` = 不同场景的对话方(Jordan / Priya / Mei / 梁教授 / Sam)

### 导入 Natively 时

- `S1` → 映射为 `speaker = "user"`
- `S2-S6` → 全部映射为 `speaker = "interviewer"`,但保留 `speakerLabel`(如"Jordan (Acme Corp Sales VP)")

### 文本替换建议(导入前)

```bash
# 把 S1 替换为 [user]
sed -i '' 's/\[S1 Alex/[user]/g' master_transcript.md
# 把 S2-S6 替换为 [interviewer] 各保留 speakerLabel
sed -i '' 's/\[S2 Jordan/[interviewer] 张经理/g' master_transcript.md
sed -i '' 's/\[S3 Priya/[interviewer] Priya/g' master_transcript.md
# ... etc
```

或者直接把整段对话复制到 Natively 的 Transcript 输入框(开发者模式),系统会自动按上下文推断 speaker。

---

## 常见问题

### Q1:Profile 数据能不能关联到多个模式?

技术上 Profile 是单例,同一时间只能关联到一个模式。本演示把 Profile 关联到 fde 模式(段 5),因为 fde 是最需要 Profile 智能的场景。其他模式不关联 Profile,演示的是模式本身的 RAG 检索能力。

### Q2:能不能用一个模式演示多个场景?

可以。比如你想验证 fde 模式的 KB 检索 + Profile 智能,在 fde 模式下播放段 5 即可。但段 1-4 的触发需要切换到对应模式(因为 intent 关键词集合不同)。

### Q3:TTS 怎么选?

- **中文**:Edge TTS(云希/晓晓/茂茂)、火山引擎 TTS、ElevenLabs 中文
- **英文**:ElevenLabs、OpenAI TTS
- **推荐**:Edge TTS 免费 + 质量不错,适合快速 demo

### Q4:能不能直接读取 .md 文件吗?

Natively 知识库支持 `.md / .txt / .pdf / .docx / .markdown`。本演示数据主要是 .md,可以**直接上传**。

### Q5:PDF 版本怎么生成?

```bash
# 需要先安装 pandoc
brew install pandoc

# 生成所有 .md 的 PDF 版本
find tests/fixtures/demo/ -name "*.md" | while read f; do
  pandoc "$f" -o "${f%.md}.pdf"
done
```

### Q6:为什么用这 5 个场景而不是 8 个?

5 个内置模式最常用:`general`(过于通用)/ `recruiting`(招聘方)/ `looking-for-work`(求职方)。其中 recruiting 和 looking-for-work 都映射到 interview scenario,可在 technical-interview 模式中演示其能力扩展。8 个模式的覆盖可以通过修改本演示数据的 master transcript 实现。

---

## 下一步

- 详细加载步骤:阅读 `00_walkthroughs/01_sales_walkthrough.md` 等
- 单场景快闪:用 `05_segment_clips/segN_xxx.md`(30 秒单场景)
- 完整演示:用 `03_master_transcript/master_transcript.md`(5-7 分钟)
- 自检脚本:可基于 `03_master_transcript/master_transcript.json` 的 `expected_intent` / `expected_assist` 字段写 e2e 测试