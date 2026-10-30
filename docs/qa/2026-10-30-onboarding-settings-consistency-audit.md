# 初始设置与设置界面的一致性核查

日期：2026-10-30。以下核查部分描述修复前的工作区源码；实施结果见文末。范围为当前工作区源码，包括尚未发布的 QCLOUD 共享密钥与语言提示修复。本次按“重新核对”执行审查与证据记录，未修改产品实现、配置值或真实用户数据。

结论：不一致确实存在，既有同一设置的名称与显示值分叉，也有服务识别、选项可见性和入口指向的问题。不能只批量替换初始设置里的文字；设置页本身也有过时文案和状态语义需要修正。

## 核查方式与边界

- 对照初始设置的概览、权限与设备、语音识别、AI 服务、开始会议页面，以及设置的通用、QCLOUD API、AI 提供商、音频及本地模型面板。
- 核对展示文案、provider/model/language 内部值、条件可见性、读写 IPC、保存时机和验证深度。相同底层值不因显示名称不同而视为不同功能。
- 用真实 CredentialsManager / SettingsManager 的隔离临时目录读取 Codex 配置，并将当前 AiServiceStep 源码转译后进行 React 服务端渲染，确认初始识别结果。语言显示对比使用实际语言目录。未接入真实账号、未操作日常应用实例，也未将服务端渲染等同于发行包真机验收。
- 可复跑的临时核查脚本与结果位于 `.tmp/onboarding-settings-audit/inspect.cjs`、`evidence.json`；命令为 `ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron .tmp/onboarding-settings-audit/inspect.cjs`。脚本只使用隔离数据，不读取真实凭据。

## 确认的问题

| 编号 / 优先级 | 项目 | 初始设置 | 设置 | 判断与修正方向 |
|---|---|---|---|---|
| C01 / P1 | 已有 Codex 配置识别及模型值 | 后端给出 provider=`codex`，但页面只将 `codex-cli` 视为支持项；显示“当前服务 · codex”、完整 `codex-cli:gpt-5.4`，并隐藏“验证当前配置” | Codex CLI 是正式提供商，模型通过同一个 `codex-cli:*` selector 保存 | **已用隔离运行与实际组件渲染确认功能缺陷。** 在界面初始化处适配后端 provider 与模型 selector；保留后端路由约定，不能只全局改名，也不能把完整 selector 再拼一次 `codex-cli:` |
| C02 / P2 | 识别语言的名称与显示值 | “会议语言”，直接拼原始 `group · label`，例如 `Chinese · Chinese (Simplified)`、`English · 美国` | “语言” + “口音/地区”，先本地化为“中文”“中文（简体）”“英语” | 实际均读写 `chinese`、`english-us` 等相同 key。统一中文显示格式；平铺和分组控件可以保留差异，不能改存储 key 或把 AI 响应语言混入 |
| C03 / P2 | 语音服务名称与选项标签 | “语音识别服务”；“云端 QCLOUD”“云端 Doubao AUC”“本地 SenseVoice（推荐）” | “语音提供商”；“QCLOUD API”“Doubao AUC（说话人分离）”“本地 SenseVoice” | provider ID 相同，显示名称分叉。建议沿用设置中的正式服务名，云端、本地、推荐、说话人分离作为说明或徽标，避免成为另一套名称 |
| C04 / P2 | 概览泄露内部 provider 值 | 概览仅特殊处理 `natively`，直接输出 `qcloud-stt`、`doubao-auc`、`local-sensevoice`、`codex`；语音 modelId 也可能再次输出同一个内部 ID | 设置以正式服务名称呈现 | provider 与模型要分别解析；不能把 STT provider 当作模型名展示。复用同一展示映射，未知配置保留友好名称或明确回原设置 |
| C05 / P2 | AI 模型显示值 | “AI 模型”通常是裸 ID，例如 `doubao-seed-2-0-lite-260215`；豆包 datalist 也只有 ID | “聊天默认模型 / 当前模型”使用 `Doubao Seed 2.0 Lite` 等友好名称；支持多个提供商模型 | 同一 ID 应有一致的名称，必要时附 ID 供自定义输入。保留初始设置只提供部分受支持配置的边界，不能把名称写入 model selector |
| C06 / P2 | QCLOUD 的设置入口和指路文字 | QCLOUD 语音“配置帮助”进入 `audio`；AI“返回原设置”固定进入 `ai-providers` | 共享 QCLOUD Key 实际在独立的 `natively-api`（QCLOUD API）页；该页说明却写“语音标签”，侧栏实际叫“音频” | 按当前服务指向正确入口，并明确“设置 → QCLOUD API”“设置 → 音频”。语音配置帮助与共享密钥管理应可区分，不再统称“原设置” |
| C07 / P2 | 已保存与已连接的状态语义 | 区分“密钥已保存”“尚未验证”“模型响应通过”“凭据访问” | QCLOUD API 页 `isSaved` 从 `hasNativelyKey` 恢复，便显示“已连接” | 仅存在已保存 Key 不代表本次连接或模型验证成功。应修正设置页状态依据或标签；不要把引导降为只凭 Key 存在即显示连接成功 |
| C08 / P2 | 转写数据范围的名称与选项 | “全局：允许转写文本用于 AI”，有沿用当前策略、允许、不允许；拒绝会阻止首次 AI 设置 | “云提供商数据范围 → 转写内容”，开关，辅助文字称关闭后在本地处理 | 都修改 `providerDataScopes.transcript`。沿用表示未显式设置且默认允许，并非第三种授权。初始设置当前对 Codex 同样施加 scope 门禁，而设置文案只称云端，需核对产品语义；统一说明前不能通过改标签扩大数据分享或移除门禁 |
| C09 / P2 | 已有历史服务的显示 | 语音页保留“当前服务 · local-whisper / groq / …”；AI 同样会出现裸 provider | 音频页 ProviderSelect 的 options 只有当前三类主推服务，值未匹配时显示“选择提供商”，没有已有值的兜底展示 | 不应把已有有效配置显示成未选择，也不应强制迁移为新默认。保留友好名称的只读当前项，并说明修改入口；服务是否可在引导验证另行说明 |
| C10 / P2 | 保留策略值与修改入口能力 | 开始会议摘要可显示永久、7 天、30 天、不保存，并提供“修改保留策略” | 通用页只有“不保存会议”开关，只能写 `never` 或 `forever` | IPC 确实接受四种值，但指向页面不能选择 7/30 天；有历史期限时仅凭开关也看不出期限。需呈现实际当前策略，或提供匹配的编辑能力，不把旧值静默改为永久 |
| C11 / P3 | 密钥名称与大小写 | AI API Key、语音 API Key、密钥、STT 密钥、更换语音密钥 | QCLOUD key、保存 key、API Key、移除 API 密钥等 | 统一“API Key / 密钥”的产品用词；QCLOUD 应明确同一份 Key 供 AI 与语音复用，豆包语音与豆包 AI 凭据仍不得误合并 |
| C12 / P3 | Codex 字段和操作名称 | “Codex 程序路径”“检测程序”“AI 模型”“验证当前配置” | “可执行文件”“测试 CLI”“普通模型” | 路径与模型字段应同名；程序检测与真实推理验证不是同一操作，应以一致术语标明检查深度，不能只把按钮全部统一成“测试连接” |
| C13 / P3 | SenseVoice 名称 | “本地 SenseVoice（推荐）”及目录中的模型名称 | 服务项“本地 SenseVoice”，面板标题 `Local SenseVoice` | 统一服务名；模型目录专有名称可保留。推荐状态不应混入永久名称 |

P1 表示已影响现有受支持配置的正常识别与验证入口；P2 表示用户可见含义、当前值、选项或指路不一致；P3 为术语规范问题。以上不是本轮已修复清单。

## 需额外场景确认的设备差异

初始设置总是添加 `value=default` 的“系统默认”，设置页直接使用原生设备数组，未找到偏好时将第一项作为显示选中值，placeholder 分别为“默认麦克风 / 默认扬声器”。对于“不包含 default 项的设备数组”，两个界面会显示不同选择；已有设备失效时，初始设置显示“已保存设备（不可用）”，设置页没有等价的当前值兜底。

这些分支已从源码确认，但尚未对本机原生设备枚举及热插拔进行本轮真机复现。修复前应覆盖：有/无 default 项、无设备、已存设备断开、系统默认设备变化和两个页面往返，避免把“系统默认”误改为“固定第一台设备”。相同字段“输入设备 / 输出设备”本身已经一致。

## 不应机械抹平的差异

- 初始设置允许在没有 Key 时选择 QCLOUD，承担开户与录入流程；设置音频页当前只在已有 Key 时列出 QCLOUD。这是选项可见性策略差异，应说明未配置状态和提供明确的配置入口，不应简单删除初始设置的入口。
- 初始设置只提供当前支持验证的 AI / STT 配置；设置还包含其他云端提供商、Embedding、自定义模型、说话人分离、专名纠正等高级项。无需把所有高级功能复制进引导，但必须准确显示已有值并允许返回正确设置页。
- 初始设置“保存并验证”先保存后检查；音频设置的“测试连接”与“保存”分开；QCLOUD 设置页保存前有探针。时序和验证深度确有区别，不能仅为文案一致而把它们当作相同成功事实。
- 初始设置的输入电平显式启动/停止，设置页进入音频标签时自动启动；设置页另有“测试声音”输出测试。没有对应按钮不一定是缺陷，应明确同一动作的名称，保留流程边界。
- 两处识别语言读写同一目录和 `setRecognitionLanguage`，底层新用户语言默认都是 `english-us`。本次没有证据证明它们采用不同的语言默认存储值；主要差异为显示、分组和推荐文案。
- QCLOUD 模型显示为“QCLOUD API”在两处已一致，内部 `natively` selector 保留兼容性；不能为改名而重命名存储或路由。
- AI 响应语言、语音识别语言是两个配置，不能为减少术语而合并。

## 证据定位

- [AI 配置读模型与 provider](../../electron/services/onboarding/OnboardingConfiguration.ts#L100)、[初始设置 AI 页初始化及选项](../../src/components/onboarding/AiServiceStep.tsx#L19)。
- [语言目录](../../electron/config/languages.ts#L1)、[设置页语言展示映射](../../src/components/SettingsOverlay.tsx#L237)、[初始设置语言与语音服务选项](../../src/components/onboarding/SpeechStep.tsx#L106)。
- [设置页语音选项](../../src/components/SettingsOverlay.tsx#L2421)、[概览 provider 展示](../../src/components/onboarding/PreparationOverview.tsx#L40)、[当前项缺失时的选择器兜底](../../src/components/SettingsOverlay.tsx#L273)。
- [共享模型目录](../../src/utils/modelUtils.ts#L1)、[设置页聊天默认模型](../../src/components/settings/AIProvidersSettings.tsx#L590)。
- [QCLOUD 设置状态及指路](../../src/components/settings/NativelyApiSettings.tsx#L112)、[设置页数据范围](../../src/components/settings/AIProvidersSettings.tsx#L1160)。
- [初始设置保留策略摘要](../../src/components/onboarding/OnboardingFlow.tsx#L112)、[通用页保留开关](../../src/components/SettingsOverlay.tsx#L1743)、[设备加载与首次选中](../../src/components/SettingsOverlay.tsx#L1442)。

## 后续修正和回归顺序

1. 先修 C01：用真实 `readOnboardingConfiguration()` 输出驱动初始设置，覆盖 `codex-cli`、`codex-cli:gpt-5.4` 和其他模型 ID，检查初始化、保存、重启不改变 selector 或重复加前缀。当前 `codex-unsupported` fixture 直接输出 `codex-cli`，与真实后端 `codex` 不同，不能代替这项回归。
2. 统一服务、模型和语言显示来源，覆盖 C02–C05、C09、C11–C13。应复用现有模型目录与一个用于两个入口的展示映射，不建立新的配置体系；从任一入口保存同一个 ID 后，另一入口应显示同一个名称。
3. 按 provider 修正设置跳转，覆盖 C06；保留未保存内容确认。补齐 QCLOUD、豆包、Codex、历史提供商的目标标签断言。
4. 校对真实状态与策略语义，覆盖 C07、C08、C10 和设备场景。明确已保存、凭据可访问、模型有响应、真实会议采集的区别；数据范围和保留策略用行为断言验证，不能只测试字符串出现。
5. 在独立 userData 中逐页对照亮暗主题、未配置/已配置/历史配置和重启后的显示；新增 production file:// 回归，再进行发行包人工复验。不覆盖日常配置，不读取真实 Key 正文。

这次核查未修改实现，因此没有把上一轮 159/41/18 的通过结果重复算作本清单已通过。当前证据只确认上述不一致和 Codex 初始化反例，尚未进行跨页面真机逐项验收。

## 实施结果（2026-10-30，尚未发布）

用户随后授权执行，已完成上述修正。底层 provider、language、model selector、数据范围及凭据存储格式保持兼容；初始设置继续提供简化流程，设置页保留高级选项。

| 清单项 | 处理结果 |
|---|---|
| C01 | 在 renderer 初始化处适配 `codex`，解析通用/固定模型 selector；保存通用 selector 时继续使用当前 Codex 默认模型，固定 selector 保留固定模型语义。保存、重启和更换模型用例确认不会增加重复前缀。后端路由 ID 不变。 |
| C02–C03 | 新增供两个入口共用的 `settingsDisplay.ts`：服务和语言显示名统一；两处均使用“语音提供商”“会议语言”，中文选项显示“中文（简体）”。平铺/分组控件保留原结构，底层语言 key 不变。 |
| C04 | 概览使用友好 provider 名，移除重复的语音 provider/model ID；未知本地模型仓库路径不再充当名称展示，具体模型仍在语音配置页按真实模型目录显示。 |
| C05 | 复用现有模型目录和展示工具；两入口使用“聊天默认模型”，友好名称与原始 ID 双向转换，自定义 ID 保留（包括大小写、点号及短横线），粘贴完整 Codex selector 与带空格的已知显示名称也会解析为底层 ID。Codex 模型预设也使用同一名称；混合提供商列表保留用于区分调用通道的 Codex 前缀。 |
| C06 | QCLOUD 帮助与返回设置按服务进入“QCLOUD API”，其他语音服务进入“音频”，其他 AI 提供商进入“AI 提供商”；修正 QCLOUD 页“语音标签”的过时指路。 |
| C07 | QCLOUD 设置页只凭 Key 存在时显示“密钥已保存”，不再显示“已连接”。程序检测、凭据访问和真实模型响应仍保持不同验证深度。 |
| C08 | 两处共用“允许 AI 使用转写内容”及全局策略说明，设置标题改为“AI 数据范围”；明确本地处理依赖可用且允许的服务。保留初始设置的沿用/允许/不允许和设置的二态开关，不改变策略、默认允许规则或首次设置门禁。 |
| C09 | 设置语音列表补齐友好的历史当前项，初始设置也使用相同名称；不把已有服务显示成未选择或迁移为新默认。自定义提供商名称通过安全的 `modelName` 元数据回显，现有高级配置在引导只读，不回传请求命令。 |
| C10 | 核查 `MeetingPersistence.stopMeeting()` 后确认只有 `never` 的不保存实现，没有找到 7/30 天自动清理逻辑。两处统一显示当前策略；旧值标注“自动清理未启用”，读取和往返不改写旧值，不新增未实现的定时删除选项。 |
| C11 | 统一 QCLOUD API Key 名称，未配置时的语音和 AI 表单也都使用同一字段名和必填提示；说明可共用，不需要语音专用 Key。豆包语音与 AI 仍使用不同凭据。 |
| C12–C13 | Codex 路径统一称“可执行文件”，程序检查称“检测 CLI”；保留“Codex 默认模型”（CLI 配置）与“聊天默认模型”（聊天 selector）的实际差别。本地 SenseVoice 的服务、面板及相关说明统一名称。 |
| 设备差异 | 两处共用设备选项构造：系统默认始终使用 `default`，不将第一台物理设备冒充默认；断开的已保存 ID 显式保留为不可用，用户明确选择默认后才写入新偏好。已用隔离跨页场景验证，真实热插拔仍待人工验收。 |

### 回归与过程记录

- 修复前：6 个新跨入口场景失败；真实配置驱动的 Codex 和概览渲染断言也失败。后续增加的共享 Key 字段名、设备旧选择器、本地仓库路径、通用 Codex 名称重复、自定义模型拼写及提供商名称场景分别确认失败后修正。
- 新增 `OnboardingSettingsDisplay.test.mjs` 10 项：真实配置输出驱动组件、友好模型名称转 ID、自定义 ID、帮助入口、共享 Key 字段、默认/断开设备和本地模型路径展示。
- 新增 `onboarding-consistency.spec.ts` 11 项：Codex 通用/固定 selector 保存与重启、QCLOUD 服务及中文回显与设置往返、模型和数据范围往返、两种旧保留策略、断开设备与明确选择默认、友好模型选择保存原始 ID、自定义 Codex/云端首选模型的拼写、自定义提供商名称只读往返。
- 原有 `codex-unsupported` fixture 改为真实后端的 `codex` provider 和 `codex-cli:*` 模型形状；现有用例只更新为统一后的可访问名称，保留行为断言。
- 相关单元/契约：**177/177 通过**。范围为所有 `Onboarding*.test.mjs`、`Retention*.test.mjs`、`SttLanguage*.test.mjs` 及 `QCloudApiSettings.test.mjs`。
- 开发态 Electron：**58/58 通过**，包含一致性、首次设置、QCLOUD、会议链路。概览最终隐藏本地仓库路径及统一名称引用后，又通过了下述生产资源回归与单元检查。最终的通用 Codex 概览重复名称也由单元反例与生产资源构建验证。
- 生产构建及 production file:// Electron：**29/29 通过**；包含新增 11 项一致性和已有权限、欢迎层、QCLOUD、亮暗主题场景。
- Renderer 类型检查及生产构建通过；Electron 类型检查通过；文档链接与 `git diff --check` 通过。

初轮跨页用例漏掉返回“通用”标签的导航，2 项在寻找“初始设置”按钮时失败；修正用例导航后当时的 8/8 通过。新增自定义提供商用例最初未遵循现有保存 IPC 的 `{{TEXT}}` 模板要求且误以为返回 ID；先修正测试数据，再复现真实名称回显断言失败。另有一次单元测试与生产构建清理产物并行，造成 `MODULE_NOT_FOUND`；构建完成后顺序重跑通过。最终新增概览用例还曾遇到自动构建清理产物的相同冲突；等待构建完成后重新运行，才将实际行为断言失败计为反例。失败日志保留，不将这些编排问题解释为产品缺陷或计为通过。

实现主要涉及[共享展示定义](../../src/utils/settingsDisplay.ts)、[模型展示与 selector 适配](../../src/utils/modelUtils.ts)、初始设置组件、设置音频/AI/QCLOUD 面板与 onboarding 安全名称元数据；未创建另一套配置存储。

原始本地日志位于 `.tmp/onboarding-consistency/`；最终日志为 `unit-final.log`、`dev-final.log`、`production-verified.log` 及两端类型日志。测试使用独立 userData、假 Key 与阻断外联的 guard；Codex 保存场景不启动真实推理。没有调用真实 QCLOUD 账号，也没有发布或替换本机应用。真实云端请求、真实系统权限、有声会议、物理设备热插拔与新发行包安装复验仍未执行；此前 SEC-01 的用户接受结论不变。
