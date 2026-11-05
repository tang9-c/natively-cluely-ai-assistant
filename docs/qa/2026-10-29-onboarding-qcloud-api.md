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

## 2.7.26 发布跟进（2026-11-02）

LLM User-Agent 统一已随 [2.7.26](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.26-sha-960e952) 正式发布，来源 `960e95254295c984fa10058baaed2f0108a09c50`。上文“工作区，尚未发布”为修复完成时的历史状态；候选 User-Agent 专项 9/9、production 38/38、权限专项 132/132 及三平台构建/附件核对结果见[发布记录](../testing/2.7.26-build-release.md)。真实账号、网关上游头部及新包人工安装仍未验收，外部 Codex CLI 自行管理请求头的边界不变。

## 2026-11-05：会中验证已保存云端配置（工作区，未发布）

用户反馈在会议进行中打开初始设置，QCLOUD 已保存密钥，但验证按钮禁用，错误仍泛称“操作未完成”。根因有两层：语音/AI 表单把会议 active 当作整个表单的 busy，连验证按钮也锁住；主进程验证器又通过通用 isOnboardingBusy 拒绝所有会中验证。原先“保存并验证”的顺序也不适合会中只读检查。

本轮调整：

- 会中增加“验证已保存的语音服务”和“验证已保存的 AI 服务”。只使用已保存且与表单一致的配置；跳过表单保存、换 Key 和服务切换，按最新配置修订发起验证。原有字段、密钥更换、下载与模型加载仍锁定。
- 界面和主进程共用会中支持范围：语音为 QCLOUD、Doubao AUC、OpenAI、Groq、Azure、IBM，AI 为 QCLOUD、豆包。检查使用既有独立 HTTP 探针和固定样本/输入，不启动录音、不读取会议转录，也不重启采集。验证回执仍保存，所选服务、密钥值、设备和模型不变。
- 主进程仅为这类验证放行 active 会议；不改变无验证上下文的配置/模型资源门控。会议启动、收尾、听写或采集测试忙碌，以及本地模型和 Codex CLI 检查继续拒绝。保留旧凭据的版本元数据初始化，避免已有密钥请求成功后仍被标为缺少凭据；该步骤不更换密钥或所选服务，验证回执绑定准备后的当前配置身份。
- 保留全局范围限制、配置身份/修订检查、并发去重、60 秒超时与取消；认证失败、范围拒绝、迟到结果和配置变化不会被改写成验证通过。
- 会中说明明确区分“配置修改已锁定”和“已保存云端服务可验证”。补齐缺少凭据、窗口不可操作、请求失效和初始化错误的具体提示，未知错误不再只显示“操作未完成”。

| 验证 | 结果 |
|---|---|
| 修复前后端定向回归 | 5 项失败：会中 QCLOUD/豆包验证返回 busy，认证错误被 busy 遮蔽；本地/瞬态锁定用例原本通过 |
| 修复前表单定向回归 | 只读验证辅助函数尚未实现；缺少凭据被显示为泛化错误，新增断言失败 |
| 最终相关单元 | 177/177，0 跳过；命令为 `ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/Onboarding*.test.mjs electron/services/__tests__/AudioDeviceAuthorization.test.mjs electron/services/__tests__/MainStartupSafety.test.mjs` |
| 旧凭据兼容回归 | 曾复现会中略过版本准备后请求成功但状态仍 missing；执行真实 main 验证器初始化绑定后，当前回执变为 verified，原 Key 和服务不变 |
| 新增会中生产界面 | 2/2；真实验证器/IPC 生成回执，验证鉴权失败后重试、AI 响应、零配置 setter 调用、配置修订和会议代次不变、采集启动/停止计数不变、会议继续接收合成转录、本地/CLI 前后端拒绝 |
| `npm run test:e2e:production` | 40/40，包含新会中场景、QCLOUD、权限、欢迎页、亮暗主题及身份菜单；同时通过 Renderer 类型检查和生产构建 |
| Electron 类型检查、`git diff --check` | 通过 |

首轮会中 UI 为 1/2，原因是隔离夹具支持选择 QCLOUD，却没有返回与真实配置读取一致的共享密钥存在标志，导致按钮按缺少凭据禁用。已补齐 test-only fixture 的配置元数据；没有放宽产品的凭据检查或注入成功回执。随后定向 2/2、全套 production 40/40 通过。测试使用 fresh userData、产品启动前的离线边界 guard 和合成配置，不读取真实用户 Key，不发起真实云端请求或收音。原始日志和既有身份回归截图保留在本机 `~/.codex/diagnostics/2026-11-05-in-meeting-validation/`。

真实 QCLOUD/其他云端服务、真实会议压力及新发行包安装未执行。云端验证通过只证明凭据访问或固定输入模型响应，不表示系统音频授权已确认；权限页的实际采集结果同步见下节。本轮未修改 Rust、未升级版本、未提交或发布，现有 2.7.26 安装包不包含本修复。


## 2026-11-05：权限页同步当前系统音频采集结果（工作区，未发布）

上节会中云端验证修复没有解决权限页的结果同步。继续核查确认：`OnboardingReadiness` 每次读取均把系统音频置为 `pending_runtime`，没有接入主进程已有的系统通道采集健康状态；界面成功分支又称“会议开始时确认”，不适用于正在进行的会议。

本次增加只读的 `AppState.getOnboardingSystemAudioCheck`，读取当前会议、匹配所选输出的系统通道健康状态；只有当前采集仍在运行且收到有效音频数据才返回 `verified/runtime`。主进程原有会话重置和采集 token 门控继续负责过滤过期回调；麦克风数据、一般会议启动事件、转写事件和屏幕预检均不能产生系统音频成功证据。失败返回采集失败，不将所有失败都解释为权限被拒；恢复中、停采、未开始会议和输出选择不匹配时不沿用旧成功。

权限页订阅系统通道的采集状态并刷新被动检查，会议活动状态变化也重新读取；不新建采集、不请求授权。绿色表示“本次会议已成功采集系统音频”，红色表示“本次会议系统音频采集失败”，其余明确为尚未验证。刷新成功文案保持动作语义，不能据此推断验证通过。实际后端和截图权限检查未改动，Rust 源码及 native 二进制未改动。

新增单元回归在修复前因缺少实际主进程方法失败；修复后覆盖开始无数据、有效系统数据、失败、恢复、会议结束、新会话迟到回调、停采、输出选择和麦克风隔离。生产界面回归在亮/暗主题分别检查“刷新成功仍未验证 → 系统数据成功 → 采集失败 → 旧结果失效”，使用真实健康监控、readiness、IPC 和渲染页面，音频边界使用合成对象，不接触真实设备或 TCC。

真实系统声音、实际授权切换和发行包安装未执行；本条不代表现有安装包已修复，也不声称已读取 macOS 的全部系统音频授权设置。

验证结果：相关单元 **225/225 通过，0 跳过**（首次设置全套、输入设备授权、启动安全、会议系统音频权限、CoreAudio 抑制和采集健康监控）；`npx tsc --noEmit`、`npm run typecheck:electron` 通过。`npm run test:e2e:production` 完成生产构建并运行 42 项，其中 40 项首轮通过；新增亮/暗主题用例结束阶段因合成测试只修改运行标志而未发送真实产品的 `ended` 事件失败。补齐该事件后使用 `ELECTRON_E2E=1 npx playwright test --config playwright.production.config.ts --last-failed --reporter=list` 复跑 **2/2 通过**，42 项均已验过。产品代码没有为测试失败放宽成功条件。`git diff --check` 通过；原始红/绿单元、构建、类型及两轮生产界面日志存于本机 `~/.codex/diagnostics/2026-11-05-in-meeting-validation/`。
