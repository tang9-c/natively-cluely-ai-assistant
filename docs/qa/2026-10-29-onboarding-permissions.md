# 初始设置系统音频权限提示与刷新反馈修复

日期：2026-10-29。状态：源码修复，尚未发布。

## 反馈与核查边界

用户反馈 macOS 已授权，页面仍显示橙色系统音频限制提示，点击“刷新设备与权限”没有反应；随后确认“屏幕与系统音频录制”和“仅系统音频录制”两项都已开启。

代码与回归已确认以下缺陷，不能据此断言用户 Mac 当前 TCC 返回值、权限缓存或签名身份就是根因。未读取该安装实例的权限返回值，未重置系统权限，未把隔离测试当作发行包真机验收。

## 根因与修复

1. `OnboardingReadiness.ts` 原来把 macOS 所有非 `granted` 的屏幕状态都转成 `permission_denied`，包括 `unknown`、`not-determined`，也没有使用已有的 `systemAudioHealth.effectiveGranted` 正向证据。[Electron 官方状态定义](https://www.electronjs.org/docs/latest/api/system-preferences#systempreferencesgetmediaaccessstatusmediatype-macos-windows)区分这些值。修复后仅明确的 `denied` / `restricted` 且没有有效授权证据时保留限制；未确定状态为 `pending_runtime` / `unavailable`，已授权为 `pending_runtime` / `system`。开发态静态许可不升级为系统证据，缺失输出设备仍为失败。
2. `PermissionsStep.tsx` 原提示没有把“应用读取的屏幕状态”与“用户系统设置 / 实际系统音频捕获”区分。页面改为明确展示已授权、当前读到未开启、尚未确认、输出设备不可用。读取值与系统设置不一致时提示退出重开后刷新，保留开会时的实际捕获检查。不会因设置页读到授权就宣称采音已成功，也不通过隐藏错误或强制写入 granted 绕过检查。
3. 刷新按钮原来没有忙碌与完成反馈，也未处理 `refresh()` 返回的结构化失败，成功重试仍可能保留旧读取错误。现在提供“正在刷新…”、按钮禁用、可访问状态提示、成功 / 失败反馈；读取错误单独管理，重试清除；过期读取和离页回调不覆盖最新局部状态。授权恢复后仍由现有服务撤销过时的限制确认。

未改变系统音频后端选择、会议启动保护、TCC 修复确认、任何真实系统权限或凭据存储。

## 回归证据

- 修复前：新增三项权限判定测试失败；新增两项界面测试失败，分别覆盖授权恢复显示与刷新反馈。
- 修复后：权限 / IPC / 策略 / 持久化 / macOS 首次授权和 TCC 修复单元 **77/77**，表单契约 **4/4**；开发态引导联合回归 **42/42**；Renderer / Electron 类型检查、生产构建、`git diff --check` 通过。
- 生产资源首轮 **5/8 通过、3/8 失败**：三项权限用例都在 `electronApplication.firstWindow` 超时，未执行到页面断言。核查发现 package 构建清理了 `dist-electron/electron/test`，而这三项启用了需要动态加载的 onboarding fixture；其余不依赖 fixture 的五项正常。
- 测试命令改为 `npm run build && npm run build:electron` 后启动 production renderer，编译主进程并保留隔离测试适配器；不改变 `build:electron:package` 或正式发行包排除测试文件的规则。完整重跑 **8/8 通过**。该结果验证生产 Vite 分块、`file://` 和无 Vite server 的启动，不代表安装包或原生权限验收。首轮失败日志完整保留。
- 新增 `tests/e2e/onboarding-permissions.spec.ts`，覆盖授权恢复后移除限制确认、保持实际捕获待确认；刷新中禁用、失败显示、成功重试清除错误；主进程结构化失败不显示刷新成功。该文件同时加入 production 资源套件。
- 单元测试补充未确定权限、正向 health、明确拒绝 / 限制、开发态静态许可、输出设备缺失；复验 IPC、进度持久化、门禁和既有 macOS 首次授权 / TCC 修复边界。

原始日志保存在本地 `.tmp/onboarding-permissions/`，不提交。图片来自隔离 Electron 测试，使用可控权限状态，不代表实际系统权限已验证。

## 界面证据

- [生产资源界面：授权恢复后的中性状态与刷新完成反馈](assets/2026-10-29-onboarding-permissions/permissions-restored.png)
- [生产资源界面：应用读到拒绝时的明确说明](assets/2026-10-29-onboarding-permissions/permissions-app-denied.png)
- [600×400 浅色受限态](assets/2026-10-29-onboarding-permissions/permission-denied-600-light.png)、[暗色受限态](assets/2026-10-29-onboarding-permissions/permission-denied-600-dark.png)，另存 1200×800 两主题。
- [图片尺寸、来源与 SHA-256 清单](assets/2026-10-29-onboarding-permissions/manifest.json)

图中拒绝状态由测试 fixture 同时拒绝麦克风和屏幕权限产生，截图中的麦克风提醒不代表用户真实麦克风状态。旧日期的历史验收图片已恢复，新增证据单独保存。

## 未执行

未安装包含本修复的新发行包；用户报告的“系统两项都已开启”场景尚未在其真实安装实例上重新读取并对照确认。实际系统音频捕获、有声转写、真实 TCC 状态变化、签名身份差异及三个平台安装包回归未执行。SEC-01 仍为已接受的非阻断风险。


## 后续会议链路核查

用户随后反馈实际启动会议仍误报权限不可用，进一步发现会议启动 / 切换 / 恢复和 CoreAudio 静音检测另有屏幕探针依赖。本记录的设置页修复未覆盖这些路径；后续已单独修复，见[会议链路根因与验证](2026-10-29-meeting-system-audio-permission.md)。两次源码修复均未发布，不能将先前页面测试当作系统音频实际可用的证明。
