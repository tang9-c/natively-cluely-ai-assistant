# Doubao Windows TLS Test Error Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Doubao configuration/test connection failures classify Windows TLS certificate problems accurately and log only safe diagnostics.

**Architecture:** Add one pure network error utility, then wire only Doubao configuration/test paths through it. Runtime Doubao LLM, STT, AUC, embedding calls keep their current network stack.

**Tech Stack:** Electron main process TypeScript, CommonJS output through `electron/tsconfig.json`, Node `node:test`, static source assertions, `axios` error shapes.

## Global Constraints

- Cover LLM Doubao test connection, Doubao model list fetching, STT Doubao test connection, STT Doubao AUC test connection, and safe logging for these paths.
- Do not change actual Doubao chat, streaming, embedding, STT, or AUC transcription runtime calls.
- Do not change global `fetch`, axios defaults, Node TLS settings, `electron.net.fetch`, or TLS certificate validation behavior.
- Never log API keys, key prefixes, `Authorization`, `X-Api-Key`, request bodies, prompts, audio content, base64 audio, embedding input text, or raw axios errors.
- TLS certificate failures must return this exact Chinese message: `证书链验证失败。这通常不是 API Key 错误，而是当前 Windows 环境的 Node/Electron 证书信任链无法验证 Doubao 服务证书。请检查系统根证书更新、公司代理/杀软 HTTPS 扫描，或代理根证书是否已正确安装。`

---

## File Structure

- Create `electron/utils/networkErrorClassifier.ts`: pure utility for classifying unknown error objects and producing safe diagnostics.
- Create `electron/services/__tests__/NetworkErrorClassifier.test.mjs`: behavioral unit tests for classification and redaction.
- Modify `electron/ipcHandlers.ts`: replace raw error logging in covered configuration/test paths and remove the Doubao AUC key-prefix log.
- Create `electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs`: static regression tests for IPC wiring and credential-safe logging.

---

### Task 1: Network Error Classifier Utility

**Files:**
- Create: `electron/utils/networkErrorClassifier.ts`
- Create: `electron/services/__tests__/NetworkErrorClassifier.test.mjs`

**Interfaces:**
- Produces:
  - `type NetworkErrorKind = 'tls_certificate' | 'timeout' | 'auth' | 'http' | 'network' | 'unknown'`
  - `function classifyNetworkError(error: unknown): { kind: NetworkErrorKind; userMessage: string }`
  - `function toSafeNetworkDiagnostic(error: unknown, context: { provider: string; endpoint?: string }): { provider: string; endpointHost?: string; kind: NetworkErrorKind; code?: string; message?: string; status?: number; nodeVersion?: string; electronVersion?: string }`
- Consumes: only `process.versions`, standard `URL`, and unknown error objects.

- [ ] **Step 1: Write the failing classifier test**

Create `electron/services/__tests__/NetworkErrorClassifier.test.mjs` with:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/utils/networkErrorClassifier.js');

async function loadClassifier() {
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('classifies TLS certificate errors from message, code, and nested cause', async () => {
  const { classifyNetworkError } = await loadClassifier();

  const byMessage = classifyNetworkError(new Error('unable to verify the first certificate'));
  assert.equal(byMessage.kind, 'tls_certificate');
  assert.match(byMessage.userMessage, /证书链验证失败/);
  assert.match(byMessage.userMessage, /不是 API Key 错误/);

  const byCode = classifyNetworkError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
  assert.equal(byCode.kind, 'tls_certificate');

  const byCause = classifyNetworkError({
    cause: {
      cause: {
        code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      },
    },
  });
  assert.equal(byCause.kind, 'tls_certificate');
});

test('classifies auth http timeout and network errors', async () => {
  const { classifyNetworkError } = await loadClassifier();

  assert.equal(classifyNetworkError({ response: { status: 401 } }).kind, 'auth');
  assert.equal(classifyNetworkError({ response: { status: 403 } }).kind, 'auth');
  assert.equal(classifyNetworkError({ response: { status: 500 } }).kind, 'http');
  assert.equal(classifyNetworkError({ code: 'ECONNABORTED' }).kind, 'timeout');
  assert.equal(classifyNetworkError({ code: 'ETIMEDOUT' }).kind, 'timeout');
  assert.equal(classifyNetworkError(new Error('request timeout after 15000ms')).kind, 'timeout');
  assert.equal(classifyNetworkError({ code: 'ENOTFOUND' }).kind, 'network');
  assert.equal(classifyNetworkError({ code: 'ECONNRESET' }).kind, 'network');
  assert.equal(classifyNetworkError({ code: 'ECONNREFUSED' }).kind, 'network');
});

test('safe diagnostic excludes credentials headers bodies and private response details', async () => {
  const { toSafeNetworkDiagnostic } = await loadClassifier();
  const error = {
    message: 'unable to verify the first certificate',
    code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    config: {
      headers: {
        Authorization: 'Bearer secret-key',
        'X-Api-Key': 'secret-api-key',
      },
      data: '{"prompt":"secret prompt"}',
    },
    response: {
      status: 0,
      headers: {
        'set-cookie': 'private-cookie',
      },
      data: {
        error: {
          message: 'private server payload',
        },
      },
    },
  };

  const diagnostic = toSafeNetworkDiagnostic(error, {
    provider: 'doubao',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/models?token=private',
  });
  const serialized = JSON.stringify(diagnostic);

  assert.equal(diagnostic.provider, 'doubao');
  assert.equal(diagnostic.endpointHost, 'ark.cn-beijing.volces.com');
  assert.equal(diagnostic.kind, 'tls_certificate');
  assert.equal(diagnostic.status, 0);
  assert.doesNotMatch(serialized, /secret-key/);
  assert.doesNotMatch(serialized, /secret-api-key/);
  assert.doesNotMatch(serialized, /Authorization/);
  assert.doesNotMatch(serialized, /X-Api-Key/);
  assert.doesNotMatch(serialized, /secret prompt/);
  assert.doesNotMatch(serialized, /set-cookie/);
  assert.doesNotMatch(serialized, /private-cookie/);
  assert.doesNotMatch(serialized, /private server payload/);
  assert.doesNotMatch(serialized, /token=private/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/NetworkErrorClassifier.test.mjs
```

Expected: FAIL because `dist-electron/electron/utils/networkErrorClassifier.js` does not exist.

- [ ] **Step 3: Implement the classifier utility**

Create `electron/utils/networkErrorClassifier.ts`:

```ts
export type NetworkErrorKind =
  | 'tls_certificate'
  | 'timeout'
  | 'auth'
  | 'http'
  | 'network'
  | 'unknown';

export interface ClassifiedNetworkError {
  kind: NetworkErrorKind;
  userMessage: string;
}

export interface NetworkDiagnosticContext {
  provider: string;
  endpoint?: string;
}

export interface SafeNetworkDiagnostic {
  provider: string;
  endpointHost?: string;
  kind: NetworkErrorKind;
  code?: string;
  message?: string;
  status?: number;
  nodeVersion?: string;
  electronVersion?: string;
}

const TLS_CERTIFICATE_MESSAGE =
  '证书链验证失败。这通常不是 API Key 错误，而是当前 Windows 环境的 Node/Electron 证书信任链无法验证 Doubao 服务证书。请检查系统根证书更新、公司代理/杀软 HTTPS 扫描，或代理根证书是否已正确安装。';

const DEFAULT_MESSAGES: Record<NetworkErrorKind, string> = {
  tls_certificate: TLS_CERTIFICATE_MESSAGE,
  timeout: '连接超时，请检查网络后重试。',
  auth: '认证失败，请检查 API Key 是否正确。',
  http: '服务返回错误状态，请稍后重试。',
  network: '网络连接失败，请检查网络或代理设置。',
  unknown: '连接失败，请稍后重试。',
};

const TLS_MARKERS = [
  'unable to verify the first certificate',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
];

const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT']);
const NETWORK_CODES = new Set(['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH']);

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' ? value as Record<string, any> : undefined;
}

function collectErrorStrings(error: unknown, depth = 0, output: string[] = []): string[] {
  if (depth > 3) return output;
  if (typeof error === 'string') {
    output.push(error);
    return output;
  }
  const record = asRecord(error);
  if (!record) return output;
  for (const key of ['message', 'code', 'name']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) output.push(value);
  }
  if (record.cause) collectErrorStrings(record.cause, depth + 1, output);
  return output;
}

function getStatus(error: unknown): number | undefined {
  const record = asRecord(error);
  const status = record?.response?.status ?? record?.status;
  return typeof status === 'number' ? status : undefined;
}

function getCode(error: unknown): string | undefined {
  return collectErrorStrings(error).find(value => /^[A-Z_]+$/.test(value));
}

function getMessage(error: unknown): string | undefined {
  const message = collectErrorStrings(error).find(value => !/^[A-Z_]+$/.test(value));
  return message ? message.slice(0, 300) : undefined;
}

function includesMarker(values: string[], markers: string[]): boolean {
  return values.some(value => markers.some(marker => value.toLowerCase().includes(marker.toLowerCase())));
}

export function classifyNetworkError(error: unknown): ClassifiedNetworkError {
  const status = getStatus(error);
  const values = collectErrorStrings(error);

  let kind: NetworkErrorKind = 'unknown';
  if (includesMarker(values, TLS_MARKERS)) {
    kind = 'tls_certificate';
  } else if (values.some(value => TIMEOUT_CODES.has(value)) || includesMarker(values, ['timeout', 'timed out'])) {
    kind = 'timeout';
  } else if (status === 401 || status === 403) {
    kind = 'auth';
  } else if (typeof status === 'number' && status > 0) {
    kind = 'http';
  } else if (values.some(value => NETWORK_CODES.has(value))) {
    kind = 'network';
  }

  return {
    kind,
    userMessage: DEFAULT_MESSAGES[kind],
  };
}

function endpointHost(endpoint?: string): string | undefined {
  if (!endpoint) return undefined;
  try {
    return new URL(endpoint).host;
  } catch {
    return undefined;
  }
}

export function toSafeNetworkDiagnostic(
  error: unknown,
  context: NetworkDiagnosticContext,
): SafeNetworkDiagnostic {
  const classified = classifyNetworkError(error);
  const diagnostic: SafeNetworkDiagnostic = {
    provider: context.provider,
    kind: classified.kind,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
  };
  const host = endpointHost(context.endpoint);
  const code = getCode(error);
  const message = getMessage(error);
  const status = getStatus(error);
  if (host) diagnostic.endpointHost = host;
  if (code) diagnostic.code = code;
  if (message) diagnostic.message = message;
  if (typeof status === 'number') diagnostic.status = status;
  return diagnostic;
}
```

- [ ] **Step 4: Run classifier tests and typecheck**

Run:

```bash
rtk npm run build:electron:tsc
rtk npm run build:electron
rtk node --test electron/services/__tests__/NetworkErrorClassifier.test.mjs
```

Expected: typecheck passes, build succeeds, classifier tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add electron/utils/networkErrorClassifier.ts electron/services/__tests__/NetworkErrorClassifier.test.mjs
git commit -m "test: classify Doubao network errors safely"
```

---

### Task 2: IPC Wiring and Credential-Safe Logs

**Files:**
- Modify: `electron/ipcHandlers.ts`
- Create: `electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs`

**Interfaces:**
- Consumes from Task 1:
  - `classifyNetworkError(error: unknown)`
  - `toSafeNetworkDiagnostic(error: unknown, context: { provider: string; endpoint?: string })`
- Produces:
  - Doubao configuration/test handlers return TLS user message for TLS failures.
  - Covered catch blocks log safe diagnostics only.

- [ ] **Step 1: Write failing IPC wiring test**

Create `electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function safeHandleBlock(source, channel) {
  const marker = new RegExp(`safeHandle\\(\\s*['"]${channel}['"]`);
  const match = source.match(marker);
  assert.ok(match && match.index !== undefined, `${channel} handler should exist`);
  const start = match.index;
  const next = source.slice(start + 1).search(/safeHandle\(\s*['"]/);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

test('Doubao test connection IPC uses network classifier and safe diagnostics', () => {
  const source = read('electron/ipcHandlers.ts');
  const llm = safeHandleBlock(source, 'test-llm-connection');
  const stt = source.slice(source.indexOf('const runSttConnectionTest'), source.indexOf("safeHandle(\n    'test-stt-connection'"));

  assert.match(source, /networkErrorClassifier/);
  assert.match(llm, /classifyNetworkError/);
  assert.match(llm, /toSafeNetworkDiagnostic/);
  assert.match(stt, /classifyNetworkError/);
  assert.match(stt, /toSafeNetworkDiagnostic/);
});

test('Doubao model fetching does not log raw axios errors', () => {
  const source = read('electron/ipcHandlers.ts');
  const block = safeHandleBlock(source, 'fetch-provider-models');

  assert.match(block, /toSafeNetworkDiagnostic/);
  assert.doesNotMatch(block, /console\.error\([^;\n]*,\s*error\s*\)/);
  assert.doesNotMatch(block, /console\.error\([^;\n]*,\s*err\s*\)/);
});

test('Doubao AUC test logging does not include API key prefixes or raw headers', () => {
  const source = read('electron/ipcHandlers.ts');

  assert.doesNotMatch(source, /apiKey\.substring\(0,\s*8\)/);
  assert.doesNotMatch(source, /apiKey\.slice\(0,\s*8\)/);
  assert.doesNotMatch(source, /X-Api-Key prefix/);
  assert.doesNotMatch(source, /Doubao AUC test detailed error:[\s\S]{0,220}headers:\s*testErr\?\.response\?\.headers/);
});
```

- [ ] **Step 2: Run IPC wiring test to verify it fails**

Run:

```bash
rtk node --test electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs
```

Expected: FAIL because `ipcHandlers.ts` does not yet import/use `networkErrorClassifier`, still contains `apiKey.substring(0, 8)`, and `fetch-provider-models` still logs raw errors.

- [ ] **Step 3: Import the classifier in `ipcHandlers.ts`**

Add near existing utility imports:

```ts
import {
  classifyNetworkError,
  toSafeNetworkDiagnostic,
} from './utils/networkErrorClassifier';
```

- [ ] **Step 4: Add Doubao endpoint constants inside IPC registration scope**

Near `sanitizeErrorMessage` in `electron/ipcHandlers.ts`, add:

```ts
  const DOUBAO_MODELS_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/models';
  const DOUBAO_CHAT_COMPLETIONS_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
  const DOUBAO_AUDIO_TRANSCRIPTIONS_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/audio/transcriptions';
  const DOUBAO_AUC_SUBMIT_ENDPOINT = 'https://openspeech-direct.zijieapi.com/api/v3/auc/bigmodel/submit';
```

- [ ] **Step 5: Replace `fetch-provider-models` raw logging**

Change its catch block to:

```ts
      } catch (error: any) {
        const endpoint = provider === 'doubao' ? DOUBAO_MODELS_ENDPOINT : undefined;
        const diagnostic = toSafeNetworkDiagnostic(error, { provider, endpoint });
        console.error(`[IPC] Failed to fetch ${provider} models:`, diagnostic);
        if (provider === 'doubao') {
          return { success: false, error: classifyNetworkError(error).userMessage };
        }
        const msg =
          error?.response?.data?.error?.message || error.message || 'Failed to fetch models';
        return { success: false, error: msg };
      }
```

- [ ] **Step 6: Replace Doubao literal endpoint in LLM test**

In the Doubao branch of `test-llm-connection`, replace the literal URL with:

```ts
            DOUBAO_CHAT_COMPLETIONS_ENDPOINT,
```

- [ ] **Step 7: Update `test-llm-connection` catch**

Replace the current `safeInfo` construction and return logic with:

```ts
        const endpoint = provider === 'doubao' ? DOUBAO_CHAT_COMPLETIONS_ENDPOINT : undefined;
        const safeInfo = toSafeNetworkDiagnostic(error, { provider, endpoint });
        console.error('LLM connection test failed:', safeInfo);
        if (provider === 'doubao') {
          return { success: false, error: classifyNetworkError(error).userMessage };
        }
        const rawMsg =
          error?.response?.data?.error?.message ||
          error?.response?.data?.message ||
          (error.response?.data?.error?.type
            ? `${error.response.data.error.type}: ${error.response.data.error.message}`
            : error.message) ||
          'Connection failed';
        const msg = sanitizeErrorMessage(rawMsg);
        return { success: false, error: msg };
```

- [ ] **Step 8: Remove Doubao AUC key-prefix logging**

Delete:

```ts
          console.log('[IPC] Testing Doubao AUC with X-Api-Key prefix:', apiKey.substring(0, 8) + '...');
```

Keep the request ID log:

```ts
          console.log('[IPC]   Request ID:', requestId);
```

- [ ] **Step 9: Replace Doubao AUC detailed error logging**

Change the inner Doubao AUC catch to:

```ts
          } catch (testErr: any) {
            console.error('[IPC] Doubao AUC test failed:', toSafeNetworkDiagnostic(testErr, {
              provider,
              endpoint: DOUBAO_AUC_SUBMIT_ENDPOINT,
            }));
            throw testErr;
          }
```

- [ ] **Step 10: Replace Doubao audio endpoint literal**

In the `provider === 'doubao'` STT test branch, replace:

```ts
            endpoint = 'https://ark.cn-beijing.volces.com/api/v3/audio/transcriptions';
```

with:

```ts
            endpoint = DOUBAO_AUDIO_TRANSCRIPTIONS_ENDPOINT;
```

- [ ] **Step 11: Update `runSttConnectionTest` outer catch**

Replace the catch logging/return with:

```ts
      } catch (error: any) {
        const respData = error?.response?.data;
        const endpoint =
          provider === 'doubao' ? DOUBAO_AUDIO_TRANSCRIPTIONS_ENDPOINT
          : provider === 'doubao-auc' ? DOUBAO_AUC_SUBMIT_ENDPOINT
          : undefined;
        console.error(`[IPC] STT connection test failed for ${provider}:`, toSafeNetworkDiagnostic(error, {
          provider,
          endpoint,
        }));
        if (provider === 'doubao' || provider === 'doubao-auc') {
          return { success: false, error: classifyNetworkError(error).userMessage };
        }
        const rawMsg =
          respData?.error?.message ||
          respData?.detail?.message ||
          respData?.message ||
          error.message ||
          'Connection failed';
        const msg = sanitizeErrorMessage(rawMsg);
        return { success: false, error: msg };
      }
```

- [ ] **Step 12: Update `test-saved-stt-connection` fallback catch**

Replace its catch return logic with:

```ts
      } catch (error: any) {
        const endpoint =
          provider === 'doubao' ? DOUBAO_AUDIO_TRANSCRIPTIONS_ENDPOINT
          : provider === 'doubao-auc' ? DOUBAO_AUC_SUBMIT_ENDPOINT
          : undefined;
        console.error(`[IPC] Saved STT connection test failed for ${provider}:`, toSafeNetworkDiagnostic(error, {
          provider,
          endpoint,
        }));
        if (provider === 'doubao' || provider === 'doubao-auc') {
          return { success: false, error: classifyNetworkError(error).userMessage };
        }
        const respData = error?.response?.data;
        const rawMsg =
          respData?.error?.message ||
          respData?.detail?.message ||
          respData?.message ||
          error.message ||
          'Connection failed';
        return { success: false, error: sanitizeErrorMessage(rawMsg) };
      }
```

- [ ] **Step 13: Run IPC static test and typecheck**

Run:

```bash
rtk node --test electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs
rtk npm run build:electron:tsc
```

Expected: tests PASS and typecheck PASS.

- [ ] **Step 14: Commit Task 2**

```bash
git add electron/ipcHandlers.ts electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs
git commit -m "fix: classify Doubao test connection TLS errors"
```

---

### Task 3: Full Verification and Regression Sweep

**Files:**
- Verify: `electron/utils/networkErrorClassifier.ts`
- Verify: `electron/ipcHandlers.ts`
- Verify: `electron/services/__tests__/NetworkErrorClassifier.test.mjs`
- Verify: `electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs`

**Interfaces:**
- Consumes Task 1 and Task 2 deliverables.
- Produces final validated implementation ready for review.

- [ ] **Step 1: Run focused tests**

```bash
rtk node --test electron/services/__tests__/NetworkErrorClassifier.test.mjs
rtk node --test electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs
```

Expected: both test files PASS.

- [ ] **Step 2: Run Electron build verification**

```bash
rtk npm run build:electron:tsc
rtk npm run build:electron
```

Expected: typecheck and build PASS.

- [ ] **Step 3: Run static leak search**

```bash
rtk rg -n "apiKey\\.substring\\(0,\\s*8\\)|X-Api-Key prefix|console\\.error\\([^\\n]*,\\s*error\\s*\\)" electron/ipcHandlers.ts electron/utils/networkErrorClassifier.ts electron/services/__tests__/NetworkErrorClassifier.test.mjs electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs
```

Expected: no matches.

- [ ] **Step 4: Inspect final diff**

```bash
rtk git diff --stat HEAD~2..HEAD
rtk git diff HEAD~2..HEAD -- electron/utils/networkErrorClassifier.ts electron/ipcHandlers.ts electron/services/__tests__/NetworkErrorClassifier.test.mjs electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs
```

Expected: diff only contains classifier, covered IPC catch/logging changes, and tests. No runtime Doubao LLM/STT/embedding network path changes.

- [ ] **Step 5: Final commit if verification required small fixes**

If Step 1-4 required small corrections, commit them:

```bash
git add electron/utils/networkErrorClassifier.ts electron/ipcHandlers.ts electron/services/__tests__/NetworkErrorClassifier.test.mjs electron/services/__tests__/DoubaoNetworkErrorIpcWiring.test.mjs
git commit -m "fix: complete Doubao TLS test diagnostics"
```

Expected: skip this commit if Task 1 and Task 2 already pass without further changes.

---

## Self-Review Checklist

- Spec coverage: Task 1 implements classification and safe diagnostics. Task 2 wires LLM test, model fetching, STT Doubao test, STT Doubao AUC test, and removes credential-prefix logging. Task 3 verifies all acceptance criteria.
- Placeholder scan: no placeholder markers, copy-forward shortcuts, or unspecified edge handling remains.
- Type consistency: `classifyNetworkError` and `toSafeNetworkDiagnostic` signatures match across all tasks.
- Scope check: no task modifies actual Doubao runtime chat, streaming, embedding, STT, AUC transcription, global fetch, axios defaults, Node TLS, or `electron.net.fetch`.
