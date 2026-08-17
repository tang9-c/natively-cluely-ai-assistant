# Embedding 健康状态展示修复设计

## 目标

修复资料库把 Embedding“尚未按需初始化”误报为“未配置语义检索”的问题，同时保留现有按需加载策略。打开设置页不得强制加载本地 Embedding 模型。

## 状态模型

Embedding Pipeline 对外提供四种运行状态：

- `idle`：已具备延迟初始化配置，但尚未开始初始化。资料库不显示警告。
- `initializing`：Provider 正在初始化。资料库显示中性提示，并定时刷新状态。
- `ready`：Provider 已可用。资料库不显示可用性提示。
- `failed`：最近一次初始化失败且没有可用 Provider。资料库显示关键词匹配降级警告。

`embeddingReady` 保留用于现有调用方兼容，其值仅在状态为 `ready` 时为 `true`。新增的 `embeddingStatus` 承担界面状态判断，避免继续用布尔值表达四种语义。

## 数据流

1. `EmbeddingPipeline` 记录最近一次初始化是否失败，并提供只读状态查询。
2. `get-context-health` 同时返回 `embeddingReady` 与 `embeddingStatus`。
3. `KnowledgeMaterialsSettings` 使用 `embeddingStatus` 控制提示：
   - `idle`：不显示警告；
   - `initializing`：显示“语义检索正在初始化”；
   - `ready`：不显示可用性提示；
   - `failed`：显示“语义检索不可用，CueUp 会对上传资料使用关键词匹配”。
4. 页面仅在 `initializing` 状态进行短间隔轮询；进入终态后停止，卸载时清理计时器。

## 错误与兼容处理

- 本地 Provider 失败但成功切换到其它 Provider 或本地 fallback 时，最终状态为 `ready`，不显示失败警告。
- 初始化异常且没有任何 Provider 时，状态为 `failed`。
- Renderer 收到旧版主进程响应、缺少 `embeddingStatus` 时，根据 `embeddingReady` 兼容映射：`true → ready`，`false → idle`，避免再次产生假警告。
- 资料自身的向量生成失败仍沿用现有“部分资料文本可用，但语义索引失败”提示，不与 Pipeline 状态混淆。

## 测试

- Pipeline 初始配置后、未初始化时返回 `idle`。
- 初始化期间返回 `initializing`。
- Provider 成功或 fallback 成功后返回 `ready`。
- 无 Provider 可用并初始化失败后返回 `failed`。
- 资料库在 `idle` 时不渲染警告，在 `failed` 时渲染关键词降级警告。
- `initializing` 状态会刷新，离开该状态或组件卸载后停止刷新。
- 现有 `embeddingReady`、资料上传、关键词降级和索引失败行为保持兼容。

## 非目标

- 不在打开设置页时强制初始化 Embedding。
- 不修改 Provider 优先级、模型、向量维度、索引结构或数据库结构。
- 不修改资料上传、分块、检索排序和关键词匹配算法。
