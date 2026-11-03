# CueUp 发布流程与更新方式

核对基线：2.7.26（2026-11-02）。本文描述仓库现有三平台远程构建与草稿发布流程。完整实例见 [2.7.26 发布记录](testing/2.7.26-build-release.md)和[附件清单](testing/2.7.26-release-assets.json)。

## 当前更新行为

| 平台 / 设置 | 当前实现 |
| --- | --- |
| 更新通道 | `setupAutoUpdater()` 固定为 `latest`，不是根据版本字符串自动切换 beta。 |
| 自动下载 / 退出安装 | `autoDownload=false`、`autoInstallOnAppQuit=false`；下载和安装由用户操作发起。 |
| Windows 安装版 | 使用 electron-updater、`latest.yml` 和 NSIS 安装包；检查、下载和安装分别显示状态。便携版可从 Releases 手动更换。 |
| macOS | 通过 GitHub 最新正式 release 检查版本，按架构选择 DMG 并手动安装；不承诺当前 ad-hoc 构建可静默自更新。 |
| 开发态 | 使用手动 GitHub API 检查逻辑，不能用开发态验证代替安装包更新验收。 |

当前仓库没有一条经核对的 beta 用户自动更新流程。生成预发布版本或在 GitHub 勾选 Pre-release，不会自动让应用改用 beta 通道。若要增加该能力，须同步实现、检查更新清单并验证客户端，而不是沿用旧文档中的示例配置。

## 1. 准备可追溯的源码

1. 在功能分支完成代码、测试和文档。版本以 `package.json` 为准，`package-lock.json` 根版本及根包版本保持一致；本项目没有独立的 `VERSION` 文件。
2. 更新 `CHANGELOG.md` 和 `.github/RELEASE_TEMPLATE.md`，写清改动、已执行验证和未执行项。不要把固定音频或隔离 UI 写成真实会议通过。
3. 合并前运行对应检查。权限/音频改动至少执行：

   ```bash
   npm run test:system-audio-permissions
   npm run test:system-audio-permissions:e2e
   ```

   首次设置及状态主题改动还需执行 `npm run test:e2e:production`；按变更运行类型检查、正式主进程编译和其他相关套件。
4. 核对 PR 的实际 head 与检查结果，再合并。保留候选与合并提交的文件树对应关系。
5. 三平台使用同一已审查的 ref，逐一核对运行的 `head_sha`。需要固定来源时，可使用明确指向该提交的标签。当前 release 标签格式是 `v<版本>-sha-<提交前7位>`，例如 `v2.7.26-sha-960e952`。GitHub 的手动工作流使用分支或标签 ref，不把裸 SHA 直接当作可靠的 dispatch ref。

汇总工作流目前从默认分支检出版本和发布模板，而用触发构建的 SHA 组成标签。因此从候选构建到汇总完成期间，不要推进默认分支到下一版版本号或不匹配的发布模板；必须人工核对版本、模板与标签来源，不能只看到任务成功就公开。

## 2. 远程构建三个平台

在 GitHub Actions 选择下列工作流，使用同一个经核对的分支或标签运行：

| 工作流 | 产物与验证 |
| --- | --- |
| `build-arm64-mac.yml` / Build ARM64 Mac | Apple Silicon DMG、ZIP、blockmap；原生架构、包内运行时、ZIP/DMG 签名完整性及手动更新资产检查。 |
| `build-intel-mac.yml` / Build Intel Mac | Intel DMG、ZIP、blockmap；当前在 ARM runner 交叉构建并由 Rosetta 验证，保留 x64 架构和运行时检查。 |
| `build-windows-x64.yml` / Build Windows x64 | Windows x64 NSIS、便携 EXE、blockmap 和 `latest.yml`；架构、安装包/更新摘要及运行时检查。 |

三份工作流都会在打包前运行系统音频权限单元回归。正式主进程通过 `npm run build:electron:package` 编译，排除测试适配器与 fixture 入口。包内 smoke 检查 PDF、PPTX、Embedding、数据库、RAG 和固定 WAV SenseVoice；也验证指定 GPU 不可用后的 CPU 回退。

检查每个任务的 attempt、结论、来源 SHA 与报告内容，不能只检查绿色总状态。任何必需步骤失败时先修复，不把其他平台的成功当作整版通过。

## 3. 汇总草稿并核对附件

任一构建完成会触发 `release-publish.yml`，它按 SHA 串行汇总为 **draft**，不会正式公开。当前脚本允许汇总部分已成功平台，缺少某个平台也可能有草稿，所以维护者必须额外确认三平台齐全。

多个平台会触发多个同 SHA 汇总任务。正式公开前等待所有相关汇总终止；可确认一个完整汇总成功后停止冗余任务，但必须确认取消已到终态，避免稍后覆盖附件或写回草稿。

2.7.26 的预期公开附件共 14 项；后续版本替换版本号：

| 平台 | 附件名称 |
| --- | --- |
| Apple Silicon | `CueUp-2.7.26-arm64.dmg`、对应 `.blockmap`、`CueUp-2.7.26-arm64-mac.zip`、对应 `.blockmap` |
| Intel Mac | `CueUp-2.7.26.dmg`、对应 `.blockmap`、`CueUp-2.7.26-mac.zip`、对应 `.blockmap` |
| Windows x64 | `CueUp-Setup-2.7.26.exe`、对应 `.blockmap`、`CueUp.2.7.26.exe`、`latest.yml` |
| Mac 安装辅助 | `INSTALL-UNSIGNED-MACOS.txt`、`OPEN-UNSIGNED-CUEUP-MAC.sh` |

核对清单：

- 标签指向预期源码提交，release 正文的版本和来源一致。
- 三份运行均为预期 SHA 且成功，原生架构和运行时报告为 `ok: true`。
- 附件名称无遗漏或重复，状态为 uploaded、大小非零、SHA-256 齐全。
- `latest.yml` 的版本、NSIS 名称、大小和 SHA-512 与实际安装包一致；blockmap 对应本次文件。
- Mac 安装辅助文件指向 `CueUp.app`。当前公开集合未包含 Mac updater YAML，macOS 走手动 DMG 更新，不用 Windows 的 `latest.yml` 推断 Mac 更新可用。

## 4. 正式发布与留存记录

1. 完成核对后将草稿设为正式 release；正式版应为 `draft=false`、`prerelease=false`，并确认 Latest 指向预期 release。
2. 再次核对附件名称、大小和摘要没有变化，检查所有公开下载地址可访问。
3. 在 `docs/testing/` 既有对应发布记录中填写实际来源提交、运行链接、报告、附件摘要和正式发布时间。发布记录后续提交不改变安装包来源或标签。
4. 安装包、完整原始日志和真实凭据留在受控证据目录，不提交仓库；公开记录只放必要且脱敏的证据。

## 签名与验收边界

macOS 当前使用 ad-hoc 签名，严格 codesign 检查只证明包内代码完整性，不等于 Developer ID 签名、Apple 公证或跨版本 TCC 授权连续性。Windows 当前未配置 Authenticode。

系统音频权限、已有授权的升级恢复、真实麦克风/系统音频转写、设备切换和人工安装必须单独执行真机验收。未执行时如实标记；固定 WAV smoke 和测试适配器下的 production renderer 场景均不能代替这些检查。清除下载隔离属性与授予录音权限是不同操作。

相关：[贡献指南](../CONTRIBUTING.md) · [功能与设置参考](REFERENCE.md) · [系统音频权限回归](testing/system-audio-permissions.md)
