# 初始设置 QCLOUD API 识别与开通指引修复

日期：2026-10-29。状态：源码与离线回归已修复，已于 2026-10-30 随 2.7.20 发布。本记录的源码核查未使用已有真实用户密钥，未更改本机安装包。

## 问题与根因

用户反馈已有 QCLOUD API 配置进入初始设置时，AI 服务和模型显示内部标识 natively，被当作不支持的服务；“我还没有账号或密钥”打开的是豆包/火山引擎指引。

核查发现这些问题同时存在，不能只改标签：

1. AI 表单只把豆包与 Codex 作为可保存/验证的选项，未使用应用已有的 natively → QCLOUD API 显示映射；概览也直接显示内部标识。
2. 开通页无条件使用豆包标题、步骤与链接。QCLOUD 的正式入口经用户确认是 https://aigw.feigenbaum.com.cn/；公开首页确认为 New API 网关，前端资源包含登录、注册和令牌相关界面。未登录账号或假定所有用户都能自行注册。
3. 主进程验证闭包固定读取豆包密钥，HTTP 探针只接受豆包，已有 QCLOUD 配置无法按自己的凭据与端点检查。
4. AI 的旧凭据版本准备未包含 nativelyApiKey，旧 QCLOUD key 缺少版本时无法建立当前配置校验身份。

## 修复

- 服务与模型字段均显示 **QCLOUD API**，概览也不再显示 natively。内部 provider/model selector 和 IPC 名保留 natively 以兼容现有配置与调用路由；没有批量重命名存储或更换已有密钥。
- QCLOUD 模型在引导中作为固定服务显示，使用现有默认聊天路由，不允许把展示名称写入模型配置。真实验证使用仓库已有 `QCLOUD_CHAT_MODEL`（lite32k）和 `QCLOUD_CHAT_COMPLETIONS_ENDPOINT`，仍通过数据范围策略检查，不回退到其他服务。
- 支持复用已保存 QCLOUD key、换 key、先保存再验证；保存通过后清空输入框，验证失败如实保留“已保存、尚未验证”的状态。旧 key 的版本仅在显式验证准备时生成。
- 主进程按实际选中的 provider 读取专用密钥，QCLOUD 不再读取豆包 key。
- QCLOUD 开通页使用独立标题、平台登录/注册、令牌/API Key 与可用额度/聊天权限提示，按钮打开用户确认的 HTTPS 平台首页。豆包保留原指引；其他服务不会再静默回退到豆包说明，而是返回原设置。
- 外部链接仅新增精确的 QCLOUD HTTPS 首页。测试拒绝 HTTP、额外路径、查询重定向和伪装域名，没有开放整个网关任意 URL。

## 验证

| 项目 | 结果 |
|---|---|
| 修复前回归 | QCLOUD 请求适配、鉴权错误、实际 main 密钥读取、旧 key 版本准备与链接许可 5 个单元用例失败；已有 QCLOUD 的 UI 用例在服务名称处失败，符合反馈 |
| 相关 Node/Electron 单元 | **90/90 通过**；涵盖 QCLOUD 保存、范围策略、认证、模型响应、IPC 与配置版本 |
| 开发态 Electron 联合回归 | 首轮 41/42，通过项之外有一项历史 Whisper 用例等待首个测试窗口超时，尚未进入业务操作；单项复跑 1/1，完整复跑 **42/42 通过**，未加 skip、放宽超时或改 Whisper 产品代码 |
| 生产资源回归 | **5/5 通过**；2 项欢迎层冷启动 + 3 项 QCLOUD 场景，包含真实 production 分块、file:// 入口和 production main 编译；不是声称已重新安装发行包 |
| 类型与生产构建 | Renderer / Electron 类型检查和 `npm run test:e2e:production` 内生产构建通过 |
| 文档与图片 | 两张独立测试截图及 SHA-256 清单保留；`git diff --check` 通过 |

QCLOUD UI 用例通过真实凭据 IPC 在独立 fresh userData 写入假 key，未注入 QCLOUD 成功回执。网络 guard 会阻止实际云端请求，因而点击验证应出现网络错误且保存状态保留；这不表示 QCLOUD 实际服务不可用。单元探针用可控响应检查目标地址、请求模型、专用 Authorization、认证失败、全局范围拒绝和错误模型响应。另一个用例执行 main 中实际配置读取闭包，防止只测试一个手工拼装的请求而漏掉读取错密钥。

开通页的浏览器启动在测试中被截获，只核对实际 open-external handler 放行后的目标 URL；没有注册账号、创建真实令牌、充值或调用真实模型。其他服务开通页使用正向标题断言，避免仅检查“豆包标题不存在”造成假阳性。

## 界面证据

以下图片来自开发态隔离 Electron 回归（假 key、阻断网络、截获外部浏览器启动），不是用户真实配置截图或在线验证凭证。

- [QCLOUD 服务、模型与已保存密钥状态](assets/2026-10-29-onboarding-qcloud-api/qcloud-saved.png)
- [QCLOUD 独立开通页](assets/2026-10-29-onboarding-qcloud-api/qcloud-provisioning.png)
- [图片尺寸与 SHA-256 清单](assets/2026-10-29-onboarding-qcloud-api/manifest.json)

原始日志与公开平台页面读取结果保存在本地 `.tmp/onboarding-qcloud/`，不提交原始日志、网关 JS 文件或任何真实凭据。用户反馈截图含其他桌面内容，未复制到仓库。

## 源码核查时未执行

真实 QCLOUD 账号登录/注册、实际令牌创建/额度/权限、在线聊天响应、完整真实会议与三个平台的重新打包/安装验收未执行。本轮没有扩大到凭据加密；SEC-01 仍为用户已接受的非阻断风险。


## 2.7.20 发布追记

2026-10-30，[CueUp 2.7.20](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.20-sha-57d25a1) 已公开，三平台构建与 14 个附件核对通过，详见[发布记录](../testing/2.7.20-build-release.md)。本记录中的隔离证据与未执行真机项保留原边界，正式发布不代表这些人工项目已完成。

## 2026-10-30 共享密钥复用与语言提示修复追记（尚未发布）

2.7.20 之后发现的首次设置服务切换问题已在工作区修复：语音与 AI 页通过安全的凭据存在标志复用同一份 QCLOUD Key，语音草稿不会显示旧配置的语言错误或成功状态，主进程也不再把旧语言错误附到新配置身份上。原有“复用已保存 Key”的覆盖只验证了 QCLOUD 已为当前服务的情形，本次补齐从其他服务切入、显式更换后切回及重启场景。详见[本机验收记录的后续修复](2026-10-30-2.7.20-device-acceptance.md)。此修复尚未发布，旧安装包验收缺口继续保留。

本次最终验证：159 项单元/契约（132 onboarding + 27 语言及语音通道）、41 项开发态界面、18 项 production file:// 界面均通过，两端类型检查通过。真实账号调用与新安装包复验仍未执行。

## 2026-11-01：LLM User-Agent 统一（工作区，尚未发布）

原行为通过本地 HTTP 收包确认：QCLOUD 普通请求和 SSE 请求使用 fetch 默认的 `node`，工具调用使用 `OpenAI/JS 6.38.0`；其他 SDK、Axios 和自定义 cURL 也各自发送不同标识。因此只改 QCLOUD 普通请求的 headers 无法统一应用标识。

当前实现将应用管理的 LLM HTTP 请求统一为 `CueUp/<当前应用版本>`。主进程使用运行中应用的 `app.getVersion()`；Node 模式没有 Electron app 时使用 package.json 版本。QCLOUD 普通、流式、工具调用与连接测试共用传输约定；其他内置 SDK、Ollama 聊天/视觉、Embedding、云端模型列表和两种自定义 cURL 路径也已接入。自定义 User-Agent 按大小写不敏感规则替换，不影响 Authorization、JSON 内容、取消信号、范围守卫与原工具目录。

新增 `electron/llm/__tests__/LLMHelper.UserAgent.test.mjs`，通过真实应用编译产物、真实 SDK/Axios 和本地 HTTP 服务验证实际收到的头部。测试只重定向传输目的地，不手工拼造目标请求；假 key 为 `local-dummy`，所有流量限制在 loopback，不读取用户凭据。应用版本替身为 `9.8.7`，特意区别于仓库版本，防止实现写死版本号。

| 覆盖 | 验收标准 |
|---|---|
| QCLOUD 普通请求 | 实际收到 `CueUp/9.8.7`、原鉴权头和消息，返回正常回答 |
| QCLOUD SSE | 同一标识，仍按 SSE 正常输出文本 |
| QCLOUD 原生工具调用 | 通过 selected-model factory 和真实 OpenAI SDK，标识正确且工具 schema 保留 |
| 其他 SDK | OpenAI、Groq、豆包、Anthropic、Gemini 初始化与换 Key 后标识一致；Gemini 切换及工具调用的单次 timeout 配置不覆盖标识 |
| 自定义 cURL | fetch 普通/流式与 Axios 原始 cURL 均覆盖混合大小写的旧标识，保留鉴权 |
| Embedding 与模型查询 | QCLOUD、OpenAI、Gemini、豆包、Ollama Embedding，以及五种云端模型列表使用同一标识 |
| 传输约定 | 保留 Request 的方法/正文，支持对象、元组、Headers，未修改调用者头部；已取消请求不发送 |

专用回归 `npm run test:llm-user-agent`：**9/9 通过**。修复前 QCLOUD 三条路径分别在默认 fetch/SDK 标识处失败，Embedding、模型列表和 Axios cURL 的新增断言也先复现旧标识。Electron 类型检查通过。现有 QCLOUD Embedding 测试改用标准 Headers 读取鉴权值，兼容传输层的头部表示。

最终联合回归：**273/273 通过，0 跳过**，涵盖全部 `LLMHelper.*.test.mjs`、QCLOUD 聊天/预算/配置/超时/推理选项、Embedding 提供方与解析、OpenAI-compatible/Anthropic/Gemini 工具适配、首次设置 IPC/AI 验证及视觉回退链；`npm run typecheck:electron` 与 `git diff --check` 通过。依赖产生既有 punycode 弃用提示，未出现测试失败。

限制：未执行真实 QCLOUD 账号请求、网关上游头部核对或发行包安装验收；此记录不代表现有 2.7.25 安装包已经具备新行为。外部 Codex CLI 自行控制 HTTP 请求，无法由 CueUp 的客户端配置统一；STT、模型文件下载等网络流量不在本轮范围内。SDK 其他诊断头保留。
