# 2.7.18 Apple Silicon 安装包本机初始设置验收

日期：2026-10-27（America/Los_Angeles）。**结论：安装与部分后续流程通过；首次欢迎页进入设置失败，完整首次会议未验收，不能判定整体通过。** 本轮仅验收和记录，没有修改产品代码、制作替代安装包或发布修复版本。

> DEVICE-01 后续状态：源码已修复，生产资源回归及本地重新打包的 ARM64 候选包原生点击复验通过，见文末修复记录。以上失败结论继续适用于原来下载的公开 2.7.18；本轮没有替换已发布附件或 `/Applications/CueUp.app`。完整首次会议仍未验收。

> 正式发布更新：DEVICE-01 修复已于 2026-10-28 随 [2.7.19](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.19-sha-8dee78b) 发布，三平台构建与附件核对通过。下文“未发布”是此前本地候选阶段的历史记录；没有把本报告的 2.7.18 候选原生点击当作正式 2.7.19 下载后验收。详见[2.7.19 发布记录](../testing/2.7.19-build-release.md)。

## 安装与证据边界

- 实机 macOS 26.1，Apple Silicon ARM64。使用正式 Release `v2.7.18-sha-85a6ca0` 的 `CueUp-2.7.18-arm64.dmg`，不是开发态 Electron 或仓库内旧构建。
- [正式下载来源](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/download/v2.7.18-sha-85a6ca0/CueUp-2.7.18-arm64.dmg)。大小 322,094,705 字节，SHA-256 `706cebc1813926ec7c98a59e4dd526323ea922d8916e6bd299475a346b890581`，与 GitHub 资产 digest 完全一致。
- DMG 只读挂载；包内和安装后应用均通过 `codesign --verify --deep --strict`。安装后 Info.plist 为 2.7.18，主程序为 Mach-O arm64。安装位置 `/Applications/CueUp.app`。
- 原安装为 2.7.16，未运行；已完整移动备份到本地 `.tmp/2718-device/backup/CueUp-2.7.16.app`，没有删除旧应用。验收结束已退出 CueUp，保留 2.7.18 安装。
- 正式记录使用全新独立 userData，通过 `open -n /Applications/CueUp.app --args --user-data-dir=...` 启动，并核对实际进程参数及 `origin: fresh`。仅放入迁移防护 marker，防止复制已有 Natively 数据；没有注入设置进度、权限/设备/模型/服务 fixture，没有启用 E2E 或 STT quality 模拟模式。
- 独立 userData 不等于全新设备：HOME、macOS TCC、物理设备均为本机真实环境；原有麦克风/屏幕授权可能沿用，没有重置 TCC。
- 下载使用 curl；安装包没有 `com.apple.quarantine` 属性。没有绕过或关闭 Gatekeeper，但本轮也没有验证浏览器隔离标记触发的首次打开拦截、公证或“仍要打开”流程。ad-hoc 完整性通过不能等同 Developer ID 签名或 Apple 公证通过。

### 工具过渡实例（不计入正式通过证据）

首次直接启动二进制后，原生界面工具连接曾报 `procNotFound`。随后观察到一个不带 `--user-data-dir` 的实例，其页面显示已有服务配置；已退出该实例，重新创建干净目录并使用上述系统启动方式复验。不能将该过渡实例的状态当作新用户体验，也不能声称默认用户目录零写入：默认目录 settings.json 的修改时间在该过程中更新。没有主动编辑默认目录文件、删除会议或复制真实密钥；应用自身默认启动可能产生的所有写入/网络行为未审计。后续所有正式截图与验收项都来自重新创建的独立 fresh 目录。

## 实际结果

| 验收项 | 结果 | 证据与限制 |
|---|---|---|
| 下载、版本、架构与签名完整性 | 通过 | 官方 digest 一致；安装后 2.7.18 / arm64 / codesign 通过 |
| 干净数据首次欢迎页 | 通过 | 显示“先完成初始设置，再开始第一场会议”；开始设置可点击，见 01 |
| 欢迎页进入设置 | **失败 DEVICE-01 / P1** | 点击后约 22 秒仍显示欢迎层和 disabled“正在读取…”；设置概览已经出现在后方，见 02 |
| 退出后重开 | 通过（绕行） | 不再显示欢迎层，可以看见概览；不能抵消上一项失败，见 03 |
| 权限页与真实设备 | 部分通过 | 麦克风显示已授权，默认输入/输出可保存；不是首次授权弹窗验收，见 04 |
| 真实麦克风电平检查 | 部分通过 | 点击后出现“停止检查”和真实电平控件，停止后恢复；观察值为 0，没有受控人声，不能认定声学链路和识别质量通过，见 05 |
| 系统音频受限说明 | 通过（受限分支 UI） | 显示限制、确认后可继续；未认定实际系统音频捕获成功 |
| 会议语言与默认语音配置 | 已检查 | 默认 English · 美国 + 推荐中文 SenseVoice 时显示不支持语言提示；切换为简体中文后下载并保存，见 06 |
| 真实模型下载与跨页继续 | 通过 | 在 P3 启动真实下载，进入 P4 后下载继续；返回时已完成，见 07、10 |
| 真实本地模型加载 | 通过 | UI“本次检查通过 · 模型加载”；实际 model.int8.onnx 为 239,233,841 字节，隔离进度中 STT receipt `result: passed / depth: model_load` |
| AI 空密钥错误与焦点 | 通过 | 保存并验证显示“请填写 AI 密钥”，焦点进入密钥框；未填写或保存真实密钥，见 08 |
| 无账号开通说明与返回 | 通过 | 展示豆包开通步骤和官方入口；返回仍是填写页，无已验证状态；没有注册、充值或调用真实账号，见 09 |
| 未保存修改 | 通过 | 使用无敏感信息的临时模型名称；离开出现三选项，Escape 保留输入，放弃修改可离开；未保存该测试名称，见 12 |
| 设置检查页缺少 AI | 通过（门禁） | 不提供可完成启动的主操作，“继续设置”回到缺失的 AI 步骤，见 11 |
| 稍后继续与首页卡片 | 通过 | 回首页显示“还需完成 1 项设置”，保留继续入口，见 13 |
| 首页直接启动会议 | 通过（门禁） | 回到 AI 配置，无会议/转写成功里程碑，见 14 |
| 真实退出重启后持久化 | 通过 | 首页卡片恢复；继续设置回到上次 AI 步骤，中文和 SenseVoice 配置保留，语音页显示“上次检查通过，沿用历史回执”，见 15 |
| 真实 AI 模型响应与完整首次会议 | **未执行** | 没有本轮专用真实 AI 账号；未伪造通过回执、未借用已有密钥，也未把受门禁拦截记为会议成功 |

## DEVICE-01：首次欢迎层不退出（P1）

复现步骤：使用安装的正式 2.7.18、全新 userData（无 settings、credentials 或 Local Storage）启动 → 欢迎页可见 → 用户明确允许接受条款后点击“开始设置” → 显示短暂加载后欢迎页停留，按钮变成 disabled“正在读取…”。

预期：欢迎层退出，用户能看到并操作设置概览。实际：在欢迎前后两张截图相隔 22.4 秒时仍由欢迎层占据画面；无障碍树同时包含欢迎页和设置概览，焦点已移到后方概览标题。对应界面设计的退出动画为 0.6 秒，该现象不能按正常短暂过渡计为通过。此症状在首个隔离尝试中也出现，第二个全新目录已通过实际点击再次复现，正式证据取自第二个目录。

退出并用同一个独立目录重开后，直接显示概览，可以继续后续检查。重开是本次验收绕行办法，不是修复。涉及区域是 `src/App.tsx` 的 StartupSequence / AnimatePresence 与懒加载主界面切换；当前仅定位到该边界，**未证明具体根因，也没有修改代码**。后续修复应在真实发行包、默认动画设置下复验“欢迎层实际消失”，不能只判断后方标题已挂载或可被测试定位器找到。

## 未执行与仍需验收

- 全新 macOS 用户/设备上的 TCC 首次提示、拒绝后恢复、真正重启重新授权、屏幕与系统音频捕获；没有为验收重置现有授权。
- 受控人声电平、真实麦克风转写、系统音频转写、拔插/默认回退、休眠与长会议；本轮仅启动/停止了本地电平检查，没有确认音频内容或识别准确率。
- 豆包及其他云服务/Codex 的专用账号、真实所选模型响应、余额/模型权限/断网/限流等实际服务分支。没有本轮账号授权与预算，未借用开发者已有凭据。
- AI 验证成功后的首次真实会议、真实转写与答案两类提示、结束后的完成状态；缺少 AI 认证前置，未通过注入跳过门禁。
- 600×400、暗色、高对比度与系统减少动态效果的发行态组合；此次实机截图均为 1200×800 浅色。开发态的 53 张 fixture 截图不计作本轮实机覆盖。
- Gatekeeper 浏览器下载隔离场景、Developer ID/公证、Intel Mac、Windows，以及安装升级/回滚的完整数据兼容性。本次安装和使用独立目录不等同默认真实用户库升级验收。

SEC-01 继续保持用户已接受的非阻断风险：实际凭据存储实现仍是明文，本轮不实施加密，也不把格式诊断写成加密通过。DEVICE-01 是独立发现的流程失败，与 SEC-01 风险接受无关。

## 证据

以下 15 张是原生界面工具获取的原始 JPEG（未转码），均 1200×800。字节数与 SHA-256 见[清单](assets/2026-10-27-first-run-onboarding-device/manifest.json)。

- [01-welcome.jpg](assets/2026-10-27-first-run-onboarding-device/01-welcome.jpg)
- [02-welcome-after-start.jpg](assets/2026-10-27-first-run-onboarding-device/02-welcome-after-start.jpg)
- [03-overview-after-restart.jpg](assets/2026-10-27-first-run-onboarding-device/03-overview-after-restart.jpg)
- [04-permissions.jpg](assets/2026-10-27-first-run-onboarding-device/04-permissions.jpg)
- [05-microphone-check.jpg](assets/2026-10-27-first-run-onboarding-device/05-microphone-check.jpg)
- [06-speech-default.jpg](assets/2026-10-27-first-run-onboarding-device/06-speech-default.jpg)
- [07-model-download.jpg](assets/2026-10-27-first-run-onboarding-device/07-model-download.jpg)
- [08-ai-required-key.jpg](assets/2026-10-27-first-run-onboarding-device/08-ai-required-key.jpg)
- [09-ai-provisioning.jpg](assets/2026-10-27-first-run-onboarding-device/09-ai-provisioning.jpg)
- [10-speech-verified.jpg](assets/2026-10-27-first-run-onboarding-device/10-speech-verified.jpg)
- [11-ready-missing-ai.jpg](assets/2026-10-27-first-run-onboarding-device/11-ready-missing-ai.jpg)
- [12-unsaved-dialog.jpg](assets/2026-10-27-first-run-onboarding-device/12-unsaved-dialog.jpg)
- [13-home-resume.jpg](assets/2026-10-27-first-run-onboarding-device/13-home-resume.jpg)
- [14-launcher-gate-ai.jpg](assets/2026-10-27-first-run-onboarding-device/14-launcher-gate-ai.jpg)
- [15-history-after-restart.jpg](assets/2026-10-27-first-run-onboarding-device/15-history-after-restart.jpg)

下载校验、安装签名日志、过渡实例日志、脱敏进度摘要、独立目录定位文件及旧应用副本保存在本地 `.tmp/2718-device/`，不纳入仓库。两处隔离资料目录留存供复查，正式使用目录由 `profile-path.txt` 记录。原始日志和资料文件不随截图公开。


## DEVICE-01 根因、修复与回归复验

### 根因

`src/App.tsx` 的外层 Suspense 包住了整个 AnimatePresence。欢迎页切换到主界面时，Launcher、SettingsOverlay 等 React.lazy 组件首次加载会挂起；同一外层边界因此把正在退出的欢迎动画子树一起隐藏并中断其布局/退出生命周期。重新显示时，AnimatePresence 仍保留等待退出完成的欢迎子节点。结果是业务状态已经进入概览、焦点也已转移，欢迎层却仍显示旧的 pending“正在读取…”状态。

证据链如下，排除了“只是网络慢/需要再等一会儿”的解释：

1. 未修复源码使用真实 Vite production 构建、Electron production main 和 `file://.../dist/index.html` 启动，两种动态效果模式都在“欢迎标题应已移除”的断言失败；后方概览标题已经可见于 DOM。无 onboarding 设备/模型/服务 adapter 注入。
2. 临时实验预先 import 主界面 JS 文件后，两种模式仍失败。JS 文件预热不能消除 React.lazy 初次挂起及共用边界的问题。
3. 仅在主界面 motion 分支内部增加独立 Suspense，捕获该分支的懒加载，使欢迎退出的 presence 边界持续挂载；同一类生产冷启动测试通过。没有增加延时、重试、强制移除 DOM、预载全部主界面或关闭动画。
4. 实际重新打包的候选 `.app` 用全新 userData 启动，经原生坐标点击“开始设置”后，欢迎层消失，设置概览可见；继续设置可进入权限页，稍后继续可返回首页，不再需要重启绕行。

生产代码改动限于 [App.tsx](../../src/App.tsx)，三个新增行（含边界说明），保持现有退出动画及减少动态效果策略。

### 为何旧测试漏检，以及新增覆盖

旧测试判断后方概览标题 `toBeVisible()`，并检查名为“开始设置”的按钮计数为零。前者不保证未被其他层遮挡；后者在旧欢迎按钮变成“正在读取…”后也成立。因此它不能证明欢迎层退出。

- [生产态回归](../../tests/e2e/onboarding-production.spec.ts)：默认动态效果与减少动态效果两个独立 fresh 实例；断言入口是 file:// production 资源、NODE_ENV=production、点击后确实请求冷加载 Launcher chunk；要求欢迎标题和“正在读取…”按钮从 DOM 消失，主按钮中心 `elementFromPoint` 命中自身，然后用普通 hit-tested 点击前进、进入权限页、稍后继续回首页。未使用 force click 或直接触发 DOM click。
- 原开发态欢迎用例也补上欢迎标题与 pending 按钮移除断言。
- 新增 [production Playwright 配置](../../playwright.production.config.ts) 与 `rendererMode` fixture 选项；默认开发套件排除该生产专用文件，避免错误地把 Vite dev 当 production。独立命令 `npm run test:e2e:production` 先真实构建 Renderer 与 production main，再执行测试；不需要 Vite 服务，不新增依赖。
- 生产资源自动化使用 Electron 测试运行器（`app.isPackaged` 并非 true），与真实打包原生点击证据分开记录；前者验证 production 分块/React 生命周期，后者验证真正 app.asar 和本机窗口路径。未声称已在远程发行 CI 或三平台发行包上复验。

### 执行结果与异常留痕

| 检查 | 结果 |
|---|---|
| 未修复 production 冷启动回归 | 2/2 失败，失败点为欢迎标题未移除，符合 DEVICE-01 |
| JS 预热临时对照实验 | 2/2 仍失败；仅诊断，不纳入最终套件 |
| 修复后 `npm run test:e2e:production` | **2/2 通过，5.7 秒**；命令内含 `npm run build` 和 `npm run build:electron:package`，均通过 |
| 原五份 Electron 回归联合执行 | 首轮 49/50，通过项之外有 1 项 `_session` 启动超时，尚未进入业务断言；该项单独复跑 1/1 通过；关闭额外 CueUp 实例后完整复跑 **50/50 通过，2.6 分钟**，没有排除/跳过/放宽超时 |
| 原欢迎页与首页内容测试 | **9/9 通过** |
| Renderer/Electron TypeScript | `npx tsc --noEmit`、`npm run typecheck:electron` 均通过 |
| 本地 ARM64 目录包 | electron-builder `--mac --arm64 --dir --publish never` 通过，严格 codesign 完整性通过 |
| 本地真实包原生操作 | 欢迎 → 概览 → 权限页 → 稍后继续回首页，通过；默认动态效果、1200×800 浅色 |
| 包内容核对 | app.asar 中 Renderer 与本次构建逐字节相同；main 无 onboarding fixture 实现；截图 SHA-256 和链接核对通过 |
| 源码差异检查 | `git diff --check` 通过 |

早期新增用例一度假定概览主按钮必须前往权限页；真实设备检查允许跳到语音页，该假定不成立。已改为验证确实离开概览，再显式点击权限步骤，不改变产品路由。该阶段欢迎移除断言已经通过，没有将测试路径假定错误当作第二个产品缺陷。

原生工具最初连接本地候选包多次超时，按应用名重试还额外打开过 `/Applications` 的正式实例；已结束额外实例，再通过候选包绝对路径重新激活后完成原生复验。启动超时的精确根因未证明，不将“并行实例/资源竞争”写成确定结论。默认资料目录的自动启动边界仍按前文过渡实例说明处理。候选包与正式实例均已退出。

完整本地日志在 `.tmp/onboarding-device01/`：`production-red.log`、`production-preloaded-experiment.log`、`production-command-final.log`、`development-regression.log`、`startup-timeout-recheck.log`、`development-regression-final.log`、`content-tests.log`、两套 typecheck 日志、`local-package.log` 与 `package-boundary.json`。未重跑整个 3,382 项单元套件，不将历史全量结果当作本次运行结果。

### 候选包证据与发布边界

本地候选位于 `.tmp/onboarding-device01/package/mac-arm64/CueUp.app`，保留原版本标签 2.7.18 仅用于本轮修复验证，**不是原先公开下载的 2.7.18，也未发布新版本**。其 app.asar SHA-256 为 `445b27449bcfe9a0e783a034ad83904264ca0fa967423318b3f878ae1894594e`。资料目录由本地 `manual-profile.txt` 记录，仅放置迁移防护 marker，没有注入回执或 fixture，进度 origin 已确认为 fresh。

- [候选欢迎页](assets/2026-10-27-first-run-onboarding-device/device01-fix/01-candidate-welcome.jpg)
- [欢迎层退出后的概览](assets/2026-10-27-first-run-onboarding-device/device01-fix/02-candidate-overview.jpg)
- [正常点击进入权限页](assets/2026-10-27-first-run-onboarding-device/device01-fix/03-candidate-permissions.jpg)
- [稍后继续回到首页](assets/2026-10-27-first-run-onboarding-device/device01-fix/04-candidate-home.jpg)
- [四张原始 JPEG 的尺寸与 SHA-256 清单](assets/2026-10-27-first-run-onboarding-device/device01-fix/manifest.json)

DEVICE-01 在源码和本地候选验证范围内已修复；原发布包的失败历史仍保留。真实 AI 账号、完整首次会议、新设备 TCC、实际音频转写、其他平台以及原先列出的其他人工验收缺口不因本次修复而变为通过。SEC-01 风险接受状态不变。
