## CueUp 2.7.19：修复首次设置欢迎页不退出

点击“开始设置”后，欢迎层现在会正常退出并显示设置概览，无需重启应用。修复将主界面懒加载与欢迎动画分开处理，保留原有动画及减少动态效果设置。

## 验证

- 新增真实 production 分块冷启动回归，覆盖默认和减少动态效果；要求欢迎层真正移除、按钮中心命中及后续正常点击，而不只检查后方标题是否出现。
- P1 最终验证：2 项 production 场景、50 项相关 Electron 场景、9 项内容测试和两套 TypeScript 检查通过。本地重新打包的 Apple Silicon 候选包已通过原生坐标点击。
- 原回归首轮有 1 项实例启动超时，单项及完整复跑通过；具体过程保留在验收文档中。

## 已知限制

- 凭据仍以明文 JSON 保存，SEC-01 已由用户接受为非阻断风险。本次未实施加密或旧文件迁移。
- 真实 AI 账号、完整首次会议、新设备系统授权及实际音频转写等人工验收仍未完成。远程构建和运行时 smoke 不代替这些项目。
- macOS 包使用 ad-hoc 签名，未配置 Developer ID 或 Apple 公证；参见附件 `INSTALL-UNSIGNED-MACOS.txt`。Windows 包未配置 Authenticode 证书，SmartScreen 可能提示无法识别发布者。

## 下载选择

- Apple Silicon Mac：文件名含 `arm64` 的 DMG 或 ZIP。
- Intel Mac：文件名不含 `arm64` 的 macOS DMG 或 ZIP。
- Windows x64：`CueUp-Setup-2.7.19.exe`；便携版为 `CueUp.2.7.19.exe`。
