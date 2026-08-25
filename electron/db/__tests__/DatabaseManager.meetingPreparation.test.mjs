import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../../dist-electron/electron/db/DatabaseManager.js';

function makeManager() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = db;
  manager.ensuredDims = new Map();
  manager.runMigrations();
  return { db, manager };
}

describe('meeting preparation persistence', () => {
  let db;
  let manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
  });

  it('runs its migration repeatedly', () => {
    manager.runMigrations();
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'meeting_preparation%'").get().count,
      2,
    );
  });

  it('creates, updates, lists and restores a draft', () => {
    const created = manager.saveMeetingPreparation({ rawInput: '机器人客户交流', inputMethod: 'text' });

    assert.equal(created.status, 'draft');
    manager.saveMeetingPreparation({ ...created, rawInput: '机器人客户产品交流' });
    assert.equal(manager.getMeetingPreparation(created.id).rawInput, '机器人客户产品交流');
    assert.equal(manager.listMeetingPreparations(10)[0].id, created.id);
  });

  it('replaces questions transactionally and cascades on delete', () => {
    const created = manager.saveMeetingPreparation({ rawInput: '会议', inputMethod: 'text' });
    manager.saveMeetingPreparationResult(
      created.id,
      { modeRecommendation: null, historySummary: [], commitments: [] },
      [
        {
          id: 'q1',
          sortOrder: 0,
          question: '案例？',
          keyMomentType: 'case',
          rationale: [],
          evidenceStatus: 'missing',
          evidence: {
            knowledgeRequirements: [],
            supported: [],
            missing: ['案例'],
            limitations: [],
            citations: [],
            handlingScript: '会后补充',
            followupQuestions: [],
          },
          checkedAt: null,
        },
      ],
    );

    manager.deleteMeetingPreparation(created.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM meeting_preparation_questions').get().count, 0);
  });

  it('saves and reloads more than three manually maintained questions', () => {
    const created = manager.saveMeetingPreparation({ rawInput: '会议', inputMethod: 'text' });
    const questions = Array.from({ length: 4 }, (_, index) => ({
      id: `manual-${index + 1}`,
      sortOrder: index,
      question: `问题 ${index + 1}`,
      keyMomentType: 'custom',
      rationale: [],
      evidenceStatus: null,
      evidence: {
        knowledgeRequirements: [],
        supported: [],
        missing: [],
        limitations: [],
        citations: [],
        handlingScript: '',
        followupQuestions: [],
      },
      checkedAt: null,
    }));

    manager.saveMeetingPreparation({ ...created, questions });

    assert.deepEqual(
      manager.getMeetingPreparation(created.id).questions.map(({ question }) => question),
      ['问题 1', '问题 2', '问题 3', '问题 4'],
    );
  });

  it('removes preparation content when all user data is cleared', () => {
    manager.saveMeetingPreparation({ rawInput: '敏感客户会议', inputMethod: 'text' });

    assert.equal(manager.clearAllData(), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM meeting_preparations').get().count, 0);
  });
});
