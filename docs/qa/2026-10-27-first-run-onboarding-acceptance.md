# 初始设置 T13 验收记录

日期：2026-10-27。界面名称以“初始设置”为准，原会议准备功能保留原名。

> 后续实机更新：已安装并检查正式 2.7.18 Apple Silicon 包。发现 DEVICE-01：欢迎页点击开始设置后不退场；重开后部分后续流程可用，真实 SenseVoice 下载/加载与进度持久化通过。完整会议仍未验收，详见[发行包本机验收](2026-10-27-first-run-onboarding-device-acceptance.md)。下文原 T13 记录及其“未执行”项是当时的历史范围，最新状态以新增实机报告为准。


**结论：功能实现与开发态自动化验收已执行，发行验收未完成，不具备本次验收的发布放行结论。** 已确认凭据仍明文落盘；用户后续明确决定 SEC-01 不作为阻断，当前记为已接受的已知风险。本轮不实施加密或旧凭据迁移。发行验收未完成的结论来自后文独立列出的真机、真实服务和当前发行包缺项。

## 环境与证据范围

- 当前主机：macOS 26.1（25B78）、Darwin arm64；项目版本 2.7.17。
- Node.js 22.23.1；Electron 42.6.0；Playwright 1.60.0；TypeScript 5.9.3。
- Git 基点 `c2990cef`，工作区含 T01–T13 和其他既有未提交改动；不是一个仅凭该提交即可复现的干净版本。本轮没有提交、推送、安装发行包或改写真实账号/凭据文件。
- Electron 用例使用隔离 userData/HOME/cwd、固定权限/设备/模型/服务 adapter；音频启动、转写事件为 synthetic。截图中的 fixture 模型、固定历史时间及 P7 基础音频桥“未配置”提示均属于测试环境，不能作为真实模型/音频可用性证明。
- `release/mac-arm64/CueUp.app` 已只读核对：包内版本 **2.7.0**，app.asar 修改时间为 **2026-08-12T18:07:59.566Z**，main 中没有 `get-onboarding-state`。它不是本次源码产物，未拿旧包替代当前版本验收。

## 自动化执行结果

下表中的 skipped 是测试运行器结果；后文“未执行”的人工/发行项目没有伪装成自动化测试通过或 skipped。

| 检查 / 轮次 | discovered | executed | passed | failed | skipped | 退出码 |
|---|---:|---:|---:|---:|---:|---:|
| `npm test` 首轮 | 3382 | 3382 | 3362 | 20 | 0 | 1 |
| 失配旧测试的定向复验 | 82 | 82 | 82 | 0 | 0 | 0 |
| `npm test` 最终完整复跑 | 3382 | 3382 | 3382 | 0 | 0 | 0 |
| 原内容测试（另行运行） | 9 | 9 | 9 | 0 | 0 | 0 |
| 原 Electron 联合回归（新增 T13 用例前） | 42 | 42 | 42 | 0 | 0 | 0 |
| T13 新增键盘/必填字段红灯用例 | 2 | 2 | 0 | 2 | 0 | 1 |
| 修复后的可访问性及页面布局用例 | 5 | 5 | 5 | 0 | 0 | 0 |
| T13 四组合视觉/交互定向验收 | 8 | 8 | 8 | 0 | 0 | 0 |
| 最终全部相关 Electron 用例 | 50 | 50 | 50 | 0 | 0 | 0 |

| 构建 / 静态检查 | 结果 | 退出码 | 证据范围 |
|---|---|---:|---|
| `npm run typecheck:electron` | 通过 | 0 | 主进程类型检查 |
| `npx tsc --noEmit` | 通过 | 0 | Renderer 类型检查 |
| `npm run build:electron:package` | 通过 | 0 | 8 个生产编译入口，不等于生成/验收安装包 |
| 生产编译 fixture 边界检查 | 通过 | 0 | 无 fixture 入口/输出文件，main 未打入 fixture 实现 |
| `npm run build:electron` | 通过 | 0 | 生产编译检查后恢复开发产物，用于最终 E2E |
| `npx vite build --outDir .tmp/onboarding-t13/renderer` | 通过 | 0 | Renderer 生产编译，不安装、不部署 |
| `git diff --check` | 通过 | 0 | 改动无空白错误 |
| 凭据明文风险 SEC-01 | **已接受，非阻断；未加密** | 不适用 | 按用户明确决定不作为发布前置；技术事实保持不变 |

### 实际命令

```bash
npm test
npm run typecheck:electron
npx tsc --noEmit
node --test src/components/__tests__/StartupSequenceContent.test.mjs src/components/__tests__/LauncherOnboardingContent.test.mjs
npm run build:electron:package
npm run build:electron
npx vite build --outDir .tmp/onboarding-t13/renderer
npm run test:e2e -- tests/e2e/onboarding.spec.ts tests/e2e/onboarding-meeting.spec.ts tests/e2e/basic-smoke.spec.ts tests/e2e/meeting-start-overlay-reliability.spec.ts tests/e2e/meeting-audio-recovery.spec.ts
git diff --check
```

最终 Electron 50 项包含原 42 项和新增 T13 的 8 项；basic smoke 实际执行 8 项，没有因 CI 跳过。独立记录的截图共 53 张，尺寸核验全部通过。执行原始日志保留在本地 `.tmp/onboarding-t13/`，不作为真实服务或发行包运行证据。

完整 Node 命令仍使用项目既有 runner、测试收集和默认并发，没有排除失败文件、降低断言或添加 skip。生产编译后另外检查 `getElectronEntryPoints(..., 'package')` 不含 fixture，输出目录没有 `electron/test/onboardingFixtures.js`，main 中没有 fixture 独有的 `invalid_onboarding_scenario` 实现。fixture 的 packaged/E2E/显式开关三条件拒绝路径由既有 Node 测试覆盖；这仍不是发行包运行证据。

### 首轮失败及本轮修复

- 12 项停止/退出/启动行为测试的提取 harness 没有包含新接入的真实 `stopAudioTest`、`recordOnboardingMeetingEvent` 方法及相应运行环境。本轮补齐提取对象，继续执行原主进程方法，保留“停止只保存一次、失败保留、退出等待、禁止新会话抢占”等行为断言，没有将失败简单 stub 为成功。
- 其余旧断言依赖原方法签名、固定字符截断、旧变量名或旧 IPC 参数个数。已适配 atomic credential candidate、scope patch、归一化提交和新音频失败方法。RAG 检查改为读取完整 AST 方法；IPC contract 执行实际 handler 验证非法输入、patch 结果和广播。凭据格式用例现明确称为“现状诊断/已接受的非阻断风险”，没有宣称明文格式符合加密要求。
- 权限页的系统设置入口原本已有平台条件；本轮统一局部条件名为 `isMac`，使既有跨平台防护检查能识别原条件，Windows 仍不生成这些链接。
- 新增 T13 用例实际发现空 AI/语音密钥可能进入保存/验证，以及结束会议图标没有可访问名称。现已在提交前校验必填密钥/模型/程序路径，显示字段错误、关联 `aria-invalid`/说明并聚焦；空值不会保存或调用验证。结束按钮增加名称“结束会议”，原回调和结束流程不变。

## UI、键盘与边界覆盖

四种组合为 **1200×800 亮色、1200×800 暗色、600×400 亮色、600×400 暗色**；均执行 reduced-motion。P0/P1/P6 主动作、P2–P5 页脚边界、P4a 返回焦点、P7 提示边界，以及错误/下载/未保存状态都有实际断言。另有仅用 Tab/Enter 的配置导航→原会议入口→关闭提示→结束会议用例，必填错误字段聚焦及 Escape 保留未保存输入用例。

E2E 每次启动先验证离线 guard：userData/appData/home/documents/session/crash 路径及 cwd/HOME/TMPDIR 隔离；HTTP(S)、fetch、Electron net 和子进程的 14 个入口受到阻止，Renderer 只允许本地 Vite 服务；隔离迁移 marker 防止读取真实旧用户数据。这是应用测试路径隔离和网络断言，不是对任意文件系统调用的 OS 沙箱证明。

实际开始按钮仍调用原 `handleStartMeeting`，没有第二个会议引擎或独立试用功能；direct IPC 门禁、并发/active 会话、下载中跨页、busy、异步失败修复、两个提示独立关闭、真实两个 webContents 的旧广播拒绝、同 userData 真重启均有 E2E。非 synthetic 里程碑另有服务测试；connected 或 synthetic 转写没有被记为真实成功时间。原会议准备功能和旧用户入口继续回归。

### 截图索引

下列截图均为本轮隔离 fixture，保存在报告同目录资产中。自动化覆盖完整矩阵；人工查看了各页面代表布局和错误、下载、未保存状态。截图尺寸与摘要校验见同目录 `assets/2026-10-27-first-run-onboarding/manifest.json`。

| 页面 / 状态 | 1200 亮色 | 1200 暗色 | 600 亮色 | 600 暗色 |
|---|---|---|---|---|
| P0 欢迎 | [截图](assets/2026-10-27-first-run-onboarding/welcome-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/welcome-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/welcome-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/welcome-600-dark.png) |
| P1 设置概览 | [截图](assets/2026-10-27-first-run-onboarding/overview-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/overview-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/overview-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/overview-600-dark.png) |
| P2 权限与设备 | [截图](assets/2026-10-27-first-run-onboarding/permissions-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/permissions-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/permissions-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/permissions-600-dark.png) |
| P3 语音识别 | [截图](assets/2026-10-27-first-run-onboarding/speech-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/speech-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/speech-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/speech-600-dark.png) |
| P4 AI 服务 | [截图](assets/2026-10-27-first-run-onboarding/ai-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/ai-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/ai-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/ai-600-dark.png) |
| P4a 开通说明 | [截图](assets/2026-10-27-first-run-onboarding/provisioning-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/provisioning-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/provisioning-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/provisioning-600-dark.png) |
| P5 设置检查 | [截图](assets/2026-10-27-first-run-onboarding/ready-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/ready-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/ready-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/ready-600-dark.png) |
| P6 首页继续卡 | [截图](assets/2026-10-27-first-run-onboarding/resume-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/resume-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/resume-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/resume-600-dark.png) |
| P7 会议首次提示 | [截图](assets/2026-10-27-first-run-onboarding/first-meeting-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/first-meeting-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/first-meeting-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/first-meeting-600-dark.png) |
| 模型下载中 | [截图](assets/2026-10-27-first-run-onboarding/download-running-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/download-running-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/download-running-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/download-running-600-dark.png) |
| 保存失败 | [截图](assets/2026-10-27-first-run-onboarding/save-failed-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/save-failed-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/save-failed-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/save-failed-600-dark.png) |
| 未保存确认 | [截图](assets/2026-10-27-first-run-onboarding/unsaved-dialog-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/unsaved-dialog-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/unsaved-dialog-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/unsaved-dialog-600-dark.png) |
| 权限被拒绝 | [截图](assets/2026-10-27-first-run-onboarding/permission-denied-1200-light.png) | [截图](assets/2026-10-27-first-run-onboarding/permission-denied-1200-dark.png) | [截图](assets/2026-10-27-first-run-onboarding/permission-denied-600-light.png) | [截图](assets/2026-10-27-first-run-onboarding/permission-denied-600-dark.png) |

补充：[空 AI 密钥的字段焦点](assets/2026-10-27-first-run-onboarding/ai-required-key.png)。表单中只使用测试字符串，图片没有真实密钥。小窗口内容可以滚动；页面操作可达不代表所有长内容需要同时铺在一屏。开发态交互和 CSS/no-drag 检查不能代替发行态原生拖拽区点击验证。

## 已接受风险 SEC-01：凭据明文存储（非阻断）

**状态：实际仍为明文；用户已接受此项风险，不作为发布阻断。** 2026-10-27 的后续决定覆盖此前阻断处置，本轮不实施加密迁移。

`electron/services/CredentialsManager.ts` 的 `saveCredentials(candidate)` 当前调用 `JSON.stringify(candidate)` 并用 UTF-8 写入 `credentials.enc.tmp`，再 rename 为 `credentials.enc`；`loadCredentials()` 直接读取 UTF-8 并 `JSON.parse`。文件名 `.enc`、文件权限 0600 和原子 rename 均不构成加密。类注释、项目说明或此前“安全存储”的表述不能当作实现证据。

本次没有读取实际凭据文件来证明该问题，证据来自保存/加载代码和隔离测试。原格式诊断测试通过仅说明现状被确认，不表示安全验收通过。T03 交付的原子写入、版本失效和回执行为也不能推导出已完成 safeStorage 加密。

未来若安排凭据加密，应单独考虑 Electron safeStorage/平台支持边界、不可用时的明确失败策略、旧明文迁移与回滚/恢复、日志脱敏、明文残留及跨平台验证。按当前风险接受决定，这些不作为本轮发布前置条件；本轮没有实施迁移或触碰现有真实凭据。

## 未执行的真实服务、真机与发行验收

| 项目 | 状态 | 本轮限制与仍需提供的证据 |
|---|---|---|
| 当前源码 macOS arm64 发行包 | 未执行 | 只有旧 2.7.0 包；本轮仅编译 main/renderer，没有构建、签名、安装当前源码的 .app/.dmg |
| macOS 原生权限拒绝→系统设置→回焦→授权后重启 | 未执行 | 开发态 fake 权限不能证明发行态 TCC；未改系统权限记录或运行真实重置 |
| 系统音频受限→真实会议授权/捕获 | 未执行 | E2E 显式跳过原生音频，无可控真实会议音源证据；没有录制环境声音 |
| macOS x64 本地模型加载/采集 | 未执行 | 当前为 arm64 主机，未提供独立 x64 验收环境；存在二进制文件不等于验证通过 |
| Windows x64 设备/默认回退/系统音频 | 未执行 | 当前没有 Windows 验收主机；非 macOS fixture 不替代 Windows 原生行为 |
| SenseVoice/Whisper 真实模型加载（各受支持架构） | 未执行 | 本轮使用 fake worker/模型状态；未读取用户真实模型缓存或下载模型，仍需真实文件与运行时证据 |
| 豆包真实所选模型响应 | 未执行 | 未启用本轮专用服务账号/费用请求，没有借用开发者真实凭据；未运行真实服务 smoke 脚本 |
| Codex 支持版本的隔离推理认证 | 未执行 | 支持认证集合仍为空，只验证了 unsupported_check 出口；未以程序存在/版本检测作为推理成功 |
| 真实 STT→首段转写→用户发起回答→结束保存 | 未执行 | 没有真实受控会话与授权音源；synthetic 只证明瞬时 UI，不是转写/回答质量证据 |
| 发行包重启回执、升级、配置失效和音频失败恢复 | 未执行 | 开发态已自动化；当前源码发行包尚未安装，须在发行态重复验证 |
| 发行态原生拖拽区/按钮 hit-test | 未执行 | 本轮证明 Electron 页面键鼠与 no-drag 结构，不能替代当前签名包的实际 OS 窗口交互 |

这些项目保持未验收，没有写成通过，也没有据此把 T13 全部勾选。结论维持：**功能实现完成，发行验收未完成；SEC-01 已接受且不作为阻断，其他未验收项仍独立保留。**

## 2.7.18 远程发布执行记录

2026-10-27 用户明确要求远程构建并发布新版本，授权范围为本轮初始设置实现及其回归修复。版本按仓库现有三段版本规则递增至 2.7.18。此前“发行验收未完成”描述保留为 T13 的验收事实，不再用作要求重复确认发布的审批门槛；未执行的人工验收不会改写为通过。SEC-01 继续保持已接受、非阻断。

发布候选只包含初始设置相关源码、测试、方案、验收证据和版本记录；其他已有研究、路线图文档及临时文件不纳入本次提交。远程分别执行 Apple Silicon、Intel Mac、Windows x64 工作流，核对同一提交的构建结果与发布附件后再公开 Release。实际构建链接、结果及发布地址以本节后续记录为准。

发布前复验：`npm test` 3,382/3,382 通过（181 suites，0 fail/skip）；指定五份 Electron E2E 50/50 通过（2.5 分钟）；`npm run typecheck:electron`、`npx tsc --noEmit` 通过；欢迎页内容检查 4/4 通过。截图回归重新生成后的 53 张图片尺寸已核对，清单字节数与 SHA-256 已同步。日志在本地 `.tmp/onboarding-t13/release-*.log`，不随源码提交。

三平台远程构建已通过并正式发布 2.7.18，发布标签指向 `85a6ca091e0cce4b59d3dc79c24a47e6198e3ab0`。14 个附件齐全，GitHub Latest 已指向该正式版本。详细构建、附件、签名范围及风险记录见[2.7.18 发布记录](../testing/2.7.18-build-release.md)。这补充了当前发行包的自动化检查；上文未执行的人工验收项目仍保持未验收。


## DEVICE-01 修复复验补充

本机发现的欢迎页不退场已在源码修复：将后续懒加载主界面限制在内部 Suspense，避免中断外层欢迎退出动画。新增真实 production 分块冷启动回归，原代码 2/2 失败，修复后 2/2 通过；原相关 Electron 套件最终 50/50、内容 9/9、类型检查及生产构建通过。本地重新打包 ARM64 候选包的真实坐标点击也通过欢迎→概览→权限→首页。首轮启动超时及复跑过程见[本机报告修复章节](2026-10-27-first-run-onboarding-device-acceptance.md#device-01-根因修复与回归复验)。

本次修复尚未发布，原下载的公开 2.7.18 失败记录不改写；完整首次会议等未执行项与 SEC-01 已接受风险状态不变。


发布后续：P1 已于 2026-10-28 随 [2.7.19](../testing/2.7.19-build-release.md) 正式发布，三平台构建和 14 个附件核对完成，Latest 已更新。此前“尚未发布”仅指本地修复阶段；完整首次会议等独立缺口保持未验收。
