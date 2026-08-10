# Native MCP Tool Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Windchill-specific and fixed-tool business-system paths with one dynamically discovered, schema-driven MCP agent loop that uses the selected model's native tool-calling API and emits privacy-safe process traces.

**Architecture:** `BusinessSystemContextService` continues to select a saved knowledge source and its `CredentialsManager` credential record. A generic `McpAgentLoop` creates an SDK-backed `McpRpcClient`, retrieves the complete dynamic tool catalog through a source-and-credential-scoped cache, asks a provider adapter to select tools and construct arguments, executes MCP calls, and feeds results back to the same model until it returns a final answer. OpenAI-compatible, Anthropic, and Gemini envelopes are isolated behind `ModelToolCallingAdapter`; unsupported provider/model pairs fail explicitly without prompt-JSON emulation or a Windchill fallback.

**Tech Stack:** Electron main-process TypeScript/CommonJS, `@modelcontextprotocol/sdk@^1.29.0`, OpenAI SDK 6, Anthropic SDK 0.74, Google GenAI SDK 1.44, Node test runner through Electron, existing `redactForLog()` and verbose-log flag.

## Global Constraints

- Production MCP endpoint and credentials come only from the selected saved business-system knowledge source and `CredentialsManager`; `.env` is test-only.
- Do not maintain Windchill tool schemas, argument templates, tool-name allowlists, write-operation gates, or prompt-generated JSON fallbacks.
- Preserve complete MCP `Tool` definitions and collect every `tools/list` page before exposing the catalog.
- Never silently truncate or preselect the MCP tool catalog.
- Never automatically retry `tools/call` because the client cannot infer idempotency.
- Do not log credentials, questions, transcripts, prompts, argument values, MCP result bodies, or complete model request/response bodies.
- Use the selected model only; do not silently change providers.
- Default budgets: initialize 10 seconds, complete discovery 30 seconds, one tool call 30 seconds, full agent run 90 seconds, maximum eight model turns.
- Every production change follows RED → GREEN → REFACTOR; each RED run must fail for the intended missing behavior.

---

## File Map

- Modify `electron/services/business-system/McpRpcClient.ts`: SDK-backed Streamable HTTP session, full tool type, paginated discovery, notification hook, call and close.
- Create `electron/services/business-system/McpToolCatalogCache.ts`: source/credential-revision cache with TTL and explicit invalidation.
- Create `electron/services/business-system/ModelToolCallingAdapter.ts`: provider-neutral conversation and adapter contracts.
- Create `electron/services/business-system/OpenAICompatibleToolAdapter.ts`: OpenAI-compatible tool envelope conversion.
- Create `electron/services/business-system/AnthropicToolAdapter.ts`: Anthropic tool envelope conversion.
- Create `electron/services/business-system/GeminiToolAdapter.ts`: Gemini function declaration and response conversion.
- Create `electron/services/business-system/SelectedModelToolAdapterFactory.ts`: selected-model binding to the appropriate adapter.
- Create `electron/services/business-system/McpProcessTraceLogger.ts`: privacy-safe structured process events.
- Create `electron/services/business-system/McpAgentLoop.ts`: bounded model/tool orchestration.
- Modify `electron/LLMHelper.ts`: expose a narrow selected-model tool-calling binding without exposing credentials.
- Modify `electron/services/CredentialsManager.ts`: expose an in-memory business-source credential revision.
- Modify `electron/services/business-system/BusinessSystemTypes.ts`: stable MCP failure codes and agent-facing result types.
- Modify `electron/services/business-system/BusinessSystemContextService.ts`: route every selected knowledge source through `McpAgentLoop`.
- Modify `electron/services/context/WhatToSayContextPreparation.ts`: construct the default service with the current `LLMHelper`.
- Modify `electron/services/SettingsManager.ts`: internal, non-UI native-MCP availability gate for rollout/rollback.
- Modify `electron/ipcHandlers.ts`: pass `LLMHelper` to context preparation and make source connection testing generic.
- Delete production-only legacy modules after migration: `BusinessMcpClient.ts`, `WindchillBusinessContextAdapter.ts`, `windchill/WindchillQueryPlanner.ts`, and `windchill/WindchillResultFormatter.ts`.
- Add focused behavior tests under `electron/services/business-system/__tests__/` and update affected contract tests under `electron/services/__tests__/`.
- Create `scripts/test-business-mcp-agent-real.mjs` and add an opt-in package script for the release test.

---

### Task 1: SDK-backed MCP protocol client

**Files:**
- Modify: `electron/services/business-system/McpRpcClient.ts`
- Modify: `electron/services/business-system/__tests__/McpRpcClient.behavior.test.mjs`
- Modify: `electron/services/__tests__/McpRpcClient.test.mjs`

**Interfaces:**
- Consumes: `BusinessSystemKnowledgeSource`, `BusinessSystemCredentialInput`, SDK `Tool`, SDK `CallToolResult`.
- Produces: `McpRpcClient.connect(timeoutMs, signal?)`, `listTools(timeoutMs, signal?)`, `callTool(name, args, timeoutMs, signal?)`, `close()`, and `setToolsChangedHandler(handler)`.

- [ ] **Step 1: Write failing protocol tests**

Add tests that inject a fake SDK session and prove complete pagination, full field preservation, repeated-cursor rejection, cancellation forwarding, tool-call no-retry, and close behavior:

```js
test('listTools follows every cursor and preserves complete tool definitions', async () => {
  const pages = [
    { tools: [{ name: 'part_search', description: 'Search', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true }, _meta: { owner: 'server' } }], nextCursor: 'p2' },
    { tools: [{ name: 'part_get', inputSchema: { type: 'object', required: ['id'] }, outputSchema: { type: 'object' } }] },
  ];
  const session = fakeSession({ listTools: async ({ cursor } = {}) => cursor ? pages[1] : pages[0] });
  const client = new McpRpcClient({ source: source(), credentials: { apiKey: 'secret' }, sessionFactory: () => session });

  await client.connect(1000);
  const tools = await client.listTools(1000);

  assert.equal(tools.length, 2);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools[0]._meta.owner, 'server');
  assert.equal(tools[1].outputSchema.type, 'object');
  assert.deepEqual(session.listCursors, [undefined, 'p2']);
});

test('listTools rejects a repeated cursor instead of returning a partial catalog', async () => {
  const session = fakeSession({ listTools: async () => ({ tools: [], nextCursor: 'same' }) });
  const client = new McpRpcClient({ source: source(), sessionFactory: () => session });
  await client.connect(1000);
  await assert.rejects(() => client.listTools(1000), /repeated tools\/list cursor/);
});

test('callTool performs exactly one SDK call when transport fails', async () => {
  let attempts = 0;
  const session = fakeSession({ callTool: async () => { attempts += 1; throw new Error('network failed'); } });
  const client = new McpRpcClient({ source: source(), sessionFactory: () => session });
  await client.connect(1000);
  await assert.rejects(() => client.callTool('part_create', { name: 'x' }, 1000));
  assert.equal(attempts, 1);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm run build:electron && ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/business-system/__tests__/McpRpcClient.behavior.test.mjs electron/services/__tests__/McpRpcClient.test.mjs
```

Expected: FAIL because the current client has no `source`, `sessionFactory`, pagination, close, or notification API and narrows tool definitions.

- [ ] **Step 3: Implement the minimal SDK wrapper**

Use the SDK's `Client` and `StreamableHTTPClientTransport`; keep test injection at the session boundary:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';

export interface McpSession {
  connect(timeoutMs: number, signal?: AbortSignal): Promise<void>;
  listTools(cursor: string | undefined, timeoutMs: number, signal?: AbortSignal): Promise<{ tools: Tool[]; nextCursor?: string }>;
  callTool(name: string, args: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<CallToolResult>;
  close(): Promise<void>;
  setToolsChangedHandler(handler: () => void): void;
}

export class McpRpcClient {
  private readonly session: McpSession;

  async connect(timeoutMs = 10_000, signal?: AbortSignal): Promise<void> {
    await this.session.connect(timeoutMs, signal);
  }

  async listTools(timeoutMs = 30_000, signal?: AbortSignal): Promise<Tool[]> {
    const tools: Tool[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      if (cursor && seen.has(cursor)) throw new Error(`MCP protocol error: repeated tools/list cursor ${cursor}`);
      if (cursor) seen.add(cursor);
      const page = await this.session.listTools(cursor, timeoutMs, signal);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  callTool(name: string, args: Record<string, unknown>, timeoutMs = 30_000, signal?: AbortSignal): Promise<CallToolResult> {
    return this.session.callTool(name, args, timeoutMs, signal);
  }

  close(): Promise<void> {
    return this.session.close();
  }
}
```

The real session must create request headers only from `source.authType` and the supplied knowledge-source credential record. It must register `ToolListChangedNotificationSchema` and must not read `.env`.

- [ ] **Step 4: Run GREEN and typecheck**

Run the Task 1 test command, then `npm run typecheck:electron`.

Expected: both focused suites PASS and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add electron/services/business-system/McpRpcClient.ts electron/services/business-system/__tests__/McpRpcClient.behavior.test.mjs electron/services/__tests__/McpRpcClient.test.mjs
git commit -m "refactor: use SDK-backed MCP protocol client"
```

---

### Task 2: Catalog cache and credential identity isolation

**Files:**
- Create: `electron/services/business-system/McpToolCatalogCache.ts`
- Create: `electron/services/business-system/__tests__/McpToolCatalogCache.behavior.test.mjs`
- Modify: `electron/services/CredentialsManager.ts`
- Modify: `electron/services/__tests__/BusinessSystemCredentials.test.mjs`

**Interfaces:**
- Produces: `McpToolCatalogCache.getOrLoad({ sourceId, credentialRevision, load })`, `invalidate(sourceId)`, and `CredentialsManager.getBusinessSystemCredentialRevision(sourceId): number`.

- [ ] **Step 1: Write failing cache and revision tests**

```js
test('same URL with different credential revisions cannot share a catalog', async () => {
  const cache = new McpToolCatalogCache({ ttlMs: 600_000, now: () => 100 });
  let loads = 0;
  const first = await cache.getOrLoad({ sourceId: 'plm', credentialRevision: 1, load: async () => [{ name: `tool-${++loads}`, inputSchema: { type: 'object' } }] });
  const second = await cache.getOrLoad({ sourceId: 'plm', credentialRevision: 2, load: async () => [{ name: `tool-${++loads}`, inputSchema: { type: 'object' } }] });
  assert.equal(first[0].name, 'tool-1');
  assert.equal(second[0].name, 'tool-2');
});

test('saving or deleting a business source increments its in-memory credential revision', () => {
  const before = manager.getBusinessSystemCredentialRevision('plm');
  manager.saveBusinessSystemKnowledgeSource(source(), { apiKey: 'new-key' });
  assert.equal(manager.getBusinessSystemCredentialRevision('plm'), before + 1);
  manager.deleteBusinessSystemKnowledgeSource('plm');
  assert.equal(manager.getBusinessSystemCredentialRevision('plm'), before + 2);
});
```

- [ ] **Step 2: Run RED**

Run the two focused test files after `npm run build:electron`.

Expected: FAIL because cache and revision APIs do not exist.

- [ ] **Step 3: Implement minimal cache and revision counter**

```ts
export class McpToolCatalogCache {
  private readonly entries = new Map<string, { expiresAt: number; tools: Tool[] }>();

  async getOrLoad(input: { sourceId: string; credentialRevision: number; load: () => Promise<Tool[]> }): Promise<Tool[]> {
    const key = `${input.sourceId}:${input.credentialRevision}`;
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.tools;
    const tools = await input.load();
    this.invalidate(input.sourceId);
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, tools });
    return tools;
  }

  invalidate(sourceId: string): void {
    for (const key of this.entries.keys()) if (key.startsWith(`${sourceId}:`)) this.entries.delete(key);
  }
}
```

Add a private `businessSystemCredentialRevisions` map to `CredentialsManager`; increment only on source save/delete and return `0` before the first mutation. Never persist or log the counter.

- [ ] **Step 4: Run GREEN**

Run focused tests and `npm run typecheck:electron`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/business-system/McpToolCatalogCache.ts electron/services/business-system/__tests__/McpToolCatalogCache.behavior.test.mjs electron/services/CredentialsManager.ts electron/services/__tests__/BusinessSystemCredentials.test.mjs
git commit -m "feat: isolate MCP tool catalog caches"
```

---

### Task 3: Provider-neutral adapter contract and OpenAI-compatible adapter

**Files:**
- Create: `electron/services/business-system/ModelToolCallingAdapter.ts`
- Create: `electron/services/business-system/OpenAICompatibleToolAdapter.ts`
- Create: `electron/services/business-system/__tests__/OpenAICompatibleToolAdapter.behavior.test.mjs`

**Interfaces:**
- Produces: `McpAgentMessage`, `ModelRequestedToolCall`, `ModelToolCallingAdapter.runTurn()`, and `OpenAICompatibleToolAdapter`.

- [ ] **Step 1: Write failing OpenAI envelope tests**

```js
test('passes every MCP tool and schema to OpenAI without filtering', async () => {
  const requests = [];
  const adapter = new OpenAICompatibleToolAdapter({
    provider: 'doubao', model: 'doubao-test',
    createCompletion: async (request) => { requests.push(request); return { choices: [{ message: { content: '完成' } }] }; },
  });
  const tools = makeTools(198);
  const turn = await adapter.runTurn({ messages: [{ role: 'user', text: '查询零件' }], tools, timeoutMs: 1000 });
  assert.equal(turn.type, 'answer');
  assert.equal(requests[0].tools.length, 198);
  assert.deepEqual(requests[0].tools[197].function.parameters, tools[197].inputSchema);
});

test('parses native parallel tool calls without generating arguments itself', async () => {
  const adapter = adapterReturning({ tool_calls: [
    { id: 'c1', type: 'function', function: { name: 'part_search', arguments: '{"number":"A-1"}' } },
    { id: 'c2', type: 'function', function: { name: 'project_list', arguments: '{}' } },
  ] });
  const turn = await adapter.runTurn(baseInput());
  assert.deepEqual(turn.calls.map((call) => call.arguments), [{ number: 'A-1' }, {}]);
});
```

- [ ] **Step 2: Run RED**

Expected: FAIL because adapter modules do not exist.

- [ ] **Step 3: Implement the neutral messages and adapter**

```ts
export type McpAgentMessage =
  | { role: 'system' | 'user'; text: string }
  | { role: 'assistant'; text?: string; toolCalls?: ModelRequestedToolCall[] }
  | { role: 'tool'; callId: string; name: string; result: CallToolResult };

export interface ModelToolCallingAdapter {
  readonly provider: string;
  readonly model: string;
  runTurn(input: { messages: McpAgentMessage[]; tools: Tool[]; timeoutMs: number; abortSignal?: AbortSignal }): Promise<
    | { type: 'tool_calls'; calls: ModelRequestedToolCall[] }
    | { type: 'answer'; text: string }
  >;
}
```

The OpenAI-compatible adapter must map the entire tool array to `{ type: 'function', function: { name, description, parameters: inputSchema } }`, serialize MCP result content only into the native `tool` message, reject malformed non-object argument JSON, and classify provider catalog rejection as `mcp_tool_catalog_unsupported`. It must not inspect Windchill names.

- [ ] **Step 4: Run GREEN and typecheck**

Expected: focused adapter tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add electron/services/business-system/ModelToolCallingAdapter.ts electron/services/business-system/OpenAICompatibleToolAdapter.ts electron/services/business-system/__tests__/OpenAICompatibleToolAdapter.behavior.test.mjs
git commit -m "feat: add OpenAI-compatible MCP tool adapter"
```

---

### Task 4: Anthropic, Gemini, and selected-model binding

**Files:**
- Create: `electron/services/business-system/AnthropicToolAdapter.ts`
- Create: `electron/services/business-system/GeminiToolAdapter.ts`
- Create: `electron/services/business-system/SelectedModelToolAdapterFactory.ts`
- Create: `electron/services/business-system/__tests__/ProviderToolAdapters.behavior.test.mjs`
- Modify: `electron/LLMHelper.ts`
- Modify: `electron/llm/__tests__/LLMHelper.BasicAndSetters.test.mjs`

**Interfaces:**
- Produces: `LLMHelper.getSelectedToolCallingBinding()` and `createSelectedModelToolAdapter(llmHelper)`.

- [ ] **Step 1: Write failing provider mapping and binding tests**

```js
test('Anthropic uses input_schema and parses tool_use blocks', async () => {
  const adapter = anthropicAdapterReturning([{ type: 'tool_use', id: 'a1', name: 'part_get', input: { id: 'OR:1' } }]);
  const turn = await adapter.runTurn(baseInput());
  assert.equal(adapter.lastRequest.tools[0].input_schema.type, 'object');
  assert.deepEqual(turn.calls[0], { callId: 'a1', name: 'part_get', arguments: { id: 'OR:1' } });
});

test('Gemini uses functionDeclarations and parses functionCall parts', async () => {
  const adapter = geminiAdapterReturning([{ functionCall: { name: 'part_search', args: { number: 'A-1' } } }]);
  const turn = await adapter.runTurn(baseInput());
  assert.equal(adapter.lastRequest.config.tools[0].functionDeclarations.length, baseInput().tools.length);
  assert.equal(turn.calls[0].name, 'part_search');
});

test('selected Doubao and QCLOUD models bind to OpenAI-compatible adapters', () => {
  helper.setModel('doubao-seed-test');
  assert.equal(helper.getSelectedToolCallingBinding().kind, 'openai_compatible');
  helper.setModel('natively');
  assert.equal(helper.getSelectedToolCallingBinding().kind, 'openai_compatible');
});
```

- [ ] **Step 2: Run RED**

Expected: FAIL because bindings and adapters do not exist.

- [ ] **Step 3: Implement native envelopes and narrow LLM binding**

```ts
export type SelectedToolCallingBinding =
  | { kind: 'openai_compatible'; provider: string; model: string; client: unknown }
  | { kind: 'anthropic'; provider: 'claude'; model: string; client: unknown }
  | { kind: 'gemini'; provider: 'gemini'; model: string; client: unknown }
  | { kind: 'unsupported'; provider: string; model: string };
```

`LLMHelper.getSelectedToolCallingBinding()` may expose client objects but never keys. It must classify QCLOUD, OpenAI, Doubao, and Groq as OpenAI-compatible; Claude as Anthropic; Gemini as Gemini; and Ollama/custom/cURL/Codex CLI as unsupported. `SelectedModelToolAdapterFactory` converts only this binding into an adapter and returns `mcp_tool_calling_unsupported` for unsupported or unconfigured pairs. Before the first model call, it must apply the existing provider data-scope policy to the question/recent-context payload.

Add a test that denies transcript scope for the selected cloud provider and asserts `runTurn()` rejects before the provider client is called. This is the existing LLM privacy policy, not an MCP tool permission filter.

- [ ] **Step 4: Run GREEN and typecheck**

Expected: focused tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add electron/LLMHelper.ts electron/llm/__tests__/LLMHelper.BasicAndSetters.test.mjs electron/services/business-system/AnthropicToolAdapter.ts electron/services/business-system/GeminiToolAdapter.ts electron/services/business-system/SelectedModelToolAdapterFactory.ts electron/services/business-system/__tests__/ProviderToolAdapters.behavior.test.mjs
git commit -m "feat: bind selected models to MCP tool adapters"
```

---

### Task 5: Bounded MCP agent loop and privacy-safe trace logger

**Files:**
- Create: `electron/services/business-system/McpProcessTraceLogger.ts`
- Create: `electron/services/business-system/McpAgentLoop.ts`
- Create: `electron/services/business-system/__tests__/McpProcessTraceLogger.behavior.test.mjs`
- Create: `electron/services/business-system/__tests__/McpAgentLoop.behavior.test.mjs`

**Interfaces:**
- Produces: `McpAgentLoop.run({ source, credentials, credentialRevision, question, recentContext, abortSignal })` returning `{ status: 'ok', answer, traceId, toolCalls }` or a stable MCP failure.

- [ ] **Step 1: Write failing loop and logging tests**

```js
test('feeds MCP result back to the model before returning the final answer', async () => {
  const adapter = scriptedAdapter([
    { type: 'tool_calls', calls: [{ callId: 'c1', name: 'part_search', arguments: { number: 'A-1' } }] },
    { type: 'answer', text: 'A-1 已发布。' },
  ]);
  const result = await loop({ adapter, tools: [tool('part_search')], callResult: { content: [{ type: 'text', text: '{"state":"RELEASED"}' }] } }).run(request());
  assert.equal(result.status, 'ok');
  assert.equal(result.answer, 'A-1 已发布。');
  assert.equal(adapter.turns[1].messages.at(-1).role, 'tool');
});

test('never logs credentials, questions, argument values, or result bodies', async () => {
  logger.event('mcp_tool_call_completed', {
    authorization: 'Bearer secret-token', question: '查秘密物料',
    argumentShape: { number: { type: 'string', length: 10 } },
    arguments: { number: 'SECRET-123' }, result: { text: 'confidential record' },
  });
  const output = sink.join('\n');
  assert.doesNotMatch(output, /secret-token|秘密物料|SECRET-123|confidential record/);
  assert.match(output, /mcp_tool_call_completed/);
});

test('does not retry a failed tools call and returns the error to the next model turn', async () => {
  assert.equal(mcp.callCount, 1);
  assert.equal(adapter.turns[1].messages.at(-1).role, 'tool');
});

test('executes multiple tool calls from one model turn sequentially', async () => {
  const order = [];
  mcp.callTool = async (name) => { order.push(`start:${name}`); order.push(`end:${name}`); return textResult(name); };
  await loop.run(requestWithTwoCalls());
  assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']);
});

test('stops after eight model turns with mcp_agent_limit_reached', async () => {
  adapter.alwaysReturnToolCall();
  const result = await loop.run(request());
  assert.equal(result.errorCode, 'mcp_agent_limit_reached');
  assert.equal(adapter.turns.length, 8);
});

test('normalizes every transport and orchestration failure code', async (t) => {
  for (const code of ['mcp_auth_failed', 'mcp_timeout', 'mcp_unavailable', 'mcp_protocol_error', 'mcp_tool_calling_unsupported', 'mcp_tool_catalog_unsupported', 'mcp_tool_result_unsupported']) {
    await t.test(code, async () => assert.equal((await runFailure(code)).errorCode, code));
  }
});
```

- [ ] **Step 2: Run RED**

Expected: FAIL because loop and logger do not exist.

- [ ] **Step 3: Implement the minimal loop and logger**

```ts
for (let turn = 1; turn <= 8; turn += 1) {
  const decision = await adapter.runTurn({ messages, tools, timeoutMs: remaining(), abortSignal });
  if (decision.type === 'answer') return { status: 'ok', answer: decision.text, traceId, toolCalls };
  for (const call of decision.calls) {
    let result: CallToolResult;
    try {
      result = await client.callTool(call.name, call.arguments, Math.min(30_000, remaining()), abortSignal);
    } catch (error) {
      result = { isError: true, content: [{ type: 'text', text: stableToolError(error) }] };
    }
    messages.push({ role: 'assistant', toolCalls: [call] });
    messages.push({ role: 'tool', callId: call.callId, name: call.name, result });
    toolCalls += 1;
  }
}
return { status: 'error', errorCode: 'mcp_agent_limit_reached', traceId, toolCalls };
```

The loop must connect before loading the catalog, bind `tools/list_changed` to cache invalidation, close in `finally`, clamp each stage to the remaining 90-second budget, and never call a tool twice automatically. The logger records only trace ID, stage, provider/model, hostname, tool/schema metadata, argument field names/types/counts/lengths, timings, statuses, and result shape/bytes. Successful events use `console.log` only when `isVerboseLogging()` is true; minimal failures use `console.warn` in both modes; every payload passes through `redactForLog()`.

- [ ] **Step 4: Run GREEN and typecheck**

Expected: loop/logger suites PASS and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add electron/services/business-system/McpProcessTraceLogger.ts electron/services/business-system/McpAgentLoop.ts electron/services/business-system/__tests__/McpProcessTraceLogger.behavior.test.mjs electron/services/business-system/__tests__/McpAgentLoop.behavior.test.mjs
git commit -m "feat: add bounded MCP agent loop tracing"
```

---

### Task 6: Replace production business-system routing

**Files:**
- Modify: `electron/services/business-system/BusinessSystemTypes.ts`
- Modify: `electron/services/business-system/BusinessSystemContextService.ts`
- Modify: `electron/services/business-system/__tests__/BusinessSystemContextService.behavior.test.mjs`
- Modify: `electron/services/__tests__/BusinessSystemContextService.test.mjs`
- Modify: `electron/services/__tests__/BusinessSystemContextService.plm.test.mjs`
- Modify: `electron/services/__tests__/BusinessSystemContextService.comprehensive.test.mjs`
- Modify: `electron/services/context/WhatToSayContextPreparation.ts`
- Modify: `electron/services/__tests__/WhatToSayContextPreparation.test.mjs`
- Modify: `electron/services/SettingsManager.ts`
- Create: `electron/services/__tests__/NativeMcpCapabilityGate.test.mjs`
- Modify: `electron/ipcHandlers.ts`
- Modify: `electron/services/__tests__/BusinessSystemSettingsIpc.test.mjs`

**Interfaces:**
- `BusinessSystemContextServiceDeps` consumes `agentLoop.run` and credential revision.
- `WhatToSayContextPreparationInput` consumes `llmHelper?: LLMHelper` for default service construction.

- [ ] **Step 1: Write failing integration tests**

```js
test('PLM and generic sources use the same MCP agent loop', async () => {
  const calls = [];
  const service = new BusinessSystemContextService({
    credentialsManager: credentialsManagerStub([source({ kind: 'plm' })]),
    agentLoop: { run: async (input) => { calls.push(input); return { status: 'ok', answer: '动态结果', traceId: 't1', toolCalls: 1 }; } },
  });
  const result = await service.resolve({ question: '根据 PLM 查询物料 A123' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source.url, 'https://plm.example.test/mcp');
  assert.equal(calls[0].credentials.apiKey, 'secret-key');
  assert.equal(result.answer, '动态结果');
});

test('default context preparation constructs native MCP service with the current LLMHelper', async () => {
  const result = await prepareWhatToSayContext({ question: '根据 PLM 查询 A123', llmHelper, ...requiredDecisionInput });
  assert.equal(bindingFactory.lastHelper, llmHelper);
});

test('connection testing initializes and lists tools for every MCP source kind', () => {
  assert.doesNotMatch(ipcSource, /source\.kind === ['"]plm['"]/);
  assert.match(ipcSource, /client\.listTools/);
  assert.doesNotMatch(ipcSource, /business_context\.query/);
});

test('ordinary answers receive the MCP agent answer as business_system context', async () => {
  const result = await service.resolve({ question: '根据 ERP 查询订单 SO-1' });
  assert.equal(result.kind, 'context');
  assert.equal(result.candidate.source, 'business_system');
  assert.match(result.candidate.text, /动态结果/);
});

test('business_system_query returns the MCP agent final answer without a second LLM stage', async () => {
  const prepared = await prepareForDynamicBusinessAction();
  assert.equal(prepared.businessSystemResult.answer, '动态结果');
  assert.equal(answerPipelineCalls, 0);
});

test('disabled native MCP capability gate reports unavailable without legacy fallback', async () => {
  settings.set('nativeMcpToolCallingEnabled', false);
  const result = await service.resolve({ question: '根据 PLM 查询 A123' });
  assert.equal(result.status, 'unavailable');
  assert.equal(agentCalls, 0);
  assert.equal(legacyCalls, 0);
});
```

- [ ] **Step 2: Run RED**

Expected: FAIL because the service still branches to `plmAdapter`/`BusinessMcpClient`, context preparation does not receive `LLMHelper`, and IPC connection testing is kind-specific.

- [ ] **Step 3: Implement one generic production path**

Replace the branch in `resolve()` with:

```ts
const agentResult = await this.agentLoop.run({
  source,
  credentials,
  credentialRevision: this.credentialsManager.getBusinessSystemCredentialRevision(source.id),
  question: trigger.query || '',
  recentContext: trigger.recentContext,
});
if (agentResult.status !== 'ok') {
  return toBusinessSystemFixedReply({ status: mapAgentFailure(agentResult.errorCode), sourceName: source.name });
}
return {
  kind: 'context', status: 'ok', sourceName: source.name,
  candidate: buildAgentContextCandidate(source, agentResult.answer),
  answer: agentResult.answer,
};
```

`WhatToSayContextPreparationService.getDefaultBusinessSystemService(llmHelper)` creates one cached `McpAgentLoop` using `createSelectedModelToolAdapter(llmHelper)`. `generate-what-to-say` passes `appState.processingHelper.getLLMHelper()` into context preparation. The source connection IPC always uses `McpRpcClient.connect()` plus complete `listTools()` and never invokes a business tool.

Add hidden `SettingsManager` key `nativeMcpToolCallingEnabled` with default `true` and no renderer/preload/IPC control. `BusinessSystemContextService` checks it before constructing an agent run. A false value returns the existing unavailable fixed reply and never invokes a legacy path or another provider; this is the spec's internal rollout/rollback gate, not MCP authorization.

- [ ] **Step 4: Run GREEN and typecheck**

Run all listed Task 6 tests and `npm run typecheck:electron`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/services/business-system/BusinessSystemTypes.ts electron/services/business-system/BusinessSystemContextService.ts electron/services/business-system/__tests__/BusinessSystemContextService.behavior.test.mjs electron/services/__tests__/BusinessSystemContextService.test.mjs electron/services/__tests__/BusinessSystemContextService.plm.test.mjs electron/services/__tests__/BusinessSystemContextService.comprehensive.test.mjs electron/services/context/WhatToSayContextPreparation.ts electron/services/__tests__/WhatToSayContextPreparation.test.mjs electron/services/SettingsManager.ts electron/services/__tests__/NativeMcpCapabilityGate.test.mjs electron/ipcHandlers.ts electron/services/__tests__/BusinessSystemSettingsIpc.test.mjs
git commit -m "refactor: route knowledge sources through MCP agent loop"
```

---

### Task 7: Remove legacy planner paths and add release evidence

**Files:**
- Delete: `electron/services/business-system/BusinessMcpClient.ts`
- Delete: `electron/services/business-system/WindchillBusinessContextAdapter.ts`
- Delete: `electron/services/business-system/windchill/WindchillQueryPlanner.ts`
- Delete: `electron/services/business-system/windchill/WindchillResultFormatter.ts`
- Delete obsolete tests for those modules under `electron/services/__tests__/` and `electron/services/business-system/__tests__/`.
- Modify: `electron/services/__tests__/BusinessSystemMainChain.contract.test.mjs`
- Modify: `electron/services/__tests__/BusinessSystemIpWiring.plm.test.mjs`
- Create: `scripts/test-business-mcp-agent-real.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces opt-in command `npm run test:business-mcp-agent:real -- --url <development-mcp-url>` using `Windchill_MCP_KEY` only inside the script.

- [ ] **Step 1: Write failing source-contract tests**

```js
test('production business-system path contains no legacy planner or fixed MCP tool', () => {
  const production = readProductionBusinessSystemSources();
  assert.doesNotMatch(production, /WindchillQueryPlanner|planWindchillQuery|business_context\.query|BUSINESS_CONTEXT_TOOL_NAME/);
  assert.match(production, /McpAgentLoop/);
});

test('real test script is opt-in and keeps env credentials out of production', () => {
  const script = fs.readFileSync(path.join(root, 'scripts/test-business-mcp-agent-real.mjs'), 'utf8');
  assert.match(script, /Windchill_MCP_KEY/);
  assert.match(script, /--url/);
  const production = readProductionBusinessSystemSources();
  assert.doesNotMatch(production, /Windchill_MCP_KEY|process\.env/);
});
```

- [ ] **Step 2: Run RED**

Expected: FAIL because legacy modules and fixed production calls still exist and the release script is absent.

- [ ] **Step 3: Remove dead production code and add the opt-in script**

The script must:

```js
const url = readRequiredFlag('--url');
const token = process.env.Windchill_MCP_KEY;
const provider = readRequiredFlag('--provider');
if (!token) throw new Error('Windchill_MCP_KEY is required for this opt-in test');
// Construct the same McpAgentLoop used in production with an explicitly selected
// development model binding, run one configured non-mutating prompt, and print only:
// status, provider, model, toolCount, catalogBytes, connectMs, discoveryMs,
// modelTurns, toolCallCount, toolCallMs, totalMs, stable errorCode.
```

It must never print the endpoint path/query, credential, prompt, arguments, tool results, or answer body. Add:

```json
"test:business-mcp-agent:real": "npm run build:electron && node scripts/test-business-mcp-agent-real.mjs"
```

- [ ] **Step 4: Run GREEN and all focused business-system tests**

Run:

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test $(find electron/services/business-system/__tests__ -name '*.test.mjs') $(find electron/services/__tests__ -name 'BusinessSystem*.test.mjs') electron/services/__tests__/WhatToSayContextPreparation.test.mjs
npm run typecheck:electron
```

Expected: all tests PASS and typecheck exits 0. Do not run the real network script in the default suite.

- [ ] **Step 5: Run the environment-gated real release test**

Run with the user-provided development endpoint and the local `.env` test key:

```bash
npm run test:business-mcp-agent:real -- --url https://gbp-cultural-notices-speaking.trycloudflare.com/mcp --provider doubao
```

Expected: either `passed`, `mcp_tool_calling_unsupported`, or `mcp_tool_catalog_unsupported`; any other status fails. A direct protocol success is not accepted as agent-loop evidence.

- [ ] **Step 6: Commit**

```bash
git add -A electron/services/business-system electron/services/__tests__ scripts/test-business-mcp-agent-real.mjs package.json
git commit -m "test: verify native MCP production migration"
```

---

### Task 8: Final regression, review, and graph refresh

**Files:**
- Modify only files required by failures attributable to Tasks 1-7.

- [ ] **Step 1: Run complete verification**

```bash
npm run typecheck:electron
npm test
npm run test:quality:smoke
git diff --check HEAD~7..HEAD
```

Expected: all commands exit 0 with no new warnings attributable to native MCP changes.

- [ ] **Step 2: Review structural constraints**

Search production code and require zero matches outside the opt-in test script and historical docs:

```bash
rg -n "WindchillQueryPlanner|planWindchillQuery|BUSINESS_CONTEXT_TOOL_NAME|Windchill_MCP_KEY" electron
rg -n "arguments:|tool result|Authorization" electron/services/business-system/McpProcessTraceLogger.ts
```

Expected: no legacy planner/fixed-tool/env-key production references; logger code records shapes and metadata only.

- [ ] **Step 3: Run pre-landing code review**

Use the project review workflow against the implementation commits. Fix only definite issues, with a failing regression test before each production correction.

- [ ] **Step 4: Refresh the code graph**

Run the code-review-graph incremental update for the repository, then confirm the graph shows `BusinessSystemContextService -> McpAgentLoop -> McpRpcClient/ModelToolCallingAdapter` and no production edge to `WindchillQueryPlanner`.

- [ ] **Step 5: Final commit if verification required fixes**

```bash
git add <only-files-changed-by-verified-fixes>
git commit -m "fix: close native MCP verification gaps"
```

If no files changed, do not create an empty commit.
