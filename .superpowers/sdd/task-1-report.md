# Task 1 Report: Register FDE As A Built-In Mode

## Status

DONE

## Scope Completed

- 在 `electron/services/ModesManager.ts` 中将 `fde` 注册为第 8 个内置 `ModeTemplateType`
- 按任务简报原样添加 `MODE_TEMPLATES` 中的 FDE 元数据
- 按任务简报原样添加 `TEMPLATE_NOTE_SECTIONS.fde` 七个默认笔记区块
- 在 `src/lib/modeTemplateMeta.ts` 中添加 renderer 用到的 `fde` 标签与默认名称
- 更新 `electron/services/__tests__/ModesManager.test.mjs` 的期望模式列表、数量断言与 premium intercept 显式分类覆盖

## TDD Record

### Red

先修改测试，再运行：

```bash
rtk npm run build:electron && rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/ModesManager.test.mjs
```

失败结果符合预期，主要报错为：

- `MODE_TEMPLATES` 缺少 `fde`
- `TEMPLATE_NOTE_SECTIONS` 缺少 `fde`
- `isPremiumKnowledgeInterceptAllowed` 的“所有生产模式都必须显式分类”断言缺少 `fde`

### Green

实现注册、默认笔记区、renderer 标签和测试分类后，再次运行：

```bash
rtk npm run build:electron && rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/ModesManager.test.mjs
```

结果：

- `build:electron` 成功
- `ModesManager.test.mjs` 12/12 通过

## Files Changed

- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/services/ModesManager.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/src/lib/modeTemplateMeta.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/services/__tests__/ModesManager.test.mjs`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/services/profile/scenarios/registry.ts`

## Notes

- `ModesManager.ts` 中的 `TEMPLATE_SYSTEM_PROMPTS` 从 `Record<ModeTemplateType, string>` 调整为 `Partial<Record<ModeTemplateType, string>>`，避免 Task 1 因尚未实现的 FDE prompt 映射而被迫越界到 Task 2。
- `electron/services/profile/scenarios/registry.ts` 的类型也同步放宽为 `Partial<Record<ModeTemplateType, ScenarioResolution>>`，这是为了在 `ModeTemplateType` 新增 `fde` 后保持当前 Task 1 可编译；未新增任何 FDE scenario 行为映射，仍由后续任务处理。
- 当前 Task 1 范围内没有新增 FDE prompt 本体；现有 `ModesManager` 测试仍然通过，因为该测试文件目前没有把 `fde` 纳入 prompt 前缀覆盖断言。

## Review Fix

### Status

DONE

### Reviewer Findings Fixed

- 恢复 `electron/services/ModesManager.ts` 中 `TEMPLATE_SYSTEM_PROMPTS` 为 `Record<ModeTemplateType, string>`，新增 `MODE_FDE_PROMPT` 并映射 `fde: MODE_FDE_PROMPT`
- 恢复 `electron/services/profile/scenarios/registry.ts` 中模板解析为 `Record<ModeTemplateType, ScenarioResolution>`，补齐 `fde -> fde` 的 exhaustive registry mapping
- 按 Task 4 brief 补齐 FDE scenario 类型、文档 subtype、adapter 与默认注册
- 在 `electron/services/__tests__/ModesManager.test.mjs` 中把 `fde` 纳入 prompt 前缀覆盖
- 在 `electron/services/__tests__/ScenarioRegistry.test.mjs` 中增加 FDE registry 与文档 subtype 覆盖

### TDD Record

#### Red

先补测试后运行：

```bash
rtk npm run build:electron && rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/ModesManager.test.mjs electron/services/__tests__/ScenarioRegistry.test.mjs
```

失败点与 reviewer 发现一致：

- `promptsMod.MODE_FDE_PROMPT` 为 `undefined`，导致 FDE prompt 前缀断言失败
- `registry.resolveByTemplateType('fde')` 回退到了 `general`
- `ScenarioRegistry.createDefault().get('fde')` 抛出 `Unknown scenario type: fde`

#### Green

补齐 FDE prompt 与 scenario 映射后，运行：

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/ModesManager.test.mjs electron/services/__tests__/ScenarioRegistry.test.mjs electron/services/__tests__/ScenarioContextService.test.mjs electron/llm/__tests__/modePrompts.test.mjs
```

结果：

- `build:electron` 成功
- 4 个测试文件共 35/35 通过

### Files Changed For Review Fix

- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/llm/prompts.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/llm/tinyPrompts.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/services/ModesManager.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/services/__tests__/ModesManager.test.mjs`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/services/profile/scenarios/types.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/services/profile/scenarios/adapters.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/services/profile/scenarios/registry.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/services/__tests__/ScenarioRegistry.test.mjs`

## Second Review Fix

### Status

DONE

### Reviewer Findings Fixed

- 在 `electron/test/modes-live-response-eval.ts` 的 tiny/full 两个 `byMode` 映射中补齐 `fde`，避免 FDE eval 静默回退 `general`
- 同文件顶部的 `TinyPromptModule` 与 `PromptModule` 类型补齐 `TINY_MODE_FDE_PROMPT` 和 `MODE_FDE_PROMPT`
- 在 `electron/llm/__tests__/modePrompts.test.mjs` 的 `MODE_PROMPTS`、`MODE_CONTRACT_TERMS`、`UNIQUE_MODE_TERMS` 中补齐 `fde`，让 shared safety、injected context、untrusted evidence、mode contract、distinctness 现有测试自动覆盖 FDE
- FDE 词项直接取自当前 `MODE_FDE_PROMPT`，覆盖前线部署工程师、客户现场、捕捉模式、现场发言模式、风险、验证步骤
- 在 `src/components/profile/types.ts` 的 `ScenarioDocSubtype` 中补齐 FDE 文档子类型：`customer-architecture`、`customer-workflow`、`security-requirements`、`prototype-scope`、`delivery-risk`

### Verification

按要求执行：

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/llm/__tests__/modePrompts.test.mjs electron/test/__tests__/evalHarnessPatterns.test.mjs
rtk npm run build
```

结果：

- `build:electron` 成功
- 2 个测试文件共 97/97 通过
- `build` 成功

### Files Changed For Second Review Fix

- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/test/modes-live-response-eval.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/llm/__tests__/modePrompts.test.mjs`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/src/components/profile/types.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/.superpowers/sdd/task-1-report.md`

## Third Review Fix

### Status

DONE

### Reviewer Finding Fixed

- 将 `electron/test/modes-live-response-eval.ts` 中 `modePromptFor()` 的 tiny/full 两条路径从 `general` 静默 fallback 改为统一的 fail-fast 校验
- 新增 `promptForKnownMode()`，当 `byMode[mode]` 缺失时抛出 `Error`
- 错误信息显式包含 unknown mode 值，以及按字母序列出的可用 mode keys，便于定位坏 scenario 或坏配置

### TDD Record

#### Red

先补静态回归测试，再运行：

```bash
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/test/__tests__/evalHarnessPatterns.test.mjs
```

结果：

- 新增断言要求源码中不能再出现 `byMode[mode] ?? ...GENERAL...` fallback
- 新增断言要求存在 unknown mode throw 和 available mode keys
- 在未先构建 `dist-electron` 的前提下，测试命令按现状失败；在本轮修复中继续按用户要求执行完整构建后复验

#### Green

按要求执行：

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --test electron/test/__tests__/evalHarnessPatterns.test.mjs
```

结果：

- `build:electron` 成功
- `evalHarnessPatterns.test.mjs` 共 87/87 通过

### Files Changed For Third Review Fix

- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/test/modes-live-response-eval.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/test/__tests__/evalHarnessPatterns.test.mjs`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/.superpowers/sdd/task-1-report.md`

## Dynamic Action Productization Task 1 Review Fix

- 已补充 `matchesRequiredPatterns(text, patterns)` 的直接覆盖测试（`true` / `false` 两类断言）
- 已在 `DynamicActionProductFixtureScoring` 测试中断言 `evaluatePatternExpectations()` 返回：
  - `missingRequired`
  - `matchedForbidden`
- 仍在 `electron/services/__tests__/DynamicActionProductFixtureScoring.test.mjs` 中验证：`rtk npm run build:electron` 后 `npx electron --test electron/services/__tests__/DynamicActionProductFixtureScoring.test.mjs` 通过。
