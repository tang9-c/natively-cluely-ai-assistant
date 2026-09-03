# Research 来源可信边界修复设计

## 目标

Research 最终展示的 Tavily 来源只能来自本次服务端收到的原始搜索结果。LLM 不得新增、替换或篡改来源，也不得通过越界引用把结论伪装成有外部证据支持。

## 已确认问题

`ResearchDossierBuilder` 当前把完整来源列表交给 LLM，并直接采用 LLM 返回的 `sources`。现有 Zod schema 只验证字段形状与 URL 格式，不验证 URL、标题、摘要或编号是否属于 `rawSources`。实测输入 `https://real.example`、模型返回 `https://invented.example` 和 citation `99` 时，结果仍被标记为 `source: tavily`。

## 设计

- 调用 LLM 前，继续由服务端把 `rawSources` 规范化为从 1 开始、连续编号的可信来源列表。
- LLM 返回的顶层 `sources` 只用于兼容现有输出 schema，不进入最终 dossier。
- 最终 `sources` 始终由服务端可信来源列表构建，保留原始标题、URL 和截断摘要。
- 六个维度中每条 bullet 的 citation 只有在对应可信来源编号存在时才保留；非整数、非正数和超过来源数量的引用删除。Zod 继续负责基础类型验证。
- `source` 只由服务端是否拥有可信 Tavily 来源决定：有来源为 `tavily`，无来源为 `llm-fallback`。
- 无 Tavily 来源时继续清空 sources、删除所有 citation，并将维度 confidence 降为 `low`。

## 测试

- LLM 返回未知 URL、篡改标题或摘要时，最终来源仍完全等于服务端原始来源。
- LLM 返回重复 source index 时，最终来源仍保持服务端连续编号且不重复。
- citation 为未知、越界或指向伪造 source 时被删除；合法 citation 保留。
- LLM 省略 sources 但服务端存在 Tavily 结果时，最终仍标记为 `tavily` 并展示可信来源。
- 无 Tavily 来源时保持现有 `llm-fallback`、空 sources 和低置信度行为。

## 非目标

- 不验证某条自然语言结论是否被引用网页语义支持。
- 不修改 Tavily 搜索、缓存结构、UI、数据库或 Provider 路由。
- 不新增依赖。
