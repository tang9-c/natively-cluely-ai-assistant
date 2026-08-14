import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outputPath = process.argv[2];
const runCount = Number.parseInt(process.env.QCLOUD_SUMMARY_BENCHMARK_RUNS || '5', 10);
const key = process.env.QCLOUD_LIVE_API_KEY;

if (!key) throw new Error('QCLOUD_LIVE_API_KEY is required');
if (!outputPath) throw new Error('Usage: node scripts/benchmark-qcloud-summary-quality.mjs <output.json>');
if (!Number.isInteger(runCount) || runCount <= 0) throw new Error('QCLOUD_SUMMARY_BENCHMARK_RUNS must be positive');

const { LLMHelper } = await import(pathToFileURL(
  path.join(repoRoot, 'dist-electron/electron/LLMHelper.js'),
).href);
const { generateFullTranscriptSummary } = await import(pathToFileURL(
  path.join(repoRoot, 'dist-electron/electron/services/post-call/PostCallSummaryGenerator.js'),
).href);

const helper = new LLMHelper();
helper.setNativelyKey(key);
helper.setModel('natively');

const filler = '团队继续核对既有流程、历史资料和实施边界，本段没有新增决策或行动项。';
const context = [
  '会议头部事实：客户批准试点预算120万元。',
  filler.repeat(180),
  '会议中部事实：Windchill 与 SAP 的第一阶段接口明确采用只读方式。',
  filler.repeat(180),
  '会议尾部事实：李工承诺在8月30日前提交完整风险清单。',
].join('\n');
const baseRules = [
  '只根据会议原文生成中文 JSON 摘要。',
  '必须保留所有明确数字、系统名称、决策、负责人和截止日期。',
  '不得编造原文没有的信息。',
].join('\n');

const collectUnboundedSummary = async (systemPrompt, userContext, _groqPrompt, options = {}) => {
  let result = '';
  for await (const chunk of helper.streamChat(
    `Context:\n${userContext}`,
    undefined,
    undefined,
    systemPrompt,
    true,
    true,
    ['post_call_summary'],
    {
      requestId: `qcloud-summary-before-${crypto.randomUUID()}`,
      requestSource: 'other',
      maxOutputTokens: options.maxOutputTokens,
    },
  )) result += chunk;
  return result;
};

const beforeHelper = { generateMeetingSummary: collectUnboundedSummary };
const afterHelper = {
  getQCloudMeetingSummaryChunkChars: () => helper.getQCloudMeetingSummaryChunkChars(),
  generateMeetingSummary: (...args) => helper.generateMeetingSummary(...args),
};

const scoreSummary = (summary) => ({
  budget: /120\s*万|1200000/.test(JSON.stringify(summary)),
  integrationDecision: /Windchill/i.test(JSON.stringify(summary))
    && /SAP/i.test(JSON.stringify(summary))
    && /只读|read.?only/i.test(JSON.stringify(summary)),
  ownerDeadline: /李工/.test(JSON.stringify(summary)) && /8月30|8-30|08-30/.test(JSON.stringify(summary)),
});

const runs = [];
for (let index = 0; index < runCount; index += 1) {
  const variants = index % 2 === 0
    ? [['before', beforeHelper], ['after', afterHelper]]
    : [['after', afterHelper], ['before', beforeHelper]];
  for (const [variant, llmHelper] of variants) {
    const startedAt = performance.now();
    let summary;
    let errorCode = null;
    try {
      summary = await generateFullTranscriptSummary({
        llmHelper,
        transcript: [],
        context,
        modeTemplateType: 'general',
        modeNoteSections: [],
        modeContextBlock: '',
        baseRules,
        groqSummaryPrompt: 'fallback',
      });
    } catch (error) {
      errorCode = error instanceof Error ? error.name : 'UnknownError';
    }
    const facts = summary ? scoreSummary(summary) : {
      budget: false,
      integrationDecision: false,
      ownerDeadline: false,
    };
    runs.push({
      variant,
      index: index + 1,
      completedMs: Math.round(performance.now() - startedAt),
      facts,
      completeness: Object.values(facts).filter(Boolean).length / 3,
      generationStatus: summary?.generationStatus ?? 'failed',
      summaryHash: summary
        ? crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex').slice(0, 16)
        : null,
      errorCode,
    });
    process.stderr.write(`${variant} ${index + 1}/${runCount}: completeness=${runs.at(-1).completeness}\n`);
  }
}

const summarize = (variant) => {
  const selected = runs.filter((run) => run.variant === variant);
  return {
    logicalSummaryCount: selected.length,
    successCount: selected.filter((run) => run.generationStatus === 'success').length,
    averageCompleteness: selected.reduce((sum, run) => sum + run.completeness, 0) / selected.length,
    completeSummaryRate: selected.filter((run) => run.completeness === 1).length / selected.length,
    averageCompletedMs: Math.round(selected.reduce((sum, run) => sum + run.completedMs, 0) / selected.length),
  };
};

const report = {
  generatedAt: new Date().toISOString(),
  model: helper.getCurrentModel(),
  input: { contextChars: context.length, requiredFactCount: 3 },
  summary: { before: summarize('before'), after: summarize('after') },
  runs,
};

fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify(report.summary)}\n`);
