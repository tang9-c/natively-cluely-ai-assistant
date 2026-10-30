## CueUp 2.7.22：修复首次设置系统音频权限误判

- 首次设置不再把屏幕录制权限结果当作系统音频受限或已授权的证据；显示待会议开始时由实际采集后端确认。
- 刷新后清除旧的系统音频限制确认；保留权限读取失败、设备缺失和实际音频采集失败的处理。
- 保留截图功能自身的权限检查，以及麦克风授权、音频启动与恢复流程。

## 验证

- 补充五种屏幕权限状态、旧限制确认清理、亮暗主题和刷新后继续流程的回归。候选测试与三平台构建核对见仓库 `docs/testing/2.7.22-build-release.md`。
- 隔离 UI / 固定 WAV smoke 不代表真实 macOS TCC 或有声会议验收通过。

## 已知限制

- 新发行包真实权限、有声会议和人工安装验收尚未执行。
- macOS 仍使用 ad-hoc 签名，未增加 Developer ID 或 Apple 公证；Windows 未配置 Authenticode。跨版本授权连续性仍未验收。macOS 安装说明见附件 `INSTALL-UNSIGNED-MACOS.txt`。
- 凭据仍为明文 JSON，SEC-01 为用户已接受的非阻断风险。

## 下载选择

- Apple Silicon Mac：含 `arm64` 的 DMG 或 ZIP。
- Intel Mac：不含 `arm64` 的 macOS DMG 或 ZIP。
- Windows x64：`CueUp-Setup-2.7.22.exe`；便携版 `CueUp.2.7.22.exe`。
