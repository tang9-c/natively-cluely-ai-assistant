# Walkthrough — Lecture 场景演示

> 演示讲座模式下,概念解释 + 公式渲染 + 课堂提问回答 + 学生视角追问。

---

## 场景设定

**课程**:CS-512 分布式系统(12 讲)
**讲次**:第 8 讲 — 分布式存储(1)— 分片
**主题**:一致性哈希(Consistent Hashing)
**教授**:Prof. Daniel Liang
**学生**:48 人(大三为主),Alex Chen 作为学生身份

---

## 加载步骤

### 步骤 1:创建/激活 Lecture 模式(1 分钟)

1. Modes → Create Mode
2. 模板选"讲座(Lecture)"
3. 命名:"Lecture Demo"
4. 设为 Active

### 步骤 2:上传 Lecture 模式参考文件(2 分钟)

把以下 3 份文件上传到 Lecture 模式:

| 文件 | 用途 | docSubtype |
|---|---|---|
| `04_mode_reference_files/lecture/audience_profile.md` | 听众画像 | audience-profile |
| `04_mode_reference_files/lecture/outline.md` | 讲纲 | outline |
| `04_mode_reference_files/lecture/references.md` | 参考资料 | references |

### 步骤 3:上传知识库资料(2 分钟)

上传 3 份 KB(同 Sales 场景)。

---

## 录制步骤(1.5 分钟)

```
[03:45] Prof. Liang: 今天我们讲一致性哈希。这个叫 consistent hashing,原理是把节点和 key 都映射到同一个环上。定义为 virtual node 的概念,意思是用 vnode 解决数据倾斜问题。

[04:10] Prof. Liang: 接下来,公式推导一下。假设环长 1,有 k 个节点、n 个 key,期望每个节点承载 key 的数量是 n/k,方差大约 1/k,标准差 1/sqrt(k)。

[04:25] Prof. Liang: 当一个节点加入或离开时,只有 1/k 比例的 key 会被重新映射,这就是相比 mod 哈希的最大优势。

[04:35] Prof. Liang: 谁知道为什么用 160 位的 vnode 而不是 32 位?有同学能答吗?

[04:50] Alex(学生): 老师,能解释一下为什么不用 mod 哈希吗?具体说一下环式映射的好处?

[04:58] Prof. Liang: 好问题。环式的好处是节点增减时只影响相邻节点,mod 哈希不行,任何一个节点变化都要全部重新映射。

[05:00] Prof. Liang: 下一讲我们讲 LSM 树,提前看一下第 2 讲的 outline。
```

或使用片段:`05_segment_clips/seg4_lecture.md`

---

## 预期触发清单(4 项)

| 时间 | 触发语句 | Intent | Assist | 预期 UI |
|---|---|---|---|---|
| 3:45 | "这个叫 consistent hashing" | `explain_concept` | `runWhatShouldISay` | 弹出术语解释 + 类比(电话区号) |
| 4:10 | "公式推导" | `render_formula` | `runWhatShouldISay` | 弹出 LaTeX 渲染(`n/k, 1/k, 1/sqrt(k)`) |
| 4:35 | "谁知道" | `answer_class_question` | `runManualAnswer` | 弹出"学生视角回答模板" |
| 4:50 | "能解释" + "具体说" | `clarification` | `runClarify` | 给出追问建议 |

---

## 可触发的功能清单(本场景 5 个)

1. ✅ `runWhatShouldISay` — 概念解释 + 公式渲染
2. ✅ `runClarify` — 追问建议
3. ✅ `runManualAnswer` — 课堂提问回答模板
4. ✅ RAG 检索(`outline.md` 第 8 讲 + `references.md` DDIA Ch.5-7)
5. ✅ 模式 prompt 注入(`MODE_LECTURE_PROMPT`)

---

## 公式渲染示例

### 自动 LaTeX 渲染

教授说"公式推导一下"时,Natively 应自动弹出以下 LaTeX 公式块:

```latex
\mathbb{E}[\text{keys per node}] = \frac{n}{k}

\text{Var}[\text{keys per node}] \approx \frac{1}{k}

\sigma[\text{keys per node}] = \frac{1}{\sqrt{k}}

\mathbb{P}[\text{key remap}] = \frac{1}{k} \text{ (节点加入/离开时)}
```

---

## 回放检查清单

- [ ] Lecture 模式已激活
- [ ] 3 份参考文件已上传
- [ ] 3 份 KB 已上传
- [ ] 3:45 `explain_concept` 触发
- [ ] 4:10 `render_formula` 触发,公式块显示
- [ ] 4:35 `answer_class_question` 触发
- [ ] 4:50 `clarification` 触发,`runClarify` 显示

---

## 进阶演示

### 场景 A:听众画像调整

修改 `audience_profile.md` 中的"班级平均理解度"为 30%,重新上传:
- AI 回答深度自动降低(更多类比,更少数学)
- 提示词从"深入讨论"变为"用生活例子"

### 场景 B:学生视角 vs 老师视角

把 `04_50` 段的 Alex 改成主讲人身份(让 Alex 讲):
- 同一句"为什么用 160 位"在学生模式下 → 弹出"如何回答"
- 在老师模式下 → 弹出"如何讲清楚"

---

## 关联材料

- Master transcript 段 4:`../../03_master_transcript/master_transcript.md`
- 讲座参考文件:`../../04_mode_reference_files/lecture/`
- 知识库:`../../02_knowledge_base/`
- 单场景片段:`../../05_segment_clips/seg4_lecture.md`
- 总览:`./00_overview.md`