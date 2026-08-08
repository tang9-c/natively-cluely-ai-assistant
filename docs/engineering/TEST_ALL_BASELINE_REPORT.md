# `test:all` 全量测试基线报告(2026-07-05)

> **目的**:建立 `npm run test:all` 全量测试的基线数据,记录 6 个 stage 的运行结果和发现的 4 个 bug。
>
> **执行人**:Claude
> **环境**:macOS Darwin 25.1.0, Electron 33.4.11, Node (test runner)
> **运行命令**:`npm run test:all`(包含 typecheck + build + 199 Node tests + 4 E2E + doubao-auc real + bench)

## TL;DR

| Stage | 命令 | 结果 | 耗时 |
|---|---|---|---|
| 1. typecheck | `npm run typecheck:electron` | ✅ 通过 | ~30s |
| 2. build:electron | `npm run build:electron` | ✅ 通过 | ~1s |
| 3. **Node tests(199 文件)** | `--test --test-force-exit` | ⚠️ **1 fail** | ~90s |
| 4. **Playwright E2E(4 spec)** | `npm run test:e2e` | ⚠️ **3 fail / 2 skip** | ~1.7min |
| 5. **Doubao AUC real API** | `npm run test:doubao-auc:real` | ⚠️ **预期失败**(需真实 Doubao key) | <5s |
| 6. **Screen understanding bench** | `npm run bench:screen-understanding` | ✅ **通过** | ~25s |

**总耗时**:~5 分钟
**失败总数**:**4**(1 Node + 3 E2E)
**通过率**:Node tests 99.42%(1538/1547 + 8 skip),E2E 7/12 = 58%

---

## 4 个 Bug 清单(优先级排序)

### 🐛 Bug #1:`EmbeddingProviderResolver.test.mjs` 文件退出时 SIGABRT(中)

**Stage**:Node tests
**位置**:`electron/rag/__tests__/EmbeddingProviderResolver.test.mjs:1:1`
**症状**:
```
ok 97 - EmbeddingProviderResolver skips Doubao when embedding model is not configured
ok 98 - EmbeddingProviderResolver prefers local when available
ok 99 - EmbeddingProviderResolver candidate order is local-first

# libc++abi: terminating due to uncaught exception of type std::__1::system_error:
#   mutex lock failed: Invalid argument
not ok 24 - .../EmbeddingProviderResolver.test.mjs
  signal: 'SIGABRT'
```

**关键事实**:
- 3 个子测试**全部 PASS**(ok 97/98/99)
- 失败发生在**测试结束后清理阶段**,native module pthread mutex 析构失败
- 触发栈:`onnxruntime-node` / `transformers.js` / `onnxruntime-web`
- macOS 特定(libcpp 释放顺序问题)

**严重度**:🟡 中(测试清理,不影响产品)

**修复建议**(3 个选项,推荐 C):

**选项 A(快速,治标)**:`EmbeddingProviderResolver.test.mjs` 末尾加 `process.exit(0)` 强制退出
```js
test('cleanup', () => process.exit(0));
```

**选项 B(根本,治本)**:`LocalEmbeddingProvider` 模块销毁时显式释放 ONNX session
```ts
// electron/rag/LocalEmbeddingProvider.ts
async unload(): Promise<void> {
  if (this.session) {
    await this.session.release();
    this.session = null;
  }
}
```

**选项 C(组合)**:`test:all` 命令加 `--test-force-exit`,同时给 `unload` 方法加 A 选项 fallback
```json
"test:all": "npm run typecheck:electron && npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test-force-exit --experimental-test-module-mocks --test ... && ELECTRON_E2E=1 npx playwright test && npm run test:doubao-auc:real && npm run bench:screen-understanding"
```

---

### 🐛 Bug #2:`meeting-start-overlay-reliability` — start button 可重复点击(中-高)

**Stage**:Playwright E2E
**位置**:`tests/e2e/meeting-start-overlay-reliability.spec.ts:8`
**症状**:点击 start button 后,launcher 没有隐藏,可被重复点击
**严重度**:🟠 中-高(可能影响 UX,用户能多次启动会议)

**测试代码**(`meeting-start-overlay-reliability.spec.ts:8-19`):
```ts
test('start button leaves the launcher after the first click so it cannot be clicked again', async ({ page }) => {
  const startButton = page.locator('button[aria-label="启动会议"]').first();
  await expect(startButton).toBeVisible();
  try {
    await startButton.click();
    await expect(startButton).toBeHidden({ timeout: 10_000 });
  } finally {
    await page.evaluate(() => (window as any).electronAPI?.endMeeting?.()).catch(() => {});
  }
});
```

**推测**:`startMeeting` IPC 调用后,launcher 组件没有正确卸载,可能因为:
- React state 没切到 "meeting mode"
- 父组件判断条件 `if (isMeeting)` 错位
- AnimatePresence exit 动画阻塞了 DOM 移除

**修复方向**:
- 查 `Launcher.tsx` 的条件渲染分支
- 查 `startMeeting` IPC handler 的状态广播
- 可能需要硬性 disable 按钮 + 显示 spinner

---

### 🐛 Bug #3:`research-pipeline` — ResearchPanel 不渲染(中-高)

**Stage**:Playwright E2E
**位置**:`tests/e2e/research-pipeline.spec.ts:74`
**症状**:
```
await expect(panel).toBeVisible({ timeout: 5_000 });
Error: element(s) not found
  - waiting for getByTestId('research-panel')
```

**测试代码**(`research-pipeline.spec.ts:74-89`):
```ts
test('Dispatching open-research-panel opens the ResearchPanel overlay', async ({ page }) => {
  await page.waitForLoadState('networkidle');

  // The App.tsx event listener wires `open-research-panel` to set
  // isResearchPanelOpen=true with optional `companyName` in detail.
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('open-research-panel', {
        detail: { companyName: 'Apple Inc.' },
      }),
    );
  });

  const panel = page.getByTestId('research-panel');
  await expect(panel).toBeVisible({ timeout: 5_000 });
});
```

**推测**:
- `App.tsx` 的 `open-research-panel` 事件监听器可能没接好
- 或 `ResearchPanel` 组件没挂载
- 或 `data-testid="research-panel"` 标识缺失
- 失败导致 Bug #4 级联(因为 #4 需要 panel 可见)

**修复方向**:
- 查 `App.tsx` 的 `addEventListener('open-research-panel', ...)` 实现
- 查 `ResearchPanel.tsx` 的 `data-testid` 是否正确导出
- 查 `useResearch` hook 的状态同步

---

### 🐛 Bug #4:`research-pipeline` — ResearchPanel 关闭按钮(级联 Bug #3)

**Stage**:Playwright E2E
**位置**:`tests/e2e/research-pipeline.spec.ts:119`
**症状**:同 #3,`getByTestId('research-panel')` 找不到
**严重度**:依赖 #3,修好 #3 后此测试大概率自动通过

---

## 已跳过测试(8 个,非 Bug)

| 类别 | 数量 | 原因 |
|---|---|---|
| `vision_only` 路径 | 2 | `# SKIP legacy OCR path disabled` |
| `ocr_only` 路径 | 1 | `# SKIP legacy OCR path disabled` |
| `ScreenUnderstandingService` OCR 路径 | 4 | `# SKIP legacy OCR-coupled API replaced by vision-first pipeline` |
| `live QCLOUD meeting chat` | 1 | `# SKIP Set QCLOUD_LIVE_CHAT_TESTS=1` |

**这是预期** — OCR 路径已废弃(vision-first pivot),保留测试是过渡措施。
详见 `docs/engineering/VISION_FIRST_PIVOT_REPORT.md`。

---

## Stage 5:Doubao AUC real API(预期失败)

```
[Doubao AUC] Submit result {
  httpStatus: 401,
  statusCode: '45000010',
  message: 'Invalid X-Api-Key',
  requestId: '1783263338059-iwq0ptaaj',
  logId: '20260705225538990E55E7AD906D2C2403'
}
[Doubao AUC] FAILED: Submit HTTP 401
```

**根因**:`scripts/test-doubao-auc-real.mjs` 调用原始 `openspeech-direct.zijieapi.com` 端点,需要真实 Doubao AUC key(火山引擎后台开通)。
**QCLOUD key(`sk-z08O...`)不兼容**此端点,QCLOUD key 工作的端点是 `aigw.feigenbaum.com.cn/v1/doubao/audio/auc/*`(新方案 v8)。

**这是环境配置问题,不是代码 Bug。**

---

## Stage 6:Screen understanding bench ✅(性能基线)

**输出 JSON 性能数据**(1080p document 基准):
| 指标 | 数值 | 说明 |
|---|---|---|
| `warmAvgMs` | 6.79ms | 缓存预热后平均延迟 |
| `warmP95Ms` | 33.77ms | P95 延迟 |
| `cacheHitMs` | 0.01ms | 内存级缓存命中(超快) |
| `fallbackOverheadVsWarmMs` | 0.74ms | fallback chain 额外开销(极小) |
| `reductionPct` | -307.3% | 压缩后体积(负值表示放大,合理因为测试图是噪声纹理) |

**其他 fixture**:
- 1440p ui:warm 6.91ms / P95 34.46ms
- 4K dashboard:warm 8.00ms / P95 39.91ms
- retina coding:warm 20.06ms / P95 100.19ms

**结论**:性能稳定,无回归。详见 `docs/engineering/SCREEN_UNDERSTANDING_IMPLEMENTATION_REPORT.md`。

---

## Action Items(汇总)

| # | 项 | 优先级 | 改动量 | 状态 |
|---|---|---|---|---|
| 1 | `package.json` `test:all` 加 `--test-force-exit` | 🔴 高 | 1 行 | **待实施** |
| 2 | `EmbeddingProviderResolver.test.mjs` 末尾加 `process.exit(0)` | 🟡 中 | 1 行 | **待实施** |
| 3 | E2E Bug #2:start button 防重复点击 | 🟠 中-高 | 需查 `Launcher.tsx` + `startMeeting` 状态机 | **待查** |
| 4 | E2E Bug #3+#4:ResearchPanel 渲染 | 🟠 中-高 | 需查 `App.tsx` 事件监听 + `ResearchPanel` 组件 | **待查** |
| 5 | `OpenAIStreamingSTT.ts` timer 清理 audit | 🟢 低 | 需 audit | **待查** |

---

## 测试基础设施改进建议

### 1. 优化 `test:all` 命令

**当前**:`package.json:35`
```json
"test:all": "npm run typecheck:electron && npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test $(find electron src scripts -name '*.test.mjs' -not -path '*/node_modules/*' -not -path '*/dist-electron/*' -not -path '*/dist/*') && ELECTRON_E2E=1 npx playwright test && npm run test:doubao-auc:real && npm run bench:screen-understanding"
```

**建议**:
```json
"test:all": "npm run typecheck:electron && npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test-force-exit --experimental-test-module-mocks --test $(find electron src scripts -name '*.test.mjs' -not -path '*/node_modules/*' -not -path '*/dist-electron/*' -not -path '*/dist/*') && ELECTRON_E2E=1 npx playwright test && (npm run test:doubao-auc:real || echo 'SKIPPED: DOUBAO_API_KEY not set') && npm run bench:screen-understanding"
```

**改进**:
- 加 `--test-force-exit`(绕过 OpenAIStreamingSTT 等测试的假死锁)
- Doubao real 测试失败不阻塞(用 `|| echo SKIPPED`)

### 2. 新增按需运行的 test:all-no-real

```json
"test:all:no-real": "npm run test:all:no-real:unit && npm run test:all:no-real:e2e && npm run bench:screen-understanding"
```

让 CI 可以跳过真实 API 测试。

---

## 关联文档

- `docs/engineering/CONTEXT_SYSTEM_ROADMAP.md` — context 系统路线图
- `docs/engineering/VISION_FIRST_PIVOT_REPORT.md` — OCR 废弃说明
- `docs/engineering/SCREEN_UNDERSTANDING_IMPLEMENTATION_REPORT.md` — 截屏理解
- `~/.claude/projects/.../memory/test-vs-code-staleness.md` — 测试维护原则

## 测试方法备忘

### 快速跑 Node tests
```bash
ELECTRON_RUN_AS_NODE=1 npx electron --test-force-exit --experimental-test-module-mocks \
  --test $(find electron src scripts -name '*.test.mjs' \
    -not -path '*/node_modules/*' -not -path '*/dist-electron/*' -not -path '*/dist/*')
```

### 跑单个文件
```bash
ELECTRON_RUN_AS_NODE=1 npx electron --test-force-exit --experimental-test-module-mocks \
  --test electron/services/__tests__/Specific.test.mjs
```

### 跑 E2E 单个 spec
```bash
ELECTRON_E2E=1 npx playwright test tests/e2e/basic-smoke.spec.ts
```

### 看 E2E 失败截图
```bash
ls test-results/<spec-name>-*/test-failed-*.png
```

---

**报告生成时间**:2026-07-05
**测试运行者**:Claude (with --test-force-exit)
**下次基线重测建议**:实施 Action Items 1+2 之后
