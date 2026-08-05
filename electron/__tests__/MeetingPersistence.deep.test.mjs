// electron/__tests__/MeetingPersistence.deep.test.mjs
//
// Phase 6 deep coverage for MeetingPersistence.js. Targets:
//   - stopMeeting(): duration<1s, doNotPersist metadata, LLM-summary failure paths
//   - processAndSaveMeeting(): background save with real DB writes
//   - recoverUnprocessedMeetings(): recovery, early-return, per-meeting error
//   - buildDynamicActionArtifactActionsFromUsage(): priority and edge cases
//
// Strategy: same as the base test — drive a real per-test DB through the
// embedded DatabaseManager/ModesManager/SettingsManager classes (which cannot
// be overridden externally). We isolate by giving each test its own userData
// directory and capturing state from the underlying DB.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);

const mockWindows = [];
const testUserData = path.join(os.tmpdir(), `meeting-persist-deep-userdata-${process.hrtime.bigint()}`);
fs.mkdirSync(testUserData, { recursive: true });

const mockElectron = {
  app: {
    getPath: (name) => {
      if (name === 'userData') return testUserData;
      return os.tmpdir();
    },
    getAppPath: () => process.cwd(),
    isReady: () => true,
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    getVersion: () => '0.0.0-test',
  },
  BrowserWindow: {
    getAllWindows: () => mockWindows,
  },
};
const electronPath = cjsRequire.resolve('electron');
cjsRequire.cache[electronPath] = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: mockElectron,
  children: [],
  paths: [],
};

const repoRoot = path.resolve(__dirname, '../..');
const mpPath = path.resolve(repoRoot, 'dist-electron/electron/MeetingPersistence.js');
const smPath = path.resolve(repoRoot, 'dist-electron/electron/services/SettingsManager.js');
const mmPath = path.resolve(repoRoot, 'dist-electron/electron/services/ModesManager.js');
const dbmPath = path.resolve(repoRoot, 'dist-electron/electron/db/DatabaseManager.js');

const { MeetingPersistence, buildDynamicActionArtifactActionsFromUsage } = cjsRequire(mpPath);
const { SettingsManager } = cjsRequire(smPath);
const { ModesManager } = cjsRequire(mmPath);
const { DatabaseManager } = cjsRequire(dbmPath);

function buildMockSession(opts = {}) {
  const startTime = opts.startTime ?? Date.now() - 5000;
  const transcript = opts.transcript ?? [
    { speaker: 'user', text: 'Hello there', timestamp: startTime + 1 },
    { speaker: 'assistant', text: 'Hi!', timestamp: startTime + 2 },
    { speaker: 'user', text: 'How are you?', timestamp: startTime + 3 },
    { speaker: 'assistant', text: 'Good, thanks!', timestamp: startTime + 4 },
  ];
  return {
    _transcript: transcript,
    _usage: opts.usage ?? [],
    _metadata: opts.metadata ?? null,
    _resetCount: 0,
    _flushedCount: 0,
    flushInterimTranscript() { this._flushedCount += 1; },
    getSessionStartTime() { return startTime; },
    getFullTranscript() { return [...this._transcript]; },
    getEffectiveFullTranscript() { return [...(opts.effectiveTranscript ?? this._transcript)]; },
    getFullUsage() { return [...this._usage]; },
    getFullSessionContext() { return 'full context'; },
    getMeetingMetadata() { return this._metadata; },
    reset() { this._resetCount += 1; },
  };
}

function buildMockLLMHelper(opts = {}) {
  const calls = [];
  return {
    generateMeetingSummary: async (a, b, c) => {
      calls.push({ a, b, c });
      if (opts.shouldThrow) throw new Error('LLM exploded');
      // alternate between title (1st) and summary (2nd)
      const isTitle = calls.length === 1;
      if (isTitle) return opts.titleResponse ?? null;
      return opts.summaryResponse ?? null;
    },
    _calls: calls,
  };
}

async function waitFor(predicate, maxMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const result = predicate();
    if (result) return result;
    await new Promise(r => setTimeout(r, 10));
  }
  return null;
}

async function waitForMeeting(db, id, maxMs = 3000) {
  return waitFor(() => {
    try {
      return db.getMeetingDetails(id);
    } catch {
      return null;
    }
  }, maxMs);
}

function setRetention(value) {
  const sm = SettingsManager.getInstance();
  const original = sm.get.bind(sm);
  sm.get = (key) => {
    if (key === 'meetingRetention') return value;
    if (key === 'providerDataScopes') return undefined;
    return original(key);
  };
  return () => { sm.get = original; };
}

describe('MeetingPersistence.deep — stopMeeting duration branches', () => {
  let restoreRetention;

  beforeEach(() => {
    restoreRetention = setRetention('forever');
    mockWindows.length = 0;
  });
  afterEach(() => {
    restoreRetention();
  });

  test('duration exactly 500ms is <1000ms → returns null and resets session', async () => {
    const session = buildMockSession({ startTime: Date.now() - 500 });
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);
    const result = await mp.stopMeeting();
    assert.equal(result, null);
    assert.equal(session._resetCount, 1);
    // LLM should never be called for too-short meetings
    assert.equal(llm._calls.length, 0);
  });

  test('duration 999ms is still too short', async () => {
    const session = buildMockSession({ startTime: Date.now() - 999 });
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);
    const result = await mp.stopMeeting();
    assert.equal(result, null);
  });

  test('duration 1001ms is processed (just above threshold)', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession({ startTime: Date.now() - 1001 });
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);
    const result = await mp.stopMeeting();
    assert.ok(result, 'meeting id must be returned');
    // Wait for final save to complete
    const final = await waitFor(() => {
      const meeting = db.getMeetingDetails(result);
      return meeting?.title !== 'Processing...' ? meeting : null;
    });
    assert.ok(final);
    assert.equal(final.id, result);
  });
});

describe('MeetingPersistence.deep — stopMeeting metadata.scenario + doNotPersist', () => {
  let restoreRetention;

  beforeEach(() => {
    restoreRetention = setRetention('forever');
    mockWindows.length = 0;
  });
  afterEach(() => { restoreRetention(); });

  test('metadata.scenario is captured via getMeetingMetadata but does not break persistence', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession({
      metadata: { scenario: 'sales', title: 'Sprint' },
    });
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);
    const result = await mp.stopMeeting();
    assert.ok(result);
    const final = await waitFor(() => {
      const meeting = db.getMeetingDetails(result);
      return meeting?.title === 'Sprint' ? meeting : null;
    });
    assert.ok(final);
    assert.equal(final.title, 'Sprint');
  });

  test('doNotPersist=true in metadata returns null and skips DB save', async () => {
    const db = DatabaseManager.getInstance();
    const beforeIds = new Set(db.getUnprocessedMeetings().map(m => m.id));
    const session = buildMockSession({
      startTime: Date.now() - 5000,
      metadata: { doNotPersist: true },
    });
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);
    const result = await mp.stopMeeting();
    assert.equal(result, null);
    // No new unprocessed meeting should have appeared
    const afterIds = new Set(db.getUnprocessedMeetings().map(m => m.id));
    const newOnes = [...afterIds].filter(id => !beforeIds.has(id));
    assert.equal(newOnes.length, 0, 'no meeting should have been saved');
    // LLM should never be invoked
    assert.equal(llm._calls.length, 0);
  });

  test('metadata.source overrides default "manual" source', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession({
      metadata: { source: 'calendar', title: 'WithSource' },
    });
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);
    const result = await mp.stopMeeting();
    const final = await waitFor(() => {
      const meeting = db.getMeetingDetails(result);
      return meeting?.source === 'calendar' ? meeting : null;
    });
    assert.ok(final);
    assert.equal(final.source, 'calendar');
  });

  test('metadata.calendarEventId persists to DB', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession({
      metadata: { calendarEventId: 'evt-deep-001', title: 'CalEvent' },
    });
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);
    const result = await mp.stopMeeting();
    const final = await waitFor(() => {
      const meeting = db.getMeetingDetails(result);
      return meeting?.calendarEventId === 'evt-deep-001' ? meeting : null;
    });
    assert.ok(final);
    assert.equal(final.calendarEventId, 'evt-deep-001');
  });
});

describe('MeetingPersistence.deep — processAndSaveMeeting LLM failure paths', () => {
  let restoreRetention;
  beforeEach(() => { restoreRetention = setRetention('forever'); mockWindows.length = 0; });
  afterEach(() => { restoreRetention(); });

  function buildSnapshot(overrides = {}) {
    return {
      transcript: overrides.transcript ?? [
        { speaker: 'user', text: 'a', timestamp: 1 },
        { speaker: 'assistant', text: 'b', timestamp: 2 },
        { speaker: 'user', text: 'c', timestamp: 3 },
        { speaker: 'assistant', text: 'd', timestamp: 4 },
      ],
      usage: overrides.usage ?? [],
      startTime: overrides.startTime ?? 1000,
      durationMs: overrides.durationMs ?? 60000,
      context: overrides.context ?? 'transcript hint',
    };
  }

  test('LLM throwing returns null but meeting is still saved with placeholder summary', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const llm = buildMockLLMHelper({ shouldThrow: true });
    const mp = new MeetingPersistence(session, llm);

    const snap = buildSnapshot();
    await mp.processAndSaveMeeting(snap, 'm-llm-fail');

    const final = db.getMeetingDetails('m-llm-fail');
    assert.ok(final, 'meeting must still be saved when LLM throws');
    // Meeting should NOT appear in unprocessed list
    const unprocessed = db.getUnprocessedMeetings();
    assert.equal(unprocessed.find(m => m.id === 'm-llm-fail'), undefined,
      'meeting must no longer be in unprocessed list');
    assert.ok(final.detailedSummary, 'detailed summary should still be set');
  });

  test('dynamic_action_artifact actions are merged into artifact by usage source', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);

    const usage = [
      {
        timestamp: 1000,
        question: 'q1',
        answer: 'a1',
        metadata: { source: 'dynamic_action', actionId: 'd1', actionType: 'followup_email', outputType: 'text', generationStatus: 'completed' },
      },
      {
        timestamp: 2000,
        question: 'q2',
        answer: 'a2',
        metadata: { source: 'dynamic_action', actionId: 'd2', actionType: 'prep_brief', outputType: 'text', generationStatus: 'completed' },
      },
    ];
    const snap = buildSnapshot({ usage });
    await mp.processAndSaveMeeting(snap, 'm-artifact');

    const final = db.getMeetingDetails('m-artifact');
    assert.ok(final, 'meeting must be saved');
    assert.ok(final.usage && final.usage.length === 2, 'both usage entries must be persisted');
  });

  test('mode snapshot captured via session when metadata includes modeSnapshot', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);
    const snap = buildSnapshot();
    await mp.processAndSaveMeeting(
      snap,
      'm-mode',
      { title: 'Mode-Test' },
      { id: 'mode-sales', name: 'Sales', templateType: 'sales' },
    );
    const final = db.getMeetingDetails('m-mode');
    assert.ok(final);
    assert.equal(final.title, 'Mode-Test');
  });

  test('metadata.title takes precedence over LLM-generated title', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const llm = buildMockLLMHelper({ titleResponse: 'LLM-title-should-not-be-used' });
    const mp = new MeetingPersistence(session, llm);
    const snap = buildSnapshot();
    await mp.processAndSaveMeeting(snap, 'm-title-precedence', { title: 'meta-title' });
    const final = db.getMeetingDetails('m-title-precedence');
    assert.equal(final.title, 'meta-title');
  });

  test('LLM summary with sections format is parsed correctly', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const calls = [];
    const llm = {
      generateMeetingSummary: async () => {
        calls.push(true);
        if (calls.length === 1) return 'Custom Title';
        return JSON.stringify({
          overview: 'overview text',
          sections: { 'Section A': ['x', 'y'], 'Section B': [] },
        });
      },
    };
    const mp = new MeetingPersistence(session, llm);
    const snap = buildSnapshot();
    await mp.processAndSaveMeeting(
      snap,
      'm-sections',
      null,
      { id: 'mode-sales', name: 'Sales', templateType: 'sales' },
    );
    const final = db.getMeetingDetails('m-sections');
    assert.ok(final);
    assert.equal(final.title, 'Custom Title');
    assert.equal(final.detailedSummary.overview, 'overview text');
  });

  test('malformed LLM summary preserves mode sections with empty bullets', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const llm = buildMockLLMHelper({
      titleResponse: 'Custom Title',
      summaryResponse: 'this is not valid json at all {',
    });
    const mp = new MeetingPersistence(session, llm);
    const snap = buildSnapshot();

    await mp.processAndSaveMeeting(
      snap,
      'm-bad-json-sections',
      null,
      { id: 'mode-sales', name: 'Sales', templateType: 'sales' },
    );

    const final = db.getMeetingDetails('m-bad-json-sections');
    assert.ok(final);
    assert.equal(final.title, 'Custom Title');
    assert.ok(Array.isArray(final.detailedSummary.sections));
    assert.equal(final.detailedSummary.sections.length, 6);
    assert.deepEqual(
      final.detailedSummary.sections.map(section => section.bullets),
      [[], [], [], [], [], []],
    );
  });

  test('long meeting summary uses chunks that include tail content', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const calls = [];
    const llm = {
      generateMeetingSummary: async (prompt, context) => {
        calls.push({ prompt, context });
        if (calls.length === 1) return '中文会议标题';
        if (prompt.includes('归并')) {
          return JSON.stringify({
            overview: '完整会议摘要',
            keyPoints: ['头部事项', '尾部事项'],
            actionItems: ['尾部确认下周提供测试数据'],
            decisions: ['先按只读方式验证'],
            openQuestions: [],
          });
        }
        return JSON.stringify({
          overview: context.includes('尾部确认下周提供测试数据') ? '尾部摘要' : '片段摘要',
          keyPoints: [],
          actionItems: context.includes('尾部确认下周提供测试数据') ? ['尾部确认下周提供测试数据'] : [],
          decisions: [],
          openQuestions: [],
        });
      },
    };
    const mp = new MeetingPersistence(session, llm);
    const context = `头部事项\n${'中间填充。'.repeat(12000)}\n尾部确认下周提供测试数据`;

    await mp.processAndSaveMeeting(
      buildSnapshot({
        context,
        transcript: [
          { speaker: '客户', text: '头部事项', timestamp: 1 },
          { speaker: '客户', text: '中间内容', timestamp: 2 },
          { speaker: '客户', text: '尾部确认下周提供测试数据', timestamp: 3 },
        ],
      }),
      'm-full-transcript-summary',
    );

    const final = db.getMeetingDetails('m-full-transcript-summary');
    assert.equal(final.detailedSummary.overview, '完整会议摘要');
    assert.deepEqual(final.detailedSummary.actionItems, ['尾部确认下周提供测试数据']);
    assert.ok(calls.some((call) => call.context.includes('尾部确认下周提供测试数据')));
  });

  test('LLM post-call enhancements are merged into detailedSummary', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    let callIndex = 0;
    const llm = {
      generateMeetingSummary: async () => {
        callIndex += 1;
        if (callIndex === 1) return '中文会议标题';
        if (callIndex === 2) {
          return JSON.stringify({
            overview: '客户确认 FDE 验证安排。',
            keyPoints: [],
            actionItems: ['客户下周提供测试数据'],
            decisions: ['第一阶段只读接入 PLM'],
            openQuestions: [],
          });
        }
        return JSON.stringify({
          coachingInsights: [
            {
              type: 'fde_validation_gap',
              title: '验证材料需要明确',
              detail: '客户已经确认测试数据，需要继续明确验收口径。',
              severity: 'opportunity',
              evidence: '客户下周提供测试数据',
            },
          ],
          followUpDraft: '您好，我们会基于只读接入范围准备验证材料。',
        });
      },
    };
    const mp = new MeetingPersistence(session, llm);

    await mp.processAndSaveMeeting(
      buildSnapshot({
        context: '客户下周提供测试数据。第一阶段只读接入 PLM。',
        transcript: [
          { speaker: '客户', text: '客户下周提供测试数据。', timestamp: 1 },
          { speaker: '我们', text: '第一阶段只读接入 PLM。', timestamp: 2 },
          { speaker: '客户', text: '好的。', timestamp: 3 },
        ],
      }),
      'm-llm-enhancements',
      null,
      { id: 'mode-fde', name: 'FDE', templateType: 'fde' },
    );

    const final = db.getMeetingDetails('m-llm-enhancements');
    assert.equal(final.detailedSummary.coachingInsights[0].title, '验证材料需要明确');
    assert.match(final.detailedSummary.followUpDraft, /只读接入范围/);
  });
});

describe('MeetingPersistence.deep — recoverUnprocessedMeetings edge cases', () => {
  let restoreRetention;
  beforeEach(() => { restoreRetention = setRetention('forever'); mockWindows.length = 0; });
  afterEach(() => { restoreRetention(); });

  test('returns early without throwing when DB has no unprocessed meetings', async () => {
    const session = buildMockSession();
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);
    // No prior meetings — should simply no-op
    await mp.recoverUnprocessedMeetings();
    // If we reach here without throwing, the early-return branch was exercised.
    assert.ok(true);
  });

  test('recovers a meeting marked isProcessed=false', async () => {
    const db = DatabaseManager.getInstance();
    db.saveMeeting({
      id: 'm-rec-deep',
      title: 'TBD',
      date: new Date().toISOString(),
      duration: '0:30',
      summary: 'Generating summary...',
      detailedSummary: { actionItems: [], keyPoints: [] },
      transcript: [
        { speaker: 'user', text: 'a', timestamp: 1 },
        { speaker: 'assistant', text: 'b', timestamp: 2 },
        { speaker: 'user', text: 'c', timestamp: 3 },
      ],
      usage: [],
      isProcessed: false,
    }, Date.now() - 60000, 30000);

    const session = buildMockSession();
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);

    await mp.recoverUnprocessedMeetings();
    const final = db.getMeetingDetails('m-rec-deep');
    assert.ok(final);
    // After recovery the meeting must no longer appear in the unprocessed list
    const unprocessed = db.getUnprocessedMeetings();
    assert.equal(unprocessed.find(m => m.id === 'm-rec-deep'), undefined,
      'recovered meeting must no longer be in unprocessed list');
  });

  test('recovers multiple unprocessed meetings in sequence', async () => {
    const db = DatabaseManager.getInstance();
    for (let i = 0; i < 3; i += 1) {
      db.saveMeeting({
        id: `m-rec-multi-${i}`,
        title: 'TBD',
        date: new Date().toISOString(),
        duration: '0:30',
        summary: 'Generating summary...',
        detailedSummary: { actionItems: [], keyPoints: [] },
        transcript: [
          { speaker: 'user', text: 'a', timestamp: 1 },
          { speaker: 'assistant', text: 'b', timestamp: 2 },
          { speaker: 'user', text: 'c', timestamp: 3 },
        ],
        usage: [],
        isProcessed: false,
      }, Date.now() - 60000, 30000);
    }

    const session = buildMockSession();
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);

    await mp.recoverUnprocessedMeetings();
    const unprocessed = db.getUnprocessedMeetings();
    for (let i = 0; i < 3; i += 1) {
      assert.equal(unprocessed.find(m => m.id === `m-rec-multi-${i}`), undefined,
        `meeting ${i} should no longer be in unprocessed list after recovery`);
      const final = db.getMeetingDetails(`m-rec-multi-${i}`);
      assert.ok(final, `meeting ${i} should be saved`);
    }
  });
});

describe('MeetingPersistence.deep — buildDynamicActionArtifactActionsFromUsage edge cases', () => {
  test('handles usage entries missing actionType but with all other fields', () => {
    const usage = [
      {
        timestamp: 1, question: 'q', answer: 'a',
        metadata: { source: 'dynamic_action', actionId: 'x', outputType: 'text' },
      },
    ];
    const result = buildDynamicActionArtifactActionsFromUsage(usage);
    // The export collapses entries that don't have BOTH actionType and outputType.
    assert.equal(result.length, 0, 'missing actionType must be skipped');
  });

  test('orders duplicates by status priority when both have full metadata', () => {
    const baseMeta = { source: 'dynamic_action', actionId: 'a', actionType: 't', outputType: 'text' };
    const usage = [
      { timestamp: 100, question: 'q', answer: '', metadata: { ...baseMeta, generationStatus: 'accepted' } },
      { timestamp: 200, question: 'q', answer: 'a', metadata: { ...baseMeta, generationStatus: 'completed' } },
      { timestamp: 50, question: 'q', answer: 'a', metadata: { ...baseMeta, generationStatus: 'auto_generated' } },
    ];
    const result = buildDynamicActionArtifactActionsFromUsage(usage);
    assert.equal(result.length, 1, 'duplicates by id collapse to one entry');
    assert.equal(result[0].status, 'completed', 'highest priority status wins');
    // createdAt should come from the earliest timestamp
    assert.equal(result[0].createdAt, 50);
  });

  test('treats entries with no metadata key as non-dynamic-action', () => {
    const usage = [
      { timestamp: 1, question: 'q', answer: 'a' }, // no metadata at all
      { timestamp: 2, question: 'q', answer: 'a', metadata: { source: 'other' } },
    ];
    const result = buildDynamicActionArtifactActionsFromUsage(usage);
    assert.equal(result.length, 0);
  });

  test('skips entries where source is dynamic_action but missing required id', () => {
    const usage = [
      { timestamp: 1, question: 'q', answer: 'a', metadata: { source: 'dynamic_action', actionType: 't', outputType: 'text' } },
    ];
    const result = buildDynamicActionArtifactActionsFromUsage(usage);
    assert.equal(result.length, 0, 'missing actionId must skip');
  });
});
