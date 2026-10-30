# 通用状态颜色

通用应用页面的状态颜色由 `src/index.css` 定义，通过 `tailwind.config.js` 暴露。主题取决于根元素的 `data-theme`，与应用现有文字、背景和按钮变量保持一致；系统 `prefers-color-scheme` 不覆盖手动选择的应用主题。

## Token 与用法

每种状态都有 `--status-{tone}-text`、`--status-{tone}-bg`、`--status-{tone}-border` 三个变量。

| tone | 语义 | 浅色文字 | 深色文字 | Tailwind 文字类 |
|---|---|---|---|---|
| info | 进行中、等待实际使用确认、历史验证记录 | `#1D4ED8` | `#93C5FD` | `text-status-info` |
| success | 本次检查通过或已确认结果 | `#047857` | `#6EE7B7` | `text-status-success` |
| warning | 功能受限、使用默认设备回退、暂不能验证、明确策略限制 | `#92400E` | `#FCD34D` | `text-status-warning` |
| error | 保存失败、验证失败、不可用设备、操作失败 | `#BE123C` | `#FDA4AF` | `text-status-error` |

例如错误容器使用 `text-status-error bg-status-error-bg border-status-error-border`。其他状态的背景 / 边框同理。文字、背景和边框必须使用同一状态族。

颜色值集中修改 token；使用页面不直接写 `text-amber-*`、`text-red-*` 等固定色，也不以 `dark:` 拼接另一套系统主题颜色。既有会议浮层继续使用其专用 `--overlay-status-*` 变量，通用 token 不依赖浮层表面或透明度。

## 文字层级与按钮

- 标题、表单标签、输入值：沿用 `text-text-primary` 或容器的主文字继承。
- 正文说明、辅助说明、法律说明：`text-text-secondary`。
- 非关键元信息、时间戳：`text-text-tertiary`；不要把长段操作指引降成弱文字。
- 状态有明确文字或图标解释，颜色不单独承载状态。历史回执保留时间和“上次”语义，概览、语音和 AI 页统一用 info，不能显示成本次成功。
- 首次设置主按钮复用已有 `bg-button-primary-bg`、`hover:bg-button-primary-hover` 和 disabled 变量；新增 `text-button-primary-text` 对应 `--btn-primary-text`。禁用态使用专用文字和背景变量，不再靠整体 opacity 降低文字可读性。

## 首次设置中的应用

欢迎、概览、权限、语音、AI、开通说明、开始会议摘要、未保存对话框与首次会议提示使用上述规则。受限的系统音频仍为 warning，麦克风限制 / 操作失败为 error；授权已开启但尚未实际捕获为 info。本次服务验证通过为 success，历史回执不冒充当前验证。

欢迎页右侧的产品演示图保留自身深色表面；功能文字、表单与操作状态按应用主题展示。此次没有改变录音授权、服务验证、门禁、导航或凭据存储行为。

## 回归

`tests/e2e/onboarding-theme.spec.ts` 检查实际 computed style，覆盖应用 / 系统亮暗四种组合、同页主题切换、成功 / 受限 / 失败、主按钮 normal / hover / disabled、开通页、未保存对话框、窄窗口和首次会议提示。

所有四种状态文字在 `--bg-primary`、`--bg-elevated` 和同族 `--status-*-bg` 三种不透明表面上的对比度，测试阈值为至少 4.5:1。该阈值检查新状态色，不表示本轮重新验证了所有既有文字色、按钮 hover 色和透明浮层的像素对比度。

```bash
# 生产资源下的主题专项
npm run test:e2e:production -- tests/e2e/onboarding-theme.spec.ts

# 包含主题专项的生产资源完整回归
npm run test:e2e:production
```

主题用例同时纳入 `playwright.system-audio.config.ts`，随已有 System Audio Permissions workflow 的 production UI 步骤执行。新配置随代码推送后生效；远程运行和分支保护状态独立记录。
