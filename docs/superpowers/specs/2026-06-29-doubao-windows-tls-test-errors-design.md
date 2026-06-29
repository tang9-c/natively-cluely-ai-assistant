# Doubao Windows TLS Test Error Handling Design

## Summary

Fix the Doubao configuration/test surfaces so Windows TLS certificate failures are reported as certificate-chain problems, not misleading API key failures. This is a minimal-risk stopgap: it changes error classification, user-facing messages, and safe diagnostics only. It does not change the runtime network stack for actual Doubao LLM, STT, or embedding calls.

This addresses the reported `unable to verify the first certificate` error on new Windows installs while keeping the blast radius small.

## Scope

Cover these configuration/test paths:

- LLM Doubao test connection.
- Doubao model list fetching.
- STT Doubao test connection.
- STT Doubao AUC test connection.
- Safe logging for the above paths.

Do not change:

- Actual Doubao chat or streaming calls.
- Actual Doubao embedding calls.
- Actual Doubao STT or AUC transcription calls.
- Global `fetch`, axios defaults, Node TLS settings, or `electron.net.fetch`.
- TLS certificate validation behavior.

## Design

Add `electron/utils/networkErrorClassifier.ts` as a pure utility with no network calls, no credential access, and no Electron app lifecycle dependency.

Expose:

```ts
type NetworkErrorKind =
  | 'tls_certificate'
  | 'timeout'
  | 'auth'
  | 'http'
  | 'network'
  | 'unknown';

function classifyNetworkError(error: unknown): {
  kind: NetworkErrorKind;
  userMessage: string;
};

function toSafeNetworkDiagnostic(error: unknown, context: {
  provider: string;
  endpoint?: string;
}): {
  provider: string;
  endpointHost?: string;
  kind: NetworkErrorKind;
  code?: string;
  message?: string;
  status?: number;
  nodeVersion?: string;
  electronVersion?: string;
};
```

Classification must inspect `message`, `code`, `cause.message`, and `cause.code` recursively to a maximum depth of 3.

TLS certificate errors include:

- `unable to verify the first certificate`
- `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
- `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`
- `SELF_SIGNED_CERT_IN_CHAIN`
- `CERT_HAS_EXPIRED`

Other classes:

- `timeout`: `ECONNABORTED`, `ETIMEDOUT`, or timeout text.
- `auth`: HTTP `401` or `403`.
- `http`: other HTTP statuses.
- `network`: `ENOTFOUND`, `ECONNRESET`, `ECONNREFUSED`, and similar transport errors.
- `unknown`: fallback.

TLS user message:

```text
证书链验证失败。这通常不是 API Key 错误，而是当前 Windows 环境的 Node/Electron 证书信任链无法验证 Doubao 服务证书。请检查系统根证书更新、公司代理/杀软 HTTPS 扫描，或代理根证书是否已正确安装。
```

## Integration

Use the classifier only in the selected configuration/test paths.

- In `fetch-provider-models`, replace raw axios error logging with `toSafeNetworkDiagnostic(...)` for every provider. For Doubao failures, return `classifyNetworkError(error).userMessage`; keep non-Doubao user-facing messages equivalent to the current behavior.
- In `test-llm-connection`, keep the current request behavior, but route Doubao failures through the classifier and safe diagnostic logging.
- In `runSttConnectionTest`, apply the same handling for `doubao` and `doubao-auc`.
- Remove the current Doubao AUC API key prefix log. Key prefixes count as credential leakage.
- In `test-saved-stt-connection`, keep delegating to `runSttConnectionTest`; keep a classifier fallback for unexpected errors.

Non-Doubao providers should keep current behavior unless the change is required to avoid raw error logging in shared catch blocks.

## Safe Logging

Never log:

- API keys or key prefixes.
- `Authorization`, `X-Api-Key`, or other credential headers.
- Request bodies.
- Prompts.
- Audio content or base64 audio.
- Embedding input text.
- Raw axios errors.

Safe diagnostics may include:

- Provider id.
- Endpoint host only, not the full URL.
- Error kind.
- Error code.
- Sanitized error message.
- HTTP status.
- Node and Electron versions.

## Tests

Add `electron/services/__tests__/NetworkErrorClassifier.test.mjs`.

Cover:

- TLS classification from plain message.
- TLS classification from `code`.
- TLS classification from nested `cause.code`.
- TLS user message includes `证书链验证失败` and `不是 API Key 错误`.
- Auth classification for HTTP `401` and `403`.
- HTTP classification for other statuses.
- Timeout classification for `ECONNABORTED`, `ETIMEDOUT`, and timeout text.
- Network classification for `ENOTFOUND`, `ECONNRESET`, and `ECONNREFUSED`.
- Safe diagnostic output does not include `secret-key`, `secret-api-key`, `Authorization`, `X-Api-Key`, request body text, or private response headers from an axios-like error.

Add an IPC static test to assert:

- `apiKey.substring(0, 8)` is no longer present.
- `fetch-provider-models` does not log raw errors.
- Doubao LLM/STT test paths reference `classifyNetworkError` and `toSafeNetworkDiagnostic`.

Verification commands:

```bash
rtk npm run build:electron:tsc
rtk npm run build:electron
rtk node --test electron/services/__tests__/NetworkErrorClassifier.test.mjs
```

Run the new IPC static test file.

## Acceptance Criteria

- Doubao LLM test, Doubao model fetching, Doubao STT test, and Doubao AUC test return the explicit Chinese certificate-chain message for TLS certificate failures.
- API key failures still surface as auth failures, not certificate failures.
- Logs for covered paths contain no credentials, credential headers, request bodies, prompts, audio data, or raw axios error objects.
- Actual Doubao LLM, STT, AUC, and embedding runtime behavior is unchanged.
- No global network behavior changes are introduced.
