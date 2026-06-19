// electron/services/__tests__/ProfileIntelligenceGate.test.mjs
//
// Verifies the Profile Intelligence IPC handlers are unconditionally
// available (all Pro features are unlocked in the open-source build).
// We test this at the source level (matching the existing ModeBleeding.test
// pattern) because the IPC handlers themselves require an Electron app
// runtime to instantiate.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '../../ipcHandlers.ts');

const PROFILE_HANDLERS = [
  'profile:upload-resume',
  'profile:set-mode',
  'profile:upload-jd',
  'profile:research-company',
  'profile:generate-negotiation',
  'profile:get-active-scenario',
  'profile:list-documents',
  'profile:upload-document',
  'profile:update-document-subtype',
  'profile:delete-document',
  'profile:get-master-profile',
  'profile:update-master-profile',
];

describe('Profile Intelligence IPC: all features unconditionally available', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  for (const handler of PROFILE_HANDLERS) {
    test(`handler "${handler}" no longer gates on Pro/trial`, () => {
      const idx = findSafeHandle(source, handler);
      assert.ok(idx >= 0, `Handler ${handler} not found in ipcHandlers.ts`);

      const slice = sliceSafeHandleBlock(source, handler).slice(0, 3000);

      assert.ok(
        !slice.includes('isProOrTrialActive()'),
        `Handler ${handler} must NOT invoke isProOrTrialActive() (Pro gate removed)`
      );
      assert.ok(
        !slice.includes('Pro license required'),
        `Handler ${handler} must NOT return "Pro license required" error`
      );
    });
  }

  test('profile:get-status returns safe defaults when orchestrator is missing', () => {
    const idx = findSafeHandle(source, 'profile:get-status');
    assert.ok(idx >= 0);
    const slice = sliceSafeHandleBlock(source, 'profile:get-status').slice(0, 1500);
    assert.ok(slice.includes('hasProfile: false'), 'profile:get-status must default to hasProfile=false when orchestrator missing');
  });
});

describe('Profile Intelligence: current schema tables exist in the schema', () => {
  const dbPath = path.resolve(__dirname, '../../db/DatabaseManager.ts');
  const dbSource = fs.readFileSync(dbPath, 'utf8');

  test('profile_jds table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS profile_jds'));
  });

  test('profile_master table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS profile_master'));
  });

  test('mode_reference_file_metadata table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS mode_reference_file_metadata'));
  });

  // The legacy user_profile + resume_nodes tables are still declared in the
  // initial v1 migration for backward compatibility with old databases. The
  // v19 migration drops them after folding structured_json into profile_master.

  test('v18 -> v19 migration is registered', () => {
    assert.match(
      dbSource,
      /if\s*\(\s*version\s*<\s*19\s*\)/,
      'DatabaseManager must register a v19 migration that drops user_profile and resume_nodes',
    );
  });

  test('v19 migration drops user_profile table', () => {
    assert.match(
      dbSource,
      /DROP\s+TABLE\s+IF\s+EXISTS\s+user_profile/,
      'v19 migration must DROP user_profile',
    );
  });

  test('v19 migration drops resume_nodes table', () => {
    assert.match(
      dbSource,
      /DROP\s+TABLE\s+IF\s+EXISTS\s+resume_nodes/,
      'v19 migration must DROP resume_nodes',
    );
  });

  test('v19 migration folds structured_json into profile_master', () => {
    assert.match(
      dbSource,
      /UPDATE\s+profile_master[\s\S]*display_name[\s\S]*experience_json/s,
      'v19 migration must UPDATE profile_master from user_profile.structured_json',
    );
  });

  test('v19 migration is idempotent: skips migration when master is non-empty', () => {
    // Source must guard the UPDATE so user-edited profile_master data is
    // never clobbered by stale structured_json during migration.
    const v19Block = dbSource.match(/if\s*\(\s*version\s*<\s*19\s*\)[\s\S]*?user_version\s*=\s*19/);
    assert.ok(v19Block, 'v19 migration block must exist');
    assert.match(
      v19Block[0],
      /masterIsEmpty|!\s*master|!\s*master\?\./,
      'v19 migration must check whether profile_master is empty before overwriting',
    );
  });
});
