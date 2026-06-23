import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../db/DatabaseManager.ts');
const dbSource = fs.readFileSync(dbPath, 'utf8');

describe('Mode database migrations', () => {
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
});
