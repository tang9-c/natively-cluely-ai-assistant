const REDACTED = '[REDACTED]';
const REMOVED = '[REMOVED]';
const REMOVE_KEY_RE = /(transcript(text)?|prompt|reference(content)?|evidence(text)?|screenshot(path)?|image(path)?|response(body)?|body|query(text|string)?|user(input|message)|chunk(text|content)?|snippet(text)?)$/i;
const REDACT_KEY_RE = /(api[_-]?key|authorization|bearer|token|secret|password|credential)$/i;

export function summarizeSamples(samples) {
  const values = samples
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (values.length === 0) return null;

  return {
    sampleCount: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    minMs: values[0],
    maxMs: values.at(-1),
  };
}

export function buildPerformanceBaselineReport({ environment = {}, configuration = {}, metrics = [], warnings = [] }) {
  const scenarios = Object.fromEntries(metrics.map((metric) => {
    const summary = summarizeSamples(metric.samples ?? []);
    const failures = Number.isInteger(metric.failures) && metric.failures >= 0 ? metric.failures : 0;
    const status = summary ? (failures > 0 ? 'failed' : 'passed') : (metric.blockedReason ? 'blocked' : 'skipped');
    return [metric.id, {
      status,
      unit: metric.unit,
      ...(summary ?? {
        sampleCount: 0,
        p50Ms: null,
        p95Ms: null,
        minMs: null,
        maxMs: null,
      }),
      failures,
      blockedReason: summary ? null : metric.blockedReason ?? null,
      ...(metric.metadata ? { metadata: sanitize(metric.metadata) } : {}),
    }];
  }));

  const statuses = Object.values(scenarios).map((scenario) => scenario.status);
  return {
    schemaVersion: 1,
    status: statuses.includes('failed') ? 'failed' : (statuses.includes('blocked') ? 'blocked' : 'completed'),
    generatedAt: new Date().toISOString(),
    environment: sanitize(environment),
    configuration: sanitize(configuration),
    scenarios,
    warnings: warnings.map(String),
  };
}

export function renderPerformanceBaselineMarkdown(report) {
  const rows = Object.entries(report.scenarios).map(([id, scenario]) => (
    `| ${id} | ${scenario.status} | ${scenario.sampleCount} | ${formatMetric(scenario.p50Ms)} | ${formatMetric(scenario.p95Ms)} | ${scenario.blockedReason ?? ''} |`
  )).join('\n');
  return [
    '# 性能基线报告',
    '',
    `- 状态: ${report.status}`,
    `- 生成时间: ${report.generatedAt}`,
    `- 平台: ${report.environment.platform ?? 'unknown'} ${report.environment.arch ?? ''}`,
    '',
    '| 指标 | 状态 | 样本 | p50 | p95 | 原因 |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    rows,
    '',
  ].join('\n');
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function formatMetric(value) {
  return value === null || value === undefined ? '-' : String(value);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (REMOVE_KEY_RE.test(key)) return [key, REMOVED];
    if (REDACT_KEY_RE.test(key)) return [key, REDACTED];
    return [key, sanitize(child)];
  }));
}
