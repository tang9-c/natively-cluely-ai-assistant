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

describe('Profile Intelligence: resume + JD storage tables exist in the schema', () => {
  const dbPath = path.resolve(__dirname, '../../db/DatabaseManager.ts');
  const dbSource = fs.readFileSync(dbPath, 'utf8');

  test('user_profile table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS user_profile'));
  });

  test('resume_nodes table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS resume_nodes'));
  });

  test('profile_jds table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS profile_jds'));
  });

  test('profile_master table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS profile_master'));
  });

  test('mode_reference_file_metadata table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS mode_reference_file_metadata'));
  });
});
