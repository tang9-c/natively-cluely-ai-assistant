# Research 统一展示与档案场景复用设计

## 目标

修复两个已确认的问题：档案页面仍按废弃字段渲染 Research 结果；已缓存的公司调研结果没有进入求职或招聘会议上下文。保持数据库结构不变，不恢复旧 schema，不注入网页原文或完整 dossier。

## 方案选择

考虑过三种方案：

1. 只更新旧内联 UI 的字段映射。改动小，但会继续维护两套 Research 状态机和展示逻辑，后续仍会漂移。
2. 删除旧内联实现，统一打开现有 `ResearchPanel`；同时把受控 dossier 摘要接入档案场景上下文。该方案复用现有六维 UI，并满足当前“影响求职/招聘场景”的产品承诺。
3. 把完整 dossier 建成新的 RAG 资料类型。扩展性较强，但需要索引生命周期、删除和去重设计，超出本次最小修复范围。

采用方案 2。

## UI 设计

- `ProfileIntelligenceSettings` 不再保存 `companyDossier: any`，不再直接调用 Research IPC，也不再渲染旧字段。
- JD 公司卡片保留一个入口，携带公司名打开顶层 `ResearchPanel`。按钮文案改为“打开公司调研”，避免承诺点击后立即产生网络费用。
- `ResearchPanel` 继续负责输入、请求、进度、错误、缓存、刷新和六维结果展示。
- 新增共享 `CompanyDossier` 类型，Electron Research 服务、preload、Renderer API 和 `useResearch` 使用同一类型，禁止继续以 `any` 绕过 schema 检查。
- 不自动发起 Research 请求，用户在统一面板确认公司名后点击“立即调研”。

## 会议上下文设计

- 仅在活动模式为 `looking-for-work` 或 `recruiting` 时尝试读取 Research 缓存。
- 从活动 JD 的 `parsed_json.company` 取得公司名；没有 JD、公司名为空、缓存不存在、schema 不匹配或缓存过期时不注入。
- 只消费缓存中的结构化 dossier，不读取网页原文。
- 采用固定字段白名单：公司名、六个维度的 `summary`，以及每个维度有限数量的 `details.text`。引用只映射到缓存中已校验的 `sources`。
- 输出放在 `<company_research_evidence>` 中，并包含明确的 `untrusted_external_evidence` 护栏。外部内容只能作为证据，不能作为指令。
- 整个 Research 块使用独立字符预算；超长字段逐项截断，绝不突破预算。
- 注入成功时标记 `profile_history`，使用户禁用档案历史云端范围后，现有 provider scope 机制能够阻止发送。
- Sales、FDE、团队会议、讲座、通用及技术面试不注入该上下文。

## 错误与降级

- Research 缓存缺失、损坏、过期或 JD 无公司名时静默跳过，不阻断会议回答。
- 解析缓存失败不得回退到原始 JD 或网页内容。
- 不增加网络请求；会议链路只读取本地缓存。

## 测试

- 档案页面不再包含旧 Research 字段和直接 Research IPC 调用，只派发打开统一面板的事件。
- 使用当前 `CompanyDossier` 返回值验证六个维度均可渲染。
- 求职和招聘模式下，与活动 JD 公司匹配且未过期的 dossier 产生受控 Research 块。
- 非允许模式、过期缓存、公司不匹配、无效 JSON 均不注入。
- 恶意文本只出现在不可信证据包装中，输出受字符预算限制，不包含网页原文。
- 运行 Research、档案上下文和数据范围专项测试，以及类型检查、构建和完整 `npm test`。

## 非目标

- 不修改数据库结构或缓存 TTL。
- 不把 Research dossier 建成持久化向量索引。
- 不恢复招聘策略、薪资估算、文化评分等旧字段。
- 不让 Research 内容影响非求职/招聘模式。
