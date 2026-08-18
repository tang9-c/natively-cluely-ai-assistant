# Windows Overlay 自动区域穿透设计

## 背景与目标

Windows 安装版在会议期间会把透明、置顶且可聚焦的 Overlay 扩展到接近屏幕高度。即使部分区域视觉透明，原生 `BrowserWindow` 仍会接收鼠标事件，导致下方应用的左键、右键看起来失灵。

目标是在不增加用户配置和提示的前提下，让 Overlay 的透明空白区域自动穿透，同时保持 CueUp 可见控件可点击。现有“鼠标穿透”开关和 `Ctrl+Shift+B` 继续作为强制全窗口穿透能力。

## 方案选择

采用 Windows 专用的自动命中策略：Renderer 判断鼠标是否位于 CueUp 的可交互可见区域，并且只在命中状态变化时通知主进程。主进程统一决定是否调用 `setIgnoreMouseEvents()`。

不采用以下方案：

- 默认强制全窗口穿透：会让 CueUp 自身按钮和输入框无法直接操作。
- 仅缩小原生窗口：长回答和多卡片仍会使窗口接近全屏，不能根治透明区域拦截。
- 要求用户手动管理开关：需要用户理解内部窗口机制，且容易忘记切换。

## 状态与优先级

主进程区分两个状态：

1. `manualPassthrough`：现有用户开关。开启时整个 Overlay 始终穿透，优先级最高。
2. `automaticInteractive`：Renderer 报告鼠标当前是否位于可交互区域，仅 Windows 使用。

最终策略：

- 非 Windows：保持现有行为。
- Windows 且手动穿透开启：`setIgnoreMouseEvents(true, { forward: true })`。
- Windows 且手动穿透关闭、鼠标位于交互区域：`setIgnoreMouseEvents(false)`。
- Windows 且手动穿透关闭、鼠标位于透明区域或离开窗口：`setIgnoreMouseEvents(true, { forward: true })`。

会议开始、Renderer 尚未报告命中状态时，Windows 默认采用自动穿透，避免透明大窗口阻塞桌面。Renderer 加载完成后根据实际命中恢复局部交互。

## Renderer 命中规则

Overlay 根节点保持透明。可交互区域由一个稳定的 DOM 标记声明，例如 `data-overlay-interactive`，标在可见的 TopPill、主面板以及需要浮出面板边界的菜单上。

Renderer 在 `pointermove` 中使用 `document.elementFromPoint()` 和 `closest()` 判断命中，另外在 `pointerleave`、窗口失焦和组件卸载时报告非交互。IPC 只在布尔值发生变化时发送，避免鼠标移动产生高频主进程调用。

输入框聚焦、拖动窗口、按下鼠标或菜单展开期间保持交互锁，直到对应操作结束，避免操作中途切换为穿透。

## IPC 与日志

新增内部 IPC，用于报告 Overlay 自动命中状态。它只接收布尔值，不接收坐标、文本或 DOM 内容。

日志只在状态变化时记录平台、手动/自动模式和最终穿透结果，不记录鼠标位置或用户内容。Overlay 状态日志增加最终 `ignoreMouseEvents` 语义，便于验证 Windows 用户反馈。

## 兼容性与边界

- 本轮只改变 Windows Overlay；Launcher、Settings、Cropper、macOS 和 Linux 行为不变。
- 手动全穿透开启后，Renderer 的自动命中报告不得关闭穿透。
- Overlay 隐藏、销毁或 Renderer 尚未就绪时不得抛错。
- 主进程必须对重复状态幂等，避免反复调用原生窗口 API。
- 不修改数据库结构，不新增依赖，不改变窗口视觉样式和尺寸算法。

## 验证

- 单元/合同测试覆盖状态优先级、Windows 平台限制、重复状态幂等以及 IPC 合同。
- Renderer 测试覆盖透明区、交互区、离开窗口和交互锁。
- 验证手动全穿透始终覆盖自动命中。
- 运行 Electron 类型检查、相关专项测试、构建和 `git diff --check`。
- Windows 安装版验收：Overlay 扩展到最大高度后，透明区域下方应用的左键和右键可用；CueUp 的按钮、输入框、菜单及拖动仍可用。
