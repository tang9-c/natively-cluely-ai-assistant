# Research Pipeline (公司情报调研) — Design Spec

**Date**: 2026-06-19
**Status**: Approved (brainstorming complete, ready for implementation plan)
**Path chosen**: A — 完整实现

## Context

Natively 项目中的 "公司情报调研"（Company Research）功能在源码中**不可用**。当前状态：

- ✅ UI 骨架已存在（`ProfileIntelligenceSettings.tsx` 已有 dossier 渲染区，"立即调研"按钮）
- ✅ TypeScript 类型契约已定义（`ScenarioDocSubtype.company-research`、`profileResearchCompany` 签名）
- ✅ Preload 桥接已暴露（`electron/preload.ts:602,1769`）
- ✅ IPC channel 已注册（`electron/ipcHandlers.ts:3655`）
- ❌ IPC handler 是 stub，永远返回 `{success:false, error:"not yet available"}`
- ❌ `CompanyResearchEngine` 不存在，`ProfileOrchestrator.ts` 没有 `getCompanyResearchEngine` 方法
- ❌ Search providers 是 placeholder（`TavilySearchProvider.ts:12`、`NativelySearchProvider.ts:12` 注释："MVP placeholder — out of scope"）
- ❌ 无测试覆盖

本设计文档定义 Research 管道的完整实现，从 stub 替换为可用的端到端管道。

## Goals

1. **真正可用的公司情报调研**：用户输入公司名 → 拿到结构化 6 维度 dossier
2. **不依赖外部搜索时仍能工作**：Tavily 失败时降级到 LLM 自由生成（带明确标识）
3. **避免重复扣费**：24h TTL 缓存，按公司名共享
4. **审计透明**：每条要点可追溯到引用源
5. **覆盖完整测试**：单元 + IPC + E2E

## Non-Goals

- **追问/对话功能**：dossier 一次性输出，不支持 followup 问题
- **多语言**：dossier 默认跟随用户输入语言（用户输入中文公司名→中文报告）；不做跨语言翻译
- **多模态调研**：不解析图片、视频、PDF 中的信息
- **离线模式**：必须联网（Tavily + LLM API）
- **可视化图表**：dossier 用 bullet points + 引用链接，不画图
- **重新设计 `TavilySearchProvider` 接口**：原 placeholder 文件存在但接口设计未定义，本期一并重新设计接口（覆盖原文件）

## User Decisions (8 项澄清)

| # | 决策点 | 选定 |
|---|---|---|
| 1 | 搜索数据源 | 仅 Tavily（无 Natively fallback） |
| 2 | Dossier 结构 | 6 个通用维度（财务、业务、战略、人、技术、采购）—— **不局限于面试场景** |
| 3 | 缓存策略 | 按公司名 24h TTL |
| 4 | Quota 控制 | 仅依赖 Tavily 报错，无本地额外限额 |
| 5 | UI 入口 | 独立面板 + ProfileIntelligenceSettings 快捷入口 |
| 6 | 追问对话 | 不支持，一次性输出 |
| 7 | 降级策略 | Tavily 失败 → LLM 自由生成（带 `source: 'llm-fallback'` 标记） |
| 8 | 测试覆盖 | 单元 + IPC + E2E |

## Architecture

### Module Tree

```
electron/services/research/
├── CompanyResearchEngine.ts        # 核心调度器
├── TavilySearchProvider.ts         # 替换 placeholder
├── CompanyResearchCache.ts         # SQLite 缓存层
├── ResearchDossierBuilder.ts       # LLM 综合 dossier
├── types.ts                        # CompanyDossier, ResearchDimension, etc.
└── __tests__/
    ├── CompanyResearchEngine.test.mjs
    ├── TavilySearchProvider.test.mjs
    ├── CompanyResearchCache.test.mjs
    ├── ResearchDossierBuilder.test.mjs
    └── CompanyResearchFlow.test.mjs

src/components/research/
├── ResearchPanel.tsx               # 顶层容器
├── ResearchInput.tsx               # 输入 + 提交
├── ResearchProgress.tsx            # 进度展示
├── ResearchDimension.tsx           # 单维度可折叠卡片
├── ResearchErrorBanner.tsx         # 错误展示
└── ResearchFallbackBanner.tsx      # fallback 标识

src/hooks/
└── useResearch.ts                  # React hook 封装 IPC 调用

tests/e2e/
└── research-pipeline.spec.ts       # Playwright E2E
```

### Integration Points

| 文件 | 变更 |
|---|---|
| `electron/services/profile/ProfileOrchestrator.ts` | 新增 `getCompanyResearchEngine()` 和 `runCompanyResearch(companyName, opts)` |
| `electron/ipcHandlers.ts:3655` | 替换 stub 为真实实现 |
| `electron/preload.ts:602,1769` | 新增 `forceRefresh` 选项，更新类型 |
| `electron/preload.ts` | 新增 `profileClearResearchCache()`、`testTavilyApiKey(key)` 桥接 |
| `electron/db/DatabaseManager.ts` | v18 migration：新增 `company_research_cache` 表 |
| `src/types/electron.d.ts:429` | 更新 `ProfileResearchCompanyResponse` 类型（新增 `cached`, `forceRefresh`） |
| `src/App.tsx` | 注册 `ResearchPanel` 路由 + 监听 `open-research-panel` 事件 |
| `src/components/ProfileIntelligenceSettings.tsx` | 新增"在新面板中调研"按钮，dispatch custom event |
| `src/components/SettingsOverlay.tsx` | 新增 `research` tab：含 Tavily API key 输入 |

### ProfileOrchestrator 扩展

在现有 `ProfileOrchestrator.ts`（262 行）上**新增两个方法**，不破坏现有 15 个方法：

```ts
// 懒加载引擎实例
private researchEngine: CompanyResearchEngine | null = null;
private getResearchEngine(): CompanyResearchEngine {
  if (!this.researchEngine) {
    this.researchEngine = new CompanyResearchEngine(
      new TavilySearchProvider(/* API key getter */),
      new CompanyResearchCache(this.db),
      new ResearchDossierBuilder(this.llmHelper),
    );
  }
  return this.researchEngine;
}

async runCompanyResearch(
  companyName: string,
  options: { forceRefresh?: boolean; onProgress?: (p: ResearchProgress) => void } = {},
): Promise<ProfileResearchCompanyResponse> {
  // 1. Validate input
  const trimmed = companyName.trim();
  if (!trimmed || trimmed.length > 100) {
    return { success: false, error: '请输入有效的公司名（1-100 字符）' };
  }
  // 2. Check Tavily key
  if (!CredentialsManager.getInstance().getTavilyApiKey()) {
    return { success: false, error: '请在 Settings → Research 中配置 Tavily API key' };
  }
  // 3. Delegate to engine
  return this.getResearchEngine().research(companyName, options);
}

// IPC contract requires getCompanyResearchEngine to return engine reference for legacy compat
getCompanyResearchEngine(): CompanyResearchEngine {
  return this.getResearchEngine();
}
```

### Data Model

#### `company_research_cache` Table (v18 migration)

```sql
CREATE TABLE company_research_cache (
  company_name TEXT PRIMARY KEY,        -- normalized (lowercase + trimmed)
  company_name_display TEXT NOT NULL,   -- original casing for display
  dossier_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,           -- ISO 8601
  expires_at TEXT NOT NULL,             -- ISO 8601
  source TEXT NOT NULL,                 -- 'tavily' | 'llm-fallback'
  schema_version TEXT NOT NULL          -- '1.0'
);

CREATE INDEX idx_company_research_expires ON company_research_cache(expires_at);
```

#### TypeScript Types (`electron/services/research/types.ts`)

```ts
export const DOSSIER_SCHEMA_VERSION = '1.0' as const;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CompanyDossier {
  schemaVersion: typeof DOSSIER_SCHEMA_VERSION;
  companyName: string;             // display name
  generatedAt: string;             // ISO 8601
  expiresAt: string;               // ISO 8601
  source: 'tavily' | 'llm-fallback';
  financials: ResearchDimension;
  business: ResearchDimension;
  strategy: ResearchDimension;
  people: ResearchDimension;
  infrastructure: ResearchDimension;
  procurement: ResearchDimension;
  sources: ResearchSource[];       // empty when source === 'llm-fallback'
}

export interface ResearchDimension {
  summary: string;
  details: ResearchBullet[];
  confidence: 'high' | 'medium' | 'low';
}

export interface ResearchBullet {
  text: string;
  citation?: number;               // 1-based index into sources[]
}

export interface ResearchSource {
  index: number;
  title: string;
  url: string;
  snippet: string;                 // ≤200 chars
}

export interface ResearchProgress {
  stage: 'cache-check' | 'searching' | 'synthesizing' | 'done' | 'error';
  message: string;
}

export interface ProfileResearchCompanyResponse {
  success: boolean;
  dossier?: CompanyDossier;
  cached?: boolean;
  searchQuotaExhausted?: boolean;
  error?: string;
  errorCode?: 'INVALID_INPUT' | 'TAVILY_KEY_MISSING' | 'TAVILY_QUOTA_EXHAUSTED'
            | 'TAVILY_INVALID_KEY' | 'LLM_FAILED' | 'LLM_INVALID_FORMAT' | 'DB_ERROR';
}
```

## Data Flow

### Normal Path (Tavily → LLM)

```
User clicks "调研" in ResearchPanel
  ↓
ResearchPanel.handleSubmit(companyName)
  ↓
window.electronAPI.profileResearchCompany(companyName, { forceRefresh: false })
  ↓ IPC invoke
ipcHandlers 'profile:research-company' handler
  ↓
ProfileOrchestrator.runCompanyResearch(companyName, { onProgress })
  ↓
CompanyResearchEngine.research(companyName, { forceRefresh, onProgress })
  ├─ onProgress({ stage: 'cache-check' })
  ├─ if !forceRefresh:
  │   const cached = await cache.get(companyName)
  │   if cached && !cached.isExpired():
  │     onProgress({ stage: 'done' })
  │     return { success: true, dossier: cached.dossier, cached: true }
  ├─ onProgress({ stage: 'searching' })
  ├─ queries = generateSearchQueries(companyName)  // 6 queries, one per dimension
  ├─ try:
  │   sources = await tavily.search(queries)
  │ catch err:
  │   if isTavilyQuotaError(err):
  │     return { success: false, searchQuotaExhausted: true, error: '...', errorCode: 'TAVILY_QUOTA_EXHAUSTED' }
  │   if isTavilyAuthError(err):
  │     return { success: false, error: '...', errorCode: 'TAVILY_INVALID_KEY' }
  │   // 非 quota/auth 错误：降级
  │   sources = []
  ├─ onProgress({ stage: 'synthesizing' })
  ├─ dossier = await builder.build(companyName, sources)
  │   // 若 sources.length === 0，dossier.source = 'llm-fallback'，confidence 全 'low'
  ├─ cache.put(companyName, dossier)
  ├─ onProgress({ stage: 'done' })
  └─ return { success: true, dossier, cached: false }
  ↓
ResearchPanel receives response
  ├─ success → render 6 dimensions
  ├─ quota → "Tavily 额度已用完"
  └─ other error → banner
```

### Fallback Path

```
Tavily.search() throws non-quota error
  ↓
sources = []
  ↓
ResearchDossierBuilder.build(companyName, sources=[])
  ├─ prompt 包含 explicit 指示："No external sources available. Generate based on training knowledge only. Mark all confidence as 'low'."
  ├─ LLM 返回 6 维度 dossier
  └─ dossier.source = 'llm-fallback' (覆盖 LLM 输出)
  ↓
cache.put(companyName, dossier)  // 缓存 fallback 结果，避免每次重试 Tavily
  ↓
UI 顶部显示 ResearchFallbackBanner: "⚠️ 本报告未经过实时搜索验证"
```

### Cache Invalidation

- `cache.get()` 读 SQLite
- `isExpired()` 比较 `expiresAt` 与 `Date.now()`
- 过期 → 视为 miss，重新走搜索+LLM
- **Schema version mismatch → 强制失效**（即使未过期）：`if (row.schema_version !== '1.0') return null`
- **Prune 懒触发**：`cache.get()` 发现过期条目时异步 prune

## Error Handling Matrix

| 错误来源 | 检测 | 处理 | errorCode | 用户看到 |
|---|---|---|---|---|
| 公司名空 / >100 chars | 字符串检查 | 立即返回 | `INVALID_INPUT` | "请输入有效的公司名（1-100 字符）" |
| Tavily key 未配置 | `CredentialsManager.getTavilyApiKey() === null` | 立即返回 | `TAVILY_KEY_MISSING` | "请在 Settings → Research 中配置 Tavily API key" |
| Tavily 网络超时 | fetch timeout 10s | 降级到 LLM-fallback | (none, success=true) | 黄色 banner |
| Tavily 429 / quota body | HTTP 429 或 `body.quota_exceeded === true` | 立即返回 | `TAVILY_QUOTA_EXHAUSTED` | "Tavily 额度已用完，请在 Tavily 控制台升级或等待下月重置" |
| Tavily 5xx | HTTP 500/502/503 | 重试 1 次（1s 后）→ 仍失败则降级 | (none) | 黄色 banner |
| Tavily 401/403 | HTTP 401/403 | 立即返回 | `TAVILY_INVALID_KEY` | "Tavily API key 无效，请检查设置" |
| LLM 抛错 | ProviderRouter throws | 立即返回 | `LLM_FAILED` | "AI 综合失败：{message}" |
| LLM 返回结构非法 | Zod schema 失败 | 重试 1 次（调整 prompt）→ 仍失败则返回 | `LLM_INVALID_FORMAT` | "AI 返回格式异常，请重试" |
| SQLite 错误 | DB throws | 立即返回 | `DB_ERROR` | "本地缓存读写失败：{message}" |

### Logging Policy

- 所有错误日志经 `redactForLog()` 处理
- **绝不记录**：Tavily API key、Tavily 原始响应、LLM prompt、dossier 全文
- **可记录**：错误 message、错误 code、公司名（normalize 后）、耗时、cache hit/miss

## UI Design

### `ResearchPanel.tsx` Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Research · 公司情报调研                              [✕]    │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│  [公司名称输入框____________________]  [🔍 立即调研]          │
│                                                                │
│  ── 进度（loading 时显示）───────────────────────────        │
│  ● 正在检查缓存...                                             │
│  ● 正在搜索（6/6 完成）...                                    │
│  ● 正在综合 AI 报告...                                        │
│                                                                │
│  ── 报告（success 时显示）───────────────────────────         │
│  ⚠️ 本报告未经过实时搜索验证，仅基于模型知识（fallback only） │
│                                                                │
│  Apple Inc. · 2026-06-19 14:30 生成 · 缓存中（23h 有效）     │
│                                                                │
│  ▾ 经营实力 (Financials) · confidence: high                   │
│     • 全球员工约 164,000 人（2024）[1]                          │
│     • 年营收约 3,830 亿美元（FY2024）[1]                       │
│     ...                                                        │
│     引用：                                                    │
│       [1] Apple 2024 Annual Report — apple.com                │
│                                                                │
│  ▾ 业务版图 (Business) · confidence: high                     │
│     ...                                                        │
│                                                                │
│  ... (其他 4 个维度同结构) ...                                │
│                                                                │
│                                          [🔄 强制刷新]         │
└──────────────────────────────────────────────────────────────┘
```

### Component Breakdown

| 组件 | 职责 | 关键 props |
|---|---|---|
| `ResearchPanel` | 顶层容器 + 状态机 (`idle \| loading \| success \| error`) | `isOpen`, `initialCompanyName`, `onClose` |
| `ResearchInput` | 受控输入 + 提交按钮 | `onSubmit`, `disabled` |
| `ResearchProgress` | 按 `stage` 显示对应文案 | `stage`, `message` |
| `ResearchDimension` | 单维度可折叠卡片（`<details>` 原生） | `dimension`, `title`, `confidence` |
| `ResearchErrorBanner` | 错误展示 | `error`, `errorCode`, `onRetry` |
| `ResearchFallbackBanner` | 黄色提示 | `dossier` |

### Interaction Details

- 输入框空 → 提交按钮 disabled
- 加载中 → 输入框 disabled + 按钮 spinner + "调研中..."
- 维度卡片默认展开，点击折叠
- 引用链接 `target="_blank" rel="noopener"`
- "强制刷新" → `{ forceRefresh: true }`，跳过缓存

### ProfileIntelligenceSettings Integration

在已有 dossier 卡片下方添加：
```tsx
<button onClick={() => window.dispatchEvent(new CustomEvent(
  'open-research-panel',
  { detail: { companyName: profileData.activeJD.company } }
))}>
  在新面板中调研此公司 →
</button>
```

### App.tsx Routing

```tsx
const [isResearchPanelOpen, setIsResearchPanelOpen] = useState(false);
const [initialCompanyName, setInitialCompanyName] = useState('');

useEffect(() => {
  const handler = (e: CustomEvent) => {
    setInitialCompanyName(e.detail.companyName);
    setIsResearchPanelOpen(true);
  };
  window.addEventListener('open-research-panel', handler);
  return () => window.removeEventListener('open-research-panel', handler);
}, []);

<AnimatePresence>
  {isResearchPanelOpen && (
    <ResearchPanel
      isOpen={isResearchPanelOpen}
      initialCompanyName={initialCompanyName}
      onClose={() => setIsResearchPanelOpen(false)}
    />
  )}
</AnimatePresence>
```

### SettingsOverlay `research` Tab

新增 tab，含：
- Tavily API key 输入框（password 类型）
- "测试连接" 按钮 → 调用 Tavily `/search?q=test` 验证
- 使用说明："Research 功能使用 Tavily 进行实时搜索。免费额度每月 1000 次。"
- "清除缓存" 按钮 → 调用新 IPC `profile:clear-research-cache`

## IPC Contract

### `profile:research-company` (UPDATED)

```ts
// Before (stub)
safeHandle('profile:research-company', async (_: unknown, _companyName: string) => ({
  success: false,
  error: 'Company research is not yet available...',
}));

// After
safeHandle(
  'profile:research-company',
  async (
    _: unknown,
    companyName: string,
    options: { forceRefresh?: boolean } = {},
  ) => {
    const orchestrator = appState.getKnowledgeOrchestrator();
    return orchestrator.runCompanyResearch(companyName, options);
  },
);
```

### `profile:clear-research-cache` (NEW)

```ts
safeHandle('profile:clear-research-cache', async () => {
  const orchestrator = appState.getKnowledgeOrchestrator();
  const engine = orchestrator.getCompanyResearchEngine();
  return { success: true, deleted: await engine.clearCache() };
});
```

### `profile:test-tavily-key` (NEW)

```ts
safeHandle('profile:test-tavily-key', async (_: unknown, key: string) => {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: 'test', max_results: 1 }),
    });
    if (res.status === 401) return { valid: false, reason: 'Invalid key' };
    if (res.status === 429) return { valid: true, quotaLow: true };
    return { valid: res.ok };
  } catch (err) {
    return { valid: false, reason: 'Network error' };
  }
});
```

## Testing Strategy

### Unit Tests (`electron/services/__tests__/`)

| 文件 | 覆盖 | 关键 mock |
|---|---|---|
| `TavilySearchProvider.test.mjs` | HTTP 调用、query 构造、错误分类 | `fetch` mock |
| `CompanyResearchCache.test.mjs` | get/put、TTL 过期、schema version 不匹配失效、prune | in-memory SQLite |
| `CompanyResearchEngine.test.mjs` | cache hit 跳过搜索、cache miss 走搜索+LLM、quota 错误传播、Tavily 5xx 降级 | TavilyProvider + LLMHelper mock |
| `ResearchDossierBuilder.test.mjs` | sources 非空/为空 prompt 分支、Zod 校验失败重试 | LLMHelper mock |

### IPC Handler Tests (扩展 `ProfileIntelligenceGate.test.mjs`)

| 用例 | 断言 |
|---|---|
| 接受有效公司名 | 不抛错、`success: true` |
| 空公司名 | `success: false`、`errorCode: 'INVALID_INPUT'` |
| 无 Tavily key | `success: false`、`errorCode: 'TAVILY_KEY_MISSING'` |
| Tavily quota exhausted | `success: false`、`searchQuotaExhausted: true`、`errorCode: 'TAVILY_QUOTA_EXHAUSTED'` |
| `forceRefresh: true` | 跳过 cache，调用 Tavily |

### Integration Test (`CompanyResearchFlow.test.mjs`)

| 场景 | 验证 |
|---|---|
| 冷启动首次调研 | cache miss → Tavily → LLM → cache put → dossier 返回 |
| 24h 内二次调研 | cache hit → 直接返回，无 Tavily 调用 |
| Tavily 失败降级 | sources=[] → dossier 仍生成、`source === 'llm-fallback'` |
| Force refresh | 跳过 cache → 强制重新生成 |
| Schema version 不匹配 | 旧 cache 自动失效 |

### E2E Test (`tests/e2e/research-pipeline.spec.ts`)

| 场景 | 操作 | 断言 |
|---|---|---|
| 完整流程 | 启动 app → 配置 Tavily key → 点击 Research 入口 → 输入公司名 → 提交 | 6 维度全部显示、`source === 'tavily'` |
| 缓存命中 | 第二次提交同公司名 | dossier 显示"缓存中"标签 |
| Force refresh | 点击强制刷新 | dossier `generatedAt` 更新 |
| Settings tab | 打开 Settings → Research tab | Tavily key 输入框可见 |
| 无 Tavily key | 删除 key 后提交 | "请配置 Tavily API key" 提示 |

### Coverage Targets

- `electron/services/research/` 目录：line coverage ≥ 80%
- IPC handler：100%（每个分支都有测试）
- 不测：UI 视觉样式（用 role-based selectors 而非样式断言）

## Verification

### Manual Verification

1. `npm run build:electron && npm start`
2. 在 Settings → Research 配置 Tavily key（用真实测试 key）
3. 点击 ProfileIntelligenceSettings 中的"在新面板中调研此公司"
4. 验证：6 维度 dossier 显示、`source === 'tavily'`、引用链接可点击
5. 立即再次点击同公司 → 验证 dossier 显示"缓存中"且 `cached: true`
6. 点击强制刷新 → 验证 dossier `generatedAt` 更新
7. 删除 Tavily key → 提交 → 验证 "请配置 Tavily API key" 错误

### Automated Verification

```bash
npm test                                              # 单测 + IPC 测试
npm run test:e2e -- research-pipeline.spec.ts         # E2E
npm run typecheck:electron                            # 类型检查
```

### Acceptance Criteria

- ✅ 点击"调研"后 ≤ 30s 内显示 dossier（缓存命中 ≤ 1s）
- ✅ Tavily 调用失败不阻塞用户（降级到 fallback）
- ✅ 同一公司 24h 内只调用一次 Tavily（除非强制刷新）
- ✅ 6 个维度全部有内容（即使 fallback 也有 LLM 生成的要点）
- ✅ 引用源链接真实有效（来自 Tavily 响应，非 LLM 捏造）
- ✅ 所有错误路径有用户可读的中文提示

## Critical Files to Modify

| 文件 | 性质 | 预估行数 |
|---|---|---|
| `electron/services/research/CompanyResearchEngine.ts` | 新建 | ~150 |
| `electron/services/research/TavilySearchProvider.ts` | 新建（替换 placeholder） | ~120 |
| `electron/services/research/CompanyResearchCache.ts` | 新建 | ~80 |
| `electron/services/research/ResearchDossierBuilder.ts` | 新建 | ~150 |
| `electron/services/research/types.ts` | 新建 | ~80 |
| `electron/services/profile/ProfileOrchestrator.ts` | 改（+30 行） | +30 |
| `electron/ipcHandlers.ts` | 改（替换 stub + 2 个新 handler） | +40 |
| `electron/preload.ts` | 改（更新类型 + 新增 2 个 API） | +20 |
| `electron/db/DatabaseManager.ts` | 改（v18 migration） | +30 |
| `src/types/electron.d.ts` | 改（更新 ProfileResearchCompanyResponse） | +10 |
| `src/components/research/ResearchPanel.tsx` | 新建 | ~200 |
| `src/components/research/ResearchInput.tsx` | 新建 | ~50 |
| `src/components/research/ResearchProgress.tsx` | 新建 | ~40 |
| `src/components/research/ResearchDimension.tsx` | 新建 | ~80 |
| `src/components/research/ResearchErrorBanner.tsx` | 新建 | ~40 |
| `src/components/research/ResearchFallbackBanner.tsx` | 新建 | ~30 |
| `src/hooks/useResearch.ts` | 新建 | ~60 |
| `src/App.tsx` | 改（注册 ResearchPanel + event listener） | +25 |
| `src/components/ProfileIntelligenceSettings.tsx` | 改（+快捷入口） | +15 |
| `src/components/SettingsOverlay.tsx` | 改（+research tab） | +120 |
| `electron/services/__tests__/CompanyResearch*.test.mjs` × 4 | 新建 | ~400 |
| `electron/services/__tests__/ProfileIntelligenceGate.test.mjs` | 扩展 | +50 |
| `tests/e2e/research-pipeline.spec.ts` | 新建 | ~150 |

**总预估**：约 1900 行（含测试）

## Migration Plan

### v18 Migration (in `DatabaseManager.ts`)

```ts
// In init() / runMigrations() chain
db.exec(`
  CREATE TABLE IF NOT EXISTS company_research_cache (
    company_name TEXT PRIMARY KEY,
    company_name_display TEXT NOT NULL,
    dossier_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    source TEXT NOT NULL,
    schema_version TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_company_research_expires ON company_research_cache(expires_at);
`);
```

迁移逻辑放在现有 v17 → v18 增量迁移中，向后兼容（旧 DB 自动升级）。

### Cleanup of Dead Code

清理 `dist-electron-test-isolated/electron/services/profile/ProfileOrchestrator.js` 中残留的死方法（这些方法在 TS 源中已被移除，仅存在于过时 dist 产物中）。可通过 `rm -rf dist-electron-test-isolated/` 触发重新构建来清理。

### Phased Rollout (建议)

**Phase 1（核心管道 + 单元测试）**：TavilySearchProvider、CompanyResearchEngine、CompanyResearchCache、ProfileOrchestrator 扩展、IPC handler 替换 stub、单测
**Phase 2（UI + E2E）**：ResearchPanel 组件族、App.tsx 路由、ProfileIntelligenceSettings 快捷入口、SettingsOverlay research tab、E2E 测试

两阶段可在同一 PR 中提交，也可分两个 PR 以便独立 review。