## CueUp 2.7.26：LLM 应用标识与会中身份菜单修复

- 应用管理的 LLM HTTP 请求统一发送 `User-Agent: CueUp/<当前应用版本>`，覆盖 QCLOUD 普通请求、SSE 流式请求、原生工具调用和连接测试，并统一其他内置 SDK、自定义 cURL、Embedding 与云端模型查询的标识。保留鉴权、取消信号和范围策略。
- 修复动态动作卡片及实时转录中的身份选项菜单点击穿透。菜单接收点击，透明区域继续保持原有穿透行为。
- 修复“恢复自动判断”后会中界面仍显示旧人工身份标签的问题。

## 验证

- 本地 HTTP 收包回归覆盖 QCLOUD 三条调用路径、SDK 重建与自定义请求头；隔离 Electron 回归直接覆盖动态动作卡片的身份修改、恢复和原生鼠标策略。
- 候选测试、远程三平台构建、包内运行时与附件核对结果见仓库 `docs/testing/2.7.26-build-release.md`。

## 已知限制

- 外部 Codex CLI 自行管理请求头；不承诺网关转发上游时保留此标识。STT 和模型文件下载不在 LLM User-Agent 统一范围内。
- 本次正式包人工安装、真实服务与网关、有声会议、硬件鼠标操作、跨版本 TCC 授权连续性及长期稳定性需要另行验收。离线夹具和包内 smoke 不代替真机验收。
- macOS 为 ad-hoc 签名，无 Developer ID 或 Apple 公证；Windows 无 Authenticode。macOS 安装说明见附件 `INSTALL-UNSIGNED-MACOS.txt`。
- 凭据仍为明文 JSON，SEC-01 为用户接受的非阻断风险。

## 下载选择

- Apple Silicon Mac：含 `arm64` 的 DMG 或 ZIP。
- Intel Mac：不含 `arm64` 的 macOS DMG 或 ZIP。
- Windows x64：`CueUp-Setup-2.7.26.exe`；便携版 `CueUp.2.7.26.exe`。
