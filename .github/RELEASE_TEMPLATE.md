## CueUp 2.7.21：修复首次设置配置复用与设置一致性

- 首次设置的语音识别与 AI 复用已保存的 QCLOUD API Key，切换提供商后无需重复输入；仅传递密钥是否存在，不读取密钥正文。
- 变更语言、提供商或模型后清除旧检查提示，避免把上一次“不支持语言”误显示为当前配置的结果。
- 统一首次设置与设置页的提供商、语言、模型、设备、数据范围用语与选项；显示名称转换保持实际配置 ID 不变。
- 正确识别并保留 Codex CLI 的通用与指定模型配置、自定义模型和历史语音提供商；配置帮助跳转到对应设置。
- 区分“密钥已保存”和连接验证通过；历史 7/30 天保留值明确标注自动清理未启用。

## 验证

- 本轮候选已通过 177 项单元/契约测试、58 项开发态 Electron 场景、29 项 production renderer 场景，以及类型检查和生产构建。测试类别可能交叠，不作为唯一用例总数相加。
- 远程构建、包内架构、运行时 smoke 与最终附件结果见仓库 `docs/testing/2.7.21-build-release.md`。

## 已知限制

- 凭据仍为明文 JSON，SEC-01 为用户明确接受的非阻断风险。
- 真实 QCLOUD 账号/模型响应、新设备 TCC、有声采集与完整会议、物理设备热插拔、新安装包人工亮暗主题验收尚未执行；隔离 UI 和固定 WAV smoke 不替代这些项目。
- macOS 为 ad-hoc 签名，未配置 Developer ID 或 Apple 公证；参见附件 `INSTALL-UNSIGNED-MACOS.txt`。Windows 未配置 Authenticode。

## 下载选择

- Apple Silicon Mac：含 `arm64` 的 DMG 或 ZIP。
- Intel Mac：不含 `arm64` 的 macOS DMG 或 ZIP。
- Windows x64：`CueUp-Setup-2.7.21.exe`；便携版 `CueUp.2.7.21.exe`。
