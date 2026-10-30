# 系统音频权限回归约定

这些测试保护行为，不冻结内部实现。修改系统音频、权限、会议启动或恢复逻辑时，必须保留以下行为；需求变更应同步说明原因、更新用例和真机验收范围，不能只删除失败断言。

## 执行命令

```bash
npm run test:system-audio-permissions
npm run test:system-audio-permissions:e2e
```

第一条重新编译 Electron 主进程并运行权限、健康监控和生命周期单元套件，使用 `cross-env`，可供三个平台的构建命令调用。第二条重新构建 renderer/main，以真实 production Vite 分块和 `file://` 运行权限页及会议流程，不启动 Vite server。入口为 `playwright.system-audio.config.ts`，继承已有 production 隔离设置。

## 必须保留的行为

| 场景 | 回归约定 | 主要用例 |
|---|---|---|
| macOS 系统音频开始 / 设备切换 / 恢复 | 不得用屏幕枚举失败阻止原生音频尝试，保留设备选择；覆盖 screen denied、granted 但无屏幕源、枚举抛异常三种输入 | `MeetingSystemAudioPermission.test.mjs` |
| 冷启动与首次授权 | 冷启动不发起屏幕捕获或凭屏幕状态广播音频拒绝；真正的首次截图使用仍到达受保护 API，restricted 不探测 | `MacTccRepairFlow.test.mjs`、`MacScreenFirstAuthorization.test.mjs` |
| 静音 / 零填充 | CoreAudio、WASAPI 和未知音频后端不根据屏幕权限产生音频拒绝；SCK 保留自身屏幕诊断 | `CoreAudioSystemAudioSuppression.test.mjs` |
| 真实原生拒绝、设备故障、取消 | 权限拒绝必须显示终止错误、释放失败通道且不重试，不被另一通道清除；设备故障有有限重试，旧回调与已取消任务不得复活采集 | `MeetingSystemAudioPermission.test.mjs`、`AudioCaptureHealthMonitor.test.mjs`、`AudioNativeUnavailable.test.mjs` |
| 首次设置状态与门禁 | 被动 screen denied/restricted/granted/unknown/not-determined 均不能证明系统音频受限或获准；未尝试音频后端时为 pending_runtime / unavailable；撤销过期限制确认，保留权限读取失败和输出设备缺失 | `OnboardingIpc.test.mjs`、`OnboardingPolicy.test.mjs` |
| 刷新设备与权限 | 有刷新中、完成、失败反馈，成功重试清除旧读取错误，结构化失败不能显示成功；仅屏幕拒绝时不要求确认音频限制，恢复屏幕授权也不冒充音频成功 | `onboarding-permissions.spec.ts` |
| 会议导航 | 保留开始入口、并发复用、异步失败恢复和已有会议行为 | `onboarding-meeting.spec.ts` |
| 修复与平台边界 | TCC 修复仍需用户确认；不自动重置 / 强制重启；截图权限独立检查；Windows 不出现 macOS 权限步骤 | TCC Safety / Screenshot / Windows 与跨平台文案套件 |

单元文件位于 `electron/services/__tests__/`，健康监控套件位于 `electron/audio/__tests__/`，Electron UI 用例位于 `tests/e2e/`。完整固定文件列表由 `package.json` 的专用命令给出，不依赖名称通配符碰巧收集到测试。

## 自动检查入口

- `.github/workflows/system-audio-permissions.yml`：每次 push、PR 和手动运行，在 macOS runner 执行单元与 production UI 套件；失败上传 Playwright 报告与证据。同一 ref 的旧运行可被新运行取消，不加路径过滤。
- ARM64 Mac、Intel Mac、Windows x64 三份发行构建：安装依赖后、打包前执行同一单元命令；不使用 `continue-on-error`。失败会中止该平台构建，不生成后续新包。

配置随代码提交推送后才在远程生效。现有分支保护 / Ruleset 未在本轮修改；若未要求 `System Audio Permissions / system-audio-permissions` 检查通过，GitHub 仍可能允许合并失败的 PR。测试本身也无法防止有人有意删除用例或移除检查，代码评审仍应关注这些变化。

## 本轮验证（2026-10-29）

- 专用单元命令：**120/120 通过**。
- 专用 production UI 命令：**9/9 通过**。
- Renderer / Electron 类型检查、生产构建、四份 workflow 的 YAML 解析和 `git diff --check` 通过。尚未在远程 runner 执行，未声称三个平台 CI 已通过。
- 对隔离临时副本做两次反例验证：重新加入“屏幕探针失败就跳过系统音频”的前置门禁；移除非 SCK 零填充保护。两次均由断言失败检出，没有修改工作区产品源码。日志位于本地 `.tmp/system-audio-permission-lock/`。

## 自动化不能证明的部分

单元使用 OS / native 替身；UI 使用独立 userData、网络隔离与禁用真实采音的 fixture。它们不读取或更改真实 TCC，不代表真实授权、实际有声系统音频、CoreAudio→SCK 回退质量、签名身份差异或发行安装验收通过。相关原生 / 权限变更发布前，仍需用实际签名安装包验证已授权、拒绝 / 撤销、完全退出重开、输出设备切换和会议恢复，并确认真实系统音频有声采集与转写。

根因背景见[会议链路核查](../qa/2026-10-29-meeting-system-audio-permission.md)和[设置页核查](../qa/2026-10-29-onboarding-permissions.md)。


## 2026-10-29 主题回归扩展

首次设置颜色修正后，production UI 入口新增 `onboarding-theme.spec.ts` 六项 computed style / 对比度用例，目前列表为 15 项；原九项保留。新用例覆盖系统音频限制说明及首次会议提示的亮暗主题颜色，不改变上述权限行为约定。本次已在 production 完整入口运行主题六项与其他八项，共 14/14，通过；远程 runner 尚未执行。见[主题验收记录](../qa/2026-10-29-onboarding-theme.md)。

## 2026-10-30 首次设置被动预检修正（工作区，未发布）

2.7.21 本机验收发现：首次设置仍把屏幕权限拒绝转换为系统音频受限，既有单元断言也把这一错误契约视为正确行为。现已更新该契约，而非删除真实后端和截图的保护用例。预检不请求授权、不尝试采集，也不把屏幕派生的正面 health 当作系统音频授权；真正的音频检查仍在会议实际采集路径执行，截图检查保持独立。

- RED：旧代码上 16 项 IPC/readiness 单元中 5 项行为断言失败；production 权限页 3 项失败，包含亮暗两种屏幕拒绝场景和拒绝提示语义。失败由预期的状态/界面断言产生，不是构建或模块缺失。
- GREEN：权限专项 **122/122**、全部 onboarding 单元 **144/144**、production 引导 **31/31**、production 会议流程 **6/6**、开发态权限与设备 **2/2** 通过。两套单元有交叠，不相加。Renderer 生产构建/类型检查和 Electron 类型检查通过。
- 两个新增 production 场景使用真实 `createOnboardingReadinessReader()` 生成快照，而非注入期望的检查结果。验证 screen denied 时为信息状态、不出现限制确认且能继续；screen 恢复 granted 后仍保持音频待验证。
- 原“permission-denied” fixture 的模拟音频拒绝改由独立 captureState 表达，和屏幕状态分开；真实拒绝提示与恢复、读取失败、设备故障以及会议失败恢复继续保留。历史截图被测试自动重写后已另存并恢复，不覆盖旧验收证据。

原始日志保存在本机私有目录 `~/.codex/release-records/onboarding-audio-evidence-fix/`。本轮没有发布、覆盖安装包、修改签名、操作用户正在检查的应用或重置 TCC。当前安装的 2.7.21 仍有旧行为；真实账号、真实有声采集及修复包升级复验未执行，见[本机验收与修复追记](../qa/2026-10-30-2.7.21-device-acceptance.md)。

## 2.7.22 发布跟进

上述首次设置权限误判修复已随 [2.7.22](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.22-sha-398ccca) 正式发布，三平台远程构建和附件核对见[发布记录](2.7.22-build-release.md)。本节不追溯改写此前未发布阶段事实，也不代表已替换本机应用或完成新包真实 TCC / 有声会议验收。
