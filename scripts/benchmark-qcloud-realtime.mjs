import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const helperPath = path.resolve(repoRoot, 'dist-electron/electron/LLMHelper.js');
const fixturePath = path.resolve(
  repoRoot,
  'tests/fixtures/demo/03_master_transcript/sales/sales_full_lifecycle_meeting.md',
);
const outputPath = process.argv[2];
const runCount = Number.parseInt(process.env.QCLOUD_BENCHMARK_RUNS || '20', 10);
const paired = process.env.QCLOUD_BENCHMARK_PAIRED === 'true';
const key = process.env.QCLOUD_LIVE_API_KEY;

if (!key) throw new Error('QCLOUD_LIVE_API_KEY is required');
if (!outputPath) throw new Error('Usage: node scripts/benchmark-qcloud-realtime.mjs <output.json>');
if (!Number.isInteger(runCount) || runCount <= 0) throw new Error('QCLOUD_BENCHMARK_RUNS must be positive');

const fixture = fs.readFileSync(fixturePath, 'utf8');
const targetContextChars = 48_000;
const repeats = Math.ceil(targetContextChars / fixture.length);
const context = Array.from({ length: repeats }, () => fixture).join('\n').slice(0, targetContextChars);
const question = '客户要求先做小范围试点，并关心 Windchill 与 SAP 集成风险。请给一句可以直接说出口的中文回应。';
const systemPrompt = '你是会议中的实时销售助手。只输出一句自然、具体、可直接说出口的中文回应。';

const percentile = (values, ratio) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
};

const { LLMHelper } = await import(pathToFileURL(helperPath).href);
const helper = new LLMHelper();
helper.setNativelyKey(key);
helper.setModel('natively');

const runVariant = async (variant, index) => {
  const startedAt = performance.now();
  let firstTokenMs = null;
  let response = '';
  let errorCode = null;
  try {
    for await (const chunk of helper.streamChat(
      question,
      undefined,
      context,
      systemPrompt,
      true,
      true,
      ['transcript'],
      {
        requestId: `qcloud-benchmark-${variant}-${index + 1}`,
        requestSource: 'automatic',
        ...(variant === 'after' ? { qcloudRequestClass: 'realtime_answer' } : {}),
        maxOutputTokens: 768,
      },
    )) {
      if (firstTokenMs === null && chunk) firstTokenMs = performance.now() - startedAt;
      response += chunk;
    }
  } catch (error) {
    errorCode = error instanceof Error ? error.name : 'UnknownError';
  }
  const completedMs = performance.now() - startedAt;
  const run = {
    variant,
    index: index + 1,
    firstTokenMs: firstTokenMs === null ? null : Math.round(firstTokenMs),
    completedMs: Math.round(completedMs),
    responseChars: response.trim().length,
    responseHash: response
      ? crypto.createHash('sha256').update(response).digest('hex').slice(0, 16)
      : null,
    nonEmpty: response.trim().length > 0,
    mentionsRelevantConcept: /试点|集成|风险|Windchill|SAP/i.test(response),
    errorCode,
  };
  process.stderr.write(`${variant} ${index + 1}/${runCount}: ttft=${run.firstTokenMs ?? 'failed'}ms\n`);
  return run;
};

const runs = [];
if (paired) {
  for (let index = 0; index < runCount; index += 1) {
    const variants = index % 2 === 0 ? ['before', 'after'] : ['after', 'before'];
    for (const variant of variants) runs.push(await runVariant(variant, index));
  }
} else {
  for (let index = 0; index < runCount; index += 1) {
    runs.push(await runVariant('after', index));
  }
}

const summarize = (variantRuns) => {
  const successful = variantRuns.filter((run) => run.firstTokenMs !== null);
  const firstTokens = successful.map((run) => run.firstTokenMs);
  const completions = successful.map((run) => run.completedMs);
  return {
    successCount: successful.length,
    failureCount: variantRuns.length - successful.length,
    failureRate: (variantRuns.length - successful.length) / variantRuns.length,
    medianFirstTokenMs: successful.length ? percentile(firstTokens, 0.5) : null,
    p95FirstTokenMs: successful.length ? percentile(firstTokens, 0.95) : null,
    maxFirstTokenMs: successful.length ? Math.max(...firstTokens) : null,
    medianCompletedMs: successful.length ? percentile(completions, 0.5) : null,
    p95CompletedMs: successful.length ? percentile(completions, 0.95) : null,
    nonEmptyRate: variantRuns.filter((run) => run.nonEmpty).length / variantRuns.length,
    relevantConceptRate: variantRuns.filter((run) => run.mentionsRelevantConcept).length / variantRuns.length,
  };
};

const summary = paired
  ? {
      before: summarize(runs.filter((run) => run.variant === 'before')),
      after: summarize(runs.filter((run) => run.variant === 'after')),
    }
  : summarize(runs);
const report = {
  generatedAt: new Date().toISOString(),
  model: helper.getCurrentModel(),
  requestCountPerVariant: runCount,
  paired,
  input: {
    contextChars: context.length,
    questionChars: question.length,
    maxOutputTokens: 768,
    fixture: path.relative(repoRoot, fixturePath),
  },
  summary,
  runs,
};

fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(report.summary)}\n`);
