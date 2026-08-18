## 发布摘要

请用一句话概括本次发布内容。

## 新增功能

- 功能一说明
- 功能二说明
- 功能三说明

## 改进

- 性能优化
- 用户体验改进
- 内部实现优化

## 修复

- 修复隐身激活问题
- 修复应用启动崩溃
- 修复界面对齐问题

## 技术变更

- 更新项目依赖
- 重构自动更新逻辑

## ⚠️ macOS 安装说明（未签名版本）

请根据设备架构下载对应的 `.zip` 或 `.dmg` 文件（Apple Silicon 或 Intel）。

如果看到“应用已损坏”提示：

- **对于 `.zip` 文件：**
  1. 将应用移动到“应用程序”文件夹。
  2. 打开终端并执行：`xattr -cr /Applications/CueUp.app`

- **对于 `.dmg` 文件：**
  1. 打开终端并执行：
     ```bash
     xattr -cr ~/Downloads/CueUp-<version>-arm64.dmg
     # Intel Mac 请执行：
     xattr -cr ~/Downloads/CueUp-<version>-x64.dmg
     ```
  2. 打开下载的 CueUp `.dmg` 并完成安装。
  3. 打开终端并执行：`xattr -cr /Applications/CueUp.app`

## ⚠️ Windows 安装说明（未签名版本）

运行 Windows 安装程序时，Microsoft Defender SmartScreen 可能提示“Windows 已保护你的电脑”，并阻止未知应用启动。

由于这是未签名版本，此提示属于正常现象。点击 **更多信息**，然后点击 **仍要运行** 即可。

详细变更请参阅仓库中的 [CHANGELOG.md](https://github.com/tang9-c/natively-cluely-ai-assistant/blob/main/CHANGELOG.md)。
