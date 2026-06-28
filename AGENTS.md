# Natively - Codex Project Guide

## Project-Wide Working Rules

Unless explicitly overridden, these rules apply to all tasks in this project.

Core tendency: for non-trivial work, prefer caution over speed; for trivial tasks, use independent judgment and proceed.

### Rule 1: Think Before Coding

State your assumptions explicitly. When something is uncertain, ask questions instead of guessing blindly.

When ambiguity exists, list the plausible interpretation paths.

If there is a simpler approach, challenge the proposed direction directly.

When confused, pause immediately and clearly identify what is unclear.

### Rule 2: Simplicity First

Use the least amount of code needed to solve the problem. Avoid speculative "just in case" implementation.

Do not implement functionality beyond the stated requirement. Do not force an abstraction for code that is only used once.

Self-check: would a senior engineer consider this implementation over-engineered? If yes, simplify it immediately.

### Rule 3: Surgical Changes

Change only what is absolutely necessary. Clean up only the redundancy or mistakes introduced by your own work.

Do not opportunistically optimize nearby code, comments, or formatting.

Never refactor code that is not causing a problem. Strictly follow the project's existing style.

### Rule 4: Goal-Driven Execution

Define success criteria clearly. Iterate until verification passes.

Do not follow steps rigidly. Define what success looks like and iterate independently toward it.

Clear success criteria give you the ability to execute independently and close the loop.

## Project Overview

Natively is an AI-powered meeting notes and assistant desktop app (v2.7.0).

- **Frontend**: React 18 + Vite + TypeScript + TailwindCSS + Framer Motion
- **Desktop**: Electron, with the main process in TypeScript/CommonJS
- **Native**: Rust (`napi-rs`) for audio capture, keyboard tapping, VAD, silence suppression, and stealth window support
- **Database**: SQLite via `better-sqlite3` plus `sqlite-vec` for RAG vector search
- **STT**: Doubao AUC, local Whisper, local SenseVoice, and local model management
- **LLM**: Codex CLI/service, Doubao, and Natively API routing
- **Intelligence features**: Research, Skills, Dynamic Actions, Profile Intelligence, Material/RAG, Telemetry, and Post-call workflows

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore the codebase.** The graph is faster, cheaper, and gives structural context that file scanning cannot.

### When to use graph tools first

- **Exploring code**: use `semantic_search_nodes` or `query_graph` instead of Grep.
- **Understanding impact**: use impact/flow graph tools when available instead of manually tracing imports.
- **Code review**: use graph change-review context before reading entire files.
- **Finding relationships**: use `query_graph` with `callers_of`, `callees_of`, `imports_of`, and `tests_for`.
- **Architecture questions**: use graph architecture/community views before suggesting structural changes.

Fall back to `rg`, Glob, or file reads only when the graph does not cover the context you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `get_minimal_context` | Getting fast task-level graph context |
| `semantic_search_nodes` | Finding files, functions, classes, types, or tests by name or keyword |
| `query_graph` | Tracing callers, callees, imports, children, and tests |
| `get_community` | Inspecting graph communities and domain clusters |
| `list_graph_stats` | Confirming graph coverage and freshness |

## Architecture

### Process Model

```text
Electron Main
  main.ts, ipcHandlers.ts, WindowHelper.ts
  LLMHelper.ts, IntelligenceEngine.ts, ProcessingHelper.ts
  DatabaseManager, SettingsManager, CredentialsManager
  ModesManager, SkillsManager, LocalModelManager
  DynamicActionEngine/Detector/Store
  RAGManager, MaterialRagRetriever, KnowledgeMaterialService
  TelemetryService, PostCallWorkflow

Renderer
  App.tsx router and multi-window entry
  NativelyInterface, SettingsOverlay, Launcher, overlays
  ModesSettingsBase, SkillsSettings, AI provider and local model settings
  DynamicActionBar/Card, ResearchPanel, Profile visualizer/cards

Native Module
  microphone and speaker capture
  VAD, silence suppression, keyboard tap, stealth window helpers
```

### Window Types

The app creates multiple `BrowserWindow` instances distinguished by `?window=` query param:

| Window | Query Param | Purpose |
|--------|-------------|---------|
| Launcher | default | Global shortcut-triggered input window |
| Overlay | `?window=overlay` | Floating meeting assistance overlay |
| Settings | `?window=settings` | Full settings panel |
| Model Selector | `?window=model-selector` | LLM model picker popup |
| Cropper | `?window=cropper` | Screenshot region selection |

### Provider Routing

`ProviderRouter.ts` implements capability-based routing. Callers specify:

- `capability`: `chat`, `stream_chat`, `structured`, or `vision`
- `availability`: which providers are configured
- `dataScopes`: what data the request carries, such as transcript, screenshots, or reference files
- `scopePolicy`: per-provider opt-in/opt-out for data scopes

Always use `routeWithScopeFallback()` or `assertProviderDataScopes()` when routing provider calls. Do not hardcode provider selection.

### Modes, Intents, and Dynamic Actions

- Mode-specific behavior is coordinated through `ModesManager`, mode settings UI, intent classification, and dynamic action services.
- The mode settings UI can maintain intent keywords, but keyword persistence alone is not enough. New or changed intents must also be reflected in classifier candidates, regex/keyword matching, intent-to-action mapping, dynamic action trigger packs, and tests.
- Sales, FDE, and General modes must stay aligned across default intent keywords, `IntentClassifier`, `IntentKeywordDefaults`, `IntentClassifierShared`, and `electron/services/dynamic-actions/*`.
- FDE mode has dedicated intent directions for discovery, integration, security, risk, success, and next-step actions.
- General mode custom intents should map to dynamic actions when those actions are expected to surface in the UI.

### RAG, Research, and Materials

- `EmbeddingPipeline.ts`: generates embeddings through configured providers.
- `VectorStore.ts`: stores vectors with sqlite-vec.
- `RAGRetriever.ts` and `MaterialRagRetriever.ts`: retrieve semantic context.
- `SemanticChunker.ts`: chunks documents for retrieval.
- `LiveRAGIndexer.ts`: indexes live transcript context.
- Research services build and cache company dossiers for profile intelligence and meeting context.

## Code Style and Conventions

### TypeScript

- **Renderer** (`src/`): ESM, `jsx: "react-jsx"`, strict mode.
- **Main** (`electron/`): CommonJS, `moduleResolution: "node"`.
- **Native** (`native-module/`): Rust with `napi-rs`.
- Path aliases: `@/*` -> `src/*`, `@hooks/*` -> `src/hooks/*`, `@config/*` -> `src/config/*`.

### React

- Use function components and hooks.
- Use `React.FC` or plain typed component functions.
- Style with TailwindCSS utilities and `cn()` from `src/lib/utils.ts`.
- Use Framer Motion for animations and Radix UI primitives where available.
- Use `lucide-react` icons for button and control affordances.

### Electron Main Process

- Singleton-style services commonly expose `getInstance()`.
- IPC handlers should register through `safeHandle(channel, listener)`.
- Window lifecycle belongs in `WindowHelper`; do not create `BrowserWindow` directly elsewhere.
- Avoid `app.getPath()` at module load time. Use lazy getters after Electron is ready.

### Naming and Imports

- Files: PascalCase for classes/components, camelCase for utilities.
- IPC channels: kebab-case.
- CSS variables: `--bg-sidebar`, `--text-primary`, `--accent-primary`.
- Import groups: external packages, internal aliases, then relative paths.
- Use `import type` for type-only imports.

## Security and Privacy

### Log Redaction

Every log line that may contain user data or credentials must be redacted with `redactForLog()` from `electron/utils/redactForLog.ts`.

- API keys, tokens, JWTs -> `[REDACTED]`
- Raw transcripts, prompts, screenshots, base64 content -> `[REMOVED]`
- Never log `event.body`, `transcript`, `prompt`, `referenceContent`, screenshots, dynamic action evidence, or provider credentials verbatim.

### Credential Storage

- `CredentialsManager` uses Electron `safeStorage` for encryption at rest.
- Credentials live under `app.getPath('userData')`, not renderer state, localStorage, or plain text files.

### Data Scope Policy

Providers can be restricted from receiving scopes such as `transcript`, `screenshots`, `reference_files`, `profile_history`, `embeddings`, and `post_call_summary`.

Respect `ProviderDataScopePolicy` in all LLM calls, post-call workflows, telemetry emission sites, and dynamic action payload construction.

## Development Workflow

### Commands

```bash
# Dev
npm start                  # Vite + Electron app dev flow
npm run app:dev            # Explicit app dev command
npm run dev                # Vite only
npm run electron:dev       # Build Electron main and launch Electron in development

# Build
npm run build              # clean + TypeScript + Vite production build
npm run build:electron     # Compile Electron main process through scripts/build-electron.js
npm run build:electron:tsc # TypeScript build for electron/
npm run app:build          # Full app build, native artifacts, electron-builder, unsigned macOS release prep
npm run dist               # Alias for app:build

# Native
npm run ensure:native
npm run build:native
npm run rebuild:native

# Type check
npm run typecheck:electron

# Tests
npm test
npm run test:modes
npm run test:modes:no-build
npm run test:modes:collect-fixtures
npm run test:modes:e2e
npm run test:modes:long
npm run test:e2e
npm run test:e2e:headed
npm run test:e2e:parity
npm run test:doubao-auc:real
npm run bench:screen-understanding

# Watch
npm run watch
```

### Environment Variables

Create `.env` in the project root when local credentials are needed. The active codebase primarily uses stored credentials and local model settings, but local development may use:

```bash
DOUBAO_API_KEY=...
NATIVE_API_KEY=...
USE_OLLAMA=false
OLLAMA_MODEL=...
OLLAMA_URL=http://localhost:11434
```

In production, credentials are loaded from `CredentialsManager` after `app.whenReady()`.

### Database

- SQLite file: `app.getPath('userData')/natively.db`.
- Schema migrations happen automatically in `DatabaseManager.init()`.
- `sqlite-vec` is loaded for vector search.

### Adding a New IPC Channel

1. Add the type to `ElectronAPI` in `electron/preload.ts`.
2. Expose the API through `contextBridge.exposeInMainWorld`.
3. Register the handler in `electron/ipcHandlers.ts` using `safeHandle()`.
4. Consume the channel through `window.electronAPI`.

### Adding or Changing a Mode Intent

1. Update default intent keywords and any mode settings defaults.
2. Update classifier candidates, labels, and keyword/regex matching.
3. Update intent-to-action mapping and dynamic action trigger packs.
4. Update renderer expectations if the action appears in `DynamicActionBar`.
5. Add or update mode tests that prove the intent triggers.

### Adding a New Setting

1. Add the default to `SettingsManager` or the owning service.
2. Add IPC get/set handlers as needed.
3. Update preload types and `electron.d.ts` when the renderer consumes it.
4. Add UI in the appropriate settings component.

## Key Files Reference

| File | Purpose |
|------|---------|
| `electron/main.ts` | App bootstrap, window creation, auto-updater |
| `electron/ipcHandlers.ts` | IPC channel registration |
| `electron/preload.ts` | contextBridge API exposure |
| `electron/WindowHelper.ts` | Window lifecycle and positioning |
| `electron/LLMHelper.ts` | LLM client management, prompt assembly, streaming |
| `electron/IntelligenceEngine.ts` | Meeting intelligence orchestration |
| `electron/ProcessingHelper.ts` | Screenshot and analysis pipeline orchestration |
| `electron/llm/ProviderRouter.ts` | Capability and data-scope based provider routing |
| `electron/llm/IntentClassifier.ts` | Intent classification |
| `electron/llm/IntentKeywordDefaults.ts` | Default mode intent keywords |
| `electron/llm/IntentClassifierShared.ts` | Shared intent utilities and mappings |
| `electron/services/ModesManager.ts` | Mode definitions, persistence, and settings |
| `electron/services/dynamic-actions/` | Dynamic action detection, storage, and execution |
| `electron/services/SkillsManager.ts` | Skills persistence and IPC-facing behavior |
| `electron/services/LocalModelManager.ts` | Local model metadata and lifecycle |
| `electron/services/CodexCliService.ts` | Codex CLI/service integration |
| `electron/services/telemetry/TelemetryService.ts` | Safe telemetry emission |
| `electron/services/post-call/PostCallWorkflow.ts` | Post-call summary workflow |
| `electron/services/knowledge/MaterialRagRetriever.ts` | Material-aware RAG retrieval |
| `electron/rag/RAGManager.ts` | RAG orchestration |
| `electron/db/DatabaseManager.ts` | SQLite schema, migrations, and queries |
| `src/App.tsx` | Renderer entry router |
| `src/components/NativelyInterface.tsx` | Main launcher UI |
| `src/components/SettingsOverlay.tsx` | Settings shell |
| `src/components/settings/ModesSettingsBase.tsx` | Mode settings UI |
| `src/components/settings/SkillsSettings.tsx` | Skills settings UI |
| `src/components/dynamic-actions/` | Dynamic action renderer UI |
| `src/components/research/` | Research UI |
| `src/components/profile/` | Profile intelligence UI |
| `src/components/LocalWhisperModelPanel.tsx` | Local Whisper model UI |
| `src/components/LocalSenseVoiceModelPanel.tsx` | Local SenseVoice model UI |
| `native-module/src/lib.rs` | Rust napi-rs entry point |
| `native-module/src/vad.rs` | Voice activity detection |
| `native-module/src/silence_suppression.rs` | Silence suppression |
| `native-module/src/keyboard_tap.rs` | Keyboard tap support |

## Testing

- **Unit**: Electron-run Node tests for `electron/services`, `electron/llm`, and `electron/rag`.
- **Modes**: Dedicated mode and profile intelligence suites, including long-session and fixture flows.
- **E2E**: Playwright-driven Electron scenarios.
- **Provider checks**: Real Doubao AUC smoke test is available through `npm run test:doubao-auc:real`.

Always add or update tests for new IPC handlers, mode intents, provider integrations, local model behavior, telemetry emission sites, and dynamic action behavior.

## Common Pitfalls

1. **Do not call `app.getPath()` at module load time**. Use lazy getters after Electron is ready.
2. **Do not create BrowserWindow outside `WindowHelper`**.
3. **Do not skip log redaction**. User content and credentials must go through `redactForLog()`.
4. **Do not hardcode provider selection**. Use provider routing and data-scope checks.
5. **Do not store credentials in renderer state**. Use `CredentialsManager`.
6. **IPC channels must be unique**. Register with `safeHandle()`.
7. **Database queries are synchronous**. Wrap `better-sqlite3` calls in try/catch.
8. **Mode intent changes are cross-cutting**. Update defaults, classifier, mappings, dynamic actions, UI expectations, and tests together.
9. **STT provider behavior must stay normalized**. Use the registry and diagnostics paths instead of special-casing call sites.
10. **Telemetry and post-call workflows must stay privacy-safe**. Do not emit raw transcripts, prompt bodies, screenshots, or evidence text.
