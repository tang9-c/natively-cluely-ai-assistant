# CueUp 品牌/商标风险治理方案

## Summary

- 对外品牌统一为 **CueUp**，降低用户误认为 Natively 官方版本、授权版本或商业合作版本的风险。
- 当前阶段不修改 `build.appId`，避免影响已安装用户升级、系统权限和数据目录。
- 新 logo 方向确定为 **简洁的 C 形声波**，不再使用圆圈 N 或任何 Natively 风格标识。
- 内部兼容 id 如 `'natively'`、旧 IPC/localStorage key、环境变量暂不改，避免破坏存量配置。

## Key Changes

- 发布元数据：
  - 将 `package.json` 的 `name` 从 `natively` 改为 `cueup`。
  - 同步更新 `package-lock.json` 顶层包名。
  - 保持 `build.productName = "CueUp"`。
  - 暂不修改 `build.appId = "com.electron.meeting-notes"`，记录为第二阶段迁移项。

- Logo 与视觉资产：
  - 新建/替换为 `CueUpLogoMark`，视觉方向为简洁的 **C 形声波**。
  - 不使用 `N` 字母、圆圈 N、或与 Natively 近似的标识。
  - 将用户可见入口切到新 logo：启动器、设置页、About、README 顶部、模型/提供商入口、帮助页示意图、托盘/窗口图标。
  - 更新发行图标资产：`assets/cueup.icns`、Windows `icon.ico`、Linux png icon、README 展示图标。
  - 旧 `NativelyLogoMark` 删除或改为非用户可见兼容代码；不得继续渲染在产品界面中。

- 用户可见品牌清理：
  - 产品名统一使用 `CueUp`。
  - “Natively” 只允许出现在 fork 来源、许可证、provenance audit、历史兼容说明中。
  - About 页面加入明确声明：CueUp 是独立 fork，不隶属、不受 Natively 或 Natively AI Private Limited 授权、赞助或背书。
  - QCLOUD API 入口使用通用云/钥匙/服务器或新的 CueUp 图标，不再使用 Natively 风格 logo。

- 法律与来源说明：
  - 保留 `LICENSE` 和 `FORK_PROVENANCE.md`。
  - 在 `FORK_PROVENANCE.md` 增加 “Trademark/Branding Policy”：
    - 对外品牌为 CueUp。
    - `Natively` 仅用于来源归属。
    - 禁止将 `Natively` 用作应用名、包名、安装包名、广告名、主标题或 logo。
    - logo 标准为 C 形声波，不得使用 N 字母标识。

## Test Plan

- 品牌扫描：
  - 运行 `rg -n "\\bNatively\\b|\\bnatively\\b|NATIVELY|natively-" README.md LICENSE FORK_PROVENANCE.md package.json package-lock.json src electron .github termsandcondition.md PRIVACY.md`。
  - 每个命中必须归类为：上游归属、许可证、内部兼容、测试迁移；不得有用户可见产品品牌误用。

- Logo 扫描：
  - 搜索 `NativelyLogoMark`、`Natively logomark`、`circle N`、`natively.iconset`。
  - 断言用户界面不再引用旧 N 标识。
  - 人工检查新 C 形声波 logo 在浅色/深色主题、16px/24px/512px 图标尺寸下仍清晰。

- 元数据校验：
  - 断言 `package.json.name === "cueup"`。
  - 断言 `package-lock.json` 顶层 `name` 和 `packages[""].name` 都为 `cueup`。
  - 断言 `build.productName === "CueUp"`。
  - 断言 `build.appId` 本阶段保持 `com.electron.meeting-notes`。

- 契约测试：
  - 运行法律/文案测试：`ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test src/components/__tests__/LegalDocsContent.test.mjs src/components/__tests__/StartupSequenceContent.test.mjs`。
  - 运行 QCLOUD 兼容命名测试：`ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/QCloudApiSettings.test.mjs electron/llm/__tests__/LLMHelper.SetModel.test.mjs`。
  - 运行图标/打包相关测试：`ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/MacX64NativeSmoke.test.mjs`。

## Assumptions

- 正式对外品牌为 **CueUp**。
- 新 logo 方向确定为 **简洁的 C 形声波**。
- 本阶段不改 `build.appId`。
- 内部 `'natively'` id、旧配置 key、环境变量和迁移逻辑暂时保留。
- GitHub repo slug 暂不改；如后续商业发布，再单独执行仓库重命名和链接迁移。
