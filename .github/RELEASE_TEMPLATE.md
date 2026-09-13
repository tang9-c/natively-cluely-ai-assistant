## 发布摘要

CueUp 2.7.11 提升了销售会议实时辅助的召回准确性，并修复动态动作卡片重复和重载后丢失的问题。

## 改进

- 覆盖明确的价格、竞品对比、实施周期、数据迁移风险、产品演示、会后资料和折扣问题。
- 竞品对比不再依赖 Salesforce 等特定产品名称，可识别通用的明确对比请求。
- 区分“ROI 怎么计算”和“有没有 ROI 案例”，避免返回答非所问的案例内容。
- 存量用户仍使用旧官方默认值时，会安全升级 Sales 意图词；用户自行修改的内容保持不变。

## 修复

- 分裂 final 转录形成完整语义后，界面会替换旧卡片，不再同时显示已经失效的重复卡片。
- 会议浮窗加载或重新挂载后，会恢复 Main 中仍然有效的动态动作卡片。

## 测试与质量

- 明确区分状态机 fixture 测试和真实决策路径测试，避免将 oracle 结果误认为线上准确率。
- 增加使用生产说话人角色的销售场景，以及常见客户问题、ROI 计算和竞品对比回归测试。

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
