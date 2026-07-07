import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../db/DatabaseManager.ts');
const dbSource = fs.readFileSync(dbPath, 'utf8');
const distRoot = path.resolve(__dirname, '../../../dist-electron/electron');
const databaseModule = await import(pathToFileURL(path.join(distRoot, 'db/DatabaseManager.js')).href);
const modeContextModule = await import(pathToFileURL(path.join(distRoot, 'services/ModeDefaultContexts.js')).href);

const { DatabaseManager } = databaseModule;
const { getDefaultModeCustomContext } = modeContextModule;
const LEGACY_FDE_DEFAULT_CUSTOM_CONTEXT = '你是 FDE 现场交付副驾驶。优先澄清客户工作流、系统边界、数据流、权限、安全合规、上线约束和成功标准。回答时先讲技术可行性与验证路径，再给出最小下一步；不要跳过未知项或替客户假设环境。';

function runFromV26(customContext) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE modes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template_type TEXT NOT NULL DEFAULT 'general',
      custom_context TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.pragma('user_version = 26');
  db.prepare('INSERT INTO modes (id, name, template_type, custom_context, is_active) VALUES (?, ?, ?, ?, 1)')
    .run('mode_fde_default', 'FDE', 'fde', customContext);

  const manager = Object.create(DatabaseManager.prototype);
  manager.db = db;
  manager.runMigrations();

  return db.prepare('SELECT custom_context FROM modes WHERE id = ?').get('mode_fde_default').custom_context;
}

describe('Mode database migrations', () => {
  test('v26 -> v27 migration backfills shipped default custom contexts and upgrades legacy FDE default copy', () => {
    assert.match(
      dbSource,
      /if\s*\(\s*version\s*<\s*27\s*\)/,
      'DatabaseManager must register a v27 migration for default mode custom contexts',
    );
    const v27Block = dbSource.match(/if\s*\(\s*version\s*<\s*27\s*\)[\s\S]*?user_version\s*=\s*27/);
    assert.ok(v27Block, 'v27 migration block must exist');
    assert.match(v27Block[0], /DEFAULT_MODE_CUSTOM_CONTEXT_BY_TEMPLATE/);
    assert.match(v27Block[0], /UPDATE\s+modes\s+SET\s+custom_context\s*=\s*\?/i);
    assert.match(v27Block[0], /TRIM\s*\(\s*custom_context\s*\)\s*=\s*''/i);
    assert.match(v27Block[0], /custom_context\s+IS\s+NULL/i);
    assert.match(v27Block[0], /isLegacyDefaultModeCustomContext/);
    for (const modeType of ['general', 'sales', 'fde', 'recruiting', 'team-meet', 'looking-for-work', 'technical-interview', 'lecture']) {
      assert.match(v27Block[0], new RegExp(modeType), `v27 migration must cover ${modeType}`);
    }
  });

  test('v27 migration upgrades legacy default FDE custom_context to the canonical manufacturing profile', () => {
    const migrated = runFromV26(LEGACY_FDE_DEFAULT_CUSTOM_CONTEXT);
    assert.equal(migrated, getDefaultModeCustomContext('fde'));
    assert.match(migrated, /制造业研发流程/);
    assert.match(migrated, /QMS/);
    assert.match(migrated, /AI Agent/);
  });

  test('v27 migration preserves user-authored FDE custom_context', () => {
    const custom = '客户当前只关心 MES 对接和工厂网络隔离，先别展开 PLM/QMS 全量讨论。';
    const migrated = runFromV26(custom);
    assert.equal(migrated, custom);
  });

  test('v22 -> v23 migration creates per-mode intent keyword defaults', () => {
    assert.match(
      dbSource,
      /if\s*\(\s*version\s*<\s*23\s*\)/,
      'DatabaseManager must register a v23 migration for mode intent keywords',
    );
    const v23Block = dbSource.match(/if\s*\(\s*version\s*<\s*23\s*\)[\s\S]*?user_version\s*=\s*23/);
    assert.ok(v23Block, 'v23 migration block must exist');
    assert.match(v23Block[0], /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+mode_intent_keywords/i);
    assert.match(v23Block[0], /UNIQUE\s*\(\s*mode_id\s*,\s*intent\s*\)/i);
    assert.match(v23Block[0], /FOREIGN\s+KEY\s*\(\s*mode_id\s*\)\s+REFERENCES\s+modes\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i);
    assert.match(v23Block[0], /DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE/);
    assert.match(v23Block[0], /INSERT\s+OR\s+IGNORE\s+INTO\s+mode_intent_keywords/i);
  });

  test('v21 -> v22 migration is registered for FDE seed backfill', () => {
    assert.match(
      dbSource,
      /if\s*\(\s*version\s*<\s*22\s*\)/,
      'DatabaseManager must register a v22 migration for existing databases',
    );
  });

  test('v22 migration inserts the FDE template mode when missing', () => {
    const v22Block = dbSource.match(/if\s*\(\s*version\s*<\s*22\s*\)[\s\S]*?user_version\s*=\s*22/);
    assert.ok(v22Block, 'v22 migration block must exist');
    assert.match(v22Block[0], /const\s+defaultFdeModeId\s*=\s*'mode_fde_default'/);
    assert.match(v22Block[0], /template_type\s*=\s*\?[\s\S]*'fde'/s);
    assert.match(v22Block[0], /INSERT\s+OR\s+IGNORE\s+INTO\s+modes[\s\S]*defaultFdeModeId/s);
  });

  test('v22 migration seeds FDE note sections for migrated databases', () => {
    const v22Block = dbSource.match(/if\s*\(\s*version\s*<\s*22\s*\)[\s\S]*?user_version\s*=\s*22/);
    assert.ok(v22Block, 'v22 migration block must exist');
    for (const title of ['客户目标', '现场工作流', '痛点与阻塞', '系统与数据约束', '方案假设', '风险与未知项', '行动项']) {
      assert.match(v22Block[0], new RegExp(title), `v22 migration must seed FDE section: ${title}`);
    }
  });

  test('v22 migration preserves an existing FDE mode instead of recreating it', () => {
    const v22Block = dbSource.match(/if\s*\(\s*version\s*<\s*22\s*\)[\s\S]*?user_version\s*=\s*22/);
    assert.ok(v22Block, 'v22 migration block must exist');
    assert.match(
      v22Block[0],
      /const\s+existingFdeMode\s*=[\s\S]*SELECT\s+id\s+FROM\s+modes\s+WHERE\s+template_type\s*=\s*\?/s,
      'v22 migration must query for an existing FDE mode first',
    );
    assert.match(
      v22Block[0],
      /if\s*\(\s*!\s*existingFdeMode\s*\)\s*\{[\s\S]*INSERT\s+OR\s+IGNORE\s+INTO\s+modes/s,
      'v22 migration must insert the default FDE mode only when no FDE mode exists',
    );
    assert.doesNotMatch(
      v22Block[0],
      /UPDATE\s+modes[\s\S]*template_type\s*=\s*['"]fde['"]|DELETE\s+FROM\s+modes/i,
      'v22 migration must not overwrite or delete existing FDE modes',
    );
  });

  test('v22 migration preserves existing FDE note sections and remains idempotent', () => {
    const v22Block = dbSource.match(/if\s*\(\s*version\s*<\s*22\s*\)[\s\S]*?user_version\s*=\s*22/);
    assert.ok(v22Block, 'v22 migration block must exist');
    assert.match(
      v22Block[0],
      /const\s+hasSection\s*=[\s\S]*SELECT\s+id\s+FROM\s+mode_note_sections\s+WHERE\s+mode_id\s*=\s*\?/s,
      'v22 migration must check whether FDE sections already exist',
    );
    assert.match(
      v22Block[0],
      /if\s*\(\s*!\s*hasSection\s*\)\s*\{[\s\S]*INSERT\s+OR\s+IGNORE\s+INTO\s+mode_note_sections/s,
      'v22 migration must seed sections only when the FDE mode has no existing sections',
    );
    assert.doesNotMatch(
      v22Block[0],
      /DELETE\s+FROM\s+mode_note_sections|UPDATE\s+mode_note_sections/i,
      'v22 migration must not overwrite or delete existing FDE note sections',
    );
  });
});
