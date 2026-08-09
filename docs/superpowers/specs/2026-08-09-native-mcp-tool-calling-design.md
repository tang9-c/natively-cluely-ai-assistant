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

## Scope

This design covers:

- Dynamic MCP tool discovery.
- Native LLM tool calling for OpenAI-compatible, Anthropic, and Gemini providers.
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

Tool discovery caches complete definitions for ten minutes per MCP server URL:

```ts
interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}
```

The cache retains the server-provided definitions without replacing or duplicating their schemas.

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
- `mcp_agent_limit_reached`

The client does not reproduce the server's `inputSchema` validation and does not translate individual Windchill business errors into client-owned policy rules.

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
- Argument field names, types, counts, lengths, and redacted short summaries.
- MCP latency, status, and stable error code.
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

## Testing Strategy

### Unit tests

- Each provider adapter converts MCP definitions into the provider's native tool format.
- Each provider adapter parses native tool calls and final answers.
- Unsupported providers return `mcp_tool_calling_unsupported` without JSON emulation.
- `McpRpcClient` preserves complete tool definitions and parses JSON and SSE responses.
- The trace logger redacts credentials, user content, arguments, and tool results.

### Agent-loop tests

- A one-tool lookup reaches a final model answer.
- A multi-step lookup feeds the first tool result back to the model before the second call.
- Multiple tool calls in one turn execute sequentially.
- A server parameter error is returned to the model and can be corrected on the next turn.
- All 196 fixture tool definitions reach the model adapter without client filtering.
- Cancellation, total timeout, provider rejection, and the eight-turn limit produce stable errors.
- Every event in one run carries the same trace ID.
- Verbose-off mode omits successful detail events and preserves a minimal failure event.

### Integration tests

- `BusinessSystemContextService` uses `McpAgentLoop` and no longer invokes `WindchillQueryPlanner`.
- `business_system_query` returns the agent's final answer directly.
- Ordinary answer preparation injects the business-system candidate into the realtime context plan.
- Connection testing still verifies initialization and reports the discovered tool count.

### Optional live smoke test

An environment-gated test uses configured development credentials to initialize the real MCP server, confirm the discovered tool count, perform one read-only natural-language lookup through the selected model, and print only privacy-safe trace metrics. It never runs in the default unit-test suite.

## Success Criteria

- No production business-system call depends on hard-coded Windchill tool names or argument templates.
- All server-advertised tools and schemas are available to the selected model adapter.
- Tool arguments originate from native model tool calls and are sent through MCP without client-owned Windchill schema copies.
- Multi-turn tool execution works with server errors and dependent calls.
- Unsupported model providers fail explicitly rather than using prompt-based JSON emulation.
- MCP debug traces can reconstruct stages, selected tools, timings, and failures without exposing credentials or complete business data.
- Existing business-system settings and source credentials continue to work without migration.
