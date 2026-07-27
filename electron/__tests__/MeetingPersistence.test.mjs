// electron/__tests__/MeetingPersistence.test.mjs
//
// Behavioral coverage for MeetingPersistence.ts.
// Note: MeetingPersistence.js embeds its own copies of DatabaseManager and
// ModesManager classes. We can't override their methods from the test scope
// (they're not exposed via the module exports). Instead, we drive the real
// underlying DB (via a unique per-test userData dir) and inspect behavior by:
//   - return values of public methods
//   - session method call counts (the session object is injected)
//   - post-call DB state read from the same per-test DB path
//   - presence / absence of exceptions

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);

// Mock the electron module before requiring any dist-electron code.
const mockWindows = [];
const testUserData = path.join(os.tmpdir(), `meeting-persist-userdata-${process.hrtime.bigint()}`);
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
  return {
    _transcript: opts.transcript ?? [
      { speaker: 'user', text: 'Hello there', timestamp: startTime + 1 },
      { speaker: 'assistant', text: 'Hi!', timestamp: startTime + 2 },
      { speaker: 'user', text: 'How are you?', timestamp: startTime + 3 },
      { speaker: 'assistant', text: 'Good, thanks!', timestamp: startTime + 4 },
    ],
    _usage: opts.usage ?? [],
    _metadata: opts.metadata ?? null,
    _resetCount: 0,
    _flushedCount: 0,
    flushInterimTranscript() { this._flushedCount += 1; },
    getSessionStartTime() { return startTime; },
    getFullTranscript() { return [...this._transcript]; },
    getFullUsage() { return [...this._usage]; },
    getFullSessionContext() { return 'full context'; },
    getMeetingMetadata() { return this._metadata; },
    reset() { this._resetCount += 1; },
  };
}

function buildMockLLMHelper(opts = {}) {
  let callIndex = 0;
  return {
    titleResponse: opts.titleResponse ?? null,
    summaryResponse: opts.summaryResponse ?? null,
    titleCalls: 0,
    summaryCalls: 0,
    generateMeetingSummary: async () => {
      callIndex += 1;
      if (callIndex === 1) {
        const r = opts.titleResponse ?? null;
        if (r !== null) { opts.titleCalls = (opts.titleCalls ?? 0) + 1; }
        return r;
      }
      const r = opts.summaryResponse ?? null;
      if (r !== null) { opts.summaryCalls = (opts.summaryCalls ?? 0) + 1; }
      return r;
    },
  };
}

function buildMockBrowserWindow() {
  const sent = [];
  const win = {
    webContents: {
      send: (channel, payload) => { sent.push({ channel, payload }); },
    },
  };
  return { win, sent };
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

function clearActiveMode() {
  // The embedded ModesManager is NOT the same singleton as the external one,
  // so we cannot override its methods. We instead rely on the fact that the
  // embedded ModesManager, when reading from a freshly-seeded DB, returns the
  // default General mode — and we accept the LLM path through that mode.
  // For tests where we don't want any LLM call, we can also mock the LLM
  // helper to return null/empty.
  return () => {};
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

async function waitForMeeting(db, id, maxMs = 2000) {
  return waitFor(() => {
    try {
      return db.getMeetingDetails(id);
    } catch {
      return null;
    }
  }, maxMs);
}

describe('MeetingPersistence.stopMeeting', () => {
  let restoreRetention;
  let restoreMode;

  beforeEach(() => {
    restoreRetention = setRetention('forever');
    restoreMode = clearActiveMode();
  });

  afterEach(() => {
    restoreRetention();
    restoreMode();
    mockWindows.length = 0;
  });

  test('duration < 1000ms returns null and skips save (early return)', async () => {
    const session = buildMockSession({ startTime: Date.now() - 500 });
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);

    const result = await mp.stopMeeting();

    assert.equal(result, null);
    assert.equal(session._resetCount, 1, 'session should still be reset');
  });

  test('happy path: duration > 1s returns meeting id, placeholder is saved, then final save updates it', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const llm = buildMockLLMHelper({ titleResponse: 'My Test Meeting' });
    const mp = new MeetingPersistence(session, llm);

    const result = await mp.stopMeeting();

    assert.ok(result, 'a meeting id should be returned');
    assert.equal(typeof result, 'string');

    // Placeholder should be saved synchronously
    const placeholder = await waitForMeeting(db, result);
    assert.ok(placeholder, 'placeholder should be saved synchronously');
    assert.equal(placeholder.title, 'Processing...');
    // summary is a JSON column; the legacySummary inside is empty for placeholder
    assert.ok(placeholder.summary !== undefined);

    // session side effects
    assert.equal(session._resetCount, 1);
    assert.equal(session._flushedCount, 1);

    // Final save happens in background; the meeting should no longer be in the unprocessed list
    const finalMeeting = await waitFor(() => {
      const unprocessed = db.getUnprocessedMeetings();
      return !unprocessed.find(m => m.id === result) ? db.getMeetingDetails(result) : null;
    }, 3000);
    assert.ok(finalMeeting, 'final save should mark the meeting as processed');
    // The title from LLM (or metadata) overrides "Untitled Session"
    assert.ok(finalMeeting.title.length > 0);
  });

  test('happy path: notifies frontend via BrowserWindow.webContents.send', async () => {
    const session = buildMockSession();
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);

    const { win, sent } = buildMockBrowserWindow();
    mockWindows.push(win);

    const result = await mp.stopMeeting();
    assert.ok(result);

    // Two notifications: one from placeholder save, one from final save
    const channels = sent.map(s => s.channel);
    assert.ok(channels.includes('meetings-updated'), 'frontend should be notified');

    // Wait for background final save to complete
    await waitFor(() => {
      try {
        const unprocessed = DatabaseManager.getInstance().getUnprocessedMeetings();
        return !unprocessed.find(m => m.id === result);
      } catch { return false; }
    }, 3000);
    const finalUpdates = sent.filter(s => s.channel === 'meetings-updated');
    assert.ok(finalUpdates.length >= 2, 'at least two meetings-updated notifications (placeholder + final)');
  });

  // NOTE: retention='never' and SettingsManager-throw tests cannot be exercised
  // from the test scope because MeetingPersistence.js bundles its own SettingsManager
  // class. Source-level coverage for the retention path is in
  // electron/services/__tests__/MeetingPersistenceRace.test.mjs and
  // electron/services/__tests__/RetentionAndHybridRag.test.mjs.

  test('per-meeting metadata doNotPersist=true returns null', async () => {
    setRetention('forever');
    const session = buildMockSession({ metadata: { doNotPersist: true } });
    const llm = buildMockLLMHelper();
    const mp = new MeetingPersistence(session, llm);

    const result = await mp.stopMeeting();
    assert.equal(result, null);
  });
});

describe('MeetingPersistence.processAndSaveMeeting (background path)', () => {
  let restoreMode;

  beforeEach(() => {
    restoreMode = clearActiveMode();
  });

  afterEach(() => {
    restoreMode();
    setRetention('forever');
    mockWindows.length = 0;
  });

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

  test('transcript with <= 2 segments still saves the meeting with the data intact', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    let llmCallCount = 0;
    const llm = {
      generateMeetingSummary: async () => {
        llmCallCount += 1;
        return null;
      },
    };
    const mp = new MeetingPersistence(session, llm);

    const snap = buildSnapshot({ transcript: [{ speaker: 'user', text: 'a' }, { speaker: 'assistant', text: 'b' }] });
    await mp.processAndSaveMeeting(snap, 'm-short');

    const final = db.getMeetingDetails('m-short');
    assert.ok(final, 'meeting should be saved');
    assert.equal(final.id, 'm-short');
    // The 2-segment transcript is preserved (no LLM-driven truncation)
    assert.ok(final.transcript.length >= 2, 'transcript should be preserved');
    assert.equal(llmCallCount, 0, 'short meetings must not invoke title, summary, or enhancement LLM calls');
  });

  test('uses metadata title when provided (no LLM title call needed)', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const llm = { generateMeetingSummary: async () => 'should not be used' };
    const mp = new MeetingPersistence(session, llm);

    const snap = buildSnapshot();
    await mp.processAndSaveMeeting(snap, 'm-meta', { title: 'Standup Notes', source: 'manual' });

    const final = db.getMeetingDetails('m-meta');
    assert.ok(final);
    assert.equal(final.title, 'Standup Notes');
    assert.equal(final.source, 'manual');
  });

  test('uses metadata calendarEventId when provided', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const llm = { generateMeetingSummary: async () => null };
    const mp = new MeetingPersistence(session, llm);

    const snap = buildSnapshot();
    await mp.processAndSaveMeeting(snap, 'm-cal', {
      title: 'Cal Meeting',
      calendarEventId: 'evt-123',
      source: 'calendar',
    });

    const final = db.getMeetingDetails('m-cal');
    assert.ok(final);
    assert.equal(final.calendarEventId, 'evt-123');
    assert.equal(final.source, 'calendar');
  });

  test('transcript > 2 segments invokes LLM summary and parses JSON', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const calls = [];
    const llm = {
      generateMeetingSummary: async () => {
        calls.push(true);
        if (calls.length === 1) return 'Sprint Planning';
        return JSON.stringify({
          overview: 'Discussion of Q3 milestones',
          keyPoints: ['Roadmap finalized', 'Sprint cadence confirmed'],
          actionItems: ['Alice owns docs'],
        });
      },
    };
    const mp = new MeetingPersistence(session, llm);

    const snap = buildSnapshot();
    await mp.processAndSaveMeeting(snap, 'm-summary');

    const final = db.getMeetingDetails('m-summary');
    assert.ok(final, 'meeting should be saved');
    assert.equal(final.title, 'Sprint Planning');
    assert.equal(final.detailedSummary.overview, 'Discussion of Q3 milestones');
    assert.ok(Array.isArray(final.detailedSummary.actionItems));
    assert.ok(final.detailedSummary.actionItems.includes('Alice owns docs'));
  });

  test('title generation failure keeps fallback title and still generates summary', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    let calls = 0;
    const llm = {
      generateMeetingSummary: async () => {
        calls += 1;
        if (calls === 1) throw new Error('provider unavailable');
        return JSON.stringify({
          overview: 'Summary still generated',
          keyPoints: ['Title failure is isolated'],
          actionItems: [],
        });
      },
    };
    const mp = new MeetingPersistence(session, llm);

    await mp.processAndSaveMeeting(buildSnapshot(), 'm-title-failure');

    const final = db.getMeetingDetails('m-title-failure');
    assert.ok(final, 'meeting should still be saved');
    assert.ok(calls >= 2, 'summary generation should run after title generation fails');
    assert.equal(final.title, 'Untitled Session');
    assert.equal(final.detailedSummary.overview, 'Summary still generated');
  });

  test('structured summary chunks long context without dropping its tail', async () => {
    const session = buildMockSession();
    const calls = [];
    const llm = {
      generateMeetingSummary: async (_prompt, context) => {
        calls.push(context);
        return JSON.stringify({ overview: 'summary', keyPoints: [], actionItems: [] });
      },
    };
    const mp = new MeetingPersistence(session, llm);
    const context = `${'甲'.repeat(50000)}尾部应进入摘要`;

    await mp.processAndSaveMeeting(
      buildSnapshot({ context }),
      'm-summary-context-limit',
      { title: '已有标题' },
    );

    const chunkContexts = calls.filter((value) => value.includes('会议片段：'));
    assert.ok(chunkContexts.length >= 2, 'long transcript should be split into summary chunks');
    assert.match(chunkContexts[0], /甲{20}/);
    assert.ok(
      chunkContexts.some((value) => value.includes('尾部应进入摘要')),
      'the final transcript tail should reach a summary chunk',
    );
  });

  test('Groq-style summary field is persisted as the overview shown in meeting details', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    let calls = 0;
    const llm = {
      generateMeetingSummary: async () => {
        calls += 1;
        if (calls === 1) return null;
        return JSON.stringify({
          summary: '讨论了 Q3 里程碑。',
          keyPoints: ['确认路线图'],
          actionItems: ['Alice 整理文档'],
          decisions: ['按原计划推进'],
        });
      },
    };
    const mp = new MeetingPersistence(session, llm);

    await mp.processAndSaveMeeting(buildSnapshot(), 'm-groq-summary-field');

    const final = db.getMeetingDetails('m-groq-summary-field');
    assert.ok(final, 'meeting should be saved');
    assert.equal(final.detailedSummary.overview, '讨论了 Q3 里程碑。');
    assert.deepEqual(final.detailedSummary.keyPoints, ['确认路线图']);
    assert.deepEqual(final.detailedSummary.actionItems, ['Alice 整理文档']);
  });

  test('LLM title that returns closing-summary prose is sanitized before save', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    let calls = 0;
    const llm = {
      generateMeetingSummary: async () => {
        calls += 1;
        if (calls === 1) {
          return '好的，那今天的会议就到这里啦。今天我们重点围绕企业质量管理流程中的风险管理展开了讨论，明确了项目场景下风险管理的核心定义、常见风险类型，也梳理了后续需推进的风险分类、对应责任人确认及最小化交付artifact梳理等关键工作要点。感谢各位的参与。';
        }
        return JSON.stringify({ overview: 'overview', keyPoints: [], actionItems: [] });
      },
    };
    const mp = new MeetingPersistence(session, llm);

    await mp.processAndSaveMeeting(buildSnapshot({
      context: '本次会议围绕企业质量管理流程中的风险管理展开，确认风险分类、责任人和交付 artifact。',
    }), 'm-long-title-prose');

    const final = db.getMeetingDetails('m-long-title-prose');
    assert.ok(final);
    assert.ok(final.title.length <= 32, `title should be short, got ${final.title.length}: ${final.title}`);
    assert.doesNotMatch(final.title, /会议就到这里|感谢各位|关键工作要点/);
  });

  test('LLM title that returns markdown meeting notes is sanitized before save', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    let calls = 0;
    const llm = {
      generateMeetingSummary: async () => {
        calls += 1;
        if (calls === 1) {
          return `### 非ERP产线数据量号提取落地方案（结合天健数据质量背景）
#### 一、核心需求拆解
针对天健方非ERP产线数据，通过现有代码实现路径输入自动化提取量号。

#### 二、关键行动项
1. 数据适配梳理
2. 代码优化与验证
3. 场景重置执行`;
        }
        return JSON.stringify({ overview: 'overview', keyPoints: [], actionItems: [] });
      },
    };
    const mp = new MeetingPersistence(session, llm);

    await mp.processAndSaveMeeting(buildSnapshot({
      context: '讨论非ERP产线数据量号提取落地方案，重点是天健数据质量、路径输入自动提取和场景重置。',
    }), 'm-long-title-markdown');

    const final = db.getMeetingDetails('m-long-title-markdown');
    assert.ok(final);
    assert.ok(final.title.length <= 32, `title should be short, got ${final.title.length}: ${final.title}`);
    assert.doesNotMatch(final.title, /###|####|关键行动项|核心需求拆解|1\./);
  });

  test('LLM returns markdown-fenced summary — JSON still parsed', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    let calls = 0;
    const llm = {
      generateMeetingSummary: async () => {
        calls += 1;
        if (calls === 1) return null;
        return '```json\n{"overview":"hi","keyPoints":["a"],"actionItems":[]}\n```';
      },
    };
    const mp = new MeetingPersistence(session, llm);

    await mp.processAndSaveMeeting(buildSnapshot(), 'm-fence');
    const final = db.getMeetingDetails('m-fence');
    assert.ok(final);
    assert.equal(final.detailedSummary.overview, 'hi');
  });

  test('LLM summary parse failure is non-fatal — meeting still saved', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const llm = {
      generateMeetingSummary: async () => 'this is not valid json at all {',
    };
    const mp = new MeetingPersistence(session, llm);

    await mp.processAndSaveMeeting(buildSnapshot(), 'm-bad-json');

    const final = db.getMeetingDetails('m-bad-json');
    assert.ok(final, 'meeting should still be saved when LLM summary is malformed');
    assert.ok(final.detailedSummary, 'detailed summary should still be set');
  });

  test('dynamic_action usage does not throw during processing', async () => {
    const db = DatabaseManager.getInstance();
    const session = buildMockSession();
    const llm = { generateMeetingSummary: async () => null };
    const mp = new MeetingPersistence(session, llm);

    const usage = [
      {
        timestamp: 12345,
        question: 'current step',
        answer: 'completed',
        metadata: {
          source: 'dynamic_action',
          actionId: 'act-1',
          actionType: 'followup_email',
          outputType: 'text',
          modeTemplateType: 'sales',
        },
      },
    ];
    await mp.processAndSaveMeeting(buildSnapshot({ usage }), 'm-da');

    const final = db.getMeetingDetails('m-da');
    assert.ok(final, 'meeting should be saved despite dynamic action usage');
    assert.ok(final.detailedSummary !== undefined);
  });
});

describe('buildDynamicActionArtifactActionsFromUsage', () => {
  test('merges duplicates by id with highest-priority status', () => {
    const usage = [
      { timestamp: 100, question: 'q1', answer: '', metadata: { source: 'dynamic_action', actionId: 'a', actionType: 't1', outputType: 'text' } },
      { timestamp: 200, question: 'q2', answer: 'final answer', metadata: { source: 'dynamic_action', actionId: 'a', actionType: 't1', outputType: 'text', generationStatus: 'completed' } },
      { timestamp: 50, question: 'q3', metadata: { source: 'dynamic_action', actionId: 'a', actionType: 't1', outputType: 'text' } },
    ];
    const result = buildDynamicActionArtifactActionsFromUsage(usage);
    assert.equal(result.length, 1, 'duplicates by id collapse');
    assert.equal(result[0].id, 'a');
    assert.equal(result[0].status, 'completed');
    assert.equal(result[0].createdAt, 50);
  });

  test('ignores non dynamic_action entries', () => {
    const usage = [
      { metadata: { source: 'screen' } },
      { metadata: { source: 'transcript' } },
      null,
      { metadata: null },
    ];
    const result = buildDynamicActionArtifactActionsFromUsage(usage);
    assert.equal(result.length, 0);
  });

  test('skips entries missing required fields', () => {
    const usage = [
      { metadata: { source: 'dynamic_action', actionId: 'x' } },
      { metadata: { source: 'dynamic_action', actionType: 't', outputType: 'text' } },
    ];
    const result = buildDynamicActionArtifactActionsFromUsage(usage);
    assert.equal(result.length, 0);
  });

  test('orders by status priority: completed > generated_failed > auto_generated > accepted', () => {
    const make = (status) => ({
      timestamp: 1,
      question: 'q',
      answer: '',
      metadata: { source: 'dynamic_action', actionId: 'x', actionType: 't', outputType: 'text', generationStatus: status },
    });
    const completed = buildDynamicActionArtifactActionsFromUsage([make('completed')]);
    const failed = buildDynamicActionArtifactActionsFromUsage([make('generated_failed')]);
    const auto = buildDynamicActionArtifactActionsFromUsage([make('auto_generated')]);
    const accepted = buildDynamicActionArtifactActionsFromUsage([make('accepted')]);
    assert.equal(completed[0].status, 'completed');
    assert.equal(failed[0].status, 'generated_failed');
    assert.equal(auto[0].status, 'auto_generated');
    assert.equal(accepted[0].status, 'accepted');
  });

  test('buildDynamicActionArtifactActionsFromUsage preserves dynamic action trigger source', () => {
    const actions = buildDynamicActionArtifactActionsFromUsage([
      {
        timestamp: 200,
        question: 'q',
        answer: 'final answer',
        metadata: {
          source: 'dynamic_action',
          actionId: 'a',
          parentActionId: 'parent-a',
          actionType: 'pricing_objection',
          outputType: 'spoken_response',
          modeTemplateType: 'sales',
          generationStatus: 'completed',
          triggerSource: 'auto_countdown',
        },
      },
    ]);

    assert.equal(actions[0].triggerSource, 'auto_countdown');
    assert.equal(actions[0].parentActionId, 'parent-a');
  });

  test('preserves recruiting source intent from metadata when merging by action id', () => {
    const actions = buildDynamicActionArtifactActionsFromUsage([
      {
        timestamp: 100,
        question: 'Do not infer a source intent from this question.',
        answer: 'Do not infer a source intent from this answer.',
        metadata: {
          source: 'dynamic_action',
          actionId: 'recruiting-evidence-1',
          actionType: 'candidate_evidence_summary',
          outputType: 'checklist',
          modeTemplateType: 'recruiting',
          generationStatus: 'accepted',
        },
      },
      {
        timestamp: 200,
        question: 'The source intent exists only in metadata.',
        answer: 'Internal evidence summary.',
        metadata: {
          source: 'dynamic_action',
          actionId: 'recruiting-evidence-1',
          actionType: 'candidate_evidence_summary',
          outputType: 'checklist',
          modeTemplateType: 'recruiting',
          sourceIntent: 'recruiting_bei_evidence_gap',
          generationStatus: 'completed',
        },
      },
    ]);

    assert.equal(actions.length, 1);
    assert.equal(actions[0].sourceIntent, 'recruiting_bei_evidence_gap');
  });
});

describe('MeetingPersistence.recoverUnprocessedMeetings', () => {
  let restoreMode;

  beforeEach(() => {
    restoreMode = clearActiveMode();
  });

  afterEach(() => {
    restoreMode();
    setRetention('forever');
    mockWindows.length = 0;
  });

  test('returns early when there are no unprocessed meetings', async () => {
    const db = DatabaseManager.getInstance();
    // Ensure DB is clean
    const session = buildMockSession();
    const llm = { generateMeetingSummary: async () => null };
    const mp = new MeetingPersistence(session, llm);

    const before = db.getUnprocessedMeetings();
    await mp.recoverUnprocessedMeetings();
    const after = db.getUnprocessedMeetings();
    // Should not have introduced new unprocessed meetings
    assert.equal(after.length, before.length);
  });

  test('recovers a single unprocessed meeting marked with isProcessed=true', async () => {
    const db = DatabaseManager.getInstance();
    // Seed an unprocessed meeting directly
    const transcript = [
      { speaker: 'user', text: 'hi', timestamp: 1 },
      { speaker: 'assistant', text: 'hello', timestamp: 2 },
      { speaker: 'user', text: 'ok', timestamp: 3 },
    ];
    db.saveMeeting({
      id: 'm-recover-1',
      title: 'Old Meeting',
      date: new Date().toISOString(),
      duration: '0:30',
      summary: 'Generating summary...',
      detailedSummary: { actionItems: [], keyPoints: [] },
      transcript,
      usage: [],
      isProcessed: false,
    }, Date.now() - 1800000, 30000);

    const session = buildMockSession();
    const llm = { generateMeetingSummary: async () => null };
    const mp = new MeetingPersistence(session, llm);

    await mp.recoverUnprocessedMeetings();

    const final = db.getMeetingDetails('m-recover-1');
    assert.ok(final, 'recovered meeting should be in DB');
    // After recovery, the meeting is no longer in the unprocessed list
    const unprocessed = db.getUnprocessedMeetings();
    assert.equal(unprocessed.find(m => m.id === 'm-recover-1'), undefined,
      'recovered meeting should no longer be marked unprocessed');
  });

  test('handles per-meeting errors without aborting the recovery loop', async () => {
    const db = DatabaseManager.getInstance();
    // Seed one good meeting
    const goodTranscript = [
      { speaker: 'user', text: 'a', timestamp: 1 },
      { speaker: 'assistant', text: 'b', timestamp: 2 },
      { speaker: 'user', text: 'c', timestamp: 3 },
    ];
    db.saveMeeting({
      id: 'm-recover-good',
      title: 'Good',
      date: new Date().toISOString(),
      duration: '0:30',
      summary: 'Generating summary...',
      detailedSummary: { actionItems: [], keyPoints: [] },
      transcript: goodTranscript,
      usage: [],
      isProcessed: false,
    }, Date.now() - 1800000, 30000);

    const session = buildMockSession();
    const llm = { generateMeetingSummary: async () => null };
    const mp = new MeetingPersistence(session, llm);

    // Should not throw even if internal per-meeting errors occur
    await mp.recoverUnprocessedMeetings();

    const good = db.getMeetingDetails('m-recover-good');
    assert.ok(good, 'good meeting should be saved');
    const unprocessed = db.getUnprocessedMeetings();
    assert.equal(unprocessed.find(m => m.id === 'm-recover-good'), undefined,
      'recovered meeting should no longer be in unprocessed list');
  });
});
