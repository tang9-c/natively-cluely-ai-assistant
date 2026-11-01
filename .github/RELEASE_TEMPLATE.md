## CueUp 2.7.24：macOS 启动阻塞与窗口激活修复

- 原生模块加载不再通过枚举麦克风设备验证 ABI，避免首次窗口出现前等待音频授权。
- 调试日志移至应用日志目录，减少启动对“文稿”目录授权的依赖；打开日志与质量报告使用同一路径。
- 非会议状态显式激活应用时恢复主窗口显示与焦点，保留会议覆盖层的被动展示行为。

## 验证

- 补充启动安全、真实 Electron 激活与主题 IPC 回归。最终候选、三平台构建与附件结果见仓库 `docs/testing/2.7.24-build-release.md`。
- 隔离候选已观察到可操作首屏、亮暗切换及外链返回后的画面与控件树一致；不宣称原生工具内部所有超时均已解决。

## 已知限制

- 新正式安装包的真实权限、有声会议、设备热插拔、长期稳定性和人工安装验收尚未执行。启动后实际功能仍可能请求权限。
- macOS 仍为 ad-hoc 签名，无 Developer ID 或 Apple 公证；Windows 无 Authenticode。跨版本 TCC 授权连续性未验收。macOS 安装说明见附件 `INSTALL-UNSIGNED-MACOS.txt`。
- 凭据仍为明文 JSON，SEC-01 为用户已接受的非阻断风险。

## 下载选择

- Apple Silicon Mac：含 `arm64` 的 DMG 或 ZIP。
- Intel Mac：不含 `arm64` 的 macOS DMG 或 ZIP。
- Windows x64：`CueUp-Setup-2.7.24.exe`；便携版 `CueUp.2.7.24.exe`。
