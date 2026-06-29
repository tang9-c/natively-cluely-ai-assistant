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
  'depth_zero_self_signed_cert',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_CHAIN_TOO_LONG',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REVOKED',
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
    if (typeof value === 'string' && value.trim()) {
      output.push(value);
    }
  }

  if (record.cause) {
    collectErrorStrings(record.cause, depth + 1, output);
  }

  return output;
}

function getStatus(error: unknown): number | undefined {
  const record = asRecord(error);
  const status = record?.response?.status ?? record?.status;
  return typeof status === 'number' ? status : undefined;
}

function getCode(error: unknown): string | undefined {
  return collectErrorStrings(error).find((value) => /^[A-Z_]+$/.test(value));
}

function getMessage(error: unknown): string | undefined {
  const message = collectErrorStrings(error).find((value) => !/^[A-Z_]+$/.test(value));
  return message ? message.slice(0, 300) : undefined;
}

function includesMarker(values: string[], markers: string[]): boolean {
  return values.some((value) => markers.some((marker) => value.toLowerCase().includes(marker.toLowerCase())));
}

export function classifyNetworkError(error: unknown): ClassifiedNetworkError {
  const status = getStatus(error);
  const values = collectErrorStrings(error);

  let kind: NetworkErrorKind = 'unknown';
  if (includesMarker(values, TLS_MARKERS)) {
    kind = 'tls_certificate';
  } else if (values.some((value) => TIMEOUT_CODES.has(value)) || includesMarker(values, ['timeout', 'timed out'])) {
    kind = 'timeout';
  } else if (status === 401 || status === 403) {
    kind = 'auth';
  } else if (typeof status === 'number' && status > 0) {
    kind = 'http';
  } else if (values.some((value) => NETWORK_CODES.has(value))) {
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
  const status = getStatus(error);

  if (host) diagnostic.endpointHost = host;
  if (code) diagnostic.code = code;
  diagnostic.message = DEFAULT_MESSAGES[classified.kind];
  if (typeof status === 'number') diagnostic.status = status;

  return diagnostic;
}
