# 权限重置与重启最小安全修复

日期：2026-10-20（America/Los_Angeles）。本记录随权限安全修复一并提交；尚未构建新安装包或正式发布。

## 修改范围

- 权限重启通过现有正常退出流程执行。先保存详情页编辑、结束并保存会议、清理资源，再安排重启；保存失败清除重启请求，保留应用供重试。普通退出不触发重启。
- ScreenCapture 等前序重置已成功、后续服务重置失败时，保留 `commandsRun`，返回 `success: false`、`requiresRestart: true`，并明确说明部分权限已重置。浮窗、设置、首次权限引导三个调用处均保留错误信息并允许确认重启；第一步即失败不重启。
- 普通屏幕权限不可用只引导打开系统设置；疑似授权失效保留重置入口。屏幕源枚举抛错不再直接判为授权记录失效。重启提示说明仍需开始会议并按系统提示授权，不把重置当作恢复成功。
- 未改音频自动恢复机制、采集阈值、原生模块或晚到警告状态机。此前隔离复现的晚到警告仍不能作为现场根因。

## 本地验证

新增 `MacTccRepairSafety.test.mjs`，执行生产权限函数、退出处理器、三处界面回调和实际 JSX 分支；操作系统、授权命令及 Electron 生命周期使用隔离替身。原版新增用例首次运行1通过、10失败，确认保存、部分失败和入口问题；修复并补充普通退出／会议保存失败边界后，新增13项通过。

最终使用项目 Electron 的 Node 模式运行以下8个文件，共83/83通过、0失败、0跳过：MacTccRepairSafety、MacTccRepairFlow、MacScreenFirstAuthorization、AudioCaptureHealthMonitor、AppShutdownResourceCleanup、MainTeardown、ScreenshotPermissionErrorUi、FormatPermissionMessageCrossPlatform。主进程 `npm run typecheck:electron`、界面 `npx tsc --noEmit`、`git diff --check`通过。

扩展检查曾检出新增系统设置入口缺少显式macOS判断，已补齐并通过跨平台回归。最初用系统Node运行SQLite用例遇原生ABI不匹配，改用项目Electron运行后通过，未重编译依赖。日志位于本地 `.tmp/tcc-repair-review/`，未提交原始日志。

## 未完成实机验收

没有执行真实 `tccutil reset`、更改系统权限、启动录音或重启应用。仍需在测试系统用户中验证完整／部分重置后的提示、重新授权、正常退出与重启、系统音频实际采集。保存失败测试使用隔离替身，不能替代安装包故障注入验收；未声明修复所有权限故障或证明现场失败频率。
