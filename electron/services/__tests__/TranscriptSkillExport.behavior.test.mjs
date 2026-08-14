import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const servicePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/services/TranscriptSkillExportService.js',
);

function loadService() {
  delete require.cache[servicePath];
  return require(servicePath);
}

const activeSkill = {
  id: 'meeting-summary',
  name: '会议总结',
  promptBlock: '提取结论和行动项。',
};

test('transcript skill token estimate is CJK-aware', () => {
  const { estimateTranscriptSkillTokens } = loadService();

  assert.equal(estimateTranscriptSkillTokens(''), 0);
  assert.equal(estimateTranscriptSkillTokens('中文ab cd'), 4);
  assert.equal(estimateTranscriptSkillTokens('abcdefgh'), 2);
});

test('transcript chunks preserve content and only hard-split oversized lines', () => {
  const { estimateTranscriptSkillTokens, splitTranscriptForSkill } = loadService();
  const ordinary = '甲乙\nabcde\n';
  const ordinaryChunks = splitTranscriptForSkill(ordinary, 3);

  assert.deepEqual(ordinaryChunks, ['甲乙\n', 'abcde\n']);
  assert.equal(ordinaryChunks.join(''), ordinary);

  const oversized = `${'中'.repeat(7)}\nnext`;
  const oversizedChunks = splitTranscriptForSkill(oversized, 3);
  assert.equal(oversizedChunks.join(''), oversized);
  assert.ok(oversizedChunks.length > 2);
  assert.ok(oversizedChunks.every(chunk => estimateTranscriptSkillTokens(chunk) <= 3));
  assert.deepEqual(splitTranscriptForSkill('', 3), []);
});

test('short transcript uses one direct request with the complete transcript', async () => {
  const { generateTranscriptSkillContent } = loadService();
  const calls = [];
  const transcriptMarkdown = '中'.repeat(12_000);
  const llmHelper = {
    async chatWithGemini(...args) {
      calls.push(args);
      return '# 结果';
    },
  };

  const result = await generateTranscriptSkillContent({ transcriptMarkdown, activeSkill, llmHelper });

  assert.equal(result, '# 结果');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], transcriptMarkdown);
  assert.equal(calls[0][5].maxOutputTokens, 6_144);
  assert.equal(calls[0][5].totalTimeoutMs, 120_000);
  assert.ok(calls[0][5].abortSignal instanceof AbortSignal);
  assert.equal('qcloudThinking' in calls[0][5], false);
  assert.equal('qcloudReasoningEffort' in calls[0][5], false);
});

test('long transcript maps with concurrency two and reduces ordered intermediate output', async () => {
  const { generateTranscriptSkillContent } = loadService();
  const transcriptMarkdown = '中'.repeat(12_001);
  const calls = [];
  let activeMaps = 0;
  let maxActiveMaps = 0;
  let mapSequence = 0;
  const llmHelper = {
    async chatWithGemini(...args) {
      const options = args[5];
      const record = { args, sequence: calls.length };
      calls.push(record);
      if (options.maxOutputTokens === 800) {
        const sequence = mapSequence++;
        activeMaps += 1;
        maxActiveMaps = Math.max(maxActiveMaps, activeMaps);
        await new Promise(resolve => setTimeout(resolve, sequence === 0 ? 15 : 5));
        activeMaps -= 1;
        return `summary-${sequence}`;
      }
      return '# 最终结果';
    },
  };

  const result = await generateTranscriptSkillContent({ transcriptMarkdown, activeSkill, llmHelper });
  const mapCalls = calls.filter(call => call.args[5].maxOutputTokens === 800);
  const reduceCalls = calls.filter(call => call.args[5].qcloudReasoningEffort === 'minimal');

  assert.equal(result, '# 最终结果');
  assert.equal(mapCalls.length, 2);
  assert.equal(reduceCalls.length, 1);
  assert.equal(maxActiveMaps, 2);
  assert.equal(mapCalls.map(call => call.args[2]).join(''), transcriptMarkdown);
  for (const call of mapCalls) {
    assert.deepEqual(call.args[5].qcloudThinking, { type: 'disabled' });
    assert.equal('qcloudReasoningEffort' in call.args[5], false);
    assert.equal(call.args[5].totalTimeoutMs, 120_000);
  }

  const reduceContext = reduceCalls[0].args[2];
  assert.ok(reduceContext.indexOf('summary-0') < reduceContext.indexOf('summary-1'));
  assert.equal(reduceContext.includes(transcriptMarkdown), false);
  assert.equal(reduceCalls[0].args[5].maxOutputTokens, 6_144);
  assert.deepEqual(reduceCalls[0].args[5].qcloudThinking, { type: 'enabled' });

  const signals = calls.map(call => call.args[5].abortSignal);
  assert.equal(new Set(signals).size, calls.length);
});

test('long transcript does not reduce when a map request fails', async () => {
  const { generateTranscriptSkillContent } = loadService();
  const calls = [];
  const llmHelper = {
    async chatWithGemini(...args) {
      calls.push(args);
      if (args[5].maxOutputTokens === 800) throw new Error('map failed');
      return 'unexpected reduce';
    },
  };

  await assert.rejects(
    generateTranscriptSkillContent({
      transcriptMarkdown: '中'.repeat(12_001),
      activeSkill,
      llmHelper,
    }),
    /map failed/,
  );
  assert.equal(calls.some(call => call[5].qcloudReasoningEffort === 'minimal'), false);
});

test('long transcript does not reduce an LLM failure fallback from a map request', async () => {
  const { generateTranscriptSkillContent } = loadService();
  const calls = [];
  const llmHelper = {
    async chatWithGemini(...args) {
      calls.push(args);
      if (args[5].maxOutputTokens === 800) return 'AI 服务未返回有效内容，请稍后重试。';
      return 'unexpected reduce';
    },
  };

  await assert.rejects(
    generateTranscriptSkillContent({
      transcriptMarkdown: '中'.repeat(12_001),
      activeSkill,
      llmHelper,
    }),
    /AI 服务未返回有效内容/,
  );
  assert.equal(calls.some(call => call[5].qcloudReasoningEffort === 'minimal'), false);
});
