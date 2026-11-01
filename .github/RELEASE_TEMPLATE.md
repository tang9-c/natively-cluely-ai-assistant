## CueUp 2.7.23：QCLOUD 测试修复与软件内帮助更新

- 软件内“设置与帮助”同步五步初始设置、QCLOUD 共享密钥、权限与设备、语言和模型配置、全局数据范围、存储和更新说明。
- 区分截图与系统音频权限、保存与验证、示意动画与实际状态；快捷键说明读取当前配置，帮助入口提供 QCLOUD API 平台链接。
- QCLOUD 回归改为检查实际名称映射与设置下拉框显示、选择和保存行为；补充亮暗主题帮助页回归。

## 验证

- 发布准备前相关单元测试 125/125、生产构建界面回归 33/33 通过。最终候选、三平台构建和附件结果见仓库 `docs/testing/2.7.23-build-release.md`。
- 隔离界面与固定 WAV smoke 不代表真实账号、macOS TCC 或有声会议验收通过。

## 已知限制

- 新发行包真实权限、有声会议、设备热插拔和人工安装验收尚未执行。
- macOS 仍使用 ad-hoc 签名，未增加 Developer ID 或 Apple 公证；Windows 未配置 Authenticode。跨版本授权连续性未验收。macOS 安装说明见附件 `INSTALL-UNSIGNED-MACOS.txt`。
- 凭据仍为明文 JSON，SEC-01 为用户已接受的非阻断风险。

## 下载选择

- Apple Silicon Mac：含 `arm64` 的 DMG 或 ZIP。
- Intel Mac：不含 `arm64` 的 macOS DMG 或 ZIP。
- Windows x64：`CueUp-Setup-2.7.23.exe`；便携版 `CueUp.2.7.23.exe`。
