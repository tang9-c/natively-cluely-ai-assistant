## CueUp 2.7.20：修复 QCLOUD API、系统音频权限与首次设置样式

- 首次设置正确显示 QCLOUD API，使用专用密钥和模型进行验证，并提供 QCLOUD API 平台的独立开通指引。
- 系统音频由原生采集后端检查授权，不再因屏幕枚举失败而跳过会议采音、设备切换或恢复。CoreAudio 静音不再被屏幕权限检查误判为拒绝；真实原生错误和截图权限检查保留。
- 权限页区分未确定和明确拒绝，刷新设备与权限会显示读取中、成功和失败结果。
- 初始设置采用统一状态色，跟随应用亮暗主题；区分信息、成功、警告、错误及历史验证回执。

## 验证

- 新增系统音频权限与生命周期专项，三个平台打包前运行相关回归；PR / push 运行隔离 production UI 检查。
- 本轮修复已通过 120 项系统音频保护、90 项 QCLOUD 相关单元、8 项内容与表单检查、51 项开发态 Electron 和最终 14 项 production 场景，以及两套类型检查和生产构建。最终 2.7.20 候选与远程包结果另记于仓库 `docs/testing/2.7.20-build-release.md`。
- 状态色覆盖应用与系统亮暗四种组合、同页切换、按钮各状态与窄窗口；新状态文字在三种标准不透明表面上的对比度至少 4.5:1。
- 原始验收中的窗口启动超时、production 测试适配器缺口及复跑保留在验收文档，不声称所有检查首轮均成功。

## 已知限制

- 凭据仍以明文 JSON 保存，SEC-01 已由用户接受为非阻断风险。本次未实施加密或旧文件迁移。
- 真实 QCLOUD 账号 / 模型调用、完整首次会议、新设备 TCC 和实际系统音频转写等人工验收尚未完成。隔离 UI 和固定 WAV 运行时 smoke 不替代这些项目。
- macOS 包使用 ad-hoc 签名，未配置 Developer ID 或 Apple 公证；参见附件 `INSTALL-UNSIGNED-MACOS.txt`。Windows 包未配置 Authenticode 证书，SmartScreen 可能提示无法识别发布者。

## 下载选择

- Apple Silicon Mac：文件名含 `arm64` 的 DMG 或 ZIP。
- Intel Mac：文件名不含 `arm64` 的 macOS DMG 或 ZIP。
- Windows x64：`CueUp-Setup-2.7.20.exe`；便携版为 `CueUp.2.7.20.exe`。
