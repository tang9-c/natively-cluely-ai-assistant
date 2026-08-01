import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..', '..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('MeetingPersistence no longer iterates reference file bodies inline for summary', () => {
  const src = read('electron/MeetingPersistence.ts');

  // The legacy inline iteration used a per-file MAX_FILE_CHARS / MAX_TOTAL_CHARS
  // pair plus a getReferenceFiles call directly inside processAndSaveMeeting().
  assert.doesNotMatch(src, /const MAX_FILE_CHARS = 12_000;/);
  assert.doesNotMatch(src, /const MAX_TOTAL_CHARS = 40_000;/);
  assert.doesNotMatch(src, /modesMgr\.getReferenceFiles\(modeSnapshot\.id\)/);
});

test('MeetingPersistence summary uses buildSummarySafeModeContextBlock with scope gating', () => {
  const src = read('electron/MeetingPersistence.ts');

  assert.match(src, /modesMgr\.buildSummarySafeModeContextBlock\(modeSnapshot\.id/);
  assert.match(src, /scopePolicy\?\.post_call_summary !== false/);
  assert.match(src, /scopePolicy\?\.reference_files !== false/);
  assert.match(src, /includeReferenceSnippets: referenceSnippetsAllowed/);
});

test('MeetingPersistence summary base rules use the enhanced enterprise recap contract', () => {
  const src = read('electron/MeetingPersistence.ts');

  const requiredRules = [
    '只基于会议中实际出现的信息总结，不编造未提到的事实、数字、结论、责任人或上下文。',
    '对 ASR 转写中的口误、重复话术、语气词、停顿词和明显错别字，应结合上下文自动完成语义纠错和信息降噪。',
    '对明显同音误识别、拼写错误和常见中英文术语识别错误可做语义纠正；金额、日期、比例、数量、公司名、人名、系统名、合同条款等高风险信息必须保持谨慎，只有上下文高度明确时才可规范化。',
    '将同一主题下分散在不同时间点、不同发言中的信息进行语义合并，避免按时间顺序机械复述。',
    '当观点、承诺、异议、决策或行动项依赖具体发言人时，应保留发言人、角色或可识别称谓；如果发言人不明确，不要猜测。',
    '优先保留金额、比例、数量、日期、周期、截止时间、版本、系统名称、客户名称等硬性指标；不得自行补全缺失数值。',
    '行动项必须体现后续要完成的具体动作或交付物；单纯的问题、观点、背景同步或泛泛意向不得写入 actionItems，应放入 openQuestions、keyPoints 或对应分区。',
    '决策项必须是会议中已确认、已同意、已选定、已否定或已批准的事项；讨论中的建议、假设、倾向和待评估方案不得写成决策。',
    '对仅用于同步背景、项目状态、行业信息或通知的内容，归入 keyPoints 或对应分区；不要强行生成行动项。',
    '专业、严谨、客观、商业化，便于快速浏览。',
  ];

  for (const rule of requiredRules) {
    assert.ok(src.includes(rule), `Missing summary base rule: ${rule}`);
  }
});

test('Groq summary prompt matches current post-call JSON schema', () => {
  const src = read('electron/llm/prompts.ts');

  assert.match(src, /"overview"/);
  assert.match(src, /"openQuestions"/);
  assert.match(src, /"sections"/);
  assert.doesNotMatch(src, /不要使用 "overview"/);
  assert.doesNotMatch(src, /必须且只能包含以下四个 key/);
});

test('ModesManager exposes buildSummarySafeModeContextBlock and gates raw bodies', () => {
  const src = read('electron/services/ModesManager.ts');

  assert.match(src, /public buildSummarySafeModeContextBlock\(/);
  assert.match(src, /includeReferenceSnippets\?: boolean/);
  assert.match(src, /this\.modeContextRetriever\.retrieve\(mode, this\.getReferenceFiles\(mode\.id\), \{[\s\S]+query:[\s\S]+transcript:[\s\S]+tokenBudget:[\s\S]+\}\);/);
});

test('buildSummarySafeModeContextBlock returns customContext only when references denied', async () => {
  // Drive the compiled module directly so we exercise the real code path,
  // but stub the DB-backed lookups so the test doesn't require Electron's app.
  const distPath = path.resolve(__dirname, '../../../dist-electron/electron/services/ModesManager.js');
  const url = (await import('node:url')).pathToFileURL(distPath).href;
  const mod = await import(url);
  const mgr = mod.ModesManager.getInstance();

  const FAKE_MODE_ID = 'test-fake-mode';
  const fakeMode = {
    id: FAKE_MODE_ID,
    name: 'Fake',
    templateType: 'sales',
    customContext: 'CUSTOM_CONTEXT_SENTINEL',
    isCustom: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isDefault: false,
    isActive: false,
  };
  const fakeFiles = [
    { id: 'rf1', modeId: FAKE_MODE_ID, fileName: 'a.txt', mimeType: 'text/plain', sizeBytes: 100, content: 'RAW_REFERENCE_CANARY_BODY', sortOrder: 0 },
  ];

  const originalGetModes = mgr.getModes.bind(mgr);
  const originalGetReferenceFiles = mgr.getReferenceFiles.bind(mgr);
  mgr.getModes = () => [fakeMode];
  mgr.getReferenceFiles = () => fakeFiles;

  try {
    // With references denied, the canary must NOT appear and customContext MUST appear.
    const denied = mgr.buildSummarySafeModeContextBlock(FAKE_MODE_ID, {
      query: 'meeting summary',
      transcript: 'short transcript',
      includeReferenceSnippets: false,
    });
    assert.ok(denied.includes('CUSTOM_CONTEXT_SENTINEL'), 'customContext must always be present');
    assert.ok(!denied.includes('RAW_REFERENCE_CANARY_BODY'), 'raw reference body must not appear when references denied');

    // With references allowed, retrieval still uses the retriever (snippets only).
    // For an irrelevant query, retrieval should not produce the full raw body.
    const allowedIrrelevant = mgr.buildSummarySafeModeContextBlock(FAKE_MODE_ID, {
      query: 'no overlap query xyz',
      transcript: 'no overlap transcript abc',
      includeReferenceSnippets: true,
    });
    assert.ok(allowedIrrelevant.includes('CUSTOM_CONTEXT_SENTINEL'));
    assert.ok(!allowedIrrelevant.includes('RAW_REFERENCE_CANARY_BODY'),
      'raw reference body must not appear in summary even when retrieval has no relevant matches');
  } finally {
    mgr.getModes = originalGetModes;
    mgr.getReferenceFiles = originalGetReferenceFiles;
  }
});

test('legacy buildActiveModeContextBlock still exists for non-summary paths', () => {
  const src = read('electron/services/ModesManager.ts');
  assert.match(src, /public buildActiveModeContextBlock\(\): string \{/);
});
