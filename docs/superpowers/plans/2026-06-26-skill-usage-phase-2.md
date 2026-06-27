# Skill Usage Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend skill usage from realtime suggestions into main chat consumption and a disabled-by-default transcript watcher that can activate or suggest skills.

**Architecture:** Keep `SkillActivationManager` as the single runtime source of truth. Chat IPC resolves an explicit active skill before calling `LLMHelper`; `LLMHelper` only assembles prompt text from the explicit public skill shape it is given. `SkillWatcherService` observes final transcript windows, uses deterministic local matching for the built-in humanize skill, and exposes settings/suggestions through IPC and live renderer events.

**Tech Stack:** Electron main process TypeScript/CommonJS, React 18 renderer, Vite, Node test runner, SQLite-backed settings via existing managers, IPC through `safeHandle()`, preload `contextBridge`, `lucide-react` UI icons where already used.

## Global Constraints

- Current worktree: `/Users/tang-codeing/code/natively-cluely-ai-assistant/.worktrees/skill-usage-phase-1`
- Current branch: `codex/skill-usage-phase-1`
- Main chat explicit `/skill` and `$skill` prefixes are not implemented in Phase 2.
- Main chat consumes only existing activations: default, user/UI, watcher-created.
- `requestType: 'chat'` must not create hotword activations from chat text.
- Mode and skill can both be present in main chat.
- Watcher is disabled by default.
- Watcher thresholds: auto activate at `>= 0.86`, suggest at `>= 0.65` and `< 0.86`, ignore below `0.65`.
- Watcher high-confidence decisions create `ephemeral` activations with the existing default 3 minute TTL.
- Watcher MVP uses deterministic local matching for the built-in `humanize-ai-text` skill.
- Watcher never reads full skill bodies; it uses summaries only.
- Phase 2 does not implement post-call artifacts, post-call analyzer, or generated skill-derived summaries.
- New IPC handlers must use `safeHandle()`.
- Renderer code must keep explicit bridge guards such as `typeof window.electronAPI?.method !== 'function'`.
- Logs may include `skillId`, `source`, `scope`, `confidence`, `action`, and safe error messages only.
- Do not log raw chat messages, transcript, skill instructions, screenshots, prompt content, or LLM response bodies.
- Use `rtk` before verification commands in this repository.

---

## File Structure

- `electron/services/SkillActivationManager.ts`: extend existing activation resolution to support `requestType: 'chat'` without hotword mutation.
- `electron/llm/chatPromptAssembly.ts`: create the shared prompt assembly helper and public active-skill type used by streaming and non-streaming chat.
- `electron/LLMHelper.ts`: accept optional explicit chat prompt inputs and use `buildChatSystemPrompt()` in streaming and non-streaming chat paths.
- `electron/ipcHandlers.ts`: resolve active chat skills, pass only `{ id, name, promptBlock }`, and add watcher IPC handlers.
- `electron/services/SkillWatcherService.ts`: create deterministic watcher settings, decisions, suggestion state, rate limits, and accept/dismiss helpers.
- `electron/IntelligenceEngine.ts`: run watcher after final transcript ingestion and emit watcher suggestion events.
- `electron/IntelligenceManager.ts`: forward watcher events from the engine.
- `electron/main.ts`: broadcast watcher suggestions to renderer windows.
- `electron/preload.ts`: expose watcher IPC methods and `onSkillWatcherSuggestionCreated()`.
- `src/types/electron.d.ts`: add watcher settings, suggestion, and event types.
- `src/components/settings/SkillsSettings.tsx`: add watcher settings, live suggestions, accept/dismiss actions, and activation cancel controls.
- `electron/services/__tests__/SkillActivationManager.test.mjs`: behavior tests for chat resolution.
- `electron/llm/__tests__/ChatPromptAssembly.test.mjs`: prompt assembly and LLM signature tests.
- `electron/services/__tests__/ChatSkillActivation.test.mjs`: static IPC tests for chat skill resolution and public shape.
- `electron/services/__tests__/SkillWatcherService.test.mjs`: watcher behavior tests.
- `electron/services/__tests__/IntelligenceEngineSkillWatcher.test.mjs`: engine/main event wiring tests.
- `electron/services/__tests__/SkillsIpcWiring.test.mjs`: IPC/preload/types/UI static coverage for watcher channels.

---

### Task 1: Enable Chat Resolution Without Hotword Mutation

**Files:**
- Modify: `electron/services/SkillActivationManager.ts`
- Test: `electron/services/__tests__/SkillActivationManager.test.mjs`

**Interfaces:**
- Consumes: existing `SkillActivationManager.getInstance()`, `activateSkill(input)`, `resolveActiveSkill(request)`.
- Produces: `resolveActiveSkill({ requestType: 'chat', latestText, now?, maxPromptTokens? }): ResolvedActiveSkill | null` where chat resolves existing default/runtime activations but never calls `activateSkill()` from trigger detection.

- [ ] **Step 1: Add failing tests for chat resolution**

Append these tests to `electron/services/__tests__/SkillActivationManager.test.mjs`:

```js
test('resolveActiveSkill resolves an existing default activation for chat', () => {
  manager.resetForTests();
  manager.setSettings({ defaultSkillId: 'humanize-ai-text', skillsAutoTriggerEnabled: true });

  const resolved = manager.resolveActiveSkill({
    requestType: 'chat',
    latestText: 'Please rewrite this line.',
    now: 1000,
  });

  assert.equal(resolved?.skill.id, 'humanize-ai-text');
  assert.equal(resolved?.activation.source, 'default');
});

test('resolveActiveSkill resolves a turn activation for chat and consumes it once', () => {
  manager.resetForTests();
  manager.activateSkill({
    skillId: 'humanize-ai-text',
    source: 'manual',
    scope: 'turn',
    now: 1000,
  });

  const first = manager.resolveActiveSkill({
    requestType: 'chat',
    latestText: 'Make this sound natural.',
    now: 1100,
  });
  const second = manager.resolveActiveSkill({
    requestType: 'chat',
    latestText: 'Make another line natural.',
    now: 1200,
  });

  assert.equal(first?.skill.id, 'humanize-ai-text');
  assert.equal(second, null);
});

test('resolveActiveSkill does not create hotword activations for chat text', () => {
  manager.resetForTests();
  manager.setSettings({ defaultSkillId: null, skillsAutoTriggerEnabled: true });

  const resolved = manager.resolveActiveSkill({
    requestType: 'chat',
    latestText: 'Can you humanize this answer?',
    now: 1000,
  });

  assert.equal(resolved, null);
  assert.deepEqual(manager.listActivations(), []);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
rtk npm test -- electron/services/__tests__/SkillActivationManager.test.mjs
```

Expected: the two chat resolution tests fail because `resolveActiveSkill()` returns `null` for non-`what_to_answer` requests.

- [ ] **Step 3: Implement chat resolution branch**

In `electron/services/SkillActivationManager.ts`, replace the early request-type guard and trigger block with this shape:

```ts
  public resolveActiveSkill(request: ResolveSkillRequest): ResolvedActiveSkill | null {
    if (request.requestType !== 'what_to_answer' && request.requestType !== 'chat') {
      return null;
    }

    const now = request.now ?? Date.now();
    this.pruneExpired(now);

    const shouldDetectTrigger = request.requestType === 'what_to_answer';
    if (shouldDetectTrigger && this.settings.skillsAutoTriggerEnabled) {
      const trigger = this.detectTrigger(request.latestText);
      if (trigger) {
        this.activateSkill({
          skillId: trigger.skillId,
          source: 'auto',
          scope: 'turn',
          ttlMs: 90_000,
          now,
        });
      }
    }

    const activation = this.pickActivation(now);
    if (!activation) {
      return null;
    }

    const skill = this.skillsManager.getSkill(activation.skillId);
    if (!skill) {
      this.deactivateSkill(activation.skillId, activation.scope);
      return null;
    }

    const prompt = this.skillsManager.buildPromptBlock(skill.id, {
      maxTokens: request.maxPromptTokens,
    });

    if (activation.scope === 'turn') {
      this.deactivateSkill(activation.skillId, 'turn');
    }

    return {
      activation,
      skill,
      promptBlock: prompt.block,
      metadata: prompt.metadata,
    };
  }
```

- [ ] **Step 4: Run tests for the manager**

Run:

```bash
rtk npm test -- electron/services/__tests__/SkillActivationManager.test.mjs
```

Expected: all tests in `SkillActivationManager.test.mjs` pass.

- [ ] **Step 5: Commit**

```bash
rtk git add electron/services/SkillActivationManager.ts electron/services/__tests__/SkillActivationManager.test.mjs
rtk git commit -m "feat: resolve active skills for chat"
```

---

### Task 2: Add Shared Chat Prompt Assembly

**Files:**
- Create: `electron/llm/chatPromptAssembly.ts`
- Modify: `electron/LLMHelper.ts`
- Test: `electron/llm/__tests__/ChatPromptAssembly.test.mjs`

**Interfaces:**
- Consumes: explicit public active skill shape from IPC.
- Produces:
  - `export interface ActiveSkillForPrompt { id: string; name: string; promptBlock: string }`
  - `export interface ChatPromptAssemblyInput { basePrompt: string; activeModePrompt?: string; activeSkill?: ActiveSkillForPrompt | null }`
  - `export function buildChatSystemPrompt(input: ChatPromptAssemblyInput): string`
  - `export interface ChatPromptOptions { activeModePrompt?: string; activeSkill?: ActiveSkillForPrompt | null }`

- [ ] **Step 1: Write failing prompt assembly tests**

Create `electron/llm/__tests__/ChatPromptAssembly.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');
const helperPath = path.join(root, 'electron/llm/chatPromptAssembly.ts');
const llmHelperPath = path.join(root, 'electron/LLMHelper.ts');

test('buildChatSystemPrompt preserves base prompt, mode prompt, and active skill order', () => {
  const source = fs.readFileSync(helperPath, 'utf8');
  assert.match(source, /export interface ActiveSkillForPrompt/);
  assert.match(source, /export function buildChatSystemPrompt/);
  assert.match(source, /basePrompt/);
  assert.match(source, /activeModePrompt/);
  assert.match(source, /activeSkill/);
});

test('LLMHelper imports and applies shared chat prompt assembly', () => {
  const source = fs.readFileSync(llmHelperPath, 'utf8');
  assert.match(source, /buildChatSystemPrompt/);
  assert.match(source, /ChatPromptOptions/);
  assert.match(source, /chatPromptOptions/);
  assert.match(source, /activeSkill/);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
rtk npm test -- electron/llm/__tests__/ChatPromptAssembly.test.mjs
```

Expected: FAIL with `ENOENT` for `electron/llm/chatPromptAssembly.ts`.

- [ ] **Step 3: Create prompt assembly helper**

Create `electron/llm/chatPromptAssembly.ts`:

```ts
export interface ActiveSkillForPrompt {
  id: string;
  name: string;
  promptBlock: string;
}

export interface ChatPromptAssemblyInput {
  basePrompt: string;
  activeModePrompt?: string;
  activeSkill?: ActiveSkillForPrompt | null;
}

export interface ChatPromptOptions {
  activeModePrompt?: string;
  activeSkill?: ActiveSkillForPrompt | null;
}

export function buildChatSystemPrompt(input: ChatPromptAssemblyInput): string {
  const parts = [input.basePrompt.trim()].filter(Boolean);

  const activeModePrompt = input.activeModePrompt?.trim();
  if (activeModePrompt) {
    parts.push(activeModePrompt);
  }

  if (input.activeSkill?.promptBlock.trim()) {
    parts.push(
      [
        '<active_skill>',
        `Skill: ${input.activeSkill.name} (${input.activeSkill.id})`,
        input.activeSkill.promptBlock.trim(),
        '</active_skill>',
      ].join('\n'),
    );
  }

  return parts.join('\n\n');
}
```

- [ ] **Step 4: Wire `LLMHelper` to accept chat prompt options**

In `electron/LLMHelper.ts`, import the helper near existing prompt imports:

```ts
import {
  buildChatSystemPrompt,
  type ChatPromptOptions,
} from './llm/chatPromptAssembly';
```

Update the non-streaming signature:

```ts
  public async chatWithGemini(
    message: string,
    imagePaths?: string[],
    context?: string,
    skipSystemPrompt: boolean = false,
    alternateGroqMessage?: string,
    chatPromptOptions?: ChatPromptOptions,
  ): Promise<string> {
```

Inside `chatWithGemini`, after provider-specific base prompts are computed and before request calls, derive system prompts with:

```ts
    const activeModePrompt = chatPromptOptions?.activeModePrompt;
    const activeSkill = chatPromptOptions?.activeSkill ?? null;
    const finalGeminiSystemPrompt = skipSystemPrompt
      ? ''
      : buildChatSystemPrompt({
          basePrompt: finalGeminiPrompt,
          activeModePrompt,
          activeSkill,
        });
    const finalGroqSystemPrompt = skipSystemPrompt
      ? ''
      : buildChatSystemPrompt({
          basePrompt: finalGroqPrompt,
          activeModePrompt,
          activeSkill,
        });
    const finalOpenAISystemPrompt = skipSystemPrompt
      ? ''
      : buildChatSystemPrompt({
          basePrompt: openaiSystemPrompt,
          activeModePrompt,
          activeSkill,
        });
    const finalClaudeSystemPrompt = skipSystemPrompt
      ? ''
      : buildChatSystemPrompt({
          basePrompt: claudeSystemPrompt,
          activeModePrompt,
          activeSkill,
        });
```

Replace provider calls that previously used `finalGeminiPrompt`, `finalGroqPrompt`, `openaiSystemPrompt`, or `claudeSystemPrompt` as chat system prompts with the corresponding `final*SystemPrompt` variable. Preserve existing user message, context, image, routing, and data-scope behavior.

Update streaming signatures:

```ts
  public async * streamChat(
    ...args: Parameters<LLMHelper['_streamChatInner']>
  ): AsyncGenerator<string> {
```

The wrapper already follows `_streamChatInner`; add the new final parameter only to `_streamChatInner`:

```ts
  private async * _streamChatInner(
    message: string,
    imagePaths?: string[],
    context?: string,
    systemPromptOverride?: string,
    ignoreKnowledgeMode: boolean = false,
    skipModeInjection: boolean = false,
    extraDataScopes: ProviderDataScope[] = [],
    chatPromptOptions?: ChatPromptOptions,
  ): AsyncGenerator<string> {
```

After the existing active-mode injection block and before language instruction injection, assemble active skill:

```ts
    if (chatPromptOptions?.activeSkill) {
      systemPromptOverride = buildChatSystemPrompt({
        basePrompt: systemPromptOverride || HARD_SYSTEM_PROMPT,
        activeModePrompt: chatPromptOptions.activeModePrompt,
        activeSkill: chatPromptOptions.activeSkill,
      });
    }
```

Update the convenience `chat()` method signature and call:

```ts
  public async chat(
    message: string,
    imagePaths?: string[],
    context?: string,
    systemPromptOverride?: string,
    skipModeInjection: boolean = false,
    chatPromptOptions?: ChatPromptOptions,
  ): Promise<string> {
    let response = '';
    for await (const chunk of this.streamChat(
      message,
      imagePaths,
      context,
      systemPromptOverride,
      false,
      skipModeInjection,
      [],
      chatPromptOptions,
    )) {
      response += chunk;
    }
    return response;
  }
```

- [ ] **Step 5: Run prompt assembly tests**

Run:

```bash
rtk npm test -- electron/llm/__tests__/ChatPromptAssembly.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Run TypeScript check for electron**

Run:

```bash
rtk npm run typecheck:electron
```

Expected: the command may still report the existing baseline `MaterialRagRetriever.ts(302,42/53)` implicit `any` errors. It must not report new errors in `electron/LLMHelper.ts` or `electron/llm/chatPromptAssembly.ts`.

- [ ] **Step 7: Commit**

```bash
rtk git add electron/llm/chatPromptAssembly.ts electron/LLMHelper.ts electron/llm/__tests__/ChatPromptAssembly.test.mjs
rtk git commit -m "feat: assemble active skills in chat prompts"
```

---

### Task 3: Resolve Active Skills in Main Chat IPC

**Files:**
- Modify: `electron/ipcHandlers.ts`
- Test: `electron/services/__tests__/ChatSkillActivation.test.mjs`

**Interfaces:**
- Consumes: `SkillActivationManager.resolveActiveSkill({ requestType: 'chat', latestText })`.
- Produces: chat calls to `LLMHelper.chatWithGemini()` and `LLMHelper.streamChat()` pass `ChatPromptOptions` with `activeSkill?: { id, name, promptBlock }`.

- [ ] **Step 1: Write failing IPC static tests**

Create `electron/services/__tests__/ChatSkillActivation.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

test('gemini-chat resolves active skill for requestType chat', () => {
  const idx = source.indexOf("safeHandle('gemini-chat'");
  assert.ok(idx >= 0, 'gemini-chat handler must exist');
  const block = source.slice(idx, source.indexOf("safeHandle('gemini-chat-stream'", idx));
  assert.match(block, /SkillActivationManager\.getInstance\(\)\.resolveActiveSkill\(\{/);
  assert.match(block, /requestType:\s*['"]chat['"]/);
  assert.match(block, /latestText:\s*message/);
  assert.match(block, /chatPromptOptions/);
  assert.match(block, /chatWithGemini\(/);
});

test('gemini-chat-stream resolves active skill and passes public skill shape only', () => {
  const idx = source.indexOf("safeHandle('gemini-chat-stream'");
  assert.ok(idx >= 0, 'gemini-chat-stream handler must exist');
  const end = source.indexOf("safeHandle(", idx + 1);
  const block = source.slice(idx, end >= 0 ? end : source.length);
  assert.match(block, /requestType:\s*['"]chat['"]/);
  assert.match(block, /activeSkill:\s*resolvedSkill\s*\?/);
  assert.match(block, /id:\s*resolvedSkill\.skill\.id/);
  assert.match(block, /name:\s*resolvedSkill\.skill\.name/);
  assert.match(block, /promptBlock:\s*resolvedSkill\.promptBlock/);
  assert.doesNotMatch(block, /SKILL\.md/);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
rtk npm test -- electron/services/__tests__/ChatSkillActivation.test.mjs
```

Expected: FAIL because chat handlers do not resolve active skills yet.

- [ ] **Step 3: Add imports and local helpers**

In `electron/ipcHandlers.ts`, add imports:

```ts
import { SkillActivationManager } from './services/SkillActivationManager';
import type { ChatPromptOptions } from './llm/chatPromptAssembly';
```

Add a local helper near other IPC helper functions:

```ts
function resolveChatPromptOptions(message: string): ChatPromptOptions | undefined {
  try {
    const resolvedSkill = SkillActivationManager.getInstance().resolveActiveSkill({
      requestType: 'chat',
      latestText: message,
    });

    if (!resolvedSkill) {
      return undefined;
    }

    console.log('[Skills] Chat active skill resolved', {
      activeSkillId: resolvedSkill.skill.id,
      scope: resolvedSkill.activation.scope,
      source: resolvedSkill.activation.source,
    });

    return {
      activeSkill: {
        id: resolvedSkill.skill.id,
        name: resolvedSkill.skill.name,
        promptBlock: resolvedSkill.promptBlock,
      },
    };
  } catch (error) {
    console.warn('[Skills] Failed to resolve chat active skill', error instanceof Error ? error.message : String(error));
    return undefined;
  }
}
```

- [ ] **Step 4: Wire non-streaming chat**

In the `gemini-chat` handler, before calling `chatWithGemini()`, add:

```ts
        const chatPromptOptions = options?.skipSystemPrompt
          ? undefined
          : resolveChatPromptOptions(message);
```

Change the `chatWithGemini()` call to:

```ts
        const response = await llmHelper
          .chatWithGemini(message, imagePaths, context, options?.skipSystemPrompt, undefined, chatPromptOptions);
```

- [ ] **Step 5: Wire streaming chat**

In `gemini-chat-stream`, keep identity-probe handling before skill resolution. For normal chat, after auto context injection and before `llmHelper.streamChat()`, add:

```ts
        const chatPromptOptions = options?.skipSystemPrompt
          ? undefined
          : resolveChatPromptOptions(message);
```

Change the stream call to include the final argument:

```ts
          const stream = llmHelper.streamChat(
            message,
            imagePaths,
            context,
            systemPromptOverride,
            options?.ignoreKnowledgeMode,
            false,
            [],
            chatPromptOptions,
          );
```

- [ ] **Step 6: Run IPC tests**

Run:

```bash
rtk npm test -- electron/services/__tests__/ChatSkillActivation.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run focused manager and prompt tests**

Run:

```bash
rtk npm test -- electron/services/__tests__/SkillActivationManager.test.mjs electron/llm/__tests__/ChatPromptAssembly.test.mjs electron/services/__tests__/ChatSkillActivation.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add electron/ipcHandlers.ts electron/services/__tests__/ChatSkillActivation.test.mjs
rtk git commit -m "feat: wire active skills into main chat"
```

---

### Task 4: Add Deterministic Skill Watcher Service

**Files:**
- Create: `electron/services/SkillWatcherService.ts`
- Test: `electron/services/__tests__/SkillWatcherService.test.mjs`

**Interfaces:**
- Consumes: skill summaries `{ id, name, description, source }`, recent transcript segments, current activations, watcher settings.
- Produces:
  - `SkillWatcherSettings`
  - `SkillWatcherDecision`
  - `SkillWatcherSuggestion`
  - singleton `SkillWatcherService.getInstance()`
  - methods `getSettings()`, `setSettings(input)`, `evaluate(input)`, `listSuggestions(now?)`, `acceptSuggestion(id, now?)`, `dismissSuggestion(id, now?)`, `clearSessionState()`.

- [ ] **Step 1: Write failing watcher tests**

Create `electron/services/__tests__/SkillWatcherService.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

const { SkillWatcherService } = require('../SkillWatcherService');

const humanizeSkill = {
  id: 'humanize-ai-text',
  name: 'Humanize AI Text',
  description: 'Rewrite text to sound natural and human.',
  source: 'builtin',
};

test('watcher ignores transcript when disabled', () => {
  const watcher = new SkillWatcherService();
  watcher.setSettings({ skillsWatcherEnabled: false });

  const result = watcher.evaluate({
    now: 10_000,
    transcriptWindow: [{ speaker: 'user', text: 'This sounds like AI text.', timestamp: 10_000 }],
    skills: [humanizeSkill],
    activations: [],
  });

  assert.equal(result.action, 'ignore');
  assert.equal(watcher.listSuggestions().length, 0);
});

test('watcher creates high confidence activate decision', () => {
  const watcher = new SkillWatcherService();
  watcher.setSettings({ skillsWatcherEnabled: true });

  const result = watcher.evaluate({
    now: 60_000,
    transcriptWindow: [{ speaker: 'user', text: 'Please humanize this AI sounding answer now.', timestamp: 60_000 }],
    skills: [humanizeSkill],
    activations: [],
  });

  assert.equal(result.action, 'activate');
  assert.equal(result.skillId, 'humanize-ai-text');
  assert.ok(result.confidence >= 0.86);
  assert.equal(result.scope, 'ephemeral');
});

test('watcher stores medium confidence suggestion', () => {
  const watcher = new SkillWatcherService();
  watcher.setSettings({ skillsWatcherEnabled: true });

  const result = watcher.evaluate({
    now: 60_000,
    transcriptWindow: [{ speaker: 'user', text: 'That draft sounds a bit robotic.', timestamp: 60_000 }],
    skills: [humanizeSkill],
    activations: [],
  });

  assert.equal(result.action, 'suggest');
  assert.equal(watcher.listSuggestions().length, 1);
  assert.equal(watcher.listSuggestions()[0].status, 'pending');
});

test('watcher rate limit prevents repeated runs', () => {
  const watcher = new SkillWatcherService();
  watcher.setSettings({ skillsWatcherEnabled: true });

  watcher.evaluate({
    now: 60_000,
    transcriptWindow: [{ speaker: 'user', text: 'That draft sounds a bit robotic.', timestamp: 60_000 }],
    skills: [humanizeSkill],
    activations: [],
  });
  const result = watcher.evaluate({
    now: 70_000,
    transcriptWindow: [{ speaker: 'user', text: 'That draft sounds a bit robotic again.', timestamp: 70_000 }],
    skills: [humanizeSkill],
    activations: [],
  });

  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'rate_limited');
});

test('accept and dismiss update suggestion state', () => {
  const watcher = new SkillWatcherService();
  watcher.setSettings({ skillsWatcherEnabled: true });
  watcher.evaluate({
    now: 60_000,
    transcriptWindow: [{ speaker: 'user', text: 'That draft sounds a bit robotic.', timestamp: 60_000 }],
    skills: [humanizeSkill],
    activations: [],
  });

  const suggestion = watcher.listSuggestions()[0];
  assert.equal(watcher.acceptSuggestion(suggestion.id)?.status, 'accepted');
  assert.equal(watcher.dismissSuggestion(suggestion.id), null);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
rtk npm test -- electron/services/__tests__/SkillWatcherService.test.mjs
```

Expected: FAIL because `SkillWatcherService` does not exist.

- [ ] **Step 3: Implement watcher service**

Create `electron/services/SkillWatcherService.ts`:

```ts
export interface SkillWatcherSettings {
  skillsWatcherEnabled: boolean;
  skillsWatcherAutoActivateThreshold: number;
  skillsWatcherSuggestThreshold: number;
}

export interface SkillWatcherDecision {
  id: string;
  skillId: string;
  action: 'activate' | 'suggest' | 'ignore';
  scope: 'meeting' | 'ephemeral';
  confidence: number;
  reason: string;
  expiresAt?: number;
}

export interface SkillWatcherSuggestion extends SkillWatcherDecision {
  createdAt: number;
  status: 'pending' | 'accepted' | 'dismissed';
}

export interface SkillWatcherInput {
  now?: number;
  transcriptWindow: Array<{ speaker?: string; text: string; timestamp?: number }>;
  skills: Array<{ id: string; name: string; description?: string; source: 'builtin' | 'userData' }>;
  activations: Array<{ skillId: string; scope: string; expiresAt?: number }>;
}

const DEFAULT_SETTINGS: SkillWatcherSettings = {
  skillsWatcherEnabled: false,
  skillsWatcherAutoActivateThreshold: 0.86,
  skillsWatcherSuggestThreshold: 0.65,
};

const MIN_INTERVAL_MS = 45_000;
const SUGGESTION_COOLDOWN_MS = 5 * 60_000;

export class SkillWatcherService {
  private static instance: SkillWatcherService | null = null;
  private settings: SkillWatcherSettings = { ...DEFAULT_SETTINGS };
  private suggestions: SkillWatcherSuggestion[] = [];
  private lastRunAt = 0;
  private lastFingerprint = '';
  private dismissedKeys = new Map<string, number>();

  static getInstance(): SkillWatcherService {
    if (!SkillWatcherService.instance) {
      SkillWatcherService.instance = new SkillWatcherService();
    }
    return SkillWatcherService.instance;
  }

  getSettings(): SkillWatcherSettings {
    return { ...this.settings };
  }

  setSettings(input: Partial<SkillWatcherSettings>): SkillWatcherSettings {
    this.settings = {
      ...this.settings,
      ...input,
      skillsWatcherEnabled: input.skillsWatcherEnabled ?? this.settings.skillsWatcherEnabled,
      skillsWatcherAutoActivateThreshold: clampThreshold(
        input.skillsWatcherAutoActivateThreshold ?? this.settings.skillsWatcherAutoActivateThreshold,
        DEFAULT_SETTINGS.skillsWatcherAutoActivateThreshold,
      ),
      skillsWatcherSuggestThreshold: clampThreshold(
        input.skillsWatcherSuggestThreshold ?? this.settings.skillsWatcherSuggestThreshold,
        DEFAULT_SETTINGS.skillsWatcherSuggestThreshold,
      ),
    };
    return this.getSettings();
  }

  evaluate(input: SkillWatcherInput): SkillWatcherDecision {
    const now = input.now ?? Date.now();
    if (!this.settings.skillsWatcherEnabled) {
      return ignoreDecision('disabled', now);
    }

    if (now - this.lastRunAt < MIN_INTERVAL_MS) {
      return ignoreDecision('rate_limited', now);
    }

    const text = input.transcriptWindow.map((segment) => segment.text).join('\n').trim();
    const fingerprint = normalizeText(text).slice(-240);
    if (!fingerprint || fingerprint === this.lastFingerprint) {
      return ignoreDecision('unchanged_transcript', now);
    }

    this.lastRunAt = now;
    this.lastFingerprint = fingerprint;

    const skill = input.skills.find((item) => item.id === 'humanize-ai-text');
    if (!skill) {
      return ignoreDecision('skill_unavailable', now);
    }

    if (input.activations.some((activation) => activation.skillId === skill.id)) {
      return ignoreDecision('already_active', now, skill.id);
    }

    const confidence = scoreHumanizeIntent(text);
    const key = `${skill.id}:${Math.round(confidence * 100)}`;
    const dismissedAt = this.dismissedKeys.get(key);
    if (dismissedAt && now - dismissedAt < SUGGESTION_COOLDOWN_MS) {
      return ignoreDecision('dismissed_recently', now, skill.id);
    }

    if (confidence >= this.settings.skillsWatcherAutoActivateThreshold) {
      return {
        id: createDecisionId(skill.id, now),
        skillId: skill.id,
        action: 'activate',
        scope: 'ephemeral',
        confidence,
        reason: 'humanize_intent_high',
        expiresAt: now + 3 * 60_000,
      };
    }

    if (confidence >= this.settings.skillsWatcherSuggestThreshold) {
      const suggestion: SkillWatcherSuggestion = {
        id: createDecisionId(skill.id, now),
        skillId: skill.id,
        action: 'suggest',
        scope: 'ephemeral',
        confidence,
        reason: 'humanize_intent_medium',
        expiresAt: now + 3 * 60_000,
        createdAt: now,
        status: 'pending',
      };
      this.suggestions = [suggestion, ...this.suggestions.filter((item) => item.skillId !== skill.id)].slice(0, 10);
      return suggestion;
    }

    return ignoreDecision('below_threshold', now, skill.id, confidence);
  }

  listSuggestions(now: number = Date.now()): SkillWatcherSuggestion[] {
    return this.suggestions
      .filter((item) => item.status === 'pending' && (!item.expiresAt || item.expiresAt > now))
      .map((item) => ({ ...item }));
  }

  acceptSuggestion(id: string, now: number = Date.now()): SkillWatcherSuggestion | null {
    const suggestion = this.suggestions.find((item) => item.id === id && item.status === 'pending');
    if (!suggestion || (suggestion.expiresAt && suggestion.expiresAt <= now)) {
      return null;
    }
    suggestion.status = 'accepted';
    return { ...suggestion };
  }

  dismissSuggestion(id: string, now: number = Date.now()): SkillWatcherSuggestion | null {
    const suggestion = this.suggestions.find((item) => item.id === id && item.status === 'pending');
    if (!suggestion) {
      return null;
    }
    suggestion.status = 'dismissed';
    this.dismissedKeys.set(`${suggestion.skillId}:${Math.round(suggestion.confidence * 100)}`, now);
    return { ...suggestion };
  }

  clearSessionState(): void {
    this.suggestions = [];
    this.lastRunAt = 0;
    this.lastFingerprint = '';
    this.dismissedKeys.clear();
  }
}

function clampThreshold(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function scoreHumanizeIntent(text: string): number {
  const normalized = normalizeText(text);
  if (/(please\s+)?humanize|sound\s+more\s+human|ai[-\s]?sounding|自然一点|像真人|人味/.test(normalized)) {
    return 0.9;
  }
  if (/robotic|stiff|too formal|less formal|more natural|不自然|太官方|太生硬/.test(normalized)) {
    return 0.72;
  }
  return 0.0;
}

function createDecisionId(skillId: string, now: number): string {
  return `${skillId}-${now}`;
}

function ignoreDecision(reason: string, now: number, skillId = '', confidence = 0): SkillWatcherDecision {
  return {
    id: createDecisionId(skillId || 'ignore', now),
    skillId,
    action: 'ignore',
    scope: 'ephemeral',
    confidence,
    reason,
  };
}
```

- [ ] **Step 4: Run watcher tests**

Run:

```bash
rtk npm test -- electron/services/__tests__/SkillWatcherService.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add electron/services/SkillWatcherService.ts electron/services/__tests__/SkillWatcherService.test.mjs
rtk git commit -m "feat: add deterministic skill watcher"
```

---

### Task 5: Wire Watcher Into Transcript Engine and Renderer Events

**Files:**
- Modify: `electron/IntelligenceEngine.ts`
- Modify: `electron/IntelligenceManager.ts`
- Modify: `electron/main.ts`
- Test: `electron/services/__tests__/IntelligenceEngineSkillWatcher.test.mjs`

**Interfaces:**
- Consumes: `SkillWatcherService.evaluate()`, `SkillActivationManager.activateSkill()`, existing transcript final segment flow.
- Produces: engine/manager event `skill_watcher_suggestion_created` and renderer channel `skill-watcher-suggestion-created`.

- [ ] **Step 1: Write failing event wiring tests**

Create `electron/services/__tests__/IntelligenceEngineSkillWatcher.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

test('IntelligenceEngine declares and emits skill watcher suggestion event', () => {
  const source = fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');
  assert.match(source, /skill_watcher_suggestion_created/);
  assert.match(source, /SkillWatcherService\.getInstance\(\)\.evaluate/);
  assert.match(source, /SkillActivationManager\.getInstance\(\)\.activateSkill/);
  assert.match(source, /this\.emit\(['"]skill_watcher_suggestion_created['"]/);
});

test('IntelligenceManager forwards skill watcher suggestion event', () => {
  const source = fs.readFileSync(path.join(root, 'electron/IntelligenceManager.ts'), 'utf8');
  assert.match(source, /skill_watcher_suggestion_created/);
});

test('main broadcasts skill watcher suggestions to renderer windows', () => {
  const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
  assert.match(source, /skill_watcher_suggestion_created/);
  assert.match(source, /skill-watcher-suggestion-created/);
  assert.match(source, /this\.broadcast\(['"]skill-watcher-suggestion-created['"]/);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
rtk npm test -- electron/services/__tests__/IntelligenceEngineSkillWatcher.test.mjs
```

Expected: FAIL because watcher event wiring does not exist.

- [ ] **Step 3: Update `IntelligenceEngine` events and watcher runner**

In `electron/IntelligenceEngine.ts`, import:

```ts
import { SkillActivationManager } from './services/SkillActivationManager';
import { SkillsManager } from './services/SkillsManager';
import { SkillWatcherService, type SkillWatcherSuggestion } from './services/SkillWatcherService';
```

Extend the event map:

```ts
  'skill_watcher_suggestion_created': (suggestion: SkillWatcherSuggestion) => void;
```

After final transcript handling in `handleTranscript()`, call:

```ts
        if (result.isFinal) {
          void this.runSkillWatcher(segment).catch((error) => {
            console.warn('[Skills] Skill watcher failed', error instanceof Error ? error.message : String(error));
          });
        }
```

Add a private method:

```ts
  private async runSkillWatcher(segment: TranscriptSegment): Promise<void> {
    if (!segment.text?.trim()) {
      return;
    }

    const watcher = SkillWatcherService.getInstance();
    const skills = SkillsManager.getInstance().listSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
    }));
    const transcriptWindow = this.session.getFullTranscript().slice(-12).map((item) => ({
      speaker: item.speaker,
      text: item.text,
      timestamp: item.timestamp,
    }));
    const activations = SkillActivationManager.getInstance().listActivations();

    const decision = watcher.evaluate({
      transcriptWindow,
      skills,
      activations,
    });

    if (decision.action === 'activate') {
      SkillActivationManager.getInstance().activateSkill({
        skillId: decision.skillId,
        source: 'auto',
        scope: 'ephemeral',
        ttlMs: 3 * 60_000,
      });
      console.log('[Skills] Watcher activated skill', {
        skillId: decision.skillId,
        scope: decision.scope,
        confidence: decision.confidence,
        action: decision.action,
      });
      return;
    }

    if (decision.action === 'suggest') {
      const suggestion = watcher.listSuggestions().find((item) => item.id === decision.id);
      if (suggestion) {
        this.emit('skill_watcher_suggestion_created', suggestion);
      }
    }
  }
```

In `reset()`, add:

```ts
    SkillWatcherService.getInstance().clearSessionState();
```

- [ ] **Step 4: Forward through `IntelligenceManager`**

In `electron/IntelligenceManager.ts`, add `skill_watcher_suggestion_created` to the event forwarding list next to `dynamic_action_emitted`:

```ts
            'skill_watcher_suggestion_created',
```

- [ ] **Step 5: Broadcast from `main.ts`**

Near the existing `dynamic_action_emitted` bridge in `electron/main.ts`, add:

```ts
    this.intelligenceManager.on('skill_watcher_suggestion_created', (suggestion: any) => {
      this.broadcast('skill-watcher-suggestion-created', { suggestion });
    });
```

- [ ] **Step 6: Run event wiring tests**

Run:

```bash
rtk npm test -- electron/services/__tests__/IntelligenceEngineSkillWatcher.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run watcher tests together**

Run:

```bash
rtk npm test -- electron/services/__tests__/SkillWatcherService.test.mjs electron/services/__tests__/IntelligenceEngineSkillWatcher.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add electron/IntelligenceEngine.ts electron/IntelligenceManager.ts electron/main.ts electron/services/__tests__/IntelligenceEngineSkillWatcher.test.mjs
rtk git commit -m "feat: emit skill watcher suggestions"
```

---

### Task 6: Add Watcher IPC, Preload, and Types

**Files:**
- Modify: `electron/ipcHandlers.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Modify: `electron/services/__tests__/SkillsIpcWiring.test.mjs`

**Interfaces:**
- Consumes: `SkillWatcherService` and `SkillActivationManager`.
- Produces:
  - `skills:get-watcher-settings`
  - `skills:set-watcher-settings`
  - `skills:list-watcher-suggestions`
  - `skills:accept-watcher-suggestion`
  - `skills:dismiss-watcher-suggestion`
  - `onSkillWatcherSuggestionCreated(callback)`.

- [ ] **Step 1: Add failing IPC wiring assertions**

Append to `electron/services/__tests__/SkillsIpcWiring.test.mjs`:

```js
test('watcher skills IPC handlers are registered and exposed', () => {
  const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
  const types = fs.readFileSync(path.join(root, 'src/types/electron.d.ts'), 'utf8');

  for (const channel of [
    'skills:get-watcher-settings',
    'skills:set-watcher-settings',
    'skills:list-watcher-suggestions',
    'skills:accept-watcher-suggestion',
    'skills:dismiss-watcher-suggestion',
  ]) {
    assert.ok(findSafeHandle(ipc, channel) >= 0, `${channel} handler must use safeHandle`);
    assert.ok(preload.includes(`ipcRenderer.invoke('${channel}'`) || preload.includes(`ipcRenderer.invoke("${channel}"`), `${channel} must be exposed by preload`);
  }

  assert.match(preload, /onSkillWatcherSuggestionCreated/);
  assert.match(preload, /skill-watcher-suggestion-created/);
  assert.match(types, /interface SkillWatcherSettings/);
  assert.match(types, /interface SkillWatcherSuggestion/);
  assert.match(types, /onSkillWatcherSuggestionCreated/);
});
```

- [ ] **Step 2: Run the failing wiring test**

Run:

```bash
rtk npm test -- electron/services/__tests__/SkillsIpcWiring.test.mjs
```

Expected: FAIL because watcher channels are not registered or exposed.

- [ ] **Step 3: Add IPC handlers**

In `electron/ipcHandlers.ts`, import:

```ts
import { SkillWatcherService } from './services/SkillWatcherService';
```

Near existing skills handlers, add:

```ts
  safeHandle('skills:get-watcher-settings', async () => {
    return SkillWatcherService.getInstance().getSettings();
  });

  safeHandle('skills:set-watcher-settings', async (_event, settings) => {
    try {
      const next = SkillWatcherService.getInstance().setSettings(settings || {});
      return { success: true, settings: next };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  safeHandle('skills:list-watcher-suggestions', async () => {
    return SkillWatcherService.getInstance().listSuggestions();
  });

  safeHandle('skills:accept-watcher-suggestion', async (_event, suggestionId: string) => {
    const suggestion = SkillWatcherService.getInstance().acceptSuggestion(suggestionId);
    if (!suggestion) {
      return { success: false, error: 'Suggestion not found or expired.' };
    }
    SkillActivationManager.getInstance().activateSkill({
      skillId: suggestion.skillId,
      source: 'auto',
      scope: suggestion.scope,
      ttlMs: 3 * 60_000,
    });
    return { success: true, suggestion };
  });

  safeHandle('skills:dismiss-watcher-suggestion', async (_event, suggestionId: string) => {
    const suggestion = SkillWatcherService.getInstance().dismissSuggestion(suggestionId);
    if (!suggestion) {
      return { success: false, error: 'Suggestion not found.' };
    }
    return { success: true, suggestion };
  });
```

- [ ] **Step 4: Add preload interface and context bridge entries**

In `electron/preload.ts`, add interfaces:

```ts
interface SkillWatcherSettings {
  skillsWatcherEnabled: boolean;
  skillsWatcherAutoActivateThreshold: number;
  skillsWatcherSuggestThreshold: number;
}

interface SkillWatcherSuggestion {
  id: string;
  skillId: string;
  action: 'suggest';
  scope: 'meeting' | 'ephemeral';
  confidence: number;
  reason: string;
  expiresAt?: number;
  createdAt: number;
  status: 'pending' | 'accepted' | 'dismissed';
}
```

Add methods to `ElectronAPI`:

```ts
  skillsGetWatcherSettings: () => Promise<SkillWatcherSettings>;
  skillsSetWatcherSettings: (settings: Partial<SkillWatcherSettings>) => Promise<{ success: boolean; settings?: SkillWatcherSettings; error?: string }>;
  skillsListWatcherSuggestions: () => Promise<SkillWatcherSuggestion[]>;
  skillsAcceptWatcherSuggestion: (suggestionId: string) => Promise<{ success: boolean; suggestion?: SkillWatcherSuggestion; error?: string }>;
  skillsDismissWatcherSuggestion: (suggestionId: string) => Promise<{ success: boolean; suggestion?: SkillWatcherSuggestion; error?: string }>;
  onSkillWatcherSuggestionCreated: (callback: (data: { suggestion: SkillWatcherSuggestion }) => void) => () => void;
```

Add exposed functions:

```ts
  skillsGetWatcherSettings: () => ipcRenderer.invoke('skills:get-watcher-settings'),
  skillsSetWatcherSettings: (settings) => ipcRenderer.invoke('skills:set-watcher-settings', settings),
  skillsListWatcherSuggestions: () => ipcRenderer.invoke('skills:list-watcher-suggestions'),
  skillsAcceptWatcherSuggestion: (suggestionId) => ipcRenderer.invoke('skills:accept-watcher-suggestion', suggestionId),
  skillsDismissWatcherSuggestion: (suggestionId) => ipcRenderer.invoke('skills:dismiss-watcher-suggestion', suggestionId),
```

Add event helper beside existing listener helpers:

```ts
  onSkillWatcherSuggestionCreated: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { suggestion: SkillWatcherSuggestion }) => callback(data);
    ipcRenderer.on('skill-watcher-suggestion-created', listener);
    return () => ipcRenderer.removeListener('skill-watcher-suggestion-created', listener);
  },
```

- [ ] **Step 5: Add renderer type declarations**

In `src/types/electron.d.ts`, add matching exported interfaces and `ElectronAPI` methods:

```ts
export interface SkillWatcherSettings {
  skillsWatcherEnabled: boolean;
  skillsWatcherAutoActivateThreshold: number;
  skillsWatcherSuggestThreshold: number;
}

export interface SkillWatcherSuggestion {
  id: string;
  skillId: string;
  action: 'suggest';
  scope: 'meeting' | 'ephemeral';
  confidence: number;
  reason: string;
  expiresAt?: number;
  createdAt: number;
  status: 'pending' | 'accepted' | 'dismissed';
}
```

Add to `ElectronAPI`:

```ts
  skillsGetWatcherSettings: () => Promise<SkillWatcherSettings>;
  skillsSetWatcherSettings: (settings: Partial<SkillWatcherSettings>) => Promise<{ success: boolean; settings?: SkillWatcherSettings; error?: string }>;
  skillsListWatcherSuggestions: () => Promise<SkillWatcherSuggestion[]>;
  skillsAcceptWatcherSuggestion: (suggestionId: string) => Promise<{ success: boolean; suggestion?: SkillWatcherSuggestion; error?: string }>;
  skillsDismissWatcherSuggestion: (suggestionId: string) => Promise<{ success: boolean; suggestion?: SkillWatcherSuggestion; error?: string }>;
  onSkillWatcherSuggestionCreated: (callback: (data: { suggestion: SkillWatcherSuggestion }) => void) => () => void;
```

- [ ] **Step 6: Run IPC wiring tests**

Run:

```bash
rtk npm test -- electron/services/__tests__/SkillsIpcWiring.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add electron/ipcHandlers.ts electron/preload.ts src/types/electron.d.ts electron/services/__tests__/SkillsIpcWiring.test.mjs
rtk git commit -m "feat: expose skill watcher controls"
```

---

### Task 7: Add Skills Settings Watcher UI

**Files:**
- Modify: `src/components/settings/SkillsSettings.tsx`
- Modify: `electron/services/__tests__/SkillsIpcWiring.test.mjs`

**Interfaces:**
- Consumes: watcher preload APIs from Task 6.
- Produces: settings toggle, threshold copy, active activation cancel controls, pending suggestions with accept/dismiss.

- [ ] **Step 1: Add failing UI guard assertions**

Append to `electron/services/__tests__/SkillsIpcWiring.test.mjs`:

```js
test('SkillsSettings uses explicit watcher bridge guards and live suggestion event', () => {
  const view = fs.readFileSync(path.join(root, 'src/components/settings/SkillsSettings.tsx'), 'utf8');
  for (const method of [
    'skillsGetWatcherSettings',
    'skillsSetWatcherSettings',
    'skillsListWatcherSuggestions',
    'skillsAcceptWatcherSuggestion',
    'skillsDismissWatcherSuggestion',
    'onSkillWatcherSuggestionCreated',
  ]) {
    assert.match(view, new RegExp(`typeof window\\\\.electronAPI\\\\?\\\\.${method}\\\\s*!==\\\\s*['"]function['"]`));
  }
  assert.match(view, /skillsWatcherEnabled/);
  assert.match(view, /skillsWatcherAutoActivateThreshold/);
  assert.match(view, /skillsWatcherSuggestThreshold/);
});
```

- [ ] **Step 2: Run the failing UI test**

Run:

```bash
rtk npm test -- electron/services/__tests__/SkillsIpcWiring.test.mjs
```

Expected: FAIL because watcher UI state and bridge guards are not present.

- [ ] **Step 3: Add watcher state and loaders**

In `src/components/settings/SkillsSettings.tsx`, import watcher types if the file already imports renderer types. Otherwise add local types:

```ts
type SkillWatcherSettings = {
  skillsWatcherEnabled: boolean;
  skillsWatcherAutoActivateThreshold: number;
  skillsWatcherSuggestThreshold: number;
};

type SkillWatcherSuggestion = {
  id: string;
  skillId: string;
  action: 'suggest';
  scope: 'meeting' | 'ephemeral';
  confidence: number;
  reason: string;
  expiresAt?: number;
  createdAt: number;
  status: 'pending' | 'accepted' | 'dismissed';
};
```

Add component state:

```tsx
    const [watcherSettings, setWatcherSettings] = useState<SkillWatcherSettings>({
        skillsWatcherEnabled: false,
        skillsWatcherAutoActivateThreshold: 0.86,
        skillsWatcherSuggestThreshold: 0.65,
    });
    const [watcherSuggestions, setWatcherSuggestions] = useState<SkillWatcherSuggestion[]>([]);
```

Add loader:

```tsx
    const loadWatcherState = async () => {
        if (typeof window.electronAPI?.skillsGetWatcherSettings !== 'function') {
            throw new Error('Skills watcher settings bridge is unavailable.');
        }
        if (typeof window.electronAPI?.skillsListWatcherSuggestions !== 'function') {
            throw new Error('Skills watcher suggestions bridge is unavailable.');
        }
        const [settings, suggestions] = await Promise.all([
            window.electronAPI.skillsGetWatcherSettings(),
            window.electronAPI.skillsListWatcherSuggestions(),
        ]);
        setWatcherSettings(settings);
        setWatcherSuggestions(suggestions);
    };
```

Call `await loadWatcherState()` from the existing `loadSkills()` flow after activations are loaded.

- [ ] **Step 4: Add watcher mutations and event subscription**

Add mutation helpers:

```tsx
    const updateWatcherSettings = async (next: SkillWatcherSettings) => {
        if (typeof window.electronAPI?.skillsSetWatcherSettings !== 'function') {
            setStatus('Skills watcher settings bridge is unavailable.');
            return;
        }
        setWatcherSettings(next);
        const result = await window.electronAPI.skillsSetWatcherSettings(next);
        if (!result.success || !result.settings) {
            setStatus(result.error || 'Could not update watcher settings.');
            await loadWatcherState();
            return;
        }
        setWatcherSettings(result.settings);
    };

    const acceptWatcherSuggestion = async (suggestionId: string) => {
        if (typeof window.electronAPI?.skillsAcceptWatcherSuggestion !== 'function') {
            setStatus('Skills watcher accept bridge is unavailable.');
            return;
        }
        const result = await window.electronAPI.skillsAcceptWatcherSuggestion(suggestionId);
        if (!result.success) {
            setStatus(result.error || 'Could not accept watcher suggestion.');
        }
        await loadSkills();
    };

    const dismissWatcherSuggestion = async (suggestionId: string) => {
        if (typeof window.electronAPI?.skillsDismissWatcherSuggestion !== 'function') {
            setStatus('Skills watcher dismiss bridge is unavailable.');
            return;
        }
        const result = await window.electronAPI.skillsDismissWatcherSuggestion(suggestionId);
        if (!result.success) {
            setStatus(result.error || 'Could not dismiss watcher suggestion.');
        }
        await loadWatcherState();
    };
```

Add live event subscription:

```tsx
    useEffect(() => {
        if (typeof window.electronAPI?.onSkillWatcherSuggestionCreated !== 'function') {
            return;
        }
        return window.electronAPI.onSkillWatcherSuggestionCreated(({ suggestion }) => {
            setWatcherSuggestions((current) => [
                suggestion,
                ...current.filter((item) => item.id !== suggestion.id),
            ]);
        });
    }, []);
```

- [ ] **Step 5: Render watcher settings and suggestions**

Add this section below the existing auto-trigger setting:

```tsx
            <div className="rounded-lg border border-border-muted bg-bg-tertiary/40 p-4">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h4 className="text-sm font-medium text-text-primary">Transcript watcher</h4>
                        <p className="mt-1 text-xs text-text-secondary">
                            High confidence activates temporarily. Medium confidence asks first.
                        </p>
                    </div>
                    <button
                        type="button"
                        className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${watcherSettings.skillsWatcherEnabled ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                        role="switch"
                        aria-checked={watcherSettings.skillsWatcherEnabled}
                        onClick={() => updateWatcherSettings({ ...watcherSettings, skillsWatcherEnabled: !watcherSettings.skillsWatcherEnabled })}
                    >
                        <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${watcherSettings.skillsWatcherEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                </div>
                <p className="mt-3 text-[11px] text-text-tertiary">
                    Auto: {Math.round(watcherSettings.skillsWatcherAutoActivateThreshold * 100)}%.
                    Suggest: {Math.round(watcherSettings.skillsWatcherSuggestThreshold * 100)}%.
                </p>
            </div>
```

Add suggestion list below active activations:

```tsx
            {watcherSuggestions.length > 0 && (
                <div className="space-y-2">
                    <h4 className="text-sm font-medium text-text-primary">Watcher suggestions</h4>
                    {watcherSuggestions.map((suggestion) => (
                        <div key={suggestion.id} className="rounded-lg border border-border-muted bg-bg-tertiary/40 p-3">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm text-text-primary truncate">{suggestion.skillId}</p>
                                    <p className="text-xs text-text-secondary">
                                        Confidence {Math.round(suggestion.confidence * 100)}% · {suggestion.reason}
                                    </p>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                    <button type="button" className="text-xs text-accent-primary" onClick={() => acceptWatcherSuggestion(suggestion.id)}>
                                        Accept
                                    </button>
                                    <button type="button" className="text-xs text-text-secondary" onClick={() => dismissWatcherSuggestion(suggestion.id)}>
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
```

Ensure active activation rows have a cancel button that calls the existing `skillsDeactivate(skillId, scope)` bridge:

```tsx
    const deactivateSkill = async (skillId: string, scope?: SkillActivation['scope']) => {
        if (typeof window.electronAPI?.skillsDeactivate !== 'function') {
            setStatus('Skills deactivate bridge is unavailable.');
            return;
        }
        const result = await window.electronAPI.skillsDeactivate(skillId, scope);
        if (!result.success) {
            setStatus(result.error || 'Could not deactivate skill.');
        }
        await loadSkills();
    };
```

- [ ] **Step 6: Run UI wiring tests**

Run:

```bash
rtk npm test -- electron/services/__tests__/SkillsIpcWiring.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/components/settings/SkillsSettings.tsx electron/services/__tests__/SkillsIpcWiring.test.mjs
rtk git commit -m "feat: add skill watcher settings UI"
```

---

### Task 8: Full Verification and Documentation Check

**Files:**
- Modify: no production files unless verification exposes a defect in Phase 2 files.
- Test: all tests touched above plus repository verification.

**Interfaces:**
- Consumes: all Phase 2 commits.
- Produces: verified branch ready for review with known baseline typecheck status documented.

- [ ] **Step 1: Run focused Phase 2 tests**

Run:

```bash
rtk npm test -- \
  electron/services/__tests__/SkillActivationManager.test.mjs \
  electron/llm/__tests__/ChatPromptAssembly.test.mjs \
  electron/services/__tests__/ChatSkillActivation.test.mjs \
  electron/services/__tests__/SkillWatcherService.test.mjs \
  electron/services/__tests__/IntelligenceEngineSkillWatcher.test.mjs \
  electron/services/__tests__/SkillsIpcWiring.test.mjs
```

Expected: PASS for every listed test file.

- [ ] **Step 2: Run full test suite**

Run:

```bash
rtk npm test
```

Expected: PASS with the existing skipped tests unchanged.

- [ ] **Step 3: Run production build**

Run:

```bash
rtk npm run build
```

Expected: PASS. Existing Vite chunk-size warnings are acceptable if no new build failure appears.

- [ ] **Step 4: Run electron typecheck**

Run:

```bash
rtk npm run typecheck:electron
```

Expected: the known baseline `electron/services/knowledge/MaterialRagRetriever.ts(302,42/53)` implicit `any` errors may remain. Any new error in files changed by Phase 2 must be fixed before completion.

- [ ] **Step 5: Inspect git diff**

Run:

```bash
rtk git status --short
rtk git diff --stat HEAD
```

Expected: only intended Phase 2 files are modified before the final verification commit.

- [ ] **Step 6: Commit verification fixes if any were needed**

If verification required changes, commit them:

```bash
rtk git add electron src
rtk git commit -m "fix: stabilize skill usage phase 2"
```

Expected: commit succeeds only when there are actual verification fixes.
