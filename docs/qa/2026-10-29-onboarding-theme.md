# 首次设置文字颜色与主题适配修正

日期：2026-10-29。状态：源码修复已于 2026-10-30 随 2.7.20 发布。

## 问题与变更

当前首次设置普通文字已使用项目的主 / 次级文字 token，但错误与限制提示混用固定 amber 色，部分页面的 `dark:` 变体跟随系统主题；应用则使用根元素 `data-theme`，手动主题与系统主题不同可能导致状态色不一致。主按钮也未统一采用项目已有的按钮主题变量。

本次补齐通用 info / success / warning / error 的文字、背景和边框 token，以及主按钮文字 token。页面消费语义 token，错误与限制分开，历史回执保留历史语义。欢迎页的说明和法律文字、概览页长段说明回到次级文字层级。详见[统一状态色约定](../design/semantic-status-colors.md)。

覆盖当前欢迎页、P1–P5、开通说明、未保存对话框与首次会议提示；恢复卡片原本已使用项目主题变量，继续复用。原生权限判断、会议门禁、服务请求、导航与存储行为保持原逻辑。

## 回归证据

- 修复前：新增“应用浅色 / 系统深色”用例在缺少 `--status-info-text` 处失败，未跳过断言。
- 主题专项：开发态最初的定位器未包含状态行的服务后缀，另一个断言误以为摘要页主按钮必然禁用；修正为匹配完整状态行，并在实际受阻的权限页验证 disabled 色，没有改变产品门禁来满足测试。随后六项专项通过。
- 开发态联合 **51/51 通过**：原引导、会议、权限、QCLOUD 与六项新主题用例。之后补齐 AI / 语音历史回执的信息色及对应断言，最终以完整 production 套件再次验证。
- 生产资源 **14/14 通过**：欢迎层冷启动、QCLOUD、权限和新主题用例；无 Vite server，使用 production 分块与 `file://`。主进程编译包含隔离适配器，不是实际安装包。
- 系统音频保护单元 **120/120**，欢迎文案 / 表单契约 **8/8**；Renderer / Electron 类型检查、生产构建和 `git diff --check` 通过。
- 新主题用例已加入 production 和 System Audio Permissions 的 UI 入口；后者现在收集 15 项，其中新增六项，远程 workflow 尚未运行。
- 新用例检查浏览器实际 computed style 和新状态色对比度，覆盖历史回执跨页信息色、应用 / 系统亮暗四种组合、同页切换、normal / hover / disabled、错误容器文字 / 背景 / 边框、开通说明、离开确认、600×400 和首次会议提示的进行中 / 收到转写 / 保存失败。
- 新状态色在页面、卡片和同族状态背景上的文字对比度全部至少 4.5:1；不将它扩大描述为所有既有文本或透明浮层对比度均通过。

日志保存在本地 `.tmp/onboarding-theme/`。截图来自网络隔离、独立 userData、假服务 / 禁用真实采音的 Electron 回归，不代表真实服务或采音验收。

## 截图核查

已目视核对生产资源下的浅 / 深色错误页面、600×400 错误容器，以及首次会议提示；没有看到文字溢出或状态色跟随错误主题。样式约定也已链接到 `AGENTS.md`，便于后续开发遵守。以下图片均使用应用 / 系统相反主题：

| 状态 | 浅色应用 / 深色系统 | 深色应用 / 浅色系统 |
|---|---|---|
| 系统音频限制 | [权限页](assets/2026-10-29-onboarding-theme/permissions-light.png) | [权限页](assets/2026-10-29-onboarding-theme/permissions-dark.png) |
| 字段错误 | [AI 页](assets/2026-10-29-onboarding-theme/ai-error-light.png) | [AI 页](assets/2026-10-29-onboarding-theme/ai-error-dark.png) |
| 600×400 摘要 | [开始会议页](assets/2026-10-29-onboarding-theme/ready-narrow-light.png) | [开始会议页](assets/2026-10-29-onboarding-theme/ready-narrow-dark.png) |
| 600×400 保存失败 | [错误容器](assets/2026-10-29-onboarding-theme/flow-error-light.png) | [错误容器](assets/2026-10-29-onboarding-theme/flow-error-dark.png) |
| 首次会议状态 / 错误 | [提示卡](assets/2026-10-29-onboarding-theme/meeting-hint-light.png) | [提示卡](assets/2026-10-29-onboarding-theme/meeting-hint-dark.png) |

[尺寸、主题和 SHA-256 清单](assets/2026-10-29-onboarding-theme/manifest.json)。截图中的豆包与 `fixture-ai` 来自指定测试配置，不表示更改了 QCLOUD API 的服务识别或开通说明。旧日期的验收截图恢复原件，避免覆盖历史证据。

## 源码核查时未执行与范围

未发布或重新安装发行包，未执行远程 workflow。真机系统权限、实际采音、真实 AI / STT 服务与既有 T13 发行验收缺口保持原状态。欢迎页右侧产品插画采用自身深色表面；已有用户的旧权限弹窗不属于当前首次设置主线，本轮没有扩展为全应用视觉重构。


## 2.7.20 发布追记

2026-10-30，[CueUp 2.7.20](https://github.com/tang9-c/natively-cluely-ai-assistant/releases/tag/v2.7.20-sha-57d25a1) 已公开，三平台构建与 14 个附件核对通过，详见[发布记录](../testing/2.7.20-build-release.md)。本记录中的隔离证据与未执行真机项保留原边界，正式发布不代表这些人工项目已完成。
