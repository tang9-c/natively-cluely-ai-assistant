# Native MCP Tool Calling Design

## Objective

Replace the Windchill-specific, hard-coded query planner with a generic MCP agent loop that discovers all tools from the configured MCP server, exposes their server-provided schemas to the selected LLM through native tool calling, executes the resulting MCP calls, and records privacy-safe process traces for debugging.

The MCP server remains responsible for authentication, authorization, tool availability, input validation, and business-level safety. Natively does not duplicate Windchill tool schemas, maintain a per-tool allowlist, or generate Windchill parameters with regular expressions.

## Current Problem

The current Windchill path calls `initialize`, `tools/list`, and `tools/call`, but it does not use MCP's dynamic capability model:

- `tools/list` results are reduced to a cached set of names.
- Tool descriptions and `inputSchema` do not participate in tool selection.
- `WindchillQueryPlanner` selects a small hard-coded subset of tools.
- Tool arguments are built from regular expressions and fixed templates.
- Adding or changing a server tool requires a client code change.

The implementation therefore uses MCP as a transport while bypassing dynamic discovery and schema-driven invocation.

## Validated Protocol Baseline

On 2026-08-09, the development Windchill MCP endpoint was tested with the project MCP SDK. The one-off test harness received the endpoint explicitly and read `Windchill_MCP_KEY` from the local `.env` file as test-only input. The credential value was not printed or persisted in test output. Neither input is a production runtime configuration source.

- An unauthenticated initialization reached the endpoint and returned `401 Unauthorized` with a Bearer-token requirement.
- Authenticated initialization negotiated with `windchill-mcp-v2` version `2.0.0`.
- `tools/list` returned 198 tools. All 198 had descriptions and object-shaped `inputSchema` values.
- The complete serialized tool list was 78,276 bytes. The tool count and payload size are runtime observations, not constants in the client contract.
- Three authenticated rounds of initialize, `tools/list`, and `servermanager_get_current_server` succeeded. Average timings were 2,207 ms for initialization, 1,584 ms for discovery, and 641 ms for the tool call.
- None of the 198 returned tools contained MCP annotations. Natively must preserve annotations when a server supplies them, but must not invent missing annotations or infer business permissions from tool names.

This evidence proves Streamable HTTP transport, Bearer authentication, dynamic discovery, schema delivery, and a direct read-only MCP call for the tested endpoint. It does not prove that every supported LLM provider accepts the complete 198-tool payload or that the full model-driven agent loop works end to end.

## Scope

This design covers:

- Dynamic MCP tool discovery.
- Native LLM tool-calling adapters for OpenAI-compatible, Anthropic, and Gemini providers, with MCP availability gated per provider/model pair by release-test evidence.
- A provider-independent MCP agent loop.
- Multi-turn tool execution.
- Privacy-safe process logging in the existing debug log.
- Integration with the existing business-system knowledge-source flow.
- Removal of the Windchill planner and formatter from the production invocation path.

This design does not add:

- Client-side copies of MCP tool schemas.
- Windchill-specific tool mappings or argument templates.
- A client-maintained business-method allowlist.
- Prompt-based JSON tool-calling emulation for unsupported models.
- A new logging preference or a separate log file.

## Architecture

```text
BusinessSystemContextService
  -> McpAgentLoop
      -> McpRpcClient
          -> initialize
          -> tools/list
          -> tools/call
      -> ModelToolCallingAdapter
          -> OpenAICompatibleToolAdapter
          -> AnthropicToolAdapter
          -> GeminiToolAdapter
      -> McpProcessTraceLogger
```

### McpRpcClient

`McpRpcClient` remains a protocol client. It owns MCP JSON-RPC transport, authentication headers, initialization, tool discovery, tool invocation, timeout propagation, and response parsing. It does not select tools or interpret Windchill business semantics.

#### Runtime source and authentication

Production runtime configuration comes exclusively from the business-system knowledge-source feature. `BusinessSystemContextService` selects a saved `BusinessSystemKnowledgeSource` from `CredentialsManager.getBusinessSystemKnowledgeSources()` and retrieves its credentials with `CredentialsManager.getBusinessSystemCredentials(source.id)`. The saved source supplies the MCP endpoint and `authType`; its separately stored credential record supplies the access key or username/password.

`McpRpcClient` receives that selected source and credential record. For `authType: 'api_key'`, it constructs `Authorization: Bearer <apiKey>` from the selected knowledge source's stored credential. For `authType: 'username_password'`, it uses the existing Basic authentication behavior. Production code does not read `Windchill_MCP_KEY`, an MCP endpoint, or any other business-system credential from `.env`; `Windchill_MCP_KEY` exists only as an opt-in live-test fixture.

#### Tool discovery and cache

Tool discovery caches complete definitions for ten minutes per configured source and credential revision. The client uses the MCP SDK's complete `Tool` type instead of a reduced local copy:

```ts
import type { Tool as McpToolDefinition } from '@modelcontextprotocol/sdk/types.js';
```

`McpRpcClient.listTools()` follows every `nextCursor` returned by `tools/list` and returns one ordered catalog only after pagination completes. A repeated cursor or a page-level timeout fails discovery with `mcp_protocol_error` or `mcp_timeout`; the client never exposes a partial catalog to the model.

The cache retains every server-provided field without replacing, narrowing, or duplicating schemas. Provider adapters may translate only fields supported by their model API, but `McpRpcClient`, the cache, schema hashing, and trace metrics operate on the unmodified MCP definitions. Tool count is never hard-coded.

The cache is scoped to the configured source ID and an in-memory credential revision supplied by `CredentialsManager`, not URL alone, because one endpoint may advertise different catalogs to different authenticated identities. The revision is an opaque change counter: it contains no credential material and is never logged or persisted as a replacement credential. Updating the endpoint or credential invalidates the entry. When a server advertises and sends `notifications/tools/list_changed`, the active entry is invalidated immediately; otherwise the ten-minute TTL applies.

### ModelToolCallingAdapter

The internal adapter interface hides provider API differences:

```ts
interface ModelToolCallingAdapter {
  runTurn(input: {
    messages: McpAgentMessage[];
    tools: McpToolDefinition[];
    abortSignal?: AbortSignal;
    timeoutMs: number;
  }): Promise<
    | { type: 'tool_calls'; calls: ModelRequestedToolCall[] }
    | { type: 'answer'; text: string }
  >;
}

interface ModelRequestedToolCall {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}
```

Provider adapters translate only the model API envelope:

- OpenAI-compatible: `tools` and `tool_calls`.
- Anthropic: `tools` and `tool_use` content blocks.
- Gemini: `functionDeclarations` and `functionCall` parts.

They do not contain MCP-server-specific logic. A selected provider without native tool-calling support returns `mcp_tool_calling_unsupported`; Natively does not silently fall back to prompt-generated JSON.

Before the first model request, an adapter serializes the complete discovered catalog into its native request format. If the provider rejects the catalog because of tool-count, request-size, schema, or context constraints, the adapter returns `mcp_tool_catalog_unsupported` with privacy-safe size and count metrics. Natively does not silently truncate tools, preselect tools by name, or introduce a second model-driven catalog-selection stage. This keeps behavior simple and preserves the server's dynamic catalog as the source of truth.

### McpAgentLoop

The agent loop owns orchestration but not business authorization:

1. Initialize the MCP session.
2. Fetch or reuse the complete tool definitions.
3. Send the user question, recent context, and all tool definitions to the selected model adapter.
4. If the model returns tool calls, invoke them sequentially through `McpRpcClient`.
5. Append each MCP result to the model conversation using the provider adapter's tool-result format.
6. Continue until the model returns a final answer.
7. Return the final answer and a privacy-safe execution summary to the business-system context service.

Sequential execution is intentional because later tool calls can depend on earlier results. The loop has an operational maximum of eight model turns, a total timeout, and cancellation support to prevent an indefinitely suspended request. These limits do not define MCP business permissions.

The model receives all tools returned by the server. The client does not filter Windchill methods. If a provider cannot accept the complete tool payload, the request fails explicitly and the trace records the provider error; the client does not introduce a hidden hard-coded selection layer.

MCP annotations are advisory metadata rather than client-owned authorization. Provider adapters pass through supported annotations when the native model API has an equivalent field. Missing annotations do not cause Natively to synthesize `readOnlyHint`, deny tools by name, or add a separate client safety policy. Authentication, authorization, input validation, and business-operation enforcement remain server responsibilities.

The default operational budget is 10 seconds for initialization, 30 seconds for complete paginated discovery, 30 seconds for one MCP tool call, and 90 seconds for the full agent run. Every stage is clamped to the remaining total budget and observes the caller's cancellation signal. These are availability controls, not business permissions. `tools/call` is never retried automatically because the client cannot infer idempotency; a model may issue a new call only after receiving the server error in a subsequent turn.

## Runtime Data Flow

```text
generate-what-to-say
  -> prepareWhatToSayContext
  -> prepareBusinessContext
  -> BusinessSystemContextService.resolve
  -> detect whether a business-system lookup was explicitly requested
  -> select configured source and credentials
  -> McpAgentLoop.run
  -> initialize / tools/list
  -> selected-model native tool calling
  -> zero or more tools/call requests
  -> model final answer
  -> BusinessSystemServiceResult
```

The existing business-system trigger remains responsible for deciding whether the user requested a business-system lookup and for rejecting requests that contain no usable lookup intent. It no longer chooses a Windchill tool or constructs tool arguments.

For a `business_system_query` dynamic action, Natively returns the MCP agent's final answer directly and records that the normal answer-generation stage was bypassed. For an ordinary answer flow, the final MCP agent answer and safe result summary become a `business_system` context candidate for the existing answer pipeline.

## Error Handling

MCP tool errors are returned to the model as tool results. The model may correct its arguments, choose another server-advertised tool, ask the user for missing information, or produce a final failure explanation.

Natively normalizes only transport and orchestration failures into stable codes:

- `mcp_auth_failed`
- `mcp_timeout`
- `mcp_unavailable`
- `mcp_protocol_error`
- `mcp_tool_calling_unsupported`
- `mcp_tool_catalog_unsupported`
- `mcp_tool_result_unsupported`
- `mcp_agent_limit_reached`

The client does not reproduce the server's `inputSchema` validation and does not translate individual Windchill business errors into client-owned policy rules. Provider adapters preserve MCP result content blocks when converting them into native tool-result messages. If a provider cannot represent the returned content type or rejects the result because of request/context size, the adapter returns `mcp_tool_result_unsupported`; it does not silently discard or truncate business data.

## Process Logging

MCP process traces use the existing verbose-logging preference and existing `~/Documents/natively_debug.log` destination. No separate log setting or file is introduced.

Each agent run receives one `traceId`. Structured events use that ID across the full lifecycle:

- `mcp_session_started`
- `mcp_tools_discovered`
- `mcp_model_turn_started`
- `mcp_tool_selected`
- `mcp_tool_call_started`
- `mcp_tool_call_completed`
- `mcp_tool_call_failed`
- `mcp_model_answered`
- `mcp_session_completed`

When verbose logging is enabled, events may contain:

- Timestamp, trace ID, and turn number.
- Selected provider and model.
- MCP server hostname, excluding credentials and sensitive URL material.
- Tool count, tool names, and schema hashes.
- Selected tool name.
- Argument field names, types, counts, and lengths. Argument values and value-derived summaries are never logged.
- MCP latency, status, and stable error code.
- Serialized tool-catalog byte size and provider rejection category.
- Result content type, record count, and byte size.
- Total duration, total tool calls, and completion reason.

The logger never stores:

- Authorization headers, API keys, passwords, or cookies.
- Complete user questions, transcripts, prompts, or recent meeting context.
- Complete tool arguments.
- Complete MCP tool results or business records.
- Complete LLM request or response bodies.

All structured events pass through `redactForLog()` before reaching console or disk.

When verbose logging is disabled, successful process events are omitted. Failures retain only the trace ID, stage, tool name, duration, and stable error code so production failures remain diagnosable without retaining business payloads.

## Compatibility and Migration

- The business-system settings UI and stored source format remain unchanged.
- `McpRpcClient` remains the single JSON-RPC transport implementation.
- The generic `BusinessMcpClient` fixed `business_context.query` path is replaced by the same MCP agent loop so all business-system MCP sources use dynamic discovery.
- `WindchillBusinessContextAdapter`, `WindchillQueryPlanner`, and the Windchill-specific result formatter leave the production invocation path after equivalent context-service behavior is covered by the new agent-loop tests.
- Existing deterministic tests that assert fixed Windchill tool names are replaced with tests of dynamic tool propagation and model-selected calls.
- Existing source connection testing continues to use `initialize` and `tools/list`; it reports discovered tool count without invoking a business method.

### Rollout and rollback

1. Land the generic transport, adapters, agent loop, and trace logger behind an internal native-MCP capability gate; this is not a user-facing security setting.
2. Run unit, agent-loop, integration, and environment-gated release tests before marking a provider/model pair MCP-capable.
3. Route business-system queries through `McpAgentLoop` only for a passing pair. Other pairs return the explicit unsupported status and do not fall back to prompt-generated JSON or the Windchill planner.
4. Remove the Windchill planner and formatter from the production invocation path after the new path passes equivalent behavior tests.

Rollback disables the native-MCP capability gate and reports the business-system source as temporarily unavailable. It never reactivates the hard-coded planner, silently changes providers, or sends the request through a non-MCP fallback. A release rollback may restore the previous application version, but runtime behavior remains explicit and observable in the trace.

## Testing Strategy

### Unit tests

- Each provider adapter converts MCP definitions into the provider's native tool format.
- Each provider adapter parses native tool calls and final answers.
- Unsupported providers return `mcp_tool_calling_unsupported` without JSON emulation.
- Provider catalog-limit failures return `mcp_tool_catalog_unsupported` without truncation or hidden tool selection.
- `McpRpcClient` preserves complete tool definitions and parses JSON and SSE responses.
- Paginated `tools/list` responses are accumulated completely; repeated cursors, failed pages, and cancellation never produce a partial catalog.
- Cache entries are isolated by source and credential revision and are invalidated by source updates, credential updates, TTL expiry, and supported `tools/list_changed` notifications.
- Tool definitions containing annotations, output schemas, icons, or future SDK-supported fields survive discovery and caching without being narrowed by a local interface.
- Unsupported MCP result content and provider context overflow return `mcp_tool_result_unsupported` without silent truncation.
- The trace logger redacts credentials, user content, arguments, and tool results.

### Agent-loop tests

- A one-tool lookup reaches a final model answer.
- A multi-step lookup feeds the first tool result back to the model before the second call.
- Multiple tool calls in one turn execute sequentially.
- A server parameter error is returned to the model and can be corrected on the next turn.
- Every definition in a variable-size fixture catalog reaches the model adapter without client filtering; the assertion derives the expected count from the fixture instead of a production tool-count constant.
- A 198-tool, approximately 78 KB fixture either reaches a provider adapter intact or produces `mcp_tool_catalog_unsupported`; partial delivery is a test failure.
- Different credentials on the same URL cannot reuse each other's cached catalog.
- An advertised `tools/list_changed` notification invalidates the matching active catalog.
- Cancellation, total timeout, provider rejection, and the eight-turn limit produce stable errors.
- `tools/call` transport failures are not automatically retried.
- Every event in one run carries the same trace ID.
- Verbose-off mode omits successful detail events and preserves a minimal failure event.

### Integration tests

- `BusinessSystemContextService` uses `McpAgentLoop` and no longer invokes `WindchillQueryPlanner`.
- `business_system_query` returns the agent's final answer directly.
- Ordinary answer preparation injects the business-system candidate into the realtime context plan.
- Connection testing still verifies initialization and reports the discovered tool count.

### Optional live protocol smoke test

An environment-gated test accepts an explicit development endpoint and reads `Windchill_MCP_KEY` from `.env` as test-only input. It does not modify, override, or act as a fallback for saved knowledge-source configuration. The test initializes the real MCP server, confirms that at least one complete tool definition is discovered, and performs a configured non-mutating direct MCP call against a development server/account. It records the observed count, catalog bytes, timings, result shape, and stable status without asserting a fixed count or printing credentials and business data. It never runs in the default unit-test suite.

### Environment-gated live agent-loop release test

A separate environment-gated release test sends a configured non-mutating natural-language prompt through every candidate provider/model pair, exposes the complete live MCP catalog, verifies that model-produced arguments reach `tools/call`, and verifies that the MCP result is returned to the model before the final answer. It stays outside the default unit-test suite but is required before marking native MCP tool calling available for that pair in a release. The endpoint and account must be designated for development testing because the generic client does not infer whether a tool is read-only when the server omits annotations.

For each provider, the test result is one of:

- `passed`: the complete catalog and end-to-end tool loop succeeded; MCP is available for this provider/model pair.
- `mcp_tool_calling_unsupported`: the model API has no native tool calling; MCP remains unavailable for this pair.
- `mcp_tool_catalog_unsupported`: the provider rejected the complete catalog; MCP remains unavailable for this pair.

Any other failure remains a failed test with a stable transport, protocol, model, or agent-loop error code. A direct MCP smoke-test success cannot substitute for this model-loop evidence.

## Success Criteria

- No production business-system call depends on hard-coded Windchill tool names or argument templates.
- All server-advertised tools and schemas are available to the selected model adapter.
- Complete MCP tool definitions are retained through discovery and caching; the client does not discard standard fields that are absent from today's Windchill response.
- Tool arguments originate from native model tool calls and are sent through MCP without client-owned Windchill schema copies.
- At least one provider/model pair passes the live full-catalog agent-loop release test. A pair is marked MCP-capable only after it passes; unsupported results remain explicit unavailable states and are not described as enabled MCP support.
- Multi-turn tool execution works with server errors and dependent calls.
- Paginated discovery, cache identity isolation, catalog invalidation, cancellation, and no-retry tool execution are covered by behavior tests.
- Unsupported model providers fail explicitly rather than using prompt-based JSON emulation.
- MCP debug traces can reconstruct stages, selected tools, timings, and failures without exposing credentials or complete business data.
- Existing business-system settings and source credentials continue to work without migration.
- Production MCP endpoints and credentials are read only from the selected saved knowledge source and its `CredentialsManager` credential record; `.env` values are never a runtime fallback.
- Rollout and rollback never silently restore the Windchill planner, switch providers, or emulate tool calling with prompt JSON.
