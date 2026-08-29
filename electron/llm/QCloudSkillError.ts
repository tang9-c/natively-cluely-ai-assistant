export type QCloudSkillErrorCode =
  | 'invalid_request'
  | 'timeout'
  | 'authentication'
  | 'balance'
  | 'rate_limit'
  | 'invalid_response'
  | 'service_unavailable'
  | 'unknown';

interface QCloudSkillErrorOptions {
  status?: number;
  requestId?: string;
  retryable?: boolean;
  userMessage?: string;
}

const USER_MESSAGES: Record<QCloudSkillErrorCode, string> = {
  invalid_request: 'AI 请求配置不兼容，请更新软件或联系支持。',
  timeout: 'AI 服务响应超时，请检查网络后重试。',
  authentication: 'QCLOUD API Key 无效或已失效，请重新配置。',
  balance: 'QCLOUD 账户余额不足，请充值后重试。',
  rate_limit: '请求过于频繁，请稍后重试。',
  invalid_response: 'AI 服务未返回有效内容，请稍后重试。',
  service_unavailable: 'AI 服务暂时不可用，请稍后重试。',
  unknown: 'AI 服务调用失败，请稍后重试。',
};

export class QCloudSkillError extends Error {
  public readonly code: QCloudSkillErrorCode;
  public readonly status?: number;
  public readonly requestId?: string;
  public readonly retryable: boolean;
  public readonly userMessage: string;

  constructor(code: QCloudSkillErrorCode, options: QCloudSkillErrorOptions = {}) {
    super(`QCLOUD skill request failed: ${code}`);
    this.name = 'QCloudSkillError';
    this.code = code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.retryable = options.retryable
      ?? ['timeout', 'rate_limit', 'service_unavailable', 'unknown'].includes(code);
    this.userMessage = options.userMessage ?? USER_MESSAGES[code];
  }

  public toSafeLogFields(): Record<string, unknown> {
    return {
      code: this.code,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.requestId ? { requestId: this.requestId } : {}),
      retryable: this.retryable,
    };
  }
}

export function normalizeQCloudSkillError(error: unknown): QCloudSkillError {
  if (error instanceof QCloudSkillError) return error;

  const source = error instanceof Error ? error.message : String(error || '');
  const statusMatch = source.match(/QCLOUD API\s+(\d{3}):/i);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;
  const requestId = source.match(/Request id:\s*([a-zA-Z0-9_-]+)/i)?.[1];
  const lower = source.toLowerCase();

  if (/overdue balance|insufficient balance|account balance|欠费|余额不足/.test(lower)) {
    return new QCloudSkillError('balance', { status, requestId, retryable: false });
  }
  if (status === 429 || /rate limit|too many requests|限流/.test(lower)) {
    return new QCloudSkillError('rate_limit', { status, requestId, retryable: true });
  }
  if (status === 400) {
    return new QCloudSkillError('invalid_request', { status, requestId, retryable: false });
  }
  if (
    status === 401
    || status === 403
    || /api key not set|invalid api key|authentication failed|unauthorized|access denied/.test(lower)
  ) {
    return new QCloudSkillError('authentication', {
      status,
      requestId,
      retryable: false,
      ...(status === 403
        ? { userMessage: 'QCLOUD 鉴权或访问权限校验失败，请检查 API Key。' }
        : {}),
    });
  }
  if (/timed out|timeout|etimedout|aborterror/.test(lower)) {
    return new QCloudSkillError('timeout', { status, requestId, retryable: true });
  }
  if (error instanceof SyntaxError || /unexpected token|unexpected end of json|invalid json/.test(lower)) {
    return new QCloudSkillError('invalid_response', { status, requestId, retryable: true });
  }
  if (status !== undefined && status >= 500) {
    return new QCloudSkillError('service_unavailable', { status, requestId, retryable: true });
  }
  return new QCloudSkillError('unknown', { status, requestId, retryable: true });
}
