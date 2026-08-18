# Windows Overlay Automatic Hit Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows 上让 CueUp Overlay 的透明区域自动穿透鼠标，同时保持可见控件可交互，并保留手动全窗口穿透的最高优先级。

**Architecture:** 用共享纯函数计算最终鼠标策略，`WindowHelper` 作为唯一原生窗口策略执行者。Renderer 只报告“指针是否命中声明过的交互区域”，IPC 只传布尔值；主进程负责平台限制、手动覆盖和幂等应用。

**Tech Stack:** Electron `BrowserWindow.setIgnoreMouseEvents`、React 18、TypeScript、Node test runner、现有 preload/IPC 合同。

## Global Constraints

- 仅改变 Windows Overlay；Launcher、Settings、Cropper、macOS 和 Linux 行为不变。
- 手动“鼠标穿透”始终覆盖自动命中。
- 不修改数据库结构，不新增依赖，不改变视觉样式和窗口尺寸算法。
- IPC 不传鼠标坐标、DOM 内容或用户数据；日志不记录这些数据。
- 只在命中状态或最终原生策略变化时调用 IPC/原生 API。
- 保留工作区现有 `.tmp/`，本轮不提交生产代码，除非用户另行要求。

## File Map

- Create `shared/overlayMouseInteractionPolicy.ts`: 平台无关、可单测的最终策略计算。
- Create `electron/services/__tests__/OverlayMouseInteractionPolicy.test.mjs`: 共享策略 RED/GREEN 测试。
- Modify `electron/WindowHelper.ts`: 保存自动命中状态并幂等应用原生穿透。
- Modify `electron/ipcHandlers.ts`: 接收 Renderer 的自动命中布尔值。
- Modify `electron/preload.ts`: 暴露 Renderer 报告方法。
- Modify `src/types/electron.d.ts`: 声明 Renderer API 合同。
- Create `src/lib/overlayPointerHitTest.ts`: DOM 命中与交互锁的纯逻辑。
- Create `src/lib/__tests__/OverlayPointerHitTest.test.mjs`: Renderer 命中逻辑测试。
- Modify `src/components/NativelyInterface.tsx`: 注册 Windows 鼠标/焦点监听并标记主面板。
- Modify `src/components/ui/TopPill.tsx`: 标记 TopPill 为交互区域。
- Modify `electron/services/__tests__/IpcContract.test.mjs`: 覆盖新增 IPC 三层合同。

---

### Task 1: 最终鼠标策略纯函数

**Files:**
- Create: `shared/overlayMouseInteractionPolicy.ts`
- Test: `electron/services/__tests__/OverlayMouseInteractionPolicy.test.mjs`

**Interfaces:**
- Produces: `resolveOverlayMouseInteractionPolicy(input): { ignoreMouseEvents: boolean; forward: boolean }`
- Consumes: `platform`、`manualPassthrough`、`automaticInteractive`

- [ ] **Step 1: 写失败测试**

```js
test('Windows transparent area passes through unless manually or automatically interactive', async () => {
  const { resolveOverlayMouseInteractionPolicy } = await loadPolicy();
  assert.deepEqual(resolveOverlayMouseInteractionPolicy({
    platform: 'win32', manualPassthrough: false, automaticInteractive: false,
  }), { ignoreMouseEvents: true, forward: true });
  assert.deepEqual(resolveOverlayMouseInteractionPolicy({
    platform: 'win32', manualPassthrough: false, automaticInteractive: true,
  }), { ignoreMouseEvents: false, forward: false });
});

test('manual passthrough overrides automatic interactivity on every platform', async () => {
  const { resolveOverlayMouseInteractionPolicy } = await loadPolicy();
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.deepEqual(resolveOverlayMouseInteractionPolicy({
      platform, manualPassthrough: true, automaticInteractive: true,
    }), { ignoreMouseEvents: true, forward: true });
  }
});

test('non-Windows automatic state does not alter existing interactive behavior', async () => {
  const { resolveOverlayMouseInteractionPolicy } = await loadPolicy();
  assert.deepEqual(resolveOverlayMouseInteractionPolicy({
    platform: 'darwin', manualPassthrough: false, automaticInteractive: false,
  }), { ignoreMouseEvents: false, forward: false });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/OverlayMouseInteractionPolicy.test.mjs`

Expected: FAIL，因为 `dist-electron/shared/overlayMouseInteractionPolicy.js` 尚不存在。

- [ ] **Step 3: 写最小实现**

```ts
export interface OverlayMouseInteractionInput {
  platform: NodeJS.Platform;
  manualPassthrough: boolean;
  automaticInteractive: boolean;
}

export interface OverlayMouseInteractionPolicy {
  ignoreMouseEvents: boolean;
  forward: boolean;
}

export function resolveOverlayMouseInteractionPolicy(
  input: OverlayMouseInteractionInput,
): OverlayMouseInteractionPolicy {
  const ignoreMouseEvents = input.manualPassthrough
    || (input.platform === 'win32' && !input.automaticInteractive);
  return { ignoreMouseEvents, forward: ignoreMouseEvents };
}
```

- [ ] **Step 4: 运行专项测试并确认 GREEN**

Run: `npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/OverlayMouseInteractionPolicy.test.mjs`

Expected: 3 tests PASS。

### Task 2: 主进程幂等策略与 IPC

**Files:**
- Modify: `electron/WindowHelper.ts`
- Modify: `electron/ipcHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Modify: `electron/services/__tests__/IpcContract.test.mjs`
- Create: `electron/services/__tests__/OverlayMouseInteraction.contract.test.mjs`

**Interfaces:**
- Consumes: `resolveOverlayMouseInteractionPolicy()` from Task 1
- Produces: `WindowHelper.setOverlayAutomaticInteractive(interactive: boolean): void`
- Produces: `window.electronAPI.setOverlayAutomaticInteractive(interactive: boolean): Promise<{ success: boolean }>`

- [ ] **Step 1: 写 IPC 和主进程行为失败测试**

```js
test('automatic overlay interaction IPC is wired through main preload and renderer types', () => {
  assert.match(read('electron/ipcHandlers.ts'), /set-overlay-automatic-interactive/);
  assert.match(read('electron/preload.ts'), /setOverlayAutomaticInteractive:[\s\S]*set-overlay-automatic-interactive/);
  assert.match(read('src/types/electron.d.ts'), /setOverlayAutomaticInteractive:\s*\(interactive:\s*boolean\)/);
});

test('WindowHelper resolves and applies mouse policy idempotently', () => {
  const source = read('electron/WindowHelper.ts');
  assert.match(source, /setOverlayAutomaticInteractive\(interactive:\s*boolean\)/);
  assert.match(source, /resolveOverlayMouseInteractionPolicy/);
  assert.match(source, /lastAppliedIgnoreMouseEvents/);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/IpcContract.test.mjs electron/services/__tests__/OverlayMouseInteraction.contract.test.mjs`

Expected: FAIL，缺少新增通道、方法和策略状态。

- [ ] **Step 3: 在 WindowHelper 中实现唯一策略执行点**

```ts
private overlayAutomaticInteractive = process.platform !== 'win32';
private lastAppliedIgnoreMouseEvents: boolean | null = null;

public setOverlayAutomaticInteractive(interactive: boolean): void {
  if (process.platform !== 'win32') return;
  if (this.overlayAutomaticInteractive === interactive) return;
  this.overlayAutomaticInteractive = interactive;
  this.syncOverlayInteractionPolicy();
}

public syncOverlayInteractionPolicy(): void {
  if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
  const policy = resolveOverlayMouseInteractionPolicy({
    platform: process.platform,
    manualPassthrough: this.appState.getOverlayMousePassthrough(),
    automaticInteractive: this.overlayAutomaticInteractive,
  });
  if (this.lastAppliedIgnoreMouseEvents === policy.ignoreMouseEvents) return;
  this.overlayWindow.setIgnoreMouseEvents(
    policy.ignoreMouseEvents,
    policy.forward ? { forward: true } : undefined,
  );
  this.lastAppliedIgnoreMouseEvents = policy.ignoreMouseEvents;
}
```

在 Overlay 创建后、Windows Overlay 每次显示前，把 `overlayAutomaticInteractive` 重置为 `false` 并同步策略；隐藏或切回 Launcher 时也清除自动交互状态，防止下次显示继承旧命中。

- [ ] **Step 4: 接通 IPC、preload 和类型**

```ts
safeHandle('set-overlay-automatic-interactive', async (_, interactive: boolean) => {
  appState.getWindowHelper().setOverlayAutomaticInteractive(interactive);
  return { success: true };
});
```

```ts
setOverlayAutomaticInteractive: (interactive: boolean) =>
  ipcRenderer.invoke('set-overlay-automatic-interactive', interactive),
```

```ts
// @ipc-channel set-overlay-automatic-interactive
setOverlayAutomaticInteractive: (
  interactive: boolean,
) => Promise<{ success: boolean }>;
```

- [ ] **Step 5: 运行专项测试并确认 GREEN**

Run: `npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/IpcContract.test.mjs electron/services/__tests__/OverlayMouseInteraction.contract.test.mjs`

Expected: 全部 PASS。

### Task 3: Renderer 自动命中与交互锁

**Files:**
- Create: `src/lib/overlayPointerHitTest.ts`
- Create: `src/lib/__tests__/OverlayPointerHitTest.test.mjs`
- Modify: `src/components/NativelyInterface.tsx`
- Modify: `src/components/ui/TopPill.tsx`
- Create: `src/components/__tests__/OverlayAutomaticHitTesting.contract.test.mjs`

**Interfaces:**
- Produces: `isOverlayInteractiveTarget(target: unknown): boolean`
- Consumes: `window.electronAPI.platform`
- Consumes: `window.electronAPI.setOverlayAutomaticInteractive(interactive)` from Task 2

- [ ] **Step 1: 写纯逻辑与 Renderer 合同失败测试**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../../..');

function loadModule() {
  const source = fs.readFileSync(path.join(root, 'src/lib/overlayPointerHitTest.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { exports: module.exports, module });
  return module.exports;
}

test('recognizes only targets inside a declared overlay interactive region', () => {
  const { isOverlayInteractiveTarget } = loadModule();
  assert.equal(isOverlayInteractiveTarget({ closest: selector => selector === '[data-overlay-interactive]' ? {} : null }), true);
  assert.equal(isOverlayInteractiveTarget({ closest: () => null }), false);
  assert.equal(isOverlayInteractiveTarget(null), false);
});

test('Overlay registers Windows-only state-change reporting and marks visible surfaces', () => {
  const interfaceSource = read('src/components/NativelyInterface.tsx');
  const pillSource = read('src/components/ui/TopPill.tsx');
  assert.match(interfaceSource, /platform !== 'win32'/);
  assert.match(interfaceSource, /setOverlayAutomaticInteractive/);
  assert.match(interfaceSource, /data-overlay-interactive/);
  assert.match(pillSource, /data-overlay-interactive/);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test src/lib/__tests__/OverlayPointerHitTest.test.mjs src/components/__tests__/OverlayAutomaticHitTesting.contract.test.mjs`

Expected: FAIL，纯逻辑模块、DOM 标记和监听尚不存在。

- [ ] **Step 3: 实现最小命中函数**

```ts
interface ClosestTarget {
  closest(selector: string): unknown;
}

export function isOverlayInteractiveTarget(target: unknown): boolean {
  if (!target || typeof (target as ClosestTarget).closest !== 'function') return false;
  return Boolean((target as ClosestTarget).closest('[data-overlay-interactive]'));
}
```

- [ ] **Step 4: 在 Overlay 注册状态变化监听**

在 `NativelyInterface` 的 effect 中：

```ts
useEffect(() => {
  const api = window.electronAPI;
  if (api?.platform !== 'win32' || !api.setOverlayAutomaticInteractive) return;

  let lastReported: boolean | null = null;
  let pointerLocked = false;
  const report = (interactive: boolean) => {
    if (lastReported === interactive) return;
    lastReported = interactive;
    void api.setOverlayAutomaticInteractive(interactive).catch(() => {});
  };
  const evaluate = (event: MouseEvent) => {
    const hit = isOverlayInteractiveTarget(document.elementFromPoint(event.clientX, event.clientY));
    report(pointerLocked || hit);
  };
  const onMouseDown = (event: MouseEvent) => {
    if (!isOverlayInteractiveTarget(event.target)) return;
    pointerLocked = true;
    report(true);
  };
  const onMouseUp = (event: MouseEvent) => {
    pointerLocked = false;
    evaluate(event);
  };
  const onWindowBlur = () => {
    pointerLocked = false;
    report(false);
  };

  report(false);
  document.addEventListener('mousemove', evaluate);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onWindowBlur);
  return () => {
    report(false);
    document.removeEventListener('mousemove', evaluate);
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('blur', onWindowBlur);
  };
}, []);
```

为 TopPill 的可见根节点和 `shellRef` 对应的主面板增加 `data-overlay-interactive="true"`。不要标记固定 `780px` 的透明外层容器。

- [ ] **Step 5: 运行 Renderer 测试并确认 GREEN**

Run: `node --test src/lib/__tests__/OverlayPointerHitTest.test.mjs src/components/__tests__/OverlayAutomaticHitTesting.contract.test.mjs`

Expected: 全部 PASS。

### Task 4: 集成验证与回归收口

**Files:**
- Verify only; no new production files.

**Interfaces:**
- Verifies Tasks 1–3 as one Windows Overlay input path.

- [ ] **Step 1: 运行全部鼠标穿透专项测试**

Run: `npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/OverlayMouseInteractionPolicy.test.mjs electron/services/__tests__/OverlayMouseInteraction.contract.test.mjs electron/services/__tests__/IpcContract.test.mjs && node --test src/lib/__tests__/OverlayPointerHitTest.test.mjs src/components/__tests__/OverlayAutomaticHitTesting.contract.test.mjs`

Expected: exit 0，所有专项测试 PASS。

- [ ] **Step 2: 运行 Electron 类型检查**

Run: `npm run typecheck:electron`

Expected: exit 0。

- [ ] **Step 3: 运行 Renderer/生产构建**

Run: `npm run build`

Expected: exit 0。

- [ ] **Step 4: 运行完整测试套件**

Run: `npm test`

Expected: exit 0；若存在与本次无关的既有失败，记录准确数量和测试名，不把它们描述为本次通过。

- [ ] **Step 5: 检查变更边界和格式**

Run: `git diff --check && git status --short`

Expected: 无格式错误；只有计划内文件和用户已有 `.tmp/`。

- [ ] **Step 6: Windows 安装版人工验收**

在 Windows x64 安装版中开始会议并让 Overlay 扩展到最大高度：

1. 在 TopPill、按钮、输入框、菜单和主面板上点击，CueUp 正常响应。
2. 在同一原生窗口矩形内、但位于透明边缘的区域点击和右键，下方应用正常响应。
3. 按 `Ctrl+Shift+B` 后整个 Overlay 穿透；再次按下后恢复自动区域穿透。
4. 隐藏再显示、结束再开始会议，不能继承上一次的交互命中状态。
5. 日志只在状态变化时出现自动/手动策略，不出现坐标或用户内容。
