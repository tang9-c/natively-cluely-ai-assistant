# Release 资产上传竞态修复设计

## 问题

`release-publish.yml` 将三个平台的产物交给一次 `softprops/action-gh-release` 调用并行上传。Intel 与 ARM64 构建都包含同名的 macOS 安装辅助文件，三个平台还都包含 `size-report.txt`。在 `overwrite_files: true` 下，同一批次中的重复 basename 会共享过期的 Release Asset 状态，导致删除或更新已失效的 asset ID 时返回 404。

## 方案

只调整 Release 上传清单：

- 删除三个平台的 `size-report.txt` 上传项；它们是内部构建诊断文件，不属于用户下载资产。
- `OPEN-UNSIGNED-CUEUP-MAC.sh` 与 `INSTALL-UNSIGNED-MACOS.txt` 仅从 Intel macOS 产物上传一次。
- 保留 Intel、ARM64 和 Windows 的安装包、更新包、blockmap 与 `latest.yml`。
- 为 Release Action 设置 `preserve_order: true`，避免资产 label 更新请求相互交错。

不修改各平台构建产物，不新增整理脚本，也不改变 Release 的草稿、覆盖和命名策略。

## 测试

扩展 `scripts/__tests__/ReleasePublishWorkflow.test.mjs` 的工作流契约：

- 要求 `preserve_order: true`。
- 禁止 Release 上传清单包含 `size-report.txt`。
- 要求共享 macOS 辅助文件各只出现一次。
- 保留现有安装包与更新文件匹配规则断言。

## 成功标准

- 单次 Release Action 的上传清单不再包含重复 basename。
- Release 资产按顺序上传。
- 发布工作流测试全部通过。
- 修改范围只包含发布工作流、对应测试及本设计文档。
