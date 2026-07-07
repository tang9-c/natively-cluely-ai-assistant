# Task 4 Report: QCLOUD Descriptor And LLMHelper Scope Wrapper

## Scope completed

- 在 `electron/LLMHelper.ts` 中为 QCLOUD 路径新增了窄公开方法 `generatePptxKnowledgeWithNatively(...)`。
- 该 wrapper 按图片阶段与纯 Markdown 阶段显式传递 data scopes：
  - 图片阶段：`['reference_files', 'screenshots']`
  - 纯 Markdown 阶段：`['reference_files']`
- `generateWithNatively(...)` 继续保持私有，仅增加通过 `_options.dataScopes` 参与 `assertOutboundScopes(...)` 的能力。
- 新增 `electron/services/knowledge/pptx/PptxVisionDescriptor.ts`，实现：
  - `describeSlide(imagePath, slideIndex, slideCount)`
  - `enhanceMarkdown(markdown)`
- 新增合同测试 `electron/services/knowledge/__tests__/pptxVisionDescriptor.contract.test.mjs`，验证：
  - Stage 1 会发送图片路径
  - Stage 2 不会再次发送图片
  - 增强结果会产出 5 个 hypothetical questions

## TDD evidence

### RED

先新增合同测试并运行：

```bash
rtk npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/knowledge/__tests__/pptxVisionDescriptor.contract.test.mjs
```

初次失败原因为测试相对路径错误；修正为符合当前 `dist-electron` 目录布局的路径后，再次运行，失败原因为目标模块尚不存在，符合预期的缺失实现失败。

### GREEN

补充 `LLMHelper` wrapper 与 `PptxVisionDescriptor` 后，重新运行同一 focused verification 命令通过。

## Files changed

- `electron/LLMHelper.ts`
- `electron/services/knowledge/pptx/PptxVisionDescriptor.ts`
- `electron/services/knowledge/__tests__/pptxVisionDescriptor.contract.test.mjs`

## Constraint check

- 仅支持 `.pptx`：本次未新增 `.ppt` / `.pptm` 支持。
- 未实现 ingestion、KnowledgeMaterialService、IPC、UI、DB、renderer 额外变更。
- 未新增图片预览 IPC。
- 未在产品 UI 暴露 image/render/screenshot/thumbnail/base64/vision。
- 未增加图片持久化存储逻辑。
- 未覆盖或回退现有 `src/components/settings/AIProvidersSettings.tsx` 用户改动。
- 保持日志/隐私边界：本次未新增原始图片/base64 输出日志。

## Verification

通过命令：

```bash
rtk npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/knowledge/__tests__/pptxVisionDescriptor.contract.test.mjs
```

结果：`1 passed, 0 failed`

## Notes

- brief 中合同测试示例里的 dist 相对路径与当前仓库测试目录结构不一致；已按现有仓库布局修正为可工作的路径，其余实现保持与 brief 要求一致。
