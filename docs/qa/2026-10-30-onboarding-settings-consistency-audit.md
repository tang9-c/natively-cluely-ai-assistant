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

## 2026-10-31 验证维护：QCLOUD 名称断言

本次基于 2.7.22 源码及已合并文档，修复文档命令实跑发现的过时测试；不修改产品行为、提供商 ID 或配置保存逻辑，不补记发行包真机通过。

根因是 `QCloudApiSpeechChannel.test.mjs` 用正则读取 `SettingsOverlay.tsx` 的源码，要求内联 `label: 'QCLOUD API'`。当前两个入口已通过 `getSpeechProviderLabel()` 统一显示名称，因此旧断言失败不能证明用户看见内部 ID。

- 单元回归现在执行真实 `settingsDisplay.ts`，独立断言当前 `qcloud-stt` 与历史 `natively` 均显示为 `QCLOUD API`，不再要求特定源码写法。
- 原 production 跨页用例保留首次设置的选中项验证，并明确检查设置页已选提供商、展开列表选项均显示 QCLOUD API，用户可见文字不出现内部 ID；选择后保存值仍为 `qcloud-stt`。
- 私有隔离副本把真实名称映射改为返回原始 ID，新断言以 `ERR_ASSERTION` 正确失败（实际 `qcloud-stt`、预期 `QCLOUD API`），排除只因启动或导入失败而变红。正常工作区映射未改动。

| 检查 | 本次结果 |
| --- | --- |
| 旧源码断言单独复现 | 修复前按预期失败，保留 RED 证据 |
| 旧语音指南中的三份 provider 套件 | **61/61 通过**，此前为 60/61 |
| 显示/配置、语言兼容、权限四份相关单元套件 | **46/46 通过** |
| `npm run test:e2e:production` | **31/31 通过**；包含生产 renderer 构建/类型检查与 Electron 编译 |
| 私有映射错误反例 | 新断言检出，未留下产品源码改动 |

语音命令仍为：

```bash
npx cross-env ELECTRON_RUN_AS_NODE=1 electron --test electron/services/__tests__/LocalSenseVoiceSTT.test.mjs electron/services/__tests__/QCloudApiSpeechChannel.test.mjs electron/services/__tests__/DoubaoAucRestSTT.test.mjs
```

相关单元命令：

```bash
npx cross-env ELECTRON_RUN_AS_NODE=1 electron --test electron/services/__tests__/OnboardingIpc.test.mjs electron/services/__tests__/OnboardingSettingsDisplay.test.mjs electron/services/__tests__/SttLanguageCompatibility.test.mjs electron/services/__tests__/QCloudApiSettings.test.mjs
```

原始日志保存在本机私有验证目录，包含旧断言 RED、私有反例 RED、61/46 项单元与 production GREEN。上述类别不合计为唯一用例数。UI 使用隔离主进程适配器、测试凭据并阻断外联，不证明真实 QCLOUD 账号、系统音频或安装包真机验收；本机已安装应用未被操作。

## 2026-10-31 软件内帮助同步（未发布）

仓库 Markdown 不会自动同步到软件内的“设置 → 设置与帮助”。本轮更新 `HelpSettings.tsx`，保留现有章节和动画结构，未改动实际采音、权限、服务路由或凭据保存逻辑。

- 快速开始改为设置概览、权限与设备、语音识别、AI 提供商、开始会议五步；区分“初始设置”和单场会议“开始准备”，说明稍后继续、配置验证和实际转写是不同阶段。
- 麦克风、截图与系统音频分别解释；不再把 CoreAudio 写成仅供旧硬件使用，不承诺 SCK 零延迟，不用屏幕开关代替音频采集结果。Windows 改为检查隐私与桌面应用访问，不承诺一定出现一次性弹窗。
- QCLOUD 语音与 AI 共用 Key，并提供独立平台入口；豆包语音与 AI 分开配置，Codex 程序检测不等于实际推理通过。模型准备、语言兼容、历史回执、保存与验证分别说明。
- 数据范围明确为全局策略；转写文本开关不控制 STT 原始音频上传，云端 Embedding 回退也受范围限制。补齐凭据明文 JSON、保留策略、当前更新方式、签名与授权连续性边界，修正 PPTX 配置指路。
- 动画明确标注示意，不显示当前密钥或连接状态；入门快捷键读取现有快捷键配置，不继续硬编码旧按键。

验证中，原帮助内容套件基线为 23/24，已有一项仍匹配旧“语音”标签源码。另有五项会把旧四步入门、默认模型准备或旧指路固化。六项相关源码断言迁至实际帮助页的亮/暗两项 Electron 场景；不是简单删除失败断言后宣称通过，其余 18 项保留。

| 检查 | 结果 |
| --- | --- |
| 修改前新帮助场景 | 亮/暗两项均在缺少新版五步标题的可见性断言处失败，保留 RED 证据 |
| 剩余帮助内容套件 | **18/18 通过** |
| 冻结后 `npm run test:e2e:production` | **33/33 通过**，含原31项及新增2项；命令同时完成 renderer 类型检查/生产构建与 Electron 编译 |
| QCLOUD 帮助平台入口 | 实际按钮经现有 IPC 到达外部链接边界；截获 shell.openExternal 确认为 QCLOUD 平台地址，未打开真实浏览器 |
| 展开与主题 | 实际设置页依次展开权限、语音、AI、通用说明，核对关键边界，并查看 QCLOUD 设置指路；亮/暗首屏截图留存，未把示意动画当作系统实际状态 |

当前版本仍为 2.7.22；这些帮助修正尚未构建/发布新安装包，已安装版本不会因源码或 Markdown 更新而自动改变。没有操作用户正在使用的已安装应用，也未执行新包真机权限、真实账号和有声会议验收。原始日志与合成截图保存在本机私有验证目录，不提交安装包或真实数据。

## 2.7.23 发布跟进

上述 QCLOUD 显示行为测试与软件内帮助修正已随 [2.7.23](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.23-sha-12e62ad) 正式发布。三平台远程构建、14 项附件及逐字节摘要核对见[发布记录](../testing/2.7.23-build-release.md)。本节保留此前未发布阶段事实，不表示已更新本机应用或完成新包真实账号、权限、有声会议和人工安装验收。

## 2026-10-31：2.7.23 Apple Silicon 本机安装与验收

以下为首次尝试结果；最新结论见文末“后续排查：恢复原生操作并补做 2.7.23 界面验收”。

环境：Apple Silicon arm64，macOS 26.1（25B78）。本次使用正式发行包和日常实例；以下将安装验证、安装包静态内容检查、原生界面验收分开记录。

### 下载、安装与启动

- 从[2.7.23 正式发布](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.23-sha-12e62ad)下载 `CueUp-2.7.23-arm64.dmg`，322104174 字节；SHA-256 为 `29fea88ca5262075f5d7709e36a18374c70a8413bd7eef86dac504fea2fc5498`，与 GitHub asset digest 一致。
- 替换前 CueUp 未运行。已安装至 `/Applications/CueUp.app`；DMG 内、暂存副本和安装后应用均通过 `codesign --verify --deep --strict`。Info.plist 版本为 **2.7.23**，主程序 `lipo -archs` 为 **arm64**。这是 ad-hoc 完整性检查，不等于 Developer ID 或 Apple 公证。
- 原 2.7.21 应用保留在本机私有备份 `~/.codex/release-records/2.7.23-device/backup/CueUp-2.7.21.app`；DMG 已卸载。未清空日常 userData、会议或权限记录，未读取或更换真实 Key，未重置 TCC 或清除扩展属性。
- 原生工具启动后，进程路径核对为 `/Applications/CueUp.app/Contents/MacOS/CueUp`，应用清单显示运行中；这只证明正确程序的进程启动，不证明窗口可用、首页加载或完整启动验收通过。

### 原生工具阻碍与实际执行范围

使用完整路径绑定应用时，原生界面工具三次返回 `Computer Use server error -10005: timeoutReached`，包含一次重建工具连接后的重试。按 bundle ID 绑定因本机存在多个同标识旧包而返回歧义；没有转而启动其他副本。当前 macOS 运行时亦未提供文档中的可选 `launch_app` 接口。

未取得可用的 CueUp accessibility 树或截图，无法据此定位并操作设置页。不将工具超时归类为已证实的应用崩溃或功能失败；也不使用开发态、隔离测试、安装包字符串或发布前回归冒充此次实际界面通过。未强制退出、重新签名或改变安全权限来绕过工具问题。

| 验收项 | 本次结果 | 尚需执行 |
| --- | --- | --- |
| 正式包下载、摘要、版本、架构、签名完整性 | **通过**，见上述安装证据 | 全新隔离下载与 Gatekeeper 首开交互未验证 |
| 正确安装路径启动 | **部分完成**：确认正式应用进程运行 | 窗口与首页可操作性未确认 |
| QCLOUD 实际显示 | **未执行**：原生界面工具无法绑定窗口 | 首次设置及设置页的语音/AI 名称、下拉展开/选中值、不得显示内部 provider ID |
| 软件内帮助内容与交互 | **未执行界面验收** | 进入“设置与帮助”、五步标题、章节展开/滚动、QCLOUD 平台按钮及当前快捷键说明 |
| 亮色主题 | **未执行** | 实际切换应用主题，核对 QCLOUD、帮助正文、状态文字、对比度与可读性 |
| 暗色主题 | **未执行** | 同上，并确认切换后内容、展开状态和主题一致；本次未改变原主题偏好 |
| 共享 Key、真实服务、权限与会议 | **未执行** | Key 复用与保存重启、真实账号调用、macOS TCC、实际采音、有声会议和设备热插拔 |

### 安装包静态内容检查（不计界面通过）

只读检查已安装应用 `Contents/Resources/app.asar` 中的真实 renderer 产物，七项内容均存在：五步帮助标题、QCLOUD 平台按钮、共享 Key 说明、屏幕/系统音频权限边界、全局数据范围、明文 JSON 说明和 QCLOUD API 名称。新版帮助位于 `SettingsOverlay-iqSgZtuK.js` 等实际发行 chunks。

这些结果排除了“仅更新 Markdown、帮助内容未打入此安装包”的情况，但不能证明文字当前可见、菜单选项正确、链接能打开或亮暗主题渲染正确。此前 125 项相关单元、33 项 production renderer 回归及三平台固定 WAV smoke 仍是独立的发布证据，不上调本次原生 UI 验收结论。

安装摘要及静态检查结果保存在本机私有 `~/.codex/release-records/2.7.23-device/`，未将原始日常界面、凭据或安装包提交仓库。当前已安装并启动 2.7.23，未主动退出它；待原生工具恢复或人工接管后继续表中未执行项。

## 2026-10-31 后续排查：恢复原生操作并补做 2.7.23 界面验收

本节更新上一节首次尝试的未执行项；此前超时记录保留。以下观察均来自 `/Applications/CueUp.app` 的日常正式实例和 `file:///Applications/CueUp.app/Contents/Resources/app.asar/dist/index.html?window=launcher`，未使用测试适配器、DOM 注入、开发版或伪造成功回执。

### 对照排查及恢复办法

1. 同一原生工具读取 Finder 成功，随后按完整路径读取 CueUp 也成功，先只返回窗口壳。截图已能看到正常首页；点击截图中的设置按钮后，完整 HTML 控件树出现。因此“原生工具整体不可用”“CueUp 没有界面”均不符合此次观察。
2. 点击帮助里的 QCLOUD 外链后，一段时间内出现控件树/主题选择已变化、截图仍停留在旧浅色页面，以及点击未立即反映到画面的不同步。只读检查 `theme-config.json` 已保存 `dark`。此时不能据截图直接判断主题设置未生效。
3. Finder 常规打开与窗口 Raise 未立即消除此现象。经原生 `Window → CueUp`（`makeKeyAndOrderFront:`）激活主窗口后，截图与控件树重新一致，显示实际暗色帮助页，后续菜单与页面操作正常。原生工具重置后浏览器编号也发生变化；外链核对应重新查询浏览器清单，不能沿用旧编号。
4. 对主进程和一个 renderer 分别进行 2 秒只读采样，主线程处于事件/消息等待；未获取到原始超时当时的调用栈，因此这些采样不能追溯证明初始超时的底层原因，也不能据此排除所有间歇性停顿。

**结论范围：已找到可继续验收的恢复路径，确认窗口激活与工具画面同步影响观察；尚未证实初始 `timeoutReached` 的内部根因。** 本轮未修改产品代码、Electron 启动参数或自动化工具实现，未提升辅助功能/录屏权限，未重置 TCC，未强制退出或重启 CueUp。不能把恢复方法写成软件缺陷已经修复，也不能把曾经滞后的浅色截图登记为已证实的暗色主题缺陷。

后续操作建议：绑定正确完整路径；窗口壳无控件时先看截图；必要时通过原生 Window 菜单激活主窗口；每次动作后重新读取控件树，并将目标滚动到可见区域；外链返回后确认当前窗口已激活。无可见结果时不继续使用旧索引盲点。

### 本机实际补验结果

| 项目 | 实际结果 | 限定范围 |
| --- | --- | --- |
| 正式版首页与设置 | **通过本次观察**：首页可见，设置可打开，版本显示 2.7.23 | 不等于全新 userData 欢迎流程通过 |
| 设置 → 音频的 QCLOUD 显示 | **通过**：亮/暗画面中的展开选项为“QCLOUD API”，可见“已保存”与“复用 QCLOUD API Key”说明 | 原服务仍为 Doubao AUC，未选中更换或重新保存，不将 badge 当连接成功 |
| 初始设置 QCLOUD 显示 | **通过观察**：AI 提供商和聊天默认模型显示“QCLOUD API”；显示语音与 AI 共用已保存密钥；语音下拉可见“QCLOUD API” | 未触发保存/验证；原有未验证及“操作未完成”文案保留，不据此判断真实服务调用成败 |
| QCLOUD 专属引导 | **通过**：“我还没有账号或密钥”打开“开通 QCLOUD API”，显示独立的平台、令牌与额度说明 | 未注册、登录或创建密钥 |
| 软件内五步帮助 | **通过**：五步标题、开始后确认转写、示意动画声明可见，章节可展开并滚动 | 检查了权限、语音、AI 章节相关内容，未逐项验完全部 12 章 |
| 帮助说明与外链 | **通过**：屏幕/系统音频边界、共享 Key、豆包凭据分开、Codex 检测边界与全局范围说明可见；实际按钮在 Chrome 打开 `https://aigw.feigenbaum.com.cn/`，标题 AIGW | 只核对打开地址，未执行平台内账号/付费操作或真实调用 |
| 亮色主题 | **通过本次视觉观察**：显式选择 Light；帮助正文、章节和状态文字显示为浅色应用主题，QCLOUD 菜单在浅色画面可读 | 未做数值化 WCAG 对比度测试或全部页面审查 |
| 暗色主题 | **通过本次视觉观察**：选择 Dark 并激活主窗口后，五步帮助、展开的权限正文、QCLOUD 菜单和首次设置/专属指引均显示暗色背景与对应文字 | 不把早先滞后截图判为主题失败；未覆盖 OS/app 四种组合、全部章节或重启持久化 |
| 恢复用户偏好 | **通过**：已从界面恢复原始 System，控件和只读主题配置均确认 `system` | 未更换语音服务、真实密钥、语言、数据范围或设备；未启动会议 |

真实 QCLOUD 响应、Key 更换/保存重启、系统授权、实际麦克风/系统音频、有声会议、设备热插拔和全新用户首开仍未执行。看到“已保存”不代表这些验收项通过。未读取真实密钥正文，未保存包含日常会议列表的原生截图到仓库。脱敏摘要和进程采样保存在本机私有 `~/.codex/release-records/2.7.23-device/`；界面观察以本次工具截图及控件树为依据，不冒称仓库留存了完整截图证据。

### 异步用户反馈补充

用户随后回复此前的状态询问：“界面可操作，但仍是浅色”。该回复到达时，本轮已观察到暗色帮助页并恢复原始 System；无法仅凭回复到达时间确定用户观察对应切换 Dark 后还是恢复 System 后。因此保留用户所见为独立证据，不把此前浅色现象直接归因为工具截图缓存，也不由此认定主题功能失败。已确认的事实仍是：Dark 曾保存，随后通过原生 Window 菜单激活主窗口后观察到暗色，最后已恢复 System；初始超时及中间画面不同步的底层原因尚未证实。


## 2026-11-01：原生工具超时与窗口不同步的根因修复（工作区，未发布）

本节继续前述排查，修正“只有恢复办法、底层原因未证实”的当前结论；不追溯改写此前记录。日常 `/Applications/CueUp.app` 仍为未修改的 2.7.23，以下修复尚未发布或安装到该路径。

### 区分应用阻塞、窗口激活与工具报错

| 现象 | 本轮证据 | 判断及边界 |
| --- | --- | --- |
| 绑定应用返回 `timeoutReached`，首窗口迟迟不出现 | 原实例在 `2026-11-01T04:24:36Z` 启动，直到 `04:53:07.015Z` 才 ready，随后创建窗口、加载页面。系统 tccd 日志记录同一 PID 的麦克风旧签名 requirement 不匹配、麦克风及 Documents 授权提示；提示处理后应用才继续 | 应用在首窗口前依赖受保护资源；不能把这段时间全部归为工具故障。原始阻塞时没有栈采样，因此历史日志本身只建立时序关系 |
| 隔离基线仍超时，且进程存活但无可操作窗口 | 使用正式 2.7.23 代码及原生模块、独立 bundle ID/空白 profile，不授予权限。PID 25760 的 2 秒采样明确停在 `get_input_devices_c_callback → list_input_devices → CPAL supported_input_configs → AudioUnitSetProperty → CoreAudio → mach_msg`；同 PID 的 tccd 日志记录麦克风 `AUTHREQ_PROMPTING` | 获得首窗口前同步输入设备枚举阻塞的直接复现。修改基线身份用于制造未授权条件，不能拿它证明正式包所有超时均为同一原因，也不等于完成真实升级授权连续性验收 |
| 点击设置或外链返回后画面/控件树滞后 | 日常 2.7.23 再现；原生 `Window → CueUp` 的 `makeKeyAndOrderFront:` 后设置页出现、交通灯由灰转为活动状态。旧 `activate` handler 对 internal visible=true 的窗口不执行 show/focus；真实 Electron 回归中旧实现无法恢复原生隐藏窗口，修复后通过 | 已定位应用的显式激活缺口。内部 visible 标记不能代表原生可见及 key 状态；不是仅凭深色配置文件就判断截图缓存。尚未取得工具内部采集/缓存实现证据，不声称已修复工具供应方所有超时或缓存问题 |

### 最小修复及保持的边界

- `nativeModuleLoader.ts` 的导入期 ABI 检查改用现有本地 `getHardwareId()`，核对 SHA-256 返回契约，继续拒绝空实现、异常与 asar stub；不再为加载模块而同步枚举音频设备。指纹不记录、不上传。实际采音、设备选择、系统音频后端及截图权限检查保留。
- `main.ts` 调试日志改为 Electron 的应用日志目录 `app.getPath('logs')`，惰性解析并创建目录，保留轮转与失败容错。日志路径 IPC、打开日志、QA 导出及设置页提示同步调整；不迁移或删除旧 Documents 日志，避免为了启动再次访问受保护目录。
- 非会议状态收到显式 `app.activate` 时，调用现有 `showMainWindow(false)` 恢复可见及焦点；保留会议 overlay 的被动展示规则。没有全局关闭 backgroundThrottling、改变透明窗口方案或放宽权限。Electron 对 [activate 事件](https://www.electronjs.org/docs/latest/api/app#event-activate-macos) 与 [show/showInactive](https://www.electronjs.org/docs/latest/api/base-window) 的区分用于限定修复范围。
- E2E 隔离边界同时覆盖新的 logs 目录，运行时核对路径，避免测试写入日常日志。

### 回归覆盖与无效尝试

新增 `MainStartupSafety.test.mjs` 执行真实源文件中的日志函数、IPC handler、激活回调和 native loader，仅替换 OS/Electron/native 外部边界；覆盖无 Documents 权限写日志、ready 后重试、10 MB 轮转、日志 IPC 一致、麦克风授权 pending 时加载 ABI、坏原生实现拒绝、可见/隐藏 launcher 聚焦，以及会议不抢焦点。另在 production renderer 场景中使用真实 Electron 窗口 blur/hide 与 `app.activate`，核对可见/焦点，并经主题 IPC 切换亮暗、确认实际 HTML 主题与持久配置回读。

已保留修复前目标断言失败和修复后通过证据：初始 6 项目标失败、日志 IPC 单项失败；真实 Electron 激活场景旧实现失败、恢复修复后通过。不是用源码字面匹配代替实际行为。

以下尝试不计通过：诊断副本最初遗漏 entitlement，后按项目配置补齐；系统日志进一步证实该副本因改名导致 `Unable to find helper app` 退出，恢复原 `CFBundleName` 后才获得上述有效采样，不能把最初崩溃全归为 JIT。另一次测试因磁盘空间耗尽中断；随后的并行诊断期间出现 preload 就绪等待超时，单独复跑冷启动场景通过，未将这些失败删去或归为产品已通过。最终结果以隔离诊断退出、构建串行后的完整复跑为准。

私有 tccd 日志、采样、红绿测试日志和诊断元数据位于 `~/.codex/release-records/2.7.23-device/debug-2026-11-01/`，不提交原始日志、硬件指纹、用户数据或安装包。未修改 TCC、未授予诊断副本麦克风/录屏权限、未读取真实 Key、未启动有声会议；仅退出本轮创建的隔离测试进程，未退出日常 CueUp。


### 最终复验结果

| 验证 | 最终结果 |
| --- | --- |
| `npm run test:e2e:production`（诊断进程退出后串行完整复跑） | **34/34 通过**；包含真实激活/主题 IPC 场景、QCLOUD、帮助、首次设置权限和 app/OS 四种亮暗组合；含 renderer 类型检查、生产构建及 Electron 编译 |
| `npm run test:system-audio-permissions` | **122/122 通过**；实际后端、截图和已有系统音频权限边界继续受回归保护 |
| MainStartupSafety、MacX64NativeSmoke、OverlayWindowRecovery、RedactForLog、SensitiveLogRedaction、QaReportIpc.contract、QaReportService | **43/43 通过**，其中新增启动安全测试 **8/8** |
| `npm run typecheck:electron`、`npm run build:electron:package` | **通过**；正式主进程编译为 package 模式，未将 E2E 适配器打入候选 |
| `git diff --check` | **通过** |
| 隔离打包候选原生首屏 | **通过本次观察**：原生工具首次绑定返回窗口壳，下一次读取取得真实首页 HTML 与截图，不再因导入期设备枚举而没有首屏。PID 29679；数据库实际位于独立 `/private/tmp` profile。使用正式 2.7.23 runtime/原生资源，替换当前生产 renderer 与 package 主进程；仅调整诊断身份/profile，重新核对 ASAR header hash 和严格签名完整性。这是本地诊断候选，非新版本正式发行包 |
| 候选设置、亮暗与外链返回 | **通过本次观察**：原生点击设置立即显示设置页；Dark/Light 选择、控件文字及截图一致；帮助语音/AI 章节可展开，外链实际打开 AIGW，返回后切换“通用”页截图与控件树一致。候选主题已恢复 System，并经设置中的退出按钮退出；日常正式实例保持运行 |
| 权限提示边界 | 候选 ready 为 `08:08:37.919Z`，窗口创建 `08:08:38.033Z`、loadURL 成功 `08:08:38.652Z`；tccd 仍在其后 `08:08:38.741Z` 记录麦克风授权提示，未授予。此时窗口已出现且后续操作正常；**不宣称启动后完全没有权限请求，也不将本轮当作实际采音通过** |

本轮对已定位的应用启动阻塞及显式激活缺口完成代码修复和上述复验；无法从本仓库修改原生工具服务内部实现，也未证明其所有潜在缓存、连接或超时原因均已消失。工具曾报告一次目标被同时更改，重新读取最新状态后才继续，未沿用旧索引盲点。截图/AX 以本次工具返回为依据；未将日常界面或诊断包提交仓库。

后续仍需：修复进入正式安装包后的日常实例升级/重启、真实 TCC 授权连续性、真实采音及长时间外链/遮挡/窗口切换稳定性验收；本机仅执行单轮隔离候选操作，不能覆盖所有 macOS 版本、Intel、Windows 或工具断连情况。上述为提交前验收状态；本轮随后按用户指令提交并合并至远程 `ci/intel-mac-workflow`。Git 合并不等于发布，已安装 2.7.23 不包含本次修复。


## 2.7.24 发布跟进

上述 macOS 启动阻塞、应用日志目录及非会议显式窗口激活修复已随 [2.7.24](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.24-sha-8559fc2) 正式发布。来源 `8559fc2064b9120fcc253d5af19272642b5f26a6`；三平台远程构建和包内 runtime smoke、14 项附件实际摘要及公开下载核对通过，见[发布记录](../testing/2.7.24-build-release.md)。此前“工作区未发布”保留为当时状态。未替换本机日常应用，新正式包的真实权限、授权连续性、有声会议和长期稳定性仍未执行。


## 2026-11-01：2.7.24 Apple Silicon 正式包本机验收

**当前结论：下载与安装通过，可操作启动未通过；窗口激活、外链返回和亮暗主题未执行。** 本轮使用日常 profile 的正式 `/Applications/CueUp.app`，不是先前独立身份、空白 profile 的诊断候选。此前隔离候选的通过记录不能替代本次正式包结果。

### 安装证据

- 环境：Apple Silicon arm64，macOS 26.1（25B78）。从[2.7.24 正式发布](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.24-sha-8559fc2)下载 `CueUp-2.7.24-arm64.dmg`，**322104640 字节**；SHA-256 **`900e3b8137b84d76f9b002bfc786a4aa29afcc048466bb93302c85610f863ea3`**，与发布 asset digest 一致。
- 替换前未运行 CueUp。DMG、暂存应用及安装后应用均通过 `codesign --verify --deep --strict`；Info.plist 为 2.7.24，主程序 `lipo -archs` 为 arm64。此为 ad-hoc 完整性检查，不等于 Developer ID 或 Apple 公证。
- 已安装至 `/Applications/CueUp.app`。原 2.7.23 保留于本机私有 `~/.codex/release-records/2.7.24-device/backup/CueUp-2.7.23.app`；DMG 已卸载。未重置日常 userData、会议或 TCC，未重新签名应用、清除扩展属性或读取真实密钥。
- 核对附件清单时发现上轮清单 `assets[].url` 保留了草稿阶段的 `untagged-*` 地址。本轮已与正式发布 API 对照，将 14 项 URL 改为固定正式标签地址；名称、大小、摘要均保持一致。上轮公开 HTTP 200 检查使用正式发布 API 的地址，不能由此认定草稿地址也可用；本次 DMG 确由正式标签地址下载。

### P1：首窗口加载后仍可能被同步输入设备枚举阻塞

原生工具按完整安装路径启动应用后，首次读取返回 `Accessibility error: AXError.cannotComplete`，第二次返回 `Computer Use server error -10005: timeoutReached`。Finder 对照可正常读取。未获得 CueUp 可操作的 AX 树或截图，不将工具尝试本身计为启动通过。

只读日志与采样确认以下事实：

1. 正确进程来自 `/Applications/CueUp.app/Contents/MacOS/CueUp`，PID 16482；采样头确认版本 2.7.24、ARM64。进程 Launch Time 为 `2026-11-01T09:10:19.557Z`。
2. 新应用日志位于 `~/Library/Logs/CueUp/natively_debug.log`：ready 为 `09:10:23.121Z`，窗口创建 `09:10:23.331Z`、loadURL 成功 `09:10:23.579Z`，随后执行 launcher 显示。ready 至 loadURL 约 0.46 秒；该区间不是整个进程启动耗时，也不证明页面可操作。
3. 同 PID 的 tccd 日志于 `09:10:25.732Z` 记录 `kTCCServiceMicrophone / AUTHREQ_PROMPTING`。未授予或拒绝新权限，也未重置旧授权。
4. `09:11:31Z` 开始的 2 秒采样中，主线程停在原生 `get_input_devices_c_callback → list_input_devices → CPAL supported_input_configs → AudioUnitSetProperty → CoreAudio → mach_msg`。这次有应用主线程阻塞的直接证据，不能只归为工具截图缓存或连接问题。

**缺陷范围：2.7.24 移除导入期 ABI 音频枚举后，正式日常实例在窗口加载后的另一条输入设备枚举路径仍可能阻塞主线程。** 此次尚未取得触发该路径的完整 JS 调用点，也未验证处理授权后能否恢复；不扩展为“所有用户必现”或“授权后一定解决”。没有在本轮验收中改产品代码、回退版本、撤回发布或绕过权限。先前“启动后仍可能请求权限”的边界不等于可以把主线程不可操作登记为通过。

### 项目结果及待办

| 验收项 | 本轮结果 | 限定或后续 |
| --- | --- | --- |
| 正式包摘要、版本、架构、签名完整性、安装 | **通过** | Gatekeeper 首次隔离下载交互未独立验证 |
| 正确进程、ready、窗口创建与页面加载日志 | **通过这些检查** | 不等于可操作启动通过 |
| 可操作启动 | **未通过，P1** | 原生工具失败，同时主线程采样确认输入设备枚举阻塞 |
| 可见窗口重新激活、隐藏窗口恢复 | **未执行** | 应用阻塞，无法可靠建立初始窗口状态及操作结果 |
| 应用内 QCLOUD 外链打开与返回 | **未执行** | 未进入可操作设置/帮助页，未冒用旧版本或隔离候选观察 |
| Light / Dark 主题切换与画面同步 | **未执行** | 未改变主题；安装前偏好为 System，无需恢复主题操作 |
| 授权连续性、真实采音、会议、热插拔、长期稳定性 | **未执行** | 本轮没有新增授权或启动会议 |

后续应定位并修复首屏之后同步枚举输入设备的调用路径，补充真实已保存配置及权限待确认时的回归，再用正式包复验上述界面项目。当前 2.7.24 保留安装；记录时进程仍运行，未强制终止日常实例。未主动保存包含会议内容的界面或读取凭据。

安装摘要、启动日志脱敏摘要、完整进程采样和 tccd 原始证据保存在本机私有 `~/.codex/release-records/2.7.24-device/`，不提交原始日志、个人数据或安装包。当前只更新文档和清单 URL，未运行与文档改动无关的产品测试，未提交或推送本轮验收记录。


## 2026-11-01：2.7.24 首窗口后输入枚举 P1 原生方案（已撤回）

**历史方案，已按用户要求撤回。** 下述 Rust 修改、原生边界测试及两个 Mac workflow 步骤均已移除，恢复原实现；本节仅保留探索记录，不代表当前工作区方案。当前验证与边界以下一节为准。原方案完成源码回归，但完整原生模块重建、新包真机复验未完成。 本节不把上一节正式包 P1 改记为通过。工作分支为 `codex/fix-passive-input-enumeration`，本轮未提交、未推送、未发布；已安装 `/Applications/CueUp.app` 仍为原始 2.7.24。

### 触发路径与根因

源码调用链与上一节的主线程采样对应：

1. `src/hooks/useOnboarding.ts` 初始化时读取 `getOnboardingState(savedSelection())`，重新获得焦点时也会读取。该读取发生在判断是否打开首次引导之前；有已有服务/设备配置、甚至不打开引导时也会执行。
2. preload 的 `get-onboarding-state` 进入 `registerOnboardingHandlers.ts`，调用 `OnboardingService.refreshChecks()`；`ipcHandlers.ts` 注册的实际 readiness reader 把 `inputDevices` 连接到 `AudioDevices.getInputDevices()`。
3. `OnboardingReadiness.ts` 的 `Promise.allSettled` 并行安排权限读取和输入设备枚举；`Promise.resolve().then(...)` 仍在 Electron 主线程执行，并不会把同步原生函数搬到后台线程，也不会等待麦克风授权确认。
4. N-API 的 `get_input_devices()` 调用 `microphone::list_input_devices()`。原先的 CPAL `HostTrait::input_devices()` 会过滤 `supported_input_configs()`；macOS 的格式探测创建 AudioUnit，并进入采样中已证实的 `AudioUnitSetProperty/CoreAudio/mach_msg` 等待。它有权限/设备访问副作用，不能作为纯 UI 元数据查询。

权限与设备页、开始会议前的设备名称读取、原设置页也通过输入设备 IPC 使用同一原生 lister。只删掉导入期 smoke 检查或隐藏一处 UI 读取，不能修复这些入口。本轮在共享原生 lister 修复，而非增加一个无法中断同步调用的 Promise 超时。

### 修复内容

- `native-module/src/microphone.rs` 在 macOS 通过现有 cidre/CoreAudio 设备列表、输入流配置的通道数及设备名称列出麦克风；被动枚举不再进行 CPAL 输入格式协商或创建 AudioUnit。
- 保留 `default / Default Microphone`、名称作为 ID 的现有契约及原大小写，兼容已保存设备选择与实际采音解析；无输入通道、查询失败或查询期间移除的设备不进入列表。Windows/Linux 继续使用原 CPAL 路径，N-API/IPC 返回类型不变。
- 实际麦克风捕获时的权限请求、设备解析和格式协商保持原流程；设备元数据可读取不等于已获录音授权。没有用“已授权”状态或空列表掩盖本次阻塞。

### 回归与结果

| 检查 | 本轮结果与边界 |
| --- | --- |
| 新增 `PassiveInputDevices.test.mjs` | **1/1 通过**。提取并编译实际 Rust lister，替换 OS/CPAL 边界；把会创建 AudioUnit 的旧格式探测设为授权待确认时不可进入。旧实现以该副作用 panic 明确 RED，修复后 GREEN；核对默认项、保存的 USB/蓝牙名称 ID、零输入通道、设备读取错误及重复刷新。不是源码字符串断言；仍是边界替身，不是完整 N-API/真实 TCC 测试 |
| 启动安全与 Onboarding IPC | **25/25 通过**。新增已有配置用例执行真实 service/reader/IPC handler，验证初次及再次状态读取保留保存的输入 ID、服务与模型配置；麦克风待确认仍为 `pending_runtime/unavailable`，显式授权状态更新后才显示 verified |
| `npm run test:e2e:production` 最终完整复跑 | **35/35 通过**。新增 existing profile 场景先保存设备选择、安装待确认权限/设备元数据边界，再重新加载 renderer；实际初始化、focus 事件、IPC 状态读取、主题 IPC 与设置按钮仍有响应，不冒充捕获授权。含其余 QCLOUD、权限和亮暗主题回归；该场景使用就绪状态边界替身，未运行修复后的原生二进制 |
| `npm run test:system-audio-permissions` | **123/123 通过**，与前述 IPC 套件有交叠，不合计为独立总用例数 |
| Electron/renderer 类型检查及 renderer 生产构建 | **通过**，renderer 检查和生产构建由 production 命令执行；`npm run typecheck:electron` 单独通过 |
| Rust 类型检查 | **通过，但不是原生构建通过**：`DOCS_RS=1 CARGO_PROFILE_RELEASE_DEBUG=0 cargo check --release --manifest-path native-module/Cargo.toml --target-dir <私有目录>`。DOCS_RS 只用于本机类型检查跳过 cidre 的 Xcode 桥接构建，不用于生成/发布二进制；保留两项既有 `AudioDropStats` 可见性警告 |
| 两个 Mac 构建流程 | 已增加 passive enumeration 回归步骤，YAML 解析及步骤核对通过；本轮未触发远程任务，不能记为远程构建通过 |
| 格式与差异 | 本轮 Rust 函数 `rustfmt --check`、`git diff --check` 通过。整文件格式检查在原 HEAD 亦有既有差异，未批量修改无关格式 |

### 原生构建限制与剩余验收

标准 `cargo build --release` 实际失败于 cidre 桥接构建：本机 active developer directory 是 `/Library/Developer/CommandLineTools`，没有可用完整 Xcode，`xcodebuild` 无法执行。随后尝试独立元数据探针也因缺少 cidre 的 `ca` 静态桥接库而无法链接；未将 DOCS_RS 类型检查、Rust 边界测试或 renderer 的成功写成真实模块构建成功。

曾由实际 crate 类型检查发现并修正 CoreAudio 绑定命名空间错误，说明边界替身本身不能替代真实绑定类型检查；最终以 `cidre::core_audio` 类型检查通过结果为准。原生构建输出均写到本轮私有目录，未覆盖工作区指向其他 checkout 的 `.node` 符号链接，也未替换用户已安装应用。

后续仍须在完整 Xcode 环境构建/链接真正的原生模块，验证新进程在麦克风待确认时不会隐式请求或等待权限，并以已保存设备/服务配置的新安装包复验启动、焦点切换、原设置设备页、外链返回和亮暗主题。真实采音、热插拔、跨版本 TCC 连续性及其他平台 native 构建亦不在本机本轮通过范围内。

未变更系统授权、强制退出日常应用、读取真实 Key 或启动录音。原始 RED/GREEN、生产/权限测试和环境失败日志位于本机私有 `~/.codex/release-records/2.7.24-device/p1-fix/`；原始采样与安装证据保留在其上级目录。保留上一轮尚未提交的验收记录与下载地址修正，没有撤销它们。


## 2026-11-01：撤回 Rust 修改，改为统一入口与被动检查授权门控

**当前结果：上层修复与回归通过，保留原 Rust 实现；隔离候选可操作启动通过，正式日常实例尚未升级复验。** 工作分支 `codex/fix-passive-input-enumeration`；未提交、推送或发布。不能据此把前述原始 2.7.24 正式包的 P1 改记为通过。

### 当前修复

- `native-module/src/microphone.rs` 及两个 Mac 构建 workflow 与 HEAD 无差异，撤回本轮 CoreAudio 元数据实现，移除 `PassiveInputDevices.test.mjs`。不改捕获后端、截图检查或 Rust ABI。
- `AudioDevices.getInputDevices()` 在 macOS 先读取麦克风状态；未确认 granted（包括待确认、未知、拒绝、受限或读取失败）不调用可能同步等待 TCC 的原生枚举。返回空列表仅表示本次没有枚举，不写入配置、不缓存设备不存在；授权后的下一次调用恢复原枚举和原设备 ID。非 macOS 及输出枚举保持原路径。
- readiness 先等待权限读取，再决定是否枚举输入；macOS 未授权时输入状态为 `pending_runtime/unavailable`，不报设备断开。权限读取异常保留失败状态，拒绝/受限仍由麦克风权限项报错。
- 初始设置与设置页保留保存的输入 ID，未枚举时显示“已保存设备（待确认）”；不把空列表当成已断开。初始设置说明授权后刷新。设置页获得焦点时重新读取，关闭或 effect 更新时移除监听，避免监听累积。
- 显式申请权限、检查电平和实际会议采集的授权流程保持原实现；没有伪造 granted。首次设置继续条件未放宽，待确认时可稍后继续。

### 回归证据

| 检查 | 结果及覆盖 |
| --- | --- |
| `AudioDeviceAuthorization.test.mjs` | **8/8**。执行实际 AudioDevices 模块，仅替换 Electron/原生边界；原实现 5 项 RED（未授权仍进入 native），修复后不进入；覆盖五种非 granted/异常、授权后恢复、原 ID、输出及 Windows/Linux 行为 |
| 启动安全与 Onboarding IPC | **26/26**。已有配置初次/重复读取保留服务及设备 ID；权限 Promise 尚未完成或待确认时枚举调用次数为零，授权后恢复；旧并行流程明确 RED |
| `npm run test:system-audio-permissions` | **132/132**，包含新增统一入口用例；与前述套件交叠，不相加统计 |
| `npm run test:e2e:production` | **35/35**。已有配置下保留设备、重新加载和 focus、真实 readiness/IPC/统一入口、设置与初始设置刷新、Light/Dark；只替换 OS 麦克风状态边界，不替换 readiness。界面先 RED：原显示“不可用”，修复为“待确认”且无断开误报。包含 renderer 类型检查和生产构建 |
| Electron 类型检查、package 模式编译 | **通过**：`npm run typecheck:electron`、`npm run build:electron:package` |

### 保留原生二进制的本机隔离候选

从已安装 2.7.24 克隆独立身份候选，仅替换本轮生产 JS/renderer，使用独立 userData；未读取真实账号或密钥。候选与原包 `.node` SHA-256 均为 `2371ea5f48d84aae20bf3657de121ef5e59df98e327b491a8f881d8f110f000a`，确认没有混入撤回的 Rust 修改；候选签名完整性检查通过。不是远程构建或正式安装包。

原生工具约 6.2 秒取得首页 AX，随后打开设置、初始设置及权限页；真实未授权状态显示“麦克风授权确认后再刷新输入设备”，设备保留系统默认。刷新后仍可退出引导并返回首页，未重现原正式包 AX 读取超时/主线程不可操作。未点击允许麦克风、检查电平或开始会议；没有新增权限或录音。仅退出本轮隔离候选。

工具曾在点击后返回旧 AX/截图；对候选窗口执行其支持的 Raise 后读取到已返回首页的新 AX，说明仍存在需要重新激活后核对的工具观察不同步现象。该现象不计为每次点击画面立即同步通过，也不据此宣称工具全部问题已消除。

### 未执行项和结论边界

上层门控回归验证了授权未确认时不会进入已定位的同步枚举路径；隔离候选保留原生模块也能正常启动。尚未验证正式日常 profile 升级、跨版本 TCC 连续性、真实授权完成后的新进程启动、有声采集、设备热插拔、长期稳定性或三平台新安装包。不能保证 granted 后所有驱动/CoreAudio 阻塞均被消除。本轮策略不需要重建 Rust；上节缺少完整 Xcode 的限制不作为当前 JS 修复的构建阻断。

候选使用独立身份和 profile，不能替代原日常实例。候选之后补齐了设置页 focus 监听清理；最终源码由 production 套件复跑覆盖，该清理未重新制作本机候选。已安装 `/Applications/CueUp.app` 未被本轮修复替换。保留既有验收记录及附件 URL 校正，未改远程标签/附件。原始 RED/GREEN、构建与候选元数据位于本机私有 `~/.codex/release-records/2.7.24-device/p1-upper-fix/`，不提交原始日志或个人数据。


## 2.7.25 发布跟进

本轮统一输入设备枚举授权门控、被动检查权限先行、保存设备待确认显示和设置页焦点监听清理已随 [2.7.25](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.25-sha-97459f8) 正式发布。来源 `97459f8d915e3e2b9a61132e10576c0c2ee0f569`；原 Rust 实现保留。上文“未提交/未发布”为验收完成时状态，已按后续用户指令提交、合并和发布。

最终候选生产界面 **35/35**、权限专项 **132/132**、启动安全 **8/8**、Electron 类型检查和 package 编译通过；三平台远程构建、包内架构/六项运行检查、14 项附件实际字节摘要、更新元数据及正式公开下载核对通过，详见[发布记录](../testing/2.7.25-build-release.md)。本轮未替换本机日常应用；新正式包人工安装、真实 TCC 连续性、有声采集、热插拔和长期稳定性仍未执行，原 2.7.24 正式包失败记录保留，不改记为通过。工具观察不同步的限制保持原记录。
