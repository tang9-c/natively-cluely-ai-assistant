# Skill Usage Phase 2 Design

> **Status:** Approved for implementation planning
> **Date:** 2026-06-26
> **Branch:** `codex/skill-usage-phase-1`
> **Phase 1 baseline:** `SkillActivationManager`, budgeted `SkillsManager.buildPromptBlock()`, realtime `WhatToAnswerLLM` activation, skill settings IPC/UI.

## Goal

Phase 2 extends skill usage beyond realtime "what should I say" suggestions into:

1. Main chat consumption of existing skill activations.
2. A transcript watcher that can semi-automatically activate or suggest skills.

Phase 2 does not implement post-call skill artifacts, summary rewrites, or `/skill` and `$skill` explicit chat prefixes.

## Confirmed Product Decisions

| Decision | Result |
| --- | --- |
| Watcher behavior | Semi-automatic: high confidence activates, medium confidence suggests |
| Watcher default | Disabled by default |
| Main chat explicit prefixes | Not implemented in Phase 2 |
| Main chat skill source | Existing activations only: defaults, user/UI activation, watcher activation |
| Architecture approach | Activation-first; IPC and engine resolve skills before calling LLMHelper |
| Mode + skill in main chat | Both can be present; mode and skill are not mutually exclusive in main chat |
| Phase 3 boundary | No post-call analyzer, no derived artifacts |

## Architecture

Phase 2 keeps `SkillActivationManager` as the single runtime source of truth for skill activation state. Callers resolve active skills explicitly, then pass the resolved prompt block into the relevant LLM path.

`LLMHelper` should not silently inspect global skill state. It may accept an explicit `activeSkill` option and include it in prompt assembly, but the decision about which skill applies stays outside `LLMHelper`.

```text
Transcript final segments
        |
        v
SkillWatcherService
        |
        +--> high confidence -> SkillActivationManager.activateSkill(...)
        |
        +--> medium confidence -> suggestion list

Main chat IPC
        |
        v
SkillActivationManager.resolveActiveSkill({ requestType: 'chat', latestText })
        |
        v
LLMHelper.streamChat/chatWithGemini(..., { activeSkill })
```

### Responsibilities

| Module | Responsibility |
| --- | --- |
| `SkillActivationManager` | Own activation priority, expiry, resolution for `what_to_answer` and `chat` |
| `SkillWatcherService` | Inspect safe transcript windows and skill summaries; output decisions |
| `ipcHandlers.ts` | Resolve active skill for chat, expose watcher settings and suggestion actions |
| `LLMHelper.ts` | Accept explicit active skill and use shared chat prompt assembly |
| `SkillsSettings.tsx` | Show watcher setting, active skills, suggestions, accept/dismiss actions |

## Main Chat Skill Consumption

Main chat covers:

- `gemini-chat-stream`
- `gemini-chat`

The IPC handler resolves the active skill before calling `LLMHelper`.

```ts
const resolvedSkill = SkillActivationManager.getInstance().resolveActiveSkill({
  requestType: 'chat',
  latestText: message,
});
```

Only the public shape is passed onward:

```ts
type ActiveSkillForPrompt = {
  id: string;
  name: string;
  promptBlock: string;
};
```

Main chat does not parse `/skill-id` or `$skill-id`. If the user types those strings, they remain ordinary chat text in Phase 2.

### Prompt Assembly

Main chat uses this order:

```text
base chat system prompt
> active mode suffix/context, if existing chat path injects it
> active skill block
> user request and context
```

Unlike Phase 1 `WhatToAnswerLLM`, main chat does not make mode and skill mutually exclusive. Mode defines scenario and persona; skill defines the current task/style constraint.

Implementation must not rely on the current `LLMHelper.streamChat()` active-mode injection path to preserve mode for `CHAT_MODE_PROMPT`. Today `CHAT_MODE_PROMPT` is treated as a universal override and skips the generic mode injection path. Phase 2 should add a small shared helper, for example:

```ts
type ActiveSkillForPrompt = {
  id: string;
  name: string;
  promptBlock: string;
};

function buildChatSystemPrompt(input: {
  basePrompt: string;
  activeModePrompt?: string;
  activeSkill?: ActiveSkillForPrompt;
}): string
```

Both streaming and non-streaming main chat paths must use the same helper so `gemini-chat-stream` and `gemini-chat` produce the same system prompt shape. The helper only assembles trusted prompt blocks. Retrieved mode context stays in user context, not system prompt.

Phase 2 should also extend `SkillActivationManager.resolveActiveSkill()` for `requestType: 'chat'`, but chat resolution must only consume existing default/runtime activations. It must not create hotword-triggered activations from chat text, because ordinary typed chat content like "humanize this sentence" should not unexpectedly mutate activation state.

### Failure Behavior

- If skill resolution fails, chat proceeds without skill.
- If skill instructions exceed budget, `SkillsManager.buildPromptBlock(..., { maxTokens })` truncates and includes `skill_instructions_truncated`.
- Logs may include `activeSkillId`, but never raw message, transcript, skill body, or prompt content.

## Watcher Design

`SkillWatcherService` observes final transcript segments through `IntelligenceEngine.handleTranscript()`. It never generates user-visible answers. It only returns structured decisions.

### Inputs

The watcher receives:

- Recent final transcript window, preferably 8-12 segments or about 90 seconds.
- Skill summaries only: `id`, `name`, `description`, `source`.
- Current activation list, to avoid repeated activation/suggestion.
- Current mode/template type if available.
- Speaker hints when available, without making Phase 2 depend on perfect diarization.

It must not read full skill bodies. Full `SKILL.md` instructions are only read later when an activation is consumed.

### Output

```ts
export interface SkillWatcherDecision {
  id: string;
  skillId: string;
  action: 'activate' | 'suggest' | 'ignore';
  scope: 'meeting' | 'ephemeral';
  confidence: number;
  reason: string;
  expiresAt?: number;
}
```

### Thresholds

Defaults live in `SettingsManager`.

```ts
skillsWatcherEnabled?: boolean; // default false
skillsWatcherAutoActivateThreshold?: number; // default 0.86
skillsWatcherSuggestThreshold?: number; // default 0.65
```

Behavior:

- `confidence >= 0.86`: automatically create `ephemeral` activation, default TTL 3 minutes.
- `0.65 <= confidence < 0.86`: store suggestion for user review.
- `< 0.65`: ignore.

### Rate Limits

- Watcher is disabled by default.
- Minimum interval: 45 seconds.
- Do not run if transcript changed too little since the last watcher run.
- Avoid duplicate decisions for the same `skillId` and similar reason within a cooldown window.
- Failure to run watcher must not affect transcript ingestion, realtime suggestions, or chat.

### Decision Source

Phase 2 MVP uses a deterministic local decision provider for the built-in `humanize-ai-text` skill. This keeps the watcher testable, cheap, and safe while the UI and activation lifecycle are still being introduced.

The service may define an internal decision-provider interface so a future cheap-model watcher can be added without rewriting the orchestration. That future LLM provider is not part of Phase 2 implementation. If an LLM watcher is added later, it must remain behind `skillsWatcherEnabled`, return strict JSON, and pass schema validation before any activation or suggestion is created.

The watcher should not call full response-generation APIs that stream user-visible answers.

## IPC and UI

Phase 2 reuses:

- `skills:list-activations`
- `skills:activate`
- `skills:deactivate`
- `skills:get-settings`
- `skills:set-settings`

New watcher APIs:

```text
skills:get-watcher-settings
skills:set-watcher-settings
skills:list-watcher-suggestions
skills:accept-watcher-suggestion
skills:dismiss-watcher-suggestion
```

Renderer preload and `src/types/electron.d.ts` must expose matching methods. All new handlers must use `safeHandle()`.

Watcher suggestions must reach the UI without requiring the user to manually refresh Settings. Phase 2 should add a renderer event:

```text
skill-watcher-suggestion-created
```

The main process emits this event when `SkillWatcherService` stores a new suggestion. `SkillsSettings.tsx` can still call `skills:list-watcher-suggestions` on mount or refresh, but live delivery should be event-driven, matching the app's existing dynamic-action style.

### Settings UI

`SkillsSettings.tsx` adds:

- Watcher enable switch, default off.
- Static threshold copy: high confidence auto-activates, medium confidence suggests.
- Active skill list with cancel controls.
- Watcher suggestion list with accept and dismiss buttons.

The UI must keep explicit bridge guards. No optional-chain silent calls such as `window.electronAPI?.skillsListWatcherSuggestions?.()`.

## Safety and Privacy

- Phase 2 does not execute skill scripts.
- Phase 2 does not read skill assets.
- Watcher input cannot include full skill body.
- Watcher and chat logs cannot contain raw transcript, prompt, skill instructions, screenshots, or LLM response body.
- The only safe log metadata is `skillId`, `source`, `scope`, `confidence`, `action`, and safe error class/message.
- Provider data scope rules still apply to the actual chat LLM call. Skill activation must not bypass provider scope policy.

## Testing Strategy

### Required Unit and Static Tests

- `SkillActivationManager` resolves `requestType: 'chat'`.
- `LLMHelper.streamChat` includes active skill in the system prompt while preserving mode injection.
- `LLMHelper.chatWithGemini` non-streaming path accepts active skill and includes it in prompt assembly.
- `gemini-chat-stream` IPC resolves active skill and passes only `{ id, name, promptBlock }`.
- `gemini-chat` IPC follows the same active skill path.
- `SkillWatcherService` returns `ignore` when disabled.
- Watcher rate limit prevents repeated runs.
- High-confidence watcher decision creates `ephemeral` activation.
- Medium-confidence watcher decision creates a suggestion, not activation.
- Medium-confidence watcher suggestion emits `skill-watcher-suggestion-created`.
- Accepting a watcher suggestion creates activation.
- Dismissing a watcher suggestion prevents immediate repeat.
- `requestType: 'chat'` consumes existing activations but does not create hotword activations from chat text.
- IPC/preload/types tests cover every new watcher channel.
- `SkillsSettings` static tests cover watcher settings and suggestion bridge guards.

### Verification Commands

```bash
rtk npm run build:electron
rtk env ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/SkillActivationManager.test.mjs electron/services/__tests__/SkillsIpcWiring.test.mjs electron/services/__tests__/SkillWatcherService.test.mjs electron/services/__tests__/ChatSkillActivation.test.mjs electron/services/__tests__/IntelligenceEngineSkillWatcher.test.mjs
rtk npm test
rtk npm run build
rtk npm run typecheck:electron
```

Known baseline note from Phase 1 verification: `rtk npm run typecheck:electron` currently fails on `electron/services/knowledge/MaterialRagRetriever.ts:302` implicit `any` parameters. Phase 2 should not add new typecheck failures.

## Non-Goals

- No `/skill` or `$skill` explicit main chat prefix.
- No multi-skill prompt composition.
- No post-call analyzer.
- No `skill_result`, `rewritten_summary`, `follow_up_draft`, or derived artifact persistence.
- No automatic modification of transcript, summary, or user-visible chat history.
- No watcher-generated final answers.

## Open Implementation Notes

- Prefer adding a small `SkillWatcherService` rather than expanding `SkillActivationManager` into watcher orchestration.
- Prefer explicit `activeSkill` options to `LLMHelper` over hidden global reads.
- Keep watcher suggestion storage in memory for Phase 2 unless implementation reveals a strong need for persistence.
- If a future LLM watcher is introduced, start behind the same `skillsWatcherEnabled` setting and keep deterministic tests with a fake decision provider.
