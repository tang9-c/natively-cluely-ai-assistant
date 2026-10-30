# 会议启动误报屏幕与系统录音权限不可用

日期：2026-10-29。状态：源码已修复，已于 2026-10-30 随 2.7.20 发布；真实安装包交互复验仍未执行。

## 用户反馈与范围

用户确认 macOS“屏幕与系统音频录制”和“仅系统音频录制”两项都已开启，启动会议后仍出现“屏幕与系统录音权限不可用 / 尚未获得屏幕与系统录音权限”。这是会议启动与采集链路，上一轮权限设置页的判定和刷新反馈修复未覆盖此路径。

本次已复现代码层面的误判与误拦截。未读取用户实际安装实例的 OS 返回值，不能据此认定该实例有 TCC 缓存损坏、签名不匹配或真正的授权拒绝。

## 根因

`electron/main.ts` 的 `startMeetingInternal` 先调用 `resolveMacScreenCaptureCapability`，失败立即发出上述提示；`setupSystemAudioPipeline`、`reconfigureAudio` 和 `recoverAudioCapture` 使用同一结果跳过系统音频创建或恢复。该能力读取的是屏幕状态并调用 `desktopCapturer.getSources({ types: ['screen'] })`，空源列表 / 枚举错误可导致 `effectiveDenied`。

但 `native-module/src/speaker/macos.rs` 默认优先 CoreAudio Tap，初始化失败才回退 ScreenCaptureKit，显式 `sck` 选择仍走 SCK。屏幕枚举结果不能证明 CoreAudio Tap 不可用。[Apple 的 Core Audio Tap 文档](https://developer.apple.com/documentation/CoreAudio/capturing-system-audio-with-core-audio-taps)说明 Tap 通过 `NSAudioCaptureUsageDescription` 描述用途，首次从含 Tap 的聚合设备录音时请求系统音频授权。

另有两处同源误报：启动后 800ms 仅凭 raw screen denied 就发送系统音频不可用；CoreAudio 已运行时的零填充检测也会调用屏幕探针，并把失败转换成 `Screen recording permission denied`，进而让通道终止。这些判断都没有实际系统音频拒绝证据。

## 修复

- 从会议预检、音频管线创建、设备切换和故障恢复中移除屏幕枚举门禁，交由所选原生后端在实际 `start()` 时检查授权。保留原生 CoreAudio→SCK 的既有选择、回退与用户设备偏好。
- 移除冷启动时基于 screen denied 的系统音频广播。不会启动即采音或自动打开系统设置。
- CoreAudio / WASAPI 等非 SCK 后端的零填充保持诊断，不使用屏幕权限推断音频拒绝；SCK 的原有屏幕诊断保留。
- 保留麦克风必要授权、截图授权检查、实际原生权限错误的终止失败反馈、重试预算、epoch 取消与异步资源释放；不写入假 granted、不重置 TCC、不自动重启应用。

涉及文件：`electron/main.ts`；新增 `electron/services/__tests__/MeetingSystemAudioPermission.test.mjs`；更新 CoreAudio 零填充、macOS 冷启动与音频取消竞态的对应回归。

## 验证

- RED：新增四项测试分别复现创建被跳过、切换不创建所选路由、恢复不触发 native start、会议启动在 native 尝试前误发权限提示。
- 执行实际 `AppState` 方法，以可控的发行态屏幕探针失败替代 OS / native 边界；未用开发态自动 granted 绕过失败。新增两项实际 health monitor 联合测试确认原生拒绝仍终止且不重试、有效音频回调仍标记 healthy 并清除通道错误。
- 相关单元最终 **81/81 通过**，涵盖采集健康/取消/释放、原生不可用、macOS 首次授权、TCC 修复安全、截图权限与 Windows 文案。首轮暴露两项旧测试对已移除屏幕预检的依赖，以及新测试替身未实现 destroy 的异步清理错误；更新取消测试为等待真实 native destroy，补齐替身释放后通过，未放宽产品取消条件。
- 开发态会议与权限界面回归 **9/9 通过**；这些 Electron 场景禁用真实采音，只作为流程回归。
- 生产资源 Electron 套件 **8/8 通过**（production Vite 分块、file://、无 Vite server；包含测试适配器，不是重新安装发行包）。Renderer / Electron 类型检查、生产构建和 `git diff --check` 通过。

原始日志保存在本地 `.tmp/meeting-audio-permissions/`，不提交。保留先前 QCLOUD 与设置页修复，不修改用户其他工作文件。此次没有 renderer 改动，未重复提交历史截图。

## 源码核查时未执行

未重新构建或安装发行包，未在用户已授权的真实安装实例验证 CoreAudio / SCK 实际采音、有声转写、重启、设备切换与恢复。没有将 mock 成功写成真实音频验收通过。本次也没有调整 SEC-01 已接受的非阻断风险。


## 后续回归保护

2026-10-29 按用户要求补齐专用测试命令和 CI / 发行打包前检查，扩充三类屏幕探针失败场景；单元 120/120、production UI 9/9，隔离副本恢复两类旧逻辑均被测试检出。尚未推送或执行远程检查，分支保护未修改；见[回归约定与行为清单](../testing/system-audio-permissions.md)。


## 2.7.20 发布追记

2026-10-30，[CueUp 2.7.20](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.20-sha-57d25a1) 已公开，三平台构建与 14 个附件核对通过，详见[发布记录](../testing/2.7.20-build-release.md)。本记录中的隔离证据与未执行真机项保留原边界，正式发布不代表这些人工项目已完成。
