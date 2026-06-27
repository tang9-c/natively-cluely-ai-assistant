# Segment 4 — Lecture 单场景快闪片段

> 30 秒版本,用于 Lecture 模式快速演示。

---

## 对话稿(30 秒)

```
[00:00] Prof. Liang: 今天讲一致性哈希。这个叫 consistent hashing,原理是把节点和 key 都映射到同一个环上,定义为 virtual node 的概念。

[00:10] Prof. Liang: 接下来,公式推导一下。假设环长 1,有 k 个节点、n 个 key,期望每个节点承载 key 的数量是 n/k,方差大约 1/k。

[00:20] Prof. Liang: 谁知道为什么用 160 位的 vnode 而不是 32 位?有同学能答吗?

[00:25] Alex(学生): 老师,能解释一下为什么不用 mod 哈希吗?
```

## 预期触发

- 0:00 `explain_concept` → `runWhatShouldISay`(术语解释)
- 0:10 `render_formula` → `runWhatShouldISay`(LaTeX 渲染)
- 0:20 `answer_class_question` → `runManualAnswer`(学生视角)
- 0:25 `clarification` → `runClarify`(追问建议)

## 适用场景

- 30 秒快闪 demo
- 讲座模式快速验证
- 公式渲染 + 概念解释演示

## 关联材料

- 完整版:`../03_master_transcript/master_transcript.md` 段 4
- 加载步骤:`../00_walkthroughs/04_lecture_walkthrough.md`