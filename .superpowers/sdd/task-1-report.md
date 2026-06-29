# Task 1 Report: Doubao/Windows TLS Network Error Classifier

## 状态

DONE

## 改动文件

- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/utils/networkErrorClassifier.ts`
- `/Users/tang-codeing/code/natively-cluely-ai-assistant/electron/services/__tests__/NetworkErrorClassifier.test.mjs`

## RED 测试

命令：

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/NetworkErrorClassifier.test.mjs
```

失败原因：

- `ERR_MODULE_NOT_FOUND`：`dist-electron/electron/utils/networkErrorClassifier.js` 缺失（测试在动态 import 时找不到构建产物）。

## GREEN 验证

命令：

```bash
rtk npm run build:electron:tsc
rtk npm run build:electron
rtk node --test electron/services/__tests__/NetworkErrorClassifier.test.mjs
```

结果：

- `build:electron:tsc` 成功
- `build:electron` 成功
- `NetworkErrorClassifier.test.mjs` 通过 3/3

## commit

- `b92763698557ed9a383e4f17def6ea99cdcc9f84`

## 自审结论

- 分类逻辑覆盖 TLS 证书、超时、鉴权、HTTP、网络和兜底网络异常，并对 `message/code/status/cause` 做递归归一化识别。
- `toSafeNetworkDiagnostic` 仅返回白名单字段（provider、endpointHost、kind、code、message、status、node/electron 版本），未保留 headers、body、set-cookie 或 URL token 等敏感内容，满足最小泄露面要求。

## Task 1 重修复记录（严格 TDD）

### RED

命令：

```bash
rtk npm run build:electron:tsc
rtk npm run build:electron
rtk node --test electron/services/__tests__/NetworkErrorClassifier.test.mjs
```

失败摘要：

- `safe diagnostic excludes credentials headers bodies and private response details`：`diagnostic.message` 命中原始 error.message（包含 `private prompt body token=secret Authorization Bearer`），触发了 `/证书链验证失败/` 断言失败，说明仍在写入原始敏感内容。
- `classifies DEPTH_ZERO_SELF_SIGNED_CERT as TLS certificate error`：`classifyNetworkError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }).kind` 返回 `unknown`，说明 TLS 码表未覆盖该常见 Node 错误码。

### GREEN

命令：

```bash
rtk npm run build:electron:tsc
rtk npm run build:electron
rtk node --test electron/services/__tests__/NetworkErrorClassifier.test.mjs
```

结果：`NetworkErrorClassifier.test.mjs` 通过 4/4。

### Commit

- `261f5720b4cc2e56544eb3007700db54832b8fbd`

### 自审

- `toSafeNetworkDiagnostic` 的 `message` 改为按 `kind` 的安全摘要写入，不再回传原始异常 message。
- TLS 错误匹配新增 `DEPTH_ZERO_SELF_SIGNED_CERT`，并补充 `UNABLE_TO_GET_ISSUER_CERT`、`CERT_CHAIN_TOO_LONG`、`CERT_NOT_YET_VALID`、`CERT_REVOKED`，覆盖常见 Node 证书链场景同时避免扩展到非 TLS 码。
