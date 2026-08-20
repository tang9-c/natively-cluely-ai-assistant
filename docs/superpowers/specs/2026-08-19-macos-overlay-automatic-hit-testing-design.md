# macOS Overlay 自动命中与鼠标穿透设计

## 背景

提交 `260ad5aa` 为 Windows Overlay 增加了自动命中检测：透明区域穿透到桌面，CueUp 可见控件恢复交互。但实现通过多处 `win32` 判断主动排除了 macOS。

会议进行中，Renderer 折叠 Overlay 后会请求 `hide-window`，主进程为保留会议 Overlay 而忽略该请求。因此原生 Overlay 窗口仍存在。Windows 依靠自动穿透避免透明窗口拦截桌面鼠标；macOS 没有运行同一策略，透明 NSPanel 区域会继续拦截点击和右键。

## 目标

- Windows 与 macOS 使用相同的自动命中语义。
- Overlay 透明区域允许鼠标事件到达下层应用。
- 标记为 `data-overlay-interactive` 的 CueUp 可见区域保持可点击、可拖动和可输入。
- 折叠开始时立即进入透明区域穿透状态，不等待 400ms 动画或被主进程忽略的隐藏请求。
- macOS Overlay 始终保持 `focusable=true`，避免破坏全局快捷键和输入框聚焦。

## 非目标

- 不修改用户“鼠标穿透”开关的含义。
- 不修改 Overlay 的 NSPanel、stealth、置顶、窗口层级或显示/隐藏策略。
- 不修改 `hide-window` 在会议进行中的保护逻辑。
- 不扩展到 Linux。
- 不增加轮询、重试、额外窗口或新设置项。

## 方案

### 1. 统一支持平台判断

新增一个共享平台判断，例如 `supportsOverlayAutomaticHitTesting(platform)`，仅对 `win32` 和 `darwin` 返回 `true`。

`resolveOverlayMouseInteractionPolicy()` 使用该判断：

- 手动鼠标穿透开启时，无条件 `ignoreMouseEvents=true`。
- 手动穿透关闭且平台支持自动命中时：
  - `automaticInteractive=false`：透明区域穿透。
  - `automaticInteractive=true`：恢复 Overlay 交互。
- Linux 保持当前整窗交互行为。

手动设置始终拥有最高优先级。

### 2. Main 进程窗口策略

`WindowHelper` 在 Windows 和 macOS 上：

- 初始 `overlayAutomaticInteractive=false`。
- 创建 Overlay 后立即同步穿透策略。
- 隐藏、折叠、切换窗口或重新显示前重置自动交互状态。
- 接受 Renderer 上报的自动交互状态并幂等应用。

应用穿透时调用 `setIgnoreMouseEvents(true, { forward: true })`，使透明区域事件传递给下层应用，同时允许 Renderer 继续收到用于重新命中的鼠标移动。

恢复交互时调用 `setIgnoreMouseEvents(false)`，并继续调用 `setFocusable(true)`。任何路径都不得在 macOS 上调用 `setFocusable(false)`。

### 3. Renderer 自动命中

`NativelyInterface` 在 Windows 和 macOS Overlay 中运行现有命中检测：

- `mousemove` 使用 `document.elementFromPoint()` 检查当前位置。
- 目标位于 `[data-overlay-interactive]` 内时上报 `true`。
- 透明区域上报 `false`。
- 在交互区域按下鼠标后保持 pointer lock，直到 `mouseup` 或窗口 `blur`，防止拖动过程中突然穿透。
- 上报结果去重，避免重复 IPC。
- effect 清理时上报 `false` 并移除监听器。

折叠时不再只判断 Windows；Windows 和 macOS 都先上报 `false`，再保留现有退出动画及 `hideWindow()` 调用。

### 4. 数据流

```text
鼠标移动
  → Renderer elementFromPoint
  → 是否命中 data-overlay-interactive
  → set-overlay-automatic-interactive IPC
  → WindowHelper.setOverlayAutomaticInteractive
  → resolveOverlayMouseInteractionPolicy
  → BrowserWindow.setIgnoreMouseEvents
```

该链路不携带用户内容，只传递布尔值。

## 边界与故障处理

- IPC 上报失败时保持当前窗口策略，不重试、不记录鼠标位置。
- 重复布尔状态不上报，也不重复调用原生窗口 API。
- 手动鼠标穿透开启时，即使 Renderer 上报可交互，Overlay 仍保持整窗穿透。
- macOS 自动穿透期间保持 `focusable=true`；快捷键行为不依赖窗口可聚焦状态切换。
- 若 Renderer 尚未加载，Main 初始状态即为透明区域穿透，避免启动瞬间形成不可见点击遮罩。

## 测试设计

### 共享策略

- `darwin + manual=false + automatic=false` 返回穿透。
- `darwin + manual=false + automatic=true` 返回可交互。
- `darwin + manual=true + automatic=true` 仍返回穿透。
- Linux 行为不变。

### Main 进程合同

- 自动命中支持平台包含 `win32` 和 `darwin`。
- macOS 初始化和重置状态为非交互。
- macOS 自动状态 setter 不再被非 Windows guard 拒绝。
- 恢复交互时保持 `setFocusable(true)`，源码中不引入 `setFocusable(false)`。
- Overlay 显示前和切换到 Launcher 前重置自动状态。

### Renderer 合同

- 自动命中 effect 在 Windows 和 macOS 启用，Linux 跳过。
- 折叠时 Windows 和 macOS 都先上报 `false`。
- 透明目标上报不可交互，可见控件上报可交互。
- `mousedown`、`mouseup`、`blur` 和 effect cleanup 正确管理 pointer lock。

### 回归验证

- Overlay 鼠标策略专项测试。
- IPC 合同测试。
- Electron 类型检查和生产构建。
- 完整 `npm test`。
- macOS 手工验证：透明区域可点击/右击下层应用，CueUp 按钮和输入框仍可操作，全局快捷键仍可切换 Overlay。

## 验收标准

- macOS 会议 Overlay 折叠后不再阻塞对应桌面区域的点击和右键。
- 展开状态下，Overlay 透明边缘不阻塞下层应用。
- CueUp 可见按钮、输入框、拖动区域在 macOS 上可正常交互。
- 手动“鼠标穿透”开启时保持整窗穿透。
- 全局快捷键不因自动穿透失效。
- Windows 现有行为无回归，Linux 行为不变。
